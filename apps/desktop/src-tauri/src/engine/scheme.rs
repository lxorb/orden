use cef::{ImplBrowser as _, ImplBrowserHost as _, ImplRequestContext as _, ImplView as _};

use orden_web::page_scheme::Scheme;

pub(crate) fn wear(platform: &tauri::webview::PlatformWebview, scheme: Scheme) {
    let Some(view) = platform.downcast_ref::<tauri_runtime_cef::Webview>() else {
        return;
    };
    let mut browser = view.browser();
    let Some(context) = browser.host().and_then(|host| host.request_context()) else {
        return;
    };
    let variant = match scheme {
        Scheme::Light => cef::sys::cef_color_variant_t::CEF_COLOR_VARIANT_LIGHT,
        Scheme::Dark => cef::sys::cef_color_variant_t::CEF_COLOR_VARIANT_DARK,
    };
    context.set_chrome_color_scheme(cef::ColorVariant::from(variant), 0);
    ground(&mut browser);
    crate::agents::engines::cef::on_ui(move || ground(&mut browser));
}

fn ground(browser: &mut cef::Browser) {
    if let Some(view) = cef::browser_view_get_for_browser(Some(browser)) {
        view.set_background_color(WHITE);
    }
}

const WHITE: u32 = 0xFFFF_FFFF;
