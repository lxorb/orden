use std::collections::HashMap;
use std::ffi::{c_void, CString};
use std::sync::{LazyLock, Mutex};

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{msg_send, sel};
use objc2_app_kit::{NSView, NSWindowOrderingMode};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use orden_base::Held as _;
use tauri::{Manager as _, Webview};

use super::Cut;

const PREFIX: &str = "OrdenUnder_";
const UNSEEN: f64 = 0.01;
struct Page {
    label: String,
    host: usize,
    cut: Option<Cut>,
    wide: f64,
}
static PAGES: LazyLock<Mutex<HashMap<usize, Page>>> = LazyLock::new(Mutex::default);
fn address(view: &NSView) -> usize {
    std::ptr::from_ref(view).addr()
}
#[allow(unsafe_code)]
fn view_at(at: usize) -> Option<Retained<NSView>> {
    unsafe { Retained::retain(at as *mut NSView) }
}
fn native(platform: &tauri::webview::PlatformWebview) -> Option<usize> {
    crate::host::page_id(platform).and_then(|one| usize::try_from(one.0).ok())
}
#[allow(unsafe_code)]
fn holder_of(view: &NSView) -> Option<Retained<NSView>> {
    unsafe { view.superview() }
}
pub fn lower(window: &tauri::Window, view: &Webview) {
    if !view.label().starts_with(crate::web_tabs::LABEL) {
        return;
    }
    let Some(own) = window.app_handle().get_webview(window.label()) else {
        return;
    };
    let page = view.clone();
    let _ = crate::engine::with_platform!(own, move |platform| {
        let Some(host) = native(&platform) else {
            return;
        };
        let label = page.label().to_owned();
        let _ = crate::engine::with_platform!(page, move |platform| {
            let (Some(page), Some(host)) = (native(&platform).and_then(view_at), view_at(host))
            else {
                return;
            };
            if beneath(&page, &host) {
                let mut all = PAGES.held();
                let kept = all.remove(&address(&page));
                let (cut, wide) = kept.map_or((None, 0.0), |one| (one.cut, one.wide));
                all.insert(
                    address(&page),
                    Page { label: label.clone(), host: address(&host), cut, wide },
                );
                drop(all);
                super::lay_under(&label, true);
            }
        });
    });
}
fn beneath(page: &NSView, host: &NSView) -> bool {
    let (Some(holder), Some(theirs)) = (holder_of(page), holder_of(host)) else {
        return false;
    };
    if address(&holder) != address(&theirs) || !adopt(host) {
        return false;
    }
    clear(host);
    let subviews = holder.subviews();
    let (mut mine, mut theirs) = (None, None);
    for at in 0..subviews.count() {
        let one = address(&subviews.objectAtIndex(at));
        if one == address(page) {
            mine = Some(at);
        } else if one == address(host) {
            theirs = Some(at);
        }
    }
    if mine.zip(theirs).is_none_or(|(mine, theirs)| mine > theirs) {
        holder.addSubview_positioned_relativeTo(page, NSWindowOrderingMode::Below, Some(host));
    }
    true
}
#[allow(unsafe_code)]
fn clear(host: &NSView) {
    host.setWantsLayer(true);
    unsafe {
        let layer: *mut AnyObject = msg_send![host, layer];
        if let Some(layer) = layer.as_ref() {
            let () = msg_send![layer, setOpaque: Bool::NO];
        }
    }
}
pub fn cut(view: &Webview, cut: Option<Cut>, wide: f64) {
    let label = view.label().to_owned();
    let mut all = PAGES.held();
    let mut host = None;
    for one in all.values_mut().filter(|one| one.label == label) {
        one.cut.clone_from(&cut);
        one.wide = wide;
        host = Some(one.host);
    }
    drop(all);
    let Some(host) = host else {
        return;
    };
    let _ = crate::engine::with_platform!(view, move |platform| {
        if let (Some(page), Some(host)) = (native(&platform).and_then(view_at), view_at(host)) {
            beneath(&page, &host);
        }
    });
}
pub fn forget(label: &str) {
    PAGES.held().retain(|_, one| one.label != label);
}
#[allow(unsafe_code)]
pub fn opacity(view: &Webview, opacity: f64) {
    let to = opacity.clamp(0.0, 1.0);
    let _ = crate::engine::with_platform!(view, move |platform| {
        let Some(page) = native(&platform).and_then(view_at) else {
            return;
        };
        if (page.alphaValue() - to).abs() < 0.001 {
            return;
        }
        let transaction = AnyClass::get(c"CATransaction");
        unsafe {
            if let Some(one) = transaction {
                let () = msg_send![one, begin];
                let () = msg_send![one, setDisableActions: Bool::YES];
            }
            page.setAlphaValue(to);
            if let Some(one) = transaction {
                let () = msg_send![one, commit];
            }
        }
    });
}
fn page_at(host: &NSView, point: NSPoint) -> Option<Retained<NSView>> {
    let me = address(host);
    let pages: Vec<(usize, Option<Cut>, f64)> = PAGES
        .held()
        .iter()
        .filter(|(_, one)| one.host == me)
        .map(|(at, one)| (*at, one.cut.clone(), one.wide))
        .collect();
    if pages.is_empty() {
        return None;
    }
    let holder = holder_of(host)?;
    let subviews = holder.subviews();
    for at in (0..subviews.count()).rev() {
        let view = subviews.objectAtIndex(at);
        let Some((_, cut, wide)) = pages.iter().find(|(one, _, _)| *one == address(&view)) else {
            continue;
        };
        if view.isHiddenOrHasHiddenAncestor() || view.alphaValue() < UNSEEN {
            continue;
        }
        let local = view.convertPoint_fromView(point, Some(&holder));
        let bounds = view.bounds();
        let x = local.x - bounds.origin.x;
        let y = if view.isFlipped() {
            local.y - bounds.origin.y
        } else {
            bounds.origin.y + bounds.size.height - local.y
        };
        if x < 0.0 || y < 0.0 || x >= bounds.size.width || y >= bounds.size.height {
            continue;
        }
        let by =
            if *wide > 0.0 && bounds.size.width > 0.0 { wide / bounds.size.width } else { 1.0 };
        return super::takes(cut.as_ref(), x * by, y * by).then_some(view);
    }
    None
}
fn original_of(view: &NSView) -> Option<&'static AnyClass> {
    original_as(view, PREFIX)
}
fn original_as(view: &NSView, prefix: &str) -> Option<&'static AnyClass> {
    let mut class = view.class();
    loop {
        if class.name().to_bytes().starts_with(prefix.as_bytes()) {
            return class.superclass();
        }
        class = class.superclass()?;
    }
}
#[allow(unsafe_code)]
extern "C-unwind" fn hit(this: &NSView, _: Sel, point: NSPoint) -> *mut NSView {
    let Some(original) = original_of(this) else {
        return std::ptr::null_mut();
    };
    if page_at(this, point).is_some() {
        return std::ptr::null_mut();
    }
    unsafe { msg_send![super(this, original), hitTest: point] }
}
#[allow(unsafe_code)]
extern "C-unwind" fn reach(this: &NSView, _: Sel, point: NSPoint) -> *mut AnyObject {
    let Some(original) = original_of(this) else {
        return std::ptr::null_mut();
    };
    let page = this.window().zip(holder_of(this)).and_then(|(window, holder)| {
        page_at(this, holder.convertPoint_fromView(window.convertPointFromScreen(point), None))
    });
    unsafe {
        match page {
            Some(page) => msg_send![&*page, accessibilityHitTest: point],
            None => msg_send![super(this, original), accessibilityHitTest: point],
        }
    }
}
#[allow(unsafe_code)]
fn adopt(host: &NSView) -> bool {
    let ok = adopt_as(host, PREFIX, |builder| unsafe {
        builder.add_method(sel!(hitTest:), hit as extern "C-unwind" fn(_, _, _) -> _);
        builder
            .add_method(sel!(accessibilityHitTest:), reach as extern "C-unwind" fn(_, _, _) -> _);
    });
    if let Some(drop) = ok.then(|| dropper(host)).flatten() {
        adopt_as(&drop, DROPS, |builder| unsafe {
            builder.add_method(
                sel!(draggingEntered:),
                drag_entered as extern "C-unwind" fn(_, _, _) -> _,
            );
            builder.add_method(
                sel!(draggingUpdated:),
                drag_updated as extern "C-unwind" fn(_, _, _) -> _,
            );
            builder.add_method(sel!(draggingExited:), drag_exited as extern "C-unwind" fn(_, _, _));
            builder.add_method(
                sel!(prepareForDragOperation:),
                drag_prepare as extern "C-unwind" fn(_, _, _) -> _,
            );
            builder.add_method(
                sel!(performDragOperation:),
                drag_perform as extern "C-unwind" fn(_, _, _) -> _,
            );
            builder.add_method(
                sel!(concludeDragOperation:),
                drag_conclude as extern "C-unwind" fn(_, _, _),
            );
        });
    }
    ok
}
#[allow(unsafe_code)]
fn adopt_as(view: &NSView, prefix: &str, methods: impl FnOnce(&mut ClassBuilder)) -> bool {
    if original_as(view, prefix).is_some() {
        return true;
    }
    let base = view.class();
    let Ok(name) = CString::new(format!("{prefix}{}", base.name().to_string_lossy())) else {
        return false;
    };
    let class = if let Some(made) = AnyClass::get(&name) {
        made
    } else {
        let Some(mut builder) = ClassBuilder::new(&name, base) else {
            return false;
        };
        methods(&mut builder);
        builder.register()
    };
    unsafe {
        objc2::ffi::object_setClass(
            std::ptr::from_ref::<NSView>(view).cast::<AnyObject>().cast_mut(),
            std::ptr::from_ref::<AnyClass>(class),
        );
    }
    true
}
const DROPS: &str = "OrdenUnderDrops_";
#[allow(unsafe_code)]
fn dropper(view: &NSView) -> Option<Retained<NSView>> {
    let types: *mut AnyObject = unsafe { msg_send![view, registeredDraggedTypes] };
    let count: usize = unsafe { types.as_ref().map_or(0, |one| msg_send![one, count]) };
    if count > 0 {
        return view_at(address(view));
    }
    let subviews = view.subviews();
    (0..subviews.count()).find_map(|at| dropper(&subviews.objectAtIndex(at)))
}
fn host_above(view: &NSView) -> Option<Retained<NSView>> {
    let hosts: Vec<usize> = PAGES.held().values().map(|one| one.host).collect();
    let mut at = holder_of(view);
    while let Some(one) = at {
        if hosts.contains(&address(&one)) {
            return Some(one);
        }
        at = holder_of(&one);
    }
    None
}
#[allow(unsafe_code)]
fn dropped_on(this: &NSView, info: *mut AnyObject) -> Option<Retained<NSView>> {
    let info = unsafe { info.as_ref() }?;
    let host = host_above(this)?;
    let at: NSPoint = unsafe { msg_send![info, draggingLocation] };
    let holder = holder_of(&host)?;
    let page = page_at(&host, holder.convertPoint_fromView(at, None))?;
    dropper(&page)
}
std::thread_local! {
    static DRAGGED: std::cell::RefCell<HashMap<usize, Option<Retained<NSView>>>> =
        std::cell::RefCell::new(HashMap::new());
}
fn dragging(this: &NSView) -> Option<Retained<NSView>> {
    DRAGGED.with_borrow(|all| all.get(&address(this)).cloned().flatten())
}
#[allow(unsafe_code)]
extern "C-unwind" fn drag_entered(this: &NSView, _: Sel, info: *mut AnyObject) -> usize {
    let Some(original) = original_as(this, DROPS) else {
        return 0;
    };
    let to = dropped_on(this, info);
    DRAGGED.with_borrow_mut(|all| all.insert(address(this), to.clone()));
    unsafe {
        match to {
            Some(page) => msg_send![&*page, draggingEntered: info],
            None => msg_send![super(this, original), draggingEntered: info],
        }
    }
}
#[allow(unsafe_code)]
extern "C-unwind" fn drag_updated(this: &NSView, _: Sel, info: *mut AnyObject) -> usize {
    let Some(original) = original_as(this, DROPS) else {
        return 0;
    };
    let to = dropped_on(this, info);
    let from = dragging(this);
    if from.as_deref().map(address) != to.as_deref().map(address) {
        unsafe {
            match &from {
                Some(page) => {
                    let () = msg_send![&**page, draggingExited: info];
                }
                None => {
                    let () = msg_send![super(this, original), draggingExited: info];
                }
            }
            let _: usize = match &to {
                Some(page) => msg_send![&**page, draggingEntered: info],
                None => msg_send![super(this, original), draggingEntered: info],
            };
        }
        DRAGGED.with_borrow_mut(|all| all.insert(address(this), to.clone()));
    }
    unsafe {
        match to {
            Some(page) => msg_send![&*page, draggingUpdated: info],
            None => msg_send![super(this, original), draggingUpdated: info],
        }
    }
}
#[allow(unsafe_code)]
extern "C-unwind" fn drag_exited(this: &NSView, _: Sel, info: *mut AnyObject) {
    let Some(original) = original_as(this, DROPS) else {
        return;
    };
    let to = DRAGGED.with_borrow_mut(|all| all.remove(&address(this)).flatten());
    unsafe {
        match to {
            Some(page) => msg_send![&*page, draggingExited: info],
            None => msg_send![super(this, original), draggingExited: info],
        }
    }
}
#[allow(unsafe_code)]
extern "C-unwind" fn drag_prepare(this: &NSView, _: Sel, info: *mut AnyObject) -> Bool {
    let Some(original) = original_as(this, DROPS) else {
        return Bool::NO;
    };
    unsafe {
        match dragging(this) {
            Some(page) => msg_send![&*page, prepareForDragOperation: info],
            None => msg_send![super(this, original), prepareForDragOperation: info],
        }
    }
}
#[allow(unsafe_code)]
extern "C-unwind" fn drag_perform(this: &NSView, _: Sel, info: *mut AnyObject) -> Bool {
    let Some(original) = original_as(this, DROPS) else {
        return Bool::NO;
    };
    unsafe {
        match dragging(this) {
            Some(page) => msg_send![&*page, performDragOperation: info],
            None => msg_send![super(this, original), performDragOperation: info],
        }
    }
}
#[allow(unsafe_code)]
extern "C-unwind" fn drag_conclude(this: &NSView, _: Sel, info: *mut AnyObject) {
    let Some(original) = original_as(this, DROPS) else {
        return;
    };
    let to = DRAGGED.with_borrow_mut(|all| all.remove(&address(this)).flatten());
    unsafe {
        match to {
            Some(page) => msg_send![&*page, concludeDragOperation: info],
            None => msg_send![super(this, original), concludeDragOperation: info],
        }
    }
}
pub fn held(label: &str) -> Option<(Option<Cut>, f64)> {
    PAGES
        .held()
        .values()
        .find(|one| one.label == label && one.wide > 0.0)
        .map(|one| (one.cut.clone(), one.wide))
}
fn on_page<T: Send + 'static>(
    view: &Webview,
    then: impl FnOnce(&NSView) -> Option<T> + Send + 'static,
) -> Option<T> {
    let (told, heard) = std::sync::mpsc::sync_channel(1);
    let _ = crate::engine::with_platform!(view, move |platform| {
        let _ = told.send(native(&platform).and_then(view_at).and_then(|page| then(&page)));
    });
    heard.recv_timeout(std::time::Duration::from_secs(2)).ok().flatten()
}
pub fn shown(view: &Webview) -> bool {
    on_page(view, |page| {
        (!page.isHiddenOrHasHiddenAncestor() && page.alphaValue() > 0.99).then_some(())
    })
    .is_some()
}
pub fn raise(view: &Webview) {
    let label = view.label().to_owned();
    let host = PAGES.held().values().find(|one| one.label == label).map(|one| one.host);
    forget(&label);
    let _ = crate::engine::with_platform!(view, move |platform| {
        let Some(page) = native(&platform).and_then(view_at) else {
            return;
        };
        page.setAlphaValue(1.0);
        let (Some(holder), Some(host)) = (holder_of(&page), host.and_then(view_at)) else {
            return;
        };
        holder.addSubview_positioned_relativeTo(&page, NSWindowOrderingMode::Above, Some(&host));
    });
}
#[allow(unsafe_code)]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCreateImage(bounds: NSRect, list: u32, window: u32, options: u32)
        -> *mut c_void;
    fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits: usize,
        row: usize,
        space: *mut c_void,
        info: u32,
    ) -> *mut c_void;
    fn CGContextDrawImage(context: *mut c_void, rect: NSRect, image: *mut c_void);
    fn CGContextRelease(context: *mut c_void);
    fn CGImageRelease(image: *mut c_void);
    fn CGColorSpaceRelease(space: *mut c_void);
}
const ONLY_THIS_WINDOW: u32 = 1 << 3;
const NO_FRAME_AT_NOMINAL_SCALE: u32 = (1 << 0) | (1 << 4);
const PREMULTIPLIED_LAST: u32 = 1;
pub fn looked_at(view: &Webview, spots: Vec<(f64, f64)>) -> Option<Vec<[u8; 3]>> {
    let (_, wide) = held(view.label())?;
    on_page(view, move |page| {
        let window = page.window()?;
        let bounds = page.bounds();
        let by = if bounds.size.width > 0.0 { wide / bounds.size.width } else { return None };
        let tall = primary_height()?;
        let number = u32::try_from(window.windowNumber()).ok()?;
        spots
            .iter()
            .map(|&(x, y)| {
                let (x, y) = (x / by, y / by);
                let local = NSPoint::new(
                    bounds.origin.x + x,
                    if page.isFlipped() {
                        bounds.origin.y + y
                    } else {
                        bounds.origin.y + bounds.size.height - y
                    },
                );
                let screen = window.convertPointToScreen(page.convertPoint_toView(local, None));
                pixel_at(NSPoint::new(screen.x.floor(), (tall - screen.y).floor()), number)
            })
            .collect()
    })
}
#[allow(unsafe_code)]
fn primary_height() -> Option<f64> {
    let screens = AnyClass::get(c"NSScreen")?;
    unsafe {
        let all: *mut AnyObject = msg_send![screens, screens];
        let all = all.as_ref()?;
        let count: usize = msg_send![all, count];
        if count == 0 {
            return None;
        }
        let first: *mut AnyObject = msg_send![all, objectAtIndex: 0usize];
        let frame: NSRect = msg_send![first.as_ref()?, frame];
        Some(frame.size.height)
    }
}
#[allow(unsafe_code)]
fn pixel_at(at: NSPoint, window: u32) -> Option<[u8; 3]> {
    let mut pixel = [0u8; 4];
    unsafe {
        let image = CGWindowListCreateImage(
            NSRect::new(at, NSSize::new(1.0, 1.0)),
            ONLY_THIS_WINDOW,
            window,
            NO_FRAME_AT_NOMINAL_SCALE,
        );
        if image.is_null() {
            return None;
        }
        let space = CGColorSpaceCreateDeviceRGB();
        let context =
            CGBitmapContextCreate(pixel.as_mut_ptr().cast(), 1, 1, 8, 4, space, PREMULTIPLIED_LAST);
        if !context.is_null() {
            CGContextDrawImage(
                context,
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0)),
                image,
            );
            CGContextRelease(context);
        }
        CGColorSpaceRelease(space);
        CGImageRelease(image);
        if context.is_null() {
            return None;
        }
    }
    Some([pixel[0], pixel[1], pixel[2]])
}
