use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 1;
const MOST: usize = 16 << 20;
pub const HELLO: u8 = 1;
pub const INPUT: u8 = 2;
pub const SIZE: u8 = 3;
pub const END: u8 = 4;
pub const TAKE: u8 = 5;
pub const NAME: u8 = 6;
pub const TAKING: u8 = 1;
pub const ASKING: u8 = 2;
pub const HI: u8 = 10;
pub const SCREEN: u8 = 11;
pub const OUT: u8 = 12;
pub const EXIT: u8 = 13;
pub const WRITER: u8 = 14;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Hi {
    pub v: u32,
    pub holder: u32,
    pub shell: Option<u32>,
    pub cols: u16,
    pub rows: u16,
    pub writer: bool,
    #[serde(default)]
    pub last: u64,
    #[serde(default)]
    pub clients: u32,
    #[serde(default)]
    pub exit: Option<i64>,
}
pub fn frame(kind: u8, body: &[u8]) -> Vec<u8> {
    let length = u32::try_from(body.len() + 1).unwrap_or(u32::MAX);
    let mut frame = Vec::with_capacity(body.len() + 5);
    frame.extend_from_slice(&length.to_le_bytes());
    frame.push(kind);
    frame.extend_from_slice(body);
    frame
}
pub fn send(to: &mut impl Write, kind: u8, body: &[u8]) -> io::Result<()> {
    to.write_all(&frame(kind, body))?;
    to.flush()
}
pub fn heard(from: &mut impl Read) -> io::Result<(u8, Vec<u8>)> {
    let mut length = [0u8; 4];
    from.read_exact(&mut length)?;
    let length = usize::try_from(u32::from_le_bytes(length)).unwrap_or(usize::MAX);
    if length == 0 || length > MOST {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut kind = [0u8; 1];
    from.read_exact(&mut kind)?;
    let mut body = vec![0u8; length - 1];
    from.read_exact(&mut body)?;
    Ok((kind[0], body))
}
pub fn size(cols: u16, rows: u16) -> [u8; 4] {
    let [a, b] = cols.to_le_bytes();
    let [c, d] = rows.to_le_bytes();
    [a, b, c, d]
}
pub fn size_of(body: &[u8]) -> Option<(u16, u16)> {
    let [a, b, c, d] = <[u8; 4]>::try_from(body).ok()?;
    Some((u16::from_le_bytes([a, b]), u16::from_le_bytes([c, d])))
}
pub fn same(one: &[u8], other: &[u8]) -> bool {
    one.len() == other.len() && one.iter().zip(other).fold(0u8, |seen, (a, b)| seen | (a ^ b)) == 0
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_reads_back_as_it_was_sent() {
        let mut line = Vec::new();
        send(&mut line, OUT, b"hello").expect("sent");
        send(&mut line, SIZE, &size(120, 40)).expect("sent");
        let mut reading = line.as_slice();
        assert_eq!(heard(&mut reading).expect("a frame"), (OUT, b"hello".to_vec()));
        let (kind, body) = heard(&mut reading).expect("a frame");
        assert_eq!(kind, SIZE);
        assert_eq!(size_of(&body), Some((120, 40)));
        assert!(heard(&mut reading).is_err());
    }
    #[test]
    fn a_frame_too_long_or_empty_is_refused() {
        let empty = 0u32.to_le_bytes();
        assert!(heard(&mut empty.as_slice()).is_err());
        let huge = u32::try_from(MOST + 1).expect("fits").to_le_bytes();
        assert!(heard(&mut huge.as_slice()).is_err());
    }
    #[test]
    fn tokens_are_compared_whole() {
        assert!(same(b"abc", b"abc"));
        assert!(!same(b"abc", b"abd"));
        assert!(!same(b"abc", b"ab"));
    }
}
