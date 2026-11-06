const BAR: f64 = 38.0;

const LEFT: f64 = 12.0;

fn spot(
    button: (f64, f64),
    holder_width: f64,
    holder_top: f64,
    pitch: f64,
    index: u8,
    leftward: bool,
) -> (f64, f64) {
    let (width, height) = button;
    let along = LEFT + f64::from(index) * pitch;
    let x = if leftward {
        holder_width - along - width
    } else {
        along
    };
    let top = ((BAR - height) / 2.0).round() - holder_top;
    (x, top)
}

#[cfg(target_os = "macos")]
pub fn hold(window: &tauri::WebviewWindow) {
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    let pointer = pointer as usize;
    let placing = move || native::hold(pointer as *mut std::ffi::c_void);

    if objc2::MainThreadMarker::new().is_some() {
        placing();
    } else {
        let _ = window.run_on_main_thread(placing);
    }
}

#[cfg(target_os = "macos")]
pub fn refresh(window: &tauri::Window) {
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    let pointer = pointer as usize;
    let _ = window.run_on_main_thread(move || native::refresh(pointer as *mut std::ffi::c_void));
}

#[cfg(target_os = "macos")]
mod native {
    use std::cell::Cell;
    use std::ffi::{c_void, CString};
    use std::ptr::NonNull;
    use std::rc::Rc;

    use block2::RcBlock;
    use objc2::rc::{Retained, Weak};
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, NSObject, ProtocolObject, Sel};
    use objc2::{define_class, msg_send, sel, AllocAnyThread, DefinedClass};
    use objc2_app_kit::{
        NSView, NSViewFrameDidChangeNotification, NSWindow, NSWindowButton, NSWindowStyleMask,
    };
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSObjectProtocol, NSOperationQueue, NSPoint,
    };

    use super::spot;

    const PREFIX: &str = "NibLights_";

    thread_local! {
        static PLACING: Cell<bool> = const { Cell::new(false) };
    }

    static KEPT: u8 = 0;

    struct Held {
        observers: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
        own: [(f64, f64); 3],
    }

    impl Drop for Held {
        #[allow(
            unsafe_code,
            reason = "an observer is taken off the notification centre through the Objective-C runtime"
        )]
        fn drop(&mut self) {
            let centre = NSNotificationCenter::defaultCenter();
            for observer in &self.observers {
                unsafe { centre.removeObserver(observer.as_ref()) };
            }
        }
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "NibLightsWatch"]
        #[ivars = Held]
        struct Watch;
    );

    #[allow(
        unsafe_code,
        reason = "an associated object is read through the Objective-C runtime"
    )]
    fn watch_on(window: &NSWindow) -> Option<Retained<Watch>> {
        unsafe {
            let found = objc2::ffi::objc_getAssociatedObject(
                std::ptr::from_ref(window).cast::<AnyObject>(),
                (&raw const KEPT).cast::<c_void>(),
            );
            Retained::retain(found.cast::<Watch>().cast_mut())
        }
    }

    fn edges(light: &NSView, holder: &NSView) -> (f64, f64) {
        let frame = light.frame();
        let top = if holder.isFlipped() {
            frame.origin.y
        } else {
            holder.bounds().size.height - frame.origin.y - frame.size.height
        };
        (frame.origin.x, top)
    }

    #[allow(
        unsafe_code,
        reason = "AppKit marks reading a view's superview unsafe, as the answer's class is not promised"
    )]
    fn parent(view: &NSView) -> Option<Retained<NSView>> {
        unsafe { view.superview() }
    }

    fn buttons(window: &NSWindow) -> Option<[Retained<NSView>; 3]> {
        let one = |kind| {
            window
                .standardWindowButton(kind)
                .map(|button| Retained::into_super(Retained::into_super(button)))
        };
        Some([
            one(NSWindowButton::CloseButton)?,
            one(NSWindowButton::MiniaturizeButton)?,
            one(NSWindowButton::ZoomButton)?,
        ])
    }

    fn nibs_frame(window: &NSWindow) -> bool {
        window.titlebarAppearsTransparent()
            && window
                .styleMask()
                .contains(NSWindowStyleMask::FullSizeContentView)
    }

    fn centred(
        window: &NSWindow,
        lights: &[Retained<NSView>; 3],
        holder: &NSView,
    ) -> [(f64, f64); 3] {
        let seen = holder.convertRect_toView(holder.bounds(), None);
        let holder_top = window.frame().size.height - (seen.origin.y + seen.size.height);
        let width = holder.bounds().size.width;
        let (first, last) = (lights[0].frame().origin.x, lights[2].frame().origin.x);
        let pitch = (lights[1].frame().origin.x - first).abs();
        let leftward = first > last;

        let mut index = 0u8;
        lights.each_ref().map(|light| {
            let size = light.frame().size;
            let at = spot(
                (size.width, size.height),
                width,
                holder_top,
                pitch,
                index,
                leftward,
            );
            index += 1;
            at
        })
    }

    fn place(window: &NSWindow) {
        if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
            return;
        }
        let Some(lights) = buttons(window) else {
            return;
        };
        let Some(holder) = parent(&lights[0]) else {
            return;
        };
        let in_this_window = holder.window().is_some_and(|there| {
            std::ptr::eq(Retained::as_ptr(&there), std::ptr::from_ref(window))
        });
        let together = lights
            .iter()
            .all(|light| parent(light).is_some_and(|there| there == holder));
        if !in_this_window || !together {
            return;
        }

        adopt(&holder);

        let spots = if nibs_frame(window) {
            centred(window, &lights, &holder)
        } else if let Some(watch) = watch_on(window) {
            watch.ivars().own
        } else {
            return;
        };

        let height = holder.bounds().size.height;
        PLACING.set(true);
        for (light, (x, top)) in lights.iter().zip(spots) {
            let size = light.frame().size;
            let y = if holder.isFlipped() {
                top
            } else {
                height - top - size.height
            };
            let now = light.frame().origin;
            if (now.x - x).abs() > 0.1 || (now.y - y).abs() > 0.1 {
                light.setFrameOrigin(NSPoint::new(x, y));
            }
        }
        PLACING.set(false);
    }

    fn original_of(view: &NSView) -> Option<&'static AnyClass> {
        let mut class = view.class();
        loop {
            if class.name().to_bytes().starts_with(PREFIX.as_bytes()) {
                return class.superclass();
            }
            class = class.superclass()?;
        }
    }

    #[allow(
        unsafe_code,
        reason = "the class this method was added to is reached through the Objective-C runtime to call the layout it replaces"
    )]
    extern "C-unwind" fn laid_out(this: &NSView, _: Sel) {
        if let Some(original) = original_of(this) {
            unsafe {
                let () = msg_send![super(this, original), layout];
            }
        }
        if let Some(window) = this.window() {
            place(&window);
        }
    }

    #[allow(
        unsafe_code,
        reason = "a class is made and an object's class is changed through the Objective-C runtime"
    )]
    fn adopt(holder: &NSView) {
        if original_of(holder).is_some() {
            return;
        }
        let base = holder.class();
        let Ok(name) = CString::new(format!("{PREFIX}{}", base.name().to_string_lossy())) else {
            return;
        };
        let class = if let Some(made) = AnyClass::get(&name) {
            made
        } else {
            let Some(mut builder) = ClassBuilder::new(&name, base) else {
                return;
            };
            unsafe {
                builder.add_method(sel!(layout), laid_out as extern "C-unwind" fn(_, _));
            }
            builder.register()
        };
        unsafe {
            objc2::ffi::object_setClass(
                std::ptr::from_ref::<NSView>(holder)
                    .cast::<AnyObject>()
                    .cast_mut(),
                std::ptr::from_ref::<AnyClass>(class),
            );
        }
    }

    #[allow(
        unsafe_code,
        reason = "Tauri hands the NSWindow over as a bare pointer"
    )]
    pub fn refresh(pointer: *mut c_void) {
        if pointer.is_null() {
            return;
        }
        let Some(window) = (unsafe { Retained::retain(pointer.cast::<NSWindow>()) }) else {
            return;
        };
        place(&window);
    }

    #[allow(
        unsafe_code,
        reason = "Tauri hands the NSWindow over as a bare pointer, and observers, the main queue and associated objects are the Objective-C runtime's own calls"
    )]
    pub fn hold(pointer: *mut c_void) {
        if pointer.is_null() {
            return;
        }
        let Some(window) = (unsafe { Retained::retain(pointer.cast::<NSWindow>()) }) else {
            return;
        };

        let Some(lights) = buttons(&window) else {
            return;
        };
        let Some(holder) = parent(&lights[0]) else {
            return;
        };
        let own = lights.each_ref().map(|light| edges(light, &holder));

        let weak = Weak::from_retained(&window);
        let waiting = Rc::new(Cell::new(false));
        let again = RcBlock::new(move |_: NonNull<NSNotification>| {
            if PLACING.get() || waiting.get() {
                return;
            }
            waiting.set(true);
            let (weak, waiting) = (weak.clone(), Rc::clone(&waiting));
            let later = RcBlock::new(move || {
                waiting.set(false);
                if let Some(window) = weak.load() {
                    place(&window);
                }
            });
            unsafe { NSOperationQueue::mainQueue().addOperationWithBlock(&later) };
        });

        let centre = NSNotificationCenter::defaultCenter();
        let mut observers = Vec::new();
        for light in &lights {
            light.setPostsFrameChangedNotifications(true);
            let observer = unsafe {
                centre.addObserverForName_object_queue_usingBlock(
                    Some(NSViewFrameDidChangeNotification),
                    Some(light.as_ref() as &AnyObject),
                    None,
                    &again,
                )
            };
            observers.push(observer);
        }

        let watch = Watch::alloc().set_ivars(Held { observers, own });
        let watch: Retained<Watch> = unsafe { msg_send![super(watch), init] };

        unsafe {
            objc2::ffi::objc_setAssociatedObject(
                Retained::as_ptr(&window).cast::<AnyObject>().cast_mut(),
                (&raw const KEPT).cast::<c_void>(),
                Retained::as_ptr(&watch).cast::<AnyObject>().cast_mut(),
                objc2::ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
            );
        }

        place(&window);
    }
}

#[cfg(test)]
mod tests {
    use super::{spot, BAR, LEFT};

    const WIDEST_PITCH: f64 = 23.0;
    const LIGHT: f64 = 14.0;

    fn pixels(css: &str, token: &str) -> f64 {
        let start = css
            .find(&format!("{token}:"))
            .unwrap_or_else(|| panic!("{token} is not in tokens.css"));
        let value = css[start + token.len() + 1..]
            .split(';')
            .next()
            .unwrap()
            .trim();
        value
            .strip_suffix("px")
            .unwrap_or_else(|| panic!("{token} is not in pixels: {value}"))
            .parse()
            .unwrap()
    }

    fn at(point: (f64, f64), x: f64, y: f64) -> bool {
        (point.0 - x).abs() < f64::EPSILON && (point.1 - y).abs() < f64::EPSILON
    }

    #[test]
    fn a_light_is_centred_in_the_bar() {
        assert!(at(
            spot((14.0, 14.0), 300.0, 0.0, 23.0, 0, false),
            LEFT,
            12.0
        ));
        assert!(at(
            spot((14.0, 16.0), 300.0, 0.0, 20.0, 0, false),
            LEFT,
            11.0
        ));
    }

    #[test]
    fn a_holder_lower_in_the_window_is_allowed_for() {
        assert!(at(
            spot((14.0, 14.0), 300.0, 2.0, 23.0, 0, false),
            LEFT,
            10.0
        ));
    }

    #[test]
    fn the_lights_keep_the_systems_own_pitch() {
        assert!(at(
            spot((14.0, 14.0), 300.0, 0.0, 23.0, 2, false),
            LEFT + 46.0,
            12.0
        ));
        assert!(at(
            spot((14.0, 16.0), 300.0, 0.0, 20.0, 1, false),
            LEFT + 20.0,
            11.0
        ));
    }

    #[test]
    fn a_titlebar_laid_out_right_to_left_is_mirrored() {
        let right = 300.0 - LEFT - 14.0;
        assert!(at(
            spot((14.0, 14.0), 300.0, 0.0, 23.0, 0, true),
            right,
            12.0
        ));
        assert!(at(
            spot((14.0, 14.0), 300.0, 0.0, 23.0, 2, true),
            right - 46.0,
            12.0
        ));
    }

    #[test]
    fn the_bar_is_as_tall_as_the_themes_say() {
        let tokens = include_str!("../../../../packages/themes/src/tokens.css");
        assert!((pixels(tokens, "--titlebar-height") - BAR).abs() < f64::EPSILON);
    }

    #[test]
    fn the_bar_leaves_room_for_all_three_lights() {
        let tokens = include_str!("../../../../packages/themes/src/tokens.css");
        let last_light_ends = LEFT + 2.0 * WIDEST_PITCH + LIGHT;
        assert!(
            pixels(tokens, "--traffic-lights") >= last_light_ends + 4.0,
            "--traffic-lights must clear the zoom button, which ends at {last_light_ends}"
        );
    }

    #[test]
    fn tao_is_not_asked_to_place_them_too() {
        let config = include_str!("../tauri.macos.conf.json");
        assert!(!config.contains("trafficLightPosition"));
    }
}
