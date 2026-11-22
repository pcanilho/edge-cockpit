//! Star Citizen key names ("ralt+n", "np_5", "f1") to keyboard scan codes.
//! Scan codes are layout independent, which is what the game reads.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Key {
    pub scan: u16,
    /// Extended keys (right Ctrl/Alt, arrows, the navigation block) need KEYEVENTF_EXTENDEDKEY.
    pub extended: bool,
}

const fn k(scan: u16) -> Key {
    Key {
        scan,
        extended: false,
    }
}
const fn x(scan: u16) -> Key {
    Key {
        scan,
        extended: true,
    }
}

/// One Star Citizen key name.
pub fn key(name: &str) -> Option<Key> {
    let n = name.trim().to_ascii_lowercase();
    if let Some(f) = n.strip_prefix('f').and_then(|d| d.parse::<u16>().ok()) {
        return match f {
            1..=10 => Some(k(0x3a + f)),
            11 => Some(k(0x57)),
            12 => Some(k(0x58)),
            13..=23 => Some(k(0x64 + f - 13)),
            24 => Some(k(0x76)),
            _ => None,
        };
    }
    let key = match n.as_str() {
        "escape" => k(0x01),
        "1" => k(0x02),
        "2" => k(0x03),
        "3" => k(0x04),
        "4" => k(0x05),
        "5" => k(0x06),
        "6" => k(0x07),
        "7" => k(0x08),
        "8" => k(0x09),
        "9" => k(0x0a),
        "0" => k(0x0b),
        "minus" => k(0x0c),
        "equals" => k(0x0d),
        "backspace" => k(0x0e),
        "tab" => k(0x0f),
        "q" => k(0x10),
        "w" => k(0x11),
        "e" => k(0x12),
        "r" => k(0x13),
        "t" => k(0x14),
        "y" => k(0x15),
        "u" => k(0x16),
        "i" => k(0x17),
        "o" => k(0x18),
        "p" => k(0x19),
        "lbracket" => k(0x1a),
        "rbracket" => k(0x1b),
        "enter" => k(0x1c),
        "lctrl" => k(0x1d),
        "a" => k(0x1e),
        "s" => k(0x1f),
        "d" => k(0x20),
        "f" => k(0x21),
        "g" => k(0x22),
        "h" => k(0x23),
        "j" => k(0x24),
        "k" => k(0x25),
        "l" => k(0x26),
        "semicolon" => k(0x27),
        "apostrophe" => k(0x28),
        "grave" => k(0x29),
        "lshift" => k(0x2a),
        "backslash" => k(0x2b),
        "z" => k(0x2c),
        "x" => k(0x2d),
        "c" => k(0x2e),
        "v" => k(0x2f),
        "b" => k(0x30),
        "n" => k(0x31),
        "m" => k(0x32),
        "comma" => k(0x33),
        "period" => k(0x34),
        "slash" => k(0x35),
        "rshift" => k(0x36),
        "np_multiply" => k(0x37),
        "lalt" => k(0x38),
        "space" => k(0x39),
        "capslock" => k(0x3a),
        "numlock" => k(0x45),
        "scrolllock" => k(0x46),
        "np_7" => k(0x47),
        "np_8" => k(0x48),
        "np_9" => k(0x49),
        "np_subtract" => k(0x4a),
        "np_4" => k(0x4b),
        "np_5" => k(0x4c),
        "np_6" => k(0x4d),
        "np_add" => k(0x4e),
        "np_1" => k(0x4f),
        "np_2" => k(0x50),
        "np_3" => k(0x51),
        "np_0" => k(0x52),
        "np_period" => k(0x53),
        "np_enter" => x(0x1c),
        "rctrl" => x(0x1d),
        "np_divide" => x(0x35),
        "print" => x(0x37),
        "ralt" => x(0x38),
        "pause" => k(0x45),
        "home" => x(0x47),
        "up" => x(0x48),
        "pgup" => x(0x49),
        "left" => x(0x4b),
        "right" => x(0x4d),
        "end" => x(0x4f),
        "down" => x(0x50),
        "pgdn" => x(0x51),
        "insert" => x(0x52),
        "delete" => x(0x53),
        _ => return None,
    };
    Some(key)
}

/// A whole bind, "rctrl+rshift+f1", in press order: modifiers first, the key last.
pub fn chord(spec: &str) -> Result<Vec<Key>, String> {
    let spec = spec.trim().trim_start_matches("kb1_");
    if spec.is_empty() {
        return Err("empty key".into());
    }
    spec.split('+')
        .map(|p| key(p).ok_or_else(|| format!("unknown key '{p}' in '{spec}'")))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_and_function_keys() {
        assert_eq!(key("n"), Some(k(0x31)));
        assert_eq!(key("F1"), Some(k(0x3b)));
        assert_eq!(key("f10"), Some(k(0x44)));
        assert_eq!(key("f12"), Some(k(0x58)));
        assert_eq!(key("f13"), Some(k(0x64)));
    }

    #[test]
    fn right_hand_modifiers_are_extended() {
        assert_eq!(chord("ralt+n").unwrap(), vec![x(0x38), k(0x31)]);
        assert_eq!(
            chord("kb1_rctrl+rshift+f1").unwrap(),
            vec![x(0x1d), k(0x36), k(0x3b)]
        );
        assert!(!key("rshift").unwrap().extended);
    }

    #[test]
    fn every_layout_key_is_known() {
        let layout = include_str!("../../../layouts/star-citizen.json");
        let v: serde_json::Value = serde_json::from_str(layout).unwrap();
        let mut stack = vec![&v];
        let mut seen = 0;
        while let Some(o) = stack.pop() {
            match o {
                serde_json::Value::Object(m) => {
                    if let Some(serde_json::Value::String(s)) = m.get("defaultKey") {
                        chord(s).unwrap();
                        seen += 1;
                    }
                    stack.extend(m.values());
                }
                serde_json::Value::Array(a) => stack.extend(a.iter()),
                _ => {}
            }
        }
        assert!(seen > 100);
    }

    #[test]
    fn rejects_unknown() {
        assert!(chord("mouse1").is_err());
        assert!(chord("").is_err());
    }
}
