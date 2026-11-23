//! Our keybind file, cut to what the player hasn't bound.
//!
//! The game keeps one Keyboard/Mouse slot per action, so a profile entry replaces whatever
//! key or mouse button the player put there. The file we put in Control Profiles only
//! carries actions the player has no keyboard key for, and keeps their mouse buttons.

use std::collections::HashMap;

/// (actionmap, action)
type Slot = (String, String);

/// The binds in a binds file: keyboard and mouse inputs per (actionmap, action).
#[derive(Default)]
struct Binds {
    kb: HashMap<Slot, String>,
    mouse: HashMap<Slot, String>,
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("{name}=\"");
    let at = tag.match_indices(&key).find(|(i, _)| *i == 0 || tag.as_bytes()[i - 1].is_ascii_whitespace())?.0 + key.len();
    let rest = &tag[at..];
    Some(&rest[..rest.find('"')?])
}

/// The input after a device prefix: "kb1_lalt+f1" with "kb" is "lalt+f1".
fn input<'a>(s: &'a str, device: &str) -> Option<&'a str> {
    let rest = s.strip_prefix(device)?;
    let (n, k) = rest.split_once('_')?;
    n.chars().all(|c| c.is_ascii_digit()).then(|| k.trim())
}

fn read(xml: &str) -> Binds {
    let mut b = Binds::default();
    let (mut map, mut action) = (String::new(), String::new());
    for tag in xml.split('<').skip(1).map(|t| t.split('>').next().unwrap_or("")) {
        let name = || attr(tag, "name").unwrap_or("").to_string();
        if tag.starts_with("actionmap ") {
            map = name();
        } else if tag.starts_with("action ") {
            action = name();
        } else if tag.starts_with("rebind ") {
            let Some(i) = attr(tag, "input") else { continue };
            let slot = (map.clone(), action.clone());
            if let Some(k) = input(i, "kb") {
                b.kb.insert(slot, k.to_string());
            } else if let Some(m) = input(i, "mo").filter(|m| !m.is_empty()) {
                b.mouse.insert(slot, m.to_string());
            }
        }
    }
    b
}

fn is_mouse(input: &str) -> bool {
    ["mouse", "mwheel", "maxis"].iter().any(|m| input.contains(m))
}

/// What our file does with one action, given the player's binds: None drops it (the player
/// has a keyboard key for it); otherwise the mouse input to put on the mouse device, if any.
fn plan(slot: &Slot, ours: &Binds, theirs: &Binds) -> Option<Option<String>> {
    let their_kb = theirs.kb.get(slot).map(String::as_str).unwrap_or("");
    if !their_kb.is_empty() && !is_mouse(their_kb) {
        return None;
    }
    if theirs.mouse.contains_key(slot) {
        return Some(None);
    }
    // Their own mouse button from the Keyboard/Mouse slot, or the game's default one.
    Some(if is_mouse(their_kb) { Some(their_kb.to_string()) } else { ours.mouse.get(slot).cloned() })
}

/// `ours` (our generated binds file) cut to the player's `actionmaps` (see the module doc).
/// Without an actionmaps.xml the player has the defaults, which our file was made for.
pub fn tailor(ours: &str, actionmaps: Option<&str>) -> String {
    let Some(xml) = actionmaps else { return ours.to_string() };
    let (mine, theirs) = (read(ours), read(xml));
    let mut out: Vec<String> = Vec::new();
    let mut map = String::new();
    let mut section: Vec<String> = Vec::new();
    let mut block: Vec<String> = Vec::new();
    for line in ours.lines() {
        let t = line.trim();
        if t.starts_with("<actionmap ") {
            map = attr(t, "name").unwrap_or("").to_string();
            section = vec![line.to_string()];
        } else if t == "</actionmap>" {
            if section.iter().any(|l| l.trim().starts_with("<action ")) {
                out.append(&mut section);
                out.push(line.to_string());
            }
            section.clear();
            map.clear();
        } else if map.is_empty() {
            out.push(line.to_string());
        } else if t != "</action>" {
            block.push(line.to_string());
        } else {
            let action = block.iter().find(|l| l.trim().starts_with("<action ")).and_then(|l| attr(l.trim(), "name")).unwrap_or("").to_string();
            if let Some(button) = plan(&(map.clone(), action), &mine, &theirs) {
                for l in block.drain(..).filter(|l| !l.trim().starts_with("<rebind input=\"mo")) {
                    let kb = l.trim().starts_with("<rebind input=\"kb");
                    let indent = l[..l.len() - l.trim_start().len()].to_string();
                    section.push(l);
                    if let (true, Some(b)) = (kb, &button) {
                        section.push(format!("{indent}<rebind input=\"mo1_{b}\"/>"));
                    }
                }
                section.push(line.to_string());
            }
            block.clear();
        }
    }
    out.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    const OURS: &str = r#"<ActionMaps version="1" profileName="edge-cockpit">
 <CustomisationUIHeader label="edge-cockpit">
  <devices>
   <keyboard instance="1"/>
   <mouse instance="1"/>
  </devices>
 </CustomisationUIHeader>
 <modifiers/>
 <actionmap name="spaceship_general">
  <!-- Open doors -->
  <action name="v_open_all_doors">
   <rebind input="kb1_rctrl+rshift+f4"/>
  </action>
  <!-- Close doors -->
  <action name="v_close_all_doors">
   <rebind input="kb1_rshift+f1"/>
  </action>
 </actionmap>
 <actionmap name="spaceship_quantum">
  <!-- Quantum -->
  <action name="v_toggle_qdrive_engagement">
   <rebind input="kb1_rctrl+f6"/>
   <rebind input="mo1_mouse1"/>
  </action>
 </actionmap>
</ActionMaps>"#;

    fn player(body: &str) -> String {
        format!(r#"<ActionMaps><ActionProfiles version="1" profileName="default">{body}</ActionProfiles></ActionMaps>"#)
    }

    #[test]
    fn without_actionmaps_the_file_is_unchanged() {
        assert_eq!(tailor(OURS, None), OURS);
    }

    #[test]
    fn nothing_bound_keeps_every_action() {
        let t = tailor(OURS, Some(&player("")));
        assert_eq!(t.trim_end(), OURS);
    }

    #[test]
    fn a_key_of_theirs_stays_and_its_actionmap_goes_when_empty() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="spaceship_general"><action name="v_open_all_doors"><rebind input="kb1_o"/></action></actionmap>
          <actionmap name="spaceship_quantum"><action name="v_toggle_qdrive_engagement"><rebind input="kb1_b"/></action></actionmap>"#)));
        assert!(!t.contains("v_open_all_doors") && !t.contains("spaceship_quantum"), "{t}");
        assert!(t.contains(r#"<action name="v_close_all_doors">"#), "{t}");
        assert!(t.contains(r#"<rebind input="kb1_rshift+f1"/>"#), "{t}");
    }

    #[test]
    fn the_same_action_in_another_actionmap_is_not_theirs() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="vehicle_general"><action name="v_open_all_doors"><rebind input="kb1_o"/></action></actionmap>"#)));
        assert!(t.contains("v_open_all_doors"), "{t}");
    }

    #[test]
    fn their_mouse_button_moves_to_the_mouse() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="spaceship_general"><action name="v_close_all_doors"><rebind input="kb1_mouse4"/></action></actionmap>
          <actionmap name="spaceship_quantum"><action name="v_toggle_qdrive_engagement"><rebind input="kb1_lalt+mouse2"/></action></actionmap>"#)));
        assert!(t.contains("<rebind input=\"kb1_rshift+f1\"/>\n   <rebind input=\"mo1_mouse4\"/>"), "{t}");
        assert!(t.contains("<rebind input=\"kb1_rctrl+f6\"/>\n   <rebind input=\"mo1_lalt+mouse2\"/>"), "{t}");
        assert!(!t.contains("mo1_mouse1"), "{t}");
    }

    #[test]
    fn a_cleared_slot_still_gets_our_key() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="spaceship_general"><action name="v_open_all_doors"><rebind input="kb1_ "/></action></actionmap>"#)));
        assert!(t.contains("<rebind input=\"kb1_rctrl+rshift+f4\"/>"), "{t}");
    }

    #[test]
    fn their_mouse_bind_is_left_alone() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="spaceship_quantum"><action name="v_toggle_qdrive_engagement"><rebind input="mo1_mouse5"/></action></actionmap>"#)));
        assert!(t.contains("kb1_rctrl+f6") && !t.contains("mo1_"), "{t}");
    }

    #[test]
    fn the_shipped_file_reads_whole() {
        let t = tailor(crate::game::BINDS_XML, Some(&player("")));
        assert_eq!(t.trim_end(), crate::game::BINDS_XML.trim_end());
    }
}
