use windows::Win32::Graphics::Gdi::{
    GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

pub struct Com(bool);
impl Com {
    #[allow(unsafe_code)]
    pub fn start() -> Com {
        Com(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok())
    }
}
impl Drop for Com {
    #[allow(unsafe_code)]
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}
#[allow(unsafe_code)]
pub fn bitmap_rgba(bitmap: HBITMAP) -> Option<(Vec<u8>, u32, u32)> {
    let mut about = BITMAP::default();
    let size = i32::try_from(std::mem::size_of::<BITMAP>()).ok()?;
    if unsafe { GetObjectW(bitmap, size, Some((&raw mut about).cast())) } == 0 {
        return None;
    }
    let (width, height) = (about.bmWidth, about.bmHeight.abs());
    if width <= 0 || height <= 0 || width > 1024 || height > 1024 {
        return None;
    }
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: u32::try_from(std::mem::size_of::<BITMAPINFOHEADER>()).ok()?,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let (w, h) = (usize::try_from(width).ok()?, usize::try_from(height).ok()?);
    let mut bgra = vec![0_u8; w * h * 4];
    let lines = unsafe {
        let screen = GetDC(None);
        let lines = GetDIBits(
            screen,
            bitmap,
            0,
            u32::try_from(height).ok()?,
            Some(bgra.as_mut_ptr().cast()),
            &raw mut info,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, screen);
        lines
    };
    if lines == 0 {
        return None;
    }
    Some((straight(&bgra), u32::try_from(width).ok()?, u32::try_from(height).ok()?))
}
fn straight(bgra: &[u8]) -> Vec<u8> {
    let pixels = bgra.as_chunks::<4>().0;
    let no_alpha = pixels.iter().all(|one| one[3] == 0);
    let premultiplied =
        !no_alpha && pixels.iter().all(|one| one[0].max(one[1]).max(one[2]) <= one[3]);
    let mut out = Vec::with_capacity(bgra.len());
    for &[blue, green, red, alpha] in pixels {
        if no_alpha {
            out.extend_from_slice(&[red, green, blue, u8::MAX]);
        } else if premultiplied && alpha > 0 && alpha < u8::MAX {
            let lift =
                |one: u8| u8::try_from(u32::from(one) * 255 / u32::from(alpha)).unwrap_or(u8::MAX);
            out.extend_from_slice(&[lift(red), lift(green), lift(blue), alpha]);
        } else {
            out.extend_from_slice(&[red, green, blue, alpha]);
        }
    }
    out
}
#[cfg(test)]
mod tests {
    use super::straight;

    #[test]
    fn reads_the_shells_pixels_straight() {
        assert_eq!(straight(&[128, 128, 128, 128]), vec![255, 255, 255, 128]);
        assert_eq!(straight(&[1, 2, 3, 0]), vec![3, 2, 1, 255]);
        assert_eq!(straight(&[200, 0, 0, 100, 0, 0, 0, 255]), vec![0, 0, 200, 100, 0, 0, 0, 255]);
    }
}
