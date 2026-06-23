#![allow(dead_code)]

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub scale_factor: f64,
    pub width: u32,
    pub height: u32,
}
