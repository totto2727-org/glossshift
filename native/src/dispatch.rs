//! Backpressure for cross-thread `AppKit` work, without a second event loop.

use std::sync::OnceLock;

use async_channel::Sender;
use objc2::MainThreadMarker;
use tokio::sync::oneshot;

use crate::services::services;

type MainTask = Box<dyn FnOnce() + Send>;
static COMMANDS: OnceLock<Sender<MainTask>> = OnceLock::new();

pub async fn on_main<T: Send + 'static>(
    operation: impl FnOnce(MainThreadMarker) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let service = services()?;
    let sender = COMMANDS.get_or_init(|| {
        let (sender, receiver) = async_channel::bounded::<MainTask>(8);
        service.runtime.spawn(async move {
            while let Ok(task) = receiver.recv().await {
                let (done, completed) = oneshot::channel();
                dispatch2::DispatchQueue::main().exec_async(move || {
                    task();
                    let _ = done.send(());
                });
                if completed.await.is_err() {
                    break;
                }
            }
        });
        sender
    });
    let (reply, result) = oneshot::channel();
    sender
        .send(Box::new(move || {
            let value = MainThreadMarker::new()
                .ok_or_else(|| "AppKit main thread unavailable".into())
                .and_then(operation);
            let _ = reply.send(value);
        }))
        .await
        .map_err(|_| "native command channel closed")?;
    result.await.map_err(|_| "native command interrupted")?
}
