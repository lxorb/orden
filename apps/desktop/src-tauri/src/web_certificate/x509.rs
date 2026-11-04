//! Just enough of X.509 to say what a certificate says to somebody looking at it: whom
//! it was issued to and by, with their organisations, when it holds, and its serial.
//!
//! Every engine hands over the certificates a page came with as DER, the bytes the site
//! sent, and only Chromium reads them out for us; `WebKit` and the `DevTools` Protocol
//! hand over the bytes and nothing else. So the bytes are read here, the same way for
//! every engine, rather than three ways that would each say something a little
//! different. Nothing here decides whether a certificate is to be trusted: the engine
//! that made the connection has done that already.

use super::Party;

/// What a certificate says, read out of its DER.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Read {
    /// Whom it was issued to.
    pub to: Party,
    /// Who issued it.
    pub by: Party,
    /// When it starts to hold, in milliseconds since the Unix epoch.
    pub from: i64,
    /// When it stops holding, the same way.
    pub until: i64,
    /// Its serial number, as the certificate writes it.
    pub serial: Vec<u8>,
    /// Whether it names itself as its issuer, which is what a root is.
    pub own_issuer: bool,
}

/// The DER tags read here.
const SEQUENCE: u8 = 0x30;
const SET: u8 = 0x31;
const INTEGER: u8 = 0x02;
const OID: u8 = 0x06;
/// `[0]`, the version, which a certificate of version 1 leaves out.
const VERSION: u8 = 0xa0;
const UTC_TIME: u8 = 0x17;
const GENERALIZED_TIME: u8 = 0x18;

/// The attributes of a name shown: its common name and its organisations.
const COMMON_NAME: &[u8] = &[0x55, 0x04, 0x03];
const ORGANIZATION: &[u8] = &[0x55, 0x04, 0x0a];

/// What a certificate says, or `None` for bytes that are not one.
pub fn fields(der: &[u8]) -> Option<Read> {
    let (certificate, _) = expect(der, SEQUENCE)?;
    let (signed, _) = expect(certificate, SEQUENCE)?;
    let (tag, first, after) = element(signed)?;
    let (serial, rest) = match tag {
        VERSION => expect(after, INTEGER)?,
        INTEGER => (first, after),
        _ => return None,
    };
    // The algorithm it is signed with, which is not shown.
    let (_, rest) = expect(rest, SEQUENCE)?;
    let (issuer, rest) = expect(rest, SEQUENCE)?;
    let (validity, rest) = expect(rest, SEQUENCE)?;
    let (subject, _) = expect(rest, SEQUENCE)?;
    let (from, rest) = time(validity)?;
    let (until, _) = time(rest)?;
    Some(Read {
        to: party(subject),
        by: party(issuer),
        from,
        until,
        serial: serial.to_vec(),
        own_issuer: subject == issuer,
    })
}

/// One element: its tag, what it holds and what comes after it.
fn element(input: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, rest) = input.split_first()?;
    let (&first, rest) = rest.split_first()?;
    let (length, rest) = if first < 0x80 {
        (usize::from(first), rest)
    } else {
        // The long form: the low bits say how many bytes the length takes.
        let count = usize::from(first & 0x7f);
        if count == 0 || count > 4 || rest.len() < count {
            return None;
        }
        let (bytes, rest) = rest.split_at(count);
        let length = bytes
            .iter()
            .fold(0_usize, |length, &byte| (length << 8) | usize::from(byte));
        (length, rest)
    };
    if rest.len() < length {
        return None;
    }
    let (content, rest) = rest.split_at(length);
    Some((tag, content, rest))
}

/// One element that has to be of `tag`: what it holds and what comes after it.
fn expect(input: &[u8], tag: u8) -> Option<(&[u8], &[u8])> {
    let (found, content, rest) = element(input)?;
    (found == tag).then_some((content, rest))
}

/// A name's common name and organisations. The first common name is the one shown, as
/// Chromium shows it; the organisations are all kept, in the certificate's order.
fn party(name: &[u8]) -> Party {
    let mut said = Party::default();
    let mut common = None;
    let mut sets = name;
    while let Some((tag, set, rest)) = element(sets) {
        sets = rest;
        if tag != SET {
            continue;
        }
        let mut pairs = set;
        while let Some((tag, pair, rest)) = element(pairs) {
            pairs = rest;
            let Some((kind, value)) = (tag == SEQUENCE).then(|| expect(pair, OID)).flatten() else {
                continue;
            };
            let Some(text) = element(value).and_then(|(tag, bytes, _)| text(tag, bytes)) else {
                continue;
            };
            if kind == COMMON_NAME && common.is_none() {
                common = Some(text);
            } else if kind == ORGANIZATION && !text.is_empty() {
                said.organization.push(text);
            }
        }
    }
    said.name = common.unwrap_or_default();
    said
}

/// A string of one of the kinds a name is written in.
fn text(tag: u8, bytes: &[u8]) -> Option<String> {
    match tag {
        // UTF8String, and the ASCII ones: Numeric, Printable, IA5 and Visible.
        0x0c | 0x12 | 0x13 | 0x16 | 0x1a => String::from_utf8(bytes.to_vec()).ok(),
        // TeletexString, which the certificates that still use it fill with Latin-1.
        0x14 => Some(bytes.iter().copied().map(char::from).collect()),
        // BMPString: UTF-16, big-endian.
        0x1e => {
            let units: Vec<u16> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&pair| u16::from_be_bytes(pair))
                .collect();
            String::from_utf16(&units).ok()
        }
        // UniversalString: UTF-32, big-endian.
        0x1c => bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|&four| char::from_u32(u32::from_be_bytes(four)))
            .collect(),
        _ => None,
    }
}

/// A time, as milliseconds since the Unix epoch, and what comes after it.
fn time(input: &[u8]) -> Option<(i64, &[u8])> {
    let (tag, content, rest) = element(input)?;
    let written = std::str::from_utf8(content).ok()?;
    let number = |at: usize, wide: usize| -> Option<i64> {
        let digits = written.get(at..at + wide)?;
        digits
            .bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| digits.parse().ok())
            .flatten()
    };
    let (year, at) = match tag {
        // Two digits of the year, which RFC 5280 reads as 1950 to 2049.
        UTC_TIME => {
            let two = number(0, 2)?;
            (if two < 50 { 2000 + two } else { 1900 + two }, 2)
        }
        GENERALIZED_TIME => (number(0, 4)?, 4),
        _ => return None,
    };
    let (month, day) = (number(at, 2)?, number(at + 2, 2)?);
    let (hour, minute) = (number(at + 4, 2)?, number(at + 6, 2)?);
    let second = number(at + 8, 2).unwrap_or(0);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let seconds = days(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second;
    Some((seconds * 1_000, rest))
}

/// Days from 1970-01-01 to a day of the proleptic Gregorian calendar.
const fn days(year: i64, month: i64, day: i64) -> i64 {
    // Counted from March, so the leap day is the last of its year.
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    era * 146_097 + of_cycle - 719_468
}

#[cfg(test)]
pub(super) mod tests {
    use base64::Engine as _;

    use super::{days, fields, Party};

    /// A chain made for these tests: a root, an intermediate it issued, and a site's
    /// certificate the intermediate issued, whose organisations are written as `BMPString`s.
    pub const ROOT: &str = "MIIBOjCB7aADAgECAgEBMAUGAytlcDBGMQswCQYDVQQGEwJDSDEdMBsGA1UECgwUT3JkZW4gVGVzdCBBdXRob3JpdHkxGDAWBgNVBAMMD09yZGVuIFRlc3QgUm9vdDAgFw0yNjAxMDEwMDAwMDBaGA8yMDUxMDEwMTAwMDAwMFowRjELMAkGA1UEBhMCQ0gxHTAbBgNVBAoMFE9yZGVuIFRlc3QgQXV0aG9yaXR5MRgwFgYDVQQDDA9PcmRlbiBUZXN0IFJvb3QwKjAFBgMrZXADIQCKiOPddAnxlf1S2y08ul1yymcJvx2UEhvzdIgBtA9vXDAFBgMrZXADQQAeJ2f8tHvXhkuzNRapugpg/6YhgpvPsxJniha9wWMEDoV9gNRe1oAdHfYYi5szj2RNiU5oIXngJsnGG2XHhYAG";
    pub const INTERMEDIATE: &str = "MIIBODCB66ADAgECAgMAjxIwBQYDK2VwMEYxCzAJBgNVBAYTAkNIMR0wGwYDVQQKDBRPcmRlbiBUZXN0IEF1dGhvcml0eTEYMBYGA1UEAwwPT3JkZW4gVGVzdCBSb290MB4XDTI2MDIwMTAwMDAwMFoXDTMxMDIwMTAwMDAwMFowRDELMAkGA1UEBhMCQ0gxHTAbBgNVBAoMFE9yZGVuIFRlc3QgQXV0aG9yaXR5MRYwFAYDVQQDDA1PcmRlbiBUZXN0IFIxMCowBQYDK2VwAyEAgTl3Dqh9F19Wo1Rmw0x+zMuNipG07jeiXfYPW4/Js5QwBQYDK2VwA0EAgwrJqZ9T5PxjjJS9l64gNRauiV17mV/xdhCeaK3FYP2aTTwRZYrKDvLFlw4B/Hl0lSKqIiDwxWmY6Zz3oEyHBg==";
    pub const SITE: &str = "MIIBWTCCAQugAwIBAgIFAQIDBAUwBQYDK2VwMEQxCzAJBgNVBAYTAkNIMR0wGwYDVQQKDBRPcmRlbiBUZXN0IEF1dGhvcml0eTEWMBQGA1UEAwwNT3JkZW4gVGVzdCBSMTAeFw0yNjAzMDExMjMwMTVaFw0yNjA2MDEwMDAwMDBaMGQxCzAJBgNVBAYTAkNIMR8wHQYDVQQKHhYA3ABuAO8AYwBvAGQAZQAgAE8AcgBnMR0wGwYDVQQKHhQAUwBlAGMAbwBuAGQAIABPAHIAZzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MCowBQYDK2VwAyEA7UkoxijRwsbq6QM4kFmVYSlZJzpcY/k2NsFGFKyHN9EwBQYDK2VwA0EAndGrQPG1ZoNtTyB1I72WP3njBfPhwZR6vbE2K0FNBn4/U6TpQnAzFBqxi6IihlJwpfT0jMWORrc3jDMmq5vKCg==";

    pub fn der(base64: &str) -> Vec<u8> {
        base64::engine::general_purpose::STANDARD
            .decode(base64)
            .expect("base64")
    }

    fn party(name: &str, organization: &[&str]) -> Party {
        Party {
            name: name.into(),
            organization: organization.iter().map(|one| (*one).to_string()).collect(),
        }
    }

    #[test]
    fn a_site_s_certificate_says_whom_it_is_for_and_who_issued_it() {
        let site = fields(&der(SITE)).expect("a certificate");
        assert_eq!(
            site.to,
            party("example.test", &["Ünïcode Org", "Second Org"])
        );
        assert_eq!(site.by, party("Orden Test R1", &["Orden Test Authority"]));
        // 2026-03-01T12:30:15Z and 2026-06-01T00:00:00Z, both UTCTime.
        assert_eq!(site.from, 1_772_368_215_000);
        assert_eq!(site.until, 1_780_272_000_000);
        assert_eq!(site.serial, [1, 2, 3, 4, 5]);
        assert!(!site.own_issuer);
    }

    #[test]
    fn a_root_is_its_own_issuer_and_may_hold_past_2049() {
        let root = fields(&der(ROOT)).expect("a certificate");
        assert_eq!(root.to, party("Orden Test Root", &["Orden Test Authority"]));
        assert_eq!(root.to, root.by);
        assert!(root.own_issuer);
        // 2026-01-01, UTCTime; 2051-01-01, GeneralizedTime.
        assert_eq!(root.from, 1_767_225_600_000);
        assert_eq!(root.until, 2_556_144_000_000);

        let intermediate = fields(&der(INTERMEDIATE)).expect("a certificate");
        // A serial whose high bit is set keeps the zero in front of it.
        assert_eq!(intermediate.serial, [0x00, 0x8f, 0x12]);
        assert_eq!(intermediate.by, root.to);
        assert!(!intermediate.own_issuer);
    }

    #[test]
    fn bytes_that_are_no_certificate_say_nothing() {
        assert_eq!(fields(&[]), None);
        assert_eq!(fields(&[0x30, 0x82, 0xff]), None);
        let whole = der(SITE);
        assert_eq!(fields(&whole[..whole.len() / 2]), None);
    }

    #[test]
    fn a_day_is_counted_from_1970() {
        assert_eq!(days(1970, 1, 1), 0);
        assert_eq!(days(2000, 3, 1), 11_017);
        assert_eq!(days(1969, 12, 31), -1);
    }
}
