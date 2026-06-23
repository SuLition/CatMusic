import type {
  AnimationCommonSettings,
  AppSettings,
  AudioFeatureFrame,
  ColorSetting,
  ThreeLayerRingSettings,
} from "../ipc/types";
import {
  createDefaultAnimationCommonSettings,
  createDefaultThreeLayerRingSettings,
} from "../settings/settings-store";
import type { VisualizerAnimation } from "./animation-registry";

const SVG_NS = "http://www.w3.org/2000/svg";
const CENTER = 100;
const BASE_VIEWBOX_SIZE = 200;
const VIEWBOX_GLOW_MARGIN = 28;
const VIEWBOX_MIN = -VIEWBOX_GLOW_MARGIN;
const VIEWBOX_SIZE = BASE_VIEWBOX_SIZE + VIEWBOX_GLOW_MARGIN * 2;
const VIEWBOX_OUTER_EDGE = CENTER + VIEWBOX_GLOW_MARGIN;

// 圆环描边宽度：1 层最宽，3 层最窄。
// 如果改这里，并且仍希望三环边缘贴紧，需要一起重算下面的基础半径。
const LAYER_ONE_WIDTH = 24;
const LAYER_TWO_WIDTH = 10;
const LAYER_THREE_WIDTH = 5;

// 基础半径，单位是 SVG viewBox 坐标；这三个值决定静止时的整体大小。
// 当前值让三环刚好贴紧：
// 1 层外边缘 = 52 + 24 / 2 = 64
// 2 层内边缘 = 69 - 10 / 2 = 64
// 2 层外边缘 = 69 + 10 / 2 = 74
// 3 层内边缘 = 76.5 - 5 / 2 = 74
// 三个值一起增大，整体圆环变大；一起减小，整体圆环变小。
const LAYER_ONE_RADIUS = 52;
const LAYER_TWO_RADIUS = 69;
const LAYER_THREE_RADIUS = 76.5;

// 半径平滑速度。数值越大，尺寸越快跟随目标；数值越小，变化越柔和。
// 接近静音时使用 idle；音频活动较强时使用 dynamic。
const IDLE_RADIUS_SMOOTHING = 0.08;
const DYNAMIC_RADIUS_SMOOTHING = 0.22;

// 静止呼吸效果。period 是一次完整呼吸周期；scale 是正负缩放幅度。
// 例如 0.035 表示呼吸峰值大约放大/缩小 3.5%。
const IDLE_BREATH_PERIOD_MS = 3200;
const IDLE_BREATH_SCALE = 0.035;
const IDLE_BREATH_WEIGHT_SMOOTHING = 0.06;

// 音频活动门限。低于 floor 的值视为静止。
// full 表示活动强度达到 1.0 时对应的输入值。
const DYNAMIC_VOLUME_FLOOR = 0.035;
const DYNAMIC_SPECTRUM_FLOOR = 0.04;
const ACTIVITY_VOLUME_FULL = 0.22;
const ACTIVITY_SPECTRUM_FULL = 0.18;

// 活动强度平滑。attack 控制进入动态响应的速度。
// release 控制回落到静止状态的速度。
const ACTIVITY_ATTACK_SMOOTHING = 0.24;
const ACTIVITY_RELEASE_SMOOTHING = 0.045;

// 每层独立扩张幅度。这里是调每个环动态缩放半径的主要位置。
// 公式：扩张量 = 基础半径 * 当前层音频值 * 缩放幅度。
// 数值越大，该层越容易因为自己的音频数据向外扩。
// 1 层使用音量/节奏；2 层使用低半段频谱；3 层使用高半段频谱。
const LAYER_ONE_SCALE_RANGE = 0.16;
const LAYER_TWO_SCALE_RANGE = 0.18;
const LAYER_THREE_SCALE_RANGE = 0.20;

// 频谱泛光最大模糊半径；最外层动态半径会按这个值预留裁剪安全区。
const SPECTRUM_GLOW_MAX_BLUR = 11;
const LAYER_THREE_MAX_RADIUS = VIEWBOX_OUTER_EDGE - LAYER_THREE_WIDTH / 2 - SPECTRUM_GLOW_MAX_BLUR;

// 静止状态下三层环的亮度权重；保持一致可以避免静止时看起来像不同颜色。
const IDLE_OPACITY_LAYER_ONE = 1.0;
const IDLE_OPACITY_LAYER_TWO = 0.8;
const IDLE_OPACITY_LAYER_THREE = 0.6;

// 颜色平滑速度。数值越大，颜色变化越快；数值越小，越不容易看到跳色。
const COLOR_SMOOTHING = 0.12;

type Rgba = [number, number, number, number];

type LayerRadii = {
  layerOne: number;
  layerTwo: number;
  layerThree: number;
};

class ThreeLayerRingAnimation implements VisualizerAnimation {
  private host: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private layerOneTrack: SVGCircleElement | null = null;
  private layerTwoTrack: SVGCircleElement | null = null;
  private layerThreeTrack: SVGCircleElement | null = null;
  private rhythmRing: SVGCircleElement | null = null;
  private rhythmPulse: SVGCircleElement | null = null;
  private layerTwoRing: SVGCircleElement | null = null;
  private layerThreeRing: SVGCircleElement | null = null;
  private beatImpulse = 0;
  private layerOneValue = 0;
  private layerTwoValue = 0;
  private layerThreeValue = 0;
  private activityLevel = 0;
  private currentColor: Rgba = [66, 214, 181, 0.88];
  private commonSettings: AnimationCommonSettings = createDefaultAnimationCommonSettings();
  private ringSettings: ThreeLayerRingSettings = createDefaultThreeLayerRingSettings();
  private currentRadii: LayerRadii = {
    layerOne: LAYER_ONE_RADIUS,
    layerTwo: LAYER_TWO_RADIUS,
    layerThree: LAYER_THREE_RADIUS,
  };
  private idleBreathWeight = 0;
  mount(host: HTMLElement): void {
    this.host = host;
    this.host.replaceChildren();
    this.currentColor = parseColorSetting(this.ringSettings.colors.lowEnergy);

    this.svg = svgElement("svg");
    this.svg.setAttribute("viewBox", `${VIEWBOX_MIN} ${VIEWBOX_MIN} ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
    this.svg.setAttribute("class", "visualizer-ring");
    this.svg.setAttribute("aria-hidden", "true");

    this.appendLayerTracks();
    this.rhythmPulse = this.appendCircle("visualizer-ring-pulse", LAYER_ONE_RADIUS, LAYER_ONE_WIDTH);
    this.rhythmRing = this.appendCircle("visualizer-ring-rhythm", LAYER_ONE_RADIUS, LAYER_ONE_WIDTH);
    this.layerTwoRing = this.appendCircle("visualizer-ring-spectrum visualizer-ring-spectrum-two", LAYER_TWO_RADIUS, LAYER_TWO_WIDTH);
    this.layerThreeRing = this.appendCircle("visualizer-ring-spectrum visualizer-ring-spectrum-three", LAYER_THREE_RADIUS, LAYER_THREE_WIDTH);

    this.host.append(this.svg);
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
    this.commonSettings = normalizeCommonSettings(settings.animationSettings.common);
    this.ringSettings = normalizeRingSettings(settings.animationSettings["three-layer-ring"]);
  }

  destroy(): void {
    this.host?.replaceChildren();
    this.host = null;
    this.svg = null;
    this.layerOneTrack = null;
    this.layerTwoTrack = null;
    this.layerThreeTrack = null;
    this.rhythmRing = null;
    this.rhythmPulse = null;
    this.layerTwoRing = null;
    this.layerThreeRing = null;
    this.layerOneValue = 0;
    this.layerTwoValue = 0;
    this.layerThreeValue = 0;
    this.activityLevel = 0;
    this.currentColor = parseColorSetting(this.ringSettings.colors.lowEnergy);
    this.currentRadii = {
      layerOne: LAYER_ONE_RADIUS,
      layerTwo: LAYER_TWO_RADIUS,
      layerThree: LAYER_THREE_RADIUS,
    };
    this.idleBreathWeight = 0;
  }

  private appendLayerTracks(): void {
    this.layerOneTrack = this.appendCircle("visualizer-ring-track visualizer-ring-track-one", LAYER_ONE_RADIUS, LAYER_ONE_WIDTH);
    this.layerTwoTrack = this.appendCircle("visualizer-ring-track visualizer-ring-track-two", LAYER_TWO_RADIUS, LAYER_TWO_WIDTH);
    this.layerThreeTrack = this.appendCircle("visualizer-ring-track visualizer-ring-track-three", LAYER_THREE_RADIUS, LAYER_THREE_WIDTH);
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
    this.svg?.append(circle);
    return circle;
  }

  private renderBlendedLayers(frame: AudioFeatureFrame, activity: number): void {
    const responseStrength = clamp(this.commonSettings.responseStrength, 0.2, 2.5);
    const spectrumSensitivity = clamp(this.ringSettings.spectrumSensitivity, 0.2, 2.5);
    const baseBrightness = clamp01(this.commonSettings.baseBrightness);
    const volume = clamp(frame.volume * responseStrength, 0, 2);
    const splitIndex = Math.max(1, Math.floor(frame.spectrum.length / 2));
    const layerTwoEnergy = clamp(
      spectrumEnergy(frame.spectrum, 0, splitIndex) * responseStrength * spectrumSensitivity,
      0,
      2,
    );
    const layerThreeEnergy = clamp(
      spectrumEnergy(frame.spectrum, splitIndex, frame.spectrum.length) * responseStrength * spectrumSensitivity,
      0,
      2,
    );
    const normalizedActivity = clamp01(activity);
    this.layerOneValue = smoothValue(this.layerOneValue, Math.max(volume, this.beatImpulse) * normalizedActivity);
    this.layerTwoValue = smoothValue(this.layerTwoValue, layerTwoEnergy * normalizedActivity);
    this.layerThreeValue = smoothValue(this.layerThreeValue, layerThreeEnergy * normalizedActivity);

    const dynamicRadii = pushedRadii(this.layerOneValue, this.layerTwoValue, this.layerThreeValue);
    const radiusSmoothing = lerp(IDLE_RADIUS_SMOOTHING, DYNAMIC_RADIUS_SMOOTHING, normalizedActivity);
    this.idleBreathWeight = smoothNumber(this.idleBreathWeight, 1 - normalizedActivity, IDLE_BREATH_WEIGHT_SMOOTHING);
    const displayedRadii = this.applyLayerRadii(dynamicRadii, radiusSmoothing);
    const idleColor = parseColorSetting(this.ringSettings.colors.idle);
    const dynamicColor = colorForVolume(this.ringSettings, volume);
    const color = this.smoothColor(mixRgba(idleColor, dynamicColor, normalizedActivity), COLOR_SMOOTHING);
    const rhythmColor = mixRgba(color, parseColorSetting(this.ringSettings.colors.rhythm), clamp01(this.beatImpulse));
    this.applyBreathTransform(this.idleBreathWeight);
    this.renderRhythmRing(displayedRadii.layerOne, volume, color, rhythmColor, normalizedActivity, baseBrightness);
    this.renderSpectrumRing(this.layerTwoRing, this.layerTwoValue, color, displayedRadii.layerTwo, normalizedActivity, baseBrightness * IDLE_OPACITY_LAYER_TWO);
    this.renderSpectrumRing(this.layerThreeRing, this.layerThreeValue, color, displayedRadii.layerThree, normalizedActivity, baseBrightness * IDLE_OPACITY_LAYER_THREE);
  }

  private renderRhythmRing(
    radius: number,
    volume: number,
    color: Rgba,
    rhythmColor: Rgba,
    activity: number,
    baseBrightness: number,
  ): void {
    const ringOpacity = baseBrightness * 0.58 + clamp01(volume) * 0.38 + clamp01(this.beatImpulse) * 0.18;
    const pulseOpacity = clamp01(this.beatImpulse) * (0.22 + clamp01(volume) * 0.28);
    const rhythmStroke = mixRgba(color, rhythmColor, clamp01(this.beatImpulse * activity));

    if (this.rhythmRing) {
      setCircleRadius(this.rhythmRing, radius);
      this.rhythmRing.style.stroke = rgbaColor(rhythmStroke);
      this.rhythmRing.style.opacity = `${lerp(baseBrightness * IDLE_OPACITY_LAYER_ONE, Math.min(1, ringOpacity), activity)}`;
      this.rhythmRing.style.filter = dropShadow(rhythmStroke, 10);
    }

    if (this.rhythmPulse) {
      const visiblePulseOpacity = pulseOpacity * activity;
      setCircleRadius(this.rhythmPulse, radius);
      this.rhythmPulse.style.stroke = rgbaColor(rhythmColor);
      this.rhythmPulse.style.opacity = `${visiblePulseOpacity}`;
      this.rhythmPulse.style.transform = `scale(${1 + clamp(this.beatImpulse, 0, 2) * 0.22})`;
      this.rhythmPulse.style.filter = visiblePulseOpacity > 0.001
        ? dropShadow(rhythmColor, 5 + clamp(this.beatImpulse, 0, 2) * 8)
        : "";
    }
  }

  private renderSpectrumRing(
    ring: SVGCircleElement | null,
    value: number,
    color: Rgba,
    radius: number,
    activity: number,
    idleOpacity: number,
  ): void {
    if (!ring) {
      return;
    }

    const normalized = clamp01(value);
    const glow = normalized * activity;
    setCircleRadius(ring, radius);
    ring.style.stroke = rgbaColor(mixRgba(color, [255, 255, 255, color[3]], glow * 0.18));
    ring.style.opacity = `${lerp(idleOpacity, 0.22 + normalized * 0.68, activity)}`;
    ring.style.filter = glow > 0.015
      ? dropShadow(color, 2 + glow * (SPECTRUM_GLOW_MAX_BLUR - 2))
      : "";
  }

  private applyLayerRadii(target: LayerRadii, smoothing: number): LayerRadii {
    this.currentRadii = {
      layerOne: smoothNumber(this.currentRadii.layerOne, target.layerOne, smoothing),
      layerTwo: smoothNumber(this.currentRadii.layerTwo, target.layerTwo, smoothing),
      layerThree: smoothNumber(this.currentRadii.layerThree, target.layerThree, smoothing),
    };

    setCircleRadius(this.layerOneTrack, this.currentRadii.layerOne);
    setCircleRadius(this.layerTwoTrack, this.currentRadii.layerTwo);
    setCircleRadius(this.layerThreeTrack, this.currentRadii.layerThree);
    setCircleRadius(this.rhythmRing, this.currentRadii.layerOne);
    setCircleRadius(this.layerTwoRing, this.currentRadii.layerTwo);
    setCircleRadius(this.layerThreeRing, this.currentRadii.layerThree);

    return this.currentRadii;
  }

  private applyBreathTransform(weight: number): void {
    const phase = (performance.now() / IDLE_BREATH_PERIOD_MS) * Math.PI * 2;
    const scale = 1 + Math.sin(phase) * IDLE_BREATH_SCALE * clamp01(weight);
    const transform = `scale(${scale.toFixed(4)})`;

    this.layerOneTrack?.style.setProperty("transform", transform);
    this.layerTwoTrack?.style.setProperty("transform", transform);
    this.layerThreeTrack?.style.setProperty("transform", transform);
    this.rhythmRing?.style.setProperty("transform", transform);
    this.layerTwoRing?.style.setProperty("transform", transform);
    this.layerThreeRing?.style.setProperty("transform", transform);
  }

  private smoothColor(targetColor: Rgba, smoothing: number): Rgba {
    this.currentColor = smoothRgba(this.currentColor, targetColor, smoothing);
    return this.currentColor;
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

function colorForVolume(settings: ThreeLayerRingSettings, volume: number): Rgba {
  const low = parseColorSetting(settings.colors.lowEnergy);
  const high = parseColorSetting(settings.colors.highEnergy);

  return mixRgba(low, high, clamp01(volume));
}

function mixRgba(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
  ratio: number,
): Rgba {
  const value = clamp01(ratio);

  return [
    Math.round(left[0] + (right[0] - left[0]) * value),
    Math.round(left[1] + (right[1] - left[1]) * value),
    Math.round(left[2] + (right[2] - left[2]) * value),
    left[3] + (right[3] - left[3]) * value,
  ];
}

function rgbaColor(rgba: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(rgba[0])}, ${Math.round(rgba[1])}, ${Math.round(rgba[2])}, ${clamp01(rgba[3]).toFixed(3)})`;
}

function dropShadow(color: readonly [number, number, number, number], blurPx: number): string {
  return `drop-shadow(0 0 ${blurPx}px ${rgbaColor(color)})`;
}

function parseColorSetting(setting: ColorSetting): Rgba {
  return [...parseColor(setting.color), clamp01(setting.alpha)] as Rgba;
}

function parseColor(value: string): [number, number, number] {
  const hex = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];
  }

  const matches = hex.match(/\d+/g);

  if (!matches || matches.length < 3) {
    return [66, 214, 181];
  }

  return [
    Number(matches[0]),
    Number(matches[1]),
    Number(matches[2]),
  ];
}

function svgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function pushedRadii(
  layerOneValue: number,
  layerTwoValue: number,
  layerThreeValue: number,
): { layerOne: number; layerTwo: number; layerThree: number } {
  const layerOneExpansion = LAYER_ONE_RADIUS * clamp(layerOneValue, 0, 2) * LAYER_ONE_SCALE_RANGE;
  const layerTwoExpansion = LAYER_TWO_RADIUS * clamp(layerTwoValue, 0, 2) * LAYER_TWO_SCALE_RANGE;
  const layerThreeExpansion = LAYER_THREE_RADIUS * clamp(layerThreeValue, 0, 2) * LAYER_THREE_SCALE_RANGE;
  const layerOne = LAYER_ONE_RADIUS + layerOneExpansion;
  const layerTwoPush = Math.max(
    0,
    outerEdge(layerOne, LAYER_ONE_WIDTH) - innerEdge(LAYER_TWO_RADIUS, LAYER_TWO_WIDTH),
  );
  const layerTwo = LAYER_TWO_RADIUS + layerTwoPush + layerTwoExpansion;
  const layerThreePush = Math.max(
    0,
    outerEdge(layerTwo, LAYER_TWO_WIDTH) - innerEdge(LAYER_THREE_RADIUS, LAYER_THREE_WIDTH),
  );
  const layerThree = Math.min(
    LAYER_THREE_MAX_RADIUS,
    LAYER_THREE_RADIUS + layerThreePush + layerThreeExpansion,
  );

  return { layerOne, layerTwo, layerThree };
}

function innerEdge(radius: number, width: number): number {
  return radius - width / 2;
}

function outerEdge(radius: number, width: number): number {
  return radius + width / 2;
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

function smoothRgba(previous: Rgba, next: Rgba, factor: number): Rgba {
  return [
    smoothNumber(previous[0], next[0], factor),
    smoothNumber(previous[1], next[1], factor),
    smoothNumber(previous[2], next[2], factor),
    smoothNumber(previous[3], next[3], factor),
  ];
}

function normalizeRingSettings(settings: ThreeLayerRingSettings | undefined): ThreeLayerRingSettings {
  const defaults = createDefaultThreeLayerRingSettings();

  if (!settings) {
    return defaults;
  }

  return {
    ...defaults,
    ...settings,
    colors: {
      ...defaults.colors,
      ...settings.colors,
    },
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
