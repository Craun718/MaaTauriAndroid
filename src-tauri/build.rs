use std::path::{Path, PathBuf};

fn manifest_dir() -> PathBuf {
    PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets this"))
}

fn repo_root() -> PathBuf {
    manifest_dir().join("..")
}

/// The checkout's git directory. Worktrees keep `.git` as a file pointing at the
/// real one, so both layouts resolve.
fn git_dir(repo: &Path) -> Option<PathBuf> {
    let dot_git = repo.join(".git");
    if dot_git.is_file() {
        let text = std::fs::read_to_string(&dot_git).ok()?;
        let target = text.trim().strip_prefix("gitdir:")?.trim().to_string();
        return Some(PathBuf::from(target));
    }
    dot_git.is_dir().then_some(dot_git)
}

/// Runs `git` inside `dir`. `None` when the directory is not a checkout (an
/// uninitialized submodule, a packaged build) or git is unavailable — a build must
/// never fail because version metadata cannot be resolved.
fn git(dir: &Path, args: &[&str]) -> Option<String> {
    if !dir.join(".git").exists() {
        return None;
    }
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let text = text.trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// The tag HEAD points at, falling back to the short commit hash — the same
/// "tag, else hash" rule the version card describes.
fn tag_or_short_hash(repo: &Path) -> Option<String> {
    git(repo, &["describe", "--tags", "--exact-match", "HEAD"])
        .or_else(|| git(repo, &["rev-parse", "--short", "HEAD"]))
}

/// Every commit and checkout touches the reflog, so watching it keeps the baked
/// tags fresh without re-running the whole build on unrelated git activity.
fn watch_git_history(repo: &Path) {
    let Some(git_dir) = git_dir(repo) else {
        return;
    };
    for watched in ["HEAD", "logs/HEAD"] {
        let path = git_dir.join(watched);
        if path.exists() {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}

/// MaaFramework release the Android libraries are vendored from.
///
/// `scripts/env.sh` is the single source of truth (kept in sync with
/// `.github/workflows/ci.yml` and `vendor/maa/README.md`). The environment
/// variable wins when set, so CI can build against a different pin.
fn maa_framework_version() -> String {
    if let Ok(value) = std::env::var("MAAFW_VERSION") {
        let value = value.trim().to_string();
        if !value.is_empty() {
            return value;
        }
    }

    let env_sh = manifest_dir().join("../scripts/env.sh");
    println!("cargo:rerun-if-changed={}", env_sh.display());
    if let Ok(contents) = std::fs::read_to_string(&env_sh) {
        if let Some(version) = parse_env_sh_version(&contents) {
            return version;
        }
    }

    // No pin to name: a short hash of the vendored framework binary still tells
    // two builds of MaaFramework apart.
    short_file_hash(&manifest_dir().join("../vendor/maa/android/arm64-v8a/libMaaFramework.so"))
        .unwrap_or_else(|| "unknown".to_string())
}

/// Reads the default out of a `MAAFW_VERSION="${MAAFW_VERSION:-v5.13.0}"`
/// assignment. Deliberately a narrow parser instead of sourcing the script:
/// a build script must not execute repository shell.
fn parse_env_sh_version(contents: &str) -> Option<String> {
    for line in contents.lines() {
        let Some(rest) = line.trim().strip_prefix("MAAFW_VERSION=") else {
            continue;
        };
        let rest = rest.trim().trim_matches(['"', '\'']);
        let value = match rest.strip_prefix("${MAAFW_VERSION:-") {
            Some(inner) => inner.trim_end_matches('}'),
            None => rest,
        };
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// A short non-crypto hash of a file — enough to tell two builds of the same
/// library apart without pulling a hasher into the build dependencies.
fn short_file_hash(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in &bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    Some(format!("{hash:016x}")[..8].to_string())
}

fn main() {
    let root = repo_root();

    println!("cargo:rerun-if-env-changed=MAAFW_VERSION");
    println!("cargo:rustc-env=MAAFW_VERSION={}", maa_framework_version());
    println!(
        "cargo:rustc-env=MTA_APP_TAG={}",
        tag_or_short_hash(&root).unwrap_or_else(|| "unknown".to_string())
    );
    println!(
        "cargo:rustc-env=MTA_RESOURCE_TAG={}",
        tag_or_short_hash(&root.join("resource/m9a")).unwrap_or_default()
    );
    watch_git_history(&root);
    watch_git_history(&root.join("resource/m9a"));
    tauri_build::build()
}
