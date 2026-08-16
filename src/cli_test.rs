use std::{
    fs,
    os::unix::fs::symlink,
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use clap::Parser as _;

use super::cli::{
    Cli, OutputIdentityGuard, ensure_safe_output_paths, highlight_markdown, target_path,
};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

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
fn rejects_a_dangling_output_symlink() {
    // Given
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|error| panic!("system clock is before the Unix epoch: {error}"))
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "glossshift-{}-{nonce}-{}",
        process::id(),
        NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&directory)
        .unwrap_or_else(|error| panic!("failed to create test directory: {error}"));
    let input = directory.join("guide.md");
    let output = directory.join("guide.ja.md");
    symlink(directory.join("missing.md"), &output)
        .unwrap_or_else(|error| panic!("failed to create output symlink: {error}"));

    // When
    let result = ensure_safe_output_paths([input.as_path()], [output.as_path()]);
    fs::remove_dir_all(&directory)
        .unwrap_or_else(|error| panic!("failed to remove test directory: {error}"));

    // Then
    assert!(result.is_err());
}

#[test]
fn rejects_an_output_hard_linked_to_an_input() {
    // Given
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|error| panic!("system clock is before the Unix epoch: {error}"))
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "glossshift-{}-{nonce}-{}",
        process::id(),
        NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&directory)
        .unwrap_or_else(|error| panic!("failed to create test directory: {error}"));
    let input = directory.join("guide.md");
    let output = directory.join("guide.ja.md");
    fs::write(&input, "# ORIGINAL\n")
        .unwrap_or_else(|error| panic!("failed to write test input: {error}"));
    fs::hard_link(&input, &output)
        .unwrap_or_else(|error| panic!("failed to create output hard link: {error}"));

    // When
    let result = ensure_safe_output_paths([input.as_path()], [output.as_path()]);
    fs::remove_dir_all(&directory)
        .unwrap_or_else(|error| panic!("failed to remove test directory: {error}"));

    // Then
    assert!(result.is_err());
}

#[test]
fn rejects_a_hard_link_substituted_after_preflight() {
    // Given
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|error| panic!("system clock is before the Unix epoch: {error}"))
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "glossshift-{}-{nonce}-{}",
        process::id(),
        NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&directory)
        .unwrap_or_else(|error| panic!("failed to create test directory: {error}"));
    let input = directory.join("guide.md");
    let output = directory.join("guide.ja.md");
    fs::write(&input, "# ORIGINAL\n")
        .unwrap_or_else(|error| panic!("failed to write test input: {error}"));
    let mut guard = OutputIdentityGuard::new([input.as_path()])
        .unwrap_or_else(|error| panic!("failed to snapshot input identities: {error}"));
    ensure_safe_output_paths([input.as_path()], [output.as_path()])
        .unwrap_or_else(|error| panic!("output should be safe before substitution: {error}"));
    fs::hard_link(&input, &output)
        .unwrap_or_else(|error| panic!("failed to substitute output hard link: {error}"));
    let opened = fs::OpenOptions::new()
        .write(true)
        .open(&output)
        .unwrap_or_else(|error| panic!("failed to open substituted output: {error}"));

    // When
    let result = guard.validate_and_remember(&opened, &output);
    let preserved = fs::read_to_string(&input)
        .unwrap_or_else(|error| panic!("failed to read preserved input: {error}"));
    fs::remove_dir_all(&directory)
        .unwrap_or_else(|error| panic!("failed to remove test directory: {error}"));

    // Then
    assert!(result.is_err());
    assert_eq!(preserved, "# ORIGINAL\n");
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
