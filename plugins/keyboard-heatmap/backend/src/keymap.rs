#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn physical_key(scan_code: u32, extended: bool, vk_code: u32) -> Option<&'static str> {
    // Virtual-key checks handle the unusual multi-part PrintScreen/Pause sequences.
    match vk_code {
        0x2C => return Some("PrintScreen"),
        0x13 => return Some("Pause"),
        0x5B => return Some("MetaLeft"),
        0x5C => return Some("MetaRight"),
        0x5D => return Some("ContextMenu"),
        _ => {}
    }
    if extended {
        return match scan_code {
            0x1C => Some("NumpadEnter"),
            0x1D => Some("ControlRight"),
            0x35 => Some("NumpadDivide"),
            0x38 => Some("AltRight"),
            0x47 => Some("Home"),
            0x48 => Some("ArrowUp"),
            0x49 => Some("PageUp"),
            0x4B => Some("ArrowLeft"),
            0x4D => Some("ArrowRight"),
            0x4F => Some("End"),
            0x50 => Some("ArrowDown"),
            0x51 => Some("PageDown"),
            0x52 => Some("Insert"),
            0x53 => Some("Delete"),
            _ => None,
        };
    }
    match scan_code {
        0x01 => Some("Escape"),
        0x02 => Some("Digit1"),
        0x03 => Some("Digit2"),
        0x04 => Some("Digit3"),
        0x05 => Some("Digit4"),
        0x06 => Some("Digit5"),
        0x07 => Some("Digit6"),
        0x08 => Some("Digit7"),
        0x09 => Some("Digit8"),
        0x0A => Some("Digit9"),
        0x0B => Some("Digit0"),
        0x0C => Some("Minus"),
        0x0D => Some("Equal"),
        0x0E => Some("Backspace"),
        0x0F => Some("Tab"),
        0x10 => Some("KeyQ"),
        0x11 => Some("KeyW"),
        0x12 => Some("KeyE"),
        0x13 => Some("KeyR"),
        0x14 => Some("KeyT"),
        0x15 => Some("KeyY"),
        0x16 => Some("KeyU"),
        0x17 => Some("KeyI"),
        0x18 => Some("KeyO"),
        0x19 => Some("KeyP"),
        0x1A => Some("BracketLeft"),
        0x1B => Some("BracketRight"),
        0x1C => Some("Enter"),
        0x1D => Some("ControlLeft"),
        0x1E => Some("KeyA"),
        0x1F => Some("KeyS"),
        0x20 => Some("KeyD"),
        0x21 => Some("KeyF"),
        0x22 => Some("KeyG"),
        0x23 => Some("KeyH"),
        0x24 => Some("KeyJ"),
        0x25 => Some("KeyK"),
        0x26 => Some("KeyL"),
        0x27 => Some("Semicolon"),
        0x28 => Some("Quote"),
        0x29 => Some("Backquote"),
        0x2A => Some("ShiftLeft"),
        0x2B => Some("Backslash"),
        0x2C => Some("KeyZ"),
        0x2D => Some("KeyX"),
        0x2E => Some("KeyC"),
        0x2F => Some("KeyV"),
        0x30 => Some("KeyB"),
        0x31 => Some("KeyN"),
        0x32 => Some("KeyM"),
        0x33 => Some("Comma"),
        0x34 => Some("Period"),
        0x35 => Some("Slash"),
        0x36 => Some("ShiftRight"),
        0x37 => Some("NumpadMultiply"),
        0x38 => Some("AltLeft"),
        0x39 => Some("Space"),
        0x3A => Some("CapsLock"),
        0x3B => Some("F1"),
        0x3C => Some("F2"),
        0x3D => Some("F3"),
        0x3E => Some("F4"),
        0x3F => Some("F5"),
        0x40 => Some("F6"),
        0x41 => Some("F7"),
        0x42 => Some("F8"),
        0x43 => Some("F9"),
        0x44 => Some("F10"),
        0x45 => Some("NumLock"),
        0x46 => Some("ScrollLock"),
        0x47 => Some("Numpad7"),
        0x48 => Some("Numpad8"),
        0x49 => Some("Numpad9"),
        0x4A => Some("NumpadSubtract"),
        0x4B => Some("Numpad4"),
        0x4C => Some("Numpad5"),
        0x4D => Some("Numpad6"),
        0x4E => Some("NumpadAdd"),
        0x4F => Some("Numpad1"),
        0x50 => Some("Numpad2"),
        0x51 => Some("Numpad3"),
        0x52 => Some("Numpad0"),
        0x53 => Some("NumpadDecimal"),
        0x57 => Some("F11"),
        0x58 => Some("F12"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_distinct_physical_positions() {
        assert_eq!(physical_key(0x1D, false, 0xA2), Some("ControlLeft"));
        assert_eq!(physical_key(0x1D, true, 0xA3), Some("ControlRight"));
        assert_eq!(physical_key(0x1C, false, 0x0D), Some("Enter"));
        assert_eq!(physical_key(0x1C, true, 0x0D), Some("NumpadEnter"));
        assert_eq!(physical_key(0x47, false, 0x67), Some("Numpad7"));
        assert_eq!(physical_key(0x47, true, 0x24), Some("Home"));
    }
}
