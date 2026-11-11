//! Credential verification is independent of the update/download phase machine.
use super::UpdateFailure;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Default, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CredentialState {
    #[default]
    Unknown,
    Valid,
    Invalid,
    Expired,
    Disabled,
    QuotaExceeded,
    Mismatch,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub state: CredentialState,
    pub checking: bool,
    pub expires_at_seconds: Option<i64>,
    pub failure: Option<UpdateFailure>,
}

#[derive(Default)]
pub struct CredentialTracker {
    pub status: CredentialStatus,
    revision: u64,
    sequence: u64,
    in_flight: HashSet<(u64, u64)>,
}

impl CredentialTracker {
    pub fn reset(&mut self) {
        self.revision += 1;
        self.in_flight.clear();
        self.status = CredentialStatus::default();
    }
    pub fn begin(&mut self) -> (u64, u64) {
        self.sequence += 1;
        let token = (self.revision, self.sequence);
        self.in_flight.insert(token);
        self.status.checking = true;
        token
    }
    pub fn cancel(&mut self, token: (u64, u64)) {
        self.in_flight.remove(&token);
        self.status.checking = !self.in_flight.is_empty();
    }
    pub fn finish(
        &mut self,
        token: (u64, u64),
        result: Result<Option<i64>, UpdateFailure>,
        now: i64,
    ) -> bool {
        self.cancel(token);
        if token != (self.revision, self.sequence) {
            return false;
        }
        self.status.failure = result.as_ref().err().copied();
        match result {
            Ok(expiry) => {
                if let Some(expiry) = expiry.filter(|value| *value > 0) {
                    self.status.expires_at_seconds = Some(expiry);
                }
                self.status.state = if self
                    .status
                    .expires_at_seconds
                    .is_some_and(|expiry| expiry <= now)
                {
                    CredentialState::Expired
                } else {
                    CredentialState::Valid
                };
            }
            Err(failure) => {
                self.status.state = match failure {
                    UpdateFailure::CdkInvalid => {
                        self.status.expires_at_seconds = None;
                        CredentialState::Invalid
                    }
                    UpdateFailure::CdkExpired => CredentialState::Expired,
                    UpdateFailure::CdkDisabled => CredentialState::Disabled,
                    UpdateFailure::CdkQuotaExceeded => CredentialState::QuotaExceeded,
                    UpdateFailure::CdkMismatch => CredentialState::Mismatch,
                    _ => self.status.state,
                };
            }
        }
        true
    }
}

#[derive(Serialize, Deserialize)]
struct Cache {
    fingerprint: String,
    expires_at_seconds: Option<i64>,
}
fn fingerprint(cdk: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(cdk.as_bytes()))
}
pub fn load_expiry(dir: &std::path::Path, cdk: &str) -> Option<i64> {
    let cache: Cache =
        serde_json::from_slice(&std::fs::read(dir.join("cdk-status.json")).ok()?).ok()?;
    (cache.fingerprint == fingerprint(cdk))
        .then_some(cache.expires_at_seconds)
        .flatten()
}
pub fn save_expiry(
    dir: &std::path::Path,
    cdk: &str,
    expires_at_seconds: Option<i64>,
) -> std::io::Result<()> {
    crate::atomic_io::write_atomic(
        &dir.join("cdk-status.json"),
        &serde_json::to_vec(&Cache {
            fingerprint: fingerprint(cdk),
            expires_at_seconds,
        })?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_requests_and_old_credentials_cannot_overwrite_current_state() {
        let mut tracker = CredentialTracker::default();
        let old = tracker.begin();
        let new = tracker.begin();
        assert!(tracker.finish(new, Ok(Some(100)), 1));
        assert!(!tracker.finish(old, Err(UpdateFailure::CdkInvalid), 1));
        assert_eq!(tracker.status.state, CredentialState::Valid);
        assert!(!tracker.status.checking);
        let old = tracker.begin();
        tracker.reset();
        assert!(!tracker.finish(old, Ok(Some(100)), 1));
        assert_eq!(tracker.status.state, CredentialState::Unknown);
    }
    #[test]
    fn network_errors_do_not_invalidate_valid_credentials_and_expiry_uses_seconds() {
        let mut tracker = CredentialTracker::default();
        let token = tracker.begin();
        tracker.finish(token, Ok(Some(100)), 99);
        let token = tracker.begin();
        tracker.finish(token, Err(UpdateFailure::Network), 99);
        assert_eq!(tracker.status.state, CredentialState::Valid);
        assert_eq!(tracker.status.failure, Some(UpdateFailure::Network));
        let token = tracker.begin();
        tracker.finish(token, Ok(None), 100);
        assert_eq!(tracker.status.state, CredentialState::Expired);
    }
    #[test]
    fn cached_expiry_never_migrates_to_a_different_code() {
        let dir = tempfile::tempdir().unwrap();
        save_expiry(dir.path(), "a", Some(100)).unwrap();
        assert_eq!(load_expiry(dir.path(), "a"), Some(100));
        assert_eq!(load_expiry(dir.path(), "b"), None);
        let text = std::fs::read_to_string(dir.path().join("cdk-status.json")).unwrap();
        assert!(!text.contains("\"a\""));
    }
}
