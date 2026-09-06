//! Time the way the window counts it: whole milliseconds since the epoch.
//!
//! Four things need this same number - the file tree, the trash, the snapshots
//! and the name of a print job - and each one of them would otherwise carry its
//! own cast. A clock set to before the epoch reads as zero here rather than as a
//! panic somewhere else.

use std::time::{SystemTime, UNIX_EPOCH};

/// Now, in milliseconds since the epoch.
pub fn now() -> u64 {
    at(SystemTime::now())
}

/// A moment in milliseconds since the epoch, or zero if it is older than that.
/// Beyond the year 584 million the number stops growing, which is long enough.
pub fn at(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |since| {
        u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
    })
}

/// The moment a file was last written, or zero if the filesystem will not say.
pub fn of(time: Option<SystemTime>) -> u64 {
    time.map_or(0, at)
}

#[cfg(test)]
mod tests {
    use super::{at, now, of};
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn counts_from_the_epoch() {
        assert_eq!(at(UNIX_EPOCH), 0);
        assert_eq!(at(UNIX_EPOCH + Duration::from_millis(1500)), 1500);
    }

    #[test]
    fn a_moment_before_the_epoch_reads_as_zero() {
        assert_eq!(at(UNIX_EPOCH - Duration::from_secs(10)), 0);
    }

    #[test]
    fn a_missing_time_reads_as_zero() {
        assert_eq!(of(None), 0);
        assert_eq!(of(Some(UNIX_EPOCH + Duration::from_millis(7))), 7);
    }

    #[test]
    fn now_is_after_the_epoch() {
        assert!(now() > 1_600_000_000_000);
    }
}
