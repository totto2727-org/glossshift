#[test]
fn bridge_declarations_match_the_typescript_transport_without_credentials() {
    let registry = crate::registry();
    let modules = registry.module_specs();
    let bridge = modules
        .iter()
        .find(|module| module.name == "Bridge")
        .unwrap_or_else(|| panic!("missing Bridge module"));
    for (name, returns) in [("openTransport", "string"), ("closeTransport", "void")] {
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
        "openTransport(): Promise<string>",
        "closeTransport(sessionId: string): Promise<void>",
        "nextControl(sessionId: string): Promise<BridgeEvent>",
        "selection(): Promise<string>",
    ] {
        assert!(
            declarations.contains(signature),
            "missing {signature} in {declarations}"
        );
    }
    for field in [
        "requestId",
        "targetLanguage",
        "accessibilityGranted",
        "runtime",
        "command",
        "entry",
    ] {
        assert!(declarations.contains(field), "missing wire field {field}");
    }
    for private in [
        "apiKey",
        "api_key",
        "credentials",
        "requestParameters",
        "headers",
        "translate(",
        "cancel(",
        "nextEvent(",
        "providerName",
        "initializeTerminal(",
        "copy(",
        "hide(",
        "reveal(",
        "quit(",
    ] {
        assert!(
            !declarations.contains(private),
            "obsolete or private API in generated declarations: {private}"
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
        (EventKind::Failed, "failed"),
        (EventKind::Reopened, "reopened"),
    ] {
        assert_eq!(kind.js_name(), expected);
    }
}
