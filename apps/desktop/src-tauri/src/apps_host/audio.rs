use std::io::{self, Read};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::Duration;

const ASKING: Duration = Duration::from_secs(5);

pub fn available() -> bool {
    super::installed::on_path("pactl") && super::installed::on_path("parec")
}

pub struct Sink {
    module: u32,
    name: String,
}

impl Sink {
    pub fn make(number: u32) -> Option<Sink> {
        if !available() {
            return None;
        }
        let name = format!("orden_application_{number}");
        let made = crate::printed::output(
            Command::new("pactl").args([
                "load-module",
                "module-null-sink",
                &format!("sink_name={name}"),
                &format!("sink_properties=device.description=Orden_application_{number}"),
            ]),
            ASKING,
        )
        .ok()?;
        if !made.status.success() {
            return None;
        }
        let module = String::from_utf8_lossy(&made.stdout).trim().parse().ok()?;
        Some(Sink { module, name })
    }

    pub fn monitor(&self) -> String {
        format!("{}.monitor", self.name)
    }
}

impl Drop for Sink {
    fn drop(&mut self) {
        let _ = crate::printed::output(
            Command::new("pactl").args(["unload-module", &self.module.to_string()]),
            ASKING,
        );
    }
}

pub fn environment(sink: Option<&Sink>) -> Vec<(&'static str, String)> {
    match sink {
        Some(sink) => vec![("PULSE_SINK", sink.name.clone())],
        None => vec![
            (
                "PULSE_SERVER",
                "unix:/nonexistent/orden-no-sound".to_owned(),
            ),
            ("PIPEWIRE_REMOTE", "orden-no-sound".to_owned()),
        ],
    }
}

pub struct Sound {
    reader: Child,
    encoder: Child,
    packets: ChildStdout,
    pages: Pages,
    read: u64,
}

impl Sound {
    pub fn start(monitor: &str) -> Option<Sound> {
        let mut reader = Command::new("parec")
            .args([
                &format!("--device={monitor}"),
                "--format=s16le",
                "--rate=48000",
                "--channels=2",
                "--latency-msec=10",
                "--raw",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let Some(samples) = reader.stdout.take() else {
            let _ = reader.kill();
            let _ = reader.wait();
            return None;
        };
        let encoder = Command::new("ffmpeg")
            .args(encoder_args())
            .stdin(Stdio::from(samples))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let Ok(mut encoder) = encoder else {
            let _ = reader.kill();
            let _ = reader.wait();
            return None;
        };
        let Some(packets) = encoder.stdout.take() else {
            for one in [&mut reader, &mut encoder] {
                let _ = one.kill();
                let _ = one.wait();
            }
            return None;
        };
        Some(Sound {
            reader,
            encoder,
            packets,
            pages: Pages::default(),
            read: 0,
        })
    }

    pub fn next(&mut self) -> Option<(Vec<u8>, u32)> {
        loop {
            let packet = self.pages.packet(&mut self.packets).ok()?;
            self.read += 1;
            if self.read <= 2 {
                continue;
            }
            let samples = opus_samples(&packet).unwrap_or(480);
            return Some((packet, samples));
        }
    }
}

impl Drop for Sound {
    fn drop(&mut self) {
        for one in [&mut self.reader, &mut self.encoder] {
            let _ = one.kill();
            let _ = one.wait();
        }
    }
}

pub fn encoder_args() -> Vec<String> {
    "-hide_banner -loglevel error -nostdin -f s16le -ar 48000 -ac 2 -i pipe:0 \
     -c:a libopus -application lowdelay -frame_duration 10 -b:a 128000 \
     -f ogg -page_duration 1 -flush_packets 1 pipe:1"
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

#[derive(Debug, Default)]
pub struct Pages {
    partial: Vec<u8>,
    ready: std::collections::VecDeque<Vec<u8>>,
}

const LARGEST_PAGE: usize = 27 + 255 + 255 * 255;

impl Pages {
    pub fn packet(&mut self, from: &mut impl Read) -> io::Result<Vec<u8>> {
        loop {
            if let Some(packet) = self.ready.pop_front() {
                return Ok(packet);
            }
            self.page(from)?;
        }
    }

    fn page(&mut self, from: &mut impl Read) -> io::Result<()> {
        let mut header = [0_u8; 27];
        from.read_exact(&mut header)?;
        if &header[..4] != b"OggS" {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "not Ogg"));
        }
        let mut table = vec![0_u8; usize::from(header[26])];
        from.read_exact(&mut table)?;
        for length in table {
            let mut segment = vec![0_u8; usize::from(length)];
            from.read_exact(&mut segment)?;
            self.partial.extend_from_slice(&segment);
            if length < 255 {
                self.ready.push_back(std::mem::take(&mut self.partial));
            }
            if self.partial.len() > LARGEST_PAGE * 4 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "packet too large",
                ));
            }
        }
        Ok(())
    }
}

pub fn opus_samples(packet: &[u8]) -> Option<u32> {
    let toc = *packet.first()?;
    let config = toc >> 3;
    let frame = match config {
        0..=11 => [480, 960, 1920, 2880][usize::from(config % 4)],
        12..=15 => [480, 960][usize::from(config % 2)],
        _ => [120, 240, 480, 960][usize::from(config % 4)],
    };
    let frames = match toc & 0b11 {
        0 => 1,
        1 | 2 => 2,
        _ => u32::from(*packet.get(1)? & 0b0011_1111),
    };
    Some(frame * frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(segments: &[u8], body: &[u8]) -> Vec<u8> {
        let mut out = b"OggS".to_vec();
        out.extend_from_slice(&[0_u8; 22]);
        out.push(u8::try_from(segments.len()).unwrap());
        out.extend_from_slice(segments);
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn reads_the_packets_off_oggs_pages_one_spanning_two() {
        let long: Vec<u8> = (0..300_u32)
            .map(|one| u8::try_from(one % 251).unwrap())
            .collect();
        let mut stream = page(&[3, 255], &[[1, 2, 3].as_slice(), &long[..255]].concat());
        stream.extend(page(&[45, 2], &[&long[255..], [9, 9].as_slice()].concat()));
        let mut pages = Pages::default();
        let mut from = stream.as_slice();
        assert_eq!(pages.packet(&mut from).unwrap(), [1, 2, 3]);
        assert_eq!(pages.packet(&mut from).unwrap(), long);
        assert_eq!(pages.packet(&mut from).unwrap(), [9, 9]);
        assert!(pages.packet(&mut from).is_err());
        assert!(Pages::default().packet(&mut &b"RIFF"[..]).is_err());
    }

    #[test]
    fn times_a_packet_by_the_samples_its_first_byte_says() {
        assert_eq!(opus_samples(&[30 << 3]), Some(480));
        assert_eq!(opus_samples(&[(31 << 3) | 1]), Some(1920));
        assert_eq!(opus_samples(&[(3 << 3) | 3, 3]), Some(8640));
        assert_eq!(opus_samples(&[]), None);
    }

    #[test]
    fn gives_an_application_its_sink_or_no_sound_at_all() {
        let sink = Sink {
            module: u32::MAX,
            name: "orden_application_7".to_owned(),
        };
        assert_eq!(
            environment(Some(&sink)),
            [("PULSE_SINK", "orden_application_7".to_owned())]
        );
        assert_eq!(sink.monitor(), "orden_application_7.monitor");
        std::mem::forget(sink);
        assert!(environment(None)
            .iter()
            .any(|(name, value)| *name == "PULSE_SERVER" && value.contains("nonexistent")));
        let args = encoder_args().join(" ");
        assert!(args.contains("-c:a libopus -application lowdelay -frame_duration 10"));
        assert!(args.ends_with("-f ogg -page_duration 1 -flush_packets 1 pipe:1"));
    }
}
