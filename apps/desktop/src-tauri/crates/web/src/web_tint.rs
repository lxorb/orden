use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const TINT: &str = r#"(function () {
  try {
    var paint = document.createElement('canvas').getContext('2d')
    function said(colour) {
      if (!paint || !colour) return ''
      paint.fillStyle = '#000000'
      paint.fillStyle = colour
      var first = paint.fillStyle
      paint.fillStyle = '#ffffff'
      paint.fillStyle = colour
      return first === paint.fillStyle ? String(first) : ''
    }
    var theme = ''
    var named = document.querySelectorAll('meta[name="theme-color" i]')
    for (var at = 0; at < named.length && !theme; at++) {
      var media = named[at].getAttribute('media')
      if (media && !window.matchMedia(media).matches) continue
      theme = said(named[at].getAttribute('content') || '')
    }
    var top = []
    var pictured = false
    var root = document.documentElement
    var wide = root.clientWidth || window.innerWidth
    var scheme = getComputedStyle(root).colorScheme || ''
    var dark = /dark/.test(scheme) && (!/light/.test(scheme) || window.matchMedia('(prefers-color-scheme: dark)').matches)
    var points = [0.08, 0.5, 0.92]
    for (var point = 0; point < points.length; point++) {
      var found = ''
      var here = false
      for (var one = document.elementFromPoint(Math.round(wide * points[point]), 1); one && one.nodeType === 1; one = one.parentElement) {
        if (/^(img|video|canvas|iframe|picture|svg|embed|object)$/i.test(one.tagName)) {
          here = true
          break
        }
        var style = getComputedStyle(one)
        if (style.backgroundImage && style.backgroundImage !== 'none') {
          here = true
          break
        }
        var ground = said(style.backgroundColor)
        if (ground.charAt(0) === '#') {
          found = ground
          break
        }
      }
      pictured = pictured || here
      top.push(found || (here ? '' : dark ? '#121212' : '#ffffff'))
    }
    return { theme: theme, top: top, pictured: pictured }
  } catch (error) {
    return { theme: '', top: [], pictured: false }
  }
})()"#;

const LONGEST: usize = 48;

const POINTS: usize = 3;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Tinted {
    #[serde(default)]
    theme: String,
    #[serde(default)]
    top: Vec<String>,
    #[serde(default)]
    pictured: bool,
}

impl Tinted {
    fn kept(self) -> Self {
        let short = |one: String| {
            if one.len() <= LONGEST {
                one
            } else {
                String::new()
            }
        };
        Self {
            theme: short(self.theme),
            top: self.top.into_iter().take(POINTS).map(short).collect(),
            pictured: self.pictured,
        }
    }
}

fn read(answer: &str) -> Tinted {
    serde_json::from_str::<Tinted>(answer)
        .map(Tinted::kept)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn web_tint(app: AppHandle, tab: String) -> Result<Tinted, String> {
    let view = crate::web_tabs::found(&app, &tab)?;
    let (sending, mut waiting) = tauri::async_runtime::channel::<String>(1);

    view.eval_with_callback(TINT, move |answer| {
        let _ = sending.try_send(answer);
    })
    .map_err(|error| format!("that page could not be read: {error}"))?;

    let answer = waiting
        .recv()
        .await
        .ok_or_else(|| "that page said nothing".to_string())?;
    Ok(read(&answer))
}

#[cfg(test)]
mod tests {
    use super::{read, Tinted, TINT};

    #[test]
    fn a_page_s_answer_is_read_as_it_was_given() {
        let said = read(r##"{"theme":"#ff0000","top":["#ffffff","#ffffff",""],"pictured":true}"##);
        assert_eq!(
            said,
            Tinted {
                theme: "#ff0000".into(),
                top: vec!["#ffffff".into(), "#ffffff".into(), String::new()],
                pictured: true,
            }
        );
    }

    #[test]
    fn an_answer_that_is_not_one_is_nothing() {
        assert_eq!(read("null"), Tinted::default());
        assert_eq!(read("not json"), Tinted::default());
        assert_eq!(read(r#"{"theme":7}"#), Tinted::default());
    }

    #[test]
    fn a_page_cannot_hand_back_more_than_a_colour() {
        let long = "x".repeat(4096);
        let many = vec!["#000000"; 50];
        let answer = serde_json::json!({ "theme": long, "top": many }).to_string();
        let said = read(&answer);
        assert!(said.theme.is_empty());
        assert_eq!(said.top.len(), 3);
    }

    #[test]
    fn the_script_asks_for_the_theme_colour_and_the_top_edge() {
        assert!(TINT.contains(r#"meta[name="theme-color" i]"#));
        assert!(TINT.contains("elementFromPoint"));
        assert!(TINT.contains("matchMedia(media)"));
    }
}
