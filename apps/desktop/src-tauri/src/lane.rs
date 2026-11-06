use std::sync::mpsc::{channel, Sender};

pub fn lane<T: Send + 'static>(work: impl Fn(T) + Send + 'static) -> Sender<T> {
    let (send, taken) = channel::<T>();
    std::thread::spawn(move || taken.into_iter().for_each(work));
    send
}

#[cfg(test)]
mod tests {
    use super::lane;
    use std::sync::mpsc::channel;

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
}
