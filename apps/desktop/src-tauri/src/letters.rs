pub(crate) fn seen(said: &str) -> String {
    said.chars()
        .filter(|one| !hidden(*one))
        .map(|one| {
            if one.is_control() || crate::downloads::is_blank(one) {
                ' '
            } else {
                look_alike(one)
            }
        })
        .collect()
}

pub(crate) fn hidden(one: char) -> bool {
    crate::downloads::is_format(one)
        || matches!(one,
            '\u{034F}'
            | '\u{200C}'..='\u{200D}'
            | '\u{FE00}'..='\u{FE0F}'
            | '\u{E0100}'..='\u{E01EF}'
        )
}

pub(crate) fn look_alike(one: char) -> char {
    let at = u32::from(one);
    let latin = |offset: u32| char::from_u32(offset).unwrap_or(one);
    match at {
        0xFF01..=0xFF5E => latin(at - 0xFEE0),
        0x1D400..=0x1D6A3 => {
            let letter = (at - 0x1D400) % 52;
            latin(if letter < 26 {
                0x41 + letter
            } else {
                0x61 + letter - 26
            })
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
