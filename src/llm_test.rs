use super::provider_headers;
use std::collections::HashMap;

#[test]
fn omitted_headers_remain_empty() -> anyhow::Result<()> {
    assert!(provider_headers(&HashMap::new(), "session")?.is_empty());
    Ok(())
}

#[test]
fn expands_every_session_placeholder_with_the_same_id() -> anyhow::Result<()> {
    let templates = HashMap::from([
        ("x-opencode-session".into(), "${session_id}".into()),
        (
            "x-trace".into(),
            "prefix-${session_id}-${session_id}".into(),
        ),
    ]);
    let headers = provider_headers(&templates, "stable-session")?;
    assert_eq!(headers["x-opencode-session"], "stable-session");
    assert_eq!(headers["x-trace"], "prefix-stable-session-stable-session");
    Ok(())
}

#[test]
fn preserves_literal_values_and_unrecognized_placeholders() -> anyhow::Result<()> {
    let templates = HashMap::from([("x-custom".into(), "literal-${HOME}-${sessoin_id}".into())]);
    let headers = provider_headers(&templates, "session")?;
    assert_eq!(headers["x-custom"], "literal-${HOME}-${sessoin_id}");
    Ok(())
}

#[test]
fn rejects_invalid_header_names_without_exposing_values() {
    let templates = HashMap::from([("invalid name".into(), "secret-value".into())]);
    let Err(error) = provider_headers(&templates, "session") else {
        panic!("invalid headers must be rejected");
    };
    assert!(
        error
            .downcast_ref::<http::header::InvalidHeaderName>()
            .is_some()
    );
    assert!(!format!("{error:#}").contains("secret-value"));
}

#[test]
fn rejects_header_injection_without_exposing_values() {
    let templates = HashMap::from([("x-custom".into(), "secret\r\nx-injected: value".into())]);
    let Err(error) = provider_headers(&templates, "session") else {
        panic!("invalid headers must be rejected");
    };
    assert!(
        error
            .downcast_ref::<http::header::InvalidHeaderValue>()
            .is_some()
    );
    assert!(!format!("{error:#}").contains("secret"));
}

#[test]
fn rejects_case_insensitive_duplicate_headers() {
    let templates = HashMap::from([
        ("X-Custom".into(), "first".into()),
        ("x-custom".into(), "second".into()),
    ]);
    let Err(error) = provider_headers(&templates, "session") else {
        panic!("invalid headers must be rejected");
    };
    assert_eq!(
        error.to_string(),
        "duplicate provider header name (case-insensitive)"
    );
}
