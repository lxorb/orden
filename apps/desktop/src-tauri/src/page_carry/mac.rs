use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, ProtocolObject, Sel};
use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly, Message as _};
use objc2_app_kit::{NSDraggingInfo, NSPasteboard, NSPasteboardTypeString, NSPasteboardTypeURL};
use objc2_foundation::{MainThreadMarker, NSArray, NSInteger, NSObjectProtocol, NSString};

use super::Carried;

struct Held {
    info: Retained<ProtocolObject<dyn NSDraggingInfo>>,
    board: Retained<NSPasteboard>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "NibCarriedDrag"]
    #[ivars = Held]
    struct CarriedDrag;

    unsafe impl NSObjectProtocol for CarriedDrag {}

    unsafe impl NSDraggingInfo for CarriedDrag {
        #[unsafe(method_id(draggingPasteboard))]
        fn dragging_pasteboard(&self) -> Retained<NSPasteboard> {
            self.ivars().board.clone()
        }
    }

    impl CarriedDrag {
        #[unsafe(method(respondsToSelector:))]
        fn responds_to_selector(&self, selector: Sel) -> bool {
            forwards(self, selector)
        }

        #[unsafe(method(forwardingTargetForSelector:))]
        fn forwarding_target_for_selector(&self, _selector: Sel) -> *mut AnyObject {
            Retained::as_ptr(&self.ivars().info)
                .cast::<AnyObject>()
                .cast_mut()
        }
    }
);

#[allow(
    unsafe_code,
    reason = "the superclass's own answer is asked for through the Objective-C runtime"
)]
fn forwards(drag: &CarriedDrag, selector: Sel) -> bool {
    let own: bool = unsafe { msg_send![super(drag), respondsToSelector: selector] };
    own || drag.ivars().info.respondsToSelector(selector)
}

thread_local! {
    static BOARD: RefCell<Option<(NSInteger, Retained<NSPasteboard>)>> = const { RefCell::new(None) };
}

#[allow(
    unsafe_code,
    deprecated,
    reason = "a pasteboard of the files is written through AppKit, under the file names' type WebKit reads a drop's files from"
)]
fn board_of(carried: &Carried) -> Retained<NSPasteboard> {
    let board = NSPasteboard::pasteboardWithUniqueName();
    let mut types = Vec::new();
    if !carried.files.is_empty() {
        types.push(unsafe { objc2_app_kit::NSFilenamesPboardType });
    }
    if carried.text.is_some() {
        types.push(unsafe { NSPasteboardTypeString });
    }
    if !carried.addresses.is_empty() {
        types.push(unsafe { NSPasteboardTypeURL });
    }
    unsafe { board.declareTypes_owner(&NSArray::from_slice(&types), None) };
    if !carried.files.is_empty() {
        let files: Vec<Retained<NSString>> = carried
            .files
            .iter()
            .map(|one| NSString::from_str(&one.to_string_lossy()))
            .collect();
        let files = NSArray::from_retained_slice(&files);
        unsafe { board.setPropertyList_forType(&files, objc2_app_kit::NSFilenamesPboardType) };
    }
    if let Some(text) = &carried.text {
        board.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString });
    }
    if let Some(address) = carried.addresses.first() {
        board.setString_forType(&NSString::from_str(address), unsafe { NSPasteboardTypeURL });
    }
    board
}

#[allow(
    unsafe_code,
    reason = "a pasteboard made for one drag is let go of through the Objective-C runtime"
)]
fn board_for(drag: NSInteger, carried: &Carried) -> Retained<NSPasteboard> {
    BOARD.with_borrow_mut(|kept| {
        if let Some((was, board)) = kept.as_ref() {
            if *was == drag {
                return board.clone();
            }
            let () = unsafe { msg_send![&**board, releaseGlobally] };
        }
        let board = board_of(carried);
        *kept = Some((drag, board.clone()));
        board
    })
}

fn carried_in(
    info: &ProtocolObject<dyn NSDraggingInfo>,
    dropping: bool,
) -> Option<Retained<ProtocolObject<dyn NSDraggingInfo>>> {
    let carried = super::carrying()?;
    info.draggingSource()?;
    let mtm = MainThreadMarker::new()?;
    let board = board_for(info.draggingSequenceNumber(), &carried);
    if dropping {
        super::taken();
    }
    let drag = CarriedDrag::alloc(mtm).set_ivars(Held {
        info: info.retain(),
        board,
    });
    #[allow(
        unsafe_code,
        reason = "an Objective-C object is initialised through its superclass"
    )]
    let drag: Retained<CarriedDrag> = unsafe { msg_send![super(drag), init] };
    Some(ProtocolObject::from_retained(drag))
}

pub(crate) fn arm() {
    wry::carry_into_pages(carried_in);
}
