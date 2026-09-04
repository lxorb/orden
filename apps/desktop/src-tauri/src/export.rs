use serde::Deserialize;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Keeps a console window from flashing up on Windows.
// `mut` is only used by the Windows branch below; elsewhere it is dead.
#[cfg_attr(not(windows), allow(unused_mut))]
fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    command
}

/// Converts a document into markdown with pandoc. The format comes from the
/// file's extension, which is what pandoc infers from anyway.
#[tauri::command]
pub fn import_document(path: String) -> Result<String, String> {
    let result = command("pandoc")
        .args([
            "--to",
            "markdown_strict+pipe_tables+backtick_code_blocks+strikeout+task_lists+tex_math_dollars",
            "--wrap",
            "none",
            "--extract-media",
            ".",
            &path,
        ])
        .output()
        .map_err(|e| format!("pandoc could not start: {e}. Is it installed?"))?;

    if result.status.success() {
        return String::from_utf8(result.stdout).map_err(|e| e.to_string());
    }

    let message = String::from_utf8_lossy(&result.stderr);
    Err(if message.trim().is_empty() {
        "pandoc could not read that file".into()
    } else {
        message.trim().to_string()
    })
}

#[tauri::command]
pub fn has_pandoc() -> bool {
    command("pandoc")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Converts markdown with pandoc, the same way Typora does. The source is piped
/// in rather than written to a temp file, so nothing is left behind.
#[tauri::command]
pub fn run_pandoc(source: String, output: String, format: String) -> Result<(), String> {
    let mut child = command("pandoc")
        .args([
            "--from",
            "markdown+tex_math_dollars+pipe_tables+task_lists+footnotes+strikeout",
            "--to",
            &format,
            "--standalone",
            "--output",
            &output,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("pandoc could not start: {e}. Is it installed?"))?;

    child
        .stdin
        .as_mut()
        .ok_or("could not write to pandoc")?
        .write_all(source.as_bytes())
        .map_err(|e| e.to_string())?;

    let result = child.wait_with_output().map_err(|e| e.to_string())?;

    if result.status.success() {
        return Ok(());
    }

    let message = String::from_utf8_lossy(&result.stderr);
    Err(if message.trim().is_empty() {
        "pandoc failed".into()
    } else {
        message.trim().to_string()
    })
}

/// The sheet a PDF is laid out on, in inches. Given upright; the printer
/// turns it when the page is landscape.
#[derive(Clone, Deserialize)]
pub struct PdfPage {
    pub width: f64,
    pub height: f64,
    pub margin: f64,
    pub landscape: bool,
}

/// Whether `print_pdf` can write a file here. WebView2 can print to a file
/// without a dialog; WebKit only offers its print panel.
#[tauri::command]
pub fn pdf_supported() -> bool {
    cfg!(windows)
}

/// Loads a finished page in a window nobody sees and asks the webview's own
/// print engine for a PDF: no dialog, no browser header, and the paper from
/// the settings. The page comes in complete, pictures and fonts inside it, so
/// nothing has to be fetched. It goes through a temporary file because the
/// webview will not take a page this size as a string.
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

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("nib-print-{}-{stamp}.html", std::process::id()));
    std::fs::write(&path, html).map_err(|e| e.to_string())?;

    let url = tauri::Url::from_file_path(&path)
        .map_err(|_| "could not address the temporary page".to_string())?;

    let (done, waited) = mpsc::channel::<Result<(), String>>();
    // The load event can come more than once; the page is printed once.
    let printed = Arc::new(AtomicBool::new(false));

    let window =
        WebviewWindowBuilder::new(&app, format!("print-{stamp}"), WebviewUrl::External(url))
            .title("Nib")
            .visible(false)
            .inner_size(900.0, 1200.0)
            .on_page_load(move |window, payload| {
                if payload.event() != PageLoadEvent::Finished
                    || printed.swap(true, Ordering::SeqCst)
                {
                    return;
                }

                let done = done.clone();
                let output = output.clone();
                let page = page.clone();

                // Fonts and pictures are inline, but the layout still wants a
                // moment to settle before it is measured for paper.
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(300));

                    let failed = done.clone();
                    let asked = window.with_webview(move |webview| {
                        if let Err(error) = printer::print(&webview, &output, &page, done) {
                            let _ = failed.send(Err(error));
                        }
                    });

                    if let Err(error) = asked {
                        let _ = failed_send(&window, error.to_string());
                    }
                });
            })
            .build()
            .map_err(|e| e.to_string())?;

    let outcome =
        tauri::async_runtime::spawn_blocking(move || waited.recv_timeout(Duration::from_secs(45)))
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|_| Err("the PDF took too long to write".into()));

    let _ = window.destroy();
    let _ = std::fs::remove_file(&path);

    outcome
}

/// A failure before the printer was even reached cannot use the channel the
/// closure took with it; closing the window makes the wait give up instead.
fn failed_send(window: &tauri::WebviewWindow, error: String) -> Result<(), String> {
    eprintln!("print_pdf: {error}");
    window.destroy().map_err(|e| e.to_string())
}

#[cfg(windows)]
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

    fn describe(error: windows_core::Error) -> String {
        error.to_string()
    }

    /// Asks WebView2 for the PDF. The answer arrives later, on the channel.
    pub fn print(
        webview: &PlatformWebview,
        output: &str,
        page: &PdfPage,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        unsafe {
            let controller = webview.controller();
            // A hidden window leaves its webview asleep, and a sleeping
            // webview never finishes a print.
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
            // Tinted code and callouts are part of the page; the browser's own
            // title and URL lines are not.
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

#[cfg(not(windows))]
mod printer {
    use super::PdfPage;
    use std::sync::mpsc::Sender;
    use tauri::webview::PlatformWebview;

    pub fn print(
        _webview: &PlatformWebview,
        _output: &str,
        _page: &PdfPage,
        _done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        Err("printing to a file is not available here".into())
    }
}
