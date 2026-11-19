pub fn seen(said: &str) -> String {
    said.chars()
        .filter(|one| !hidden(*one))
        .map(|one| if one.is_control() || is_blank(one) { ' ' } else { look_alike(one) })
        .collect()
}
pub fn hidden(one: char) -> bool {
    is_format(one)
        || matches!(one,
            '\u{034F}'
            | '\u{200C}'..='\u{200D}'
            | '\u{FE00}'..='\u{FE0F}'
            | '\u{E0100}'..='\u{E01EF}'
        )
}
pub fn look_alike(one: char) -> char {
    let at = u32::from(one);
    let latin = |offset: u32| char::from_u32(offset).unwrap_or(one);
    match at {
        0xFF01..=0xFF5E => latin(at - 0xFEE0),
        0x1D400..=0x1D6A3 => {
            let letter = (at - 0x1D400) % 52;
            latin(if letter < 26 { 0x41 + letter } else { 0x61 + letter - 26 })
        }
        0x1D7CE..=0x1D7FF => latin(0x30 + (at - 0x1D7CE) % 10),
        _ => {
            let mut lower = one.to_lowercase();
            let (Some(small), None) = (lower.next(), lower.next()) else {
                return one;
            };
            match like_latin(small) {
                Some(latin) if one.is_uppercase() => latin.to_ascii_uppercase(),
                Some(latin) => latin,
                None => one,
            }
        }
    }
}
fn like_latin(small: char) -> Option<char> {
    Some(match small {
        '\u{430}' | '\u{3b1}' => 'a',
        '\u{441}' | '\u{3f2}' => 'c',
        '\u{501}' => 'd',
        '\u{435}' | '\u{450}' => 'e',
        '\u{4bb}' => 'h',
        '\u{456}' | '\u{3b9}' | '\u{131}' => 'i',
        '\u{4cf}' => 'l',
        '\u{458}' | '\u{3f3}' => 'j',
        '\u{3ba}' => 'k',
        '\u{43e}' | '\u{3bf}' => 'o',
        '\u{440}' | '\u{3c1}' => 'p',
        '\u{51b}' => 'q',
        '\u{455}' => 's',
        '\u{3c5}' => 'u',
        '\u{3bd}' | '\u{475}' => 'v',
        '\u{51d}' => 'w',
        '\u{445}' | '\u{3c7}' => 'x',
        '\u{443}' => 'y',
        _ => return None,
    })
}
pub fn is_format(one: char) -> bool {
    matches!(one,
        '\u{00AD}'
        | '\u{0600}'..='\u{0605}'
        | '\u{061C}'
        | '\u{06DD}'
        | '\u{070F}'
        | '\u{0890}'..='\u{0891}'
        | '\u{08E2}'
        | '\u{180E}'
        | '\u{200B}'
        | '\u{200E}'..='\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{206F}'
        | '\u{FEFF}'
        | '\u{FFF9}'..='\u{FFFB}'
        | '\u{110BD}'
        | '\u{110CD}'
        | '\u{13430}'..='\u{1343F}'
        | '\u{1BCA0}'..='\u{1BCA3}'
        | '\u{1D173}'..='\u{1D17A}'
        | '\u{E0001}'
        | '\u{E0020}'..='\u{E007F}'
    )
}
pub fn is_blank(one: char) -> bool {
    matches!(one,
        '\u{00A0}'
        | '\u{115F}'..='\u{1160}'
        | '\u{1680}'
        | '\u{17B4}'..='\u{17B5}'
        | '\u{2000}'..='\u{200A}'
        | '\u{202F}'
        | '\u{205F}'
        | '\u{2800}'
        | '\u{3000}'
        | '\u{3164}'
        | '\u{FFA0}'
    )
}
pub fn plain_name(said: &str) -> String {
    said.chars()
        .filter(|one| !is_format(*one))
        .map(|one| if one.is_control() || is_blank(one) { ' ' } else { one })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
pub fn spelled_out(said: &str) -> String {
    let mut out = String::with_capacity(said.len());
    for one in said.chars() {
        if (one.is_control() && one != ' ') || is_format(one) {
            out.extend(one.escape_unicode());
        } else {
            out.push(one);
        }
    }
    out
}
