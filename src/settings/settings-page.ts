import {
  getAppSettings,
  listAudioSourcePresets,
  saveAppSettings,
} from "../ipc/commands";
import type { AppSettings, AudioSourcePreset } from "../ipc/types";
import { createSettingsView } from "./settings-view";

export async function createSettingsPage(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <main class="settings-shell">
      <section id="settings-host" class="settings-panel"></section>
    </main>
  `;

  const host = root.querySelector<HTMLElement>("#settings-host");

  if (!host) {
    throw new Error("Failed to initialize settings host");
  }

  let currentSettings = await getAppSettings();
  const audioSourcePresets: AudioSourcePreset[] = await listAudioSourcePresets();

  const applySettings = async (settings: AppSettings): Promise<void> => {
    currentSettings = await saveAppSettings(settings);
  };

  createSettingsView(host, currentSettings, audioSourcePresets, applySettings);
}
