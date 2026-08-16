use std::{
    fs,
    io::{Read, Write as _},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{self, Command, Output},
    sync::atomic::{AtomicU64, Ordering},
    thread,
};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    root: PathBuf,
    listener: Option<TcpListener>,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "glossshift-{name}-{}-{}",
            process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root)
            .unwrap_or_else(|error| panic!("failed to create test directory: {error}"));
        let listener = TcpListener::bind("127.0.0.1:0")
            .unwrap_or_else(|error| panic!("failed to bind mock provider: {error}"));
        let address = listener
            .local_addr()
            .unwrap_or_else(|error| panic!("failed to read mock provider address: {error}"));
        let config_directory = root.join("config/glossshift");
        fs::create_dir_all(&config_directory)
            .unwrap_or_else(|error| panic!("failed to create test config directory: {error}"));
        let config = glossshift::config::DEFAULT_CONFIG
            .replace("https://api.openai.com/v1", &format!("http://{address}/v1"))
            .replace("gpt-4.1-mini", "mock-model");
        fs::write(config_directory.join("config.toml"), config)
            .unwrap_or_else(|error| panic!("failed to write test config: {error}"));
        fs::write(
            config_directory.join("credentials.toml"),
            "[credentials.default]\napi_key = \"test-key\"\n",
        )
        .unwrap_or_else(|error| panic!("failed to write test credentials: {error}"));
        Self {
            root,
            listener: Some(listener),
        }
    }

    fn input(&self, name: &str, content: &str) -> PathBuf {
        let path = self.root.join(name);
        fs::write(&path, content)
            .unwrap_or_else(|error| panic!("failed to write test input: {error}"));
        path
    }

    fn run(&mut self, inputs: &[&Path], stdout: bool, translations: &[&str]) -> Output {
        let listener = self
            .listener
            .take()
            .unwrap_or_else(|| panic!("mock provider was already started"));
        let translations = translations
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        let server = thread::spawn(move || serve(&listener, &translations));
        let mut command = self.command(inputs);
        command.args(["--lang", "ja"]);
        if stdout {
            command.args(["--stdout", "--color", "never"]);
        }
        let output = command
            .output()
            .unwrap_or_else(|error| panic!("failed to run gshift: {error}"));
        server
            .join()
            .unwrap_or_else(|error| panic!("mock provider failed: {error:?}"));
        output
    }

    fn command(&self, inputs: &[&Path]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_gshift"));
        command
            .current_dir(&self.root)
            .env("XDG_CONFIG_HOME", self.root.join("config"));
        for input in inputs {
            command.arg(input);
        }
        command
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.root) {
            eprintln!("failed to remove test directory: {error}");
        }
    }
}

fn serve(listener: &TcpListener, translations: &[String]) {
    for translation in translations {
        let (mut stream, _) = listener
            .accept()
            .unwrap_or_else(|error| panic!("failed to accept provider request: {error}"));
        read_request(&mut stream);
        let event = format!(
            "data: {{\"id\":\"mock\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"mock-model\",\"choices\":[{{\"index\":0,\"delta\":{{\"content\":{}}},\"finish_reason\":null}}]}}\n\ndata: [DONE]\n\n",
            serde_json::to_string(translation)
                .unwrap_or_else(|error| panic!("failed to encode translation: {error}"))
        );
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{event}",
            event.len()
        )
        .unwrap_or_else(|error| panic!("failed to write provider response: {error}"));
    }
}

fn read_request(stream: &mut impl Read) {
    let mut buffer = [0_u8; 8192];
    let read = stream
        .read(&mut buffer)
        .unwrap_or_else(|error| panic!("failed to read provider request: {error}"));
    assert!(buffer[..read].windows(4).any(|bytes| bytes == b"\r\n\r\n"));
}

#[test]
fn writes_multiple_translations_to_stdout_in_input_order() {
    // Given
    let mut fixture = Fixture::new("stdout-order");
    let first = fixture.input("first.md", "# FIRST\n");
    let second = fixture.input("second.md", "# SECOND\n");

    // When
    let output = fixture.run(
        &[first.as_path(), second.as_path()],
        true,
        &["FIRST-TRANSLATED", "SECOND-TRANSLATED"],
    );

    // Then
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.stdout, b"FIRST-TRANSLATEDSECOND-TRANSLATED");
    assert!(output.stderr.is_empty());
}

#[test]
fn writes_a_sibling_output_for_each_input() {
    // Given
    let mut fixture = Fixture::new("sibling-outputs");
    let first = fixture.input("first.md", "# FIRST\n");
    let second = fixture.input("second.md", "# SECOND\n");

    // When
    let output = fixture.run(
        &[first.as_path(), second.as_path()],
        false,
        &["FIRST-TRANSLATED", "SECOND-TRANSLATED"],
    );

    // Then
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
    assert_eq!(
        fs::read_to_string(fixture.root.join("first.ja.md"))
            .unwrap_or_else(|error| panic!("failed to read first output: {error}")),
        "FIRST-TRANSLATED"
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("second.ja.md"))
            .unwrap_or_else(|error| panic!("failed to read second output: {error}")),
        "SECOND-TRANSLATED"
    );
}

#[test]
fn rejects_an_output_that_would_overwrite_a_later_input() {
    // Given
    let fixture = Fixture::new("input-output-collision");
    let first = fixture.input("guide.md", "# FIRST\n");
    let second_source = "# SECOND\n";
    let second = fixture.input("guide.fr.md", second_source);

    // When
    let output = fixture
        .command(&[first.as_path(), second.as_path()])
        .args(["--lang", "fr", "--force"])
        .output()
        .unwrap_or_else(|error| panic!("failed to run gshift: {error}"));

    // Then
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("is also an input file"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fs::read_to_string(second)
            .unwrap_or_else(|error| panic!("failed to read preserved input: {error}")),
        second_source
    );
    assert!(!fixture.root.join("guide.fr.fr.md").exists());
}
