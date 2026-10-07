//! Kick-drum onset detection for the audio-reactive visuals.
//!
//! The visuals pulse on the beat. Detection used to happen in the webview, on
//! band levels the capture loop averaged over 33 ms windows through a single
//! one-pole low-pass at 250 Hz. Two things went wrong with that:
//!
//!  - **Timing.** A kick could only be placed somewhere inside a 33 ms window,
//!    and was reported when the window ended — up to 33 ms late, varying beat
//!    to beat. A fixed latency allowance can cancel a constant delay but not
//!    that jitter, which is what makes a pulse read as "near" the beat rather
//!    than on it.
//!  - **Isolation.** A one-pole filter falls off at 6 dB/octave, so at 250 Hz
//!    it passes half the energy at 500 Hz — the body of every sung vowel. A
//!    syllable attack registered as a beat, and a loud sustained note raised
//!    the baseline enough to hide real kicks.
//!
//! This runs where the samples are: a 4th-order low-pass at
//! [`BASS_CUTOFF_HZ`] (24 dB/octave), energy measured every [`HOP_MS`], and an
//! onset decided against fast and slow envelopes of that energy in decibels, so
//! the thresholds mean the same at any input gain. Each onset keeps the sample
//! it occurred at, and the event that reports it says how long ago that was —
//! so the webview can place the beat to within a hop, not a window.

/// Kick drums put their energy at 50-100 Hz; bass guitar and voice sit above.
pub const BASS_CUTOFF_HZ: f32 = 150.0;
/// Onset resolution.
pub const HOP_MS: f32 = 4.0;
/// Envelope time constants: the fast one tracks the attack, the slow one the
/// level of the music around it.
const FAST_TAU_MS: f32 = 15.0;
const SLOW_TAU_MS: f32 = 350.0;
/// How far (dB) a hop must stand above the slow envelope, and how much it must
/// have risen over the fast envelope, to be an onset. The rise test is what
/// separates "a hit just landed" from "the music is now louder".
const ONSET_ABOVE_SLOW_DB: f32 = 6.0;
const ONSET_RISE_DB: f32 = 4.0;
/// Hops quieter than this (dBFS of the bass band) are never onsets.
const FLOOR_DB: f32 = -50.0;
/// Energy is measured over this many hops (20 ms) — one full cycle of a 50 Hz
/// kick. A single 4 ms hop is shorter than the waveform it measures, so its
/// energy ripples with the phase of the kick and fakes rises of its own.
const WINDOW_HOPS: usize = 5;
/// Share of the window's total energy the bass band must hold for an onset.
/// A kick is almost all bass; a sung syllable, even a low one, is mostly
/// mids. Relative thresholds alone can't tell them apart once the drums stop
/// and the envelopes settle on the voice — this can, at any input level.
const MIN_BASS_SHARE: f32 = 0.35;
/// One kick can't trigger twice: 200 ms is 300 BPM.
const REFRACTORY_MS: f32 = 200.0;

/// Direct-form-I biquad.
#[derive(Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    /// RBJ cookbook low-pass.
    fn lowpass(cutoff_hz: f32, sample_rate: f32, q: f32) -> Self {
        let w0 = 2.0 * std::f32::consts::PI * cutoff_hz / sample_rate;
        let alpha = w0.sin() / (2.0 * q);
        let cos = w0.cos();
        let a0 = 1.0 + alpha;
        Self {
            b0: (1.0 - cos) / 2.0 / a0,
            b1: (1.0 - cos) / a0,
            b2: (1.0 - cos) / 2.0 / a0,
            a1: -2.0 * cos / a0,
            a2: (1.0 - alpha) / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

pub struct BeatDetector {
    /// Two cascaded Butterworth sections: a 4th-order Butterworth low-pass.
    lowpass: [Biquad; 2],
    hop_samples: usize,
    hop_energy: f32,
    hop_total: f32,
    hop_filled: usize,
    /// Bass and total energy of the last [`WINDOW_HOPS`] hops.
    window: [(f32, f32); WINDOW_HOPS],
    window_at: usize,
    fast_db: f32,
    slow_db: f32,
    primed: bool,
    a_fast: f32,
    a_slow: f32,
    refractory_samples: u64,
    sample_rate: f32,
    /// Samples processed so far.
    position: u64,
    /// Start sample of the hop holding the most recent onset.
    last_onset: Option<u64>,
    /// An onset detected since the last [`take_onset_age_ms`] call.
    unreported: Option<u64>,
}

impl BeatDetector {
    pub fn new(sample_rate: f32) -> Self {
        // Q values of a 4th-order Butterworth split into two biquads.
        let lowpass = [
            Biquad::lowpass(BASS_CUTOFF_HZ, sample_rate, 0.541_196_1),
            Biquad::lowpass(BASS_CUTOFF_HZ, sample_rate, 1.306_563),
        ];
        let hop_samples = ((sample_rate * HOP_MS / 1000.0).round() as usize).max(1);
        let hop_ms = hop_samples as f32 * 1000.0 / sample_rate;
        Self {
            lowpass,
            hop_samples,
            hop_energy: 0.0,
            hop_total: 0.0,
            hop_filled: 0,
            window: [(0.0, 0.0); WINDOW_HOPS],
            window_at: 0,
            fast_db: FLOOR_DB,
            slow_db: FLOOR_DB,
            primed: false,
            a_fast: 1.0 - (-hop_ms / FAST_TAU_MS).exp(),
            a_slow: 1.0 - (-hop_ms / SLOW_TAU_MS).exp(),
            refractory_samples: (sample_rate * REFRACTORY_MS / 1000.0) as u64,
            sample_rate,
            position: 0,
            last_onset: None,
            unreported: None,
        }
    }

    /// Feed the next run of mono samples, in order, in chunks of any size.
    pub fn process(&mut self, samples: &[f32]) {
        for &x in samples {
            let stage = self.lowpass[0].process(x);
            let y = self.lowpass[1].process(stage);
            self.hop_energy += y * y;
            self.hop_total += x * x;
            self.hop_filled += 1;
            self.position += 1;
            if self.hop_filled == self.hop_samples {
                let hop_start = self.position - self.hop_samples as u64;
                self.window[self.window_at] = (self.hop_energy, self.hop_total);
                self.window_at = (self.window_at + 1) % WINDOW_HOPS;
                self.hop_energy = 0.0;
                self.hop_total = 0.0;
                self.hop_filled = 0;
                self.end_hop(hop_start);
            }
        }
    }

    fn end_hop(&mut self, hop_start: u64) {
        let (bass, total) = self.window.iter().fold((0.0, 0.0), |(b, t), (hb, ht)| (b + hb, t + ht));
        let samples = (self.hop_samples * WINDOW_HOPS) as f32;
        // Mean bass power relative to full scale: a sine of amplitude 1 is -3 dB.
        let db = 10.0 * (bass / samples + 1e-12).log10();
        let bass_share = if total > 0.0 { bass / total } else { 0.0 };
        if !self.primed {
            self.fast_db = db;
            self.slow_db = db;
            self.primed = true;
            return;
        }
        let rise = db - self.fast_db;
        let onset = db > FLOOR_DB
            && bass_share >= MIN_BASS_SHARE
            && db - self.slow_db > ONSET_ABOVE_SLOW_DB
            && rise > ONSET_RISE_DB
            && self.last_onset.map_or(true, |last| hop_start - last >= self.refractory_samples);
        self.fast_db += (db - self.fast_db) * self.a_fast;
        self.slow_db += (db - self.slow_db) * self.a_slow;
        if onset {
            self.last_onset = Some(hop_start);
            self.unreported = Some(hop_start);
        }
    }

    /// How long ago (ms, measured to the end of the audio processed so far) the
    /// most recent unreported onset happened, consuming it.
    pub fn take_onset_age_ms(&mut self) -> Option<f32> {
        self.unreported
            .take()
            .map(|at| (self.position - at) as f32 * 1000.0 / self.sample_rate)
    }

    /// Sample index of the latest onset — for tests.
    #[cfg(test)]
    fn last_onset_sample(&self) -> Option<u64> {
        self.last_onset
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FS: f32 = 16_000.0;

    /// Deterministic noise.
    struct Lcg(u32);
    impl Lcg {
        fn next(&mut self) -> f32 {
            self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (self.0 >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0
        }
    }

    /// 20 s of worship-like audio. A kick every 500 ms (120 BPM) except during
    /// 8-12 s; a sung vowel throughout (220 Hz with harmonics and vibrato) with
    /// a sharp syllable attack every 500 ms, placed *off* the beat; low noise.
    /// Returns the samples and the true kick times in samples.
    fn worship_take() -> (Vec<f32>, Vec<u64>) {
        let n = (FS * 20.0) as usize;
        let mut out = vec![0.0f32; n];
        let mut kicks = Vec::new();
        let mut noise = Lcg(7);
        let beat = (FS * 0.5) as usize;
        let mut t0 = (FS * 0.25) as usize;
        while t0 < n {
            let secs = t0 as f32 / FS;
            if !(8.0..12.0).contains(&secs) {
                kicks.push(t0 as u64);
                let len = (FS * 0.15) as usize;
                let mut phase = 0.0f32;
                for i in 0..len.min(n - t0) {
                    let t = i as f32 / FS;
                    // Pitch drops 120 -> 50 Hz over the hit, like a real kick.
                    let f = 50.0 + 70.0 * (-t / 0.03).exp();
                    phase += 2.0 * std::f32::consts::PI * f / FS;
                    out[t0 + i] += 0.5 * (-t / 0.06).exp() * phase.sin();
                }
            }
            t0 += beat;
        }
        let mut ph = 0.0f32;
        for (i, s) in out.iter_mut().enumerate() {
            let t = i as f32 / FS;
            // Syllables start 250 ms after each beat and decay over 300 ms.
            let since_syllable = ((t - 0.5) % 0.5 + 0.5) % 0.5;
            let env = 0.25 * (0.4 + 0.6 * (-since_syllable / 0.3).exp());
            // Vibrato: ±1% at 5 Hz. Phase is accumulated sample by sample —
            // `2π·f(t)·t` would sweep the pitch further off 220 Hz every second.
            let f = 220.0 * (1.0 + 0.01 * (2.0 * std::f32::consts::PI * 5.0 * t).sin());
            ph = (ph + 2.0 * std::f32::consts::PI * f / FS) % (2.0 * std::f32::consts::PI);
            let voice = ph.sin() + 0.5 * (2.0 * ph).sin() + 0.3 * (3.0 * ph).sin();
            *s += env * voice / 1.8 + 0.01 * noise.next();
        }
        (out, kicks)
    }

    struct Score {
        hits: usize,
        missed: usize,
        false_beats: usize,
        mean_abs_err_ms: f32,
        max_abs_err_ms: f32,
    }

    /// Match detected onset times (samples) to true kicks within ±60 ms.
    fn score(detected: &[i64], kicks: &[u64]) -> Score {
        let tol = (FS * 0.06) as i64;
        let mut used = vec![false; detected.len()];
        let mut errs = Vec::new();
        for &k in kicks {
            let k = k as i64;
            if let Some((i, d)) = detected
                .iter()
                .enumerate()
                .filter(|(i, d)| !used[*i] && (**d - k).abs() <= tol)
                .min_by_key(|(_, d)| (**d - k).abs())
            {
                used[i] = true;
                errs.push((d - k) as f32 * 1000.0 / FS);
            }
        }
        let hits = errs.len();
        Score {
            hits,
            missed: kicks.len() - hits,
            false_beats: detected.len() - hits,
            mean_abs_err_ms: errs.iter().map(|e| e.abs()).sum::<f32>() / hits.max(1) as f32,
            max_abs_err_ms: errs.iter().fold(0.0f32, |m, e| m.max(e.abs())),
        }
    }

    /// The new detector, fed in 10 ms chunks the way the capture loop drains.
    fn detect_new(samples: &[f32]) -> Vec<i64> {
        let mut d = BeatDetector::new(FS);
        let mut out = Vec::new();
        for chunk in samples.chunks((FS * 0.01) as usize) {
            d.process(chunk);
            if d.take_onset_age_ms().is_some() {
                out.push(d.last_onset_sample().unwrap() as i64);
            }
        }
        out
    }

    /// The previous pipeline: 33 ms windows through `AudioFeatureFilters`
    /// (one-pole at 250 Hz, gain 6, clamped), then the webview's onset rule
    /// (`audioFeatures.ts` detectBeat), which can only date a beat to the end
    /// of the window that carried it.
    fn detect_old(samples: &[f32]) -> Vec<i64> {
        let win = (FS * 0.033) as usize;
        let mut filters = super::super::AudioFeatureFilters::new();
        let (mut fast, mut slow, mut primed) = (0.0f32, 0.0f32, false);
        let mut last_beat: Option<f32> = None;
        let mut out = Vec::new();
        let dt = 33.0f32;
        let (a_fast, a_slow) = (1.0 - (-dt / 45.0).exp(), 1.0 - (-dt / 420.0).exp());
        for (w, chunk) in samples.chunks(win).enumerate() {
            let bass = filters.compute(chunk, FS).bass;
            let t_ms = ((w + 1) * win) as f32 * 1000.0 / FS;
            if !primed {
                fast = bass;
                slow = bass;
                primed = true;
                continue;
            }
            let flux = bass - fast;
            fast += (bass - fast) * a_fast;
            slow += (bass - slow) * a_slow;
            let onset = bass > slow * 1.3
                && bass > 0.05
                && flux > 0.06
                && last_beat.map_or(true, |l| t_ms - l > 200.0);
            if onset {
                last_beat = Some(t_ms);
                out.push(((w + 1) * win) as i64);
            }
        }
        out
    }

    #[test]
    fn finds_kicks_under_singing_more_reliably_and_more_precisely_than_before() {
        let (audio, kicks) = worship_take();
        let new = score(&detect_new(&audio), &kicks);
        let old = score(&detect_old(&audio), &kicks);
        for (name, s) in [("old", &old), ("new", &new)] {
            println!(
                "{name}: {} hit, {} missed, {} false, timing error mean {:.1} ms / max {:.1} ms",
                s.hits, s.missed, s.false_beats, s.mean_abs_err_ms, s.max_abs_err_ms
            );
        }
        assert!(new.missed <= 1, "new detector missed {} kicks", new.missed);
        assert!(new.false_beats <= 1, "new detector fired {} false beats", new.false_beats);
        assert!(new.max_abs_err_ms <= 10.0, "new detector timing off by {} ms", new.max_abs_err_ms);
        assert!(new.missed + new.false_beats <= old.missed + old.false_beats);
        assert!(new.mean_abs_err_ms < old.mean_abs_err_ms);
    }

    /// A bass guitar under the same take: a held note per beat-pair, plucked
    /// on the beat and, every other bar, once more off it.
    fn with_bass_guitar(mut audio: Vec<f32>) -> Vec<f32> {
        let notes = [55.0f32, 73.4, 65.4, 82.4];
        let mut ph = 0.0f32;
        for (i, s) in audio.iter_mut().enumerate() {
            let t = i as f32 / FS;
            let note = notes[((t / 1.0) as usize) % notes.len()];
            // Plucks at each bar (1 s) on the beat (+0.25), and off-beat at +0.75 in odd bars.
            let bar_t = t % 1.0;
            let since = if (t as usize) % 2 == 1 && bar_t >= 0.75 { bar_t - 0.75 } else { (bar_t + 0.75) % 1.0 };
            let env = 0.12 * (0.5 + 0.5 * (-since / 0.25).exp());
            ph = (ph + 2.0 * std::f32::consts::PI * note / FS) % (2.0 * std::f32::consts::PI);
            *s += env * (ph.sin() + 0.3 * (2.0 * ph).sin());
        }
        audio
    }

    fn compare(name: &str, audio: &[f32], kicks: &[u64]) -> (Score, Score) {
        let new = score(&detect_new(audio), kicks);
        let old = score(&detect_old(audio), kicks);
        for (which, s) in [("old", &old), ("new", &new)] {
            println!(
                "{name} {which}: {} hit, {} missed, {} false, timing error mean {:.1} ms / max {:.1} ms",
                s.hits, s.missed, s.false_beats, s.mean_abs_err_ms, s.max_abs_err_ms
            );
        }
        (old, new)
    }

    #[test]
    fn holds_up_under_a_bass_guitar() {
        let (audio, kicks) = worship_take();
        let (old, new) = compare("bass", &with_bass_guitar(audio), &kicks);
        assert!(new.missed + new.false_beats <= old.missed + old.false_beats);
        assert!(new.mean_abs_err_ms < old.mean_abs_err_ms);
    }

    #[test]
    fn does_not_depend_on_input_level() {
        let (audio, kicks) = worship_take();
        let quiet: Vec<f32> = audio.iter().map(|s| s * 0.1).collect();
        let (old, new) = compare("quiet", &quiet, &kicks);
        assert!(new.missed <= 1 && new.false_beats <= 1);
        assert!(new.missed + new.false_beats <= old.missed + old.false_beats);
    }

    #[test]
    fn does_not_beat_on_singing_alone() {
        let (audio, _) = worship_take();
        // 8-12 s has no kick: only syllable attacks.
        let quiet = &audio[(FS * 8.2) as usize..(FS * 11.9) as usize];
        assert!(detect_new(quiet).is_empty());
    }

    #[test]
    fn reports_how_long_ago_the_onset_was() {
        let mut d = BeatDetector::new(FS);
        d.process(&vec![0.0; (FS * 0.5) as usize]);
        // A kick, then 20 ms more audio before the report is taken.
        let kick: Vec<f32> = (0..(FS * 0.1) as usize)
            .map(|i| 0.5 * (2.0 * std::f32::consts::PI * 60.0 * i as f32 / FS).sin())
            .collect();
        d.process(&kick);
        let age = d.take_onset_age_ms().expect("onset");
        // 100 ms of kick was processed after the onset hop began.
        assert!((age - 100.0).abs() <= HOP_MS * 2.0, "age {age}");
        assert!(d.take_onset_age_ms().is_none(), "an onset is reported once");
    }
}
