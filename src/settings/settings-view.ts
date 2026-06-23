import type {
  AnimationCommonSettings,
  AnimationType,
  AppSettings,
  AudioSourcePreset,
  AudioSourcePresetId,
  ColorSetting,
  SolidSpectrumCircleSettings,
  ThreeLayerRingColors,
  ThreeLayerRingSettings,
} from "../ipc/types";
import {
  createDefaultSettings,
  FLOATING_SIZE_MAX,
  FLOATING_SIZE_MIN,
  normalizeSettings,
} from "./settings-store";

const SETTINGS_TABS = [
  { id: "animation", label: "&#21160;&#30011;" },
  { id: "audio", label: "&#38899;&#28304;" },
  { id: "window", label: "&#24748;&#28014;&#31383;&#21475;" },
  { id: "system", label: "&#31995;&#32479;" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

let activeSettingsTab: SettingsTab = "animation";

export function createSettingsView(
  host: HTMLElement,
  settings: AppSettings,
  audioSourcePresets: AudioSourcePreset[],
  onChange: (settings: AppSettings) => void | Promise<void>,
): void {
  let currentSettings = normalizeSettings(settings);

  host.innerHTML = `
    <header class="settings-header">
      <h1>CatMusic &#35774;&#32622;</h1>
      <span id="settings-save-status" class="settings-save-status">&#33258;&#21160;&#20445;&#23384;</span>
    </header>
    <nav class="settings-tabs" aria-label="CatMusic settings sections">
      ${SETTINGS_TABS.map((tab) => `
        <button class="settings-tab" type="button" data-tab="${tab.id}">${tab.label}</button>
      `).join("")}
    </nav>
    <section id="settings-tab-panel" class="settings-tab-panel"></section>
  `;

  const panel = requiredElement<HTMLElement>(host, "#settings-tab-panel");
  const status = requiredElement<HTMLElement>(host, "#settings-save-status");
  const tabButtons = Array.from(host.querySelectorAll<HTMLButtonElement>(".settings-tab"));

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      activeSettingsTab = button.dataset.tab as SettingsTab;
      renderActiveTab();
    });
  }

  renderActiveTab();

  function renderActiveTab(): void {
    for (const button of tabButtons) {
      button.classList.toggle("is-active", button.dataset.tab === activeSettingsTab);
    }

    switch (activeSettingsTab) {
      case "animation":
        renderAnimationTab();
        break;
      case "audio":
        renderAudioTab();
        break;
      case "window":
        renderWindowTab();
        break;
      case "system":
        renderSystemTab();
        break;
    }
  }

  async function commitSettings(nextSettings: AppSettings, rerender = false): Promise<void> {
    currentSettings = normalizeSettings(nextSettings);
    status.textContent = "\u4fdd\u5b58\u4e2d...";

    try {
      await onChange(currentSettings);
      status.textContent = "\u5df2\u4fdd\u5b58";
    } catch {
      status.textContent = "\u4fdd\u5b58\u5931\u8d25";
    }

    if (rerender) {
      renderActiveTab();
    }
  }

  function renderAnimationTab(): void {
    const commonSettings = currentSettings.animationSettings.common;
    const ringSettings = currentSettings.animationSettings["three-layer-ring"];
    const circleSettings = currentSettings.animationSettings["rainbow-ball"];
    const selectedSpecificSettings = currentSettings.animationType === "rainbow-ball"
      ? renderSolidSpectrumCircleSettings(circleSettings)
      : renderThreeLayerRingSettings(ringSettings);
    const selectedColorSettings = currentSettings.animationType === "rainbow-ball"
      ? ""
      : renderThreeLayerRingColors(ringSettings.colors);

    panel.innerHTML = `
      <div class="settings-section">
        <div class="setting-row">
          <span class="setting-row-title">&#21160;&#30011;&#31867;&#22411;</span>
          <select id="setting-animation-type" class="setting-control">
            <option value="three-layer-ring">&#22278;&#29615;&#65288;&#19977;&#23618;&#65289;</option>
            <option value="rainbow-ball">&#24425;&#34425;&#29699;</option>
          </select>
        </div>
      </div>

      <div class="settings-section">
        <h2>&#36890;&#29992;&#21442;&#25968;</h2>
        ${rangeRow("setting-response-strength", "&#21709;&#24212;&#24378;&#24230;", 0.2, 2.5, 0.05, commonSettings.responseStrength, formatScale)}
        ${rangeRow("setting-base-brightness", "&#22522;&#30784;&#20142;&#24230;", 0.1, 1, 0.01, commonSettings.baseBrightness, formatPercent)}
      </div>

      <div class="settings-section">
        ${selectedSpecificSettings}
      </div>

      ${selectedColorSettings
        ? `<div class="settings-section">${selectedColorSettings}</div>`
        : ""}
    `;

    const animationType = requiredElement<HTMLSelectElement>(panel, "#setting-animation-type");
    animationType.value = currentSettings.animationType;
    animationType.addEventListener("change", () => {
      void commitSettings({
        ...currentSettings,
        animationType: animationType.value as AnimationType,
      }, true);
    });

    bindCommonRange("setting-response-strength", (common, value) => ({
      ...common,
      responseStrength: value,
    }));
    bindCommonRange("setting-base-brightness", (common, value) => ({
      ...common,
      baseBrightness: value,
    }));

    if (currentSettings.animationType === "rainbow-ball") {
      bindSolidSpectrumCircleControls();
      return;
    }

    bindThreeLayerRingControls();
  }

  function renderThreeLayerRingSettings(settings: ThreeLayerRingSettings): string {
    return `
      <h2>&#22278;&#29615;&#21442;&#25968;</h2>
      ${rangeRow("setting-ring-rhythm-pulse", "&#33410;&#22863;&#33033;&#20914;", 0, 2, 0.05, settings.rhythmPulse, formatScale)}
      ${rangeRow("setting-ring-spectrum-sensitivity", "&#39057;&#35889;&#28789;&#25935;&#24230;", 0.2, 2.5, 0.05, settings.spectrumSensitivity, formatScale)}
    `;
  }

  function renderSolidSpectrumCircleSettings(settings: SolidSpectrumCircleSettings): string {
    return `
      <h2>&#24425;&#34425;&#29699;&#21442;&#25968;</h2>
      <div class="setting-row">
        <span class="setting-row-title">&#39044;&#35774;&#39118;&#26684;</span>
        <select id="setting-circle-rainbow-style" class="setting-control">
          <option value="cool">&#20919;&#33394;</option>
          <option value="aurora">&#26497;&#20809;</option>
          <option value="twilight">&#26286;&#33394;</option>
        </select>
      </div>
      ${rangeRow("setting-circle-rhythm-pulse", "&#33410;&#22863;&#33033;&#20914;", 0, 2, 0.05, settings.rhythmPulse, formatScale)}
      ${rangeRow("setting-circle-spectrum-sensitivity", "&#39057;&#35889;&#28789;&#25935;&#24230;", 0.2, 2.5, 0.05, settings.spectrumSensitivity, formatScale)}
      ${rangeRow("setting-circle-wave-height", "&#27874;&#24418;&#24133;&#24230;", 0.4, 2, 0.05, settings.waveHeight, formatScale)}
      ${checkboxRow("setting-circle-rotation-enabled", "&#22806;&#22280;&#26059;&#36716;", settings.rotationEnabled)}
      ${rangeRow("setting-circle-rotation-speed", "&#26059;&#36716;&#36895;&#24230;", 0.1, 3, 0.05, settings.rotationSpeed, formatScale)}
      ${rangeRow("setting-circle-rotation-angle", "&#20572;&#27490;&#35282;&#24230;", 0, 360, 1, settings.rotationAngle, formatDegrees)}
    `;
  }

  function renderThreeLayerRingColors(colors: ThreeLayerRingColors): string {
    return `
      <h2>&#22278;&#29615;&#39068;&#33394;</h2>
      ${colorRow("ring-idle", "&#38745;&#40664;", colors.idle)}
      ${colorRow("ring-rhythm", "&#33410;&#22863;", colors.rhythm)}
      ${colorRow("ring-low-energy", "&#20302;&#33021;&#37327;", colors.lowEnergy)}
      ${colorRow("ring-high-energy", "&#39640;&#33021;&#37327;", colors.highEnergy)}
    `;
  }

  function bindThreeLayerRingControls(): void {
    bindRingRange("setting-ring-rhythm-pulse", (ring, value) => ({
      ...ring,
      rhythmPulse: value,
    }));
    bindRingRange("setting-ring-spectrum-sensitivity", (ring, value) => ({
      ...ring,
      spectrumSensitivity: value,
    }));

    bindRingColorControls("ring-idle", (colors, color) => ({ ...colors, idle: color }));
    bindRingColorControls("ring-rhythm", (colors, color) => ({ ...colors, rhythm: color }));
    bindRingColorControls("ring-low-energy", (colors, color) => ({ ...colors, lowEnergy: color }));
    bindRingColorControls("ring-high-energy", (colors, color) => ({ ...colors, highEnergy: color }));
  }

  function bindSolidSpectrumCircleControls(): void {
    const rainbowStyle = requiredElement<HTMLSelectElement>(panel, "#setting-circle-rainbow-style");
    rainbowStyle.value = currentSettings.animationSettings["rainbow-ball"].rainbowStyle;
    rainbowStyle.addEventListener("change", () => {
      void commitSettings(withCircleSettings(currentSettings, (circle) => ({
        ...circle,
        rainbowStyle: rainbowStyle.value as SolidSpectrumCircleSettings["rainbowStyle"],
      })));
    });

    bindCircleRange("setting-circle-rhythm-pulse", (circle, value) => ({
      ...circle,
      rhythmPulse: value,
    }));
    bindCircleRange("setting-circle-spectrum-sensitivity", (circle, value) => ({
      ...circle,
      spectrumSensitivity: value,
    }));
    bindCircleRange("setting-circle-wave-height", (circle, value) => ({
      ...circle,
      waveHeight: value,
    }));
    bindCircleCheckbox("setting-circle-rotation-enabled", (circle, checked) => ({
      ...circle,
      rotationEnabled: checked,
    }));
    bindCircleRange("setting-circle-rotation-speed", (circle, value) => ({
      ...circle,
      rotationSpeed: value,
    }));
    bindCircleRange("setting-circle-rotation-angle", (circle, value) => ({
      ...circle,
      rotationAngle: value,
    }));

  }

  function renderAudioTab(): void {
    panel.innerHTML = `
      <div class="settings-section">
        <div class="setting-row">
          <span class="setting-row-title">&#25429;&#33719;&#26469;&#28304;</span>
          <select id="setting-audio-source" class="setting-control">
            <option value="system">&#31995;&#32479;&#38899;&#39057;</option>
          </select>
        </div>
        <label class="setting-check-row">
          <input id="setting-audio-fallback" type="checkbox" />
          <span>&#25429;&#33719;&#22833;&#36133;&#26102;&#22238;&#36864;&#21040;&#31995;&#32479;&#38899;&#39057;</span>
        </label>
      </div>
    `;

    const audioSource = requiredElement<HTMLSelectElement>(panel, "#setting-audio-source");
    const fallback = requiredElement<HTMLInputElement>(panel, "#setting-audio-fallback");
    renderAudioSourceOptions(audioSource, audioSourcePresets);
    audioSource.value =
      currentSettings.audioSource.mode === "preset" && currentSettings.audioSource.presetId
        ? currentSettings.audioSource.presetId
        : "system";
    fallback.checked = currentSettings.audioSource.fallbackToSystem;

    audioSource.addEventListener("change", () => {
      const presetId = audioSource.value === "system"
        ? null
        : (audioSource.value as AudioSourcePresetId);

      void commitSettings({
        ...currentSettings,
        audioSource: {
          ...currentSettings.audioSource,
          mode: presetId ? "preset" : "system",
          presetId,
        },
      });
    });

    fallback.addEventListener("change", () => {
      void commitSettings({
        ...currentSettings,
        audioSource: {
          ...currentSettings.audioSource,
          fallbackToSystem: fallback.checked,
        },
      });
    });
  }

  function renderWindowTab(): void {
    panel.innerHTML = `
      <div class="settings-section">
        <div class="setting-row">
          <span class="setting-row-title">&#20572;&#38752;&#35282;&#33853;</span>
          <select id="setting-corner" class="setting-control">
            <option value="top-left">&#24038;&#19978;&#35282;</option>
            <option value="top-right">&#21491;&#19978;&#35282;</option>
            <option value="bottom-left">&#24038;&#19979;&#35282;</option>
            <option value="bottom-right">&#21491;&#19979;&#35282;</option>
          </select>
        </div>
        <div class="setting-row">
          <span class="setting-row-title">&#24748;&#28014;&#23610;&#23544;</span>
          <span class="setting-range-control setting-range-control-with-limits">
            <span class="setting-range-limit">${FLOATING_SIZE_MIN}px</span>
            <input id="setting-floating-size" type="range" min="${FLOATING_SIZE_MIN}" max="${FLOATING_SIZE_MAX}" step="10" value="${currentSettings.floatingSize}" />
            <span class="setting-range-limit">${FLOATING_SIZE_MAX}px</span>
            <output id="setting-floating-size-value">${formatPixels(currentSettings.floatingSize)}</output>
          </span>
        </div>
        <label class="setting-check-row">
          <input id="setting-mouse-passthrough" type="checkbox" />
          <span>&#40736;&#26631;&#31359;&#36879;</span>
        </label>
      </div>
    `;

    const corner = requiredElement<HTMLSelectElement>(panel, "#setting-corner");
    const floatingSize = requiredElement<HTMLInputElement>(panel, "#setting-floating-size");
    const floatingSizeValue = requiredElement<HTMLOutputElement>(panel, "#setting-floating-size-value");
    const mousePassthrough = requiredElement<HTMLInputElement>(panel, "#setting-mouse-passthrough");

    corner.value = currentSettings.floatingCorner;
    floatingSize.value = `${currentSettings.floatingSize}`;
    mousePassthrough.checked = currentSettings.mousePassthrough;

    corner.addEventListener("change", () => {
      void commitSettings({
        ...currentSettings,
        floatingCorner: corner.value as AppSettings["floatingCorner"],
        floatingPosition: null,
      });
    });

    floatingSize.addEventListener("input", () => {
      floatingSizeValue.textContent = formatPixels(Number(floatingSize.value));
    });

    floatingSize.addEventListener("change", () => {
      void commitSettings({
        ...currentSettings,
        floatingSize: clamp(Number(floatingSize.value), FLOATING_SIZE_MIN, FLOATING_SIZE_MAX),
      });
    });

    mousePassthrough.addEventListener("change", () => {
      void commitSettings({
        ...currentSettings,
        mousePassthrough: mousePassthrough.checked,
      });
    });
  }

  function renderSystemTab(): void {
    panel.innerHTML = `
      <div class="settings-section">
        <label class="setting-check-row">
          <input id="setting-start-with-windows" type="checkbox" />
          <span>&#24320;&#26426;&#21551;&#21160;</span>
        </label>
        <div class="setting-row">
          <span class="setting-row-title">&#40664;&#35748;&#35774;&#32622;</span>
          <button id="setting-reset-defaults" class="settings-button" type="button">&#24674;&#22797;&#40664;&#35748;&#35774;&#32622;</button>
        </div>
      </div>
    `;

    const startWithWindows = requiredElement<HTMLInputElement>(panel, "#setting-start-with-windows");
    const resetButton = requiredElement<HTMLButtonElement>(panel, "#setting-reset-defaults");
    startWithWindows.checked = currentSettings.startWithWindows;

    startWithWindows.addEventListener("change", () => {
      void commitSettings({
        ...currentSettings,
        startWithWindows: startWithWindows.checked,
      });
    });

    resetButton.addEventListener("click", () => {
      void commitSettings(createDefaultSettings(), true);
    });
  }

  function bindCommonRange(
    id: string,
    update: (settings: AnimationCommonSettings, value: number) => AnimationCommonSettings,
  ): void {
    bindRangeInput(id, (value) => {
      void commitSettings(withCommonSettings(currentSettings, (commonSettings) => update(
        commonSettings,
        value,
      )));
    });
  }

  function bindRingRange(
    id: string,
    update: (settings: ThreeLayerRingSettings, value: number) => ThreeLayerRingSettings,
  ): void {
    bindRangeInput(id, (value) => {
      void commitSettings(withRingSettings(currentSettings, (ringSettings) => update(
        ringSettings,
        value,
      )));
    });
  }

  function bindCircleRange(
    id: string,
    update: (settings: SolidSpectrumCircleSettings, value: number) => SolidSpectrumCircleSettings,
  ): void {
    bindRangeInput(id, (value) => {
      void commitSettings(withCircleSettings(currentSettings, (circleSettings) => update(
        circleSettings,
        value,
      )));
    });
  }

  function bindCircleCheckbox(
    id: string,
    update: (settings: SolidSpectrumCircleSettings, checked: boolean) => SolidSpectrumCircleSettings,
  ): void {
    const input = requiredElement<HTMLInputElement>(panel, `#${id}`);

    input.addEventListener("change", () => {
      void commitSettings(withCircleSettings(currentSettings, (circleSettings) => update(
        circleSettings,
        input.checked,
      )));
    });
  }

  function bindRangeInput(id: string, onCommit: (value: number) => void): void {
    const input = requiredElement<HTMLInputElement>(panel, `#${id}`);
    const output = requiredElement<HTMLOutputElement>(panel, `#${id}-value`);

    input.addEventListener("input", () => {
      output.textContent = formatRangeValue(Number(input.value), output.dataset.format);
    });

    input.addEventListener("change", () => {
      onCommit(Number(input.value));
    });
  }

  function bindRingColorControls(
    id: string,
    update: (colors: ThreeLayerRingColors, color: ColorSetting) => ThreeLayerRingColors,
  ): void {
    bindColorInputs(id, (color) => {
      void commitSettings(withRingSettings(currentSettings, (ringSettings) => ({
        ...ringSettings,
        colors: update(ringSettings.colors, color),
      })));
    });
  }

  function bindColorInputs(id: string, onCommit: (color: ColorSetting) => void): void {
    const colorInput = requiredElement<HTMLInputElement>(panel, `#setting-color-${id}`);
    const alphaInput = requiredElement<HTMLInputElement>(panel, `#setting-alpha-${id}`);
    const alphaOutput = requiredElement<HTMLOutputElement>(panel, `#setting-alpha-${id}-value`);

    alphaInput.addEventListener("input", () => {
      alphaOutput.textContent = formatPercent(Number(alphaInput.value));
    });

    const commitColor = (): void => {
      const nextColor = {
        color: normalizeColor(colorInput.value),
        alpha: clamp01(Number(alphaInput.value)),
      };

      onCommit(nextColor);
    };

    colorInput.addEventListener("change", commitColor);
    alphaInput.addEventListener("change", commitColor);
  }
}

function rangeRow(
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  formatter: (value: number) => string,
): string {
  const dataFormat = rangeFormat(formatter);

  return `
    <label class="setting-row setting-range-row">
      <span class="setting-row-title">${label}</span>
      <span class="setting-range-control">
        <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${clamp(value, min, max)}" />
        <output id="${id}-value" data-format="${dataFormat}">${formatter(value)}</output>
      </span>
    </label>
  `;
}

function checkboxRow(id: string, label: string, checked: boolean): string {
  return `
    <label class="setting-check-row">
      <input id="${id}" type="checkbox" ${checked ? "checked" : ""} />
      <span>${label}</span>
    </label>
  `;
}

function colorRow(id: string, label: string, setting: ColorSetting): string {
  return `
    <div class="setting-row setting-color-row">
      <span class="setting-row-title">${label}</span>
      <span class="setting-color-control">
        <input id="setting-color-${id}" type="color" value="${normalizeColor(setting.color)}" aria-label="${label}" />
        <input id="setting-alpha-${id}" type="range" min="0" max="1" step="0.01" value="${clamp01(setting.alpha)}" aria-label="${label} alpha" />
        <output id="setting-alpha-${id}-value">${formatPercent(setting.alpha)}</output>
      </span>
    </div>
  `;
}

function withCommonSettings(
  settings: AppSettings,
  update: (settings: AnimationCommonSettings) => AnimationCommonSettings,
): AppSettings {
  return normalizeSettings({
    ...settings,
    animationSettings: {
      ...settings.animationSettings,
      common: update(settings.animationSettings.common),
    },
  });
}

function withRingSettings(
  settings: AppSettings,
  update: (settings: ThreeLayerRingSettings) => ThreeLayerRingSettings,
): AppSettings {
  return normalizeSettings({
    ...settings,
    animationSettings: {
      ...settings.animationSettings,
      "three-layer-ring": update(settings.animationSettings["three-layer-ring"]),
    },
  });
}

function withCircleSettings(
  settings: AppSettings,
  update: (settings: SolidSpectrumCircleSettings) => SolidSpectrumCircleSettings,
): AppSettings {
  return normalizeSettings({
    ...settings,
    animationSettings: {
      ...settings.animationSettings,
      "rainbow-ball": update(settings.animationSettings["rainbow-ball"]),
    },
  });
}

function renderAudioSourceOptions(
  select: HTMLSelectElement,
  presets: AudioSourcePreset[],
): void {
  const selectedValue = select.value || "system";
  select.replaceChildren(new Option("\u7cfb\u7edf\u97f3\u9891", "system"));

  for (const preset of presets) {
    select.add(new Option(sourceLabel(preset), preset.id));
  }

  select.value = selectedValue;
}

function sourceLabel(preset: AudioSourcePreset): string {
  return preset.running
    ? `${preset.displayName} \u00b7 \u8fd0\u884c\u4e2d`
    : preset.displayName;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing settings element: ${selector}`);
  }

  return element;
}

function formatScale(value: number): string {
  return `${Number(value).toFixed(2)}x`;
}

function formatPercent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function formatDegrees(value: number): string {
  return `${Math.round(clamp(value, 0, 360))}\u00b0`;
}

function formatRangeValue(value: number, format: string | undefined): string {
  if (format === "percent") {
    return formatPercent(value);
  }

  if (format === "degrees") {
    return formatDegrees(value);
  }

  return formatScale(value);
}

function rangeFormat(formatter: (value: number) => string): string {
  if (formatter === formatPercent) {
    return "percent";
  }

  if (formatter === formatDegrees) {
    return "degrees";
  }

  return "scale";
}

function formatPixels(value: number): string {
  return `${Math.round(value)}px`;
}

function normalizeColor(value: string): string {
  const hex = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return hex.toLowerCase();
  }

  return "#42d6b5";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
