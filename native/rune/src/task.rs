use crate::backend::RUNTIME;
use crate::workspace::Workspace;
use rune::{AppHandle, Tx};
use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicBool, Ordering},
};

static HANDLE: OnceLock<AppHandle<Workspace>> = OnceLock::new();

pub fn install(handle: AppHandle<Workspace>) {
    let _ = HANDLE.set(handle);
}

pub struct Task {
    live: Arc<AtomicBool>,
    abort: Option<tokio::task::AbortHandle>,
}

impl Drop for Task {
    fn drop(&mut self) {
        self.live.store(false, Ordering::Release);
        if let Some(abort) = &self.abort {
            abort.abort();
        }
    }
}

pub fn update(f: impl FnOnce(&mut Workspace, &mut Tx) + Send + 'static) {
    match HANDLE.get() {
        Some(handle) => handle.update(f),
        None => headless::queue(Box::new(f)),
    }
}

fn deliver<T: Send + 'static>(
    live: Arc<AtomicBool>,
    value: T,
    done: impl FnOnce(&mut Workspace, T, &mut Tx) + Send + 'static,
) {
    update(move |s, tx| {
        if live.load(Ordering::Acquire) {
            done(s, value, tx);
        }
    });
}

pub fn spawn<T: Send + 'static>(
    future: impl std::future::Future<Output = T> + Send + 'static,
    done: impl FnOnce(&mut Workspace, T, &mut Tx) + Send + 'static,
) -> Task {
    let live = Arc::new(AtomicBool::new(true));
    let alive = live.clone();
    let handle = RUNTIME.spawn(async move {
        let value = future.await;
        deliver(alive, value, done);
    });
    Task {
        live,
        abort: Some(handle.abort_handle()),
    }
}

pub fn background<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
    done: impl FnOnce(&mut Workspace, T, &mut Tx) + Send + 'static,
) -> Task {
    let live = Arc::new(AtomicBool::new(true));
    let alive = live.clone();
    RUNTIME.spawn_blocking(move || {
        if !alive.load(Ordering::Acquire) {
            return;
        }
        let value = work();
        deliver(alive, value, done);
    });
    Task { live, abort: None }
}

pub fn detached(future: impl std::future::Future<Output = ()> + Send + 'static) -> Task {
    let handle = RUNTIME.spawn(future);
    Task {
        live: Arc::new(AtomicBool::new(true)),
        abort: Some(handle.abort_handle()),
    }
}

pub fn guarded<F>(future: impl FnOnce(Arc<AtomicBool>) -> F) -> Task
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    let live = Arc::new(AtomicBool::new(true));
    let handle = RUNTIME.spawn(future(live.clone()));
    Task {
        live,
        abort: Some(handle.abort_handle()),
    }
}

pub mod headless {
    use super::*;
    use std::sync::Mutex;

    type Update = Box<dyn FnOnce(&mut Workspace, &mut Tx) + Send>;
    static QUEUE: Mutex<Vec<Update>> = Mutex::new(Vec::new());

    pub(super) fn queue(update: Update) {
        QUEUE.lock().unwrap_or_else(|e| e.into_inner()).push(update);
    }

    pub fn drain() -> Vec<Update> {
        std::mem::take(&mut *QUEUE.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

#[cfg(test)]
pub mod testing {
    use super::*;
    use rune::Runtime;

    pub static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

    pub fn serial() -> std::sync::MutexGuard<'static, ()> {
        let guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        headless::drain();
        guard
    }

    pub fn runtime(state: Workspace) -> Runtime<Workspace> {
        Runtime::new(
            state,
            |_, _| rune::el(),
            (1000., 700.),
            rune::Env::new(false, 1.),
        )
    }

    pub fn view_runtime(state: Workspace, size: (f32, f32)) -> Runtime<Workspace> {
        Runtime::new(
            state,
            crate::workspace::view,
            size,
            rune::Env::new(false, 1.),
        )
    }

    pub fn deliver(rt: &mut Runtime<Workspace>) -> bool {
        let updates = headless::drain();
        let any = !updates.is_empty();
        for update in updates {
            rt.update(update);
        }
        any
    }

    pub fn run_until(rt: &mut Runtime<Workspace>, done: impl Fn(&Workspace) -> bool) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            deliver(rt);
            if done(&rt.state) {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for background work"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    pub fn run_until_idle(rt: &mut Runtime<Workspace>) {
        let mut quiet = 0;
        while quiet < 30 {
            if deliver(rt) {
                quiet = 0;
            } else {
                quiet += 1;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}
