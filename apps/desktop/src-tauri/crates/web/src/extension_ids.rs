use std::collections::HashSet;
use std::sync::{LazyLock, PoisonError, RwLock};

use tauri::Url;

static KNOWN: LazyLock<RwLock<HashSet<String>>> = LazyLock::new(RwLock::default);

pub fn ours(url: &Url) -> bool {
    url.scheme() == "chrome-extension"
        && url.host_str().is_some_and(|id| {
            KNOWN
                .read()
                .unwrap_or_else(PoisonError::into_inner)
                .contains(id)
        })
}

#[cfg(test)]
pub fn known(id: &str) {
    KNOWN
        .write()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id.to_owned());
}

pub fn replace(ids: impl IntoIterator<Item = String>) {
    *KNOWN.write().unwrap_or_else(PoisonError::into_inner) = ids.into_iter().collect();
}
