use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter as _};

use super::verbs::{Answer, Approval, ApprovalAnswer, Category, Event, EVENT};
use crate::downloads::spelled_out;

const EXPIRES: Duration = Duration::from_secs(24 * 60 * 60);

const SPEND_WITHIN: Duration = Duration::from_secs(10 * 60);

struct Held {
    approval: Approval,
    key: String,
    at: Instant,
    spent: bool,
}

static HELD: Mutex<Vec<Held>> = Mutex::new(Vec::new());

static NEXT: AtomicU64 = AtomicU64::new(1);

fn held() -> std::sync::MutexGuard<'static, Vec<Held>> {
    HELD.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn key(verb: &str, tab: Option<&str>, element: Option<&str>) -> String {
    format!(
        "{verb}:{}:{}",
        tab.unwrap_or_default(),
        element.unwrap_or_default()
    )
}

pub fn on_page(key: &str, url: &str, element: &str) -> String {
    let host = super::policy::host_of(url).unwrap_or_default();
    let element = element.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("{key}:{host}:{element}")
}

pub fn is_allowed(agent: &str, key: &str) -> bool {
    held().iter().any(|one| {
        one.approval.agent == agent
            && one.key == key
            && one.approval.answer == ApprovalAnswer::Allowed
            && !one.spent
            && one.at.elapsed() < SPEND_WITHIN
    })
}

pub fn allowed(agent: &str, key: &str) -> bool {
    let mut all = held();
    let found = all.iter_mut().find(|one| {
        one.approval.agent == agent
            && one.key == key
            && one.approval.answer == ApprovalAnswer::Allowed
            && !one.spent
            && one.at.elapsed() < SPEND_WITHIN
    });
    match found {
        Some(one) => {
            one.spent = true;
            true
        }
        None => false,
    }
}

pub struct Asking<'a> {
    pub agent: &'a str,
    pub name: &'a str,
    pub category: Category,
    pub summary: String,
    pub site: Option<String>,
    pub tab: Option<String>,
    pub key: String,
}

pub fn granted(app: &AppHandle, asking: Asking<'_>, answer: ApprovalAnswer) -> Approval {
    let approval = Approval {
        id: format!("q{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: asking.agent.to_string(),
        name: spelled_out(asking.name),
        category: asking.category,
        summary: spelled_out(&asking.summary),
        site: asking.site,
        tab: asking.tab,
        verb: verb_of(&asking.key).to_owned(),
        asked: crate::clock::now(),
        answer,
    };
    held().push(Held {
        approval: approval.clone(),
        key: asking.key,
        at: Instant::now(),
        spent: true,
    });
    let _ = app.emit(
        EVENT,
        Event::Answered {
            approval: approval.clone(),
        },
    );
    approval
}

pub fn ask(app: &AppHandle, asking: Asking<'_>) -> Answer {
    let mut all = held();
    if let Some(one) = all
        .iter()
        .rev()
        .find(|one| one.approval.agent == asking.agent && one.key == asking.key)
    {
        match one.approval.answer {
            ApprovalAnswer::Pending => {
                return Answer::NeedsApproval {
                    approval: one.approval.id.clone(),
                    summary: one.approval.summary.clone(),
                };
            }
            ApprovalAnswer::Denied if one.at.elapsed() < SPEND_WITHIN => {
                return Answer::error(
                    super::verbs::Code::Denied,
                    format!("the reader said no: {}", one.approval.summary),
                );
            }
            _ => {}
        }
    }
    let approval = Approval {
        id: format!("q{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: asking.agent.to_string(),
        name: spelled_out(asking.name),
        category: asking.category,
        summary: spelled_out(&asking.summary),
        site: asking.site,
        tab: asking.tab,
        verb: verb_of(&asking.key).to_owned(),
        asked: crate::clock::now(),
        answer: ApprovalAnswer::Pending,
    };
    all.push(Held {
        approval: approval.clone(),
        key: asking.key,
        at: Instant::now(),
        spent: false,
    });
    drop(all);
    let _ = app.emit(
        EVENT,
        Event::Asked {
            approval: approval.clone(),
        },
    );
    Answer::NeedsApproval {
        approval: approval.id,
        summary: approval.summary,
    }
}

fn verb_of(key: &str) -> &str {
    key.split(':').next().unwrap_or_default()
}

pub fn answer(app: &AppHandle, id: &str, allow: bool) -> Result<Approval, String> {
    let approval = {
        let mut all = held();
        let one = all
            .iter_mut()
            .find(|one| one.approval.id == id)
            .ok_or("there is no such question")?;
        if one.approval.answer != ApprovalAnswer::Pending {
            return Ok(one.approval.clone());
        }
        one.approval.answer = match (allow, one.approval.category) {
            (true, Category::Takeover) => ApprovalAnswer::Done,
            (true, _) => ApprovalAnswer::Allowed,
            (false, _) => ApprovalAnswer::Denied,
        };
        one.at = Instant::now();
        one.approval.clone()
    };
    let _ = app.emit(
        EVENT,
        Event::Answered {
            approval: approval.clone(),
        },
    );
    Ok(approval)
}

pub fn status(agent: &str, id: &str) -> Option<Approval> {
    held()
        .iter()
        .find(|one| one.approval.id == id && one.approval.agent == agent)
        .map(|one| one.approval.clone())
}

pub fn any(id: &str) -> Option<Approval> {
    held()
        .iter()
        .find(|one| one.approval.id == id)
        .map(|one| one.approval.clone())
}

pub fn pending(agent: Option<&str>) -> Vec<Approval> {
    held()
        .iter()
        .filter(|one| one.approval.answer == ApprovalAnswer::Pending)
        .filter(|one| agent.is_none_or(|agent| one.approval.agent == agent))
        .map(|one| one.approval.clone())
        .collect()
}

pub fn expire(app: &AppHandle) {
    let expired: Vec<Approval> = held()
        .iter_mut()
        .filter(|one| one.approval.answer == ApprovalAnswer::Pending && one.at.elapsed() >= EXPIRES)
        .map(|one| {
            one.approval.answer = ApprovalAnswer::Expired;
            one.approval.clone()
        })
        .collect();
    for approval in expired {
        let _ = app.emit(EVENT, Event::Answered { approval });
    }
}

pub fn waiting_on(agent: &str, tab: &str, category: Category) -> Option<Approval> {
    held()
        .iter()
        .rev()
        .find(|one| {
            one.approval.agent == agent
                && one.approval.tab.as_deref() == Some(tab)
                && one.approval.category == category
        })
        .map(|one| one.approval.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pushed(agent: &str, key: &str, answer: ApprovalAnswer) -> String {
        let id = format!("t{}", NEXT.fetch_add(1, Ordering::Relaxed));
        held().push(Held {
            approval: Approval {
                id: id.clone(),
                agent: agent.into(),
                name: agent.into(),
                category: Category::Paying,
                summary: "Pay on shop.example".into(),
                site: Some("shop.example".into()),
                tab: Some("a1".into()),
                verb: verb_of(key).into(),
                asked: 0,
                answer,
            },
            key: key.into(),
            at: Instant::now(),
            spent: false,
        });
        id
    }

    #[test]
    fn an_allowed_question_lets_its_call_through_once() {
        let key = key("browser_click", Some("a1"), Some("e7"));
        pushed("allowing", &key, ApprovalAnswer::Allowed);
        assert!(allowed("allowing", &key));
        assert!(!allowed("allowing", &key));
        pushed("allowing", &key, ApprovalAnswer::Allowed);
        assert!(!allowed("somebody", &key));
        assert!(!allowed("allowing", "browser_click:a1:e8"));
    }

    #[test]
    fn a_waiting_question_is_nobody_elses_to_read() {
        let id = pushed("reading", "k", ApprovalAnswer::Pending);
        assert!(status("reading", &id).is_some());
        assert!(status("other", &id).is_none());
        assert!(pending(Some("reading")).iter().any(|one| one.id == id));
    }

    #[test]
    fn a_question_names_the_verb_that_asked() {
        assert_eq!(verb_of("browser_click:a1:e7"), "browser_click");
        assert_eq!(verb_of(r#"edit_note:{"path":"a.md"}"#), "edit_note");
        assert_eq!(verb_of(""), "");
    }

    #[test]
    fn an_allowance_is_for_the_site_and_the_element_it_was_asked_about() {
        let asked = on_page(
            "browser_press:a1:Enter",
            "http://localhost:9/pay",
            "Pay now",
        );
        assert_ne!(
            asked,
            on_page(
                "browser_press:a1:Enter",
                "http://127.0.0.1:9/pay",
                "Pay now"
            )
        );
        assert_ne!(
            asked,
            on_page(
                "browser_press:a1:Enter",
                "http://localhost:9/pay",
                "Delete account"
            )
        );
        assert_eq!(
            asked,
            on_page(
                "browser_press:a1:Enter",
                "http://localhost:9/other",
                "Pay  now"
            )
        );
        assert_eq!(verb_of(&asked), "browser_press");
    }

    #[test]
    fn a_key_names_the_verb_the_tab_and_the_element() {
        assert_eq!(
            key("browser_click", Some("a1"), Some("e7")),
            "browser_click:a1:e7"
        );
        assert_eq!(key("browser_show", Some("a1"), None), "browser_show:a1:");
    }
}
