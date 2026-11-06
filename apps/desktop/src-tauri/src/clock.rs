use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> u64 {
    at(SystemTime::now())
}

pub fn at(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |since| {
        u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
    })
}

pub fn iso(millis: u64) -> String {
    let days = millis / 86_400_000;
    let within = millis % 86_400_000;
    let (hours, minutes) = (within / 3_600_000, within / 60_000 % 60);
    let (seconds, thousandths) = (within / 1000 % 60, within % 1000);

    let shifted = days + 719_468;
    let era = shifted / 146_097;
    let of_era = shifted - era * 146_097;
    let year_of_era = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * of_year + 2) / 153;
    let day = of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + u64::from(month <= 2);

    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{thousandths:03}Z")
}

pub fn of(time: Option<SystemTime>) -> u64 {
    time.map_or(0, at)
}

#[cfg(test)]
mod tests {
    use super::{at, iso, now, of};
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
    fn a_moment_reads_as_the_window_writes_it() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_791_065_463_685), "2026-10-03T22:11:03.685Z");
        assert_eq!(iso(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
        assert_eq!(iso(1_735_689_599_999), "2024-12-31T23:59:59.999Z");
    }

    #[test]
    fn now_is_after_the_epoch() {
        assert!(now() > 1_600_000_000_000);
    }
}
