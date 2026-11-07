mod catalog;
mod fetch;
mod sealed;

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead as _, BufReader, Write as _};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody, Request};
use tauri::{AppHandle, Manager as _, Webview};

use crate::ai_cli::family::{self, Family};
use catalog::Program;
use sealed::{private_folder, Vault};

const GRACE: Duration = Duration::from_secs(5);
const MOST_PENDING: usize = 512 * 1024 * 1024;
const MOST_LISTENERS: usize = 64;

static FETCHING: AtomicBool = AtomicBool::new(false);
static NEXT: AtomicU64 = AtomicU64::new(1);

fn held<T>(lock: &Mutex<T>) -> MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(PoisonError::into_inner)
}

pub enum Heard {
    Line(Vec<u8>),
    End(String),
}

type Out = Arc<dyn Fn(Heard) -> bool + Send + Sync>;

struct Listener {
    owner: String,
    out: Out,
    pending: Vec<u8>,
}

struct Places {
    install: PathBuf,
    live: PathBuf,
    run: PathBuf,
    config: PathBuf,
    sealed: PathBuf,
}

impl Places {
    fn under(root: &std::path::Path, program: &Program) -> Self {
        Self {
            install: root.join("program").join(program.version),
            live: root.join("live"),
            run: root.join("run"),
            config: root.join("config"),
            sealed: root.join("state.sealed"),
        }
    }
}

struct Instance {
    args: Vec<String>,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<(Child, Family)>>,
    listeners: Mutex<HashMap<String, Listener>>,
    finished: Mutex<bool>,
    ending: AtomicBool,
    places: Places,
    vault: Arc<dyn Vault>,
}

impl Instance {
    fn start(
        mut command: Command,
        args: Vec<String>,
        places: Places,
        vault: Arc<dyn Vault>,
    ) -> Result<(Arc<Self>, ChildStdout), String> {
        sealed::unseal(&places.sealed, &places.live, vault.as_ref())?;
        let _ = fs::remove_dir_all(&places.run);
        private_folder(&places.run)?;
        private_folder(&places.config)?;
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let spawned = family::spawn(&mut command);
        let (mut child, family) = match spawned {
            Ok(both) => both,
            Err(error) => {
                if sealed::seal(&places.live, &places.sealed, vault.as_ref()).is_ok() {
                    let _ = fs::remove_dir_all(&places.live);
                }
                return Err(format!("signal-cli would not start: {error}"));
            }
        };
        let stdin = child.stdin.take();
        if let Some(mut stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let _ = std::io::copy(&mut stderr, &mut std::io::sink());
            });
        }
        let stdout = child.stdout.take();
        let instance = Arc::new(Self {
            args,
            stdin: Mutex::new(stdin),
            child: Mutex::new(Some((child, family))),
            listeners: Mutex::new(HashMap::new()),
            finished: Mutex::new(false),
            ending: AtomicBool::new(false),
            places,
            vault,
        });
        let Some(stdout) = stdout else {
            instance.finish("signal-cli gave nothing to read");
            return Err("signal-cli gave nothing to read".to_owned());
        };
        Ok((instance, stdout))
    }

    fn listen(&self, owner: &str, out: Out) -> Result<String, String> {
        if self.ending.load(Ordering::SeqCst) {
            return Err("signal-cli is stopping; try again".to_owned());
        }
        let mut listeners = held(&self.listeners);
        if listeners.len() >= MOST_LISTENERS {
            return Err("too many windows are listening".to_owned());
        }
        let id = format!("s{}", NEXT.fetch_add(1, Ordering::Relaxed));
        listeners.insert(
            id.clone(),
            Listener {
                owner: owner.to_owned(),
                out,
                pending: Vec::new(),
            },
        );
        Ok(id)
    }

    fn hear(&self, line: &[u8]) {
        let outs: Vec<(String, Out)> = held(&self.listeners)
            .iter()
            .map(|(id, one)| (id.clone(), one.out.clone()))
            .collect();
        let deaf: Vec<String> = outs
            .into_iter()
            .filter(|(_, out)| !out(Heard::Line(line.to_vec())))
            .map(|(id, _)| id)
            .collect();
        if !deaf.is_empty() {
            let mut listeners = held(&self.listeners);
            for id in deaf {
                listeners.remove(&id);
            }
        }
    }

    fn write(&self, id: &str, owner: &str, bytes: &[u8]) -> Result<(), String> {
        let lines = {
            let mut listeners = held(&self.listeners);
            let one = listeners
                .get_mut(id)
                .filter(|one| one.owner == owner)
                .ok_or_else(|| "that connection is closed".to_owned())?;
            if one.pending.len() + bytes.len() > MOST_PENDING {
                one.pending.clear();
                return Err("that is too much to hand signal-cli at once".to_owned());
            }
            one.pending.extend_from_slice(bytes);
            match one.pending.iter().rposition(|byte| *byte == b'\n') {
                Some(end) => one.pending.drain(..=end).collect::<Vec<u8>>(),
                None => return Ok(()),
            }
        };
        let mut stdin = held(&self.stdin);
        let pipe = stdin
            .as_mut()
            .ok_or_else(|| "signal-cli has stopped".to_owned())?;
        pipe.write_all(&lines)
            .and_then(|()| pipe.flush())
            .map_err(|_| "signal-cli has stopped".to_owned())
    }

    fn unlisten(&self, id: &str, owner: &str) {
        let mut listeners = held(&self.listeners);
        if listeners.get(id).is_some_and(|one| one.owner == owner) {
            listeners.remove(id);
        }
    }

    fn unlisten_all(&self, owner: &str) -> bool {
        let mut listeners = held(&self.listeners);
        listeners.retain(|_, one| one.owner != owner);
        listeners.is_empty()
    }

    fn finish(&self, reason: &str) {
        self.ending.store(true, Ordering::SeqCst);
        let mut finished = held(&self.finished);
        if *finished {
            return;
        }
        *finished = true;
        drop(held(&self.stdin).take());
        if let Some((mut child, family)) = held(&self.child).take() {
            let until = Instant::now() + GRACE;
            loop {
                match child.try_wait() {
                    Ok(None) if Instant::now() < until => {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Ok(Some(_)) => break,
                    _ => {
                        family.end();
                        let _ = child.wait();
                        break;
                    }
                }
            }
        }
        if sealed::seal(&self.places.live, &self.places.sealed, self.vault.as_ref()).is_ok() {
            let _ = fs::remove_dir_all(&self.places.live);
        }
        let _ = fs::remove_dir_all(&self.places.run);
        let listeners: Vec<Listener> = held(&self.listeners).drain().map(|(_, one)| one).collect();
        for one in listeners {
            (one.out)(Heard::End(reason.to_owned()));
        }
    }
}

fn read_lines(instance: &Arc<Instance>, stdout: ChildStdout) {
    let mut reader = BufReader::new(stdout);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => instance.hear(&line),
        }
    }
}

#[derive(Default)]
pub struct Sidecars {
    running: Mutex<HashMap<&'static str, Arc<Instance>>>,
    turn: Mutex<()>,
}

impl Sidecars {
    fn gone(&self, instance: &Arc<Instance>) {
        held(&self.running).retain(|_, one| !Arc::ptr_eq(one, instance));
    }

    fn holding(&self, id: &str) -> Option<Arc<Instance>> {
        held(&self.running)
            .values()
            .find(|one| held(&one.listeners).contains_key(id))
            .cloned()
    }

    fn attached(
        &self,
        program: &str,
        args: &[String],
        owner: &str,
        out: &Out,
    ) -> Option<Result<String, String>> {
        let running = held(&self.running);
        let one = running.get(program)?;
        Some(if one.args == args {
            one.listen(owner, out.clone())
        } else {
            Err(format!("{program} is already running for another use"))
        })
    }

    fn open(
        self: &Arc<Self>,
        program: &'static Program,
        args: Vec<String>,
        owner: &str,
        out: &Out,
        make: impl FnOnce() -> Result<(Command, Places, Arc<dyn Vault>), String>,
    ) -> Result<String, String> {
        if let Some(attached) = self.attached(program.name, &args, owner, out) {
            return attached;
        }
        let turn = held(&self.turn);
        if let Some(attached) = self.attached(program.name, &args, owner, out) {
            return attached;
        }
        let (command, places, vault) = make()?;
        let (instance, stdout) = Instance::start(command, args, places, vault)?;
        let id = instance.listen(owner, out.clone())?;
        held(&self.running).insert(program.name, instance.clone());
        drop(turn);
        let sidecars = self.clone();
        std::thread::spawn(move || {
            read_lines(&instance, stdout);
            let _turn = held(&sidecars.turn);
            instance.finish("signal-cli stopped");
            sidecars.gone(&instance);
        });
        Ok(id)
    }

    fn end_if_unheard(&self, instance: &Arc<Instance>) {
        let _turn = held(&self.turn);
        if held(&instance.listeners).is_empty() {
            instance.finish("closed");
            self.gone(instance);
        }
    }

    fn close(&self, id: &str, owner: &str) {
        if let Some(instance) = self.holding(id) {
            instance.unlisten(id, owner);
            self.end_if_unheard(&instance);
        }
    }

    pub fn end_where(self: &Arc<Self>, owner: &str) {
        let unheard: Vec<Arc<Instance>> = held(&self.running)
            .values()
            .filter(|one| one.unlisten_all(owner))
            .cloned()
            .collect();
        for instance in unheard {
            let sidecars = self.clone();
            std::thread::spawn(move || sidecars.end_if_unheard(&instance));
        }
    }

    pub fn end_all(&self) {
        let _turn = held(&self.turn);
        let ended: Vec<Arc<Instance>> = held(&self.running).values().cloned().collect();
        for instance in &ended {
            instance.finish("Orden quit");
        }
        held(&self.running).clear();
    }

    fn running(&self) -> bool {
        !held(&self.running).is_empty()
    }
}

#[derive(Default)]
pub struct Held(Arc<Sidecars>);

impl Held {
    pub fn end_where(&self, owner: &str) {
        self.0.end_where(owner);
    }

    pub fn hold_exit(&self, app: &AppHandle, code: i32) -> bool {
        if !self.0.running() {
            return false;
        }
        let sidecars = self.0.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            sidecars.end_all();
            app.exit(code);
        });
        true
    }
}

struct AppVault {
    app: AppHandle,
    name: String,
}

impl Vault for AppVault {
    fn get(&self) -> Result<Option<String>, String> {
        crate::secrets::get(&self.app, &self.name)
    }

    fn set(&self, value: &str) -> Result<(), String> {
        crate::secrets::set(&self.app, &self.name, value)
    }
}

fn owner(webview: &Webview) -> Result<String, String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(label.to_owned())
    } else {
        Err("only Orden's own window may start a helper program".to_owned())
    }
}

fn known(name: &str) -> Result<&'static Program, String> {
    catalog::program(name).ok_or_else(|| format!("{name} is not a program Orden runs"))
}

fn root(app: &AppHandle, program: &Program) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("sidecars").join(program.name))
        .map_err(|error| error.to_string())
}

fn command_for(program: &Program, places: &Places, args: &[String]) -> Result<Command, String> {
    let runtime = program
        .runtime()
        .ok_or_else(|| format!("{} does not run on this computer", program.name))?;
    let mut command = Command::new(places.install.join("jre").join(runtime.java));
    let classpath = places.install.join("app").join("lib").join("*");
    command
        .arg("-Xmx512m")
        .arg("-XX:+UseSerialGC")
        .arg("--enable-native-access=ALL-UNNAMED")
        .arg("-Dfile.encoding=UTF-8")
        .arg("-Dstdout.encoding=UTF-8")
        .arg("-Dstdin.encoding=UTF-8")
        .arg(format!("-Djava.io.tmpdir={}", places.run.display()))
        .arg("-cp")
        .arg(classpath)
        .arg(program.main)
        .arg("--data-dir")
        .arg(&places.live)
        .arg("--trust-new-identities")
        .arg("always")
        .args(args)
        .env("XDG_CONFIG_HOME", &places.config)
        .env_remove("JAVA_TOOL_OPTIONS")
        .env_remove("JDK_JAVA_OPTIONS")
        .env_remove("_JAVA_OPTIONS")
        .env_remove("SIGNAL_CLI_CONFIG")
        .current_dir(&places.run);
    Ok(command)
}

#[derive(Clone, Serialize)]
pub struct Fetched {
    done: u64,
    total: u64,
}

#[tauri::command]
pub async fn sidecar_ready(app: AppHandle, program: String) -> Result<bool, String> {
    crate::lane::off_the_runtime(move || -> Result<bool, String> {
        let program = known(&program)?;
        let places = Places::under(&root(&app, program)?, program);
        Ok(program.runtime().is_some() && places.install.join("ready").is_file())
    })
    .await
}

async fn install(
    root: PathBuf,
    program: &'static Program,
    progress: &mut impl FnMut(Fetched),
) -> Result<(), String> {
    let runtime = program
        .runtime()
        .ok_or_else(|| format!("{} does not run on this computer", program.name))?;
    let downloads = root.join("downloads");
    let app_archive = downloads.join(format!("{}-app", program.version));
    let jre_archive = downloads.join(format!("{}-jre", program.version));
    let total = program.archive.size + runtime.archive.size;
    let mut done = 0;
    progress(Fetched { done, total });
    let client = fetch::client()?;
    for (pin, path) in [
        (&program.archive, &app_archive),
        (&runtime.archive, &jre_archive),
    ] {
        fetch::fetch(&client, pin, path, &mut |more| {
            done += more;
            progress(Fetched { done, total });
        })
        .await?;
    }
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        let places = Places::under(&root, program);
        let part = places.install.with_extension("part");
        let _ = fs::remove_dir_all(&part);
        let unpacked = fetch::unpack(&app_archive, program.archive.packing, &part.join("app"))
            .and_then(|()| fetch::unpack(&jre_archive, runtime.archive.packing, &part.join("jre")))
            .and_then(|()| {
                fs::write(part.join("ready"), program.version).map_err(|e| e.to_string())
            });
        let _ = fs::remove_dir_all(&downloads);
        if let Err(error) = unpacked {
            let _ = fs::remove_dir_all(&part);
            return Err(error);
        }
        let _ = fs::remove_dir_all(&places.install);
        fs::rename(&part, &places.install).map_err(|error| error.to_string())?;
        if let Ok(versions) = fs::read_dir(root.join("program")) {
            for one in versions.filter_map(Result::ok) {
                if one.file_name() != program.version {
                    let _ = fs::remove_dir_all(one.path());
                }
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn sidecar_fetch(
    webview: Webview,
    program: String,
    progress: Channel<Fetched>,
) -> Result<(), String> {
    owner(&webview)?;
    let program = known(&program)?;
    let root = root(webview.app_handle(), program)?;
    if FETCHING.swap(true, Ordering::SeqCst) {
        return Err(format!("{} is already being downloaded", program.name));
    }
    let result = install(root, program, &mut |fetched| {
        let _ = progress.send(fetched);
    })
    .await;
    FETCHING.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub async fn sidecar_open(
    webview: Webview,
    program: String,
    args: Vec<String>,
    output: Channel<InvokeResponseBody>,
) -> Result<String, String> {
    let owner = owner(&webview)?;
    let program = known(&program)?;
    program.allows(&args)?;
    let app = webview.app_handle().clone();
    let out: Out = Arc::new(move |heard| match heard {
        Heard::Line(line) => output.send(InvokeResponseBody::Raw(line)).is_ok(),
        Heard::End(reason) => {
            let said = serde_json::json!({ "end": reason }).to_string();
            output.send(InvokeResponseBody::Json(said)).is_ok()
        }
    });
    crate::lane::off_the_runtime(move || {
        let sidecars = app.state::<Held>().0.clone();
        sidecars.open(program, args.clone(), &owner, &out, || {
            let places = Places::under(&root(&app, program)?, program);
            if !places.install.join("ready").is_file() {
                return Err(format!("{} is not downloaded yet", program.name));
            }
            let command = command_for(program, &places, &args)?;
            let vault: Arc<dyn Vault> = Arc::new(AppVault {
                name: crate::secrets::filed(
                    &format!("sidecar-{}", program.name),
                    &app.config().identifier,
                )?,
                app: app.clone(),
            });
            Ok((command, places, vault))
        })
    })
    .await
}

#[derive(Deserialize)]
struct Written {
    id: String,
}

#[tauri::command]
pub async fn sidecar_write(webview: Webview, request: Request<'_>) -> Result<(), String> {
    let owner = owner(&webview)?;
    let (Written { id }, bytes) = crate::notes::raw_sent(request.headers(), request.body())?;
    let bytes = bytes.into_owned();
    let sidecars = webview.state::<Held>().0.clone();
    crate::lane::off_the_runtime(move || {
        let instance = sidecars
            .holding(&id)
            .ok_or_else(|| "that connection is closed".to_owned())?;
        instance.write(&id, &owner, &bytes)
    })
    .await
}

#[tauri::command]
pub async fn sidecar_close(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    let sidecars = webview.state::<Held>().0.clone();
    crate::lane::off_the_runtime(move || sidecars.close(&id, &owner)).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::catalog;

    #[test]
    fn only_the_programs_and_words_orden_knows_are_run() {
        assert!(catalog::program("signal-cli").is_some());
        assert!(catalog::program("sh").is_none());
        assert!(catalog::program("../signal-cli").is_none());
        let signal = catalog::program("signal-cli").unwrap();
        assert!(signal.allows(&["jsonRpc".to_owned()]).is_ok());
        assert!(signal
            .allows(&["jsonRpc".to_owned(), "--receive-mode=manual".to_owned()])
            .is_ok());
        assert!(signal.allows(&[]).is_err());
        assert!(signal
            .allows(&["jsonRpc".to_owned(), "--data-dir".to_owned()])
            .is_err());
        assert!(signal.allows(&["daemon".to_owned()]).is_err());
        assert!(signal.allows(&["-a".to_owned(), "+1".to_owned()]).is_err());
    }

    #[test]
    fn every_platform_with_a_runtime_has_a_whole_pin() {
        for program in catalog::PROGRAMS {
            assert_eq!(program.archive.sha256.len(), 64);
            assert!(program.archive.url.starts_with("https://github.com/"));
            for runtime in program.runtimes {
                assert_eq!(runtime.archive.sha256.len(), 64);
                assert!(runtime
                    .archive
                    .sha256
                    .bytes()
                    .all(|one| one.is_ascii_hexdigit()));
                assert!(runtime.archive.url.starts_with("https://github.com/"));
            }
        }
        let signal = catalog::program("signal-cli").unwrap();
        for (os, arch) in [
            ("linux", "x86_64"),
            ("macos", "x86_64"),
            ("macos", "aarch64"),
            ("windows", "x86_64"),
        ] {
            assert!(signal.runtime_on(os, arch).is_some(), "{os} {arch}");
        }
    }
}

#[cfg(all(test, unix))]
mod running {
    use super::{catalog, Heard, Out, Places, Sidecars};
    use crate::sidecar::sealed::Vault;
    use std::process::Command;
    use std::sync::mpsc::{channel, Receiver};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[derive(Default)]
    struct Kept(Mutex<Option<String>>);

    impl Vault for Kept {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, value: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.to_owned());
            Ok(())
        }
    }

    fn heard() -> (Out, Receiver<Result<String, String>>) {
        let (tell, told) = channel();
        let tell = Mutex::new(tell);
        let out: Out = Arc::new(move |heard| {
            let said = match heard {
                Heard::Line(line) => Ok(String::from_utf8_lossy(&line).into_owned()),
                Heard::End(reason) => Err(reason),
            };
            tell.lock().unwrap().send(said).is_ok()
        });
        (out, told)
    }

    fn echoing() -> Command {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("while read -r line; do echo \"heard $line\"; done");
        command
    }

    #[test]
    fn lines_go_to_every_window_and_the_last_to_leave_ends_it_and_seals_the_state() {
        let folder = tempfile::tempdir().unwrap();
        let program = catalog::program("signal-cli").unwrap();
        let places = || Places::under(folder.path(), program);
        let vault: Arc<dyn Vault> = Arc::new(Kept::default());
        let sidecars = Arc::new(Sidecars::default());
        let args = vec!["jsonRpc".to_owned()];
        let (first_out, first) = heard();
        let (second_out, second) = heard();
        let one = sidecars
            .open(program, args.clone(), "main", &first_out, || {
                Ok((echoing(), places(), vault.clone()))
            })
            .unwrap();
        let two = sidecars
            .open(program, args.clone(), "second", &second_out, || {
                panic!("a second window starts nothing new")
            })
            .unwrap();
        assert!(places().live.is_dir());
        std::fs::write(places().live.join("account.db"), b"keys").unwrap();
        let instance = sidecars.holding(&one).unwrap();
        instance.write(&one, "main", b"hel").unwrap();
        instance.write(&one, "main", b"lo\n").unwrap();
        let wait = Duration::from_secs(5);
        assert_eq!(
            first.recv_timeout(wait).unwrap(),
            Ok("heard hello\n".to_owned())
        );
        assert_eq!(
            second.recv_timeout(wait).unwrap(),
            Ok("heard hello\n".to_owned())
        );
        assert!(instance.write(&one, "second", b"x\n").is_err());
        assert!(sidecars
            .open(
                program,
                vec!["jsonRpc".to_owned(), "--ignore-stories".to_owned()],
                "main",
                &first_out,
                || { panic!("other words start nothing") }
            )
            .is_err());

        sidecars.close(&one, "main");
        assert!(places().live.is_dir());
        sidecars.close(&two, "second");
        assert!(second.recv_timeout(Duration::from_millis(200)).is_err());
        assert!(!places().live.exists());
        assert!(!places().run.exists());
        assert!(places().sealed.is_file());
        assert!(sidecars.holding(&two).is_none());

        let (again_out, again) = heard();
        let three = sidecars
            .open(program, args, "main", &again_out, || {
                Ok((echoing(), places(), vault.clone()))
            })
            .unwrap();
        assert_eq!(
            std::fs::read(places().live.join("account.db")).unwrap(),
            b"keys"
        );
        sidecars.end_where("main");
        let until = std::time::Instant::now() + wait;
        while places().live.exists() && std::time::Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!places().live.exists());
        assert!(sidecars.holding(&three).is_none());
        assert!(again.try_recv().is_err());
    }

    #[test]
    fn a_program_that_stops_by_itself_tells_its_windows_and_is_gone() {
        let folder = tempfile::tempdir().unwrap();
        let program = catalog::program("signal-cli").unwrap();
        let vault: Arc<dyn Vault> = Arc::new(Kept::default());
        let sidecars = Arc::new(Sidecars::default());
        let (out, told) = heard();
        let mut command = Command::new("sh");
        command.arg("-c").arg("echo started; exit 3");
        let id = sidecars
            .open(program, vec!["jsonRpc".to_owned()], "main", &out, || {
                Ok((command, Places::under(folder.path(), program), vault))
            })
            .unwrap();
        let wait = Duration::from_secs(5);
        assert_eq!(told.recv_timeout(wait).unwrap(), Ok("started\n".to_owned()));
        assert_eq!(
            told.recv_timeout(wait).unwrap(),
            Err("signal-cli stopped".to_owned())
        );
        assert!(sidecars.holding(&id).is_none());
        assert!(!Places::under(folder.path(), program).live.exists());
    }

    #[test]
    fn a_program_that_ignores_its_closed_input_is_ended_and_quitting_waits_for_the_seal() {
        let folder = tempfile::tempdir().unwrap();
        let program = catalog::program("signal-cli").unwrap();
        let vault: Arc<dyn Vault> = Arc::new(Kept::default());
        let sidecars = Arc::new(Sidecars::default());
        let (out, _told) = heard();
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("trap '' TERM; exec 0<&-; while true; do sleep 1; done");
        let places = Places::under(folder.path(), program);
        let sealed = places.sealed.clone();
        sidecars
            .open(program, vec!["jsonRpc".to_owned()], "main", &out, || {
                Ok((command, places, vault))
            })
            .unwrap();
        let started = std::time::Instant::now();
        sidecars.end_all();
        assert!(started.elapsed() < Duration::from_secs(15));
        assert!(sealed.is_file());
    }
}
