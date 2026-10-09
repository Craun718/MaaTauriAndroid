//! Download-rate sampling.

/// Computes a byte rate over a recent, bounded window.
///
/// A short window can jump wildly between chunk arrivals, so the first span is
/// deliberately ignored. Samples use caller-provided timestamps to keep the
/// arithmetic deterministic in tests.
#[derive(Debug, Default)]
pub struct TransferRateMeter {
    samples: Vec<(u64, u64)>,
}

impl TransferRateMeter {
    const WINDOW_MILLIS: u64 = 3_000;
    const MIN_SPAN_MILLIS: u64 = 1_000;

    /// Records a cumulative byte count and returns the current rate, if the
    /// available time span is long enough to make one meaningful.
    pub fn sample(&mut self, now_millis: u64, bytes: u64) -> Option<u64> {
        self.samples.push((now_millis, bytes));
        // Keep the earliest sample that is still inside the window. Stopping
        // there makes the measured span at least the configured window.
        while self.samples.len() > 2
            && now_millis.saturating_sub(self.samples[1].0) >= Self::WINDOW_MILLIS
        {
            self.samples.remove(0);
        }

        let &(start_millis, start_bytes) = self.samples.first()?;
        let span_millis = now_millis.saturating_sub(start_millis);
        if span_millis < Self::MIN_SPAN_MILLIS {
            return None;
        }
        let transferred = bytes.saturating_sub(start_bytes);
        Some(transferred * 1_000 / span_millis)
    }

    pub fn reset(&mut self) {
        self.samples.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIB: u64 = 1024 * 1024;

    #[test]
    fn nothing_is_reported_before_the_minimum_span() {
        let mut meter = TransferRateMeter::default();

        assert_eq!(meter.sample(0, 0), None);
        assert_eq!(meter.sample(500, MIB), None);
        assert_eq!(meter.sample(1_000, 2 * MIB), Some(2 * MIB));
    }

    #[test]
    fn the_rate_follows_the_recent_window() {
        let mut meter = TransferRateMeter::default();
        let mut bytes = 0;
        for time in (0..=6_000).step_by(500) {
            meter.sample(time, bytes);
            bytes += if time < 3_000 { 2 * MIB } else { MIB / 2 };
        }

        assert_eq!(meter.sample(6_500, bytes), Some(MIB));
    }

    #[test]
    fn a_stall_drops_the_rate_to_zero_once_it_fills_the_window() {
        let mut meter = TransferRateMeter::default();
        for time in (0..=2_000).step_by(500) {
            meter.sample(time, time * 1024);
        }
        let stalled = 2_000 * 1024;

        // The span includes the sample at 500 ms.
        assert_eq!(
            meter.sample(3_500, stalled),
            Some((stalled - 500 * 1024) * 1_000 / 3_000)
        );
        for time in (4_000..=5_000).step_by(500) {
            meter.sample(time, stalled);
        }
        assert_eq!(meter.sample(5_500, stalled), Some(0));
    }

    #[test]
    fn a_byte_count_reset_does_not_produce_a_negative_rate() {
        let mut meter = TransferRateMeter::default();
        meter.sample(0, 100);

        assert_eq!(meter.sample(1_000, 20), Some(0));
    }
}
