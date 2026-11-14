use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use zeroize::Zeroizing;

const LENGTH: usize = 32;

const SHORTEST_SALT: usize = 8;

fn stretch_params(salt: &[u8], m: u32, t: u32, p: u32) -> Result<Params, String> {
    let sound = (8..=1_048_576).contains(&m)
        && (1..=10).contains(&t)
        && (1..=4).contains(&p)
        && u64::from(m) >= 8 * u64::from(p);
    if !sound {
        return Err("the stretch's memory, passes or lanes are out of bounds".into());
    }
    if salt.len() < SHORTEST_SALT {
        return Err("the salt is shorter than 8 bytes".into());
    }
    Params::new(m, t, p, Some(LENGTH)).map_err(|_| "the stretch's settings were refused".into())
}

fn secret_stretched(
    secret: &[u8],
    salt: &[u8],
    m: u32,
    t: u32,
    p: u32,
) -> Result<Zeroizing<[u8; LENGTH]>, String> {
    let params = stretch_params(salt, m, t, p)?;
    let mut key = Zeroizing::new([0u8; LENGTH]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret, salt, key.as_mut())
        .map_err(|_| "the secret could not be secret_stretched".to_string())?;
    Ok(key)
}

#[tauri::command]
pub async fn pass_stretch(
    webview: tauri::Webview,
    secret: String,
    salt: String,
    m: u32,
    t: u32,
    p: u32,
) -> Result<String, String> {
    #[cfg(desktop)]
    crate::agents::from_the_app(&webview)?;
    #[cfg(mobile)]
    let _ = webview;
    let secret = Zeroizing::new(secret);
    let salt = STANDARD
        .decode(salt.as_bytes())
        .map_err(|_| "the salt is not base64".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let key = secret_stretched(secret.as_bytes(), &salt, m, t, p)?;
        Ok(STANDARD.encode(key.as_ref()))
    })
    .await
    .map_err(|_| "the secret could not be secret_stretched".to_string())?
}

#[cfg(test)]
mod tests {
    use std::fmt::Write as _;

    use super::secret_stretched;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().fold(String::new(), |mut out, one| {
            let _ = write!(out, "{one:02x}");
            out
        })
    }

    #[test]
    fn the_reference_vector_stretches_to_its_key() {
        let key =
            secret_stretched(b"password", b"somesalt", 65536, 2, 1).expect("secret_stretched");
        assert_eq!(
            hex(key.as_ref()),
            "09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7"
        );
    }

    #[test]
    fn settings_out_of_bounds_are_refused_without_saying_the_secret() {
        let salt = b"somesalt";
        for (m, t, p) in [
            (7, 1, 1),
            (1_048_577, 1, 1),
            (16, 1, 4),
            (64, 0, 1),
            (64, 11, 1),
            (64, 1, 0),
            (64, 1, 5),
        ] {
            let refused = secret_stretched(b"hunter2", salt, m, t, p).expect_err("out of bounds");
            assert!(!refused.contains("hunter2"), "{refused}");
        }
        assert!(secret_stretched(b"hunter2", b"short", 64, 1, 1).is_err());
        assert!(secret_stretched(b"hunter2", salt, 32, 1, 4).is_ok());
    }
}
