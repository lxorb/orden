mod cdp;
pub(crate) mod cookies;
mod isolated;
mod merge;
mod restore_view;

use tauri::{Manager as _, Webview};

pub(super) const PATIENCE: std::time::Duration = std::time::Duration::from_secs(60);

const DUMP: &str = include_str!("web_state/scripts/dump.js");

const RESTORE: &str = include_str!("web_state/scripts/restore.js");

const REFUSED: &str = "not a window of this app";

fn ours(webview: &Webview) -> Result<(), String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(())
    } else {
        Err(REFUSED.to_owned())
    }
}

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
