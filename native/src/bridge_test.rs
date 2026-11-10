#[test]
fn bridge_declarations_match_the_typescript_transport_without_credentials() {
    let registry = crate::registry();
    let modules = registry.module_specs();
    let bridge = modules
        .iter()
        .find(|module| module.name == "Bridge")
        .unwrap_or_else(|| panic!("missing Bridge module"));
    for (name, returns) in [
        ("translate", "void"),
        ("cancel", "void"),
        ("initializeTerminal", "Bootstrap"),
        ("openTransport", "string"),
        ("closeTransport", "void"),
    ] {
        let function = bridge
            .functions
            .iter()
            .find(|function| function.name == name)
            .unwrap_or_else(|| panic!("missing {name} operation"));
        assert_eq!(function.kind, nsh_core::element::FunctionKind::Op);
        assert_eq!(function.returns.as_deref(), Some(returns));
    }
    let declarations = nsh_core::element::declarations(&registry, &[]);
    for signature in [
        "initialize(): Promise<Bootstrap>",
        "initializeTerminal(): Promise<Bootstrap>",
        "openTransport(): Promise<string>",
        "closeTransport(sessionId: string): Promise<void>",
        "nextEvent(sessionId: string): Promise<BridgeEvent>",
        "nextControl(sessionId: string): Promise<BridgeEvent>",
        "selection(): Promise<string>",
        "copy(text: string): Promise<void>",
        "hide(): Promise<void>",
        "reveal(): Promise<void>",
        "quit(): Promise<void>",
    ] {
        assert!(
            declarations.contains(signature),
            "missing {signature} in {declarations}"
        );
    }
    for field in [
        "requestId",
        "targetLanguage",
        "sourceLanguage",
        "accessibilityGranted",
        "providerName",
    ] {
        assert!(declarations.contains(field), "missing wire field {field}");
    }
    for private in [
        "apiKey",
        "api_key",
        "credentials",
        "requestParameters",
        "headers",
    ] {
        assert!(
            !declarations.contains(private),
            "private setting in generated declarations: {private}"
        );
    }
    assert!(
        crate::services::started_services().is_none(),
        "describing a module must not initialize native services"
    );
}

#[test]
fn wire_event_tags_are_lower_camel_case() {
    use crate::bridge_types::EventKind;
    use nsh_core::element::PropEnum as _;
    for (kind, expected) in [
        (EventKind::Capture, "capture"),
        (EventKind::Started, "started"),
        (EventKind::Delta, "delta"),
        (EventKind::Finished, "finished"),
        (EventKind::Failed, "failed"),
        (EventKind::Cancelled, "cancelled"),
        (EventKind::Reopened, "reopened"),
    ] {
        assert_eq!(kind.js_name(), expected);
    }
}
