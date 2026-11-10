//! Parse app launch flags only in the packaged runner, never NSH's dev host.

use clap::Parser as _;
use std::path::Path;

#[derive(clap::Parser)]
#[command(
    version,
    about = "GlossShift translation popup",
    args_conflicts_with_subcommands = true
)]
struct Arguments {
    #[arg(long)]
    background: bool,
    #[arg(long = "fps")]
    _fps: bool,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(clap::Subcommand)]
enum Command {
    Autostart {
        #[command(subcommand)]
        command: crate::autostart::AutostartCommand,
    },
}

fn packaged(executable: &Path) -> bool {
    executable.parent().is_some_and(|directory| {
        directory.file_name().is_some_and(|name| name == "MacOS")
            && directory.parent().is_some_and(|contents| {
                contents.file_name().is_some_and(|name| name == "Contents")
                    && contents.parent().is_some_and(|bundle| {
                        bundle
                            .extension()
                            .is_some_and(|extension| extension == "app")
                    })
            })
    })
}

/// `None` means a configuration/help command completed without opening a window.
pub fn configure() -> Result<Option<bool>, String> {
    let executable = std::env::current_exe()
        .and_then(|path| path.canonicalize())
        .map_err(|error| error.to_string())?;
    if !packaged(&executable) {
        return Ok(Some(false));
    }
    let arguments = match Arguments::try_parse() {
        Ok(arguments) => arguments,
        Err(error) if error.exit_code() == 0 => {
            error.print().map_err(|error| error.to_string())?;
            return Ok(None);
        }
        Err(error) => return Err(error.to_string()),
    };
    if let Some(Command::Autostart { command }) = arguments.command {
        crate::autostart::run(command).map_err(|error| format!("{error:#}"))?;
        return Ok(None);
    }
    Ok(Some(arguments.background))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn development_host_arguments_are_not_app_flags() {
        assert!(!packaged(Path::new(
            "/project/.nsh/target/debug/app-glossshift-macos-host"
        )));
        assert!(!packaged(Path::new("/project/target/debug/glossshift")));
        assert!(packaged(Path::new(
            "/Applications/GlossShift.app/Contents/MacOS/glossshift"
        )));
    }
    #[test]
    fn packaged_flags_reject_unknown_and_conflicting_commands() {
        for arguments in [
            vec!["glossshift", "--unknown"],
            vec!["glossshift", "--background", "autostart", "status"],
            vec!["glossshift", "autostart", "unknown"],
        ] {
            assert!(Arguments::try_parse_from(arguments).is_err());
        }
        assert!(Arguments::try_parse_from(["glossshift", "--background"]).is_ok());
        assert!(Arguments::try_parse_from(["glossshift", "autostart", "status"]).is_ok());
    }
    #[test]
    fn installed_symlink_resolves_to_packaged_runner() -> anyhow::Result<()> {
        let directory = tempfile::TempDir::new()?;
        let executable = directory
            .path()
            .join("GlossShift.app/Contents/MacOS/GlossShift");
        std::fs::create_dir_all(
            executable
                .parent()
                .ok_or_else(|| anyhow::anyhow!("missing executable directory"))?,
        )?;
        std::fs::write(&executable, "synthetic executable, never run")?;
        let link = directory.path().join("glossshift");
        std::os::unix::fs::symlink(&executable, &link)?;
        assert!(packaged(&link.canonicalize()?));
        Ok(())
    }

    #[test]
    fn packaged_help_and_version_complete_successfully() {
        for flag in ["--help", "--version"] {
            let error = Arguments::try_parse_from(["glossshift", flag])
                .err()
                .unwrap_or_else(|| panic!("expected display response"));
            assert_eq!(error.exit_code(), 0);
        }
    }
}
