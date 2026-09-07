//! Explicit, next-login-only registration. This module never calls launch services.
use std::{
    collections::BTreeMap,
    fs,
    io::ErrorKind,
    os::unix::fs::{DirBuilderExt as _, MetadataExt as _, PermissionsExt as _},
    path::{Path, PathBuf},
};

use anyhow::{Context as _, ensure};
use serde::{Deserialize, Serialize};

const IDENTIFIER: &str = "com.totto2727.glossshift";
const FILE_NAME: &str = "com.totto2727.glossshift.plist";

#[derive(clap::Subcommand)]
pub enum AutostartCommand {
    /// Configure startup at the next login, without launching the application now.
    Enable {
        #[arg(long)]
        app: PathBuf,
    },
    /// Remove configured startup without quitting the running application.
    Disable,
    /// Inspect configuration, not effective macOS authorization or process state.
    Status,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
struct Agent {
    label: String,
    program_arguments: Vec<String>,
    run_at_load: bool,
    limit_load_to_session_type: String,
    associated_bundle_identifiers: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    environment_variables: BTreeMap<String, String>,
}

impl Agent {
    fn new(app: &Path, xdg: Option<&Path>) -> anyhow::Result<Self> {
        let mut environment_variables = BTreeMap::new();
        if let Some(path) = xdg {
            environment_variables.insert("XDG_CONFIG_HOME".into(), absolute_text(path)?.into());
        }
        Ok(Self {
            label: IDENTIFIER.into(),
            program_arguments: vec![
                "/usr/bin/open".into(),
                "-g".into(),
                absolute_text(app)?.into(),
                "--args".into(),
                "--background".into(),
            ],
            run_at_load: true,
            limit_load_to_session_type: "Aqua".into(),
            associated_bundle_identifiers: vec![IDENTIFIER.into()],
            environment_variables,
        })
    }

    fn app(&self) -> anyhow::Result<&Path> {
        let app = Path::new(
            self.program_arguments
                .get(2)
                .context("missing bundle argument")?,
        );
        let xdg = self
            .environment_variables
            .get("XDG_CONFIG_HOME")
            .map(Path::new);
        ensure!(
            *self == Self::new(app, xdg)?,
            "refusing unrelated or modified autostart plist"
        );
        Ok(app)
    }
}

#[derive(Deserialize)]
struct Bundle {
    #[serde(rename = "CFBundleIdentifier")]
    identifier: String,
    #[serde(rename = "CFBundleExecutable")]
    executable: String,
}

fn absolute_text(path: &Path) -> anyhow::Result<&str> {
    ensure!(
        path.is_absolute(),
        "path must be absolute: {}",
        path.display()
    );
    let text = path.to_str().context("path must contain valid Unicode")?;
    ensure!(
        !text.chars().any(char::is_control),
        "path contains control characters"
    );
    Ok(text)
}

fn validate_app(app: &Path) -> anyhow::Result<()> {
    absolute_text(app)?;
    ensure!(
        app.extension().is_some_and(|extension| extension == "app") && app.is_dir(),
        "expected an existing .app directory: {}",
        app.display()
    );
    let bundle: Bundle = plist::from_file(app.join("Contents/Info.plist"))
        .context("invalid application Info.plist")?;
    ensure!(
        bundle.identifier == IDENTIFIER && bundle.executable == "glossshift",
        "bundle identity does not match GlossShift"
    );
    let executable =
        fs::metadata(app.join("Contents/MacOS/glossshift")).context("missing bundle executable")?;
    ensure!(
        executable.is_file() && executable.permissions().mode() & 0o111 != 0,
        "bundle executable must be an executable file"
    );
    Ok(())
}

struct Registration {
    directory: PathBuf,
    owner: u32,
}

impl Registration {
    fn new(home: &Path) -> anyhow::Result<Self> {
        absolute_text(home)?;
        let metadata = fs::metadata(home).context("cannot inspect HOME")?;
        ensure!(metadata.is_dir(), "HOME must be a directory");
        Ok(Self {
            directory: home.join("Library/LaunchAgents"),
            owner: metadata.uid(),
        })
    }

    fn check_directories(&self, create: bool) -> anyhow::Result<()> {
        let library = self
            .directory
            .parent()
            .context("invalid LaunchAgents directory")?;
        for directory in [library, self.directory.as_path()] {
            match fs::symlink_metadata(directory) {
                Ok(metadata) => ensure!(
                    metadata.is_dir()
                        && metadata.uid() == self.owner
                        && metadata.permissions().mode() & 0o022 == 0,
                    "unsafe registration directory: {}",
                    directory.display()
                ),
                Err(error) if error.kind() == ErrorKind::NotFound => {
                    if create {
                        fs::DirBuilder::new().mode(0o700).create(directory)?;
                    }
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    fn read(&self) -> anyhow::Result<Option<Agent>> {
        self.check_directories(false)?;
        let path = self.directory.join(FILE_NAME);
        match fs::symlink_metadata(&path) {
            Ok(metadata) => ensure!(
                metadata.is_file()
                    && metadata.uid() == self.owner
                    && metadata.permissions().mode() & 0o022 == 0,
                "refusing unsafe autostart file: {}",
                path.display()
            ),
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }
        let agent: Agent =
            plist::from_file(&path).context("invalid or unrelated autostart plist")?;
        agent.app()?;
        Ok(Some(agent))
    }

    fn enable(&self, app: &Path, xdg: Option<&Path>) -> anyhow::Result<()> {
        validate_app(app)?;
        let agent = Agent::new(app, xdg)?;
        self.read()?;
        self.check_directories(true)?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
        plist::to_writer_xml(&mut temporary, &agent)?;
        temporary.as_file().sync_all()?;
        // Recheck ownership before replacement. The rename never follows a destination symlink.
        let existing = self.read()?.is_some();
        let destination = self.directory.join(FILE_NAME);
        if existing {
            temporary.persist(destination)?;
        } else {
            temporary.persist_noclobber(destination)?;
        }
        Ok(())
    }

    fn disable(&self) -> anyhow::Result<()> {
        if self.read()?.is_some() {
            fs::remove_file(self.directory.join(FILE_NAME))?;
        }
        Ok(())
    }
}

pub fn run(command: AutostartCommand) -> anyhow::Result<()> {
    let home = std::env::var_os("HOME").context("HOME is required for autostart management")?;
    let registration = Registration::new(Path::new(&home))?;
    match command {
        AutostartCommand::Enable { app } => {
            let xdg = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from);
            registration.enable(&app, xdg.as_deref())?;
            println!("Autostart configured for next login: {}", app.display());
            println!("No application was launched. macOS may require background-item approval.");
        }
        AutostartCommand::Disable => {
            registration.disable()?;
            println!(
                "Autostart not configured for next login. Any running application is unchanged."
            );
        }
        AutostartCommand::Status => match registration.read()? {
            Some(agent) => {
                let app = agent.app()?;
                validate_app(app).context("autostart is configured but its bundle is invalid")?;
                println!("Autostart configured for next login: {}", app.display());
                println!(
                    "Configuration only. macOS authorization and running state are not checked."
                );
            }
            None => println!("Autostart not configured for next login."),
        },
    }
    Ok(())
}

#[cfg(test)]
#[path = "autostart_test.rs"]
mod tests;
