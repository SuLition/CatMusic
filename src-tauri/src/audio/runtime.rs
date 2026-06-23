use std::{
    thread,
    time::{Duration, Instant},
};

use anyhow::Context;
use tauri::Emitter;

use crate::{
    bridge::dto::AudioFeatureFrame,
    config::{
        schema::{AudioSourceMode, AudioSourceSettings},
        store,
    },
};

use super::{
    features::{self, FeatureExtractor},
    loopback::LoopbackCapture,
    ring_buffer::AudioRingBuffer,
    source,
};

const FEATURE_INTERVAL: Duration = Duration::from_millis(16);
const RETRY_INTERVAL: Duration = Duration::from_secs(2);
const SOURCE_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const RING_BUFFER_SECONDS: usize = 3;

pub fn start(app: tauri::AppHandle) {
    thread::spawn(move || run(app));
}

fn run(app: tauri::AppHandle) {
    loop {
        if let Err(error) = run_configured_loopback(&app) {
            eprintln!("audio loopback stopped: {error:#}");
            emit_silent(&app);
            thread::sleep(RETRY_INTERVAL);
        }
    }
}

fn run_configured_loopback(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let active_source = store::load().audio_source;
    let capture = open_capture(&active_source)?;
    let sample_rate = capture.sample_rate();
    let mut ring_buffer = AudioRingBuffer::new(sample_rate as usize * RING_BUFFER_SECONDS);
    let mut extractor = FeatureExtractor::new(sample_rate);
    let mut last_source_check = Instant::now();

    loop {
        let frame_start = Instant::now();
        let samples = capture.read_available_samples()?;
        ring_buffer.push_slice(&samples);
        emit_frame(app, extractor.next_frame(&samples, &ring_buffer));

        if last_source_check.elapsed() >= SOURCE_CHECK_INTERVAL {
            if store::load().audio_source != active_source {
                return Ok(());
            }

            last_source_check = Instant::now();
        }

        let elapsed = frame_start.elapsed();
        if elapsed < FEATURE_INTERVAL {
            thread::sleep(FEATURE_INTERVAL - elapsed);
        } else {
            capture.wait_for_next_poll();
        }
    }
}

fn open_capture(settings: &AudioSourceSettings) -> anyhow::Result<LoopbackCapture> {
    match settings.mode {
        AudioSourceMode::System => {
            LoopbackCapture::open_system().context("open system audio loopback")
        }
        AudioSourceMode::Preset => open_preset_capture(settings),
    }
}

fn open_preset_capture(settings: &AudioSourceSettings) -> anyhow::Result<LoopbackCapture> {
    let preset_id = settings
        .preset_id
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("audio source preset is not selected"))?;

    let Some(pid) = source::resolve_preset_process(preset_id) else {
        if settings.fallback_to_system {
            eprintln!("audio preset process is not running: {preset_id}; falling back to system");
            return LoopbackCapture::open_system().context("open fallback system audio loopback");
        }

        return Err(anyhow::anyhow!(
            "audio preset process is not running: {preset_id}"
        ));
    };

    match LoopbackCapture::open_process(pid) {
        Ok(capture) => Ok(capture),
        Err(error) if settings.fallback_to_system => {
            eprintln!(
                "process audio loopback failed for {preset_id} pid {pid}: {error:#}; falling back to system"
            );
            LoopbackCapture::open_system().context("open fallback system audio loopback")
        }
        Err(error) => Err(error)
            .with_context(|| format!("open process audio loopback for {preset_id} pid {pid}")),
    }
}

fn emit_silent(app: &tauri::AppHandle) {
    emit_frame(app, features::silent_frame(0));
}

fn emit_frame(app: &tauri::AppHandle, frame: AudioFeatureFrame) {
    let _ = app.emit("audio://features", frame);
}
