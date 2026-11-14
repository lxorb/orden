use serde::Serialize;
use sha2::{Digest as _, Sha256};
use tauri::AppHandle;

mod separately;
mod x509;

#[path = "web_certificate/chromium.rs"]
mod engine;

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Party {
    pub name: String,
    pub organization: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub to: Party,
    pub by: Party,
    pub from: i64,
    pub until: i64,
    pub serial: String,
    pub sha256: String,
    pub root: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Certificate {
    pub secure: bool,
    pub separately: bool,
    pub chain: Vec<Link>,
}

pub struct Served {
    secure: bool,
    chain: Vec<Vec<u8>>,
}

#[tauri::command]
pub async fn web_certificate(
    app: AppHandle,
    tab: String,
    address: String,
) -> Result<Option<Certificate>, String> {
    let view = crate::web_tabs::found(&app, &tab)?;
    if let Some(served) = engine::read(view, &address).await {
        if let Some(said) = Certificate::from_chain(served.secure, false, &served.chain) {
            return Ok(Some(said));
        }
    }
    let Ok(address) = tauri::Url::parse(&address) else {
        return Ok(None);
    };
    if address.scheme() != "https" {
        return Ok(None);
    }
    let chain = separately::read(address).await;
    Ok(Certificate::from_chain(true, true, &chain))
}

impl Certificate {
    fn from_chain(secure: bool, separately: bool, chain: &[Vec<u8>]) -> Option<Self> {
        let chain: Vec<Link> = chain.iter().map_while(|der| Link::from_der(der)).collect();
        (!chain.is_empty()).then_some(Self {
            secure,
            separately,
            chain,
        })
    }
}

impl Link {
    fn from_der(der: &[u8]) -> Option<Self> {
        let read = x509::fields(der)?;
        Some(Self {
            to: read.to,
            by: read.by,
            from: read.from,
            until: read.until,
            serial: hex(&read.serial),
            sha256: hex(&Sha256::digest(der)),
            root: read.own_issuer,
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::x509::tests::{der, INTERMEDIATE, ROOT, SITE};
    use super::{hex, Certificate};

    #[test]
    fn a_fingerprint_is_written_as_a_browser_writes_one() {
        assert_eq!(hex(&[0x0a, 0xff, 0x10]), "0A:FF:10");
        assert_eq!(hex(&[]), "");
    }

    #[test]
    fn the_whole_chain_is_told_site_first_up_to_the_root() {
        let said = Certificate::from_chain(true, false, &[der(SITE), der(INTERMEDIATE), der(ROOT)])
            .expect("a chain");
        let names: Vec<&str> = said.chain.iter().map(|one| one.to.name.as_str()).collect();
        assert_eq!(names, ["example.test", "Orden Test R1", "Orden Test Root"]);
        let roots: Vec<bool> = said.chain.iter().map(|one| one.root).collect();
        assert_eq!(roots, [false, false, true]);
        assert_eq!(said.chain[0].serial, "01:02:03:04:05");
        assert_eq!(
            said.chain[0].sha256,
            "69:78:C9:7A:DE:D0:CA:09:18:2D:0E:ED:A7:D5:C4:48:8C:18:83:26:80:C8:D6:8C:D1:FA:66:60:9A:D8:9E:E8"
        );
    }

    #[test]
    fn a_chain_is_cut_where_a_certificate_cannot_be_read() {
        let said = Certificate::from_chain(false, true, &[der(SITE), vec![1, 2, 3], der(ROOT)])
            .expect("a chain");
        assert_eq!(said.chain.len(), 1);
        assert!(said.separately);
        assert_eq!(
            Certificate::from_chain(true, false, &[vec![0x30, 0x00]]),
            None
        );
        assert_eq!(Certificate::from_chain(true, false, &[]), None);
    }

    #[test]
    fn the_popover_is_told_in_its_own_words() {
        let told = serde_json::to_value(
            Certificate::from_chain(true, false, &[der(SITE), der(INTERMEDIATE)]).expect("a chain"),
        )
        .expect("json");
        assert_eq!(told["secure"], true);
        assert_eq!(told["separately"], false);
        assert_eq!(told["chain"][0]["to"]["name"], "example.test");
        assert_eq!(
            told["chain"][0]["by"]["organization"][0],
            "Orden Test Authority"
        );
        assert_eq!(told["chain"][1]["root"], false);
        assert_eq!(told["chain"][0]["until"], 1_780_272_000_000_i64);
    }
}
