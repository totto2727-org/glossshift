use std::{
    collections::HashMap,
    fs,
    io::{Read as _, Write as _},
    net::TcpListener,
    path::Path,
    sync::Arc,
    thread,
    time::Duration,
};

use glossshift::llm::{RequestId, TranslationEvent, TranslationRequest, translate};
use llm_profiles::{AgentConfigPaths, load_from_paths};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

async fn capture_translation(headers: &str) -> anyhow::Result<HashMap<String, String>> {
    capture_translation_at(headers, "/v1").await
}

async fn capture_translation_at(
    headers: &str,
    prefix: &'static str,
) -> anyhow::Result<HashMap<String, String>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let address = listener.local_addr()?;
    let server = thread::spawn(move || -> anyhow::Result<HashMap<String, String>> {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    anyhow::ensure!(std::time::Instant::now() < deadline, "request not received");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => return Err(error.into()),
            }
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        let mut request = Vec::new();
        let mut buffer = [0; 4096];
        let header_end = loop {
            let count = stream.read(&mut buffer)?;
            anyhow::ensure!(count > 0, "request ended before headers");
            request.extend_from_slice(&buffer[..count]);
            if let Some(position) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                break position;
            }
        };
        let text = std::str::from_utf8(&request[..header_end])?;
        let route = format!("POST {prefix}/chat/completions HTTP/1.1");
        assert_eq!(text.lines().next(), Some(route.as_str()));
        let headers: HashMap<_, _> = text
            .lines()
            .skip(1)
            .filter_map(|line| {
                line.split_once(':')
                    .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_owned()))
            })
            .collect();
        let length: usize = headers["content-length"].parse()?;
        while request.len() < header_end + 4 + length {
            let count = stream.read(&mut buffer)?;
            anyhow::ensure!(count > 0, "request ended before body");
            request.extend_from_slice(&buffer[..count]);
        }
        let payload: serde_json::Value =
            serde_json::from_slice(&request[header_end + 4..header_end + 4 + length])?;
        assert_translation_payload(&payload);
        let body = "data: {\"id\":\"mock\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"mock\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"translated\"},\"finish_reason\":null}]}\n\ndata: [DONE]\n\n";
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )?;
        Ok(headers)
    });
    let fixture = TempDir::new()?;
    let paths = write_provider_config(fixture.path(), address.port(), prefix, headers)?;
    let loaded = load_from_paths(paths)?;
    let (sender, receiver) = async_channel::bounded(16);
    let result = translate(
        TranslationRequest {
            id: RequestId(1),
            agents: Arc::new(loaded),
            source_language: "auto".into(),
            target_language: "Japanese".into(),
            text: "hello".into(),
        },
        sender,
        CancellationToken::new(),
    )
    .await;
    let captured = server
        .join()
        .unwrap_or_else(|error| panic!("server panicked: {error:?}"))?;
    result?;
    assert!(matches!(
        receiver.recv().await?,
        TranslationEvent::Started {
            id: RequestId(1),
            ..
        }
    ));
    match receiver.recv().await? {
        TranslationEvent::Delta { id, text } => {
            assert_eq!(id, RequestId(1));
            assert_eq!(text, "translated");
        }
        event => panic!("expected translation delta, got {event:?}"),
    }
    assert!(matches!(
        receiver.recv().await?,
        TranslationEvent::Finished { id: RequestId(1) }
    ));
    Ok(captured)
}

fn assert_translation_payload(payload: &serde_json::Value) {
    assert_eq!(payload["model"], "mock-model");
    assert_eq!(payload["stream"], true);
    assert_eq!(payload["messages"][0]["role"], "system");
    assert_eq!(
        payload["messages"][0]["content"],
        serde_json::json!([{
            "type": "text",
            "text": glossshift::prompt::translation_system_prompt("auto", "Japanese")
        }])
    );
    assert_eq!(payload["messages"][1]["role"], "user");
    assert_eq!(
        payload["messages"][1]["content"],
        glossshift::prompt::translation_user_prompt("hello")
    );
    assert_eq!(payload["reasoning_effort"], "none");
    assert_eq!(payload["chat_template_kwargs"]["enable_thinking"], false);
}

fn write_provider_config(
    root: &Path,
    port: u16,
    prefix: &str,
    headers: &str,
) -> anyhow::Result<AgentConfigPaths> {
    let config_path = root.join("agents/config.toml");
    let credentials_path = root.join("agents/credentials.toml");
    fs::create_dir_all(config_path.parent().unwrap_or(root))?;
    fs::write(
        &config_path,
        format!(
            "active_provider = \"default\"\n\n[providers.default]\nbase_url = \"http://127.0.0.1:{port}{prefix}\"\nmodel = \"mock-model\"\ncredential = \"default\"\nfirst_chunk_timeout_seconds = 30\nstream_idle_timeout_seconds = 60\n\n[providers.default.request_parameters]\nreasoning_effort = \"none\"\n[providers.default.request_parameters.chat_template_kwargs]\nenable_thinking = false\n\n{headers}"
        ),
    )?;
    fs::write(
        &credentials_path,
        "[credentials.default]\napi_key = \"test-key\"\n",
    )?;
    Ok(AgentConfigPaths::new(config_path, credentials_path)?)
}

#[tokio::test]
async fn preserves_opencode_go_prefix_and_request_parameters() -> anyhow::Result<()> {
    let headers = capture_translation_at(
        "[providers.default.headers]\nx-opencode-session = \"${session_id}\"\n",
        "/zen/go/v1",
    )
    .await?;
    assert_eq!(headers["authorization"], "Bearer test-key");
    assert_eq!(
        Uuid::parse_str(&headers["x-opencode-session"])?.get_version_num(),
        4
    );
    Ok(())
}

#[tokio::test]
async fn sends_configured_headers_through_shared_rig_adapter_with_one_session_id()
-> anyhow::Result<()> {
    let headers = capture_translation(
        r#"[providers.default.headers]
x-opencode-session = "${session_id}"
x-trace = "trace-${session_id}"
User-Agent = "glossshift/test"
"#,
    )
    .await?;
    let session = &headers["x-opencode-session"];
    assert_eq!(Uuid::parse_str(session)?.get_version_num(), 4);
    assert_eq!(headers["x-trace"], format!("trace-{session}"));
    assert_eq!(headers["user-agent"], "glossshift/test");
    assert_eq!(headers["authorization"], "Bearer test-key");
    Ok(())
}

#[tokio::test]
async fn independent_translations_get_distinct_sessions() -> anyhow::Result<()> {
    let config = "[providers.default.headers]\nx-opencode-session = \"${session_id}\"\n";
    let first = capture_translation(config).await?;
    let second = capture_translation(config).await?;
    assert_ne!(first["x-opencode-session"], second["x-opencode-session"]);
    Ok(())
}

#[tokio::test]
async fn unconfigured_provider_does_not_send_session_headers() -> anyhow::Result<()> {
    let headers = capture_translation("").await?;
    assert_eq!(headers.get("x-opencode-session"), None);
    assert_eq!(headers["authorization"], "Bearer test-key");
    Ok(())
}

#[tokio::test]
async fn literal_session_id_is_sent_unchanged() -> anyhow::Result<()> {
    let headers =
        capture_translation("[providers.default.headers]\nx-opencode-session = \"my-stable-id\"\n")
            .await?;
    assert_eq!(headers["x-opencode-session"], "my-stable-id");
    Ok(())
}

fn translation_request(root: &Path, port: u16) -> anyhow::Result<TranslationRequest> {
    let loaded = load_from_paths(write_provider_config(root, port, "/v1", "")?)?;
    Ok(TranslationRequest {
        id: RequestId(7),
        agents: Arc::new(loaded),
        source_language: "auto".into(),
        target_language: "Japanese".into(),
        text: "hello".into(),
    })
}

async fn stalled_provider_times_out(
    send_first_text: bool,
) -> anyhow::Result<Vec<TranslationEvent>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let (release, released) = std::sync::mpsc::channel();
    let server = thread::spawn(move || -> anyhow::Result<()> {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    anyhow::ensure!(std::time::Instant::now() < deadline, "request not received");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => return Err(error.into()),
            }
        };
        socket.set_read_timeout(Some(Duration::from_secs(5)))?;
        socket.set_write_timeout(Some(Duration::from_secs(5)))?;
        let mut request = Vec::new();
        let mut buffer = [0; 4096];
        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let count = socket.read(&mut buffer)?;
            anyhow::ensure!(count > 0, "request ended before headers");
            request.extend_from_slice(&buffer[..count]);
        }
        if send_first_text {
            let body = "data: {\"id\":\"mock\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"mock\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"first\"},\"finish_reason\":null}]}\n\n";
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 1000000\r\nConnection: close\r\n\r\n{body}"
            )?;
            socket.flush()?;
        }
        let _ = released.recv_timeout(Duration::from_secs(5));
        Ok(())
    });
    let fixture = TempDir::new()?;
    let mut request = translation_request(fixture.path(), port)?;
    let config_path = fixture.path().join("agents/config.toml");
    let config = fs::read_to_string(&config_path)?;
    let (first, idle) = if send_first_text { (3, 1) } else { (1, 3) };
    fs::write(
        &config_path,
        config
            .replace(
                "first_chunk_timeout_seconds = 30",
                &format!("first_chunk_timeout_seconds = {first}"),
            )
            .replace(
                "stream_idle_timeout_seconds = 60",
                &format!("stream_idle_timeout_seconds = {idle}"),
            ),
    )?;
    request.agents = Arc::new(load_from_paths(AgentConfigPaths::new(
        config_path,
        fixture.path().join("agents/credentials.toml"),
    )?)?);
    let (sender, events) = async_channel::bounded(8);
    let outcome = tokio::time::timeout(
        Duration::from_secs(2),
        translate(request, sender, CancellationToken::new()),
    )
    .await;
    let _ = release.send(());
    server
        .join()
        .unwrap_or_else(|error| panic!("server panicked: {error:?}"))?;
    let error = outcome?
        .err()
        .ok_or_else(|| anyhow::anyhow!("stalled provider completed successfully"))?;
    assert!(format!("{error:#}").contains("timed out"), "{error:#}");
    let mut actual = Vec::new();
    while let Ok(event) = events.try_recv() {
        actual.push(event);
    }
    Ok(actual)
}

#[tokio::test]
async fn first_chunk_timeout_includes_waiting_for_response_headers() -> anyhow::Result<()> {
    let events = stalled_provider_times_out(false).await?;
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, TranslationEvent::Delta { .. }))
    );
    Ok(())
}

#[tokio::test]
async fn idle_timeout_applies_after_the_first_text_delta() -> anyhow::Result<()> {
    let events = stalled_provider_times_out(true).await?;
    assert!(
        events
            .iter()
            .any(|event| matches!(event, TranslationEvent::Delta { text, .. } if text == "first"))
    );
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, TranslationEvent::Finished { .. }))
    );
    Ok(())
}

#[tokio::test]
async fn downstream_backpressure_does_not_consume_provider_idle_timeout() -> anyhow::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let (ready, response_ready) = tokio::sync::oneshot::channel();
    let (release, released) = std::sync::mpsc::channel();
    let server = thread::spawn(move || -> anyhow::Result<()> {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    anyhow::ensure!(std::time::Instant::now() < deadline, "request not received");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => return Err(error.into()),
            }
        };
        socket.set_read_timeout(Some(Duration::from_secs(5)))?;
        socket.set_write_timeout(Some(Duration::from_secs(5)))?;
        let mut request = Vec::new();
        let mut buffer = [0; 4096];
        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let count = socket.read(&mut buffer)?;
            anyhow::ensure!(count > 0, "request ended before headers");
            request.extend_from_slice(&buffer[..count]);
        }
        let first = "data: {\"id\":\"mock\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"mock\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"first\"},\"finish_reason\":null}]}\n\n";
        let last = "data: {\"id\":\"mock\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"mock\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" second\"},\"finish_reason\":null}]}\n\ndata: {\"id\":\"mock\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"mock\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{first}",
            first.len() + last.len(),
        )?;
        socket.flush()?;
        let _ = ready.send(());
        released.recv_timeout(Duration::from_secs(5))?;
        thread::sleep(Duration::from_millis(200));
        socket.write_all(last.as_bytes())?;
        socket.flush()?;
        Ok(())
    });
    let fixture = TempDir::new()?;
    let mut request = translation_request(fixture.path(), port)?;
    let config_path = fixture.path().join("agents/config.toml");
    fs::write(
        &config_path,
        fs::read_to_string(&config_path)?.replace(
            "stream_idle_timeout_seconds = 60",
            "stream_idle_timeout_seconds = 1",
        ),
    )?;
    request.agents = Arc::new(load_from_paths(AgentConfigPaths::new(
        config_path,
        fixture.path().join("agents/credentials.toml"),
    )?)?);
    let (sender, events) = async_channel::bounded(1);
    let cancellation = CancellationToken::new();
    let task = tokio::spawn(translate(request, sender, cancellation.clone()));
    tokio::time::timeout(Duration::from_secs(5), response_ready).await??;
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(1), events.recv()).await??,
        TranslationEvent::Started { .. }
    ));
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(1), events.recv()).await??,
        TranslationEvent::Delta { text, .. } if text == "first"
    ));
    let _ = release.send(());
    let output = tokio::time::timeout(Duration::from_secs(3), async {
        let mut text = String::new();
        while let Ok(event) = events.recv().await {
            match event {
                TranslationEvent::Delta { text: delta, .. } => text.push_str(&delta),
                TranslationEvent::Finished { .. } => return Ok(text),
                _ => {}
            }
        }
        anyhow::bail!("stream ended without Finished")
    })
    .await;
    if output.is_err() {
        cancellation.cancel();
    }
    let outcome = tokio::time::timeout(Duration::from_secs(1), task).await??;
    server
        .join()
        .unwrap_or_else(|error| panic!("server panicked: {error:?}"))?;
    outcome?;
    assert_eq!(output??, " second");
    Ok(())
}

#[tokio::test]
async fn cancellation_does_not_wait_for_a_full_event_channel() -> anyhow::Result<()> {
    let fixture = TempDir::new()?;
    let request = translation_request(fixture.path(), 1)?;
    let (sender, receiver) = async_channel::bounded(1);
    sender
        .send(TranslationEvent::Finished { id: RequestId(6) })
        .await?;
    let cancellation = CancellationToken::new();
    let task = tokio::spawn(translate(request, sender, cancellation.clone()));
    tokio::task::yield_now().await;
    cancellation.cancel();
    tokio::time::timeout(Duration::from_secs(1), task).await???;
    assert_eq!(
        receiver.len(),
        1,
        "cancelled request must not emit an event"
    );
    assert!(matches!(
        receiver.recv().await?,
        TranslationEvent::Finished { id: RequestId(6) }
    ));
    Ok(())
}

#[tokio::test]
async fn cancellation_interrupts_a_provider_that_never_returns_headers() -> anyhow::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let (notify_request, request_received) = tokio::sync::oneshot::channel();
    let (release, released) = std::sync::mpsc::channel();
    let server = thread::spawn(move || -> anyhow::Result<()> {
        let (mut socket, _) = listener.accept()?;
        socket.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut request = Vec::new();
        let mut buffer = [0; 4096];
        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let count = socket.read(&mut buffer)?;
            anyhow::ensure!(count > 0, "request closed before headers");
            request.extend_from_slice(&buffer[..count]);
        }
        notify_request
            .send(())
            .map_err(|()| anyhow::anyhow!("test ended"))?;
        let _ = released.recv_timeout(Duration::from_secs(5));
        Ok(())
    });
    let fixture = TempDir::new()?;
    let request = translation_request(fixture.path(), port)?;
    let (events, receiver) = async_channel::bounded(4);
    let cancellation = CancellationToken::new();
    let mut task = tokio::spawn(translate(request, events, cancellation.clone()));
    tokio::time::timeout(Duration::from_secs(5), request_received).await??;
    cancellation.cancel();
    let result = tokio::time::timeout(Duration::from_secs(1), &mut task).await;
    let _ = release.send(());
    server
        .join()
        .unwrap_or_else(|error| panic!("server panicked: {error:?}"))?;
    if result.is_err() {
        task.abort();
    }
    result???;
    assert!(matches!(
        receiver.recv().await?,
        TranslationEvent::Started {
            id: RequestId(7),
            ..
        }
    ));
    assert!(
        receiver.try_recv().is_err(),
        "cancellation is not completion"
    );
    Ok(())
}
