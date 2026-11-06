use serde::Deserialize;

use super::grants::{Grant, Mode, SiteRule};
use super::verbs::{Category, DialogKind, Store};

pub fn host_of(url: &str) -> Option<String> {
    let parsed: tauri::Url = url.parse().ok()?;
    parsed
        .host_str()
        .map(|host| host.trim_end_matches('.').to_lowercase())
}

pub fn on_the_web(url: &str) -> bool {
    if url.is_empty() {
        return true;
    }
    let Ok(parsed) = url.parse::<tauri::Url>() else {
        return false;
    };
    match parsed.scheme() {
        "http" | "https" => !parsed.host_str().is_some_and(crate::web_tabs::app_host),
        "blob" => true,
        "about" => parsed.as_str() == "about:blank",
        _ => false,
    }
}

const SHARED_HOSTS: &[&str] = &[
    "github.io",
    "gitlab.io",
    "pages.dev",
    "workers.dev",
    "vercel.app",
    "netlify.app",
    "web.app",
    "firebaseapp.com",
    "herokuapp.com",
    "onrender.com",
    "fly.dev",
    "azurewebsites.net",
    "cloudfront.net",
    "s3.amazonaws.com",
    "blogspot.com",
    "wordpress.com",
    "notion.site",
    "glitch.me",
    "surge.sh",
    "ngrok.io",
    "ngrok.app",
    "ngrok-free.app",
    "repl.co",
];

pub fn site_of(host: &str) -> String {
    let host = host.trim_end_matches('.').to_lowercase();
    if host.parse::<std::net::IpAddr>().is_ok() || !host.contains('.') {
        return host;
    }
    let labels: Vec<&str> = host.split('.').collect();
    if let Some(shared) = SHARED_HOSTS
        .iter()
        .find(|one| host.ends_with(&format!(".{one}")))
    {
        return labels[labels.len() - shared.split('.').count() - 1..].join(".");
    }
    let keep = match labels.as_slice() {
        [.., second, top]
            if top.len() == 2
                && matches!(
                    *second,
                    "co" | "com"
                        | "org"
                        | "net"
                        | "ac"
                        | "gov"
                        | "edu"
                        | "or"
                        | "ne"
                        | "go"
                        | "gob"
                        | "nic"
                        | "mil"
                        | "ltd"
                        | "plc"
                ) =>
        {
            3
        }
        _ => 2,
    };
    labels[labels.len().saturating_sub(keep)..].join(".")
}

pub fn rule_for(grant: &Grant, host: &str) -> Option<SiteRule> {
    grant
        .sites
        .iter()
        .filter(|(site, _)| covers(site, host))
        .max_by_key(|(site, _)| site.len())
        .map(|(_, rule)| *rule)
}

fn covers(site: &str, host: &str) -> bool {
    let site = named(site.trim().trim_start_matches("*."));
    let host = host.trim_end_matches('.');
    !site.is_empty() && (host == site || host.ends_with(&format!(".{site}")))
}

fn named(site: &str) -> String {
    let site = site.trim_end_matches('.');
    format!("http://{site}/")
        .parse::<tauri::Url>()
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| site.to_owned())
        .trim_end_matches('.')
        .to_lowercase()
}

pub fn site_allowed(grant: &Grant, url: &str, store: Store) -> Result<(), String> {
    if url.starts_with("chrome-error:") {
        return Ok(());
    }
    if !on_the_web(url) {
        return Err(format!("an agent stays on the web, and {url} is not on it"));
    }
    let Some(host) = host_of(url) else {
        return Ok(());
    };
    match rule_for(grant, &host) {
        Some(SiteRule::Deny) => Err(format!("{} is denied to this agent", site_of(&host))),
        Some(SiteRule::AgentStore) if store != Store::Agent => Err(format!(
            "{} is only for this agent's own store: open it with store \"agent\"",
            site_of(&host)
        )),
        _ => Ok(()),
    }
}

pub fn frame_allowed(grant: &Grant, at: &[String], store: Store) -> Result<(), String> {
    let Some(host) = at.iter().find_map(|one| {
        tauri::Url::parse(one)
            .ok()
            .filter(|url| matches!(url.scheme(), "http" | "https"))
            .and_then(|_| host_of(one))
    }) else {
        return Ok(());
    };
    match rule_for(grant, &host) {
        Some(SiteRule::Deny) => Err(format!("{} is denied to this agent", site_of(&host))),
        Some(SiteRule::AgentStore) if store != Store::Agent => Err(format!(
            "{} is only for this agent's own store",
            site_of(&host)
        )),
        _ => Ok(()),
    }
}

pub fn site_allowed_for(agent: &str, url: &str, store: Store) -> Result<(), String> {
    match super::grants::cached(agent) {
        Some(grant) => site_allowed(&grant, url, store),
        None => Ok(()),
    }
}

pub fn script_allowed(grant: &Grant, host: &str) -> bool {
    grant.asks_nothing() || grant.scripts.iter().any(|site| covers(site, host))
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "four things the page reports apart - submits, follows a link, takes words, in a form - which the policy reads one at a time, in every combination"
)]
pub struct Facts {
    pub tag: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub autocomplete: String,
    pub submit: bool,
    pub link: bool,
    pub editable: bool,
    pub in_form: bool,
    pub fields: Vec<Field>,
    pub control: bool,
    pub dialog: String,
    pub held: Vec<String>,
    pub cut: bool,
    pub at: Vec<String>,
    pub field: Field,
    pub default_button: String,
    pub opaque: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Field {
    #[serde(rename = "type")]
    pub kind: String,
    pub autocomplete: String,
    pub said: String,
    pub label: String,
    pub masked: bool,
    pub mentions: bool,
}

impl Facts {
    pub fn password(&self) -> bool {
        self.kind == "password" || credential(&self.field)
    }

    pub fn sign_in(&self) -> bool {
        self.in_form && self.fields.iter().any(credential)
    }

    pub fn card_form(&self) -> bool {
        self.in_form && self.fields.iter().any(card_field)
    }

    pub fn sensitive(&self) -> bool {
        self.password()
            || secret(&self.field)
            || secret(&Field {
                kind: self.kind.clone(),
                autocomplete: self.autocomplete.clone(),
                said: self.name.clone(),
                ..Field::default()
            })
    }

    pub fn pressable(&self) -> bool {
        !self.editable && !matches!(self.tag.as_str(), "" | "body" | "html")
    }

    pub fn picker(&self) -> bool {
        self.tag == "select"
            || (self.tag == "input"
                && matches!(
                    self.kind.as_str(),
                    "date" | "datetime-local" | "month" | "week" | "time" | "color"
                ))
    }
}

fn card_field(field: &Field) -> bool {
    if field.autocomplete.split_whitespace().any(|one| {
        matches!(
            one,
            "cc-number" | "cc-csc" | "cc-exp" | "cc-exp-month" | "cc-exp-year"
        )
    }) {
        return true;
    }
    let said = field.said.to_lowercase();
    CARD.iter().any(|one| said.contains(one))
        || (says(&plain_said(&field.said), CARD_WORDS) && !says(&said, NO_PAYMENT_CARD))
}

fn plain_said(said: &str) -> String {
    let mut plain = String::with_capacity(said.len() + 4);
    let mut lower = false;
    for one in said.chars() {
        if lower && one.is_uppercase() {
            plain.push(' ');
        }
        lower = one.is_lowercase();
        plain.push(if matches!(one, '-' | '_') { ' ' } else { one });
    }
    plain
}

fn one_time(field: &Field) -> bool {
    if field
        .autocomplete
        .split_whitespace()
        .any(|one| one == "postal-code")
    {
        return false;
    }
    let said = plain_said(&field.said);
    if says(&said, ONE_TIME)
        || alone(&plain_said(&field.label), ONE_TIME_ALONE)
        || alone(&said, ONE_TIME_ALONE)
    {
        return true;
    }
    said.trim() == "tan"
        || said
            .split(|one: char| !one.is_alphanumeric())
            .map(|word| word.trim_end_matches(|one: char| one.is_ascii_digit()))
            .any(|word| {
                word.ends_with("TAN")
                    || word.eq_ignore_ascii_case("otp")
                    || (word.eq_ignore_ascii_case("pin") && !body(field) && !says(&said, NOT_A_PIN))
            })
}

const NOT_A_PIN: &[&str] = &[
    "pin to",
    "pin notes",
    "pin note",
    "pin this",
    "pin it",
    "pin on",
    "pin board",
];

fn credential(field: &Field) -> bool {
    field.kind == "password"
        || field.masked
        || field
            .autocomplete
            .split_whitespace()
            .any(|one| matches!(one, "current-password" | "new-password"))
}

pub fn secret(field: &Field) -> bool {
    credential(field)
        || field
            .autocomplete
            .split_whitespace()
            .any(|one| one.starts_with("cc-") || one == "one-time-code")
        || card_field(field)
        || one_time(field)
}

fn body(field: &Field) -> bool {
    matches!(field.kind.as_str(), "textarea" | "editable")
}

fn addressed(field: &Field) -> bool {
    matches!(field.kind.as_str(), "email" | "tel")
        || field
            .autocomplete
            .split_whitespace()
            .any(|one| one == "email" || one == "tel" || one.starts_with("tel-"))
        || alone(&field.label, ADDRESSED_ALONE)
        || says(&field.said, RECIPIENTS)
        || (body(field) && field.mentions)
}

fn message_box(field: &Field) -> bool {
    body(field) && says(&field.said, MESSAGES)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Sends {
    ByWords,
    ByShape,
}

fn sends(facts: &Facts, act: Act, host: &str) -> Option<Sends> {
    if facts.sign_in() {
        return None;
    }
    let social = social(host);
    let writing = facts.fields.iter().any(body);
    let to_somebody = facts.fields.iter().any(addressed);
    let composed = facts.submit && writing && to_somebody;
    match act {
        Act::Write => None,
        Act::Press => {
            let worded = !facts.editable
                && !facts.link
                && ((says_sending(&facts.name) && (social || writing || to_somebody))
                    || (says(&facts.name, SUBMITTING) && (social || writing)));
            if worded {
                Some(Sends::ByWords)
            } else {
                composed.then_some(Sends::ByShape)
            }
        }
        Act::Enter => {
            let own = &facts.field;
            let sent = if body(own) {
                social || message_box(own)
            } else {
                composed
            };
            sent.then_some(Sends::ByShape)
        }
    }
}

fn says_sending(name: &str) -> bool {
    (says(name, SENDING) || alone(name, SENDING_ALONE)) && !says(name, NOT_SENDING)
}

pub fn credential_act(facts: &Facts, act: Act) -> bool {
    signs_in(facts, act) || (act == Act::Write && (facts.password() || facts.sign_in()))
}

pub fn signs_in(facts: &Facts, act: Act) -> bool {
    match act {
        Act::Write => false,
        Act::Enter => facts.sign_in() || facts.password(),
        Act::Press => {
            (facts.submit && facts.sign_in())
                || (!facts.editable
                    && !facts.link
                    && says(&facts.name, SIGNING_IN)
                    && facts.fields.iter().any(credential))
        }
    }
}

fn alone(name: &str, words: &[&str]) -> bool {
    let name = name
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches([':', '\u{ff1a}'])
        .trim()
        .to_lowercase();
    !name.is_empty() && words.contains(&name.as_str())
}

pub struct Question {
    pub category: Category,
    pub summary: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    Press,
    Enter,
    Write,
}

pub fn judge(
    grant: &Grant,
    facts: &Facts,
    act: Act,
    url: &str,
    hosts: &[String],
) -> Option<Question> {
    let host = host_of(url).unwrap_or_default();
    let site = site_of(&host);
    let label = if act == Act::Enter || (secret(&facts.field) && facts.name != facts.field.label) {
        String::new()
    } else {
        short(&facts.name)
    };
    let ask = |category: Category, summary: String| {
        (grant.asks(category) && !grant.always(&site, category))
            .then_some(Question { category, summary })
    };

    if credential_act(facts, act) {
        if let Some(question) = ask(Category::SigningIn, on(&label, "Sign in", &site)) {
            return Some(question);
        }
    }

    let is_a_press = (facts.submit && !facts.default_button.is_empty()) || !facts.dialog.is_empty();
    if act == Act::Enter && is_a_press && !body(&facts.field) {
        let pressed = Facts {
            name: facts.default_button.clone(),
            editable: false,
            link: false,
            default_button: String::new(),
            ..facts.clone()
        };
        if let Some(question) = judge(grant, &pressed, Act::Press, url, hosts) {
            return Some(question);
        }
    }

    if act != Act::Write {
        let paying = facts.card_form()
            || says(&facts.name, PAYING)
            || (facts.submit && hosts.iter().any(|one| payment_host(one)));
        if paying {
            if let Some(question) = ask(Category::Paying, on(&label, "Pay", &site)) {
                return Some(question);
            }
        }
        if let Some(how) = sends(facts, act, &host) {
            let said = if how == Sends::ByWords {
                label.as_str()
            } else {
                ""
            };
            if let Some(question) = ask(Category::Sending, on(said, "Send", &site)) {
                return Some(question);
            }
        }
    }
    if act == Act::Press && !facts.link && says(&facts.name, DELETING) {
        if let Some(question) = ask(Category::Deleting, on(&label, "Delete", &site)) {
            return Some(question);
        }
    }

    if act == Act::Press && !facts.link && !facts.editable {
        for (words, inflected, category, fallback) in [
            (PAYING, DIALOG_PAYING, Category::Paying, "Pay"),
            (DELETING, DIALOG_DELETING, Category::Deleting, "Delete"),
        ] {
            let Some(said) = mention(&facts.dialog, words, inflected) else {
                continue;
            };
            if dismisses(&facts.name)
                || (category == Category::Deleting && alone(&facts.name, KEEPING))
            {
                continue;
            }
            if let Some(question) = ask(category, on(&short(said), fallback, &site)) {
                return Some(question);
            }
        }
    }

    if act == Act::Press && (facts.opaque || (facts.cut && facts.submit)) {
        if let Some(question) = ask(Category::Unread, on("", "A press", &site)) {
            return Some(question);
        }
    }

    (grant.mode == Mode::Confirm)
        .then(|| {
            let what = if label.is_empty() {
                "a change".to_string()
            } else {
                format!("\u{201c}{label}\u{201d}")
            };
            ask(Category::Writing, format!("{what} on {site}"))
        })
        .flatten()
}

pub fn key_act(mut facts: Facts, key: &super::keys::Key) -> Option<(Facts, Act)> {
    if key.presses() && facts.pressable() {
        let its_own_submit = matches!(facts.kind.as_str(), "submit" | "image" | "button" | "reset");
        if key.submits() && facts.tag == "input" && !its_own_submit {
            facts.submit = facts.in_form;
            return Some((facts, Act::Enter));
        }
        return Some((facts, Act::Press));
    }
    if !(key.sends() || key.submits()) {
        return None;
    }
    facts.submit = facts.in_form && key.submits();
    let enter = key.sends() || (key.submits() && !body(&facts.field));
    Some((facts, if enter { Act::Enter } else { Act::Press }))
}

pub fn of_a_drag<'a>(
    grant: &Grant,
    from: &'a Facts,
    to: &'a Facts,
    url: &str,
    hosts: &[String],
) -> &'a Facts {
    if !to.control {
        return from;
    }
    let category = |facts| judge(grant, facts, Act::Press, url, hosts).map(|one| one.category);
    match (category(from), category(to)) {
        (None, Some(_)) => to,
        (Some(Category::Writing), Some(other)) if other != Category::Writing => to,
        _ => from,
    }
}

pub fn answering(
    grant: &Grant,
    kind: DialogKind,
    accept: bool,
    url: &str,
    message: &str,
) -> Option<Question> {
    if !accept {
        return None;
    }
    let site = site_of(&host_of(url).unwrap_or_default());
    let ask = |category: Category, summary: String| {
        (grant.asks(category) && !grant.always(&site, category))
            .then_some(Question { category, summary })
    };
    if kind.signs_in() {
        return ask(Category::SigningIn, on("", "Sign in", &site));
    }
    if !matches!(kind, DialogKind::Confirm | DialogKind::Prompt) {
        return None;
    }
    let said = format!("The page says \u{201c}{}\u{201d}", short(message));
    if says(message, PAYING) {
        if let Some(question) = ask(Category::Paying, on(&said, "Pay", &site)) {
            return Some(question);
        }
    }
    if says_sending(message) {
        if let Some(question) = ask(Category::Sending, on(&said, "Send", &site)) {
            return Some(question);
        }
    }
    if says(message, DELETING) {
        return ask(Category::Deleting, on(&said, "Delete", &site));
    }
    None
}

fn on(label: &str, fallback: &str, site: &str) -> String {
    let what = if label.is_empty() { fallback } else { label };
    format!("{what} on {site}")
}

fn short(name: &str) -> String {
    let flat = name.split_whitespace().collect::<Vec<_>>().join(" ");
    match flat.char_indices().nth(60) {
        Some((at, _)) => format!("{}\u{2026}", &flat[..at]),
        None => flat,
    }
}

pub fn says(name: &str, words: &[&str]) -> bool {
    let name = name.to_lowercase();
    words.iter().any(|word| {
        if !spaced(word) {
            return name.contains(word);
        }
        name.match_indices(word).any(|(at, found)| {
            let before = name[..at].chars().next_back();
            let after = name[at + found.len()..].chars().next();
            before.is_none_or(|one| !one.is_alphanumeric())
                && after.is_none_or(|one| !one.is_alphanumeric())
        })
    })
}

fn spaced(word: &str) -> bool {
    !word.chars().any(|one| {
        matches!(u32::from(one),
            0x0E00..=0x0EFF
            | 0x1000..=0x109F
            | 0x1100..=0x11FF
            | 0x2E80..=0x9FFF
            | 0xAC00..=0xD7AF
            | 0xF900..=0xFAFF
            | 0x0900..=0x0DFF
        )
    })
}

pub fn payment_host(host: &str) -> bool {
    PAYMENT_HOSTS.iter().any(|one| covers(one, host))
}

pub fn social(host: &str) -> bool {
    SOCIAL.iter().any(|one| covers(one, host))
}

const ONE_TIME: &[&str] = &[
    "otp",
    "otpcode",
    "totp",
    "one time code",
    "one time password",
    "one time passcode",
    "one time pin",
    "onetime code",
    "onetime password",
    "onetimecode",
    "onetimepassword",
    "verification code",
    "verificationcode",
    "verify code",
    "digit code",
    "digit 1",
    "digit 2",
    "digit 3",
    "digit 4",
    "digit 5",
    "digit 6",
    "2fa",
    "two factor",
    "mfa",
    "authenticator code",
    "auth code",
    "authentication code",
    "sms code",
    "login code",
    "sign in code",
    "recovery code",
    "backup code",
    "enter code",
    "your code",
    "einmal code",
    "two step code",
    "security key",
    "code we sent",
    "code you received",
    "pincode",
    "pin code",
    "pin number",
    "passcode",
    "best\u{e4}tigungs code",
    "best\u{e4}tigungscode",
    "einmalcode",
    "einmalpasswort",
    "sicherheitscode",
    "zugangscode",
    "anmeldecode",
    "authentifizierungscode",
    "geheimzahl",
    "code de v\u{e9}rification",
    "c\u{f3}digo de verificaci\u{f3}n",
    "codice di verifica",
];

const ONE_TIME_ALONE: &[&str] = &["code", "otp", "pin", "one time", "authenticator"];

const CARD_WORDS: &[&str] = &[
    "card no",
    "cardno",
    "card num",
    "credit card",
    "mm/yy",
    "mm / yy",
    "mm/jj",
    "mm/aa",
];

const NO_PAYMENT_CARD: &[&str] = &[
    "library",
    "loyalty",
    "member",
    "membership",
    "student",
    "health",
    "insurance",
    "id card",
    "gift",
];

const DISMISSING: &[&str] = &[
    "cancel",
    "close",
    "close dialog",
    "close modal",
    "close window",
    "close popup",
    "dismiss",
    "no",
    "stay",
    "stay here",
    "continue shopping",
    "not now",
    "back",
    "go back",
    "never mind",
    "got it",
    "accept cookies",
    "accept all cookies",
    "allow cookies",
    "allow all cookies",
    "reject",
    "reject all",
    "decline",
    "learn more",
    "more info",
    "details",
    "next page",
    "previous page",
    "skip",
    "later",
    "maybe later",
    "x",
    "\u{d7}",
    "\u{2715}",
    "abbrechen",
    "schlie\u{df}en",
    "nein",
    "zur\u{fc}ck",
    "sp\u{e4}ter",
    "verstanden",
    "alle cookies akzeptieren",
    "annuler",
    "fermer",
    "non",
    "cancelar",
    "cerrar",
    "annulla",
    "chiudi",
    "annuleren",
    "sluiten",
    "fechar",
    "\u{30ad}\u{30e3}\u{30f3}\u{30bb}\u{30eb}",
    "\u{9589}\u{3058}\u{308b}",
    "\u{53d6}\u{6d88}",
    "\u{5173}\u{95ed}",
    "\u{43e}\u{442}\u{43c}\u{435}\u{43d}\u{430}",
    "\u{437}\u{430}\u{43a}\u{440}\u{44b}\u{442}\u{44c}",
];

const KEEPING: &[&str] = &["keep", "behalten", "garder"];

fn dismisses(name: &str) -> bool {
    if alone(name, DISMISSING) {
        return true;
    }
    let name = name.trim_matches(|one: char| !one.is_alphanumeric());
    let words: Vec<&str> = name.split_whitespace().collect();
    let (half, other) = words.split_at(words.len() / 2);
    let half = half.join(" ");
    if half.eq_ignore_ascii_case(&other.join(" ")) && alone(&half, DISMISSING) {
        return true;
    }
    let (first, rest) = name.split_once(',').unwrap_or((name, ""));
    alone(first, DISMISSING)
        && !talks_of(rest, PAYING, DIALOG_PAYING)
        && !talks_of(rest, DELETING, DIALOG_DELETING)
}

const DIALOG_DELETING: &[&str] = &[
    "deletion",
    "terminated",
    "terminates",
    "terminating",
    "wipes",
    "wiped",
    "wiping",
    "destroyed",
    "destroys",
    "destroying",
    "discard",
    "discards",
    "discarded",
    "discarding",
    "eliminada",
    "eliminados",
    "eliminadas",
    "borrada",
    "supprim\u{e9}s",
    "supprim\u{e9}es",
    "deleted",
    "deletes",
    "deleting",
    "removed",
    "removes",
    "removing",
    "erased",
    "erases",
    "erasing",
    "gel\u{f6}scht",
    "entfernt",
    "supprim\u{e9}",
    "supprim\u{e9}e",
    "eliminado",
    "borrado",
    "eliminato",
    "cancellato",
    "rimosso",
];
const DIALOG_PAYING: &[&str] = &[
    "debited",
    "debits",
    "charged",
    "charge",
    "billed",
    "paid",
    "paying",
    "payment",
    "purchased",
    "bezahlt",
    "zahlung",
];

const IN_ANOTHER_SENSE: &[&str] = &[
    "free of charge",
    "no charge",
    "without charge",
    "in charge",
    "pay attention",
];

const ONLY_AS_A_NAME: &[&str] = &["saya"];

fn talks_of(said: &str, words: &[&str], inflected: &[&str]) -> bool {
    let mut said = said.to_lowercase();
    for phrase in IN_ANOTHER_SENSE {
        said = said.replace(phrase, " ");
    }
    words
        .iter()
        .chain(inflected)
        .filter(|word| !ONLY_AS_A_NAME.contains(word))
        .any(|word| says(&said, &[word]))
}

fn stops(dialog: &str) -> impl Iterator<Item = usize> + '_ {
    dialog.char_indices().filter_map(|(at, one)| {
        let end = at + one.len_utf8();
        (matches!(one, '.' | '!' | '?' | '\u{ff1f}')
            && dialog[end..].chars().next().is_none_or(char::is_whitespace))
        .then_some(end)
    })
}

fn mention<'d>(dialog: &'d str, words: &[&str], inflected: &[&str]) -> Option<&'d str> {
    if !talks_of(dialog, words, inflected) {
        return None;
    }
    let mut start = 0;
    for end in stops(dialog) {
        let sentence = dialog[start..end].trim();
        if talks_of(sentence, words, inflected) {
            return Some(sentence);
        }
        start = end;
    }
    Some(dialog[start..].trim())
}

fn starts_with_any(line: &str, words: &[&str]) -> bool {
    let line = line.trim().to_lowercase();
    words.iter().any(|word| {
        line.strip_prefix(word)
            .is_some_and(|rest| !rest.chars().next().is_some_and(char::is_alphanumeric))
    })
}

pub fn leads(line: &str) -> bool {
    line.split_whitespace().count() <= 4
        && (starts_with_any(line, PAYING) || starts_with_any(line, DELETING))
}

const CARD: &[&str] = &[
    "cardnumber",
    "card-number",
    "card_number",
    "card number",
    "ccnum",
    "cc-num",
    "cc_num",
    "creditcard",
    "credit-card",
    "credit card",
    "cvc",
    "cvv",
    "csc",
    "securitycode",
    "security code",
    "security-code",
    "card verification",
    "expiry",
    "expiration",
    "exp-date",
    "exp_date",
    "expdate",
    "valid thru",
    "kartennummer",
    "kreditkarte",
    "pr\u{fc}fnummer",
    "ablaufdatum",
    "g\u{fc}ltig bis",
    "num\u{e9}ro de carte",
    "cryptogramme",
    "date d'expiration",
    "n\u{fa}mero de tarjeta",
    "fecha de caducidad",
    "c\u{f3}digo de seguridad",
    "numero della carta",
    "codice di sicurezza",
    "n\u{fa}mero do cart\u{e3}o",
    "c\u{f3}digo de seguran\u{e7}a",
    "numer karty",
    "\u{43d}\u{43e}\u{43c}\u{435}\u{440} \u{43a}\u{430}\u{440}\u{442}\u{44b}",
    "\u{43d}\u{43e}\u{43c}\u{435}\u{440} \u{43a}\u{430}\u{440}\u{442}\u{43a}\u{438}",
    "\u{30ab}\u{30fc}\u{30c9}\u{756a}\u{53f7}",
    "\u{30bb}\u{30ad}\u{30e5}\u{30ea}\u{30c6}\u{30a3}\u{30b3}\u{30fc}\u{30c9}",
    "\u{5361}\u{53f7}",
    "\u{5361}\u{865f}",
    "\u{5b89}\u{5168}\u{7801}",
    "\u{ce74}\u{b4dc} \u{bc88}\u{d638}",
    "kart numaras\u{131}",
    "s\u{1ed1} th\u{1ebb}",
    "nomor kartu",
];

pub const PAYING: &[&str] = &[
    "pay", "pay now", "buy", "buy now", "place order", "place your order", "checkout",
    "check out", "confirm purchase", "complete purchase", "complete order", "submit order",
    "confirm order", "purchase", "order now",
    "bezahlen", "jetzt bezahlen", "kaufen", "jetzt kaufen", "zahlungspflichtig bestellen",
    "kostenpflichtig bestellen", "bestellung abschlie\u{df}en", "kauf abschlie\u{df}en",
    "zur kasse", "zahle", "chaufe",
    "payer", "acheter", "commander", "passer la commande", "valider la commande",
    "confirmer l'achat", "finaliser la commande", "paiement",
    "pagar", "comprar", "realizar pedido", "finalizar compra", "confirmar compra",
    "tramitar pedido", "hacer pedido",
    "paga", "acquista", "compra", "effettua ordine", "conferma ordine",
    "procedi all'acquisto", "concludi ordine",
    "fazer pedido", "finalizar pedido", "encomendar",
    "zap\u{142}a\u{107}", "kup", "kup teraz", "zamawiam", "zam\u{f3}w",
    "z\u{142}\u{f3}\u{17c} zam\u{f3}wienie", "kupuj\u{119} i p\u{142}ac\u{119}",
    "\u{43e}\u{43f}\u{43b}\u{430}\u{442}\u{438}\u{442}\u{44c}", "\u{43a}\u{443}\u{43f}\u{438}\u{442}\u{44c}",
    "\u{43e}\u{444}\u{43e}\u{440}\u{43c}\u{438}\u{442}\u{44c} \u{437}\u{430}\u{43a}\u{430}\u{437}",
    "\u{437}\u{430}\u{43a}\u{430}\u{437}\u{430}\u{442}\u{44c}",
    "\u{43e}\u{43f}\u{43b}\u{430}\u{442}\u{438}\u{442}\u{438}", "\u{43a}\u{443}\u{43f}\u{438}\u{442}\u{438}",
    "\u{43e}\u{444}\u{43e}\u{440}\u{43c}\u{438}\u{442}\u{438} \u{437}\u{430}\u{43c}\u{43e}\u{432}\u{43b}\u{435}\u{43d}\u{43d}\u{44f}",
    "\u{437}\u{430}\u{43c}\u{43e}\u{432}\u{438}\u{442}\u{438}",
    "\u{f6}de", "\u{f6}deme yap", "sat\u{131}n al", "sipari\u{15f}i tamamla", "sipari\u{15f} ver",
    "bayar", "beli", "beli sekarang", "buat pesanan", "tuku", "magbayad", "bumili", "bilhin",
    "mag-order",
    "lipa", "nunua", "agiza", "biya", "saya", "\u{12ed}\u{12ad}\u{1348}\u{1209}", "\u{130d}\u{12db}",
    "\u{627}\u{62f}\u{641}\u{639}", "\u{62f}\u{641}\u{639}", "\u{634}\u{631}\u{627}\u{621}",
    "\u{627}\u{634}\u{62a}\u{631}", "\u{625}\u{62a}\u{645}\u{627}\u{645} \u{627}\u{644}\u{637}\u{644}\u{628}",
    "\u{62a}\u{623}\u{643}\u{64a}\u{62f} \u{627}\u{644}\u{637}\u{644}\u{628}",
    "\u{67e}\u{631}\u{62f}\u{627}\u{62e}\u{62a}", "\u{62e}\u{631}\u{6cc}\u{62f}",
    "\u{62b}\u{628}\u{62a} \u{633}\u{641}\u{627}\u{631}\u{634}", "\u{62a}\u{627}\u{62f}\u{6cc}\u{647}",
    "\u{627}\u{62f}\u{627}\u{626}\u{6cc}\u{6af}\u{6cc}", "\u{62e}\u{631}\u{6cc}\u{62f}\u{6cc}\u{6ba}",
    "\u{92d}\u{941}\u{917}\u{924}\u{93e}\u{928}", "\u{916}\u{930}\u{940}\u{926}\u{947}\u{902}",
    "\u{911}\u{930}\u{94d}\u{921}\u{930} \u{915}\u{930}\u{947}\u{902}", "\u{916}\u{930}\u{947}\u{926}\u{940}",
    "\u{9aa}\u{9c7}\u{9ae}\u{9c7}\u{9a8}\u{9cd}\u{99f}", "\u{995}\u{9bf}\u{9a8}\u{9c1}\u{9a8}",
    "\u{a9a}\u{ac1}\u{a95}\u{ab5}\u{aa3}\u{ac0}", "\u{a96}\u{ab0}\u{ac0}\u{aa6}\u{acb}",
    "\u{a2d}\u{a41}\u{a17}\u{a24}\u{a3e}\u{a28}", "\u{a16}\u{a30}\u{a40}\u{a26}\u{a4b}",
    "\u{b9a}\u{bc6}\u{bb2}\u{bc1}\u{ba4}\u{bcd}\u{ba4}\u{bc1}", "\u{bb5}\u{bbe}\u{b99}\u{bcd}\u{b95}\u{bc1}",
    "\u{c1a}\u{c46}\u{c32}\u{c4d}\u{c32}\u{c3f}\u{c02}\u{c1a}", "\u{c15}\u{c4a}\u{c28}\u{c41}\u{c17}\u{c4b}\u{c32}\u{c41}",
    "\u{caa}\u{cbe}\u{cb5}\u{ca4}\u{cbf}\u{cb8}\u{cbf}", "\u{c96}\u{cb0}\u{cc0}\u{ca6}\u{cbf}\u{cb8}\u{cbf}",
    "\u{d2a}\u{d23}\u{d2e}\u{d1f}\u{d2f}\u{d4d}\u{d15}\u{d4d}\u{d15}\u{d41}\u{d15}", "\u{d35}\u{d3e}\u{d19}\u{d4d}\u{d19}\u{d41}\u{d15}",
    "\u{e0a}\u{e33}\u{e23}\u{e30}\u{e40}\u{e07}\u{e34}\u{e19}", "\u{e2a}\u{e31}\u{e48}\u{e07}\u{e0b}\u{e37}\u{e49}\u{e2d}",
    "\u{1004}\u{103d}\u{1031}\u{1015}\u{1031}\u{1038}\u{1001}\u{103b}\u{1031}", "\u{101d}\u{101a}\u{103a}",
    "thanh to\u{e1}n", "mua ngay", "\u{111}\u{1eb7}t h\u{e0}ng", "\u{111}\u{1eb7}t mua",
    "\u{652f}\u{6255}", "\u{8cfc}\u{5165}", "\u{6ce8}\u{6587}\u{3059}\u{308b}", "\u{6ce8}\u{6587}\u{3092}\u{78ba}\u{5b9a}",
    "\u{30ec}\u{30b8}\u{306b}\u{9032}\u{3080}", "\u{acb0}\u{c81c}", "\u{ad6c}\u{b9e4}", "\u{c8fc}\u{bb38}\u{d558}\u{ae30}",
    "\u{652f}\u{4ed8}", "\u{4ed8}\u{6b3e}", "\u{8d2d}\u{4e70}", "\u{63d0}\u{4ea4}\u{8ba2}\u{5355}", "\u{7ed3}\u{7b97}",
    "\u{4e0b}\u{5355}", "\u{8cfc}\u{8cb7}", "\u{63d0}\u{4ea4}\u{8a02}\u{55ae}", "\u{7d50}\u{5e33}", "\u{4e0b}\u{55ae}",
    "\u{4fbe}\u{9322}", "\u{843d}\u{55ae}",
];

const SENDING: &[&str] = &[
    "send",
    "post",
    "reply",
    "publish",
    "comment",
    "tweet",
    "retweet",
    "repost",
    "reply all",
    "senden",
    "absenden",
    "abschicken",
    "schicken",
    "posten",
    "ver\u{f6}ffentlichen",
    "antworten",
    "kommentieren",
    "s\u{e4}nde",
    "schicke",
    "ver\u{f6}ffentliche",
    "antworte",
    "kommentiere",
    "envoyer",
    "publier",
    "r\u{e9}pondre",
    "poster",
    "commenter",
    "enviar",
    "publicar",
    "responder",
    "comentar",
    "invia",
    "inviare",
    "pubblica",
    "rispondi",
    "commenta",
    "wy\u{15b}lij",
    "prze\u{15b}lij",
    "opublikuj",
    "publikuj",
    "odpowiedz",
    "skomentuj",
    "\u{43e}\u{442}\u{43f}\u{440}\u{430}\u{432}\u{438}\u{442}\u{44c}",
    "\u{43e}\u{43f}\u{443}\u{431}\u{43b}\u{438}\u{43a}\u{43e}\u{432}\u{430}\u{442}\u{44c}",
    "\u{43e}\u{442}\u{432}\u{435}\u{442}\u{438}\u{442}\u{44c}",
    "\u{43f}\u{440}\u{43e}\u{43a}\u{43e}\u{43c}\u{43c}\u{435}\u{43d}\u{442}\u{438}\u{440}\u{43e}\u{432}\u{430}\u{442}\u{44c}",
    "\u{43a}\u{43e}\u{43c}\u{43c}\u{435}\u{43d}\u{442}\u{438}\u{440}\u{43e}\u{432}\u{430}\u{442}\u{44c}",
    "\u{43d}\u{430}\u{434}\u{456}\u{441}\u{43b}\u{430}\u{442}\u{438}",
    "\u{432}\u{456}\u{434}\u{43f}\u{440}\u{430}\u{432}\u{438}\u{442}\u{438}",
    "\u{43e}\u{43f}\u{443}\u{431}\u{43b}\u{456}\u{43a}\u{443}\u{432}\u{430}\u{442}\u{438}",
    "\u{432}\u{456}\u{434}\u{43f}\u{43e}\u{432}\u{456}\u{441}\u{442}\u{438}",
    "\u{43a}\u{43e}\u{43c}\u{435}\u{43d}\u{442}\u{443}\u{432}\u{430}\u{442}\u{438}",
    "g\u{f6}nder",
    "yay\u{131}nla",
    "yay\u{131}mla",
    "yan\u{131}tla",
    "yorum yap",
    "kirim",
    "hantar",
    "terbitkan",
    "siarkan",
    "balas",
    "komentari",
    "komen",
    "terbitake",
    "bales",
    "wangsuli",
    "ipadala",
    "ilathala",
    "sumagot",
    "tumugon",
    "i-post",
    "magkomento",
    "tuma",
    "chapisha",
    "jibu",
    "aika",
    "wallafa",
    "amsa",
    "\u{120b}\u{12ad}",
    "\u{12ed}\u{120b}\u{12a9}",
    "\u{12a0}\u{1233}\u{1275}\u{121d}",
    "\u{625}\u{631}\u{633}\u{627}\u{644}",
    "\u{623}\u{631}\u{633}\u{644}",
    "\u{646}\u{634}\u{631}",
    "\u{627}\u{646}\u{634}\u{631}",
    "\u{631}\u{62f}",
    "\u{627}\u{631}\u{633}\u{627}\u{644}",
    "\u{628}\u{641}\u{631}\u{633}\u{62a}",
    "\u{627}\u{646}\u{62a}\u{634}\u{627}\u{631}",
    "\u{67e}\u{627}\u{633}\u{62e}",
    "\u{644}\u{6d0}\u{696}\u{644}",
    "\u{62e}\u{67e}\u{631}\u{648}\u{644}",
    "\u{681}\u{648}\u{627}\u{628}",
    "\u{628}\u{6be}\u{6cc}\u{62c}\u{6cc}\u{6ba}",
    "\u{645}\u{646}\u{62a}\u{634}\u{631} \u{6a9}\u{646}",
    "\u{634}\u{627}\u{626}\u{639} \u{6a9}\u{631}\u{6cc}\u{6ba}",
    "\u{62c}\u{648}\u{627}\u{628} \u{62f}\u{6cc}\u{6ba}",
    "\u{92d}\u{947}\u{91c}\u{947}\u{902}",
    "\u{92d}\u{947}\u{91c}\u{94b}",
    "\u{92a}\u{94d}\u{930}\u{915}\u{93e}\u{936}\u{93f}\u{924}",
    "\u{91c}\u{935}\u{93e}\u{92c} \u{926}\u{947}\u{902}",
    "\u{91f}\u{93f}\u{92a}\u{94d}\u{92a}\u{923}\u{940} \u{915}\u{930}\u{947}\u{902}",
    "\u{92a}\u{93e}\u{920}\u{935}\u{93e}",
    "\u{909}\u{924}\u{94d}\u{924}\u{930} \u{926}\u{94d}\u{92f}\u{93e}",
    "\u{9aa}\u{9be}\u{9a0}\u{9be}\u{9a8}",
    "\u{9aa}\u{9cd}\u{9b0}\u{995}\u{9be}\u{9b6} \u{995}\u{9b0}\u{9c1}\u{9a8}",
    "\u{989}\u{9a4}\u{9cd}\u{9a4}\u{9b0} \u{9a6}\u{9bf}\u{9a8}",
    "\u{aae}\u{acb}\u{a95}\u{ab2}\u{acb}",
    "\u{aaa}\u{acd}\u{ab0}\u{a95}\u{abe}\u{ab6}\u{abf}\u{aa4} \u{a95}\u{ab0}\u{acb}",
    "\u{a9c}\u{ab5}\u{abe}\u{aac} \u{a86}\u{aaa}\u{acb}",
    "\u{a2d}\u{a47}\u{a1c}\u{a4b}",
    "\u{a1b}\u{a3e}\u{a2a}\u{a4b}",
    "\u{a1c}\u{a35}\u{a3e}\u{a2c} \u{a26}\u{a3f}\u{a13}",
    "\u{b85}\u{ba9}\u{bc1}\u{baa}\u{bcd}\u{baa}\u{bc1}",
    "\u{bb5}\u{bc6}\u{bb3}\u{bbf}\u{baf}\u{bbf}\u{b9f}\u{bc1}",
    "\u{baa}\u{ba4}\u{bbf}\u{bb2}\u{bb3}\u{bbf}",
    "\u{c2a}\u{c02}\u{c2a}\u{c41}",
    "\u{c2a}\u{c02}\u{c2a}\u{c02}\u{c21}\u{c3f}",
    "\u{c2a}\u{c4d}\u{c30}\u{c1a}\u{c41}\u{c30}\u{c3f}\u{c02}\u{c1a}\u{c41}",
    "\u{c2a}\u{c4d}\u{c30}\u{c24}\u{c4d}\u{c2f}\u{c41}\u{c24}\u{c4d}\u{c24}\u{c30}\u{c02}",
    "\u{c95}\u{cb3}\u{cc1}\u{cb9}\u{cbf}\u{cb8}\u{cbf}",
    "\u{caa}\u{ccd}\u{cb0}\u{c95}\u{c9f}\u{cbf}\u{cb8}\u{cbf}",
    "\u{c89}\u{ca4}\u{ccd}\u{ca4}\u{cb0}\u{cbf}\u{cb8}\u{cbf}",
    "\u{d05}\u{d2f}\u{d2f}\u{d4d}\u{d15}\u{d4d}\u{d15}\u{d41}\u{d15}",
    "\u{d2a}\u{d4d}\u{d30}\u{d38}\u{d3f}\u{d26}\u{d4d}\u{d27}\u{d40}\u{d15}\u{d30}\u{d3f}\u{d15}\u{d4d}\u{d15}\u{d41}\u{d15}",
    "\u{d2e}\u{d31}\u{d41}\u{d2a}\u{d1f}\u{d3f}",
    "\u{e2a}\u{e48}\u{e07}\u{e02}\u{e49}\u{e2d}\u{e04}\u{e27}\u{e32}\u{e21}",
    "\u{e42}\u{e1e}\u{e2a}\u{e15}\u{e4c}",
    "\u{e40}\u{e1c}\u{e22}\u{e41}\u{e1e}\u{e23}\u{e48}",
    "\u{e15}\u{e2d}\u{e1a}\u{e01}\u{e25}\u{e31}\u{e1a}",
    "\u{1015}\u{102d}\u{102f}\u{1037}\u{101b}\u{1014}\u{103a}",
    "\u{1011}\u{102f}\u{1010}\u{103a}\u{1015}\u{103c}\u{1014}\u{103a}",
    "\u{1015}\u{103c}\u{1014}\u{103a}\u{1005}\u{102c}",
    "g\u{1eed}i",
    "xu\u{1ea5}t b\u{1ea3}n",
    "tr\u{1ea3} l\u{1edd}i",
    "b\u{ec}nh lu\u{1ead}n",
    "\u{9001}\u{4fe1}",
    "\u{6295}\u{7a3f}",
    "\u{8fd4}\u{4fe1}",
    "\u{516c}\u{958b}\u{3059}\u{308b}",
    "\u{bcf4}\u{b0b4}\u{ae30}",
    "\u{c804}\u{c1a1}",
    "\u{ac8c}\u{c2dc}\u{d558}\u{ae30}",
    "\u{b2f5}\u{c7a5}",
    "\u{b313}\u{ae00} \u{b2ec}\u{ae30}",
    "\u{53d1}\u{9001}",
    "\u{53d1}\u{5e03}",
    "\u{53d1}\u{8868}",
    "\u{56de}\u{590d}",
    "\u{767c}\u{9001}",
    "\u{50b3}\u{9001}",
    "\u{767c}\u{4f48}",
    "\u{767c}\u{5e03}",
    "\u{767c}\u{8868}",
    "\u{56de}\u{8986}",
    "\u{9001}\u{51fa}",
];

const SENDING_ALONE: &[&str] = &[
    "\u{e2a}\u{e48}\u{e07}",
    "\u{111}\u{103}ng",
    "\u{1015}\u{102d}\u{102f}\u{1037}",
    "\u{ac8c}\u{c2dc}",
    "\u{516c}\u{958b}",
    "\u{9001}\u{308b}",
];

const NOT_SENDING: &[&str] = &["post code", "post office"];

const SUBMITTING: &[&str] = &[
    "submit",
    "soumettre",
    "submeter",
    "einreichen",
    "\u{fc}bermitteln",
    "\u{63d0}\u{4ea4}",
    "\u{63d0}\u{51fa}",
    "\u{c81c}\u{cd9c}",
];

const RECIPIENTS: &[&str] = &[
    "recipient",
    "recipients",
    "empf\u{e4}nger",
    "destinataire",
    "destinataires",
    "destinatario",
    "destinatarios",
    "destinatari",
    "destinat\u{e1}rio",
    "destinat\u{e1}rios",
    "odbiorca",
    "odbiorcy",
    "\u{43f}\u{43e}\u{43b}\u{443}\u{447}\u{430}\u{442}\u{435}\u{43b}\u{44c}",
    "\u{43f}\u{43e}\u{43b}\u{443}\u{447}\u{430}\u{442}\u{435}\u{43b}\u{438}",
    "\u{430}\u{434}\u{440}\u{435}\u{441}\u{430}\u{442}",
    "\u{43e}\u{434}\u{435}\u{440}\u{436}\u{443}\u{432}\u{430}\u{447}",
    "\u{43e}\u{442}\u{440}\u{438}\u{43c}\u{443}\u{432}\u{430}\u{447}",
    "al\u{131}c\u{131}",
    "al\u{131}c\u{131}lar",
    "penerima",
    "tatanggap",
    "mpokeaji",
    "\u{1270}\u{1240}\u{1263}\u{12ed}",
    "\u{627}\u{644}\u{645}\u{633}\u{62a}\u{644}\u{645}",
    "\u{627}\u{644}\u{645}\u{633}\u{62a}\u{644}\u{645}\u{64a}\u{646}",
    "\u{6af}\u{6cc}\u{631}\u{646}\u{62f}\u{647}",
    "\u{648}\u{635}\u{648}\u{644} \u{6a9}\u{646}\u{646}\u{62f}\u{6c1}",
    "\u{92a}\u{94d}\u{930}\u{93e}\u{92a}\u{94d}\u{924}\u{915}\u{930}\u{94d}\u{924}\u{93e}",
    "\u{9aa}\u{9cd}\u{9b0}\u{9be}\u{9aa}\u{995}",
    "\u{aaa}\u{acd}\u{ab0}\u{abe}\u{aaa}\u{acd}\u{aa4}\u{a95}\u{ab0}\u{acd}\u{aa4}\u{abe}",
    "\u{a2a}\u{a4d}\u{a30}\u{a3e}\u{a2a}\u{a24}\u{a15}\u{a30}\u{a24}\u{a3e}",
    "\u{baa}\u{bc6}\u{bb1}\u{bc1}\u{ba8}\u{bb0}\u{bcd}",
    "\u{c17}\u{c4d}\u{c30}\u{c39}\u{c40}\u{c24}",
    "\u{cb8}\u{ccd}\u{cb5}\u{cc0}\u{c95}\u{cb0}\u{cbf}\u{cb8}\u{cc1}\u{cb5}\u{cb5}\u{cb0}\u{cc1}",
    "\u{d38}\u{d4d}\u{d35}\u{d40}\u{d15}\u{d7c}\u{d24}\u{d4d}\u{d24}\u{d3e}\u{d35}\u{d4d}",
    "\u{e1c}\u{e39}\u{e49}\u{e23}\u{e31}\u{e1a}",
    "\u{101c}\u{1000}\u{103a}\u{1001}\u{1036}\u{101e}\u{1030}",
    "ng\u{1b0}\u{1edd}i nh\u{1ead}n",
    "\u{5b9b}\u{5148}",
    "\u{bc1b}\u{b294} \u{c0ac}\u{b78c}",
    "\u{c218}\u{c2e0}\u{c790}",
    "\u{6536}\u{4ef6}\u{4eba}",
    "\u{6536}\u{4ef6}\u{8005}",
];

const ADDRESSED_ALONE: &[&str] = &[
    "to",
    "cc",
    "bcc",
    "send to",
    "an",
    "\u{e0}",
    "a",
    "para",
    "do",
    "\u{43a}\u{43e}\u{43c}\u{443}",
    "kime",
    "kepada",
    "kwa",
    "\u{625}\u{644}\u{649}",
    "\u{628}\u{647}",
    "\u{62a}\u{647}",
    "\u{915}\u{94b}",
    "\u{92a}\u{94d}\u{930}\u{924}\u{93f}",
    "\u{9aa}\u{9cd}\u{9b0}\u{9a4}\u{9bf}",
    "\u{e16}\u{e36}\u{e07}",
    "\u{111}\u{1ebf}n",
];

const MESSAGES: &[&str] = &[
    "message",
    "reply",
    "comment",
    "chat",
    "nachricht",
    "antwort",
    "kommentar",
    "r\u{e9}ponse",
    "commentaire",
    "mensaje",
    "respuesta",
    "comentario",
    "messaggio",
    "risposta",
    "commento",
    "mensagem",
    "resposta",
    "coment\u{e1}rio",
    "wiadomo\u{15b}\u{107}",
    "odpowied\u{17a}",
    "komentarz",
    "\u{441}\u{43e}\u{43e}\u{431}\u{449}\u{435}\u{43d}\u{438}\u{435}",
    "\u{43e}\u{442}\u{432}\u{435}\u{442}",
    "\u{43a}\u{43e}\u{43c}\u{43c}\u{435}\u{43d}\u{442}\u{430}\u{440}\u{438}\u{439}",
    "\u{43f}\u{43e}\u{432}\u{456}\u{434}\u{43e}\u{43c}\u{43b}\u{435}\u{43d}\u{43d}\u{44f}",
    "\u{432}\u{456}\u{434}\u{43f}\u{43e}\u{432}\u{456}\u{434}\u{44c}",
    "\u{43a}\u{43e}\u{43c}\u{435}\u{43d}\u{442}\u{430}\u{440}",
    "mesaj",
    "yan\u{131}t",
    "yorum",
    "pesan",
    "balasan",
    "komentar",
    "mesej",
    "komen",
    "pesen",
    "mensahe",
    "sagot",
    "komento",
    "ujumbe",
    "jibu",
    "maoni",
    "sa\u{199}o",
    "amsa",
    "sharhi",
    "\u{1218}\u{120d}\u{12a5}\u{12ad}\u{1275}",
    "\u{12a0}\u{1235}\u{1270}\u{12eb}\u{12e8}\u{1275}",
    "\u{631}\u{633}\u{627}\u{644}\u{629}",
    "\u{627}\u{644}\u{631}\u{633}\u{627}\u{644}\u{629}",
    "\u{631}\u{62f}",
    "\u{62a}\u{639}\u{644}\u{64a}\u{642}",
    "\u{67e}\u{6cc}\u{627}\u{645}",
    "\u{67e}\u{627}\u{633}\u{62e}",
    "\u{646}\u{638}\u{631}",
    "\u{67e}\u{6cc}\u{63a}\u{627}\u{645}",
    "\u{681}\u{648}\u{627}\u{628}",
    "\u{62c}\u{648}\u{627}\u{628}",
    "\u{62a}\u{628}\u{635}\u{631}\u{6c1}",
    "\u{938}\u{902}\u{926}\u{947}\u{936}",
    "\u{91c}\u{935}\u{93e}\u{92c}",
    "\u{91f}\u{93f}\u{92a}\u{94d}\u{92a}\u{923}\u{940}",
    "\u{9ac}\u{9be}\u{9b0}\u{9cd}\u{9a4}\u{9be}",
    "\u{9ae}\u{9a8}\u{9cd}\u{9a4}\u{9ac}\u{9cd}\u{9af}",
    "\u{989}\u{9a4}\u{9cd}\u{9a4}\u{9b0}",
    "\u{ab8}\u{a82}\u{aa6}\u{ac7}\u{ab6}",
    "\u{a9f}\u{abf}\u{aaa}\u{acd}\u{aaa}\u{aa3}\u{ac0}",
    "\u{a38}\u{a41}\u{a28}\u{a47}\u{a39}\u{a3e}",
    "\u{a1f}\u{a3f}\u{a71}\u{a2a}\u{a23}\u{a40}",
    "\u{b9a}\u{bc6}\u{baf}\u{bcd}\u{ba4}\u{bbf}",
    "\u{b95}\u{bb0}\u{bc1}\u{ba4}\u{bcd}\u{ba4}\u{bc1}",
    "\u{c38}\u{c02}\u{c26}\u{c47}\u{c36}\u{c02}",
    "\u{c35}\u{c4d}\u{c2f}\u{c3e}\u{c16}\u{c4d}\u{c2f}",
    "\u{cb8}\u{c82}\u{ca6}\u{cc7}\u{cb6}",
    "\u{c95}\u{cbe}\u{cae}\u{cc6}\u{c82}\u{c9f}\u{ccd}",
    "\u{d38}\u{d28}\u{d4d}\u{d26}\u{d47}\u{d36}\u{d02}",
    "\u{d15}\u{d2e}\u{d28}\u{d4d}\u{d31}\u{d4d}",
    "\u{e02}\u{e49}\u{e2d}\u{e04}\u{e27}\u{e32}\u{e21}",
    "\u{e04}\u{e27}\u{e32}\u{e21}\u{e04}\u{e34}\u{e14}\u{e40}\u{e2b}\u{e47}\u{e19}",
    "\u{e15}\u{e2d}\u{e1a}\u{e01}\u{e25}\u{e31}\u{e1a}",
    "\u{1019}\u{1000}\u{103a}\u{1006}\u{1031}\u{1037}\u{1001}\u{103b}\u{103a}",
    "\u{1019}\u{103e}\u{1010}\u{103a}\u{1001}\u{103b}\u{1000}\u{103a}",
    "tin nh\u{1eaf}n",
    "tr\u{1ea3} l\u{1edd}i",
    "b\u{ec}nh lu\u{1ead}n",
    "\u{30e1}\u{30c3}\u{30bb}\u{30fc}\u{30b8}",
    "\u{8fd4}\u{4fe1}",
    "\u{30b3}\u{30e1}\u{30f3}\u{30c8}",
    "\u{ba54}\u{c2dc}\u{c9c0}",
    "\u{b2f5}\u{c7a5}",
    "\u{b313}\u{ae00}",
    "\u{6d88}\u{606f}",
    "\u{4fe1}\u{606f}",
    "\u{56de}\u{590d}",
    "\u{8bc4}\u{8bba}",
    "\u{8a0a}\u{606f}",
    "\u{56de}\u{8986}",
    "\u{7559}\u{8a00}",
    "\u{8a55}\u{8ad6}",
];

const SIGNING_IN: &[&str] = &[
    "sign in",
    "log in",
    "login",
    "log on",
    "anmelden",
    "einloggen",
    "aamelde",
    "iilogge",
    "se connecter",
    "connexion",
    "iniciar sesi\u{f3}n",
    "iniciar sess\u{e3}o",
    "acceder",
    "entrar",
    "accedi",
    "zaloguj",
    "\u{432}\u{43e}\u{439}\u{442}\u{438}",
    "\u{443}\u{432}\u{456}\u{439}\u{442}\u{438}",
    "oturum a\u{e7}",
    "giri\u{15f} yap",
    "masuk",
    "mlebu",
    "mag-sign in",
    "mag-log in",
    "ingia",
    "shiga",
    "\u{130d}\u{1263}",
    "\u{62a}\u{633}\u{62c}\u{64a}\u{644} \u{627}\u{644}\u{62f}\u{62e}\u{648}\u{644}",
    "\u{648}\u{631}\u{648}\u{62f}",
    "\u{646}\u{646}\u{648}\u{62a}\u{644}",
    "\u{633}\u{627}\u{626}\u{646} \u{627}\u{646}",
    "\u{644}\u{627}\u{6af} \u{627}\u{646}",
    "\u{938}\u{93e}\u{907}\u{928} \u{907}\u{928}",
    "\u{932}\u{949}\u{917} \u{907}\u{928}",
    "\u{9b8}\u{9be}\u{987}\u{9a8} \u{987}\u{9a8}",
    "\u{ab8}\u{abe}\u{a87}\u{aa8} \u{a87}\u{aa8}",
    "\u{a38}\u{a3e}\u{a08}\u{a28} \u{a07}\u{a28}",
    "\u{b89}\u{bb3}\u{bcd}\u{ba8}\u{bc1}\u{bb4}\u{bc8}",
    "\u{c38}\u{c48}\u{c28}\u{c4d} \u{c07}\u{c28}\u{c4d}",
    "\u{cb8}\u{cc8}\u{ca8}\u{ccd} \u{c87}\u{ca8}\u{ccd}",
    "\u{d38}\u{d48}\u{d7b} \u{d07}\u{d7b}",
    "\u{e40}\u{e02}\u{e49}\u{e32}\u{e2a}\u{e39}\u{e48}\u{e23}\u{e30}\u{e1a}\u{e1a}",
    "\u{1021}\u{1000}\u{1031}\u{102c}\u{1004}\u{1037}\u{103a}\u{101d}\u{1004}\u{103a}",
    "\u{111}\u{103}ng nh\u{1ead}p",
    "\u{30b5}\u{30a4}\u{30f3}\u{30a4}\u{30f3}",
    "\u{30ed}\u{30b0}\u{30a4}\u{30f3}",
    "\u{b85c}\u{adf8}\u{c778}",
    "\u{767b}\u{5f55}",
    "\u{767b}\u{5165}",
    "\u{767b}\u{9304}",
];

pub const DELETING: &[&str] = &[
    "delete",
    "remove",
    "erase",
    "delete forever",
    "delete permanently",
    "l\u{f6}schen",
    "entfernen",
    "endg\u{fc}ltig l\u{f6}schen",
    "l\u{f6}sche",
    "entferne",
    "supprimer",
    "effacer",
    "eliminar",
    "borrar",
    "suprimir",
    "quitar",
    "elimina",
    "cancella",
    "rimuovi",
    "excluir",
    "apagar",
    "remover",
    "usu\u{144}",
    "skasuj",
    "wyma\u{17c}",
    "\u{443}\u{434}\u{430}\u{43b}\u{438}\u{442}\u{44c}",
    "\u{441}\u{442}\u{435}\u{440}\u{435}\u{442}\u{44c}",
    "\u{432}\u{438}\u{434}\u{430}\u{43b}\u{438}\u{442}\u{438}",
    "\u{441}\u{442}\u{435}\u{440}\u{442}\u{438}",
    "sil",
    "kald\u{131}r",
    "hapus",
    "padam",
    "buang",
    "busak",
    "tanggalin",
    "burahin",
    "futa",
    "ondoa",
    "goge",
    "cire",
    "\u{1230}\u{122d}\u{12dd}",
    "\u{62d}\u{630}\u{641}",
    "\u{627}\u{62d}\u{630}\u{641}",
    "\u{625}\u{632}\u{627}\u{644}\u{629}",
    "\u{645}\u{633}\u{62d}",
    "\u{67e}\u{627}\u{6a9} \u{6a9}\u{631}\u{62f}\u{646}",
    "\u{6c1}\u{679}\u{627}\u{626}\u{6cc}\u{6ba}",
    "\u{939}\u{91f}\u{93e}\u{90f}\u{902}",
    "\u{92e}\u{93f}\u{91f}\u{93e}\u{90f}\u{902}",
    "\u{939}\u{91f}\u{935}\u{93e}",
    "\u{9ae}\u{9c1}\u{99b}\u{9c1}\u{9a8}",
    "\u{a95}\u{abe}\u{aa2}\u{ac0} \u{aa8}\u{abe}\u{a96}\u{acb}",
    "\u{a2e}\u{a3f}\u{a1f}\u{a3e}\u{a13}",
    "\u{ba8}\u{bc0}\u{b95}\u{bcd}\u{b95}\u{bc1}",
    "\u{c24}\u{c4a}\u{c32}\u{c17}\u{c3f}\u{c02}\u{c1a}\u{c41}",
    "\u{c85}\u{cb3}\u{cbf}\u{cb8}\u{cbf}",
    "\u{d07}\u{d32}\u{d4d}\u{d32}\u{d3e}\u{d24}\u{d3e}\u{d15}\u{d4d}\u{d15}\u{d41}\u{d15}",
    "\u{e25}\u{e1a}",
    "\u{1016}\u{103b}\u{1000}\u{103a}",
    "x\u{f3}a",
    "x\u{f2}a",
    "g\u{1ee1} b\u{1ecf}",
    "\u{524a}\u{9664}",
    "\u{6d88}\u{53bb}",
    "\u{c0ad}\u{c81c}",
    "\u{c81c}\u{ac70}",
    "\u{5220}\u{9664}",
    "\u{79fb}\u{9664}",
    "\u{6e05}\u{9664}",
    "\u{522a}\u{9664}",
];

const PAYMENT_HOSTS: &[&str] = &[
    "stripe.com",
    "stripe.network",
    "paypal.com",
    "paypalobjects.com",
    "braintreegateway.com",
    "braintree-api.com",
    "adyen.com",
    "adyenpayments.com",
    "checkout.com",
    "klarna.com",
    "klarnaservices.com",
    "afterpay.com",
    "affirm.com",
    "squareup.com",
    "pay.google.com",
    "payments.google.com",
    "applepay.cdn-apple.com",
    "pay.amazon.com",
    "payments.amazon.com",
    "worldpay.com",
    "authorize.net",
    "2checkout.com",
    "mollie.com",
    "razorpay.com",
    "paddle.com",
    "paystack.co",
    "flutterwave.com",
    "payu.com",
    "mercadopago.com",
    "alipay.com",
    "twint.ch",
    "sofort.com",
    "trustly.com",
    "shop.app",
    "pay.shopify.com",
    "recurly.com",
    "chargebee.com",
    "gocardless.com",
    "sezzle.com",
    "zip.co",
    "bitpay.com",
    "commerce.coinbase.com",
    "datatrans.com",
    "saferpay.com",
    "payrexx.com",
    "wallee.com",
];

const SOCIAL: &[&str] = &[
    "mail.google.com",
    "gmail.com",
    "outlook.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "mail.yahoo.com",
    "proton.me",
    "protonmail.com",
    "icloud.com",
    "fastmail.com",
    "gmx.net",
    "gmx.de",
    "gmx.ch",
    "web.de",
    "mail.ru",
    "mail.yandex.ru",
    "tutanota.com",
    "tuta.com",
    "zoho.com",
    "x.com",
    "twitter.com",
    "facebook.com",
    "messenger.com",
    "instagram.com",
    "threads.net",
    "linkedin.com",
    "reddit.com",
    "bsky.app",
    "mastodon.social",
    "tiktok.com",
    "youtube.com",
    "discord.com",
    "slack.com",
    "teams.microsoft.com",
    "teams.live.com",
    "whatsapp.com",
    "telegram.org",
    "signal.org",
    "github.com",
    "gitlab.com",
    "medium.com",
    "substack.com",
    "tumblr.com",
    "pinterest.com",
    "quora.com",
    "stackoverflow.com",
    "stackexchange.com",
    "news.ycombinator.com",
    "weibo.com",
    "vk.com",
    "line.me",
    "wechat.com",
    "snapchat.com",
    "chat.google.com",
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::grants::Grant;

    fn grant() -> Grant {
        Grant::own("a".into(), "A")
    }

    fn press(name: &str) -> Facts {
        Facts {
            tag: "button".into(),
            name: name.into(),
            ..Facts::default()
        }
    }

    fn category(facts: &Facts, url: &str) -> Option<Category> {
        judge(&grant(), facts, Act::Press, url, &[]).map(|question| question.category)
    }

    #[test]
    fn a_dialog_that_talks_of_paying_or_deleting_asks_of_all_but_its_way_out() {
        let url = "https://app.example/";
        let in_dialog = |name: &str, dialog: &str| Facts {
            dialog: dialog.into(),
            ..press(name)
        };
        for (name, dialog, asked) in [
            (
                "Confirm",
                "You are about to delete your account.",
                Category::Deleting,
            ),
            (
                "Confirm",
                "Warning. Delete your account.",
                Category::Deleting,
            ),
            (
                "Yes",
                "Confirmation Delete your account.",
                Category::Deleting,
            ),
            ("OK", "Please confirm: delete account", Category::Deleting),
            ("OK", "Your account will be terminated.", Category::Deleting),
            ("Continue", "This wipes your phone.", Category::Deleting),
            ("OK", "All your data is destroyed.", Category::Deleting),
            ("Yes", "Discard this draft?", Category::Deleting),
            (
                "Agree",
                "We start the deletion of your data.",
                Category::Deleting,
            ),
            ("Confirm", "20 EUR is debited today.", Category::Paying),
            (
                "OK",
                "Are you sure? All your files get deleted.",
                Category::Deleting,
            ),
            (
                "Confirm",
                "Order summary. Total 99 EUR. Pay with Visa ending 4242.",
                Category::Paying,
            ),
            (
                "OK",
                "Your card is charged 99 EUR. Purchase details below.",
                Category::Paying,
            ),
            (
                "Continue \u{2192}",
                "Delete your account?",
                Category::Deleting,
            ),
            (
                "Confirm and close",
                "Delete your account?",
                Category::Deleting,
            ),
            ("Keep going", "Delete your account?", Category::Deleting),
            ("Close account", "Delete your account?", Category::Deleting),
            (
                "Yes, no going back",
                "Delete your account?",
                Category::Deleting,
            ),
            (
                "Done",
                "You can remove your data at any time.",
                Category::Deleting,
            ),
            ("", "Remove item from cart?", Category::Deleting),
        ] {
            assert_eq!(
                category(&in_dialog(name, dialog), url),
                Some(asked),
                "{name}: {dialog}"
            );
        }
        for (name, dialog) in [
            ("Got it", "How to delete your data"),
            ("Learn more", "Delete account?"),
            ("Next page", "Recently deleted items"),
            ("Cancel", "Delete your account?"),
            ("No, keep it", "Delete your account?"),
            ("Close", "Pay 20.00 EUR"),
            ("x", "Delete your account?"),
            ("Abbrechen", "Konto l\u{f6}schen?"),
            ("Confirm", "Change your name?"),
        ] {
            assert_eq!(
                category(&in_dialog(name, dialog), url),
                None,
                "{name}: {dialog}"
            );
        }
    }

    #[test]
    fn the_way_out_of_a_dialog_and_what_reads_as_paying_by_mistake() {
        let url = "https://app.example/";
        let in_dialog = |name: &str, dialog: &str| Facts {
            dialog: dialog.into(),
            ..press(name)
        };
        for (name, dialog) in [
            (
                "Accept all cookies",
                "We use cookies. You can remove them at any time.",
            ),
            (
                "Allow all cookies",
                "Our partners use cookies to process payment and measure ads.",
            ),
            ("Next", "Tip: drag a widget to move it."),
            ("Continue", "This upgrade is free of charge."),
            ("Assign", "Who is in charge of this project?"),
            ("Lanjut", "Saya setuju dengan ketentuan ini"),
            ("Close dialog", "Delete your account?"),
            ("Close modal", "Pay 20 EUR"),
            ("Close Close", "Delete your account?"),
            ("Continue shopping", "Item removed"),
            ("Stay", "Delete your account?"),
            ("Sluiten", "Delete your account?"),
            (
                "\u{30ad}\u{30e3}\u{30f3}\u{30bb}\u{30eb}",
                "Delete your account?",
            ),
            ("Keep", "Delete this item?"),
            ("No, keep it", "Delete your account?"),
        ] {
            assert_eq!(
                category(&in_dialog(name, dialog), url),
                None,
                "{name}: {dialog}"
            );
        }
    }

    #[test]
    fn only_what_is_plainly_the_way_out_goes_free() {
        let url = "https://app.example/";
        let in_dialog = |name: &str, dialog: &str| Facts {
            dialog: dialog.into(),
            ..press(name)
        };
        for (name, dialog, asked) in [
            (
                "Accept",
                "Accept a charge of 99 EUR to your card?",
                Category::Paying,
            ),
            (
                "Keep",
                "Keep your plan and be billed 99 EUR?",
                Category::Paying,
            ),
            (
                "Accept",
                "Delete transfer request from Bob",
                Category::Deleting,
            ),
            ("Accept all", "Delete your account?", Category::Deleting),
            ("OK", "Delete your account?", Category::Deleting),
            ("No, thanks and charge me", "Pay 99 EUR?", Category::Paying),
            (
                "OK",
                "Delete your account? We use cookies.",
                Category::Deleting,
            ),
            (
                "OK",
                "Your card is charged 99 EUR. We use cookies.",
                Category::Paying,
            ),
            (
                "Continue",
                "Free of charge for a month, then you are charged 9 EUR.",
                Category::Paying,
            ),
            (
                "Continue",
                "This upgrade is 20 EUR. Pay now?",
                Category::Paying,
            ),
            (
                "OK",
                "We use cookies. You can delete them in your browser.",
                Category::Deleting,
            ),
            ("OK", "Consent to payment of 99 EUR.", Category::Paying),
            (
                "Agree",
                "By clicking Agree you consent to be charged 99 EUR every month.",
                Category::Paying,
            ),
            (
                "Allow",
                "Payment consent. Allow shop.example to take 500 EUR from your account.",
                Category::Paying,
            ),
            (
                "OK",
                "We use cookies. Your account will be deleted permanently.",
                Category::Deleting,
            ),
            (
                "Accept all",
                "We use cookies. You can delete them in your browser.",
                Category::Deleting,
            ),
            (
                "Next",
                "Your card will be charged 99 EUR.",
                Category::Paying,
            ),
            ("Next", "Your account will be deleted.", Category::Deleting),
        ] {
            assert_eq!(
                category(&in_dialog(name, dialog), url),
                Some(asked),
                "{name}: {dialog}"
            );
        }
    }

    #[test]
    fn enter_in_a_dialog_is_judged_like_its_confirm() {
        let url = "https://app.example/";
        let field = |submit: bool, default_button: &str, dialog: &str| Facts {
            tag: "input".into(),
            editable: true,
            in_form: submit,
            submit,
            default_button: default_button.into(),
            dialog: dialog.into(),
            ..Facts::default()
        };
        let enter = |facts: &Facts| {
            judge(&grant(), facts, Act::Enter, url, &[]).map(|question| question.category)
        };
        for facts in [
            field(true, "Confirm", "Delete your account?"),
            field(true, "", "Delete your account?"),
            field(false, "", "Delete your account?"),
        ] {
            assert_eq!(
                enter(&facts),
                Some(Category::Deleting),
                "{}",
                facts.default_button
            );
        }
        assert_eq!(
            enter(&field(true, "Next", "Your account will be deleted.")),
            Some(Category::Deleting)
        );
        assert_eq!(enter(&field(true, "Cancel", "Delete your account?")), None);
        assert_eq!(enter(&field(true, "", "Change your name?")), None);
    }

    #[test]
    fn shift_enter_in_a_field_submits_like_enter_and_in_a_box_writes_a_line() {
        let key = crate::agents::keys::chord("Shift+Enter").expect("a key");
        let field = |kind: &str| Facts {
            tag: "input".into(),
            editable: true,
            in_form: true,
            field: Field {
                kind: kind.into(),
                ..Field::default()
            },
            ..Facts::default()
        };
        let (facts, act) = key_act(field("text"), &key).expect("it does something");
        assert_eq!(act, Act::Enter);
        assert!(facts.submit);
        let (_, act) = key_act(field("textarea"), &key).expect("as before");
        assert_eq!(act, Act::Press);
    }

    #[test]
    fn a_question_does_not_quote_a_secret_it_is_asked_on() {
        let url = "https://app.example/";
        let facts = Facts {
            tag: "input".into(),
            name: "4111111111111111".into(),
            field: Field {
                autocomplete: "cc-number".into(),
                ..Field::default()
            },
            ..Facts::default()
        };
        let confirm = Grant {
            mode: Mode::Confirm,
            ..grant()
        };
        let question = judge(&confirm, &facts, Act::Press, url, &[]);
        let summary = question.map(|one| one.summary).unwrap_or_default();
        assert!(!summary.is_empty());
        assert!(!summary.contains("4111"), "{summary}");
    }

    #[test]
    fn a_dialog_is_read_in_its_inflections() {
        let url = "https://app.example/";
        let in_dialog = |dialog: &str| Facts {
            dialog: dialog.into(),
            ..press("OK")
        };
        for (dialog, asked) in [
            ("Tu cuenta sera eliminada", Category::Deleting),
            ("Paying 20 EUR", Category::Paying),
            ("Purchased", Category::Paying),
        ] {
            assert_eq!(category(&in_dialog(dialog), url), Some(asked), "{dialog}");
        }
    }

    #[test]
    fn a_dialog_is_quoted_whole_and_amounts_stay_whole() {
        let quoted = |dialog: &str| mention(dialog, PAYING, DIALOG_PAYING).map(str::to_string);
        assert_eq!(
            quoted("Pay 1.299,00 EUR to Mallory").as_deref(),
            Some("Pay 1.299,00 EUR to Mallory")
        );
        assert_eq!(quoted("Pay 20.00 EUR").as_deref(), Some("Pay 20.00 EUR"));
        assert_eq!(
            quoted("This will charge 1,299.00 EUR to your card. Pay now?").as_deref(),
            Some("This will charge 1,299.00 EUR to your card.")
        );
        assert_eq!(quoted("Nothing about it."), None);
    }

    #[test]
    fn a_line_leads_by_how_it_opens() {
        for line in [
            "Pay now",
            "Pay 20.00 EUR",
            "Delete 3 files",
            "Remove item",
            "Kaufen",
            "pay",
        ] {
            assert!(leads(line), "{line}");
        }
        for line in [
            "Pay gap widens in Europe",
            "Remove stains from a shirt",
            "Buy one get one free",
            "How to delete your account",
            "Payment details",
            "Help center",
            "Order summary",
            "Display",
        ] {
            assert!(!leads(line), "{line}");
        }
    }

    #[test]
    fn what_says_nothing_of_itself_asks() {
        let unread = Facts {
            opaque: true,
            ..Facts::default()
        };
        assert_eq!(
            category(&unread, "https://app.example/"),
            Some(Category::Unread)
        );
    }

    #[test]
    fn what_is_no_code_and_no_payment_card_stays_readable() {
        let called = |said: &str, kind: &str| Field {
            kind: kind.into(),
            said: said.into(),
            ..Field::default()
        };
        for said in [
            "One-time donation",
            "Authenticator app name",
            "Tan",
            "Library card no",
            "Discount code",
            "Pin to top",
        ] {
            assert!(!secret(&called(said, "text")), "{said}");
        }
        assert!(!secret(&called("Pin notes", "textarea")));
        assert!(!card_field(&called("Library card no", "text")));
        let postal = Field {
            autocomplete: "postal-code".into(),
            ..called("PIN code", "text")
        };
        assert!(!secret(&postal));
    }

    #[test]
    fn a_name_in_any_case_or_with_a_number_is_a_code() {
        for said in [
            "Your Pin",
            "Enter your Pin",
            "pin1",
            "otp1",
            "userPin",
            "tan",
            "code",
            "Authenticator",
            "One-time",
            "Enter code",
            "Your code",
            "Einmal-Code",
            "Two-step code",
            "Security key",
        ] {
            let field = Field {
                kind: "text".into(),
                said: said.into(),
                ..Field::default()
            };
            assert!(secret(&field), "{said}");
        }
    }

    #[test]
    fn a_code_under_a_name_with_marks_or_as_a_whole_label_is_secret() {
        let called = |said: &str| Field {
            kind: "text".into(),
            said: said.into(),
            ..Field::default()
        };
        for said in [
            "SMS-Code",
            "Best\u{e4}tigungs-Code",
            "Login code",
            "Enter the code we sent you",
            "Recovery code",
            "Zugangscode",
            "Authentifizierungscode",
            "Digit 1",
            "MM/YY",
            "photoTAN",
            "TAN",
        ] {
            assert!(secret(&called(said)), "{said}");
        }
        let code = Field {
            label: "Code".into(),
            ..called("Code")
        };
        assert!(secret(&code));
    }

    #[test]
    fn a_code_a_pin_and_a_card_are_secret_by_what_they_are_called() {
        let called = |said: &str| Field {
            kind: "text".into(),
            said: said.into(),
            ..Field::default()
        };
        for said in [
            "otp 6-digit code",
            "verification_code Verification code",
            "verificationCode",
            "pin PIN",
            "user_pin",
            "card_no Card no",
            "cardno",
            "credit_card",
            "Best\u{e4}tigungscode",
            "One-time password",
        ] {
            assert!(secret(&called(said)), "{said}");
        }
        for said in [
            "shipping",
            "spinner",
            "hotpot",
            "Search",
            "Card notes",
            "tangent",
            "Discount code",
        ] {
            assert!(!secret(&called(said)), "{said}");
        }
    }

    #[test]
    fn a_site_is_its_registrable_domain() {
        assert_eq!(site_of("www.shop.example"), "shop.example");
        assert_eq!(site_of("news.bbc.co.uk"), "bbc.co.uk");
        assert_eq!(site_of("moodle-app2.let.ethz.ch"), "ethz.ch");
        assert_eq!(site_of("127.0.0.1"), "127.0.0.1");
        assert_eq!(site_of("localhost"), "localhost");
    }

    #[test]
    fn a_name_on_a_shared_host_is_a_site_of_its_own() {
        assert_eq!(site_of("shop.github.io"), "shop.github.io");
        assert_eq!(site_of("a.shop.github.io"), "shop.github.io");
        assert_eq!(site_of("x.pages.dev"), "x.pages.dev");
        assert_eq!(site_of("github.io"), "github.io");
        assert_eq!(site_of("www.github.com"), "github.com");
    }

    #[test]
    fn a_rule_covers_its_site_and_every_host_under_it() {
        let mut grant = grant();
        grant
            .sites
            .insert("bank.example".into(), SiteRule::AgentStore);
        grant.sites.insert("evil.example".into(), SiteRule::Deny);
        grant
            .sites
            .insert("ok.evil.example".into(), SiteRule::Allow);
        assert_eq!(
            rule_for(&grant, "login.bank.example"),
            Some(SiteRule::AgentStore)
        );
        assert_eq!(rule_for(&grant, "evil.example"), Some(SiteRule::Deny));
        assert_eq!(rule_for(&grant, "ok.evil.example"), Some(SiteRule::Allow));
        assert_eq!(rule_for(&grant, "notbank.example"), None);

        assert!(site_allowed(&grant, "https://a.evil.example/", Store::Agent).is_err());
        assert!(site_allowed(&grant, "https://bank.example/", Store::Reader).is_err());
        assert!(site_allowed(&grant, "https://bank.example/", Store::Agent).is_ok());
        assert!(site_allowed(&grant, "https://ok.evil.example/", Store::Reader).is_ok());
    }

    #[test]
    fn a_rule_is_not_got_round_by_another_spelling_of_its_site() {
        let mut grant = grant();
        grant.sites.insert("Evil.Example.".into(), SiteRule::Deny);
        grant.sites.insert("bücher.example".into(), SiteRule::Deny);
        for url in [
            "https://evil.example./",
            "https://EVIL.example/",
            "https://a.evil.example./x",
            "https://bücher.example/",
            "https://xn--bcher-kva.example/",
            "https://www.BÜCHER.example./",
        ] {
            assert!(site_allowed(&grant, url, Store::Agent).is_err(), "{url}");
        }
        assert!(site_allowed(&grant, "https://notevil.example/", Store::Agent).is_ok());
        assert_eq!(
            host_of("https://Evil.Example./"),
            Some("evil.example".into())
        );
    }

    #[test]
    fn presses_are_recognised_in_every_language() {
        let cases: &[(&str, &str, Option<Category>)] = &[
            ("Place order", "https://shop.example/", Some(Category::Paying)),
            ("Pay \u{20ac}12.50", "https://shop.example/", Some(Category::Paying)),
            ("Jetzt kaufen", "https://shop.example/", Some(Category::Paying)),
            ("Zahlungspflichtig bestellen", "https://shop.example/", Some(Category::Paying)),
            ("Passer la commande", "https://shop.example/", Some(Category::Paying)),
            ("Finalizar compra", "https://shop.example/", Some(Category::Paying)),
            ("\u{6ce8}\u{6587}\u{3092}\u{78ba}\u{5b9a}\u{3059}\u{308b}", "https://shop.example/", Some(Category::Paying)),
            ("\u{7acb}\u{5373}\u{8d2d}\u{4e70}", "https://shop.example/", Some(Category::Paying)),
            ("\u{acb0}\u{c81c}\u{d558}\u{ae30}", "https://shop.example/", Some(Category::Paying)),
            ("\u{41e}\u{444}\u{43e}\u{440}\u{43c}\u{438}\u{442}\u{44c} \u{437}\u{430}\u{43a}\u{430}\u{437}", "https://shop.example/", Some(Category::Paying)),
            ("Send", "https://mail.google.com/mail/u/0/", Some(Category::Sending)),
            ("Senden", "https://outlook.office.com/mail/", Some(Category::Sending)),
            ("Publier", "https://www.linkedin.com/feed/", Some(Category::Sending)),
            ("\u{53d1}\u{9001}", "https://weibo.com/", Some(Category::Sending)),
            ("Send", "https://shop.example/contact", None),
            ("Delete", "https://drive.example/", Some(Category::Deleting)),
            ("Endg\u{fc}ltig l\u{f6}schen", "https://drive.example/", Some(Category::Deleting)),
            ("Supprimer le fichier", "https://drive.example/", Some(Category::Deleting)),
            ("\u{524a}\u{9664}", "https://drive.example/", Some(Category::Deleting)),
            ("Sil", "https://drive.example/", Some(Category::Deleting)),
            ("Silver plan", "https://drive.example/", None),
            ("Payment history", "https://shop.example/", None),
            ("Search", "https://shop.example/", None),
            ("Next", "https://shop.example/", None),
        ];
        for (name, url, expected) in cases {
            assert_eq!(category(&press(name), url), *expected, "{name} on {url}");
        }
    }

    #[test]
    fn a_press_in_a_form_with_a_card_field_is_paying() {
        let mut facts = press("Continue");
        facts.in_form = true;
        facts.submit = true;
        facts.fields = vec![Field {
            kind: "text".into(),
            autocomplete: "cc-number".into(),
            said: String::new(),
            ..Field::default()
        }];
        assert_eq!(
            category(&facts, "https://shop.example/"),
            Some(Category::Paying)
        );
        facts.fields = vec![Field {
            kind: "text".into(),
            autocomplete: String::new(),
            said: "Kartennummer".into(),
            ..Field::default()
        }];
        assert_eq!(
            category(&facts, "https://shop.example/"),
            Some(Category::Paying)
        );
    }

    #[test]
    fn a_submit_on_a_page_that_talks_to_a_payment_processor_is_paying() {
        let mut facts = press("Continue");
        facts.submit = true;
        let hosts = vec!["js.stripe.com".to_string()];
        let asked = judge(
            &grant(),
            &facts,
            Act::Press,
            "https://shop.example/",
            &hosts,
        );
        assert_eq!(asked.map(|one| one.category), Some(Category::Paying));
        facts.submit = false;
        assert!(judge(
            &grant(),
            &facts,
            Act::Press,
            "https://shop.example/",
            &hosts
        )
        .is_none());
    }

    fn field(kind: &str, label: &str) -> Field {
        Field {
            kind: kind.into(),
            said: label.into(),
            label: label.into(),
            ..Field::default()
        }
    }

    fn submitting(name: &str, fields: Vec<Field>) -> Facts {
        Facts {
            tag: "button".into(),
            name: name.into(),
            submit: true,
            in_form: true,
            fields,
            ..Facts::default()
        }
    }

    fn on_the_page(name: &str, fields: Vec<Field>) -> Facts {
        Facts {
            tag: "div".into(),
            name: name.into(),
            fields,
            ..Facts::default()
        }
    }

    fn enter_in(own: Field, in_form: bool, fields: Vec<Field>) -> Facts {
        Facts {
            tag: if own.kind == "textarea" {
                "textarea"
            } else {
                "input"
            }
            .into(),
            editable: true,
            submit: in_form,
            in_form,
            fields,
            field: own,
            ..Facts::default()
        }
    }

    fn compose() -> Vec<Field> {
        vec![
            field("email", "To"),
            field("text", "Subject"),
            field("textarea", "Message"),
        ]
    }

    fn asked(facts: &Facts, act: Act, url: &str) -> Option<(Category, String)> {
        judge(&grant(), facts, act, url, &[]).map(|one| (one.category, one.summary))
    }

    fn sent(facts: &Facts, act: Act, url: &str) -> bool {
        asked(facts, act, url).is_some_and(|(category, _)| category == Category::Sending)
    }

    #[test]
    fn a_compose_form_on_any_site_asks_before_it_sends() {
        let send = submitting("Send", compose());
        assert_eq!(
            asked(&send, Act::Press, "http://127.0.0.1:23960/mail"),
            Some((Category::Sending, "Send on 127.0.0.1".to_string()))
        );
        let webmail = on_the_page(
            "Send",
            vec![
                field("text", "To recipients"),
                field("text", "Subject"),
                field("editable", "Message Body"),
            ],
        );
        assert!(sent(&webmail, Act::Press, "https://mail.example.org/"));
        let support = submitting(
            "Submit",
            vec![
                field("text", "Name"),
                field("email", "Email"),
                field("textarea", "How can we help?"),
            ],
        );
        assert!(sent(&support, Act::Press, "https://help.example/contact"));
        let widget = vec![field("textarea", "Type a message\u{2026}")];
        assert!(sent(
            &on_the_page("Send message", widget.clone()),
            Act::Press,
            "https://shop.example/"
        ));
        assert!(sent(
            &enter_in(widget[0].clone(), false, widget.clone()),
            Act::Enter,
            "https://shop.example/"
        ));
        let mut mention = field("textarea", "");
        mention.mentions = true;
        assert_eq!(
            asked(
                &submitting("\u{2192}", vec![mention]),
                Act::Press,
                "https://forum.example/"
            ),
            Some((Category::Sending, "Send on forum.example".to_string()))
        );
        let support = vec![
            field("email", "Email"),
            field("textarea", "How can we help?"),
        ];
        assert!(!sent(
            &enter_in(support[1].clone(), true, support.clone()),
            Act::Enter,
            "https://help.example/"
        ));
        assert!(sent(
            &enter_in(support[0].clone(), true, support),
            Act::Enter,
            "https://help.example/"
        ));
        assert!(sent(
            &enter_in(field("text", "Subject"), true, compose()),
            Act::Enter,
            "https://mail.example.org/"
        ));
        assert!(sent(
            &on_the_page("Post", Vec::new()),
            Act::Press,
            "https://www.linkedin.com/feed/"
        ));
    }

    #[test]
    fn sending_is_read_in_every_language() {
        let composer = || vec![field("textarea", "")];
        for name in [
            "Senden",
            "Abschicken",
            "Envoyer",
            "Enviar",
            "Invia",
            "Wy\u{15b}lij",
            "\u{41e}\u{442}\u{43f}\u{440}\u{430}\u{432}\u{438}\u{442}\u{44c}",
            "G\u{f6}nder",
            "Kirim",
            "Tuma",
            "\u{625}\u{631}\u{633}\u{627}\u{644}",
            "\u{92d}\u{947}\u{91c}\u{947}\u{902}",
            "\u{e2a}\u{e48}\u{e07}",
            "G\u{1eed}i",
            "\u{9001}\u{4fe1}",
            "\u{bcf4}\u{b0b4}\u{ae30}",
            "\u{53d1}\u{9001}",
            "\u{50b3}\u{9001}",
            "Reply all",
            "Post comment",
        ] {
            assert!(
                sent(
                    &on_the_page(name, composer()),
                    Act::Press,
                    "https://a.example/"
                ),
                "{name}"
            );
        }
    }

    #[test]
    fn a_search_a_sign_in_or_a_newsletter_is_no_send() {
        let url = "https://a.example/";
        let never = [
            submitting("Search", vec![field("search", "Search")]),
            submitting("Submit", vec![field("search", "q Search")]),
            submitting("Google Search", vec![field("search", "q Search")]),
            submitting(
                "Submit",
                vec![field("email", "Email"), field("password", "Password")],
            ),
            submitting(
                "Send",
                vec![field("email", "Email"), field("password", "Password")],
            ),
            submitting("Subscribe", vec![field("email", "Email")]),
            submitting("Submit", vec![field("email", "Email")]),
            submitting("Submit", vec![field("text", "From"), field("text", "To")]),
            submitting("Save", vec![field("textarea", "Bio")]),
            on_the_page("\u{110}\u{103}ng nh\u{1ead}p", vec![field("textarea", "")]),
            on_the_page(
                "\u{e08}\u{e31}\u{e14}\u{e2a}\u{e48}\u{e07}\u{e1f}\u{e23}\u{e35}",
                vec![field("textarea", "")],
            ),
            on_the_page("Find by post code", vec![field("textarea", "")]),
            on_the_page("Sender", vec![field("textarea", "")]),
            on_the_page("Send", Vec::new()),
            Facts {
                link: true,
                ..on_the_page("Reply", vec![field("textarea", "")])
            },
        ];
        for facts in &never {
            assert!(
                !sent(facts, Act::Press, url),
                "{} {:?}",
                facts.name,
                facts.fields
            );
        }
        let mut into = enter_in(
            field("textarea", "Reply"),
            false,
            vec![field("textarea", "Reply")],
        );
        into.name = "Reply".into();
        assert!(!sent(&into, Act::Press, url));
        let words = field("textarea", "words Words");
        assert!(!sent(
            &enter_in(words.clone(), false, vec![words]),
            Act::Enter,
            url
        ));
        let search = field("search", "q Search");
        assert!(!sent(
            &enter_in(search.clone(), true, vec![search]),
            Act::Enter,
            url
        ));
    }

    #[test]
    fn a_sign_in_is_the_readers_whatever_the_page_calls_it() {
        let sign_in = vec![field("email", "Email"), field("password", "Password")];
        assert!(signs_in(
            &submitting("Sign in", sign_in.clone()),
            Act::Press
        ));
        assert!(signs_in(&submitting("Weiter", sign_in.clone()), Act::Press));
        assert!(signs_in(
            &enter_in(field("email", "Email"), true, sign_in.clone()),
            Act::Enter
        ));
        let mut shown = field("text", "Password");
        shown.autocomplete = "current-password".into();
        assert!(signs_in(
            &submitting("Log in", vec![field("email", "Email"), shown.clone()]),
            Act::Press
        ));
        let mut masked = field("text", "PIN");
        masked.masked = true;
        assert!(signs_in(
            &enter_in(masked.clone(), false, vec![masked]),
            Act::Enter
        ));
        assert!(signs_in(
            &on_the_page("Anmelden", sign_in.clone()),
            Act::Press
        ));
        assert!(signs_in(
            &on_the_page("\u{30ed}\u{30b0}\u{30a4}\u{30f3}", sign_in.clone()),
            Act::Press
        ));

        let mut show = submitting("Show password", sign_in.clone());
        show.submit = false;
        assert!(!signs_in(&show, Act::Press));
        assert!(!signs_in(
            &submitting("Next", vec![field("email", "Email")]),
            Act::Press
        ));
        assert!(!signs_in(&on_the_page("Sign in", Vec::new()), Act::Press));
        let forgot = Facts {
            link: true,
            ..on_the_page("Forgot your login?", sign_in.clone())
        };
        assert!(!signs_in(&forgot, Act::Press));
        assert!(!signs_in(&submitting("Sign in", sign_in), Act::Write));
    }

    #[test]
    fn a_secret_is_a_credential_a_code_or_a_card() {
        let with = |kind: &str, autocomplete: &str, label: &str| Field {
            autocomplete: autocomplete.into(),
            ..field(kind, label)
        };
        for one in [
            with("password", "", "Password"),
            with("text", "current-password", "Password"),
            with("text", "section-a new-password", "New password"),
            with("text", "one-time-code", "Code"),
            with("text", "cc-number", ""),
            with("text", "billing cc-csc", ""),
            with("text", "", "CVC"),
            with("text", "", "Expiry"),
            with("text", "", "Kartennummer"),
            Field {
                masked: true,
                ..field("text", "PIN")
            },
        ] {
            assert!(secret(&one), "{one:?}");
        }
        for one in [
            with("email", "email", "Email"),
            with("text", "name", "Name"),
            with("search", "", "Search"),
            with("textarea", "", "Message"),
        ] {
            assert!(!secret(&one), "{one:?}");
        }
    }

    #[test]
    fn the_summary_is_the_press_and_the_site() {
        let asked = judge(
            &grant(),
            &press("Place order"),
            Act::Press,
            "https://www.shop.example/cart",
            &[],
        )
        .expect("asks");
        assert_eq!(asked.summary, "Place order on shop.example");
    }

    #[test]
    fn a_category_turned_off_or_always_allowed_does_not_ask() {
        let mut grant = grant();
        grant.asks.insert(Category::Deleting, false);
        assert!(judge(
            &grant,
            &press("Delete"),
            Act::Press,
            "https://a.example/",
            &[]
        )
        .is_none());
        grant
            .always
            .insert("shop.example".into(), vec![Category::Paying]);
        assert!(judge(
            &grant,
            &press("Buy now"),
            Act::Press,
            "https://shop.example/",
            &[]
        )
        .is_none());
        assert!(judge(
            &grant,
            &press("Buy now"),
            Act::Press,
            "https://other.example/",
            &[]
        )
        .is_some());
    }

    #[test]
    fn signing_in_asks_as_the_mode_says_and_full_permissions_just_signs_in() {
        let sign_in = vec![field("email", "Email"), field("password", "Password")];
        let log_in = submitting("Log in", sign_in.clone());
        let typed = enter_in(field("password", "Password"), true, sign_in);
        let url = "https://bank.example/login";
        assert!(credential_act(&log_in, Act::Press));
        assert!(credential_act(&typed, Act::Write));

        let mut full = grant();
        full.mode = Mode::Autonomous;
        assert!(judge(&full, &log_in, Act::Press, url, &[]).is_none());
        assert!(judge(&full, &typed, Act::Write, url, &[]).is_none());
        assert!(judge(&full, &typed, Act::Enter, url, &[]).is_none());

        let mut asked = grant();
        let question = judge(&asked, &log_in, Act::Press, url, &[]);
        assert_eq!(question.map(|one| one.category), Some(Category::SigningIn));
        asked.asks.insert(Category::SigningIn, false);
        assert!(judge(&asked, &log_in, Act::Press, url, &[]).is_none());

        let mut approve = grant();
        approve.mode = Mode::Confirm;
        let question = judge(&approve, &typed, Act::Write, url, &[]);
        assert_eq!(question.map(|one| one.category), Some(Category::SigningIn));
    }

    #[test]
    fn a_site_s_sign_in_box_and_certificate_ask_as_the_mode_says() {
        let url = "https://intranet.example/";
        let mut full = grant();
        full.mode = Mode::Autonomous;
        for kind in [DialogKind::SignIn, DialogKind::Certificate] {
            assert!(answering(&full, kind, true, url, "").is_none(), "{kind:?}");
        }

        let mut approve = grant();
        approve.mode = Mode::Confirm;
        let unsupervised = grant();
        for asking in [&approve, &unsupervised] {
            for kind in [DialogKind::SignIn, DialogKind::Certificate] {
                let question = answering(asking, kind, true, url, "").expect("asked");
                assert_eq!(question.category, Category::SigningIn);
                assert_eq!(question.summary, "Sign in on intranet.example");
                assert!(answering(asking, kind, false, url, "").is_none());
            }
        }

        let mut off = grant();
        off.asks.insert(Category::SigningIn, false);
        assert!(answering(&off, DialogKind::SignIn, true, url, "").is_none());

        for kind in [DialogKind::Alert, DialogKind::Confirm, DialogKind::Prompt] {
            assert!(
                answering(&approve, kind, true, url, "Leave this page?").is_none(),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn a_confirm_that_says_it_pays_or_deletes_asks() {
        let url = "https://shop.example/";
        let unsupervised = grant();
        let question = answering(
            &unsupervised,
            DialogKind::Confirm,
            true,
            url,
            "Pay 500 EUR now?",
        )
        .expect("asked");
        assert_eq!(question.category, Category::Paying);
        assert_eq!(
            question.summary,
            "The page says \u{201c}Pay 500 EUR now?\u{201d} on shop.example"
        );

        let question = answering(
            &unsupervised,
            DialogKind::Confirm,
            true,
            url,
            "Delete this repository?",
        )
        .expect("asked");
        assert_eq!(question.category, Category::Deleting);

        assert!(answering(&unsupervised, DialogKind::Confirm, false, url, "Pay now?").is_none());
        assert!(answering(&unsupervised, DialogKind::Alert, true, url, "Pay now?").is_none());
        let mut full = grant();
        full.mode = Mode::Autonomous;
        assert!(answering(&full, DialogKind::Confirm, true, url, "Pay now?").is_none());
    }

    #[test]
    fn a_link_is_no_delete_and_a_button_still_is() {
        let url = "https://a.example/";
        let mut link = press("How to delete your account");
        link.link = true;
        assert_eq!(category(&link, url), None);
        assert_eq!(
            category(&press("Delete account"), url),
            Some(Category::Deleting)
        );
    }

    #[test]
    fn a_drag_is_one_question_about_its_graver_end() {
        let url = "https://a.example/";
        let unsupervised = grant();
        let mut confirm = grant();
        confirm.mode = Mode::Confirm;
        let card = press("Card");
        let mut column = press("Pay rent");
        column.control = false;
        let mut pay = press("Pay now");
        pay.control = true;

        let of = |grant: &Grant, from: &Facts, to: &Facts| {
            of_a_drag(grant, from, to, url, &[]).name.clone()
        };
        assert_eq!(of(&unsupervised, &card, &column), "Card");
        assert_eq!(of(&unsupervised, &card, &pay), "Pay now");
        assert_eq!(of(&confirm, &card, &pay), "Pay now");
        assert_eq!(of(&confirm, &pay, &card), "Pay now");
    }

    #[test]
    fn a_page_too_big_to_read_asks_before_a_submit() {
        let url = "https://a.example/";
        let mut big = press("Go");
        big.cut = true;
        big.submit = true;
        assert_eq!(category(&big, url), Some(Category::Unread));
        big.submit = false;
        assert_eq!(category(&big, url), None);
    }

    #[test]
    fn a_denied_site_in_a_frame_is_denied() {
        let mut owner = grant();
        owner.sites.insert("denied.example".into(), SiteRule::Deny);
        owner
            .sites
            .insert("mine.example".into(), SiteRule::AgentStore);
        let at = |urls: &[&str]| urls.iter().map(ToString::to_string).collect::<Vec<_>>();

        assert!(frame_allowed(&owner, &at(&["https://a.example/"]), Store::Reader).is_ok());
        assert!(frame_allowed(&owner, &at(&["https://denied.example/x"]), Store::Agent).is_err());
        assert!(frame_allowed(
            &owner,
            &at(&[
                "about:srcdoc",
                "https://denied.example",
                "https://a.example"
            ]),
            Store::Agent
        )
        .is_err());
        assert!(frame_allowed(
            &owner,
            &at(&["about:blank", "https://a.example"]),
            Store::Agent
        )
        .is_ok());
        assert!(frame_allowed(&owner, &at(&["https://mine.example/"]), Store::Reader).is_err());
        assert!(frame_allowed(&owner, &at(&["https://mine.example/"]), Store::Agent).is_ok());
    }

    #[test]
    fn confirm_mode_asks_for_every_write() {
        let mut grant = grant();
        grant.mode = Mode::Confirm;
        let asked = judge(
            &grant,
            &press("Next"),
            Act::Press,
            "https://a.example/",
            &[],
        );
        assert_eq!(asked.map(|one| one.category), Some(Category::Writing));
        let typed = judge(
            &grant,
            &Facts::default(),
            Act::Write,
            "https://a.example/",
            &[],
        );
        assert_eq!(typed.map(|one| one.category), Some(Category::Writing));
    }

    #[test]
    fn autonomous_mode_asks_nothing_paying_included() {
        let mut grant = grant();
        grant.mode = Mode::Autonomous;
        let url = "https://mail.example/";
        for name in [
            "Send",
            "Delete",
            "Publish",
            "Next",
            "Buy now",
            "Place order",
        ] {
            assert!(
                judge(&grant, &press(name), Act::Press, url, &[]).is_none(),
                "{name}"
            );
        }
        assert!(judge(&grant, &Facts::default(), Act::Write, url, &[]).is_none());
        let submit = Facts {
            submit: true,
            ..press("Continue")
        };
        let hosts = ["js.stripe.com".to_string()];
        assert!(judge(&grant, &submit, Act::Press, url, &hosts).is_none());
        assert!(judge(&grant, &press("Send"), Act::Enter, url, &[]).is_none());
    }

    #[test]
    fn a_sign_in_form_and_a_card_field_are_known() {
        let facts = Facts {
            tag: "input".into(),
            kind: "email".into(),
            in_form: true,
            fields: vec![Field {
                kind: "password".into(),
                ..Field::default()
            }],
            ..Facts::default()
        };
        assert!(facts.sign_in());
        assert!(!facts.password());
        let card = Facts {
            tag: "input".into(),
            autocomplete: "cc-csc".into(),
            ..Facts::default()
        };
        assert!(card.sensitive());
        assert!(Facts {
            tag: "select".into(),
            ..Facts::default()
        }
        .picker());
        assert!(Facts {
            tag: "input".into(),
            kind: "date".into(),
            ..Facts::default()
        }
        .picker());
    }

    #[test]
    fn an_agent_stays_on_the_web() {
        let grant = grant();
        for address in [
            "file:///etc/hostname",
            "file://localhost/etc/hostname",
            "file://server/share/secret.md",
            "chrome://version",
            "chrome-extension://abc/options.html",
            "devtools://devtools/bundled/inspector.html",
            "view-source:https://example.com/",
            "javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            "java\nscript:alert(1)",
            "data:text/html,<h1>x</h1>",
            "about:version",
            "tauri://localhost",
            "nib://open",
        ] {
            assert!(
                site_allowed(&grant, address, Store::Agent).is_err(),
                "{address}"
            );
        }
        for address in [
            "https://example.com/",
            "http://127.0.0.1:9/x",
            "about:blank",
            "blob:https://example.com/5d2f",
            "",
        ] {
            assert!(
                site_allowed(&grant, address, Store::Agent).is_ok(),
                "{address}"
            );
        }
    }

    #[test]
    fn a_failed_load_leaves_the_tab_to_its_agent() {
        assert!(site_allowed(&grant(), "chrome-error://chromewebdata/", Store::Agent).is_ok());
    }

    #[test]
    fn a_trailing_dot_is_the_same_host() {
        let mut grant = grant();
        grant.sites.insert("denied.example".into(), SiteRule::Deny);
        grant
            .sites
            .insert("bank.example.".into(), SiteRule::AgentStore);
        assert_eq!(
            host_of("http://Denied.Example.:8/").as_deref(),
            Some("denied.example")
        );
        assert!(site_allowed(&grant, "http://denied.example./", Store::Agent).is_err());
        assert!(site_allowed(&grant, "http://a.denied.example../", Store::Agent).is_err());
        assert!(site_allowed(&grant, "https://bank.example./", Store::Reader).is_err());
        assert!(site_allowed(&grant, "https://bank.example/", Store::Reader).is_err());
        assert!(payment_host(
            host_of("https://js.stripe.com./").as_deref().unwrap_or("")
        ));
        assert!(social(
            host_of("https://mail.google.com./")
                .as_deref()
                .unwrap_or("")
        ));
    }

    fn keyed(grant: &Grant, facts: Facts, keys: &str) -> Option<Category> {
        let key = crate::agents::keys::chord(keys).expect("key");
        let (facts, act) = key_act(facts, &key)?;
        judge(grant, &facts, act, "https://shop.example/", &[]).map(|one| one.category)
    }

    #[test]
    fn a_key_on_a_button_is_a_press_of_it() {
        let grant = grant();
        for key in ["Space", "Enter", "Shift+Enter", "Control+Enter"] {
            assert_eq!(
                keyed(&grant, press("Pay now"), key),
                Some(Category::Paying),
                "{key}"
            );
            assert_eq!(
                keyed(&grant, press("Delete account"), key),
                Some(Category::Deleting),
                "{key}"
            );
        }
        let send = Facts {
            fields: vec![field("textarea", "Type a message"), field("email", "To")],
            ..press("Send")
        };
        assert_eq!(
            keyed(&grant, send.clone(), "Space"),
            Some(Category::Sending)
        );
        assert_eq!(keyed(&grant, send, "Enter"), Some(Category::Sending));
        assert_eq!(keyed(&grant, press("Pay now"), "Tab"), None);
        assert_eq!(keyed(&grant, press("Open menu"), "Space"), None);
    }

    #[test]
    fn a_key_on_a_sign_in_button_signs_in_as_the_mode_says() {
        let log_in = || Facts {
            submit: true,
            in_form: true,
            fields: vec![field("password", "Password")],
            ..press("Log in")
        };
        let grant = grant();
        assert_eq!(keyed(&grant, log_in(), "Space"), Some(Category::SigningIn));
        assert_eq!(keyed(&grant, log_in(), "Enter"), Some(Category::SigningIn));
        let mut full = grant.clone();
        full.mode = Mode::Autonomous;
        assert_eq!(keyed(&full, log_in(), "Space"), None);
    }

    #[test]
    fn enter_in_a_field_presses_its_forms_default_button() {
        let grant = grant();
        let field_of = |button: &str| Facts {
            tag: "input".into(),
            kind: "text".into(),
            editable: true,
            in_form: true,
            default_button: button.into(),
            field: field("text", "Name"),
            ..Facts::default()
        };
        assert_eq!(
            keyed(&grant, field_of("Delete account"), "Enter"),
            Some(Category::Deleting)
        );
        assert_eq!(
            keyed(&grant, field_of("Pay now"), "Enter"),
            Some(Category::Paying)
        );
        assert_eq!(keyed(&grant, field_of("Search"), "Enter"), None);
        let submitted = Facts {
            submit: true,
            ..field_of("Delete account")
        };
        let question = judge(&grant, &submitted, Act::Enter, "https://shop.example/", &[]);
        assert_eq!(
            question.as_ref().map(|one| one.category),
            Some(Category::Deleting)
        );
        assert_eq!(
            question.map(|one| one.summary).as_deref(),
            Some("Delete account on shop.example")
        );
        let tick = Facts {
            kind: "checkbox".into(),
            editable: false,
            field: field("checkbox", "Sure"),
            ..field_of("Delete account")
        };
        assert_eq!(keyed(&grant, tick, "Enter"), Some(Category::Deleting));
        let boxed = Facts {
            tag: "textarea".into(),
            kind: String::new(),
            field: field("textarea", "Notes"),
            ..field_of("Delete account")
        };
        assert_eq!(keyed(&grant, boxed, "Enter"), None);
        let other = Facts {
            default_button: "Delete account".into(),
            in_form: true,
            ..press("Open menu")
        };
        assert_eq!(keyed(&grant, other, "Space"), None);
        let mut full = grant.clone();
        full.mode = Mode::Autonomous;
        assert_eq!(keyed(&full, field_of("Delete account"), "Enter"), None);
    }

    #[test]
    fn a_press_on_what_cannot_be_read_asks() {
        let grant = grant();
        let host = || Facts {
            tag: "x-pay".into(),
            opaque: true,
            ..Facts::default()
        };
        assert_eq!(keyed(&grant, host(), "Space"), Some(Category::Unread));
        assert_eq!(keyed(&grant, host(), "Enter"), Some(Category::Unread));
        let mut full = grant.clone();
        full.mode = Mode::Autonomous;
        assert_eq!(keyed(&full, host(), "Space"), None);
    }

    #[test]
    fn the_apps_own_hosts_are_off_the_web_with_a_trailing_dot_too() {
        for address in [
            "http://tauri.localhost/",
            "http://tauri.localhost./",
            "https://IPC.localhost../x",
            "http://asset.localhost./",
            "http://nib.localhost./",
        ] {
            assert!(!on_the_web(address), "{address}");
        }
    }

    #[test]
    fn a_key_in_a_box_is_not_a_press() {
        let grant = grant();
        let boxed = Facts {
            tag: "textarea".into(),
            name: "Pay this month's rent".into(),
            editable: true,
            ..Facts::default()
        };
        assert!(key_act(
            boxed.clone(),
            &crate::agents::keys::chord("Space").expect("key")
        )
        .is_none());
        let enter = key_act(boxed, &crate::agents::keys::chord("Enter").expect("key"));
        assert_eq!(enter.map(|(_, act)| act), Some(Act::Enter));
        let page = Facts {
            tag: "body".into(),
            name: "Delete old notes in this list".into(),
            ..Facts::default()
        };
        assert_eq!(keyed(&grant, page.clone(), "Space"), None);
        assert!(key_act(page, &crate::agents::keys::chord("Space").expect("key")).is_none());
        let tick = Facts {
            tag: "input".into(),
            kind: "checkbox".into(),
            in_form: true,
            fields: vec![field("password", "Password")],
            ..Facts::default()
        };
        assert_eq!(
            keyed(&grant, tick.clone(), "Enter"),
            Some(Category::SigningIn)
        );
        assert_eq!(keyed(&grant, tick, "Space"), None);
    }

    #[test]
    fn scripts_are_per_site() {
        let mut grant = grant();
        grant.scripts.push("docs.example".into());
        assert!(script_allowed(&grant, "api.docs.example"));
        assert!(!script_allowed(&grant, "shop.example"));
    }

    #[test]
    fn payment_processors_and_social_sites_are_known() {
        assert!(payment_host("js.stripe.com"));
        assert!(payment_host("www.paypal.com"));
        assert!(!payment_host("stripe.example"));
        assert!(social("mail.google.com"));
        assert!(!social("docs.google.com"));
    }
}
