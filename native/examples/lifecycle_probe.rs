//! Exercises the real `AppKit` host without accessing other apps or credentials.

use std::{
    process::ExitCode,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

use nsh_core::prelude::*;
use nsh_platform_macos::{
    AppOptions, AppSource, Root, StandaloneHooks, hide_app, quit_app, run_app,
    set_standalone_hooks, show_app,
};
use objc2::MainThreadMarker;
use objc2_app_kit::NSApplication;

const TITLE: &str = "GlossShift lifecycle verification";
static ENGINE_STARTED: AtomicBool = AtomicBool::new(false);
static SETUPS: AtomicUsize = AtomicUsize::new(0);
static SHUTDOWNS: AtomicUsize = AtomicUsize::new(0);
static RESULT: Mutex<Option<Result<(), String>>> = Mutex::new(None);

#[component]
fn Probe() -> impl IntoElement {
    ENGINE_STARTED.store(true, Ordering::SeqCst);
    view().child(text("Lifecycle verification"))
}

fn setup(options: &mut AppOptions) -> Result<bool, String> {
    if SETUPS.fetch_add(1, Ordering::SeqCst) != 0 {
        return Err("setup ran more than once".into());
    }
    options.initially_hidden = true;
    options.keep_alive_on_close = true;
    options.min_size = Some((320, 180));
    thread::spawn(|| {
        let result = exercise();
        if let Ok(mut saved) = RESULT.lock() {
            *saved = Some(result);
        }
        quit_app();
    });
    Ok(true)
}

fn shutdown() {
    SHUTDOWNS.fetch_add(1, Ordering::SeqCst);
}

#[derive(Debug)]
struct Snapshot {
    visible: bool,
    active: bool,
    policy: objc2_app_kit::NSApplicationActivationPolicy,
    identity: usize,
    minimum: (f64, f64),
}

fn inspect(close: bool) -> Result<Snapshot, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    dispatch2::DispatchQueue::main().exec_async(move || {
        let result = MainThreadMarker::new()
            .ok_or_else(|| "not on the AppKit main thread".to_owned())
            .and_then(|mtm| {
                let app = NSApplication::sharedApplication(mtm);
                let windows = app.windows();
                let window = windows
                    .iter()
                    .find(|window| window.title().to_string() == TITLE)
                    .ok_or_else(|| "standalone window was not retained".to_owned())?;
                if close {
                    window.performClose(None);
                }
                let minimum = window.contentMinSize();
                Ok(Snapshot {
                    visible: window.isVisible(),
                    active: app.isActive(),
                    policy: app.activationPolicy(),
                    identity: objc2::rc::Retained::as_ptr(&window) as usize,
                    minimum: (minimum.width, minimum.height),
                })
            });
        let _ = sender.send(result);
    });
    receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|error| format!("AppKit inspection did not complete: {error}"))?
}

fn settle() {
    thread::sleep(Duration::from_millis(250));
}

fn activated() -> Result<Snapshot, String> {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        settle();
        let snapshot = inspect(false)?;
        if snapshot.visible && snapshot.active {
            return Ok(snapshot);
        }
        if Instant::now() >= deadline {
            return Err(format!("activation request was not accepted: {snapshot:?}"));
        }
    }
}

fn exercise() -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !ENGINE_STARTED.load(Ordering::SeqCst) {
        if Instant::now() >= deadline {
            return Err("the standalone engine did not mount its root".into());
        }
        settle();
    }
    let initial = inspect(false)?;
    if initial.visible
        || initial.active
        || initial.policy != objc2_app_kit::NSApplicationActivationPolicy::Regular
        || initial.minimum != (320.0, 180.0)
    {
        return Err(format!(
            "hidden startup or minimum size incorrect: {initial:?}"
        ));
    }
    println!("PASS: initially hidden and inactive, minimum content 320x180");
    show_app();
    let shown = activated()?;
    if !shown.visible || !shown.active || shown.identity != initial.identity {
        return Err(format!(
            "show did not activate the retained window: {shown:?}"
        ));
    }
    println!("PASS: external wake shows and activates the retained window");
    hide_app();
    settle();
    let hidden = inspect(false)?;
    if hidden.visible || hidden.identity != initial.identity {
        return Err(format!("hide did not retain the same window: {hidden:?}"));
    }
    show_app();
    settle();
    let _ = inspect(true)?;
    let deadline = Instant::now() + Duration::from_secs(3);
    let closed = loop {
        settle();
        let snapshot = inspect(false)?;
        if !snapshot.visible || Instant::now() >= deadline {
            break snapshot;
        }
    };
    if closed.visible || closed.identity != initial.identity {
        return Err(format!(
            "close did not hide and retain the window: {closed:?}"
        ));
    }
    settle();
    show_app();
    let reopened = activated()?;
    if !reopened.visible || reopened.identity != initial.identity {
        return Err(format!(
            "close disposed the retained engine/window: {reopened:?}"
        ));
    }
    hide_app();
    settle();
    if inspect(false)?.visible {
        return Err("window remained visible before hidden quit".into());
    }
    println!("PASS: hide, close, and reopen retain the same standalone window");
    Ok(())
}

fn main() -> ExitCode {
    // A dead event loop must fail, rather than leaving a verification app running.
    thread::spawn(|| {
        thread::sleep(Duration::from_secs(20));
        eprintln!("FAIL: lifecycle verification timed out");
        std::process::exit(1);
    });
    set_standalone_hooks(StandaloneHooks { setup, shutdown });
    let exit = run_app(
        AppSource::Rust(Root::of::<Probe>()),
        AppOptions {
            app_id: "com.totto2727.glossshift.lifecycle-probe".into(),
            title: TITLE.into(),
            size: (560, 392),
            ..AppOptions::default()
        },
    );
    if exit != ExitCode::SUCCESS || SHUTDOWNS.load(Ordering::SeqCst) != 1 {
        eprintln!("FAIL: runner exit or exactly-once shutdown incorrect");
        return ExitCode::FAILURE;
    }
    match RESULT.lock().ok().and_then(|mut saved| saved.take()) {
        Some(Ok(())) => {
            println!("PASS: hidden quit returns and calls shutdown exactly once");
            ExitCode::SUCCESS
        }
        result => {
            eprintln!("FAIL: {result:?}");
            ExitCode::FAILURE
        }
    }
}
