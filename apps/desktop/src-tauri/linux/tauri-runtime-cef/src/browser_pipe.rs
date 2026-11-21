use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, sync_channel};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{Value, json};

pub const EXTENSION_METHODS: &[&str] = &["Extensions.loadUnpacked", "Extensions.uninstall"];

pub(crate) const DEBUGGING_SWITCHES: &[&str] = &[
  "remote-debugging-port",
  "remote-debugging-address",
  "remote-debugging-pipe",
  "remote-debugging-io-pipes",
  "remote-allow-origins",
];

type Answer = Result<Value, String>;

pub(crate) struct Pipe {
  writer: Mutex<Box<dyn Write + Send>>,
  waiting: Mutex<HashMap<u64, SyncSender<Answer>>>,
  closed: AtomicBool,
  next: AtomicU64,
}

static PIPE: OnceLock<Arc<Pipe>> = OnceLock::new();

fn framed(id: u64, method: &str, params: &Value) -> Vec<u8> {
  let mut bytes = json!({ "id": id, "method": method, "params": params })
    .to_string()
    .into_bytes();
  bytes.push(0);
  bytes
}

fn answer_of(message: &Value) -> Option<(u64, Answer)> {
  let id = message.get("id")?.as_u64()?;
  if let Some(error) = message.get("error") {
    let said = error.get("message").and_then(Value::as_str).unwrap_or("no message");
    let code = error.get("code").and_then(Value::as_i64).unwrap_or_default();
    return Some((id, Err(format!("the browser answered with CDP error {code}: {said}"))));
  }
  Some((id, Ok(message.get("result").cloned().unwrap_or(Value::Null))))
}

fn read_frames(reader: impl Read, mut each: impl FnMut(&[u8])) {
  let mut reader = BufReader::new(reader);
  let mut frame = Vec::new();
  loop {
    frame.clear();
    match reader.read_until(0, &mut frame) {
      Ok(0) | Err(_) => return,
      Ok(_) => {
        if frame.last() == Some(&0) {
          frame.pop();
          each(&frame);
        } else {
          return;
        }
      }
    }
  }
}

pub(crate) fn allowed(method: &str) -> Result<(), String> {
  if EXTENSION_METHODS.contains(&method) {
    Ok(())
  } else {
    Err(format!(
      "{method} is not carried by the browser pipe, which takes only {}",
      EXTENSION_METHODS.join(" and ")
    ))
  }
}

impl Pipe {
  fn new(writer: Box<dyn Write + Send>) -> Self {
    Self {
      writer: Mutex::new(writer),
      waiting: Mutex::new(HashMap::new()),
      closed: AtomicBool::new(false),
      next: AtomicU64::new(1),
    }
  }

  fn settle(&self, frame: &[u8]) {
    let Ok(message) = serde_json::from_slice::<Value>(frame) else {
      return;
    };
    let Some((id, answer)) = answer_of(&message) else {
      return;
    };
    let waiter = self.waiting.lock().ok().and_then(|mut all| all.remove(&id));
    if let Some(waiter) = waiter {
      let _ = waiter.try_send(answer);
    }
  }

  fn close(&self) {
    self.closed.store(true, Ordering::SeqCst);
    let waiters: Vec<_> = self
      .waiting
      .lock()
      .map(|mut all| all.drain().map(|(_, one)| one).collect())
      .unwrap_or_default();
    for one in waiters {
      let _ = one.try_send(Err("the browser pipe closed".to_string()));
    }
  }

  fn call(&self, method: &str, params: &Value, patience: Duration) -> Answer {
    allowed(method)?;
    if self.closed.load(Ordering::SeqCst) {
      return Err("the browser pipe closed".to_string());
    }
    let id = self.next.fetch_add(1, Ordering::Relaxed);
    let (answered, answer) = sync_channel(1);
    self
      .waiting
      .lock()
      .map_err(|_| "the browser pipe is broken".to_string())?
      .insert(id, answered);
    let written = self
      .writer
      .lock()
      .map_err(|_| "the browser pipe is broken".to_string())
      .and_then(|mut writer| {
        writer
          .write_all(&framed(id, method, params))
          .and_then(|()| writer.flush())
          .map_err(|error| format!("the browser pipe could not be written: {error}"))
      });
    let forget = || {
      if let Ok(mut all) = self.waiting.lock() {
        all.remove(&id);
      }
    };
    if let Err(error) = written {
      forget();
      return Err(error);
    }
    answer.recv_timeout(patience).unwrap_or_else(|_| {
      forget();
      Err(format!(
        "the browser pipe did not answer {method} in {} ms",
        patience.as_millis()
      ))
    })
  }
}

fn start(reader: impl Read + Send + 'static, writer: impl Write + Send + 'static) -> bool {
  let pipe = Arc::new(Pipe::new(Box::new(writer)));
  if PIPE.set(pipe.clone()).is_err() {
    return false;
  }
  std::thread::Builder::new()
    .name("browser-pipe".into())
    .spawn(move || {
      read_frames(reader, |frame| pipe.settle(frame));
      pipe.close();
    })
    .is_ok()
}

pub fn extensions_cdp(method: &str, params: &Value, patience: Duration) -> Answer {
  allowed(method)?;
  PIPE
    .get()
    .ok_or_else(|| "the browser pipe is not open".to_string())?
    .call(method, params, patience)
}

pub(crate) fn open() -> Option<Vec<(String, Option<String>)>> {
  let (reader, writer, mut switches) = ends()?;
  if !start(reader, writer) {
    return None;
  }
  switches.insert(0, ("--remote-debugging-pipe".to_string(), None));
  switches.push(unmarked());
  Some(switches)
}

fn unmarked() -> (String, Option<String>) {
  ("--disable-blink-features".to_string(), Some("AutomationControlled".to_string()))
}

#[cfg(unix)]
type Ends = (std::fs::File, std::fs::File, Vec<(String, Option<String>)>);

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn ends() -> Option<Ends> {
  use std::os::fd::FromRawFd;
  let (reader, writer) = posix::take()?;
  Some(unsafe {
    (
      std::fs::File::from_raw_fd(reader),
      std::fs::File::from_raw_fd(writer),
      Vec::new(),
    )
  })
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn ends() -> Option<Ends> {
  None
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) fn hand_back_inherited() {
  posix::hand_back();
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub(crate) fn hand_back_inherited() {}

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod posix {
  use std::ffi::{CStr, c_char, c_int};
  use std::sync::atomic::{AtomicI32, Ordering};

  const READ_FD: c_int = 3;
  const WRITE_FD: c_int = 4;
  const ABOVE: c_int = 10;

  static READER: AtomicI32 = AtomicI32::new(-1);
  static WRITER: AtomicI32 = AtomicI32::new(-1);
  static MOVED: [AtomicI32; 2] = [AtomicI32::new(-1), AtomicI32::new(-1)];

  pub(super) fn is_child(args: impl IntoIterator<Item = Vec<u8>>) -> bool {
    args.into_iter().any(|arg| arg.starts_with(b"--type="))
  }

  fn high(fd: c_int) -> c_int {
    let moved = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, ABOVE) };
    unsafe { libc::close(fd) };
    moved
  }

  fn pipe() -> Option<(c_int, c_int)> {
    let mut fds = [0 as c_int; 2];
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
      return None;
    }
    let (read, write) = (high(fds[0]), high(fds[1]));
    if read < 0 || write < 0 {
      unsafe {
        libc::close(read);
        libc::close(write);
      }
      return None;
    }
    Some((read, write))
  }

  fn place(fd: c_int, at: c_int) -> bool {
    let placed = unsafe { libc::dup2(fd, at) } == at;
    unsafe {
      libc::close(fd);
      if placed {
        libc::fcntl(at, libc::F_SETFD, libc::FD_CLOEXEC);
      }
    }
    placed
  }

  fn reserve(args: impl IntoIterator<Item = Vec<u8>>) {
    if is_child(args) {
      return;
    }
    for (slot, fd) in MOVED.iter().zip([READ_FD, WRITE_FD]) {
      if unsafe { libc::fcntl(fd, libc::F_GETFD) } != -1 {
        slot.store(unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, ABOVE) }, Ordering::SeqCst);
      }
    }
    let Some((chromium_reads, we_write)) = pipe() else {
      return;
    };
    let Some((we_read, chromium_writes)) = pipe() else {
      unsafe {
        libc::close(chromium_reads);
        libc::close(we_write);
      }
      return;
    };
    if place(chromium_reads, READ_FD) && place(chromium_writes, WRITE_FD) {
      READER.store(we_read, Ordering::SeqCst);
      WRITER.store(we_write, Ordering::SeqCst);
    } else {
      unsafe {
        libc::close(we_read);
        libc::close(we_write);
      }
    }
  }

  pub(super) fn take() -> Option<(c_int, c_int)> {
    let reader = READER.swap(-1, Ordering::SeqCst);
    let writer = WRITER.swap(-1, Ordering::SeqCst);
    (reader >= 0 && writer >= 0).then_some((reader, writer))
  }

  pub(super) fn hand_back() {
    for (slot, fd) in MOVED.iter().zip([READ_FD, WRITE_FD]) {
      let moved = slot.swap(-1, Ordering::SeqCst);
      if moved >= 0 {
        unsafe {
          libc::dup2(moved, fd);
          libc::close(moved);
        }
      }
    }
  }

  extern "C" fn at_start(argc: c_int, argv: *const *const c_char, _: *const *const c_char) {
    if argv.is_null() || argc < 0 {
      return;
    }
    let args = (0..argc as usize).filter_map(|at| {
      let arg = unsafe { *argv.add(at) };
      (!arg.is_null()).then(|| unsafe { CStr::from_ptr(arg) }.to_bytes().to_vec())
    });
    reserve(args);
  }

  #[used]
  #[cfg_attr(target_os = "linux", unsafe(link_section = ".init_array"))]
  #[cfg_attr(target_os = "macos", unsafe(link_section = "__DATA,__mod_init_func"))]
  static AT_START: extern "C" fn(c_int, *const *const c_char, *const *const c_char) = at_start;
}

#[cfg(windows)]
fn ends() -> Option<(std::fs::File, std::fs::File, Vec<(String, Option<String>)>)> {
  use std::os::windows::io::FromRawHandle;
  use windows::Win32::Foundation::HANDLE;
  use windows::Win32::System::Pipes::CreatePipe;
  let mut chromium_reads = HANDLE::default();
  let mut we_write = HANDLE::default();
  let mut we_read = HANDLE::default();
  let mut chromium_writes = HANDLE::default();
  unsafe {
    CreatePipe(&mut chromium_reads, &mut we_write, None, 0).ok()?;
    CreatePipe(&mut we_read, &mut chromium_writes, None, 0).ok()?;
  }
  let value = io_pipes(chromium_reads.0 as usize, chromium_writes.0 as usize)?;
  Some(unsafe {
    (
      std::fs::File::from_raw_handle(we_read.0),
      std::fs::File::from_raw_handle(we_write.0),
      vec![("--remote-debugging-io-pipes".to_string(), Some(value))],
    )
  })
}

#[cfg_attr(not(windows), allow(dead_code))]
fn io_pipes(reads: usize, writes: usize) -> Option<String> {
  Some(format!("{},{}", u32::try_from(reads).ok()?, u32::try_from(writes).ok()?))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Cursor;

  #[test]
  fn the_pipe_never_marks_pages_as_driven_by_automation() {
    assert_eq!(
      super::unmarked(),
      ("--disable-blink-features".to_string(), Some("AutomationControlled".to_string()))
    );
    let source = include_str!("browser_pipe.rs");
    let opening = &source[source.find("pub(crate) fn open()").expect("open")..];
    assert!(opening[..opening.find("\n}\n").expect("its end")].contains("switches.push(unmarked())"));
  }

  struct Dribble {
    bytes: Vec<u8>,
    at: usize,
  }

  impl Read for Dribble {
    fn read(&mut self, into: &mut [u8]) -> std::io::Result<usize> {
      let take = into.len().min(3).min(self.bytes.len() - self.at);
      into[..take].copy_from_slice(&self.bytes[self.at..self.at + take]);
      self.at += take;
      Ok(take)
    }
  }

  #[derive(Clone, Default)]
  struct Sink(Arc<Mutex<Vec<u8>>>);

  impl Write for Sink {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
      self.0.lock().unwrap().extend_from_slice(bytes);
      Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
      Ok(())
    }
  }

  #[test]
  fn a_call_is_one_json_message_ended_by_a_nul() {
    let bytes = framed(7, "Extensions.loadUnpacked", &json!({ "path": "/x" }));
    assert_eq!(bytes.last(), Some(&0));
    assert_eq!(bytes.iter().filter(|byte| **byte == 0).count(), 1);
    let message: Value = serde_json::from_slice(&bytes[..bytes.len() - 1]).unwrap();
    assert_eq!(
      message,
      json!({ "id": 7, "method": "Extensions.loadUnpacked", "params": { "path": "/x" } })
    );
  }

  #[test]
  fn frames_split_on_nul_even_when_they_arrive_in_halves_and_a_cut_tail_is_dropped() {
    let mut seen = Vec::new();
    let bytes = b"{\"id\":1}\0{\"method\":\"x\"}\0{\"id\":2,\"result\":{}}\0{\"id\":3".to_vec();
    read_frames(Dribble { bytes, at: 0 }, |frame| {
      seen.push(String::from_utf8(frame.to_vec()).unwrap())
    });
    assert_eq!(seen, vec![r#"{"id":1}"#, r#"{"method":"x"}"#, r#"{"id":2,"result":{}}"#]);
    let mut none = 0;
    read_frames(Cursor::new(Vec::new()), |_| none += 1);
    assert_eq!(none, 0);
  }

  #[test]
  fn an_answer_reaches_the_call_with_its_id_and_an_error_says_cdp_s_own_words() {
    assert_eq!(answer_of(&json!({ "method": "Target.attachedToTarget" })), None);
    assert_eq!(
      answer_of(&json!({ "id": 4, "result": { "id": "abc" } })),
      Some((4, Ok(json!({ "id": "abc" }))))
    );
    assert_eq!(
      answer_of(&json!({ "id": 5, "error": { "code": -32000, "message": "Not allowed" } })),
      Some((5, Err("the browser answered with CDP error -32000: Not allowed".to_string())))
    );
    let pipe = Pipe::new(Box::new(Sink::default()));
    let (one, first) = sync_channel(1);
    let (two, second) = sync_channel(1);
    pipe.waiting.lock().unwrap().insert(1, one);
    pipe.waiting.lock().unwrap().insert(2, two);
    pipe.settle(br#"{"id":2,"result":{"id":"b"}}"#);
    pipe.settle(br#"{"id":1,"result":{"id":"a"}}"#);
    assert_eq!(first.recv().unwrap(), Ok(json!({ "id": "a" })));
    assert_eq!(second.recv().unwrap(), Ok(json!({ "id": "b" })));
    assert!(pipe.waiting.lock().unwrap().is_empty());
  }

  #[test]
  fn only_the_extensions_methods_are_carried_and_every_other_is_refused_before_it_is_sent() {
    let sink = Sink::default();
    let pipe = Pipe::new(Box::new(sink.clone()));
    for method in ["Runtime.evaluate", "Target.createTarget", "Browser.close", "Extensions.getStorageItems", ""] {
      let refused = pipe.call(method, &json!({}), Duration::from_millis(10)).unwrap_err();
      assert!(refused.contains("not carried by the browser pipe"), "{refused}");
      let refused = extensions_cdp(method, &json!({}), Duration::from_millis(10)).unwrap_err();
      assert!(refused.contains("not carried by the browser pipe"), "{refused}");
    }
    assert!(sink.0.lock().unwrap().is_empty());
    assert_eq!(EXTENSION_METHODS, ["Extensions.loadUnpacked", "Extensions.uninstall"]);
  }

  #[test]
  fn an_unanswered_call_says_so_and_a_closed_pipe_fails_every_waiting_call() {
    let sink = Sink::default();
    let pipe = Pipe::new(Box::new(sink.clone()));
    let said = pipe
      .call("Extensions.uninstall", &json!({ "id": "x" }), Duration::from_millis(20))
      .unwrap_err();
    assert_eq!(said, "the browser pipe did not answer Extensions.uninstall in 20 ms");
    assert!(sink.0.lock().unwrap().ends_with(b"}\0"));
    assert!(pipe.waiting.lock().unwrap().is_empty());
    let (waiter, answer) = sync_channel(1);
    pipe.waiting.lock().unwrap().insert(9, waiter);
    pipe.close();
    assert_eq!(answer.recv().unwrap(), Err("the browser pipe closed".to_string()));
    assert_eq!(
      pipe.call("Extensions.uninstall", &json!({}), Duration::from_millis(10)),
      Err("the browser pipe closed".to_string())
    );
  }

  #[test]
  fn windows_hands_chromium_its_two_pipe_handles_as_unsigned_numbers() {
    assert_eq!(io_pipes(1240, 1244), Some("1240,1244".to_string()));
    assert_eq!(io_pipes(usize::MAX, 4), None);
  }

  #[cfg(any(target_os = "linux", target_os = "macos"))]
  #[test]
  fn only_the_browser_process_reserves_the_pipe_descriptors() {
    let args = |all: &[&str]| all.iter().map(|one| one.as_bytes().to_vec()).collect::<Vec<_>>();
    assert!(!posix::is_child(args(&["orden"])));
    assert!(!posix::is_child(args(&["orden", "--url", "x"])));
    assert!(posix::is_child(args(&["orden", "--type=renderer"])));
    assert!(posix::is_child(args(&["orden", "--type=zygote", "--no-sandbox"])));
  }

  #[cfg(any(target_os = "linux", target_os = "macos"))]
  #[test]
  fn the_browser_process_holds_chromium_s_two_pipe_descriptors_from_its_first_instruction() {
    for fd in [3, 4] {
      let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
      assert!(flags >= 0 && flags & libc::FD_CLOEXEC != 0, "descriptor {fd}: {flags}");
      let mut stat: libc::stat = unsafe { std::mem::zeroed() };
      assert_eq!(unsafe { libc::fstat(fd, &mut stat) }, 0);
      assert_eq!(stat.st_mode & libc::S_IFMT, libc::S_IFIFO, "descriptor {fd}");
    }
  }

  #[test]
  fn every_way_to_ask_chromium_for_a_debugging_server_is_one_the_runtime_owns() {
    for name in ["remote-debugging-port", "remote-debugging-address", "remote-debugging-pipe", "remote-debugging-io-pipes", "remote-allow-origins"] {
      assert!(DEBUGGING_SWITCHES.contains(&name), "{name}");
    }
  }
}
