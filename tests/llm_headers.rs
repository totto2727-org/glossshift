use std::{
    collections::HashMap,
    io::{Read as _, Write as _},
    net::TcpListener,
    thread,
    time::Duration,
};

use glossshift::{
    config::{DEFAULT_CONFIG, parse_config},
    llm::{RequestId, TranslationEvent, TranslationRequest, translate},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

async fn capture_translation(headers: &str) -> anyhow::Result<HashMap<String, String>> {
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
        // macOS can inherit the listener's nonblocking mode on accepted sockets.
        // Only accept is polled. Reading the request must wait for its bytes.
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
        assert_eq!(
            text.lines().next(),
            Some("POST /v1/chat/completions HTTP/1.1")
        );
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
        let body = "data: {\"id\":\"mock\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"mock\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"translated\"},\"finish_reason\":null}]}\n\ndata: [DONE]\n\n";
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )?;
        Ok(headers)
    });
    let source = format!("{DEFAULT_CONFIG}\n{headers}")
        .replace("https://api.openai.com/v1", &format!("http://{address}/v1"));
    let config = parse_config(&source)?;
    let (sender, receiver) = async_channel::bounded(16);
    let result = translate(
        TranslationRequest {
            id: RequestId(1),
            provider: config.provider()?.clone(),
            api_key: "test-key".into(),
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

#[tokio::test]
async fn sends_configured_headers_through_rig_with_one_session_id() -> anyhow::Result<()> {
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
