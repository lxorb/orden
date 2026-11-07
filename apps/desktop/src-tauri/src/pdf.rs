use serde::Deserialize;
#[cfg(any(windows, feature = "cef"))]
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
#[cfg(not(feature = "cef"))]
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

use crate::clock;
use crate::paths::{cannot, chosen};

const SETTLE: Duration = Duration::from_millis(300);

const PATIENCE: Duration = Duration::from_secs(45);

static PRINTS: AtomicU32 = AtomicU32::new(0);

#[cfg_attr(
    any(not(any(windows, target_os = "macos")), feature = "cef"),
    allow(dead_code)
)]
#[derive(Clone, Deserialize)]
pub struct PdfPage {
    pub width: f64,
    pub height: f64,
    pub margin: f64,
    pub landscape: bool,
}

#[cfg(not(feature = "cef"))]
type Printable = PlatformWebview;
#[cfg(feature = "cef")]
type Printable = tauri::WebviewWindow<crate::Engine>;

#[tauri::command]
pub fn pdf_supported() -> bool {
    printer::available()
}

#[cfg(any(windows, feature = "cef"))]
pub(crate) fn printing(paper: &PdfPage) -> Value {
    let margin = paper.margin.max(0.0);
    json!({
        "landscape": paper.landscape,
        "paperWidth": paper.width,
        "paperHeight": paper.height,
        "marginTop": margin,
        "marginBottom": margin,
        "marginLeft": margin,
        "marginRight": margin,
        "printBackground": true,
        "displayHeaderFooter": false,
        "preferCSSPageSize": false,
        "transferMode": "ReturnAsBase64",
    })
}

#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
const POINTS_PER_INCH: f64 = 72.0;

#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
fn sheet_in_points(page: &PdfPage) -> (f64, f64, f64) {
    let (width, height) = if page.landscape && page.width < page.height {
        (page.height, page.width)
    } else {
        (page.width, page.height)
    };

    (
        width * POINTS_PER_INCH,
        height * POINTS_PER_INCH,
        page.margin.max(0.0) * POINTS_PER_INCH,
    )
}

#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
fn on_its_side(width: f64, height: f64) -> bool {
    width > height
}

#[tauri::command]
pub async fn print_pdf(
    app: AppHandle,
    html: String,
    output: String,
    page: PdfPage,
) -> Result<(), String> {
    if !pdf_supported() {
        return Err("printing to a file is not available here".into());
    }
    let output = chosen(&app, &output)?.to_string_lossy().into_owned();

    in_hidden_window(&app, html, PATIENCE, move |webview, done| {
        printer::print(webview, &output, &page, done)
    })
    .await
    .map_err(|error| {
        if error == TOO_LONG {
            "the PDF took too long to write".into()
        } else {
            error
        }
    })
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
const DIALOG_PATIENCE: Duration = Duration::from_secs(60 * 60);

const TOO_LONG: &str = "the print took too long";

#[tauri::command]
#[cfg_attr(
    not(all(target_os = "macos", not(feature = "cef"))),
    allow(
        clippy::unused_async,
        reason = "one signature for every platform; only a Mac has a dialog to wait for"
    )
)]
pub async fn print_page(
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let (html, page) = printed(&request)?;

    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    {
        use tauri::Manager as _;

        let app = webview.app_handle().clone();
        let parent = webview.window();
        in_hidden_window(&app, html, DIALOG_PATIENCE, move |view, done| {
            printer::dialog(view, &parent, page.as_ref(), done)
        })
        .await
    }

    #[cfg(not(all(target_os = "macos", not(feature = "cef"))))]
    {
        let _ = (webview, html, page);
        Err("the print dialog here is the page's own".into())
    }
}

#[derive(Deserialize)]
struct Printing {
    page: Option<PdfPage>,
}

fn printed(request: &tauri::ipc::Request<'_>) -> Result<(String, Option<PdfPage>), String> {
    let (Printing { page }, bytes) =
        crate::notes::raw_sent::<Printing>(request.headers(), request.body())?;
    let html = String::from_utf8(bytes.into_owned())
        .map_err(|_| "the page to print is not text".to_owned())?;
    Ok((html, page))
}

async fn in_hidden_window<F>(
    app: &AppHandle,
    html: String,
    patience: Duration,
    print: F,
) -> Result<(), String>
where
    F: FnOnce(&Printable, mpsc::Sender<Result<(), String>>) -> Result<(), String> + Send + 'static,
{
    let job = format!(
        "{}-{}-{}",
        std::process::id(),
        clock::now(),
        PRINTS.fetch_add(1, Ordering::Relaxed)
    );
    let path = std::env::temp_dir().join(format!("orden-print-{job}.html"));
    written_alone(&path, &fenced(&html)).map_err(|error| cannot("write", &path, &error))?;

    let Ok(url) = tauri::Url::from_file_path(&path) else {
        let _ = std::fs::remove_file(&path);
        return Err(format!("could not address {}", path.display()));
    };

    let (done, waited) = mpsc::channel::<Result<(), String>>();
    let print = Arc::new(Mutex::new(Some(print)));

    let building =
        WebviewWindowBuilder::new(app, format!("print-{job}"), WebviewUrl::External(url));

    #[cfg(all(windows, not(feature = "cef")))]
    let building = building.additional_browser_args(&crate::engine::browser_args(app));

    #[cfg(feature = "cef")]
    let building = crate::engine::own_profile(building);

    let window = building
        .title("Orden")
        .visible(false)
        .inner_size(900.0, 1200.0)
        .disable_drag_drop_handler()
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let Some(print) = print.lock().ok().and_then(|mut held| held.take()) else {
                return;
            };

            let done = done.clone();

            std::thread::spawn(move || {
                std::thread::sleep(SETTLE);

                let failed = done.clone();

                #[cfg(feature = "cef")]
                if let Err(error) = print(&window, done) {
                    let _ = failed.send(Err(error));
                }

                #[cfg(not(feature = "cef"))]
                {
                    let asked = window.with_webview(move |webview| {
                        if let Err(error) = print(&webview, done) {
                            let _ = failed.send(Err(error));
                        }
                    });

                    if let Err(error) = asked {
                        give_up(&window, &error.to_string());
                    }
                }
            });
        })
        .build();

    let window = match window {
        Ok(window) => window,
        Err(error) => {
            let _ = std::fs::remove_file(&path);
            return Err(format!("could not open a window to print in: {error}"));
        }
    };

    let waiting = tauri::async_runtime::spawn_blocking(move || waited.recv_timeout(patience)).await;

    let _ = window.destroy();
    let _ = std::fs::remove_file(&path);

    waiting
        .map_err(|error| format!("the print was interrupted: {error}"))?
        .unwrap_or_else(|_| Err(TOO_LONG.into()))
}

const PAGE_POLICY: &str = "default-src 'none'; style-src 'unsafe-inline'; \
     img-src data: http: https:; font-src data:; media-src data:";

fn fenced(html: &str) -> String {
    let at = policy_place(html);
    format!(
        "{}<meta http-equiv=\"Content-Security-Policy\" content=\"{PAGE_POLICY}\">{}",
        &html[..at],
        &html[at..]
    )
}

fn policy_place(html: &str) -> usize {
    let lower = html.to_ascii_lowercase();
    let mut at = 0;
    let mut place = 0;
    loop {
        let rest = lower[at..]
            .trim_start_matches(|one: char| one.is_ascii_whitespace() || one == '\u{feff}');
        at = lower.len() - rest.len();
        let past = if rest.starts_with("<!--") {
            comment_end(rest)
        } else if rest.starts_with("<!doctype") {
            tag_end(rest).inspect(|end| place = at + end)
        } else if rest.starts_with("<!") || rest.starts_with("<?") {
            rest.find('>').map(|end| end + 1)
        } else if is_tag(rest, "<html") {
            tag_end(rest)
        } else if is_tag(rest, "<head") {
            return tag_end(rest).map_or(place, |end| at + end);
        } else {
            return place;
        };
        let Some(past) = past else {
            return place;
        };
        at += past;
    }
}

fn is_tag(text: &str, tag: &str) -> bool {
    text.strip_prefix(tag).is_some_and(|after| {
        after.starts_with(|one: char| one.is_ascii_whitespace() || one == '/' || one == '>')
    })
}

fn tag_end(text: &str) -> Option<usize> {
    let mut quote = None;
    for (at, one) in text.char_indices() {
        match (quote, one) {
            (None, '>') => return Some(at + 1),
            (None, '"' | '\'') => quote = Some(one),
            (Some(open), _) if open == one => quote = None,
            _ => {}
        }
    }
    None
}

fn comment_end(text: &str) -> Option<usize> {
    let body = text.strip_prefix("<!--")?;
    if body.starts_with('>') {
        return Some(5);
    }
    if body.starts_with("->") {
        return Some(6);
    }
    let plain = body.find("-->").map(|end| end + 3);
    let bang = body.find("--!>").map(|end| end + 4);
    Some(4 + plain.into_iter().chain(bang).min()?)
}

fn written_alone(path: &std::path::Path, html: &str) -> std::io::Result<()> {
    use std::io::Write as _;
    let mut opening = std::fs::OpenOptions::new();
    opening.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opening, 0o600);
    opening.open(path)?.write_all(html.as_bytes())
}

#[cfg(not(feature = "cef"))]
fn give_up(window: &tauri::WebviewWindow, error: &str) {
    eprintln!("print_pdf: {error}");
    let _ = window.destroy();
}

#[cfg(all(windows, not(feature = "cef")))]
mod printer {
    use super::PdfPage;
    use std::sync::mpsc::Sender;
    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING};

    pub fn available() -> bool {
        true
    }

    fn describe(error: windows_core::Error) -> String {
        error.to_string()
    }

    #[allow(
        unsafe_code,
        reason = "WebView2's print engine is reached through its COM interfaces"
    )]
    pub fn print(
        webview: &PlatformWebview,
        output: &str,
        page: &PdfPage,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        unsafe {
            let controller = webview.controller();
            controller.SetIsVisible(true).map_err(describe)?;

            let core = controller.CoreWebView2().map_err(describe)?;
            let printer: ICoreWebView2_7 = core.cast().map_err(describe)?;
            let environment: ICoreWebView2Environment6 =
                webview.environment().cast().map_err(describe)?;

            let settings = environment.CreatePrintSettings().map_err(describe)?;
            settings
                .SetOrientation(if page.landscape {
                    COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                } else {
                    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                })
                .map_err(describe)?;
            settings.SetPageWidth(page.width).map_err(describe)?;
            settings.SetPageHeight(page.height).map_err(describe)?;
            settings.SetMarginTop(page.margin).map_err(describe)?;
            settings.SetMarginBottom(page.margin).map_err(describe)?;
            settings.SetMarginLeft(page.margin).map_err(describe)?;
            settings.SetMarginRight(page.margin).map_err(describe)?;
            settings.SetScaleFactor(1.0).map_err(describe)?;
            settings.SetShouldPrintBackgrounds(true).map_err(describe)?;
            settings
                .SetShouldPrintHeaderAndFooter(false)
                .map_err(describe)?;

            let target = HSTRING::from(output);
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, written| {
                let _ = done.send(match result {
                    Err(error) => Err(error.to_string()),
                    Ok(()) if !written => Err("the PDF could not be written".into()),
                    Ok(()) => Ok(()),
                });
                Ok(())
            }));

            printer
                .PrintToPdf(&target, &settings, &handler)
                .map_err(describe)
        }
    }
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod printer {
    use super::{on_its_side, sheet_in_points, PdfPage};
    use std::cell::{Cell, RefCell};
    use std::ffi::c_void;
    use std::sync::mpsc::Sender;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{define_class, msg_send, sel, ClassType, DefinedClass, MainThreadOnly};
    use objc2_app_kit::{
        NSPaperOrientation, NSPrintHeaderAndFooter, NSPrintInfo, NSPrintJobSavingURL,
        NSPrintOperation, NSPrintSaveJob, NSPrintingPaginationMode, NSWindow,
    };
    use objc2_foundation::{
        MainThreadMarker, NSCopying as _, NSNumber, NSObjectProtocol, NSSize, NSString, NSURL,
    };
    use objc2_web_kit::WKWebView;
    use tauri::webview::PlatformWebview;

    pub fn available() -> bool {
        WKWebView::class().responds_to(sel!(printOperationWithPrintInfo:))
    }

    struct Waiting {
        output: Option<String>,
        done: Cell<Option<Sender<Result<(), String>>>>,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "NibPdfPrinted"]
        #[ivars = Waiting]
        struct Printed;

        impl Printed {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(
                &self,
                _operation: &NSPrintOperation,
                success: bool,
                _context: *mut c_void,
            ) {
                let Some(done) = self.ivars().done.take() else {
                    return;
                };

                let _ = done.send(match &self.ivars().output {
                    Some(output) if !(success && std::path::Path::new(output).is_file()) => {
                        Err("the PDF could not be written".into())
                    }
                    _ => Ok(()),
                });
            }
        }
    );

    impl Printed {
        #[allow(
            unsafe_code,
            reason = "an Objective-C object is initialised through its superclass"
        )]
        fn new(
            mtm: MainThreadMarker,
            output: Option<&str>,
            done: Sender<Result<(), String>>,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Waiting {
                output: output.map(str::to_owned),
                done: Cell::new(Some(done)),
            });
            unsafe { msg_send![super(this), init] }
        }

        fn answered(&self) -> bool {
            let done = self.ivars().done.take();
            let answered = done.is_none();
            self.ivars().done.set(done);
            answered
        }
    }

    thread_local! {
        static PRINTING: RefCell<Vec<Retained<Printed>>> = const { RefCell::new(Vec::new()) };
    }

    #[allow(
        unsafe_code,
        reason = "wry hands the webview and its window out as bare Objective-C pointers"
    )]
    fn held(
        webview: &PlatformWebview,
    ) -> Result<(Retained<WKWebView>, Retained<NSWindow>), String> {
        let (view, window) = unsafe {
            (
                Retained::retain(webview.inner().cast::<WKWebView>()),
                Retained::retain(webview.ns_window().cast::<NSWindow>()),
            )
        };
        view.zip(window)
            .ok_or_else(|| "there was no page to print".into())
    }

    fn lay_out(info: &NSPrintInfo, page: &PdfPage) {
        let (width, height, margin) = sheet_in_points(page);

        info.setOrientation(if on_its_side(width, height) {
            NSPaperOrientation::Landscape
        } else {
            NSPaperOrientation::Portrait
        });
        info.setPaperSize(NSSize::new(width, height));
        info.setTopMargin(margin);
        info.setBottomMargin(margin);
        info.setLeftMargin(margin);
        info.setRightMargin(margin);
        info.setScalingFactor(1.0);
        info.setHorizontallyCentered(false);
        info.setVerticallyCentered(false);
        info.setHorizontalPagination(NSPrintingPaginationMode::Automatic);
        info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
    }

    #[allow(
        unsafe_code,
        reason = "WKWebView's print operation is reached through the Objective-C runtime"
    )]
    fn operation(view: &WKWebView, info: &NSPrintInfo) -> Retained<NSPrintOperation> {
        let operation = unsafe {
            info.dictionary().insert(
                NSPrintHeaderAndFooter,
                NSNumber::new_bool(false).as_ref() as &AnyObject,
            );

            let preferences = view.configuration().preferences();
            if preferences.respondsToSelector(sel!(setShouldPrintBackgrounds:)) {
                preferences.setShouldPrintBackgrounds(true);
            }

            view.printOperationWithPrintInfo(info)
        };

        if let Some(printing) = operation.view() {
            printing.setFrame(view.frame());
        }
        operation
    }

    #[allow(
        unsafe_code,
        reason = "a modal print reports back through an Objective-C selector"
    )]
    fn run(
        operation: &NSPrintOperation,
        window: &NSWindow,
        output: Option<&str>,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let mtm =
            MainThreadMarker::new().ok_or("the print was not asked for on the main thread")?;

        let printed = Printed::new(mtm, output, done);
        PRINTING.with_borrow_mut(|held| {
            held.retain(|one| !one.answered());
            held.push(printed.clone());
        });

        unsafe {
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                window,
                Some(printed.as_ref() as &AnyObject),
                Some(sel!(printOperationDidRun:success:contextInfo:)),
                std::ptr::null_mut(),
            );
        }
        Ok(())
    }

    #[allow(
        unsafe_code,
        reason = "a print info's save settings are an Objective-C dictionary"
    )]
    pub fn print(
        webview: &PlatformWebview,
        output: &str,
        page: &PdfPage,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let (view, window) = held(webview)?;

        let info = NSPrintInfo::new();
        lay_out(&info, page);

        unsafe {
            info.setJobDisposition(NSPrintSaveJob);
            let target = NSURL::fileURLWithPath(&NSString::from_str(output));
            info.dictionary()
                .insert(NSPrintJobSavingURL, target.as_ref() as &AnyObject);
        }

        let operation = operation(&view, &info);
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);

        run(&operation, &window, Some(output), done)
    }

    pub fn dialog(
        webview: &PlatformWebview,
        parent: &tauri::Window,
        page: Option<&PdfPage>,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let (view, _) = held(webview)?;
        let parent = parent
            .ns_window()
            .ok()
            .and_then(|pointer| {
                #[allow(unsafe_code, reason = "tauri hands a window out as a bare pointer")]
                unsafe {
                    Retained::retain(pointer.cast::<NSWindow>())
                }
            })
            .ok_or("there is no window to show the print dialog on")?;

        let info = NSPrintInfo::sharedPrintInfo().copy();
        if let Some(page) = page {
            lay_out(&info, page);
        }

        let operation = operation(&view, &info);
        operation.setShowsPrintPanel(true);
        operation.setShowsProgressPanel(true);

        run(&operation, &parent, None, done)
    }

    pub fn sheet(webview: &PlatformWebview) -> Result<(), String> {
        let (view, window) = held(webview)?;
        let operation = operation(&view, &NSPrintInfo::sharedPrintInfo().copy());
        operation.setShowsPrintPanel(true);
        operation.setShowsProgressPanel(true);

        let (done, _) = std::sync::mpsc::channel();
        run(&operation, &window, None, done)
    }
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub(crate) fn print_sheet(webview: &PlatformWebview) -> Result<(), String> {
    printer::sheet(webview)
}

#[cfg(feature = "cef")]
mod printer {
    use super::{printing, PdfPage, Printable, Value, PATIENCE};
    use base64::Engine as _;
    use std::path::Path;
    use std::sync::mpsc::Sender;

    pub fn available() -> bool {
        true
    }

    pub fn print(
        window: &Printable,
        output: &str,
        page: &PdfPage,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let printed = crate::engine::devtools::call(
            window.as_ref(),
            None,
            "Page.printToPDF",
            &printing(page),
            PATIENCE,
        )?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(
                printed
                    .get("data")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
            .map_err(|error| format!("the engine printed something unreadable: {error}"))?;
        if bytes.is_empty() {
            return Err("the engine printed nothing".into());
        }
        crate::paths::write_atomically(Path::new(output), &bytes)?;
        let _ = done.send(Ok(()));
        Ok(())
    }
}

#[cfg(all(not(any(windows, target_os = "macos")), not(feature = "cef")))]
mod printer {
    use super::PdfPage;
    use std::sync::mpsc::Sender;
    use tauri::webview::PlatformWebview;

    pub fn available() -> bool {
        false
    }

    pub fn print(
        _webview: &PlatformWebview,
        _output: &str,
        _page: &PdfPage,
        _done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        Err("printing to a file is not available here".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{on_its_side, sheet_in_points, PdfPage};

    fn page(width: f64, height: f64, margin: f64, landscape: bool) -> PdfPage {
        PdfPage {
            width,
            height,
            margin,
            landscape,
        }
    }

    #[test]
    fn the_policy_goes_to_the_real_head() {
        let meta = "<meta http-equiv=\"Content-Security-Policy\"";

        let page = "<!-- a <head> in words --><!doctype html><head><script>1</script>";
        assert!(
            super::fenced(page).contains(&format!("<!doctype html><head>{meta}")),
            "{page}"
        );

        let page = "<!doctype html><header><script>1</script></header><head>";
        assert!(
            super::fenced(page).starts_with(&format!("<!doctype html>{meta}")),
            "{page}"
        );

        let page = "<script>1</script><head>";
        assert!(super::fenced(page).starts_with(meta), "{page}");
        let page = "<title><head></title><script>1</script>";
        assert!(super::fenced(page).starts_with(meta), "{page}");

        let page = "<html data-a=\"x>y\"><head data-b='p>q'><p>";
        assert!(
            super::fenced(page).contains(&format!("data-b='p>q'>{meta}")),
            "{page}"
        );

        let page = "<!--><script>1</script><!-- --><head>";
        assert!(super::fenced(page).starts_with(meta), "{page}");

        let page = "\u{feff}\n <!DOCTYPE html>\n<HTML>\n<HEAD\nlang=en>\n<title>t</title>";
        assert!(
            super::fenced(page).contains(&format!("lang=en>{meta}")),
            "{page}"
        );
    }

    #[test]
    fn the_policy_is_first_in_the_page() {
        let meta = "<meta http-equiv=\"Content-Security-Policy\"";
        let page = "<!DOCTYPE html><HTML><HEAD lang=en><title>t</title></HEAD><p>x";
        let fenced = super::fenced(page);
        assert!(fenced.starts_with(&format!("<!DOCTYPE html><HTML><HEAD lang=en>{meta}")));
        assert!(fenced.ends_with("<title>t</title></HEAD><p>x"));

        assert!(super::fenced("<!doctype html><p>x").starts_with(&format!("<!doctype html>{meta}")));
        assert!(super::fenced("<p>x").starts_with(meta));
        assert!(super::PAGE_POLICY.starts_with("default-src 'none'"));
        assert!(!super::PAGE_POLICY.contains("file:"));
    }

    #[test]
    fn the_page_in_the_temp_folder_is_the_run_s_own() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("page.html");
        super::written_alone(&path, "words").expect("a new file");
        assert_eq!(std::fs::read_to_string(&path).expect("the file"), "words");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&path)
                .expect("its mode")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(super::written_alone(&path, "again").is_err());
        assert_eq!(std::fs::read_to_string(&path).expect("the file"), "words");
    }

    #[cfg(feature = "cef")]
    #[test]
    fn chromium_writes_the_file_itself() {
        assert!(super::pdf_supported());
    }

    #[test]
    fn an_upright_sheet_is_measured_in_points() {
        let (width, height, margin) = sheet_in_points(&page(8.27, 11.69, 1.0, false));
        assert!((width - 595.44).abs() < 0.01);
        assert!((height - 841.68).abs() < 0.01);
        assert!((margin - 72.0).abs() < f64::EPSILON);
    }

    #[test]
    fn a_landscape_sheet_is_turned() {
        let (width, height, _) = sheet_in_points(&page(8.5, 11.0, 0.5, true));
        assert!((width - 792.0).abs() < f64::EPSILON);
        assert!((height - 612.0).abs() < f64::EPSILON);
    }

    #[test]
    fn a_sheet_that_already_lies_on_its_side_is_left_alone() {
        let (width, height, margin) = sheet_in_points(&page(10.0, 5.0, 0.0, true));
        assert!((width - 720.0).abs() < f64::EPSILON);
        assert!((height - 360.0).abs() < f64::EPSILON);
        assert!(margin.abs() < f64::EPSILON);
    }

    #[test]
    fn a_wide_sheet_is_on_its_side_whatever_the_page_says() {
        let (width, height, _) = sheet_in_points(&page(1280.0 / 96.0, 720.0 / 96.0, 0.0, false));
        assert!((width - 960.0).abs() < 0.01);
        assert!((height - 540.0).abs() < 0.01);
        assert!(on_its_side(width, height));

        let (width, height, _) = sheet_in_points(&page(8.5, 11.0, 0.5, true));
        assert!(on_its_side(width, height));

        let (width, height, _) = sheet_in_points(&page(8.27, 11.69, 1.0, false));
        assert!(!on_its_side(width, height));
    }

    #[test]
    fn a_negative_margin_is_none() {
        let (_, _, margin) = sheet_in_points(&page(8.5, 11.0, -1.0, false));
        assert!(margin.abs() < f64::EPSILON);
    }
}
