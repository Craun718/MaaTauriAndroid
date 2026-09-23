//! npm-compatible version parsing for release tags.
//!
//! Release tags are not strict semver: `v1.2`, `1.2.3-beta.1`, and build
//! metadata all need to be accepted. `node-semver` intentionally implements
//! those looser rules, including npm precedence.

pub use node_semver::Version;

/// Checks a comma-separated constraint list such as `">=1.2.0, <2.0.0"`.
///
/// The explicit `==` spelling is retained for compatibility with tags emitted
/// by MaaFwApp's update metadata.
#[allow(dead_code)]
pub fn allowed_for(current: &Version, constraints: &str) -> bool {
    constraints
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .all(|item| {
            let item = item.trim_start_matches("==");
            node_semver::Range::parse(item).is_ok_and(|range| range.satisfies(current))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn newer(left: &str, right: &str) -> bool {
        let left = Version::parse(left).expect("left parses");
        let right = Version::parse(right).expect("right parses");
        left > right
    }

    #[test]
    fn parses_loosely_spelled_versions() {
        assert!(Version::parse(" v1.2 ").is_ok());
        assert!(Version::parse("1.2.3-beta.1").is_ok());

        // Build metadata is ignored by semver precedence.
        assert_eq!(Version::parse("1.2.3+build.5"), Version::parse("1.2.3"));
    }

    #[test]
    fn rejects_unparsable_versions() {
        assert!(Version::parse("").is_err());
        assert!(Version::parse("abc").is_err());
        assert!(Version::parse("1.2.x").is_err());
        assert!(Version::parse("v").is_err());
    }

    #[test]
    fn release_segments_compare_with_zero_padding() {
        assert!(newer("1.2.1", "1.2"));
        assert!(newer("1.10.0", "1.9.9"));
        assert!(newer("2.0", "1.99.99"));
        assert!(!newer("1.2.0", "1.2"));
        assert!(!newer("1.2", "1.2.0"));
    }

    #[test]
    fn pre_releases_sort_below_their_release() {
        assert!(newer("1.0.0", "1.0.0-rc.1"));
        assert!(newer("1.0.0-rc.2", "1.0.0-rc.1"));
        assert!(newer("1.0.0-beta", "1.0.0-alpha"));
        assert!(newer("1.0.0-alpha.2", "1.0.0-alpha"));
        assert!(newer("1.0.0-alpha", "1.0.0-1"));
        assert!(!newer("1.0.0-beta.1", "1.0.0-beta.1"));
    }

    #[test]
    fn constraints_must_all_hold() {
        let current = Version::parse("1.4.2").expect("parses");
        assert!(allowed_for(&current, ">=1.2.0, <2.0.0"));
        assert!(!allowed_for(&current, ">=1.5.0, <2.0.0"));
        assert!(allowed_for(&current, "1.4.2"));
        assert!(allowed_for(&current, "==v1.4.2"));
        assert!(!allowed_for(&current, ">1.4.2"));
        assert!(allowed_for(&current, "<=1.4.2, >1.0"));
        assert!(allowed_for(&current, ""));
        assert!(!allowed_for(&current, "not a version"));
    }
}
