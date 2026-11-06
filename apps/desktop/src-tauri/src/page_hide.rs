#[cfg(feature = "cef")]
mod engine {
    use std::sync::LazyLock;

    use tauri::Webview;
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::{ChangeWindowAttributesAux, ConnectionExt as _};
    use x11rb::rust_connection::RustConnection;
    use x11rb::wrapper::ConnectionExt as _;

    static X: LazyLock<Option<RustConnection>> =
        LazyLock::new(|| x11rb::connect(None).ok().map(|(x, _)| x));

    pub fn bare(window: u32) {
        let Some(x) = X.as_ref() else {
            return;
        };
        let none = ChangeWindowAttributesAux::new().background_pixmap(x11rb::NONE);
        let mut todo = vec![window];
        let mut seen = 0;
        while let Some(one) = todo.pop() {
            seen += 1;
            if seen > 256 {
                break;
            }
            let _ = x.change_window_attributes(one, &none);
            let Ok(asked) = x.query_tree(one) else {
                continue;
            };
            if let Ok(tree) = asked.reply() {
                todo.extend(tree.children);
            }
        }
        let _ = x.flush();
    }

    pub fn page(view: &Webview) {
        let _ = view.with_webview(|platform| {
            if let Some(window) = crate::web_keys::x11_window(&platform) {
                bare(window);
            }
        });
    }

    pub fn out_of_sight(view: &Webview) {
        let _ = view.with_webview(|platform| {
            let (Some(window), Some(x)) = (crate::web_keys::x11_window(&platform), X.as_ref())
            else {
                return;
            };
            let _ = x.unmap_window(window);
            let _ = x.sync();
        });
    }
}

pub fn out_of_sight(view: &tauri::Webview) {
    #[cfg(feature = "cef")]
    engine::out_of_sight(view);
    #[cfg(not(feature = "cef"))]
    let _ = view;
}

pub fn no_ground(view: &tauri::Webview) {
    #[cfg(feature = "cef")]
    engine::page(view);
    #[cfg(not(feature = "cef"))]
    let _ = view;
}

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn no_ground_in(window: u32) {
    #[cfg(feature = "cef")]
    engine::bare(window);
    #[cfg(not(feature = "cef"))]
    let _ = window;
}
