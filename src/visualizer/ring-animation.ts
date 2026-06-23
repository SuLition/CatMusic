import type {
  AnimationCommonSettings,
  AppSettings,
  AudioFeatureFrame,
  ThreeLayerRingSettings,
  ThreeLayerRingStyle,
} from "../ipc/types";
import {
  createDefaultAnimationCommonSettings,
  createDefaultThreeLayerRingSettings,
  normalizeThreeLayerRingStyle,
} from "../settings/settings-store";
import type { VisualizerAnimation } from "./animation-registry";

const SVG_NS = "http://www.w3.org/2000/svg";
// SVG 基础画布：中心点固定在 100，外扩 margin 给泛光预留空间。
const CENTER = 100;
const BASE_VIEWBOX_SIZE = 200;
const VIEWBOX_GLOW_MARGIN = 28;
const VIEWBOX_MIN = -VIEWBOX_GLOW_MARGIN;
const VIEWBOX_SIZE = BASE_VIEWBOX_SIZE + VIEWBOX_GLOW_MARGIN * 2;
const VIEWBOX_OUTER_EDGE = CENTER + VIEWBOX_GLOW_MARGIN;
// 固定三环布局，不再暴露环数设置。
const FIXED_RING_COUNT = 3;
const RING_LAYOUT_GAP = 0;
// 主体轻微重叠，用来盖住 SVG stroke 贴合处的抗锯齿细线。
const RING_BODY_SEAM_OVERLAP = 1.1;
// 动态时相邻环打开的最大净间距。
const MAX_DYNAMIC_RING_GAP = 8.6;
// 三个环的静止半径。
const LAYER_ONE_RADIUS = 52;
const LAYER_TWO_RADIUS = 72;
const LAYER_THREE_RADIUS = 85;
// 三个环的主体宽度：内层最厚，外层接近细线。
const LAYER_ONE_WIDTH = 32;
const LAYER_TWO_WIDTH = 16;
const LAYER_THREE_WIDTH = 2;
// 泛光与动态外扩边界。
const SPECTRUM_GLOW_MAX_BLUR = 11;
const RING_BODY_OUTER_LIMIT = VIEWBOX_OUTER_EDGE - 4;
// 半径跟随速度：静止更慢，动态更快。
const IDLE_RADIUS_SMOOTHING = 0.08;
const DYNAMIC_RADIUS_SMOOTHING = 0.22;
// 静止呼吸效果。
const IDLE_BREATH_PERIOD_MS = 3200;
const IDLE_BREATH_SCALE = 0.035;
const IDLE_BREATH_WEIGHT_SMOOTHING = 0.06;
// 音频活动门限。
const DYNAMIC_VOLUME_FLOOR = 0.035;
const DYNAMIC_SPECTRUM_FLOOR = 0.04;
const ACTIVITY_VOLUME_FULL = 0.22;
const ACTIVITY_SPECTRUM_FULL = 0.18;
// 活动强度平滑：attack 控制变强速度，release 控制回落速度。
const ACTIVITY_ATTACK_SMOOTHING = 0.24;
const ACTIVITY_RELEASE_SMOOTHING = 0.045;
// 动态半径扩张幅度：外环响应略强。
const INNER_RING_EXPANSION = 0.13;
const OUTER_RING_EXPANSION = 0.23;
// 动态颜色响应：先放大音频值，再增强当前环自身颜色。
const RING_COLOR_VALUE_GAIN = 1.4;
const RING_COLOR_BOOST_MAX = 0.5;
// 最外侧旋律正弦波：melody 越强，闭合波形振幅越大。
const MELODY_WAVE_POINT_COUNT = 144;
const MELODY_WAVE_CYCLES = 9;
const MELODY_WAVE_MAX_AMPLITUDE = 5.2;
const MELODY_WAVE_RADIUS_GAP = 6;
const MELODY_WAVE_STROKE_WIDTH = 0.8;
const MELODY_WAVE_PHASE_SPEED = 1.2;
const MELODY_WAVE_ATTACK_SMOOTHING = 0.24;
const MELODY_WAVE_RELEASE_SMOOTHING = 0.08;

type Rgba = [number, number, number, number];

type RingLayout = {
  index: number;
  ratio: number;
  radius: number;
  width: number;
  motionScale: number;
};

type RingColors = {
  body: string;
  glow: string;
};

type RingColorPalette = {
  color: string;
};

type RingLayerElements = {
  body: SVGCircleElement;
  outerGlow: SVGCircleElement;
};

class ThreeLayerRingAnimation implements VisualizerAnimation {
  private host: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private rings: RingLayerElements[] = [];
  private rhythmPulse: SVGCircleElement | null = null;
  private melodyWave: SVGPathElement | null = null;
  private beatImpulse = 0;
  private ringValues: number[] = [];
  private currentRadii: number[] = [];
  private melodyWaveValue = 0;
  private activityLevel = 0;
  private commonSettings: AnimationCommonSettings = createDefaultAnimationCommonSettings();
  private ringSettings: ThreeLayerRingSettings = createDefaultThreeLayerRingSettings();
  private idleBreathWeight = 0;

  mount(host: HTMLElement): void {
    this.host = host;
    this.host.replaceChildren();

    this.svg = svgElement("svg");
    this.svg.setAttribute("viewBox", `${VIEWBOX_MIN} ${VIEWBOX_MIN} ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
    this.svg.setAttribute("class", "visualizer-ring");
    this.svg.setAttribute("aria-hidden", "true");
    this.host.append(this.svg);
    this.rebuildLayers();
    this.renderBlendedLayers(silentFrame(), 0);
  }

  render(frame: AudioFeatureFrame): void {
    const responseStrength = clamp(this.commonSettings.responseStrength, 0.2, 2.5);
    const spectrumSensitivity = clamp(this.ringSettings.spectrumSensitivity, 0.2, 2.5);
    const rhythmPulse = clamp(this.ringSettings.rhythmPulse, 0, 2);
    const volume = clamp(frame.volume * responseStrength, 0, 2);
    const fullSpectrumEnergy = clamp(
      spectrumEnergy(frame.spectrum, 0, frame.spectrum.length) * responseStrength * spectrumSensitivity,
      0,
      2,
    );
    const nextActivity = audioActivity(volume, fullSpectrumEnergy, frame.rhythm);
    const activitySmoothing = nextActivity > this.activityLevel
      ? ACTIVITY_ATTACK_SMOOTHING
      : ACTIVITY_RELEASE_SMOOTHING;
    this.activityLevel = smoothNumber(this.activityLevel, nextActivity, activitySmoothing);

    if (frame.rhythm) {
      this.beatImpulse = rhythmPulse;
    } else {
      this.beatImpulse *= 0.84;
    }

    this.renderBlendedLayers(frame, this.activityLevel);
  }

  updateSettings(settings: AppSettings): void {
    const nextRingSettings = normalizeRingSettings(settings.animationSettings["three-layer-ring"]);

    this.commonSettings = normalizeCommonSettings(settings.animationSettings.common);
    this.ringSettings = nextRingSettings;
  }

  destroy(): void {
    this.host?.replaceChildren();
    this.host = null;
    this.svg = null;
    this.rings = [];
    this.rhythmPulse = null;
    this.melodyWave = null;
    this.beatImpulse = 0;
    this.ringValues = [];
    this.currentRadii = [];
    this.melodyWaveValue = 0;
    this.activityLevel = 0;
    this.idleBreathWeight = 0;
  }

  private rebuildLayers(): void {
    if (!this.svg) {
      return;
    }

    this.svg.replaceChildren();
    const layouts = ringLayouts();
    this.rings = layouts.map((layout) => this.appendLayer(layout));
    this.rhythmPulse = this.appendCircle("visualizer-ring-pulse", layouts[0]?.radius ?? 50, layouts[0]?.width ?? 18);
    this.melodyWave = this.appendPath("visualizer-ring-melody-wave");
    this.ringValues = Array.from({ length: layouts.length }, () => 0);
    this.currentRadii = layouts.map((layout) => layout.radius);
  }

  private appendLayer(layout: RingLayout): RingLayerElements {
    return {
      outerGlow: this.appendCircle("visualizer-ring-outer-glow", layout.radius, layout.width),
      body: this.appendCircle("visualizer-ring-body", layout.radius, layout.width),
    };
  }

  private appendCircle(className: string, radius: number, width: number): SVGCircleElement {
    const circle = svgElement("circle");
    circle.setAttribute("class", className);
    circle.setAttribute("cx", `${CENTER}`);
    circle.setAttribute("cy", `${CENTER}`);
    circle.setAttribute("r", `${radius}`);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke-width", `${width}`);
    circle.setAttribute("pathLength", "1");
    circle.setAttribute("stroke-linecap", "round");
    this.svg?.append(circle);
    return circle;
  }

  private appendPath(className: string): SVGPathElement {
    const path = svgElement("path");
    path.setAttribute("class", className);
    path.setAttribute("fill", "none");
    path.setAttribute("pathLength", "1");
    this.svg?.append(path);
    return path;
  }

  private renderBlendedLayers(frame: AudioFeatureFrame, activity: number): void {
    const layouts = ringLayouts();
    const count = layouts.length;
    const responseStrength = clamp(this.commonSettings.responseStrength, 0.2, 2.5);
    const spectrumSensitivity = clamp(this.ringSettings.spectrumSensitivity, 0.2, 2.5);
    const volume = clamp(frame.volume * responseStrength, 0, 2);
    const normalizedActivity = clamp01(activity);
    const spectrumValues = ringSpectrumValues(frame.spectrum, count, responseStrength, spectrumSensitivity);
    const palette = ringColorPalette(this.ringSettings.ringStyle);

    for (let index = 0; index < count; index += 1) {
      const target = index === 0
        ? Math.max(volume, this.beatImpulse) * normalizedActivity
        : (spectrumValues[index] ?? 0) * normalizedActivity;
      this.ringValues[index] = smoothValue(this.ringValues[index] ?? 0, target);
    }

    const radiusSmoothing = lerp(IDLE_RADIUS_SMOOTHING, DYNAMIC_RADIUS_SMOOTHING, normalizedActivity);
    const targetRadii = pushedRadii(layouts, this.ringValues);
    this.idleBreathWeight = smoothNumber(this.idleBreathWeight, 1 - normalizedActivity, IDLE_BREATH_WEIGHT_SMOOTHING);
    const displayedRadii = layouts.map((layout, index) => {
      const targetRadius = targetRadii[index] ?? layout.radius;
      const radius = smoothNumber(this.currentRadii[index] ?? layout.radius, targetRadius, radiusSmoothing);

      this.currentRadii[index] = radius;
      return radius;
    });

    for (let index = 0; index < count; index += 1) {
      const layout = layouts[index];
      const radius = displayedRadii[index] ?? layout.radius;
      this.renderRingLayer({
        elements: this.rings[index] ?? null,
        layout,
        radius,
        value: this.ringValues[index] ?? 0,
        activity: normalizedActivity,
        colors: colorsForRing(palette, this.ringValues[index] ?? 0),
      });
    }

    this.renderMelodyWave(
      layouts[count - 1],
      displayedRadii[count - 1] ?? layouts[count - 1]?.radius ?? LAYER_THREE_RADIUS,
      frame.melody,
      palette,
    );
    this.renderPulse(this.currentRadii[0] ?? layouts[0]?.radius ?? 50, layouts[0], palette, volume, normalizedActivity);
    this.applyBreathTransform(this.idleBreathWeight);
  }

  private renderRingLayer(options: {
    elements: RingLayerElements | null;
    layout: RingLayout;
    radius: number;
    value: number;
    activity: number;
    colors: RingColors;
  }): void {
    const { elements, layout, radius, value, activity, colors } = options;

    if (!elements) {
      return;
    }

    const normalized = clamp01(value);
    const glow = normalized * (0.42 + activity * 0.58);
    const glowVisibility = Math.sqrt(clamp01(glow));
    const glowColor = parseColor(colors.glow, 0.86);
    const bodyWidth = ringBodyWidth(layout.width);
    const outerGlowWidth = glowWidth(bodyWidth, layout.ratio);

    setCircleRadius(elements.outerGlow, radius);
    setCircleRadius(elements.body, radius);
    elements.outerGlow.setAttribute("stroke-width", outerGlowWidth.toFixed(2));
    elements.body.setAttribute("stroke-width", bodyWidth.toFixed(2));

    elements.outerGlow.style.stroke = rgbaColor(glowColor);
    elements.outerGlow.style.opacity = (glowVisibility * lerp(0.24, 0.62, glow)).toFixed(3);
    elements.outerGlow.style.filter = glowVisibility > 0.001
      ? blurFilter(lerp(2.6, SPECTRUM_GLOW_MAX_BLUR + 2, glow) * lerp(0.82, 1.08, layout.ratio))
      : "";

    elements.body.style.stroke = colors.body;
    elements.body.style.opacity = "1";
    elements.body.style.filter = "";
  }

  private renderMelodyWave(
    outerLayout: RingLayout | undefined,
    outerRadius: number,
    melody: number | null,
    palette: RingColorPalette,
  ): void {
    if (!this.melodyWave || !outerLayout) {
      return;
    }

    const target = melody === null || !Number.isFinite(melody) ? 0 : clamp01(melody);
    const smoothing = target > this.melodyWaveValue
      ? MELODY_WAVE_ATTACK_SMOOTHING
      : MELODY_WAVE_RELEASE_SMOOTHING;
    this.melodyWaveValue = smoothNumber(this.melodyWaveValue, target, smoothing);

    const strength = smoothStep(this.melodyWaveValue);
    const amplitude = MELODY_WAVE_MAX_AMPLITUDE * strength;
    const bodyOuterRadius = outerEdge(outerRadius, ringBodyWidth(outerLayout.width));
    const safeOuterRadius = VIEWBOX_OUTER_EDGE - MELODY_WAVE_STROKE_WIDTH / 2 - amplitude;
    const waveRadius = Math.min(bodyOuterRadius + MELODY_WAVE_RADIUS_GAP, safeOuterRadius);
    const phase = (performance.now() / 1000) * MELODY_WAVE_PHASE_SPEED;

    this.melodyWave.setAttribute("d", melodyWavePath(waveRadius, amplitude, phase));
    this.melodyWave.setAttribute("stroke-width", (MELODY_WAVE_STROKE_WIDTH + strength * 1.1).toFixed(2));
    this.melodyWave.style.stroke = boostedRingColor(palette.color, this.melodyWaveValue);
    this.melodyWave.style.opacity = "1";
    this.melodyWave.style.filter = strength > 0.001
      ? blurFilter(0.35 + strength * 1.15)
      : "";
  }

  private renderPulse(
    radius: number,
    firstLayout: RingLayout | undefined,
    palette: RingColorPalette,
    volume: number,
    activity: number,
  ): void {
    if (!this.rhythmPulse || !firstLayout) {
      return;
    }

    const pulseColor = parseColor(
      boostedRingColor(palette.color, Math.max(volume, this.beatImpulse)),
      0.92,
    );
    const visiblePulseOpacity = clamp01(this.beatImpulse) * (0.16 + clamp01(volume) * 0.24) * activity;

    setCircleRadius(this.rhythmPulse, radius);
    this.rhythmPulse.setAttribute("stroke-width", ringBodyWidth(firstLayout.width).toFixed(2));
    this.rhythmPulse.style.stroke = rgbaColor(pulseColor);
    this.rhythmPulse.style.opacity = `${visiblePulseOpacity}`;
    this.rhythmPulse.style.transform = "scale(1)";
    this.rhythmPulse.style.filter = "";
  }

  private applyBreathTransform(weight: number): void {
    const phase = (performance.now() / IDLE_BREATH_PERIOD_MS) * Math.PI * 2;
    const scale = 1 + Math.sin(phase) * IDLE_BREATH_SCALE * clamp01(weight);
    const transform = `scale(${scale.toFixed(4)})`;

    for (const layer of this.rings) {
      layer.outerGlow.style.transform = transform;
      layer.body.style.transform = transform;
    }
    this.melodyWave?.style.setProperty("transform", transform);
  }
}

export function createThreeLayerRingAnimation(): VisualizerAnimation {
  return new ThreeLayerRingAnimation();
}

function silentFrame(): AudioFeatureFrame {
  return {
    schemaVersion: 3,
    seq: 0,
    timestampMs: 0,
    volume: 0,
    rhythm: false,
    spectrum: Array.from({ length: 32 }, () => 0),
    melody: null,
  };
}

function ringLayouts(): RingLayout[] {
  return [
    fixedRingLayout(0, LAYER_ONE_RADIUS, LAYER_ONE_WIDTH, INNER_RING_EXPANSION),
    fixedRingLayout(1, LAYER_TWO_RADIUS, LAYER_TWO_WIDTH, lerp(INNER_RING_EXPANSION, OUTER_RING_EXPANSION, 0.5)),
    fixedRingLayout(2, LAYER_THREE_RADIUS, LAYER_THREE_WIDTH, OUTER_RING_EXPANSION),
  ];
}

function fixedRingLayout(index: number, radius: number, width: number, motionScale: number): RingLayout {
  const ratio = ringRatio(index);

  return {
    index,
    ratio,
    radius,
    width,
    motionScale,
  };
}

function ringRatio(index: number): number {
  return index / (FIXED_RING_COUNT - 1);
}

function pushedRadii(layouts: RingLayout[], values: number[]): number[] {
  const expansions = layouts.map((layout, index) => (
    layout.radius * clamp(values[index] ?? 0, 0, 2) * layout.motionScale
  ));
  const gaps = layouts.map((layout, index) => {
    if (index === 0) {
      return 0;
    }

    const adjacentEnergy = Math.max(clamp01(values[index - 1] ?? 0), clamp01(values[index] ?? 0));

    // Idle keeps seams closed; audio opens visible gaps.
    return MAX_DYNAMIC_RING_GAP * smoothStep(adjacentEnergy) * lerp(0.72, 1.18, layout.ratio);
  });
  const resolve = (scale: number): number[] => {
    const radii: number[] = [];

    for (let index = 0; index < layouts.length; index += 1) {
      const layout = layouts[index];
      const desiredRadius = layout.radius + (expansions[index] ?? 0) * scale;
      const previousLayout = layouts[index - 1];
      const previousRadius = radii[index - 1];
      const minimumRadius = previousLayout && previousRadius !== undefined
        ? outerEdge(previousRadius, previousLayout.width) + RING_LAYOUT_GAP + (gaps[index] ?? 0) * scale + layout.width / 2
        : desiredRadius;

      radii.push(Math.max(desiredRadius, minimumRadius));
    }

    return radii;
  };
  const fits = (radii: number[]): boolean => {
    const lastLayout = layouts[layouts.length - 1];
    const lastRadius = radii[radii.length - 1];

    if (!lastLayout || lastRadius === undefined) {
      return true;
    }

    return outerEdge(lastRadius, lastLayout.width) <= RING_BODY_OUTER_LIMIT;
  };
  const fullRadii = resolve(1);

  if (fits(fullRadii)) {
    return fullRadii;
  }

  let low = 0;
  let high = 1;

  for (let index = 0; index < 12; index += 1) {
    const middle = (low + high) / 2;

    if (fits(resolve(middle))) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return resolve(low);
}

function ringSpectrumValues(
  spectrum: number[],
  count: number,
  responseStrength: number,
  spectrumSensitivity: number,
): number[] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) {
      return 0;
    }

    const bandCount = count - 1;
    const start = Math.floor(((index - 1) / bandCount) * spectrum.length);
    const end = Math.max(start + 1, Math.floor((index / bandCount) * spectrum.length));

    return clamp(spectrumEnergy(spectrum, start, end) * responseStrength * spectrumSensitivity, 0, 2);
  });
}

function ringColorPalette(style: ThreeLayerRingStyle): RingColorPalette {
  switch (style) {
    case "obsidian-mint":
    default:
      return { color: "#2a8e7c" };
  }
}

function colorsForRing(palette: RingColorPalette, value: number): RingColors {
  const next = boostedRingColor(palette.color, value);

  return {
    body: next,
    glow: next,
  };
}

function melodyWavePath(radius: number, amplitude: number, phase: number): string {
  let path = "";

  for (let index = 0; index <= MELODY_WAVE_POINT_COUNT; index += 1) {
    const ratio = index / MELODY_WAVE_POINT_COUNT;
    const angle = ratio * Math.PI * 2;
    const waveRadius = radius + Math.sin(angle * MELODY_WAVE_CYCLES + phase) * amplitude;
    const x = CENTER + Math.cos(angle) * waveRadius;
    const y = CENTER + Math.sin(angle) * waveRadius;

    path += `${index === 0 ? "M" : " L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  return `${path} Z`;
}

function audioActivity(volume: number, spectrum: number, rhythm: boolean): number {
  if (rhythm) {
    return 1;
  }

  const volumeActivity = gateAndNormalize(volume, DYNAMIC_VOLUME_FLOOR, ACTIVITY_VOLUME_FULL);
  const spectrumActivity = gateAndNormalize(spectrum, DYNAMIC_SPECTRUM_FLOOR, ACTIVITY_SPECTRUM_FULL);
  return Math.max(volumeActivity, spectrumActivity);
}

function gateAndNormalize(value: number, floor: number, full: number): number {
  if (value <= floor) {
    return 0;
  }

  return clamp01((value - floor) / Math.max(0.001, full - floor));
}

function boostedRingColor(color: string, value: number): string {
  const boost = Math.sqrt(clamp01(value * RING_COLOR_VALUE_GAIN)) * RING_COLOR_BOOST_MAX;
  const rgba = parseColor(color, 1);
  const luminance = rgba[0] * 0.299 + rgba[1] * 0.587 + rgba[2] * 0.114;
  const saturationGain = 1 + boost * 1.45;
  const brightnessGain = 1 + boost * 0.46;
  const boosted: Rgba = [
    (luminance + (rgba[0] - luminance) * saturationGain) * brightnessGain,
    (luminance + (rgba[1] - luminance) * saturationGain) * brightnessGain,
    (luminance + (rgba[2] - luminance) * saturationGain) * brightnessGain,
    1,
  ];

  return `#${toHex(boosted[0])}${toHex(boosted[1])}${toHex(boosted[2])}`;
}

function toHex(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

function rgbaColor(rgba: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(rgba[0])}, ${Math.round(rgba[1])}, ${Math.round(rgba[2])}, ${clamp01(rgba[3]).toFixed(3)})`;
}

function blurFilter(blurPx: number): string {
  return `blur(${blurPx.toFixed(2)}px)`;
}

function parseColor(value: string, alpha = 1): Rgba {
  const hex = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
      clamp01(alpha),
    ];
  }

  const matches = hex.match(/\d+/g);

  if (!matches || matches.length < 3) {
    return [66, 214, 181, clamp01(alpha)];
  }

  return [
    Number(matches[0]),
    Number(matches[1]),
    Number(matches[2]),
    clamp01(alpha),
  ];
}

function svgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function outerEdge(radius: number, width: number): number {
  return radius + width / 2;
}

function ringBodyWidth(width: number): number {
  return width + RING_BODY_SEAM_OVERLAP;
}

function glowWidth(width: number, ratio: number): number {
  return width + lerp(8, 14, ratio);
}

function setCircleRadius(circle: SVGCircleElement | null, radius: number): void {
  circle?.setAttribute("r", radius.toFixed(3));
}

function spectrumEnergy(spectrum: number[], start: number, end: number): number {
  if (start >= end) {
    return 0;
  }

  let squareSum = 0;
  let count = 0;

  for (let index = start; index < end; index += 1) {
    const value = clamp01(spectrum[index] ?? 0);
    squareSum += value * value;
    count += 1;
  }

  return count > 0 ? Math.sqrt(squareSum / count) : 0;
}

function smoothValue(previous: number, next: number): number {
  const factor = next > previous ? 0.36 : 0.16;
  return previous + (next - previous) * factor;
}

function smoothNumber(previous: number, next: number, factor: number): number {
  return previous + (next - previous) * factor;
}

function lerp(start: number, end: number, ratio: number): number {
  return start + (end - start) * clamp01(ratio);
}

function smoothStep(value: number): number {
  const ratio = clamp01(value);

  return ratio * ratio * (3 - 2 * ratio);
}

function normalizeRingSettings(settings: ThreeLayerRingSettings | undefined): ThreeLayerRingSettings {
  const defaults = createDefaultThreeLayerRingSettings();

  if (!settings) {
    return defaults;
  }

  return {
    ...defaults,
    ...settings,
    ringStyle: normalizeThreeLayerRingStyle(settings.ringStyle),
  };
}

function normalizeCommonSettings(settings: AnimationCommonSettings | undefined): AnimationCommonSettings {
  const defaults = createDefaultAnimationCommonSettings();

  if (!settings) {
    return defaults;
  }

  return {
    ...defaults,
    ...settings,
  };
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
