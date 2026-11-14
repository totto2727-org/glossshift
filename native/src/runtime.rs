//! Locate application-owned Node assets. No model or translation policy lives here.

use std::{
    ffi::OsStr,
    os::unix::fs::PermissionsExt as _,
    path::{Path, PathBuf},
};

use serde::Deserialize;

use crate::bridge_types::RuntimeSettings;

#[derive(Deserialize)]
struct InstalledRuntime {
    command: String,
    entry: String,
}

pub fn locate() -> Result<RuntimeSettings, String> {
    let executable =
        std::env::current_exe().map_err(|_| "Unable to locate the application runtime.")?;
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("Unable to locate development assets.")?;
    locate_at(&executable, development)
}

fn manifest_path(executable: &Path) -> Result<Option<PathBuf>, String> {
    let parent = executable
        .parent()
        .ok_or("Application runtime has no directory.")?;
    if parent.file_name().is_some_and(|name| name == "MacOS") {
        let contents = parent
            .parent()
            .ok_or("Application resources are unavailable.")?;
        return Ok(Some(contents.join("Resources/glossshift/runtime.json")));
    }
    let sibling = parent.join("runtime.json");
    Ok(sibling.exists().then_some(sibling))
}

fn locate_at(executable: &Path, development: &Path) -> Result<RuntimeSettings, String> {
    if let Some(manifest) = manifest_path(executable)? {
        let contents = std::fs::read_to_string(manifest)
            .map_err(|_| "The installed local translation runtime is missing.")?;
        let installed: InstalledRuntime = serde_json::from_str(&contents)
            .map_err(|_| "The installed local translation runtime is invalid.")?;
        if !Path::new(&installed.command).is_absolute()
            || !Path::new(&installed.entry).is_absolute()
        {
            return Err("The installed local translation runtime must use absolute paths.".into());
        }
        return Ok(RuntimeSettings {
            command: installed.command,
            entry: installed.entry,
        });
    }
    Ok(RuntimeSettings {
        command: development_node(std::env::var_os("PATH").as_deref())?,
        entry: development
            .join("node/main.ts")
            .to_string_lossy()
            .into_owned(),
    })
}

fn development_node(search: Option<&OsStr>) -> Result<String, String> {
    let search = search.ok_or("Unable to locate the development Node runtime.")?;
    for directory in std::env::split_paths(search) {
        if !directory.is_absolute() {
            continue;
        }
        let candidate = directory.join("node");
        if std::fs::metadata(&candidate)
            .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        {
            // Preserve argv[0]-sensitive shims. Canonicalizing a Vite+ Node shim runs the wrong command.
            return candidate
                .to_str()
                .map(str::to_owned)
                .ok_or_else(|| "The development Node path must contain valid Unicode.".into());
        }
    }
    Err("Unable to locate the development Node runtime.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_node_is_absolute_and_preserves_executable_shims() -> anyhow::Result<()> {
        let directory = tempfile::TempDir::new()?;
        let executable = directory.path().join("actual-runtime");
        std::fs::write(&executable, "synthetic runtime, never execute")?;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755))?;
        let shim = directory.path().join("node");
        std::os::unix::fs::symlink(executable, &shim)?;
        assert_eq!(
            development_node(Some(directory.path().as_os_str())).map_err(anyhow::Error::msg)?,
            shim.to_string_lossy()
        );
        assert!(development_node(Some(OsStr::new("relative/path"))).is_err());
        assert!(development_node(None).is_err());
        Ok(())
    }

    #[test]
    fn installed_bundle_uses_its_manifest_not_the_launch_directory() -> anyhow::Result<()> {
        let directory = tempfile::TempDir::new()?;
        let executable = directory
            .path()
            .join("GlossShift.app/Contents/MacOS/GlossShift");
        let resources = directory
            .path()
            .join("GlossShift.app/Contents/Resources/glossshift");
        std::fs::create_dir_all(&resources)?;
        std::fs::write(
            resources.join("runtime.json"),
            r#"{"command":"/immutable/bin/node","entry":"/immutable/glossshift/node/main.ts"}"#,
        )?;
        let runtime =
            locate_at(&executable, Path::new("/wrong/development")).map_err(anyhow::Error::msg)?;
        assert_eq!(runtime.command, "/immutable/bin/node");
        assert_eq!(runtime.entry, "/immutable/glossshift/node/main.ts");
        Ok(())
    }

    #[test]
    fn missing_packaged_runtime_never_falls_back_to_a_development_checkout() -> anyhow::Result<()> {
        let directory = tempfile::TempDir::new()?;
        let executable = directory
            .path()
            .join("GlossShift.app/Contents/MacOS/GlossShift");
        assert!(locate_at(&executable, directory.path()).is_err());
        Ok(())
    }

    #[test]
    fn installed_terminal_uses_its_sibling_manifest() -> anyhow::Result<()> {
        let directory = tempfile::TempDir::new()?;
        std::fs::write(
            directory.path().join("runtime.json"),
            r#"{"command":"/immutable/node","entry":"/immutable/main.ts"}"#,
        )?;
        let runtime = locate_at(
            &directory.path().join("gshift-tui-host"),
            Path::new("/wrong"),
        )
        .map_err(anyhow::Error::msg)?;
        assert_eq!(runtime.command, "/immutable/node");
        Ok(())
    }
}
