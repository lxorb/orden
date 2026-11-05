//! What an agent does to a page, through the engine and nothing else
//! (docs/agent-native.md 5.2, 7.2).
//!
//! Every act is the `DevTools` Protocol on that one webview: a press is
//! `Input.dispatchMouseEvent` at the element's middle, words are `Input.insertText`, a key
//! is `Input.dispatchKeyEvent` into the page. Trusted events, inside the page, that move
//! neither the system's pointer nor its keyboard; the spike and the probe measure that
//! the window in front and the app's focus never change.
//!
//! **Every act settles** the way Chrome `DevTools` MCP's `waitForEventsAfterAction` does:
//! if the page's own frame starts a navigation within 50 ms, its load is waited for (up
//! to 3 s), and then the document is waited on until it has not changed for 80 ms (up to
//! 3 s). So an agent rarely needs `browser_wait` after a press, and a dialog the act
//! raised ends the wait and rides on the answer instead.
//!
//! **What is never done**: a `<select>`, a date field or a colour field is never pressed
//! or keyed open, because its list is a window of the engine's own (6.5); they are set
//! through the page. A password field is never typed into, never read and never
//! photographed while focused, and no secret field's value - a password's, a code's, a
//! card's - is read back in any shape, not even as the bullets that count it: a picture
//! has each filled one painted over (9.4).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::cdp::{self, Heard, Whence};
use super::engines::{self, Engine, Gate, Page, Tree, SETTLED, UNREAD};
use super::grants::Grant;
use super::keys::{self, Key};
use super::policy::{self, Facts, Field};
use super::scripts::{self, paint_over, png_size, CARET_ALL, CARET_END};
use super::snapshot::{self, Part};
use super::verbs::{
    Answer, Code, ConsoleLine, ConsoleLines, Cookie, FieldValue, Match, Moment, Picture, ReadAs,
    Request, Requests, Store, Until,
};
use crate::pdf::{printing, PdfPage};

/// What an agent's refs are resolved and scripts run under, in the page.
const WORLD: &str = "nib-agent";

/// How long an act waits for a navigation it may have started to begin.
const NAVIGATION_STARTS: Duration = Duration::from_millis(50);

/// How long an act waits for a navigation's load, and for the document to settle.
const SETTLES: Duration = Duration::from_secs(3);

/// How long the document has to be still to be settled.
const STILL: Duration = Duration::from_millis(80);

/// How long the element about to be pressed in a reader's tab is lit first (7.1).
const LIT: Duration = Duration::from_millis(300);

static INSIDE: LazyLock<String> = LazyLock::new(|| {
    [
        "function (place) { ",
        NATIVE,
        "const target = read(place, 'element') || place; const up = (one) => read(one, 'assignedSlot') || read(one, 'parentNode') || read(one, 'host') || null; const holds = (outer, inner) => { for (let one = inner; one; one = up(one)) if (one === outer) return true; return false }; const el = read(this, 'nodeType') === 1 ? this : read(this, 'parentElement') || read(this, 'element') || read(this, 'host'); if (!el) return true; if (holds(target, el) || holds(el, target)) return true; const label = call(el, 'closest', 'label'); if (label && (read(label, 'control') === target || holds(label, target))) return true; return ['IFRAME', 'FRAME'].includes(read(el, 'tagName')) }",
    ]
    .concat()
});

const NATIVE: &str = "const read = (one, key) => Reflect.get(Object.getPrototypeOf(one), key, one); const call = (one, key, ...args) => read(one, key).apply(one, args); ";

/// The tallest full-page picture, in CSS pixels.
const TALLEST: f64 = 16_384.0;

const FIELDS: &str = r"
  // What is read of an element, through its interface and past its own properties: a form's named field is its own property, in every world, and would answer for `nodeType`, `elements` or `parentElement`.
  const read = (one, key) => Reflect.get(Object.getPrototypeOf(one), key, one)
  const call = (one, key, ...args) => read(one, key).apply(one, args)
  const text = (one) => String(one || '').replace(/\s+/g, ' ').trim()
  const CONTROLS = 'button, a, [role=button], [role=link], [role=menuitem], input[type=submit], input[type=button], input[type=image], summary'
  const BUILT_TO_PRESS = '[onclick], [onmousedown], [onmouseup], [onpointerdown], [onpointerup], [role=option], [role=tab], [role=treeitem], [role=menuitemcheckbox], [role=menuitemradio], [role=checkbox], [role=radio], [role=switch]'
  const TAKES_A_PRESS = BUILT_TO_PRESS + ', [tabindex]:not([tabindex^=\x22-\x22])'
  const labelOf = (field) => {
    const parts = [call(field, 'getAttribute', 'aria-label')]
    if (read(field, 'labels')) for (const one of read(field, 'labels')) parts.push(read(one, 'innerText'))
    const by = call(field, 'getAttribute', 'aria-labelledby')
    if (by) for (const id of by.split(/\s+/)) {
      const home = call(field, 'getRootNode')
      const named = (home.getElementById && home.getElementById(id)) || read(field, 'ownerDocument').getElementById(id)
      if (named) parts.push(read(named, 'innerText'))
    }
    return text(parts.filter(Boolean).join(' '))
  }
  const describe = (one) => {
    const tag = read(one, 'tagName').toLowerCase()
    const role = String(call(one, 'getAttribute', 'role') || '').toLowerCase()
    const box = tag === 'textarea' || ((!!read(one, 'isContentEditable') || role === 'textbox') && tag !== 'input')
    let type = tag === 'input' ? String(read(one, 'type') || 'text').toLowerCase() : tag === 'textarea' ? 'textarea' : box ? 'editable' : tag
    if (role === 'searchbox' || (box && role === 'combobox')) type = 'search'
    const label = labelOf(one) || text(call(one, 'getAttribute', 'placeholder'))
    let masked = false
    try {
      const style = read(one, 'ownerDocument').defaultView.getComputedStyle(one)
      masked = type !== 'password' && String(style.webkitTextSecurity || 'none') !== 'none'
    } catch (_) {}
    const words = box ? String(tag === 'textarea' ? read(one, 'value') : read(one, 'innerText') || '').slice(0, 5000) : ''
    return {
      type,
      autocomplete: String(call(one, 'getAttribute', 'autocomplete') || '').toLowerCase(),
      said: text([read(one, 'name'), read(one, 'id'), call(one, 'getAttribute', 'placeholder'), labelOf(one)].filter(Boolean).join(' ')).slice(0, 200),
      label: label.slice(0, 200),
      masked,
      mentions: /(^|\s)@[\p{L}\p{N}_.-]{2,}/u.test(words),
    }
  }
";

const FACTS_BODY: &str = r"
  // A pseudo-element answers a hit test and has no node of its own, a root or a document
  // none that is an element. What is left says nothing, which the crate asks about.
  let el = read(this, 'nodeType') === 1 ? this : read(this, 'parentElement') || this.element || this.host || this.documentElement
  if (!el || read(el, 'nodeType') !== 1) return {}
  // A part of a field the engine draws itself (a date's picker button) is that field.
  const root = call(el, 'getRootNode')
  if (root && root.host && ['INPUT', 'SELECT', 'TEXTAREA'].includes(root.host.tagName)) el = root.host
  const tag = read(el, 'tagName').toLowerCase()
  const kind = tag === 'input' ? String(read(el, 'type') || 'text').toLowerCase() : ''
  // Its label's control, which is what a press on the label's words presses.
  const labelled = () => {
    const held = call(el, 'closest', 'label')
    return held && read(held, 'control') && call(read(held, 'control'), 'matches', CONTROLS) ? read(held, 'control') : null
  }
  const control = call(el, 'closest', CONTROLS) || labelled()
  const pressed = control || el
  // A button named by its picture says so through the picture: what the engine's tree names it too.
  const pictured = (one) => {
    const said = []
    for (const kid of call(one, 'querySelectorAll', 'img[alt], input[alt], area[alt], [aria-label], [title], svg title')) said.push(call(kid, 'getAttribute', 'alt') || call(kid, 'getAttribute', 'aria-label') || call(kid, 'getAttribute', 'title') || read(kid, 'textContent'))
    return said.join(' ')
  }
  // What is no control has no name in what it holds: a column of cards is not called Pay rent, nor a mail's row Delete for an icon in it. Its own words, down through what is plainly part of them, and only if they are short enough to be a name.
  const INLINE = ['SPAN', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'U', 'MARK', 'ABBR', 'FONT', 'LABEL']
  const ownWords = (one) => {
    let said = ''
    for (const node of read(one, 'childNodes')) {
      if (read(node, 'nodeType') === 3) said += read(node, 'textContent')
      else if (read(node, 'nodeType') === 1 && !call(node, 'matches', CONTROLS) && !['SCRIPT', 'STYLE'].includes(read(node, 'tagName')) && (read(one, 'children').length === 1 || INLINE.includes(read(node, 'tagName')))) said += ' ' + ownWords(node)
    }
    return said
  }
  const onlyPicture = (one) => {
    const kid = read(one, 'children').length === 1 ? read(one, 'children')[0] : null
    return kid ? call(kid, 'getAttribute', 'alt') || call(kid, 'getAttribute', 'aria-label') || call(kid, 'getAttribute', 'title') || (read(kid, 'tagName').toLowerCase() === 'svg' ? (call(kid, 'querySelector', 'title') || {}).textContent : '') || onlyPicture(kid) : ''
  }
  const plainName = (one) => {
    const words = text(ownWords(one))
    return text(labelOf(one) || (words.length > 60 ? '' : words) || (read(one, 'tagName') === 'INPUT' ? read(one, 'value') : '') || call(one, 'getAttribute', 'title') || call(one, 'getAttribute', 'alt') || (words ? '' : onlyPicture(one)))
  }
  // A design system's inner button, with its label on the host round its shadow root.
  const hostLabel = (one) => {
    for (let at = call(one, 'getRootNode').host; at; at = call(at, 'getRootNode').host) {
      const said = text(call(at, 'getAttribute', 'aria-label') || call(at, 'getAttribute', 'title'))
      if (said) return said
    }
    return ''
  }
  const controlName = (one) => {
    // A `<label>` elsewhere and its words both: that is no way to hide what it says.
    const label = labelOf(one)
    const words = text(read(one, 'innerText'))
    const both = label && words && !call(one, 'hasAttribute', 'aria-label') && !label.toLowerCase().includes(words.toLowerCase()) ? label + ' ' + words : label || words
    const said = text((both || (read(one, 'tagName') === 'INPUT' ? read(one, 'value') : '') || call(one, 'getAttribute', 'title') || call(one, 'getAttribute', 'alt') || '') + ' ' + pictured(one))
    return said || hostLabel(one)
  }
  const nameOf = (one) => (call(one, 'matches', CONTROLS) ? controlName(one) : plainName(one)).slice(0, 200)
  // What is pressed where no control holds the press: what listens round it, the nearest that says it takes a press (a handler, a place in the tab order, a widget's role, or `heard`, which the engine found listening), or the outermost that shows a pointer, which its children inherit. A field is its own.
  const above = (one) => read(one, 'parentElement') || call(one, 'getRootNode').host || null
  const acting = () => {
    if (control || ['INPUT', 'SELECT', 'TEXTAREA'].includes(read(el, 'tagName')) || read(el, 'isContentEditable')) return null
    const top = (one) => !one || ['BODY', 'HTML'].includes(read(one, 'tagName'))
    const pointing = (one) => read(one, 'ownerDocument').defaultView.getComputedStyle(one).cursor === 'pointer'
    for (let one = el; !top(one); one = above(one)) {
      if (one === heard || call(one, 'matches', TAKES_A_PRESS)) return one
      if (pointing(one) && (top(above(one)) || !pointing(above(one)))) return one
    }
    return null
  }
  // Its lines as they show, short of a control of its own, which is pressed for itself: a mail's row is not called Delete for the icon in it. Through a shadow root: an open one, and the one the hit itself is in, closed or not. The words of its pseudo-elements, which is all some labels are.
  const rootOf = (one) => {
    if (read(one, 'shadowRoot')) return read(one, 'shadowRoot')
    for (let at = call(el, 'getRootNode'); at && at.host; at = at.host.getRootNode()) if (at.host === one) return at
    return null
  }
  const MOST_HELD = 400
  const MOST_IN_A_DIALOG = 4000
  const OWN_WORDS = 'input, select, textarea, [contenteditable]:not([contenteditable=false i]), [role=textbox]'
  const pseudoWords = (one) => {
    const said = []
    for (const part of ['::before', '::after', '::marker']) {
      const words = /^\x22(.*)\x22$/.exec(String(read(one, 'ownerDocument').defaultView.getComputedStyle(one, part).content || ''))
      if (words && words[1]) said.push(words[1])
    }
    return said
  }
  const linesOf = (one, leaving, most = MOST_HELD) => {
    const lines = [...pseudoWords(one), '']
    let seen = 0
    const walk = (nodes) => {
      for (const node of nodes) {
        if (seen > most) return
        if (read(node, 'nodeType') === 3) {
          lines[lines.length - 1] += read(node, 'textContent')
          seen += read(node, 'textContent').length
        }
        if (read(node, 'tagName') === 'BR') lines.push('')
        // Nor a field's words, which may be a secret's and are not what the page says: these lines are quoted to whoever asks.
        if (read(node, 'nodeType') !== 1 || node === leaving || call(node, 'matches', CONTROLS) || call(node, 'matches', OWN_WORDS) || ['SCRIPT', 'STYLE'].includes(read(node, 'tagName'))) continue
        const style = read(one, 'ownerDocument').defaultView.getComputedStyle(node)
        if (String(style.webkitTextSecurity || 'none') !== 'none') continue
        const shown = style.display
        if (shown === 'none' || (shown !== 'contents' && !call(node, 'getClientRects').length)) continue
        const inline = shown.startsWith('inline') || shown === 'contents'
        if (!inline) lines.push('')
        const slotted = read(node, 'tagName') === 'SLOT' ? call(node, 'assignedNodes') : []
        walk(slotted.length ? slotted : read(rootOf(node) || node, 'childNodes'))
        if (!inline) lines.push('')
      }
    }
    walk(read(rootOf(one) || one, 'childNodes'))
    return lines.map(text).filter(Boolean)
  }
  // What it says for itself, with the words of the hit. Its lines are the policy's to read, with what is too long to be a name left out: built to be pressed, any of them may say what it does, as a Pay tile says Order summary and then Pay now; a row, or what only a listener round it or a place in the tab order says takes a press, by its first alone, as a row is not called Pay for its second cell and an app's root not Delete for its menu. Too many controls and it is no one control, as a column of cards is not.
  const SHORT = 60
  const actingName = (one) => text(labelOf(one) || call(one, 'getAttribute', 'title') || (linesOf(one).length ? '' : onlyPicture(one)))
  const heldBy = (one) => {
    if (call(one, 'querySelectorAll', CONTROLS).length > 2) return []
    const lines = linesOf(one)
    const built = call(one, 'matches', BUILT_TO_PRESS) || (one !== heard && !call(one, 'matches', TAKES_A_PRESS))
    const row = ['TR', 'TD', 'TH'].includes(read(one, 'tagName'))
    return (built && !row ? lines.slice(0, 8) : lines.slice(0, 1)).filter((line) => line.length <= SHORT)
  }
  const actor = acting()
  const held = actor ? heldBy(actor) : []
  const named = () => {
    const hit = plainName(el)
    const own = actingName(actor)
    return own.includes(hit) ? own : text(own + ' ' + hit)
  }
  const name = (actor ? named() : nameOf(pressed)).slice(0, 200)
  // Through the shadow roots it is in: a design system's button is in the form round its host.
  const formOf = () => {
    if (read(el, 'form')) return read(el, 'form')
    for (let at = el; at; at = call(at, 'getRootNode').host) {
      const found = call(at, 'closest', 'form')
      if (found) return found
    }
    return null
  }
  const form = formOf()
  const buttonType = read(pressed, 'tagName') === 'BUTTON' ? String(call(pressed, 'getAttribute', 'type') || 'submit').toLowerCase() : ''
  const submit = !!form && ((read(pressed, 'tagName') === 'BUTTON' && buttonType === 'submit') || (read(pressed, 'tagName') === 'INPUT' && ['submit', 'image'].includes(String(read(pressed, 'type')).toLowerCase())))
  // One that only goes: a Rails or Turbo delete, a link that says it is a button, and one with a handler do more than that. A listener no attribute shows is the crate's to see.
  const link = read(pressed, 'tagName') === 'A' && !/^\s*(#|javascript:|$)/i.test(String(call(pressed, 'getAttribute', 'href') || '')) && !call(pressed, 'matches', '[data-method], [data-turbo-method], [role=button], [onclick], [onmousedown], [onmouseup], [onpointerdown], [onpointerup]')
  const said = String(call(el, 'getAttribute', 'role') || '').toLowerCase()
  const editable = !!(read(el, 'isContentEditable') || tag === 'textarea' || said === 'textbox' || said === 'searchbox' || (tag === 'input' && !['checkbox', 'radio', 'submit', 'button', 'image', 'file', 'reset', 'hidden', 'range', 'color'].includes(kind)))
  // What Enter in the form presses: its first submit button, in the order the form holds them.
  const first = form && read(form, 'elements') ? Array.from(read(form, 'elements')).find((one) => ['BUTTON', 'INPUT'].includes(read(one, 'tagName')) && ['submit', 'image'].includes(String(read(one, 'type')).toLowerCase())) : null
  // A closed shadow root's host: it has the keyboard and shows nothing to read, not even that it has a root.
  const native = ['input', 'select', 'textarea', 'button', 'a', 'area', 'summary', 'body', 'html', 'iframe', 'frame', 'object', 'embed', 'img', 'video', 'audio', 'canvas']
  // And what draws its own face and acts on a press: a canvas, or a component showing nothing that can be read. An empty div with a listener is a backdrop, or a tile nobody named, and goes.
  const drawn = !!actor && !name && !held.length && (tag === 'canvas' || tag.includes('-')) && !read(el, 'children').length && !text(read(el, 'innerText'))
  const opaque = drawn || (!native.includes(tag) && !read(el, 'shadowRoot') && !read(el, 'children').length && !text(read(el, 'innerText')) && !name && !!root && root.activeElement === el)
  // The form's fields, or the page's when it is in none: a webmail's Send and a chat
  // widget's are in no form, and their message box is an editable region.
  // Into the open shadow roots under it; a closed one is the crate's (`closed_fields`).
  // So far and no further on a page of a million nodes or a form of hundreds of fields, and it says so: a submit then asks.
  const fields = []
  let walked = 0
  const fieldsIn = (under) => {
    for (const one of call(under, 'querySelectorAll', '*')) {
      if (fields.length >= 200 || walked >= 50000) return
      walked += 1
      if (call(one, 'matches', 'input, select, textarea, [contenteditable]:not([contenteditable=false]), [role=textbox]')) fields.push(describe(one))
      if (read(one, 'shadowRoot')) fieldsIn(read(one, 'shadowRoot'))
    }
  }
  fieldsIn(form || read(el, 'ownerDocument'))
  // What the dialog a press is in says: its label and its own lines. Its Confirm does what the dialog says.
  const dialogOf = () => {
    if (!control && !actor && !editable) return ''
    for (let at = el; at; at = call(at, 'getRootNode').host) {
      const box = call(at, 'closest', 'dialog, [role=dialog], [role=alertdialog]')
      if (box) {
        const label = labelOf(box)
        const lines = linesOf(box, actor, MOST_IN_A_DIALOG).filter((line) => line !== label)
        return text([label, ...lines].join(' ')).slice(0, MOST_IN_A_DIALOG)
      }
    }
    return ''
  }
  // The document it is in and the origins round it, which is the frame it is in.
  const place = read(el, 'ownerDocument').location
  const at = place ? [place.href, ...Array.from(place.ancestorOrigins || [])] : []
  return { at, cut: walked >= 50000 || fields.length >= 200, control: !!control, tag, type: kind, name, autocomplete: String(call(el, 'getAttribute', 'autocomplete') || '').toLowerCase(), submit, link, editable, in_form: !!form, fields, field: describe(el), default_button: first ? nameOf(first) : '', opaque, dialog: dialogOf(), held }
";

static FACTS: LazyLock<String> =
    LazyLock::new(|| ["function (heard) {", FIELDS, FACTS_BODY, "}"].concat());

static ROUND_IT: LazyLock<String> = LazyLock::new(|| {
    [
        "function () { ",
        NATIVE,
        "const el = read(this, 'nodeType') === 1 ? this : read(this, 'parentElement') || read(this, 'element') || read(this, 'host'); if (!el) return null; const up = read(el, 'parentElement') || call(el, 'getRootNode').host || null; return !up || ['BODY', 'HTML'].includes(read(up, 'tagName')) ? null : up }",
    ]
    .concat()
});

const MOST_LISTENED_ROUND: usize = 6;

const PRESS_EVENTS: [&str; 5] = ["click", "mousedown", "mouseup", "pointerdown", "pointerup"];

fn hears_a_press(said: &Value) -> bool {
    said.get("listeners")
        .and_then(Value::as_array)
        .is_some_and(|all| {
            all.iter().any(|one| {
                one.get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| PRESS_EVENTS.contains(&kind))
            })
        })
}

/// What the secret scan's handles are held under, and let go of together.
const SECRETS: &str = "nib-agent-secrets";

static DESCRIBED: LazyLock<String> = LazyLock::new(|| {
    [
        "function () {",
        FIELDS,
        "const value = read(this, 'value'); return Object.assign(describe(this), { filled: String((value === undefined ? read(this, 'innerText') : value) || '').trim() !== '' }) }",
    ]
    .concat()
});

static FIELDS_SCOPE: LazyLock<String> = LazyLock::new(|| {
    [
        "function () { ",
        NATIVE,
        "const el = read(this, 'nodeType') === 1 ? this : read(this, 'parentElement'); if (!el) return null; if (read(el, 'form')) return read(el, 'form'); for (let at = el; at; at = call(at, 'getRootNode').host) { const found = call(at, 'closest', 'form'); if (found) return found } return read(el, 'ownerDocument') }",
    ]
    .concat()
});

static DESCRIBED_ONLY: LazyLock<String> =
    LazyLock::new(|| ["function () {", FIELDS, "return describe(this) }"].concat());

static PRESSED: LazyLock<String> = LazyLock::new(|| {
    [
        "function () {",
        FIELDS,
        "const el = read(this, 'nodeType') === 1 ? this : read(this, 'parentElement') || read(this, 'element') || read(this, 'host'); return el ? call(el, 'closest', CONTROLS) : null }",
    ]
    .concat()
});

pub(super) const FRAME_PATIENCE: Duration = Duration::from_secs(8);

const MOST_ON_FRAMES: Duration = Duration::from_secs(10);

fn prefix_past_budget(prefix: &str, started: Instant) -> bool {
    !prefix.is_empty() && started.elapsed() > MOST_ON_FRAMES
}

fn patience_in(session: Option<&str>) -> Duration {
    if session.is_some() {
        FRAME_PATIENCE
    } else {
        cdp::PATIENCE
    }
}

const LEFT_OUT: &str = "left out";

const MOST_FIELDS_ASKED: usize = 500;

const MOST_PAINTED: usize = 500;

type Hidden = (HashSet<(String, u64)>, Vec<[f64; 4]>);

/// A secret field on the page: which node, and whether anything is in it.
struct Secret {
    /// Its part's prefix, as its ref starts.
    prefix: String,
    /// Its node.
    backend: u64,
    /// Whether it holds a value.
    filled: bool,
}

const ACTIVE: &str = r"(() => {
  const read = (one, key) => Reflect.get(Object.getPrototypeOf(one), key, one)
  let at = document.activeElement
  try { while (at) {
    const inner = (read(at, 'shadowRoot') && read(at, 'shadowRoot').activeElement) || (read(at, 'contentDocument') && read(at, 'contentDocument').activeElement)
    if (!inner) break
    at = inner
  } } catch (_) {}
  return at
})()";

const IN_PAGE_KEY: &str = r"function (key, code, modifiers) {
  const init = { key, code, bubbles: true, cancelable: true, composed: true, altKey: !!(modifiers & 1), ctrlKey: !!(modifiers & 2), metaKey: !!(modifiers & 4), shiftKey: !!(modifiers & 8) }
  const went = this.dispatchEvent(new KeyboardEvent('keydown', init))
  let answer = ''
  if (went) {
    const form = this.form || (this.closest && this.closest('form'))
    if (key === 'Enter' && this.tagName !== 'TEXTAREA' && !this.isContentEditable) {
      if (form) { form.requestSubmit ? form.requestSubmit() : form.submit() }
    } else if (key === 'Tab') {
      const all = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')).filter((one) => !one.disabled && one.tabIndex >= 0 && one.getClientRects().length > 0)
      const at = all.indexOf(this)
      const next = all[(at + (init.shiftKey ? -1 : 1) + all.length) % all.length]
      if (next) next.focus()
    } else if (key === 'Backspace' || key === 'Delete') {
      document.execCommand(key === 'Backspace' ? 'delete' : 'forwardDelete')
    } else if (!init.ctrlKey && !init.altKey && !init.metaKey) {
      answer = 'type'
    }
  }
  this.dispatchEvent(new KeyboardEvent('keyup', init))
  return answer
}";

const TEXT: &str = r"(() => ({ url: location.href, title: document.title, text: document.body ? document.body.innerText : '' }))()";

const UNVALUED: &str = r"const unvalued = (root) => {
  for (const one of root.querySelectorAll('input[type=password]')) one.remove()
  for (const one of root.querySelectorAll('input[value]')) one.removeAttribute('value')
  return root
}";

const REGIONS: &str = r"[contenteditable]:not([contenteditable=false i]), [role=textbox]";

static REGIONS_SAID: LazyLock<String> = LazyLock::new(|| {
    [
        "(() => {",
        FIELDS,
        "const said = (one) => Object.assign(describe(one), { filled: text(read(one, 'innerText')) !== '' }); return document.body ? Array.from(document.body.querySelectorAll('",
        REGIONS,
        "')).map(said) : [] })()",
    ]
    .concat()
});

const MASKED_TEXT: &str = r"
  const read = (one, key) => Reflect.get(Object.getPrototypeOf(one), key, one)
  const call = (one, key, ...args) => read(one, key).apply(one, args)
  const all = Array.from(document.body.querySelectorAll('[contenteditable]:not([contenteditable=false i]), [role=textbox]'))
  const secret = hidden.map((at) => all[at]).filter(Boolean)
  const say = (one) => {
    if (secret.includes(one)) return '[hidden]'
    const view = read(one, 'ownerDocument').defaultView
    if (view.getComputedStyle(one).display === 'none') return ''
    if (!secret.some((held) => call(one, 'contains', held))) return call(one, 'getClientRects').length ? read(one, 'innerText') : ''
    let said = ''
    for (const node of read(one, 'childNodes')) {
      if (read(node, 'nodeType') === 3) said += read(node, 'textContent').replace(/\s+/g, ' ')
      else if (read(node, 'nodeType') === 1) {
        const shown = view.getComputedStyle(node).display
        const words = say(node)
        said += shown.startsWith('inline') ? words : words ? '\n' + words + '\n' : ''
      }
    }
    return said
  }
  return say(document.body).replace(/\n{3,}/g, '\n\n').trim()
";

const MASKED_CLONE: &str = r"
  const all = Array.from(copy.querySelectorAll('[contenteditable]:not([contenteditable=false i]), [role=textbox]'))
  for (const at of hidden) if (all[at]) all[at].textContent = '[hidden]'
";

fn text_hiding(hidden: &[usize]) -> String {
    if hidden.is_empty() {
        return TEXT.to_string();
    }
    format!(
        "(() => {{ const hidden = {}; const said = (() => {{ {MASKED_TEXT} }})(); return {{ url: location.href, title: document.title, text: said }} }})()",
        json!(hidden)
    )
}

fn whole_hiding(hidden: &[usize]) -> String {
    [
        "(() => {\n",
        UNVALUED,
        "\n  const hidden = ",
        &json!(hidden).to_string(),
        r"
  const copy = document.body ? document.body.cloneNode(true) : document.createElement('body')
",
        MASKED_CLONE,
        r"
  unvalued(copy)
  for (const one of copy.querySelectorAll('script, style, noscript, template, svg, canvas, iframe')) one.remove()
  for (const one of copy.querySelectorAll('[href]')) { try { one.setAttribute('href', one.href) } catch (_) { one.removeAttribute('href') } }
  for (const one of copy.querySelectorAll('[src]')) { try { one.setAttribute('src', one.src) } catch (_) { one.removeAttribute('src') } }
  return { url: location.href, title: document.title, html: copy.innerHTML.slice(0, 4000000), text: document.body ? (() => {",
        MASKED_TEXT,
        r"})() : '' }
})()",
    ]
    .concat()
}

fn clipped_hiding(hidden: &[usize]) -> String {
    crate::web_tabs::reader(false).replace(
        "/* __HIDE__ */",
        &format!(
            "{{ const copy = body; const hidden = {}; {MASKED_CLONE} }}",
            json!(hidden)
        ),
    )
}

pub struct Aim {
    point: (f64, f64),
    pub on: Element,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct FrameMap {
    origin: (f64, f64),
    across: (f64, f64),
    down: (f64, f64),
}

impl FrameMap {
    fn same() -> Self {
        Self {
            origin: (0.0, 0.0),
            across: (1.0, 0.0),
            down: (0.0, 1.0),
        }
    }

    fn of(quad: &[f64], width: f64, height: f64) -> Option<Self> {
        if quad.len() != 8 || width <= 0.0 || height <= 0.0 {
            return None;
        }
        let parallel = (quad[0] + quad[4] - quad[2] - quad[6]).abs() < 1.0
            && (quad[1] + quad[5] - quad[3] - quad[7]).abs() < 1.0;
        let map = Self {
            origin: (quad[0], quad[1]),
            across: ((quad[2] - quad[0]) / width, (quad[3] - quad[1]) / width),
            down: ((quad[6] - quad[0]) / height, (quad[7] - quad[1]) / height),
        };
        (parallel && map.determinant().abs() > 1e-6).then_some(map)
    }

    fn nothing_drawn(quad: &[f64], width: f64, height: f64) -> bool {
        if quad.len() != 8 || width <= 0.0 || height <= 0.0 {
            return true;
        }
        let area = (quad[0] * quad[3] - quad[2] * quad[1])
            + (quad[2] * quad[5] - quad[4] * quad[3])
            + (quad[4] * quad[7] - quad[6] * quad[5])
            + (quad[6] * quad[1] - quad[0] * quad[7]);
        area.abs() < 1e-6
    }

    fn within(self, outer: Self) -> Self {
        let step = |(x, y): (f64, f64)| {
            (
                outer.across.0 * x + outer.down.0 * y,
                outer.across.1 * x + outer.down.1 * y,
            )
        };
        Self {
            origin: outer.to_page(self.origin),
            across: step(self.across),
            down: step(self.down),
        }
    }

    fn determinant(self) -> f64 {
        self.across.0 * self.down.1 - self.across.1 * self.down.0
    }

    fn to_page(self, (x, y): (f64, f64)) -> (f64, f64) {
        (
            self.origin.0 + self.across.0 * x + self.down.0 * y,
            self.origin.1 + self.across.1 * x + self.down.1 * y,
        )
    }

    fn to_frame(self, (x, y): (f64, f64)) -> Option<(f64, f64)> {
        let det = self.determinant();
        if det.abs() <= 1e-6 {
            return None;
        }
        let (dx, dy) = (x - self.origin.0, y - self.origin.1);
        Some((
            (dx * self.down.1 - dy * self.down.0) / det,
            (dy * self.across.0 - dx * self.across.1) / det,
        ))
    }
}

/// An element, resolved from a ref.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Element {
    /// The frame's session, for an element in a process of its own.
    session: Option<String>,
    /// The frame's id there.
    frame: Option<String>,
    /// The node.
    pub backend: u64,
}

impl Page<'_> {
    fn heard(&self) -> Arc<Mutex<Heard>> {
        cdp::heard(&self.label)
    }

    /// One call on the page's own session. A call the page cannot answer because it is
    /// holding a dialog - the press that raised it, a navigation it asked to be asked
    /// about - answers nothing rather than waiting for the agent to answer the dialog.
    fn call(&self, method: &str, params: &Value) -> Result<Value, Answer> {
        cdp::call_until(self.view, None, method, params, || {
            super::quiet::dialog_of(&self.label).is_some()
        })
        .map(Option::unwrap_or_default)
        .map_err(|why| Answer::error(Code::Failed, why))
    }

    fn call_on(&self, element: &Element, method: &str, params: &Value) -> Result<Value, Answer> {
        cdp::call_until(
            self.view,
            element.session.as_deref(),
            method,
            params,
            || super::quiet::dialog_of(&self.label).is_some(),
        )
        .map(Option::unwrap_or_default)
        .map_err(|why| stale(&why))
    }

    /// Where the page is.
    fn url(&self) -> String {
        self.view.url()
    }

    /// An element from a ref the agent passed.
    fn element(&self, reference: &str) -> Result<Element, Answer> {
        let Some((frame, backend)) = snapshot::parse_ref(reference) else {
            return Err(Answer::error(
                Code::NoSuchRef,
                format!("{reference} is not a ref: refs look like e12 or f2e17"),
            ));
        };
        let Some(number) = frame else {
            return Ok(Element {
                session: None,
                frame: None,
                backend,
            });
        };
        let found = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .frame(number);
        found
            .map(|one| Element {
                session: Some(one.session),
                frame: Some(one.id),
                backend,
            })
            .ok_or_else(|| {
                Answer::error(
                    Code::NoSuchRef,
                    format!("the frame of {reference} is gone: take a snapshot again"),
                )
            })
    }

    /// A handle to an element in nib's own world, for a function to run on: what it reads
    /// is the engine's own, whatever the page has defined on the same objects (9.3).
    fn object(&self, element: &Element) -> Result<String, Answer> {
        self.handle_in_world(element.session.as_deref(), element.backend, WORLD)
            .ok_or_else(|| stale("the element has no object"))
    }

    fn handle_in_world(&self, session: Option<&str>, backend: u64, group: &str) -> Option<String> {
        let resolve = |world: i64| {
            cdp::call_in(
                self.view,
                session,
                "DOM.resolveNode",
                &json!({ "backendNodeId": backend, "objectGroup": group, "executionContextId": world }),
                FRAME_PATIENCE,
            )
            .ok()
            .and_then(|said| {
                said.pointer("/object/objectId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
        };
        let started = Instant::now();
        for fresh in [false, true] {
            if fresh {
                if self.worlds_renewed.swap(true, Ordering::Relaxed) {
                    return None;
                }
                self.forget_worlds(session);
            }
            for frame in self.frames_of(session) {
                if started.elapsed() > FRAME_PATIENCE {
                    return None;
                }
                if let Some(handle) = self.world_of_frame(session, &frame).ok().and_then(resolve) {
                    self.frame_read(session, &frame);
                    return Some(handle);
                }
            }
        }
        None
    }

    fn frames_of(&self, session: Option<&str>) -> Vec<String> {
        let key = session.map(str::to_string);
        if let Some(known) = self
            .frame_lists
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&key)
        {
            return known.clone();
        }
        let tree = cdp::call_in(
            self.view,
            session,
            "Page.getFrameTree",
            &json!({}),
            patience_in(session),
        );
        let mut frames = Vec::new();
        if let Ok(tree) = tree {
            frames_under(tree.get("frameTree").unwrap_or(&Value::Null), &mut frames);
        }
        self.frame_lists
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key, frames.clone());
        frames
    }

    fn frame_read(&self, session: Option<&str>, frame: &str) {
        if let Some(known) = self
            .frame_lists
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_mut(&session.map(str::to_string))
        {
            if let Some(at) = known.iter().position(|one| one == frame) {
                known[..=at].rotate_right(1);
            }
        }
    }

    fn page_object(&self, element: &Element) -> Result<String, Answer> {
        let resolved = self.call_on(
            element,
            "DOM.resolveNode",
            &json!({ "backendNodeId": element.backend, "objectGroup": WORLD }),
        )?;
        resolved
            .pointer("/object/objectId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| stale("the element has no object"))
    }

    /// nib's own world in a session's top frame.
    fn world_in(&self, session: Option<&str>) -> Result<i64, Answer> {
        let frame = match session {
            None => self.main_frame()?,
            Some(_) => cdp::call_in(
                self.view,
                session,
                "Page.getFrameTree",
                &json!({}),
                FRAME_PATIENCE,
            )
            .map_err(|why| stale(&why))?
            .pointer("/frameTree/frame/id")
            .and_then(Value::as_str)
            .ok_or_else(|| Answer::error(Code::Failed, "the frame has no world for nib"))?
            .to_string(),
        };
        self.world_of_frame(session, &frame)
    }

    /// nib's own world in one frame, made once for the call.
    fn world_of_frame(&self, session: Option<&str>, frame: &str) -> Result<i64, Answer> {
        let key = (session.map(str::to_string), frame.to_string());
        if let Some(world) = self
            .worlds
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&key)
        {
            return Ok(*world);
        }
        let made = cdp::call_in(
            self.view,
            session,
            "Page.createIsolatedWorld",
            &json!({ "frameId": frame, "worldName": WORLD }),
            FRAME_PATIENCE,
        )
        .map_err(|why| stale(&why))?;
        let world = made
            .get("executionContextId")
            .and_then(Value::as_i64)
            .ok_or_else(|| Answer::error(Code::Failed, "the page has no world for nib"))?;
        self.worlds
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key, world);
        Ok(world)
    }

    fn forget_worlds(&self, session: Option<&str>) {
        self.worlds
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|(of, _), _| of.as_deref() != session);
        self.frame_lists
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&session.map(str::to_string));
    }

    /// Runs a function on an element in nib's own world, answering its value.
    fn run_on(
        &self,
        element: &Element,
        function: &str,
        arguments: &[Value],
    ) -> Result<Value, Answer> {
        self.run_with(element, &self.object(element)?, function, arguments)
    }

    fn run_in_page(
        &self,
        element: &Element,
        function: &str,
        arguments: &[Value],
    ) -> Result<Value, Answer> {
        self.run_with(element, &self.page_object(element)?, function, arguments)
    }

    fn run_with(
        &self,
        element: &Element,
        object: &str,
        function: &str,
        arguments: &[Value],
    ) -> Result<Value, Answer> {
        let arguments: Vec<Value> = arguments
            .iter()
            .map(|one| json!({ "value": one }))
            .collect();
        let answered = self.call_on(
            element,
            "Runtime.callFunctionOn",
            &json!({
                "objectId": object,
                "functionDeclaration": function,
                "arguments": arguments,
                "returnByValue": true,
                "awaitPromise": true,
            }),
        )?;
        thrown(&answered)?;
        Ok(answered
            .pointer("/result/value")
            .cloned()
            .unwrap_or_default())
    }

    /// What an element says about itself and its form.
    fn facts(&self, element: &Element) -> Result<Facts, Answer> {
        let said = self.run_on(element, &FACTS, &[])?;
        Ok(self.facts_from(element, &said))
    }

    fn facts_of_press(&self, element: &Element) -> Result<Facts, Answer> {
        let mut facts = self.facts(element)?;
        if facts.link && self.link_listens(element) {
            facts.link = false;
        }
        if facts.control || facts.editable {
            return Ok(facts);
        }
        let engine = self.engine_control_round(element);
        let named = |mut facts: Facts| {
            if let Some(name) = &engine {
                facts.name = joined_name(&facts.name, name);
            }
            facts
        };
        let Some(listening) = self.listening(element) else {
            return Ok(named(facts));
        };
        let answered = self.call_on(
            element,
            "Runtime.callFunctionOn",
            &json!({
                "objectId": self.object(element)?,
                "functionDeclaration": FACTS.as_str(),
                "arguments": [{ "objectId": listening }],
                "returnByValue": true,
            }),
        )?;
        thrown(&answered)?;
        let said = answered
            .pointer("/result/value")
            .cloned()
            .unwrap_or_default();
        Ok(named(self.facts_from(element, &said)))
    }

    fn link_listens(&self, element: &Element) -> bool {
        let control = self.object(element).ok().and_then(|object| {
            let found = self
                .call_on(
                    element,
                    "Runtime.callFunctionOn",
                    &json!({ "objectId": object, "functionDeclaration": PRESSED.as_str() }),
                )
                .ok()?;
            found
                .pointer("/result/objectId")?
                .as_str()
                .map(str::to_string)
        });
        control.is_some_and(|object| self.hears(element, &object))
    }

    fn hears(&self, element: &Element, object: &str) -> bool {
        let page_side = (|| {
            let node = self
                .call_on(element, "DOM.describeNode", &json!({ "objectId": object }))
                .ok()?;
            let backend = node.pointer("/node/backendNodeId")?.as_u64()?;
            let handle = self
                .call_on(
                    element,
                    "DOM.resolveNode",
                    &json!({ "backendNodeId": backend, "objectGroup": WORLD }),
                )
                .ok()?;
            handle
                .pointer("/object/objectId")?
                .as_str()
                .map(str::to_string)
        })();
        page_side.is_some_and(|handle| {
            self.call_on(
                element,
                "DOMDebugger.getEventListeners",
                &json!({ "objectId": handle }),
            )
            .is_ok_and(|said| hears_a_press(&said))
        })
    }

    fn engine_control_round(&self, element: &Element) -> Option<String> {
        let tree = self
            .call_on(
                element,
                "Accessibility.getPartialAXTree",
                &json!({ "objectId": self.object(element).ok()?, "fetchRelatives": true }),
            )
            .ok()?;
        control_in_tree(tree.get("nodes")?.as_array()?)
    }

    fn listening(&self, element: &Element) -> Option<String> {
        let mut object = self.object(element).ok()?;
        for _ in 0..MOST_LISTENED_ROUND {
            if self.hears(element, &object) {
                return Some(object);
            }
            let round = self
                .call_on(
                    element,
                    "Runtime.callFunctionOn",
                    &json!({ "objectId": object, "functionDeclaration": ROUND_IT.as_str() }),
                )
                .ok()?;
            object = round.pointer("/result/objectId")?.as_str()?.to_string();
        }
        None
    }

    fn facts_from(&self, element: &Element, said: &Value) -> Facts {
        let mut facts = facts_read(said);
        if !facts.cut {
            match self.closed_fields(element) {
                Some(closed) => facts.fields.extend(closed),
                None => facts.opaque = true,
            }
        }
        if facts.control {
            if let Some(name) = self.engine_name(element) {
                facts.name = joined_name(&facts.name, &name);
            }
        }
        facts
    }

    fn engine_name(&self, element: &Element) -> Option<String> {
        let object = self.object(element).ok()?;
        let control = self
            .call_on(
                element,
                "Runtime.callFunctionOn",
                &json!({ "objectId": object, "functionDeclaration": PRESSED.as_str() }),
            )
            .ok()?;
        let control = control.pointer("/result/objectId")?.as_str()?;
        let tree = self
            .call_on(
                element,
                "Accessibility.getPartialAXTree",
                &json!({ "objectId": control, "fetchRelatives": false }),
            )
            .ok()?;
        tree.pointer("/nodes/0/name/value")?
            .as_str()
            .map(str::to_string)
    }

    fn may_read_frame(&self, at: &[String]) -> bool {
        engines::frame_readable(self.limits.as_ref(), at)
    }

    fn closed_fields(&self, element: &Element) -> Option<Vec<Field>> {
        let session = element.session.as_deref();
        let call = |method: &str, params: &Value| {
            cdp::call_in(self.view, session, method, params, cdp::PATIENCE).ok()
        };
        let object = self.object(element).ok()?;
        let scope = call(
            "Runtime.callFunctionOn",
            &json!({ "objectId": object, "functionDeclaration": FIELDS_SCOPE.as_str() }),
        )?;
        let scope = call(
            "DOM.describeNode",
            &json!({ "objectId": scope.pointer("/result/objectId")?.as_str()? }),
        )?;
        let scope = scope.pointer("/node/backendNodeId")?.as_u64()?;
        let backends = fields_in_capture(&self.capture(session)?, Some(scope));
        if backends.len() > 200 {
            return None;
        }
        backends
            .into_iter()
            .map(|backend| {
                let field = self.handle_in_world(session, backend, WORLD)?;
                let said = call(
                    "Runtime.callFunctionOn",
                    &json!({
                        "objectId": field,
                        "functionDeclaration": DESCRIBED_ONLY.as_str(),
                        "returnByValue": true,
                    }),
                )?;
                serde_json::from_value(said.pointer("/result/value")?.clone()).ok()
            })
            .collect()
    }

    fn capture(&self, session: Option<&str>) -> Option<Value> {
        cdp::call_in(
            self.view,
            session,
            "DOMSnapshot.captureSnapshot",
            &json!({ "computedStyles": [] }),
            patience_in(session),
        )
        .ok()
    }

    /// What the element with the keyboard says about itself, if one has it.
    fn active_facts(&self) -> Result<Option<Facts>, Answer> {
        let Some((facts, object)) = self.active_in(None, None)? else {
            return Ok(None);
        };
        if matches!(facts.tag.as_str(), "body" | "html") {
            return Ok(Some(self.active_in_a_frame().unwrap_or(facts)));
        }
        let Some(frame) = self.frame_held(None, &object) else {
            return Ok(Some(facts));
        };
        let session = self.frame_session(&frame);
        let inner = match &session {
            Some(session) => self.active_in(Some(session), None)?,
            None => match self.frame_world(&frame) {
                Some(world) => self.active_in(None, Some(world))?,
                None => None,
            },
        };
        match inner {
            Some((facts, object)) if self.frame_held(session.as_deref(), &object).is_none() => {
                Ok(Some(facts))
            }
            _ => Err(Answer::error(
                Code::Failed,
                "the keyboard is in a frame Orden cannot read: take a snapshot, and press or type there by ref",
            )),
        }
    }

    fn frame_held(&self, session: Option<&str>, object: &str) -> Option<String> {
        cdp::call_in(
            self.view,
            session,
            "DOM.describeNode",
            &json!({ "objectId": object }),
            cdp::PATIENCE,
        )
        .ok()
        .and_then(|said| said.get("node").and_then(frame_of_holder))
    }

    fn frame_world(&self, frame: &str) -> Option<u64> {
        self.call(
            "Page.createIsolatedWorld",
            &json!({ "frameId": frame, "worldName": WORLD }),
        )
        .ok()?
        .get("executionContextId")?
        .as_u64()
    }

    fn active_in_a_frame(&self) -> Option<Facts> {
        let frames = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .frames();
        let mut held = None;
        for (_, frame) in frames {
            let Ok(Some((facts, _))) = self.active_in(Some(&frame.session), None) else {
                continue;
            };
            if !facts.pressable() && !facts.editable {
                continue;
            }
            let Ok(world) = self.world_in(Some(&frame.session)) else {
                continue;
            };
            let focused = cdp::call_in(
                self.view,
                Some(&frame.session),
                "Runtime.evaluate",
                &json!({ "expression": "document.hasFocus()", "returnByValue": true, "contextId": world }),
                cdp::PATIENCE,
            )
            .ok()
            .and_then(|said| said.pointer("/result/value").and_then(Value::as_bool));
            if focused == Some(true) {
                return Some(facts);
            }
            held.get_or_insert(facts);
        }
        held
    }

    fn active_in(
        &self,
        session: Option<&str>,
        world: Option<u64>,
    ) -> Result<Option<(Facts, String)>, Answer> {
        let call = |method: &str, params: &Value| -> Result<Value, Answer> {
            cdp::call_in(self.view, session, method, params, cdp::PATIENCE)
                .map_err(|why| stale(&why))
        };
        let world = match world {
            Some(world) => i64::try_from(world).unwrap_or_default(),
            None => self.world_in(session)?,
        };
        let asked = json!({ "expression": ACTIVE, "returnByValue": false, "contextId": world });
        let found = call("Runtime.evaluate", &asked)?;
        let Some(object) = found.pointer("/result/objectId").and_then(Value::as_str) else {
            return Ok(None);
        };
        let said = call(
            "Runtime.callFunctionOn",
            &json!({ "objectId": object, "functionDeclaration": FACTS.as_str(), "returnByValue": true }),
        )?;
        Ok(said
            .pointer("/result/value")
            .cloned()
            .map(|value| (facts_read(&value), object.to_string())))
    }

    fn frame_session(&self, frame: &str) -> Option<String> {
        self.heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .frames()
            .into_iter()
            .find(|(_, one)| one.id == frame)
            .map(|(_, one)| one.session)
    }

    /// Runs an expression in nib's own world in the page's frame, answering its value.
    pub fn isolated(&self, expression: &str) -> Result<Value, Answer> {
        let run = |context: i64| {
            self.call(
                "Runtime.evaluate",
                &json!({
                    "expression": expression,
                    "contextId": context,
                    "returnByValue": true,
                    "awaitPromise": true,
                }),
            )
        };
        let answered = run(self.world()?).or_else(|_| {
            self.forget_worlds(None);
            run(self.world()?)
        })?;
        thrown(&answered)?;
        Ok(answered
            .pointer("/result/value")
            .cloned()
            .unwrap_or_default())
    }

    /// nib's own world in the page's frame: the page's document, none of its globals.
    fn world(&self) -> Result<i64, Answer> {
        self.world_in(None)
    }

    fn main_frame(&self) -> Result<String, Answer> {
        if let Some(frame) = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .main_frame
            .clone()
        {
            return Ok(frame);
        }
        let tree = self.call("Page.getFrameTree", &json!({}))?;
        let frame = tree
            .pointer("/frameTree/frame/id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| Answer::error(Code::Failed, "the page has no frame"))?;
        self.heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .main_frame = Some(frame.clone());
        Ok(frame)
    }

    /// Waits for an act to settle; see the top of this file.
    fn settle(&self, navigations_before: u64) {
        let started = Instant::now();
        let navigated = loop {
            let navigations = self
                .heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .navigations;
            if navigations > navigations_before {
                break true;
            }
            if started.elapsed() >= NAVIGATION_STARTS || self.interrupted() {
                break false;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        if navigated {
            let loads = self
                .heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .loads;
            let waiting = Instant::now();
            while waiting.elapsed() < SETTLES && !self.interrupted() {
                if self
                    .heard()
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .loads
                    > loads
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        if self.interrupted() {
            return;
        }
        let Ok(context) = self.world() else {
            return;
        };
        let expression = format!(
            "({SETTLED})({}, {})",
            STILL.as_millis(),
            SETTLES.as_millis()
        );
        let _ = cdp::call_in(
            self.view,
            None,
            "Runtime.evaluate",
            &json!({ "expression": expression, "contextId": context, "awaitPromise": true, "returnByValue": true }),
            SETTLES + Duration::from_millis(500),
        );
    }

    /// Whether a wait should end early: the stop was pressed, or the page is holding a
    /// dialog, which stops everything in it.
    fn interrupted(&self) -> bool {
        super::stop::cancelled(self.since) || super::quiet::dialog_of(&self.label).is_some()
    }

    /// How many navigations of the page's own frame have started, for `settle`.
    fn navigations(&self) -> u64 {
        self.heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .navigations
    }

    /// Where an element's middle is in the page's viewport, scrolled into view first.
    fn point(&self, element: &Element) -> Result<(f64, f64), Answer> {
        Ok(self.points(element)?[0])
    }

    /// Where an element can be pressed in the page's viewport, scrolled into view first:
    /// its middle, and then the middles of its four quarters, for an element whose
    /// middle something small of the page's sits over - a badge, a count, an icon's
    /// overlay.
    fn points(&self, element: &Element) -> Result<Vec<(f64, f64)>, Answer> {
        let _ = self.call_on(
            element,
            "DOM.scrollIntoViewIfNeeded",
            &json!({ "backendNodeId": element.backend }),
        );
        let quads = self.call_on(
            element,
            "DOM.getContentQuads",
            &json!({ "backendNodeId": element.backend }),
        )?;
        let quad = quads
            .get("quads")
            .and_then(Value::as_array)
            .and_then(|all| {
                all.iter().find_map(|quad| {
                    let at: Vec<f64> = quad.as_array()?.iter().filter_map(Value::as_f64).collect();
                    (at.len() == 8 && area(&at) > 1.0).then_some(at)
                })
            })
            .ok_or_else(|| {
                Answer::error(
                    Code::Failed,
                    "the element is not visible: nothing of it is on the page",
                )
            })?;
        let map = self.frame_map(element)?;
        Ok(pressable(&quad)
            .into_iter()
            .map(|point| map.to_page(point))
            .collect())
    }

    /// The first of an element's points that a press lands on, or why none does: what
    /// covers its middle.
    fn landing(&self, element: &Element) -> Result<(f64, f64), Answer> {
        let points = self.points(element)?;
        let mut first = None;
        for point in &points {
            match self.lands_on(element, *point) {
                Ok(()) => return Ok(*point),
                Err(covered) => {
                    first.get_or_insert(covered);
                }
            }
        }
        Err(first.unwrap_or_else(|| {
            Answer::error(
                Code::Failed,
                "the element is not visible: nothing of it is on the page",
            )
        }))
    }

    pub fn aim(&self, element: &Element) -> Result<Aim, Answer> {
        let point = self.landing(element)?;
        let on = self.struck(element, point)?;
        Ok(Aim { point, on })
    }

    fn struck(&self, element: &Element, point: (f64, f64)) -> Result<Element, Answer> {
        if self.node_at(point).is_some() {
            self.element_at(point)
        } else {
            Ok(element.clone())
        }
    }

    fn at_first_point(&self, element: &Element) -> Result<Element, Answer> {
        let point = self.point(element)?;
        self.struck(element, point)
    }

    /// How far the page's own frame is scrolled, in CSS pixels: `DOM.getNodeForLocation`
    /// counts from the page's top left and not the viewport's, so a point in the viewport
    /// is that far further in. Asked with the viewport's point, a page scrolled down
    /// answered with whatever was that far from the top of the page - a header, a menu -
    /// and every press there was refused as covered by it (#373).
    fn scrolled(&self) -> (f64, f64) {
        let Ok(metrics) = self.call("Page.getLayoutMetrics", &json!({})) else {
            return (0.0, 0.0);
        };
        let get = |path: &str| {
            metrics
                .pointer(path)
                .and_then(Value::as_f64)
                .unwrap_or_default()
        };
        (
            get("/cssLayoutViewport/pageX"),
            get("/cssLayoutViewport/pageY"),
        )
    }

    /// The node a press at a point in the page's viewport lands on.
    fn node_at(&self, (x, y): (f64, f64)) -> Option<u64> {
        let (left, top) = self.scrolled();
        let hit = self
            .call(
                "DOM.getNodeForLocation",
                &json!({ "x": whole(x + left), "y": whole(y + top), "includeUserAgentShadowDOM": false, "ignorePointerEventsNone": false }),
            )
            .ok()?;
        let backend = hit.get("backendNodeId").and_then(Value::as_u64)?;
        Some(self.originating(None, backend))
    }

    fn originating(&self, session: Option<&str>, backend: u64) -> u64 {
        let call = |method: &str, params: &Value| {
            cdp::call_in(self.view, session, method, params, cdp::PATIENCE).ok()
        };
        let hangs =
            call("DOM.describeNode", &json!({ "backendNodeId": backend })).is_some_and(|said| {
                said.pointer("/node/pseudoType").is_some()
                    || said.pointer("/node/nodeName").and_then(Value::as_str)
                        == Some("#document-fragment")
            });
        if !hangs {
            return backend;
        }
        let holder = || {
            let handle = self.handle_in_world(session, backend, WORLD)?;
            let on = call(
                "Runtime.callFunctionOn",
                &json!({
                    "objectId": handle,
                    "functionDeclaration": "function () { return this.element || this.host || null }",
                }),
            )?;
            let said = call(
                "DOM.describeNode",
                &json!({ "objectId": on.pointer("/result/objectId")?.as_str()? }),
            )?;
            said.pointer("/node/backendNodeId")?.as_u64()
        };
        holder().unwrap_or(backend)
    }

    /// What a press at a point in the page's viewport lands on, as an element: inside a
    /// frame of another origin where the point is in one, since the frame's element says
    /// nothing of the button a press lands on (a card form, a pay button). A point in a
    /// frame that cannot be read is refused, for a press by ref, rather than judged blind.
    fn element_at(&self, point: (f64, f64)) -> Result<Element, Answer> {
        let backend = self
            .node_at(point)
            .ok_or_else(|| Answer::error(Code::Failed, "nothing of the page is at that point"))?;
        let element = Element {
            session: None,
            frame: None,
            backend,
        };
        let described = self.call("DOM.describeNode", &json!({ "backendNodeId": backend }))?;
        let node = described.get("node").cloned().unwrap_or_default();
        let Some(frame) = frame_of_holder(&node) else {
            return Ok(element);
        };
        if node.get("contentDocument").is_some() {
            return Ok(element);
        }
        self.element_in_frame(&frame, point).ok_or_else(|| {
            Answer::error(
                Code::Failed,
                "that point is in a frame Orden cannot read: take a snapshot and press by ref",
            )
        })
    }

    fn element_in_frame(&self, frame: &str, (x, y): (f64, f64)) -> Option<Element> {
        let session = self.frame_session(frame)?;
        let inner = Element {
            session: Some(session.clone()),
            frame: Some(frame.to_string()),
            backend: 0,
        };
        let (x, y) = self.frame_map(&inner).ok()?.to_frame((x, y))?;
        let call = |method: &str, params: &Value| {
            cdp::call_in(self.view, Some(&session), method, params, cdp::PATIENCE).ok()
        };
        let metrics = call("Page.getLayoutMetrics", &json!({}))?;
        let scrolled = |path: &str| metrics.pointer(path).and_then(Value::as_f64).unwrap_or(0.0);
        let hit = call(
            "DOM.getNodeForLocation",
            &json!({
                "x": whole(x + scrolled("/cssLayoutViewport/pageX")),
                "y": whole(y + scrolled("/cssLayoutViewport/pageY")),
                "includeUserAgentShadowDOM": false,
                "ignorePointerEventsNone": false,
            }),
        )?;
        let backend = hit.get("backendNodeId").and_then(Value::as_u64)?;
        let backend = self.originating(Some(&session), backend);
        let held = call("DOM.describeNode", &json!({ "backendNodeId": backend }))?;
        held.get("node")
            .and_then(frame_of_holder)
            .is_none()
            .then_some(Element { backend, ..inner })
    }

    fn frame_map(&self, element: &Element) -> Result<FrameMap, Answer> {
        let Some(frame) = &element.frame else {
            return Ok(FrameMap::same());
        };
        let holder = self.frame_holding(frame)?;
        let ask = |method: &str, params: &Value| match &holder {
            Some(holder) => self.call_on(holder, method, params),
            None => self.call(method, params),
        };
        let owner = ask("DOM.getFrameOwner", &json!({ "frameId": frame }))?;
        let Some(backend) = owner.get("backendNodeId").and_then(Value::as_u64) else {
            return if holder.is_some() {
                Err(stale("the frame has no owner"))
            } else {
                Ok(FrameMap::same())
            };
        };
        let boxes = ask("DOM.getBoxModel", &json!({ "backendNodeId": backend }))?;
        let quad: Vec<f64> = boxes
            .pointer("/model/content")
            .and_then(Value::as_array)
            .map(|all| all.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        let session = element.session.as_deref();
        let said = self.call_on(
            element,
            "Runtime.evaluate",
            &json!({ "expression": "[innerWidth, innerHeight]", "returnByValue": true, "contextId": self.world_of_frame(session, frame)? }),
        )?;
        let size = |at: &str| said.pointer(at).and_then(Value::as_f64).unwrap_or(0.0);
        let (width, height) = (size("/result/value/0"), size("/result/value/1"));
        let map = FrameMap::of(&quad, width, height).ok_or_else(|| {
            Answer::error(
                Code::Failed,
                if FrameMap::nothing_drawn(&quad, width, height) {
                    "that frame is not on the page"
                } else {
                    "that frame is drawn in a way Orden cannot follow: press something else"
                },
            )
        })?;
        match &holder {
            Some(holder) => Ok(map.within(self.frame_map(holder)?)),
            None => Ok(map),
        }
    }

    fn frame_holding(&self, frame: &str) -> Result<Option<Element>, Answer> {
        let frames = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .frames();
        let parent = frames
            .iter()
            .find(|(_, one)| one.id == frame)
            .map(|(_, one)| one.parent.as_str())
            .unwrap_or_default();
        if parent.is_empty() {
            return Ok(None);
        }
        frames
            .iter()
            .find(|(_, one)| one.session == parent)
            .map(|(_, one)| {
                Some(Element {
                    session: Some(one.session.clone()),
                    frame: Some(one.id.clone()),
                    backend: UNREAD,
                })
            })
            .ok_or_else(|| stale("the frame round it is gone"))
    }

    fn lands_on(&self, element: &Element, point: (f64, f64)) -> Result<(), Answer> {
        let covered = if element.session.is_some() {
            match self.element_at(point) {
                Ok(hit) if hit.session == element.session => hit,
                _ => return Ok(()),
            }
        } else {
            let Some(hit) = self.node_at(point) else {
                return Ok(());
            };
            Element {
                session: None,
                frame: None,
                backend: hit,
            }
        };
        let hit = covered.backend;
        if hit == element.backend {
            return Ok(());
        }
        let target = self.object(element)?;
        if self
            .frame_held(element.session.as_deref(), &target)
            .is_some()
        {
            return Ok(());
        }
        if self.inside(element, &self.object(&covered)?, &target) {
            return Ok(());
        }
        let what = self
            .run_on(&covered, "function () { const el = this.nodeType === 1 ? this : this.parentElement; return el ? el.tagName.toLowerCase() : '' }", &[])
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_default();
        Err(Answer::error(
            Code::Failed,
            format!("e{} is covered by e{hit} (a {what}) where it would be pressed: deal with that first, or, where the element is what shows there, press there with browser_click's x and y", element.backend),
        ))
    }

    /// Lights an element with the engine's own inspector highlight for a beat: drawn by
    /// the renderer, not put into the page (7.1).
    fn light(&self, element: &Element) {
        if element.session.is_some() {
            return;
        }
        let _ = self.call("Overlay.enable", &json!({}));
        let lit = self.call(
            "Overlay.highlightNode",
            &json!({
                "backendNodeId": element.backend,
                "highlightConfig": {
                    "contentColor": { "r": 111, "g": 76, "b": 255, "a": 0.18 },
                    "borderColor": { "r": 111, "g": 76, "b": 255, "a": 0.9 },
                },
            }),
        );
        if lit.is_ok() {
            std::thread::sleep(LIT);
            let _ = self.call("Overlay.hideHighlight", &json!({}));
        }
    }

    fn mouse(
        &self,
        kind: &str,
        (x, y): (f64, f64),
        button: &str,
        count: u8,
        modifiers: u8,
    ) -> Result<(), Answer> {
        let buttons = match (kind, button) {
            ("mousePressed", "left") => 1,
            ("mousePressed", "right") => 2,
            ("mousePressed", "middle") => 4,
            _ => 0,
        };
        self.call(
            "Input.dispatchMouseEvent",
            &json!({
                "type": kind, "x": x, "y": y, "button": button, "buttons": buttons,
                "clickCount": count, "modifiers": modifiers,
            }),
        )
        .map(|_| ())
    }

    /// Presses an element: into view, lit for a beat in a reader's tab, then the
    /// engine's own press at its middle. Refused on a field whose list is a window.
    fn click(
        &self,
        element: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer> {
        let aim = self.aim(element)?;
        gate(&aim.on)?;
        self.refuse_picker(&aim.on)?;
        if !self.own {
            self.light(element);
        }
        self.press_judged(aim.point, &aim.on, button, count, modifiers, gate)
    }

    fn refuse_picker(&self, element: &Element) -> Result<(), Answer> {
        if self.facts(element)?.picker() {
            return Err(Answer::error(
                Code::BadArguments,
                "that opens a list of the engine's own: set it with browser_select or browser_fill_form",
            ));
        }
        Ok(())
    }

    /// The engine's own press at a point in the tab's viewport, in CSS pixels - one image
    /// pixel of `browser_screenshot` at its own scale: what an agent falls back on where a
    /// press by ref cannot say what it lands on. Refused where it lands on a field whose
    /// list is a window, as a press by ref is.
    fn click_at(
        &self,
        point: (f64, f64),
        judged: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer> {
        let (width, height, _, _) = self.viewport()?;
        if !(0.0..width).contains(&point.0) || !(0.0..height).contains(&point.1) {
            return Err(Answer::error(
                Code::BadArguments,
                format!(
                    "{}, {} is outside the tab, which is {width} by {height}",
                    point.0, point.1
                ),
            ));
        }
        self.refuse_picker(judged)?;
        self.press_judged(point, judged, button, count, modifiers, gate)
    }

    fn press_judged(
        &self,
        point: (f64, f64),
        judged: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer> {
        let before = self.navigations();
        self.mouse("mouseMoved", point, "none", 0, modifiers)?;
        let mut last = judged.clone();
        for press in 1..=count.max(1) {
            let now = match self.struck(judged, point) {
                Ok(now) => now,
                Err(_) if press > 1 => break,
                Err(refused) => return Err(refused),
            };
            if press == 1 || now != last {
                gate(&now)?;
                self.refuse_picker(&now)?;
                last = now.clone();
            }
            if let Some(over) = self
                .pointer_over(&now)
                .filter(|over| !self.same_press(over, &now))
            {
                gate(&over)?;
                self.refuse_picker(&over)?;
            }
            self.mouse("mousePressed", point, button, press, modifiers)?;
            self.mouse("mouseReleased", point, button, press, modifiers)?;
        }
        self.settle(before);
        Ok(())
    }

    /// What the frame an element is in says the pointer is over, by `:hover`, the engine's
    /// own: the deepest of it, and not a label's control, which shows it too when only its
    /// label is under the pointer. `None` for an element of the page's own document.
    fn pointer_over(&self, element: &Element) -> Option<Element> {
        let (session, frame) = (element.session.as_deref()?, element.frame.as_deref()?);
        let world = self.world_of_frame(Some(session), frame).ok()?;
        let call = |method: &str, params: &Value| {
            cdp::call_in(self.view, Some(session), method, params, cdp::PATIENCE).ok()
        };
        let said = call(
            "Runtime.evaluate",
            &json!({
                "expression": "(() => { const all = [...document.querySelectorAll(':hover')]; const over = all.filter((one) => !all.some((label) => label.tagName === 'LABEL' && label.control === one && !label.contains(one))); return over[over.length - 1] || null })()",
                "contextId": world,
            }),
        )?;
        let object = said.pointer("/result/objectId")?.as_str()?;
        let node = call("DOM.describeNode", &json!({ "objectId": object }))?;
        Some(Element {
            backend: node.pointer("/node/backendNodeId")?.as_u64()?,
            ..element.clone()
        })
    }

    /// Whether a press at one is a press at the other: `INSIDE`, either way round.
    fn same_press(&self, one: &Element, other: &Element) -> bool {
        if one == other {
            return true;
        }
        let (Ok(one_held), Ok(other_held)) = (self.object(one), self.object(other)) else {
            return false;
        };
        self.inside(one, &one_held, &other_held)
    }

    fn inside(&self, on: &Element, object: &str, target: &str) -> bool {
        self.call_on(
            on,
            "Runtime.callFunctionOn",
            &json!({
                "objectId": object,
                "functionDeclaration": INSIDE.as_str(),
                "arguments": [{ "objectId": target }],
                "returnByValue": true,
            }),
        )
        .is_ok_and(|said| said.pointer("/result/value").and_then(Value::as_bool) != Some(false))
    }

    fn hover(&self, element: &Element) -> Result<(), Answer> {
        let point = self.point(element)?;
        self.mouse("mouseMoved", point, "none", 0, 0)
    }

    /// Words into a field, as text rather than keys; replacing what is there when asked.
    fn type_text(&self, element: &Element, text: &str, replace: bool) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        self.refuse_secret(&facts)?;
        if facts.sensitive() {
            super::log::sensitive();
        }
        if facts.tag == "select" {
            return Err(Answer::error(
                Code::BadArguments,
                "that is a list: use browser_select",
            ));
        }
        if facts.kind == "file" {
            return Err(Answer::error(
                Code::BadArguments,
                "that takes files: use browser_upload",
            ));
        }
        if facts.picker() {
            return self.set_value(element, text);
        }
        if !facts.editable {
            return Err(Answer::error(
                Code::BadArguments,
                "that is not a field words can be typed into",
            ));
        }
        let placing = if replace { CARET_ALL } else { CARET_END };
        // In a reader's tab the field is focused, its caret placed and the words put in
        // within one task of the page's own, so a key of the reader's - who may be typing
        // in the same page this moment - lands before them or after them and never
        // between, where it would have sent the words into the reader's field (7.3). An
        // agent's own tab has nobody else in it and keeps the engine's insert.
        if !self.own && !text.is_empty() {
            let put = self.run_in_page(
                element,
                &format!("function (text) {{ this.focus(); ({placing}).call(this); return document.execCommand('insertText', false, text) }}"),
                &[json!(text)],
            )?;
            if put.as_bool() == Some(true) {
                return Ok(());
            }
        }
        self.call_on(
            element,
            "DOM.focus",
            &json!({ "backendNodeId": element.backend }),
        )?;
        self.run_in_page(element, placing, &[])?;
        if text.is_empty() {
            if replace {
                self.press_key(
                    &keys::chord("Delete").map_err(|why| Answer::error(Code::Failed, why))?,
                )?;
            }
            return Ok(());
        }
        self.call("Input.insertText", &json!({ "text": text }))
            .map(|_| ())
    }

    /// A value set through the page, with the events a person's choice raises: for the
    /// fields whose own picker is a window (a date, a time, a colour).
    fn set_value(&self, element: &Element, text: &str) -> Result<(), Answer> {
        let said = self.run_in_page(
            element,
            "function (value) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value').set; setter.call(this, value); this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); return this.value }",
            &[json!(text)],
        )?;
        if said.as_str() == Some(text) || text.is_empty() {
            Ok(())
        } else {
            Err(Answer::error(
                Code::BadArguments,
                format!("the field did not take {text:?}: a date is written 2026-09-30, a time 14:30, a colour #336699"),
            ))
        }
    }

    /// Options of a `<select>` chosen through the page, never by opening its list.
    fn select(&self, element: &Element, values: &[String]) -> Result<Vec<String>, Answer> {
        let said = self.run_in_page(
            element,
            r"function (values) {
  if (this.tagName !== 'SELECT') return { error: 'that is not a <select>: press it and then the option you want' }
  const options = Array.from(this.options)
  const pick = (value) => options.find((one) => one.value === value) || options.find((one) => one.label.trim() === value.trim()) || options.find((one) => one.label.trim().toLowerCase() === value.trim().toLowerCase())
  const wanted = values.map(pick)
  const missing = values.find((_, at) => !wanted[at])
  if (missing !== undefined) return { error: 'there is no option ' + JSON.stringify(missing) + ': the options are ' + options.slice(0, 40).map((one) => JSON.stringify(one.label.trim())).join(', ') }
  if (!this.multiple && wanted.length > 1) return { error: 'this list takes one option' }
  for (const one of options) one.selected = wanted.includes(one)
  this.dispatchEvent(new Event('input', { bubbles: true }))
  this.dispatchEvent(new Event('change', { bubbles: true }))
  return { chosen: wanted.map((one) => one.value) }
}",
            &[json!(values)],
        )?;
        if let Some(error) = said.get("error").and_then(Value::as_str) {
            return Err(Answer::error(Code::BadArguments, error));
        }
        Ok(said
            .get("chosen")
            .and_then(Value::as_array)
            .map(|all| {
                all.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default())
    }

    /// One field of a form set to a value, by what kind of field it is.
    fn fill(&self, element: &Element, value: &FieldValue, gate: Gate<'_>) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        self.refuse_secret(&facts)?;
        if facts.sensitive() {
            super::log::sensitive();
        }
        match value {
            FieldValue::Ticked(wanted) => {
                if !matches!(facts.kind.as_str(), "checkbox" | "radio") {
                    return Err(Answer::error(
                        Code::BadArguments,
                        "true and false are for a checkbox or a radio button",
                    ));
                }
                if self.tick_changes(element, *wanted)? {
                    self.click(element, "left", 1, 0, gate)?;
                }
                Ok(())
            }
            FieldValue::Options(values) => self.select(element, values).map(|_| ()),
            FieldValue::Words(text) if facts.tag == "select" => {
                self.select(element, std::slice::from_ref(text)).map(|_| ())
            }
            FieldValue::Words(text) => self.type_text(element, text, true),
        }
    }

    fn tick_changes(&self, element: &Element, wanted: bool) -> Result<bool, Answer> {
        let now = self.run_on(element, "function () { return this.checked }", &[])?;
        Ok(now.as_bool() != Some(wanted))
    }

    /// One key or chord pressed inside the page.
    fn press(&self, key: &Key) -> Result<(), Answer> {
        self.may_press(key)?;
        let before = self.navigations();
        self.press_key(key)?;
        self.settle(before);
        Ok(())
    }

    /// One key or chord in a reader's page, as the page's own key events rather than the
    /// engine's: a reader's tab hands the engine's keys to the window, which then takes
    /// the keyboard (see reader.rs). The key's default is done the page's way - Enter
    /// submits the field's form, Tab moves along, Backspace and Delete delete - and its
    /// text is inserted as text.
    fn press_in_page(&self, key: &Key) -> Result<(), Answer> {
        self.may_press(key)?;
        let found = self.call(
            "Runtime.evaluate",
            &json!({ "expression": format!("{ACTIVE} || document.body"), "returnByValue": false }),
        )?;
        let Some(object) = found.pointer("/result/objectId").and_then(Value::as_str) else {
            return Err(Answer::error(
                Code::Failed,
                "the page has nothing to press a key in",
            ));
        };
        let before = self.navigations();
        let said = self.call(
            "Runtime.callFunctionOn",
            &json!({
                "objectId": object,
                "functionDeclaration": IN_PAGE_KEY,
                "arguments": [{ "value": key.name }, { "value": key.code }, { "value": key.modifiers }],
                "returnByValue": true,
            }),
        )?;
        let went = said
            .pointer("/result/value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if went == "type" {
            if let Some(text) = key.text.as_deref() {
                let text = if text == "\r" { "\n" } else { text };
                self.call("Input.insertText", &json!({ "text": text }))?;
            }
        }
        self.settle(before);
        Ok(())
    }

    fn press_key(&self, key: &Key) -> Result<(), Answer> {
        for event in key.events() {
            self.call("Input.dispatchKeyEvent", &event)?;
        }
        Ok(())
    }

    /// An element into view, or the page moved by an amount with the wheel at its middle.
    fn scroll(&self, element: Option<&Element>, dx: f64, dy: f64) -> Result<(), Answer> {
        if let Some(element) = element {
            self.call_on(
                element,
                "DOM.scrollIntoViewIfNeeded",
                &json!({ "backendNodeId": element.backend }),
            )?;
            return Ok(());
        }
        let (width, height, x, y) = self.viewport()?;
        // The wheel scrolls what is under it, which may be a frame of a site the agent may
        // not act in (9.2); that, and what cannot be told, is scrolled as a whole page
        // instead, which moves the tab's own document and no frame in it.
        let middle = (width / 2.0, height / 2.0);
        let under = if self.limits_sites() {
            self.element_at(middle)
                .ok()
                .and_then(|one| self.facts(&one).ok())
        } else {
            None
        };
        if !wheels(self.limits.as_ref(), under.as_ref()) {
            self.isolated(&format!(
                "window.scrollBy({{ left: {dx}, top: {dy}, behavior: 'instant' }})"
            ))?;
            return Ok(());
        }
        self.call(
            "Input.dispatchMouseEvent",
            &json!({ "type": "mouseWheel", "x": middle.0, "y": middle.1, "deltaX": dx, "deltaY": dy }),
        )?;
        // The wheel is what a person's scroll is, and what a page's own scrolling listens
        // to; a page it did not move is scrolled as a whole instead.
        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(400) {
            std::thread::sleep(Duration::from_millis(50));
            let (_, _, now_x, now_y) = self.viewport()?;
            if (now_x - x).abs() > 0.5 || (now_y - y).abs() > 0.5 {
                return Ok(());
            }
        }
        self.isolated(&format!(
            "window.scrollBy({{ left: {dx}, top: {dy}, behavior: 'instant' }})"
        ))?;
        Ok(())
    }

    /// One element dragged onto another, with the engine's own drag when the page drags
    /// and plain presses and moves when it only listens to the pointer. The engine's drag
    /// is intercepted rather than started, so no drag of the system's ever begins.
    fn drag(
        &self,
        (from, picked): (&Element, &Element),
        (to, dropped): (&Element, &Element),
        (at_start, at_end): (Gate<'_>, Gate<'_>),
    ) -> Result<(), Answer> {
        let start = self.point(from)?;
        let end = self.point(to)?;
        self.call("Input.setInterceptDrags", &json!({ "enabled": true }))?;
        self.heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .dragged = None;
        let dragged = (|| {
            self.mouse("mouseMoved", start, "none", 0, 0)?;
            let now = self.struck(from, start)?;
            if &now != picked {
                at_start(&now)?;
            }
            self.mouse("mousePressed", start, "left", 1, 0)?;
            for step in 1..=8u8 {
                let at = f64::from(step) / 8.0;
                let point = (
                    start.0 + (end.0 - start.0) * at,
                    start.1 + (end.1 - start.1) * at,
                );
                self.call(
                    "Input.dispatchMouseEvent",
                    &json!({ "type": "mouseMoved", "x": point.0, "y": point.1, "button": "left", "buttons": 1 }),
                )?;
                std::thread::sleep(Duration::from_millis(16));
            }
            let data = self
                .heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .dragged
                .take();
            if let Some(data) = data {
                for kind in ["dragEnter", "dragOver", "drop"] {
                    self.call(
                        "Input.dispatchDragEvent",
                        &json!({ "type": kind, "x": end.0, "y": end.1, "data": data }),
                    )?;
                }
            }
            let now = self.struck(to, end)?;
            if &now != dropped {
                at_end(&now)?;
            }
            self.mouse("mouseReleased", end, "left", 1, 0)
        })();
        let _ = self.call("Input.setInterceptDrags", &json!({ "enabled": false }));
        dragged
    }

    /// Files handed to a file input: the input itself, or the chooser a press on the
    /// element opens, which the engine intercepts rather than shows (6.2).
    fn upload(&self, element: &Element, files: &[String], gate: Gate<'_>) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        let input = if facts.kind == "file" {
            element.clone()
        } else {
            self.heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .chooser = None;
            self.click(element, "left", 1, 0, gate)?;
            let waiting = Instant::now();
            let chosen = loop {
                if let Some(node) = self
                    .heard()
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .chooser
                    .take()
                {
                    break Some(node);
                }
                if waiting.elapsed() > Duration::from_secs(3) || self.interrupted() {
                    break None;
                }
                std::thread::sleep(Duration::from_millis(25));
            };
            let Some(backend) = chosen else {
                return Err(Answer::error(
                    Code::Failed,
                    "pressing it opened no file chooser: pass the file input's ref",
                ));
            };
            Element {
                session: element.session.clone(),
                frame: element.frame.clone(),
                backend,
            }
        };
        self.call_on(
            &input,
            "DOM.setFileInputFiles",
            &json!({ "files": files, "backendNodeId": input.backend }),
        )?;
        Ok(())
    }

    /// The viewport in CSS pixels, where it is scrolled to, and the device's pixels per
    /// CSS pixel: `(width, height, x, y)` and the ratio in `ratio`.
    fn viewport(&self) -> Result<(f64, f64, f64, f64), Answer> {
        let metrics = self.call("Page.getLayoutMetrics", &json!({}))?;
        let get = |path: &str| {
            metrics
                .pointer(path)
                .and_then(Value::as_f64)
                .unwrap_or_default()
        };
        Ok((
            get("/cssVisualViewport/clientWidth"),
            get("/cssVisualViewport/clientHeight"),
            get("/cssVisualViewport/pageX"),
            get("/cssVisualViewport/pageY"),
        ))
    }

    fn ratio(&self) -> f64 {
        self.call("Page.getLayoutMetrics", &json!({}))
            .ok()
            .and_then(|metrics| {
                let device = metrics.pointer("/layoutViewport/clientWidth")?.as_f64()?;
                let css = metrics
                    .pointer("/cssLayoutViewport/clientWidth")?
                    .as_f64()?;
                (css > 0.0).then_some(device / css)
            })
            .filter(|ratio| *ratio > 0.0)
            .unwrap_or(1.0)
    }

    /// A PNG of the page: what fits in the tab, the whole page, or one element; scaled to
    /// one image pixel per CSS pixel unless asked. Refused while a password field has the
    /// keyboard (9.4).
    fn screenshot(
        &self,
        element: Option<&Element>,
        full: bool,
        scale: Option<f64>,
    ) -> Result<Picture, Answer> {
        if !self.may_touch_credentials()
            && self.active_facts()?.is_some_and(|facts| facts.password())
        {
            return Err(Answer::error(
                Code::PasswordField,
                "a password field has the keyboard: nothing is photographed while one does",
            ));
        }
        let (width, height, x, y) = self.viewport()?;
        let clip = match (element, full) {
            (Some(element), _) => {
                let _ = self.call_on(
                    element,
                    "DOM.scrollIntoViewIfNeeded",
                    &json!({ "backendNodeId": element.backend }),
                );
                let [left, top, right, bottom] = self.page_rect(element)?;
                (left, top, right - left, bottom - top)
            }
            (None, true) => {
                let metrics = self.call("Page.getLayoutMetrics", &json!({}))?;
                let content_width = metrics
                    .pointer("/cssContentSize/width")
                    .and_then(Value::as_f64)
                    .unwrap_or(width);
                let content_height = metrics
                    .pointer("/cssContentSize/height")
                    .and_then(Value::as_f64)
                    .unwrap_or(height);
                (0.0, 0.0, content_width, content_height.min(TALLEST))
            }
            (None, false) => (x, y, width, height),
        };
        if clip.2 < 1.0 || clip.3 < 1.0 {
            return Err(Answer::error(
                Code::Failed,
                "nothing of it is on the page to photograph",
            ));
        }
        let wanted = scale.unwrap_or(1.0).clamp(0.1, 4.0);
        for _ in 0..2 {
            let (before, mut rects) = self.hidden_rects()?;
            let shot = self.call(
                "Page.captureScreenshot",
                &json!({
                    "format": "png",
                    "captureBeyondViewport": full || element.is_some(),
                    "clip": { "x": clip.0, "y": clip.1, "width": clip.2, "height": clip.3, "scale": wanted / self.ratio() },
                }),
            )?;
            let (after, later) = self.hidden_rects()?;
            if before != after {
                continue;
            }
            rects.extend(later);
            let png = shot
                .get("data")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let (width, height) = png_size(&png).unwrap_or_default();
            let png = painted_over(png, clip, (width, height), &rects)?;
            return Ok(Picture { png, width, height });
        }
        Err(Answer::error(
            Code::Failed,
            "this page's secret fields keep changing, so there is no picture of it",
        ))
    }

    /// Where an element is on the page, in CSS pixels from the page's top left: its
    /// left, top, right and bottom, through the frame it is in.
    fn page_rect(&self, element: &Element) -> Result<[f64; 4], Answer> {
        let model = self.call_on(
            element,
            "DOM.getBoxModel",
            &json!({ "backendNodeId": element.backend }),
        )?;
        let border: Vec<f64> = model
            .pointer("/model/border")
            .and_then(Value::as_array)
            .map(|all| all.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        if border.len() != 8 {
            return Err(Answer::error(
                Code::Failed,
                "the element is not on the page",
            ));
        }
        let map = self.frame_map(element)?;
        let (_, _, x, y) = self.viewport()?;
        let corners: Vec<(f64, f64)> = border
            .chunks(2)
            .map(|one| map.to_page((one[0], one[1])))
            .collect();
        let xs: Vec<f64> = corners.iter().map(|one| one.0).collect();
        let ys: Vec<f64> = corners.iter().map(|one| one.1).collect();
        let (left, right) = (
            xs.iter().copied().fold(f64::INFINITY, f64::min),
            xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        );
        let (top, bottom) = (
            ys.iter().copied().fold(f64::INFINITY, f64::min),
            ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        );
        Ok([left + x, top + y, right + x, bottom + y])
    }

    fn hidden_rects(&self) -> Result<Hidden, Answer> {
        let secrets: Vec<Secret> = self
            .secrets(self.every_part()?)
            .into_iter()
            .filter(|one| one.filled)
            .collect();
        if secrets.iter().any(|one| one.backend == UNREAD) {
            return Err(Answer::error(
                Code::Failed,
                "a part of this page's fields could not be read, so there is no picture of it",
            ));
        }
        if secrets.len() > MOST_PAINTED {
            return Err(Answer::error(
                Code::Failed,
                "this page has too many secret fields to hide in a picture, so there is none",
            ));
        }
        let mut drawn = Vec::with_capacity(secrets.len());
        let which = secrets
            .iter()
            .map(|one| (one.prefix.clone(), one.backend))
            .collect();
        for one in secrets {
            let Ok(element) = self.element(&format!("{}e{}", one.prefix, one.backend)) else {
                continue;
            };
            match self.page_rect(&element) {
                Ok(rect) => drawn.push(rect),
                Err(Answer::Error { message, .. }) if undrawn(&message) => {}
                Err(refused) => return Err(refused),
            }
        }
        drawn.extend(self.denied_frames()?);
        Ok((which, drawn))
    }

    fn nested_followed(&self) -> Result<(), Answer> {
        cdp::follow_nested(self.view, &self.label, FRAME_PATIENCE).map_err(|why| {
            Answer::error(
                Code::Failed,
                format!("a part of this page could not be reached, so there is no picture or print of it: {why}"),
            )
        })
    }

    /// The prefix of every part of the page: its own document, and each frame in a
    /// process of its own, at any depth.
    fn every_part(&self) -> Result<Vec<String>, Answer> {
        self.nested_followed()?;
        let mut prefixes = vec![String::new()];
        prefixes.extend(
            self.heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .frames()
                .into_iter()
                .map(|(number, _)| format!("f{number}")),
        );
        Ok(prefixes)
    }

    /// The page's accessibility tree, with its frames, as the parts `snapshot` writes.
    fn parts(&self) -> Result<Tree, Answer> {
        let started = Instant::now();
        let _ = self.nested_followed();
        let own = self.call("Accessibility.getFullAXTree", &json!({}))?;
        let mut parts = vec![Part {
            prefix: String::new(),
            nodes: nodes_of(&own),
            owner: None,
        }];
        let away: Vec<(usize, cdp::Frame)> = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .frames();
        let away_ids: HashSet<String> = away.iter().map(|(_, frame)| frame.id.clone()).collect();
        let mut whole = away.iter().all(|(_, frame)| frame.parent.is_empty());
        let away = away
            .into_iter()
            .filter(|(_, frame)| frame.parent.is_empty());

        // Frames in the page's own process: a tree each, under their frame element.
        let tree = self.call("Page.getFrameTree", &json!({}))?;
        let mut same = Vec::new();
        collect_frames(
            tree.get("frameTree").unwrap_or(&Value::Null),
            true,
            &mut same,
        );
        let mut places = HashMap::new();
        frame_places(
            tree.get("frameTree").unwrap_or(&Value::Null),
            &[],
            &mut places,
        );
        for frame in same.into_iter().filter(|one| !away_ids.contains(one)) {
            if !places.get(&frame).is_none_or(|at| self.may_read_frame(at)) {
                continue;
            }
            if started.elapsed() > MOST_ON_FRAMES {
                whole = false;
                break;
            }
            let Ok(nodes) = cdp::call_in(
                self.view,
                None,
                "Accessibility.getFullAXTree",
                &json!({ "frameId": frame }),
                FRAME_PATIENCE,
            ) else {
                whole = false;
                continue;
            };
            let owner = self.owner_in(&parts, &frame);
            parts.push(Part {
                prefix: String::new(),
                nodes: nodes_of(&nodes),
                owner,
            });
        }
        // Frames in processes of their own, through their sessions.
        for (number, frame) in away {
            if started.elapsed() > MOST_ON_FRAMES {
                whole = false;
                break;
            }
            let at = self.frame_address(&frame);
            if !self.may_read_frame(&at) {
                continue;
            }
            let Ok(nodes) = cdp::call_in(
                self.view,
                Some(&frame.session),
                "Accessibility.getFullAXTree",
                &json!({}),
                FRAME_PATIENCE,
            ) else {
                whole = false;
                continue;
            };
            let owner = self.owner_in(&parts, &frame.id);
            parts.push(Part {
                prefix: format!("f{number}"),
                nodes: nodes_of(&nodes),
                owner,
            });
        }
        let mut secret = self.secret_fields(&parts);
        if secret.contains(&(String::new(), UNREAD)) {
            return Err(Answer::error(
                Code::Failed,
                "this page's fields could not be read, so neither can it be",
            ));
        }
        parts.retain(|part| !secret.contains(&(part.prefix.clone(), UNREAD)));
        if !whole {
            secret.insert((LEFT_OUT.to_string(), UNREAD));
        }
        Ok((parts, secret))
    }

    fn denied_frames(&self) -> Result<Vec<[f64; 4]>, Answer> {
        if self.limits.is_none() {
            return Ok(Vec::new());
        }
        self.nested_followed()?;
        let mut frames: Vec<(String, Vec<String>)> = Vec::new();
        if let Ok(tree) = self.call("Page.getFrameTree", &json!({})) {
            let mut places = HashMap::new();
            frame_places(
                tree.get("frameTree").unwrap_or(&Value::Null),
                &[],
                &mut places,
            );
            frames.extend(places);
        }
        let away = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .frames();
        for (_, frame) in away {
            frames.push((frame.id.clone(), self.frame_address(&frame)));
        }
        let mut rects = Vec::new();
        for (id, _) in frames.iter().filter(|(_, at)| !self.may_read_frame(at)) {
            let holder = self.frame_holding(id)?;
            let params = json!({ "frameId": id });
            let owner = match &holder {
                Some(holder) => self.call_on(holder, "DOM.getFrameOwner", &params),
                None => self.call("DOM.getFrameOwner", &params),
            }?;
            let backend = owner
                .get("backendNodeId")
                .and_then(Value::as_u64)
                .ok_or_else(|| stale("the frame has no owner"))?;
            let (session, frame) = holder.map_or((None, None), |one| (one.session, one.frame));
            match self.page_rect(&Element {
                session,
                frame,
                backend,
            }) {
                Ok(rect) => rects.push(rect),
                Err(Answer::Error { message, .. }) if undrawn(&message) => {}
                Err(refused) => return Err(refused),
            }
        }
        Ok(rects)
    }

    fn frame_address(&self, frame: &cdp::Frame) -> Vec<String> {
        let world = self.world_in(Some(&frame.session)).ok();
        world
            .and_then(|world| {
                cdp::call_in(
                    self.view,
                    Some(&frame.session),
                    "Runtime.evaluate",
                    &json!({ "expression": "[location.href, ...Array.from(location.ancestorOrigins || [])]", "returnByValue": true, "contextId": world }),
                    FRAME_PATIENCE,
                )
                .ok()
            })
        .and_then(|said| serde_json::from_value(said.pointer("/result/value")?.clone()).ok())
        .unwrap_or_else(|| vec![frame.url.clone()])
    }

    /// The frame element a frame hangs under: the part holding it, and its node.
    fn owner_in(&self, parts: &[Part], frame: &str) -> Option<(usize, u64)> {
        let owner = self
            .call("DOM.getFrameOwner", &json!({ "frameId": frame }))
            .ok()?;
        let backend = owner.get("backendNodeId")?.as_u64()?;
        let part = parts.iter().position(|part| {
            part.prefix.is_empty()
                && part.nodes.iter().any(|node| {
                    node.get("backendDOMNodeId").and_then(Value::as_u64) == Some(backend)
                })
        })?;
        Some((part, backend))
    }

    /// Every secret field in the parts of the page, by part prefix and node, so that
    /// nothing of theirs is written whatever the tree says.
    fn secret_fields(&self, parts: &[Part]) -> HashSet<(String, u64)> {
        let prefixes: HashSet<String> = parts.iter().map(|part| part.prefix.clone()).collect();
        let (found, seen) = self.scanned(prefixes);
        found
            .into_iter()
            .map(|one| (one.prefix, one.backend))
            .chain(gone_fields(parts, &seen))
            .collect()
    }

    fn session_of_part(&self, prefix: &str) -> Option<String> {
        if prefix.is_empty() {
            return None;
        }
        let number = prefix.trim_start_matches('f').parse::<usize>().ok()?;
        self.heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .frame(number)
            .map(|frame| frame.session)
    }

    /// Every secret field (`policy::secret`: a password, a one-time code, a card) in the
    /// page's parts with these prefixes. The nodes are the engine's, so a shadow root, open
    /// or closed, and a frame sharing the process, of any origin, hide none of them from
    /// this; each describes itself and the policy judges.
    fn secrets(&self, prefixes: impl IntoIterator<Item = String>) -> Vec<Secret> {
        self.scanned(prefixes).0
    }

    fn scanned(
        &self,
        prefixes: impl IntoIterator<Item = String>,
    ) -> (Vec<Secret>, HashSet<(String, u64)>) {
        let started = Instant::now();
        let mut found = Vec::new();
        let mut seen = HashSet::new();
        for prefix in prefixes {
            let session = self.session_of_part(&prefix);
            let call = |method: &str, params: &Value| {
                cdp::call_in(
                    self.view,
                    session.as_deref(),
                    method,
                    params,
                    patience_in(session.as_deref()),
                )
            };
            let capture = if prefix_past_budget(&prefix, started) {
                None
            } else {
                self.capture(session.as_deref())
            };
            let Some(capture) = capture else {
                found.push(Secret {
                    prefix: prefix.clone(),
                    backend: UNREAD,
                    filled: true,
                });
                continue;
            };
            seen.extend(
                nodes_in_capture(&capture)
                    .into_iter()
                    .map(|backend| (prefix.clone(), backend)),
            );
            let fields = fields_in_capture(&capture, None);
            for (at, backend) in fields.into_iter().enumerate() {
                let said = (at < MOST_FIELDS_ASKED && started.elapsed() <= MOST_ON_FRAMES)
                    .then(|| self.handle_in_world(session.as_deref(), backend, SECRETS))
                    .flatten()
                    .and_then(|field| {
                        call(
                            "Runtime.callFunctionOn",
                            &json!({ "objectId": field, "functionDeclaration": DESCRIBED.as_str(), "returnByValue": true }),
                        )
                        .ok()
                    })
                    .and_then(|value| value.pointer("/result/value").cloned())
                    .filter(Value::is_object);
                let Some(said) = said else {
                    found.push(Secret {
                        prefix: prefix.clone(),
                        backend,
                        filled: true,
                    });
                    continue;
                };
                if serde_json::from_value::<Field>(said.clone())
                    .map_or(true, |field| policy::secret(&field))
                {
                    found.push(Secret {
                        prefix: prefix.clone(),
                        backend,
                        filled: said.get("filled").and_then(Value::as_bool) != Some(false),
                    });
                }
            }
            let _ = call(
                "Runtime.releaseObjectGroup",
                &json!({ "objectGroup": SECRETS }),
            );
        }
        (found, seen)
    }

    fn secret_regions(&self) -> Result<Vec<usize>, Answer> {
        let said = self.isolated(&REGIONS_SAID)?;
        let all = said.as_array().ok_or_else(|| {
            Answer::error(
                Code::Failed,
                "the page's fields could not be read, so neither can its words",
            )
        })?;
        Ok(all
            .iter()
            .enumerate()
            .filter(|(_, one)| one.get("filled").and_then(Value::as_bool) == Some(true))
            .filter(|(_, one)| {
                serde_json::from_value::<Field>((*one).clone())
                    .map_or(true, |field| policy::secret(&field))
            })
            .map(|(at, _)| at)
            .collect())
    }

    fn read_hiding(&self, reading: fn(&[usize]) -> String) -> Result<Value, Answer> {
        for _ in 0..2 {
            let hidden = self.secret_regions()?;
            let said = self.isolated(&reading(&hidden))?;
            if self.secret_regions()? == hidden {
                return Ok(said);
            }
        }
        Err(Answer::error(
            Code::Failed,
            "the page's fields keep changing, so its words cannot be read",
        ))
    }

    /// The page as text, as markdown, or its article as markdown. Markdown is the
    /// clipper's own converter's, asked of the window; without a window it is the text.
    fn read(
        &self,
        app: &tauri::AppHandle,
        shape: super::verbs::ReadAs,
    ) -> Result<(String, String, String), Answer> {
        use super::verbs::ReadAs;
        let said = self.read_hiding(match shape {
            ReadAs::Text => text_hiding,
            ReadAs::Markdown => whole_hiding,
            ReadAs::Article => clipped_hiding,
        })?;
        Ok(scripts::words(app, shape, &said))
    }

    /// What the page calls itself, read in nib's own world.
    fn title(&self) -> String {
        self.isolated("document.title")
            .ok()
            .and_then(|one| one.as_str().map(str::to_string))
            .unwrap_or_default()
    }

    /// The article as the clip button reads it, in nib's own world and unvalued:
    /// `(url, title, html)`. The window turns the HTML into the clip's markdown with the
    /// clipper's own converter, so a clip of an agent's tab and of the reader's are the
    /// same words.
    pub fn clip(&self) -> Result<(String, String, String), Answer> {
        let said = self.read_hiding(clipped_hiding)?;
        Ok((
            text(&said, "url"),
            text(&said, "title"),
            text(&said, "html"),
        ))
    }

    /// The page printed to a PDF, as base64: the engine's own print, laid out on the
    /// paper given.
    ///
    /// Refused while a filled secret field is anywhere on the page. A field prints as
    /// what it shows, and a password shows as one bullet a character, which says how
    /// long it is; a picture has such a field painted over (9.4), and a PDF is text and
    /// shapes that nothing here can paint over after the engine has laid them out. So
    /// the agent is told to take the picture instead, rather than handed a weaker print.
    pub fn pdf(&self, paper: &PdfPage) -> Result<String, Answer> {
        if !self.denied_frames()?.is_empty() {
            return Err(Answer::error(
                Code::SiteDenied,
                "a frame of a denied site is on the page, and a PDF would print it: capture a screenshot, which paints it over",
            ));
        }
        if !self.may_touch_credentials()
            && self
                .secrets(self.every_part()?)
                .iter()
                .any(|one| one.filled)
        {
            return Err(Answer::error(
                Code::PasswordField,
                "a filled secret field is on the page, and it would print as bullets that say how long it is: capture a screenshot, which paints it over",
            ));
        }
        let printed = self
            .call("Page.printToPDF", &printing(paper))
            .map_err(|refused| match refused {
                Answer::Error { message, .. } if unprintable(&message) => Answer::error(
                    Code::UnsupportedOnThisEngine,
                    format!("this engine does not print a page to a PDF: {message}"),
                ),
                other => other,
            })?;
        printed
            .get("data")
            .and_then(Value::as_str)
            .filter(|data| !data.is_empty())
            .map(str::to_string)
            .ok_or_else(|| Answer::error(Code::Failed, "the engine printed nothing"))
    }

    /// Waits for what the agent asked, stop and dialogs ending it early.
    fn wait(&self, until: &Until, most: Duration) -> Result<u64, Answer> {
        let started = Instant::now();
        loop {
            let done = match until {
                Until::Moment(Moment::Load) => self
                    .isolated("document.readyState")
                    .is_ok_and(|state| state.as_str() == Some("complete")),
                Until::Moment(Moment::NetworkIdle) => self
                    .heard()
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .idle_for(Duration::from_millis(500)),
                Until::Text { text } => {
                    self.isolated(&format!(
                        "(document.body ? document.body.innerText : '').includes({})",
                        json!(text)
                    ))
                    .is_ok_and(|found| found.as_bool() == Some(true))
                        && self
                            .secret_regions()
                            .and_then(|hidden| self.isolated(&text_hiding(&hidden)))
                            .is_ok_and(|said| self::text(&said, "text").contains(text.as_str()))
                }
                Until::Element { element } => self.element(element).is_ok_and(|element| {
                    self.call_on(
                        &element,
                        "DOM.getContentQuads",
                        &json!({ "backendNodeId": element.backend }),
                    )
                    .ok()
                    .and_then(|quads| {
                        quads
                            .get("quads")
                            .and_then(Value::as_array)
                            .map(|all| !all.is_empty())
                    }) == Some(true)
                }),
                Until::Url { url } => self.url().contains(url.as_str()),
            };
            let spent = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            if done {
                return Ok(spent);
            }
            if super::stop::cancelled(self.since) {
                return Err(Answer::error(Code::Stopped, "the reader pressed the stop"));
            }
            if super::quiet::dialog_of(&self.label).is_some() {
                return Err(Answer::error(
                    Code::Failed,
                    "the page is holding a dialog: answer it with browser_dialog",
                ));
            }
            if started.elapsed() >= most {
                let waiting = match until {
                    Until::Moment(Moment::NetworkIdle) => {
                        let open = self
                            .heard()
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .in_flight();
                        let open = still_in_flight(self.limits.as_ref(), open);
                        format!(": still in flight, {}", open.join(", "))
                    }
                    _ => String::new(),
                };
                return Err(Answer::error(
                    Code::Timeout,
                    format!("not in {} ms{waiting}", most.as_millis()),
                ));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// A script run in the page, in nib's world or the page's own, answering its value.
    fn evaluate(&self, expression: &str, page_world: bool) -> Result<Value, Answer> {
        if !page_world {
            return self.isolated(expression);
        }
        let answered = self.call(
            "Runtime.evaluate",
            &json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
        )?;
        thrown(&answered)?;
        Ok(answered
            .pointer("/result/value")
            .cloned()
            .unwrap_or_default())
    }

    /// Goes to an address, and waits for it to load, up to ten seconds.
    fn navigate(&self, url: &str) -> Result<(), Answer> {
        let loads = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .loads;
        let went = self.call("Page.navigate", &json!({ "url": url }))?;
        if let Some(error) = went
            .get("errorText")
            .and_then(Value::as_str)
            .filter(|one| !one.is_empty())
        {
            return Err(Answer::error(
                Code::Failed,
                format!("the page could not be reached: {error}"),
            ));
        }
        self.loaded_after(loads, Duration::from_secs(10));
        Ok(())
    }

    /// One step along the tab's history, or the same page again.
    fn step(&self, by: i64) -> Result<(), Answer> {
        let loads = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .loads;
        if by == 0 {
            self.call("Page.reload", &json!({}))?;
        } else {
            let history = self.call("Page.getNavigationHistory", &json!({}))?;
            let at = history
                .get("currentIndex")
                .and_then(Value::as_i64)
                .unwrap_or_default()
                + by;
            let found = history
                .get("entries")
                .and_then(Value::as_array)
                .and_then(|all| all.get(usize::try_from(at).ok()?))
                .ok_or_else(|| Answer::error(Code::BadArguments, "there is nowhere to step to"))?;
            if let (Some((grant, store)), Some(url)) =
                (&self.limits, found.get("url").and_then(Value::as_str))
            {
                policy::site_allowed(grant, url, *store)
                    .map_err(|why| Answer::error(Code::SiteDenied, why))?;
            }
            let entry = found
                .get("id")
                .cloned()
                .ok_or_else(|| Answer::error(Code::BadArguments, "there is nowhere to step to"))?;
            self.call("Page.navigateToHistoryEntry", &json!({ "entryId": entry }))?;
        }
        self.loaded_after(loads, Duration::from_secs(10));
        Ok(())
    }

    fn loaded_after(&self, loads: u64, most: Duration) {
        let started = Instant::now();
        while started.elapsed() < most && !self.interrupted() {
            if self
                .heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .loads
                > loads
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    /// The cookies the page's address would be sent.
    fn cookies(&self) -> Result<Vec<Cookie>, Answer> {
        let said = self.call("Network.getCookies", &json!({ "urls": [self.url()] }))?;
        Ok(said
            .get("cookies")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|one| Cookie {
                name: text(one, "name"),
                value: text(one, "value"),
                domain: Some(text(one, "domain")),
                path: Some(text(one, "path")),
                expires: one
                    .get("expires")
                    .and_then(Value::as_f64)
                    .filter(|at| *at > 0.0),
                http_only: one
                    .get("httpOnly")
                    .and_then(Value::as_bool)
                    .unwrap_or_default(),
                secure: one
                    .get("secure")
                    .and_then(Value::as_bool)
                    .unwrap_or_default(),
            })
            .collect())
    }

    /// Sets a cookie for the page's address, or a domain the page is on: a cookie for any
    /// other would plant it for a site the agent may not reach at all.
    fn set_cookie(&self, cookie: &Cookie) -> Result<(), Answer> {
        if let Some(domain) = &cookie.domain {
            if !policy::host_of(&self.url()).is_some_and(|host| cookie_fits(domain, &host)) {
                return Err(Answer::error(
                    Code::SiteDenied,
                    "a cookie here is for this page's own site",
                ));
            }
        }
        let mut params = json!({
            "name": cookie.name, "value": cookie.value, "path": cookie.path.clone().unwrap_or_else(|| "/".into()),
            "httpOnly": cookie.http_only, "secure": cookie.secure,
        });
        match &cookie.domain {
            Some(domain) => params["domain"] = json!(domain),
            None => params["url"] = json!(self.url()),
        }
        if let Some(expires) = cookie.expires {
            params["expires"] = json!(expires);
        }
        let said = self.call("Network.setCookie", &params)?;
        if said.get("success").and_then(Value::as_bool) == Some(false) {
            return Err(Answer::error(
                Code::Failed,
                "the engine refused that cookie",
            ));
        }
        Ok(())
    }

    /// Every cookie and bit of storage of the page's origin, gone.
    fn clear(&self) -> Result<(), Answer> {
        for cookie in self.cookies()? {
            let _ = self.call(
                "Network.deleteCookies",
                &json!({ "name": cookie.name, "domain": cookie.domain, "path": cookie.path }),
            );
        }
        let origin = tauri::Url::parse(&self.url())
            .map(|url| url.origin().ascii_serialization())
            .unwrap_or_default();
        self.call(
            "Storage.clearDataForOrigin",
            &json!({ "origin": origin, "storageTypes": "all" }),
        )?;
        Ok(())
    }

    /// The page's `localStorage`.
    fn local(&self) -> Result<serde_json::Map<String, Value>, Answer> {
        let said = self.isolated("(() => { const out = {}; for (let at = 0; at < localStorage.length; at++) { const key = localStorage.key(at); out[key] = localStorage.getItem(key) } return out })()")?;
        Ok(said.as_object().cloned().unwrap_or_default())
    }

    /// The elements that match, over every frame.
    fn find(&self, wanted: &snapshot::Wanted<'_>) -> Result<Vec<Match>, Answer> {
        let (parts, secret) = self.parts()?;
        Ok(snapshot::find(&parts, &secret, wanted))
    }
}

/// How many response bodies one `browser_network` reads, and how long each may be.
const BODIES: usize = 20;
const LONGEST_BODY: usize = 100_000;

/// The `DevTools` Protocol's road to every act (#1092): `WebView2`'s and Orden's own
/// Chromium's. Each act is the page's own method above.
impl Engine for Page<'_> {
    fn wake(&self) {
        cdp::awake(self.view, &self.label, self.own);
    }

    fn url(&self) -> String {
        Page::url(self)
    }

    fn title(&self) -> String {
        Page::title(self)
    }

    fn element(&self, reference: &str) -> Result<Element, Answer> {
        Page::element(self, reference)
    }

    fn element_at(&self, point: (f64, f64)) -> Result<Element, Answer> {
        Page::element_at(self, point)
    }

    fn facts(&self, element: &Element) -> Result<Facts, Answer> {
        Page::facts(self, element)
    }

    fn facts_of_press(&self, element: &Element) -> Result<Facts, Answer> {
        Page::facts_of_press(self, element)
    }

    fn at_first_point(&self, element: &Element) -> Result<Element, Answer> {
        Page::at_first_point(self, element)
    }

    fn aimed(&self, element: &Element) -> Result<Element, Answer> {
        Ok(Page::aim(self, element)?.on)
    }

    fn may_act_in(&self, facts: &Facts) -> Result<(), Answer> {
        self.frame_may_be_acted_in(facts)
    }

    fn limits_sites(&self) -> bool {
        self.grant_limits_sites()
    }

    fn tick_changes(&self, element: &Element, wanted: bool) -> Result<bool, Answer> {
        Page::tick_changes(self, element, wanted)
    }

    fn active_facts(&self) -> Result<Option<Facts>, Answer> {
        Page::active_facts(self)
    }

    fn navigate(&self, url: &str) -> Result<(), Answer> {
        Page::navigate(self, url)
    }

    fn step(&self, by: i64) -> Result<(), Answer> {
        Page::step(self, by)
    }

    fn wait(&self, until: &Until, most: Duration) -> Result<u64, Answer> {
        Page::wait(self, until, most)
    }

    fn settle(&self, navigations_before: u64) {
        Page::settle(self, navigations_before);
    }

    fn navigations(&self) -> u64 {
        Page::navigations(self)
    }

    fn opened(&self) -> Vec<String> {
        std::mem::take(
            &mut self
                .heard()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .opened,
        )
    }

    fn hosts(&self) -> Vec<String> {
        let heard = self.heard();
        let held = heard.lock().unwrap_or_else(PoisonError::into_inner);
        let (requests, _) = held.requests(None, None);
        let mut hosts: HashSet<String> = requests
            .iter()
            .filter_map(|(one, _)| policy::host_of(&one.url))
            .collect();
        for (_, frame) in held.frames() {
            if let Some(host) = policy::host_of(&frame.url) {
                hosts.insert(host);
            }
        }
        hosts.into_iter().collect()
    }

    fn parts(&self) -> Result<Tree, Answer> {
        Page::parts(self)
    }

    fn find(&self, wanted: &snapshot::Wanted<'_>) -> Result<Vec<Match>, Answer> {
        Page::find(self, wanted)
    }

    fn read(
        &self,
        app: &tauri::AppHandle,
        shape: ReadAs,
    ) -> Result<(String, String, String), Answer> {
        Page::read(self, app, shape)
    }

    fn clip(&self) -> Result<(String, String, String), Answer> {
        Page::clip(self)
    }

    fn pdf(&self, paper: &PdfPage) -> Result<String, Answer> {
        Page::pdf(self, paper)
    }

    fn click(
        &self,
        element: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer> {
        Page::click(self, element, button, count, modifiers, gate)
    }

    fn click_at(
        &self,
        point: (f64, f64),
        judged: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer> {
        Page::click_at(self, point, judged, button, count, modifiers, gate)
    }

    fn hover(&self, element: &Element) -> Result<(), Answer> {
        Page::hover(self, element)
    }

    fn type_text(&self, element: &Element, text: &str, replace: bool) -> Result<(), Answer> {
        Page::type_text(self, element, text, replace)
    }

    fn press(&self, key: &Key) -> Result<(), Answer> {
        Page::press(self, key)
    }

    fn press_in_page(&self, key: &Key) -> Result<(), Answer> {
        Page::press_in_page(self, key)
    }

    fn scroll(&self, element: Option<&Element>, dx: f64, dy: f64) -> Result<(), Answer> {
        Page::scroll(self, element, dx, dy)
    }

    fn select(&self, element: &Element, values: &[String]) -> Result<Vec<String>, Answer> {
        Page::select(self, element, values)
    }

    fn fill(&self, element: &Element, value: &FieldValue, gate: Gate<'_>) -> Result<(), Answer> {
        Page::fill(self, element, value, gate)
    }

    fn drag(
        &self,
        from: (&Element, &Element),
        to: (&Element, &Element),
        gates: (Gate<'_>, Gate<'_>),
    ) -> Result<(), Answer> {
        Page::drag(self, from, to, gates)
    }

    fn upload(&self, element: &Element, files: &[String], gate: Gate<'_>) -> Result<(), Answer> {
        Page::upload(self, element, files, gate)
    }

    fn screenshot(
        &self,
        element: Option<&Element>,
        full: bool,
        scale: Option<f64>,
    ) -> Result<Picture, Answer> {
        Page::screenshot(self, element, full, scale)
    }

    fn console(&self, since: Option<u64>, level: Option<&str>) -> Result<ConsoleLines, Answer> {
        cdp::listen_to_console(self.view, &self.label);
        let (lines, next) = self
            .heard()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .console(since, level);
        let lines = lines
            .into_iter()
            .filter(|(one, whence)| line_readable(self.limits.as_ref(), one, whence))
            .map(|(one, _)| one)
            .collect();
        Ok(ConsoleLines { lines, next })
    }

    fn network(
        &self,
        since: Option<u64>,
        matching: Option<&str>,
        bodies: bool,
    ) -> Result<Requests, Answer> {
        let heard = self.heard();
        let (requests, next) = heard
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .requests(since, matching);
        let mut requests: Vec<Request> = requests
            .into_iter()
            .filter(|(one, from)| request_readable(self.limits.as_ref(), one, from))
            .map(|(one, _)| one)
            .collect();
        if bodies {
            for row in requests.iter_mut().rev().take(BODIES) {
                let found = heard
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .request_id(row.seq);
                if let Some((session, id)) = found {
                    let session = (!session.is_empty()).then_some(session);
                    if let Ok(body) = cdp::call_in(
                        self.view,
                        session.as_deref(),
                        "Network.getResponseBody",
                        &json!({ "requestId": id }),
                        Duration::from_secs(5),
                    ) {
                        row.body = body
                            .get("body")
                            .and_then(Value::as_str)
                            .map(|text| cdp::cut(text.to_string(), LONGEST_BODY));
                    }
                }
            }
        }
        Ok(Requests { requests, next })
    }

    fn evaluate(&self, expression: &str, page_world: bool) -> Result<Value, Answer> {
        Page::evaluate(self, expression, page_world)
    }

    fn cookies(&self) -> Result<Vec<Cookie>, Answer> {
        Page::cookies(self)
    }

    fn set_cookie(&self, cookie: &Cookie) -> Result<(), Answer> {
        Page::set_cookie(self, cookie)
    }

    fn clear(&self) -> Result<(), Answer> {
        Page::clear(self)
    }

    fn local(&self) -> Result<serde_json::Map<String, Value>, Answer> {
        Page::local(self)
    }
}

/// Whether the engine's refusal of a print is that it has no printing at all, rather
/// than that this page could not be printed.
fn unprintable(said: &str) -> bool {
    let said = said.to_ascii_lowercase();
    said.contains("not implemented")
        || said.contains("not supported")
        || said.contains("wasn't found")
}

/// A coordinate as the whole number the protocol takes for a hit test.
#[allow(
    clippy::cast_possible_truncation,
    reason = "a point on a page is a few thousand pixels at most"
)]
fn whole(value: f64) -> i64 {
    value.round() as i64
}

/// The error an element that is gone answers with: take a snapshot again.
///
/// A node of a document the tab has since left is refused by `WebView2` itself, before the
/// protocol says anything, with the system's `E_INVALIDARG`: "The parameter is incorrect."
/// Every call this reads for names its element by that node, so that sentence is the
/// element being gone too (measured by scripts/mcp-probe.py: a ref of one page pressed
/// after the tab went to the next).
fn stale(why: &str) -> Answer {
    let gone = why.contains("No node")
        || why.contains("Could not find node")
        || why.contains("does not belong")
        || why.contains("No object")
        || why.contains("The parameter is incorrect");
    if gone {
        Answer::error(
            Code::NoSuchRef,
            "that element is gone: take a snapshot again",
        )
    } else {
        Answer::error(Code::Failed, why.to_string())
    }
}

/// The page's own exception, from an answer that threw.
fn thrown(answered: &Value) -> Result<(), Answer> {
    let Some(details) = answered.get("exceptionDetails") else {
        return Ok(());
    };
    let said = details
        .pointer("/exception/description")
        .and_then(Value::as_str)
        .or_else(|| details.get("text").and_then(Value::as_str))
        .unwrap_or("the script threw");
    Err(Answer::error(
        Code::Failed,
        cdp::cut(said.to_string(), 2_000),
    ))
}

fn frame_of_holder(node: &Value) -> Option<String> {
    let name = node.get("nodeName").and_then(Value::as_str)?;
    matches!(
        name.to_ascii_uppercase().as_str(),
        "IFRAME" | "FRAME" | "OBJECT" | "EMBED" | "FENCEDFRAME"
    )
    .then(|| node.get("frameId").and_then(Value::as_str))
    .flatten()
    .map(str::to_string)
}

fn control_in_tree(nodes: &[Value]) -> Option<String> {
    let by_id: HashMap<&str, &Value> = nodes
        .iter()
        .filter_map(|node| Some((node.get("nodeId")?.as_str()?, node)))
        .collect();
    let mut at = nodes.first();
    let mut steps = 0;
    while let Some(node) = at {
        let role = node
            .pointer("/role/value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let name = node
            .pointer("/name/value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if matches!(role, "button" | "link" | "menuitem") && !name.trim().is_empty() {
            return Some(name.to_string());
        }
        steps += 1;
        at = node
            .get("parentId")
            .and_then(Value::as_str)
            .and_then(|parent| by_id.get(parent).copied())
            .filter(|_| steps < 64);
    }
    None
}

fn undrawn(message: &str) -> bool {
    message.contains("Could not compute box model")
        || message.contains("is not on the page")
        || message.contains("gone")
}

fn painted_over(
    png: String,
    clip: (f64, f64, f64, f64),
    size: (u32, u32),
    rects: &[[f64; 4]],
) -> Result<String, Answer> {
    if rects.is_empty() {
        return Ok(png);
    }
    let (across, down) = (f64::from(size.0) / clip.2, f64::from(size.1) / clip.3);
    let rects: Vec<[f64; 4]> = rects
        .iter()
        .map(|[left, top, right, bottom]| {
            [
                (left - clip.0) * across,
                (top - clip.1) * down,
                (right - clip.0) * across,
                (bottom - clip.1) * down,
            ]
        })
        .collect();
    paint_over(&png, &rects).map_err(|why| {
        Answer::error(
            Code::Failed,
            format!("a secret field could not be hidden in the picture, so there is none: {why}"),
        )
    })
}

fn frames_under(tree: &Value, out: &mut Vec<String>) {
    if let Some(id) = tree.pointer("/frame/id").and_then(Value::as_str) {
        out.push(id.to_string());
    }
    for child in tree
        .get("childFrames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        frames_under(child, out);
    }
}

fn facts_read(said: &Value) -> Facts {
    let named = said.get("tag").and_then(Value::as_str).is_some();
    match serde_json::from_value::<Facts>(said.clone()) {
        Ok(mut facts) if named => {
            if let Some(line) = facts.held.iter().find(|line| policy::leads(line)) {
                facts.name = joined_name(&facts.name, line);
            }
            facts
        }
        _ => Facts {
            opaque: true,
            ..Facts::default()
        },
    }
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn nodes_of(tree: &Value) -> Vec<Value> {
    tree.get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn joined_name(read: &str, engine: &str) -> String {
    let (read, engine) = (read.trim(), engine.trim());
    if read.contains(engine) {
        read.to_string()
    } else if engine.contains(read) {
        engine.to_string()
    } else {
        format!("{read} {engine}")
    }
}

fn cookie_fits(domain: &str, host: &str) -> bool {
    let domain = domain
        .trim_start_matches('.')
        .trim_end_matches('.')
        .to_lowercase();
    let host = host.to_lowercase();
    let site = policy::site_of(&host);
    (domain == host || host.ends_with(&format!(".{domain}")))
        && (domain == site || domain.ends_with(&format!(".{site}")))
}

fn frame_places(tree: &Value, around: &[String], out: &mut HashMap<String, Vec<String>>) {
    let mut at = Vec::with_capacity(around.len() + 1);
    if let Some(url) = tree.pointer("/frame/url").and_then(Value::as_str) {
        at.push(url.to_string());
    }
    at.extend_from_slice(around);
    if let Some(id) = tree.pointer("/frame/id").and_then(Value::as_str) {
        out.insert(id.to_string(), at.clone());
    }
    for child in tree
        .get("childFrames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        frame_places(child, &at, out);
    }
}

fn nodes_in_capture(capture: &Value) -> Vec<u64> {
    capture
        .get("documents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|document| document.pointer("/nodes/backendNodeId")?.as_array())
        .flatten()
        .filter_map(Value::as_u64)
        .collect()
}

fn gone_fields(parts: &[Part], seen: &HashSet<(String, u64)>) -> Vec<(String, u64)> {
    parts
        .iter()
        .flat_map(|part| {
            let holders: HashSet<&str> = part
                .nodes
                .iter()
                .filter(|node| snapshot::holds_words(node))
                .filter_map(|node| node.get("nodeId")?.as_str())
                .collect();
            part.nodes
                .iter()
                .filter(|node| snapshot::holds_words(node))
                .filter(move |node| {
                    !node
                        .get("parentId")
                        .and_then(Value::as_str)
                        .is_some_and(|parent| holders.contains(parent))
                })
                .filter_map(|node| node.get("backendDOMNodeId").and_then(Value::as_u64))
                .map(|backend| (part.prefix.clone(), backend))
                .filter(|one| !seen.contains(one))
        })
        .collect()
}

fn fields_in_capture(capture: &Value, under: Option<u64>) -> Vec<u64> {
    let strings: Vec<&str> = capture
        .get("strings")
        .and_then(Value::as_array)
        .map(|all| {
            all.iter()
                .map(|one| one.as_str().unwrap_or_default())
                .collect()
        })
        .unwrap_or_default();
    let string = |at: Option<&Value>| {
        at.and_then(Value::as_u64)
            .and_then(|at| strings.get(usize::try_from(at).ok()?).copied())
            .unwrap_or_default()
    };
    let mut out = Vec::new();
    for document in capture
        .get("documents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(nodes) = document.get("nodes") else {
            continue;
        };
        let list = |key: &str| nodes.get(key).and_then(Value::as_array);
        let (Some(parents), Some(names), Some(backends)) =
            (list("parentIndex"), list("nodeName"), list("backendNodeId"))
        else {
            continue;
        };
        let mut roots: HashMap<u64, &str> = HashMap::new();
        if let Some(rare) = nodes.get("shadowRootType") {
            let at = rare.get("index").and_then(Value::as_array);
            let kind = rare.get("value").and_then(Value::as_array);
            for (at, kind) in at.into_iter().flatten().zip(kind.into_iter().flatten()) {
                if let Some(at) = at.as_u64() {
                    roots.insert(at, string(Some(kind)));
                }
            }
        }
        let empty = Vec::new();
        let attributes = list("attributes").unwrap_or(&empty);
        let mut seen: Vec<(bool, bool, bool)> = Vec::with_capacity(backends.len());
        for (at, backend) in backends.iter().enumerate() {
            let parent = parents
                .get(at)
                .and_then(Value::as_i64)
                .and_then(|one| usize::try_from(one).ok())
                .and_then(|one| seen.get(one).copied())
                .unwrap_or((false, false, false));
            let kind = roots.get(&(at as u64)).copied().unwrap_or_default();
            let backend = backend.as_u64().unwrap_or_default();
            let here = (
                parent.0 || kind == "closed",
                parent.1 || kind == "user-agent",
                parent.2 || under == Some(backend),
            );
            seen.push(here);
            if here.1 || (under.is_some() && !(here.0 && here.2)) {
                continue;
            }
            let said: Vec<&str> = attributes
                .get(at)
                .and_then(Value::as_array)
                .map(|all| all.iter().map(|one| string(Some(one))).collect())
                .unwrap_or_default();
            let name = local_name(string(names.get(at)));
            if (matches!(name.as_str(), "INPUT" | "TEXTAREA") && takes_words(&said))
                || edited(&name, &said)
            {
                out.push(backend);
            }
        }
    }
    out
}

fn local_name(name: &str) -> String {
    name.rsplit(':').next().unwrap_or(name).to_ascii_uppercase()
}

fn edited(name: &str, attributes: &[&str]) -> bool {
    attributes.chunks(2).any(|pair| {
        let value = pair.get(1).copied().unwrap_or_default();
        (pair[0].eq_ignore_ascii_case("contenteditable") && !value.eq_ignore_ascii_case("false"))
            || (pair[0] == "role" && value == "textbox" && !matches!(name, "INPUT" | "TEXTAREA"))
    })
}

fn takes_words(attributes: &[&str]) -> bool {
    let kind = attributes
        .chunks(2)
        .find(|pair| pair[0].eq_ignore_ascii_case("type"))
        .and_then(|pair| pair.get(1))
        .copied()
        .unwrap_or_default()
        .to_ascii_lowercase();
    !matches!(
        kind.as_str(),
        "hidden"
            | "submit"
            | "button"
            | "image"
            | "reset"
            | "checkbox"
            | "radio"
            | "file"
            | "range"
            | "color"
    )
}

/// Every frame under the page's own, by id.
fn collect_frames(tree: &Value, top: bool, out: &mut Vec<String>) {
    if !top {
        if let Some(id) = tree.pointer("/frame/id").and_then(Value::as_str) {
            out.push(id.to_string());
        }
    }
    for child in tree
        .get("childFrames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        collect_frames(child, false, out);
    }
}

/// A quad's area, to skip the empty ones an inline element has.
/// Where a quad (eight numbers, four corners) can be pressed: its middle, then half way
/// from the middle to each corner.
fn pressable(quad: &[f64]) -> Vec<(f64, f64)> {
    let corners: Vec<(f64, f64)> = quad
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[x, y]| (x, y))
        .collect();
    let middle = (
        corners.iter().map(|one| one.0).sum::<f64>() / 4.0,
        corners.iter().map(|one| one.1).sum::<f64>() / 4.0,
    );
    std::iter::once(middle)
        .chain(corners.iter().map(|corner| {
            (
                f64::midpoint(middle.0, corner.0),
                f64::midpoint(middle.1, corner.1),
            )
        }))
        .collect()
}

fn area(at: &[f64]) -> f64 {
    let mut twice = 0.0;
    for corner in 0..4 {
        let (x1, y1) = (at[corner * 2], at[corner * 2 + 1]);
        let next = (corner + 1) % 4;
        let (x2, y2) = (at[next * 2], at[next * 2 + 1]);
        twice += x1 * y2 - x2 * y1;
    }
    (twice / 2.0).abs()
}

/// Whether a scroll of the page may wheel at the viewport's middle under a call's
/// `limits`, by what is there (`None` when that cannot be told): not into a frame of a site
/// the agent may not act in (9.2), nor where that cannot be told; `false` scrolls the page
/// as a whole instead.
fn wheels(limits: Option<&(Grant, Store)>, under: Option<&Facts>) -> bool {
    !engines::limits_sites(limits)
        || under.is_some_and(|facts| engines::acts_in(limits, facts).is_ok())
}

/// The addresses of the requests still in flight that the agent may read, for a wait
/// that timed out on the network: the same rows `browser_network` shows.
fn still_in_flight(limits: Option<&(Grant, Store)>, rows: Vec<(Request, Whence)>) -> Vec<String> {
    rows.into_iter()
        .filter(|(one, from)| request_readable(limits, one, from))
        .map(|(one, _)| one.url)
        .collect()
}

/// Whether a console line is the agent's to read under a call's `limits`: one a frame of a
/// site it may not reach printed is that site's, whichever site its script came from, as is
/// one a script of such a site printed; one the engine did not place is nobody's.
fn line_readable(limits: Option<&(Grant, Store)>, line: &ConsoleLine, whence: &Whence) -> bool {
    match whence {
        Whence::Orden => true,
        Whence::Frame(at) => {
            engines::from_allowed(limits, at).is_ok()
                && line
                    .source
                    .as_ref()
                    .is_none_or(|url| engines::frame_readable(limits, std::slice::from_ref(url)))
        }
    }
}

/// Whether a request is the agent's to read under a call's `limits`: one to or from a site
/// it may not reach is that site's, and one from a frame the engine did not place is
/// nobody's.
fn request_readable(limits: Option<&(Grant, Store)>, row: &Request, from: &Whence) -> bool {
    engines::frame_readable(limits, std::slice::from_ref(&row.url))
        && match from {
            Whence::Orden => true,
            Whence::Frame(at) => engines::from_allowed(limits, at).is_ok(),
        }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::grants::SiteRule;

    /// An agent denied bank.example, in the reader's store.
    fn denying() -> (Grant, Store) {
        let mut grant = Grant::own("a".into(), "A");
        grant.sites.insert("bank.example".into(), SiteRule::Deny);
        (grant, Store::Reader)
    }

    fn frame(at: &[&str]) -> Whence {
        Whence::Frame(at.iter().map(|one| (*one).to_string()).collect())
    }

    /// RE-2: a line a denied frame printed stays out of `browser_console`, whichever site
    /// its script came from or none, and so does one the engine did not place.
    #[test]
    fn a_denied_frame_s_console_line_is_not_read_whatever_its_script() {
        let limits = denying();
        let line = |source: Option<&str>| ConsoleLine {
            seq: 1,
            level: "log".into(),
            text: "balance 1200".into(),
            source: source.map(str::to_string),
        };
        let bank = frame(&["https://bank.example"]);
        let shop = frame(&["https://shop.example"]);
        for source in [Some("https://cdn.example/app.js:3"), Some(":1"), None] {
            assert!(
                !line_readable(Some(&limits), &line(source), &bank),
                "{source:?}"
            );
            assert!(
                !line_readable(Some(&limits), &line(source), &frame(&[])),
                "{source:?}"
            );
            assert!(
                line_readable(Some(&limits), &line(source), &shop),
                "{source:?}"
            );
        }
        // A script of the denied site, in an allowed frame, is still that site's.
        let theirs = line(Some("https://bank.example/widget.js:9"));
        assert!(!line_readable(Some(&limits), &theirs, &shop));
        // Orden's own lines, and the reader's command line.
        assert!(line_readable(
            Some(&limits),
            &line(Some("nib")),
            &Whence::Orden
        ));
        assert!(line_readable(None, &line(None), &bank));
    }

    /// RE-3: a request a denied frame sent is out of `browser_network`, whichever host it
    /// went to, as is one to the denied site.
    #[test]
    fn a_denied_frame_s_request_is_not_read_whatever_its_host() {
        let limits = denying();
        let row = |url: &str| Request {
            seq: 1,
            method: "GET".into(),
            url: url.into(),
            status: Some(200),
            kind: "Fetch".into(),
            ms: None,
            failed: None,
            body: None,
        };
        let api = row("https://api.backend.example/accounts");
        assert!(!request_readable(
            Some(&limits),
            &api,
            &frame(&["https://bank.example/app"])
        ));
        assert!(!request_readable(
            Some(&limits),
            &api,
            &frame(&["about:blank", "https://bank.example/app"])
        ));
        assert!(!request_readable(Some(&limits), &api, &frame(&[])));
        assert!(request_readable(
            Some(&limits),
            &api,
            &frame(&["https://shop.example/"])
        ));
        assert!(!request_readable(
            Some(&limits),
            &row("https://bank.example/pixel"),
            &frame(&["https://shop.example/"])
        ));
        assert!(request_readable(
            None,
            &api,
            &frame(&["https://bank.example/"])
        ));
    }

    /// RE-4: a scroll by no ref wheels into a denied frame at the middle not at all, and
    /// scrolls the page as a whole where what is there cannot be told.
    #[test]
    fn a_scroll_by_no_ref_does_not_wheel_a_denied_frame() {
        let limits = denying();
        let facts = |at: &[&str]| Facts {
            at: at.iter().map(|one| (*one).to_string()).collect(),
            ..Facts::default()
        };
        // RF-3: a denied frame at the middle scrolls the page as a whole, not an error.
        assert!(!wheels(
            Some(&limits),
            Some(&facts(&["https://bank.example/"]))
        ));
        assert!(wheels(
            Some(&limits),
            Some(&facts(&["https://shop.example/"]))
        ));
        assert!(!wheels(Some(&limits), None));
        // No rule for any site: the wheel, as before.
        let open = (Grant::own("a".into(), "A"), Store::Reader);
        assert!(wheels(Some(&open), None));
        assert!(wheels(None, None));
    }

    /// RF-1: a wait that timed out on the network names only the requests the agent may
    /// read, not a denied frame's or one to a denied site.
    #[test]
    fn a_network_wait_names_only_the_requests_the_agent_may_read() {
        let limits = denying();
        let row = |url: &str| Request {
            seq: 1,
            method: "GET".into(),
            url: url.into(),
            status: None,
            kind: "Fetch".into(),
            ms: None,
            failed: None,
            body: None,
        };
        let rows = vec![
            (
                row("https://bank.example/stream?session=abc"),
                frame(&["https://shop.example/"]),
            ),
            (
                row("https://api.backend.example/accounts?acct=123"),
                frame(&["https://bank.example/app"]),
            ),
            (
                row("https://shop.example/poll"),
                frame(&["https://shop.example/"]),
            ),
        ];
        assert_eq!(
            still_in_flight(Some(&limits), rows.clone()),
            ["https://shop.example/poll"]
        );
        assert_eq!(still_in_flight(None, rows).len(), 3);
    }

    #[test]
    fn a_frame_inside_a_frame_maps_through_both() {
        let outer = FrameMap::of(
            &[10.0, 20.0, 210.0, 20.0, 210.0, 120.0, 10.0, 120.0],
            100.0,
            50.0,
        )
        .expect("drawn");
        let inner =
            FrameMap::of(&[5.0, 5.0, 25.0, 5.0, 25.0, 15.0, 5.0, 15.0], 20.0, 10.0).expect("drawn");
        let map = inner.within(outer);
        assert_eq!(map.to_page((1.0, 1.0)), (22.0, 32.0));
        assert_eq!(map.to_frame((22.0, 32.0)), Some((1.0, 1.0)));
    }

    #[test]
    fn a_frame_of_no_size_shows_nothing_and_one_in_perspective_is_shown() {
        let flat = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
        let line = [0.0, 0.0, 100.0, 0.0, 100.0, 0.0, 0.0, 0.0];
        let square = [0.0, 0.0, 100.0, 0.0, 100.0, 100.0, 0.0, 100.0];
        let tilted = [0.0, 0.0, 100.0, 10.0, 90.0, 80.0, 10.0, 100.0];
        assert!(FrameMap::nothing_drawn(&flat, 0.0, 0.0));
        assert!(FrameMap::nothing_drawn(&line, 100.0, 100.0));
        assert!(FrameMap::nothing_drawn(&square, 100.0, 0.0));
        assert!(FrameMap::nothing_drawn(&[], 100.0, 100.0));
        assert!(!FrameMap::nothing_drawn(&square, 100.0, 100.0));
        assert!(!FrameMap::nothing_drawn(&tilted, 100.0, 100.0));
    }

    #[test]
    fn a_field_gone_by_the_scan_is_a_secret_by_what_the_tree_says() {
        let field = |backend: u64, value: &str| json!({ "backendDOMNodeId": backend, "value": { "value": value } });
        let parts = [
            Part {
                prefix: String::new(),
                nodes: vec![
                    field(1, "4111111111111111"),
                    field(2, "seen"),
                    field(3, ""),
                    json!({ "backendDOMNodeId": 4 }),
                    json!({ "backendDOMNodeId": 5, "properties": [{ "name": "editable", "value": { "value": "plaintext" } }] }),
                    json!({ "nodeId": "6", "backendDOMNodeId": 6, "value": { "value": "seen" } }),
                    json!({ "parentId": "6", "backendDOMNodeId": 7, "properties": [{ "name": "editable", "value": { "value": "plaintext" } }] }),
                ],
                owner: None,
            },
            Part {
                prefix: "f1".into(),
                nodes: vec![field(2, "gone in this part")],
                owner: None,
            },
        ];
        let seen: HashSet<(String, u64)> = [(String::new(), 2), (String::new(), 6)]
            .into_iter()
            .collect();
        let gone = gone_fields(&parts, &seen);
        assert_eq!(
            gone,
            [
                (String::new(), 1),
                (String::new(), 5),
                ("f1".to_string(), 2),
            ]
        );
    }

    #[test]
    fn a_slider_gone_by_the_scan_is_no_secret() {
        let parts = [Part {
            prefix: String::new(),
            nodes: vec![
                json!({ "backendDOMNodeId": 1, "role": { "value": "slider" }, "value": { "value": "0:10" } }),
            ],
            owner: None,
        }];
        assert!(gone_fields(&parts, &HashSet::new()).is_empty());
    }

    #[test]
    fn a_capture_says_every_node_in_every_document() {
        let capture = json!({ "documents": [
            { "nodes": { "backendNodeId": [1, 2] } },
            { "nodes": { "backendNodeId": [3] } },
        ] });
        assert_eq!(nodes_in_capture(&capture), [1, 2, 3]);
    }

    #[test]
    fn a_press_tries_the_middle_and_then_each_quarter() {
        let points = pressable(&[0.0, 0.0, 100.0, 0.0, 100.0, 40.0, 0.0, 40.0]);
        assert_eq!(
            points,
            vec![
                (50.0, 20.0),
                (25.0, 10.0),
                (75.0, 10.0),
                (75.0, 30.0),
                (25.0, 30.0)
            ]
        );
    }

    #[test]
    fn an_empty_quad_is_no_place_to_press() {
        assert!((area(&[0.0, 0.0, 10.0, 0.0, 10.0, 5.0, 0.0, 5.0]) - 50.0).abs() < f64::EPSILON);
        assert!(area(&[3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0]) < 1.0);
    }

    #[test]
    fn a_print_is_on_the_readers_paper_with_no_line_of_the_browsers() {
        let a4 = PdfPage {
            width: 8.27,
            height: 11.69,
            margin: 0.787,
            landscape: false,
        };
        let asked = printing(&a4);
        assert_eq!(asked["paperWidth"], 8.27);
        assert_eq!(asked["paperHeight"], 11.69);
        assert_eq!(asked["marginLeft"], 0.787);
        assert_eq!(asked["landscape"], false);
        assert_eq!(asked["printBackground"], true);
        assert_eq!(asked["displayHeaderFooter"], false);
        assert_eq!(asked["transferMode"], "ReturnAsBase64");

        // Given upright and turned by the flag, as the reader's own export is.
        let turned = printing(&PdfPage {
            margin: -1.0,
            landscape: true,
            ..a4
        });
        assert_eq!(turned["paperWidth"], 8.27);
        assert_eq!(turned["landscape"], true);
        assert_eq!(turned["marginTop"], 0.0);

        assert!(unprintable("PrintToPDF is not implemented"));
        assert!(unprintable("'Page.printToPDF' wasn't found"));
        assert!(!unprintable("Printing failed"));
    }

    #[test]
    fn a_clip_is_the_clip_buttons_own_script_and_no_field_value() {
        let clipped = clipped_hiding(&[]);
        assert!(clipped.contains("input[type=password]"));
        assert!(clipped.contains("removeAttribute('value')"));
        assert!(!clipped.contains("__HIDE__"));
        assert!(whole_hiding(&[]).contains("unvalued(copy)"));
    }

    #[test]
    fn a_control_by_the_engine_alone_names_what_it_holds() {
        let nodes = [
            json!({ "nodeId": "3", "parentId": "2", "role": { "value": "StaticText" }, "name": { "value": "x" } }),
            json!({ "nodeId": "2", "parentId": "1", "role": { "value": "button" }, "name": { "value": "Pay now" } }),
            json!({ "nodeId": "9", "parentId": "1", "role": { "value": "button" }, "name": { "value": "A sibling" } }),
        ];
        assert_eq!(control_in_tree(&nodes).as_deref(), Some("Pay now"));
        assert_eq!(control_in_tree(&nodes[2..]).as_deref(), Some("A sibling"));
        let plain = [json!({ "nodeId": "3", "role": { "value": "generic" } })];
        assert_eq!(control_in_tree(&plain), None);
        let round = [json!({ "nodeId": "3", "parentId": "3", "role": { "value": "generic" } })];
        assert_eq!(control_in_tree(&round), None);
    }

    #[test]
    fn every_frame_of_a_tree_is_tried_the_top_one_first() {
        let tree = json!({
            "frame": { "id": "a" },
            "childFrames": [
                { "frame": { "id": "b" }, "childFrames": [{ "frame": { "id": "c" } }] },
                { "frame": { "id": "d" } },
            ],
        });
        let mut frames = Vec::new();
        frames_under(&tree, &mut frames);
        assert_eq!(frames, ["a", "b", "c", "d"]);
    }

    #[test]
    fn a_frames_size_with_its_bars_lands_where_the_quad_says() {
        let map = FrameMap::of(
            &[0.0, 0.0, 300.0, 0.0, 300.0, 200.0, 0.0, 200.0],
            300.0,
            200.0,
        )
        .expect("a straight quad");
        assert_eq!(map.to_page((200.0, 20.0)), (200.0, 20.0));
        assert_eq!(map.to_frame((200.0, 20.0)), Some((200.0, 20.0)));
    }

    #[test]
    fn only_what_holds_a_frame_holds_one() {
        let node = |name: &str| json!({ "nodeName": name, "frameId": "F" });
        for name in ["IFRAME", "OBJECT", "EMBED", "FRAME"] {
            assert_eq!(frame_of_holder(&node(name)).as_deref(), Some("F"), "{name}");
        }
        for name in ["HTML", "#document", "DIV"] {
            assert_eq!(frame_of_holder(&node(name)), None, "{name}");
        }
        assert_eq!(frame_of_holder(&json!({ "nodeName": "IFRAME" })), None);
    }

    #[test]
    fn a_frame_under_a_transform_is_mapped_by_its_quad() {
        let half = FrameMap::of(
            &[0.0, 0.0, 100.0, 0.0, 100.0, 50.0, 0.0, 50.0],
            200.0,
            100.0,
        )
        .expect("a straight quad");
        assert_eq!(half.to_frame((75.0, 25.0)), Some((150.0, 50.0)));
        assert_eq!(half.to_page((150.0, 50.0)), (75.0, 25.0));
        let moved = FrameMap::of(
            &[50.0, 0.0, 150.0, 0.0, 150.0, 50.0, 50.0, 50.0],
            200.0,
            100.0,
        )
        .expect("a straight quad");
        assert_eq!(moved.to_frame((75.0, 25.0)), Some((50.0, 50.0)));
        let turned = FrameMap::of(
            &[100.0, 0.0, 100.0, 200.0, 0.0, 200.0, 0.0, 0.0],
            200.0,
            100.0,
        )
        .expect("a straight quad");
        assert_eq!(turned.to_page((10.0, 20.0)), (80.0, 10.0));
        assert_eq!(turned.to_frame((80.0, 10.0)), Some((10.0, 20.0)));
        assert!(FrameMap::of(
            &[0.0, 0.0, 100.0, 10.0, 90.0, 50.0, 10.0, 40.0],
            200.0,
            100.0
        )
        .is_none());
        assert!(FrameMap::of(&[0.0; 8], 200.0, 100.0).is_none());
        assert!(FrameMap::of(&[], 200.0, 100.0).is_none());
        assert_eq!(FrameMap::same().to_page((3.0, 4.0)), (3.0, 4.0));
    }

    #[test]
    fn a_line_that_says_what_it_does_names_what_acts() {
        let read = facts_read(
            &json!({ "tag": "div", "name": "Order summary", "held": ["Order summary", "Pay now"] }),
        );
        assert_eq!(read.name, "Order summary Pay now");
        let plain = facts_read(
            &json!({ "tag": "div", "name": "Stripe", "held": ["Stripe", "Help center"] }),
        );
        assert_eq!(plain.name, "Stripe");
    }

    #[test]
    fn a_listener_for_a_press_is_told_from_any_other() {
        assert!(hears_a_press(
            &json!({ "listeners": [{ "type": "scroll" }, { "type": "click" }] })
        ));
        assert!(hears_a_press(
            &json!({ "listeners": [{ "type": "pointerdown" }] })
        ));
        assert!(!hears_a_press(
            &json!({ "listeners": [{ "type": "mousemove" }] })
        ));
        assert!(!hears_a_press(&json!({ "listeners": [] })));
        assert!(!hears_a_press(&json!({})));
    }

    #[test]
    fn an_editable_region_is_a_field_and_false_says_it_is_not() {
        assert!(edited("DIV", &["contenteditable", ""]));
        assert!(edited("DIV", &["id", "x", "contentEditable", "true"]));
        assert!(edited("DIV", &["contenteditable", "plaintext-only"]));
        assert!(!edited("DIV", &["contenteditable", "false"]));
        assert!(!edited("DIV", &["id", "contenteditable"]));
        assert!(!edited("DIV", &[]));
        assert!(edited("DIV", &["role", "textbox", "aria-label", "PIN"]));
        assert!(!edited("INPUT", &["role", "textbox"]));
        assert_eq!(local_name("input"), "INPUT");
        assert_eq!(local_name("html:input"), "INPUT");
    }

    #[test]
    fn a_read_of_a_page_with_no_secret_region_is_the_plain_read() {
        assert_eq!(text_hiding(&[]), TEXT);
        assert!(text_hiding(&[2]).contains("const hidden = [2]"));
        assert!(whole_hiding(&[2]).contains("const hidden = [2]"));
        assert!(clipped_hiding(&[2]).contains("const hidden = [2]"));
        assert!(MASKED_TEXT.contains("[hidden]") && MASKED_CLONE.contains("[hidden]"));
        assert!(MASKED_TEXT.contains(REGIONS) && MASKED_CLONE.contains(REGIONS));
    }

    #[test]
    fn what_cannot_be_read_of_a_press_is_never_nothing() {
        assert!(facts_read(&json!({})).opaque);
        assert!(facts_read(&Value::Null).opaque);
        assert!(facts_read(&json!({ "tag": 3 })).opaque);
        let read = facts_read(&json!({ "tag": "button", "name": "OK" }));
        assert!(!read.opaque);
        assert_eq!(read.name, "OK");
    }

    #[test]
    fn a_controls_name_is_what_the_page_and_the_engine_call_it() {
        assert_eq!(joined_name("", "Pay now"), "Pay now");
        assert_eq!(joined_name("Pay now", ""), "Pay now");
        assert_eq!(joined_name("Pay now", "Pay now"), "Pay now");
        assert_eq!(joined_name("OK", "OK Pay now"), "OK Pay now");
        assert_eq!(joined_name("Continue", "Pay now"), "Continue Pay now");
    }

    #[test]
    fn a_cookie_is_for_the_pages_own_site() {
        assert!(cookie_fits("shop.example", "www.shop.example"));
        assert!(cookie_fits(".shop.example", "www.shop.example"));
        assert!(cookie_fits("www.shop.example", "www.shop.example"));
        assert!(!cookie_fits("denied.example", "www.shop.example"));
        assert!(!cookie_fits("example", "www.shop.example"));
        assert!(!cookie_fits("github.io", "shop.github.io"));
        assert!(!cookie_fits("op.example", "shop.example"));
    }

    fn captured(nodes: &[(i64, &str, u64, &[&str])], roots: &[(u64, &str)]) -> Value {
        let mut strings: Vec<String> = Vec::new();
        let mut index = |word: &str| {
            let at = strings
                .iter()
                .position(|one| one == word)
                .unwrap_or_else(|| {
                    strings.push(word.to_string());
                    strings.len() - 1
                });
            json!(at)
        };
        let names: Vec<Value> = nodes.iter().map(|one| index(one.1)).collect();
        let attributes: Vec<Vec<Value>> = nodes
            .iter()
            .map(|one| one.3.iter().map(|word| index(word)).collect())
            .collect();
        let kinds: Vec<Value> = roots.iter().map(|one| index(one.1)).collect();
        json!({
            "strings": strings,
            "documents": [{ "nodes": {
                "parentIndex": nodes.iter().map(|one| one.0).collect::<Vec<_>>(),
                "nodeName": names,
                "backendNodeId": nodes.iter().map(|one| one.2).collect::<Vec<_>>(),
                "attributes": attributes,
                "shadowRootType": {
                    "index": roots.iter().map(|one| one.0).collect::<Vec<_>>(),
                    "value": kinds,
                },
            } }],
        })
    }

    #[test]
    fn every_field_is_found_through_roots_and_frames() {
        let capture = captured(
            &[
                (-1, "#document", 100, &[]),
                (0, "INPUT", 1, &["type", "text"]),
                (0, "INPUT", 2, &["type", "hidden"]),
                (0, "X-CARD", 101, &[]),
                (3, "#document-fragment", 102, &[]),
                (4, "INPUT", 3, &["type", "text"]),
                (0, "X-PW", 103, &[]),
                (6, "#document-fragment", 104, &[]),
                (7, "INPUT", 4, &["type", "password"]),
                (0, "INPUT", 5, &[]),
                (9, "#document-fragment", 105, &[]),
                (10, "INPUT", 6, &["type", "text"]),
                (0, "input", 7, &[]),
            ],
            &[(4, "open"), (7, "closed"), (10, "user-agent")],
        );
        assert_eq!(fields_in_capture(&capture, None), [1, 3, 4, 5, 7]);
        assert_eq!(fields_in_capture(&capture, Some(100)), [4]);
        assert_eq!(fields_in_capture(&capture, Some(101)), Vec::<u64>::new());
    }

    #[test]
    fn a_field_a_thousand_levels_down_is_found() {
        let mut nodes: Vec<(i64, &str, u64, &[&str])> = vec![(-1, "#document", 5000, &[])];
        for level in 0..1000u64 {
            nodes.push((
                i64::try_from(level).expect("small"),
                "DIV",
                6000 + level,
                &[],
            ));
        }
        nodes.push((1000, "INPUT", 7, &["autocomplete", "cc-number"]));
        let capture = captured(&nodes, &[]);
        let text = serde_json::to_string(&capture).expect("written");
        let read: Value =
            serde_json::from_str(&text).expect("a flat reply is within the parser's limit");
        assert_eq!(fields_in_capture(&read, None), [7]);
    }

    #[test]
    fn a_frame_with_no_address_of_its_own_is_where_it_sits() {
        let tree = json!({ "frame": { "id": "top", "url": "https://a.example/" }, "childFrames": [
            { "frame": { "id": "denied", "url": "https://denied.example/" }, "childFrames": [
                { "frame": { "id": "blank", "url": "about:blank" } },
            ] },
        ] });
        let mut places = HashMap::new();
        frame_places(&tree, &[], &mut places);
        assert_eq!(
            places["blank"],
            [
                "about:blank",
                "https://denied.example/",
                "https://a.example/"
            ]
        );
    }

    #[test]
    fn frames_are_every_one_under_the_page() {
        let tree = json!({ "frame": { "id": "top" }, "childFrames": [
            { "frame": { "id": "a" }, "childFrames": [{ "frame": { "id": "b" } }] },
            { "frame": { "id": "c" } },
        ]});
        let mut out = Vec::new();
        collect_frames(&tree, true, &mut out);
        assert_eq!(out, ["a", "b", "c"]);
    }

    #[test]
    fn a_gone_element_says_to_look_again() {
        assert!(matches!(
            stale("No node with given id found"),
            Answer::Error {
                code: Code::NoSuchRef,
                ..
            }
        ));
        assert!(matches!(
            stale("The parameter is incorrect."),
            Answer::Error {
                code: Code::NoSuchRef,
                ..
            }
        ));
        assert!(matches!(
            stale("Target closed"),
            Answer::Error {
                code: Code::Failed,
                ..
            }
        ));
    }
}
