//! Finding Star Citizen on disk, following its Game.log and reading the player's binds.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const ROOTS: &[&str] = &[
    r"Program Files\Roberts Space Industries\StarCitizen",
    r"Roberts Space Industries\StarCitizen",
    r"Games\Roberts Space Industries\StarCitizen",
    r"Games\StarCitizen",
    r"StarCitizen",
];
const CHANNELS: &[&str] = &["LIVE", "PTU", "EPTU", "HOTFIX", "TECH-PREVIEW"];

/// Our keybind file for actions that have no default key; the player loads it once in game.
pub const BINDS_XML: &str = include_str!("../../../binds/layout_edge_cockpit_exported.xml");
pub const BINDS_NAME: &str = "layout_edge_cockpit_exported.xml";

/// The last part of a path, split on either separator, so Windows paths read the same in
/// tests on any system.
fn last_part(p: &str) -> &str {
    p.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next().unwrap_or("")
}

/// The path without its last part, or None at the top.
#[cfg_attr(not(windows), allow(dead_code))]
fn parent_of(p: &str) -> Option<&str> {
    let t = p.trim_end_matches(['\\', '/']);
    t.rfind(['\\', '/']).map(|i| &t[..i])
}

/// Every place a channel folder (…\StarCitizen\LIVE) usually is, or the ones under `game_dir`.
pub fn candidates(game_dir: Option<&Path>) -> Vec<PathBuf> {
    if let Some(dir) = game_dir {
        let base = last_part(&dir.to_string_lossy()).to_uppercase();
        return if CHANNELS.contains(&base.as_str()) {
            vec![dir.to_path_buf()]
        } else {
            CHANNELS.iter().map(|c| dir.join(c)).collect()
        };
    }
    let mut out = vec![];
    for d in 'C'..='J' {
        for r in ROOTS {
            for c in CHANNELS {
                out.push(PathBuf::from(format!(r"{d}:\{r}\{c}")));
            }
        }
    }
    out
}

fn modified(p: &Path) -> Option<SystemTime> {
    fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// The channel whose Game.log was written last.
pub fn find_channel(game_dir: Option<&Path>) -> Option<PathBuf> {
    candidates(game_dir)
        .into_iter()
        .filter_map(|c| modified(&c.join("Game.log")).map(|t| (t, c)))
        .max_by_key(|(t, _)| *t)
        .map(|(_, c)| c)
}

/// …\StarCitizen\PTU\Bin64\StarCitizen.exe -> …\StarCitizen\PTU
#[cfg_attr(not(windows), allow(dead_code))]
pub fn channel_from_exe(exe: &str) -> Option<PathBuf> {
    if !last_part(exe).eq_ignore_ascii_case("StarCitizen.exe") {
        return None;
    }
    let bin = parent_of(exe)?;
    if !last_part(bin).eq_ignore_ascii_case("Bin64") {
        return None;
    }
    Some(PathBuf::from(parent_of(bin)?))
}

pub fn actionmaps(channel: &Path) -> PathBuf {
    channel.join(r"user\client\0\Profiles\default\actionmaps.xml")
}

pub fn mappings_dir(channel: &Path) -> PathBuf {
    channel.join(r"user\client\0\controls\mappings")
}

/// Puts our keybind file where the game's Control Profiles list finds it. Returns the path.
pub fn install_binds(channel: &Path) -> std::io::Result<PathBuf> {
    let dir = mappings_dir(channel);
    fs::create_dir_all(&dir)?;
    let path = dir.join(BINDS_NAME);
    if fs::read_to_string(&path).ok().as_deref() != Some(BINDS_XML) {
        fs::write(&path, BINDS_XML)?;
    }
    Ok(path)
}

pub const PROFILE_BINDS_NAME: &str = "layout_edge_cockpit_profile_exported.xml";

/// Puts keyboard binds from an imported profile in the game's Control Profiles list,
/// next to ours. Only a control profile is accepted. Returns the path.
pub fn install_profile_binds(channel: &Path, xml: &str) -> std::io::Result<PathBuf> {
    let head = xml.trim_start();
    if !head.starts_with("<ActionMaps") || xml.len() > 1_000_000 {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "Not a Star Citizen control profile"));
    }
    let dir = mappings_dir(channel);
    fs::create_dir_all(&dir)?;
    let path = dir.join(PROFILE_BINDS_NAME);
    fs::write(&path, xml)?;
    Ok(path)
}

/// Follows a growing log file. The game starts a new Game.log on each launch, so a
/// file that shrinks is read again from the start.
pub struct Tail {
    pub path: PathBuf,
    offset: u64,
    rest: String,
    born: Option<SystemTime>,
    /// Set when the game started a new Game.log since the last poll.
    pub restarted: bool,
}

impl Tail {
    pub fn new(path: PathBuf) -> Self {
        Self { path, offset: 0, rest: String::new(), born: None, restarted: false }
    }

    /// New complete lines since the last call. A new Game.log (the game restarted: the file
    /// is shorter, or was created again) is read from the start and sets `restarted`.
    pub fn poll(&mut self) -> Vec<String> {
        let Ok(mut f) = File::open(&self.path) else { return vec![] };
        let Ok(meta) = f.metadata() else { return vec![] };
        let size = meta.len();
        let born = meta.created().ok();
        let renewed = self.offset > 0 && born.is_some() && self.born.is_some() && born != self.born;
        if size < self.offset || renewed {
            self.offset = 0;
            self.rest.clear();
            self.restarted = true;
        }
        self.born = born;
        if size == self.offset || f.seek(SeekFrom::Start(self.offset)).is_err() {
            return vec![];
        }
        let mut buf = Vec::with_capacity((size - self.offset) as usize);
        let Ok(n) = f.take(size - self.offset).read_to_end(&mut buf) else { return vec![] };
        self.offset += n as u64;
        self.rest.push_str(&String::from_utf8_lossy(&buf));
        let rest = std::mem::take(&mut self.rest);
        let mut parts = rest.split('\n').collect::<Vec<_>>();
        self.rest = parts.pop().unwrap_or_default().to_string();
        parts.into_iter().map(|l| l.trim_end_matches('\r')).filter(|l| relevant(l)).map(str::to_string).collect()
    }
}

pub const POLL: Duration = Duration::from_millis(300);
/// After 30 s with no new lines (menus, the game closed).
pub const POLL_IDLE: Duration = Duration::from_millis(1500);

/// Markers of the lines the panel reads (app/ui/lib/gamelog.js PATTERNS; app/test checks every
/// pattern has one). Everything
/// else, which is nearly all of Game.log, never leaves Rust.
const MARKERS: &[&str] = &[
    "SetDriver", "ClearDriver", "Armistice Zone", "as their destination", "Join PU", "Context Establisher Done",
    "Loading screen for", "FastShutdown", "Disconnecting from", "SystemQuit", "AccountLoginCharacterStatus_Character",
    "Emergency Services", "Logged an incap", "[ActorState] Dead", "<Actor Death>", "Recv Unbind Batch Add Player",
    "<Spawn Flow>", "\"Contract ", "Objective", "Jurisdiction", "Monitored Space", "CrimeStat",
    "Branch:", "Changelist:", "<Vehicle Destruction>", "RequestLocationInventory",
    // 4.10 boarding, navigation and quantum, hangars, and the Log page.
    "You have joined", "You have left", "CSCItemNavigation::", "SetVehicleSpawningInformations", "[Team_GameServices][ASOP]",
    "Hangar Request Completed", "OnLoadingPlatformStateChanged", "<Actor stall>", "<Changing Solar System>",
    "Refinery Work Order", "DoesLocationContainHospital", "STOWING ON UNREGISTER",
];

pub fn relevant(line: &str) -> bool {
    MARKERS.iter().any(|m| line.contains(m))
}

/// The game's earlier logs (…\LIVE\logbackups\*.log), newest first: at most `max`, none older
/// than `days`.
pub fn backups(channel: &Path, max: usize, days: u64) -> Vec<PathBuf> {
    let cutoff = SystemTime::now().checked_sub(Duration::from_secs(days * 86_400));
    let Ok(dir) = fs::read_dir(channel.join("logbackups")) else { return vec![] };
    let mut files: Vec<(SystemTime, PathBuf)> = dir
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("log")))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .filter(|(t, _)| cutoff.is_none_or(|c| *t >= c))
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    files.into_iter().take(max).map(|(_, p)| p).collect()
}

/// The lines of a whole log the console reads (see `relevant`).
pub fn relevant_lines(path: &Path) -> Vec<String> {
    let Ok(bytes) = fs::read(path) else { return vec![] };
    String::from_utf8_lossy(&bytes).lines().filter(|l| relevant(l)).map(str::to_string).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn channel_from_exe_path() {
        assert_eq!(
            channel_from_exe(r"C:\Games\StarCitizen\PTU\Bin64\StarCitizen.exe"),
            Some(PathBuf::from(r"C:\Games\StarCitizen\PTU"))
        );
        assert_eq!(channel_from_exe(r"C:\Windows\notepad.exe"), None);
    }

    #[test]
    fn backups_are_logs_newest_first() {
        let ch = std::env::temp_dir().join(format!("xfd-backups-{}", std::process::id()));
        let dir = ch.join("logbackups");
        fs::create_dir_all(&dir).unwrap();
        for (i, name) in ["a.log", "b.log", "notes.txt", "c.LOG"].iter().enumerate() {
            fs::write(dir.join(name), "<Join PU> x\nnoise\n").unwrap();
            let t = SystemTime::now() - Duration::from_secs(100 - i as u64 * 10);
            fs::File::options().write(true).open(dir.join(name)).unwrap().set_modified(t).unwrap();
        }
        let got: Vec<_> = backups(&ch, 2, 30).iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(got, ["c.LOG", "b.log"]);
        assert_eq!(relevant_lines(&dir.join("a.log")), ["<Join PU> x"]);
        assert!(backups(&ch.join("none"), 5, 30).is_empty());
        fs::remove_dir_all(&ch).unwrap();
    }

    #[test]
    fn tail_reads_whole_lines_and_restarts() {
        let dir = std::env::temp_dir().join(format!("xfd-tail-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("Game.log");
        fs::write(&p, "noise\r\nEntering Armistice Zone\r\nLeaving Armi").unwrap();
        let mut t = Tail::new(p.clone());
        assert_eq!(t.poll(), vec!["Entering Armistice Zone"]);
        fs::OpenOptions::new().append(true).open(&p).unwrap().write_all(b"stice Zone\nmore noise\n").unwrap();
        assert_eq!(t.poll(), vec!["Leaving Armistice Zone"]);
        fs::write(&p, "<Join PU>\n").unwrap();
        assert_eq!(t.poll(), vec!["<Join PU>"]);
        assert!(t.restarted, "a shorter log is a new one");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn keeps_the_lines_the_panel_reads() {
        for l in [
            "CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'AEGS_Gladius_1' [1]",
            "Player has selected point ArcCorp as their destination",
            "Added notification \"Contract Accepted: Bounty: \" [2]",
            "Added notification \"New Objective: Go to Hurston: \" [3]",
            "<Spawn Flow> Player 'me' lost reservation for spawnpoint",
            "Loading screen for Stanton : PU closed after 12s",
            "Branch: sc-alpha-4.3.2",
            "<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'AEGS_Gladius_1' [1]",
        ] {
            assert!(relevant(l), "{l}");
        }
        assert!(!relevant("<2026-11-17> [Notice] <CEntityComponentPhysics> nothing to see"));
    }

    /// A whole 4.10 session (test/fixtures/game-4.10.log: the game's own line formats, with
    /// noise between them and CRLF endings), appended to a log in three parts as the game
    /// writes it, through the real tail and line filter. What gets through must match
    /// test/fixtures/game-4.10.filtered.log, which the JS tests then replay through the
    /// parser. After changing the filter: UPDATE_REPLAY=1 cargo test replays.
    #[test]
    fn replays_a_recorded_session() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures");
        let log = fs::read(fixtures.join("game-4.10.log")).unwrap();
        let dir = std::env::temp_dir().join(format!("xfd-replay-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("Game.log");
        fs::write(&p, b"").unwrap();
        let mut t = Tail::new(p.clone());
        let mut got = vec![];
        for part in log.chunks(log.len() / 3 + 1) {
            fs::OpenOptions::new().append(true).open(&p).unwrap().write_all(part).unwrap();
            got.extend(t.poll());
        }
        fs::remove_dir_all(dir).ok();
        let expected = fixtures.join("game-4.10.filtered.log");
        let text = got.join("\n") + "\n";
        if std::env::var_os("UPDATE_REPLAY").is_some() {
            fs::write(&expected, &text).unwrap();
        }
        assert_eq!(text, fs::read_to_string(&expected).unwrap().replace("\r\n", "\n"));
        assert!(got.len() < 80, "the filter let {} lines through", got.len());
    }

    #[test]
    fn candidates_under_a_game_dir() {
        assert_eq!(candidates(Some(Path::new(r"D:\SC\LIVE"))), vec![PathBuf::from(r"D:\SC\LIVE")]);
        assert_eq!(candidates(Some(Path::new(r"D:\SC"))).len(), CHANNELS.len());
    }
}

#[cfg(test)]
mod binds_tests {
    use super::BINDS_XML;

    #[test]
    fn every_action_without_a_default_key_gets_one() {
        let layout: serde_json::Value = serde_json::from_str(include_str!("../../../layouts/star-citizen.json")).unwrap();
        let mut stack = vec![&layout];
        while let Some(o) = stack.pop() {
            match o {
                serde_json::Value::Object(m) => {
                    if m.get("needsKeyboardBind") == Some(&serde_json::Value::Bool(true)) {
                        let action = m["action"].as_str().unwrap();
                        assert!(BINDS_XML.contains(&format!("<action name=\"{action}\">")), "{action} has no key in the binds file");
                    }
                    stack.extend(m.values());
                }
                serde_json::Value::Array(a) => stack.extend(a.iter()),
                _ => {}
            }
        }
    }
}
