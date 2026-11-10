use super::*;
use std::{fs, time::Duration};
use tempfile::TempDir;

fn fixture() -> anyhow::Result<(TempDir, Arc<Services>)> {
    let directory = TempDir::new()?;
    let config_path = directory.path().join("config.toml");
    let credentials_path = directory.path().join("credentials.toml");
    fs::write(
        &config_path,
        "active_provider = \"test\"\n[providers.test]\nbase_url = \"https://example.invalid/v1\"\nmodel = \"test-model\"\ncredential = \"test\"\n",
    )?;
    fs::write(
        &credentials_path,
        "[credentials.test]\napi_key = \"synthetic-test-key\"\n",
    )?;
    let agents = llm_profiles::load_from_paths(llm_profiles::AgentConfigPaths::new(
        config_path,
        credentials_path,
    )?)?;
    let loaded = config::LoadedConfig {
        app: config::parse_config(config::DEFAULT_CONFIG)?,
        agents: Arc::new(agents),
        directory: directory.path().into(),
        created_files: false,
    };
    let service = Services::with_loaded(loaded).map_err(anyhow::Error::msg)?;
    Ok((directory, service))
}

#[test]
fn terminal_bootstrap_returns_shared_settings_without_accessibility_status() -> anyhow::Result<()> {
    let (_directory, service) = fixture()?;
    let bootstrap = service.terminal_bootstrap();
    assert_eq!(bootstrap.schema_version, 1);
    assert_eq!(bootstrap.provider_name, "test");
    assert_eq!(bootstrap.status, "Ready");
    assert!(!bootstrap.accessibility_granted);
    assert!(!bootstrap.source_language.is_empty());
    Ok(())
}

#[test]
fn stale_cancel_and_terminal_cannot_clear_newer_translation() -> anyhow::Result<()> {
    let (_directory, service) = fixture()?;
    let token = CancellationToken::new();
    *service
        .active
        .lock()
        .map_err(|_| anyhow::anyhow!("poisoned state"))? = Some(("new".into(), token.clone()));
    service.cancel(Some("old")).map_err(anyhow::Error::msg)?;
    service.terminal("old");
    assert!(!token.is_cancelled());
    service.cancel(Some("new")).map_err(anyhow::Error::msg)?;
    assert!(token.is_cancelled());
    assert!(
        service
            .active
            .lock()
            .map_err(|_| anyhow::anyhow!("poisoned state"))?
            .is_none()
    );
    Ok(())
}

#[test]
fn event_transport_rejects_parallel_consumers_and_reopens_after_reply() -> anyhow::Result<()> {
    let (_directory, service) = fixture()?;
    let session = service.open_transport().map_err(anyhow::Error::msg)?;
    service.runtime.block_on(async {
        tokio::time::timeout(Duration::from_secs(1), async {
            let first = service.next_event(&session);
            let second = async {
                tokio::task::yield_now().await;
                assert!(service.next_event(&session).await.is_err());
                service
                    .sender
                    .send(BridgeEvent::new(EventKind::Delta, "request", "text"))
                    .await?;
                Ok::<(), anyhow::Error>(())
            };
            let (event, sent) = tokio::join!(first, second);
            sent?;
            assert_eq!(event.map_err(anyhow::Error::msg)?.text, "text");
            service
                .sender
                .send(BridgeEvent::new(EventKind::Finished, "request", ""))
                .await?;
            assert_eq!(
                service
                    .next_event(&session)
                    .await
                    .map_err(anyhow::Error::msg)?
                    .kind,
                EventKind::Finished
            );
            Ok::<(), anyhow::Error>(())
        })
        .await?
    })
}

#[test]
fn controls_bypass_full_provider_queue_and_have_an_independent_consumer() -> anyhow::Result<()> {
    let (_directory, service) = fixture()?;
    let session = service.open_transport().map_err(anyhow::Error::msg)?;
    service.runtime.block_on(async {
        for _ in 0..256 {
            service
                .sender
                .send(BridgeEvent::new(EventKind::Delta, "old", "delta"))
                .await?;
        }
        service
            .control_sender
            .send(BridgeEvent::new(EventKind::Capture, "latest", "source"))
            .await?;
        let event = tokio::time::timeout(Duration::from_secs(1), service.next_control(&session))
            .await?
            .map_err(anyhow::Error::msg)?;
        assert_eq!(event.request_id, "latest");
        assert_eq!(event.text, "source");
        assert_eq!(service.events.len(), 256);
        service.close();
        assert!(service.next_control(&session).await.is_err());
        Ok::<(), anyhow::Error>(())
    })
}

#[test]
fn invalid_request_is_rejected_before_starting_network_work() -> anyhow::Result<()> {
    let (_directory, service) = fixture()?;
    for (id, source, target) in [
        ("", "source", "Japanese"),
        ("request", " ", "Japanese"),
        ("request", "source", ""),
    ] {
        assert!(
            service
                .translate(id.into(), source.into(), target.into())
                .is_err()
        );
    }
    assert!(service.events.try_recv().is_err());
    assert!(
        service
            .active
            .lock()
            .map_err(|_| anyhow::anyhow!("poisoned state"))?
            .is_none()
    );
    Ok(())
}
