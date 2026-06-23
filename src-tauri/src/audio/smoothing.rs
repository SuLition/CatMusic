#![allow(dead_code)]

pub fn smooth(previous: f32, next: f32, factor: f32) -> f32 {
    let factor = factor.clamp(0.0, 1.0);
    previous + (next - previous) * factor
}
