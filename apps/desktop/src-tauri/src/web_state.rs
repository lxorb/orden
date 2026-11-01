//! A store's web state - its cookies, and each origin's localStorage and `IndexedDB` -
//! read out of one web store and written into another on this computer, through each
//! engine's own APIs. What it is for now is the one fold of #239: a store a space kept
//! apart, merged into the one every page shares (`merge.rs`, lib/web-tab/merged.ts);
//! and a tab saved out of a web note kept apart, whose store is copied into the new
//! note's own (`web_copy`).
//!
//! It also carried a site's login between the person's computers, sealed so that only
//! their own could open it (docs/sync-v2.md section 6). That was taken out (#393):
//! Google binds its sessions to the device they were made on, so a login carried to
//! another computer stopped working there within minutes, which took away most of the
//! point. Never the files, then or now: a cookie database is encrypted to the machine it
//! is on.
//!
//! | | `WebView2` | `WKWebView` | CEF (Linux) |
//! | --- | --- | --- | --- |
//! | cookies | `DevTools` `Network.*` (`cookies.rs`) | `WKHTTPCookieStore` | as `WebView2` |
//! | the page's storage | dump.js and restore.js in an isolated world (`isolated.rs`) | a `WKContentWorld` | as `WebView2` |
//! | a page on an origin nobody has open | `WebResourceRequested` answering `<origin>/__nib_restore` (`restore_view.rs`) | `loadHTMLString` | the site's own answer at that address |
//!
//! **Who may call.** Only the app's own windows (`main`, `nib-2`, ...): a web tab's page
//! is a remote origin that reaches no command anyway, and the command refuses any other
//! caller besides, as the terminal's do.

mod answer;
#[cfg(any(windows, feature = "cef"))]
mod cdp;
pub(crate) mod cookies;
mod isolated;
mod merge;
mod restore_view;

use tauri::{Manager as _, Webview};

/// The page's half of reading a store out; see scripts/dump.js.
const DUMP: &str = include_str!("web_state/scripts/dump.js");

/// The page's half of writing one in; see scripts/restore.js.
const RESTORE: &str = include_str!("web_state/scripts/restore.js");

/// The one answer every caller that is not a window of ours gets.
const REFUSED: &str = "not a window of this app";

/// Refuses every caller but the app's own windows.
fn ours(webview: &Webview) -> Result<(), String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(())
    } else {
        Err(REFUSED.to_owned())
    }
}

/// Folds the store `from` - a space's own, or one of its sites' - into the store every
/// page shares: its cookies one by one, and the storage of each of `origins` the shared
/// store holds none of. Leaves `from` as it was. See `web_state/merge.rs`.
#[tauri::command]
pub async fn web_merge(
    webview: Webview,
    from: String,
    origins: Vec<String>,
) -> Result<merge::Merged, String> {
    ours(&webview)?;
    let Some(from) = crate::web_stores::named(Some(&from))? else {
        return Err("the shared store is merged into nothing".to_owned());
    };
    let origins: Vec<String> = origins
        .into_iter()
        .filter(|one| one.starts_with("https://") || one.starts_with("http://"))
        .collect();
    // Which store was used last, for two copies of a cookie neither of which ends. A store
    // that is not a folder (a Mac's) has nothing to say, and the space's own is taken as
    // the one used for its sites.
    let used = crate::engine::root(webview.app_handle())
        .ok()
        .map(|global| {
            let store = global
                .parent()
                .map(|config| config.join(crate::web_stores::STORES).join(from));
            (
                store.as_deref().and_then(merge::last_used),
                merge::last_used(&global),
            )
        });
    let from_used_last = match used {
        Some((Some(store), Some(global))) => store >= global,
        _ => true,
    };
    merge::merge(&webview, from, None, &origins, from_used_last).await
}

/// Copies the store `from` into the store `into`, which is new and empty: a tab kept
/// apart in one web note's store, saved as a note of its own, is given a store of its
/// own that it is still signed in to (`ownFor` in lib/workspace/placing.ts). The same fold as
/// `web_merge`, into a named store rather than the shared one, and `from` is left as it
/// was. Two notes never name one store, since a note set back to Global clears its own.
#[tauri::command]
pub async fn web_copy(
    webview: Webview,
    from: String,
    into: String,
    origins: Vec<String>,
) -> Result<merge::Merged, String> {
    ours(&webview)?;
    let (from, into) = copy_stores(&from, &into)?;
    let origins: Vec<String> = origins
        .into_iter()
        .filter(|one| one.starts_with("https://") || one.starts_with("http://"))
        .collect();
    merge::merge(&webview, from, Some(into), &origins, true).await
}

/// The two stores of a copy, checked: both named, `into` a note's own, and not the same.
fn copy_stores<'a>(from: &'a str, into: &'a str) -> Result<(&'a str, &'a str), String> {
    let (Some(from), Some(into)) = (
        crate::web_stores::named(Some(from))?,
        crate::web_stores::named(Some(into))?,
    ) else {
        return Err("a copy is from one note's store into another's".to_owned());
    };
    if !into.starts_with("note_") || from == into {
        return Err("a copy is into another note's own store".to_owned());
    }
    Ok((from, into))
}

#[cfg(test)]
mod tests {
    use super::copy_stores;

    #[test]
    fn a_copy_is_from_a_named_store_into_another_note_s() {
        assert_eq!(
            copy_stores("note_0123456789abcdef", "note_fedcba9876543210"),
            Ok(("note_0123456789abcdef", "note_fedcba9876543210"))
        );
        assert!(
            copy_stores("", "note_fedcba9876543210").is_err(),
            "not the shared store"
        );
        assert!(
            copy_stores("note_0123456789abcdef", "").is_err(),
            "not into the shared store"
        );
        assert!(
            copy_stores("note_0123456789abcdef", "space_w").is_err(),
            "only into a note's own"
        );
        assert!(copy_stores("note_0123456789abcdef", "note_0123456789abcdef").is_err());
        assert!(copy_stores("note_0123456789abcdef", "note_../x").is_err());
    }
}
