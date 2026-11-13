use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use orden_contracts::{FailureKind, Outcome};
use orden_web_engine::{
    allowed, app_host, becomes, debug_port, embed_allowed, frame_may_open, from_run, handed_out,
    internal, once_built, one_at_a_time, overlay_scrollbars, signs_in, switches, tab_may_open,
    with_extensions, Asked, Becomes, Cookie, Download, Edge, Embed, EngineSettings, NativeWindow,
    NoExtensions, Outbox, Picture, Plain, Profiles, SandboxPolicy, Sending, StoreName, Url,
    WebEngine, WebPage, WindowSystem, APP_PROFILE, ENGINE_SWIPE, LONGEST_STORE_NAME,
    LOWEST_DEBUG_PORT, ROOT, STORE_PROFILE,
};

struct FakePage {
    label: String,
    sent: Arc<Mutex<Vec<(u64, String)>>>,
    outbox: Arc<Mutex<Outbox<String>>>,
    address: Arc<Mutex<String>>,
}

impl WebPage for FakePage {
    fn label(&self) -> &str {
        &self.label
    }

    fn navigate(&self, url: &Url) -> Outcome<()> {
        if !allowed(url) {
            return Err(orden_contracts::Failure::new(
                "fake",
                FailureKind::Refused,
                "not a page address",
            ));
        }
        *self.address.lock().expect("address") = url.to_string();
        Ok(())
    }

    fn step(&self, _delta: i32) -> Outcome<()> {
        Ok(())
    }

    fn reload(&self) -> Outcome<()> {
        Ok(())
    }

    fn evaluate(&self, _script: &str) -> Outcome<()> {
        Ok(())
    }

    fn send(&self, message: &str) -> Outcome<u64> {
        let sending = self.outbox.lock().expect("outbox").send(message.to_owned());
        if let Some(body) = sending.now {
            self.sent.lock().expect("sent").push((sending.id, body));
        }
        Ok(sending.id)
    }

    fn place(&self, _position: (f64, f64), _size: (f64, f64)) -> Outcome<()> {
        Ok(())
    }

    fn zoom(&self, _factor: f64) -> Outcome<()> {
        Ok(())
    }

    fn find(&self, _text: &str, _forward: bool) -> Outcome<()> {
        Ok(())
    }

    fn devtools(&self) -> Outcome<()> {
        Ok(())
    }

    fn print_to_pdf(&self, _into: &Path) -> Outcome<()> {
        Ok(())
    }

    fn capture(&self) -> Outcome<Picture> {
        Ok(Picture {
            width: 1,
            height: 1,
            png: Vec::new(),
        })
    }

    fn close(&self) -> Outcome<()> {
        Ok(())
    }
}

type Held = (Arc<Mutex<Outbox<String>>>, Arc<Mutex<String>>);

struct Fake {
    settings: EngineSettings,
    profiles: Profiles,
    pages: Mutex<HashMap<String, Held>>,
    sent: Arc<Mutex<Vec<(u64, String)>>>,
    cleared: Mutex<Vec<Option<String>>>,
}

impl Default for Fake {
    fn default() -> Self {
        Self {
            settings: EngineSettings::default(),
            profiles: Profiles::under(Path::new("/config")),
            pages: Mutex::default(),
            sent: Arc::default(),
            cleared: Mutex::default(),
        }
    }
}

impl Fake {
    fn loaded(&self, label: &str) -> Vec<(u64, String)> {
        let pages = self.pages.lock().expect("pages");
        let (outbox, _) = pages.get(label).expect("a page");
        let flushed = outbox.lock().expect("outbox").ready();
        self.sent.lock().expect("sent").extend(flushed.clone());
        flushed
    }
}

impl WebEngine for Fake {
    fn settings(&self) -> &EngineSettings {
        &self.settings
    }

    fn profiles(&self) -> &Profiles {
        &self.profiles
    }

    fn embed(&self, embed: Embed) -> Outcome<Box<dyn WebPage>> {
        embed_allowed(&embed, &NoExtensions)?;
        let outbox = Arc::new(Mutex::new(Outbox::default()));
        let address = Arc::new(Mutex::new(embed.url.to_string()));
        self.pages.lock().expect("pages").insert(
            embed.label.clone(),
            (Arc::clone(&outbox), Arc::clone(&address)),
        );
        Ok(Box::new(FakePage {
            label: embed.label,
            sent: Arc::clone(&self.sent),
            outbox,
            address,
        }))
    }

    fn page(&self, label: &str) -> Option<Box<dyn WebPage>> {
        let pages = self.pages.lock().expect("pages");
        let (outbox, address) = pages.get(label)?;
        Some(Box::new(FakePage {
            label: label.to_owned(),
            sent: Arc::clone(&self.sent),
            outbox: Arc::clone(outbox),
            address: Arc::clone(address),
        }))
    }

    fn cookies(&self, _store: Option<&StoreName>) -> Outcome<Vec<Cookie>> {
        Ok(Vec::new())
    }

    fn clear(&self, store: Option<&StoreName>) -> Outcome<()> {
        self.cleared
            .lock()
            .expect("cleared")
            .push(store.map(|one| one.as_str().to_owned()));
        Ok(())
    }

    fn downloads(&self) -> Outcome<Vec<Download>> {
        Ok(Vec::new())
    }
}

fn embed_of(label: &str, url: &str) -> Embed {
    Embed {
        label: label.to_owned(),
        window: "main".to_owned(),
        url: Url::parse(url).expect("a url"),
        store: None,
        private: false,
        position: (0.0, 0.0),
        size: (800.0, 600.0),
    }
}

#[test]
fn a_store_s_profile_is_a_direct_child_of_the_root_and_never_the_interface_s() {
    let profiles = Profiles::under(Path::new("/config"));
    assert_eq!(profiles.root(), Path::new("/config").join(ROOT));
    assert_eq!(profiles.app(), profiles.root().join(APP_PROFILE));
    assert_eq!(profiles.of(None), profiles.root());
    let space = StoreName::parse(Some("space_0-k3j9x2"))
        .expect("a name")
        .expect("named");
    let site = StoreName::parse(Some("site_0-k3j9x2_ethz.ch"))
        .expect("a name")
        .expect("named");
    let of_space = profiles.of(Some(&space));
    assert_eq!(of_space.parent(), Some(profiles.root()));
    assert_ne!(of_space, profiles.app());
    assert_ne!(of_space, profiles.of(Some(&site)));
    assert_eq!(
        of_space.file_name().and_then(|one| one.to_str()),
        Some(format!("{STORE_PROFILE}{space}").as_str())
    );
    assert!(!APP_PROFILE.contains(['/', '\\']));
    assert!(!STORE_PROFILE.contains(['/', '\\']));
}

#[test]
fn a_store_name_is_one_plain_folder_with_a_known_prefix() {
    assert_eq!(StoreName::parse(None).expect("none"), None);
    assert_eq!(StoreName::parse(Some("")).expect("none"), None);
    for good in [
        "note_3f9a0c17e2b4d685",
        "space_0-k3j9x2",
        "site_7-a_xn--mnchen-3ya.de",
    ] {
        assert_eq!(
            StoreName::parse(Some(good))
                .expect("a name")
                .expect("named")
                .as_str(),
            good
        );
    }
    for bad in [
        "..",
        "nul",
        "web",
        "app",
        "note_",
        "space_",
        "site_",
        ".hidden",
        "../web",
        "space/0",
        "space\\0",
        "Space_0",
        "space 0",
        "space_0\0",
        "site_0_é.ch",
        "space_0_",
    ] {
        let refused = StoreName::parse(Some(bad)).expect_err(bad);
        assert_eq!(refused.kind, FailureKind::Invalid, "{bad}");
        assert_eq!(refused.module, "web-engine");
    }
    let long = format!("space_{}", "a".repeat(LONGEST_STORE_NAME - 6));
    assert!(StoreName::parse(Some(&long)).is_ok());
    assert!(StoreName::parse(Some(&format!("{long}a"))).is_err());
}

#[test]
fn the_app_s_own_hosts_are_no_web_page() {
    for host in [
        "tauri.localhost",
        "ipc.localhost",
        "asset.localhost",
        "nib.localhost",
        "TAURI.localhost.",
    ] {
        assert!(app_host(host), "{host}");
    }
    assert!(!app_host("localhost"));
    assert!(!app_host("example.com"));
    let url = |text: &str| Url::parse(text).expect(text);
    assert!(allowed(&url("https://example.com/a")));
    assert!(allowed(&url("http://127.0.0.1:8080/")));
    assert!(!allowed(&url("http://tauri.localhost/index.html")));
    assert!(!allowed(&url("file:///etc/passwd")));
    assert!(!allowed(&url("javascript:alert(1)")));
    assert!(!allowed(&url("chrome-extension://abc/popup.html")));
    assert!(allowed(&url("view-source:https://example.com/")));
    assert!(!allowed(&url(
        "view-source:view-source:https://example.com/"
    )));
    assert!(!allowed(&url("view-source:http://ipc.localhost/")));
}

#[test]
fn an_extension_s_own_pages_open_as_tabs_and_frames_take_what_a_page_embeds() {
    let url = |text: &str| Url::parse(text).expect(text);
    let known = |one: &Url| one.scheme() == "chrome-extension" && one.host_str() == Some("abc");
    assert!(tab_may_open(
        &url("chrome-extension://abc/popup.html"),
        &known
    ));
    assert!(!tab_may_open(
        &url("chrome-extension://xyz/popup.html"),
        &known
    ));
    assert!(!tab_may_open(
        &url("chrome-extension://abc/popup.html"),
        &NoExtensions
    ));
    assert!(frame_may_open(&url("about:blank"), &NoExtensions));
    assert!(frame_may_open(&url("about:srcdoc"), &NoExtensions));
    assert!(!frame_may_open(&url("about:settings"), &NoExtensions));
    assert!(frame_may_open(
        &url("data:text/html,<p>x</p>"),
        &NoExtensions
    ));
    assert!(frame_may_open(
        &url("blob:https://example.com/1234"),
        &NoExtensions
    ));
    assert!(!frame_may_open(
        &url("blob:http://ipc.localhost/1234"),
        &NoExtensions
    ));
    assert!(!frame_may_open(
        &url("blob:blob:https://example.com/1"),
        &NoExtensions
    ));
    assert!(frame_may_open(&url("https://example.com/"), &NoExtensions));
    assert!(!frame_may_open(&url("file:///x"), &NoExtensions));
}

#[test]
fn a_new_window_becomes_a_tab_a_window_a_blocked_popup_or_nothing() {
    let url = |text: &str| Url::parse(text).expect(text);
    let site = url("https://example.com/page");
    let asked = Asked::default();
    assert_eq!(
        becomes(&site, asked, &NoExtensions),
        Becomes::Tab(site.to_string())
    );
    assert_eq!(
        becomes(
            &site,
            Asked {
                sized: true,
                ..asked
            },
            &NoExtensions
        ),
        Becomes::Window
    );
    assert_eq!(
        becomes(&url("https://accounts.example.com/x"), asked, &NoExtensions),
        Becomes::Window
    );
    assert_eq!(
        becomes(&url("about:blank"), asked, &NoExtensions),
        Becomes::Window
    );
    assert_eq!(
        becomes(
            &site,
            Asked {
                said: true,
                ..asked
            },
            &NoExtensions
        ),
        Becomes::Tab(site.to_string())
    );
    assert_eq!(
        becomes(
            &site,
            Asked {
                unasked: true,
                ..asked
            },
            &NoExtensions
        ),
        Becomes::Blocked(site.to_string())
    );
    let app = url("http://ipc.localhost/x");
    assert_eq!(becomes(&app, asked, &NoExtensions), Becomes::Nothing);
    assert_eq!(
        becomes(
            &app,
            Asked {
                unasked: true,
                ..asked
            },
            &NoExtensions
        ),
        Becomes::Nothing
    );
    let known = |one: &Url| one.scheme() == "chrome-extension";
    let popup = url("chrome-extension://abc/popup.html");
    assert_eq!(
        becomes(
            &popup,
            Asked {
                sized: true,
                ..asked
            },
            &known
        ),
        Becomes::Tab(popup.to_string())
    );
}

#[test]
fn a_sign_in_page_is_known_by_its_host_or_its_path() {
    let url = |text: &str| Url::parse(text).expect(text);
    for yes in [
        "https://accounts.google.com/o/x",
        "https://login.microsoftonline.com/",
        "https://example.com/oauth2/authorize",
        "https://example.com/users/sign_in",
        "https://example.com/Log-On",
        "https://example.com/pay/3ds/challenge",
    ] {
        assert!(signs_in(&url(yes)), "{yes}");
    }
    for no in [
        "https://example.com/",
        "https://example.com/blog/signals",
        "https://docs.example.com/authors",
    ] {
        assert!(!signs_in(&url(no)), "{no}");
    }
}

#[test]
fn the_engine_s_own_first_page_is_nobody_s_address() {
    assert!(internal(concat!(
        "data:text/html;charset=utf-8,%3C!doctype%20html%3E",
        "%3Chtml%20data-tauri-cef-internal%3D%22initial-load%22%3E"
    )));
    assert!(!internal("about:blank"));
    assert!(!internal("https://example.com/?q=data-tauri-cef-internal"));
    assert!(!internal("data:text/html,<p>a page somebody made</p>"));
}

#[test]
fn the_command_line_reads_pairs_and_bare_keys() {
    assert_eq!(
        switches("enable-logging=stderr, no-sandbox ,,v=1"),
        vec![
            ("enable-logging".to_owned(), Some("stderr".to_owned())),
            ("--no-sandbox".to_owned(), None),
            ("v".to_owned(), Some("1".to_owned())),
        ]
    );
    assert_eq!(
        switches("--noerrdialogs"),
        vec![("--noerrdialogs".to_owned(), None)]
    );
    assert!(switches("").is_empty());
}

#[test]
fn the_extension_folders_join_what_a_run_loads() {
    let ours = [
        PathBuf::from("/c/extensions/a/1"),
        PathBuf::from("/c/extensions/b/2"),
    ];
    let mut asked = switches("load-extension=/run/x,v=1");
    assert!(with_extensions(&mut asked, &ours));
    assert_eq!(
        asked[0],
        (
            "load-extension".to_owned(),
            Some("/run/x,/c/extensions/a/1,/c/extensions/b/2".to_owned())
        )
    );
    let mut none = switches("v=1");
    assert!(!with_extensions(&mut none, &[] as &[PathBuf]));
    assert_eq!(none.len(), 1);
    assert!(with_extensions(&mut none, &ours[..1]));
    assert_eq!(
        none[1],
        (
            "load-extension".to_owned(),
            Some("/c/extensions/a/1".to_owned())
        )
    );
}

#[test]
fn the_settings_switch_the_engine_s_swipe_off_on_every_desktop() {
    let settings = EngineSettings::default();
    let (feature, switch, value) = ENGINE_SWIPE;
    assert_eq!(feature, "TouchpadOverscrollHistoryNavigation");
    assert!(settings.disabled_features.contains(&feature.to_owned()));
    assert!(settings
        .switches
        .contains(&(switch.to_owned(), Some(value.to_owned()))));
    assert_eq!(settings.sandbox, SandboxPolicy::Auto);
    assert_eq!(settings.remote_debugging, None);
    assert_eq!(settings.deep_link_schemes, ["orden", "nib"]);
    let bars = overlay_scrollbars();
    assert_eq!(bars.is_some(), cfg!(any(target_os = "linux", windows)));
    assert_eq!(
        settings.enabled_features,
        bars.map(str::to_owned).into_iter().collect::<Vec<_>>()
    );
    let more = settings.clone().disabling(feature).enabling("Probe");
    assert_eq!(more.disabled_features.len(), 1);
    assert!(more.enabled_features.contains(&"Probe".to_owned()));
}

#[test]
fn a_run_s_sandbox_and_debug_port_are_read_the_way_the_drives_write_them() {
    assert_eq!(SandboxPolicy::parse("required"), SandboxPolicy::Required);
    assert_eq!(SandboxPolicy::parse("disabled"), SandboxPolicy::Disabled);
    assert_eq!(SandboxPolicy::parse("off"), SandboxPolicy::Disabled);
    assert_eq!(SandboxPolicy::parse(""), SandboxPolicy::Auto);
    assert_eq!(SandboxPolicy::parse("yes"), SandboxPolicy::Auto);
    assert_eq!(debug_port(Some("9222")), Some(9222));
    assert_eq!(debug_port(Some("80")), None);
    assert_eq!(debug_port(Some(&LOWEST_DEBUG_PORT.to_string())), Some(1024));
    assert_eq!(debug_port(Some("nine")), None);
    assert_eq!(debug_port(None), None);
}

#[test]
fn a_build_that_ships_reads_nothing_from_its_environment() {
    assert_eq!(from_run(false, "PATH"), None);
    assert!(from_run(true, "PATH").is_some());
}

#[test]
fn an_engine_refuses_an_address_of_the_app_s_own_and_opens_the_web() {
    let engine = Fake::default();
    let refused = engine
        .embed(embed_of("web-1", "http://ipc.localhost/x"))
        .err()
        .expect("refused");
    assert_eq!(refused.kind, FailureKind::Refused);
    assert_eq!(refused.module, "web-engine");
    assert!(engine.page("web-1").is_none());
    let unnamed = engine
        .embed(embed_of("", "https://example.com/"))
        .err()
        .expect("refused");
    assert_eq!(unnamed.kind, FailureKind::Invalid);
    let page = engine
        .embed(embed_of("web-2", "https://example.com/"))
        .expect("opened");
    assert_eq!(page.label(), "web-2");
    assert!(engine.page("web-2").is_some());
    assert!(engine.embed(embed_of("web-3", "about:blank")).is_ok());
    let gone = page
        .navigate(&Url::parse("file:///etc/passwd").expect("a url"))
        .expect_err("refused");
    assert_eq!(gone.kind, FailureKind::Refused);
    page.navigate(&Url::parse("https://example.org/").expect("a url"))
        .expect("navigated");
}

#[test]
fn messages_to_a_page_arrive_once_it_is_ready_in_the_order_they_were_sent() {
    let engine = Fake::default();
    let page = engine
        .embed(embed_of("web-1", "https://example.com/"))
        .expect("opened");
    page.send("one").expect("sent");
    page.send("two").expect("sent");
    assert!(engine.sent.lock().expect("sent").is_empty());
    let flushed = engine.loaded("web-1");
    assert_eq!(flushed, vec![(1, "one".to_owned()), (2, "two".to_owned())]);
    assert_eq!(page.send("three").expect("sent"), 3);
    let sent = engine.sent.lock().expect("sent").clone();
    assert_eq!(
        sent.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert_eq!(sent[2].1, "three");
}

#[test]
fn an_outbox_keeps_its_order_across_a_page_that_went_away() {
    let mut outbox = Outbox::default();
    assert_eq!(outbox.send("a"), Sending { id: 1, now: None });
    assert_eq!(outbox.waiting(), 1);
    assert_eq!(outbox.gone(), 1);
    assert!(!outbox.is_ready());
    assert_eq!(outbox.send("b"), Sending { id: 2, now: None });
    assert_eq!(outbox.ready(), vec![(2, "b")]);
    assert!(outbox.is_ready());
    assert_eq!(
        outbox.send("c"),
        Sending {
            id: 3,
            now: Some("c")
        }
    );
    assert_eq!(outbox.waiting(), 0);
}

#[test]
fn a_store_is_cleared_by_name_and_the_shared_one_by_none() {
    let engine = Fake::default();
    let space = StoreName::parse(Some("space_1"))
        .expect("a name")
        .expect("named");
    engine.clear(Some(&space)).expect("cleared");
    engine.clear(None).expect("cleared");
    assert_eq!(
        *engine.cleared.lock().expect("cleared"),
        vec![Some("space_1".to_owned()), None]
    );
    assert_eq!(
        engine.profiles().of(Some(&space)),
        Path::new("/config").join(ROOT).join("store-space_1")
    );
}

#[test]
fn a_page_handed_inline_is_used_once_the_runtime_lets_go() {
    let lock = Arc::new(Mutex::new(()));
    let held = Arc::clone(&lock);
    let ran = Arc::new(Mutex::new(None));
    let saw = Arc::clone(&ran);
    let asked: Result<(), ()> = handed_out(
        |f: Box<dyn FnOnce(u8) + Send>| {
            let _runtime = held.lock().expect("the runtime's lock");
            f(7);
            Ok(())
        },
        move |platform| {
            let free = lock.try_lock().is_ok();
            *saw.lock().expect("saw") = Some((platform, free));
        },
    );
    assert!(asked.is_ok());
    assert_eq!(*ran.lock().expect("ran"), Some((7, true)));
}

#[test]
fn a_page_handed_later_is_used_where_it_is_handed() {
    let (said, heard) = std::sync::mpsc::channel();
    let elsewhere = said.clone();
    handed_out::<u8, ()>(
        |f: Box<dyn FnOnce(u8) + Send>| {
            std::thread::spawn(move || f(1));
            Ok(())
        },
        move |platform| {
            let _ = elsewhere.send((platform, std::thread::current().id()));
        },
    )
    .expect("asked");
    let (platform, on) = heard.recv().expect("handed");
    assert_eq!(platform, 1);
    assert_ne!(on, std::thread::current().id());

    let kept = Arc::new(Mutex::new(None::<Box<dyn FnOnce(u8) + Send>>));
    let keeping = Arc::clone(&kept);
    handed_out::<u8, ()>(
        move |f: Box<dyn FnOnce(u8) + Send>| {
            *keeping.lock().expect("kept") = Some(f);
            Ok(())
        },
        move |platform| {
            let _ = said.send((platform, std::thread::current().id()));
        },
    )
    .expect("asked");
    assert!(heard.try_recv().is_err(), "nothing ran yet");
    let later = kept.lock().expect("kept").take().expect("posted");
    later(2);
    assert_eq!(
        heard.try_recv().expect("handed"),
        (2, std::thread::current().id())
    );
}

#[test]
fn a_page_asked_for_while_another_is_built_waits_for_it_and_never_builds_inside_it() {
    let order = Rc::new(RefCell::new(Vec::new()));
    let seen = Rc::clone(&order);
    let built = one_at_a_time(
        || "busy",
        || {
            seen.borrow_mut().push("outer begins");
            let inner = Rc::clone(&seen);
            once_built(move || {
                let nested = one_at_a_time(
                    || "busy",
                    || {
                        inner.borrow_mut().push("waited");
                        Ok::<(), &str>(())
                    },
                );
                assert!(nested.is_ok());
            });
            assert_eq!(one_at_a_time(|| "busy", || Ok::<(), &str>(())), Err("busy"));
            seen.borrow_mut().push("outer ends");
            Ok::<u8, &str>(7)
        },
    );
    assert_eq!(built, Ok(7));
    assert_eq!(*order.borrow(), ["outer begins", "outer ends", "waited"]);

    let now = Rc::new(RefCell::new(false));
    let ran = Rc::clone(&now);
    once_built(move || *ran.borrow_mut() = true);
    assert!(*now.borrow());
}

#[test]
fn the_edges_are_the_ewmh_s_and_a_missing_edge_is_a_move() {
    let edges = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    for (code, edge) in edges.iter().enumerate() {
        let parsed = Edge::parse(Some(edge)).expect(edge);
        assert_eq!(u64::from(parsed.ewmh()), code as u64);
        assert!(!parsed.is_move());
    }
    let moving = Edge::parse(None).expect("a move");
    assert!(moving.is_move());
    assert_eq!(moving.ewmh(), 8);
    assert_eq!(Edge::parse(Some("north")), None);
    assert_eq!(NativeWindow(0x3a0_0007).as_x11(), Some(0x3a0_0007));
    assert_eq!(NativeWindow(0).as_x11(), None);
    assert_eq!(NativeWindow(u64::MAX).as_x11(), None);
}

#[test]
fn a_plain_window_system_leaves_moves_to_the_platform_and_refuses_nothing_else() {
    let system = Plain;
    assert_eq!(system.name(), "plain");
    let refused = system
        .move_resize(NativeWindow(1), Edge::Move, None)
        .expect_err("left to the platform");
    assert_eq!(refused.kind, FailureKind::Unsupported);
    assert_eq!(refused.module, "web-engine");
    assert!(system.frame(NativeWindow(1), 2.0).is_ok());
    assert!(system.float(NativeWindow(1)).is_ok());
    system.bare(NativeWindow(1));
    system.hide(NativeWindow(1));
    assert_eq!(system.desktop_scale(), None);
}
