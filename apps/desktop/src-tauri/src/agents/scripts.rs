use std::time::Duration;

use base64::Engine as _;
use serde_json::Value;

use super::verbs::ReadAs;

const PAINTED: [u8; 3] = [128, 128, 128];

pub(super) fn png_size(base64: &str) -> Option<(u32, u32)> {
    let head = base64.get(..44)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(head)
        .ok()?;
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
    Some((width, height))
}

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

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to the picture first, which is a few thousand pixels at most"
)]
fn pixel(value: f64, most: u32) -> usize {
    value.floor().clamp(0.0, f64::from(most)) as usize
}

fn strip_tags(html: &str) -> String {
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

pub(super) const CARET_ALL: &str = "function () { if (this.select) { this.select() } else { const range = document.createRange(); range.selectNodeContents(this); const now = getSelection(); now.removeAllRanges(); now.addRange(range) } }";

pub(super) const CARET_END: &str = "function () { try { if (this.setSelectionRange) { const end = String(this.value || '').length; this.setSelectionRange(end, end) } } catch (_) {} }";

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
        let one = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        assert_eq!(png_size(one), Some((1, 1)));
        assert_eq!(png_size("nope"), None);
    }

    #[test]
    fn a_secret_is_painted_over_and_nothing_else_moves() {
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
    fn markup_s_words_leave_out_scripts_and_styles() {
        assert_eq!(strip_tags("<p>a <b>b</b></p>"), "a b");
        assert_eq!(
            strip_tags("<p>words</p><script>let x = 1</script><STYLE>p{}</STYLE> more"),
            "words more"
        );
    }
}
