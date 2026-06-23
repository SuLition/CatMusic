import type {
  AnimationCommonSettings,
  AnimationType,
  AppSettings,
  SolidSpectrumCircleSettings,
  ThreeLayerRingSettings,
} from "../ipc/types";

export const FLOATING_SIZE_MIN = 220;
export const FLOATING_SIZE_MAX = 720;
export const FLOATING_SIZE_DEFAULT = 360;

export function createDefaultAnimationCommonSettings(): AnimationCommonSettings {
  return {
    responseStrength: 1,
    baseBrightness: 0.55,
  };
}

export function createDefaultThreeLayerRingSettings(): ThreeLayerRingSettings {
  return {
    rhythmPulse: 1,
    spectrumSensitivity: 1,
    colors: {
      idle: {
        color: "#42d6b5",
        alpha: 0.56,
      },
      rhythm: {
        color: "#f8c15c",
        alpha: 0.94,
      },
      lowEnergy: {
        color: "#42d6b5",
        alpha: 0.88,
      },
      highEnergy: {
        color: "#ff528e",
        alpha: 0.96,
      },
    },
  };
}

export function createDefaultSolidSpectrumCircleSettings(): SolidSpectrumCircleSettings {
  return {
    rhythmPulse: 1,
    spectrumSensitivity: 1,
    waveHeight: 1,
    rainbowStyle: "cool",
    rotationEnabled: true,
    rotationSpeed: 1,
    rotationAngle: 0,
  };
}

export function createDefaultSettings(): AppSettings {
  return {
    mousePassthrough: false,
    startWithWindows: false,
    floatingCorner: "bottom-right",
    floatingSize: FLOATING_SIZE_DEFAULT,
    floatingPosition: null,
    animationType: "three-layer-ring",
    animationSettings: {
      common: createDefaultAnimationCommonSettings(),
      "three-layer-ring": createDefaultThreeLayerRingSettings(),
      "rainbow-ball": createDefaultSolidSpectrumCircleSettings(),
    },
    audioSource: {
      mode: "system",
      presetId: null,
      fallbackToSystem: true,
    },
  };
}

export function normalizeSettings(settings: AppSettings): AppSettings {
  const defaults = createDefaultSettings();
  const candidate = settings as AppSettings & { opacity?: number; floatingSize?: number | string };
  type LegacyRingSettings = Partial<ThreeLayerRingSettings & AnimationCommonSettings>;
  const commonSettings = candidate.animationSettings?.common;
  const ringSettings = candidate.animationSettings?.["three-layer-ring"] as LegacyRingSettings | undefined;
  const circleSettings = candidate.animationSettings?.["rainbow-ball"];
  const {
    responseStrength: legacyResponseStrength,
    baseBrightness: legacyBaseBrightness,
    ...ringSpecificSettings
  } = ringSettings ?? {};
  const normalizedCommon = {
    ...defaults.animationSettings.common,
    ...commonSettings,
    responseStrength: commonSettings?.responseStrength
      ?? legacyResponseStrength
      ?? defaults.animationSettings.common.responseStrength,
    baseBrightness: commonSettings?.baseBrightness
      ?? legacyBaseBrightness
      ?? defaults.animationSettings.common.baseBrightness,
  };
  const normalizedRing = {
    ...defaults.animationSettings["three-layer-ring"],
    ...ringSpecificSettings,
    colors: {
      ...defaults.animationSettings["three-layer-ring"].colors,
      ...ringSpecificSettings.colors,
    },
  };
  const normalizedCircle = {
    ...defaults.animationSettings["rainbow-ball"],
    ...circleSettings,
  };

  if (typeof candidate.opacity === "number" && !ringSettings) {
    const legacyAlpha = clamp01(candidate.opacity);
    normalizedRing.colors = {
      idle: { ...normalizedRing.colors.idle, alpha: legacyAlpha },
      rhythm: { ...normalizedRing.colors.rhythm, alpha: legacyAlpha },
      lowEnergy: { ...normalizedRing.colors.lowEnergy, alpha: legacyAlpha },
      highEnergy: { ...normalizedRing.colors.highEnergy, alpha: legacyAlpha },
    };
  }

  return {
    ...defaults,
    ...candidate,
    animationType: normalizeAnimationType(candidate.animationType),
    floatingSize: normalizeFloatingSize(candidate.floatingSize),
    floatingPosition: normalizeFloatingPosition(candidate.floatingPosition),
    animationSettings: {
      common: normalizedCommon,
      "three-layer-ring": normalizedRing,
      "rainbow-ball": normalizedCircle,
    },
    audioSource: {
      ...defaults.audioSource,
      ...candidate.audioSource,
    },
  };
}

export const defaultSettings: AppSettings = createDefaultSettings();

function normalizeAnimationType(value: unknown): AnimationType {
  return value === "rainbow-ball" || value === "three-layer-ring"
    ? value
    : "three-layer-ring";
}

function normalizeFloatingSize(value: number | string | undefined): number {
  if (value === "small") {
    return 280;
  }

  if (value === "medium") {
    return FLOATING_SIZE_DEFAULT;
  }

  if (value === "large") {
    return 480;
  }

  if (typeof value === "number") {
    return clamp(value, FLOATING_SIZE_MIN, FLOATING_SIZE_MAX);
  }

  return FLOATING_SIZE_DEFAULT;
}

function normalizeFloatingPosition(value: AppSettings["floatingPosition"] | undefined): AppSettings["floatingPosition"] {
  if (!value || typeof value.x !== "number" || typeof value.y !== "number") {
    return null;
  }

  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    return null;
  }

  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
  };
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}
