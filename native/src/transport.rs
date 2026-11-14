//! Generation-scoped OS control receives survive same-VM remounts.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use async_channel::Receiver;
use tokio_util::sync::CancellationToken;

use crate::bridge_types::BridgeEvent;

#[derive(Default)]
pub struct Transport(Mutex<Option<Arc<Session>>>);

struct Session {
    id: String,
    stopped: CancellationToken,
    reader: AtomicBool,
}

impl Transport {
    pub fn open(&self) -> Result<String, String> {
        let session = Arc::new(Session {
            id: uuid::Uuid::new_v4().to_string(),
            stopped: CancellationToken::new(),
            reader: AtomicBool::new(false),
        });
        let mut current = self.0.lock().map_err(|_| "native transport unavailable")?;
        if let Some(previous) = current.replace(session.clone()) {
            previous.stopped.cancel();
        }
        Ok(session.id.clone())
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        let mut current = self.0.lock().map_err(|_| "native transport unavailable")?;
        if current.as_ref().is_some_and(|session| session.id == id)
            && let Some(session) = current.take()
        {
            session.stopped.cancel();
        }
        Ok(())
    }

    pub async fn receive(
        &self,
        id: &str,
        receiver: &Receiver<BridgeEvent>,
    ) -> Result<BridgeEvent, String> {
        struct Reading<'a>(&'a AtomicBool);
        impl Drop for Reading<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let session = self
            .0
            .lock()
            .map_err(|_| "native transport unavailable")?
            .as_ref()
            .filter(|session| session.id == id)
            .cloned()
            .ok_or("native transport session expired")?;
        if session.reader.swap(true, Ordering::AcqRel) {
            return Err("only one native control consumer is allowed".into());
        }
        let _reading = Reading(&session.reader);
        tokio::select! {
            biased;
            () = session.stopped.cancelled() => Err("native transport session expired".into()),
            event = receiver.recv() => event.map_err(|_| "native control channel closed".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge_types::EventKind;
    use std::time::Duration;

    #[tokio::test]
    async fn close_settles_an_idle_reader_without_closing_the_control_queue() -> anyhow::Result<()>
    {
        let transport = Transport::default();
        let session = transport.open().map_err(anyhow::Error::msg)?;
        let (sender, receiver) = async_channel::bounded(1);
        let reading = transport.receive(&session, &receiver);
        let close = async {
            tokio::task::yield_now().await;
            transport.close(&session).map_err(anyhow::Error::msg)
        };
        let (result, closed) = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(reading, close)
        })
        .await?;
        closed?;
        assert!(result.is_err());
        assert!(!sender.is_closed());
        let replacement = transport.open().map_err(anyhow::Error::msg)?;
        sender
            .send(BridgeEvent::new(EventKind::Reopened, "", ""))
            .await?;
        let event = transport
            .receive(&replacement, &receiver)
            .await
            .map_err(anyhow::Error::msg)?;
        assert_eq!(event.kind, EventKind::Reopened);
        Ok(())
    }

    #[tokio::test]
    async fn remount_releases_idle_reader_and_ignores_late_close() -> anyhow::Result<()> {
        let transport = Transport::default();
        let old = transport.open().map_err(anyhow::Error::msg)?;
        let (sender, receiver) = async_channel::bounded(1);
        let reading = transport.receive(&old, &receiver);
        let remount = async {
            tokio::task::yield_now().await;
            let new = transport.open().map_err(anyhow::Error::msg)?;
            transport.close(&old).map_err(anyhow::Error::msg)?;
            sender
                .send(BridgeEvent::new(EventKind::Capture, "new", "source"))
                .await?;
            let event = transport
                .receive(&new, &receiver)
                .await
                .map_err(anyhow::Error::msg)?;
            assert_eq!(event.request_id, "new");
            transport.close(&new).map_err(anyhow::Error::msg)?;
            Ok::<(), anyhow::Error>(())
        };
        let (previous, new) = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(reading, remount)
        })
        .await?;
        assert!(previous.is_err());
        new?;
        Ok(())
    }
}
