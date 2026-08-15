use std::{
    fs::{self, OpenOptions},
    io::{IsTerminal as _, Write as _},
};

use anyhow::{Context as _, bail};
use clap::Parser as _;
use tokio_util::sync::CancellationToken;
use translate_popup::{
    cli::{Cli, highlight_markdown, normalize_language, target_path},
    config,
    llm::{RequestId, TranslationEvent, TranslationRequest},
};

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    if let Err(error) = run(Cli::parse()).await {
        eprintln!("translate-popup-cli failed: {error:#}");
        std::process::exit(1);
    }
}

async fn run(cli: Cli) -> anyhow::Result<()> {
    let language = normalize_language(&cli.lang)?;
    let output_path = (!cli.stdout)
        .then(|| target_path(&cli.file, &language))
        .transpose()?;
    if let Some(path) = &output_path
        && path.exists()
        && !cli.force
    {
        bail!(
            "output file '{}' already exists; pass --force to overwrite it",
            path.display()
        );
    }
    let source = fs::read_to_string(&cli.file)
        .with_context(|| format!("failed to read {}", cli.file.display()))?;
    let loaded = config::load_or_initialize()?;
    if loaded.api_key.trim().is_empty() || loaded.api_key == "replace-me" {
        bail!(
            "set api_key in {}/credentials.toml before translating",
            loaded.directory.display()
        );
    }
    let request = TranslationRequest {
        id: RequestId(1),
        provider: loaded.app.provider()?.clone(),
        api_key: loaded.api_key,
        source_language: loaded.app.translation.source_language,
        target_language: language,
        text: source,
    };
    let color = cli.color.enabled(std::io::stdout().is_terminal());
    let (event_tx, event_rx) = async_channel::bounded(256);
    let translation = tokio::spawn(translate_popup::llm::translate(
        request,
        event_tx,
        CancellationToken::new(),
    ));
    let mut translated = String::new();
    let mut stdout = std::io::stdout().lock();
    while let Ok(event) = event_rx.recv().await {
        match event {
            TranslationEvent::Delta { text, .. } => {
                if cli.stdout && !color {
                    stdout
                        .write_all(text.as_bytes())
                        .context("failed to write translation to stdout")?;
                    stdout.flush().context("failed to flush stdout")?;
                } else {
                    translated.push_str(&text);
                }
            }
            TranslationEvent::Started { .. } | TranslationEvent::Finished { .. } => {}
            TranslationEvent::Failed { message, .. } => bail!(message),
        }
    }
    translation
        .await
        .context("translation task failed")?
        .context("translation failed")?;

    if cli.stdout {
        if color {
            stdout
                .write_all(highlight_markdown(&translated)?.as_bytes())
                .context("failed to write highlighted translation to stdout")?;
            stdout.flush().context("failed to flush stdout")?;
        }
        return Ok(());
    }

    let output_path = output_path.context("output path is unavailable")?;
    let mut options = OpenOptions::new();
    options.write(true);
    if cli.force {
        options.create(true).truncate(true);
    } else {
        options.create_new(true);
    }
    let mut output = options
        .open(&output_path)
        .with_context(|| format!("failed to create {}", output_path.display()))?;
    output
        .write_all(translated.as_bytes())
        .with_context(|| format!("failed to write {}", output_path.display()))?;
    eprintln!("Written to {}", output_path.display());
    Ok(())
}
