use std::cell::{Cell, RefCell};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

thread_local! {
    static BUILDING: Cell<u32> = const { Cell::new(0) };
    static AFTER: RefCell<Vec<Box<dyn FnOnce()>>> = const { RefCell::new(Vec::new()) };
    static HANDED: RefCell<Vec<Box<dyn FnOnce()>>> = const { RefCell::new(Vec::new()) };
}

pub fn one_at_a_time<T, E>(
    busy: impl FnOnce() -> E,
    build: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    if BUILDING.get() > 0 {
        return Err(busy());
    }
    BUILDING.set(1);
    let made = build();
    BUILDING.set(0);
    loop {
        let waiting = AFTER.with_borrow_mut(std::mem::take);
        if waiting.is_empty() {
            break;
        }
        for one in waiting {
            one();
        }
    }
    made
}

pub fn once_built(then: impl FnOnce() + 'static) {
    if BUILDING.get() > 0 {
        AFTER.with_borrow_mut(|after| after.push(Box::new(then)));
    } else {
        then();
    }
}

pub fn handed_out<P: 'static, E>(
    with_platform: impl FnOnce(Box<dyn FnOnce(P) + Send>) -> Result<(), E>,
    then: impl FnOnce(P) + Send + 'static,
) -> Result<(), E> {
    let caller = std::thread::current().id();
    let waiting = Arc::new(AtomicBool::new(true));
    let inside = Arc::clone(&waiting);
    let before = HANDED.with_borrow(Vec::len);
    let asked = with_platform(Box::new(move |platform| {
        if std::thread::current().id() == caller && inside.load(Ordering::Acquire) {
            HANDED.with_borrow_mut(|handed| handed.push(Box::new(move || then(platform))));
        } else {
            then(platform);
        }
    }));
    waiting.store(false, Ordering::Release);
    let handed =
        HANDED.with_borrow_mut(|handed| (handed.len() > before).then(|| handed.pop()).flatten());
    if let Some(handed) = handed {
        handed();
    }
    asked
}

#[derive(Debug)]
pub struct Outbox<M> {
    next: u64,
    ready: bool,
    waiting: Vec<(u64, M)>,
}

impl<M> Default for Outbox<M> {
    fn default() -> Self {
        Self {
            next: 1,
            ready: false,
            waiting: Vec::new(),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Sending<M> {
    pub id: u64,
    pub now: Option<M>,
}

impl<M> Outbox<M> {
    pub fn send(&mut self, message: M) -> Sending<M> {
        let id = self.next;
        self.next += 1;
        if self.ready {
            Sending {
                id,
                now: Some(message),
            }
        } else {
            self.waiting.push((id, message));
            Sending { id, now: None }
        }
    }

    pub fn ready(&mut self) -> Vec<(u64, M)> {
        self.ready = true;
        std::mem::take(&mut self.waiting)
    }

    pub fn gone(&mut self) -> usize {
        self.ready = false;
        std::mem::take(&mut self.waiting).len()
    }

    #[must_use]
    pub fn is_ready(&self) -> bool {
        self.ready
    }

    #[must_use]
    pub fn waiting(&self) -> usize {
        self.waiting.len()
    }
}
