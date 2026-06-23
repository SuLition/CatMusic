export type AudioFeatureFrame = {
  schemaVersion: 3;
  seq: number;
  timestampMs: number;
  volume: number;
  rhythm: boolean;
  spectrum: number[];
  melody: number | null;
};

export type FloatingCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type FloatingPosition = {
  x: number;
  y: number;
};

export type AudioSourceMode = "system" | "preset";

export type AudioSourcePresetId = "netease-cloud-music" | "qq-music";

export type AudioSourceSettings = {
  mode: AudioSourceMode;
  presetId: AudioSourcePresetId | null;
  fallbackToSystem: boolean;
};

export type AudioSourcePreset = {
  id: AudioSourcePresetId;
  displayName: string;
  processNames: string[];
  running: boolean;
  pid: number | null;
};

export type AnimationType = "three-layer-ring" | "rainbow-ball";

export type ColorSetting = {
  color: string;
  alpha: number;
};

export type AnimationCommonSettings = {
  responseStrength: number;
  baseBrightness: number;
};

export type ThreeLayerRingColors = {
  idle: ColorSetting;
  rhythm: ColorSetting;
  lowEnergy: ColorSetting;
  highEnergy: ColorSetting;
};

export type ThreeLayerRingSettings = {
  rhythmPulse: number;
  spectrumSensitivity: number;
  colors: ThreeLayerRingColors;
};

export type RainbowBallStyle = "cool" | "aurora" | "twilight";

export type SolidSpectrumCircleSettings = {
  rhythmPulse: number;
  spectrumSensitivity: number;
  waveHeight: number;
  rainbowStyle: RainbowBallStyle;
  rotationEnabled: boolean;
  rotationSpeed: number;
  rotationAngle: number;
};

export type AnimationSettings = {
  common: AnimationCommonSettings;
  "three-layer-ring": ThreeLayerRingSettings;
  "rainbow-ball": SolidSpectrumCircleSettings;
};

export type AppSettings = {
  mousePassthrough: boolean;
  startWithWindows: boolean;
  floatingCorner: FloatingCorner;
  floatingSize: number;
  floatingPosition: FloatingPosition | null;
  animationType: AnimationType;
  animationSettings: AnimationSettings;
  audioSource: AudioSourceSettings;
};
