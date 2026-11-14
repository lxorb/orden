use std::collections::{HashMap, VecDeque};

use serde::Serialize;

use crate::web_keys::{Held, Pressed, PRESSED};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Asked {
    Behind,
    Front,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Heard {
    pub ours: bool,
    pub said: Option<Asked>,
    pub unasked: bool,
}

impl Heard {
    #[cfg_attr(not(test), allow(dead_code))]
    pub const UNHEARD: Self = Self {
        ours: false,
        said: None,
        unasked: true,
    };
}

const WAITING: usize = 64;

#[derive(Debug)]
#[cfg_attr(not(test), allow(dead_code))]
pub struct Waiting<T> {
    tabs: HashMap<String, VecDeque<(String, T)>>,
}

impl<T> Default for Waiting<T> {
    fn default() -> Self {
        Self {
            tabs: HashMap::new(),
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
impl<T> Waiting<T> {
    pub fn heard(&mut self, tab: &str, uri: &str, what: T) {
        let waiting = self.tabs.entry(tab.to_string()).or_default();
        if waiting.len() >= WAITING {
            waiting.pop_front();
        }
        waiting.push_back((uri.to_string(), what));
    }

    pub fn taken(&mut self, tab: &str, url: &str) -> Option<T> {
        let waiting = self.tabs.get_mut(tab)?;
        let found = waiting
            .iter()
            .position(|(uri, _)| same_address(uri, url))
            .and_then(|at| waiting.remove(at));
        if waiting.is_empty() {
            self.tabs.remove(tab);
        }
        found.map(|(_, what)| what)
    }
}

#[cfg_attr(not(test), allow(dead_code))]
fn same_address(heard: &str, url: &str) -> bool {
    heard == url || tauri::Url::parse(heard).is_ok_and(|heard| heard.as_str() == url)
}

const BEHIND: &str = "orden-behind";
const FRONT: &str = "orden-front";

const FIND: &str = "orden-find";
const FIND_NEXT: &str = "orden-find-next";
const FIND_PREVIOUS: &str = "orden-find-previous";
const ADDRESS: &str = "orden-address";
const CTRL_D: &str = "orden-ctrl-d";
const CTRL_SHIFT_D: &str = "orden-ctrl-shift-d";
const CTRL_SPACE: &str = "orden-ctrl-space";
const CTRL_SHIFT_SPACE: &str = "orden-ctrl-shift-space";
const CTRL_H: &str = "orden-ctrl-h";
const CTRL_SHIFT_DELETE: &str = "orden-ctrl-shift-delete";

const ACTUAL: &str = "orden-actual-size";

const INSTALL: &str = "orden-install-extension";

const ESCAPE: &str = "orden-escape";

const TWICE_SHIFT: &str = "orden-twice-shift";
const TWICE_CTRL: &str = "orden-twice-ctrl";
const TWICE_ALT: &str = "orden-twice-alt";

const PASSED: &str = "orden://web-passed";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
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
    pub fn wanted_by(self, window: &str) -> bool {
        self != Self::Escape || crate::full_screen::is_on(window)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct Ask {
    tab: String,
    key: Passed,
}

fn passed(app: &tauri::AppHandle, window: &str, tab: &str, key: Passed) {
    let ask = Ask {
        tab: tab.to_string(),
        key,
    };
    told(app, window, PASSED, ask);
}

fn played(app: &tauri::AppHandle, window: &str, key: Pressed) {
    told(app, window, PRESSED, key);
}

fn told<S: Serialize + Clone>(app: &tauri::AppHandle, window: &str, event: &str, said: S) {
    use tauri::{Emitter, Manager};

    if let Some(ours) = app.get_webview(window) {
        crate::placement::keyboard_to(&ours);
    }
    let _ = app.emit_to(window, event, said);
}

const PRESSED_IN: &str = "orden-pressed";

const BLOCKED: &str = "orden-popup-blocked";

pub const PAGE_SCRIPT: &str = r"(function () {
  if (typeof Proxy !== 'function' || typeof WeakSet !== 'function') return
  var ours = true
  var apply = Reflect.apply
  var now = Date.now
  var described = Object.getOwnPropertyDescriptor
  var define = Object.defineProperty
  var seen = new WeakSet()
  var saw = WeakSet.prototype.has.bind(seen)
  var see = WeakSet.prototype.add.bind(seen)
  var pressed = -1
  var spending = {}
  function getter(kind, name) {
    var one = typeof window[kind] === 'function' ? described(window[kind].prototype, name) : null
    return one && typeof one.get === 'function' ? one.get : null
  }
  function read(get, one) {
    try { return get ? apply(get, one, []) : undefined } catch (e) { return undefined }
  }
  var named = getter('Element', 'localName')
  var typed = getter('HTMLInputElement', 'type')
  var labelled = getter('HTMLLabelElement', 'control')
  var holders = [getter('HTMLIFrameElement', 'contentWindow'), getter('HTMLFrameElement', 'contentWindow'), getter('HTMLObjectElement', 'contentWindow')]
  function filed(one) {
    if (read(named, one) === 'label') one = read(labelled, one)
    return read(named, one) === 'input' && String(read(typed, one)).toLowerCase() === 'file'
  }
  function held(one) {
    if (!/^(iframe|frame|object)$/.test(read(named, one))) return null
    for (var i = 0; i < holders.length; i++) {
      var inner = read(holders[i], one)
      if (inner) return inner
    }
    return null
  }
  function denied(name) {
    try { return new DOMException('A press or a key in the page comes first.', name) } catch (e) { return new Error(name) }
  }
  function rejecting(name) {
    return function () { return Promise.reject(denied(name)) }
  }
  function said(kind, url) {
    var at = null
    try { at = String(new URL(url == null || url === '' ? 'about:blank' : String(url), location.href)) } catch (e) { return }
    window.dispatchEvent(new CustomEvent(kind, { detail: at }))
  }
  function guard(win) {
    try {
      if (!win || saw(win)) return
      see(win)
      if (typeof win.Element !== 'function') return
    } catch (e) { return }
    function spent(kind) {
      var at = apply(now, Date, [])
      var fresh = pressed >= 0 && at - pressed < 5000 && spending[kind] !== pressed
      var activation = win.navigator && win.navigator.userActivation
      var engine = kind !== 'open' || !activation || activation.isActive
      if (fresh && engine) spending[kind] = pressed
      return fresh && engine
    }
    function wrapped(engine, after) {
      return new Proxy(engine, {
        apply: function (engine, self, args) { return after(engine, self, args) }
      })
    }
    function gated(owner, name, kind, refuse) {
      var was = owner ? described(owner, name) : null
      if (!was || typeof was.value !== 'function') return
      was.value = wrapped(was.value, function (engine, self, args) {
        var asked = typeof kind === 'function' ? kind(self, args) : kind
        if (!asked || spent(asked)) return apply(engine, self, args)
        return refuse(self, args)
      })
      define(owner, name, was)
    }
    function prototype(kind) {
      return typeof win[kind] === 'function' ? win[kind].prototype : null
    }
    function framed(inner) {
      if (!inner) return
      try { guard(inner.window === inner ? inner : inner.defaultView) } catch (e) {}
    }
    function heard(target) {
      target.addEventListener('load', function (event) {
        var one = event.target
        if (one && one !== win.document) framed(held(one))
      }, true)
    }
    ;['keydown', 'mousedown', 'pointerdown', 'pointerup', 'touchend', 'click'].forEach(function (type) {
      win.addEventListener(type, function (event) {
        if (event.isTrusted) pressed = apply(now, Date, [])
      }, true)
    })
    heard(win)
    ;['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement', 'HTMLEmbedElement'].forEach(function (kind) {
      var owner = prototype(kind)
      if (!owner) return
      ;['contentWindow', 'contentDocument'].forEach(function (name) {
        var was = described(owner, name)
        if (!was || typeof was.get !== 'function') return
        was.get = wrapped(was.get, function (engine, self, args) {
          var inner = apply(engine, self, args)
          framed(inner)
          return inner
        })
        define(owner, name, was)
      })
      var svg = described(owner, 'getSVGDocument')
      if (!svg || typeof svg.value !== 'function') return
      svg.value = wrapped(svg.value, function (engine, self, args) {
        var inner = apply(engine, self, args)
        framed(inner)
        return inner
      })
      define(owner, 'getSVGDocument', svg)
    })
    var shadows = prototype('Element')
    var shadow = shadows ? described(shadows, 'attachShadow') : null
    if (shadow && typeof shadow.value === 'function') {
      shadow.value = wrapped(shadow.value, function (engine, self, args) {
        var root = apply(engine, self, args)
        try { heard(root) } catch (e) {}
        return root
      })
      define(shadows, 'attachShadow', shadow)
    }
    ;['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen'].forEach(function (name) {
      gated(prototype('Element'), name, 'fullscreen', function (self) {
        try { self.dispatchEvent(new Event('fullscreenerror', { bubbles: true, composed: true })) } catch (e) {}
        return name === 'requestFullscreen' ? Promise.reject(new TypeError('Permissions check failed')) : undefined
      })
    })
    gated(prototype('Clipboard'), 'writeText', 'clipboard', rejecting('NotAllowedError'))
    gated(prototype('Clipboard'), 'write', 'clipboard', rejecting('NotAllowedError'))
    gated(prototype('Document'), 'execCommand', function (self, args) {
      return /^(copy|cut)$/i.test(String(args[0])) ? 'copy' : null
    }, function () { return false })
    gated(prototype('HTMLElement'), 'click', function (self) {
      return filed(self) ? 'picker' : null
    }, function () {})
    ;['HTMLInputElement', 'HTMLSelectElement'].forEach(function (kind) {
      gated(prototype(kind), 'showPicker', 'picker', function () { throw denied('NotAllowedError') })
    })
    ;['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker'].forEach(function (name) {
      gated(win, name, 'picker', rejecting('SecurityError'))
    })
    gated(prototype('PaymentRequest'), 'show', 'payment', rejecting('SecurityError'))
    gated(prototype('Navigator'), 'share', 'share', rejecting('NotAllowedError'))
    gated(prototype('HTMLVideoElement'), 'requestPictureInPicture', 'picture', rejecting('NotAllowedError'))
    gated(win.Notification, 'requestPermission', 'notifications', function (self, args) {
      var answer = win.Notification.permission
      if (typeof args[0] === 'function') setTimeout(function () { args[0](answer) })
      return Promise.resolve(answer)
    })

    if (typeof win.open !== 'function') return
    win.open = wrapped(win.open, function (engine, self, args) {
      var active = spent('open')
      var name = args.length > 1 && args[1] != null ? String(args[1]) : '_blank'
      var features = args.length > 2 && args[2] != null ? String(args[2]).toLowerCase() : ''
      if (ours && /(^|[\s,])no(opener|referrer)(?=$|[\s,=])/.test(features) && (name === '_blank' || name === '')) {
        said(active ? 'orden-open-tab' : 'orden-popup-blocked', args[0])
        return null
      }
      if (!active) {
        said('orden-popup-blocked', args[0])
        return null
      }
      return apply(engine, self, args)
    })
  }
  guard(window)
})()";

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
    open(link.href, front || event.shiftKey ? 'orden-front' : 'orden-behind')
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
    var name = 'orden-post-' + (++posted)
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

  // A press anywhere in the page chooses its tab and its pane, said through Orden's own
  // binding where there is one (#1080): the window system says nothing of a press into a
  // page that has the keyboard already. Never as a window: that would spend the press's
  // activation, which the page's own `window.open` in the same press needs.
  addEventListener('pointerdown', function (event) {
    var asking = globalThis.ordenAsked
    if (event.isTrusted && typeof asking === 'function') asking(JSON.stringify(['', 'orden-pressed']))
  }, true)

  addEventListener('orden-open-tab', function (event) {
    if (typeof event.detail === 'string') open(event.detail, 'orden-front')
  })
  addEventListener('orden-popup-blocked', function (event) {
    if (typeof event.detail !== 'string') return
    var asking = globalThis.ordenAsked
    if (typeof asking === 'function') asking(JSON.stringify([event.detail, 'orden-popup-blocked']))
    else open(event.detail, 'orden-popup-blocked')
  })

  last('keydown', function (event, stopped) {
    if (!event.isTrusted || event.defaultPrevented || event.metaKey) return
    var ctrl = event.ctrlKey
    var alt = event.altKey
    var back = event.shiftKey
    var code = event.keyCode
    var name = null
    if (stopped && code === 27) return
    if (!ctrl && !alt && !back && code === 27) return open('about:blank', 'orden-escape')
    if (ctrl && alt) return
    else if (alt) name = code === 68 && !back ? 'orden-address' : null
    else if (ctrl && code === 70 && !back) name = 'orden-find'
    else if (ctrl && code === 76 && !back) name = 'orden-address'
    else if (ctrl && (code === 48 || code === 96) && !back) name = 'orden-actual-size'
    else if (ctrl && code === 68) name = back ? 'orden-ctrl-shift-d' : 'orden-ctrl-d'
    else if (ctrl && code === 32) name = back ? 'orden-ctrl-shift-space' : 'orden-ctrl-space'
    else if (ctrl && code === 72 && !back) name = 'orden-ctrl-h'
    else if (ctrl && code === 46 && back) name = 'orden-ctrl-shift-delete'
    else if (ctrl && code === 71) name = back ? 'orden-find-previous' : 'orden-find-next'
    else if (!ctrl && code === 114) name = back ? 'orden-find-previous' : 'orden-find-next'
    if (!name || (stopped && /^orden-(find|actual)/.test(name))) return
    event.preventDefault()
    open('about:blank', name)
  }, true)

  var within = 350
  var twice = { Shift: 'orden-twice-shift', Control: 'orden-twice-ctrl', Alt: 'orden-twice-alt' }
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
      open('about:blank', 'orden-install-extension')
    }, true)
  }
})()";

const STORE_PART: &str = "  var here = typeof location";
const STORE_END: &str = "    }, true)\n  }\n";

fn without_store_button(script: &str) -> String {
    let Some(start) = script.find(STORE_PART) else {
        return script.to_owned();
    };
    let end = script[start..]
        .find(STORE_END)
        .map_or(start, |at| start + at + STORE_END.len());
    format!("{}{}", &script[..start], &script[end..])
}

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

pub fn actual(name: &str) -> bool {
    name == ACTUAL
}

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

pub const BINDING: &str = "ordenAsked";

pub fn script() -> String {
    without_store_button(SCRIPT)
        .replacen(
            "var open = window.open.bind(window)",
            concat!(
                "var opening = window.open.bind(window)\n  ",
                "var open = function (url, name) {\n    ",
                "if (typeof ordenAsked === 'function') ordenAsked(JSON.stringify([url, name]))\n    ",
                "else if (url !== 'about:blank') opening(url, name)\n  }",
            ),
            1,
        )
        .replacen(STOPPED_ENGINE_KEYS, "/^$/", 1)
}

const STOPPED_ENGINE_KEYS: &str = "/^orden-(find|actual)/";

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

pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: tauri::AppHandle,
    _tab: String,
    _window: String,
) {
}

pub fn heard(_tab: &str, _url: &tauri::Url) -> Heard {
    Heard::default()
}

#[cfg(test)]
mod tests {
    use super::{
        actual, chord, placed, sought, Ask, Asked, Heard, Held, Passed, Waiting, SCRIPT, WAITING,
    };

    const UNASKED: Heard = Heard {
        ours: false,
        said: None,
        unasked: true,
    };

    #[test]
    fn a_storm_of_opens_keeps_each_request_s_own_verdict() {
        let mut waiting = Waiting::default();
        let asked = Heard {
            said: Some(Asked::Front),
            ..Heard::default()
        };
        waiting.heard("tab", "https://one.example/", UNASKED);
        waiting.heard("tab", "https://two.example/", asked);
        waiting.heard("tab", "https://three.example/", UNASKED);
        waiting.heard("other", "https://one.example/", asked);

        assert_eq!(waiting.taken("tab", "https://one.example/"), Some(UNASKED));
        assert_eq!(waiting.taken("tab", "https://two.example/"), Some(asked));
        assert_eq!(
            waiting.taken("tab", "https://three.example/"),
            Some(UNASKED)
        );
        assert_eq!(waiting.taken("tab", "https://three.example/"), None);
        assert_eq!(waiting.taken("other", "https://one.example/"), Some(asked));
    }

    #[test]
    fn every_unasked_open_of_a_burst_to_one_address_stays_unasked() {
        let mut waiting = Waiting::default();
        for _ in 0..20 {
            waiting.heard("tab", "https://same.example/", UNASKED);
        }
        for _ in 0..20 {
            assert_eq!(waiting.taken("tab", "https://same.example/"), Some(UNASKED));
        }
        assert_eq!(waiting.taken("tab", "https://same.example/"), None);
    }

    #[test]
    fn a_request_is_found_by_the_address_the_engine_parsed() {
        let mut waiting = Waiting::default();
        waiting.heard("tab", "HTTPS://Example.com", UNASKED);
        assert_eq!(waiting.taken("tab", "https://example.com/"), Some(UNASKED));
    }

    #[test]
    fn requests_never_answered_do_not_pile_up() {
        let mut waiting = Waiting::default();
        for at in 0..WAITING * 3 {
            waiting.heard("tab", &format!("https://example.com/{at}"), at);
        }
        assert_eq!(waiting.taken("tab", "https://example.com/0"), None);
        let last = WAITING * 3 - 1;
        assert_eq!(
            waiting.taken("tab", &format!("https://example.com/{last}")),
            Some(last)
        );
        assert_eq!(waiting.tabs["tab"].len(), WAITING - 1);
    }

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

    #[test]
    fn on_chromium_the_script_asks_through_the_binding_where_there_is_one() {
        let script = super::script();
        assert!(script.contains("typeof ordenAsked === 'function'"));
        assert!(script.contains(super::BINDING));
        assert!(!script.contains("var open = window.open.bind(window)"));
        assert!(!script.contains("var open = typeof ordenAsked"));
        assert!(SCRIPT.contains(super::STOPPED_ENGINE_KEYS));
        assert!(!script.contains(super::STOPPED_ENGINE_KEYS));
    }

    #[test]
    fn the_script_names_the_window_for_a_press_on_a_link() {
        assert_eq!(
            placed("orden-behind", true, NONE, false),
            Some(Asked::Behind)
        );
        assert_eq!(
            placed("orden-front", true, SHIFT, false),
            Some(Asked::Front)
        );
    }

    #[test]
    fn the_press_s_own_keys_outrank_the_keyboard_s() {
        assert_eq!(
            placed("orden-behind", true, BOTH, false),
            Some(Asked::Behind)
        );
        assert_eq!(
            placed("orden-behind", true, SHIFT, true),
            Some(Asked::Behind)
        );
        assert_eq!(placed("orden-front", true, NONE, false), Some(Asked::Front));
        assert_eq!(placed("orden-front", true, CTRL, true), Some(Asked::Front));
    }

    #[test]
    fn the_script_answers_the_middle_button_and_ctrl_or_shift_on_a_link() {
        assert!(SCRIPT.contains("last('auxclick'"));
        assert!(SCRIPT.contains("last('click'"));
        assert!(SCRIPT.contains("event.ctrlKey || event.shiftKey"));
        assert!(SCRIPT.contains("!event.altKey && !event.metaKey"));
        for name in ["'orden-behind'", "'orden-front'"] {
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
            placed("orden-behind", false, NONE, false),
            Some(Asked::Behind)
        );
    }

    #[test]
    fn eight_names_ask_for_orden_s_answer_and_nothing_else_does() {
        assert_eq!(sought("orden-find"), Some(Passed::Find));
        assert_eq!(sought("orden-find-next"), Some(Passed::Next));
        assert_eq!(sought("orden-find-previous"), Some(Passed::Previous));
        assert_eq!(sought("orden-address"), Some(Passed::Address));
        assert_eq!(sought("orden-twice-shift"), Some(Passed::ShiftTwice));
        assert_eq!(sought("orden-twice-ctrl"), Some(Passed::CtrlTwice));
        assert_eq!(sought("orden-twice-alt"), Some(Passed::AltTwice));
        assert_eq!(sought("orden-install-extension"), Some(Passed::Install));
        for name in [
            "",
            "_blank",
            "orden-behind",
            "orden-front",
            "ORDEN-FIND",
            "orden-find ",
            "orden-find-all",
            "orden-twice-meta",
            "orden-twice",
        ] {
            assert_eq!(sought(name), None, "{name:?}");
        }
    }

    #[test]
    fn ctrl_d_let_go_by_goes_back_as_the_key_it_was() {
        let key = chord("orden-ctrl-d").map(|one| serde_json::to_value(one).expect("a key"));
        let key = key.expect("Ctrl+D");
        assert_eq!(key["key"], "d");
        assert_eq!(key["code"], "KeyD");
        assert_eq!(key["ctrl"], true);
        assert_eq!(key["down"], true);

        for name in [
            "",
            "orden-find",
            "orden-address",
            "ORDEN-CTRL-D",
            "orden-ctrl-d ",
            "orden-ctrl-f",
        ] {
            assert!(chord(name).is_none(), "{name:?}");
        }
        assert_eq!(sought("orden-ctrl-d"), None);
    }

    #[test]
    fn ctrl_shift_d_let_go_by_goes_back_with_its_shift() {
        let key = chord("orden-ctrl-shift-d").map(|one| serde_json::to_value(one).expect("a key"));
        let key = key.expect("Ctrl+Shift+D");
        assert_eq!(key["key"], "D");
        assert_eq!(key["code"], "KeyD");
        assert_eq!(key["ctrl"], true);
        assert_eq!(key["shift"], true);
        assert_eq!(key["down"], true);
        assert_eq!(sought("orden-ctrl-shift-d"), None);
        assert!(chord("orden-ctrl-shift-d ").is_none());
        assert!(SCRIPT.contains("name = back ? 'orden-ctrl-shift-d' : 'orden-ctrl-d'"));
    }

    #[test]
    fn ctrl_h_and_ctrl_shift_delete_let_go_by_go_back_as_the_keys_they_were() {
        let history = chord("orden-ctrl-h").map(|one| serde_json::to_value(one).expect("a key"));
        let history = history.expect("Ctrl+H");
        assert_eq!(history["key"], "h");
        assert_eq!(history["code"], "KeyH");
        assert_eq!(history["ctrl"], true);
        assert_eq!(history["shift"], false);

        let clear =
            chord("orden-ctrl-shift-delete").map(|one| serde_json::to_value(one).expect("a key"));
        let clear = clear.expect("Ctrl+Shift+Delete");
        assert_eq!(clear["key"], "Delete");
        assert_eq!(clear["code"], "Delete");
        assert_eq!(clear["ctrl"], true);
        assert_eq!(clear["shift"], true);

        assert_eq!(sought("orden-ctrl-h"), None);
        assert!(chord("orden-ctrl-delete").is_none());
        assert!(SCRIPT
            .contains("else if (ctrl && code === 46 && back) name = 'orden-ctrl-shift-delete'"));
    }

    #[test]
    fn ctrl_space_let_go_by_goes_back_as_the_space_switcher() {
        for (name, shift) in [
            ("orden-ctrl-space", false),
            ("orden-ctrl-shift-space", true),
        ] {
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
        assert!(chord("orden-alt-space").is_none());
        assert!(SCRIPT.contains(
            "else if (ctrl && code === 32) name = back ? 'orden-ctrl-shift-space' : 'orden-ctrl-space'"
        ));
    }

    #[test]
    fn the_script_asks_by_the_names_read_here() {
        for name in [
            "'orden-find'",
            "'orden-find-next'",
            "'orden-find-previous'",
            "'orden-address'",
            "'orden-actual-size'",
            "'orden-twice-shift'",
            "'orden-twice-ctrl'",
            "'orden-twice-alt'",
            "'orden-ctrl-d'",
            "'orden-ctrl-shift-d'",
            "'orden-install-extension'",
            "'orden-ctrl-space'",
            "'orden-ctrl-shift-space'",
            "'orden-ctrl-h'",
            "'orden-ctrl-shift-delete'",
        ] {
            assert!(SCRIPT.contains(name), "{name}");
        }
    }

    #[test]
    fn chromium_leaves_the_store_s_button_to_the_store() {
        let left = super::without_store_button(SCRIPT);
        assert!(!left.contains("orden-install-extension"));
        assert!(!left.contains("chromewebstore"));
        assert!(left.contains("'orden-ctrl-d'") && left.contains("'orden-twice-shift'"));
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
    fn ctrl_0_asks_by_a_name_of_its_own() {
        assert!(actual("orden-actual-size"));
        assert_eq!(sought("orden-actual-size"), None);
        assert_eq!(placed("orden-actual-size", true, NONE, false), None);
        for name in [
            "",
            "orden-find",
            "orden-actual",
            "ORDEN-ACTUAL-SIZE",
            "_blank",
        ] {
            assert!(!actual(name), "{name:?}");
        }
        assert!(SCRIPT.contains("ctrl && (code === 48 || code === 96) && !back"));
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
