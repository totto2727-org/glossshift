//! Application-facing capabilities implemented by the native desktop adapter.
//!
//! Native resource installation stays at the composition root. The popup only
//! receives selection capture, not permission management or native lifecycle APIs.

pub trait SelectionSource {
    fn selected_text(&self) -> anyhow::Result<String>;
}

pub trait AccessibilityPermission {
    fn is_granted(&self) -> bool;
}
