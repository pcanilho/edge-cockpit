// Copies of the player's actionmaps.xml, so binds a game update wipes can come back.
// Kept in Documents\Edge Cockpit\Binds\<channel>, the last few, one per change.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Copies kept per channel.
pub const KEEP: usize = 5;
/// A copy is only compared against when it held at least this many binds.
const LOSS_MIN: usize = 10;
const PREFIX: &str = "actionmaps-";
const DISMISSED: &str = "dismissed.txt";

/// Binds set in an actionmaps.xml: each `<rebind input="...">` that names an input.
/// A cleared default ("kb1_ ") counts too: it is a choice the player made.
pub fn count(xml: &str) -> usize {
    xml.match_indices("<rebind").filter(|(i, _)| {
        let rest = &xml[i + 7..];
        let end = rest.find('>').unwrap_or(rest.len());
        rest[..end].contains("input=\"") && !rest[..end].contains("input=\"\"")
    }).count()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Copy {
    pub file: String,
    /// When it was taken, in seconds since 1970.
    pub at: u64,
    pub binds: usize,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct State {
    /// Newest first.
    pub copies: Vec<Copy>,
    /// Binds in actionmaps.xml now, or None when there is no file.
    pub now: Option<usize>,
    /// actionmaps.xml lost most of the binds of the newest copy, and the player hasn't said that's fine.
    pub lost: bool,
}

/// The copies in a channel's folder, newest first.
fn copies(dir: &Path) -> Vec<(Copy, PathBuf)> {
    let mut out: Vec<(Copy, PathBuf)> = fs::read_dir(dir).into_iter().flatten().flatten().filter_map(|e| {
        let name = e.file_name().to_string_lossy().into_owned();
        let at: u64 = name.strip_prefix(PREFIX)?.strip_suffix(".xml")?.parse().ok()?;
        let binds = count(&fs::read_to_string(e.path()).ok()?);
        Some((Copy { file: name, at, binds }, e.path()))
    }).collect();
    out.sort_by_key(|c| std::cmp::Reverse(c.0.at));
    out
}

fn dismissed(dir: &Path) -> Option<String> {
    fs::read_to_string(dir.join(DISMISSED)).ok().map(|s| s.trim().to_string())
}

fn lost(newest: Option<&Copy>, now: Option<usize>, dismissed: Option<&str>) -> bool {
    match newest {
        Some(c) => c.binds >= LOSS_MIN && now.unwrap_or(0) * 3 < c.binds && dismissed != Some(c.file.as_str()),
        None => false,
    }
}

/// What the Keybinds page shows: the copies, and whether the binds look wiped.
pub fn state(dir: &Path, current: Option<&str>) -> State {
    let list: Vec<Copy> = copies(dir).into_iter().map(|(c, _)| c).collect();
    let now = current.map(count);
    let lost = lost(list.first(), now, dismissed(dir).as_deref());
    State { copies: list, now, lost }
}

/// Keeps a copy of actionmaps.xml when it holds binds, differs from the newest copy and
/// doesn't look like a wipe of it (a wipe is what the copies are for). Drops the oldest
/// beyond KEEP. Returns whether a copy was made.
pub fn keep(dir: &Path, xml: &str, at: SystemTime) -> std::io::Result<bool> {
    let binds = count(xml);
    // Half written (the game saving it right now): the next look gets the whole file.
    if binds == 0 || !xml.trim_end().ends_with("</ActionMaps>") {
        return Ok(false);
    }
    let list = copies(dir);
    if let Some((newest, path)) = list.first() {
        if fs::read_to_string(path).ok().as_deref() == Some(xml) {
            return Ok(false);
        }
        if lost(Some(newest), Some(binds), dismissed(dir).as_deref()) {
            return Ok(false);
        }
    }
    fs::create_dir_all(dir)?;
    let mut secs = at.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // Two changes in one second still get two files.
    while list.iter().any(|(c, _)| c.at == secs) {
        secs += 1;
    }
    fs::write(dir.join(format!("{PREFIX}{secs}.xml")), xml)?;
    for (_, old) in copies(dir).into_iter().skip(KEEP) {
        let _ = fs::remove_file(old);
    }
    Ok(true)
}

/// The text of one copy, by its file name as `state` lists it.
pub fn read(dir: &Path, file: &str) -> std::io::Result<String> {
    let ok = file.strip_prefix(PREFIX).and_then(|s| s.strip_suffix(".xml")).is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()));
    if !ok {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Not a binds copy"));
    }
    fs::read_to_string(dir.join(file))
}

/// The player says the binds are as they want them: stop warning about the newest copy.
pub fn dismiss(dir: &Path) -> std::io::Result<()> {
    if let Some((c, _)) = copies(dir).into_iter().next() {
        fs::create_dir_all(dir)?;
        fs::write(dir.join(DISMISSED), c.file)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn binds(n: usize) -> String {
        let acts: String = (0..n).map(|i| format!("<action name=\"a{i}\"><rebind input=\"kb1_f{i}\"/></action>")).collect();
        format!("<ActionMaps><ActionProfiles profileName=\"default\"><actionmap name=\"m\">{acts}</actionmap></ActionProfiles></ActionMaps>")
    }
    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ec-backup-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }
    fn t(s: u64) -> SystemTime { UNIX_EPOCH + Duration::from_secs(1_700_000_000 + s) }

    #[test]
    fn counts_rebinds_with_an_input() {
        assert_eq!(count(&binds(3)), 3);
        assert_eq!(count(r#"<action name="a"><rebind input="kb1_ "/></action><rebind input=""/><rebind/>"#), 1);
        assert_eq!(count(""), 0);
    }

    #[test]
    fn keeps_changes_only_and_the_last_five() {
        let d = dir("keep");
        assert!(!keep(&d, "<ActionMaps/>", t(0)).unwrap(), "no binds, no copy");
        assert!(!keep(&d, &binds(20)[..60], t(0)).unwrap(), "half written");
        assert!(keep(&d, &binds(20), t(1)).unwrap());
        assert!(!keep(&d, &binds(20), t(2)).unwrap(), "unchanged");
        for i in 0..6 {
            assert!(keep(&d, &binds(21 + i), t(3 + i as u64)).unwrap());
        }
        let s = state(&d, Some(&binds(26)));
        assert_eq!(s.copies.len(), KEEP);
        assert_eq!(s.copies[0].binds, 26, "newest first");
        assert!(!s.lost);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_wipe_is_flagged_not_copied_until_dismissed() {
        let d = dir("wipe");
        keep(&d, &binds(40), t(1)).unwrap();
        assert!(state(&d, None).lost, "file gone");
        assert!(state(&d, Some(&binds(0))).lost, "file emptied");
        assert!(state(&d, Some(&binds(12))).lost, "only the console's own few binds back");
        assert!(!keep(&d, &binds(12), t(2)).unwrap(), "the wipe doesn't replace the copy");
        assert!(!state(&d, Some(&binds(35))).lost, "a few removed by hand is fine");
        dismiss(&d).unwrap();
        assert!(!state(&d, Some(&binds(12))).lost);
        assert!(keep(&d, &binds(12), t(3)).unwrap(), "after dismissing, the smaller set is kept");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn small_sets_never_warn() {
        let d = dir("small");
        keep(&d, &binds(4), t(1)).unwrap();
        assert!(!state(&d, None).lost);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn reads_only_copies() {
        let d = dir("read");
        keep(&d, &binds(2), t(1)).unwrap();
        let f = state(&d, None).copies[0].file.clone();
        assert_eq!(read(&d, &f).unwrap(), binds(2));
        assert!(read(&d, "..\\prefs.json").is_err());
        assert!(read(&d, "actionmaps-.xml").is_err());
        let _ = fs::remove_dir_all(&d);
    }
}
