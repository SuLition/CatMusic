use std::f32::consts::PI;

use aubio::{vec::CVec, OnsetMode, Pitch, PitchMode, PitchUnit, Smpl, Tempo, FFT};

use crate::bridge::dto::AudioFeatureFrame;

use super::{ring_buffer::AudioRingBuffer, smoothing};

const SPECTRUM_BAND_COUNT: usize = 32;
pub const AUBIO_WINDOW_SIZE: usize = 2048;
const AUBIO_HOP_SIZE: usize = 512;
const MIN_SPECTRUM_HZ: f32 = 40.0;
const MAX_SPECTRUM_HZ: f32 = 16_000.0;
const SPECTRUM_GAIN: f32 = 8.0;
const VOLUME_ATTACK_SMOOTHING: f32 = 0.34;
const VOLUME_RELEASE_SMOOTHING: f32 = 0.11;
const SPECTRUM_ATTACK_SMOOTHING: f32 = 0.42;
const SPECTRUM_RELEASE_SMOOTHING: f32 = 0.18;
const MELODY_SMOOTHING: f32 = 0.28;
const MELODY_MIN_HZ: f32 = 80.0;
const MELODY_MAX_HZ: f32 = 1_200.0;
// Tunable: filters unstable pitch frames so melody only moves on clear tonal input.
const PITCH_CONFIDENCE_FLOOR: f32 = 0.35;
const MELODY_VOLUME_FLOOR: f32 = 0.03;
const MELODY_CENTROID_ENERGY_FLOOR: f32 = 0.000_001;
const AUBIO_SILENCE_DB: Smpl = -60.0;
const AUBIO_TEMPO_THRESHOLD: Smpl = 0.30;

pub fn silent_frame(seq: u64) -> AudioFeatureFrame {
    AudioFeatureFrame {
        schema_version: 3,
        seq,
        timestamp_ms: 0,
        volume: 0.0,
        rhythm: false,
        spectrum: vec![0.0; SPECTRUM_BAND_COUNT],
        melody: None,
    }
}

pub struct FeatureExtractor {
    seq: u64,
    sample_rate: u32,
    tempo: Option<Tempo>,
    pitch: Option<Pitch>,
    fft: Option<FFT>,
    pending_samples: Vec<f32>,
    fftgrain: Vec<Smpl>,
    spectrum: Vec<f32>,
    spectral_melody: Option<f32>,
    volume: f32,
    melody: Option<f32>,
}

impl FeatureExtractor {
    pub fn new(sample_rate: u32) -> Self {
        let sample_rate = sample_rate.max(1);
        let tempo = Tempo::new(
            OnsetMode::SpecFlux,
            AUBIO_WINDOW_SIZE,
            AUBIO_HOP_SIZE,
            sample_rate,
        )
        .map(|tempo| {
            tempo
                .with_silence(AUBIO_SILENCE_DB)
                .with_threshold(AUBIO_TEMPO_THRESHOLD)
        })
        .ok();
        let pitch = Pitch::new(
            PitchMode::Yinfft,
            AUBIO_WINDOW_SIZE,
            AUBIO_HOP_SIZE,
            sample_rate,
        )
        .map(|pitch| {
            pitch
                .with_unit(PitchUnit::Hz)
                .with_silence(AUBIO_SILENCE_DB)
        })
        .ok();

        Self {
            seq: 0,
            sample_rate,
            tempo,
            pitch,
            fft: FFT::new(AUBIO_WINDOW_SIZE).ok(),
            pending_samples: Vec::with_capacity(AUBIO_HOP_SIZE * 2),
            fftgrain: vec![0.0; AUBIO_WINDOW_SIZE + 2],
            spectrum: vec![0.0; SPECTRUM_BAND_COUNT],
            spectral_melody: None,
            volume: 0.0,
            melody: None,
        }
    }

    pub fn next_frame(
        &mut self,
        samples: &[f32],
        ring_buffer: &AudioRingBuffer,
    ) -> AudioFeatureFrame {
        let (rhythm, pitch_melody) = self.process_hops(samples);
        let analysis_window = ring_buffer.latest_window(AUBIO_WINDOW_SIZE);
        let spectrum = self.extract_spectrum(&analysis_window);
        let melody = if self.volume >= MELODY_VOLUME_FLOOR {
            pitch_melody.or(self.spectral_melody)
        } else {
            None
        };
        self.update_melody(melody);

        self.seq = self.seq.wrapping_add(1);

        AudioFeatureFrame {
            schema_version: 3,
            seq: self.seq,
            timestamp_ms: timestamp_ms(),
            volume: self.volume,
            rhythm,
            spectrum,
            melody: self.melody,
        }
    }

    fn process_hops(&mut self, samples: &[f32]) -> (bool, Option<f32>) {
        if samples.is_empty() {
            self.volume = smooth_volume(self.volume, 0.0);
            return (false, None);
        }

        self.pending_samples.extend_from_slice(samples);
        let mut rhythm = false;
        let mut pitch_melody = None;

        while self.pending_samples.len() >= AUBIO_HOP_SIZE {
            let hop: Vec<f32> = self.pending_samples.drain(..AUBIO_HOP_SIZE).collect();
            self.volume = smooth_volume(self.volume, measure_volume(&hop));
            rhythm |= self.detect_rhythm(&hop);
            pitch_melody = self.detect_pitch_melody(&hop).or(pitch_melody);
        }

        (rhythm, pitch_melody)
    }

    fn detect_rhythm(&mut self, hop: &[f32]) -> bool {
        let Some(tempo) = self.tempo.as_mut() else {
            return false;
        };

        tempo
            .do_result(hop)
            .map(|value| value > 0.0)
            .unwrap_or(false)
    }

    fn detect_pitch_melody(&mut self, hop: &[f32]) -> Option<f32> {
        let Some(pitch) = self.pitch.as_mut() else {
            return None;
        };

        pitch
            .do_result(hop)
            .ok()
            .filter(|hz| hz.is_finite())
            .filter(|hz| (MELODY_MIN_HZ..=MELODY_MAX_HZ).contains(hz))
            .filter(|_| pitch.get_confidence() >= PITCH_CONFIDENCE_FLOOR)
            .map(normalize_melody)
    }

    fn extract_spectrum(&mut self, samples: &[f32]) -> Vec<f32> {
        if samples.len() != AUBIO_WINDOW_SIZE {
            self.smooth_spectrum(&vec![0.0; SPECTRUM_BAND_COUNT]);
            self.spectral_melody = None;
            return self.spectrum.clone();
        }

        let mut windowed = Vec::with_capacity(AUBIO_WINDOW_SIZE);
        let window_denominator = (AUBIO_WINDOW_SIZE - 1) as f32;
        for (index, sample) in samples.iter().enumerate() {
            let window = 0.5 - 0.5 * ((2.0 * PI * index as f32) / window_denominator).cos();
            windowed.push(sample * window);
        }

        let Some(fft) = self.fft.as_mut() else {
            self.smooth_spectrum(&vec![0.0; SPECTRUM_BAND_COUNT]);
            self.spectral_melody = None;
            return self.spectrum.clone();
        };

        if fft
            .do_(windowed.as_slice(), self.fftgrain.as_mut_slice())
            .is_err()
        {
            self.smooth_spectrum(&vec![0.0; SPECTRUM_BAND_COUNT]);
            self.spectral_melody = None;
            return self.spectrum.clone();
        }

        let (raw_spectrum, spectral_melody) = {
            let fftgrain = CVec::from(self.fftgrain.as_slice());
            (
                self.measure_spectrum(fftgrain.norm()),
                self.measure_melody_centroid(fftgrain.norm()),
            )
        };

        self.smooth_spectrum(&raw_spectrum);
        self.spectral_melody = if self.volume >= MELODY_VOLUME_FLOOR {
            spectral_melody
        } else {
            None
        };
        self.spectrum.clone()
    }

    fn measure_spectrum(&self, magnitudes: &[Smpl]) -> Vec<f32> {
        let nyquist_hz = self.sample_rate as f32 * 0.5;
        let max_hz = MAX_SPECTRUM_HZ.min(nyquist_hz * 0.98);

        if max_hz <= MIN_SPECTRUM_HZ {
            return vec![0.0; SPECTRUM_BAND_COUNT];
        }

        (0..SPECTRUM_BAND_COUNT)
            .map(|band_index| {
                let start_hz = log_lerp(
                    MIN_SPECTRUM_HZ,
                    max_hz,
                    band_index as f32 / SPECTRUM_BAND_COUNT as f32,
                );
                let end_hz = log_lerp(
                    MIN_SPECTRUM_HZ,
                    max_hz,
                    (band_index + 1) as f32 / SPECTRUM_BAND_COUNT as f32,
                );
                let start_bin = hz_to_bin(start_hz, self.sample_rate).max(1);
                let end_bin = hz_to_bin(end_hz, self.sample_rate)
                    .max(start_bin + 1)
                    .min(magnitudes.len());

                measure_band(magnitudes, start_bin, end_bin)
            })
            .collect()
    }

    fn smooth_spectrum(&mut self, next_spectrum: &[f32]) {
        for (previous, next) in self.spectrum.iter_mut().zip(next_spectrum.iter()) {
            let factor = if *next > *previous {
                SPECTRUM_ATTACK_SMOOTHING
            } else {
                SPECTRUM_RELEASE_SMOOTHING
            };

            *previous = smoothing::smooth(*previous, *next, factor);
        }
    }

    fn measure_melody_centroid(&self, magnitudes: &[Smpl]) -> Option<f32> {
        let start_bin = hz_to_bin(MELODY_MIN_HZ, self.sample_rate).max(1);
        let end_bin = hz_to_bin(MELODY_MAX_HZ, self.sample_rate)
            .max(start_bin + 1)
            .min(magnitudes.len());
        let mut energy_sum = 0.0;
        let mut weighted_sum = 0.0;

        for bin in start_bin..end_bin {
            let magnitude = magnitudes[bin] * (2.0 / AUBIO_WINDOW_SIZE as f32);
            let energy = magnitude * magnitude;
            energy_sum += energy;
            weighted_sum += normalize_melody(bin_to_hz(bin, self.sample_rate)) * energy;
        }

        if energy_sum < MELODY_CENTROID_ENERGY_FLOOR {
            return None;
        }

        Some((weighted_sum / energy_sum).clamp(0.0, 1.0))
    }

    fn update_melody(&mut self, next: Option<f32>) {
        self.melody = match (self.melody, next) {
            (_, None) => None,
            (None, Some(value)) => Some(value),
            (Some(previous), Some(value)) => {
                Some(smoothing::smooth(previous, value, MELODY_SMOOTHING))
            }
        };
    }
}

fn measure_volume(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let mut square_sum = 0.0;
    let mut peak = 0.0;

    for sample in samples {
        let sample = sample.abs().clamp(0.0, 1.0);
        square_sum += sample * sample;
        if sample > peak {
            peak = sample;
        }
    }

    let rms = (square_sum / samples.len() as f32).sqrt().clamp(0.0, 1.0);
    (rms * 1.65 + peak * 0.25).clamp(0.0, 1.0)
}

fn smooth_volume(previous: f32, next: f32) -> f32 {
    let factor = if next > previous {
        VOLUME_ATTACK_SMOOTHING
    } else {
        VOLUME_RELEASE_SMOOTHING
    };

    smoothing::smooth(previous, next, factor)
}

fn measure_band(magnitudes: &[Smpl], start_bin: usize, end_bin: usize) -> f32 {
    if start_bin >= end_bin {
        return 0.0;
    }

    let mut energy_sum = 0.0;
    let mut count = 0;

    for magnitude in &magnitudes[start_bin..end_bin] {
        let normalized = *magnitude * (2.0 / AUBIO_WINDOW_SIZE as f32);
        energy_sum += normalized * normalized;
        count += 1;
    }

    if count == 0 {
        return 0.0;
    }

    normalize_spectrum((energy_sum / count as f32).sqrt())
}

fn normalize_spectrum(magnitude: f32) -> f32 {
    (magnitude * SPECTRUM_GAIN).sqrt().clamp(0.0, 1.0)
}

fn normalize_melody(hz: f32) -> f32 {
    let value = (hz / MELODY_MIN_HZ).ln() / (MELODY_MAX_HZ / MELODY_MIN_HZ).ln();
    value.clamp(0.0, 1.0)
}

fn log_lerp(start: f32, end: f32, ratio: f32) -> f32 {
    start * (end / start).powf(ratio)
}

fn hz_to_bin(hz: f32, sample_rate: u32) -> usize {
    ((hz * AUBIO_WINDOW_SIZE as f32) / sample_rate as f32).floor() as usize
}

fn bin_to_hz(bin: usize, sample_rate: u32) -> f32 {
    bin as f32 * sample_rate as f32 / AUBIO_WINDOW_SIZE as f32
}

fn timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SAMPLE_RATE: u32 = 44_100;

    #[test]
    fn silent_frame_uses_schema_three() {
        let frame = silent_frame(7);

        assert_eq!(frame.schema_version, 3);
        assert_eq!(frame.seq, 7);
        assert!(!frame.rhythm);
        assert_eq!(frame.spectrum.len(), SPECTRUM_BAND_COUNT);
        assert!(frame.spectrum.iter().all(|value| *value <= 0.001));
        assert_eq!(frame.melody, None);
    }

    #[test]
    fn fft_spectrum_moves_with_tone_frequency() {
        let low_tone = sine_window(440.0);
        let high_tone = sine_window(4_000.0);

        let low_frame = frame_for_samples(&low_tone);
        let high_frame = frame_for_samples(&high_tone);

        let low_peak = peak_band_index(&low_frame.spectrum);
        let high_peak = peak_band_index(&high_frame.spectrum);

        assert!(
            high_peak > low_peak + 5,
            "expected high tone peak band to be above low tone peak band; low={low_peak}, high={high_peak}"
        );
    }

    #[test]
    fn melody_normalization_increases_with_pitch() {
        assert!(normalize_melody(880.0) > normalize_melody(220.0));
    }

    #[test]
    fn tone_window_produces_melody_value() {
        let frame = frame_for_samples(&sine_window(440.0));

        assert!(frame.melody.is_some());
    }

    fn frame_for_samples(samples: &[f32]) -> AudioFeatureFrame {
        let mut ring_buffer = AudioRingBuffer::new(AUBIO_WINDOW_SIZE);
        ring_buffer.push_slice(samples);

        let mut extractor = FeatureExtractor::new(TEST_SAMPLE_RATE);
        extractor.next_frame(samples, &ring_buffer)
    }

    fn sine_window(frequency_hz: f32) -> Vec<f32> {
        (0..AUBIO_WINDOW_SIZE)
            .map(|index| {
                let phase = 2.0 * PI * frequency_hz * index as f32 / TEST_SAMPLE_RATE as f32;
                phase.sin() * 0.7
            })
            .collect()
    }

    fn peak_band_index(spectrum: &[f32]) -> usize {
        spectrum
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| {
                left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(index, _)| index)
            .unwrap_or(0)
    }
}
