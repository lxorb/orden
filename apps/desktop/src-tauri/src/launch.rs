use std::collections::HashSet;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

static WINDOWS: AtomicU32 = AtomicU32::new(0);

const MAIN: &str = "main";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handed {
    Pages,
    Pdfs,
}

impl Handed {
    fn event(self) -> &'static str {
        match self {
            Self::Pages => "orden://open-pages",
            Self::Pdfs => "orden://open-pdfs",
        }
    }
}

#[derive(Default)]
pub struct Pending(Mutex<Waiting>);

#[derive(Default)]
struct Waiting {
    pages: Road,
    pdfs: Road,
    launched: bool,
}

#[derive(Default)]
struct Road {
    waiting: Vec<String>,
    listening: HashSet<String>,
}

impl Waiting {
    fn road(&mut self, handed: Handed) -> &mut Road {
        match handed {
            Handed::Pages => &mut self.pages,
            Handed::Pdfs => &mut self.pdfs,
        }
    }
}

impl Pending {
    pub fn hold(&self, handed: Handed, arrived: Vec<String>) {
        if let Ok(mut waiting) = self.0.lock() {
            waiting.road(handed).waiting.extend(arrived);
        }
    }

    pub fn launched(&self) {
        if let Ok(mut waiting) = self.0.lock() {
            waiting.launched = true;
        }
    }

    pub fn forget(&self, label: &str) {
        if let Ok(mut waiting) = self.0.lock() {
            waiting.pages.listening.remove(label);
            waiting.pdfs.listening.remove(label);
        }
    }

    pub fn is_listening(&self, label: &str) -> bool {
        self.hears(Handed::Pages, label)
    }

    fn hears(&self, handed: Handed, label: &str) -> bool {
        self.0
            .lock()
            .is_ok_and(|mut waiting| waiting.road(handed).listening.contains(label))
    }

    fn take(&self, handed: Handed, label: &str) -> Vec<String> {
        let Ok(mut waiting) = self.0.lock() else {
            return Vec::new();
        };

        let road = waiting.road(handed);
        road.listening.insert(label.to_owned());
        std::mem::take(&mut road.waiting)
    }
}

pub fn handed_by(args: &[String]) -> Vec<String> {
    crate::web_handed::pages_in(args)
}

pub fn hold_handed(app: &AppHandle, args: &[std::ffi::OsString], cwd: &std::path::Path) {
    if let Some(pending) = app.try_state::<Pending>() {
        let words: Vec<String> = args
            .iter()
            .map(|one| one.to_string_lossy().into_owned())
            .collect();
        pending.hold(Handed::Pages, handed_by(&words));
        let pdfs = crate::handed_pdfs::pdfs_in(args, cwd);
        pending.hold(Handed::Pdfs, crate::handed_pdfs::admit_handed(app, pdfs));
    }
}

#[tauri::command]
pub fn take_startup_pages(
    window: tauri::Window,
    pending: tauri::State<'_, Pending>,
) -> Vec<String> {
    pending.take(Handed::Pages, window.label())
}

#[tauri::command]
pub fn take_startup_pdfs(window: tauri::Window, pending: tauri::State<'_, Pending>) -> Vec<String> {
    pending.take(Handed::Pdfs, window.label())
}

pub fn second_launch_heard(app: &AppHandle, argv: Vec<String>, cwd: String) {
    let later = app.clone();
    std::thread::spawn(move || {
        let answering = later.clone();
        let _ = later.run_on_main_thread(move || second_launch(&answering, &argv, &cwd));
    });
}

fn second_launch(app: &AppHandle, argv: &[String], cwd: &str) {
    if in_background(argv) {
        return;
    }
    let pressed = crate::hotkeys::Which::asked_by(argv);
    if !pressed.is_empty() {
        for which in pressed {
            crate::hotkeys::pressed(app, which, None);
        }
        return;
    }
    if let Some(unread) = unread_link(argv) {
        use tauri_plugin_deep_link::DeepLinkExt as _;
        app.deep_link().handle_cli_arguments(unread.iter());
    }
    let argv = &without_ours(argv);

    let reminder = argv
        .iter()
        .any(|one| crate::reminders::link::is_reminder(one));
    if let Some(window) = app.get_window(MAIN).filter(|_| !reminder) {
        if crate::placement::away().is_none() {
            let _ = window.show();
        }
        bring_forward(&window);
    }

    hand_over(app, Handed::Pages, handed_by(argv));
    let (app, argv, cwd) = (app.clone(), argv.clone(), cwd.to_owned());
    std::thread::spawn(move || {
        let pdfs = crate::handed_pdfs::pdfs_in(&argv, std::path::Path::new(&cwd));
        hand_over(
            &app,
            Handed::Pdfs,
            crate::handed_pdfs::admit_handed(&app, pdfs),
        );
    });
}

pub fn page_up(app: &AppHandle, label: &str) -> bool {
    app.try_state::<Pending>()
        .is_some_and(|pending| pending.is_listening(label))
        && !crate::stall::page_gone(label)
}

fn token_in(argv: &[String]) -> Option<String> {
    argv.iter()
        .skip(1)
        .find_map(|one| one.strip_prefix(TOKEN_FLAG))
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
}

fn without_ours(argv: &[String]) -> Vec<String> {
    argv.iter()
        .filter(|one| {
            !one.starts_with(TOKEN_FLAG)
                && one.as_str() != BACKGROUND_FLAG
                && !crate::hotkeys::Which::is_flag(one)
        })
        .cloned()
        .collect()
}

fn unread_link(argv: &[String]) -> Option<Vec<String>> {
    token_in(argv).map(|_| without_ours(argv))
}

pub const TOKEN_FLAG: &str = "--activation-token=";

pub const BACKGROUND_FLAG: &str = "--background";

pub fn in_background<A: AsRef<std::ffi::OsStr>>(argv: &[A]) -> bool {
    argv.iter()
        .skip(1)
        .any(|one| one.as_ref() == BACKGROUND_FLAG)
}

pub fn hand_over(app: &AppHandle, handed: Handed, arrived: Vec<String>) {
    if arrived.is_empty() {
        return;
    }

    let Some(pending) = app.try_state::<Pending>() else {
        return;
    };
    let seen = seen(app, &pending, handed);
    let launched = pending.0.lock().is_ok_and(|waiting| waiting.launched);

    match receiver(&seen, launched) {
        Handover::To(label) => {
            if let Some(window) = app.get_window(&label) {
                bring_forward(&window);
            }
            let _ = app.emit_to(label.as_str(), handed.event(), arrived);
        }
        Handover::Hold => pending.hold(handed, arrived),
        Handover::HoldAndOpen => {
            pending.hold(handed, arrived);
            let _ = open_again(app);
        }
    }
}

pub fn brought_up(window: &tauri::Window) {
    if crate::placement::away().is_none() {
        let _ = window.show();
    }
    bring_forward(window);
}

pub fn open_for_what_waits(app: &AppHandle) {
    let launched = app
        .try_state::<Pending>()
        .is_some_and(|pending| pending.0.lock().is_ok_and(|waiting| waiting.launched));
    if launched && document_windows(app).is_empty() {
        let _ = open_again(app);
    }
}

#[cfg(target_os = "macos")]
pub fn reopen(app: &AppHandle) {
    let windows = document_windows(app);
    let waiting = windows
        .iter()
        .find(|window| window.label() == MAIN)
        .or_else(|| windows.first());

    match waiting {
        Some(window) => {
            let _ = window.show();
            bring_forward(window);
        }
        None => {
            let _ = open_again(app);
        }
    }
}

#[tauri::command]
pub async fn new_window(app: AppHandle) -> Result<(), String> {
    let (sending, mut waiting) = tauri::async_runtime::channel(1);
    let building = app.clone();
    app.run_on_main_thread(move || {
        let _ = sending.try_send(open_window(&building, &free_label(&building)));
    })
    .map_err(|error| format!("could not open another window: {error}"))?;
    waiting
        .recv()
        .await
        .unwrap_or_else(|| Err("could not open another window".to_string()))
}

fn open_window(app: &AppHandle, label: &str) -> Result<(), String> {
    opened(window_builder(app, label))
}

fn open_again(app: &AppHandle) -> Result<(), String> {
    let label = reopened_label(app);
    if label != MAIN {
        return open_window(app, &label);
    }
    opened(crate::placement::reopened(app, window_builder(app, MAIN)))
}

fn window_builder<'a>(
    app: &'a AppHandle,
    label: &str,
) -> WebviewWindowBuilder<'a, crate::Engine, AppHandle> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Orden")
        .inner_size(1180.0, 760.0)
        .min_inner_size(520.0, 400.0)
        .disable_drag_drop_handler();

    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    #[cfg(target_os = "macos")]
    let builder = builder.visible(false);

    #[cfg(all(windows, not(feature = "cef")))]
    let builder = builder
        .additional_browser_args(&crate::engine::browser_args(app))
        .initialization_script(crate::page_scheme::SCRIPT);
    #[cfg(feature = "cef")]
    let builder = crate::engine::own_window(builder);

    builder
}

fn opened(builder: WebviewWindowBuilder<'_, crate::Engine, AppHandle>) -> Result<(), String> {
    let building = crate::appearance::own_frame(builder);
    let window = crate::placement::built(building)
        .map_err(|error| format!("could not open another window: {error}"))?;
    crate::pinch::let_through(window.as_ref());
    crate::dropped_paths::hear(window.as_ref());

    #[cfg(target_os = "macos")]
    {
        crate::lights::hold(&window);
        if crate::placement::away().is_none() {
            window
                .show()
                .map_err(|error| format!("could not show the window: {error}"))?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;

    Ok(())
}

fn reopened_label(app: &AppHandle) -> String {
    if app.get_window(MAIN).is_none() {
        MAIN.to_owned()
    } else {
        free_label(app)
    }
}

pub fn document_windows(app: &AppHandle) -> Vec<tauri::Window> {
    app.windows()
        .into_values()
        .filter(|window| is_document_window(window.label()))
        .collect()
}

pub(crate) fn is_document_window(label: &str) -> bool {
    label == MAIN
        || label
            .strip_prefix("nib-")
            .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

fn bring_forward(window: &tauri::Window) {
    crate::placement::raised(window);
}

#[tauri::command]
pub fn show_window(window: tauri::Window) {
    bring_forward(&window);
}

struct Seen {
    label: String,
    focused: bool,
    listening: bool,
}

fn seen(app: &AppHandle, pending: &Pending, handed: Handed) -> Vec<Seen> {
    document_windows(app)
        .into_iter()
        .map(|window| Seen {
            focused: window.is_focused().unwrap_or(false),
            listening: pending.hears(handed, window.label()),
            label: window.label().to_owned(),
        })
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
enum Handover {
    To(String),
    Hold,
    HoldAndOpen,
}

fn receiver(windows: &[Seen], launched: bool) -> Handover {
    let listening = || windows.iter().filter(|one| one.listening);
    let chosen = listening()
        .find(|one| one.focused)
        .or_else(|| listening().find(|one| one.label == MAIN))
        .or_else(|| listening().next());

    match chosen {
        Some(one) => Handover::To(one.label.clone()),
        None if windows.is_empty() && launched => Handover::HoldAndOpen,
        None => Handover::Hold,
    }
}

fn free_label(app: &AppHandle) -> String {
    loop {
        let label = format!("nib-{}", WINDOWS.fetch_add(1, Ordering::Relaxed) + 2);
        if app.get_window(&label).is_none() {
            return label;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        handed_by, in_background, is_document_window, receiver, token_in, unread_link,
        without_ours, Handed, Handover, Pending, Seen, BACKGROUND_FLAG,
    };

    fn window(label: &str, focused: bool, listening: bool) -> Seen {
        Seen {
            label: label.to_owned(),
            focused,
            listening,
        }
    }

    #[test]
    fn pages_go_to_the_window_in_front() {
        let windows = [window("main", false, true), window("nib-2", true, true)];
        assert_eq!(receiver(&windows, true), Handover::To("nib-2".into()));
    }

    #[test]
    fn with_nothing_in_front_the_first_window_takes_them() {
        let windows = [window("nib-3", false, true), window("main", false, true)];
        assert_eq!(receiver(&windows, true), Handover::To("main".into()));

        let windows = [window("nib-3", false, true)];
        assert_eq!(receiver(&windows, true), Handover::To("nib-3".into()));
    }

    #[test]
    fn a_window_still_loading_is_not_handed_anything() {
        let windows = [window("main", true, false)];
        assert_eq!(receiver(&windows, true), Handover::Hold);

        let windows = [window("main", true, false), window("nib-2", false, true)];
        assert_eq!(receiver(&windows, true), Handover::To("nib-2".into()));
    }

    #[test]
    fn with_no_window_at_all_one_is_opened_once_the_launch_is_through() {
        assert_eq!(receiver(&[], false), Handover::Hold);
        assert_eq!(receiver(&[], true), Handover::HoldAndOpen);
    }

    #[test]
    fn a_document_window_is_main_or_a_numbered_one() {
        assert!(is_document_window("main"));
        assert!(is_document_window("nib-2"));
        assert!(is_document_window("nib-12"));
        assert!(!is_document_window("orden-presenter"));
        assert!(!is_document_window("nib-"));
        assert!(!is_document_window("web-1"));
    }

    #[test]
    fn a_window_is_up_once_it_has_asked_for_its_pages() {
        let pending = Pending::default();
        pending.hold(Handed::Pages, vec!["https://example.com/".into()]);

        assert!(!pending.is_listening("main"));

        assert_eq!(
            pending.take(Handed::Pages, "main"),
            vec!["https://example.com/".to_owned()]
        );
        assert!(pending.is_listening("main"));
        assert!(pending.take(Handed::Pages, "main").is_empty());
    }

    #[test]
    fn pdfs_wait_on_a_road_of_their_own() {
        let pending = Pending::default();
        pending.hold(Handed::Pdfs, vec![r"C:\Downloads\a.pdf".into()]);

        assert!(pending.take(Handed::Pages, "main").is_empty());
        assert!(!pending.hears(Handed::Pdfs, "main"));
        assert_eq!(
            pending.take(Handed::Pdfs, "main"),
            vec![r"C:\Downloads\a.pdf".to_owned()]
        );
        assert!(pending.hears(Handed::Pdfs, "main"));

        pending.forget("main");
        assert!(!pending.hears(Handed::Pdfs, "main"));
    }

    #[test]
    fn a_window_that_went_listens_for_nothing() {
        let pending = Pending::default();
        pending.take(Handed::Pages, "nib-2");

        pending.forget("nib-2");
        assert!(!pending.is_listening("nib-2"));
    }

    #[test]
    fn a_launch_token_travels_with_the_arguments_and_is_taken_off_them() {
        let argv: Vec<String> = [
            "nib",
            "https://orden.so",
            "--activation-token=abc",
            "--quick-add",
        ]
        .map(String::from)
        .into();
        assert_eq!(token_in(&argv).as_deref(), Some("abc"));
        assert_eq!(
            without_ours(&argv),
            vec!["nib".to_owned(), "https://orden.so".to_owned()]
        );
        let bare: Vec<String> = ["nib", "--activation-token="].map(String::from).into();
        assert_eq!(token_in(&bare), None);
    }

    #[test]
    fn an_agents_launch_asks_for_no_window() {
        let agent: Vec<String> = ["nib", BACKGROUND_FLAG].map(String::from).into();
        assert!(in_background(&agent));
        assert_eq!(without_ours(&agent), vec!["nib".to_owned()]);
        for reader in [
            vec!["nib"],
            vec!["nib", "https://orden.so"],
            vec![BACKGROUND_FLAG],
        ] {
            let argv: Vec<String> = reader.into_iter().map(String::from).collect();
            assert!(!in_background(&argv), "{argv:?}");
        }
    }

    #[test]
    fn a_link_beside_a_token_is_read_again_without_it() {
        let link = "orden://open?path=Inbox.md";
        let read = Some(vec!["nib".to_owned(), link.to_owned()]);
        let last: Vec<String> = ["nib", link, "--activation-token=abc"]
            .map(String::from)
            .into();
        assert_eq!(unread_link(&last), read);
        let first: Vec<String> = ["nib", "--activation-token=abc", link]
            .map(String::from)
            .into();
        assert_eq!(unread_link(&first), read);
        let bare: Vec<String> = ["nib", link].map(String::from).into();
        assert_eq!(unread_link(&bare), None);
    }

    #[test]
    fn a_command_line_hands_over_pages_and_never_a_note() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let note = dir.path().join("Idea.md");
        std::fs::write(&note, "# Idea").expect("a note");
        let note = note.to_string_lossy().to_string();

        assert!(handed_by(&["nib.exe".into(), note.clone()]).is_empty());
        assert_eq!(
            handed_by(&["nib.exe".into(), note.clone(), "https://example.com".into()]),
            vec!["https://example.com/".to_owned()]
        );

        let pages = handed_by(&[
            "nib.exe".into(),
            "--url".into(),
            "https://example.com/".into(),
            note,
        ]);
        assert_eq!(pages.len(), 1);
        assert!(pages[0].starts_with("https://example.com/"));
    }

    #[test]
    fn every_webview_takes_its_own_drops() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut sources = vec![root.clone()];
        let mut taken = Vec::new();
        while let Some(at) = sources.pop() {
            for entry in std::fs::read_dir(&at)
                .expect("the crate's source")
                .flatten()
            {
                let path = entry.path();
                if path.is_dir() {
                    sources.push(path);
                    continue;
                }
                let name = path
                    .strip_prefix(&root)
                    .expect("under the source")
                    .to_string_lossy()
                    .replace('\\', "/");
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                let text = text.split("#[cfg(test)]").next().unwrap_or_default();
                let built = text.matches("WebviewWindowBuilder::new(").count()
                    + text.matches("WebviewBuilder::new(").count();
                if text.matches(".disable_drag_drop_handler()").count() < built {
                    taken.push(name);
                }
            }
        }
        taken.sort();
        assert!(
            taken.is_empty(),
            "a webview built with Tauri's drop handler on: {taken:?}"
        );
    }
}
