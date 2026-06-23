#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFeatureFrame {
    pub schema_version: u8,
    pub seq: u64,
    pub timestamp_ms: u64,
    pub volume: f32,
    pub rhythm: bool,
    pub spectrum: Vec<f32>,
    pub melody: Option<f32>,
}
