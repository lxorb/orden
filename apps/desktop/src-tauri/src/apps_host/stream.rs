//! The picture of an application this computer hosts, sent to the device holding it
//! (issue 1063, step 4; docs/apps.md).
//!
//! **Signalling** comes through the window: the relay passes the holder's `signal`
//! frames to it, and it hands their `data` here (`apps_signal`). The holder offers a
//! receive-only video and a data channel, `{"offer": sdp}`, and trickles its candidates,
//! `{"candidate": {"candidate": ...}}`; this answers with every candidate of its own
//! already in the answer, or says why it cannot, `{"cannot": ...}`.
//!
//! **The connection** is `str0m`'s, a `WebRTC` library with no threads or clock of its
//! own: one lock round it, fed by a thread for each socket and one for its timers, and
//! written to by the encoder's. One socket for each address this computer has, since
//! `str0m` has to be told which address a datagram came in on. It gathers nothing, so
//! the addresses are found here, and it has no TURN client, which a host does not need:
//! the viewer's engine does TURN, and a relayed candidate is answered from here.
//!
//! **The picture** is ffmpeg's: it reads the application's display (`x11grab`, over
//! `XShm`), encodes VP8 in libvpx's realtime mode with nothing held back, and writes
//! each frame to a pipe as IVF the moment it is made. VP8 because every engine a viewer
//! has decodes it: Orden's own CEF has no H.264. A program the host runs, as Xvfb is,
//! rather than a codec linked into every build. It starts once the viewer is
//! connected, so the first frame is a key frame, and another comes every two seconds.

use std::io::{self, Read};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use str0m::change::SdpOffer;
use str0m::crypto::CryptoProvider;
use str0m::format::Codec;
use str0m::media::{MediaKind, MediaTime, Mid, Pt};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};

use super::Screen;

/// How long a viewer has to connect once it has the answer.
const CONNECT_WITHIN: Duration = Duration::from_secs(30);
/// The longest the timers wait between two looks, so an end is seen soon.
const LONGEST_WAIT: Duration = Duration::from_millis(20);
/// How long a socket waits for a datagram before it looks whether the peer ended.
const LISTEN_FOR: Duration = Duration::from_millis(250);
/// The largest frame read off the encoder: a key frame of a 16K screen fits.
const LARGEST_FRAME: usize = 16 * 1024 * 1024;

/// What the holder says, as `data` of its `signal` frames.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum FromViewer {
    /// Its offer: a receive-only video and the data channel.
    Offer { offer: String },
    /// One of its candidates, as its engine's `RTCIceCandidate` says it.
    Candidate { candidate: ViewerCandidate },
    /// It is done with the picture.
    Bye {
        #[allow(
            dead_code,
            reason = "the field is the frame's name and says nothing more"
        )]
        bye: bool,
    },
}

/// A candidate as `RTCIceCandidate.toJSON()` gives it; only the line is read.
#[derive(Debug, Deserialize)]
pub struct ViewerCandidate {
    pub candidate: String,
}

/// Why there is no picture to offer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cannot {
    /// ffmpeg is not installed.
    Encoder,
    /// The offer is not one this can answer: no video, no VP8, or not SDP.
    Offer,
    /// This computer has no address to be reached on.
    Network,
}

impl Cannot {
    /// The word the viewer reads (`cannot` in `@orden/online/apps`).
    pub fn word(self) -> &'static str {
        match self {
            Cannot::Encoder => "encoder",
            Cannot::Offer => "offer",
            Cannot::Network => "network",
        }
    }
}

/// The answer the viewer is sent, as `data` of a `signal` frame.
pub fn answer_text(sdp: &str) -> String {
    serde_json::json!({ "answer": sdp }).to_string()
}

/// Why it cannot, as `data` of a `signal` frame.
pub fn cannot_text(why: &str) -> String {
    serde_json::json!({ "cannot": why }).to_string()
}

/// One crypto provider for every connection: `RustCrypto`'s (`rust-crypto`), so no build
/// links a system library for DTLS or SRTP.
fn provider() -> Arc<CryptoProvider> {
    static ONE: OnceLock<Arc<CryptoProvider>> = OnceLock::new();
    ONE.get_or_init(|| Arc::new(str0m::crypto::from_feature_flags()))
        .clone()
}

/// What the threads of one connection share.
struct Shared {
    rtc: Rtc,
    /// The sockets, to send each datagram from the address `str0m` chose.
    sockets: Vec<UdpSocket>,
    /// The video's media and its VP8 payload type, once the answer has made them.
    video: Option<(Mid, Pt)>,
    /// When the timers are next due.
    next: Instant,
    /// When the viewer connected, which is when the picture starts.
    connected: Option<Instant>,
    /// Whether the encoder is to be started: set once the viewer is connected and the
    /// video's media is known, which `str0m` says only after the connection is made.
    start_encoder: bool,
    /// Whether it was.
    encoding: bool,
}

/// One connection and what its threads read.
struct Inner {
    shared: Mutex<Shared>,
    ended: AtomicBool,
    screen: Screen,
    began: Instant,
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, Shared> {
        self.shared
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn over(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }

    fn end(&self) {
        self.ended.store(true, Ordering::SeqCst);
        self.lock().rtc.disconnect();
    }
}

/// The picture of one application, sent to the device holding it. Dropped, it ends:
/// its sockets close and the encoder is stopped.
pub struct Peer {
    inner: Arc<Inner>,
}

impl Peer {
    /// Answers the holder's offer for the application on `screen`, and starts listening
    /// for it: the peer, and the answer's SDP.
    pub fn answer(screen: Screen, offer: &str) -> Result<(Peer, String), Cannot> {
        if !super::installed::on_path("ffmpeg") {
            return Err(Cannot::Encoder);
        }
        let offer = SdpOffer::from_sdp_string(offer).map_err(|_| Cannot::Offer)?;
        let now = Instant::now();
        let mut rtc = RtcConfig::new()
            .clear_codecs()
            .enable_vp8(true)
            .set_crypto_provider(provider())
            .build(now);

        let mut sockets = Vec::new();
        for ip in addresses() {
            let Ok(socket) = UdpSocket::bind(SocketAddr::new(ip, 0)) else {
                continue;
            };
            let Ok(local) = socket.local_addr() else {
                continue;
            };
            let Ok(candidate) = Candidate::host(local, "udp") else {
                continue;
            };
            let _ = rtc.add_local_candidate(candidate);
            sockets.push(socket);
        }
        if sockets.is_empty() {
            return Err(Cannot::Network);
        }
        let answer = rtc
            .sdp_api()
            .accept_offer(offer)
            .map_err(|_| Cannot::Offer)?
            .to_sdp_string();
        if !answers_video(&answer) {
            return Err(Cannot::Offer);
        }

        let listening: Vec<UdpSocket> = sockets
            .iter()
            .filter_map(|socket| socket.try_clone().ok())
            .collect();
        let inner = Arc::new(Inner {
            shared: Mutex::new(Shared {
                rtc,
                sockets,
                video: None,
                next: now,
                connected: None,
                start_encoder: false,
                encoding: false,
            }),
            ended: AtomicBool::new(false),
            screen,
            began: now,
        });
        for socket in listening {
            let inner = inner.clone();
            std::thread::spawn(move || listen(&inner, &socket));
        }
        let timers = inner.clone();
        std::thread::spawn(move || keep_time(&timers));
        Ok((Peer { inner }, answer))
    }

    /// One of the viewer's candidates. A line that does not read - an address hidden
    /// behind an `mDNS` name, as Chromium hides its own - is let go: the viewer's checks
    /// reach this end anyway, and its address is learnt from them.
    pub fn candidate(&self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let Ok(candidate) = Candidate::from_sdp_string(line) else {
            return;
        };
        let mut shared = self.inner.lock();
        shared.rtc.add_remote_candidate(candidate);
        drive(&mut shared);
    }

    /// Whether it has ended: the viewer went, or never came.
    #[cfg(test)]
    pub fn ended(&self) -> bool {
        self.inner.over()
    }
}

impl Drop for Peer {
    fn drop(&mut self) {
        self.inner.end();
    }
}

/// Every address this computer could be reached on, found by asking the system which
/// of its addresses it would send from towards the internet, the private ranges and
/// Tailscale's, without a datagram sent; and the loopback, for a viewer on this same
/// computer.
fn addresses() -> Vec<IpAddr> {
    const TOWARDS: [&str; 6] = [
        "8.8.8.8:9",
        "10.255.255.254:9",
        "172.31.255.254:9",
        "192.168.255.254:9",
        "100.127.255.254:9",
        "[2001:4860:4860::8888]:9",
    ];
    let mut found: Vec<IpAddr> = Vec::new();
    for towards in TOWARDS {
        let Ok(towards) = towards.parse::<SocketAddr>() else {
            continue;
        };
        let from: SocketAddr = if towards.is_ipv4() {
            (Ipv4Addr::UNSPECIFIED, 0).into()
        } else {
            (std::net::Ipv6Addr::UNSPECIFIED, 0).into()
        };
        let Ok(socket) = UdpSocket::bind(from) else {
            continue;
        };
        if socket.connect(towards).is_err() {
            continue;
        }
        let Ok(local) = socket.local_addr() else {
            continue;
        };
        let ip = local.ip();
        if usable_address(ip) && !found.contains(&ip) {
            found.push(ip);
        }
    }
    found.push(IpAddr::V4(Ipv4Addr::LOCALHOST));
    found
}

/// An address a host candidate may name: not unspecified, not the loopback (added on its
/// own), and not an IPv6 link-local one, which needs a scope a candidate cannot carry.
fn usable_address(ip: IpAddr) -> bool {
    if ip.is_unspecified() || ip.is_loopback() {
        return false;
    }
    match ip {
        IpAddr::V4(_) => true,
        IpAddr::V6(v6) => (v6.segments()[0] & 0xffc0) != 0xfe80,
    }
}

/// Drains what `str0m` has to say: datagrams sent, events heard, and when it is next
/// due. Answers whether the connection goes on.
fn drive(shared: &mut Shared) -> bool {
    loop {
        match shared.rtc.poll_output() {
            Ok(Output::Timeout(at)) => {
                shared.next = at;
                return shared.rtc.is_alive();
            }
            Ok(Output::Transmit(datagram)) => {
                let socket = shared
                    .sockets
                    .iter()
                    .find(|one| one.local_addr().ok() == Some(datagram.source))
                    .or_else(|| shared.sockets.first());
                if let Some(socket) = socket {
                    let _ = socket.send_to(&datagram.contents, datagram.destination);
                }
            }
            Ok(Output::Event(event)) => {
                if !heard(shared, event) {
                    shared.rtc.disconnect();
                    return false;
                }
            }
            Err(_) => {
                shared.rtc.disconnect();
                return false;
            }
        }
    }
}

/// One event of the connection; answers whether it goes on.
fn heard(shared: &mut Shared, event: Event) -> bool {
    match event {
        Event::MediaAdded(added) if added.kind == MediaKind::Video => {
            let pt = shared.rtc.writer(added.mid).and_then(|writer| {
                writer
                    .payload_params()
                    .find(|params| params.spec().codec == Codec::Vp8)
                    .map(str0m::format::PayloadParams::pt)
            });
            if let Some(pt) = pt {
                shared.video = Some((added.mid, pt));
            }
            due(shared);
            true
        }
        Event::Connected => {
            if shared.connected.is_none() {
                shared.connected = Some(Instant::now());
            }
            due(shared);
            true
        }
        Event::IceConnectionStateChange(IceConnectionState::Disconnected) => false,
        _ => true,
    }
}

/// The encoder is due once the viewer is connected and the video known, and only once.
fn due(shared: &mut Shared) {
    if shared.connected.is_some() && shared.video.is_some() && !shared.encoding {
        shared.encoding = true;
        shared.start_encoder = true;
    }
}

/// The codecs, as an `rtpmap` names them, that this can encode.
const ENCODED: [&str; 3] = ["VP8/", "VP9/", "H264/"];

/// Whether an answer sends a video, in a codec this can encode: a `m=video` section that
/// is not refused (port 0) and maps a payload type to VP8, VP9 or H.264.
fn answers_video(sdp: &str) -> bool {
    let mut in_video = false;
    for line in sdp.lines() {
        if let Some(media) = line.strip_prefix("m=") {
            if in_video {
                return false;
            }
            in_video = media.starts_with("video ") && !media.starts_with("video 0 ");
        } else if in_video && line.starts_with("a=rtpmap:") {
            let codec = line.split_whitespace().nth(1).unwrap_or_default();
            if ENCODED.iter().any(|one| codec.starts_with(one)) {
                return true;
            }
        }
    }
    false
}

/// After a turn of the connection: the encoder started once it is due.
fn after(inner: &Arc<Inner>, shared: &mut Shared) {
    if std::mem::take(&mut shared.start_encoder) {
        let encoding = inner.clone();
        std::thread::spawn(move || encode(&encoding));
    }
}

/// One socket's datagrams, handed to the connection until it ends.
fn listen(inner: &Arc<Inner>, socket: &UdpSocket) {
    let Ok(local) = socket.local_addr() else {
        return;
    };
    let _ = socket.set_read_timeout(Some(LISTEN_FOR));
    let mut buffer = vec![0_u8; 2000];
    while !inner.over() {
        let Ok((length, from)) = socket.recv_from(&mut buffer) else {
            continue;
        };
        let Ok(datagram) = Receive::new(Protocol::Udp, from, local, &buffer[..length]) else {
            continue;
        };
        let mut shared = inner.lock();
        let input = Input::Receive(Instant::now(), datagram);
        // A datagram it cannot take, which anybody may send, is no reason to end.
        let _ = shared.rtc.handle_input(input);
        let goes_on = drive(&mut shared);
        after(inner, &mut shared);
        drop(shared);
        if !goes_on {
            inner.end();
        }
    }
}

/// The connection's timers, and its end: the viewer gone, or never connected.
fn keep_time(inner: &Arc<Inner>) {
    while !inner.over() {
        let now = Instant::now();
        let mut shared = inner.lock();
        let mut goes_on = shared.rtc.is_alive();
        if goes_on && now >= shared.next {
            goes_on = shared.rtc.handle_input(Input::Timeout(now)).is_ok() && drive(&mut shared);
            after(inner, &mut shared);
        }
        if shared.connected.is_none() && now.duration_since(inner.began) > CONNECT_WITHIN {
            goes_on = false;
        }
        let wait = shared.next.saturating_duration_since(now);
        drop(shared);
        if !goes_on {
            inner.end();
            return;
        }
        std::thread::sleep(wait.clamp(Duration::from_millis(1), LONGEST_WAIT));
    }
}

/// The frame rate the display is read at: the holder's refresh rate, at most 60.
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

/// The bits a second VP8 is given: about a tenth of a bit a pixel a frame, which keeps
/// text sharp, between 1 and 20 megabits.
pub fn bit_rate(width: u32, height: u32, fps: u32) -> u64 {
    let pixels = u64::from(width) * u64::from(height) * u64::from(fps);
    (pixels / 10).clamp(1_000_000, 20_000_000)
}

/// What ffmpeg is told: read the display at the frame rate, encode VP8 in realtime with
/// no frame held back, a key frame every two seconds, and write each frame as IVF the
/// moment it is made.
pub fn encoder_args(screen: &Screen) -> Vec<String> {
    let fps = frame_rate(screen.hz);
    let rate = bit_rate(screen.width, screen.height, fps);
    let threads = std::thread::available_parallelism()
        .map_or(2, std::num::NonZeroUsize::get)
        .clamp(1, 8);
    [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "x11grab",
        "-framerate",
        &fps.to_string(),
        "-draw_mouse",
        "1",
        "-i",
        &screen.display,
        "-c:v",
        "libvpx",
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
        "-b:v",
        &rate.to_string(),
        "-maxrate",
        &(rate * 3 / 2).to_string(),
        "-bufsize",
        &(rate / 2).to_string(),
        "-g",
        &(fps * 2).to_string(),
        "-threads",
        &threads.to_string(),
        "-pix_fmt",
        "yuv420p",
        "-f",
        "ivf",
        "-flush_packets",
        "1",
        "pipe:1",
    ]
    .iter()
    .map(|&one| one.to_owned())
    .collect()
}

/// The encoder for one connection: frames read off ffmpeg and written to the video
/// until the connection ends or ffmpeg does.
fn encode(inner: &Arc<Inner>) {
    let Ok(mut child) = Command::new("ffmpeg")
        .args(encoder_args(&inner.screen))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        inner.end();
        return;
    };
    if let Some(mut frames) = child.stdout.take() {
        if ivf_header(&mut frames).is_ok() {
            while !inner.over() {
                let Ok(frame) = ivf_frame(&mut frames) else {
                    break;
                };
                send_frame(inner, frame);
            }
        }
    }
    stop(&mut child);
    inner.end();
}

/// One frame written to the video, at the time it came, on the 90 kHz clock.
fn send_frame(inner: &Arc<Inner>, frame: Vec<u8>) {
    let mut shared = inner.lock();
    let (Some((mid, pt)), Some(_)) = (shared.video, shared.connected) else {
        return;
    };
    let now = Instant::now();
    let ticks = now.duration_since(inner.began).as_micros() * 9 / 100;
    let time = MediaTime::from_90khz(u64::try_from(ticks).unwrap_or(u64::MAX));
    let written = shared
        .rtc
        .writer(mid)
        .is_some_and(|writer| writer.write(pt, now, time, frame).is_ok());
    if written {
        drive(&mut shared);
    }
}

/// Ends ffmpeg, which may be in the middle of a frame.
fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// IVF's file header: 32 bytes, `DKIF`, and its own length.
fn ivf_header(from: &mut impl Read) -> io::Result<()> {
    let mut header = [0_u8; 32];
    from.read_exact(&mut header)?;
    if &header[..4] != b"DKIF" {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "not IVF"));
    }
    let length = usize::from(u16::from_le_bytes([header[6], header[7]]));
    if length > 32 {
        io::copy(
            &mut from.take(u64::try_from(length - 32).unwrap_or(0)),
            &mut io::sink(),
        )?;
    }
    Ok(())
}

/// One IVF frame: its length, its time (not read), and its bytes.
fn ivf_frame(from: &mut impl Read) -> io::Result<Vec<u8>> {
    let mut header = [0_u8; 12];
    from.read_exact(&mut header)?;
    let length = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let length = usize::try_from(length).unwrap_or(usize::MAX);
    if length > LARGEST_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame too large",
        ));
    }
    let mut frame = vec![0_u8; length];
    from.read_exact(&mut frame)?;
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ivf(frames: &[&[u8]]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"DKIF");
        out.extend_from_slice(&0_u16.to_le_bytes());
        out.extend_from_slice(&32_u16.to_le_bytes());
        out.extend_from_slice(b"VP80");
        out.extend_from_slice(&[0_u8; 20]);
        for (at, frame) in frames.iter().enumerate() {
            out.extend_from_slice(&u32::try_from(frame.len()).unwrap().to_le_bytes());
            out.extend_from_slice(&u64::try_from(at).unwrap().to_le_bytes());
            out.extend_from_slice(frame);
        }
        out
    }

    #[test]
    fn reads_the_encoders_frames_one_by_one() {
        let bytes = ivf(&[b"one", b"", b"three"]);
        let mut from = bytes.as_slice();
        ivf_header(&mut from).unwrap();
        assert_eq!(ivf_frame(&mut from).unwrap(), b"one");
        assert_eq!(ivf_frame(&mut from).unwrap(), b"");
        assert_eq!(ivf_frame(&mut from).unwrap(), b"three");
        assert!(ivf_frame(&mut from).is_err());
    }

    #[test]
    fn refuses_what_is_not_ivf_and_a_frame_too_large() {
        let mut other = &b"RIFF0000000000000000000000000000"[..];
        assert!(ivf_header(&mut other).is_err());
        let mut huge = Vec::new();
        huge.extend_from_slice(&u32::MAX.to_le_bytes());
        huge.extend_from_slice(&[0_u8; 8]);
        assert!(ivf_frame(&mut huge.as_slice()).is_err());
    }

    #[test]
    fn reads_what_the_viewer_says() {
        let offer: FromViewer = serde_json::from_str(r#"{"offer":"v=0"}"#).unwrap();
        assert!(matches!(offer, FromViewer::Offer { offer } if offer == "v=0"));
        let candidate: FromViewer = serde_json::from_str(
            r#"{"candidate":{"candidate":"candidate:1 1 udp 1 1.2.3.4 5 typ host","sdpMid":"0","sdpMLineIndex":0}}"#,
        )
        .unwrap();
        assert!(
            matches!(candidate, FromViewer::Candidate { candidate } if candidate.candidate.starts_with("candidate:1"))
        );
        assert!(matches!(
            serde_json::from_str::<FromViewer>(r#"{"bye":true}"#).unwrap(),
            FromViewer::Bye { .. }
        ));
        assert!(serde_json::from_str::<FromViewer>(r#"{"run":"rm -rf ~"}"#).is_err());
    }

    #[test]
    fn says_its_answer_and_why_it_cannot() {
        assert_eq!(answer_text("v=0\r\n"), r#"{"answer":"v=0\r\n"}"#);
        assert_eq!(
            cannot_text(Cannot::Encoder.word()),
            r#"{"cannot":"encoder"}"#
        );
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
    fn asks_ffmpeg_for_vp8_with_nothing_held_back() {
        let screen = Screen {
            display: ":123".to_owned(),
            width: 1280,
            height: 800,
            hz: 120.0,
        };
        let args = encoder_args(&screen).join(" ");
        assert!(args.contains("-f x11grab -framerate 60 -draw_mouse 1 -i :123"));
        assert!(args.contains("-c:v libvpx -deadline realtime"));
        assert!(args.contains("-lag-in-frames 0"));
        assert!(args.contains("-g 120"));
        assert!(args.ends_with("-f ivf -flush_packets 1 pipe:1"));
    }

    #[test]
    fn names_no_address_a_candidate_cannot_carry() {
        assert!(usable_address("192.168.1.2".parse().unwrap()));
        assert!(usable_address("2001:db8::1".parse().unwrap()));
        assert!(!usable_address("fe80::1".parse().unwrap()));
        assert!(!usable_address("0.0.0.0".parse().unwrap()));
        assert!(!usable_address("127.0.0.1".parse().unwrap()));
        assert_eq!(addresses().last(), Some(&IpAddr::V4(Ipv4Addr::LOCALHOST)));
    }

    #[test]
    fn answers_no_offer_it_cannot_read() {
        if !super::super::installed::on_path("ffmpeg") {
            return;
        }
        let screen = Screen {
            display: ":1".to_owned(),
            width: 64,
            height: 64,
            hz: 60.0,
        };
        assert_eq!(Peer::answer(screen, "not sdp").err(), Some(Cannot::Offer));
    }

    /// What the answer to a viewer's offer says: a video it sends in a codec it encodes,
    /// or no video, which `Peer::answer` refuses.
    #[test]
    fn reads_whether_the_answer_sends_a_video() {
        use str0m::media::Direction;

        let answer_to = |video: bool| {
            let mut viewer = RtcConfig::new()
                .set_crypto_provider(provider())
                .build(Instant::now());
            let mut change = viewer.sdp_api();
            if video {
                change.add_media(MediaKind::Video, Direction::RecvOnly, None, None, None);
            }
            change.add_channel("input".to_owned());
            let (offer, _) = change.apply().unwrap();
            let mut host = RtcConfig::new()
                .clear_codecs()
                .enable_vp8(true)
                .set_crypto_provider(provider())
                .build(Instant::now());
            host.sdp_api().accept_offer(offer).unwrap().to_sdp_string()
        };
        assert!(answers_video(&answer_to(true)));
        assert!(!answers_video(&answer_to(false)));
        assert!(!answers_video(
            "m=video 0 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n"
        ));
        assert!(!answers_video(
            "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 AV1/90000\r\n"
        ));
    }

    /// A viewer of `str0m`'s own, on the loopback, against a real Xvfb and ffmpeg: it
    /// connects with the answer and gets the display's picture as VP8, key frame first.
    /// CI installs both; elsewhere the test says nothing without them.
    #[test]
    fn a_viewer_gets_the_picture_of_the_display() {
        use str0m::change::SdpAnswer;
        use str0m::media::Direction;

        let ready =
            super::super::display::available() && super::super::installed::on_path("ffmpeg");
        if !ready {
            assert!(
                std::env::var_os("CI").is_none() || !cfg!(target_os = "linux"),
                "CI installs xvfb and ffmpeg for this test"
            );
            return;
        }
        let display = super::super::display::Display::start(320, 240, 1.0).unwrap();
        let screen = Screen {
            display: display.name(),
            width: 320,
            height: 240,
            hz: 30.0,
        };

        let mut viewer = RtcConfig::new()
            .set_crypto_provider(provider())
            .build(Instant::now());
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let local = socket.local_addr().unwrap();
        let mine = Candidate::host(local, "udp").unwrap();
        let _ = viewer.add_local_candidate(mine.clone());
        let mut change = viewer.sdp_api();
        change.add_media(MediaKind::Video, Direction::RecvOnly, None, None, None);
        change.add_channel("input".to_owned());
        let (offer, pending) = change.apply().unwrap();

        let (peer, answer) = Peer::answer(screen, &offer.to_sdp_string()).unwrap();
        assert!(answer.contains("VP8"));
        viewer
            .sdp_api()
            .accept_answer(pending, SdpAnswer::from_sdp_string(&answer).unwrap())
            .unwrap();
        peer.candidate(&mine.to_sdp_string());

        socket
            .set_read_timeout(Some(Duration::from_millis(10)))
            .unwrap();
        let until = Instant::now() + Duration::from_secs(30);
        let mut buffer = vec![0_u8; 2000];
        let mut frames = 0;
        let mut first_key = None;
        while Instant::now() < until && frames < 10 {
            loop {
                match viewer.poll_output().unwrap() {
                    Output::Timeout(_) => break,
                    Output::Transmit(datagram) => {
                        // The host's other addresses are not reachable from the loopback.
                        let _ = socket.send_to(&datagram.contents, datagram.destination);
                    }
                    Output::Event(Event::MediaData(data)) => {
                        // VP8's frame tag: a clear lowest bit is a key frame.
                        let key = data.data.first().is_some_and(|tag| (tag & 1) == 0);
                        first_key.get_or_insert(key);
                        frames += 1;
                    }
                    Output::Event(_) => {}
                }
            }
            let input = match socket.recv_from(&mut buffer) {
                Ok((length, from)) => Input::Receive(
                    Instant::now(),
                    Receive::new(Protocol::Udp, from, local, &buffer[..length]).unwrap(),
                ),
                Err(_) => Input::Timeout(Instant::now()),
            };
            viewer.handle_input(input).unwrap();
        }
        assert!(frames >= 10, "{frames} frames came");
        assert_eq!(first_key, Some(true), "the first frame is a key frame");
        assert!(!peer.ended());
        drop(peer);
    }
}
