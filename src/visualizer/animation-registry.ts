import type { AnimationType, AppSettings, AudioFeatureFrame } from "../ipc/types";
import { createThreeLayerRingAnimation } from "./ring-animation";
import { createSolidSpectrumCircleAnimation } from "./solid-spectrum-circle-animation";

export type VisualizerAnimation = {
  mount(host: HTMLElement): void;
  render(frame: AudioFeatureFrame): void;
  updateSettings(settings: AppSettings): void;
  destroy(): void;
};

type AnimationFactory = () => VisualizerAnimation;

const animationRegistry: Record<AnimationType, AnimationFactory> = {
  "three-layer-ring": createThreeLayerRingAnimation,
  "rainbow-ball": createSolidSpectrumCircleAnimation,
};

export function createVisualizerAnimation(type: AnimationType): VisualizerAnimation {
  const factory = animationRegistry[type] ?? animationRegistry["three-layer-ring"];
  return factory();
}
