#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn main() -> std::process::ExitCode {
    orden_opencode::shell::wrapped()
}
#[cfg(any(target_os = "android", target_os = "ios"))]
fn main() {}
