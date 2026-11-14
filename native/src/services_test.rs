use super::*;
use std::time::Duration;
use tempfile::TempDir;

fn fixture() -> anyhow::Result<(TempDir, Arc<Services>)> {
    let directory = TempDir::new()?;
    let loaded = config::LoadedConfig {
        app: config::parse_config(config::DEFAULT_CONFIG)?,
        directory: directory.path().into(),
        created_files: false,
    };
    let service = Services::with_loaded(loaded).map_err(anyhow::Error::msg)?;
    Ok((directory, service))
}

#[test]
fn terminal_initialization_needs_no_provider_credentials_or_accessibility() -> anyhow::Result<()> {
    let (_directory, service) = fixture()?;
    let bootstrap = service.terminal_bootstrap().map_err(anyhow::Error::msg)?;
    assert_eq!(bootstrap.schema_version, 2);
    assert_eq!(bootstrap.status, "Ready");
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
