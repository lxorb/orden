use orden_base::Held as _;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use btleplug::api::{
    bleuuid::uuid_from_u16, Central as _, CentralState, Manager as _, Peripheral as _, ScanFilter,
    ValueNotification,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures_util::{Stream, StreamExt as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter as _};
use uuid::Uuid;

type Notes = Pin<Box<dyn Stream<Item = ValueNotification> + Send>>;
const SCAN: Duration = Duration::from_secs(5);
const RETRY: Duration = Duration::from_secs(10);
const OFF: &str = "Bluetooth is off. Turn it on to connect the watch.";
const DENIED: &str =
    "Orden may not use Bluetooth. Allow it in the system settings, then try again.";
const NO_ADAPTER: &str = "This computer has no Bluetooth adapter Orden can use.";
const GONE: &str = "That watch is not broadcasting its heart rate now.";
const NO_RATE: &str = "The watch offers no heart rate.";
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Found {
    id: String,
    name: Option<String>,
    rssi: Option<i16>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct Beat {
    bpm: u16,
    at: u64,
    rr: Option<Vec<u16>>,
}
#[derive(Debug, Clone, Serialize)]
struct State {
    state: &'static str,
    id: String,
}
static ADAPTER: Mutex<Option<(Manager, Adapter)>> = Mutex::new(None);
static SEEN: Mutex<Vec<(String, Peripheral)>> = Mutex::new(Vec::new());
static LINKED: Mutex<Option<(String, Peripheral)>> = Mutex::new(None);
static TURN: AtomicU64 = AtomicU64::new(0);
fn service() -> Uuid {
    uuid_from_u16(0x180D)
}
fn rate() -> Uuid {
    uuid_from_u16(0x2A37)
}
pub(crate) fn measurement(bytes: &[u8]) -> Option<(u16, Option<Vec<u16>>)> {
    let flags = *bytes.first()?;
    let (bpm, mut at) = if flags & 0x01 == 0 {
        (u16::from(*bytes.get(1)?), 2)
    } else {
        (u16::from_le_bytes([*bytes.get(1)?, *bytes.get(2)?]), 3)
    };
    if flags & 0x08 != 0 {
        at += 2;
    }
    let rr = (flags & 0x10 != 0)
        .then(|| {
            bytes
                .get(at..)
                .unwrap_or_default()
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| {
                    let raw = u32::from(u16::from_le_bytes(*pair));
                    u16::try_from((raw * 1000 + 512) / 1024).unwrap_or(u16::MAX)
                })
                .collect::<Vec<u16>>()
        })
        .filter(|one| !one.is_empty());
    Some((bpm, rr))
}
fn said(error: btleplug::Error) -> String {
    match error {
        btleplug::Error::PermissionDenied => DENIED.to_owned(),
        other => format!("Bluetooth: {other}"),
    }
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |one| u64::try_from(one.as_millis()).unwrap_or(u64::MAX))
}
async fn adapter() -> Result<Adapter, String> {
    let known = ADAPTER.held().as_ref().map(|(_, adapter)| adapter.clone());
    let adapter = if let Some(adapter) = known {
        adapter
    } else {
        let manager = Manager::new().await.map_err(said)?;
        let adapter = manager
            .adapters()
            .await
            .map_err(said)?
            .into_iter()
            .next()
            .ok_or_else(|| NO_ADAPTER.to_owned())?;
        *ADAPTER.held() = Some((manager, adapter.clone()));
        adapter
    };
    match adapter.adapter_state().await {
        Ok(CentralState::PoweredOff) => Err(OFF.to_owned()),
        _ => Ok(adapter),
    }
}
fn radio() -> &'static tokio::runtime::Handle {
    static RADIO: OnceLock<tokio::runtime::Handle> = OnceLock::new();
    RADIO.get_or_init(|| {
        let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
            return tokio::runtime::Handle::current();
        };
        let handle = runtime.handle().clone();
        let _ = std::thread::Builder::new().name("orden-bluetooth".into()).spawn(move || {
            #[cfg(windows)]
            #[allow(unsafe_code)]
            let _ = unsafe {
                windows::Win32::System::Com::CoInitializeEx(
                    None,
                    windows::Win32::System::Com::COINIT_MULTITHREADED,
                )
            };
            runtime.block_on(std::future::pending::<()>());
        });
        handle
    })
}
async fn on_radio<T: Send + 'static>(
    work: impl std::future::Future<Output = Result<T, String>> + Send + 'static,
) -> Result<T, String> {
    radio().spawn(work).await.map_err(|_| "Bluetooth stopped unexpectedly.".to_owned())?
}
#[tauri::command]
pub async fn hr_devices() -> Result<Vec<Found>, String> {
    on_radio(scan()).await
}
async fn scan() -> Result<Vec<Found>, String> {
    let adapter = adapter().await?;
    adapter.start_scan(ScanFilter { services: vec![service()] }).await.map_err(said)?;
    tokio::time::sleep(SCAN).await;
    let _ = adapter.stop_scan().await;
    let mut found = Vec::new();
    let mut kept = Vec::new();
    for one in adapter.peripherals().await.map_err(said)? {
        let Ok(Some(about)) = one.properties().await else {
            continue;
        };
        if !about.services.contains(&service()) {
            continue;
        }
        let id = one.id().to_string();
        found.push(Found { id: id.clone(), name: about.local_name, rssi: about.rssi });
        kept.push((id, one));
    }
    found.sort_by_key(|one| std::cmp::Reverse(one.rssi.unwrap_or(i16::MIN)));
    *SEEN.held() = kept;
    Ok(found)
}
fn seen(id: &str) -> Option<Peripheral> {
    SEEN.held().iter().find(|(one, _)| one == id).map(|(_, peripheral)| peripheral.clone())
}
async fn linked(peripheral: &Peripheral) -> Result<Notes, String> {
    if !peripheral.is_connected().await.unwrap_or(false) {
        peripheral.connect().await.map_err(said)?;
    }
    peripheral.discover_services().await.map_err(said)?;
    let measured = peripheral
        .characteristics()
        .into_iter()
        .find(|one| one.uuid == rate())
        .ok_or_else(|| NO_RATE.to_owned())?;
    peripheral.subscribe(&measured).await.map_err(said)?;
    peripheral.notifications().await.map_err(said)
}
fn tell(app: &AppHandle<orden_base::Engine>, state: &'static str, id: &str) {
    let _ = app.emit("orden://heart-state", State { state, id: id.to_owned() });
}
async fn follow(
    app: AppHandle<orden_base::Engine>,
    id: String,
    peripheral: Peripheral,
    mut notes: Notes,
    turn: u64,
) {
    let current = || TURN.load(Ordering::SeqCst) == turn;
    loop {
        while current() {
            match tokio::time::timeout(RETRY, notes.next()).await {
                Ok(Some(note)) => {
                    if note.uuid != rate() {
                        continue;
                    }
                    if let Some((bpm, rr)) = measurement(&note.value) {
                        let _ = app.emit("orden://heart", Beat { bpm, at: now(), rr });
                    }
                }
                Ok(None) => break,
                Err(_) => {
                    if !peripheral.is_connected().await.unwrap_or(false) {
                        break;
                    }
                }
            }
        }
        if !current() {
            return;
        }
        tell(&app, "reconnecting", &id);
        loop {
            tokio::time::sleep(RETRY).await;
            if !current() {
                return;
            }
            if let Ok(next) = linked(&peripheral).await {
                notes = next;
                tell(&app, "connected", &id);
                break;
            }
        }
    }
}
#[tauri::command]
pub async fn hr_connect(app: AppHandle<orden_base::Engine>, id: String) -> Result<(), String> {
    on_radio(connect(app, id)).await
}
async fn connect(app: AppHandle<orden_base::Engine>, id: String) -> Result<(), String> {
    let turn = TURN.fetch_add(1, Ordering::SeqCst) + 1;
    let was = LINKED.held().take();
    if let Some((_, peripheral)) = was {
        let _ = peripheral.disconnect().await;
    }
    let peripheral = if let Some(one) = seen(&id) {
        one
    } else {
        scan().await?;
        seen(&id).ok_or_else(|| GONE.to_owned())?
    };
    let notes = linked(&peripheral).await?;
    if TURN.load(Ordering::SeqCst) != turn {
        let _ = peripheral.disconnect().await;
        return Ok(());
    }
    *LINKED.held() = Some((id.clone(), peripheral.clone()));
    tell(&app, "connected", &id);
    tokio::spawn(follow(app, id, peripheral, notes, turn));
    Ok(())
}
#[tauri::command]
pub async fn hr_disconnect(app: AppHandle<orden_base::Engine>) {
    let _ = on_radio(async move {
        disconnect(app).await;
        Ok(())
    })
    .await;
}
async fn disconnect(app: AppHandle<orden_base::Engine>) {
    TURN.fetch_add(1, Ordering::SeqCst);
    let was = LINKED.held().take();
    if let Some((id, peripheral)) = was {
        let _ = peripheral.disconnect().await;
        tell(&app, "stopped", &id);
    }
}
#[cfg(test)]
mod tests {
    use super::measurement;

    #[test]
    fn a_heart_rate_is_read_in_either_width_with_its_rr_intervals_in_milliseconds() {
        assert_eq!(measurement(&[0x00, 72]), Some((72, None)));
        assert_eq!(measurement(&[0x01, 0x2C, 0x01]), Some((300, None)));
        assert_eq!(measurement(&[0x16, 60, 0x00, 0x04]), Some((60, Some(vec![1000]))));
        assert_eq!(
            measurement(&[0x18, 61, 0x10, 0x00, 0x00, 0x04, 0x00, 0x02]),
            Some((61, Some(vec![1000, 500])))
        );
        assert_eq!(measurement(&[0x10, 58]), Some((58, None)));
        assert_eq!(measurement(&[0x11, 0x50, 0x00, 0x33, 0x03]), Some((80, Some(vec![800]))));
        assert_eq!(measurement(&[0x01, 5]), None);
        assert_eq!(measurement(&[]), None);
    }
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn a_scan_lists_heart_rate_broadcasters_or_says_why_it_cannot() {
        let runtime =
            tokio::runtime::Builder::new_current_thread().enable_all().build().expect("a runtime");
        let said = runtime
            .block_on(async {
                tokio::time::timeout(std::time::Duration::from_secs(30), super::hr_devices()).await
            })
            .expect("the scan ended");
        match said {
            Ok(found) => assert!(found.iter().all(|one| !one.id.is_empty())),
            Err(why) => assert!(!why.trim().is_empty()),
        }
    }
    #[test]
    fn a_mac_is_told_why_orden_asks_for_bluetooth() {
        let plist = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Info.plist"),
        )
        .expect("the Info.plist");
        assert!(plist.contains("<key>NSBluetoothAlwaysUsageDescription</key>"));
        assert!(plist.contains("heart rate"));
    }
}
