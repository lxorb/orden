pub fn say() {
    let config = config();
    let said = |key: &str| {
        config
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    println!("cargo:rustc-env=ORDEN_IDENTIFIER={}", said("identifier"));
    println!("cargo:rustc-env=ORDEN_VERSION={}", said("version"));
}

fn config() -> serde_json::Value {
    let target = std::env::var("TARGET").unwrap_or_default();
    let here = std::env::current_dir().expect("the build runs in the app's folder");
    let (mut config, _) = tauri_utils::config::parse::read_from(
        tauri_utils::platform::Target::from_triple(&target),
        &here,
    )
    .expect("tauri.conf.json, which tauri-build has just read");

    let asked = std::env::var("TAURI_CONFIG").ok();
    let over = asked
        .as_deref()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok());
    if let (Some(serde_json::Value::Object(over)), serde_json::Value::Object(held)) =
        (over, &mut config)
    {
        held.extend(over);
    }
    config
}
