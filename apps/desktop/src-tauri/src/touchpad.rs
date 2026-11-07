#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

const FINGERS: &str = "orden://touchpad";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
pub struct Fingers {
    fingers: u32,
}

const DIGITIZER: u16 = 0x0D;
const TOUCH_PAD: u16 = 0x05;
const FINGER: u16 = 0x22;
const TIP: u16 = 0x42;
const CONTACT_COUNT: u16 = 0x54;

#[derive(Debug, Default)]
pub struct Frames {
    left: u32,
    down: u32,
}

impl Frames {
    pub fn report(&mut self, count: u32, tips: &[bool]) -> Option<u32> {
        if count > 0 {
            self.left = count;
            self.down = 0;
        }
        if self.left == 0 {
            return None;
        }
        for &tip in tips.iter().take(self.left as usize) {
            self.down += u32::from(tip);
            self.left -= 1;
        }
        (self.left == 0).then_some(self.down)
    }
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

#[cfg(windows)]
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
        HidP_GetCaps, HidP_GetLinkCollectionNodes, HidP_GetUsageValue, HidP_GetUsages, HidP_Input,
        HIDP_CAPS, HIDP_LINK_COLLECTION_NODE, HIDP_STATUS_SUCCESS, PHIDP_PREPARSED_DATA,
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
        telling, Fingers, Frames, CONTACT_COUNT, DIGITIZER, FINGER, FINGERS, TIP, TOUCH_PAD,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();

    struct Pad {
        shape: Vec<u64>,
        fingers: Vec<u16>,
        frames: Frames,
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
                lpszClassName: w!("nib-touchpad"),
                ..Default::default()
            };
            if RegisterClassW(&raw const class) == 0 {
                return;
            }
            let Ok(window) = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("nib-touchpad"),
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
            for report in all.chunks_exact(each) {
                let (count, tips) = report_of(pad, report);
                if let Some(now) = pad.frames.report(count, &tips) {
                    fingers = Some(now);
                }
            }
            let now = telling(kept.told, fingers?, in_front())?;
            kept.told = now;
            super::ON_THE_PAD.store(now, std::sync::atomic::Ordering::Relaxed);
            Some(now)
        });
        if let (Some(fingers), Some(app)) = (said, APP.get()) {
            let _ = app.emit(FINGERS, Fingers { fingers });
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
        (!fingers.is_empty()).then(|| Pad {
            shape,
            fingers,
            frames: Frames::default(),
        })
    }

    fn report_of(pad: &Pad, report: &[u8]) -> (u32, Vec<bool>) {
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
        let tips = pad
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
                status == HIDP_STATUS_SUCCESS
                    && usages.iter().take(length as usize).any(|&one| one == TIP)
            })
            .collect();
        (count, tips)
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
    use super::{telling, Fingers, Frames};

    #[test]
    fn a_frame_in_one_report_is_its_fingers_touching() {
        let mut frames = Frames::default();
        assert_eq!(
            frames.report(2, &[true, true, false, false, false]),
            Some(2)
        );
        assert_eq!(
            frames.report(2, &[false, false, false, false, false]),
            Some(0)
        );
    }

    #[test]
    fn a_frame_over_several_reports_is_whole_only_at_its_last() {
        let mut frames = Frames::default();
        assert_eq!(frames.report(3, &[true]), None);
        assert_eq!(frames.report(0, &[true]), None);
        assert_eq!(frames.report(0, &[false]), Some(2));
        assert_eq!(frames.report(0, &[true]), None);
    }

    #[test]
    fn a_report_beyond_its_frame_s_count_is_not_read() {
        let mut frames = Frames::default();
        assert_eq!(frames.report(1, &[true, true, true]), Some(1));
    }

    #[test]
    fn the_window_hears_changes_and_only_a_lift_while_nib_is_behind() {
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
    }
}
