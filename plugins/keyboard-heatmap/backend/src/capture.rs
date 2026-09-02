use crate::engine::StatsEngine;
use crate::keymap::physical_key;
use std::collections::HashSet;
use std::sync::Arc;

#[derive(Debug, Clone, Copy)]
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub struct RawKeyEvent {
    pub scan_code: u32,
    pub vk_code: u32,
    pub extended: bool,
    pub key_down: bool,
    pub injected: bool,
}

#[derive(Default)]
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub struct PressTracker {
    held: HashSet<&'static str>,
}

impl PressTracker {
    #[cfg_attr(not(any(windows, test)), allow(dead_code))]
    pub fn handle(&mut self, event: RawKeyEvent) -> Option<&'static str> {
        if event.injected {
            return None;
        }
        let key = physical_key(event.scan_code, event.extended, event.vk_code)?;
        if event.key_down {
            self.held.insert(key).then_some(key)
        } else {
            self.held.remove(key);
            None
        }
    }
}

pub struct CaptureHandle {
    #[cfg(windows)]
    thread_id: u32,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl CaptureHandle {
    pub fn start(engine: Arc<StatsEngine>) -> anyhow::Result<Self> {
        #[cfg(windows)]
        {
            Self::start_windows(engine)
        }
        #[cfg(not(windows))]
        {
            let thread = std::thread::Builder::new()
                .name("keyboard-capture-placeholder".into())
                .spawn(move || {
                    tracing::info!("global keyboard capture is available only on Windows");
                    drop(engine);
                })?;
            Ok(Self {
                thread: Some(thread),
            })
        }
    }

    pub fn stop(mut self) {
        #[cfg(windows)]
        unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
            let _ = PostThreadMessageW(
                self.thread_id,
                WM_QUIT,
                Default::default(),
                Default::default(),
            );
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(windows)]
mod windows_capture {
    use super::*;
    use std::sync::{Mutex, OnceLock, mpsc};
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, KBDLLHOOKSTRUCT, LLKHF_EXTENDED,
        LLKHF_INJECTED, LLKHF_UP, MSG, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx,
        WH_KEYBOARD_LL,
    };

    static SENDER: OnceLock<Mutex<Option<mpsc::SyncSender<RawKeyEvent>>>> = OnceLock::new();

    unsafe extern "system" fn hook_callback(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let raw = RawKeyEvent {
                scan_code: event.scanCode,
                vk_code: event.vkCode,
                extended: event.flags.contains(LLKHF_EXTENDED),
                key_down: !event.flags.contains(LLKHF_UP),
                injected: event.flags.contains(LLKHF_INJECTED),
            };
            if let Some(sender) = SENDER
                .get()
                .and_then(|slot| slot.lock().ok())
                .and_then(|slot| slot.clone())
            {
                let _ = sender.try_send(raw);
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    impl CaptureHandle {
        pub(super) fn start_windows(engine: Arc<StatsEngine>) -> anyhow::Result<Self> {
            let (sender, receiver) = mpsc::sync_channel::<RawKeyEvent>(4096);
            *SENDER
                .get_or_init(|| Mutex::new(None))
                .lock()
                .expect("hook sender lock") = Some(sender);
            let (ready_tx, ready_rx) = mpsc::sync_channel(1);
            let thread = std::thread::Builder::new()
                .name("keyboard-hook".into())
                .spawn(move || {
                    let thread_id = unsafe { GetCurrentThreadId() };
                    let hook = match unsafe {
                        SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_callback), None, 0)
                    } {
                        Ok(hook) => hook,
                        Err(error) => {
                            let _ = ready_tx.send(Err(anyhow::anyhow!(error)));
                            return;
                        }
                    };
                    let _ = ready_tx.send(Ok(thread_id));

                    let processor_engine = engine.clone();
                    let processor = std::thread::Builder::new()
                        .name("keyboard-counter".into())
                        .spawn(move || {
                            let mut tracker = PressTracker::default();
                            while let Ok(event) = receiver.recv() {
                                if let Some(key) = tracker.handle(event) {
                                    processor_engine.note_key(key);
                                }
                            }
                        })
                        .expect("spawn keyboard counter");

                    let mut message = MSG::default();
                    while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
                        let _ = unsafe { TranslateMessage(&message) };
                        unsafe {
                            DispatchMessageW(&message);
                        }
                    }
                    let _ = unsafe { UnhookWindowsHookEx(hook) };
                    if let Some(slot) = SENDER.get() {
                        *slot.lock().expect("hook sender lock") = None;
                    }
                    let _ = processor.join();
                })?;
            let thread_id = ready_rx
                .recv()
                .map_err(|_| anyhow::anyhow!("keyboard hook startup channel closed"))??;
            Ok(Self {
                thread_id,
                thread: Some(thread),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(down: bool, injected: bool) -> RawKeyEvent {
        RawKeyEvent {
            scan_code: 0x1E,
            vk_code: 0x41,
            extended: false,
            key_down: down,
            injected,
        }
    }

    #[test]
    fn counts_one_physical_press_and_ignores_injected_events() {
        let mut tracker = PressTracker::default();
        assert_eq!(tracker.handle(event(true, false)), Some("KeyA"));
        assert_eq!(tracker.handle(event(true, false)), None);
        assert_eq!(tracker.handle(event(false, false)), None);
        assert_eq!(tracker.handle(event(true, false)), Some("KeyA"));
        assert_eq!(tracker.handle(event(false, false)), None);
        assert_eq!(tracker.handle(event(true, true)), None);
    }
}
