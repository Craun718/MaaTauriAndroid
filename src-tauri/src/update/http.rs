//! HTTP plumbing for the update sources.
//!
//! A tiny `get`/`get_stream` abstraction keeps every network decision (real
//! reqwest vs. scripted test stub) swappable; the download pipeline only ever
//! sees statuses and byte chunks.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;
use tokio::sync::mpsc;

/// Future returned by the client trait. Hand-written so the trait stays
/// object-safe without pulling in `async-trait` or `futures-util`.
pub type HttpFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

/// A buffered `GET` response. Bodies above [`MAX_BODY_BYTES`] fail instead of
/// silently truncating.
#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

/// A streamed `GET` response: the body arrives as byte chunks on a channel so
/// a multi-hundred-megabyte APK never has to be buffered.
pub struct StreamResponse {
    pub status: u16,
    pub content_length: Option<u64>,
    pub body: mpsc::Receiver<std::io::Result<Vec<u8>>>,
}

pub trait UpdateHttpClient: Send + Sync + 'static {
    fn get<'a>(
        &'a self,
        url: &'a str,
        headers: &'a [(String, String)],
    ) -> HttpFuture<'a, HttpResponse>;
    fn get_stream<'a>(
        &'a self,
        url: &'a str,
        headers: &'a [(String, String)],
    ) -> HttpFuture<'a, StreamResponse>;
}

/// Guard against a runaway JSON body (a full release list stays far below this).
pub const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Whole-request timeout for buffered `GET`s only; downloads stream untimed.
const GET_TIMEOUT: Duration = Duration::from_secs(60);

pub struct ReqwestUpdateClient {
    client: reqwest::Client,
}

impl ReqwestUpdateClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .expect("the reqwest client must build");
        Self { client }
    }
}

impl Default for ReqwestUpdateClient {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdateHttpClient for ReqwestUpdateClient {
    fn get<'a>(
        &'a self,
        url: &'a str,
        headers: &'a [(String, String)],
    ) -> HttpFuture<'a, HttpResponse> {
        Box::pin(async move {
            let mut request = self.client.get(url).timeout(GET_TIMEOUT);
            for (name, value) in headers {
                request = request.header(name, value);
            }
            let response = request
                .send()
                .await
                .map_err(|error| format!("the request to {url} failed: {error}"))?;
            let status = response.status().as_u16();
            let body = read_capped(response, url).await?;
            Ok(HttpResponse { status, body })
        })
    }

    fn get_stream<'a>(
        &'a self,
        url: &'a str,
        headers: &'a [(String, String)],
    ) -> HttpFuture<'a, StreamResponse> {
        Box::pin(async move {
            let mut request = self.client.get(url);
            for (name, value) in headers {
                request = request.header(name, value);
            }
            let response = request
                .send()
                .await
                .map_err(|error| format!("the request to {url} failed: {error}"))?;
            let status = response.status().as_u16();
            let content_length = response.content_length();
            let (tx, rx) = mpsc::channel::<std::io::Result<Vec<u8>>>(8);
            tokio::spawn(async move {
                let mut response = response;
                loop {
                    match response.chunk().await {
                        Ok(Some(chunk)) => {
                            if tx.send(Ok(chunk.to_vec())).await.is_err() {
                                break;
                            }
                        }
                        Ok(None) => break,
                        Err(error) => {
                            let _ = tx
                                .send(Err(std::io::Error::new(
                                    std::io::ErrorKind::Other,
                                    format!("the download stream failed: {error}"),
                                )))
                                .await;
                            break;
                        }
                    }
                }
            });
            Ok(StreamResponse {
                status,
                content_length,
                body: rx,
            })
        })
    }
}

async fn read_capped(mut response: reqwest::Response, url: &str) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > MAX_BODY_BYTES {
                    return Err(format!(
                        "the response from {url} exceeds the {MAX_BODY_BYTES} byte cap"
                    ));
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(body),
            Err(error) => return Err(format!("reading the response from {url} failed: {error}")),
        }
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;

    /// A scripted GET response, matched by URL substring.
    pub struct BodyScript {
        pub url_contains: String,
        pub response: Result<HttpResponse, String>,
    }

    /// A scripted stream: all chunks are queued eagerly, so keep test chunks
    /// well below the channel capacity.
    pub struct StreamScript {
        pub url_contains: String,
        pub response: Result<StreamSpec, String>,
    }

    pub struct StreamSpec {
        pub status: u16,
        pub content_length: Option<u64>,
        pub chunks: Vec<std::io::Result<Vec<u8>>>,
    }

    /// In-memory [`UpdateHttpClient`]: every call is answered from scripted
    /// queues matched by URL substring, and every requested URL is recorded so
    /// tests can assert on query strings.
    pub struct StubClient {
        bodies: Mutex<Vec<BodyScript>>,
        streams: Mutex<Vec<StreamScript>>,
        requested_urls: Mutex<Vec<String>>,
    }

    impl StubClient {
        pub fn new() -> Self {
            Self {
                bodies: Mutex::new(Vec::new()),
                streams: Mutex::new(Vec::new()),
                requested_urls: Mutex::new(Vec::new()),
            }
        }

        fn with_body_script(
            mut self,
            url_contains: &str,
            response: Result<HttpResponse, String>,
        ) -> Self {
            self.bodies.lock().unwrap().push(BodyScript {
                url_contains: url_contains.to_string(),
                response,
            });
            self
        }

        pub fn with_body(self, url_contains: &str, status: u16, body: impl Into<Vec<u8>>) -> Self {
            self.with_body_script(
                url_contains,
                Ok(HttpResponse {
                    status,
                    body: body.into(),
                }),
            )
        }

        pub fn with_failed_body(self, url_contains: &str, error: &str) -> Self {
            self.with_body_script(url_contains, Err(error.to_string()))
        }

        pub fn with_stream(mut self, url_contains: &str, spec: StreamSpec) -> Self {
            self.streams.lock().unwrap().push(StreamScript {
                url_contains: url_contains.to_string(),
                response: Ok(spec),
            });
            self
        }

        pub fn requested_urls(&self) -> Vec<String> {
            self.requested_urls.lock().unwrap().clone()
        }
    }

    impl Default for StubClient {
        fn default() -> Self {
            Self::new()
        }
    }

    impl UpdateHttpClient for StubClient {
        fn get<'a>(
            &'a self,
            url: &'a str,
            _headers: &'a [(String, String)],
        ) -> HttpFuture<'a, HttpResponse> {
            Box::pin(async move {
                self.requested_urls.lock().unwrap().push(url.to_string());
                let mut bodies = self.bodies.lock().unwrap();
                let index = bodies
                    .iter()
                    .position(|script| url.contains(&script.url_contains))
                    .ok_or_else(|| format!("the stub has no scripted body for {url}"))?;
                Ok(bodies.remove(index).response?)
            })
        }

        fn get_stream<'a>(
            &'a self,
            url: &'a str,
            _headers: &'a [(String, String)],
        ) -> HttpFuture<'a, StreamResponse> {
            Box::pin(async move {
                self.requested_urls.lock().unwrap().push(url.to_string());
                let mut streams = self.streams.lock().unwrap();
                let index = streams
                    .iter()
                    .position(|script| url.contains(&script.url_contains))
                    .ok_or_else(|| format!("the stub has no scripted stream for {url}"))?;
                let spec = streams.remove(index).response?;
                let (tx, rx) = mpsc::channel(8);
                for chunk in spec.chunks {
                    let _ = tx.send(chunk).await;
                }
                drop(tx);
                Ok(StreamResponse {
                    status: spec.status,
                    content_length: spec.content_length,
                    body: rx,
                })
            })
        }
    }

    #[tokio::test]
    async fn stub_answers_gets_from_the_scripted_queue() {
        let client = StubClient::new()
            .with_body("first", 200, b"one".to_vec())
            .with_body("second", 404, b"{}".to_vec());

        let first = client.get("https://example.test/first", &[]).await.unwrap();
        assert_eq!(first.status, 200);
        assert_eq!(first.body, b"one");

        let second = client
            .get("https://example.test/second", &[])
            .await
            .unwrap();
        assert_eq!(second.status, 404);

        let error = client
            .get("https://example.test/first", &[])
            .await
            .unwrap_err();
        assert!(error.contains("no scripted body"));

        assert_eq!(client.requested_urls().len(), 3);
    }

    #[tokio::test]
    async fn stub_streams_chunks_in_order() {
        let client = StubClient::new().with_stream(
            "apk",
            StreamSpec {
                status: 200,
                content_length: Some(5),
                chunks: vec![Ok(b"he".to_vec()), Ok(b"llo".to_vec())],
            },
        );

        let response = client.get("https://cdn.test/app.apk", &[]).await.unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.content_length, Some(5));
        let mut body = Vec::new();
        while let Some(chunk) = response.body.recv().await {
            body.extend_from_slice(&chunk.unwrap());
        }
        assert_eq!(body, b"hello");
    }
}
