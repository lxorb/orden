use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

use orden_base::clock;
use orden_base::paths::{cannot, chosen};

const SETTLE: Duration = Duration::from_millis(300);
const PATIENCE: Duration = Duration::from_secs(45);
static PRINTS: AtomicU32 = AtomicU32::new(0);
#[derive(Clone, Deserialize)]
pub struct PdfPage {
    pub width: f64,
    pub height: f64,
    pub margin: f64,
    pub landscape: bool,
}
type Printable = tauri::WebviewWindow<orden_base::Engine>;
type Building<'a> = WebviewWindowBuilder<'a, orden_base::Engine, AppHandle>;
type Call = fn(
    &tauri::Webview<orden_base::Engine>,
    Option<&str>,
    &str,
    &Value,
    Duration,
) -> Result<Value, String>;
pub struct Engine {
    pub profile: for<'a> fn(Building<'a>) -> Building<'a>,
    pub call: Call,
}
static ENGINE: OnceLock<Engine> = OnceLock::new();
pub fn hand_engine(engine: Engine) {
    let _ = ENGINE.set(engine);
}
#[tauri::command]
pub fn pdf_supported() -> bool {
    true
}
pub fn printing(paper: &PdfPage) -> Value {
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
#[derive(Deserialize)]
struct Writing {
    output: String,
    page: PdfPage,
}
#[tauri::command]
pub async fn print_pdf(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    if !pdf_supported() {
        return Err("printing to a file is not available here".into());
    }
    let (Writing { output, page }, bytes) =
        orden_base::sent::raw_sent::<Writing>(request.headers(), request.body())?;
    let html = String::from_utf8(bytes.into_owned())
        .map_err(|_| "the page to write is not text".to_owned())?;
    let output = chosen(&app, &output)?.to_string_lossy().into_owned();
    in_hidden_window(&app, html, PATIENCE, move |webview, done| {
        printer::print(webview, &output, &page, done)
    })
    .await
    .map_err(
        |error| {
            if error == TOO_LONG {
                "the PDF took too long to write".into()
            } else {
                error
            }
        },
    )
}
const TOO_LONG: &str = "the print took too long";
#[tauri::command]
#[allow(clippy::unused_async)]
pub async fn print_page(
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let (html, page) = printed(&request)?;
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
        orden_base::sent::raw_sent::<Printing>(request.headers(), request.body())?;
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
    let building = match ENGINE.get() {
        Some(engine) => (engine.profile)(building),
        None => building,
    };
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
                if let Err(error) = print(&window, done) {
                    let _ = failed.send(Err(error));
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
mod printer {
    use super::{printing, PdfPage, Printable, Value, ENGINE, PATIENCE};
    use base64::Engine as _;
    use std::path::Path;
    use std::sync::mpsc::Sender;

    pub fn print(
        window: &Printable,
        output: &str,
        page: &PdfPage,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let call = ENGINE.get().ok_or("the engine that prints was never handed over")?.call;
        let printed = call(window.as_ref(), None, "Page.printToPDF", &printing(page), PATIENCE)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(printed.get("data").and_then(Value::as_str).unwrap_or_default())
            .map_err(|error| format!("the engine printed something unreadable: {error}"))?;
        if bytes.is_empty() {
            return Err("the engine printed nothing".into());
        }
        orden_base::paths::write_atomically(Path::new(output), &bytes)?;
        let _ = done.send(Ok(()));
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn the_policy_goes_to_the_real_head() {
        let meta = "<meta http-equiv=\"Content-Security-Policy\"";
        let page = "<!-- a <head> in words --><!doctype html><head><script>1</script>";
        assert!(super::fenced(page).contains(&format!("<!doctype html><head>{meta}")), "{page}");
        let page = "<!doctype html><header><script>1</script></header><head>";
        assert!(super::fenced(page).starts_with(&format!("<!doctype html>{meta}")), "{page}");
        let page = "<script>1</script><head>";
        assert!(super::fenced(page).starts_with(meta), "{page}");
        let page = "<title><head></title><script>1</script>";
        assert!(super::fenced(page).starts_with(meta), "{page}");
        let page = "<html data-a=\"x>y\"><head data-b='p>q'><p>";
        assert!(super::fenced(page).contains(&format!("data-b='p>q'>{meta}")), "{page}");
        let page = "<!--><script>1</script><!-- --><head>";
        assert!(super::fenced(page).starts_with(meta), "{page}");
        let page = "\u{feff}\n <!DOCTYPE html>\n<HTML>\n<HEAD\nlang=en>\n<title>t</title>";
        assert!(super::fenced(page).contains(&format!("lang=en>{meta}")), "{page}");
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
            let mode = std::fs::metadata(&path).expect("its mode").permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(super::written_alone(&path, "again").is_err());
        assert_eq!(std::fs::read_to_string(&path).expect("the file"), "words");
    }
    #[test]
    fn chromium_writes_the_file_itself() {
        assert!(super::pdf_supported());
    }
}
