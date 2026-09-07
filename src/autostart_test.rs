use super::*;
use std::os::unix::fs::symlink;

fn bundle(root: &Path, name: &str) -> anyhow::Result<PathBuf> {
    let app = root.join(name);
    fs::create_dir_all(app.join("Contents/MacOS"))?;
    fs::write(
        app.join("Contents/Info.plist"),
        include_str!("../packaging/Info.plist"),
    )?;
    let executable = app.join("Contents/MacOS/glossshift");
    fs::write(&executable, "fixture, never execute")?;
    fs::set_permissions(executable, fs::Permissions::from_mode(0o755))?;
    Ok(app)
}

#[test]
fn serialization_escapes_paths_and_captures_only_xdg() -> anyhow::Result<()> {
    let app = Path::new("/stable/日本語 & <bundle>.app");
    let xdg = Path::new("/config/a & b");
    let agent = Agent::new(app, Some(xdg))?;
    let mut bytes = Vec::new();
    plist::to_writer_xml(&mut bytes, &agent)?;
    let text = String::from_utf8(bytes.clone())?;
    assert!(text.contains("&amp;") && text.contains("&lt;"));
    assert!(!text.contains("KeepAlive"));
    let decoded: Agent = plist::from_bytes(&bytes)?;
    assert_eq!(decoded, agent);
    assert_eq!(decoded.environment_variables.len(), 1);
    assert_eq!(decoded.app()?, app);
    assert_eq!(
        decoded.program_arguments,
        [
            "/usr/bin/open",
            "-g",
            "/stable/日本語 & <bundle>.app",
            "--args",
            "--background"
        ]
    );
    Ok(())
}

#[test]
fn stable_bundle_and_executable_symlinks_are_preserved() -> anyhow::Result<()> {
    let root = tempfile::tempdir()?;
    let first = bundle(root.path(), "generation-a.app")?;
    let second = bundle(root.path(), "generation-b.app")?;
    let executable = first.join("Contents/MacOS/glossshift");
    fs::remove_file(&executable)?;
    symlink(second.join("Contents/MacOS/glossshift"), &executable)?;
    let stable = root.path().join("GlossShift.app");
    symlink(&first, &stable)?;
    let registration = Registration::new(root.path())?;
    registration.enable(&stable, None)?;
    let before = fs::read(registration.directory.join(FILE_NAME))?;
    fs::remove_file(&stable)?;
    symlink(&second, &stable)?;
    validate_app(&stable)?;
    let agent = registration.read()?.context("missing registration")?;
    assert_eq!(agent.app()?, stable);
    assert_eq!(before, fs::read(registration.directory.join(FILE_NAME))?);
    Ok(())
}

#[test]
fn enable_disable_are_idempotent_and_restrict_permissions() -> anyhow::Result<()> {
    let root = tempfile::tempdir()?;
    let app = bundle(root.path(), "GlossShift.app")?;
    let registration = Registration::new(root.path())?;
    assert!(registration.read()?.is_none());
    registration.disable()?;
    assert!(!registration.directory.exists());
    registration.enable(&app, None)?;
    registration.enable(&app, Some(Path::new("/new/config")))?;
    let path = registration.directory.join(FILE_NAME);
    assert_eq!(fs::metadata(&path)?.permissions().mode() & 0o777, 0o600);
    assert_eq!(
        registration
            .read()?
            .context("missing registration")?
            .environment_variables["XDG_CONFIG_HOME"],
        "/new/config"
    );
    // Removal must remain possible after an app is moved or uninstalled.
    fs::remove_dir_all(app)?;
    registration.disable()?;
    registration.disable()?;
    assert!(!path.exists());
    Ok(())
}

fn fixture() -> anyhow::Result<(tempfile::TempDir, PathBuf, Registration)> {
    let root = tempfile::tempdir()?;
    let app = bundle(root.path(), "GlossShift.app")?;
    let registration = Registration::new(root.path())?;
    Ok((root, app, registration))
}

#[test]
fn rejects_symlink_destination_without_modifying_target() -> anyhow::Result<()> {
    let (root, app, registration) = fixture()?;
    registration.check_directories(true)?;
    let path = registration.directory.join(FILE_NAME);
    let target = root.path().join("unrelated");
    fs::write(&target, "do not replace")?;
    symlink(&target, &path)?;
    assert!(
        matches!(registration.enable(&app, None), Err(error) if error.to_string().contains("refusing unsafe autostart file"))
    );
    assert!(
        matches!(registration.disable(), Err(error) if error.to_string().contains("refusing unsafe autostart file"))
    );
    assert!(
        matches!(registration.read(), Err(error) if error.to_string().contains("refusing unsafe autostart file"))
    );
    assert_eq!(fs::read_to_string(&target)?, "do not replace");
    Ok(())
}

#[test]
fn rejects_unrelated_destination_without_modifying_it() -> anyhow::Result<()> {
    let (_root, app, registration) = fixture()?;
    registration.check_directories(true)?;
    let path = registration.directory.join(FILE_NAME);
    fs::write(&path, "not a plist")?;
    assert!(
        matches!(registration.enable(&app, None), Err(error) if error.to_string().contains("invalid or unrelated autostart plist"))
    );
    assert!(
        matches!(registration.disable(), Err(error) if error.to_string().contains("invalid or unrelated autostart plist"))
    );
    assert_eq!(fs::read_to_string(&path)?, "not a plist");
    Ok(())
}

#[test]
fn rejects_modified_command() -> anyhow::Result<()> {
    let (_root, app, registration) = fixture()?;
    registration.enable(&app, None)?;
    let mut agent = Agent::new(&app, None)?;
    agent.program_arguments[0] = "/bin/sh".into();
    plist::to_file_xml(registration.directory.join(FILE_NAME), &agent)?;
    assert!(
        matches!(registration.disable(), Err(error) if error.to_string().contains("refusing unrelated or modified autostart plist"))
    );
    Ok(())
}

#[test]
fn rejects_unexpected_environment() -> anyhow::Result<()> {
    let (_root, app, registration) = fixture()?;
    registration.enable(&app, None)?;
    let mut agent = Agent::new(&app, None)?;
    agent
        .environment_variables
        .insert("UNEXPECTED".into(), "value".into());
    plist::to_file_xml(registration.directory.join(FILE_NAME), &agent)?;
    assert!(
        matches!(registration.read(), Err(error) if error.to_string().contains("refusing unrelated or modified autostart plist"))
    );
    Ok(())
}

#[test]
fn rejects_unknown_plist_field() -> anyhow::Result<()> {
    let (_root, app, registration) = fixture()?;
    registration.enable(&app, None)?;
    let path = registration.directory.join(FILE_NAME);
    let mut value = plist::Value::from_file(&path)?;
    value
        .as_dictionary_mut()
        .context("missing dictionary")?
        .insert("KeepAlive".into(), plist::Value::Boolean(true));
    value.to_file_xml(&path)?;
    assert!(
        matches!(registration.read(), Err(error) if error.to_string().contains("invalid or unrelated autostart plist"))
    );
    assert!(
        matches!(registration.disable(), Err(error) if error.to_string().contains("invalid or unrelated autostart plist"))
    );
    Ok(())
}

#[test]
fn rejects_unsafe_file_permissions() -> anyhow::Result<()> {
    let (_root, app, registration) = fixture()?;
    registration.enable(&app, None)?;
    fs::set_permissions(
        registration.directory.join(FILE_NAME),
        fs::Permissions::from_mode(0o666),
    )?;
    assert!(
        matches!(registration.read(), Err(error) if error.to_string().contains("refusing unsafe autostart file"))
    );
    Ok(())
}

#[test]
fn rejects_relative_bundle_without_creating_registration() -> anyhow::Result<()> {
    let (_root, _app, registration) = fixture()?;
    assert!(matches!(
        registration.enable(Path::new("relative.app"), None),
        Err(error) if error.to_string().contains("path must be absolute")
    ));
    assert!(!registration.directory.exists());
    Ok(())
}

#[test]
fn rejects_relative_xdg_without_creating_registration() -> anyhow::Result<()> {
    let (_root, app, registration) = fixture()?;
    assert!(matches!(
        registration.enable(&app, Some(Path::new("relative"))),
        Err(error) if error.to_string().contains("path must be absolute")
    ));
    assert!(!registration.directory.exists());
    Ok(())
}

#[test]
fn rejects_empty_xdg_without_creating_registration() -> anyhow::Result<()> {
    let (_root, app, registration) = fixture()?;
    assert!(matches!(
        registration.enable(&app, Some(Path::new(""))),
        Err(error) if error.to_string().contains("path must be absolute")
    ));
    assert!(!registration.directory.exists());
    Ok(())
}

#[test]
fn rejects_nonexecutable_bundle_without_creating_registration() -> anyhow::Result<()> {
    let (_root, app, registration) = fixture()?;
    fs::set_permissions(
        app.join("Contents/MacOS/glossshift"),
        fs::Permissions::from_mode(0o644),
    )?;
    assert!(
        matches!(registration.enable(&app, None), Err(error) if error.to_string().contains("bundle executable must be an executable file"))
    );
    assert!(!registration.directory.exists());
    Ok(())
}

#[test]
fn rejects_wrong_bundle_identity_without_creating_registration() -> anyhow::Result<()> {
    let (_root, app, registration) = fixture()?;
    let info = app.join("Contents/Info.plist");
    fs::write(
        &info,
        fs::read_to_string(&info)?.replace(IDENTIFIER, "com.example.other"),
    )?;
    assert!(
        matches!(registration.enable(&app, None), Err(error) if error.to_string().contains("bundle identity does not match GlossShift"))
    );
    assert!(!registration.directory.exists());
    Ok(())
}

#[test]
fn symlinked_registration_directory_is_rejected() -> anyhow::Result<()> {
    let root = tempfile::tempdir()?;
    let outside = tempfile::tempdir()?;
    symlink(outside.path(), root.path().join("Library"))?;
    let registration = Registration::new(root.path())?;
    assert!(
        matches!(registration.read(), Err(error) if error.to_string().contains("unsafe registration directory"))
    );
    assert!(
        matches!(registration.disable(), Err(error) if error.to_string().contains("unsafe registration directory"))
    );
    assert!(!outside.path().join("LaunchAgents").exists());
    Ok(())
}
