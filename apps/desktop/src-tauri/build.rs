//! Tauri's own build step: it generates the context the app is compiled with,
//! which is where the config, the icons and the permissions come from.
//!
//! And two facts `nib mcp` needs without any of that, the identifier and the version;
//! see identity.rs, which the Chromium build's own build script runs as well.
//!
//! And on a Mac the App Intents in swift/: compiled into an object linked into the app,
//! and their metadata (`Metadata.appintents`) written where the bundle picks it up
//! (`bundle.macOS.files` in tauri.macos.conf.json). See src/siri.rs.

#[path = "identity.rs"]
mod identity;

fn main() {
    tauri_build::build();
    identity::say();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        app_intents::build();
    }
}

mod app_intents {
    use std::env;
    use std::path::PathBuf;
    use std::process::Command;

    /// The Swift files, compiled as one module.
    const SOURCES: &[&str] = &["swift/AddTask.swift"];

    /// The module the intents are in; the metadata names their types by it.
    const MODULE: &str = "NibIntents";

    /// The protocols whose conformances the compiler writes values out for, which the
    /// metadata processor reads the intents from (Xcode's own list, and a few spare).
    const PROTOCOLS: &str = r#"["AppIntent","AppEntity","AppEnum","EntityQuery","TransientAppEntity","AppShortcutsProvider","AppIntentsPackage","DynamicOptionsProvider"]"#;

    /// Where the metadata is written, relative to src-tauri; the bundle copies it from
    /// here into Contents/Resources.
    const METADATA: &str = "gen/app-intents";

    pub fn build() {
        for source in SOURCES {
            println!("cargo:rerun-if-changed={source}");
        }
        let out = PathBuf::from(env::var("OUT_DIR").unwrap());
        let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
            "aarch64" => "arm64",
            other => other,
        }
        .to_owned();
        let deployment = env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "13.3".into());
        let triple = format!("{arch}-apple-macosx{deployment}");
        let sdk = xcrun(&["--sdk", "macosx", "--show-sdk-path"]);
        let toolchain = PathBuf::from(xcrun(&["--find", "swiftc"]))
            .ancestors()
            .nth(3)
            .unwrap()
            .to_path_buf();

        let protocols = out.join("protocols.json");
        std::fs::write(&protocols, PROTOCOLS).unwrap();
        let object = out.join(format!("{MODULE}.o"));
        let values = out.join(format!("{MODULE}.swiftconstvalues"));
        let sources: Vec<PathBuf> = SOURCES.iter().map(|one| manifest.join(one)).collect();

        let mut swiftc = Command::new("xcrun");
        swiftc
            .args(["swiftc", "-parse-as-library", "-wmo", "-c", "-O"])
            .args(["-module-name", MODULE, "-target", &triple, "-sdk", &sdk])
            .arg("-o")
            .arg(&object)
            .arg("-emit-const-values-path")
            .arg(&values)
            .args(["-Xfrontend", "-const-gather-protocols-file", "-Xfrontend"])
            .arg(&protocols)
            .args(&sources);
        run(&mut swiftc);

        let source_list = out.join("sources.txt");
        let values_list = out.join("constvalues.txt");
        std::fs::write(&source_list, lines(&sources)).unwrap();
        std::fs::write(&values_list, lines(&[values])).unwrap();
        let metadata = manifest.join(METADATA);
        std::fs::create_dir_all(&metadata).unwrap();
        let mut processor = Command::new("xcrun");
        processor
            .arg("appintentsmetadataprocessor")
            .arg("--output")
            .arg(&metadata)
            .arg("--toolchain-dir")
            .arg(&toolchain)
            .args(["--module-name", MODULE, "--sdk-root", &sdk])
            .args(["--xcode-version", &xcode_build()])
            .args([
                "--platform-family",
                "macOS",
                "--deployment-target",
                &deployment,
            ])
            .args(["--target-triple", &triple])
            .arg("--source-file-list")
            .arg(&source_list)
            .arg("--swift-const-vals-list")
            .arg(&values_list)
            .arg("--binary-file")
            .arg(&object)
            .arg("--force");
        run(&mut processor);

        // The object into the app itself, not the library: the intents call back into
        // the app's Rust, and the system looks for their types in the main executable.
        // The Swift runtime and AppIntents come in by the object's own link commands.
        println!("cargo:rustc-link-arg-bins={}", object.display());
        println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
        println!(
            "cargo:rustc-link-search=native={}",
            toolchain.join("usr/lib/swift/macosx").display()
        );
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,/usr/lib/swift");
    }

    fn lines(paths: &[PathBuf]) -> String {
        paths.iter().fold(String::new(), |all, one| {
            all + &one.display().to_string() + "\n"
        })
    }

    fn xcrun(args: &[&str]) -> String {
        let out = Command::new("xcrun").args(args).output().expect("xcrun");
        assert!(out.status.success(), "xcrun {args:?} failed");
        String::from_utf8(out.stdout).unwrap().trim().to_owned()
    }

    /// Xcode's build number, which the metadata records as the tools that made it.
    fn xcode_build() -> String {
        let out = Command::new("xcodebuild")
            .arg("-version")
            .output()
            .expect("xcodebuild");
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .find_map(|line| line.strip_prefix("Build version "))
            .unwrap_or_default()
            .trim()
            .to_owned()
    }

    fn run(command: &mut Command) {
        let status = command.status().expect("could not start xcrun");
        assert!(status.success(), "{command:?} failed");
    }
}
