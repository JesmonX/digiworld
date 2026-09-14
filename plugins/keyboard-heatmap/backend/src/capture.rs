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
    #[cfg(target_os = "macos")]
    stop_sender: Option<std::sync::mpsc::SyncSender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl CaptureHandle {
    pub fn start(engine: Arc<StatsEngine>) -> anyhow::Result<Self> {
        #[cfg(windows)]
        {
            Self::start_windows(engine)
        }
        #[cfg(target_os = "macos")]
        {
            Self::start_macos(engine)
        }
        #[cfg(not(any(windows, target_os = "macos")))]
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
        #[cfg(target_os = "macos")]
        if let Some(sender) = self.stop_sender.take() {
            let _ = sender.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn mac_key(key_code: u16) -> Option<&'static str> {
    Some(match key_code {
        0x00 => "KeyA",
        0x01 => "KeyS",
        0x02 => "KeyD",
        0x03 => "KeyF",
        0x04 => "KeyH",
        0x05 => "KeyG",
        0x06 => "KeyZ",
        0x07 => "KeyX",
        0x08 => "KeyC",
        0x09 => "KeyV",
        0x0B => "KeyB",
        0x0C => "KeyQ",
        0x0D => "KeyW",
        0x0E => "KeyE",
        0x0F => "KeyR",
        0x10 => "KeyY",
        0x11 => "KeyT",
        0x12 => "Digit1",
        0x13 => "Digit2",
        0x14 => "Digit3",
        0x15 => "Digit4",
        0x16 => "Digit6",
        0x17 => "Digit5",
        0x18 => "Equal",
        0x19 => "Digit9",
        0x1A => "Digit7",
        0x1B => "Minus",
        0x1C => "Digit8",
        0x1D => "Digit0",
        0x1E => "BracketRight",
        0x1F => "KeyO",
        0x20 => "KeyU",
        0x21 => "BracketLeft",
        0x22 => "KeyI",
        0x23 => "KeyP",
        0x24 => "Enter",
        0x25 => "KeyL",
        0x26 => "KeyJ",
        0x27 => "Quote",
        0x28 => "KeyK",
        0x29 => "Semicolon",
        0x2A => "Backslash",
        0x2B => "Comma",
        0x2C => "Slash",
        0x2D => "KeyN",
        0x2E => "KeyM",
        0x2F => "Period",
        0x30 => "Tab",
        0x31 => "Space",
        0x32 => "Backquote",
        0x33 => "Backspace",
        0x35 => "Escape",
        0x36 => "MetaRight",
        0x37 => "MetaLeft",
        0x38 => "ShiftLeft",
        0x39 => "CapsLock",
        0x3A => "AltLeft",
        0x3B => "ControlLeft",
        0x3C => "ShiftRight",
        0x3D => "AltRight",
        0x3E => "ControlRight",
        0x3F => "Fn",
        0x60 => "F5",
        0x61 => "F6",
        0x62 => "F7",
        0x63 => "F3",
        0x64 => "F8",
        0x65 => "F9",
        0x67 => "F11",
        0x6D => "F10",
        0x6F => "F12",
        0x76 => "F4",
        0x78 => "F2",
        0x7A => "F1",
        0x7B => "ArrowLeft",
        0x7C => "ArrowRight",
        0x7D => "ArrowDown",
        0x7E => "ArrowUp",
        _ => return None,
    })
}

#[cfg(target_os = "macos")]
mod macos_capture {
    use super::*;
    use core_foundation::runloop::{CFRunLoop, kCFRunLoopDefaultMode};
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
        CallbackResult, EventField,
    };
    use std::sync::{Mutex, mpsc};
    use std::time::Duration;

    impl CaptureHandle {
        pub(super) fn start_macos(engine: Arc<StatsEngine>) -> anyhow::Result<Self> {
            let (stop_sender, stop_receiver) = mpsc::sync_channel(1);
            let (ready_sender, ready_receiver) = mpsc::sync_channel::<Result<(), String>>(1);
            let thread = std::thread::Builder::new()
                .name("keyboard-event-tap".into())
                .spawn(move || {
                    let held_modifiers = Mutex::new(HashSet::new());
                    let result = CGEventTap::with_enabled(
                        CGEventTapLocation::HID,
                        CGEventTapPlacement::HeadInsertEventTap,
                        CGEventTapOptions::ListenOnly,
                        vec![CGEventType::KeyDown, CGEventType::FlagsChanged],
                        move |_proxy, event_type, event| {
                            let key_code = event
                                .get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE)
                                as u16;
                            if let Some(key) = mac_key(key_code) {
                                match event_type {
                                    CGEventType::KeyDown => {
                                        let repeated = event.get_integer_value_field(
                                            EventField::KEYBOARD_EVENT_AUTOREPEAT,
                                        ) != 0;
                                        if !repeated {
                                            engine.note_key(key);
                                        }
                                    }
                                    CGEventType::FlagsChanged => {
                                        if key == "CapsLock" {
                                            engine.note_key(key);
                                        } else if let Ok(mut held) = held_modifiers.lock() {
                                            if !held.remove(key) {
                                                held.insert(key);
                                                engine.note_key(key);
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            CallbackResult::Keep
                        },
                        || {
                            let _ = ready_sender.send(Ok(()));
                            loop {
                                if stop_receiver.try_recv().is_ok() {
                                    break;
                                }
                                unsafe {
                                    CFRunLoop::run_in_mode(
                                        kCFRunLoopDefaultMode,
                                        Duration::from_millis(250),
                                        false,
                                    );
                                }
                            }
                        },
                    );
                    if result.is_err() {
                        let _ = ready_sender.send(Err(
                            "macOS keyboard monitoring permission is required".into(),
                        ));
                    }
                })?;
            ready_receiver
                .recv()
                .map_err(|_| anyhow::anyhow!("macOS event tap startup channel closed"))?
                .map_err(anyhow::Error::msg)?;
            Ok(Self {
                stop_sender: Some(stop_sender),
                thread: Some(thread),
            })
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

    #[test]
    fn maps_macos_ansi_and_modifier_positions() {
        assert_eq!(mac_key(0x00), Some("KeyA"));
        assert_eq!(mac_key(0x24), Some("Enter"));
        assert_eq!(mac_key(0x36), Some("MetaRight"));
        assert_eq!(mac_key(0x3F), Some("Fn"));
        assert_eq!(mac_key(0x7E), Some("ArrowUp"));
        assert_eq!(mac_key(0xFF), None);
    }
}
