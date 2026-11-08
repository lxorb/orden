#![cfg(all(windows, not(feature = "cef")))]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const NOTING: Duration = Duration::from_secs(5);

const STUCK: Duration = Duration::from_secs(30);

#[test]
#[ignore = "makes a real window and runs its event loop on this thread, so it runs alone"]
fn noting_every_window_from_a_command_while_one_moves_never_stops_the_window_s_thread() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = orden_lib::window_thread::managed(tauri::Builder::<tauri::Wry>::new().any_thread())
        .build(context)
        .expect("an app");
    let window = tauri::window::WindowBuilder::new(&app, "moving")
        .inner_size(320.0, 240.0)
        .position(40.0, 40.0)
        .focused(false)
        .build()
        .expect("a window");
    let done = Arc::new(AtomicBool::new(false));
    let moves = Arc::new(AtomicU64::new(0));
    let rounds = Arc::new(AtomicU64::new(0));

    let moving = done.clone();
    let moved = moves.clone();
    std::thread::spawn(move || {
        let mut at = 0_u32;
        while !moving.load(Ordering::Relaxed) {
            at = (at + 7) % 200;
            let _ = window.set_position(tauri::LogicalPosition::new(40.0 + f64::from(at), 40.0));
            let _ = window.outer_position();
            moved.fetch_add(1, Ordering::Relaxed);
        }
    });

    let handle = app.handle().clone();
    let noted = done.clone();
    let counted = rounds.clone();
    let noting = std::thread::spawn(move || {
        let until = Instant::now() + NOTING;
        while Instant::now() < until {
            orden_lib::window_thread::note_every_window(&handle);
            counted.fetch_add(1, Ordering::Relaxed);
        }
        noted.store(true, Ordering::Relaxed);
        handle.exit(0);
    });

    let watched = done.clone();
    let seen = rounds.clone();
    std::thread::spawn(move || {
        let mut last = (seen.load(Ordering::Relaxed), Instant::now());
        while !watched.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(100));
            let now = seen.load(Ordering::Relaxed);
            if now != last.0 {
                last = (now, Instant::now());
            } else if last.1.elapsed() > STUCK {
                eprintln!(
                    "the window's thread and a command noting every window wait on each other"
                );
                std::process::exit(101);
            }
        }
    });

    app.run_return(|_, _| {});
    noting.join().expect("the noting thread");
    let rounds = rounds.load(Ordering::Relaxed);
    let moves = moves.load(Ordering::Relaxed);
    println!("{rounds} rounds of noting every window while the window moved {moves} times");
    assert!(rounds > 0 && moves > 0, "{rounds} rounds, {moves} moves");
}
