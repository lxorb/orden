use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Made {
    Vp8,
    Vp9,
    H264,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hardware {
    None,
    Vaapi,
    Qsv,
    Nvenc,
    Amf,
    VideoToolbox,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Encoder {
    pub name: &'static str,
    pub made: Made,
    pub hardware: Hardware,
}

pub const ALL: [Encoder; 9] = [
    one("h264_nvenc", Made::H264, Hardware::Nvenc),
    one("h264_vaapi", Made::H264, Hardware::Vaapi),
    one("h264_qsv", Made::H264, Hardware::Qsv),
    one("h264_amf", Made::H264, Hardware::Amf),
    one("vp9_vaapi", Made::Vp9, Hardware::Vaapi),
    one("vp9_qsv", Made::Vp9, Hardware::Qsv),
    one("vp8_vaapi", Made::Vp8, Hardware::Vaapi),
    one("h264_videotoolbox", Made::H264, Hardware::VideoToolbox),
    SOFTWARE,
];

pub const SOFTWARE: Encoder = one("libvpx", Made::Vp8, Hardware::None);

const fn one(name: &'static str, made: Made, hardware: Hardware) -> Encoder {
    Encoder {
        name,
        made,
        hardware,
    }
}

const RENDER_NODE: &str = "/dev/dri/renderD128";
const TRY_FOR: Duration = Duration::from_secs(5);

pub fn chosen(working: &[Encoder], decodes: &[Made]) -> Option<Encoder> {
    working
        .iter()
        .copied()
        .find(|one| decodes.contains(&one.made))
}

pub fn working() -> &'static [Encoder] {
    static FOUND: OnceLock<Vec<Encoder>> = OnceLock::new();
    FOUND.get_or_init(|| {
        let mut found: Vec<Encoder> = ALL
            .iter()
            .copied()
            .filter(|one| one.hardware != Hardware::None)
            .filter(|one| ours(one.hardware))
            .filter(|one| works(*one))
            .collect();
        found.push(SOFTWARE);
        found
    })
}

fn ours(hardware: Hardware) -> bool {
    (hardware == Hardware::VideoToolbox) == cfg!(target_os = "macos")
}

const MAC_FOLDERS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];

pub fn ffmpeg() -> Option<PathBuf> {
    static FOUND: OnceLock<Option<PathBuf>> = OnceLock::new();
    FOUND
        .get_or_init(|| {
            super::installed::which("ffmpeg")
                .or_else(|| {
                    let links = PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
                        .join("Microsoft\\WinGet\\Links\\ffmpeg.exe");
                    (cfg!(windows) && links.is_file()).then_some(links)
                })
                .or_else(|| {
                    MAC_FOLDERS
                        .iter()
                        .map(|folder| PathBuf::from(folder).join("ffmpeg"))
                        .find(|one| cfg!(target_os = "macos") && one.is_file())
                })
        })
        .clone()
}

pub fn command() -> Command {
    let command = Command::new(ffmpeg().unwrap_or_else(|| PathBuf::from("ffmpeg")));
    #[cfg(windows)]
    let command = {
        use std::os::windows::process::CommandExt as _;
        const NO_WINDOW: u32 = 0x0800_0000;
        let mut command = command;
        command.creation_flags(NO_WINDOW);
        command
    };
    command
}

fn works(encoder: Encoder) -> bool {
    if encoder.hardware == Hardware::Vaapi && !std::path::Path::new(RENDER_NODE).exists() {
        return false;
    }
    let mut args = device_args(encoder.hardware);
    args.extend(words("-f lavfi -i testsrc=size=320x240:rate=1 -frames:v 1"));
    args.extend(upload_args(encoder.hardware));
    args.extend(["-c:v".to_owned(), encoder.name.to_owned()]);
    args.extend(tuning_args(encoder, 1));
    args.extend(["-f", "null", "-"].map(str::to_owned));
    let Ok(mut child) = command()
        .args(["-hide_banner", "-loglevel", "quiet", "-nostdin"])
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let until = Instant::now() + TRY_FOR;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

fn words(line: &str) -> Vec<String> {
    line.split_whitespace().map(str::to_owned).collect()
}

fn device_args(hardware: Hardware) -> Vec<String> {
    let words: &[&str] = match hardware {
        Hardware::Vaapi => &[
            "-init_hw_device",
            "vaapi=va:/dev/dri/renderD128",
            "-filter_hw_device",
            "va",
        ],
        Hardware::Qsv => &["-init_hw_device", "qsv=hw", "-filter_hw_device", "hw"],
        Hardware::Nvenc | Hardware::Amf | Hardware::VideoToolbox | Hardware::None => &[],
    };
    words.iter().map(|&one| one.to_owned()).collect()
}

fn upload_args(hardware: Hardware) -> Vec<String> {
    let words: &[&str] = match hardware {
        Hardware::Vaapi => &["-vf", "format=nv12,hwupload"],
        Hardware::Qsv => &["-vf", "format=nv12,hwupload=extra_hw_frames=16"],
        Hardware::Nvenc | Hardware::Amf | Hardware::None => &["-pix_fmt", "yuv420p"],
        Hardware::VideoToolbox => &["-pix_fmt", "nv12"],
    };
    words.iter().map(|&one| one.to_owned()).collect()
}

fn tuning_args(encoder: Encoder, threads: usize) -> Vec<String> {
    let words: &[&str] = match encoder.name {
        "libvpx" => &[
            "-deadline",
            "realtime",
            "-cpu-used",
            "8",
            "-lag-in-frames",
            "0",
            "-error-resilient",
            "1",
            "-auto-alt-ref",
            "0",
        ],
        "h264_nvenc" => &[
            "-preset",
            "p1",
            "-tune",
            "ull",
            "-zerolatency",
            "1",
            "-delay",
            "0",
            "-rc",
            "cbr",
            "-bf",
            "0",
            "-profile:v",
            "baseline",
        ],
        "h264_vaapi" => &[
            "-bf",
            "0",
            "-async_depth",
            "1",
            "-profile:v",
            "constrained_baseline",
        ],

        "h264_qsv" => &[
            "-bf",
            "0",
            "-async_depth",
            "1",
            "-look_ahead",
            "0",
            "-profile:v",
            "baseline",
        ],
        "h264_amf" => &[
            "-usage",
            "ultralowlatency",
            "-quality",
            "speed",
            "-profile:v",
            "constrained_baseline",
        ],
        "h264_videotoolbox" => &[
            "-realtime",
            "1",
            "-prio_speed",
            "1",
            "-bf",
            "0",
            "-profile:v",
            "constrained_baseline",
        ],
        "vp9_qsv" | "vp9_vaapi" | "vp8_vaapi" => &["-async_depth", "1"],
        _ => &[],
    };
    let mut args: Vec<String> = words.iter().map(|&one| one.to_owned()).collect();
    if encoder.hardware == Hardware::None {
        args.extend(["-threads".to_owned(), threads.to_string()]);
    }
    args
}

fn output_args(made: Made) -> Vec<String> {
    let words: &[&str] = match made {
        Made::Vp8 | Made::Vp9 => &["-f", "ivf"],
        Made::H264 => &["-bsf:v", "h264_metadata=aud=insert", "-f", "h264"],
    };
    words.iter().map(|&one| one.to_owned()).collect()
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to 10 to 60 first"
)]
pub fn frame_rate(hz: f64) -> u32 {
    if hz.is_finite() {
        hz.clamp(10.0, 60.0).round() as u32
    } else {
        60
    }
}

pub fn bit_rate(width: u32, height: u32, fps: u32) -> u64 {
    let pixels = u64::from(width) * u64::from(height) * u64::from(fps);
    (pixels / 10).clamp(1_000_000, 20_000_000)
}

pub fn encoder_args(encoder: Encoder, width: u16, height: u16, fps: u32) -> Vec<String> {
    let rate = bit_rate(u32::from(width), u32::from(height), fps);
    let threads = std::thread::available_parallelism()
        .map_or(2, std::num::NonZeroUsize::get)
        .clamp(1, 8);
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin"]
        .map(str::to_owned)
        .to_vec();
    args.extend(device_args(encoder.hardware));
    args.extend(words(&format!(
        "-f rawvideo -pix_fmt bgr0 -video_size {width}x{height} -framerate {fps} \
         -use_wallclock_as_timestamps 1 -i pipe:0"
    )));
    args.extend(upload_args(encoder.hardware));
    args.extend(["-c:v".to_owned(), encoder.name.to_owned()]);
    args.extend(tuning_args(encoder, threads));
    args.extend([
        "-b:v".to_owned(),
        rate.to_string(),
        "-maxrate".to_owned(),
        (rate * 3 / 2).to_string(),
        "-bufsize".to_owned(),
        (rate / 2).to_string(),
        "-g".to_owned(),
        (fps * 10).to_string(),
        "-fps_mode".to_owned(),
        "passthrough".to_owned(),
    ]);
    args.extend(output_args(encoder.made));
    args.extend(["-flush_packets", "1", "pipe:1"].map(str::to_owned));
    args
}

#[derive(Debug, Default)]
pub struct AccessUnits {
    kept: Vec<u8>,
}

impl AccessUnits {
    pub fn take(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        let mut from = self.kept.len().saturating_sub(4).max(2);
        self.kept.extend_from_slice(bytes);
        let mut frames = Vec::new();
        while let Some(at) = next_delimiter(&self.kept, from) {
            frames.push(self.kept.drain(..at).collect());
            from = 2;
        }
        frames
    }

    pub fn flush(&mut self) -> Option<Vec<u8>> {
        (self.kept.len() > 4).then(|| std::mem::take(&mut self.kept))
    }
}

fn next_delimiter(bytes: &[u8], from: usize) -> Option<usize> {
    let mut at = from;
    while at + 3 < bytes.len() {
        if bytes[at..at + 3] == [0, 0, 1] && (bytes[at + 3] & 0x1f) == 9 {
            return Some(if at > 0 && bytes[at - 1] == 0 {
                at - 1
            } else {
                at
            });
        }
        at += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_hardware_the_viewer_decodes_and_vp8_in_software_otherwise() {
        let named = |name: &str| *ALL.iter().find(|one| one.name == name).unwrap();
        let nvenc = named("h264_nvenc");
        let vp9 = named("vp9_vaapi");
        assert_eq!(
            chosen(&[nvenc, vp9, SOFTWARE], &[Made::Vp8, Made::H264]),
            Some(nvenc)
        );
        assert_eq!(
            chosen(&[nvenc, vp9, SOFTWARE], &[Made::Vp8, Made::Vp9]),
            Some(vp9)
        );
        assert_eq!(
            chosen(&[nvenc, SOFTWARE], &[Made::Vp8, Made::Vp9]),
            Some(SOFTWARE)
        );
        assert_eq!(chosen(&[SOFTWARE], &[Made::H264]), None);
    }

    #[test]
    fn reads_the_display_at_the_holders_refresh_rate_up_to_sixty() {
        assert_eq!(frame_rate(144.0), 60);
        assert_eq!(frame_rate(30.0), 30);
        assert_eq!(frame_rate(1.0), 10);
        assert_eq!(frame_rate(f64::NAN), 60);
    }

    #[test]
    fn gives_a_bigger_screen_more_bits_within_bounds() {
        assert_eq!(bit_rate(1280, 800, 60), 6_144_000);
        assert_eq!(bit_rate(64, 64, 10), 1_000_000);
        assert_eq!(bit_rate(7680, 4320, 60), 20_000_000);
    }

    #[test]
    fn asks_libvpx_for_vp8_with_nothing_held_back() {
        let args = encoder_args(SOFTWARE, 1280, 800, 60).join(" ");
        assert!(args.contains(
            "-f rawvideo -pix_fmt bgr0 -video_size 1280x800 -framerate 60 -use_wallclock_as_timestamps 1 -i pipe:0"
        ));
        assert!(args.contains("-pix_fmt yuv420p -c:v libvpx -deadline realtime"));
        assert!(args.contains("-lag-in-frames 0"));
        assert!(args.contains("-g 600 -fps_mode passthrough"));
        assert!(args.ends_with("-f ivf -flush_packets 1 pipe:1"));
    }

    #[test]
    fn uploads_to_the_gpu_and_writes_h264_with_a_delimiter_before_each_frame() {
        let vaapi = ALL[1];
        let args = encoder_args(vaapi, 1280, 800, 60).join(" ");
        assert!(args.contains(
            "-init_hw_device vaapi=va:/dev/dri/renderD128 -filter_hw_device va -f rawvideo"
        ));
        assert!(args.contains("-vf format=nv12,hwupload -c:v h264_vaapi -bf 0 -async_depth 1"));
        assert!(args.ends_with("-bsf:v h264_metadata=aud=insert -f h264 -flush_packets 1 pipe:1"));
        let nvenc = encoder_args(ALL[0], 1280, 800, 60).join(" ");
        assert!(nvenc.contains("-tune ull -zerolatency 1"));
        assert!(!nvenc.contains("hwupload"));
    }

    #[test]
    fn cuts_h264_into_frames_at_each_delimiter_however_the_bytes_come() {
        let first = [
            0, 0, 0, 1, 9, 0xf0, 0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x65, 3,
        ];
        let second = [0, 0, 0, 1, 9, 0xf0, 0, 0, 1, 0x41, 4];
        let third = [0, 0, 0, 1, 9, 0xf0];
        let stream: Vec<u8> = [&first[..], &second[..], &third[..]].concat();
        for cut in 1..stream.len() {
            let mut units = AccessUnits::default();
            let mut frames = units.take(&stream[..cut]);
            frames.extend(units.take(&stream[cut..]));
            assert_eq!(
                frames,
                vec![first.to_vec(), second.to_vec()],
                "cut at {cut}"
            );
        }
    }

    #[test]
    fn hands_out_the_last_frame_once_the_stream_pauses() {
        let frame = [0, 0, 0, 1, 9, 0xf0, 0, 0, 1, 0x41, 4];
        let mut units = AccessUnits::default();
        assert_eq!(units.take(&frame), Vec::<Vec<u8>>::new());
        assert_eq!(units.flush(), Some(frame.to_vec()));
        assert_eq!(units.flush(), None);
    }

    #[test]
    fn an_encoder_that_cannot_run_here_is_not_kept() {
        let missing = one("no_such_encoder", Made::H264, Hardware::Nvenc);
        assert!(!works(missing));
        assert_eq!(working().last(), Some(&SOFTWARE));
    }
}
