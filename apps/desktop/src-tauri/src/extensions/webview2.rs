use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Once;

use tauri::webview::PlatformWebview;
use tauri::AppHandle;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2BrowserExtension, ICoreWebView2Profile7, ICoreWebView2_13,
};
use webview2_com::{
    BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler,
    ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
};
use windows_core::{Interface as _, HSTRING, PWSTR};

use super::library::{self, Kept};

#[derive(Clone)]
struct Open {
    profile: ICoreWebView2Profile7,
    environment: usize,
    browser: u32,
}

thread_local! {
    static OPEN: RefCell<HashMap<String, Open>> = RefCell::new(HashMap::new());

    static ADDING: RefCell<HashSet<(String, String)>> = RefCell::new(HashSet::new());
}

static TIDIED: Once = Once::new();

pub fn seen(app: &AppHandle, store: Option<&str>, platform: &PlatformWebview) {
    if !super::in_store(store) {
        return;
    }
    let Some(profile) = profile_of(platform) else {
        return;
    };
    let key = store.unwrap_or_default().to_owned();
    let environment = platform.environment().as_raw() as usize;
    let open = Open {
        profile,
        environment,
        browser: browser_of(platform),
    };
    let fresh = OPEN.with_borrow_mut(|all| {
        let fresh = all
            .get(&key)
            .is_none_or(|seen| seen.environment != environment);
        if fresh {
            all.insert(key.clone(), open.clone());
        }
        fresh
    });
    if fresh {
        reconcile(app, &key, &open);
    }

    let tidying = app.clone();
    TIDIED.call_once(move || {
        std::thread::spawn(move || super::tidy(&tidying));
    });
}

pub fn apply(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let open: Vec<(String, Open)> = OPEN.with_borrow(|open| {
            open.iter()
                .map(|(key, one)| (key.clone(), one.clone()))
                .collect()
        });
        for (key, one) in open {
            reconcile(&handle, &key, &one);
        }
    });
}

fn profile_of(platform: &PlatformWebview) -> Option<ICoreWebView2Profile7> {
    #[allow(
        unsafe_code,
        reason = "the profile is reached through WebView2's own COM interfaces, on the page's own thread"
    )]
    unsafe {
        platform
            .controller()
            .CoreWebView2()
            .ok()?
            .cast::<ICoreWebView2_13>()
            .ok()?
            .Profile()
            .ok()?
            .cast::<ICoreWebView2Profile7>()
            .ok()
    }
}

#[allow(unsafe_code, reason = "WebView2's own COM interface")]
fn browser_of(platform: &PlatformWebview) -> u32 {
    let mut browser = 0u32;
    unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            let _ = core.BrowserProcessId(&raw mut browser);
        }
    }
    browser
}

#[allow(
    unsafe_code,
    reason = "the extensions are read, added, turned on and off and removed through WebView2's own COM interfaces"
)]
fn reconcile(app: &AppHandle, store: &str, open: &Open) {
    let Ok(root) = super::root(app) else {
        return;
    };
    let list = super::kept(app);
    let store = store.to_owned();
    let (adding_to, browser) = (open.profile.clone(), open.browser);

    let handler =
        ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, extensions| {
            if result.is_err() {
                return Ok(());
            }
            let installed = extensions.map(|all| listed(&all)).unwrap_or_default();
            let applied = library::applied(&root);
            let given = applied.get(&store).cloned().unwrap_or_default();
            let adding: BTreeSet<String> = ADDING.with_borrow(|all| {
                all.iter()
                    .filter(|(into, _)| *into == store)
                    .map(|(_, id)| id.clone())
                    .collect()
            });
            let ids: BTreeSet<String> = installed.keys().cloned().collect();
            let plan = super::given::plan(&list, &ids, &given, &adding);

            for kept in plan.switch {
                if let Some(extension) = installed.get(&kept.id) {
                    switched(extension, kept.enabled);
                }
            }
            for kept in plan.add {
                add(&adding_to, &root, &store, kept, browser);
            }
            let stale = plan.remove;
            for id in &stale {
                if let Some(extension) = installed.get(id) {
                    unsafe {
                        let _ = extension.Remove(&BrowserExtensionRemoveCompletedHandler::create(
                            Box::new(|_| Ok(())),
                        ));
                    }
                }
            }
            if !stale.is_empty() {
                let mut applied = library::applied(&root);
                if let Some(given) = applied.get_mut(&store) {
                    given.retain(|id, _| !stale.contains(id));
                }
                let _ = library::write_applied(&root, &applied);
            }
            Ok(())
        }));
    unsafe {
        let _ = open.profile.GetBrowserExtensions(&handler);
    }
}

#[allow(unsafe_code, reason = "the list is WebView2's own COM collection")]
fn listed(
    all: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2BrowserExtensionList,
) -> HashMap<String, ICoreWebView2BrowserExtension> {
    let mut out = HashMap::new();
    let mut count = 0u32;
    unsafe {
        if all.Count(&raw mut count).is_err() {
            return out;
        }
        for at in 0..count {
            let Ok(one) = all.GetValueAtIndex(at) else {
                continue;
            };
            let mut id = PWSTR::null();
            if one.Id(&raw mut id).is_ok() {
                out.insert(webview2_com::take_pwstr(id), one);
            }
        }
    }
    out
}

#[allow(unsafe_code, reason = "WebView2's own COM interface")]
fn switched(extension: &ICoreWebView2BrowserExtension, enabled: bool) {
    let mut on = windows_core::BOOL::default();
    unsafe {
        if extension.IsEnabled(&raw mut on).is_ok() && on.as_bool() != enabled {
            let _ = extension.Enable(
                enabled,
                &BrowserExtensionEnableCompletedHandler::create(Box::new(|_| Ok(()))),
            );
        }
    }
}

#[allow(unsafe_code, reason = "WebView2's own COM interface")]
fn add(
    profile: &ICoreWebView2Profile7,
    root: &std::path::Path,
    store: &str,
    kept: &Kept,
    browser: u32,
) {
    let folder = library::folder_of(root, &kept.id, &kept.version);
    if !folder.join("manifest.json").is_file() {
        super::went_wrong(&kept.id, "its files are missing");
        return;
    }
    let (root, store, id, version, enabled) = (
        root.to_path_buf(),
        store.to_owned(),
        kept.id.clone(),
        kept.version.clone(),
        kept.enabled,
    );
    let on_its_way = (store.clone(), id.clone());
    super::welcome::adding(&store, browser);
    ADDING.with_borrow_mut(|all| all.insert(on_its_way.clone()));
    let arrived = on_its_way.clone();
    let handler =
        ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |result, extension| {
            ADDING.with_borrow_mut(|all| all.remove(&arrived));
            super::welcome::adding(&store, browser);
            match (result, extension) {
                (Ok(()), Some(extension)) => {
                    if !enabled {
                        switched(&extension, false);
                    }
                    let mut applied = library::applied(&root);
                    applied
                        .entry(store.clone())
                        .or_default()
                        .insert(id.clone(), version.clone());
                    let _ = library::write_applied(&root, &applied);
                    super::went_right(&id);
                }
                (Err(error), _) => super::went_wrong(&id, &error.message()),
                (Ok(()), None) => super::went_wrong(&id, "the engine did not take it"),
            }
            Ok(())
        }));
    unsafe {
        if let Err(error) = profile.AddBrowserExtension(&HSTRING::from(folder.as_path()), &handler)
        {
            ADDING.with_borrow_mut(|all| all.remove(&on_its_way));
            super::went_wrong(&kept.id, &error.message());
        }
    }
}
