#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FloatingCorner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Default for FloatingCorner {
    fn default() -> Self {
        Self::BottomRight
    }
}

pub const FLOATING_SIZE_MIN: f64 = 220.0;
pub const FLOATING_SIZE_MAX: f64 = 720.0;
pub const FLOATING_SIZE_DEFAULT: f64 = 360.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingPosition {
    pub x: i32,
    pub y: i32,
}

impl FloatingPosition {
    pub fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }

    pub fn physical(self) -> tauri::PhysicalPosition<i32> {
        tauri::PhysicalPosition::new(self.x, self.y)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(transparent)]
pub struct FloatingSize(f64);

impl FloatingSize {
    fn new(value: f64) -> Self {
        if value.is_finite() {
            Self(value.clamp(FLOATING_SIZE_MIN, FLOATING_SIZE_MAX))
        } else {
            Self(FLOATING_SIZE_DEFAULT)
        }
    }

    pub fn logical_pixels(self) -> f64 {
        Self::new(self.0).0
    }
}

impl Default for FloatingSize {
    fn default() -> Self {
        Self(FLOATING_SIZE_DEFAULT)
    }
}

impl<'de> serde::Deserialize<'de> for FloatingSize {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct FloatingSizeVisitor;

        impl<'de> serde::de::Visitor<'de> for FloatingSizeVisitor {
            type Value = FloatingSize;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a floating window size in pixels")
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(FloatingSize::new(value))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(FloatingSize::new(value as f64))
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(FloatingSize::new(value as f64))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                let size = match value {
                    "small" => 280.0,
                    "medium" => FLOATING_SIZE_DEFAULT,
                    "large" => 480.0,
                    _ => value.parse::<f64>().unwrap_or(FLOATING_SIZE_DEFAULT),
                };

                Ok(FloatingSize::new(size))
            }
        }

        deserializer.deserialize_any(FloatingSizeVisitor)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioSourceMode {
    System,
    #[serde(alias = "process")]
    Preset,
}

impl Default for AudioSourceMode {
    fn default() -> Self {
        Self::System
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AudioSourceSettings {
    pub mode: AudioSourceMode,
    pub preset_id: Option<String>,
    pub fallback_to_system: bool,
}

impl Default for AudioSourceSettings {
    fn default() -> Self {
        Self {
            mode: AudioSourceMode::System,
            preset_id: None,
            fallback_to_system: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnimationType {
    ThreeLayerRing,
    RainbowBall,
}

impl Default for AnimationType {
    fn default() -> Self {
        Self::ThreeLayerRing
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ColorSetting {
    pub color: String,
    pub alpha: f32,
}

impl ColorSetting {
    fn new(color: &'static str, alpha: f32) -> Self {
        Self {
            color: color.to_string(),
            alpha,
        }
    }
}

impl Default for ColorSetting {
    fn default() -> Self {
        Self::new("#42d6b5", 0.88)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AnimationCommonSettings {
    pub response_strength: f32,
    pub opacity: f32,
}

impl Default for AnimationCommonSettings {
    fn default() -> Self {
        Self {
            response_strength: 1.0,
            opacity: 1.0,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ThreeLayerRingColors {
    pub idle: ColorSetting,
    pub rhythm: ColorSetting,
    pub low_energy: ColorSetting,
    pub high_energy: ColorSetting,
}

impl Default for ThreeLayerRingColors {
    fn default() -> Self {
        Self {
            idle: ColorSetting::new("#42d6b5", 1.0),
            rhythm: ColorSetting::new("#f8c15c", 1.0),
            low_energy: ColorSetting::new("#42d6b5", 1.0),
            high_energy: ColorSetting::new("#ff528e", 1.0),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ThreeLayerRingSettings {
    #[serde(default, rename = "responseStrength", skip_serializing)]
    legacy_response_strength: Option<f32>,
    pub rhythm_pulse: f32,
    pub spectrum_sensitivity: f32,
    pub colors: ThreeLayerRingColors,
}

impl Default for ThreeLayerRingSettings {
    fn default() -> Self {
        Self {
            legacy_response_strength: None,
            rhythm_pulse: 1.0,
            spectrum_sensitivity: 1.0,
            colors: ThreeLayerRingColors::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RainbowBallStyle {
    OpalCurrent,
    BiolumeLagoon,
    PlumNebula,
    SolarJelly,
    JadeSmoke,
    VioletAlloy,
}

impl Default for RainbowBallStyle {
    fn default() -> Self {
        Self::OpalCurrent
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct SolidSpectrumCircleSettings {
    pub rhythm_pulse: f32,
    pub spectrum_sensitivity: f32,
    pub wave_height: f32,
    pub rainbow_style: RainbowBallStyle,
    pub rotation_enabled: bool,
    pub rotation_speed: f32,
    pub rotation_angle: f32,
}

impl Default for SolidSpectrumCircleSettings {
    fn default() -> Self {
        Self {
            rhythm_pulse: 1.0,
            spectrum_sensitivity: 1.0,
            wave_height: 1.0,
            rainbow_style: RainbowBallStyle::OpalCurrent,
            rotation_enabled: true,
            rotation_speed: 1.0,
            rotation_angle: 0.0,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct AnimationSettings {
    pub common: AnimationCommonSettings,
    #[serde(rename = "three-layer-ring")]
    pub three_layer_ring: ThreeLayerRingSettings,
    #[serde(rename = "rainbow-ball")]
    pub rainbow_ball: SolidSpectrumCircleSettings,
}

impl Default for AnimationSettings {
    fn default() -> Self {
        Self {
            common: AnimationCommonSettings::default(),
            three_layer_ring: ThreeLayerRingSettings::default(),
            rainbow_ball: SolidSpectrumCircleSettings::default(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppSettings {
    pub mouse_passthrough: bool,
    pub start_with_windows: bool,
    pub floating_corner: FloatingCorner,
    pub floating_size: FloatingSize,
    pub floating_position: Option<FloatingPosition>,
    pub animation_type: AnimationType,
    pub animation_settings: AnimationSettings,
    pub audio_source: AudioSourceSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            mouse_passthrough: false,
            start_with_windows: false,
            floating_corner: FloatingCorner::BottomRight,
            floating_size: FloatingSize::default(),
            floating_position: None,
            animation_type: AnimationType::ThreeLayerRing,
            animation_settings: AnimationSettings::default(),
            audio_source: AudioSourceSettings::default(),
        }
    }
}

impl AppSettings {
    pub fn normalized(mut self) -> Self {
        if let Some(value) = self
            .animation_settings
            .three_layer_ring
            .legacy_response_strength
            .take()
        {
            self.animation_settings.common.response_strength = value;
        }

        self.animation_settings.common.opacity = self.animation_settings.common.opacity.clamp(0.0, 1.0);

        self
    }
}
