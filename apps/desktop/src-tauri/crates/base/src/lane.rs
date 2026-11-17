use std::sync::mpsc::{channel, Sender};

pub fn lane<T: Send + 'static>(work: impl Fn(T) + Send + 'static) -> Sender<T> {
    let (send, taken) = channel::<T>();
    std::thread::spawn(move || taken.into_iter().for_each(work));
    send
}

pub async fn off_the_runtime<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(done) => done,
        Err(error) => panic!("{error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{lane, off_the_runtime};
    use std::sync::mpsc::channel;
    use std::time::Duration;

    #[test]
    fn work_is_done_in_the_order_it_was_sent() {
        let (done, heard) = channel();
        let send = lane(move |one: u32| done.send(one).expect("the test listening"));

        for one in 0..100 {
            send.send(one).expect("the lane");
        }

        let order: Vec<u32> = heard.iter().take(100).collect();
        assert_eq!(order, (0..100).collect::<Vec<_>>());
    }

    #[test]
    fn work_waiting_off_the_runtime_leaves_its_workers_free() {
        let workers = std::thread::available_parallelism().map_or(4, usize::from);
        let (release, released) = channel::<()>();
        let released = std::sync::Arc::new(std::sync::Mutex::new(released));
        let waiting: Vec<_> = (0..workers * 4)
            .map(|_| {
                let released = released.clone();
                tauri::async_runtime::spawn(off_the_runtime(move || {
                    let _ = released.lock().expect("the channel").recv();
                }))
            })
            .collect();
        let (done, heard) = channel();
        tauri::async_runtime::spawn(async move { done.send(()) });
        assert!(heard.recv_timeout(Duration::from_secs(5)).is_ok());
        drop(release);
        for one in waiting {
            tauri::async_runtime::block_on(one).expect("the waiting work");
        }
    }
}
