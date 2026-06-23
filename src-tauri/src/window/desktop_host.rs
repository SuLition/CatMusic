#![allow(dead_code)]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopHostState {
    Disabled,
    FloatingFallback,
}
