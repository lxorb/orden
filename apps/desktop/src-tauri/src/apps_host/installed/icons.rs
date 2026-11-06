use base64::Engine;

pub const SIDE: u32 = 32;

#[cfg(any(target_os = "linux", target_os = "macos", test))]
pub const MOST_FILE: u64 = 4 * 1024 * 1024;

#[cfg(any(target_os = "linux", target_os = "macos", test))]
pub const MOST_SVG: usize = 35 * 1024;

pub fn data_url(kind: &str, bytes: &[u8]) -> String {
    format!(
        "data:{kind};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[cfg(any(target_os = "linux", target_os = "macos", test))]
pub fn png_url(bytes: &[u8]) -> Option<String> {
    let (width, height) = png_size(bytes)?;
    if width <= SIDE && height <= SIDE {
        return Some(data_url("image/png", bytes));
    }
    let (rgba, width, height) = read_png(bytes)?;
    Some(data_url("image/png", &rgba_png(&rgba, width, height)?))
}

#[cfg(any(target_os = "linux", target_os = "macos", test))]
pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.get(..8)? != b"\x89PNG\r\n\x1a\n" || bytes.get(12..16)? != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
    Some((width, height))
}

#[cfg(any(target_os = "linux", target_os = "macos", test))]
fn read_png(bytes: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().ok()?;
    let mut pixels = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut pixels).ok()?;
    let (width, height) = (info.width, info.height);
    let count = usize::try_from(width).ok()? * usize::try_from(height).ok()?;
    let mut rgba = Vec::with_capacity(count * 4);
    for row in pixels
        .chunks(info.line_size)
        .take(usize::try_from(height).ok()?)
    {
        match info.color_type {
            png::ColorType::Rgba => {
                rgba.extend_from_slice(&row[..usize::try_from(width).ok()? * 4]);
            }
            png::ColorType::Rgb => {
                for one in row
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .take(usize::try_from(width).ok()?)
                {
                    rgba.extend_from_slice(&[one[0], one[1], one[2], u8::MAX]);
                }
            }
            png::ColorType::GrayscaleAlpha => {
                for one in row
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .take(usize::try_from(width).ok()?)
                {
                    rgba.extend_from_slice(&[one[0], one[0], one[0], one[1]]);
                }
            }
            png::ColorType::Grayscale => {
                for &one in row.iter().take(usize::try_from(width).ok()?) {
                    rgba.extend_from_slice(&[one, one, one, u8::MAX]);
                }
            }
            png::ColorType::Indexed => return None,
        }
    }
    (rgba.len() == count * 4).then_some((rgba, width, height))
}

pub fn rgba_png(rgba: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let (w, h) = (usize::try_from(width).ok()?, usize::try_from(height).ok()?);
    if w == 0 || h == 0 || rgba.len() < w * h * 4 {
        return None;
    }
    let scale = (f64::from(SIDE) / f64::from(width.max(height))).min(1.0);
    let out_w = side_of(f64::from(width) * scale);
    let out_h = side_of(f64::from(height) * scale);
    let mut out = Vec::with_capacity(out_w * out_h * 4);
    for y in 0..out_h {
        let (top, bottom) = (y * h / out_h, ((y + 1) * h).div_ceil(out_h).min(h));
        for x in 0..out_w {
            let (left, right) = (x * w / out_w, ((x + 1) * w).div_ceil(out_w).min(w));
            let mut sum = [0_u64; 4];
            let mut count = 0_u64;
            for row in top..bottom {
                for column in left..right {
                    let at = (row * w + column) * 4;
                    let alpha = u64::from(rgba[at + 3]);
                    sum[0] += u64::from(rgba[at]) * alpha;
                    sum[1] += u64::from(rgba[at + 1]) * alpha;
                    sum[2] += u64::from(rgba[at + 2]) * alpha;
                    sum[3] += alpha;
                    count += 1;
                }
            }
            let alpha = sum[3];
            let channel = |one: u64| {
                one.checked_div(alpha)
                    .map_or(0, |mean| u8::try_from(mean).unwrap_or(u8::MAX))
            };
            out.extend_from_slice(&[
                channel(sum[0]),
                channel(sum[1]),
                channel(sum[2]),
                u8::try_from(alpha / count.max(1)).unwrap_or(u8::MAX),
            ]);
        }
    }
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(
        &mut png,
        u32::try_from(out_w).ok()?,
        u32::try_from(out_h).ok()?,
    );
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().ok()?;
    writer.write_image_data(&out).ok()?;
    writer.finish().ok()?;
    Some(png)
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a side of at most SIDE pixels, rounded"
)]
fn side_of(value: f64) -> usize {
    (value.round() as usize).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_of(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(rgba).unwrap();
        writer.finish().unwrap();
        out
    }

    #[test]
    fn sends_a_small_png_as_it_is_and_makes_a_large_one_small() {
        let small = png_of(&[255, 0, 0, 255].repeat(16 * 16), 16, 16);
        assert_eq!(png_url(&small), Some(data_url("image/png", &small)));

        let large = png_of(&[0, 0, 255, 255].repeat(256 * 128), 256, 128);
        let url = png_url(&large).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(url.trim_start_matches("data:image/png;base64,"))
            .unwrap();
        assert_eq!(png_size(&bytes), Some((32, 16)));
        let (rgba, _, _) = read_png(&bytes).unwrap();
        assert_eq!(&rgba[..4], &[0, 0, 255, 255]);
    }

    #[test]
    fn a_transparent_edge_does_not_darken_what_it_is_mixed_with() {
        let shrunk = rgba_png(&[255, 255, 255, 255, 0, 0, 0, 0], 2, 1).unwrap();
        assert_eq!(png_size(&shrunk), Some((2, 1)));
        let wide: Vec<u8> = [[255, 255, 255, 255], [0, 0, 0, 0]].repeat(64).concat();
        let one = rgba_png(&wide, 128, 1).unwrap();
        let (rgba, width, _) = read_png(&one).unwrap();
        assert_eq!(width, 32);
        assert_eq!(&rgba[..4], &[255, 255, 255, 127]);
    }

    #[test]
    fn is_nothing_for_what_is_not_a_png() {
        assert_eq!(png_url(b"GIF89a"), None);
        assert_eq!(png_size(b""), None);
        assert_eq!(rgba_png(&[], 0, 0), None);
    }
}
