#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Packing {
    TarGz,
    BareTarGz,
    Zip,
}

#[derive(Clone, Copy, Debug)]
pub struct Pinned {
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub packing: Packing,
}

#[derive(Clone, Copy, Debug)]
pub struct Runtime {
    pub os: &'static str,
    pub arch: &'static str,
    pub archive: Pinned,
    pub java: &'static str,
    pub native: Option<Pinned>,
}

#[derive(Clone, Copy, Debug)]
pub struct Program {
    pub name: &'static str,
    pub version: &'static str,
    pub archive: Pinned,
    pub main: &'static str,
    pub args: &'static [&'static str],
    pub runtimes: &'static [Runtime],
}

const fn pinned(url: &'static str, size: u64, sha256: &'static str, packing: Packing) -> Pinned {
    Pinned {
        url,
        size,
        sha256,
        packing,
    }
}

macro_rules! jre {
    ($file:literal) => {
        concat!(
            "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/",
            $file
        )
    };
}

const WINDOWS_X64_JRE: Pinned = pinned(
    jre!("OpenJDK25U-jre_x64_windows_hotspot_25.0.5_8.zip"),
    58_589_419,
    "da78d54a2fcdbba1e92d5e3f07dd30236f96297891c4a21a781c3f38f5c0beae",
    Packing::Zip,
);

pub const SIGNAL_CLI: Program = Program {
    name: "signal-cli",
    version: "0.14.9-25.0.5",
    archive: pinned(
        "https://github.com/AsamK/signal-cli/releases/download/v0.14.9/signal-cli-0.14.9.tar.gz",
        124_262_811,
        "c32b87f587198cbd277c9d71228716ee6047ee2b63e8e88728e8280d9407d65a",
        Packing::TarGz,
    ),
    main: "org.asamk.signal.Main",
    args: &["jsonRpc", "--receive-mode=manual", "--ignore-stories"],
    runtimes: &[
        Runtime {
            os: "linux",
            arch: "x86_64",
            archive: pinned(
                jre!("OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz"),
                61_736_206,
                "6fac98f0c8202efc3135a9e9e42aa61963ec42d1c5cbb40caf231e7b14a24ef6",
                Packing::TarGz,
            ),
            java: "bin/java",
            native: None,
        },
        Runtime {
            os: "linux",
            arch: "aarch64",
            archive: pinned(
                jre!("OpenJDK25U-jre_aarch64_linux_hotspot_25.0.5_8.tar.gz"),
                60_517_419,
                "963931723891302ebb2687178532c3d793d71e2577cd058061c7efb396140a86",
                Packing::TarGz,
            ),
            java: "bin/java",
            native: Some(pinned(
                "https://github.com/exquo/signal-libs-build/releases/download/libsignal_v0.103.0/libsignal_jni.so-v0.103.0-aarch64-unknown-linux-gnu.tar.gz",
                10_340_511,
                "bc112187bef1989ac5a3de14a0e43c53ba6c0c7fbc20b97cc363e92a7012728f",
                Packing::BareTarGz,
            )),
        },
        Runtime {
            os: "macos",
            arch: "x86_64",
            archive: pinned(
                jre!("OpenJDK25U-jre_x64_mac_hotspot_25.0.5_8.tar.gz"),
                42_207_761,
                "806902c796c670969b7b27df73b8f0fe0924a61bd65083aa53064115e49cab2d",
                Packing::TarGz,
            ),
            java: "Contents/Home/bin/java",
            native: None,
        },
        Runtime {
            os: "macos",
            arch: "aarch64",
            archive: pinned(
                jre!("OpenJDK25U-jre_aarch64_mac_hotspot_25.0.5_8.tar.gz"),
                56_298_727,
                "72ebd76b502c849e88dea39afae51baf5f82f2b5b1b6389c28ea707b20451bce",
                Packing::TarGz,
            ),
            java: "Contents/Home/bin/java",
            native: None,
        },
        Runtime {
            os: "windows",
            arch: "x86_64",
            archive: WINDOWS_X64_JRE,
            java: "bin/java.exe",
            native: None,
        },
        Runtime {
            os: "windows",
            arch: "aarch64",
            archive: WINDOWS_X64_JRE,
            java: "bin/java.exe",
            native: None,
        },
    ],
};

pub const PROGRAMS: &[Program] = &[SIGNAL_CLI];

pub fn program(name: &str) -> Option<&'static Program> {
    PROGRAMS.iter().find(|one| one.name == name)
}

fn system_name(os: &str) -> &str {
    match os {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    }
}

fn chip_name(arch: &str) -> &str {
    match arch {
        "x86_64" => "x64",
        "aarch64" => "ARM64",
        other => other,
    }
}

impl Program {
    pub fn runtime_on(&self, os: &str, arch: &str) -> Option<&'static Runtime> {
        self.runtimes
            .iter()
            .find(|one| one.os == os && one.arch == arch)
    }

    pub fn runnable_on(&self, os: &str, arch: &str) -> Result<&'static Runtime, String> {
        if let Some(runtime) = self.runtime_on(os, arch) {
            return Ok(runtime);
        }
        Err(format!(
            "{} does not run on {} on {}: there is no Java and Signal library made for it",
            self.name,
            system_name(os),
            chip_name(arch)
        ))
    }

    pub fn runnable(&self) -> Result<&'static Runtime, String> {
        self.runnable_on(std::env::consts::OS, std::env::consts::ARCH)
    }

    pub fn allows(&self, args: &[String]) -> Result<(), String> {
        match args.iter().find(|one| !self.args.contains(&one.as_str())) {
            Some(one) => Err(format!("{one} is not something Orden asks {}", self.name)),
            None if args.is_empty() => Err(format!("{} was asked nothing", self.name)),
            None => Ok(()),
        }
    }
}
