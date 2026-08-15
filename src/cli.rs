use std::path::{Path, PathBuf};

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
    about = "Translate a Markdown file with GlossShift's configured provider"
)]
pub struct Cli {
    /// Markdown file to translate.
    pub file: PathBuf,

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
mod tests {
    use std::path::Path;

    use super::{highlight_markdown, target_path};

    #[test]
    fn inserts_language_before_markdown_extension() {
        // Given
        let input = Path::new("docs/guide.md");

        // When
        let output = target_path(input, "ja")
            .unwrap_or_else(|error| panic!("failed to resolve output path: {error}"));

        // Then
        assert_eq!(output, Path::new("docs/guide.ja.md"));
    }

    #[test]
    fn preserves_moonbit_markdown_compound_extension() {
        // Given
        let input = Path::new("docs/guide.mbt.md");

        // When
        let output = target_path(input, "ja")
            .unwrap_or_else(|error| panic!("failed to resolve output path: {error}"));

        // Then
        assert_eq!(output, Path::new("docs/guide.ja.mbt.md"));
    }

    #[test]
    fn replaces_existing_language_segment() {
        // Given
        let input = Path::new("docs/guide.en.mbt.md");

        // When
        let output = target_path(input, "ja")
            .unwrap_or_else(|error| panic!("failed to resolve output path: {error}"));

        // Then
        assert_eq!(output, Path::new("docs/guide.ja.mbt.md"));
    }

    #[test]
    fn highlights_markdown_without_changing_source_text() {
        // Given
        let source = "# Heading\n\n- item\n";

        // When
        let highlighted = highlight_markdown(source)
            .unwrap_or_else(|error| panic!("failed to highlight markdown: {error}"));

        // Then
        assert!(highlighted.contains("\u{1b}["));
        let plain = highlighted
            .replace("\u{1b}[0m", "")
            .replace("\u{1b}[1;36m", "")
            .replace("\u{1b}[2;37m", "");
        assert_eq!(plain, source);
    }
}
