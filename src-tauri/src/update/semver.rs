//! Lenient semantic-version parsing and comparison.
//!
//! Ported from MaaFwApp's `update/UpdateVersion.kt`: release tags spell versions
//! loosely (`v1.2`, `1.2.3-beta.1`, `1.2.3+build`), so both the comparison and
//! the range check tolerate the shapes that actually show up in tags instead of
//! rejecting them.

use std::cmp::Ordering;

/// One pre-release segment: numeric segments compare numerically and sort
/// before text segments, matching semver's precedence rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreSegment {
    Num(u64),
    Text(String),
}

/// A parsed version: dotted numeric release segments with an optional
/// pre-release. Build metadata is parsed away and never affects ordering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    release: Vec<u64>,
    pre: Option<Vec<PreSegment>>,
}

impl Version {
    /// Parses a loosely-spelled version. Returns `None` for anything without
    /// at least one all-numeric release segment.
    pub fn parse(input: &str) -> Option<Self> {
        let input = input.trim();
        let input = input.strip_prefix(['v', 'V']).unwrap_or(input);
        // Build metadata never affects ordering.
        let input = input.split('+').next()?;
        let (release_part, pre_part) = match input.split_once('-') {
            Some((release, pre)) => (release, Some(pre)),
            None => (input, None),
        };
        if release_part.is_empty() {
            return None;
        }
        let mut release = Vec::new();
        for segment in release_part.split('.') {
            release.push(segment.parse::<u64>().ok()?);
        }
        let pre = pre_part.map(|pre| {
            pre.split(['.', '_'])
                .filter(|segment| !segment.is_empty())
                .map(|segment| match segment.parse::<u64>() {
                    Ok(value) => PreSegment::Num(value),
                    Err(_) => PreSegment::Text(segment.to_lowercase()),
                })
                .collect()
        });
        Some(Self { release, pre })
    }

    /// Whether `self` is strictly newer than `other`.
    pub fn is_newer_than(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Greater
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        // Missing segments count as zero, so 1.2 < 1.2.1.
        let width = self.release.len().max(other.release.len());
        for index in 0..width {
            let left = self.release.get(index).copied().unwrap_or(0);
            let right = other.release.get(index).copied().unwrap_or(0);
            if left != right {
                return left.cmp(&right);
            }
        }
        match (&self.pre, &other.pre) {
            (None, None) => Ordering::Equal,
            // A release sorts above any of its pre-releases.
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (Some(left), Some(right)) => compare_pre(left, right),
        }
    }
}

fn compare_pre(left: &[PreSegment], right: &[PreSegment]) -> Ordering {
    for (left, right) in left.iter().zip(right.iter()) {
        let ordering = match (left, right) {
            (PreSegment::Num(left), PreSegment::Num(right)) => left.cmp(right),
            (PreSegment::Text(left), PreSegment::Text(right)) => left.cmp(right),
            (PreSegment::Num(_), PreSegment::Text(_)) => Ordering::Less,
            (PreSegment::Text(_), PreSegment::Num(_)) => Ordering::Greater,
        };
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    // A longer pre-release with the same prefix sorts above its prefix.
    left.len().cmp(&right.len())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Constraint {
    Lt,
    Le,
    Eq,
    Ge,
    Gt,
}

/// Checks a comma-separated constraint list such as `">=1.2.0, <2.0.0"`.
/// Each item is one of `>`, `>=`, `<`, `<=`, `==` or a bare exact version.
/// Every item must pass; an unparsable item fails the whole check, matching
/// MaaFwApp's `allowedFor`.
#[allow(dead_code)] // ported for parity with MaaFwApp's UpdateVersion
pub fn allowed_for(current: &Version, constraints: &str) -> bool {
    constraints
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .all(|item| satisfies(current, item))
}

fn satisfies(current: &Version, item: &str) -> bool {
    let (constraint, target) = if let Some(rest) = item.strip_prefix(">=") {
        (Constraint::Ge, rest)
    } else if let Some(rest) = item.strip_prefix("<=") {
        (Constraint::Le, rest)
    } else if let Some(rest) = item.strip_prefix("==") {
        (Constraint::Eq, rest)
    } else if let Some(rest) = item.strip_prefix('>') {
        (Constraint::Gt, rest)
    } else if let Some(rest) = item.strip_prefix('<') {
        (Constraint::Lt, rest)
    } else {
        (Constraint::Eq, item.strip_prefix('=').unwrap_or(item))
    };
    let Some(target) = Version::parse(target) else {
        return false;
    };
    match current.cmp(&target) {
        Ordering::Less => matches!(constraint, Constraint::Lt | Constraint::Le),
        Ordering::Equal => matches!(constraint, Constraint::Le | Constraint::Eq | Constraint::Ge),
        Ordering::Greater => matches!(constraint, Constraint::Ge | Constraint::Gt),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn newer(left: &str, right: &str) -> bool {
        let left = Version::parse(left).expect("left parses");
        let right = Version::parse(right).expect("right parses");
        left.is_newer_than(&right)
    }

    #[test]
    fn parses_loosely_spelled_versions() {
        let version = Version::parse(" v1.2 ").expect("parses");
        assert_eq!(version.release, vec![1, 2]);
        assert!(version.pre.is_none());

        let version = Version::parse("1.2.3-beta.1").expect("parses");
        assert_eq!(version.release, vec![1, 2, 3]);
        assert_eq!(
            version.pre,
            Some(vec![PreSegment::Text("beta".into()), PreSegment::Num(1)])
        );

        // Build metadata is dropped.
        assert_eq!(Version::parse("1.2.3+build.5"), Version::parse("1.2.3"));
    }

    #[test]
    fn rejects_unparsable_versions() {
        assert!(Version::parse("").is_none());
        assert!(Version::parse("abc").is_none());
        assert!(Version::parse("1.2.x").is_none());
        assert!(Version::parse("v").is_none());
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
        // Numeric segments sort before text segments.
        assert!(newer("1.0.0-alpha", "1.0.0-1"));
        // A longer prefix sorts above its prefix.
        assert!(newer("1.0.0-alpha.2", "1.0.0-alpha"));
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
