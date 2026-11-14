//! Native launch flag parsing with filesystem management delegated to Node.
use std::{path::PathBuf, process::Command};

use anyhow::{Context as _, ensure};

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

pub fn run(command: AutostartCommand) -> anyhow::Result<()> {
    let runtime = crate::runtime::locate().map_err(anyhow::Error::msg)?;
    let mut child = Command::new(runtime.command);
    child.arg(runtime.entry).arg("--autostart").env_clear();
    for key in ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"] {
        if let Some(value) = std::env::var_os(key) {
            child.env(
                key,
                value
                    .to_str()
                    .context("runtime paths must contain valid Unicode")?,
            );
        }
    }
    match command {
        AutostartCommand::Enable { app } => {
            child
                .arg("enable")
                .arg("--app")
                .arg(app.to_str().context("path must contain valid Unicode")?);
        }
        AutostartCommand::Disable => {
            child.arg("disable");
        }
        AutostartCommand::Status => {
            child.arg("status");
        }
    }
    let status = child
        .status()
        .context("Unable to start autostart management runtime")?;
    ensure!(status.success(), "Autostart management failed");
    Ok(())
}
