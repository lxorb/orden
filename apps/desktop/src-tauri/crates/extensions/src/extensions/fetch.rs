use super::link::Store;

const PRODUCT_VERSION: &str = "154.0.0.0";
const MOST_BYTES: usize = 256 * 1024 * 1024;
const CONNECTING: std::time::Duration = std::time::Duration::from_secs(20);
const SILENT: std::time::Duration = std::time::Duration::from_secs(60);
pub fn client() -> Result<reqwest::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .connect_timeout(CONNECTING)
        .read_timeout(SILENT)
        .build()
        .map_err(|error| error.to_string())
}
fn service(store: Store, response: &str, x: &str) -> Result<String, String> {
    match store {
        Store::Chrome => Ok(format!(
            "https://clients2.google.com/service/update2/crx?response={response}&acceptformat=crx3&prodversion={PRODUCT_VERSION}&x={x}"
        )),
        Store::Edge => Ok(format!(
            "https://edge.microsoft.com/extensionwebstorebase/v1/crx?response={response}&prod=chromiumcrx&prodchannel=&prodversion={PRODUCT_VERSION}&x={x}"
        )),
        Store::Firefox => Err("addons.mozilla.org is asked through its own API".into()),
    }
}
pub async fn crx(store: Store, id: &str) -> Result<Vec<u8>, String> {
    let x = format!("id%3D{id}%26installsource%3Dondemand%26uc");
    file(&service(store, "redirect", &x)?).await
}
pub async fn file(url: &str) -> Result<Vec<u8>, String> {
    let bytes = download(url).await?;
    if bytes.is_empty() {
        return Err("the store did not hand out that extension".into());
    }
    Ok(bytes)
}
pub async fn newer(store: Store, id: &str, version: &str) -> Result<Option<String>, String> {
    let x = format!("id%3D{id}%26v%3D{version}%26uc");
    let said = client()?
        .get(service(store, "updatecheck", &x)?)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(offline)?
        .text()
        .await
        .map_err(offline)?;
    Ok(update_in(&said)?.filter(|(found, _)| later(found, version)).map(|(_, file)| file))
}
fn update_in(xml: &str) -> Result<Option<(String, String)>, String> {
    let unread = || "the store's answer about updates cannot be read".to_string();
    let at = xml.find("<updatecheck").ok_or_else(unread)?;
    let tag = &xml[at..at + xml[at..].find('>').ok_or_else(unread)?];
    let attribute = |name: &str| {
        let start = tag.find(&format!(" {name}=\""))? + name.len() + 3;
        let end = start + tag[start..].find('"')?;
        Some(tag[start..end].replace("&amp;", "&"))
    };
    match attribute("status").as_deref() {
        Some("noupdate") => return Ok(None),
        Some("ok") | None => {}
        Some(other) => return Err(format!("the store did not offer an update: {other}")),
    }
    Ok(Some((attribute("version").ok_or_else(unread)?, attribute("codebase").ok_or_else(unread)?)))
}
fn later(a: &str, b: &str) -> bool {
    let numbers = |version: &str| -> Vec<u64> {
        version.split('.').map(|part| part.parse().unwrap_or(0)).collect()
    };
    let (a, b) = (numbers(a), numbers(b));
    for at in 0..a.len().max(b.len()) {
        let (one, two) = (a.get(at).copied().unwrap_or(0), b.get(at).copied().unwrap_or(0));
        if one != two {
            return one > two;
        }
    }
    false
}
pub async fn download(url: &str) -> Result<Vec<u8>, String> {
    capped(url, MOST_BYTES).await
}
async fn capped(url: &str, most: usize) -> Result<Vec<u8>, String> {
    let mut response = client()?
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(offline)?;
    if response.content_length().is_some_and(|length| length > most as u64) {
        return Err("that extension is too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(offline)? {
        if bytes.len() + chunk.len() > most {
            return Err("that extension is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
pub fn offline(error: reqwest::Error) -> String {
    format!("the store could not be reached: {error}")
}
#[cfg(test)]
mod tests {
    use super::{capped, later, service, update_in, Store};
    use std::io::{Read as _, Write as _};

    fn serving(chunks: usize) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port");
        let address = listener.local_addr().expect("its address");
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("the client");
            let mut asked = [0_u8; 4096];
            let _ = socket.read(&mut asked);
            let _ = socket.write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            );
            for _ in 0..chunks {
                if socket.write_all(b"400\r\n").is_err()
                    || socket.write_all(&[7_u8; 1024]).is_err()
                    || socket.write_all(b"\r\n").is_err()
                {
                    return;
                }
            }
            let _ = socket.write_all(b"0\r\n\r\n");
        });
        format!("http://{address}/x.crx")
    }
    #[test]
    fn a_download_that_says_no_length_is_cut_off_at_the_most_it_may_be() {
        let small = tauri::async_runtime::block_on(capped(&serving(2), 4096));
        assert_eq!(small.map(|bytes| bytes.len()), Ok(2048));
        let large = tauri::async_runtime::block_on(capped(&serving(64), 4096));
        assert_eq!(large, Err("that extension is too large".to_owned()));
    }
    #[test]
    fn each_store_is_asked_for_its_own_file_and_amo_is_not() {
        let id = "ghmbeldphafepmbegfdlkpapadhbakde";
        let x = format!("id%3D{id}%26installsource%3Dondemand%26uc");
        let chrome = service(Store::Chrome, "redirect", &x).expect("Chrome's");
        assert!(chrome.starts_with("https://clients2.google.com/service/update2/crx?"), "{chrome}");
        assert!(chrome.contains(&format!("x=id%3D{id}%26")), "{chrome}");
        let edge = service(Store::Edge, "redirect", &x).expect("Edge's");
        assert!(edge.starts_with("https://edge.microsoft.com/extensionwebstorebase/"), "{edge}");
        assert!(edge.contains(&format!("x=id%3D{id}%26")), "{edge}");
        assert!(service(Store::Firefox, "redirect", &x).is_err());
    }
    #[test]
    fn an_update_answer_says_the_version_and_the_file_or_why_not() {
        let offered = r#"<?xml version="1.0"?><gupdate><app appid="x" status="ok"><updatecheck status="ok" codebase="http://host/files/f?P1=1&amp;P2=2" version="2026.930.1227" /></app></gupdate>"#;
        assert_eq!(
            update_in(offered),
            Ok(Some(("2026.930.1227".to_owned(), "http://host/files/f?P1=1&P2=2".to_owned())))
        );
        let none = r#"<gupdate><app appid="x" status="ok"><updatecheck _esbAllowlist="true" status="noupdate"/></app></gupdate>"#;
        assert_eq!(update_in(none), Ok(None));
        let gone = r#"<gupdate><app appid="x" status="ok"><updatecheck status="error-unknownApplication"/></app></gupdate>"#;
        assert!(update_in(gone).is_err_and(|why| why.contains("error-unknownApplication")));
        assert!(update_in("<html>").is_err());
    }
    #[test]
    fn versions_compare_as_numbers() {
        assert!(later("2026.930.1227", "2026.92.1"));
        assert!(later("1.10", "1.9"));
        assert!(later("1.0.1", "1"));
        assert!(!later("1.0", "1"));
        assert!(!later("1.2", "1.10"));
    }
}
