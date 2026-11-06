#![cfg_attr(feature = "cef", allow(dead_code))]

use std::time::Duration;

use tauri::async_runtime::{channel, Sender};

pub(crate) const PATIENCE: Duration = Duration::from_secs(60);

pub(crate) struct Reply<T>(Sender<Result<T, String>>);

impl<T> Clone for Reply<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T> Reply<T> {
    pub(crate) fn say(&self, answer: Result<T, String>) {
        let _ = self.0.try_send(answer);
    }
}

pub(crate) async fn answer<T: Send + 'static>(
    what: &str,
    ask: impl FnOnce(Reply<T>) -> Result<(), String>,
) -> Result<T, String> {
    let (sender, mut receiver) = channel(1);
    ask(Reply(sender))?;
    match tokio::time::timeout(PATIENCE, receiver.recv()).await {
        Ok(Some(answer)) => answer,
        Ok(None) => Err(format!("{what}: the engine went away without answering")),
        Err(_) => Err(format!("{what}: the engine did not answer")),
    }
}
