//! Our keybind file, cut to what the player hasn't bound.
//!
//! The game keeps one Keyboard/Mouse slot per action, so a profile entry replaces whatever
//! the player put there. The file we put in Control Profiles never touches a bind of theirs:
//! - an action they set anything for on the keyboard (a key, a mouse button, or cleared) is
//!   left out, and the console uses their key where it is one; our own key from an earlier
//!   load of this profile isn't theirs, so it stays;
//! - the game's default mouse button moves to the mouse device only when they have no
//!   mouse bind there;
//! - a key of ours they already use for something else is swapped for a spare one, or the
//!   action is left out when none is free.

use std::collections::{BTreeSet, HashMap};

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

/// A key combination as a set, so "lalt+f5" and "f5+lalt" are the same key.
fn combo(k: &str) -> BTreeSet<String> {
    k.split('+').map(|p| p.trim().to_ascii_lowercase()).filter(|p| !p.is_empty()).collect()
}

/// The spare keys our file lists in its `<!-- spare: ... -->` line.
fn spares(ours: &str) -> Vec<String> {
    ours.lines()
        .find_map(|l| l.trim().strip_prefix("<!-- spare:")?.strip_suffix("-->").map(|s| s.split_whitespace().map(str::to_string).collect()))
        .unwrap_or_default()
}

/// `ours` (our generated binds file) cut to the player's `actionmaps` (see the module doc).
/// Without an actionmaps.xml the player has the defaults, which our file was made for.
pub fn tailor(ours: &str, actionmaps: Option<&str>) -> String {
    let Some(xml) = actionmaps else { return ours.to_string() };
    let mut theirs = read(xml);
    // Our key from an earlier load of this profile is ours, not theirs.
    let mine = read(ours);
    theirs.kb.retain(|slot, k| mine.kb.get(slot).is_none_or(|m| combo(m) != combo(k)));
    // Keys the player uses anywhere; ours must not land on one of them.
    let mut taken: Vec<BTreeSet<String>> = theirs.kb.values().map(|k| combo(k)).filter(|c| !c.is_empty()).collect();
    let mut spare = spares(ours).into_iter();
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
            if keep(&mut block, &(map.clone(), action), &theirs, &mut taken, &mut spare) {
                section.append(&mut block);
                section.push(line.to_string());
            }
            block.clear();
        }
    }
    out.join("\n") + "\n"
}

/// Fits one action of ours to the player's binds; false when it must be left out.
fn keep(block: &mut Vec<String>, slot: &Slot, theirs: &Binds, taken: &mut Vec<BTreeSet<String>>, spare: &mut impl Iterator<Item = String>) -> bool {
    // Anything they set in the Keyboard/Mouse slot, a cleared one included, is theirs.
    if theirs.kb.contains_key(slot) {
        return false;
    }
    if theirs.mouse.contains_key(slot) {
        block.retain(|l| !l.trim().starts_with("<rebind input=\"mo"));
    }
    for l in block.iter_mut() {
        let Some(key) = attr(l.trim(), "input").and_then(|i| input(i, "kb")).map(str::to_string) else { continue };
        let mut c = combo(&key);
        if taken.contains(&c) {
            let Some(s) = spare.find(|s| !taken.contains(&combo(s))) else { return false };
            *l = l.replace(&format!("kb1_{key}\""), &format!("kb1_{s}\""));
            c = combo(&s);
        }
        taken.push(c);
    }
    true
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
 <!-- spare: rctrl+lalt+f9 rctrl+lalt+f10 -->
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
    fn a_mouse_button_or_cleared_slot_of_theirs_stays() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="spaceship_general"><action name="v_close_all_doors"><rebind input="kb1_mouse4"/></action>
          <action name="v_open_all_doors"><rebind input="kb1_ "/></action></actionmap>"#)));
        assert!(!t.contains("v_close_all_doors") && !t.contains("v_open_all_doors") && !t.contains("spaceship_general"), "{t}");
        assert!(t.contains("<rebind input=\"kb1_rctrl+f6\"/>\n   <rebind input=\"mo1_mouse1\"/>"), "{t}");
    }

    #[test]
    fn our_key_from_an_earlier_load_stays_and_gets_its_mouse_button_back() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="spaceship_quantum"><action name="v_toggle_qdrive_engagement"><rebind input="kb1_rctrl+f6"/></action></actionmap>"#)));
        assert!(t.contains("<rebind input=\"kb1_rctrl+f6\"/>\n   <rebind input=\"mo1_mouse1\"/>"), "{t}");
    }

    #[test]
    fn their_mouse_bind_is_left_alone() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="spaceship_quantum"><action name="v_toggle_qdrive_engagement"><rebind input="mo1_mouse5"/></action></actionmap>"#)));
        assert!(t.contains("kb1_rctrl+f6") && !t.contains("<rebind input=\"mo1_"), "{t}");
    }

    #[test]
    fn a_key_of_ours_they_use_elsewhere_is_swapped_for_a_spare() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="spaceship_movement"><action name="v_ifcs_toggle_vector_decoupling"><rebind input="kb1_f6+rctrl"/></action>
          <action name="v_autoland"><rebind input="kb1_rctrl+lalt+f9"/></action></actionmap>"#)));
        assert!(t.contains("<rebind input=\"kb1_rctrl+lalt+f10\"/>") && !t.contains("kb1_rctrl+f6\""), "{t}");
    }

    #[test]
    fn no_spare_left_leaves_the_action_out() {
        let t = tailor(OURS, Some(&player(r#"<actionmap name="x"><action name="a"><rebind input="kb1_rctrl+f6"/></action>
          <action name="b"><rebind input="kb1_rctrl+lalt+f9"/></action><action name="c"><rebind input="kb1_rctrl+lalt+f10"/></action></actionmap>"#)));
        assert!(!t.contains("v_toggle_qdrive_engagement"), "{t}");
        assert!(t.contains("v_open_all_doors") && t.contains("v_close_all_doors"), "{t}");
    }

    #[test]
    fn the_shipped_file_reads_whole() {
        let t = tailor(crate::game::BINDS_XML, Some(&player("")));
        assert_eq!(t.trim_end(), crate::game::BINDS_XML.trim_end());
    }
}
