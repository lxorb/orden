pub const RUNTIME_VERSION: &str = "2.0.1";

#[derive(Clone, Copy, Debug)]
pub struct Pinned {
    pub name: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub struct Runtime {
    pub rid: &'static str,
    pub package: Pinned,
    pub onnxruntime: Pinned,
    pub api: Pinned,
}

impl Runtime {
    pub fn url(&self) -> String {
        let id = format!("org.k2fsa.sherpa.onnx.runtime.{}", self.rid);
        format!("https://api.nuget.org/v3-flatcontainer/{id}/{RUNTIME_VERSION}/{id}.{RUNTIME_VERSION}.nupkg")
    }
}

const fn pinned(name: &'static str, size: u64, sha256: &'static str) -> Pinned {
    Pinned { name, size, sha256 }
}

const fn runtime(rid: &'static str, package: Pinned, onnxruntime: Pinned, api: Pinned) -> Runtime {
    Runtime {
        rid,
        package,
        onnxruntime,
        api,
    }
}

pub const RUNTIMES: &[Runtime] = &[
    runtime(
        "win-x64",
        pinned(
            "package.zip",
            8_413_229,
            "aa1af9048923eee5790c6626b8857803f9b637c1d9290bc5aa14496ed430da4e",
        ),
        pinned(
            "onnxruntime.dll",
            17_799_168,
            "7f66f939a881baf4f46a2216496798edf4a1429878b646d12674aa62f27d8a25",
        ),
        pinned(
            "sherpa-onnx-c-api.dll",
            4_294_656,
            "5dd36dbd3572846b72c4a40a4017c5a770160ee8e00da5053bebc8b2632501e8",
        ),
    ),
    runtime(
        "win-arm64",
        pinned(
            "package.zip",
            8_029_645,
            "bb6598a20d267e62b549d90cc5dd7dcf7088e5545e0fa678ec2991dc915d0795",
        ),
        pinned(
            "onnxruntime.dll",
            17_635_328,
            "968d081836cad9af537105f59e34d4997bca2ce6d78ff39d3e47660620e8a642",
        ),
        pinned(
            "sherpa-onnx-c-api.dll",
            4_293_120,
            "c0a4ef195d3df57cd2c791c85d181273810dfdce69b53fd004277840974dd028",
        ),
    ),
    runtime(
        "osx-arm64",
        pinned(
            "package.zip",
            9_783_984,
            "9944605af98d3306837e4208d0ae42c0526c2e28db38eb7512969babdfc6a259",
        ),
        pinned(
            "libonnxruntime.dylib",
            29_006_384,
            "b0613d0ae53199a83b05fa48e169211498e9d40d54beaa372068ebe5ec5b0929",
        ),
        pinned(
            "libsherpa-onnx-c-api.dylib",
            4_139_368,
            "97d6d1d646549896b2cc596a7be8f7ff7e766da5f0828d55f7b098857d497bc6",
        ),
    ),
    runtime(
        "osx-x64",
        pinned(
            "package.zip",
            10_973_176,
            "60eb5dee411e64589ddd235e1d01d9a4cd353650a537d43c8b2a2f6379eabcb2",
        ),
        pinned(
            "libonnxruntime.dylib",
            32_315_856,
            "2bf27180c09e6fd3f407c9ab25205ebf1ff95f2d53bfa35e35409b5849e0ac70",
        ),
        pinned(
            "libsherpa-onnx-c-api.dylib",
            4_442_976,
            "66875970f5e899b82bbd68d171976c4a2efa3c6baa91db4e598c0381069cab34",
        ),
    ),
    runtime(
        "linux-x64",
        pinned(
            "package.zip",
            10_694_863,
            "9f826edb3e72b7a7c9fc30310d66a7ab03972cf3b993c3ee65a2dd05bae85427",
        ),
        pinned(
            "libonnxruntime.so",
            27_026_609,
            "4b3607aebd1784b26b6f9b20e4bd974c7ab8287043e4d095cb7d2cb40b5e566e",
        ),
        pinned(
            "libsherpa-onnx-c-api.so",
            4_892_512,
            "250bf877faccc35d311041f7da84ad652772857be935eaa789f4c621a1d56e3e",
        ),
    ),
    runtime(
        "linux-arm64",
        pinned(
            "package.zip",
            13_535_140,
            "193a36bfb098e953764f393f8e9923e54c02aa87b0e9c437b915376827ec0978",
        ),
        pinned(
            "libonnxruntime.so",
            34_606_912,
            "cfc800d4438f15e8d9017521326776ca7117d8783cb847ccccc2fc61ac4d540f",
        ),
        pinned(
            "libsherpa-onnx-c-api.so",
            4_443_416,
            "0ff5424726570888040e9e4ba2de7b145d77e298a61bb9db9f5d793af4f6f7ad",
        ),
    ),
];

pub fn rid_of(os: &str, arch: &str) -> Option<&'static str> {
    Some(match (os, arch) {
        ("windows", "x86_64") => "win-x64",
        ("windows", "aarch64") => "win-arm64",
        ("macos", "aarch64") => "osx-arm64",
        ("macos", "x86_64") => "osx-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        _ => return None,
    })
}

pub fn this_runtime() -> Option<&'static Runtime> {
    let rid = rid_of(std::env::consts::OS, std::env::consts::ARCH)?;
    RUNTIMES.iter().find(|one| one.rid == rid)
}

#[derive(Clone, Copy, Debug)]
pub struct Model {
    pub id: &'static str,
    pub name: &'static str,
    pub base: &'static str,
    pub files: &'static [Pinned],
    pub memory: u64,
}

impl Model {
    pub fn url(&self, file: &Pinned) -> String {
        format!("{}/{}", self.base, file.name)
    }

    pub fn bytes(&self) -> u64 {
        self.files.iter().map(|one| one.size).sum()
    }
}

pub const PARAKEET: Model = Model {
    id: "parakeet-tdt-0.6b-v3-int8",
    name: "NVIDIA Parakeet TDT 0.6B v3 (CC BY 4.0)",
    base: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78",
    files: &[
        pinned("encoder.int8.onnx", 652_184_281, "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247"),
        pinned("decoder.int8.onnx", 11_845_275, "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e"),
        pinned("joiner.int8.onnx", 6_355_277, "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3"),
        pinned("tokens.txt", 93_939, "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"),
    ],
    memory: 4,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_platform_orden_ships_on_has_a_runtime() {
        for (os, arch) in [
            ("windows", "x86_64"),
            ("windows", "aarch64"),
            ("macos", "aarch64"),
            ("macos", "x86_64"),
            ("linux", "x86_64"),
            ("linux", "aarch64"),
        ] {
            let rid = rid_of(os, arch).unwrap();
            assert!(RUNTIMES.iter().any(|one| one.rid == rid), "{rid}");
        }
        assert_eq!(rid_of("android", "aarch64"), None);
    }

    #[test]
    fn every_pin_is_a_whole_sha256() {
        let pins = RUNTIMES
            .iter()
            .flat_map(|one| [one.package, one.onnxruntime, one.api])
            .chain(PARAKEET.files.iter().copied());
        for pin in pins {
            assert_eq!(pin.sha256.len(), 64, "{}", pin.name);
            assert!(pin
                .sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
            assert!(pin.size > 0);
        }
    }

    #[test]
    fn a_runtime_is_fetched_from_its_own_package() {
        let linux = RUNTIMES.iter().find(|one| one.rid == "linux-x64").unwrap();
        assert_eq!(
            linux.url(),
            "https://api.nuget.org/v3-flatcontainer/org.k2fsa.sherpa.onnx.runtime.linux-x64/2.0.1/org.k2fsa.sherpa.onnx.runtime.linux-x64.2.0.1.nupkg"
        );
    }
}
