use super::types::{Project, ProjectMetadata};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

const MAX_WELCOME_BYTES: usize = 2 * 1024 * 1024;
const WELCOME_TIMEOUT: Duration = Duration::from_secs(5);

type WelcomeFuture<'a> = Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>>;

trait WelcomeFetcher: Send + Sync {
    fn fetch<'a>(&'a self, url: &'a str) -> WelcomeFuture<'a>;
}

pub(crate) async fn resolve_project(project: &mut Project) {
    let fetcher = ReqwestWelcomeFetcher::new();
    resolve(&mut project.metadata, &fetcher).await;
}

async fn resolve(metadata: &mut ProjectMetadata, fetcher: &dyn WelcomeFetcher) {
    if metadata.welcome.is_empty() {
        metadata.welcome_fingerprint = None;
        return;
    }

    let mut bodies = Vec::with_capacity(metadata.welcome.len());
    let declarations = if metadata.welcome_declarations.is_empty() {
        metadata.welcome.clone()
    } else {
        metadata.welcome_declarations.clone()
    };
    let mut declaration_bodies = Vec::with_capacity(declarations.len());
    let mut fetched = BTreeMap::new();
    let mut failed = false;

    for body in &metadata.welcome {
        match resolve_entry(body, &mut fetched, fetcher).await {
            Ok(value) => bodies.push(value),
            Err(error) => {
                failed = true;
                metadata.welcome_errors.push(error);
                break;
            }
        }
    }

    if !failed {
        for declaration in &declarations {
            match resolve_entry(declaration, &mut fetched, fetcher).await {
                Ok(value) => declaration_bodies.push(value),
                Err(error) => {
                    failed = true;
                    metadata.welcome_errors.push(error);
                    break;
                }
            }
        }
    }

    if failed {
        metadata.welcome_errors.sort();
        metadata.welcome_errors.dedup();
        metadata.welcome.clear();
        metadata.welcome_fingerprint = None;
        return;
    }

    metadata.welcome_fingerprint = Some(welcome_fingerprint(&declaration_bodies));
    metadata.welcome = bodies;
}

async fn resolve_entry<'a>(
    value: &'a str,
    fetched: &mut BTreeMap<String, String>,
    fetcher: &dyn WelcomeFetcher,
) -> Result<String, String> {
    if !is_remote_url(value) {
        return Ok(value.to_string());
    }
    if let Some(body) = fetched.get(value) {
        return Ok(body.clone());
    }
    let body = fetcher.fetch(value).await?;
    fetched.insert(value.to_string(), body.clone());
    Ok(body)
}

fn is_remote_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

fn welcome_fingerprint(bodies: &[String]) -> String {
    let canonical = serde_json::to_string(bodies).unwrap_or_else(|_| format!("{bodies:?}"));
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

struct ReqwestWelcomeFetcher {
    client: reqwest::Client,
}

impl ReqwestWelcomeFetcher {
    fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()
            .expect("the reqwest client must build");
        Self { client }
    }
}

impl WelcomeFetcher for ReqwestWelcomeFetcher {
    fn fetch<'a>(&'a self, url: &'a str) -> WelcomeFuture<'a> {
        Box::pin(async move {
            let response = self
                .client
                .get(url)
                .timeout(WELCOME_TIMEOUT)
                .header(
                    "user-agent",
                    concat!("MaaTauriAndroid/", env!("CARGO_PKG_VERSION")),
                )
                .send()
                .await
                .map_err(|error| format!("the request to {url} failed: {error}"))?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!("the request to {url} returned {status}"));
            }
            if response
                .content_length()
                .is_some_and(|length| length > MAX_WELCOME_BYTES as u64)
            {
                return Err(format!(
                    "the announcement from {url} exceeds the {MAX_WELCOME_BYTES} byte cap"
                ));
            }

            let mut body = Vec::new();
            let mut response = response;
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|error| format!("reading the announcement from {url} failed: {error}"))?
            {
                if body.len() + chunk.len() > MAX_WELCOME_BYTES {
                    return Err(format!(
                        "the announcement from {url} exceeds the {MAX_WELCOME_BYTES} byte cap"
                    ));
                }
                body.extend_from_slice(&chunk);
            }
            String::from_utf8(body)
                .map_err(|_| format!("the announcement from {url} is not valid UTF-8"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct StubFetcher {
        responses: Mutex<Vec<(&'static str, Result<String, String>)>>,
    }

    impl StubFetcher {
        fn new(responses: Vec<(&'static str, Result<String, String>)>) -> Self {
            Self {
                responses: Mutex::new(responses),
            }
        }
    }

    impl WelcomeFetcher for StubFetcher {
        fn fetch<'a>(&'a self, url: &'a str) -> WelcomeFuture<'a> {
            Box::pin(async move {
                let mut responses = self.responses.lock().expect("stub lock poisoned");
                let index = responses
                    .iter()
                    .position(|(prefix, _)| url.contains(prefix))
                    .ok_or_else(|| format!("the stub has no response for {url}"))?;
                responses.remove(index).1
            })
        }
    }

    fn metadata(welcome: Vec<String>) -> ProjectMetadata {
        ProjectMetadata {
            welcome_declarations: welcome.clone(),
            welcome,
            ..ProjectMetadata::default()
        }
    }

    #[tokio::test]
    async fn resolves_welcome_bodies_and_fingerprints_content() {
        let mut project = metadata(vec![
            "direct".to_string(),
            "https://example.test/announcement.md".to_string(),
        ]);
        let fetcher = StubFetcher::new(vec![(
            "announcement.md",
            Ok("# First announcement".to_string()),
        )]);

        resolve(&mut project, &fetcher).await;

        assert_eq!(
            project.welcome,
            vec!["direct".to_string(), "# First announcement".to_string()]
        );
        let first = project.welcome_fingerprint.expect("fingerprint");

        let mut project = metadata(vec!["https://example.test/announcement.md".to_string()]);
        let fetcher = StubFetcher::new(vec![(
            "announcement.md",
            Ok("# Second announcement".to_string()),
        )]);
        resolve(&mut project, &fetcher).await;
        let second = project.welcome_fingerprint.expect("fingerprint");

        assert_ne!(first, second);
    }

    #[tokio::test]
    async fn fingerprints_localized_declarations_instead_of_their_bodies() {
        let mut project = ProjectMetadata {
            welcome: vec!["旧公告".to_string()],
            welcome_declarations: vec!["$welcome".to_string()],
            ..ProjectMetadata::default()
        };
        resolve(&mut project, &StubFetcher::new(Vec::new())).await;
        let first = project.welcome_fingerprint.expect("fingerprint");

        let mut project = ProjectMetadata {
            welcome: vec!["Welcome".to_string()],
            welcome_declarations: vec!["$welcome".to_string()],
            ..ProjectMetadata::default()
        };
        resolve(&mut project, &StubFetcher::new(Vec::new())).await;
        let second = project.welcome_fingerprint.expect("fingerprint");

        assert_eq!(first, second);
    }

    #[tokio::test]
    async fn fetches_repeated_urls_once_in_declaration_order() {
        let mut project = metadata(vec![
            "https://example.test/a.md".to_string(),
            "static".to_string(),
            "https://example.test/a.md".to_string(),
        ]);
        let fetcher = StubFetcher::new(vec![("a.md", Ok("shared body".to_string()))]);

        resolve(&mut project, &fetcher).await;

        assert_eq!(
            project.welcome,
            vec![
                "shared body".to_string(),
                "static".to_string(),
                "shared body".to_string()
            ]
        );
    }

    #[tokio::test]
    async fn a_failed_fetch_suppresses_the_announcement_and_fingerprint() {
        let mut project = metadata(vec![
            "direct".to_string(),
            "https://example.test/missing.md".to_string(),
        ]);
        let fetcher = StubFetcher::new(vec![("missing.md", Err("HTTP 404".to_string()))]);

        resolve(&mut project, &fetcher).await;

        assert!(project.welcome.is_empty());
        assert_eq!(project.welcome_fingerprint, None);
        assert_eq!(project.welcome_errors, vec!["HTTP 404".to_string()]);
    }

    #[tokio::test]
    async fn rejects_oversized_announcement_bodies() {
        let mut project = metadata(vec!["https://example.test/large.md".to_string()]);
        let fetcher = StubFetcher::new(vec![("large.md", Ok("x".repeat(MAX_WELCOME_BYTES + 1)))]);

        resolve(&mut project, &fetcher).await;

        assert!(project.welcome.is_empty());
        assert_eq!(project.welcome_fingerprint, None);
    }
}
