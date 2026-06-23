import { getCurrentWindow } from "@tauri-apps/api/window";
import { listenToAudioFeatures } from "../ipc/events";
import type { AudioFeatureFrame } from "../ipc/types";

const RHYTHM_HISTORY_LENGTH = 64;
const RHYTHM_WAVE_WIDTH = 160;
const RHYTHM_WAVE_HIGH_Y = 7;
const RHYTHM_WAVE_LOW_Y = 30;
const MELODY_WAVE_WIDTH = 160;
const MELODY_WAVE_MID_Y = 18;

export async function createDebugPage(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <main class="debug-shell">
      <section class="debug-panel">
        <header id="debug-drag-handle" class="debug-header" data-tauri-drag-region>
          <span id="debug-status" class="debug-status" aria-label="&#25968;&#25454;&#29366;&#24577;"></span>
        </header>
        <div class="debug-content" aria-label="&#38899;&#39057;&#29305;&#24449;&#38754;&#26495;">
          <section class="debug-section debug-volume-section" aria-label="&#38899;&#37327;">
            <div class="debug-gauges">
              <div class="debug-gauge">
                <strong id="debug-volume-value">0%</strong>
                <i><b id="debug-volume-fill"></b></i>
              </div>
            </div>
          </section>
          <section class="debug-section debug-beat-section" aria-label="&#33410;&#22863;">
            <div class="debug-beat-wave" aria-label="&#33410;&#22863;&#35302;&#21457;&#26041;&#27874;">
              <svg viewBox="0 0 160 36" preserveAspectRatio="none" aria-hidden="true">
                <line class="debug-beat-baseline" x1="0" y1="30" x2="160" y2="30"></line>
                <path id="debug-rhythm-wave-path" class="debug-beat-wave-path"></path>
              </svg>
            </div>
          </section>
          <section class="debug-section debug-melody-section" aria-label="&#26059;&#24459;">
            <div class="debug-melody-wave" aria-label="&#26059;&#24459;&#21464;&#21270;">
              <svg viewBox="0 0 160 36" preserveAspectRatio="none" aria-hidden="true">
                <line class="debug-melody-baseline" x1="0" y1="18" x2="160" y2="18"></line>
                <path id="debug-melody-wave-path" class="debug-melody-wave-path"></path>
              </svg>
            </div>
          </section>
          <section class="debug-section debug-band-section" aria-label="&#39057;&#35889;">
            <div id="debug-spectrum" class="debug-band-eq"></div>
          </section>
        </div>
      </section>
    </main>
  `;

  const dragHandle = requireElement(root, "#debug-drag-handle");
  const elements = {
    status: requireElement(root, "#debug-status"),
    volume: queryMeter(root, "#debug-volume-fill", "#debug-volume-value"),
    rhythmWave: requireSvgPath(root, "#debug-rhythm-wave-path"),
    rhythmHistory: Array<boolean>(RHYTHM_HISTORY_LENGTH).fill(false),
    melodyWave: requireSvgPath(root, "#debug-melody-wave-path"),
    spectrum: requireElement(root, "#debug-spectrum"),
    spectrumBars: [] as SpectrumBar[],
  };

  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    void getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  });

  renderRhythmWave(elements, false);
  renderMelodyWave(elements, null);
  await listenToAudioFeatures((frame) => renderFrame(elements, frame));
}

type DebugElements = {
  status: HTMLElement;
  volume: Meter;
  rhythmWave: SVGPathElement;
  rhythmHistory: boolean[];
  melodyWave: SVGPathElement;
  spectrum: HTMLElement;
  spectrumBars: SpectrumBar[];
};

type Meter = {
  fill: HTMLElement;
  value: HTMLElement;
};

type SpectrumBar = {
  root: HTMLElement;
  fill: HTMLElement;
};

function renderFrame(elements: DebugElements, frame: AudioFeatureFrame): void {
  elements.status.classList.add("is-live");

  setMeter(elements.volume, frame.volume);
  renderRhythmWave(elements, frame.rhythm);
  renderMelodyWave(elements, frame.melody);
  renderSpectrum(elements, frame.spectrum);
}

function queryMeter(root: HTMLElement, fillSelector: string, valueSelector: string): Meter {
  return {
    fill: requireElement(root, fillSelector),
    value: requireElement(root, valueSelector),
  };
}

function setMeter(meter: Meter, value: number): void {
  meter.fill.style.transform = `scaleX(${clamp01(value)})`;
  meter.value.textContent = formatPercent(value);
}

function renderRhythmWave(elements: DebugElements, active: boolean): void {
  elements.rhythmHistory.push(active);

  if (elements.rhythmHistory.length > RHYTHM_HISTORY_LENGTH) {
    elements.rhythmHistory.shift();
  }

  elements.rhythmWave.setAttribute("d", squareWavePath(elements.rhythmHistory));
}

function squareWavePath(history: boolean[]): string {
  if (history.length === 0) {
    return "";
  }

  const step = RHYTHM_WAVE_WIDTH / Math.max(1, history.length - 1);
  let path = `M 0 ${rhythmY(history[0])}`;

  for (let index = 1; index < history.length; index += 1) {
    const previousX = (index - 1) * step;
    const x = index * step;
    const y = rhythmY(history[index]);
    path += ` H ${previousX.toFixed(2)} V ${y} H ${x.toFixed(2)}`;
  }

  return path;
}

function rhythmY(active: boolean): number {
  return active ? RHYTHM_WAVE_HIGH_Y : RHYTHM_WAVE_LOW_Y;
}

function renderMelodyWave(elements: DebugElements, melody: number | null): void {
  if (melody === null || !Number.isFinite(melody)) {
    elements.melodyWave.setAttribute("d", flatMelodyPath());
    elements.melodyWave.style.opacity = "0.45";
    return;
  }

  const value = clamp01(melody);
  elements.melodyWave.setAttribute("d", sineWavePath(value));
  elements.melodyWave.style.opacity = `${0.55 + value * 0.45}`;
}

function flatMelodyPath(): string {
  return `M 0 ${MELODY_WAVE_MID_Y} H ${MELODY_WAVE_WIDTH}`;
}

function sineWavePath(value: number): string {
  const amplitude = 2 + value * 13;
  const cycles = 2;
  const points = 48;
  let path = "";

  for (let index = 0; index <= points; index += 1) {
    const ratio = index / points;
    const x = ratio * MELODY_WAVE_WIDTH;
    const y =
      MELODY_WAVE_MID_Y -
      Math.sin(ratio * Math.PI * 2 * cycles) * amplitude;
    path += `${index === 0 ? "M" : " L"} ${x.toFixed(2)} ${y
      .toFixed(2)
      .padStart(1, "0")}`;
  }

  return path;
}

function renderSpectrum(elements: DebugElements, spectrum: number[]): void {
  if (elements.spectrumBars.length !== spectrum.length) {
    elements.spectrum.replaceChildren();
    elements.spectrumBars = spectrum.map(() => appendSpectrumBar(elements.spectrum));
  }

  spectrum.forEach((value, index) => {
    const band = elements.spectrumBars[index];
    band.fill.style.transform = `scaleY(${Math.max(0.04, clamp01(value))})`;
  });
}

function appendSpectrumBar(parent: HTMLElement): SpectrumBar {
  const bar = document.createElement("div");
  bar.className = "debug-band";

  const track = document.createElement("i");
  const fill = document.createElement("b");
  track.append(fill);

  bar.append(track);
  parent.append(bar);

  return { root: bar, fill };
}

function formatPercent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);

  if (!element) {
    throw new Error(`Missing debug element: ${selector}`);
  }

  return element;
}

function requireSvgPath(root: HTMLElement, selector: string): SVGPathElement {
  const element = root.querySelector<SVGPathElement>(selector);

  if (!element) {
    throw new Error(`Missing debug SVG path: ${selector}`);
  }

  return element;
}
