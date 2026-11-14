//! Locate application-owned Node assets. No model or translation policy lives here.

use std::path::{Path, PathBuf};

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
        command: "node".into(),
        entry: development
            .join("node/main.ts")
            .to_string_lossy()
            .into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
