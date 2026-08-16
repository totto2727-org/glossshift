use std::{
    collections::HashSet,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use anyhow::{Context as _, bail};
use clap::{Parser, ValueEnum};
use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

const COMPOUND_EXTENSION: &str = ".mbt.md";
const HIGHLIGHT_NAMES: [&str; 8] = [
    "none",
    "punctuation.delimiter",
    "punctuation.special",
    "string.escape",
    "text.literal",
    "text.reference",
    "text.title",
    "text.uri",
];

#[derive(Debug, Parser)]
#[command(
    name = "gshift",
    version,
    about = "Translate Markdown files with GlossShift's configured provider"
)]
pub struct Cli {
    /// Markdown files to translate in input order.
    #[arg(required = true, num_args = 1..)]
    pub files: Vec<PathBuf>,

    /// Target language code, such as ja or en.
    #[arg(short, long)]
    pub lang: String,

    /// Overwrite an existing translated file.
    #[arg(short, long, conflicts_with = "stdout")]
    pub force: bool,

    /// Write the translation to standard output instead of a sibling file.
    #[arg(long)]
    pub stdout: bool,

    /// ANSI highlighting mode for standard output.
    #[arg(long, value_enum, default_value_t, requires = "stdout")]
    pub color: ColorChoice,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
pub enum ColorChoice {
    #[default]
    Auto,
    Always,
    Never,
}

impl ColorChoice {
    #[must_use]
    pub const fn enabled(self, stdout_is_terminal: bool) -> bool {
        match self {
            Self::Auto => stdout_is_terminal,
            Self::Always => true,
            Self::Never => false,
        }
    }
}

/// Normalize a language code for prompts and generated file names.
///
/// # Errors
/// Returns an error when the value is empty or contains characters outside an ASCII language code.
pub fn normalize_language(language: &str) -> anyhow::Result<String> {
    let normalized = language.trim().to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.starts_with('-')
        || normalized.ends_with('-')
        || !normalized
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        bail!("target language must be a non-empty language code");
    }
    Ok(normalized)
}

/// Resolve the sibling Markdown path for a translated document.
///
/// # Errors
/// Returns an error when the input has no UTF-8 file name or is not a Markdown file.
pub fn target_path(input: &Path, language: &str) -> anyhow::Result<PathBuf> {
    let file_name = input
        .file_name()
        .and_then(|name| name.to_str())
        .with_context(|| format!("input path '{}' has no UTF-8 file name", input.display()))?;
    let stem = file_name
        .strip_suffix(COMPOUND_EXTENSION)
        .or_else(|| file_name.strip_suffix(".md"))
        .with_context(|| format!("input file '{}' is not Markdown", input.display()))?;
    let extension = if file_name.ends_with(COMPOUND_EXTENSION) {
        COMPOUND_EXTENSION
    } else {
        ".md"
    };
    let stem = strip_known_language(stem);
    Ok(input.with_file_name(format!("{stem}.{language}{extension}")))
}

/// Reject output paths that identify another output or an input file.
///
/// # Errors
/// Returns an error when a path cannot be resolved or an output is not distinct from every other path.
pub fn ensure_safe_output_paths<'a>(
    inputs: impl IntoIterator<Item = &'a Path>,
    outputs: impl IntoIterator<Item = &'a Path>,
) -> anyhow::Result<()> {
    let resolved_inputs = inputs
        .into_iter()
        .map(resolve_path_identity)
        .collect::<anyhow::Result<HashSet<_>>>()?;
    let mut resolved_outputs = HashSet::new();
    for path in outputs {
        reject_symbolic_link(path)?;
        let resolved = resolve_path_identity(path)?;
        if resolved_inputs.contains(&resolved) {
            bail!("output file '{}' is also an input file", path.display());
        }
        if !resolved_outputs.insert(resolved) {
            bail!(
                "multiple inputs resolve to the same output file '{}'",
                path.display()
            );
        }
    }
    Ok(())
}

fn reject_symbolic_link(path: &Path) -> anyhow::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            bail!("output path '{}' is a symbolic link", path.display());
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error)
            .with_context(|| format!("failed to inspect output path '{}'", path.display())),
    }
}

fn resolve_path_identity(path: &Path) -> anyhow::Result<PathBuf> {
    let resolved = match fs::canonicalize(path) {
        Ok(resolved) => resolved,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let parent = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            let file_name = path
                .file_name()
                .with_context(|| format!("path '{}' has no file name", path.display()))?;
            fs::canonicalize(parent)
                .with_context(|| format!("failed to resolve directory '{}'", parent.display()))?
                .join(file_name)
        }
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to resolve path '{}'", path.display()));
        }
    };
    Ok(PathBuf::from(resolved.to_string_lossy().to_lowercase()))
}

/// Convert Markdown highlight events to ANSI-styled source text.
///
/// # Errors
/// Returns an error when the Markdown highlight query or emitted byte ranges are invalid.
pub fn highlight_markdown(source: &str) -> anyhow::Result<String> {
    let mut configuration = HighlightConfiguration::new(
        tree_sitter_md::LANGUAGE.into(),
        "markdown",
        tree_sitter_md::HIGHLIGHT_QUERY_BLOCK,
        tree_sitter_md::INJECTION_QUERY_BLOCK,
        "",
    )
    .context("failed to configure Markdown highlighting")?;
    configuration.configure(&HIGHLIGHT_NAMES);

    let mut highlighter = Highlighter::new();
    let events = highlighter
        .highlight(&configuration, source.as_bytes(), None, |_| None)
        .context("failed to highlight Markdown")?;
    let mut output = String::with_capacity(source.len() + 64);
    let mut styles = Vec::new();
    for event in events {
        match event.context("failed to read a Markdown highlight")? {
            HighlightEvent::Source { start, end } => output.push_str(
                source
                    .get(start..end)
                    .context("Markdown highlighter returned an invalid byte range")?,
            ),
            HighlightEvent::HighlightStart(highlight) => {
                let style = ansi_style(highlight.0);
                styles.push(style);
                output.push_str(style);
            }
            HighlightEvent::HighlightEnd => {
                let _ = styles.pop();
                output.push_str("\u{1b}[0m");
                if let Some(style) = styles.last() {
                    output.push_str(style);
                }
            }
        }
    }
    Ok(output)
}

fn strip_known_language(stem: &str) -> &str {
    ["ja", "en"]
        .iter()
        .find_map(|language| stem.strip_suffix(&format!(".{language}")))
        .unwrap_or(stem)
}

const fn ansi_style(highlight: usize) -> &'static str {
    match highlight {
        1 | 2 => "\u{1b}[2;37m",
        3 | 4 => "\u{1b}[33m",
        5 => "\u{1b}[34m",
        6 => "\u{1b}[1;36m",
        7 => "\u{1b}[4;34m",
        _ => "",
    }
}

#[cfg(test)]
mod tests;
