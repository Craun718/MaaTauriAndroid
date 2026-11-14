//! PI pre-tasks run sequentially before a Maa controller is created. Their
//! arguments and output may contain passwords, so neither is logged.
use crate::domain::types::ResolvedPretask;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

// A cancelled shell script may have spawned children. Kill its process group,
// including when the surrounding future is dropped by a startup timeout.
struct ProcessGroup(Option<u32>);

impl Drop for ProcessGroup {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(id) = self.0 {
            // SAFETY: the child was started in a fresh group with its own PID.
            unsafe {
                libc::kill(-(id as i32), libc::SIGKILL);
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PretaskError {
    #[error("the run was stopped before controller startup")]
    Cancelled,
    #[error("pre-task {name} could not start: {source}")]
    Start {
        name: String,
        source: std::io::Error,
    },
    #[error("pre-task {name} could not be awaited: {source}")]
    Wait {
        name: String,
        source: std::io::Error,
    },
    #[error("pre-task {name} failed ({status})")]
    Exit {
        name: String,
        status: std::process::ExitStatus,
    },
}

pub async fn run(
    root: &Path,
    tasks: &[ResolvedPretask],
    environment: &BTreeMap<String, String>,
    cancelled: impl Fn() -> bool,
    preparing: impl Fn(&str),
) -> Result<(), PretaskError> {
    for task in tasks {
        if cancelled() {
            return Err(PretaskError::Cancelled);
        }
        preparing(&task.name);
        // Bare executable names use PATH; relative executable paths are based
        // on the interface directory rather than the app's own working dir.
        let executable = Path::new(&task.exec);
        let executable = if executable.is_relative() && executable.components().count() > 1 {
            root.join(executable)
        } else {
            executable.to_path_buf()
        };
        let mut command = Command::new(executable);
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command
            .args(&task.args)
            .envs(environment)
            .current_dir(root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|source| PretaskError::Start {
                name: task.name.clone(),
                source,
            })?;
        let mut group = ProcessGroup(child.id());
        loop {
            if cancelled() {
                drop(group);
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(PretaskError::Cancelled);
            }
            let status = child.try_wait().map_err(|source| PretaskError::Wait {
                name: task.name.clone(),
                source,
            })?;
            if let Some(status) = status {
                if !status.success() {
                    return Err(PretaskError::Exit {
                        name: task.name.clone(),
                        status,
                    });
                }
                group.0 = None;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    if cancelled() {
        return Err(PretaskError::Cancelled);
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn command(name: &str, script: &str) -> ResolvedPretask {
        ResolvedPretask {
            name: name.into(),
            exec: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
        }
    }

    #[tokio::test]
    async fn waits_in_order_and_uses_the_interface_directory() {
        let root = tempfile::tempdir().unwrap();
        run(
            root.path(),
            &[
                command("first", "printf '%s' \"$PI_CLIENT_NAME\" > ready"),
                command("second", "test \"$(cat ready)\" = TestClient"),
            ],
            &BTreeMap::from([("PI_CLIENT_NAME".into(), "TestClient".into())]),
            || false,
            |_| {},
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn stops_after_failure_and_does_not_expose_arguments() {
        let root = tempfile::tempdir().unwrap();
        let error = run(
            root.path(),
            &[
                command("first", "echo secret-value; exit 7"),
                command("second", "touch should-not-exist"),
            ],
            &BTreeMap::new(),
            || false,
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(matches!(error, PretaskError::Exit { .. }));
        assert!(!error.to_string().contains("secret-value"));
        assert!(!root.path().join("should-not-exist").exists());
    }

    #[tokio::test]
    async fn reports_spawn_failure() {
        let root = tempfile::tempdir().unwrap();
        let task = ResolvedPretask {
            name: "missing".into(),
            exec: "./missing".into(),
            args: vec![],
        };
        assert!(matches!(
            run(root.path(), &[task], &BTreeMap::new(), || false, |_| {}).await,
            Err(PretaskError::Start { .. })
        ));
    }

    #[tokio::test]
    async fn cancels_a_running_process_and_skips_the_remaining_tasks() {
        let root = tempfile::tempdir().unwrap();
        let polls = AtomicUsize::new(0);
        let result = run(
            root.path(),
            &[
                command("first", "exec sleep 30"),
                command("second", "touch should-not-exist"),
            ],
            &BTreeMap::new(),
            || polls.fetch_add(1, Ordering::SeqCst) > 1,
            |_| {},
        )
        .await;
        assert!(matches!(result, Err(PretaskError::Cancelled)));
        assert!(!root.path().join("should-not-exist").exists());
    }
}
