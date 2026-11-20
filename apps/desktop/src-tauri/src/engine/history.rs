#![allow(
    clippy::transmute_ptr_to_ptr,
    reason = "the cef crate's wrap_* macros transmute between a wrapper and the struct it wraps"
)]
use orden_base::Held as _;
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cef::*;

type Seen = Arc<Mutex<Vec<(String, bool)>>>;
wrap_navigation_entry_visitor! {
    struct Visit {
        seen: Seen,
        done: SyncSender<()>,
    }
    impl NavigationEntryVisitor {
        fn visit(
            &self,
            entry: Option<&mut NavigationEntry>,
            current: ::std::os::raw::c_int,
            index: ::std::os::raw::c_int,
            total: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            let url = entry.map(|one| CefString::from(&one.url()).to_string()).unwrap_or_default();
            self.seen.held().push((url, current != 0));
            if index + 1 >= total {
                let _ = self.done.try_send(());
            }
            1
        }
    }
}
pub(crate) fn history(
    platform: &tauri::webview::PlatformWebview,
) -> Option<orden_web::engine::Entries> {
    let host = platform.downcast_ref::<tauri_runtime_cef::Webview>()?.browser().host()?;
    let seen: Seen = Arc::default();
    let (done, finished) = sync_channel(1);
    let mut visitor = Visit::new(seen.clone(), done);
    host.navigation_entries(Some(&mut visitor), 0);
    drop(visitor);
    if currently_on(ThreadId::UI) != 0 {
        finished.try_recv().ok()?;
    } else {
        finished.recv_timeout(Duration::from_millis(500)).ok()?;
    }
    let seen = seen.held().clone();
    let at = seen.iter().position(|(_, current)| *current)?;
    Some((seen.into_iter().map(|(url, _)| url).collect(), at))
}
