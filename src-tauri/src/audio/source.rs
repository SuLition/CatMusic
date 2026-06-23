const AUDIO_SOURCE_PRESETS: &[AudioSourcePresetDefinition] = &[
    AudioSourcePresetDefinition {
        id: "netease-cloud-music",
        display_name: "\u{7f51}\u{6613}\u{4e91}\u{97f3}\u{4e50}",
        process_names: &["cloudmusic.exe"],
    },
    AudioSourcePresetDefinition {
        id: "qq-music",
        display_name: "QQ \u{97f3}\u{4e50}",
        process_names: &["QQMusic.exe"],
    },
];

struct AudioSourcePresetDefinition {
    id: &'static str,
    display_name: &'static str,
    process_names: &'static [&'static str],
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSourcePreset {
    pub id: String,
    pub display_name: String,
    pub process_names: Vec<String>,
    pub running: bool,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone)]
struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

pub fn list_source_presets() -> Vec<AudioSourcePreset> {
    let processes = list_platform_processes();

    AUDIO_SOURCE_PRESETS
        .iter()
        .map(|preset| {
            let matched = find_process_for_preset(preset, &processes);

            AudioSourcePreset {
                id: preset.id.to_string(),
                display_name: preset.display_name.to_string(),
                process_names: preset
                    .process_names
                    .iter()
                    .map(|name| (*name).to_string())
                    .collect(),
                running: matched.is_some(),
                pid: matched.map(|process| process.pid),
            }
        })
        .collect()
}

pub fn resolve_preset_process(preset_id: &str) -> Option<u32> {
    let processes = list_platform_processes();
    let preset = AUDIO_SOURCE_PRESETS
        .iter()
        .find(|preset| preset.id == preset_id)?;

    find_process_for_preset(preset, &processes).map(|process| process.pid)
}

fn find_process_for_preset<'a>(
    preset: &AudioSourcePresetDefinition,
    processes: &'a [ProcessInfo],
) -> Option<&'a ProcessInfo> {
    processes.iter().find(|process| {
        preset
            .process_names
            .iter()
            .any(|name| process.name.eq_ignore_ascii_case(name))
    })
}

#[cfg(target_os = "windows")]
fn list_platform_processes() -> Vec<ProcessInfo> {
    use windows::Win32::{
        Foundation::CloseHandle,
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };

    let snapshot = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
        Ok(snapshot) => snapshot,
        Err(_) => return Vec::new(),
    };

    let mut processes = Vec::new();
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            let name = process_name(&entry.szExeFile);
            if !name.is_empty() && entry.th32ProcessID != 0 {
                processes.push(ProcessInfo {
                    pid: entry.th32ProcessID,
                    name,
                });
            }

            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }

    let _ = unsafe { CloseHandle(snapshot) };
    processes.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then(left.pid.cmp(&right.pid))
    });
    processes
}

#[cfg(not(target_os = "windows"))]
fn list_platform_processes() -> Vec<ProcessInfo> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn process_name(buffer: &[u16]) -> String {
    let len = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());

    String::from_utf16_lossy(&buffer[..len])
}
