use serde::Serialize;

use crate::web_keys::{Held, Pressed, PRESSED};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Asked {
    Behind,
    Front,
}

const BEHIND: &str = "nib-behind";
const FRONT: &str = "nib-front";

const FIND: &str = "nib-find";
const FIND_NEXT: &str = "nib-find-next";
const FIND_PREVIOUS: &str = "nib-find-previous";
const ADDRESS: &str = "nib-address";
const CTRL_D: &str = "nib-ctrl-d";
const CTRL_SHIFT_D: &str = "nib-ctrl-shift-d";
const CTRL_SPACE: &str = "nib-ctrl-space";
const CTRL_SHIFT_SPACE: &str = "nib-ctrl-shift-space";
const CTRL_H: &str = "nib-ctrl-h";
const CTRL_SHIFT_DELETE: &str = "nib-ctrl-shift-delete";

const ACTUAL: &str = "nib-actual-size";

const INSTALL: &str = "nib-install-extension";

const ESCAPE: &str = "nib-escape";

const TWICE_SHIFT: &str = "nib-twice-shift";
const TWICE_CTRL: &str = "nib-twice-ctrl";
const TWICE_ALT: &str = "nib-twice-alt";

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const PASSED: &str = "nib://web-passed";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub enum Passed {
    Find,
    Next,
    Previous,
    Address,
    #[serde(rename = "shift-shift")]
    ShiftTwice,
    #[serde(rename = "ctrl-ctrl")]
    CtrlTwice,
    #[serde(rename = "alt-alt")]
    AltTwice,
    Install,
    Escape,
}

impl Passed {
    #[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
    pub const fn is_tap(self) -> bool {
        matches!(
            self,
            Self::ShiftTwice | Self::CtrlTwice | Self::AltTwice | Self::Escape
        )
    }

    #[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
    pub fn wanted_by(self, window: &str) -> bool {
        self != Self::Escape || crate::full_screen::is_on(window)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
struct Ask {
    tab: String,
    key: Passed,
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn passed(app: &tauri::AppHandle, window: &str, tab: &str, key: Passed) {
    let ask = Ask {
        tab: tab.to_string(),
        key,
    };
    told(app, window, PASSED, ask);
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn played(app: &tauri::AppHandle, window: &str, key: Pressed) {
    told(app, window, PRESSED, key);
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn told<S: Serialize + Clone>(app: &tauri::AppHandle, window: &str, event: &str, said: S) {
    use tauri::{Emitter, Manager};

    if let Some(ours) = app.get_webview(window) {
        crate::placement::keyboard_to(&ours);
    }
    let _ = app.emit_to(window, event, said);
}

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
const PRESSED_IN: &str = "nib-pressed";

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
const BLOCKED: &str = "nib-popup-blocked";

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
pub const PAGE_SCRIPT: &str = r"(function () {
  var open = window.open
  if (typeof open !== 'function' || typeof Proxy !== 'function') return
  function said(kind, url) {
    var at = null
    try { at = String(new URL(url == null || url === '' ? 'about:blank' : String(url), location.href)) } catch (e) { return }
    window.dispatchEvent(new CustomEvent(kind, { detail: at }))
  }
  window.open = new Proxy(open, {
    apply: function (engine, self, args) {
      var active = !navigator.userActivation || navigator.userActivation.isActive
      var name = args.length > 1 && args[1] != null ? String(args[1]) : '_blank'
      var features = args.length > 2 && args[2] != null ? String(args[2]).toLowerCase() : ''
      if (/(^|[\s,])no(opener|referrer)(?=$|[\s,=])/.test(features) && (name === '_blank' || name === '')) {
        said(active ? 'nib-open-tab' : 'nib-popup-blocked', args[0])
        return null
      }
      var opened = Reflect.apply(engine, self, args)
      if (!opened && !active) said('nib-popup-blocked', args[0])
      return opened
    }
  })
})()";

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
pub const SCRIPT: &str = r"(function () {
  var open = window.open.bind(window)
  var windows = window.open.bind(window)

  var came = new WeakSet()

  function last(type, answer, stopped) {
    function after(event) {
      removeEventListener(type, after)
      came.add(event)
      answer(event)
    }
    addEventListener(type, function (event) {
      removeEventListener(type, after)
      addEventListener(type, after)
      if (stopped) setTimeout(function () {
        if (!came.has(event)) answer(event, true)
      })
    }, true)
  }

  function asked(event, front) {
    if (!event.isTrusted || event.defaultPrevented) return
    var link = event.target instanceof Element ? event.target.closest('a[href], area[href]') : null
    if (!link || typeof link.href !== 'string' || !/^https?:/i.test(link.href)) return
    if (front === 'blank' && (link.target || '').toLowerCase() !== '_blank') return
    event.preventDefault()
    open(link.href, front || event.shiftKey ? 'nib-front' : 'nib-behind')
  }

  last('auxclick', function (event) {
    if (event.button === 1) asked(event)
  })

  var posted = 0
  last('submit', function (event) {
    var form = event.target
    if (!event.isTrusted || event.defaultPrevented || !(form instanceof HTMLFormElement)) return
    var by = event.submitter && event.submitter.hasAttribute('formtarget') ? event.submitter : null
    var method = event.submitter && event.submitter.getAttribute('formmethod') || form.method
    var target = by ? by.getAttribute('formtarget') : form.target
    if (String(method).toLowerCase() !== 'post' || target !== '_blank') return
    var name = 'nib-post-' + (++posted)
    if (!windows('about:blank', name)) return
    if (by) by.setAttribute('formtarget', name)
    else form.target = name
    setTimeout(function () {
      if (by) by.setAttribute('formtarget', target)
      else form.target = target
    })
  })

  last('click', function (event) {
    var held = event.ctrlKey || event.shiftKey
    if (event.button === 0 && held && !event.altKey && !event.metaKey) asked(event)
    else if (event.button === 0 && !event.altKey && !event.metaKey) asked(event, 'blank')
  })

  // A press anywhere in the page chooses its tab and its pane, said through nib's own
  // binding where there is one (#1080): the window system says nothing of a press into a
  // page that has the keyboard already. Never as a window: that would spend the press's
  // activation, which the page's own `window.open` in the same press needs.
  addEventListener('pointerdown', function (event) {
    var asking = globalThis.nibAsked
    if (event.isTrusted && typeof asking === 'function') asking(JSON.stringify(['', 'nib-pressed']))
  }, true)

  addEventListener('nib-open-tab', function (event) {
    if (typeof event.detail === 'string') open(event.detail, 'nib-front')
  })
  addEventListener('nib-popup-blocked', function (event) {
    var asking = globalThis.nibAsked
    if (typeof event.detail === 'string' && typeof asking === 'function')
      asking(JSON.stringify([event.detail, 'nib-popup-blocked']))
  })

  last('keydown', function (event, stopped) {
    if (!event.isTrusted || event.defaultPrevented || event.metaKey) return
    var ctrl = event.ctrlKey
    var alt = event.altKey
    var back = event.shiftKey
    var code = event.keyCode
    var name = null
    if (stopped && code === 27) return
    if (!ctrl && !alt && !back && code === 27) return open('about:blank', 'nib-escape')
    if (ctrl && alt) return
    else if (alt) name = code === 68 && !back ? 'nib-address' : null
    else if (ctrl && code === 70 && !back) name = 'nib-find'
    else if (ctrl && code === 76 && !back) name = 'nib-address'
    else if (ctrl && (code === 48 || code === 96) && !back) name = 'nib-actual-size'
    else if (ctrl && code === 68) name = back ? 'nib-ctrl-shift-d' : 'nib-ctrl-d'
    else if (ctrl && code === 32) name = back ? 'nib-ctrl-shift-space' : 'nib-ctrl-space'
    else if (ctrl && code === 72 && !back) name = 'nib-ctrl-h'
    else if (ctrl && code === 46 && back) name = 'nib-ctrl-shift-delete'
    else if (ctrl && code === 71) name = back ? 'nib-find-previous' : 'nib-find-next'
    else if (!ctrl && code === 114) name = back ? 'nib-find-previous' : 'nib-find-next'
    if (!name || (stopped && /^nib-(find|actual)/.test(name))) return
    event.preventDefault()
    open('about:blank', name)
  }, true)

  var within = 350
  var twice = { Shift: 'nib-twice-shift', Control: 'nib-twice-ctrl', Alt: 'nib-twice-alt' }
  var down = null
  var tap = null
  var asking = null
  function broken() {
    down = null
    tap = null
  }
  function alone(event, key) {
    return (key === 'Shift' || !event.shiftKey) && (key === 'Control' || !event.ctrlKey) &&
      (key === 'Alt' || !event.altKey) && !event.metaKey
  }
  addEventListener('keydown', function (event) {
    if (!event.isTrusted || event.repeat) return
    if (event.isComposing || event.key === 'Process') return broken()
    if (twice[event.key] && down === null && alone(event, event.key)) {
      if (tap && event.timeStamp - tap.at > within) tap = null
      down = { key: event.key, at: event.timeStamp }
      return
    }
    broken()
  }, true)
  addEventListener('keyup', function (event) {
    asking = null
    if (!event.isTrusted) return
    if (!down || down.key !== event.key) return broken()
    var key = down.key
    var at = down.at
    down = null
    if (event.timeStamp - at > within) {
      tap = null
      return
    }
    var again = tap && tap.key === key && at - tap.at <= within
    if (again && tap.spent) {
      tap = { key: key, at: event.timeStamp, spent: true }
      return
    }
    tap = { key: key, at: event.timeStamp, spent: again }
    if (again) asking = key
  }, true)
  addEventListener('pointerdown', broken, true)
  addEventListener('wheel', broken, true)
  addEventListener('blur', function (event) {
    if (event.target === window) broken()
  }, true)
  last('keyup', function (event) {
    var key = asking
    asking = null
    if (key && !event.defaultPrevented) open('about:blank', twice[key])
  }, true)
  var here = typeof location === 'object' ? location : null
  if (here && /^(chromewebstore\.google\.com|microsoftedge\.microsoft\.com)$/.test(here.hostname) &&
    /\/detail\//.test(here.pathname)) {
    addEventListener('click', function (event) {
      if (!event.isTrusted || event.button !== 0) return
      var button = event.target instanceof Element ? event.target.closest('button') : null
      if (!button) return
      var said = button.innerText || ''
      if (!/^getOrRemoveButton/.test(button.id) && !(/chrome/i.test(said) && !/enterprise/i.test(said))) return
      event.preventDefault()
      event.stopImmediatePropagation()
      open('about:blank', 'nib-install-extension')
    }, true)
  }
})()";

const STORE_PART: &str = "  var here = typeof location";
const STORE_END: &str = "    }, true)\n  }\n";

#[cfg_attr(
    not(feature = "cef"),
    allow(dead_code, reason = "only nib's own Chromium leaves it out")
)]
fn without_store_button(script: &str) -> String {
    let Some(start) = script.find(STORE_PART) else {
        return script.to_owned();
    };
    let end = script[start..]
        .find(STORE_END)
        .map_or(start, |at| start + at + STORE_END.len());
    format!("{}{}", &script[..start], &script[end..])
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
pub fn chord(name: &str) -> Option<Pressed> {
    match name {
        CTRL_D => Some(Pressed::with_ctrl("d", "KeyD", false)),
        CTRL_SHIFT_D => Some(Pressed::with_ctrl("D", "KeyD", true)),
        CTRL_SPACE => Some(Pressed::with_ctrl(" ", "Space", false)),
        CTRL_SHIFT_SPACE => Some(Pressed::with_ctrl(" ", "Space", true)),
        CTRL_H => Some(Pressed::with_ctrl("h", "KeyH", false)),
        CTRL_SHIFT_DELETE => Some(Pressed::with_ctrl("Delete", "Delete", true)),
        _ => None,
    }
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
pub fn sought(name: &str) -> Option<Passed> {
    match name {
        FIND => Some(Passed::Find),
        FIND_NEXT => Some(Passed::Next),
        FIND_PREVIOUS => Some(Passed::Previous),
        ADDRESS => Some(Passed::Address),
        TWICE_SHIFT => Some(Passed::ShiftTwice),
        TWICE_CTRL => Some(Passed::CtrlTwice),
        TWICE_ALT => Some(Passed::AltTwice),
        INSTALL => Some(Passed::Install),
        ESCAPE => Some(Passed::Escape),
        _ => None,
    }
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn actual(name: &str) -> bool {
    name == ACTUAL
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const LATELY_MS: u32 = 1000;

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn taken_as_a_person_s(key: Passed, user: bool, since: u32, focused: bool) -> bool {
    user || (key.is_tap() && focused && since <= LATELY_MS)
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
pub fn placed(name: &str, user: bool, held: Held, menu: bool) -> Option<Asked> {
    match name {
        BEHIND => return Some(Asked::Behind),
        FRONT => return Some(Asked::Front),
        _ => {}
    }

    if !user {
        return None;
    }
    if held.ctrl {
        return Some(if held.shift {
            Asked::Front
        } else {
            Asked::Behind
        });
    }
    if held.shift {
        return Some(Asked::Front);
    }
    menu.then_some(Asked::Behind)
}

#[cfg(all(windows, not(feature = "cef")))]
pub use heard::{closing, listen, ours, taken, unasked};

#[cfg(all(windows, not(feature = "cef")))]
mod heard {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2NewWindowRequestedEventArgs2, ICoreWebView2_11,
    };
    use webview2_com::{
        ContextMenuRequestedEventHandler, NewWindowRequestedEventHandler,
        WindowCloseRequestedEventHandler,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetFocus, GetKeyState, GetLastInputInfo, LASTINPUTINFO, VIRTUAL_KEY,
        VK_CONTROL, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::IsChild;
    use windows_core::Interface;

    use super::{actual, chord, passed, placed, played, sought, taken_as_a_person_s, Asked, Held};

    thread_local! {
        static SAID: RefCell<HashMap<String, Option<Asked>>> = RefCell::new(HashMap::new());
        static MENU: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
        static OURS: RefCell<std::collections::HashSet<String>> =
            RefCell::new(std::collections::HashSet::new());
        static UNASKED: RefCell<std::collections::HashSet<String>> =
            RefCell::new(std::collections::HashSet::new());
    }

    fn noted(tab: &str, said: Option<Asked>, user: bool) {
        SAID.with_borrow_mut(|all| all.insert(tab.to_string(), said));
        if !user {
            UNASKED.with_borrow_mut(|all| all.insert(tab.to_string()));
        }
    }

    pub fn unasked(tab: &str) -> bool {
        UNASKED.with_borrow_mut(|unasked| unasked.remove(tab))
    }

    fn nibs_own(name: &str) -> bool {
        crate::web_swipe::named(name).is_some()
            || sought(name).is_some()
            || chord(name).is_some()
            || actual(name)
    }

    pub fn ours(tab: &str) -> bool {
        OURS.with_borrow_mut(|ours| ours.remove(tab))
    }

    #[allow(
        unsafe_code,
        reason = "a page closing itself is one of WebView2's own events, and its objects are reached through COM"
    )]
    pub fn closing(webview: &PlatformWebview, window: tauri::WebviewWindow) {
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let closed = WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                let _ = window.close();
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_WindowCloseRequested(&closed, &raw mut token);
        }
    }

    pub fn taken(tab: &str) -> Option<Asked> {
        SAID.with_borrow_mut(|said| said.remove(tab)).flatten()
    }

    #[allow(
        unsafe_code,
        reason = "the last input and the window with the keyboard are Win32's to say"
    )]
    fn typing_here(host: HWND) -> (u32, bool) {
        let mut last = LASTINPUTINFO {
            cbSize: u32::try_from(std::mem::size_of::<LASTINPUTINFO>()).unwrap_or(8),
            dwTime: 0,
        };

        unsafe {
            let since = if GetLastInputInfo(&raw mut last).as_bool() {
                GetTickCount().wrapping_sub(last.dwTime)
            } else {
                u32::MAX
            };
            let focus = GetFocus();
            let here = !focus.is_invalid() && (focus == host || IsChild(host, focus).as_bool());
            (since, here)
        }
    }

    #[allow(
        unsafe_code,
        reason = "a page asking for a window is one of WebView2's own events, and its objects are reached through COM"
    )]
    pub fn listen(webview: &PlatformWebview, app: tauri::AppHandle, tab: String, window: String) {
        let held = |key: VIRTUAL_KEY| {
            let code = i32::from(key.0);
            unsafe { GetKeyState(code) < 0 || GetAsyncKeyState(code) < 0 }
        };

        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };

            let mut parent = windows_com::Win32::Foundation::HWND::default();
            let _ = webview.controller().ParentWindow(&raw mut parent);
            let host = HWND(parent.0);

            let asking = tab.clone();
            let requested = NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };

                let mut uri = windows_core::PWSTR::null();
                args.Uri(&raw mut uri)?;
                let uri = webview2_com::take_pwstr(uri);

                let mut user = windows_core::BOOL::default();
                let _ = args.IsUserInitiated(&raw mut user);

                let name = args
                    .cast::<ICoreWebView2NewWindowRequestedEventArgs2>()
                    .ok()
                    .and_then(|named| {
                        let mut name = windows_core::PWSTR::null();
                        named.Name(&raw mut name).ok()?;
                        Some(webview2_com::take_pwstr(name))
                    })
                    .unwrap_or_default();

                if nibs_own(&name) {
                    OURS.with_borrow_mut(|ours| ours.insert(asking.clone()));
                }
                if let Some(payload) = crate::web_swipe::named(&name) {
                    crate::web_swipe::heard(&app, &window, &asking, payload);
                    return Ok(());
                }
                if let Some(key) = sought(&name) {
                    let (since, focused) = typing_here(host);
                    if key.wanted_by(&window)
                        && taken_as_a_person_s(key, user.as_bool(), since, focused)
                    {
                        passed(&app, &window, &asking, key);
                    }
                    return Ok(());
                }
                if let Some(key) = chord(&name) {
                    if user.as_bool() {
                        played(&app, &window, key);
                    }
                    return Ok(());
                }
                if actual(&name) {
                    if user.as_bool() {
                        crate::web_page::actual_size(&app, &window, &asking);
                    }
                    return Ok(());
                }

                let menu = MENU
                    .with_borrow_mut(|menu| menu.remove(&asking).is_some_and(|link| link == uri));

                let keys = Held {
                    ctrl: held(VK_CONTROL),
                    shift: held(VK_SHIFT),
                    alt: false,
                };
                noted(
                    &asking,
                    placed(&name, user.as_bool(), keys, menu),
                    user.as_bool(),
                );
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_NewWindowRequested(&requested, &raw mut token);

            let Ok(core) = core.cast::<ICoreWebView2_11>() else {
                return;
            };
            let menu = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };

                let target = args.ContextMenuTarget()?;
                let mut has = windows_core::BOOL::default();
                target.HasLinkUri(&raw mut has)?;
                let link = if has.as_bool() {
                    let mut link = windows_core::PWSTR::null();
                    target.LinkUri(&raw mut link)?;
                    Some(webview2_com::take_pwstr(link))
                } else {
                    None
                };

                MENU.with_borrow_mut(|menu| match link {
                    Some(link) => menu.insert(tab.clone(), link),
                    None => menu.remove(&tab),
                });
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_ContextMenuRequested(&menu, &raw mut token);
        }
    }
}

#[cfg(feature = "cef")]
pub const BINDING: &str = "nibAsked";

#[cfg(feature = "cef")]
pub fn script() -> String {
    without_store_button(SCRIPT)
        .replacen(
            "var open = window.open.bind(window)",
            concat!(
                "var opening = window.open.bind(window)\n  ",
                "var open = function (url, name) {\n    ",
                "if (typeof nibAsked === 'function') nibAsked(JSON.stringify([url, name]))\n    ",
                "else if (url !== 'about:blank') opening(url, name)\n  }",
            ),
            1,
        )
        .replacen(STOPPED_ENGINE_KEYS, "/^$/", 1)
}

#[cfg(feature = "cef")]
const STOPPED_ENGINE_KEYS: &str = "/^nib-(find|actual)/";

#[cfg(feature = "cef")]
pub fn heard_on_chromium(app: &tauri::AppHandle, window: &str, tab: &str, payload: &str) {
    let Ok((url, name)) = serde_json::from_str::<(String, String)>(payload) else {
        return;
    };
    if name == crate::web_media::UNPLAYABLE {
        crate::web_media::heard(app, window, tab);
        return;
    }
    if let Some(key) = sought(&name) {
        if key.wanted_by(window) {
            passed(app, window, tab, key);
        }
        return;
    }
    if let Some(key) = chord(&name) {
        played(app, window, key);
        return;
    }
    if actual(&name) {
        crate::web_page::actual_size(app, window, tab);
        return;
    }
    if name == BLOCKED {
        crate::web_tabs::popup_blocked(app, window, tab, &url);
        return;
    }
    if name == PRESSED_IN {
        crate::web_tabs::page_chosen(app, window, &crate::web_tabs::label_of(tab));
        return;
    }
    if let Some(asked) = placed(&name, true, Held::default(), false) {
        crate::web_tabs::opened_beside(app, window, tab, &url, asked == Asked::Behind);
    }
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: tauri::AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn taken(_tab: &str) -> Option<Asked> {
    None
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn ours(_tab: &str) -> bool {
    false
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn unasked(_tab: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::{
        actual, chord, placed, sought, taken_as_a_person_s, Ask, Asked, Held, Passed, SCRIPT,
    };

    const NONE: Held = Held {
        ctrl: false,
        shift: false,
        alt: false,
    };
    const CTRL: Held = Held { ctrl: true, ..NONE };
    const SHIFT: Held = Held {
        shift: true,
        ..NONE
    };
    const BOTH: Held = Held {
        ctrl: true,
        shift: true,
        alt: false,
    };

    #[test]
    fn the_script_opens_its_windows_through_the_line_chromium_swaps() {
        assert_eq!(
            SCRIPT
                .matches("var open = window.open.bind(window)")
                .count(),
            1
        );
    }

    #[cfg(feature = "cef")]
    #[test]
    fn on_chromium_the_script_asks_through_the_binding_where_there_is_one() {
        let script = super::script();
        assert!(script.contains("typeof nibAsked === 'function'"));
        assert!(script.contains(super::BINDING));
        assert!(!script.contains("var open = window.open.bind(window)"));
        assert!(!script.contains("var open = typeof nibAsked"));
        assert!(SCRIPT.contains(super::STOPPED_ENGINE_KEYS));
        assert!(!script.contains(super::STOPPED_ENGINE_KEYS));
    }

    #[test]
    fn the_script_names_the_window_for_a_press_on_a_link() {
        assert_eq!(placed("nib-behind", true, NONE, false), Some(Asked::Behind));
        assert_eq!(placed("nib-front", true, SHIFT, false), Some(Asked::Front));
    }

    #[test]
    fn the_press_s_own_keys_outrank_the_keyboard_s() {
        assert_eq!(placed("nib-behind", true, BOTH, false), Some(Asked::Behind));
        assert_eq!(placed("nib-behind", true, SHIFT, true), Some(Asked::Behind));
        assert_eq!(placed("nib-front", true, NONE, false), Some(Asked::Front));
        assert_eq!(placed("nib-front", true, CTRL, true), Some(Asked::Front));
    }

    #[test]
    fn the_script_answers_the_middle_button_and_ctrl_or_shift_on_a_link() {
        assert!(SCRIPT.contains("last('auxclick'"));
        assert!(SCRIPT.contains("last('click'"));
        assert!(SCRIPT.contains("event.ctrlKey || event.shiftKey"));
        assert!(SCRIPT.contains("!event.altKey && !event.metaKey"));
        for name in ["'nib-behind'", "'nib-front'"] {
            assert!(SCRIPT.contains(name), "{name}");
            assert!(
                placed(name.trim_matches('\''), true, NONE, false).is_some(),
                "{name}"
            );
        }
    }

    #[test]
    fn ctrl_leaves_the_tab_behind_and_shift_with_it_goes_there() {
        assert_eq!(placed("", true, CTRL, false), Some(Asked::Behind));
        assert_eq!(placed("", true, BOTH, false), Some(Asked::Front));
    }

    #[test]
    fn shift_alone_goes_there_since_a_window_would_be_a_second_workspace() {
        assert_eq!(placed("", true, SHIFT, false), Some(Asked::Front));
    }

    #[test]
    fn the_pages_own_menu_leaves_the_tab_behind() {
        assert_eq!(placed("", true, NONE, true), Some(Asked::Behind));
    }

    #[test]
    fn a_plain_press_is_the_pages_own_request() {
        assert_eq!(placed("", true, NONE, false), None);
        assert_eq!(placed("_blank", true, NONE, false), None);
    }

    #[test]
    fn keys_held_while_a_script_opens_a_window_are_not_about_it() {
        assert_eq!(placed("", false, CTRL, false), None);
        assert_eq!(placed("", false, NONE, true), None);
        assert_eq!(
            placed("nib-behind", false, NONE, false),
            Some(Asked::Behind)
        );
    }

    #[test]
    fn eight_names_ask_for_nib_s_answer_and_nothing_else_does() {
        assert_eq!(sought("nib-find"), Some(Passed::Find));
        assert_eq!(sought("nib-find-next"), Some(Passed::Next));
        assert_eq!(sought("nib-find-previous"), Some(Passed::Previous));
        assert_eq!(sought("nib-address"), Some(Passed::Address));
        assert_eq!(sought("nib-twice-shift"), Some(Passed::ShiftTwice));
        assert_eq!(sought("nib-twice-ctrl"), Some(Passed::CtrlTwice));
        assert_eq!(sought("nib-twice-alt"), Some(Passed::AltTwice));
        assert_eq!(sought("nib-install-extension"), Some(Passed::Install));
        for name in [
            "",
            "_blank",
            "nib-behind",
            "nib-front",
            "NIB-FIND",
            "nib-find ",
            "nib-find-all",
            "nib-twice-meta",
            "nib-twice",
        ] {
            assert_eq!(sought(name), None, "{name:?}");
        }
    }

    #[test]
    fn ctrl_d_let_go_by_goes_back_as_the_key_it_was() {
        let key = chord("nib-ctrl-d").map(|one| serde_json::to_value(one).expect("a key"));
        let key = key.expect("Ctrl+D");
        assert_eq!(key["key"], "d");
        assert_eq!(key["code"], "KeyD");
        assert_eq!(key["ctrl"], true);
        assert_eq!(key["down"], true);

        for name in [
            "",
            "nib-find",
            "nib-address",
            "NIB-CTRL-D",
            "nib-ctrl-d ",
            "nib-ctrl-f",
        ] {
            assert!(chord(name).is_none(), "{name:?}");
        }
        assert_eq!(sought("nib-ctrl-d"), None);
    }

    #[test]
    fn ctrl_shift_d_let_go_by_goes_back_with_its_shift() {
        let key = chord("nib-ctrl-shift-d").map(|one| serde_json::to_value(one).expect("a key"));
        let key = key.expect("Ctrl+Shift+D");
        assert_eq!(key["key"], "D");
        assert_eq!(key["code"], "KeyD");
        assert_eq!(key["ctrl"], true);
        assert_eq!(key["shift"], true);
        assert_eq!(key["down"], true);
        assert_eq!(sought("nib-ctrl-shift-d"), None);
        assert!(chord("nib-ctrl-shift-d ").is_none());
        assert!(SCRIPT.contains("name = back ? 'nib-ctrl-shift-d' : 'nib-ctrl-d'"));
    }

    #[test]
    fn ctrl_h_and_ctrl_shift_delete_let_go_by_go_back_as_the_keys_they_were() {
        let history = chord("nib-ctrl-h").map(|one| serde_json::to_value(one).expect("a key"));
        let history = history.expect("Ctrl+H");
        assert_eq!(history["key"], "h");
        assert_eq!(history["code"], "KeyH");
        assert_eq!(history["ctrl"], true);
        assert_eq!(history["shift"], false);

        let clear =
            chord("nib-ctrl-shift-delete").map(|one| serde_json::to_value(one).expect("a key"));
        let clear = clear.expect("Ctrl+Shift+Delete");
        assert_eq!(clear["key"], "Delete");
        assert_eq!(clear["code"], "Delete");
        assert_eq!(clear["ctrl"], true);
        assert_eq!(clear["shift"], true);

        assert_eq!(sought("nib-ctrl-h"), None);
        assert!(chord("nib-ctrl-delete").is_none());
        assert!(
            SCRIPT.contains("else if (ctrl && code === 46 && back) name = 'nib-ctrl-shift-delete'")
        );
    }

    #[test]
    fn ctrl_space_let_go_by_goes_back_as_the_space_switcher() {
        for (name, shift) in [("nib-ctrl-space", false), ("nib-ctrl-shift-space", true)] {
            let key = chord(name).map(|one| serde_json::to_value(one).expect("a key"));
            let key = key.expect(name);
            assert_eq!(key["key"], " ");
            assert_eq!(key["code"], "Space");
            assert_eq!(key["ctrl"], true);
            assert_eq!(key["shift"], shift);
            assert_eq!(key["alt"], false);
            assert_eq!(key["down"], true);
            assert_eq!(sought(name), None);
        }
        assert!(chord("nib-alt-space").is_none());
        assert!(SCRIPT.contains(
            "else if (ctrl && code === 32) name = back ? 'nib-ctrl-shift-space' : 'nib-ctrl-space'"
        ));
    }

    #[test]
    fn the_script_asks_by_the_names_read_here() {
        for name in [
            "'nib-find'",
            "'nib-find-next'",
            "'nib-find-previous'",
            "'nib-address'",
            "'nib-actual-size'",
            "'nib-twice-shift'",
            "'nib-twice-ctrl'",
            "'nib-twice-alt'",
            "'nib-ctrl-d'",
            "'nib-ctrl-shift-d'",
            "'nib-install-extension'",
            "'nib-ctrl-space'",
            "'nib-ctrl-shift-space'",
            "'nib-ctrl-h'",
            "'nib-ctrl-shift-delete'",
        ] {
            assert!(SCRIPT.contains(name), "{name}");
        }
    }

    #[test]
    fn chromium_leaves_the_store_s_button_to_the_store() {
        let left = super::without_store_button(SCRIPT);
        assert!(!left.contains("nib-install-extension"));
        assert!(!left.contains("chromewebstore"));
        assert!(left.contains("'nib-ctrl-d'") && left.contains("'nib-twice-shift'"));
        assert!(left.trim_end().ends_with("})()"));
        assert_eq!(
            SCRIPT.len() - left.len(),
            SCRIPT.find(super::STORE_PART).map_or(0, |start| {
                SCRIPT[start..]
                    .find(super::STORE_END)
                    .expect("the part ends")
                    + super::STORE_END.len()
            })
        );
    }

    #[test]
    fn escape_the_page_let_go_by_gives_back_a_screen_the_app_holds_and_nothing_else() {
        assert_eq!(sought("nib-escape"), Some(Passed::Escape));
        assert_eq!(placed("nib-escape", true, NONE, false), None);
        assert!(SCRIPT.contains(
            "if (!ctrl && !alt && !back && code === 27) return open('about:blank', 'nib-escape')"
        ));
        let keys = SCRIPT.find("last('keydown'").expect("the keys");
        assert!(SCRIPT.find("code === 27").is_some_and(|at| at > keys));

        assert!(taken_as_a_person_s(Passed::Escape, false, 40, true));
        assert!(!taken_as_a_person_s(Passed::Escape, false, 40, false));

        assert!(!Passed::Escape.wanted_by("escape-test"));
        crate::full_screen::noted_for_test("escape-test", true);
        assert!(Passed::Escape.wanted_by("escape-test"));
        crate::full_screen::noted_for_test("escape-test", false);
        assert!(!Passed::Escape.wanted_by("escape-test"));
        assert!(Passed::Find.wanted_by("escape-test"));
    }

    #[test]
    fn ctrl_0_asks_by_a_name_of_its_own() {
        assert!(actual("nib-actual-size"));
        assert_eq!(sought("nib-actual-size"), None);
        assert_eq!(placed("nib-actual-size", true, NONE, false), None);
        for name in ["", "nib-find", "nib-actual", "NIB-ACTUAL-SIZE", "_blank"] {
            assert!(!actual(name), "{name:?}");
        }
        assert!(SCRIPT.contains("ctrl && (code === 48 || code === 96) && !back"));
    }

    #[test]
    fn a_tap_is_a_person_s_when_a_key_just_went_and_the_page_has_the_keyboard() {
        let tap = Passed::ShiftTwice;
        assert!(taken_as_a_person_s(tap, false, 40, true));
        assert!(!taken_as_a_person_s(tap, false, 5000, true));
        assert!(!taken_as_a_person_s(tap, false, 40, false));
        assert!(taken_as_a_person_s(tap, true, u32::MAX, false));
    }

    #[test]
    fn the_other_asks_still_want_the_engine_s_word() {
        assert!(!taken_as_a_person_s(Passed::Find, false, 40, true));
        assert!(taken_as_a_person_s(Passed::Address, true, 40, false));
    }

    #[test]
    fn an_ask_reaches_the_window_as_one_of_eight_words_for_its_tab() {
        let said = |key| {
            serde_json::to_value(Ask {
                tab: "t1".into(),
                key,
            })
            .expect("an ask")
        };
        assert_eq!(said(Passed::Find)["key"], "find");
        assert_eq!(said(Passed::Next)["key"], "next");
        assert_eq!(said(Passed::Previous)["key"], "previous");
        assert_eq!(said(Passed::Address)["key"], "address");
        assert_eq!(said(Passed::ShiftTwice)["key"], "shift-shift");
        assert_eq!(said(Passed::CtrlTwice)["key"], "ctrl-ctrl");
        assert_eq!(said(Passed::AltTwice)["key"], "alt-alt");
        assert_eq!(said(Passed::Install)["key"], "install");
        assert_eq!(said(Passed::Find)["tab"], "t1");
    }
}
