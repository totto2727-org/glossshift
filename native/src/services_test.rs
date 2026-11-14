use super::*;
use std::time::Duration;
use tempfile::TempDir;

fn fixture() -> anyhow::Result<(TempDir, Arc<Services>)> {
    let directory = TempDir::new()?;
    let loaded = config::LoadedConfig {
        app: config::AppConfig {
            shortcuts: vec![config::ShortcutConfig {
                keys: "Ctrl+Super+KeyJ".parse().map_err(anyhow::Error::msg)?,
                target_language: "Japanese".into(),
            }],
            window: config::WindowConfig {
                width: 560.0,
                height: 360.0,
                min_width: 320.0,
                min_height: 180.0,
            },
        },
        directory: directory.path().into(),
        created_files: false,
    };
    let service = Services::with_loaded(loaded).map_err(anyhow::Error::msg)?;
    Ok((directory, service))
}

#[test]
fn denied_permission_bootstrap_returns_public_settings_without_requesting_access()
-> anyhow::Result<()> {
    let (_directory, service) = fixture()?;
    let bootstrap = service
        .bootstrap_for_permission(false)
        .map_err(anyhow::Error::msg)?;
    assert_eq!(bootstrap.schema_version, 2);
    assert_eq!(
        bootstrap.status,
        "Ready · Accessibility permission required"
    );
    assert!(!bootstrap.accessibility_granted);
    assert_eq!(bootstrap.shortcuts.len(), 1);
    assert!(!bootstrap.runtime.command.is_empty());
    assert!(bootstrap.runtime.entry.ends_with("node/main.ts"));
    Ok(())
}

#[test]
fn control_transport_rejects_parallel_consumers_and_reopens_after_reply() -> anyhow::Result<()> {
    let (_directory, service) = fixture()?;
    let session = service.open_transport().map_err(anyhow::Error::msg)?;
    service.runtime.block_on(async {
        tokio::time::timeout(Duration::from_secs(1), async {
            let first = service.next_control(&session);
            let second = async {
                tokio::task::yield_now().await;
                assert!(service.next_control(&session).await.is_err());
                service
                    .control_sender
                    .send(Services::capture_event(
                        "request".into(),
                        "text".into(),
                        "Japanese".into(),
                    ))
                    .await?;
                Ok::<(), anyhow::Error>(())
            };
            let (event, sent) = tokio::join!(first, second);
            sent?;
            assert_eq!(event.map_err(anyhow::Error::msg)?.text, "text");
            service
                .control_sender
                .send(BridgeEvent::new(EventKind::Reopened, "", ""))
                .await?;
            assert_eq!(
                service
                    .next_control(&session)
                    .await
                    .map_err(anyhow::Error::msg)?
                    .kind,
                EventKind::Reopened
            );
            service.close();
            assert!(service.next_control(&session).await.is_err());
            Ok::<(), anyhow::Error>(())
        })
        .await?
    })
}
