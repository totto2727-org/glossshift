//! Generation-scoped native receives survive same-VM UI remounts safely.

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
    event_reader: AtomicBool,
    control_reader: AtomicBool,
}

impl Transport {
    pub fn open(&self) -> Result<String, String> {
        let session = Arc::new(Session {
            id: uuid::Uuid::new_v4().to_string(),
            stopped: CancellationToken::new(),
            event_reader: AtomicBool::new(false),
            control_reader: AtomicBool::new(false),
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
        control: bool,
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
        let reading = if control {
            &session.control_reader
        } else {
            &session.event_reader
        };
        if reading.swap(true, Ordering::AcqRel) {
            return Err("only one native event consumer is allowed".into());
        }
        let _reading = Reading(reading);
        tokio::select! {
            biased;
            () = session.stopped.cancelled() => Err("native transport session expired".into()),
            event = receiver.recv() => event.map_err(|_| "native event channel closed".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge_types::EventKind;
    use std::time::Duration;

    #[tokio::test]
    async fn remount_releases_both_idle_readers_and_late_close_is_harmless() -> anyhow::Result<()> {
        let transport = Transport::default();
        let old = transport.open().map_err(anyhow::Error::msg)?;
        let (events, event_receiver) = async_channel::bounded(1);
        let (controls, control_receiver) = async_channel::bounded(1);
        let old_events = transport.receive(&old, &event_receiver, false);
        let old_controls = transport.receive(&old, &control_receiver, true);
        let remount = async {
            tokio::task::yield_now().await;
            let new = transport.open().map_err(anyhow::Error::msg)?;
            transport.close(&old).map_err(anyhow::Error::msg)?;
            events
                .send(BridgeEvent::new(EventKind::Delta, "new", "delta"))
                .await?;
            controls
                .send(BridgeEvent::new(EventKind::Capture, "new", "source"))
                .await?;
            assert_eq!(
                transport
                    .receive(&new, &event_receiver, false)
                    .await
                    .map_err(anyhow::Error::msg)?
                    .text,
                "delta"
            );
            assert_eq!(
                transport
                    .receive(&new, &control_receiver, true)
                    .await
                    .map_err(anyhow::Error::msg)?
                    .text,
                "source"
            );
            transport.close(&new).map_err(anyhow::Error::msg)?;
            assert!(
                transport
                    .receive(&new, &event_receiver, false)
                    .await
                    .is_err()
            );
            Ok::<(), anyhow::Error>(())
        };
        let (old_event, old_control, result) =
            tokio::time::timeout(Duration::from_secs(1), async {
                tokio::join!(old_events, old_controls, remount)
            })
            .await?;
        assert!(old_event.is_err());
        assert!(old_control.is_err());
        result
    }

    #[tokio::test]
    async fn close_releases_an_idle_reader_without_closing_the_channel() -> anyhow::Result<()> {
        let transport = Transport::default();
        let id = transport.open().map_err(anyhow::Error::msg)?;
        let (sender, receiver) = async_channel::bounded(1);
        let read = transport.receive(&id, &receiver, false);
        let close = async {
            tokio::task::yield_now().await;
            transport.close(&id).map_err(anyhow::Error::msg)
        };
        let (event, closed) =
            tokio::time::timeout(Duration::from_secs(1), async { tokio::join!(read, close) })
                .await?;
        assert!(event.is_err());
        closed?;
        assert!(!sender.is_closed());
        Ok(())
    }
}
