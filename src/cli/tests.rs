use std::path::{Path, PathBuf};

use clap::Parser as _;

use super::{Cli, ensure_safe_output_paths, highlight_markdown, target_path};

#[test]
fn accepts_multiple_files_in_input_order() {
    // Given / When
    let cli = Cli::try_parse_from([
        "gshift",
        "docs/first.md",
        "docs/second.md",
        "--lang",
        "ja",
        "--stdout",
    ])
    .unwrap_or_else(|error| panic!("failed to parse multiple files: {error}"));

    // Then
    assert_eq!(
        cli.files,
        [
            PathBuf::from("docs/first.md"),
            PathBuf::from("docs/second.md")
        ]
    );
}

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
fn rejects_inputs_that_resolve_to_the_same_output_path() {
    // Given
    let inputs = [PathBuf::from("guide.md"), PathBuf::from("./guide.en.md")];
    let outputs = [
        target_path(&inputs[0], "ja")
            .unwrap_or_else(|error| panic!("failed to resolve first output path: {error}")),
        target_path(&inputs[1], "ja")
            .unwrap_or_else(|error| panic!("failed to resolve second output path: {error}")),
    ];

    // When
    let result = ensure_safe_output_paths(
        inputs.iter().map(PathBuf::as_path),
        outputs.iter().map(PathBuf::as_path),
    );

    // Then
    assert!(result.is_err());
}

#[test]
fn rejects_an_output_path_that_is_also_an_input_path() {
    // Given
    let inputs = [PathBuf::from("guide.md"), PathBuf::from("./guide.fr.md")];
    let outputs = inputs
        .iter()
        .map(|input| {
            target_path(input, "fr")
                .unwrap_or_else(|error| panic!("failed to resolve output path: {error}"))
        })
        .collect::<Vec<_>>();

    // When
    let result = ensure_safe_output_paths(
        inputs.iter().map(PathBuf::as_path),
        outputs.iter().map(PathBuf::as_path),
    );

    // Then
    assert!(result.is_err());
}

#[test]
fn rejects_output_paths_that_differ_only_by_case() {
    // Given
    let inputs = [PathBuf::from("guide.md"), PathBuf::from("GUIDE.en.md")];
    let outputs = inputs
        .iter()
        .map(|input| {
            target_path(input, "ja")
                .unwrap_or_else(|error| panic!("failed to resolve output path: {error}"))
        })
        .collect::<Vec<_>>();

    // When
    let result = ensure_safe_output_paths(
        inputs.iter().map(PathBuf::as_path),
        outputs.iter().map(PathBuf::as_path),
    );

    // Then
    assert!(result.is_err());
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
