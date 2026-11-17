use std::borrow::Cow;
use tauri::ipc::InvokeBody;

pub const ARGS_HEADER: &str = "orden-args";

pub fn raw_sent<'a, T: serde::de::DeserializeOwned>(
    headers: &tauri::http::HeaderMap,
    body: &'a InvokeBody,
) -> Result<(T, Cow<'a, [u8]>), String> {
    let sent = headers
        .get(ARGS_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or("bytes came without what to do with them")?;
    let words = percent_encoding::percent_decode_str(sent)
        .decode_utf8()
        .map_err(|_| "what came with the bytes is not words".to_owned())?;
    let args = serde_json::from_str(&words)
        .map_err(|error| format!("what came with the bytes is not understood: {error}"))?;
    let bytes = bytes_sent(body).ok_or("what came is not bytes")?;
    Ok((args, bytes))
}

pub fn bytes_sent(body: &InvokeBody) -> Option<Cow<'_, [u8]>> {
    match body {
        InvokeBody::Raw(bytes) => Some(Cow::Borrowed(bytes)),
        InvokeBody::Json(serde_json::Value::Array(numbers)) => numbers
            .iter()
            .map(|one| one.as_u64().and_then(|number| u8::try_from(number).ok()))
            .collect::<Option<Vec<u8>>>()
            .map(Cow::Owned),
        InvokeBody::Json(_) => None,
    }
}

#[cfg(test)]
mod tests {
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff];

    #[test]
    fn what_is_sent_beside_raw_bytes_is_read_back_whole() {
        #[derive(serde::Deserialize, Debug, PartialEq)]
        struct Asked {
            path: String,
        }
        let header = |value: &str| {
            let mut headers = tauri::http::HeaderMap::new();
            headers.insert(super::ARGS_HEADER, value.parse().expect("a header"));
            headers
        };
        let read = |headers: tauri::http::HeaderMap, body: tauri::ipc::InvokeBody| {
            super::raw_sent::<Asked>(&headers, &body)
                .map(|(asked, bytes)| (asked, bytes.into_owned()))
        };
        assert_eq!(
            read(
                header("%7B%22path%22%3A%22C%3A%2FNotes%2F%C3%BCber%20uns.png%22%7D"),
                tauri::ipc::InvokeBody::Raw(PNG.to_vec())
            ),
            Ok((
                Asked {
                    path: "C:/Notes/über uns.png".to_owned()
                },
                PNG.to_vec()
            ))
        );
        assert!(read(
            tauri::http::HeaderMap::new(),
            tauri::ipc::InvokeBody::Raw(PNG.to_vec())
        )
        .is_err());
        assert!(read(header("%FF"), tauri::ipc::InvokeBody::Raw(PNG.to_vec())).is_err());
        assert!(read(header("%7B%7D"), tauri::ipc::InvokeBody::Raw(PNG.to_vec())).is_err());
    }

    #[test]
    fn bytes_arrive_raw_or_as_numbers_and_nothing_else() {
        use tauri::ipc::InvokeBody;
        let raw = InvokeBody::Raw(PNG.to_vec());
        assert_eq!(super::bytes_sent(&raw).as_deref(), Some(PNG));
        let numbers = InvokeBody::Json(serde_json::json!([1, 2, 255]));
        assert_eq!(
            super::bytes_sent(&numbers).as_deref(),
            Some(&[1_u8, 2, 255][..])
        );
        assert!(super::bytes_sent(&InvokeBody::Json(serde_json::json!([256]))).is_none());
        assert!(super::bytes_sent(&InvokeBody::Json(serde_json::json!({ "0": 1 }))).is_none());
    }
}
