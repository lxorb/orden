//! A web tab's page drawn under the app's own page, on Windows (#1137).
//!
//! A windowed `WebView2` page is a child window over the app's, and Windows draws a child
//! window over every pixel of its parent: a menu, a sheet or the tab overview over a page
//! had to be cut out of it or stand in front of a still picture of it. Here a page is
//! hosted as a `DirectComposition` visual instead (`CreateCoreWebView2CompositionController`,
//! chosen by label in the vendored wry, `windows/wry`). Every page of a window is a visual
//! in one tree, the window's, whose target is made *under* the window's children
//! (`CreateTargetForHwnd(.., topmost = false)`), and the app's own webview is the
//! transparent child window drawn over that tree. So whatever of the app's page is not
//! transparent is drawn over the live page, the way a browser draws its menus, and the
//! page shows wherever the app leaves a hole for it (lib/web-tab/underlay.ts).
//!
//! The window wry made to hold the page stays where it always was, at the page's place
//! and over the app's webview, and draws nothing: it is where the page's input arrives.
//! Its subclass here hands the page its mouse and wheel (`SendMouseInput`), touch and pen
//! (`SendPointerInput`), its cursor (`CursorChanged`), its accessibility tree
//! (`AutomationProvider`) and what is dragged over it (`Drag*`), and puts the visual where
//! the window is whenever the window moves, so every placement of a page is followed by
//! its picture in the same commit. The cut the app's layers make in a page (`web_cut.rs`)
//! is that window's region, which now only says where the page takes input. The keyboard,
//! the IME and the page's own popups are the engine's, as they are for a windowed page.
//!
//! Under `NIB_PAGES_UNDER=1` for now; without it every page is windowed, as before.

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::sync::{Mutex, PoisonError};

use tauri::{Manager, Runtime, Webview};
use webview2_com::CursorChangedEventHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2CompositionController, ICoreWebView2CompositionController2,
    ICoreWebView2CompositionController3, ICoreWebView2Controller, ICoreWebView2Environment3,
    ICoreWebView2PointerInfo, COREWEBVIEW2_MOUSE_EVENT_KIND, COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS, COREWEBVIEW2_POINTER_EVENT_KIND,
};
use windows_com::core::Interface;
use windows_com::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_com::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice2, IDCompositionDesktopDevice, IDCompositionRectangleClip,
    IDCompositionTarget, IDCompositionVisual2, IDCompositionVisual3,
};
use windows_com::Win32::Graphics::Gdi::{MapWindowPoints, ScreenToClient};
use windows_com::Win32::System::Ole::{
    IDropTarget, OleInitialize, RegisterDragDrop, RevokeDragDrop,
};
use windows_com::Win32::UI::Accessibility::{
    IRawElementProviderSimple, UiaReturnRawElementProvider, UiaRootObjectId,
};
use windows_com::Win32::UI::Input::KeyboardAndMouse::{
    GetCapture, ReleaseCapture, SetCapture, TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT,
};
use windows_com::Win32::UI::Input::Pointer::{
    GetPointerDeviceRects, GetPointerInfo, GetPointerPenInfo, GetPointerTouchInfo, GetPointerType,
    POINTER_INFO, POINTER_PEN_INFO, POINTER_TOUCH_INFO,
};
use windows_com::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows_com::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClientRect, GetCursorPos, SetCursor, WindowFromPoint, GA_ROOT, HCURSOR,
    HTCLIENT, POINTER_INPUT_TYPE, PT_PEN, PT_TOUCH, WM_GETOBJECT, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN,
    WM_LBUTTONUP, WM_MBUTTONDBLCLK, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEHWHEEL, WM_MOUSEMOVE,
    WM_MOUSEWHEEL, WM_NCDESTROY, WM_POINTERACTIVATE, WM_POINTERDOWN, WM_POINTERENTER,
    WM_POINTERLEAVE, WM_POINTERUP, WM_POINTERUPDATE, WM_RBUTTONDBLCLK, WM_RBUTTONDOWN,
    WM_RBUTTONUP, WM_SETCURSOR, WM_WINDOWPOSCHANGED, WM_XBUTTONDBLCLK, WM_XBUTTONDOWN,
    WM_XBUTTONUP,
};

/// The switch, read once.
pub(crate) fn pages_drawn_under() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("NIB_PAGES_UNDER").is_some_and(|said| said == "1"))
}

/// Which webviews are drawn under the app: a tab's page, and nothing else - an extension's
/// popup and the page that holds the session open stay windowed.
fn drawn_under(label: &str) -> bool {
    label.starts_with(crate::web_tabs::LABEL)
}

/// Says to wry which pages it builds as visuals, before the first is built.
pub(crate) fn arm_visuals() {
    if pages_drawn_under() {
        wry::host_as_visual(drawn_under);
    }
}

/// The pointer left a window, as the common controls name it.
const WM_MOUSELEAVE: u32 = 0x02A3;

/// This file's mark among the page window's subclasses.
const OURS: usize = 0x7669_7375;

/// One page drawn as a visual.
struct Page {
    composition: ICoreWebView2CompositionController,
    controller: ICoreWebView2Controller,
    visual: IDCompositionVisual2,
    clip: IDCompositionRectangleClip,
    /// The window whose tree it is in.
    top: isize,
    label: String,
    cursor: HCURSOR,
    /// Whether the pointer's leaving is being listened for.
    tracking: bool,
    corner: f32,
    opacity: f32,
}

/// One window's tree: its target and the visual every page of it hangs under.
struct Tree {
    _target: IDCompositionTarget,
    root: IDCompositionVisual2,
}

/// Everything here lives on the window's thread, which is the only one that touches it.
#[derive(Default)]
struct Composed {
    device: Option<IDCompositionDesktopDevice>,
    trees: HashMap<isize, Tree>,
    pages: HashMap<isize, Page>,
}

thread_local! {
    static COMPOSED: RefCell<Composed> = RefCell::new(Composed::default());
}

fn composed<T>(with: impl FnOnce(&mut Composed) -> T) -> T {
    COMPOSED.with_borrow_mut(with)
}

/// The window wry made for a page, which holds its controller.
#[allow(
    unsafe_code,
    reason = "the controller's window is asked through WebView2's COM interface"
)]
fn holder_window(controller: &ICoreWebView2Controller) -> Option<HWND> {
    let mut held = HWND::default();
    // Safe: a live controller, asked for a window it owns.
    unsafe { controller.ParentWindow(&raw mut held) }.ok()?;
    (!held.is_invalid()).then_some(held)
}

/// The labels of the pages drawn under the app, for any thread to ask.
static UNDER: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

/// Whether a page is drawn under the app; what the window is answered with for it.
pub(crate) fn is_drawn_under(label: &str) -> bool {
    UNDER
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .contains(label)
}

/// A page just built: drawn into its window's tree and handed its input, where wry built
/// it as a visual. Every other webview is left as it is. On the window's own thread, where
/// `with_webview` runs at once.
pub(crate) fn host_page<R: Runtime>(view: &Webview<R>) {
    let label = view.label().to_string();
    let _ =
        crate::engine::with_platform!(view, move |platform: tauri::webview::PlatformWebview| {
            let controller = platform.controller();
            let Ok(composition) = controller.cast::<ICoreWebView2CompositionController>() else {
                return;
            };
            let environment = platform.environment();
            match draw_page_under(&controller, &composition, environment.cast().ok(), &label) {
                Ok(()) => {
                    UNDER
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .insert(label);
                }
                Err(error) => {
                    eprintln!("web_visual: {label} could not be drawn under the window: {error}");
                }
            }
        });
    if is_drawn_under(view.label()) {
        clear_grounds(view);
    }
}

/// The app's own webview with nothing of its own behind its page, and the window with no
/// colour of its own: the page's HTML paints every ground it has, and where it leaves a
/// hole the page drawn under it shows. A window opened before it had a material paints a
/// remembered colour on both, to be on screen before its page (ground.rs), and that colour
/// stood over the page.
fn clear_grounds<R: Runtime>(view: &Webview<R>) {
    let window = view.window();
    let _ = window.set_background_color(None);
    if let Some(own) = view.app_handle().get_webview(window.label()) {
        let _ = own.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
    }
}

#[allow(
    unsafe_code,
    reason = "DirectComposition, the page's window and its subclass are reached only through Win32 and COM"
)]
fn draw_page_under(
    controller: &ICoreWebView2Controller,
    composition: &ICoreWebView2CompositionController,
    environment: Option<ICoreWebView2Environment3>,
    label: &str,
) -> windows_com::core::Result<()> {
    let window = holder_window(controller).ok_or_else(windows_com::core::Error::empty)?;
    // Safe: a live window of this thread, asked for its top-level window.
    let top = unsafe { GetAncestor(window, GA_ROOT) };
    let visual = composed(|all| -> windows_com::core::Result<IDCompositionVisual2> {
        let device = composition_device(all)?;
        let root = tree_of_window(all, &device, top)?;
        // Safe: objects of the one device, made and joined on this thread.
        unsafe {
            let visual = device.CreateVisual()?;
            root.AddVisual(&visual, false, None)?;
            Ok(visual)
        }
    })?;
    let clip = composed(|all| {
        let device = composition_device(all)?;
        // Safe: as above.
        unsafe {
            let clip = device.CreateRectangleClip()?;
            visual.SetClip(&clip)?;
            Ok::<_, windows_com::core::Error>(clip)
        }
    })?;
    // Safe: the page's own controller, given the visual it draws into.
    unsafe { composition.SetRootVisualTarget(&visual)? };

    let key = window.0 as isize;
    composed(|all| {
        all.pages.insert(
            key,
            Page {
                composition: composition.clone(),
                controller: controller.clone(),
                visual,
                clip,
                top: top.0 as isize,
                label: label.to_string(),
                cursor: HCURSOR::default(),
                tracking: false,
                corner: 0.0,
                opacity: 1.0,
            },
        );
    });
    let _ = ENVIRONMENTS.with_borrow_mut(|all| all.insert(key, environment));

    // Safe: the page's window, of this thread, given this file's subclass, which takes
    // itself off as the window goes; and the engine's own cursor event, for the window.
    unsafe {
        let _ = SetWindowSubclass(window, Some(page_window_heard), OURS, 0);
        let mut token = 0_i64;
        let handler = CursorChangedEventHandler::create(Box::new(move |sender, _| {
            if let Some(sender) = sender {
                cursor_changed(key, &sender);
            }
            Ok(())
        }));
        let _ = composition.add_CursorChanged(&handler, &raw mut token);
        let _ = OleInitialize(None);
        if let Ok(three) = composition.cast::<ICoreWebView2CompositionController3>() {
            let target: IDropTarget = dropping::Dropping {
                page: three,
                window: key,
            }
            .into();
            let _ = RegisterDragDrop(window, &target);
        }
    }
    place_visual(window);
    Ok(())
}

thread_local! {
    /// The environment each page was built in, which makes its pointer events.
    static ENVIRONMENTS: RefCell<HashMap<isize, Option<ICoreWebView2Environment3>>> =
        RefCell::new(HashMap::new());
}

#[allow(
    unsafe_code,
    reason = "DirectComposition's device is made through Win32"
)]
fn composition_device(all: &mut Composed) -> windows_com::core::Result<IDCompositionDesktopDevice> {
    if let Some(device) = &all.device {
        return Ok(device.clone());
    }
    // Safe: a device of our own with no rendering device, which a webview's visual needs
    // none of: the engine draws into it with its own.
    let device: IDCompositionDesktopDevice = unsafe { DCompositionCreateDevice2(None)? };
    all.device = Some(device.clone());
    Ok(device)
}

#[allow(
    unsafe_code,
    reason = "a window's composition target is made through DirectComposition"
)]
fn tree_of_window(
    all: &mut Composed,
    device: &IDCompositionDesktopDevice,
    top: HWND,
) -> windows_com::core::Result<IDCompositionVisual2> {
    let key = top.0 as isize;
    if let Some(tree) = all.trees.get(&key) {
        return Ok(tree.root.clone());
    }
    // Safe: the window's own target, under its children, so the app's webview is drawn
    // over every page; one per window, made on its thread.
    unsafe {
        let target = device.CreateTargetForHwnd(top, false)?;
        let root = device.CreateVisual()?;
        target.SetRoot(&root)?;
        all.trees.insert(
            key,
            Tree {
                _target: target,
                root: root.clone(),
            },
        );
        Ok(root)
    }
}

/// The page's corner, in the window's units at `scale`: the card's, at its two bottom
/// corners.
pub(crate) fn visual_corner(view: &Webview, corner: f64, scale: f64) {
    #[allow(clippy::cast_possible_truncation)]
    let corner = (corner.max(0.0) * scale) as f32;
    change_page(view, move |page| page.corner = corner);
}

/// How much of the page shows: the opacity of the hole the window draws it in.
pub(crate) fn visual_opacity(view: &Webview, opacity: f64) {
    #[allow(clippy::cast_possible_truncation)]
    let opacity = opacity.clamp(0.0, 1.0) as f32;
    change_page(view, move |page| page.opacity = opacity);
}

fn change_page(view: &Webview, change: impl FnOnce(&mut Page) + Send + 'static) {
    let _ = view.with_webview(move |platform| {
        let Some(window) = holder_window(&platform.controller()) else {
            return;
        };
        let changed = composed(|all| {
            all.pages
                .get_mut(&(window.0 as isize))
                .map(change)
                .is_some()
        });
        if changed {
            place_visual(window);
        }
    });
}

/// The page's visual where its window is now, at its size, corner and opacity, committed.
#[allow(
    unsafe_code,
    reason = "the window's place is read through Win32 and the visual moved through DirectComposition"
)]
fn place_visual(window: HWND) {
    let key = window.0 as isize;
    let mut rect = RECT::default();
    let mut at = [POINT::default()];
    // Safe: a live window of this thread, its place read in its top-level window's
    // coordinates.
    let placed = unsafe {
        GetClientRect(window, &raw mut rect).is_ok() && {
            let top = GetAncestor(window, GA_ROOT);
            MapWindowPoints(Some(window), Some(top), &mut at);
            true
        }
    };
    if !placed {
        return;
    }
    let failed = composed(|all| {
        let Some(page) = all.pages.get(&key) else {
            return false;
        };
        #[allow(clippy::cast_precision_loss)]
        let (x, y, wide, tall) = (
            at[0].x as f32,
            at[0].y as f32,
            rect.right as f32,
            rect.bottom as f32,
        );
        let round = page.corner.min(wide / 2.0).min(tall / 2.0);
        // Safe: this page's own visual and clip, of the one device, on this thread.
        let done = unsafe {
            (|| -> windows_com::core::Result<()> {
                page.visual.SetOffsetX2(x)?;
                page.visual.SetOffsetY2(y)?;
                page.clip.SetLeft2(0.0)?;
                page.clip.SetTop2(0.0)?;
                page.clip.SetRight2(wide)?;
                page.clip.SetBottom2(tall)?;
                for radius in [
                    IDCompositionRectangleClip::SetBottomLeftRadiusX2,
                    IDCompositionRectangleClip::SetBottomLeftRadiusY2,
                    IDCompositionRectangleClip::SetBottomRightRadiusX2,
                    IDCompositionRectangleClip::SetBottomRightRadiusY2,
                ] {
                    radius(&page.clip, round)?;
                }
                if let Ok(three) = page.visual.cast::<IDCompositionVisual3>() {
                    three.SetOpacity2(page.opacity)?;
                }
                match &all.device {
                    Some(device) => device.Commit(),
                    None => Ok(()),
                }
            })()
        };
        done.is_err()
    });
    if failed {
        rebuild_visuals();
    }
}

/// The device lost - the system's compositor restarted, the adapter reset: a new device,
/// a new tree for every window, and every page given a new visual in it.
#[allow(
    unsafe_code,
    reason = "each page is handed its new visual through WebView2's COM interface"
)]
fn rebuild_visuals() {
    let windows: Vec<(isize, isize)> = composed(|all| {
        all.device = None;
        all.trees.clear();
        all.pages
            .iter()
            .map(|(window, page)| (*window, page.top))
            .collect()
    });
    for (window, top) in windows {
        let made = composed(|all| -> windows_com::core::Result<()> {
            let device = composition_device(all)?;
            let root = tree_of_window(all, &device, HWND(top as *mut core::ffi::c_void))?;
            let Some(page) = all.pages.get_mut(&window) else {
                return Ok(());
            };
            // Safe: objects of the new device, on this thread, and the page's own
            // controller handed the visual it draws into from now on.
            unsafe {
                let visual = device.CreateVisual()?;
                let clip = device.CreateRectangleClip()?;
                visual.SetClip(&clip)?;
                root.AddVisual(&visual, false, None)?;
                page.composition.SetRootVisualTarget(&visual)?;
                page.visual = visual;
                page.clip = clip;
            }
            Ok(())
        });
        if made.is_ok() {
            place_visual(HWND(window as *mut core::ffi::c_void));
        }
    }
}

fn low_word(value: usize) -> u32 {
    u32::try_from(value & 0xffff).unwrap_or(0)
}

#[allow(clippy::cast_possible_truncation)]
fn high_word(value: usize) -> u16 {
    ((value >> 16) & 0xffff) as u16
}

#[allow(clippy::cast_possible_truncation)]
fn point_of(lparam: LPARAM) -> POINT {
    POINT {
        x: i32::from(lparam.0 as i16),
        y: i32::from((lparam.0 >> 16) as i16),
    }
}

/// Every button of the mouse a message says is down.
const BUTTONS: u32 = 0x0001 | 0x0002 | 0x0010 | 0x0020 | 0x0040;

/// What arrives at a page's window: handed to the page, or on to wry's own procedure.
#[allow(
    unsafe_code,
    reason = "a subclass procedure is called by Windows with the window's own message, and the page is handed it through WebView2's COM interface"
)]
unsafe extern "system" fn page_window_heard(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    let key = window.0 as isize;
    let Some((composition, controller)) = composed(|all| {
        all.pages
            .get(&key)
            .map(|page| (page.composition.clone(), page.controller.clone()))
    }) else {
        // Safe: handing the message on is what a subclass owes the window.
        return unsafe { DefSubclassProc(window, message, wparam, lparam) };
    };

    match message {
        WM_MOUSEMOVE | WM_LBUTTONDOWN | WM_LBUTTONUP | WM_LBUTTONDBLCLK | WM_RBUTTONDOWN
        | WM_RBUTTONUP | WM_RBUTTONDBLCLK | WM_MBUTTONDOWN | WM_MBUTTONUP | WM_MBUTTONDBLCLK
        | WM_XBUTTONDOWN | WM_XBUTTONUP | WM_XBUTTONDBLCLK | WM_MOUSEWHEEL | WM_MOUSEHWHEEL => {
            mouse_to_page(
                key,
                window,
                message,
                wparam,
                lparam,
                &composition,
                &controller,
            );
            LRESULT(0)
        }
        WM_MOUSELEAVE => {
            composed(|all| {
                if let Some(page) = all.pages.get_mut(&key) {
                    page.tracking = false;
                }
            });
            // Safe: the page told the pointer has left it.
            let _ = unsafe {
                composition.SendMouseInput(
                    COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE,
                    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS(0),
                    0,
                    POINT::default(),
                )
            };
            LRESULT(0)
        }
        WM_POINTERACTIVATE | WM_POINTERDOWN | WM_POINTERENTER | WM_POINTERLEAVE | WM_POINTERUP
        | WM_POINTERUPDATE => {
            if pointer_to_page(key, window, message, wparam, &composition) {
                LRESULT(0)
            } else {
                // A mouse's pointer: on to the window, which makes the mouse's own
                // messages of it, handed to the page above.
                // Safe: as above.
                unsafe { DefSubclassProc(window, message, wparam, lparam) }
            }
        }
        WM_SETCURSOR if low_word(usize::try_from(lparam.0).unwrap_or(0)) == HTCLIENT => {
            let cursor = composed(|all| all.pages.get(&key).map(|page| page.cursor));
            match cursor {
                Some(cursor) if !cursor.is_invalid() => {
                    // Safe: the cursor the engine handed over for its page.
                    unsafe { SetCursor(Some(cursor)) };
                    LRESULT(1)
                }
                // Safe: as above.
                _ => unsafe { DefSubclassProc(window, message, wparam, lparam) },
            }
        }
        #[allow(clippy::cast_possible_truncation)]
        WM_GETOBJECT if lparam.0 as i32 == UiaRootObjectId => {
            let provider = composition
                .cast::<ICoreWebView2CompositionController2>()
                // Safe: the page's own tree for assistive technology, handed over to it.
                .and_then(|two| unsafe { two.AutomationProvider() })
                .and_then(|provider| provider.cast::<IRawElementProviderSimple>());
            match provider {
                // Safe: as above.
                Ok(provider) => unsafe {
                    UiaReturnRawElementProvider(window, wparam, lparam, &provider)
                },
                // Safe: as above.
                Err(_) => unsafe { DefSubclassProc(window, message, wparam, lparam) },
            }
        }
        WM_WINDOWPOSCHANGED => {
            // Safe: as above.
            let answer = unsafe { DefSubclassProc(window, message, wparam, lparam) };
            place_visual(window);
            answer
        }
        WM_NCDESTROY => {
            visual_gone(key);
            // Safe: this subclass taken off its own window as the window goes, and the
            // window's drop target with it.
            unsafe {
                let _ = RevokeDragDrop(window);
                let _ = RemoveWindowSubclass(window, Some(page_window_heard), OURS);
                DefSubclassProc(window, message, wparam, lparam)
            }
        }
        // Safe: as above.
        _ => unsafe { DefSubclassProc(window, message, wparam, lparam) },
    }
}

/// A message of the mouse's handed to the page: where, which buttons and keys, how far a
/// wheel turned. A press takes the keyboard into the page and holds the pointer until the
/// last button is let go, as a windowed page does.
#[allow(
    unsafe_code,
    reason = "the window is asked and changed through Win32, and the press handed on through WebView2's COM interface"
)]
fn mouse_to_page(
    key: isize,
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    composition: &ICoreWebView2CompositionController,
    controller: &ICoreWebView2Controller,
) {
    let mut point = point_of(lparam);
    let keys = low_word(wparam.0);
    // Safe: questions and changes about this thread's own window, and the press
    // handed to its own page.
    unsafe {
        if matches!(message, WM_MOUSEWHEEL | WM_MOUSEHWHEEL) {
            let _ = ScreenToClient(window, &raw mut point);
        }
        if message == WM_MOUSEMOVE {
            let tracking = composed(|all| {
                all.pages
                    .get_mut(&key)
                    .is_some_and(|page| std::mem::replace(&mut page.tracking, true))
            });
            if !tracking {
                let mut track = TRACKMOUSEEVENT {
                    cbSize: u32::try_from(std::mem::size_of::<TRACKMOUSEEVENT>()).unwrap_or(0),
                    dwFlags: TME_LEAVE,
                    hwndTrack: window,
                    dwHoverTime: 0,
                };
                let _ = TrackMouseEvent(&raw mut track);
            }
        }
        let down = matches!(
            message,
            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN
        );
        if down {
            // The keyboard follows a press into the page, as it does into a
            // windowed one.
            crate::placement::keyboard_into(controller);
            SetCapture(window);
        }
        let data = match message {
            WM_MOUSEWHEEL | WM_MOUSEHWHEEL | WM_XBUTTONDOWN | WM_XBUTTONUP | WM_XBUTTONDBLCLK => {
                u32::from(high_word(wparam.0))
            }
            _ => 0,
        };
        // The engine's kinds of mouse event are the messages' own numbers, and its
        // keys the message's.
        #[allow(clippy::cast_possible_wrap)]
        let _ = composition.SendMouseInput(
            COREWEBVIEW2_MOUSE_EVENT_KIND(message as i32),
            COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS(keys as i32),
            data,
            point,
        );
        let up = matches!(
            message,
            WM_LBUTTONUP | WM_RBUTTONUP | WM_MBUTTONUP | WM_XBUTTONUP
        );
        if up && keys & BUTTONS == 0 && GetCapture() == window {
            let _ = ReleaseCapture();
        }
    }
}

/// A page's window closed: its visual leaves the tree, and the tree goes with the window's
/// last page.
#[allow(
    unsafe_code,
    reason = "a visual is taken out of its tree through DirectComposition"
)]
fn visual_gone(key: isize) {
    composed(|all| {
        let Some(page) = all.pages.remove(&key) else {
            return;
        };
        UNDER
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&page.label);
        if let Some(tree) = all.trees.get(&page.top) {
            // Safe: this page's visual, out of the tree it was put in, on this thread.
            unsafe {
                let _ = tree.root.RemoveVisual(&page.visual);
            }
        }
        if !all.pages.values().any(|one| one.top == page.top) {
            all.trees.remove(&page.top);
        }
        if let Some(device) = &all.device {
            // Safe: as above.
            let _ = unsafe { device.Commit() };
        }
    });
    let _ = ENVIRONMENTS.with_borrow_mut(|all| all.remove(&key));
}

/// The engine changed the page's cursor: kept for the window's next `WM_SETCURSOR`, and
/// shown at once where the pointer is over the page.
#[allow(
    unsafe_code,
    reason = "the cursor is read through WebView2's COM interface and set through Win32"
)]
fn cursor_changed(key: isize, sender: &ICoreWebView2CompositionController) {
    let mut cursor = HCURSOR::default();
    // Safe: the page's own controller, asked for the cursor it wants.
    if unsafe { sender.Cursor(&raw mut cursor) }.is_err() {
        return;
    }
    composed(|all| {
        if let Some(page) = all.pages.get_mut(&key) {
            page.cursor = cursor;
        }
    });
    let mut at = POINT::default();
    // Safe: where the pointer is, and which window is under it.
    unsafe {
        if GetCursorPos(&raw mut at).is_ok() && WindowFromPoint(at).0 as isize == key {
            SetCursor(Some(cursor));
        }
    }
}

/// A touch or a pen on the page, handed to it whole: where, how hard, at what tilt. False
/// for a mouse's pointer, which the window turns into mouse messages.
#[allow(
    unsafe_code,
    reason = "the pointer is read through Win32 and handed to the page through WebView2's COM interface"
)]
fn pointer_to_page(
    key: isize,
    window: HWND,
    message: u32,
    wparam: WPARAM,
    composition: &ICoreWebView2CompositionController,
) -> bool {
    let id = low_word(wparam.0);
    let Some(Some(environment)) = ENVIRONMENTS.with_borrow(|all| all.get(&key).cloned()) else {
        return false;
    };
    // Safe: the pointer's own record, read for the message it came with, into structures
    // of the size each call says, and handed to the page's own controller.
    unsafe {
        let mut kind = POINTER_INPUT_TYPE::default();
        if GetPointerType(id, &raw mut kind).is_err() || (kind != PT_TOUCH && kind != PT_PEN) {
            return false;
        }
        let Ok(info) = environment.CreateCoreWebView2PointerInfo() else {
            return false;
        };
        let mut given = POINTER_INFO::default();
        let mut touch = POINTER_TOUCH_INFO::default();
        let mut pen = POINTER_PEN_INFO::default();
        let read = if kind == PT_TOUCH {
            GetPointerTouchInfo(id, &raw mut touch).map(|()| touch.pointerInfo)
        } else {
            GetPointerPenInfo(id, &raw mut pen).map(|()| pen.pointerInfo)
        };
        match read {
            Ok(one) => given = one,
            Err(_) => {
                if GetPointerInfo(id, &raw mut given).is_err() {
                    return false;
                }
            }
        }

        let mut device = RECT::default();
        let mut display = RECT::default();
        let _ = GetPointerDeviceRects(given.sourceDevice, &raw mut device, &raw mut display);
        let local = |mut at: POINT| {
            let _ = ScreenToClient(window, &raw mut at);
            at
        };
        // A himetric point in the page: the device's units per pixel of the display it maps
        // onto, at the page's pixel.
        let himetric = |at: POINT| {
            let wide = f64::from((display.right - display.left).max(1));
            let tall = f64::from((display.bottom - display.top).max(1));
            let across = f64::from(device.right - device.left) / wide;
            let down = f64::from(device.bottom - device.top) / tall;
            let at = local(at);
            #[allow(clippy::cast_possible_truncation)]
            POINT {
                x: (f64::from(at.x) * across) as i32,
                y: (f64::from(at.y) * down) as i32,
            }
        };
        #[allow(clippy::cast_sign_loss)]
        let set = (|| -> windows_com::core::Result<()> {
            info.SetPointerKind(kind.0 as u32)?;
            info.SetPointerId(given.pointerId)?;
            info.SetFrameId(given.frameId)?;
            info.SetPointerFlags(given.pointerFlags.0)?;
            info.SetPointerDeviceRect(device)?;
            info.SetDisplayRect(display)?;
            info.SetPixelLocation(local(given.ptPixelLocation))?;
            info.SetHimetricLocation(himetric(given.ptPixelLocation))?;
            info.SetPixelLocationRaw(local(given.ptPixelLocationRaw))?;
            info.SetHimetricLocationRaw(himetric(given.ptPixelLocationRaw))?;
            info.SetTime(given.dwTime)?;
            info.SetHistoryCount(given.historyCount)?;
            info.SetInputData(given.InputData)?;
            info.SetKeyStates(given.dwKeyStates)?;
            info.SetPerformanceCount(given.PerformanceCount)?;
            info.SetButtonChangeKind(given.ButtonChangeType.0)?;
            pointer_detail(&info, kind == PT_TOUCH, &touch, &pen, window)?;
            // The engine's kinds of pointer event are the messages' own numbers.
            #[allow(clippy::cast_possible_wrap)]
            composition.SendPointerInput(COREWEBVIEW2_POINTER_EVENT_KIND(message as i32), &info)
        })();
        set.is_ok()
    }
}

/// What a touch or a pen says beyond where it is: a finger's contact and pressure, a pen's
/// pressure, rotation and tilt.
#[allow(
    unsafe_code,
    reason = "the pointer's record is handed to the page through WebView2's COM interface"
)]
fn pointer_detail(
    info: &ICoreWebView2PointerInfo,
    touching: bool,
    touch: &POINTER_TOUCH_INFO,
    pen: &POINTER_PEN_INFO,
    window: HWND,
) -> windows_com::core::Result<()> {
    let local = |mut at: POINT| {
        // Safe: a point made this thread's own window's.
        let _ = unsafe { ScreenToClient(window, &raw mut at) };
        at
    };
    let contact = |rect: RECT| {
        let from = local(POINT {
            x: rect.left,
            y: rect.top,
        });
        let to = local(POINT {
            x: rect.right,
            y: rect.bottom,
        });
        RECT {
            left: from.x,
            top: from.y,
            right: to.x,
            bottom: to.y,
        }
    };
    // Safe: the engine's own record of a pointer, filled in.
    unsafe {
        if touching {
            info.SetTouchFlags(touch.touchFlags)?;
            info.SetTouchMask(touch.touchMask)?;
            info.SetTouchContact(contact(touch.rcContact))?;
            info.SetTouchContactRaw(contact(touch.rcContactRaw))?;
            info.SetTouchOrientation(touch.orientation)?;
            info.SetTouchPressure(touch.pressure)
        } else {
            info.SetPenFlags(pen.penFlags)?;
            info.SetPenMask(pen.penMask)?;
            info.SetPenPressure(pen.pressure)?;
            info.SetPenRotation(pen.rotation)?;
            info.SetPenTiltX(pen.tiltX)?;
            info.SetPenTiltY(pen.tiltY)
        }
    }
}

/// The drop target a page's window is given; see `Dropping`.
mod dropping {
    #![allow(
        unsafe_code,
        clippy::ref_as_ptr,
        clippy::inline_always,
        reason = "a COM object's methods are called by the system through its vtable, which `implement` writes, and each hands the drag on to the page through WebView2's COM interface"
    )]

    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2CompositionController3;
    use windows_com::core::{implement, Ref};
    use windows_com::Win32::Foundation::{HWND, POINT, POINTL};
    use windows_com::Win32::Graphics::Gdi::ScreenToClient;
    use windows_com::Win32::System::Com::IDataObject;
    use windows_com::Win32::System::Ole::{IDropTarget, IDropTarget_Impl, DROPEFFECT};
    use windows_com::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;

    /// What is dragged over a page, handed to the page: a file from Explorer, a link, a tab's
    /// own drag. Its points are the page's own, from the screen's.
    #[implement(IDropTarget)]
    pub(super) struct Dropping {
        pub(super) page: ICoreWebView2CompositionController3,
        pub(super) window: isize,
    }

    impl Dropping {
        fn local(&self, at: &POINTL) -> POINT {
            let mut point = POINT { x: at.x, y: at.y };
            // Safe: this page's own window, on its thread.
            unsafe {
                let _ = ScreenToClient(HWND(self.window as *mut core::ffi::c_void), &raw mut point);
            }
            point
        }
    }

    impl IDropTarget_Impl for Dropping_Impl {
        fn DragEnter(
            &self,
            data: Ref<'_, IDataObject>,
            keys: MODIFIERKEYS_FLAGS,
            at: &POINTL,
            effect: *mut DROPEFFECT,
        ) -> windows_com::core::Result<()> {
            // Safe: the page's own controller, handed what the system handed this target.
            unsafe {
                self.page
                    .DragEnter(data.as_ref(), keys.0, self.local(at), effect.cast())
            }
        }

        fn DragOver(
            &self,
            keys: MODIFIERKEYS_FLAGS,
            at: &POINTL,
            effect: *mut DROPEFFECT,
        ) -> windows_com::core::Result<()> {
            // Safe: as above.
            unsafe { self.page.DragOver(keys.0, self.local(at), effect.cast()) }
        }

        fn DragLeave(&self) -> windows_com::core::Result<()> {
            // Safe: as above.
            unsafe { self.page.DragLeave() }
        }

        fn Drop(
            &self,
            data: Ref<'_, IDataObject>,
            keys: MODIFIERKEYS_FLAGS,
            at: &POINTL,
            effect: *mut DROPEFFECT,
        ) -> windows_com::core::Result<()> {
            // Safe: as above.
            unsafe {
                self.page
                    .Drop(data.as_ref(), keys.0, self.local(at), effect.cast())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{high_word, low_word, point_of};
    use windows_com::Win32::Foundation::LPARAM;

    #[test]
    fn a_message_s_point_is_signed() {
        let point = point_of(LPARAM(0xFFFB_FFFD));
        assert_eq!((point.x, point.y), (-3, -5));
    }

    #[test]
    fn a_wheel_s_turn_is_its_high_word() {
        let wparam = (120_usize << 16) | 0x0008;
        assert_eq!((high_word(wparam), low_word(wparam)), (120, 0x0008));
    }
}
