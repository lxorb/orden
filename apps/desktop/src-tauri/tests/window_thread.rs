#![cfg(all(windows, not(feature = "cef")))]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[test]
#[ignore = "makes a real window and runs its event loop on this thread, so it runs alone"]
fn noting_every_window_from_a_command_while_one_moves_never_stops_the_window_s_thread() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = nib_lib::window_thread::managed(tauri::Builder::<tauri::Wry>::new().any_thread())
        .build(context)
        .expect("an app");
    let window = tauri::window::WindowBuilder::new(&app, "moving")
        .inner_size(320.0, 240.0)
        .position(40.0, 40.0)
        .focused(false)
        .build()
        .expect("a window");
    let done = Arc::new(AtomicBool::new(false));

    let moving = done.clone();
    std::thread::spawn(move || {
        let mut at = 0_u32;
        while !moving.load(Ordering::Relaxed) {
            at = (at + 7) % 200;
            let _ = window.set_position(tauri::LogicalPosition::new(40.0 + f64::from(at), 40.0));
        }
    });

    let handle = app.handle().clone();
    let noted = done.clone();
    let noting = std::thread::spawn(move || {
        let until = Instant::now() + Duration::from_secs(5);
        let mut rounds = 0_u32;
        while Instant::now() < until {
            nib_lib::window_thread::note_every_window(&handle);
            rounds += 1;
        }
        noted.store(true, Ordering::Relaxed);
        handle.exit(0);
        rounds
    });

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(60));
        if !done.load(Ordering::Relaxed) {
            eprintln!("the window's thread and a command noting every window wait on each other");
            std::process::exit(101);
        }
    });

    app.run_return(|_, _| {});
    let rounds = noting.join().expect("the noting thread");
    assert!(
        rounds > 20,
        "only {rounds} rounds of noting every window in 5 s"
    );
}
