use accessibility::{AXAttribute, AXUIElement};
use anyhow::{Context as _, bail};
use core_foundation::{base::CFType, string::CFString};

pub fn selected_text() -> anyhow::Result<String> {
    if !macos_accessibility_client::accessibility::application_is_trusted() {
        bail!(
            "Accessibility permission is required. Enable this app in System Settings > Privacy & Security > Accessibility."
        );
    }

    let focused_attribute = AXAttribute::<CFType>::new(&CFString::new("AXFocusedUIElement"));
    let selected_attribute = AXAttribute::<CFType>::new(&CFString::new("AXSelectedText"));
    let focused_value = AXUIElement::system_wide()
        .attribute(&focused_attribute)
        .context("failed to read the focused UI element")?;
    let focused = focused_value
        .downcast::<AXUIElement>()
        .context("the focused object is not an accessibility UI element")?;
    let selected_value = focused
        .attribute(&selected_attribute)
        .context("the focused UI element does not expose selected text")?;
    let selected = selected_value
        .downcast::<CFString>()
        .context("the selected text is not a string")?
        .to_string();
    if selected.trim().is_empty() {
        bail!("No text is selected.");
    }
    Ok(selected)
}
