use std::{thread, time::Duration};

use accessibility::{AXAttribute, AXUIElement};
use anyhow::{Context as _, anyhow, bail};
use core_foundation::{base::CFType, string::CFString};
use core_graphics::{
    event::{CGEvent, CGEventFlags, CGEventTapLocation},
    event_source::{CGEventSource, CGEventSourceStateID},
};
use objc2_app_kit::NSPasteboard;
use objc2_foundation::NSString;

const COPY_KEY_CODE: u16 = 0x08;
const PASTEBOARD_POLL_INTERVAL: Duration = Duration::from_millis(25);
const PASTEBOARD_TIMEOUT: Duration = Duration::from_millis(300);

pub fn selected_text() -> anyhow::Result<String> {
    if !macos_accessibility_client::accessibility::application_is_trusted() {
        bail!(
            "Accessibility permission is required. Enable this app in System Settings > Privacy & Security > Accessibility."
        );
    }

    selected_text_via_accessibility().or_else(|accessibility_error| {
        copied_text_via_shortcut().with_context(|| {
            format!(
                "{accessibility_error:#}; failed to capture the selection with a simulated Cmd+C"
            )
        })
    })
}

fn selected_text_via_accessibility() -> anyhow::Result<String> {
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

fn copied_text_via_shortcut() -> anyhow::Result<String> {
    let pasteboard = NSPasteboard::generalPasteboard();
    let previous_change_count = pasteboard.changeCount();
    post_copy_shortcut()?;

    let started = std::time::Instant::now();
    loop {
        let current_change_count = pasteboard.changeCount();
        if current_change_count != previous_change_count {
            let plain_text_type = NSString::from_str("public.utf8-plain-text");
            let copied = pasteboard
                .stringForType(&plain_text_type)
                .map(|text| text.to_string());
            return copied_text_if_changed(previous_change_count, current_change_count, copied)
                .context("Cmd+C did not copy non-empty plain text");
        }
        if started.elapsed() >= PASTEBOARD_TIMEOUT {
            bail!("the pasteboard did not change after Cmd+C");
        }
        thread::sleep(PASTEBOARD_POLL_INTERVAL);
    }
}

fn post_copy_shortcut() -> anyhow::Result<()> {
    let source = CGEventSource::new(CGEventSourceStateID::Private)
        .map_err(|()| anyhow!("failed to create a Core Graphics event source"))?;
    let key_down = CGEvent::new_keyboard_event(source.clone(), COPY_KEY_CODE, true)
        .map_err(|()| anyhow!("failed to create the Cmd+C key-down event"))?;
    let key_up = CGEvent::new_keyboard_event(source, COPY_KEY_CODE, false)
        .map_err(|()| anyhow!("failed to create the Cmd+C key-up event"))?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);
    key_up.post(CGEventTapLocation::HID);
    Ok(())
}

fn copied_text_if_changed(
    previous_change_count: isize,
    current_change_count: isize,
    text: Option<String>,
) -> Option<String> {
    (current_change_count != previous_change_count)
        .then_some(text)
        .flatten()
        .filter(|text| !text.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_copied_text_when_pasteboard_changes() {
        // Given
        let previous_change_count = 4;
        let current_change_count = 5;

        // When
        let text = copied_text_if_changed(
            previous_change_count,
            current_change_count,
            Some("selected text".into()),
        );

        // Then
        assert_eq!(text.as_deref(), Some("selected text"));
    }

    #[test]
    fn ignores_clipboard_text_when_pasteboard_does_not_change() {
        // Given
        let unchanged_count = 4;

        // When
        let text = copied_text_if_changed(
            unchanged_count,
            unchanged_count,
            Some("stale clipboard".into()),
        );

        // Then
        assert_eq!(text, None);
    }

    #[test]
    fn ignores_blank_text_after_pasteboard_changes() {
        // Given
        let previous_change_count = 4;
        let current_change_count = 5;

        // When
        let text = copied_text_if_changed(
            previous_change_count,
            current_change_count,
            Some("  \n".into()),
        );

        // Then
        assert_eq!(text, None);
    }
}
