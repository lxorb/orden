fn main() {
    println!("cargo::rustc-check-cfg=cfg(desktop)");
    println!("cargo::rustc-check-cfg=cfg(mobile)");
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let side = if os == "android" || os == "ios" { "mobile" } else { "desktop" };
    println!("cargo::rustc-cfg={side}");
}
