//! What every engine runs in an agent's page, and what it makes of the answers
//! (docs/agent-native.md 5.2, 9.4): the scripts that read a field, an element and its
//! form, the page's words and its markup, and the painting over of a secret field in a
//! picture. One copy, so the `DevTools` Protocol's road (`page.rs`) and `WKWebView`'s
//! (`engines/webkit.rs`) read a page the same way and refuse the same things (#1092).

use std::sync::LazyLock;
use std::time::Duration;

use base64::Engine as _;
use serde_json::Value;

use super::verbs::ReadAs;

/// Whether what a press lands on (`this`) is the element meant (`target`): it, inside it,
/// round it, its label, or a frame it may be in. Across shadow roots, which `contains`
/// stops at: a button inside a web component is pressed through its host.
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "WKWebView's presses and keys are built in #1092's next step"
    )
)]
pub(super) const INSIDE: &str = "function (target) { const up = (one) => one.parentNode || (one instanceof ShadowRoot ? one.host : null); const holds = (outer, inner) => { for (let one = inner; one; one = up(one)) if (one === outer) return true; return false }; const el = this.nodeType === 1 ? this : this.parentElement; if (!el) return true; if (holds(target, el) || holds(el, target)) return true; const label = el.closest('label'); if (label && (label.control === target || holds(label, target))) return true; return el.tagName === 'IFRAME' || el.tagName === 'FRAME' }";

/// How the page's scripts read a field, as the policy's `Field` has it: shared by `FACTS`
/// and the secret scan, so the two never read one field two ways. Reports what the page
/// says - type, `autocomplete`, words, whether its style masks it, whether a message box
/// @-mentions somebody - and leaves every judgement to `policy`.
pub(super) const FIELDS: &str = r"
  const text = (one) => String(one || '').replace(/\s+/g, ' ').trim()
  const labelOf = (field) => {
    const parts = [field.getAttribute('aria-label')]
    if (field.labels) for (const one of field.labels) parts.push(one.innerText)
    const by = field.getAttribute('aria-labelledby')
    if (by) for (const id of by.split(/\s+/)) {
      const named = field.ownerDocument.getElementById(id)
      if (named) parts.push(named.innerText)
    }
    return text(parts.filter(Boolean).join(' '))
  }
  const describe = (one) => {
    const tag = one.tagName.toLowerCase()
    const role = String(one.getAttribute('role') || '').toLowerCase()
    const box = tag === 'textarea' || (!!one.isContentEditable && tag !== 'input')
    let type = tag === 'input' ? String(one.type || 'text').toLowerCase() : tag === 'textarea' ? 'textarea' : box ? 'editable' : tag
    if (role === 'searchbox' || (box && role === 'combobox')) type = 'search'
    const label = labelOf(one) || text(one.getAttribute('placeholder'))
    let masked = false
    try {
      const style = one.ownerDocument.defaultView.getComputedStyle(one)
      masked = type !== 'password' && String(style.webkitTextSecurity || 'none') !== 'none'
    } catch (_) {}
    const words = box ? String(tag === 'textarea' ? one.value : one.innerText || '').slice(0, 5000) : ''
    return {
      type,
      autocomplete: String(one.getAttribute('autocomplete') || '').toLowerCase(),
      said: text([one.name, one.id, one.getAttribute('placeholder'), labelOf(one)].filter(Boolean).join(' ')).slice(0, 200),
      label: label.slice(0, 200),
      masked,
      mentions: /(^|\s)@[\p{L}\p{N}_.-]{2,}/u.test(words),
    }
  }
";

/// What a page's element says about itself and its form, for the policy and for what
/// may be done to it. Run with the element as `this`.
pub(super) const FACTS_BODY: &str = r"
  let el = this.nodeType === 1 ? this : this.parentElement
  if (!el) return {}
  // A part of a field the engine draws itself (a date's picker button) is that field.
  const root = el.getRootNode && el.getRootNode()
  if (root && root.host && ['INPUT', 'SELECT', 'TEXTAREA'].includes(root.host.tagName)) el = root.host
  const tag = el.tagName.toLowerCase()
  const kind = tag === 'input' ? String(el.type || 'text').toLowerCase() : ''
  const pressed = el.closest('button, a, [role=button], [role=link], [role=menuitem], input[type=submit], input[type=button], input[type=image], summary') || el
  const name = text(labelOf(pressed) || pressed.innerText || (pressed.tagName === 'INPUT' ? pressed.value : '') || pressed.getAttribute('title') || pressed.getAttribute('alt')).slice(0, 200)
  const form = el.form || el.closest('form')
  const buttonType = pressed.tagName === 'BUTTON' ? String(pressed.getAttribute('type') || 'submit').toLowerCase() : ''
  const submit = !!form && ((pressed.tagName === 'BUTTON' && buttonType === 'submit') || (pressed.tagName === 'INPUT' && ['submit', 'image'].includes(String(pressed.type).toLowerCase())))
  const link = pressed.tagName === 'A' && !/^\s*(#|javascript:|$)/i.test(String(pressed.getAttribute('href') || ''))
  const editable = !!(el.isContentEditable || tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'submit', 'button', 'image', 'file', 'reset', 'hidden', 'range', 'color'].includes(kind)))
  // The form's fields, or the page's when it is in none: a webmail's Send and a chat
  // widget's are in no form, and their message box is an editable region.
  const fields = []
  for (const one of (form || el.ownerDocument).querySelectorAll('input, select, textarea, [contenteditable]:not([contenteditable=false])')) {
    if (fields.length >= 200) break
    fields.push(describe(one))
  }
  return { tag, type: kind, name, autocomplete: String(el.getAttribute('autocomplete') || '').toLowerCase(), submit, link, editable, in_form: !!form, fields, field: describe(el) }
";

/// `FACTS_BODY` with `FIELDS` in front of it, as the function the protocol runs.
pub(super) static FACTS: LazyLock<String> =
    LazyLock::new(|| ["function () {", FIELDS, FACTS_BODY, "}"].concat());

/// Every field words can be typed into, over the page and its frames of the same origin:
/// the array the secret scan reads, one element at a time.
pub(super) const TYPED_INTO: &str = r"(() => {
  const all = []
  const walk = (doc) => {
    for (const one of doc.querySelectorAll('input, textarea')) all.push(one)
    for (const frame of doc.querySelectorAll('iframe, frame')) { try { if (frame.contentDocument) walk(frame.contentDocument) } catch (_) {} }
  }
  walk(document)
  return all
})()";

/// Each of `TYPED_INTO`'s fields described, in its order, and whether it holds anything.
pub(super) static DESCRIBED: LazyLock<String> = LazyLock::new(|| {
    [
        "function () {",
        FIELDS,
        "return this.map((one) => Object.assign(describe(one), { filled: String(one.value || '') !== '' })) }",
    ]
    .concat()
});

/// The grey a filled secret field is painted in a picture of the page.
const PAINTED: [u8; 3] = [128, 128, 128];

/// The element that has the keyboard, into frames of the same origin.
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "WKWebView's presses and keys are built in #1092's next step"
    )
)]
pub(super) const ACTIVE: &str = r"(() => {
  let at = document.activeElement
  try { while (at && at.contentDocument && at.contentDocument.activeElement) at = at.contentDocument.activeElement } catch (_) {}
  return at
})()";

/// A key in a reader's page as the page's own events, and its default done the page's
/// way; answers `type` when the key's text is still to be inserted.
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "WKWebView's presses and keys are built in #1092's next step"
    )
)]
pub(super) const IN_PAGE_KEY: &str = r"function (key, code, modifiers) {
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

/// The page as the reader reads it, for `browser_read` as text.
pub(super) const TEXT: &str = r"(() => ({ url: location.href, title: document.title, text: document.body ? document.body.innerText : '' }))()";

/// What no field carries into the markup an agent reads (9.4): a password field is
/// dropped and every other field's `value` too, so a page that writes a secret into the
/// markup (a prefilled password, a card number) has nothing read back whatever the
/// converter makes of a field. Words typed into a field are never in markup at all,
/// which writes attributes, not a field's live value; nor in `innerText`, the text
/// shape. The clip's reader (`web_tabs/reader.js`) holds its snapshot to the same rule.
pub(super) const UNVALUED: &str = r"const unvalued = (root) => {
  for (const one of root.querySelectorAll('input[type=password]')) one.remove()
  for (const one of root.querySelectorAll('input[value]')) one.removeAttribute('value')
  return root
}";

/// The whole page's HTML with its links made absolute and its scripts left out, for
/// `browser_read` as markdown, unvalued.
pub(super) static WHOLE: LazyLock<String> = LazyLock::new(|| {
    [
        "(() => {\n",
        UNVALUED,
        r"
  const copy = unvalued(document.body ? document.body.cloneNode(true) : document.createElement('body'))
  for (const one of copy.querySelectorAll('script, style, noscript, template, svg, canvas, iframe')) one.remove()
  for (const one of copy.querySelectorAll('[href]')) { try { one.setAttribute('href', one.href) } catch (_) { one.removeAttribute('href') } }
  for (const one of copy.querySelectorAll('[src]')) { try { one.setAttribute('src', one.src) } catch (_) { one.removeAttribute('src') } }
  return { url: location.href, title: document.title, html: copy.innerHTML.slice(0, 4000000), text: document.body ? document.body.innerText : '' }
})()",
    ]
    .concat()
});

/// The article as the clip button reads it - the very script, `web_tabs::reader`, which
/// leaves out every field's value by the same rule as `UNVALUED` - for `browser_read` as
/// an article and for a clip, which are the same words. It answers a snapshot of the
/// document; the window finds the article in it with the clipper's own extractor (see
/// packages/markdown/src/article.ts `readSnapshot`), on the way to the markdown.
pub(super) static CLIPPED: LazyLock<String> = LazyLock::new(|| crate::web_tabs::reader(false));

/// A PNG's size, read from its header.
pub(super) fn png_size(base64: &str) -> Option<(u32, u32)> {
    let head = base64.get(..44)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(head)
        .ok()?;
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
    Some((width, height))
}

/// A PNG, base64, with rectangles in its own pixels - left, top, right, bottom - painted
/// flat grey.
pub(super) fn paint_over(png: &str, rects: &[[f64; 4]]) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png)
        .map_err(|why| why.to_string())?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().map_err(|why| why.to_string())?;
    let mut pixels = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("the picture is too big")?
    ];
    let info = reader
        .next_frame(&mut pixels)
        .map_err(|why| why.to_string())?;
    let channels = match (info.color_type, info.bit_depth) {
        (png::ColorType::Rgba, png::BitDepth::Eight) => 4,
        (png::ColorType::Rgb, png::BitDepth::Eight) => 3,
        other => return Err(format!("a picture of {other:?}")),
    };
    for &[left, top, right, bottom] in rects {
        let (x0, x1) = (pixel(left, info.width), pixel(right.ceil(), info.width));
        let (y0, y1) = (pixel(top, info.height), pixel(bottom.ceil(), info.height));
        for row in y0..y1 {
            for column in x0..x1 {
                let at = row * info.line_size + column * channels;
                pixels[at..at + 3].copy_from_slice(&PAINTED);
                if channels == 4 {
                    pixels[at + 3] = u8::MAX;
                }
            }
        }
    }
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, info.width, info.height);
    encoder.set_color(info.color_type);
    encoder.set_depth(info.bit_depth);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|why| why.to_string())?;
    writer
        .write_image_data(&pixels[..info.buffer_size()])
        .map_err(|why| why.to_string())?;
    writer.finish().map_err(|why| why.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

/// A coordinate as a pixel index, held inside a picture `most` pixels across.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to the picture first, which is a few thousand pixels at most"
)]
fn pixel(value: f64, most: u32) -> usize {
    value.floor().clamp(0.0, f64::from(most)) as usize
}

/// Markup's words, for a page the window could not convert.
fn strip_tags(html: &str) -> String {
    // A script's or a style's insides are not words on the page.
    let mut kept = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find('<') {
        kept.push_str(&rest[..at]);
        rest = &rest[at..];
        let lower = rest.get(..8).unwrap_or(rest).to_ascii_lowercase();
        let closing = if lower.starts_with("<script") {
            Some("</script>")
        } else if lower.starts_with("<style") {
            Some("</style>")
        } else {
            None
        };
        let past = closing.and_then(|end| {
            rest.to_ascii_lowercase()
                .find(end)
                .map(|found| found + end.len())
        });
        if let Some(past) = past {
            rest = &rest[past..];
        } else {
            let end = rest.find('>').map_or(rest.len(), |found| found + 1);
            kept.push(' ');
            rest = &rest[end..];
        }
    }
    kept.push_str(rest);
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A `<select>`'s options chosen through the page, never by opening its list (6.5): by
/// value, by label, by label in any case. Run with the `<select>` as `this`; answers the
/// values chosen, or why not.
pub(super) const SELECT: &str = r"function (values) {
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
}";

/// A value set through the page, with the events a person's choice raises: for the
/// fields whose own picker is a window (a date, a time, a colour). Run with the field as
/// `this`; answers the value it took.
pub(super) const SET_VALUE: &str = "function (value) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value').set; setter.call(this, value); this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); return this.value }";

/// Everything in a field selected, so words typed replace it.
pub(super) const CARET_ALL: &str = "function () { if (this.select) { this.select() } else { const range = document.createRange(); range.selectNodeContents(this); const now = getSelection(); now.removeAllRanges(); now.addRange(range) } }";

/// The caret at the end of a field, so words typed go after what is there.
pub(super) const CARET_END: &str = "function () { try { if (this.setSelectionRange) { const end = String(this.value || '').length; this.setSelectionRange(end, end) } } catch (_) {} }";

/// The page as `browser_read` answers it, from what `TEXT`, `WHOLE` or `CLIPPED`
/// answered: `(url, title, words)`. Markdown is the clipper's own converter's, asked of
/// the window; without a window it is the text.
pub(super) fn words(
    app: &tauri::AppHandle,
    shape: ReadAs,
    said: &Value,
) -> (String, String, String) {
    let text_at = |key: &str| {
        said.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let (url, title) = (text_at("url"), text_at("title"));
    if shape == ReadAs::Text {
        return (url, title, text_at("text"));
    }
    let html = text_at("html");
    let markdown = crate::endpoint::ask(
        app,
        super::verbs::window::MARKDOWN,
        serde_json::to_value(super::verbs::window::Convert {
            html: html.clone(),
            url: url.clone(),
        })
        .unwrap_or_default(),
        Duration::from_secs(5),
    )
    .ok()
    .and_then(|value| value.as_str().map(str::to_string));
    let words = markdown.unwrap_or_else(|| {
        let text = text_at("text");
        if text.is_empty() {
            strip_tags(&html)
        } else {
            text
        }
    });
    (url, title, words)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pngs_size_is_in_its_header() {
        // A 1 by 1 PNG.
        let one = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        assert_eq!(png_size(one), Some((1, 1)));
        assert_eq!(png_size("nope"), None);
    }

    #[test]
    fn a_secret_is_painted_over_and_nothing_else_moves() {
        // A 4 by 2 picture, every pixel white, and a field over its middle two columns.
        let mut raw = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut raw, 4, 2);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("a header");
            writer.write_image_data(&[255; 32]).expect("the pixels");
            writer.finish().expect("a picture");
        }
        let white = base64::engine::general_purpose::STANDARD.encode(raw);
        let painted = paint_over(&white, &[[1.2, -5.0, 2.5, 9.0]]).expect("painted");
        assert_eq!(png_size(&painted), Some((4, 2)));
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(painted)
            .expect("base64");
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .expect("a png");
        let mut pixels = vec![0; reader.output_buffer_size().expect("a size")];
        reader.next_frame(&mut pixels).expect("a frame");
        let grey = [128, 128, 128, 255];
        let white = [255; 4];
        for row in 0..2 {
            let at = |column: usize| &pixels[(row * 4 + column) * 4..(row * 4 + column + 1) * 4];
            assert_eq!(at(0), white);
            assert_eq!(at(1), grey);
            assert_eq!(at(2), grey);
            assert_eq!(at(3), white);
        }
        assert!(paint_over("not a picture", &[]).is_err());
    }

    #[test]
    fn a_clip_is_the_clip_buttons_own_script_and_no_field_value() {
        assert_eq!(*CLIPPED, crate::web_tabs::reader(false));
        assert!(CLIPPED.contains("input[type=password]"));
        assert!(CLIPPED.contains("removeAttribute('value')"));
        assert!(WHOLE.contains("unvalued(document.body"));
    }

    #[test]
    fn markup_s_words_leave_out_scripts_and_styles() {
        assert_eq!(strip_tags("<p>a <b>b</b></p>"), "a b");
        assert_eq!(
            strip_tags("<p>words</p><script>let x = 1</script><STYLE>p{}</STYLE> more"),
            "words more"
        );
    }
}
