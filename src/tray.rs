use anyhow::Context as _;
use gpui::{App, Global};
use tray_icon::{
    Icon, TrayIcon, TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuItem},
};

const QUIT_ID: &str = "glossshift.quit";
const ICON_SIZE: u32 = 32;
const ICON_RGBA: &[u8] = include_bytes!("../packaging/tray-icon.rgba");

// Keep the native status item alive until GPUI shuts down, even while the
// translation popup is hidden. All native menu operations stay on its thread.
struct MenuBarIcon {
    _icon: TrayIcon,
}

impl Global for MenuBarIcon {}

pub fn install(cx: &mut App) -> anyhow::Result<()> {
    let menu = Menu::new();
    let quit = MenuItem::with_id(QUIT_ID, "Quit GlossShift", true, None);
    menu.append(&quit).context("failed to add Quit menu item")?;
    let icon = Icon::from_rgba(ICON_RGBA.to_vec(), ICON_SIZE, ICON_SIZE)
        .context("invalid embedded menu bar icon")?;
    let tray = TrayIconBuilder::new()
        .with_tooltip("GlossShift")
        .with_menu(Box::new(menu))
        .with_icon(icon)
        .with_icon_as_template(true)
        .build()
        .context("failed to create native status item")?;

    let (sender, receiver) = async_channel::bounded(1);
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        if event.id.as_ref() == QUIT_ID {
            let _ = sender.try_send(());
        }
    }));
    cx.set_global(MenuBarIcon { _icon: tray });
    cx.spawn(async move |cx| {
        if receiver.recv().await.is_ok() {
            let _ = cx.update(|app| app.quit());
        }
    })
    .detach();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_template_icon_has_visible_and_transparent_pixels() -> anyhow::Result<()> {
        Icon::from_rgba(ICON_RGBA.to_vec(), ICON_SIZE, ICON_SIZE)?;
        assert!(ICON_RGBA.chunks_exact(4).any(|pixel| pixel[3] == 0));
        assert!(ICON_RGBA.chunks_exact(4).any(|pixel| pixel[3] == 255));
        assert!(
            ICON_RGBA
                .chunks_exact(4)
                .all(|pixel| pixel[..3] == [0, 0, 0])
        );
        Ok(())
    }
}
