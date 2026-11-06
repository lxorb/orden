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
//! the addresses are found here, each also as the internet sees it (`stun.rs`), and it
//! has no TURN client, which a host does not need: the viewer's engine does TURN, and a
//! relayed candidate is answered from here.
//!
//! **The picture** is read off the application's display when something is drawn on
//! it, at most once a refresh of the holder's screen (`capture.rs`), and encoded by
//! ffmpeg with nothing held back - on this computer's GPU where it can and the viewer
//! decodes what that makes, else VP8 in libvpx's realtime mode, which every viewer
//! decodes (`encoder.rs`) - each frame written to a pipe the moment it is made. A
//! program the host runs, as Xvfb is, rather than a codec linked into every build. It
//! starts once the viewer is connected, so the first frame is a key frame. A still
//! screen sends nothing.
//!
//! **A whole picture when one was lost** (step 5): a viewer whose picture broke - a
//! packet lost that a resend did not bring back - asks for a key frame (PLI or FIR),
//! and gets one at once from an encoder started afresh, which begins with one; so does
//! a screen made another size. Asked again while that one is on its way, it waits.
//!
//! **Input** comes back over the data channel and is played into the application's
//! display, and only there (`input.rs`); the pointer's shape goes the other way on it.
//! So does the clipboard, both ways, while the holder shares it (step 6;
//! `clipboard.rs`).
//!
//! **Sound** (step 6): a viewer that offers to take audio too is sent the application's
//! sink as Opus, once connected (`audio.rs`).

use std::collections::VecDeque;
use std::io::{self, Read, Write as _};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use str0m::change::SdpOffer;
use str0m::channel::ChannelId;
use str0m::crypto::CryptoProvider;
use str0m::format::Codec;
use str0m::media::{Frequency, MediaKind, MediaTime, Mid, Pt};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};

use super::audio;
use super::capture::{Capture, News};
use super::clipboard::Clipboard;
use super::encoder::{self, AccessUnits, Encoder, Made};
use super::input::{Input as HolderInput, InputEvent};
use super::{stun, Screen};

/// How long a viewer has to connect once it has the answer.
const CONNECT_WITHIN: Duration = Duration::from_secs(30);
/// The longest the timers wait between two looks, so an end is seen soon.
const LONGEST_WAIT: Duration = Duration::from_millis(20);
/// How long a socket waits for a datagram before it looks whether the peer ended.
const LISTEN_FOR: Duration = Duration::from_millis(250);
/// The largest frame read off the encoder: a key frame of a 16K screen fits.
const LARGEST_FRAME: usize = 16 * 1024 * 1024;
/// How long the H.264 stream pauses before the frame read so far counts as whole.
const FRAME_PAUSE: Duration = Duration::from_millis(2);
/// The least time between two whole pictures the viewer asks for: it asks again while the
/// first is on its way.
const WHOLE_AT_MOST: Duration = Duration::from_millis(500);

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
    /// The offer is not one this can answer: no video, no codec this can encode, or not
    /// SDP.
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
    /// The video's media, its payload type and the encoder that makes it, once the
    /// answer has made them.
    video: Option<(Mid, Pt, Encoder)>,
    /// When the timers are next due.
    next: Instant,
    /// When the viewer connected, which is when the picture starts.
    connected: Option<Instant>,
    /// Where the picture's encoder is: due once the viewer is connected and the video's
    /// media is known, which `str0m` says only after the connection is made.
    pictures: Stage,
    /// The display, for the input played into it.
    display: String,
    /// The holder's input, played into the display: opened as the first arrives.
    input: Option<HolderInput>,
    /// The data channel, once the viewer has opened it.
    channel: Option<ChannelId>,
    /// The pointer's shape as last said, for a channel that opens after.
    pointer: Option<String>,
    /// Whoever reads the picture, told when the viewer asks for a whole one.
    news: Option<Sender<News>>,
    /// The application's process group.
    group: Option<u32>,
    /// When the connection began on this computer's clock, in milliseconds since 1970:
    /// what a frame's time counts from, as the tab reads it (step 9).
    began_wall: f64,
    /// The display's clipboard, and whether the holder shares its own with it.
    clipboard: Option<Arc<Clipboard>>,
    sharing: bool,
    /// The audio's media and its payload type, once the answer has made them, the
    /// application's sink's monitor, and where its sound is.
    audio: Option<(Mid, Pt)>,
    sound: Option<String>,
    sounds: Stage,
}

/// Where the picture, or the sound, of a connection is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Waiting,
    /// To be started after this turn of the connection.
    Due,
    Started,
}

/// What a peer sends: the application's display (and the holder's refresh rate), its
/// clipboard, and its sink's monitor, where it has them.
pub struct Source {
    pub screen: Arc<Mutex<Screen>>,
    pub clipboard: Option<Arc<Clipboard>>,
    pub sound: Option<String>,
    /// The application's process group, whose use of this computer each pong says
    /// (step 10).
    pub group: Option<u32>,
}

/// One connection and what its threads read.
struct Inner {
    shared: Mutex<Shared>,
    ended: AtomicBool,
    /// The application's display, and the holder's refresh rate as it is now.
    screen: Arc<Mutex<Screen>>,
    began: Instant,
    /// Counted up by every encoder started, so the frames of one ended are let go.
    generation: AtomicU64,
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

    fn screen(&self) -> Screen {
        self.screen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
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
    pub fn answer(source: Source, offer: &str) -> Result<(Peer, String), Cannot> {
        let Source {
            screen,
            clipboard,
            sound,
            group,
        } = source;
        if encoder::ffmpeg().is_none() {
            return Err(Cannot::Encoder);
        }
        let offer = SdpOffer::from_sdp_string(offer).map_err(|_| Cannot::Offer)?;
        let now = Instant::now();
        // The codecs this computer's encoders make; which of them is sent is chosen once
        // the offer says what the viewer decodes.
        let working = encoder::working();
        let makes = |made: Made| working.iter().any(|one| one.made == made);
        let mut rtc = RtcConfig::new()
            .clear_codecs()
            .enable_vp8(true)
            .enable_vp9(makes(Made::Vp9))
            .enable_h264(makes(Made::H264))
            .enable_opus(true, false)
            .set_crypto_provider(provider())
            .build(now);

        let sockets = gather(&mut rtc)?;
        let answer = rtc
            .sdp_api()
            .accept_offer(offer)
            .map_err(|_| Cannot::Offer)?
            .to_sdp_string();
        if !answers_video(&answer) {
            return Err(Cannot::Offer);
        }

        let display = screen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .display
            .clone();
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
                pictures: Stage::Waiting,
                display,
                input: None,
                channel: None,
                pointer: None,
                news: None,
                group,
                began_wall: wall_now(),
                clipboard: clipboard.clone(),
                sharing: false,
                audio: None,
                sound,
                sounds: Stage::Waiting,
            }),
            ended: AtomicBool::new(false),
            screen,
            began: now,
            generation: AtomicU64::new(0),
        });
        for socket in listening {
            let inner = inner.clone();
            std::thread::spawn(move || listen(&inner, &socket));
        }
        let timers = inner.clone();
        std::thread::spawn(move || keep_time(&timers));
        if let Some(clipboard) = &clipboard {
            let copying = Arc::downgrade(&inner);
            clipboard.listen(Some(Arc::new(move |text| {
                if let Some(inner) = copying.upgrade() {
                    copied(&inner, &text);
                }
            })));
        }
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
        if let Some(clipboard) = &self.inner.lock().clipboard {
            clipboard.listen(None);
        }
    }
}

/// This computer's clock, in milliseconds since 1970.
fn wall_now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |since| since.as_secs_f64() * 1000.0)
}

/// The answer to the tab's ping (step 9): its own time back, when the connection began
/// and what time it is here, on this computer's clock, which together set the two
/// clocks side by side and a frame's time on the tab's; and the encoder the picture is
/// made with; and what the application uses of this computer, where it can be read
/// (step 10).
fn pong_text(
    at: f64,
    began: f64,
    now: f64,
    video: Option<(Mid, Pt, Encoder)>,
    usage: Option<crate::usage::Usage>,
) -> String {
    let encoder = video.map(|(_, _, one)| one);
    serde_json::json!({
        "t": "pong",
        "at": at,
        "began": began,
        "now": now,
        "encoder": encoder.map(|one| one.name),
        "hardware": encoder.is_some_and(|one| one.hardware != encoder::Hardware::None),
        "usage": usage,
    })
    .to_string()
}

/// What the application copied, sent to the holder's tab while it shares its clipboard.
fn copied(inner: &Inner, text: &str) {
    let mut shared = inner.lock();
    if !shared.sharing {
        return;
    }
    let said = serde_json::json!({ "t": "clipboard", "text": text }).to_string();
    write_channel(&mut shared, &said);
    drive(&mut shared);
}

/// One socket for each address this computer has, each a host candidate of the
/// connection's, and each also as the internet sees it, asked for all at once, for a
/// viewer outside this network.
fn gather(rtc: &mut Rtc) -> Result<Vec<UdpSocket>, Cannot> {
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
    // And each address as the internet sees it, asked for all at once, for a viewer
    // outside this network.
    let seen: Vec<(SocketAddr, SocketAddr)> = std::thread::scope(|scope| {
        let asking: Vec<_> = sockets
            .iter()
            .filter_map(|socket| socket.local_addr().ok().map(|local| (socket, local)))
            .filter(|(_, local)| !local.ip().is_loopback())
            .map(|(socket, local)| {
                scope.spawn(move || Some((stun::reflexive(socket, stun::SERVER)?, local)))
            })
            .collect();
        asking
            .into_iter()
            .filter_map(|one| one.join().ok().flatten())
            .collect()
    });
    for (outside, local) in seen {
        if let Ok(candidate) = Candidate::server_reflexive(outside, local, "udp") {
            let _ = rtc.add_local_candidate(candidate);
        }
    }
    Ok(sockets)
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
        Event::MediaAdded(added) if added.kind == MediaKind::Audio => {
            let opus = shared.rtc.writer(added.mid).and_then(|writer| {
                writer
                    .payload_params()
                    .find(|params| params.spec().codec == Codec::Opus)
                    .map(str0m::format::PayloadParams::pt)
            });
            if let Some(pt) = opus {
                shared.audio = Some((added.mid, pt));
            }
            due(shared);
            true
        }
        Event::MediaAdded(added) if added.kind == MediaKind::Video => {
            let offered: Vec<(Made, Pt)> = shared
                .rtc
                .writer(added.mid)
                .map(|writer| {
                    writer
                        .payload_params()
                        .filter_map(|params| Some((made_of(params.spec().codec)?, params.pt())))
                        .collect()
                })
                .unwrap_or_default();
            let decodes: Vec<Made> = offered.iter().map(|&(made, _)| made).collect();
            let chosen = encoder::chosen(encoder::working(), &decodes);
            let pt = chosen.and_then(|one| {
                offered
                    .iter()
                    .find(|&&(made, _)| made == one.made)
                    .map(|&(_, pt)| pt)
            });
            if let (Some(chosen), Some(pt)) = (chosen, pt) {
                shared.video = Some((added.mid, pt, chosen));
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
        Event::KeyframeRequest(_) => {
            if let Some(news) = &shared.news {
                let _ = news.send(News::Whole);
            }
            true
        }
        Event::ChannelOpen(id, label) => {
            if label == "input" {
                shared.channel = Some(id);
                if let Some(pointer) = shared.pointer.clone() {
                    write_channel(shared, &pointer);
                }
            }
            true
        }
        Event::ChannelData(data) => {
            // A message that does not read is let go.
            let Ok(event) = serde_json::from_slice::<InputEvent>(&data.data) else {
                return true;
            };
            match event {
                InputEvent::Share { clipboard } => shared.sharing = clipboard,
                InputEvent::Ping { at } => {
                    let usage = shared.group.and_then(|group| {
                        crate::usage::sample(
                            &format!("app:{group}"),
                            crate::usage::Whose::Group(group),
                        )
                    });
                    let pong = pong_text(at, shared.began_wall, wall_now(), shared.video, usage);
                    write_channel(shared, &pong);
                }
                InputEvent::Clipboard { text } => {
                    if let (true, Some(clipboard)) = (shared.sharing, shared.clipboard.as_ref()) {
                        clipboard.give(&text);
                    }
                }
                played => {
                    if shared.input.is_none() {
                        shared.input = HolderInput::open(&shared.display).ok();
                    }
                    if let Some(input) = shared.input.as_mut() {
                        input.play(played);
                    }
                }
            }
            true
        }
        _ => true,
    }
}

/// The encoder is due once the viewer is connected and the video known, and only once;
/// the sound once the viewer is connected and the audio known, where there is a sink.
fn due(shared: &mut Shared) {
    let connected = shared.connected.is_some();
    if connected && shared.video.is_some() && shared.pictures == Stage::Waiting {
        shared.pictures = Stage::Due;
    }
    let sounds = shared.audio.is_some() && shared.sound.is_some();
    if connected && sounds && shared.sounds == Stage::Waiting {
        shared.sounds = Stage::Due;
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

/// The codec an encoder here makes, for a codec the viewer negotiated.
fn made_of(codec: Codec) -> Option<Made> {
    match codec {
        Codec::Vp8 => Some(Made::Vp8),
        Codec::Vp9 => Some(Made::Vp9),
        Codec::H264 => Some(Made::H264),
        _ => None,
    }
}

/// After a turn of the connection: the encoder started once it is due.
fn after(inner: &Arc<Inner>, shared: &mut Shared) {
    if shared.pictures == Stage::Due {
        shared.pictures = Stage::Started;
        let encoding = inner.clone();
        std::thread::spawn(move || pictures(&encoding));
    }
    if shared.sounds == Stage::Due {
        shared.sounds = Stage::Started;
        if let Some(monitor) = shared.sound.clone() {
            let sounding = inner.clone();
            std::thread::spawn(move || sound(&sounding, &monitor));
        }
    }
}

/// The application's sound for one connection, until the connection ends or the sound
/// server does. Its end does not end the picture.
fn sound(inner: &Arc<Inner>, monitor: &str) {
    let Some(mut sound) = audio::Sound::start(monitor) else {
        return;
    };
    let mut at: u64 = 0;
    while !inner.over() {
        let Some((packet, samples)) = sound.next() else {
            break;
        };
        let mut shared = inner.lock();
        if let Some((mid, pt)) = shared.audio {
            let time = MediaTime::new(at, Frequency::FORTY_EIGHT_KHZ);
            let written = shared
                .rtc
                .writer(mid)
                .is_some_and(|writer| writer.write(pt, Instant::now(), time, packet).is_ok());
            if written {
                drive(&mut shared);
            }
        }
        at += u64::from(samples);
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

/// One encoder, for frames of one size. Dropped, it is ended.
struct Encoding {
    child: Child,
    frames: ChildStdin,
    size: (u16, u16),
    began: Instant,
    /// When each frame written and not yet made was read off the display: what the
    /// frame is timed by, so its time is when it was seen (step 9).
    seen: Arc<Mutex<VecDeque<Instant>>>,
}

impl Drop for Encoding {
    fn drop(&mut self) {
        stop(&mut self.child);
    }
}

/// What the picture is waiting to send: the screen drawn on since it was last read, and
/// a whole picture the viewer asked for.
#[derive(Debug, Default)]
struct Owed {
    drawn: bool,
    whole: bool,
}

impl Owed {
    /// Takes one piece of news; answers whether the picture goes on.
    fn hear(&mut self, inner: &Inner, news: News) -> bool {
        match news {
            News::Drawn | News::Resized => self.drawn = true,
            News::Whole => self.whole = true,
            News::Pointer(text) => {
                let mut shared = inner.lock();
                write_channel(&mut shared, &text);
                shared.pointer = Some(text);
                drive(&mut shared);
            }
            News::Gone => return false,
        }
        true
    }

    /// When the next frame is due, if one is owed: a refresh after the last one, and a
    /// whole picture not sooner than `WHOLE_AT_MOST` after the encoder last began.
    fn due(
        &self,
        now: Instant,
        last: Option<Instant>,
        every: Duration,
        began: Option<Instant>,
    ) -> Option<Instant> {
        let refresh = last.map(|at| at + every);
        let drawn = self.drawn.then(|| refresh.unwrap_or(now));
        let whole = self.whole.then(|| {
            let fresh = began.map(|at| at + WHOLE_AT_MOST);
            refresh.max(fresh).unwrap_or(now)
        });
        match (drawn, whole) {
            (Some(one), Some(other)) => Some(one.min(other)),
            (one, other) => one.or(other),
        }
    }
}

/// The picture of one connection: read off the display as it changes, encoded, and
/// written to the video, until the connection ends, the display does, or the encoder.
fn pictures(inner: &Arc<Inner>) {
    let Some((_, _, chosen)) = inner.lock().video else {
        inner.end();
        return;
    };
    let (tell, news) = mpsc::channel();
    let Ok(mut capture) = Capture::open(&inner.screen().display, tell.clone()) else {
        inner.end();
        return;
    };
    inner.lock().news = Some(tell);
    let mut encoding: Option<Encoding> = None;
    // The first frame is owed already: the screen as it is.
    let mut owed = Owed {
        drawn: true,
        whole: false,
    };
    let mut last: Option<Instant> = None;
    'reading: while !inner.over() {
        let fps = encoder::frame_rate(inner.screen().hz);
        let every = Duration::from_secs_f64(1.0 / f64::from(fps));
        let now = Instant::now();
        let due = owed.due(now, last, every, encoding.as_ref().map(|one| one.began));
        if due.is_none_or(|at| at > now) {
            let wait = due.map_or(LISTEN_FOR, |at| at - now).min(LISTEN_FOR);
            match news.recv_timeout(wait) {
                Ok(one) => {
                    for one in std::iter::once(one).chain(news.try_iter()) {
                        if !owed.hear(inner, one) {
                            break 'reading;
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            continue;
        }

        // What was drawn up to now is in this frame, so news of it is not owed again.
        for one in news.try_iter() {
            if !owed.hear(inner, one) {
                break 'reading;
            }
        }
        let Ok((image, size)) = capture.grab() else {
            break;
        };
        let whole_now = owed.whole
            && encoding
                .as_ref()
                .is_none_or(|one| now >= one.began + WHOLE_AT_MOST);
        let fresh = whole_now || encoding.as_ref().is_none_or(|one| one.size != size);
        if fresh {
            // The one before is ended once this has begun, and what it still makes is let
            // go: a new encoder begins with a key frame.
            let Some(started) = start_encoder(inner, chosen, size, fps) else {
                break;
            };
            encoding = Some(started);
            owed.whole = false;
        }
        let Some(writing) = encoding.as_mut() else {
            break;
        };
        lock(&writing.seen).push_back(now);
        if writing.frames.write_all(image).is_err() {
            break;
        }
        owed.drawn = false;
        last = Some(now);
    }
    inner.lock().news = None;
    drop(encoding);
    drop(capture);
    inner.end();
}

/// An encoder for frames of this size, and the thread that sends what it makes.
fn start_encoder(
    inner: &Arc<Inner>,
    chosen: Encoder,
    size: (u16, u16),
    fps: u32,
) -> Option<Encoding> {
    let generation = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let mut child = encoder::command()
        .args(encoder::encoder_args(chosen, size.0, size.1, fps))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let (Some(frames), Some(made)) = (child.stdin.take(), child.stdout.take()) else {
        stop(&mut child);
        return None;
    };
    let sending = inner.clone();
    let seen = Arc::new(Mutex::new(VecDeque::new()));
    let timing = seen.clone();
    std::thread::spawn(move || send_frames(&sending, made, chosen.made, generation, &timing));
    Some(Encoding {
        child,
        frames,
        size,
        began: Instant::now(),
        seen,
    })
}

/// The frames one encoder makes, written to the video while it is the one in use, each
/// at the time its picture was read off the display. The one in use ending by itself
/// ends the picture.
fn send_frames(
    inner: &Arc<Inner>,
    made: ChildStdout,
    codec: Made,
    generation: u64,
    seen: &Mutex<VecDeque<Instant>>,
) {
    let current = || inner.generation.load(Ordering::SeqCst) == generation;
    let send = |frame: Vec<u8>| {
        // One frame out for each written: ffmpeg is told to make one of each, no more.
        let at = lock(seen).pop_front().unwrap_or_else(Instant::now);
        if current() {
            send_frame(inner, frame, at);
        }
    };
    match codec {
        Made::Vp8 | Made::Vp9 => {
            let mut made = made;
            if ivf_header(&mut made).is_ok() {
                while !inner.over() && current() {
                    let Ok(frame) = ivf_frame(&mut made) else {
                        break;
                    };
                    send(frame);
                }
            }
        }
        Made::H264 => {
            // Read on a thread of its own, so that a pause in the stream - the end of a
            // frame, with no next one to say so - is seen.
            let (bytes, came) = mpsc::channel::<Vec<u8>>();
            std::thread::spawn(move || {
                let mut made = made;
                let mut buffer = vec![0_u8; 64 * 1024];
                while let Ok(length) = made.read(&mut buffer) {
                    if length == 0 || bytes.send(buffer[..length].to_vec()).is_err() {
                        break;
                    }
                }
            });
            let mut units = AccessUnits::default();
            while !inner.over() && current() {
                match came.recv_timeout(FRAME_PAUSE) {
                    Ok(some) => units.take(&some).into_iter().for_each(send),
                    Err(RecvTimeoutError::Timeout) => {
                        if let Some(frame) = units.flush() {
                            send(frame);
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        }
    }
    if current() {
        inner.end();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// A message to the tab on the data channel, once it is open.
fn write_channel(shared: &mut Shared, text: &str) {
    if let Some(id) = shared.channel {
        if let Some(mut channel) = shared.rtc.channel(id) {
            let _ = channel.write(false, text.as_bytes());
        }
    }
}

/// One frame written to the video at the time its picture was read off the display, on
/// the 90 kHz clock from when the connection began.
fn send_frame(inner: &Arc<Inner>, frame: Vec<u8>, seen: Instant) {
    let mut shared = inner.lock();
    let (Some((mid, pt, _)), Some(_)) = (shared.video, shared.connected) else {
        return;
    };
    let now = Instant::now();
    let ticks = seen.saturating_duration_since(inner.began).as_micros() * 9 / 100;
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
    #[cfg(target_os = "linux")]
    use std::process::Command;

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
    fn answers_a_ping_with_both_clocks_and_its_encoder() {
        let said: serde_json::Value = serde_json::from_str(&pong_text(
            5.0,
            1000.0,
            1250.5,
            None,
            Some(crate::usage::Usage {
                cpu: 12.5,
                memory: 1024,
                gpu: None,
            }),
        ))
        .unwrap();
        assert_eq!(said["t"], "pong");
        assert_eq!(said["at"], 5.0);
        assert_eq!(said["began"], 1000.0);
        assert_eq!(said["now"], 1250.5);
        assert!(said["encoder"].is_null());
        assert_eq!(said["hardware"], false);
        assert_eq!(said["usage"]["cpu"], 12.5);
        assert_eq!(said["usage"]["memory"], 1024);
        assert!(said["usage"].get("gpu").is_none());
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
        if encoder::ffmpeg().is_none() {
            return;
        }
        let screen = Arc::new(Mutex::new(Screen {
            display: ":1".to_owned(),
            hz: 60.0,
        }));
        assert_eq!(
            Peer::answer(
                Source {
                    screen,
                    clipboard: None,
                    sound: None,
                    group: None,
                },
                "not sdp"
            )
            .err(),
            Some(Cannot::Offer)
        );
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

    /// Whether a VP8 frame is a key frame, and the size a key frame says.
    fn vp8(frame: &[u8]) -> (bool, Option<(u16, u16)>) {
        let key = frame.first().is_some_and(|tag| (tag & 1) == 0);
        let size = (key && frame.len() >= 10 && frame[3..6] == [0x9d, 0x01, 0x2a]).then(|| {
            (
                u16::from_le_bytes([frame[6], frame[7]]) & 0x3fff,
                u16::from_le_bytes([frame[8], frame[9]]) & 0x3fff,
            )
        });
        (key, size)
    }

    /// A viewer of `str0m`'s own on the loopback, as a tab's engine is one.
    struct Viewer {
        rtc: Rtc,
        socket: UdpSocket,
        local: SocketAddr,
    }

    impl Viewer {
        /// A viewer that offers to take the display's picture and its sound, the
        /// host's peer that answered it, and the video's media and the audio's.
        fn connect(
            display: String,
            clipboard: Option<Arc<Clipboard>>,
            sound: Option<String>,
        ) -> (Peer, Viewer, Mid, Mid) {
            use str0m::change::SdpAnswer;
            use str0m::media::Direction;

            let screen = Arc::new(Mutex::new(Screen { display, hz: 30.0 }));
            let mut rtc = RtcConfig::new()
                .set_crypto_provider(provider())
                .build(Instant::now());
            let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
            let local = socket.local_addr().unwrap();
            let mine = Candidate::host(local, "udp").unwrap();
            let _ = rtc.add_local_candidate(mine.clone());
            let mut change = rtc.sdp_api();
            let mid = change.add_media(MediaKind::Video, Direction::RecvOnly, None, None, None);
            let heard = change.add_media(MediaKind::Audio, Direction::RecvOnly, None, None, None);
            change.add_channel("input".to_owned());
            let (offer, pending) = change.apply().unwrap();

            let (peer, answer) = Peer::answer(
                Source {
                    screen,
                    clipboard,
                    sound,
                    group: None,
                },
                &offer.to_sdp_string(),
            )
            .unwrap();
            assert!(answer.contains("VP8"));
            rtc.sdp_api()
                .accept_answer(pending, SdpAnswer::from_sdp_string(&answer).unwrap())
                .unwrap();
            peer.candidate(&mine.to_sdp_string());
            socket
                .set_read_timeout(Some(Duration::from_millis(10)))
                .unwrap();
            (peer, Viewer { rtc, socket, local }, mid, heard)
        }

        /// Runs it for at most `within`, each event handed to `heard`, until `done`.
        fn run(
            &mut self,
            within: Duration,
            mut heard: impl FnMut(&mut Rtc, Event),
            mut done: impl FnMut() -> bool,
        ) -> bool {
            let until = Instant::now() + within;
            let mut buffer = vec![0_u8; 2000];
            while Instant::now() < until {
                if done() {
                    return true;
                }
                loop {
                    match self.rtc.poll_output().unwrap() {
                        Output::Timeout(_) => break,
                        Output::Transmit(datagram) => {
                            // The host's other addresses are not reachable from the loopback.
                            let _ = self
                                .socket
                                .send_to(&datagram.contents, datagram.destination);
                        }
                        Output::Event(event) => heard(&mut self.rtc, event),
                    }
                }
                let input = match self.socket.recv_from(&mut buffer) {
                    Ok((length, from)) => Input::Receive(
                        Instant::now(),
                        Receive::new(Protocol::Udp, from, self.local, &buffer[..length]).unwrap(),
                    ),
                    Err(_) => Input::Timeout(Instant::now()),
                };
                self.rtc.handle_input(input).unwrap();
            }
            done()
        }
    }

    #[cfg(target_os = "linux")]
    /// A viewer of `str0m`'s own, on the loopback, against a real Xvfb and ffmpeg. It
    /// connects with the answer and gets the display's picture as VP8, key frame first,
    /// and the pointer's shape, and moves the display's pointer over the data channel.
    /// Then: nothing drawn, nothing is sent; something drawn is; a whole picture asked
    /// for comes as a key frame; and the screen made another size comes as a key frame
    /// of that size. CI installs both; elsewhere the test says nothing without them.
    #[test]
    #[allow(
        clippy::too_many_lines,
        reason = "one viewer's picture, told in the order it changes"
    )]
    fn a_viewer_gets_the_picture_of_the_display_as_it_changes() {
        super::super::in_time(|| {
            use str0m::media::KeyframeRequestKind;
            use x11rb::connection::Connection as _;
            use x11rb::protocol::xproto::{ConnectionExt as _, CreateGCAux, Rectangle};

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
            let (peer, mut viewer, mid, _) = Viewer::connect(display.name(), None, None);
            let (x, number) = x11rb::connect(Some(display.name().as_str())).unwrap();
            let root = x.setup().roots[number].root;
            let pointer = || {
                let at = x.query_pointer(root).ok()?.reply().ok()?;
                Some((at.root_x, at.root_y))
            };
            let frames = std::cell::RefCell::new(Vec::<Vec<u8>>::new());
            let mut shape = false;
            let heard = |rtc: &mut Rtc, event: Event, shape: &mut bool| match event {
                Event::ChannelOpen(id, _) => {
                    if let Some(mut channel) = rtc.channel(id) {
                        channel
                            .write(false, br#"{"t":"move","x":100,"y":50}"#)
                            .unwrap();
                    }
                }
                Event::ChannelData(data) => {
                    *shape = *shape
                        || data.data.starts_with(b"{")
                            && String::from_utf8_lossy(&data.data).contains(r#""t":"pointer""#);
                }
                Event::MediaData(data) => frames.borrow_mut().push(data.data.to_vec()),
                _ => {}
            };

            let connected = viewer.run(
                Duration::from_secs(30),
                |rtc, event| heard(rtc, event, &mut shape),
                || !frames.borrow().is_empty() && pointer() == Some((100, 50)),
            );
            assert!(connected, "{} frames came", frames.borrow().len());
            assert!(vp8(&frames.borrow()[0]).0, "the first frame is a key frame");
            let mut shaped = shape;
            viewer.run(
                Duration::from_secs(2),
                |rtc, event| heard(rtc, event, &mut shaped),
                || false,
            );
            assert!(shape || shaped, "the pointer's shape came");

            // Nothing drawn: nothing sent.
            frames.borrow_mut().clear();
            viewer.run(
                Duration::from_millis(800),
                |rtc, event| heard(rtc, event, &mut shaped),
                || false,
            );
            assert!(
                frames.borrow().is_empty(),
                "{} frames of a still screen",
                frames.borrow().len()
            );

            // Something drawn: sent.
            let pen = x.generate_id().unwrap();
            x.create_gc(pen, root, &CreateGCAux::new().foreground(0x00ff_0000))
                .unwrap();
            x.poly_fill_rectangle(
                root,
                pen,
                &[Rectangle {
                    x: 0,
                    y: 0,
                    width: 40,
                    height: 40,
                }],
            )
            .unwrap();
            x.flush().unwrap();
            let drawn = viewer.run(
                Duration::from_secs(5),
                |rtc, event| heard(rtc, event, &mut shaped),
                || !frames.borrow().is_empty(),
            );
            assert!(drawn, "what was drawn came");

            // A whole picture asked for: a key frame.
            frames.borrow_mut().clear();
            viewer
                .rtc
                .writer(mid)
                .unwrap()
                .request_keyframe(None, KeyframeRequestKind::Pli)
                .unwrap();
            let whole = viewer.run(
                Duration::from_secs(5),
                |rtc, event| heard(rtc, event, &mut shaped),
                || frames.borrow().iter().any(|one| vp8(one).0),
            );
            assert!(whole, "a key frame came when one was asked for");

            // Another size: a key frame of it.
            frames.borrow_mut().clear();
            display.fit(400, 300, 1.0).unwrap();
            let resized = viewer.run(
                Duration::from_secs(5),
                |rtc, event| heard(rtc, event, &mut shaped),
                || {
                    frames
                        .borrow()
                        .iter()
                        .any(|one| vp8(one).1 == Some((400, 300)))
                },
            );
            assert!(resized, "a key frame of the new size came");
            assert!(!peer.ended());
            drop(peer);
        });
    }

    #[cfg(target_os = "linux")]
    /// The clipboard over the picture's channel: nothing while the holder does not
    /// share it; shared, what the holder gives is what the application's paste gets, and
    /// what the application copies comes to the holder. CI installs Xvfb and ffmpeg;
    /// elsewhere the test says nothing without them.
    #[test]
    #[allow(
        clippy::too_many_lines,
        reason = "one paste and one copy, told in the order they happen"
    )]
    fn the_clipboard_goes_both_ways_while_the_holder_shares_it() {
        super::super::in_time(|| {
            use x11rb::connection::Connection as _;
            use x11rb::protocol::xproto::{
                AtomEnum, ConnectionExt as _, CreateWindowAux, EventMask, PropMode,
                SelectionNotifyEvent, WindowClass, SELECTION_NOTIFY_EVENT,
            };
            use x11rb::wrapper::ConnectionExt as _;
            use x11rb::NONE;

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
            let (peer, mut viewer, _, _) =
                Viewer::connect(display.name(), display.clipboard(), None);
            let (x, number) = x11rb::connect(Some(display.name().as_str())).unwrap();
            let root = x.setup().roots[number].root;
            let atoms = super::super::clipboard::Atoms::new(&x)
                .unwrap()
                .reply()
                .unwrap();
            let window = x.generate_id().unwrap();
            x.create_window(
                0,
                window,
                root,
                0,
                0,
                1,
                1,
                0,
                WindowClass::INPUT_ONLY,
                0,
                &CreateWindowAux::new(),
            )
            .unwrap();
            x.flush().unwrap();
            let owner = || {
                x.get_selection_owner(atoms.CLIPBOARD)
                    .unwrap()
                    .reply()
                    .unwrap()
                    .owner
            };

            let channel = std::cell::Cell::new(None);
            let copied = std::cell::RefCell::new(Vec::<String>::new());
            let heard = |_: &mut Rtc, event: Event| match event {
                Event::ChannelOpen(id, _) => channel.set(Some(id)),
                Event::ChannelData(data) => {
                    let text = String::from_utf8_lossy(&data.data).into_owned();
                    if text.contains(r#""t":"clipboard""#) {
                        copied.borrow_mut().push(text);
                    }
                }
                _ => {}
            };
            assert!(viewer.run(Duration::from_secs(30), heard, || channel.get().is_some()));
            let say = |viewer: &mut Viewer, text: &[u8]| {
                let id = channel.get().unwrap();
                viewer.rtc.channel(id).unwrap().write(false, text).unwrap();
            };

            // Not shared: the holder's clipboard goes nowhere.
            say(&mut viewer, br#"{"t":"clipboard","text":"secret"}"#);
            viewer.run(Duration::from_millis(500), heard, || false);
            assert_eq!(owner(), NONE);

            // Shared: the application's paste gets it.
            say(&mut viewer, br#"{"t":"share","clipboard":true}"#);
            say(
                &mut viewer,
                br#"{"t":"clipboard","text":"from the holder"}"#,
            );
            assert!(viewer.run(Duration::from_secs(5), heard, || owner() != NONE));
            x.convert_selection(
                window,
                atoms.CLIPBOARD,
                atoms.UTF8_STRING,
                atoms.ORDEN_CLIPBOARD,
                x11rb::CURRENT_TIME,
            )
            .unwrap();
            x.flush().unwrap();
            let mut pasted = None;
            viewer.run(Duration::from_secs(5), heard, || {
                if let Ok(Some(x11rb::protocol::Event::SelectionNotify(answer))) =
                    x.poll_for_event()
                {
                    pasted = x
                        .get_property(true, window, answer.property, AtomEnum::ANY, 0, 1024)
                        .ok()
                        .and_then(|cookie| cookie.reply().ok())
                        .map(|reply| String::from_utf8_lossy(&reply.value).into_owned());
                }
                pasted.is_some()
            });
            assert_eq!(pasted.as_deref(), Some("from the holder"));

            // The application copies: the holder hears it.
            x.set_selection_owner(window, atoms.CLIPBOARD, x11rb::CURRENT_TIME)
                .unwrap();
            x.flush().unwrap();
            let came = viewer.run(Duration::from_secs(5), heard, || {
                if let Ok(Some(x11rb::protocol::Event::SelectionRequest(asked))) =
                    x.poll_for_event()
                {
                    let _ = x.change_property8(
                        PropMode::REPLACE,
                        asked.requestor,
                        asked.property,
                        atoms.UTF8_STRING,
                        b"from the application",
                    );
                    let _ = x.send_event(
                        false,
                        asked.requestor,
                        EventMask::NO_EVENT,
                        SelectionNotifyEvent {
                            response_type: SELECTION_NOTIFY_EVENT,
                            sequence: 0,
                            time: asked.time,
                            requestor: asked.requestor,
                            selection: asked.selection,
                            target: asked.target,
                            property: asked.property,
                        },
                    );
                    let _ = x.flush();
                }
                !copied.borrow().is_empty()
            });
            assert!(came, "what the application copied came");
            assert_eq!(
                copied.borrow()[0],
                r#"{"t":"clipboard","text":"from the application"}"#
            );
            drop(peer);
        });
    }

    #[cfg(target_os = "linux")]
    /// A sound server for the test: the one there is, or one started for it where
    /// `pulseaudio` is installed (CI installs it), in a folder of its own.
    fn sound_server() -> Option<std::process::Child> {
        let up = || {
            Command::new("pactl")
                .arg("info")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
        };
        if up() || !super::super::installed::on_path("pulseaudio") {
            return None;
        }
        let folder = std::env::temp_dir().join(format!("orden-pulse-{}", std::process::id()));
        std::fs::create_dir_all(&folder).ok()?;
        // The `pactl` and `parec` this process starts find the server by it; no other
        // test asks for a sound server.
        std::env::set_var("PULSE_RUNTIME_PATH", &folder);
        let server = Command::new("pulseaudio")
            .args([
                "-n",
                "--daemonize=no",
                "--exit-idle-time=-1",
                "--disallow-exit",
                "-L",
                "module-native-protocol-unix",
                "-L",
                "module-null-sink sink_name=orden_test_default",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let until = Instant::now() + Duration::from_secs(10);
        while !up() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(50));
        }
        Some(server)
    }

    #[cfg(target_os = "linux")]
    /// The application's sound reaches a viewer that offers to take it, as Opus. CI
    /// installs Xvfb, ffmpeg and `PulseAudio`; elsewhere the test says nothing without
    /// them.
    #[test]
    fn a_viewer_hears_the_applications_sound() {
        super::super::in_time(|| {
            let ready = super::super::display::available()
                && super::super::installed::on_path("ffmpeg")
                && audio::available();
            if !ready {
                assert!(
                    std::env::var_os("CI").is_none() || !cfg!(target_os = "linux"),
                    "CI installs xvfb, ffmpeg and pulseaudio for this test"
                );
                return;
            }
            let server = sound_server();
            let sink = audio::Sink::make(std::process::id() % 100_000 + 400_000);
            assert!(
                sink.is_some() || std::env::var_os("CI").is_none(),
                "a sink of the application's own"
            );
            let Some(sink) = sink else {
                return;
            };
            // The application playing: noise into its sink.
            let monitor = sink.monitor();
            let mut playing = Command::new("pacat")
                .args([
                    "--playback",
                    &format!("--device={}", monitor.trim_end_matches(".monitor")),
                    "--format=s16le",
                    "--rate=48000",
                    "--channels=2",
                    "--raw",
                ])
                .stdin(std::fs::File::open("/dev/urandom").unwrap())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();

            let display = super::super::display::Display::start(320, 240, 1.0).unwrap();
            let (peer, mut viewer, _, heard) =
                Viewer::connect(display.name(), display.clipboard(), Some(monitor));
            let packets = std::cell::Cell::new(0);
            let came = viewer.run(
                Duration::from_secs(30),
                |_, event| {
                    if let Event::MediaData(data) = event {
                        if data.mid == heard {
                            packets.set(packets.get() + 1);
                        }
                    }
                },
                || packets.get() >= 20,
            );
            assert!(came, "{} packets of sound came", packets.get());
            drop(peer);
            let _ = playing.kill();
            let _ = playing.wait();
            drop(sink);
            if let Some(mut server) = server {
                let _ = server.kill();
                let _ = server.wait();
            }
        });
    }

    #[cfg(target_os = "linux")]
    /// The latency benchmark (step 9): from something drawn on the display to its frame
    /// arriving at a viewer on the loopback - reading, encoding, sending, receiving, the
    /// part of glass to glass that is the host's and the network's - and the frames of an
    /// application drawing at the refresh rate arriving at it, evenly. The bounds are
    /// far above what CI's runners measure (a few milliseconds), so that only a real
    /// regression - a frame held back, a refresh missed - fails them. CI installs Xvfb
    /// and ffmpeg; elsewhere the test says nothing without them.
    #[test]
    #[allow(
        clippy::too_many_lines,
        reason = "one benchmark, its two halves told in order"
    )]
    fn latency_benchmark() {
        super::super::in_time(|| {
            use x11rb::connection::Connection as _;
            use x11rb::protocol::xproto::{
                ChangeGCAux, ConnectionExt as _, CreateGCAux, Rectangle,
            };

            let ready =
                super::super::display::available() && super::super::installed::on_path("ffmpeg");
            if !ready {
                assert!(
                    std::env::var_os("CI").is_none() || !cfg!(target_os = "linux"),
                    "CI installs xvfb and ffmpeg for this test"
                );
                return;
            }
            let display = super::super::display::Display::start(640, 400, 1.0).unwrap();
            let (peer, mut viewer, _, _) =
                Viewer::connect(display.name(), display.clipboard(), None);
            let (x, number) = x11rb::connect(Some(display.name().as_str())).unwrap();
            let root = x.setup().roots[number].root;
            let pen = x.generate_id().unwrap();
            x.create_gc(pen, root, &CreateGCAux::new()).unwrap();
            let mut colour = 0_u32;
            let mut draw = || {
                colour = colour.wrapping_add(0x0011_2233) & 0x00ff_ffff;
                x.change_gc(pen, &ChangeGCAux::new().foreground(colour))
                    .unwrap();
                x.poly_fill_rectangle(
                    root,
                    pen,
                    &[Rectangle {
                        x: 0,
                        y: 0,
                        width: 640,
                        height: 400,
                    }],
                )
                .unwrap();
                x.flush().unwrap();
            };
            let frames = std::cell::Cell::new(0_usize);
            let arrived = std::cell::RefCell::new(Vec::<Instant>::new());
            let heard = |_: &mut Rtc, event: Event| {
                if let Event::MediaData(_) = event {
                    frames.set(frames.get() + 1);
                    arrived.borrow_mut().push(Instant::now());
                }
            };
            assert!(viewer.run(Duration::from_secs(30), heard, || frames.get() > 0));
            viewer.run(Duration::from_millis(300), heard, || false);

            // Drawn to arrived, one frame at a time.
            let mut latencies = Vec::new();
            for _ in 0..20 {
                let before = frames.get();
                draw();
                let drawn = Instant::now();
                assert!(viewer.run(Duration::from_secs(5), heard, || frames.get() > before));
                latencies.push(drawn.elapsed());
                viewer.run(Duration::from_millis(60), heard, || false);
            }
            latencies.sort();
            let median = latencies[latencies.len() / 2];
            let worst = latencies[latencies.len() * 9 / 10];
            eprintln!("drawn to arrived: median {median:?}, 90th {worst:?}");
            assert!(median < Duration::from_millis(50), "median {median:?}");
            assert!(worst < Duration::from_millis(120), "90th {worst:?}");

            // Drawing at the holder's refresh rate, 30 here: as many frames, evenly.
            arrived.borrow_mut().clear();
            let began = Instant::now();
            let mut next = began;
            let mut drawn = 0;
            while began.elapsed() < Duration::from_secs(2) {
                if Instant::now() >= next {
                    draw();
                    drawn += 1;
                    next += Duration::from_millis(33);
                }
                viewer.run(Duration::from_millis(2), heard, || false);
            }
            viewer.run(Duration::from_millis(200), heard, || false);
            let times = arrived.borrow();
            let gaps: Vec<Duration> = times.windows(2).map(|two| two[1] - two[0]).collect();
            let longest = gaps.iter().max().copied().unwrap_or_default();
            eprintln!(
                "{drawn} drawn, {} arrived, longest gap {longest:?}",
                times.len()
            );
            assert!(times.len() * 10 >= drawn * 8, "{} of {drawn}", times.len());
            assert!(
                longest < Duration::from_millis(250),
                "longest gap {longest:?}"
            );
            drop(times);
            drop(peer);
        });
    }

    /// Notepad on a desktop of its own, seen by a viewer of `str0m`'s own on the loopback
    /// (step 8): its picture comes as VP8, key frame first; a click and text played over
    /// the data channel type into it, and nothing of it is on the reader's desktop. CI
    /// installs ffmpeg on Windows; elsewhere the test says nothing without it.
    #[cfg(target_os = "windows")]
    #[test]
    fn a_viewer_gets_the_picture_of_a_desktop_of_its_own_and_types_into_it() {
        super::super::in_time(|| {
            use super::super::desk;

            let notepad = std::path::PathBuf::from(std::env::var("SystemRoot").unwrap())
                .join("System32\\notepad.exe");
            if encoder::ffmpeg().is_none() || !notepad.is_file() {
                assert!(
                    std::env::var_os("CI").is_none(),
                    "CI installs ffmpeg for this test"
                );
                return;
            }
            let desktop = desk::Desktop::start(640, 480).unwrap();
            let program = desktop
                .run(
                    &[notepad.to_string_lossy().into_owned()],
                    &std::env::temp_dir(),
                )
                .unwrap();
            let (peer, mut viewer, _, _) = Viewer::connect(desktop.name(), None, None);
            let frames = std::cell::RefCell::new(Vec::<Vec<u8>>::new());
            let channel = std::cell::Cell::new(None);
            let connected = viewer.run(
                Duration::from_secs(30),
                |_, event| match event {
                    Event::ChannelOpen(id, _) => channel.set(Some(id)),
                    Event::MediaData(data) => frames.borrow_mut().push(data.data.to_vec()),
                    _ => {}
                },
                || {
                    channel.get().is_some()
                        && frames.borrow().iter().any(|one| vp8(one).1.is_some())
                },
            );
            assert!(connected, "{} frames came", frames.borrow().len());
            assert!(vp8(&frames.borrow()[0]).0, "the first frame is a key frame");

            let id = channel.get().unwrap();
            for said in [
                r#"{"t":"move","x":320,"y":240}"#,
                r#"{"t":"button","button":0,"down":true}"#,
                r#"{"t":"button","button":0,"down":false}"#,
                r#"{"t":"text","text":"hello from afar"}"#,
            ] {
                viewer
                    .rtc
                    .channel(id)
                    .unwrap()
                    .write(false, said.as_bytes())
                    .unwrap();
                viewer.run(Duration::from_millis(200), |_, _| {}, || false);
            }
            let desk = desk::desk(&desktop.name()).unwrap();
            let typed = std::thread::spawn(move || {
                desk.enter().unwrap();
                let until = Instant::now() + Duration::from_secs(10);
                while Instant::now() < until {
                    if desk::shown()
                        .into_iter()
                        .any(|one| text_in(one).contains("hello from afar"))
                    {
                        return true;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                false
            })
            .join()
            .unwrap();
            assert!(typed, "the text did not reach notepad");
            assert!(!peer.ended());
            drop(peer);
            // Typed into, it would ask whether to save before it closed: ended instead.
            desk::kill(program.pid());
            let _ = program.wait();
        });
    }

    /// The text of a window and of its children, as each answers `WM_GETTEXT`.
    #[cfg(target_os = "windows")]
    #[allow(unsafe_code, reason = "a window's text is asked with Win32 messages")]
    fn text_in(window: windows::Win32::Foundation::HWND) -> String {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            FindWindowExW, SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_GETTEXT,
        };

        let mut all = String::new();
        let mut child = HWND::default();
        for _ in 0..64 {
            // SAFETY: windows of a desktop this thread is on; a buffer of the size said.
            unsafe {
                child = FindWindowExW(window, child, PCWSTR::null(), PCWSTR::null())
                    .unwrap_or_default();
                if child.is_invalid() {
                    break;
                }
                let mut buffer = [0_u16; 4096];
                let mut length = 0_usize;
                SendMessageTimeoutW(
                    child,
                    WM_GETTEXT,
                    WPARAM(buffer.len()),
                    LPARAM(buffer.as_mut_ptr() as isize),
                    SMTO_ABORTIFHUNG,
                    2000,
                    Some(&raw mut length),
                );
                all.push_str(&String::from_utf16_lossy(
                    &buffer[..length.min(buffer.len())],
                ));
            }
        }
        all
    }
}
