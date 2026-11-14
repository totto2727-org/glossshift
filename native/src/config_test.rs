use super::*;
use global_hotkey::hotkey::{Code, Modifiers};

fn response(keys: &[&str]) -> Vec<u8> {
    serde_json::json!({
        "shortcuts": keys.iter().map(|key| serde_json::json!({"keys":key,"target_language":"Japanese"})).collect::<Vec<_>>(),
        "window": {"width":560,"height":360,"min_width":320,"min_height":180},
        "directory":"/synthetic/config/glossshift",
        "created_files":true
    }).to_string().into_bytes()
}

#[test]
fn decodes_native_hotkeys_from_private_node_response() -> anyhow::Result<()> {
    let config = decode_config(&response(&["Ctrl+Super+KeyJ"]))?;
    assert_eq!(
        config.app.shortcuts[0].keys.mods,
        Modifiers::CONTROL | Modifiers::SUPER
    );
    assert_eq!(config.app.shortcuts[0].keys.key, Code::KeyJ);
    assert_eq!(config.app.shortcuts[0].target_language, "Japanese");
    assert!(config.created_files);
    assert_eq!(
        config.directory,
        PathBuf::from("/synthetic/config/glossshift")
    );
    Ok(())
}

#[test]
fn rejects_invalid_and_canonically_duplicate_native_hotkeys() {
    assert!(decode_config(&response(&["not-a-key"])).is_err());
    assert!(decode_config(&response(&["Ctrl+Super+KeyJ", "Super+Control+KeyJ"])).is_err());
}

#[test]
fn rejects_malformed_or_incomplete_private_responses() {
    for source in [b"not json".as_slice(), b"{}", b"{\"shortcuts\":[]}"] {
        assert!(decode_config(source).is_err());
    }
}
