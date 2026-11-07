use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, OnceLock, PoisonError};

use objc2::ffi;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{msg_send, sel, ClassType};
use objc2_app_kit::{NSEvent, NSEventType, NSView, NSWindowOrderingMode};
use objc2_foundation::{NSNumber, NSPoint, NSString};
use objc2_web_kit::WKWebView;
use tauri::{Manager, Webview, Window};

use super::{Cut, Hollow};

macro_rules! as_imp {
    ($name:ident, $argument:ty => $answer:ty) => {
        std::mem::transmute::<extern "C-unwind" fn(&NSView, Sel, $argument) -> $answer, Imp>($name)
    };
}

macro_rules! call {
    ($imp:expr, $this:expr, $name:expr, $argument:expr, $type:ty => $answer:ty) => {{
        #[allow(
            unsafe_code,
            reason = "the method replaced is called with the signature it has"
        )]
        let answer = unsafe {
            std::mem::transmute::<Imp, extern "C-unwind" fn(&NSView, Sel, $type) -> $answer>($imp)(
                $this, $name, $argument,
            )
        };
        answer
    }};
}

const UNSEEN: f64 = 0.01;

pub fn on() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("ORDEN_PAGES_UNDER").is_some_and(|said| said == "1"))
}

struct Held {
    label: String,
    host: usize,
    cut: Option<Cut>,
}

static HELD: LazyLock<Mutex<HashMap<usize, Held>>> = LazyLock::new(Mutex::default);

fn held<T>(look: impl FnOnce(&mut HashMap<usize, Held>) -> T) -> T {
    look(&mut HELD.lock().unwrap_or_else(PoisonError::into_inner))
}

thread_local! {
    static AWAY: RefCell<HashSet<usize>> = RefCell::new(HashSet::new());
    static DRAGGED: RefCell<HashMap<usize, Option<Retained<NSView>>>> = RefCell::new(HashMap::new());
}

fn address(view: &NSView) -> usize {
    std::ptr::from_ref(view) as usize
}

#[allow(
    unsafe_code,
    reason = "AppKit's binding marks a view's superview unsafe, as a view it does not retain"
)]
fn holder_of(view: &NSView) -> Option<Retained<NSView>> {
    unsafe { view.superview() }
}

pub fn under(label: &str) -> bool {
    held(|all| all.values().any(|one| one.label == label))
}

pub fn cut(view: &Webview, cut: Option<&Cut>) {
    let label = view.label();
    held(|all| {
        if let Some(one) = all.values_mut().find(|one| one.label == label) {
            one.cut = cut.cloned();
        }
    });
}

pub fn forget(label: &str) {
    held(|all| all.retain(|_, one| one.label != label));
}

#[allow(
    unsafe_code,
    reason = "the runtime hands both views over as bare pointers, and the app's view is made transparent by its own key"
)]
pub fn lower(window: &Window, view: &Webview) {
    if !on() || !view.label().starts_with(crate::web_tabs::LABEL) {
        return;
    }
    let Some(own) = window.app_handle().get_webview(window.label()) else {
        return;
    };
    let (sending, heard) = std::sync::mpsc::channel();
    let _ = own.with_webview(move |platform| {
        let _ = sending.send(platform.inner() as usize);
    });
    let Ok(host) = heard.try_recv() else {
        return;
    };
    let label = view.label().to_string();
    let _ = view.with_webview(move |platform| unsafe {
        let (Some(page), Some(host)) = (
            Retained::retain(platform.inner().cast::<NSView>()),
            Retained::retain(host as *mut NSView),
        ) else {
            return;
        };
        let (Some(holder), Some(theirs)) = (page.superview(), host.superview()) else {
            return;
        };
        if address(&holder) != address(&theirs) || !installed(&host) {
            return;
        }
        let no = NSNumber::new_bool(false);
        let key = NSString::from_str("drawsBackground");
        let () = msg_send![&*host, setValue: &*no, forKey: &*key];
        holder.addSubview_positioned_relativeTo(&page, NSWindowOrderingMode::Below, Some(&host));
        held(|all| {
            all.insert(
                address(&page),
                Held {
                    label,
                    host: address(&host),
                    cut: None,
                },
            )
        });
    });
}

#[allow(
    unsafe_code,
    reason = "the runtime hands the page's view over as a bare pointer, and Core Animation's transaction is reached through the Objective-C runtime"
)]
pub fn opacity(view: &Webview, opacity: f64) {
    if !under(view.label()) {
        return;
    }
    let to = opacity.clamp(0.0, 1.0);
    let _ = view.with_webview(move |platform| unsafe {
        let Some(page) = Retained::retain(platform.inner().cast::<NSView>()) else {
            return;
        };
        if (page.alphaValue() - to).abs() < 0.001 {
            return;
        }
        let transaction = AnyClass::get(c"CATransaction");
        if let Some(one) = transaction {
            let () = msg_send![one, begin];
            let () = msg_send![one, setDisableActions: Bool::YES];
        }
        page.setAlphaValue(to);
        if let Some(one) = transaction {
            let () = msg_send![one, commit];
        }
    });
}

fn takes(cut: Option<&Cut>, x: f64, y: f64) -> bool {
    cut.is_none_or(|cut| !cut.all && !cut.hollows.iter().any(|one| holds(one, x, y)))
}

fn holds(layer: &Hollow, x: f64, y: f64) -> bool {
    let (right, bottom) = (layer.x + layer.width, layer.y + layer.height);
    if x < layer.x || y < layer.y || x >= right || y >= bottom {
        return false;
    }
    let round = layer
        .radius
        .min(layer.width / 2.0)
        .min(layer.height / 2.0)
        .max(0.0);
    let (nearest_x, nearest_y) = (
        x.clamp(layer.x + round, right - round),
        y.clamp(layer.y + round, bottom - round),
    );
    (x - nearest_x).powi(2) + (y - nearest_y).powi(2) <= round * round
}

fn page_at(host: &NSView, point: NSPoint) -> Option<Retained<NSView>> {
    let me = address(host);
    let pages: Vec<(usize, Option<Cut>)> = held(|all| {
        all.iter()
            .filter(|(_, one)| one.host == me)
            .map(|(at, one)| (*at, one.cut.clone()))
            .collect()
    });
    if pages.is_empty() {
        return None;
    }
    let holder = holder_of(host)?;
    let subviews = holder.subviews().to_vec();
    for view in subviews.iter().rev() {
        let Some((_, cut)) = pages.iter().find(|(at, _)| *at == address(view)) else {
            continue;
        };
        if view.isHiddenOrHasHiddenAncestor() || view.alphaValue() < UNSEEN {
            continue;
        }
        let at = view.convertPoint_fromView(point, Some(&holder));
        let bounds = view.bounds();
        let x = at.x - bounds.origin.x;
        let y = if view.isFlipped() {
            at.y - bounds.origin.y
        } else {
            bounds.origin.y + bounds.size.height - at.y
        };
        if x < 0.0 || y < 0.0 || x >= bounds.size.width || y >= bounds.size.height {
            continue;
        }
        return takes(cut.as_ref(), x, y).then(|| view.clone());
    }
    None
}

fn hosts(view: &NSView) -> bool {
    let me = address(view);
    held(|all| all.values().any(|one| one.host == me))
}

fn minds(view: &NSView) -> bool {
    let me = address(view);
    held(|all| all.contains_key(&me) || all.values().any(|one| one.host == me))
}

fn over(view: &NSView, event: &NSEvent) -> bool {
    let Some(content) = view.window().and_then(|window| window.contentView()) else {
        return true;
    };
    let at = event.locationInWindow();
    let at = holder_of(&content).map_or(at, |frame| frame.convertPoint_fromView(at, None));
    content
        .hitTest(at)
        .is_some_and(|hit| hit.isDescendantOf(view))
}

struct Before {
    hit: Imp,
    reach: Imp,
    moved: Imp,
    entered: Imp,
    exited: Imp,
    cursor: Imp,
    drag_entered: Imp,
    drag_updated: Imp,
    drag_exited: Imp,
    drag_prepare: Imp,
    drag_perform: Imp,
    drag_conclude: Imp,
}

static BEFORE: OnceLock<Option<Before>> = OnceLock::new();

fn before() -> Option<&'static Before> {
    BEFORE.get().and_then(Option::as_ref)
}

#[allow(
    unsafe_code,
    reason = "a class's methods are replaced through the Objective-C runtime"
)]
fn installed(host: &NSView) -> bool {
    BEFORE
        .get_or_init(|| {
            let web = WKWebView::class();
            let mut class = host.class();
            let wry = loop {
                let up = class.superclass()?;
                if std::ptr::eq(up, web) {
                    break class;
                }
                class = up;
            };
            unsafe {
                Some(Before {
                    hit: swap(wry, sel!(hitTest:), as_imp!(hit, NSPoint => *mut NSView))?,
                    reach: swap(
                        wry,
                        sel!(accessibilityHitTest:),
                        as_imp!(reach, NSPoint => *mut AnyObject),
                    )?,
                    moved: swap(wry, sel!(mouseMoved:), as_imp!(moved, &NSEvent => ()))?,
                    entered: swap(wry, sel!(mouseEntered:), as_imp!(entered, &NSEvent => ()))?,
                    exited: swap(wry, sel!(mouseExited:), as_imp!(exited, &NSEvent => ()))?,
                    cursor: swap(wry, sel!(cursorUpdate:), as_imp!(cursor, &NSEvent => ()))?,
                    drag_entered: swap(
                        wry,
                        sel!(draggingEntered:),
                        as_imp!(drag_entered, *mut AnyObject => usize),
                    )?,
                    drag_updated: swap(
                        wry,
                        sel!(draggingUpdated:),
                        as_imp!(drag_updated, *mut AnyObject => usize),
                    )?,
                    drag_exited: swap(
                        wry,
                        sel!(draggingExited:),
                        as_imp!(drag_exited, *mut AnyObject => ()),
                    )?,
                    drag_prepare: swap(
                        wry,
                        sel!(prepareForDragOperation:),
                        as_imp!(drag_prepare, *mut AnyObject => Bool),
                    )?,
                    drag_perform: swap(
                        wry,
                        sel!(performDragOperation:),
                        as_imp!(drag_perform, *mut AnyObject => Bool),
                    )?,
                    drag_conclude: swap(
                        wry,
                        sel!(concludeDragOperation:),
                        as_imp!(drag_conclude, *mut AnyObject => ()),
                    )?,
                })
            }
        })
        .is_some()
}

#[allow(
    unsafe_code,
    reason = "a class's method is replaced through the Objective-C runtime"
)]
unsafe fn swap(class: &AnyClass, name: Sel, new: Imp) -> Option<Imp> {
    unsafe {
        let method = ffi::class_getInstanceMethod(class, name);
        if method.is_null() {
            return None;
        }
        let was = ffi::method_getImplementation(method)?;
        let types = ffi::method_getTypeEncoding(method);
        ffi::class_replaceMethod(std::ptr::from_ref(class).cast_mut(), name, new, types);
        Some(was)
    }
}

extern "C-unwind" fn hit(this: &NSView, name: Sel, point: NSPoint) -> *mut NSView {
    let Some(was) = before() else {
        return std::ptr::null_mut();
    };
    if hosts(this) && page_at(this, point).is_some() {
        return std::ptr::null_mut();
    }
    call!(was.hit, this, name, point, NSPoint => *mut NSView)
}

extern "C-unwind" fn reach(this: &NSView, name: Sel, point: NSPoint) -> *mut AnyObject {
    let Some(was) = before() else {
        return std::ptr::null_mut();
    };
    let page = hosts(this)
        .then(|| {
            let (window, holder) = (this.window()?, holder_of(this)?);
            page_at(
                this,
                holder.convertPoint_fromView(window.convertPointFromScreen(point), None),
            )
        })
        .flatten();
    call!(was.reach, page.as_deref().unwrap_or(this), name, point, NSPoint => *mut AnyObject)
}

#[allow(
    unsafe_code,
    reason = "an event is made through AppKit's constructor for one"
)]
fn left(view: &NSView, event: &NSEvent, was: &Before) {
    let made = unsafe {
        NSEvent::enterExitEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_trackingNumber_userData(
            NSEventType::MouseExited,
            event.locationInWindow(),
            event.modifierFlags(),
            event.timestamp(),
            event.windowNumber(),
            None,
            0,
            0,
            std::ptr::null_mut(),
        )
    };
    if let Some(made) = made {
        call!(was.exited, view, sel!(mouseExited:), &*made, &NSEvent => ());
    }
}

extern "C-unwind" fn moved(this: &NSView, name: Sel, event: &NSEvent) {
    let Some(was) = before() else {
        return;
    };
    if minds(this) && !over(this, event) {
        if AWAY.with_borrow_mut(|all| all.insert(address(this))) {
            left(this, event, was);
        }
        return;
    }
    AWAY.with_borrow_mut(|all| all.remove(&address(this)));
    call!(was.moved, this, name, event, &NSEvent => ());
}

extern "C-unwind" fn entered(this: &NSView, name: Sel, event: &NSEvent) {
    let Some(was) = before() else {
        return;
    };
    if minds(this) && !over(this, event) {
        AWAY.with_borrow_mut(|all| all.insert(address(this)));
        return;
    }
    AWAY.with_borrow_mut(|all| all.remove(&address(this)));
    call!(was.entered, this, name, event, &NSEvent => ());
}

extern "C-unwind" fn exited(this: &NSView, name: Sel, event: &NSEvent) {
    let Some(was) = before() else {
        return;
    };
    AWAY.with_borrow_mut(|all| all.remove(&address(this)));
    call!(was.exited, this, name, event, &NSEvent => ());
}

extern "C-unwind" fn cursor(this: &NSView, name: Sel, event: &NSEvent) {
    let Some(was) = before() else {
        return;
    };
    if minds(this) && !over(this, event) {
        return;
    }
    call!(was.cursor, this, name, event, &NSEvent => ());
}

#[allow(
    unsafe_code,
    reason = "the drag's place is asked of AppKit's dragging info through the Objective-C runtime"
)]
fn dragged_to(host: &NSView, info: *mut AnyObject) -> Option<Retained<NSView>> {
    if info.is_null() {
        return None;
    }
    let at: NSPoint = unsafe { msg_send![info, draggingLocation] };
    let holder = holder_of(host)?;
    page_at(host, holder.convertPoint_fromView(at, None))
}

fn dragging(host: &NSView) -> Option<Retained<NSView>> {
    DRAGGED.with_borrow(|all| all.get(&address(host)).cloned().flatten())
}

extern "C-unwind" fn drag_entered(this: &NSView, name: Sel, info: *mut AnyObject) -> usize {
    let Some(was) = before() else {
        return 0;
    };
    let to = hosts(this).then(|| dragged_to(this, info)).flatten();
    if hosts(this) {
        DRAGGED.with_borrow_mut(|all| all.insert(address(this), to.clone()));
    }
    call!(was.drag_entered, to.as_deref().unwrap_or(this), name, info, *mut AnyObject => usize)
}

extern "C-unwind" fn drag_updated(this: &NSView, name: Sel, info: *mut AnyObject) -> usize {
    let Some(was) = before() else {
        return 0;
    };
    if !hosts(this) {
        return call!(was.drag_updated, this, name, info, *mut AnyObject => usize);
    }
    let to = dragged_to(this, info);
    let from = dragging(this);
    if from.as_deref().map(address) != to.as_deref().map(address) {
        let leaving = from.as_deref().unwrap_or(this);
        call!(was.drag_exited, leaving, sel!(draggingExited:), info, *mut AnyObject => ());
        let entering = to.as_deref().unwrap_or(this);
        call!(was.drag_entered, entering, sel!(draggingEntered:), info, *mut AnyObject => usize);
        DRAGGED.with_borrow_mut(|all| all.insert(address(this), to.clone()));
    }
    call!(was.drag_updated, to.as_deref().unwrap_or(this), name, info, *mut AnyObject => usize)
}

extern "C-unwind" fn drag_exited(this: &NSView, name: Sel, info: *mut AnyObject) {
    let Some(was) = before() else {
        return;
    };
    let to = DRAGGED.with_borrow_mut(|all| all.remove(&address(this)).flatten());
    call!(was.drag_exited, to.as_deref().unwrap_or(this), name, info, *mut AnyObject => ());
}

extern "C-unwind" fn drag_prepare(this: &NSView, name: Sel, info: *mut AnyObject) -> Bool {
    let Some(was) = before() else {
        return Bool::NO;
    };
    let to = dragging(this);
    call!(was.drag_prepare, to.as_deref().unwrap_or(this), name, info, *mut AnyObject => Bool)
}

extern "C-unwind" fn drag_perform(this: &NSView, name: Sel, info: *mut AnyObject) -> Bool {
    let Some(was) = before() else {
        return Bool::NO;
    };
    let to = dragging(this);
    call!(was.drag_perform, to.as_deref().unwrap_or(this), name, info, *mut AnyObject => Bool)
}

extern "C-unwind" fn drag_conclude(this: &NSView, name: Sel, info: *mut AnyObject) {
    let Some(was) = before() else {
        return;
    };
    let to = DRAGGED.with_borrow_mut(|all| all.remove(&address(this)).flatten());
    call!(was.drag_conclude, to.as_deref().unwrap_or(this), name, info, *mut AnyObject => ());
}

#[cfg(test)]
mod tests {
    use super::{holds, takes, Cut, Hollow};

    fn layer(x: f64, y: f64, width: f64, height: f64, radius: f64) -> Hollow {
        Hollow {
            x,
            y,
            width,
            height,
            radius,
        }
    }

    #[test]
    fn a_page_takes_what_no_layer_is_over() {
        assert!(takes(None, 10.0, 10.0));
        let menu = Cut {
            all: false,
            hollows: vec![layer(100.0, 0.0, 200.0, 300.0, 0.0)],
        };
        assert!(!takes(Some(&menu), 150.0, 10.0));
        assert!(takes(Some(&menu), 50.0, 10.0));
        assert!(takes(Some(&menu), 300.0, 10.0));
        let all = Cut {
            all: true,
            hollows: Vec::new(),
        };
        assert!(!takes(Some(&all), 10.0, 10.0));
    }

    #[test]
    fn a_layer_s_rounded_corner_leaves_the_page_its_corner() {
        let card = layer(0.0, 0.0, 100.0, 100.0, 20.0);
        assert!(holds(&card, 50.0, 50.0));
        assert!(holds(&card, 20.0, 2.0));
        assert!(!holds(&card, 1.0, 1.0));
        assert!(!holds(&card, 99.0, 99.0));
        assert!(holds(&card, 10.0, 10.0));
        assert!(holds(&layer(0.0, 0.0, 10.0, 100.0, 50.0), 5.0, 50.0));
    }
}
