import type {
  AnimationCommonSettings,
  AppSettings,
  AudioFeatureFrame,
  SolidSpectrumCircleSettings,
} from "../ipc/types";
import {
  createDefaultAnimationCommonSettings,
  createDefaultSolidSpectrumCircleSettings,
} from "../settings/settings-store";
import type { VisualizerAnimation } from "./animation-registry";

const SVG_NS = "http://www.w3.org/2000/svg";
const CENTER = 100;
const VIEWBOX_MIN = -24;
const VIEWBOX_SIZE = 248;
const CORE_RADIUS = 58;
const MAX_WAVE_HEIGHT = 46;
const MIN_VISIBLE_WAVE_HEIGHT = 6;
const WAVE_INNER_RADIUS = CORE_RADIUS - 0.5;
const POINT_COUNT = 144;
const MIN_SPECTRUM_POINTS = 32;
const RADIAL_SMOOTHING_PASSES = 1;
const BASE_SPECTRUM_ROTATION_PERIOD_SECONDS = 28;
const ROTATION_SPEED_MIN = 0.1;
const ROTATION_SPEED_MAX = 3;
const IDLE_OUTLINE_OPACITY = 0.22;
const WAVE_RANGE_FLOOR = 0.08;
const WAVE_ENERGY_WEIGHT = 0.32;
const WAVE_CONTOUR_WEIGHT = 0.68;
const NEIGHBOR_CARRY_FIRST = 0.26;
const NEIGHBOR_CARRY_SECOND = 0.10;
const SURFACE_SMOOTHING_PASSES = 2;
const SURFACE_SMOOTHING_BLEND = 0.18;
const SURFACE_MAX_CONCAVITY = 2.4;
const SURFACE_WIDE_VALLEY_LIFT = 0.78;
const SURFACE_PEAK_KEEP = 0.86;
const SEAM_SMOOTH_SAMPLE_RATIO = 0.055;
const SEAM_SMOOTH_BLEND = 0.92;
const ACTIVITY_VOLUME_FLOOR = 0.025;
const ACTIVITY_SPECTRUM_FLOOR = 0.035;
const ACTIVITY_VOLUME_FULL = 0.24;
const ACTIVITY_SPECTRUM_FULL = 0.2;
const ACTIVITY_ATTACK_SMOOTHING = 0.28;
const ACTIVITY_RELEASE_SMOOTHING = 0.06;
const WAVE_ATTACK_ACCELERATION = 0.48;
const WAVE_RELEASE_ACCELERATION = 0.075;
const WAVE_ATTACK_DAMPING = 0.50;
const WAVE_RELEASE_DAMPING = 0.84;
const WAVE_VELOCITY_LIMIT = 0.55;
const WAVE_VALUE_MAX = 2;
const GLOW_ATTACK_SMOOTHING = 0.28;
const GLOW_RELEASE_SMOOTHING = 0.09;
const SIRI_RAINBOW_ALPHA = 0.92;
const SURFACE_OUTLINE_COLOR = "rgba(244, 253, 255, 0.92)";
const OUTER_LINE_MIN_GAP = 2.5;
const OUTER_LINE_DYNAMIC_GAP = 8.5;
const OUTER_LINE_BEAT_GAP = 3;
const OUTER_LINE_ATTACK_ACCELERATION = 0.24;
const OUTER_LINE_RELEASE_ACCELERATION = 0.13;
const OUTER_LINE_ATTACK_DAMPING = 0.66;
const OUTER_LINE_RELEASE_DAMPING = 0.84;
const OUTER_LINE_VELOCITY_LIMIT = 3.2;
const OUTER_LINE_IDLE_OPACITY = 0.48;
const OUTER_LINE_ACTIVE_OPACITY = 0.96;
const IDLE_BREATH_PERIOD_MS = 5200;
const IDLE_DRIFT_PERIOD_MS = 7600;
const IDLE_EDGE_WAVE_HEIGHT = 2.4;
const IDLE_RADIUS_BREATH_HEIGHT = 1.2;
const IDLE_OUTER_LINE_GAP = 3.4;
const TAU = Math.PI * 2;
const COLOR_FLOW_FILL_PERIOD_SECONDS = 18;
const COLOR_FLOW_STROKE_PERIOD_SECONDS = 14;
const COLOR_FLOW_OVERLAY_PERIOD_SECONDS = 22;

type Rgba = [number, number, number, number];

type BandProfile = {
  min: number;
  max: number;
  mean: number;
  range: number;
  energy: number;
};

type GradientStop = {
  offset: string;
  color: string;
  opacity: number;
};

type RainbowOverlayPaint = {
  cx: number;
  cy: number;
  r: number;
  color: string;
  midColor: string;
  opacity: number;
};

type RainbowStyleColors = {
  fill: GradientStop[];
  stroke: GradientStop[];
  overlays: RainbowOverlayPaint[];
  glow: Rgba[];
};

type RainbowPaintIds = {
  fill: string;
  stroke: string;
  overlays: string[];
};

type IdleMotion = {
  weight: number;
  breath: number;
  phase: number;
  glow: number;
};

let rainbowPaintIdCounter = 0;

class SolidSpectrumCircleAnimation implements VisualizerAnimation {
  private readonly rainbowPaintIds = createRainbowPaintIds();
  private host: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private rainbowDefs: SVGDefsElement | null = null;
  private glowPath: SVGPathElement | null = null;
  private silhouettePath: SVGPathElement | null = null;
  private rainbowOverlayPaths: SVGPathElement[] = [];
  private surfaceOutlinePath: SVGPathElement | null = null;
  private outerLinePath: SVGPathElement | null = null;
  private glowRotation: SVGAnimateTransformElement | null = null;
  private silhouetteRotation: SVGAnimateTransformElement | null = null;
  private rainbowOverlayRotations: Array<SVGAnimateTransformElement | null> = [];
  private surfaceOutlineRotation: SVGAnimateTransformElement | null = null;
  private outerLineRotation: SVGAnimateTransformElement | null = null;
  private activityLevel = 0;
  private beatImpulse = 0;
  private glowLevel = 0;
  private bandValues = Array.from({ length: MIN_SPECTRUM_POINTS }, () => 0);
  private bandVelocities = Array.from({ length: MIN_SPECTRUM_POINTS }, () => 0);
  private outerLineRadii: number[] = [];
  private outerLineVelocities: number[] = [];
  private commonSettings: AnimationCommonSettings = createDefaultAnimationCommonSettings();
  private circleSettings: SolidSpectrumCircleSettings = createDefaultSolidSpectrumCircleSettings();

  mount(host: HTMLElement): void {
    this.host = host;
    this.host.replaceChildren();

    this.svg = svgElement("svg");
    this.svg.setAttribute("viewBox", `${VIEWBOX_MIN} ${VIEWBOX_MIN} ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
    this.svg.setAttribute("class", "visualizer-solid-spectrum-circle");
    this.svg.setAttribute("aria-hidden", "true");
    this.rainbowDefs = createRainbowDefs(this.rainbowPaintIds, this.circleSettings.rainbowStyle);
    this.svg.append(this.rainbowDefs);

    this.glowPath = svgElement("path");
    this.glowPath.setAttribute("class", "visualizer-solid-spectrum-glow");
    this.glowPath.setAttribute("fill", "none");
    this.glowPath.setAttribute("stroke-linecap", "round");
    this.glowPath.setAttribute("stroke-linejoin", "round");
    this.glowPath.setAttribute("stroke-width", "7");
    this.svg.append(this.glowPath);

    this.silhouettePath = svgElement("path");
    this.silhouettePath.setAttribute("class", "visualizer-solid-spectrum-silhouette");
    this.silhouettePath.setAttribute("fill-rule", "evenodd");
    this.svg.append(this.silhouettePath);

    this.rainbowOverlayPaths = this.rainbowPaintIds.overlays.map((paintId) => {
      const path = svgElement("path");
      path.setAttribute("class", "visualizer-solid-spectrum-rainbow-layer");
      path.setAttribute("fill-rule", "evenodd");
      path.style.fill = paintUrl(paintId);
      path.style.display = "none";
      this.svg?.append(path);
      return path;
    });
    this.rainbowOverlayRotations = Array.from({ length: this.rainbowOverlayPaths.length }, () => null);

    this.surfaceOutlinePath = svgElement("path");
    this.surfaceOutlinePath.setAttribute("class", "visualizer-solid-spectrum-surface-outline");
    this.surfaceOutlinePath.setAttribute("fill", "none");
    this.surfaceOutlinePath.setAttribute("stroke-linecap", "round");
    this.surfaceOutlinePath.setAttribute("stroke-linejoin", "round");
    this.svg.append(this.surfaceOutlinePath);

    this.outerLinePath = svgElement("path");
    this.outerLinePath.setAttribute("class", "visualizer-solid-spectrum-outer-line");
    this.outerLinePath.setAttribute("fill", "none");
    this.outerLinePath.setAttribute("stroke-linecap", "round");
    this.outerLinePath.setAttribute("stroke-linejoin", "round");
    this.svg.append(this.outerLinePath);

    this.host.append(this.svg);
    this.applyRotationSettings();
    this.render(silentFrame());
  }

  render(frame: AudioFeatureFrame): void {
    const responseStrength = clamp(this.commonSettings.responseStrength, 0.2, 2.5);
    const spectrumSensitivity = clamp(this.circleSettings.spectrumSensitivity, 0.2, 2.5);
    const volume = clamp(frame.volume * responseStrength, 0, 2);
    const spectrum = normalizeSpectrum(frame.spectrum, MIN_SPECTRUM_POINTS);
    const spectrumLevel = spectrumEnergy(spectrum) * responseStrength * spectrumSensitivity;
    const nextActivity = audioActivity(volume, spectrumLevel, frame.rhythm);
    const activitySmoothing = nextActivity > this.activityLevel
      ? ACTIVITY_ATTACK_SMOOTHING
      : ACTIVITY_RELEASE_SMOOTHING;

    this.activityLevel = smoothNumber(this.activityLevel, nextActivity, activitySmoothing);
    this.beatImpulse = frame.rhythm
      ? clamp(this.circleSettings.rhythmPulse, 0, 2)
      : this.beatImpulse * 0.84;

    this.updateBandValues(spectrum, responseStrength, spectrumSensitivity, volume);
    this.renderShape(volume);
  }

  updateSettings(settings: AppSettings): void {
    this.commonSettings = normalizeCommonSettings(settings.animationSettings.common);
    this.circleSettings = normalizeCircleSettings(settings.animationSettings["rainbow-ball"]);
    this.updateRainbowDefs();
    this.applyRotationSettings();
  }

  destroy(): void {
    this.host?.replaceChildren();
    this.host = null;
    this.svg = null;
    this.rainbowDefs = null;
    this.glowPath = null;
    this.silhouettePath = null;
    this.rainbowOverlayPaths = [];
    this.surfaceOutlinePath = null;
    this.outerLinePath = null;
    this.glowRotation = null;
    this.silhouetteRotation = null;
    this.rainbowOverlayRotations = [];
    this.surfaceOutlineRotation = null;
    this.outerLineRotation = null;
    this.activityLevel = 0;
    this.beatImpulse = 0;
    this.glowLevel = 0;
    this.bandValues = Array.from({ length: MIN_SPECTRUM_POINTS }, () => 0);
    this.bandVelocities = Array.from({ length: MIN_SPECTRUM_POINTS }, () => 0);
    this.outerLineRadii = [];
    this.outerLineVelocities = [];
  }

  private updateBandValues(
    spectrum: number[],
    responseStrength: number,
    spectrumSensitivity: number,
    volume: number,
  ): void {
    const sharedLift = volume * 0.1 + this.beatImpulse * 0.1;
    const rawTargets = spectrum.map((value) => clamp(
      value * responseStrength * spectrumSensitivity + sharedLift,
      0,
      WAVE_VALUE_MAX,
    ));
    const carriedTargets = carryNeighborPeaks(rawTargets);

    if (this.bandValues.length !== carriedTargets.length) {
      this.bandValues = Array.from({ length: carriedTargets.length }, () => 0);
      this.bandVelocities = Array.from({ length: carriedTargets.length }, () => 0);
    }

    for (let index = 0; index < carriedTargets.length; index += 1) {
      const target = clamp(
        carriedTargets[index] ?? 0,
        0,
        WAVE_VALUE_MAX,
      );
      const current = this.bandValues[index] ?? 0;
      const velocity = this.bandVelocities[index] ?? 0;
      const next = inertialBandValue(current, velocity, target);

      this.bandValues[index] = next.value;
      this.bandVelocities[index] = next.velocity;
    }
  }

  private renderShape(volume: number): void {
    if (!this.glowPath || !this.silhouettePath || !this.surfaceOutlinePath || !this.outerLinePath) {
      return;
    }

    const activity = clamp01(this.activityLevel);
    const nextGlow = dynamicGlowStrength(activity, volume, this.bandValues, this.beatImpulse);
    const glowSmoothing = nextGlow > this.glowLevel
      ? GLOW_ATTACK_SMOOTHING
      : GLOW_RELEASE_SMOOTHING;
    this.glowLevel = smoothNumber(this.glowLevel, nextGlow, glowSmoothing);
    const glow = clamp01(this.glowLevel);
    const idleMotion = idleMotionState(activity);
    const displayGlow = Math.max(glow, idleMotion.glow);
    const waveHeightScale = clamp(this.circleSettings.waveHeight, 0.4, 2);
    const paths = wavePaths(
      this.bandValues,
      activity,
      this.beatImpulse,
      waveHeightScale,
      idleMotion,
      (targetRadii, minimumRadii) => this.updateOuterLineRadii(targetRadii, minimumRadii),
    );
    const wavePaint = paintUrl(this.rainbowPaintIds.fill);
    const strokePaint = paintUrl(this.rainbowPaintIds.stroke);
    const glowColor = siriRainbowGlowColor(this.circleSettings.rainbowStyle, volume, displayGlow);
    const idleBrightness = idleMotion.weight * smoothStep(idleMotion.breath);
    const silhouetteOpacity = lerp(1, lerp(0.95, 1, idleBrightness), idleMotion.weight);
    const overlayOpacity = lerp(1, lerp(0.92, 1, idleBrightness), idleMotion.weight);

    this.glowPath.setAttribute("d", paths.outline);
    this.glowPath.style.stroke = strokePaint;
    this.glowPath.setAttribute("stroke-width", lerp(2.25, 10, displayGlow).toFixed(2));
    this.glowPath.style.opacity = lerp(IDLE_OUTLINE_OPACITY, 0.92, displayGlow).toFixed(3);
    this.glowPath.style.filter = displayGlow > 0.015
      ? dropShadow(glowColor, lerp(2, 22, displayGlow))
      : "";

    this.silhouettePath.setAttribute("d", paths.outline);
    this.silhouettePath.style.fill = wavePaint;
    this.silhouettePath.style.opacity = silhouetteOpacity.toFixed(3);
    this.silhouettePath.style.filter = idleMotion.weight > 0.01
      ? dropShadow(glowColor, lerp(1, 4, idleBrightness))
      : "";

    for (const overlayPath of this.rainbowOverlayPaths) {
      overlayPath.setAttribute("d", paths.outline);
      overlayPath.style.display = "";
      overlayPath.style.opacity = overlayOpacity.toFixed(3);
    }

    this.surfaceOutlinePath.setAttribute("d", paths.outline);
    this.surfaceOutlinePath.style.stroke = SURFACE_OUTLINE_COLOR;
    this.surfaceOutlinePath.setAttribute("stroke-width", lerp(1.55, 2.35, displayGlow).toFixed(2));
    this.surfaceOutlinePath.style.opacity = lerp(0.68, 0.84, displayGlow).toFixed(3);
    this.surfaceOutlinePath.style.filter = `drop-shadow(0 0 ${lerp(3, 5, idleBrightness).toFixed(2)}px rgba(236, 250, 255, 0.28))`;

    this.outerLinePath.setAttribute("d", paths.outerLine);
    this.outerLinePath.style.stroke = strokePaint;
    this.outerLinePath.setAttribute("stroke-width", lerp(1.15, 2.75, displayGlow).toFixed(2));
    this.outerLinePath.style.opacity = lerp(OUTER_LINE_IDLE_OPACITY, OUTER_LINE_ACTIVE_OPACITY, displayGlow).toFixed(3);
    this.outerLinePath.style.filter = displayGlow > 0.02
      ? dropShadow(glowColor, lerp(1.5, 10, displayGlow))
      : "";

  }

  private updateOuterLineRadii(targetRadii: number[], minimumRadii: number[]): number[] {
    if (
      this.outerLineRadii.length !== targetRadii.length ||
      this.outerLineVelocities.length !== targetRadii.length
    ) {
      this.outerLineRadii = [...targetRadii];
      this.outerLineVelocities = Array.from({ length: targetRadii.length }, () => 0);
      return this.outerLineRadii;
    }

    for (let index = 0; index < targetRadii.length; index += 1) {
      const target = targetRadii[index] ?? 0;
      const minimum = minimumRadii[index] ?? target;
      const current = Math.max(this.outerLineRadii[index] ?? target, minimum);
      const velocity = this.outerLineVelocities[index] ?? 0;
      const next = inertialOuterLineRadius(current, velocity, target, minimum);

      this.outerLineRadii[index] = next.value;
      this.outerLineVelocities[index] = next.velocity;
    }

    return this.outerLineRadii;
  }

  private updateRainbowDefs(): void {
    if (!this.svg || !this.rainbowDefs) {
      return;
    }

    const nextDefs = createRainbowDefs(this.rainbowPaintIds, this.circleSettings.rainbowStyle);
    this.rainbowDefs.replaceWith(nextDefs);
    this.rainbowDefs = nextDefs;
  }

  private applyRotationSettings(): void {
    const duration = BASE_SPECTRUM_ROTATION_PERIOD_SECONDS / clamp(
      this.circleSettings.rotationSpeed,
      ROTATION_SPEED_MIN,
      ROTATION_SPEED_MAX,
    );
    const angle = clamp(this.circleSettings.rotationAngle, 0, 360);
    this.glowRotation = applyRotationAnimation(
      this.glowPath,
      this.glowRotation,
      this.circleSettings.rotationEnabled,
      duration,
      angle,
    );
    this.silhouetteRotation = applyRotationAnimation(
      this.silhouettePath,
      this.silhouetteRotation,
      this.circleSettings.rotationEnabled,
      duration,
      angle,
    );
    this.rainbowOverlayRotations = this.rainbowOverlayPaths.map((path, index) => applyRotationAnimation(
      path,
      this.rainbowOverlayRotations[index] ?? null,
      this.circleSettings.rotationEnabled,
      duration,
      angle,
    ));
    this.surfaceOutlineRotation = applyRotationAnimation(
      this.surfaceOutlinePath,
      this.surfaceOutlineRotation,
      this.circleSettings.rotationEnabled,
      duration,
      angle,
    );
    this.outerLineRotation = applyRotationAnimation(
      this.outerLinePath,
      this.outerLineRotation,
      this.circleSettings.rotationEnabled,
      duration,
      angle,
    );
  }
}

export function createSolidSpectrumCircleAnimation(): VisualizerAnimation {
  return new SolidSpectrumCircleAnimation();
}

function wavePaths(
  bands: number[],
  activity: number,
  beatImpulse: number,
  waveHeightScale: number,
  idleMotion: IdleMotion,
  resolveOuterLineRadii?: (targetRadii: number[], minimumRadii: number[]) => number[],
): { outline: string; ring: string; outerLine: string } {
  const smoothedBands = smoothClosedValues(bands, RADIAL_SMOOTHING_PASSES);
  const profile = spectrumProfile(smoothedBands);
  const angles: number[] = [];
  const rawWaveHeights: number[] = [];
  const activityLevel = clamp01(activity);

  for (let index = 0; index < POINT_COUNT; index += 1) {
    const ratio = index / POINT_COUNT;
    const angle = -Math.PI / 2 + ratio * Math.PI * 2;
    const bandValue = interpolatedBand(smoothedBands, ratio);
    const normalized = waveBandStrength(bandValue, profile);
    const impulse = clamp01(beatImpulse) * 4;
    const maxHeight = MAX_WAVE_HEIGHT * waveHeightScale;
    const baseHeight = Math.min(MIN_VISIBLE_WAVE_HEIGHT, maxHeight);
    const dynamicHeight = Math.max(0, maxHeight - baseHeight);
    const dynamicWaveHeight = normalized * dynamicHeight + impulse;

    angles.push(angle);
    rawWaveHeights.push(dynamicWaveHeight);
  }

  const waveHeights = smoothWaveSeam(smoothWaveSurface(rawWaveHeights));
  const outlinePoints: Array<{ x: number; y: number }> = [];
  const ringPoints: Array<{ x: number; y: number }> = [];
  const outerLinePoints: Array<{ x: number; y: number }> = [];
  const minimumOuterLineRadii: number[] = [];
  const targetOuterLineRadii: number[] = [];
  const maxHeight = MAX_WAVE_HEIGHT * waveHeightScale;
  const baseHeight = Math.min(MIN_VISIBLE_WAVE_HEIGHT, maxHeight);
  const dynamicHeight = Math.max(1, maxHeight - baseHeight);

  for (let index = 0; index < POINT_COUNT; index += 1) {
    const angle = angles[index] ?? 0;
    const dynamicWaveHeight = waveHeights[index] ?? 0;
    const idleWave = idleEdgeWave(angle, idleMotion);
    const idleBreath = idleMotion.weight * idleMotion.breath * IDLE_RADIUS_BREATH_HEIGHT;
    const visibleWaveHeight = dynamicWaveHeight * activityLevel + idleWave;
    const outlineRadius = CORE_RADIUS + baseHeight + idleBreath + visibleWaveHeight;
    const ringRadius = CORE_RADIUS + (baseHeight + dynamicWaveHeight) * activityLevel + idleBreath + idleWave;
    const localWaveStrength = clamp01((dynamicWaveHeight * activityLevel + Math.abs(idleWave)) / dynamicHeight);
    const lineGap = idleMotion.weight * (IDLE_OUTER_LINE_GAP + idleMotion.breath * 0.7)
      + activityLevel * (
      OUTER_LINE_MIN_GAP +
      localWaveStrength * OUTER_LINE_DYNAMIC_GAP +
      clamp01(beatImpulse) * OUTER_LINE_BEAT_GAP
    );

    outlinePoints.push(radialPoint(angle, outlineRadius));
    ringPoints.push(radialPoint(angle, ringRadius));
    minimumOuterLineRadii.push(outlineRadius);
    targetOuterLineRadii.push(outlineRadius + lineGap);
  }

  const outerLineRadii = resolveOuterLineRadii
    ? resolveOuterLineRadii(targetOuterLineRadii, minimumOuterLineRadii)
    : targetOuterLineRadii;

  for (let index = 0; index < POINT_COUNT; index += 1) {
    outerLinePoints.push(radialPoint(
      angles[index] ?? 0,
      outerLineRadii[index] ?? targetOuterLineRadii[index] ?? CORE_RADIUS,
    ));
  }

  return {
    outline: closedBezierSurfacePath(outlinePoints),
    ring: `${closedBezierSurfacePath(ringPoints)} ${circlePath(CENTER, CENTER, WAVE_INNER_RADIUS)}`,
    outerLine: closedBezierSurfacePath(outerLinePoints),
  };
}

function radialPoint(angle: number, radius: number): { x: number; y: number } {
  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

function closedBezierSurfacePath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 3) {
    return "";
  }

  const start = bSplinePoint(
    points[points.length - 1],
    points[0],
    points[1],
  );
  let path = `M ${format(start.x)} ${format(start.y)}`;

  for (let index = 0; index < points.length; index += 1) {
    const p1 = points[index];
    const p2 = points[(index + 1) % points.length];
    const p3 = points[(index + 2) % points.length];
    const cp1 = {
      x: (2 * p1.x + p2.x) / 3,
      y: (2 * p1.y + p2.y) / 3,
    };
    const cp2 = {
      x: (p1.x + 2 * p2.x) / 3,
      y: (p1.y + 2 * p2.y) / 3,
    };
    const end = bSplinePoint(p1, p2, p3);

    path += ` C ${format(cp1.x)} ${format(cp1.y)}, ${format(cp2.x)} ${format(cp2.y)}, ${format(end.x)} ${format(end.y)}`;
  }

  return `${path} Z`;
}

function bSplinePoint(
  previous: { x: number; y: number },
  current: { x: number; y: number },
  next: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (previous.x + 4 * current.x + next.x) / 6,
    y: (previous.y + 4 * current.y + next.y) / 6,
  };
}

function interpolatedBand(bands: number[], ratio: number): number {
  if (bands.length === 0) {
    return 0;
  }

  const position = ratio * bands.length;
  const leftIndex = Math.floor(position) % bands.length;
  const rightIndex = (leftIndex + 1) % bands.length;
  const localRatio = position - Math.floor(position);

  return lerp(bands[leftIndex] ?? 0, bands[rightIndex] ?? 0, localRatio);
}

function spectrumProfile(values: number[]): BandProfile {
  if (values.length === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      range: 0,
      energy: 0,
    };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let sum = 0;

  for (const value of values) {
    const normalized = clamp(value, 0, 2);
    min = Math.min(min, normalized);
    max = Math.max(max, normalized);
    sum += normalized;
  }

  const mean = sum / values.length;

  return {
    min,
    max,
    mean,
    range: max - min,
    energy: clamp01(mean),
  };
}

function waveBandStrength(value: number, profile: BandProfile): number {
  const absolute = Math.pow(clamp01(value * 0.75), 0.86);
  const relative = clamp01((value - profile.min) / Math.max(profile.range, WAVE_RANGE_FLOOR));
  const contour = absolute * 0.35 + Math.pow(relative, 0.72) * 0.65;

  return clamp01(profile.energy * WAVE_ENERGY_WEIGHT + contour * WAVE_CONTOUR_WEIGHT);
}

function carryNeighborPeaks(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  return values.map((value, index) => {
    const firstNeighbor = Math.max(
      values[(index - 1 + values.length) % values.length] ?? 0,
      values[(index + 1) % values.length] ?? 0,
    );
    const secondNeighbor = Math.max(
      values[(index - 2 + values.length) % values.length] ?? 0,
      values[(index + 2) % values.length] ?? 0,
    );
    const carried = Math.max(
      value,
      firstNeighbor * NEIGHBOR_CARRY_FIRST,
      secondNeighbor * NEIGHBOR_CARRY_SECOND,
    );

    return clamp(carried, 0, 2);
  });
}

function inertialBandValue(
  current: number,
  velocity: number,
  target: number,
): { value: number; velocity: number } {
  const rising = target > current;
  const acceleration = rising ? WAVE_ATTACK_ACCELERATION : WAVE_RELEASE_ACCELERATION;
  const damping = rising ? WAVE_ATTACK_DAMPING : WAVE_RELEASE_DAMPING;
  const nextVelocity = clamp(
    velocity * damping + (target - current) * acceleration,
    -WAVE_VELOCITY_LIMIT,
    WAVE_VELOCITY_LIMIT,
  );
  const nextValue = clamp(current + nextVelocity, 0, WAVE_VALUE_MAX);

  if (nextValue === 0 || nextValue === WAVE_VALUE_MAX) {
    return {
      value: nextValue,
      velocity: 0,
    };
  }

  return {
    value: nextValue,
    velocity: nextVelocity,
  };
}

function inertialOuterLineRadius(
  current: number,
  velocity: number,
  target: number,
  minimum: number,
): { value: number; velocity: number } {
  const rising = target > current;
  const acceleration = rising ? OUTER_LINE_ATTACK_ACCELERATION : OUTER_LINE_RELEASE_ACCELERATION;
  const damping = rising ? OUTER_LINE_ATTACK_DAMPING : OUTER_LINE_RELEASE_DAMPING;
  const nextVelocity = clamp(
    velocity * damping + (target - current) * acceleration,
    -OUTER_LINE_VELOCITY_LIMIT,
    OUTER_LINE_VELOCITY_LIMIT,
  );
  const nextValue = Math.max(current + nextVelocity, minimum);

  if (nextValue === minimum && target <= minimum) {
    return {
      value: nextValue,
      velocity: 0,
    };
  }

  return {
    value: nextValue,
    velocity: nextVelocity,
  };
}

function smoothWaveSurface(values: number[]): number[] {
  let result = values.map((value) => Math.max(0, value));

  for (let pass = 0; pass < SURFACE_SMOOTHING_PASSES; pass += 1) {
    const lifted = result.map((value, index) => {
      const previous = result[(index - 1 + result.length) % result.length] ?? value;
      const next = result[(index + 1) % result.length] ?? value;
      const widePrevious = result[(index - 2 + result.length) % result.length] ?? value;
      const wideNext = result[(index + 2) % result.length] ?? value;
      const localFloor = (previous + next) * 0.5 - SURFACE_MAX_CONCAVITY;
      const wideFloor = (widePrevious + wideNext) * 0.5 * SURFACE_WIDE_VALLEY_LIFT;

      return Math.max(value, localFloor, wideFloor, 0);
    });

    result = lifted.map((value, index) => {
      const previous = lifted[(index - 1 + lifted.length) % lifted.length] ?? value;
      const next = lifted[(index + 1) % lifted.length] ?? value;
      const smoothed = lerp(value, (previous + next) * 0.5, SURFACE_SMOOTHING_BLEND);

      return Math.max(smoothed, values[index] * SURFACE_PEAK_KEEP);
    });
  }

  return result;
}

function smoothWaveSeam(values: number[]): number[] {
  if (values.length < 8) {
    return values;
  }

  const result = [...values];
  const width = clamp(
    Math.round(values.length * SEAM_SMOOTH_SAMPLE_RATIO),
    3,
    Math.floor(values.length / 4),
  );
  const leftAnchor = values[values.length - width - 1] ?? values[values.length - 1] ?? 0;
  const rightAnchor = values[width] ?? values[0] ?? 0;
  const seamCenter = (
    (values[values.length - 1] ?? 0) * 0.32 +
    (values[0] ?? 0) * 0.32 +
    leftAnchor * 0.18 +
    rightAnchor * 0.18
  );

  for (let offset = 0; offset < width; offset += 1) {
    const falloff = 1 - smoothStep(offset / width);
    const blend = SEAM_SMOOTH_BLEND * falloff;
    const targetRatio = smoothStep(offset / Math.max(1, width - 1));
    const leftIndex = values.length - 1 - offset;
    const rightIndex = offset;
    const leftTarget = lerp(seamCenter, leftAnchor, targetRatio);
    const rightTarget = lerp(seamCenter, rightAnchor, targetRatio);

    result[leftIndex] = lerp(result[leftIndex] ?? 0, leftTarget, blend);
    result[rightIndex] = lerp(result[rightIndex] ?? 0, rightTarget, blend);
  }

  return result;
}

function smoothClosedValues(values: number[], passes: number): number[] {
  let result = values.map((value) => clamp(value, 0, 2));

  for (let pass = 0; pass < passes; pass += 1) {
    result = result.map((value, index) => {
      const previous = result[(index - 1 + result.length) % result.length] ?? value;
      const next = result[(index + 1) % result.length] ?? value;

      return previous * 0.25 + value * 0.5 + next * 0.25;
    });
  }

  return result;
}

function circlePath(cx: number, cy: number, radius: number): string {
  return [
    `M ${format(cx + radius)} ${format(cy)}`,
    `A ${format(radius)} ${format(radius)} 0 1 0 ${format(cx - radius)} ${format(cy)}`,
    `A ${format(radius)} ${format(radius)} 0 1 0 ${format(cx + radius)} ${format(cy)}`,
    "Z",
  ].join(" ");
}

function normalizeSpectrum(spectrum: number[], fallbackLength: number): number[] {
  if (spectrum.length > 0) {
    return spectrum.map(clamp01);
  }

  return Array.from({ length: fallbackLength }, () => 0);
}

function silentFrame(): AudioFeatureFrame {
  return {
    schemaVersion: 3,
    seq: 0,
    timestampMs: 0,
    volume: 0,
    rhythm: false,
    spectrum: Array.from({ length: MIN_SPECTRUM_POINTS }, () => 0),
    melody: null,
  };
}

function audioActivity(volume: number, spectrum: number, rhythm: boolean): number {
  if (rhythm) {
    return 1;
  }

  return Math.max(
    gateAndNormalize(volume, ACTIVITY_VOLUME_FLOOR, ACTIVITY_VOLUME_FULL),
    gateAndNormalize(spectrum, ACTIVITY_SPECTRUM_FLOOR, ACTIVITY_SPECTRUM_FULL),
  );
}

function gateAndNormalize(value: number, floor: number, full: number): number {
  if (value <= floor) {
    return 0;
  }

  return clamp01((value - floor) / Math.max(0.001, full - floor));
}

function spectrumEnergy(spectrum: number[]): number {
  if (spectrum.length === 0) {
    return 0;
  }

  let squareSum = 0;

  for (const value of spectrum) {
    squareSum += clamp01(value) ** 2;
  }

  return Math.sqrt(squareSum / spectrum.length);
}

function dynamicGlowStrength(activity: number, volume: number, bands: number[], beatImpulse: number): number {
  const spectrum = spectrumEnergy(bands);
  const dynamicEnergy = spectrum * 0.78 + clamp01(volume) * 0.22;
  const beatLift = clamp01(beatImpulse) * 0.18;

  return clamp01(clamp01(activity) * dynamicEnergy + beatLift);
}

function idleMotionState(activity: number): IdleMotion {
  const weight = 1 - smoothStep(clamp01(activity * 2.2));
  const now = performance.now();
  const breath = (Math.sin((now / IDLE_BREATH_PERIOD_MS) * TAU) + 1) * 0.5;
  const phase = (now / IDLE_DRIFT_PERIOD_MS) * TAU;

  return {
    weight,
    breath,
    phase,
    glow: weight * lerp(0.055, 0.14, smoothStep(breath)),
  };
}

function idleEdgeWave(angle: number, idleMotion: IdleMotion): number {
  if (idleMotion.weight <= 0.001) {
    return 0;
  }

  const mainWave = Math.sin(angle * 3 + idleMotion.phase);
  const secondaryWave = Math.sin(angle * 5 - idleMotion.phase * 0.72 + 0.85);
  const breathScale = 0.72 + idleMotion.breath * 0.28;

  return (
    mainWave * 0.58 +
    secondaryWave * 0.42
  ) * IDLE_EDGE_WAVE_HEIGHT * idleMotion.weight * breathScale;
}

function siriRainbowGlowColor(
  style: SolidSpectrumCircleSettings["rainbowStyle"],
  volume: number,
  glow: number,
): Rgba {
  const palette = rainbowStyleColors(style).glow;
  const value = clamp01(volume * 0.72 + glow * 0.28) * (palette.length - 1);
  const index = Math.floor(value);
  const nextIndex = Math.min(index + 1, palette.length - 1);

  return mixRgba(palette[index] ?? palette[0], palette[nextIndex] ?? palette[0], value - index);
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

function svgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function createRainbowPaintIds(): RainbowPaintIds {
  rainbowPaintIdCounter += 1;

  return {
    fill: `solid-spectrum-rainbow-fill-${rainbowPaintIdCounter}`,
    stroke: `solid-spectrum-rainbow-stroke-${rainbowPaintIdCounter}`,
    overlays: [
      `solid-spectrum-rainbow-layer-a-${rainbowPaintIdCounter}`,
      `solid-spectrum-rainbow-layer-b-${rainbowPaintIdCounter}`,
      `solid-spectrum-rainbow-layer-c-${rainbowPaintIdCounter}`,
      `solid-spectrum-rainbow-layer-d-${rainbowPaintIdCounter}`,
    ],
  };
}

function rainbowStyleColors(style: SolidSpectrumCircleSettings["rainbowStyle"]): RainbowStyleColors {
  switch (style) {
    case "aurora":
      return {
        fill: [
          { offset: "0%", color: "#63f4e5", opacity: 0.9 },
          { offset: "22%", color: "#5ee8bd", opacity: SIRI_RAINBOW_ALPHA },
          { offset: "44%", color: "#58d8f4", opacity: 0.91 },
          { offset: "66%", color: "#5c8df0", opacity: 0.9 },
          { offset: "84%", color: "#765cdd", opacity: 0.88 },
          { offset: "100%", color: "#a06fdf", opacity: 0.84 },
        ],
        stroke: [
          { offset: "0%", color: "#78f2e9", opacity: 0.84 },
          { offset: "22%", color: "#6be5b6", opacity: 0.86 },
          { offset: "44%", color: "#5bd6f5", opacity: 0.86 },
          { offset: "68%", color: "#5f8df0", opacity: 0.84 },
          { offset: "100%", color: "#9670df", opacity: 0.8 },
        ],
        overlays: [
          { cx: 74, cy: 62, r: 132, color: "#adfff3", midColor: "#66ead1", opacity: 0.34 },
          { cx: 178, cy: 78, r: 136, color: "#70f0bf", midColor: "#5de1d3", opacity: 0.3 },
          { cx: 158, cy: 178, r: 134, color: "#2e74f0", midColor: "#44bdf2", opacity: 0.32 },
          { cx: 46, cy: 176, r: 126, color: "#7051cf", midColor: "#a46ee2", opacity: 0.24 },
        ],
        glow: [
          [99, 244, 229, 0.82],
          [94, 232, 189, 0.84],
          [88, 216, 244, 0.84],
          [92, 141, 240, 0.84],
          [118, 92, 221, 0.82],
        ],
      };
    case "twilight":
      return {
        fill: [
          { offset: "0%", color: "#4ed7f1", opacity: 0.88 },
          { offset: "20%", color: "#4c9ff0", opacity: 0.9 },
          { offset: "42%", color: "#4c62db", opacity: SIRI_RAINBOW_ALPHA },
          { offset: "64%", color: "#6b4fc8", opacity: 0.9 },
          { offset: "82%", color: "#9b65d3", opacity: 0.86 },
          { offset: "100%", color: "#ce7aba", opacity: 0.78 },
        ],
        stroke: [
          { offset: "0%", color: "#58d5ee", opacity: 0.82 },
          { offset: "24%", color: "#4d9bed", opacity: 0.84 },
          { offset: "50%", color: "#5361d8", opacity: 0.84 },
          { offset: "76%", color: "#8560d1", opacity: 0.82 },
          { offset: "100%", color: "#c276bf", opacity: 0.76 },
        ],
        overlays: [
          { cx: 82, cy: 72, r: 128, color: "#73dff1", midColor: "#5caeed", opacity: 0.26 },
          { cx: 176, cy: 70, r: 132, color: "#535cd8", midColor: "#4e8fe9", opacity: 0.3 },
          { cx: 158, cy: 180, r: 138, color: "#3427a8", midColor: "#5646c7", opacity: 0.34 },
          { cx: 46, cy: 180, r: 130, color: "#9d4ca7", midColor: "#c072ba", opacity: 0.28 },
        ],
        glow: [
          [78, 215, 241, 0.78],
          [76, 159, 240, 0.82],
          [76, 98, 219, 0.84],
          [107, 79, 200, 0.82],
          [206, 122, 186, 0.74],
        ],
      };
    case "cool":
    default:
      return {
        fill: [
          { offset: "0%", color: "#68ecf6", opacity: 0.9 },
          { offset: "20%", color: "#55c7f6", opacity: SIRI_RAINBOW_ALPHA },
          { offset: "42%", color: "#4594ee", opacity: 0.91 },
          { offset: "64%", color: "#4b66df", opacity: 0.9 },
          { offset: "82%", color: "#6657d2", opacity: 0.88 },
          { offset: "100%", color: "#9269da", opacity: 0.86 },
        ],
        stroke: [
          { offset: "0%", color: "#70edf7", opacity: 0.82 },
          { offset: "18%", color: "#59c8f7", opacity: 0.84 },
          { offset: "38%", color: "#4898ef", opacity: 0.84 },
          { offset: "58%", color: "#4d6ee4", opacity: 0.82 },
          { offset: "78%", color: "#655bd4", opacity: 0.8 },
          { offset: "100%", color: "#9872df", opacity: 0.76 },
        ],
        overlays: [
          { cx: 86, cy: 68, r: 128, color: "#9bf8ff", midColor: "#6fdff7", opacity: 0.34 },
          { cx: 178, cy: 70, r: 132, color: "#69d6ff", midColor: "#4cbcf5", opacity: 0.32 },
          { cx: 160, cy: 180, r: 136, color: "#1554df", midColor: "#2f82f3", opacity: 0.34 },
          { cx: 46, cy: 180, r: 128, color: "#6d4ac7", midColor: "#9a69dc", opacity: 0.28 },
        ],
        glow: [
          [104, 236, 246, 0.82],
          [84, 198, 246, 0.84],
          [68, 148, 238, 0.86],
          [76, 102, 224, 0.86],
          [105, 88, 210, 0.84],
          [146, 105, 218, 0.82],
        ],
      };
  }
}

function createRainbowDefs(
  ids: RainbowPaintIds,
  style: SolidSpectrumCircleSettings["rainbowStyle"],
): SVGDefsElement {
  const defs = svgElement("defs");
  const colors = rainbowStyleColors(style);
  const fillGradient = svgElement("linearGradient");
  const strokeGradient = svgElement("linearGradient");

  fillGradient.setAttribute("id", ids.fill);
  fillGradient.setAttribute("gradientUnits", "userSpaceOnUse");
  fillGradient.setAttribute("x1", "-16");
  fillGradient.setAttribute("y1", "22");
  fillGradient.setAttribute("x2", "216");
  fillGradient.setAttribute("y2", "180");
  appendGradientStops(fillGradient, colors.fill);
  appendGradientFlow(fillGradient, COLOR_FLOW_FILL_PERIOD_SECONDS, "forward", 0);

  ids.overlays.forEach((id, index) => {
    defs.append(createRainbowOverlayGradient(id, colors.overlays[index] ?? colors.overlays[0], index));
  });

  strokeGradient.setAttribute("id", ids.stroke);
  strokeGradient.setAttribute("gradientUnits", "userSpaceOnUse");
  strokeGradient.setAttribute("x1", "-4");
  strokeGradient.setAttribute("y1", "100");
  strokeGradient.setAttribute("x2", "204");
  strokeGradient.setAttribute("y2", "100");
  appendGradientStops(strokeGradient, colors.stroke);
  appendGradientFlow(strokeGradient, COLOR_FLOW_STROKE_PERIOD_SECONDS, "reverse", -2.2);

  defs.append(fillGradient, strokeGradient);

  return defs;
}

function createRainbowOverlayGradient(
  id: string,
  overlay: {
    cx: number;
    cy: number;
    r: number;
    color: string;
    midColor: string;
    opacity: number;
  },
  index: number,
): SVGRadialGradientElement {
  const gradient = svgElement("radialGradient");

  gradient.setAttribute("id", id);
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  gradient.setAttribute("cx", `${overlay.cx}`);
  gradient.setAttribute("cy", `${overlay.cy}`);
  gradient.setAttribute("r", `${overlay.r}`);
  appendGradientStops(gradient, [
    { offset: "0%", color: overlay.color, opacity: overlay.opacity },
    { offset: "38%", color: overlay.midColor, opacity: overlay.opacity * 0.42 },
    { offset: "74%", color: overlay.midColor, opacity: overlay.opacity * 0.12 },
    { offset: "100%", color: overlay.midColor, opacity: 0 },
  ]);
  appendGradientFlow(
    gradient,
    COLOR_FLOW_OVERLAY_PERIOD_SECONDS + index * 2.5,
    index % 2 === 0 ? "forward" : "reverse",
    -index * 1.7,
  );

  return gradient;
}

function appendGradientFlow(
  gradient: SVGGradientElement,
  durationSeconds: number,
  direction: "forward" | "reverse",
  beginSeconds: number,
): void {
  const animation = svgElement("animateTransform");
  const fromAngle = direction === "forward" ? 0 : 360;
  const toAngle = direction === "forward" ? 360 : 0;

  animation.setAttribute("attributeName", "gradientTransform");
  animation.setAttribute("type", "rotate");
  animation.setAttribute("from", `${fromAngle} ${CENTER} ${CENTER}`);
  animation.setAttribute("to", `${toAngle} ${CENTER} ${CENTER}`);
  animation.setAttribute("dur", `${durationSeconds.toFixed(3)}s`);
  animation.setAttribute("begin", `${beginSeconds.toFixed(3)}s`);
  animation.setAttribute("repeatCount", "indefinite");
  gradient.append(animation);
}

function appendGradientStops(
  gradient: SVGGradientElement,
  stops: Array<{ offset: string; color: string; opacity: number }>,
): void {
  for (const stop of stops) {
    const element = svgElement("stop");
    element.setAttribute("offset", stop.offset);
    element.setAttribute("stop-color", stop.color);
    element.setAttribute("stop-opacity", stop.opacity.toFixed(3));
    gradient.append(element);
  }
}

function paintUrl(id: string): string {
  return `url(#${id})`;
}

function createRotationAnimation(durationSeconds: number, angle: number): SVGAnimateTransformElement {
  const animation = svgElement("animateTransform");
  animation.setAttribute("attributeName", "transform");
  animation.setAttribute("type", "rotate");
  animation.setAttribute("from", `${format(angle)} ${CENTER} ${CENTER}`);
  animation.setAttribute("to", `${format(angle + 360)} ${CENTER} ${CENTER}`);
  animation.setAttribute("dur", `${durationSeconds.toFixed(3)}s`);
  animation.setAttribute("repeatCount", "indefinite");

  return animation;
}

function applyRotationAnimation(
  path: SVGPathElement | null,
  animation: SVGAnimateTransformElement | null,
  enabled: boolean,
  durationSeconds: number,
  angle: number,
): SVGAnimateTransformElement | null {
  if (!path) {
    return null;
  }

  if (!enabled) {
    animation?.remove();
    path.setAttribute("transform", `rotate(${format(angle)} ${CENTER} ${CENTER})`);
    return null;
  }

  path.removeAttribute("transform");

  if (!animation || !animation.isConnected) {
    const nextAnimation = createRotationAnimation(durationSeconds, angle);
    path.append(nextAnimation);
    return nextAnimation;
  }

  animation.setAttribute("from", `${format(angle)} ${CENTER} ${CENTER}`);
  animation.setAttribute("to", `${format(angle + 360)} ${CENTER} ${CENTER}`);
  animation.setAttribute("dur", `${durationSeconds.toFixed(3)}s`);
  return animation;
}

function normalizeCircleSettings(settings: SolidSpectrumCircleSettings | undefined): SolidSpectrumCircleSettings {
  const defaults = createDefaultSolidSpectrumCircleSettings();

  if (!settings) {
    return defaults;
  }

  return {
    ...defaults,
    ...settings,
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

function format(value: number): string {
  return value.toFixed(3);
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
