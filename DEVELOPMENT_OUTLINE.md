# CatMusic Development Outline

## 1. Product Goal

CatMusic is a Windows desktop audio visualizer. The audio feature monitor remains as a diagnostics panel, but the primary user-facing surface is the selected visualizer animation.

The first usable version should focus on:

- Audio source detection, with selected application capture as the preferred mode and system audio as fallback.
- Borderless floating visualizer content.
- Always-on-top window behavior.
- Optional mouse click-through.
- Tray-based control.
- Real-time audio feature monitoring for volume, rhythm state, melody and frequency bands.
- A separate settings interface; the startup window itself shows the visualizer content.
- Persistent local settings.
- A debug panel that stays separate from the visualizer surface.

The first animation type is a three-layer circular ring: layer 1 is the widest rhythm-response layer, layers 2 and 3 are continuous spectrum-response rings, and volume controls the active color. Desktop background mode remains a separate host strategy and should not be mixed into the renderer.

## 2. Technology Stack

| Layer | Choice | Purpose |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Window, tray, packaging, native bridge |
| Native backend | Rust | Audio capture, feature extraction, Windows integration |
| Frontend | TypeScript | UI, settings and visualizer orchestration |
| 2D renderer | TypeScript + SVG/CSS | Lightweight ring and spectrum visualizer modes |
| 3D renderer | Three.js, optional | Future 3D visualizer modes |
| Audio capture | Windows Application Loopback + WASAPI loopback | Capture selected application audio when available, otherwise capture system output audio |
| Audio analysis | aubio | FFT, rhythm/onset and pitch-assisted melody analysis |
| Windows integration | Win32 APIs | Mouse transparency, desktop host, monitor/DPI handling |

## 3. Architecture

```text
Tauri 2 Application
├─ Rust Native Backend
│  ├─ Audio Capture
│  ├─ Audio Feature Engine
│  ├─ IPC/Event Bridge
│  ├─ Window Management
│  ├─ Tray and Settings Commands
│  ├─ Config Persistence
│  └─ Windows-only Desktop Host
│
└─ TypeScript Frontend
   ├─ App Shell
   ├─ Visualizer Runtime
   ├─ Real-time Monitor Panel
   ├─ Settings UI
   └─ IPC Client
```

## 4. Recommended Project Layout

```text
CatMusic/
├─ package.json
├─ index.html
├─ vite.config.ts
├─ tsconfig.json
├─ src/
│  ├─ main.ts
│  ├─ debug/
│  │  └─ debug-page.ts
│  ├─ visualizer/
│  │  ├─ animation-registry.ts
│  │  ├─ ring-animation.ts
│  │  └─ visualizer-page.ts
│  ├─ ipc/
│  │  ├─ commands.ts
│  │  ├─ events.ts
│  │  └─ types.ts
│  ├─ settings/
│  │  ├─ settings-store.ts
│  │  └─ settings-view.ts
│  └─ styles/
│     └─ main.css
│
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json
   └─ src/
      ├─ main.rs
      ├─ app.rs
      ├─ audio/
      │  ├─ mod.rs
      │  ├─ loopback.rs
      │  ├─ device.rs
      │  ├─ ring_buffer.rs
      │  ├─ features.rs
      │  └─ smoothing.rs
      ├─ bridge/
      │  ├─ mod.rs
      │  ├─ commands.rs
      │  ├─ events.rs
      │  └─ dto.rs
      ├─ window/
      │  ├─ mod.rs
      │  ├─ floating.rs
      │  ├─ desktop_host.rs
      │  ├─ monitor.rs
      │  └─ tray.rs
      ├─ config/
      │  ├─ mod.rs
      │  ├─ schema.rs
      │  └─ store.rs
      ├─ platform/
      │  └─ windows/
      │     ├─ mod.rs
      │     ├─ cursor_passthrough.rs
      │     ├─ desktop_shell.rs
      │     └─ startup.rs
      └─ diagnostics/
         ├─ mod.rs
         └─ logging.rs
```

## 5. Core Data Flow

```text
Selected audio source
-> PCM buffer
-> Ring buffer
-> FFT and feature extraction
-> Smoothed AudioFeatureFrame
-> Tauri event stream
-> TypeScript visualizer runtime and diagnostics panel
```

The frontend should receive audio features only. Raw PCM audio should not be sent to the frontend per frame.

## 6. Audio Feature Contract

Use an extensible frame structure from the first version. Do not lock the system to only low/mid/high bands.

```ts
export type AudioFeatureFrame = {
  schemaVersion: 3
  seq: number
  timestampMs: number
  volume: number
  rhythm: boolean
  spectrum: number[]
  melody: number | null
}
```

Initial target:

- Feature push rate: 60 Hz.
- FFT update source: WASAPI capture buffer.
- First band count: 32.
- Values normalized to `0.0..1.0`.
- Silent input should produce stable zero-like values.

## 7. Backend Modules

### 7.1 Audio Capture

Responsibilities:

- Initialize WASAPI loopback.
- Initialize Windows Application Loopback for a selected process when configured.
- Fall back to system WASAPI loopback when process capture is unavailable.
- Select default output device for system loopback.
- React to device changes later.
- Push PCM samples into ring buffer.
- Recover from capture errors where possible.

Non-responsibilities:

- No UI logic.
- No renderer-specific shaping.
- No direct Tauri window calls.

### 7.2 Feature Engine

Responsibilities:

- Read PCM frames from ring buffer.
- Compute volume, rhythm, melody and frequency bands.
- Apply smoothing and decay.
- Detect rhythm/onset activity.
- Produce `AudioFeatureFrame`.

### 7.3 Bridge

Responsibilities:

- Define Rust DTOs matching TypeScript types.
- Expose Tauri commands.
- Emit feature events to frontend.
- Keep event names stable.

Suggested events:

- `audio://features`
- `audio://state`
- `settings://changed`
- `window://mode-changed`

### 7.4 Window Layer

Responsibilities:

- Floating overlay mode.
- Transparent and borderless window setup.
- Always-on-top behavior.
- Skip taskbar behavior.
- Mouse click-through toggle.
- Window size and position persistence.
- Multi-monitor handling.

### 7.5 Desktop Background Host

Responsibilities:

- Windows-only implementation.
- Attach a render window to the desktop layer.
- Handle Explorer restart.
- Handle monitor and DPI changes.
- Provide a clean fallback to floating mode.

This module should be isolated behind a trait or service boundary because it is the highest-risk platform-specific area.

## 8. Frontend Modules

### 8.1 App Shell

Responsibilities:

- Start the selected visualizer page for the main floating window.
- Subscribe to Tauri events.
- Load current settings.
- Keep settings and diagnostics on separate routes.

### 8.2 Real-time Monitor Panel

Responsibilities:

- Show diagnostic volume and feature values.
- Show rhythm active state as a simple history waveform.
- Show frequency-band energy as an equalizer-style bar panel.
- Subscribe only to feature frames; do not consume raw PCM.

### 8.3 Visualizer Runtime

Responsibilities:

- Render selected animation types from `AudioFeatureFrame`.
- Register animation implementations through a registry.
- Keep renderer code separate from audio capture internals.
- Keep host strategy separate: floating window and desktop background should use the same renderer contract.
- First implementation: three-layer ring.

Three-layer ring mapping:

- Layer 1: inner, widest ring; responds to rhythm and volume.
- Layer 2: middle continuous ring; scales from lower spectrum energy.
- Layer 3: outer, narrowest continuous ring; scales from upper spectrum energy.
- Volume controls the active color.
- The ring uses one smaller touching base radius set; there is no separate idle radius and dynamic base radius.
- Activity level controls audio expansion and breathing strength, not a hard radius-state switch.
- Dynamic response adds each layer's own radius expansion after inside-out push displacement, so inner growth can move outer rings while outer rings still visibly separate from their own spectrum data.
- Color uses the same state-transition principle: volume selects a target color, but rendered color eases toward it instead of switching immediately.

Non-responsibilities:

- Do not own desktop attachment, Explorer recovery, or native window placement.

### 8.4 Settings UI

Responsibilities:

- Opacity.
- Window size.
- Animation type.
- Mouse click-through.
- Start with Windows.
- Audio source selection: system audio or predefined player presets. Do not expose the full process list to users.

Settings UI should call Rust commands. It should not duplicate native state rules.

## 9. Development Phases

### Phase 0: Project Bootstrap

Tasks:

- Create Tauri 2 + TypeScript project.
- Add Rust module skeleton.
- Add TypeScript IPC type skeleton.
- Add basic logging.
- Add config store skeleton.

Acceptance criteria:

- App starts in development mode.
- Frontend can invoke one Rust command.
- Rust can emit one test event to frontend.

### Phase 1: Floating Overlay Window

Tasks:

- Configure transparent window.
- Remove border and title bar.
- Enable always-on-top.
- Hide from taskbar.
- Implement mouse click-through toggle.
- Add tray menu.
- Add show, hide and quit actions.

Acceptance criteria:

- Window appears as transparent floating overlay.
- Tray can show, hide and quit the app.
- Mouse click-through can be toggled.

### Phase 2: Audio Capture

Tasks:

- Add WASAPI loopback capture.
- Add audio source configuration for system audio or predefined player presets.
- Capture default system output audio.
- Use system output audio as fallback when selected process capture is unavailable.
- Implement ring buffer.
- Compute normalized volume.
- Emit temporary debug audio state.

Acceptance criteria:

- Playing system audio changes measured values.
- Selecting a supported application process isolates that process audio.
- If the selected process exits or cannot be captured, system audio fallback still produces values.
- Stopping audio returns values to near zero.
- App does not crash when no music is playing.

### Phase 3: FFT and Feature Frames

Tasks:

- Add aubio-based FFT and feature analysis.
- Compute configurable frequency bands.
- Add smoothing and decay.
- Add rhythm/onset and melody estimate.
- Emit `AudioFeatureFrame` at around 60 Hz.

Acceptance criteria:

- Frontend receives stable feature frames.
- `spectrum` values react to audio.
- Silent input produces stable low values.

### Phase 4: Visualizer Runtime and Diagnostics

Tasks:

- Make the main window render the selected visualizer animation.
- Keep the real-time monitor panel as a debug window.
- Show volume, rhythm state, melody and frequency bands.
- Add the first animation through the registry.

Acceptance criteria:

- The visualizer responds to audio feature frames.
- Startup shows the selected animation.
- The debug panel still responds to audio feature frames.
- The frontend build has no Pixi dependency.

### Phase 5: Settings and Persistence

Tasks:

- Define config schema.
- Persist settings locally.
- Add settings window or panel.
- Save window size and position.
- Save mouse click-through state.
- Add start-with-Windows option.

Acceptance criteria:

- Settings survive app restart.
- Invalid config falls back to defaults safely.
- Tray and settings UI stay consistent.

### Phase 6: Desktop Background Mode

Tasks:

- Implement Windows desktop host module.
- Attach render window to desktop layer.
- Handle Explorer restart.
- Handle monitor changes.
- Add floating/background mode switch.
- Add fallback if desktop host fails.

Acceptance criteria:

- App can run as desktop background.
- Floating mode still works.
- Explorer restart does not leave broken invisible windows.

### Phase 7: Packaging and Stability

Tasks:

- Configure Tauri bundling.
- Add installer metadata.
- Add log export or diagnostics location.
- Add basic performance counters.
- Test long-running playback.
- Test sleep/wake and audio device changes.

Acceptance criteria:

- App can be installed and launched normally.
- App can quit cleanly from tray.
- Long-running use does not show major CPU/GPU growth.

## 10. First Version Scope

Must have:

- Tauri 2 application.
- Rust WASAPI loopback.
- Selected application audio source with system audio fallback.
- Audio feature frames.
- Borderless floating visualizer window.
- First ring animation type.
- Real-time monitor panel as diagnostics.
- Always-on-top mode.
- Mouse click-through.
- Tray controls.
- Local settings persistence.

Out of scope for v1:

- Desktop background mode.
- Multiple animation types.
- Song title, artist or cover metadata.
- JavaScript-side audio capture.
- Sending raw PCM to frontend.
- PixiJS/WebGL rendering path.
- Full 3D scene system.
- Plugin system.
- Cross-platform support.

## 11. Engineering Rules

- Keep platform-specific Windows code isolated under `src-tauri/src/platform/windows`.
- Keep renderer code independent from audio capture internals.
- Keep IPC DTOs versioned and mirrored in Rust and TypeScript.
- Prefer feature frames over raw audio data across the bridge.
- When visualizers are reintroduced, add them through a registry rather than hard-coded conditionals.
- Treat desktop background mode as a separate host strategy, not a different renderer.
- Verify each phase with a small runnable acceptance test before moving forward.
