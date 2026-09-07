//! Every `#tag` a note uses, once per use.
//!
//! One rule, three readers: the tag list the sidebar offers, the `tag:`
//! operator in a search, and the count behind `space_tags`. The twin of this
//! is search/tags.ts, which the browser build reads with.
//!
//! A heading is not a tag: it has a space after the hash, and a tag never
//! does. A tag starts a word, and its first character is a letter, which is
//! what rules out `#42`.

/// Every tag in one note's text, with the hash, in the order they are used.
pub fn tags_in(body: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut in_fence = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        let letters: Vec<char> = line.chars().collect();
        let mut at = 0;

        while at < letters.len() {
            if letters[at] != '#' {
                at += 1;
                continue;
            }

            // A tag starts a word, so what comes before it must be a space.
            let opens = at == 0 || letters[at - 1].is_whitespace() || letters[at - 1] == '(';
            let mut end = at + 1;
            while end < letters.len()
                && (letters[end].is_alphanumeric() || "-_/".contains(letters[end]))
            {
                end += 1;
            }

            // The first character has to be a letter, which rules out `#1`.
            let named = end > at + 1 && letters[at + 1].is_alphabetic();

            if opens && named {
                found.push(letters[at..end].iter().collect());
            }

            at = end.max(at + 1);
        }
    }

    found
}

#[cfg(test)]
mod tests {
    use super::tags_in;

    #[test]
    fn finds_tags_but_not_headings() {
        assert_eq!(tags_in("# Heading\n#tag here"), vec!["#tag"]);
        assert_eq!(tags_in("## Also a heading"), Vec::<String>::new());
    }

    #[test]
    fn a_tag_has_to_start_a_word() {
        assert_eq!(tags_in("a#b"), Vec::<String>::new());
        assert_eq!(tags_in("(#nested)"), vec!["#nested"]);
        assert_eq!(tags_in("issue #42"), Vec::<String>::new());
    }

    #[test]
    fn keeps_the_characters_a_tag_may_contain() {
        assert_eq!(
            tags_in("#work/2026 #a-b #c_d"),
            vec!["#work/2026", "#a-b", "#c_d"]
        );
    }

    #[test]
    fn ignores_anything_inside_a_fence() {
        assert_eq!(tags_in("```\n#notatag\n```\n#real"), vec!["#real"]);
    }

    #[test]
    fn counts_a_tag_once_per_use() {
        assert_eq!(tags_in("#a #a #b").len(), 3);
    }
}
