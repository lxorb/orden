#[path = "identity.rs"]
mod identity;

fn main() {
    tauri_build::build();
    identity::say();
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("windows")
            .join("tests.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        app_intents::build();
    }
}

mod app_intents {
    use std::env;
    use std::path::PathBuf;
    use std::process::Command;

    const SOURCES: &[&str] = &["swift/AddTask.swift"];

    const MODULE: &str = "NibIntents";

    const PROTOCOLS: &str = r#"["AppIntent","AppEntity","AppEnum","EntityQuery","TransientAppEntity","AppShortcutsProvider","AppIntentsPackage","DynamicOptionsProvider"]"#;

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
