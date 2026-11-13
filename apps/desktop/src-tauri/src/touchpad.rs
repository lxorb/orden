#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

const FINGERS: &str = "orden://touchpad";

const PAN: &str = "orden://touchpad-pan";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
pub struct Fingers {
    fingers: u32,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub struct Pan {
    dx: f64,
    dy: f64,
}

const DIGITIZER: u16 = 0x0D;
const TOUCH_PAD: u16 = 0x05;
const FINGER: u16 = 0x22;
const TIP: u16 = 0x42;
const CONTACT_COUNT: u16 = 0x54;
const CONTACT_ID: u16 = 0x51;
const DESKTOP: u16 = 0x01;
const ACROSS: u16 = 0x30;
const DOWN: u16 = 0x31;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Contact {
    pub id: u32,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Default)]
pub struct Frames {
    left: u32,
    down: Vec<Contact>,
}

impl Frames {
    pub fn report(&mut self, count: u32, seen: &[(bool, Contact)]) -> Option<Vec<Contact>> {
        if count > 0 {
            self.left = count;
            self.down.clear();
        }
        if self.left == 0 {
            return None;
        }
        for &(tip, contact) in seen.iter().take(self.left as usize) {
            if tip {
                self.down.push(contact);
            }
            self.left -= 1;
        }
        (self.left == 0).then(|| self.down.clone())
    }
}

#[derive(Debug, Default)]
pub struct Pair {
    last: Option<[Contact; 2]>,
}

impl Pair {
    pub fn frame(&mut self, down: &[Contact]) -> Option<Pan> {
        let [one, other] = down else {
            self.last = None;
            return None;
        };
        let now = if one.id <= other.id {
            [*one, *other]
        } else {
            [*other, *one]
        };
        let was = self.last.replace(now)?;
        if was[0].id != now[0].id || was[1].id != now[1].id {
            return None;
        }
        let dx = (now[0].x + now[1].x - was[0].x - was[1].x) / 2.0;
        let dy = (now[0].y + now[1].y - was[0].y - was[1].y) / 2.0;
        (dx != 0.0 || dy != 0.0).then_some(Pan { dx, dy })
    }
}

static PANS_WANTED: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

#[tauri::command]
pub fn touchpad_pan(on: bool) {
    let step = if on { 1 } else { -1 };
    PANS_WANTED.fetch_add(step, std::sync::atomic::Ordering::Relaxed);
}

#[must_use]
pub fn per_unit(logical: (i32, i32), physical: (i32, i32)) -> f64 {
    let wide = f64::from(logical.1) - f64::from(logical.0);
    let real = f64::from(physical.1) - f64::from(physical.0);
    if wide > 0.0 && real > 0.0 {
        real / wide
    } else {
        1.0
    }
}

fn pans_wanted() -> bool {
    PANS_WANTED.load(std::sync::atomic::Ordering::Relaxed) > 0
}

#[must_use]
pub fn telling(told: u32, fingers: u32, ours: bool) -> Option<u32> {
    let now = if ours { fingers } else { 0 };
    (now != told).then_some(now)
}

#[cfg(windows)]
pub fn start(app: &tauri::AppHandle) {
    raw::start(app);
}

#[cfg(windows)]
static ON_THE_PAD: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

#[cfg(all(windows, not(feature = "cef")))]
pub fn fingers() -> u32 {
    ON_THE_PAD.load(std::sync::atomic::Ordering::Relaxed)
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a touchpad's own reports reach a program only as raw input, read through user32 and hid.dll"
)]
mod raw {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::OnceLock;

    use tauri::{AppHandle, Emitter};
    use windows::core::w;
    use windows::Win32::Devices::HumanInterfaceDevice::{
        HidP_GetCaps, HidP_GetLinkCollectionNodes, HidP_GetSpecificValueCaps, HidP_GetUsageValue,
        HidP_GetUsages, HidP_Input, HIDP_CAPS, HIDP_LINK_COLLECTION_NODE, HIDP_STATUS_SUCCESS,
        HIDP_VALUE_CAPS, PHIDP_PREPARSED_DATA,
    };
    use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::Input::{
        GetRawInputData, GetRawInputDeviceInfoW, RegisterRawInputDevices, HRAWINPUT, RAWINPUT,
        RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK, RIDI_PREPARSEDDATA, RID_INPUT,
        RIM_TYPEHID,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetForegroundWindow, GetMessageW,
        GetWindowThreadProcessId, RegisterClassW, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_INPUT, WNDCLASSW,
    };

    use super::{
        pans_wanted, telling, Contact, Fingers, Frames, Pair, ACROSS, CONTACT_COUNT, CONTACT_ID,
        DESKTOP, DIGITIZER, DOWN, FINGER, FINGERS, PAN, TIP, TOUCH_PAD,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();

    struct Pad {
        shape: Vec<u64>,
        fingers: Vec<u16>,
        frames: Frames,
        pair: Pair,
        across: f64,
        down: f64,
    }

    #[derive(Default)]
    struct Kept {
        pads: HashMap<isize, Option<Pad>>,
        told: u32,
    }

    thread_local! {
        static KEPT: RefCell<Kept> = RefCell::new(Kept::default());
    }

    pub fn start(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        let _ = std::thread::Builder::new()
            .name("touchpad".into())
            .spawn(listen);
    }

    fn listen() {
        unsafe {
            let Ok(module) = GetModuleHandleW(None) else {
                return;
            };
            let class = WNDCLASSW {
                lpfnWndProc: Some(heard),
                hInstance: module.into(),
                lpszClassName: w!("orden-touchpad"),
                ..Default::default()
            };
            if RegisterClassW(&raw const class) == 0 {
                return;
            }
            let Ok(window) = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("orden-touchpad"),
                w!(""),
                WINDOW_STYLE::default(),
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                None,
                module,
                None,
            ) else {
                return;
            };
            let pad = RAWINPUTDEVICE {
                usUsagePage: DIGITIZER,
                usUsage: TOUCH_PAD,
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: window,
            };
            let size = u32::try_from(size_of::<RAWINPUTDEVICE>()).unwrap_or(0);
            if RegisterRawInputDevices(&[pad], size).is_err() {
                return;
            }
            let mut message = MSG::default();
            while GetMessageW(&raw mut message, HWND::default(), 0, 0).as_bool() {
                DispatchMessageW(&raw const message);
            }
        }
    }

    unsafe extern "system" fn heard(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_INPUT {
            read(HRAWINPUT(lparam.0 as _));
        }
        unsafe { DefWindowProcW(window, message, wparam, lparam) }
    }

    fn read(input: HRAWINPUT) {
        let header = u32::try_from(size_of::<RAWINPUTHEADER>()).unwrap_or(0);
        let mut size = 0u32;
        if unsafe { GetRawInputData(input, RID_INPUT, None, &raw mut size, header) } != 0 {
            return;
        }
        let bytes = size as usize;
        if bytes < size_of::<RAWINPUT>() {
            return;
        }
        let mut buffer = vec![0u64; bytes.div_ceil(8)];
        let wrote = unsafe {
            GetRawInputData(
                input,
                RID_INPUT,
                Some(buffer.as_mut_ptr().cast()),
                &raw mut size,
                header,
            )
        };
        if wrote == u32::MAX || wrote as usize > bytes {
            return;
        }
        let raw = unsafe { &*buffer.as_ptr().cast::<RAWINPUT>() };
        if raw.header.dwType != RIM_TYPEHID.0 {
            return;
        }
        let hid = unsafe { raw.data.hid };
        let each = hid.dwSizeHid as usize;
        let count = hid.dwCount as usize;
        let start = std::mem::offset_of!(RAWINPUT, data)
            + std::mem::offset_of!(windows::Win32::UI::Input::RAWHID, bRawData);
        let Some(end) = each
            .checked_mul(count)
            .and_then(|all| all.checked_add(start))
        else {
            return;
        };
        if each == 0 || end > bytes {
            return;
        }
        let all = unsafe {
            std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>().add(start), each * count)
        };
        let device = raw.header.hDevice;

        let said = KEPT.with_borrow_mut(|kept| {
            let pad = kept
                .pads
                .entry(device.0 as isize)
                .or_insert_with(|| shape_of(device))
                .as_mut()?;
            let mut fingers = None;
            let mut pans = Vec::new();
            let front = in_front();
            for report in all.chunks_exact(each) {
                let (count, seen) = report_of(pad, report);
                if let Some(down) = pad.frames.report(count, &seen) {
                    fingers = Some(u32::try_from(down.len()).unwrap_or(u32::MAX));
                    if let Some(pan) = pad.pair.frame(&down) {
                        if front && pans_wanted() {
                            pans.push(pan);
                        }
                    }
                }
            }
            let told = fingers.and_then(|fingers| telling(kept.told, fingers, front));
            if let Some(now) = told {
                kept.told = now;
                super::ON_THE_PAD.store(now, std::sync::atomic::Ordering::Relaxed);
            }
            Some((told, pans))
        });
        let (Some((told, pans)), Some(app)) = (said, APP.get()) else {
            return;
        };
        if let Some(fingers) = told {
            let _ = app.emit(FINGERS, Fingers { fingers });
        }
        for pan in pans {
            let _ = app.emit(PAN, pan);
        }
    }

    fn shape_of(device: HANDLE) -> Option<Pad> {
        let mut size = 0u32;
        unsafe { GetRawInputDeviceInfoW(device, RIDI_PREPARSEDDATA, None, &raw mut size) };
        if size == 0 {
            return None;
        }
        let mut shape = vec![0u64; (size as usize).div_ceil(8)];
        let wrote = unsafe {
            GetRawInputDeviceInfoW(
                device,
                RIDI_PREPARSEDDATA,
                Some(shape.as_mut_ptr().cast()),
                &raw mut size,
            )
        };
        if wrote == u32::MAX || wrote == 0 {
            return None;
        }
        let parsed = PHIDP_PREPARSED_DATA(shape.as_ptr() as isize);
        let mut caps = HIDP_CAPS::default();
        if unsafe { HidP_GetCaps(parsed, &raw mut caps) } != HIDP_STATUS_SUCCESS {
            return None;
        }
        let mut length = u32::from(caps.NumberLinkCollectionNodes);
        let mut nodes = vec![HIDP_LINK_COLLECTION_NODE::default(); length as usize];
        if unsafe { HidP_GetLinkCollectionNodes(nodes.as_mut_ptr(), &raw mut length, parsed) }
            != HIDP_STATUS_SUCCESS
        {
            return None;
        }
        let fingers: Vec<u16> = nodes
            .iter()
            .take(length as usize)
            .enumerate()
            .filter(|(_, node)| node.LinkUsagePage == DIGITIZER && node.LinkUsage == FINGER)
            .filter_map(|(at, _)| u16::try_from(at).ok())
            .collect();
        let first = *fingers.first()?;
        let across = physical(parsed, first, ACROSS);
        let down = physical(parsed, first, DOWN);
        Some(Pad {
            shape,
            fingers,
            frames: Frames::default(),
            pair: Pair::default(),
            across,
            down,
        })
    }

    fn physical(parsed: PHIDP_PREPARSED_DATA, link: u16, usage: u16) -> f64 {
        let mut caps = vec![HIDP_VALUE_CAPS::default(); 1];
        let mut length = 1u16;
        let status = unsafe {
            HidP_GetSpecificValueCaps(
                HidP_Input,
                DESKTOP,
                link,
                usage,
                caps.as_mut_ptr(),
                &raw mut length,
                parsed,
            )
        };
        if status != HIDP_STATUS_SUCCESS || length == 0 {
            return 1.0;
        }
        super::per_unit(
            (caps[0].LogicalMin, caps[0].LogicalMax),
            (caps[0].PhysicalMin, caps[0].PhysicalMax),
        )
    }

    fn report_of(pad: &Pad, report: &[u8]) -> (u32, Vec<(bool, Contact)>) {
        let parsed = PHIDP_PREPARSED_DATA(pad.shape.as_ptr() as isize);
        let mut count = 0u32;
        let found = unsafe {
            HidP_GetUsageValue(
                HidP_Input,
                DIGITIZER,
                0,
                CONTACT_COUNT,
                &raw mut count,
                parsed,
                report,
            )
        };
        if found != HIDP_STATUS_SUCCESS {
            count = 0;
        }
        let mut copy = report.to_vec();
        let value = |page: u16, link: u16, usage: u16| {
            let mut value = 0u32;
            let status = unsafe {
                HidP_GetUsageValue(
                    HidP_Input,
                    page,
                    link,
                    usage,
                    &raw mut value,
                    parsed,
                    report,
                )
            };
            (status == HIDP_STATUS_SUCCESS).then_some(value)
        };
        let seen = pad
            .fingers
            .iter()
            .map(|&link| {
                let mut usages = [0u16; 16];
                let mut length = u32::try_from(usages.len()).unwrap_or(0);
                let status = unsafe {
                    HidP_GetUsages(
                        HidP_Input,
                        DIGITIZER,
                        link,
                        usages.as_mut_ptr(),
                        &raw mut length,
                        parsed,
                        &mut copy,
                    )
                };
                let tip = status == HIDP_STATUS_SUCCESS
                    && usages.iter().take(length as usize).any(|&one| one == TIP);
                let contact = Contact {
                    id: value(DIGITIZER, link, CONTACT_ID).unwrap_or(u32::from(link)),
                    x: f64::from(value(DESKTOP, link, ACROSS).unwrap_or(0)) * pad.across,
                    y: f64::from(value(DESKTOP, link, DOWN).unwrap_or(0)) * pad.down,
                };
                (tip, contact)
            })
            .collect();
        (count, seen)
    }

    fn in_front() -> bool {
        unsafe {
            let front = GetForegroundWindow();
            let mut owner = 0u32;
            GetWindowThreadProcessId(front, Some(&raw mut owner));
            owner != 0 && owner == GetCurrentProcessId()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{per_unit, telling, Contact, Fingers, Frames, Pair, Pan};

    fn at(id: u32, x: f64, y: f64) -> Contact {
        Contact { id, x, y }
    }

    fn tips(down: &[bool]) -> Vec<(bool, Contact)> {
        down.iter()
            .enumerate()
            .map(|(at_, &tip)| (tip, at(u32::try_from(at_).unwrap_or(0), 0.0, 0.0)))
            .collect()
    }

    fn count(said: Option<Vec<Contact>>) -> Option<usize> {
        said.map(|down| down.len())
    }

    #[test]
    fn a_frame_in_one_report_is_its_fingers_touching() {
        let mut frames = Frames::default();
        assert_eq!(
            count(frames.report(2, &tips(&[true, true, false, false, false]))),
            Some(2)
        );
        assert_eq!(
            count(frames.report(2, &tips(&[false, false, false, false, false]))),
            Some(0)
        );
    }

    #[test]
    fn a_frame_over_several_reports_is_whole_only_at_its_last() {
        let mut frames = Frames::default();
        assert_eq!(count(frames.report(3, &tips(&[true]))), None);
        assert_eq!(count(frames.report(0, &tips(&[true]))), None);
        assert_eq!(count(frames.report(0, &tips(&[false]))), Some(2));
        assert_eq!(count(frames.report(0, &tips(&[true]))), None);
    }

    #[test]
    fn a_report_beyond_its_frame_s_count_is_not_read() {
        let mut frames = Frames::default();
        assert_eq!(count(frames.report(1, &tips(&[true, true, true]))), Some(1));
    }

    #[test]
    fn a_frame_keeps_where_each_finger_touching_is() {
        let mut frames = Frames::default();
        let seen = [
            (true, at(7, 1.0, 2.0)),
            (false, at(8, 9.0, 9.0)),
            (true, at(9, 3.0, 4.0)),
        ];
        assert_eq!(
            frames.report(3, &seen),
            Some(vec![at(7, 1.0, 2.0), at(9, 3.0, 4.0)])
        );
    }

    #[test]
    fn two_fingers_moving_together_pan_by_their_middle_in_any_direction() {
        let mut pair = Pair::default();
        assert_eq!(pair.frame(&[at(1, 10.0, 10.0), at(2, 30.0, 10.0)]), None);
        assert_eq!(
            pair.frame(&[at(2, 34.0, 13.0), at(1, 14.0, 13.0)]),
            Some(Pan { dx: 4.0, dy: 3.0 })
        );
        assert_eq!(
            pair.frame(&[at(1, 11.0, 18.0), at(2, 31.0, 18.0)]),
            Some(Pan { dx: -3.0, dy: 5.0 })
        );
    }

    #[test]
    fn one_finger_three_fingers_or_new_fingers_pan_nothing() {
        let mut pair = Pair::default();
        assert_eq!(pair.frame(&[at(1, 0.0, 0.0), at(2, 0.0, 0.0)]), None);
        assert_eq!(pair.frame(&[at(1, 5.0, 5.0)]), None);
        assert_eq!(pair.frame(&[at(1, 5.0, 5.0), at(2, 5.0, 5.0)]), None);
        assert_eq!(pair.frame(&[at(1, 9.0, 9.0), at(3, 9.0, 9.0)]), None);
        assert_eq!(
            pair.frame(&[at(1, 9.0, 9.0), at(3, 9.0, 9.0), at(4, 0.0, 0.0)]),
            None
        );
        assert_eq!(pair.frame(&[at(1, 9.0, 9.0), at(3, 9.0, 9.0)]), None);
        assert_eq!(pair.frame(&[at(1, 9.0, 9.0), at(3, 9.0, 9.0)]), None);
    }

    #[test]
    fn a_pad_s_units_are_made_alike_across_and_down() {
        assert!((per_unit((0, 4000), (0, 1000)) - 0.25).abs() < 1e-9);
        assert!((per_unit((0, 2000), (0, 1000)) - 0.5).abs() < 1e-9);
        assert!((per_unit((0, 0), (0, 0)) - 1.0).abs() < 1e-9);
        assert!((per_unit((0, 100), (0, 0)) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn the_window_hears_changes_and_only_a_lift_while_orden_is_behind() {
        assert_eq!(telling(0, 2, true), Some(2));
        assert_eq!(telling(2, 2, true), None);
        assert_eq!(telling(2, 0, true), Some(0));
        assert_eq!(telling(0, 2, false), None);
        assert_eq!(telling(2, 2, false), Some(0));
    }

    #[test]
    fn the_window_is_told_in_its_own_words() {
        assert_eq!(
            serde_json::to_value(Fingers { fingers: 2 }).expect("fingers are said as JSON"),
            serde_json::json!({ "fingers": 2 })
        );
        assert_eq!(
            serde_json::to_value(Pan { dx: 1.5, dy: -2.0 }).expect("a pan is said as JSON"),
            serde_json::json!({ "dx": 1.5, "dy": -2.0 })
        );
    }
}
