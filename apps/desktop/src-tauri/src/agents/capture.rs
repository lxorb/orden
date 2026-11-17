use tauri::AppHandle;

use super::grants::Scope;
use super::verbs::{Answer, CaptureAs, Code};
use super::Caller;
use crate::pdf::PdfPage;

const VERB: &str = "capture_to_note";

pub struct Asked {
    pub shape: CaptureAs,
    pub full_page: bool,
    pub paper: Option<PdfPage>,
}

pub fn answer(app: &AppHandle, caller: &Caller, tab: &str, asked: Asked) -> Answer {
    if let Err(refused) = may_capture(caller, &asked) {
        return refused;
    }
    taken(app, caller, tab, asked)
}

fn may_capture(caller: &Caller, asked: &Asked) -> Result<(), Answer> {
    if super::stop::stopped() {
        return Err(Answer::error(
            Code::Stopped,
            "the reader pressed the stop: nothing runs until they resume",
        ));
    }
    super::may_ask_the_window(caller, VERB).map_err(|why| Answer::error(Code::NotGranted, why))?;
    if !caller.holds(Scope::Browser) && !caller.holds(Scope::BrowserReader) {
        return Err(Answer::error(
            Code::NotGranted,
            "this agent was not granted the browser",
        ));
    }
    if asked.shape == CaptureAs::Pdf && asked.paper.is_none() {
        return Err(no_paper());
    }
    Ok(())
}

fn no_paper() -> Answer {
    Answer::error(Code::BadArguments, "a PDF needs the paper it is printed on")
}

fn taken(app: &AppHandle, caller: &Caller, tab: &str, asked: Asked) -> Answer {
    use super::engines::{self, Engine};
    use super::verbs::Captured;

    if engines::cannot(VERB).is_some() {
        return engines::refused(VERB);
    }

    if super::tabs::find(caller.id(), tab).is_some() && !caller.holds(Scope::Browser) {
        return Answer::error(
            Code::NotGranted,
            "this agent was not granted tabs of its own",
        );
    }
    let since = super::stop::generation();
    super::browser::on_tab(app, caller, tab, VERB, since, false, |_, page| {
        let url = Engine::url(page);
        let captured = match asked.shape {
            CaptureAs::Clip => Engine::clip(page).map(|(url, title, html)| Captured {
                url,
                title,
                html: Some(html),
                ..Captured::default()
            }),
            CaptureAs::Screenshot => {
                Engine::screenshot(page, None, asked.full_page, None).map(|picture| Captured {
                    url: url.clone(),
                    title: Engine::title(page),
                    png: Some(picture.png),
                    ..Captured::default()
                })
            }
            CaptureAs::Pdf => asked
                .paper
                .as_ref()
                .ok_or_else(no_paper)
                .and_then(|paper| Engine::pdf(page, paper))
                .map(|pdf| Captured {
                    url: url.clone(),
                    title: Engine::title(page),
                    pdf: Some(pdf),
                    ..Captured::default()
                }),
        };
        match captured {
            Ok(captured) => Answer::Ok {
                result: serde_json::to_value(captured).unwrap_or_default(),
                untrusted: Some(url),
                dialog: None,
            },
            Err(refused) => refused,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::grants::Grant;

    fn asked(shape: CaptureAs) -> Asked {
        Asked {
            shape,
            full_page: false,
            paper: Some(PdfPage {
                width: 8.27,
                height: 11.69,
                margin: 0.787,
                landscape: false,
            }),
        }
    }

    fn agent(scopes: &[Scope]) -> Caller {
        let mut grant = Grant::own("a".into(), "A");
        grant.scopes = scopes.to_vec();
        Caller::Agent(Box::new(grant))
    }

    fn code(refused: Result<(), Answer>) -> Option<Code> {
        match refused {
            Err(Answer::Error { code, .. }) => Some(code),
            _ => None,
        }
    }

    #[test]
    fn a_capture_needs_what_capture_to_note_needs_and_a_browser() {
        let clip = asked(CaptureAs::Clip);
        assert_eq!(
            code(may_capture(&agent(&[Scope::Browser]), &clip)),
            Some(Code::NotGranted)
        );
        assert_eq!(
            code(may_capture(&agent(&[Scope::NotesWrite]), &clip)),
            Some(Code::NotGranted)
        );
        assert!(may_capture(&agent(&[Scope::NotesWrite, Scope::Browser]), &clip).is_ok());
        assert!(may_capture(&agent(&[Scope::NotesWrite, Scope::BrowserReader]), &clip).is_ok());
        assert!(may_capture(&Caller::Reader, &clip).is_ok());
    }

    #[test]
    fn a_pdf_needs_the_paper() {
        let mut pdf = asked(CaptureAs::Pdf);
        assert!(may_capture(&Caller::Reader, &pdf).is_ok());
        pdf.paper = None;
        assert_eq!(
            code(may_capture(&Caller::Reader, &pdf)),
            Some(Code::BadArguments)
        );
        let mut shot = asked(CaptureAs::Screenshot);
        shot.paper = None;
        assert!(may_capture(&Caller::Reader, &shot).is_ok());
    }

    #[test]
    fn the_shapes_are_the_windows_words() {
        for (shape, word) in [
            (CaptureAs::Clip, "clip"),
            (CaptureAs::Screenshot, "screenshot"),
            (CaptureAs::Pdf, "pdf"),
        ] {
            assert_eq!(serde_json::to_value(shape).expect("a word"), word);
            assert_eq!(
                serde_json::from_value::<CaptureAs>(word.into()).expect("a shape"),
                shape
            );
        }
        assert!(serde_json::from_value::<CaptureAs>("link".into()).is_err());
    }
}
