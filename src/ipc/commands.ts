import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, AudioSourcePreset } from "./types";
import { createDefaultSettings, normalizeSettings } from "../settings/settings-store";

export async function pingBackend(): Promise<string> {
  try {
    return await invoke<string>("ping");
  } catch {
    return "frontend-preview";
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    return normalizeSettings(await invoke<AppSettings>("get_app_settings"));
  } catch {
    return createDefaultSettings();
  }
}

export async function listAudioSourcePresets(): Promise<AudioSourcePreset[]> {
  try {
    return await invoke<AudioSourcePreset[]>("list_audio_source_presets");
  } catch {
    return [];
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  const normalizedSettings = normalizeSettings(settings);

  try {
    return normalizeSettings(await invoke<AppSettings>("save_app_settings", {
      settings: normalizedSettings,
    }));
  } catch {
    return normalizedSettings;
  }
}

export async function setMousePassthrough(enabled: boolean): Promise<boolean> {
  try {
    return await invoke<boolean>("set_mouse_passthrough", { enabled });
  } catch {
    return enabled;
  }
}

export async function openSettingsWindow(): Promise<void> {
  try {
    await invoke("open_settings_window");
  } catch {
    // Preview mode has no Tauri backend.
  }
}

export async function openDebugWindow(): Promise<void> {
  try {
    await invoke("open_debug_window");
  } catch {
    // Preview mode has no Tauri backend.
  }
}
