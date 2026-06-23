import { listen } from "@tauri-apps/api/event";
import type { AppSettings, AudioFeatureFrame } from "./types";

export async function listenToAudioFeatures(
  handler: (frame: AudioFeatureFrame) => void,
): Promise<() => void> {
  try {
    return await listen<AudioFeatureFrame>("audio://features", (event) => {
      handler(event.payload);
    });
  } catch {
    return () => undefined;
  }
}

export async function listenToSettingsChanged(
  handler: (settings: AppSettings) => void,
): Promise<() => void> {
  try {
    return await listen<AppSettings>("settings://changed", (event) => {
      handler(event.payload);
    });
  } catch {
    return () => undefined;
  }
}
