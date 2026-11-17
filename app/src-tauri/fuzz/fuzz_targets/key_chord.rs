//! Key binds come from the player's actionmaps.xml and profile files, so the parser
//! must never panic, and anything it accepts must be a real key.
//!   cargo +nightly fuzz run key_chord
#![no_main]

use libfuzzer_sys::fuzz_target;

#[path = "../../src/keys.rs"]
#[allow(dead_code)]
mod keys;

fuzz_target!(|data: &[u8]| {
    let Ok(spec) = std::str::from_utf8(data) else { return };
    if let Ok(chord) = keys::chord(spec) {
        assert!(!chord.is_empty());
        for k in chord {
            assert!(k.scan > 0 && k.scan < 0x80, "scan code {:#x} from {spec:?}", k.scan);
        }
    }
});
