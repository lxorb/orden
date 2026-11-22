#![cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::PathBuf;

use orden_opencode::env::{env_of, MOVED};
use orden_opencode::{Dirs, Launch, Status};
use serde_json::json;

#[test]
fn the_server_lives_in_ordens_folder_and_says_its_state_plainly() {
    let root = PathBuf::from("/data/opencode");
    let launch = Launch {
        binary: PathBuf::from("/opt/opencode"),
        dirs: Dirs { root: root.clone() },
        config: json!({}),
        auth: None,
    };
    let env = env_of(&launch, "pw", |_| None);
    for var in MOVED {
        let given = env.iter().find(|(name, _)| name == var).map(|(_, value)| PathBuf::from(value));
        assert!(given.is_some_and(|path| path.starts_with(&root)), "{var}");
    }
    assert_eq!(
        serde_json::to_value(orden_opencode::host::status()).expect("json"),
        json!({ "state": "off", "port": null })
    );
    let _: fn() = orden_opencode::stop_all;
    assert!(orden_opencode::proxy::allowed("POST", "/session/ses_1/prompt_async"));
    assert!(!orden_opencode::proxy::allowed("PATCH", "/config"));
    assert!(!orden_opencode::proxy::allowed("GET", "/session/..%2Fconfig"));
    let _ = std::any::type_name::<Status>();
}
