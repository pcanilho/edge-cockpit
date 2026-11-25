// Edge Cockpit: a lightweight cockpit-style touch console for Star Citizen.
// Rust does the window, the keys, the game files, the screen and updates; the console
// itself is the web UI in ../ui.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod family;
#[cfg_attr(not(windows), allow(dead_code))]
mod fit;
mod game;
mod keys;
mod phone;
mod tailor;
mod telemetry;
mod world;
#[cfg(windows)]
mod win;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

#[derive(Default)]
struct App {
    /// Keys held down by hold-type buttons, released when the panel hides or quits.
    held: Mutex<HashSet<String>>,
    /// The channel folder in use (…\StarCitizen\LIVE).
    channel: Mutex<Option<PathBuf>>,
    /// The UI listens for Game.log lines; nothing is sent before it does.
    ui_ready: AtomicBool,
    rescan: AtomicBool,
    /// The running Star Citizen process, or 0.
    game: AtomicU32,
    /// The screen is off: the console is black and, where the Edge allows it, the backlight is down.
    dark: AtomicBool,
    /// Bumped on every wake, so only the latest wake puts the screen back to sleep.
    wake_gen: AtomicU64,
    prefs: Mutex<Prefs>,
    /// The last CPU reading for the performance overlay: when, and total CPU ticks.
    perf: Mutex<Option<(std::time::Instant, u64)>>,
    /// Whether the Edge answered DDC/CI, once we have tried.
    ddc: Mutex<Option<bool>>,
    update: Mutex<Option<tauri_plugin_updater::Update>>,
    /// Prices and server status for the Verse page.
    world: world::Cache,
    /// Phones paired as extra screens, and their links.
    phones: phone::Phones,
    /// The console's size after its last move, against the size of its display.
    fit: Mutex<Option<Fit>>,
    /// The game link (Star Citizen's local telemetry), for actions; and the last update it sent.
    link: std::sync::Arc<telemetry::Link>,
    telemetry: Mutex<Option<telemetry::Update>>,
}

/// The console's size against its display's, after a move. Settings and the setup check
/// show it, so a console that came up smaller than its screen is seen and refitted.
#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
struct Fit {
    want: (i32, i32),
    got: (i32, i32),
}

/// Settings that matter before the UI loads, kept in prefs.json in the app's config folder.
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct Prefs {
    /// Start hidden with Windows.
    autostart: bool,
    /// Turn the screen off when the game isn't running (otherwise hide the panel).
    screen_off: bool,
    /// The backlight level to restore, while we hold it down.
    saved_backlight: Option<u32>,
    /// The display picked in Settings (its monitor name or GDI name), or None for automatic.
    display: Option<String>,
    /// Serve the console to phones on the home network.
    phones: bool,
    /// The day backlight level, while Night mode holds the backlight down.
    night_saved: Option<u32>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { autostart: true, screen_off: true, saved_backlight: None, display: None, phones: false, night_saved: None }
    }
}

fn prefs_path(handle: &AppHandle) -> Option<PathBuf> {
    handle.path().app_config_dir().ok().map(|d| d.join("prefs.json"))
}

fn load_prefs(handle: &AppHandle) -> (Prefs, bool) {
    match prefs_path(handle).and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(s) => (serde_json::from_str(&s).unwrap_or_default(), false),
        None => (Prefs::default(), true),
    }
}

fn save_prefs(handle: &AppHandle, p: &Prefs) {
    if let Some(path) = prefs_path(handle) {
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
        let _ = std::fs::write(path, serde_json::to_string_pretty(p).unwrap_or_default());
    }
}

#[derive(Serialize, Clone)]
struct GameInfo {
    channel: Option<String>,
    elevated: bool,
    /// True while Star Citizen is the window in front.
    focused: bool,
    running: bool,
    /// Whether the game runs as administrator, known only while it is in front.
    game_elevated: Option<bool>,
    /// The channel's Game.log exists, so the panel can follow the game.
    log: bool,
}

#[derive(Serialize, Clone)]
struct LogBatch {
    lines: Vec<String>,
    /// False while catching up on what the log already held.
    live: bool,
    /// Set when a new Game.log was opened (a new channel or a restart).
    reset: bool,
}

fn game_focused() -> bool {
    #[cfg(windows)]
    {
        win::foreground_exe().is_some_and(|e| e.to_ascii_lowercase().ends_with("\\starcitizen.exe"))
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Sends a bind. mode: "down", "up" or "tap" (down, wait `ms`, up).
/// anywhere: also when the game isn't in front (for trying keys in Notepad).
#[tauri::command]
async fn key(app: State<'_, App>, spec: String, mode: String, ms: Option<u64>, anywhere: bool) -> Result<(), String> {
    send_key(&app, spec, mode, ms, anywhere).await
}

async fn send_key(app: &App, spec: String, mode: String, ms: Option<u64>, anywhere: bool) -> Result<(), String> {
    let chord = keys::chord(&spec)?;
    #[cfg(windows)]
    win::restore_game_focus();
    if !anywhere && !game_focused() {
        return Err("no-game".into());
    }
    #[cfg(windows)]
    {
        if mode != "up" && !win::is_elevated() && win::foreground_elevated() {
            return Err("blocked".into());
        }
        match mode.as_str() {
            "down" => {
                press(&chord, false).await?;
                app.held.lock().unwrap().insert(spec);
            }
            "up" => {
                app.held.lock().unwrap().remove(&spec);
                press(&chord, true).await?;
            }
            _ => {
                press(&chord, false).await?;
                // Star Citizen polls input once a frame, so a tap must last a few frames.
                tokio_sleep(ms.unwrap_or(60).clamp(30, 5000)).await;
                press(&chord, true).await?;
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, mode, ms, chord);
        Err("not-windows".into())
    }
}

/// The game link's last update, for a UI that just started listening.
#[tauri::command]
fn telemetry_now(app: State<'_, App>) -> Option<telemetry::Update> {
    app.telemetry.lock().unwrap().clone()
}

/// Runs an action through the game link. "ok", or why the game didn't (see telemetry::Link::trigger).
#[tauri::command]
async fn game_action(app: State<'_, App>, action: String, hold_ms: Option<u32>) -> Result<String, String> {
    let link = app.link.clone();
    link.trigger(&action, hold_ms).await.map(str::to_string)
}

#[derive(Serialize)]
struct TelemetrySetup {
    /// The Windows variable 4.10 reads (GRPC_CLIENT_SERVER_ENABLED) is set.
    env: bool,
    /// Channel folders (LIVE, PTU…) and whether their user.cfg turns telemetry on.
    channels: Vec<(String, bool)>,
}

fn telemetry_channels(app: &App) -> Vec<PathBuf> {
    let current = app.channel.lock().unwrap().clone().or_else(|| game::find_channel(None));
    current.map(|c| telemetry::sibling_channels(&c)).unwrap_or_default()
}

/// Whether telemetry is turned on for the game, as far as Windows and user.cfg say.
#[tauri::command]
fn telemetry_setup(app: State<'_, App>) -> TelemetrySetup {
    #[cfg(windows)]
    let env = win::user_env("GRPC_CLIENT_SERVER_ENABLED").is_some_and(|v| v.eq_ignore_ascii_case("true") || v == "1");
    #[cfg(not(windows))]
    let env = false;
    let channels = telemetry_channels(&app)
        .into_iter()
        .map(|c| {
            let on = std::fs::read_to_string(c.join("user.cfg")).is_ok_and(|cfg| telemetry::cfg_on(&cfg));
            (c.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), on)
        })
        .collect();
    TelemetrySetup { env, channels }
}

/// Turns the game's telemetry on or off: the Windows variable 4.10 reads, and the user.cfg
/// line 5.0 reads in each channel folder. The game picks it up on its next start.
#[tauri::command]
fn telemetry_enable(app: State<'_, App>, on: bool) -> Result<TelemetrySetup, String> {
    let channels = telemetry_channels(&app);
    if channels.is_empty() {
        return Err("Start Star Citizen once, so the console finds its folder".into());
    }
    for c in &channels {
        let path = c.join("user.cfg");
        let cfg = std::fs::read_to_string(&path).unwrap_or_default();
        let next = telemetry::with_telemetry(&cfg, on);
        if next != cfg {
            std::fs::write(&path, next).map_err(|e| format!("{}: {e}", path.display()))?;
        }
    }
    #[cfg(windows)]
    if !win::set_user_env("GRPC_CLIENT_SERVER_ENABLED", on.then_some("true")) {
        return Err("Windows didn't take the setting".into());
    }
    Ok(telemetry_setup(app))
}

/// Starts recording the game link, or stops and saves the recording to Documents\\Edge Cockpit.
/// Some(path) once saved; None when a recording started.
#[tauri::command]
fn telemetry_record(handle: AppHandle, app: State<'_, App>, on: bool) -> Result<Option<String>, String> {
    if on {
        app.link.record();
        return Ok(None);
    }
    let bytes = app.link.stop().ok_or("Not recording")?;
    let dir = user_dir(&handle).ok_or("No Documents folder")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let path = dir.join(format!("telemetry-{secs}.sctl"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", path.display())).spawn();
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Follows the game link and passes each change to the UI.
fn watch_link(handle: AppHandle) {
    let link = handle.state::<App>().link.clone();
    let h1 = handle.clone();
    let h2 = handle;
    tauri::async_runtime::spawn(telemetry::run(
        link,
        move || h1.state::<App>().channel.lock().unwrap().clone(),
        move |u| {
            *h2.state::<App>().telemetry.lock().unwrap() = Some(u.clone());
            let _ = h2.emit("telemetry", u);
        },
    ));
}

/// Turns the mouse wheel in the game, for controls the game only reads from the wheel.
#[tauri::command]
fn wheel(clicks: i32, anywhere: bool) -> Result<(), String> {
    #[cfg(windows)]
    win::restore_game_focus();
    if !anywhere && !game_focused() {
        return Err("no-game".into());
    }
    #[cfg(windows)]
    {
        if !win::is_elevated() && win::foreground_elevated() {
            return Err("blocked".into());
        }
        win::wheel(clicks)
    }
    #[cfg(not(windows))]
    {
        let _ = clicks;
        Err("not-windows".into())
    }
}

/// Presses or releases a chord. Modifiers go down a moment before the key and come up a
/// moment after it: the game reads input once a frame, and a modifier landing in the
/// same frame as its key is missed (RCtrl+F2 then reads as F2, the starmap).
#[cfg(windows)]
async fn press(chord: &[keys::Key], up: bool) -> Result<(), String> {
    const GAP_MS: u64 = 25;
    let (mods, key) = chord.split_at(chord.len().saturating_sub(1));
    if mods.is_empty() {
        return win::send(key, up);
    }
    if up {
        win::send(key, true)?;
        tokio_sleep(GAP_MS).await;
        win::send(mods, true)
    } else {
        win::send(mods, false)?;
        tokio_sleep(GAP_MS).await;
        win::send(key, false)
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
async fn tokio_sleep(ms: u64) {
    tauri::async_runtime::spawn_blocking(move || std::thread::sleep(Duration::from_millis(ms))).await.ok();
}

fn release_all(app: &App) {
    let held: Vec<String> = app.held.lock().unwrap().drain().collect();
    for spec in held {
        if let Ok(_c) = keys::chord(&spec) {
            #[cfg(windows)]
            let _ = win::send(&_c, true);
        }
    }
}

/// Called by the UI once it listens for Game.log lines; it then gets the whole log again.
#[tauri::command]
fn ui_ready(app: State<'_, App>) {
    app.ui_ready.store(true, Ordering::SeqCst);
    *app.channel.lock().unwrap() = None;
    app.rescan.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn release_keys(app: State<'_, App>) {
    release_all(&app);
}

#[tauri::command]
fn game_info(app: State<'_, App>) -> GameInfo {
    let channel = app.channel.lock().unwrap().clone();
    let running = channel.as_ref().is_some_and(|c| {
        // The game holds Game.log open and writes to it while running; a log touched in
        // the last minute is a good enough sign without scanning processes.
        std::fs::metadata(c.join("Game.log"))
            .and_then(|m| m.modified())
            .is_ok_and(|t| t.elapsed().map(|e| e.as_secs() < 60).unwrap_or(false))
    });
    let focused = game_focused();
    #[cfg(windows)]
    let game_elevated = focused.then(win::foreground_elevated);
    #[cfg(not(windows))]
    let game_elevated = None;
    let log = channel.as_ref().is_some_and(|c| c.join("Game.log").is_file());
    GameInfo {
        channel: channel.map(|c| c.to_string_lossy().into_owned()),
        #[cfg(windows)]
        elevated: win::is_elevated(),
        #[cfg(not(windows))]
        elevated: false,
        focused,
        running: running || focused || app.game.load(Ordering::SeqCst) != 0,
        game_elevated,
        log,
    }
}

/// Percent-encodes text for a URL query, cut to `max` characters.
fn url_part(s: &str, max: usize) -> String {
    s.chars()
        .take(max)
        .collect::<String>()
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// What a bug report says about the PC: Windows and WebView2 versions.
#[derive(Serialize)]
struct ReportInfo {
    os: String,
    webview: String,
}

#[tauri::command]
fn report_info() -> ReportInfo {
    #[cfg(windows)]
    let os = win::windows_version();
    #[cfg(not(windows))]
    let os = std::env::consts::OS.to_string();
    ReportInfo { os, webview: tauri::webview_version().unwrap_or_default() }
}

/// Largest report written: a few hundred log lines and the details.
const REPORT_MAX: usize = 512 * 1024;

/// Saves a bug report as Documents\Edge Cockpit\report.txt and shows it in Explorer, to
/// attach to the issue. Returns the path.
#[tauri::command]
fn save_report(handle: AppHandle, text: String) -> Result<String, String> {
    if text.len() > REPORT_MAX {
        return Err("The report is too big".into());
    }
    let dir = user_dir(&handle).ok_or("No Documents folder")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("report.txt");
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", path.display())).spawn();
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Opens a new issue on the app's GitHub page in the browser, title and body filled in.
/// Only this one address: the page can't open anything else.
#[tauri::command]
fn report_issue(title: String, body: String) -> bool {
    let url = format!(
        "https://github.com/pcanilho/edge-cockpit/issues/new?labels=bug&title={}&body={}",
        url_part(&title, 120),
        url_part(&body, 1500)
    );
    #[cfg(windows)]
    {
        win::open_url(&url)
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        false
    }
}

#[derive(Serialize)]
struct Perf {
    /// Percent of the whole machine, as Task Manager shows it.
    cpu: f64,
    mem_mb: f64,
}

/// CPU and memory of the app and its WebView2 processes, for the performance overlay.
/// CPU is measured since the previous call, so the first call reads 0.
#[tauri::command]
fn perf(app: State<'_, App>) -> Perf {
    #[cfg(windows)]
    let (ticks, mem) = win::usage();
    #[cfg(not(windows))]
    let (ticks, mem) = (0u64, 0u64);
    let now = std::time::Instant::now();
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get()) as f64;
    let mut last = app.perf.lock().unwrap();
    let cpu = match *last {
        Some((t, before)) if ticks >= before => {
            let wall = now.duration_since(t).as_secs_f64();
            if wall > 0.0 { (ticks - before) as f64 / 1e7 / wall / cores * 100.0 } else { 0.0 }
        }
        _ => 0.0,
    };
    *last = Some((now, ticks));
    Perf { cpu, mem_mb: mem as f64 / 1_048_576.0 }
}

/// The player's actionmaps.xml, or None when there isn't one yet.
#[tauri::command]
fn read_binds(app: State<'_, App>) -> Option<String> {
    let channel = app.channel.lock().unwrap().clone()?;
    std::fs::read_to_string(game::actionmaps(&channel)).ok()
}

/// One earlier game session's log, filtered to the lines the console reads.
#[derive(Serialize)]
struct PastLog {
    name: String,
    lines: Vec<String>,
}

/// The game's log backups from the last 30 days (at most 12), for the Log page's past sessions.
#[tauri::command]
async fn past_logs(app: State<'_, App>) -> Result<Vec<PastLog>, String> {
    let Some(ch) = app.channel.lock().unwrap().clone() else { return Ok(vec![]) };
    tauri::async_runtime::spawn_blocking(move || {
        game::backups(&ch, 12, 30)
            .into_iter()
            .map(|p| PastLog { name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(), lines: game::relevant_lines(&p) })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// The player's own ship roles, Documents\Edge Cockpit\ships.json, if there is one.
#[tauri::command]
fn user_ships(handle: AppHandle) -> Option<String> {
    std::fs::read_to_string(user_dir(&handle)?.join("ships.json")).ok()
}

/// Documents\Edge Cockpit, where the player's own files live.
fn user_dir(handle: &AppHandle) -> Option<PathBuf> {
    Some(handle.path().document_dir().ok()?.join("Edge Cockpit"))
}

/// Saves a profile (settings, plate order, ship roles and keyboard binds) as
/// Documents\Edge Cockpit\profile.json. Returns the path.
#[tauri::command]
fn save_profile(handle: AppHandle, json: String) -> Result<String, String> {
    let dir = user_dir(&handle).ok_or("No Documents folder")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("profile.json");
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// The saved profile, Documents\Edge Cockpit\profile.json, if there is one.
#[tauri::command]
fn load_profile(handle: AppHandle) -> Option<String> {
    std::fs::read_to_string(user_dir(&handle)?.join("profile.json")).ok()
}

/// Largest page file read or written: a page is a few kilobytes.
const PAGE_MAX: usize = 256 * 1024;

/// A file name for a shared page, from its name: letters, digits, spaces and dashes only.
fn page_file(name: &str) -> String {
    let clean: String = name.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-').take(40).collect();
    let clean = clean.trim();
    format!("{}.json", if clean.is_empty() { "Page" } else { clean })
}

/// Saves a page of yours as Documents\Edge Cockpit\Pages\<name>.json, to share. Returns the path.
#[tauri::command]
fn save_page(handle: AppHandle, name: String, json: String) -> Result<String, String> {
    if json.len() > PAGE_MAX {
        return Err("The page is too big".into());
    }
    let dir = user_dir(&handle).ok_or("No Documents folder")?.join("Pages");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(page_file(&name));
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Page files in Documents\Edge Cockpit\Pages, to import: (file name, contents).
#[tauri::command]
fn page_files(handle: AppHandle) -> Vec<(String, String)> {
    let Some(dir) = user_dir(&handle).map(|d| d.join("Pages")) else { return Vec::new() };
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<(String, String)> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("json")))
        .filter(|e| e.metadata().is_ok_and(|m| m.is_file() && (m.len() as usize) <= PAGE_MAX))
        .filter_map(|e| Some((e.file_name().to_string_lossy().into_owned(), std::fs::read_to_string(e.path()).ok()?)))
        .take(50)
        .collect();
    out.sort();
    out
}

/// Writes ships.json from an imported profile.
#[tauri::command]
fn save_user_ships(handle: AppHandle, json: String) -> Result<(), String> {
    let dir = user_dir(&handle).ok_or("No Documents folder")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("ships.json"), json).map_err(|e| e.to_string())
}

/// Puts a profile's keyboard binds (or, with `backup`, a copy of the player's own binds)
/// in the game's Control Profiles list.
#[tauri::command]
fn install_profile_binds(app: State<'_, App>, xml: String, backup: Option<bool>) -> Result<String, String> {
    let channel = app.channel.lock().unwrap().clone().ok_or("Star Citizen not found")?;
    let name = if backup == Some(true) { game::BACKUP_BINDS_NAME } else { game::PROFILE_BINDS_NAME };
    game::install_profile_binds(&channel, &xml, name).map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

/// Documents\Edge Cockpit\Binds\<channel>, where copies of the player's binds are kept.
fn backup_dir(handle: &AppHandle, channel: &std::path::Path) -> Option<PathBuf> {
    let name = channel.file_name()?.to_string_lossy().into_owned();
    Some(user_dir(handle)?.join("Binds").join(name))
}

/// The kept copies of the player's binds, and whether actionmaps.xml looks wiped.
#[tauri::command]
fn binds_backups(handle: AppHandle, app: State<'_, App>) -> Option<backup::State> {
    let channel = app.channel.lock().unwrap().clone()?;
    let dir = backup_dir(&handle, &channel)?;
    let now = std::fs::read_to_string(game::actionmaps(&channel)).ok();
    Some(backup::state(&dir, now.as_deref()))
}

/// One kept copy of the player's binds, by file name.
#[tauri::command]
fn read_binds_backup(handle: AppHandle, app: State<'_, App>, file: String) -> Result<String, String> {
    let channel = app.channel.lock().unwrap().clone().ok_or("Star Citizen not found")?;
    let dir = backup_dir(&handle, &channel).ok_or("No Documents folder")?;
    backup::read(&dir, &file).map_err(|e| e.to_string())
}

/// The player keeps their binds as they are now: no more warning for the newest copy.
#[tauri::command]
fn dismiss_binds_loss(handle: AppHandle, app: State<'_, App>) -> Result<(), String> {
    let channel = app.channel.lock().unwrap().clone().ok_or("Star Citizen not found")?;
    let dir = backup_dir(&handle, &channel).ok_or("No Documents folder")?;
    backup::dismiss(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn install_binds(app: State<'_, App>) -> Result<String, String> {
    let channel = app.channel.lock().unwrap().clone().ok_or("Star Citizen not found")?;
    game::install_binds(&channel).map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

#[tauri::command]
fn run_as_admin(handle: AppHandle) -> bool {
    #[cfg(windows)]
    if win::relaunch_elevated() {
        handle.exit(0);
        return true;
    }
    let _ = handle;
    false
}

#[tauri::command]
fn quit(handle: AppHandle) {
    release_all(&handle.state::<App>());
    handle.exit(0);
}

#[derive(Serialize)]
struct PrefsView {
    autostart: bool,
    screen_off: bool,
    /// None until the screen has gone off once; then whether the backlight could be turned down.
    backlight: Option<bool>,
    version: String,
}

#[tauri::command]
fn get_prefs(handle: AppHandle, app: State<'_, App>) -> PrefsView {
    let p = app.prefs.lock().unwrap().clone();
    PrefsView {
        autostart: p.autostart,
        screen_off: p.screen_off,
        backlight: *app.ddc.lock().unwrap(),
        version: handle.package_info().version.to_string(),
    }
}

#[tauri::command]
fn set_pref(handle: AppHandle, app: State<'_, App>, name: String, value: bool) {
    let p = {
        let mut p = app.prefs.lock().unwrap();
        match name.as_str() {
            "autostart" => p.autostart = value,
            "screen_off" => p.screen_off = value,
            _ => return,
        }
        p.clone()
    };
    save_prefs(&handle, &p);
    if name == "autostart" {
        #[cfg(windows)]
        win::set_autostart(value);
        if let Some(item) = handle.try_state::<TrayAutostart>() {
            let _ = item.0.set_checked(value);
        }
    }
}

/// The tray's Start with Windows tick, kept in step with the setting.
struct TrayAutostart(CheckMenuItem<tauri::Wry>);

/// Start with Windows, ticked in the tray: saved like the setting, and the console told.
fn tray_autostart(handle: &AppHandle) {
    let p = {
        let app = handle.state::<App>();
        let mut p = app.prefs.lock().unwrap();
        p.autostart = !p.autostart;
        p.clone()
    };
    save_prefs(handle, &p);
    #[cfg(windows)]
    win::set_autostart(p.autostart);
    if let Some(item) = handle.try_state::<TrayAutostart>() {
        let _ = item.0.set_checked(p.autostart);
    }
    let _ = handle.emit("autostart", p.autostart);
}

/// Settings, Setup check and Check for updates in the tray: light the console and let it open them.
fn tray_open(handle: &AppHandle, what: &str) {
    wake(handle);
    let _ = handle.emit("tray", what);
}

/// A touch on the dark screen, or the tray: light it up, and let it sleep again in two
/// minutes if the game still isn't running.
#[tauri::command]
fn wake_screen(handle: AppHandle) {
    wake(&handle);
}

/// "Screen off now" in settings: dark until a touch, the tray or the game wakes it.
#[tauri::command]
fn sleep_screen(handle: AppHandle) {
    handle.state::<App>().wake_gen.fetch_add(1, Ordering::SeqCst);
    show_panel(&handle, true);
    set_dark(&handle, true);
}

fn wake(handle: &AppHandle) {
    let app = handle.state::<App>();
    let gen = app.wake_gen.fetch_add(1, Ordering::SeqCst) + 1;
    set_dark(handle, false);
    show_panel(handle, true);
    if app.game.load(Ordering::SeqCst) != 0 {
        return;
    }
    let h = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(120));
        let app = h.state::<App>();
        if app.wake_gen.load(Ordering::SeqCst) == gen && app.game.load(Ordering::SeqCst) == 0 {
            idle(&h);
        }
    });
}

/// Not playing: the screen goes off, or the panel hides, as the player chose.
fn idle(handle: &AppHandle) {
    let off = handle.state::<App>().prefs.lock().unwrap().screen_off;
    if off {
        show_panel(handle, true);
        set_dark(handle, true);
    } else {
        set_dark(handle, false);
        show_panel(handle, false);
    }
}

fn show_panel(handle: &AppHandle, on: bool) {
    let Some(w) = handle.get_webview_window("main") else { return };
    if on == w.is_visible().unwrap_or(!on) {
        return;
    }
    release_all(&handle.state::<App>());
    if on {
        #[cfg(windows)]
        win::show_no_activate();
        #[cfg(not(windows))]
        let _ = w.show();
        place(&w);
    } else {
        #[cfg(windows)]
        win::hide_panel();
        #[cfg(not(windows))]
        let _ = w.hide();
    }
    if let Some(item) = handle.try_state::<TrayToggle>() {
        let _ = item.0.set_text(if on { "Hide the console" } else { "Show the console" });
    }
}

/// The tray's one show/hide item, relabelled as the console comes and goes.
struct TrayToggle(MenuItem<tauri::Wry>);

/// Tray and left click: hide the console if it shows, otherwise show it.
fn toggle_panel(handle: &AppHandle) {
    let visible = handle.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false);
    let dark = handle.state::<App>().dark.load(Ordering::SeqCst);
    if visible && !dark {
        handle.state::<App>().wake_gen.fetch_add(1, Ordering::SeqCst);
        show_panel(handle, false);
    } else {
        wake(handle);
    }
}

fn set_dark(handle: &AppHandle, dark: bool) {
    let app = handle.state::<App>();
    if app.dark.swap(dark, Ordering::SeqCst) == dark {
        return;
    }
    release_all(&app);
    let _ = handle.emit("screen", dark);
    app.phones.broadcast("screen", serde_json::Value::Bool(dark));
    // DDC/CI takes tens of milliseconds a call, so it runs off the UI thread.
    let h = handle.clone();
    std::thread::spawn(move || {
        let Some(w) = h.get_webview_window("main") else { return };
        let Some((x, y, wd, ht)) = edge_rect(&w) else { return };
        let app = h.state::<App>();
        #[cfg(windows)]
        {
            if dark {
                let had = win::backlight(x, y, wd, ht, Some(0));
                *app.ddc.lock().unwrap() = Some(had.is_some());
                if let Some(level) = had.filter(|l| *l > 0) {
                    let mut p = app.prefs.lock().unwrap();
                    p.saved_backlight = Some(level);
                    save_prefs(&h, &p);
                }
            } else {
                let saved = app.prefs.lock().unwrap().saved_backlight.take();
                if let Some(level) = saved {
                    win::backlight(x, y, wd, ht, Some(level));
                    save_prefs(&h, &app.prefs.lock().unwrap());
                }
            }
        }
        #[cfg(not(windows))]
        let _ = (app, x, y, wd, ht);
    });
}

/// Night mode's backlight: Some(level) turns the console's display down to `level` percent
/// (keeping the day level to put back), None puts the day level back. While the screen is
/// off only the level to wake to changes. Returns whether the display answered DDC/CI.
#[tauri::command]
async fn night_backlight(handle: AppHandle, level: Option<u32>) -> Result<Option<bool>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let w = handle.get_webview_window("main")?;
        let (x, y, wd, ht) = edge_rect(&w)?;
        let app = handle.state::<App>();
        let dark = app.dark.load(Ordering::SeqCst);
        #[cfg(windows)]
        let set = |l: Option<u32>| win::backlight(x, y, wd, ht, l);
        #[cfg(not(windows))]
        let set = |_: Option<u32>| -> Option<u32> {
            let _ = (x, y, wd, ht);
            None
        };
        let mut p = app.prefs.lock().unwrap();
        let ok = match level {
            Some(l) => {
                // The day level: while the screen is off it is the level to wake to.
                let day = if dark { p.saved_backlight } else { set(None) };
                if p.night_saved.is_none() {
                    p.night_saved = day.filter(|d| *d > l);
                }
                if p.night_saved.is_none() {
                    // Already at or below the night level: nothing to do.
                    Some(day.is_some())
                } else if dark {
                    p.saved_backlight = Some(l);
                    Some(true)
                } else {
                    Some(set(Some(l)).is_some())
                }
            }
            None => match p.night_saved.take() {
                Some(day) if dark => {
                    p.saved_backlight = Some(day);
                    Some(true)
                }
                Some(day) => Some(set(Some(day)).is_some()),
                None => None,
            },
        };
        save_prefs(&handle, &p);
        if let Some(answered) = ok {
            *app.ddc.lock().unwrap() = Some(answered);
        }
        ok
    })
    .await
    .map_err(|e| e.to_string())
}

/// Star Citizen started: wake the screen, show the panel and wait for it to exit.
#[cfg_attr(not(windows), allow(dead_code))]
fn game_started(handle: &AppHandle, pid: u32) {
    let app = handle.state::<App>();
    if app.game.swap(pid, Ordering::SeqCst) == pid {
        return;
    }
    app.rescan.store(true, Ordering::SeqCst);
    wake(handle);
    let h = handle.clone();
    std::thread::spawn(move || {
        #[cfg(windows)]
        {
            // Waiting on the process handle costs nothing; polling is the fallback for when
            // Windows won't hand us one (an elevated game seen from a normal panel).
            if !win::wait_exit(pid) {
                while win::alive(pid) {
                    std::thread::sleep(Duration::from_secs(5));
                }
            }
            win::forget_game();
        }
        let app = h.state::<App>();
        if app.game.compare_exchange(pid, 0, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            app.rescan.store(true, Ordering::SeqCst);
            idle(&h);
        }
    });
}

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    notes: String,
    date: Option<String>,
}

/// Asks GitHub whether a newer release exists. The UI calls this at start and rarely after,
/// never while the game runs.
#[tauri::command]
async fn check_update(handle: AppHandle, app: State<'_, App>) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let found = handle.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = found.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone().unwrap_or_default(),
        date: u.date.map(|d| d.to_string()),
    });
    *app.update.lock().unwrap() = found;
    Ok(info)
}

/// Commodity prices for the Verse page: fresh every 30 minutes, else the last ones saved, marked offline.
#[tauri::command]
async fn world_prices(handle: AppHandle, app: State<'_, App>) -> Result<world::Market, String> {
    let file = handle.path().app_local_data_dir().ok().map(|d| d.join("world-prices.json"));
    world::prices(&app.world, file).await
}

/// The Map page chart's bodies and places, fetched once a week and kept for offline use.
#[tauri::command]
async fn world_chart(handle: AppHandle, app: State<'_, App>) -> Result<world::Chart, String> {
    let file = handle.path().app_local_data_dir().ok().map(|d| d.join("world-chart.json"));
    world::chart_data(&app.world, file).await
}

/// RSI's server status for the Verse page, at most every 5 minutes.
#[tauri::command]
async fn world_status(app: State<'_, App>) -> Result<world::Status, String> {
    world::status(&app.world).await
}

/// Downloads and runs the new installer, which closes the app and starts the new one.
#[tauri::command]
async fn install_update(handle: AppHandle, app: State<'_, App>) -> Result<(), String> {
    let update = app.update.lock().unwrap().take().ok_or("no update")?;
    release_all(&app);
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    handle.restart();
}

/// The Edge is the only common display wider than 3:1. Otherwise use the last
/// non-primary display, or the primary one in a window (for development).
/// The display to use, as (x, y, width, height). A display picked in Settings wins
/// while it is connected. Otherwise: a touchscreen that isn't the main display, then
/// any display at least 3:1 wide (the Edge is 32:9), then any display but the main one.
fn edge_rect(w: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    let picked = w.state::<App>().prefs.lock().unwrap().display.clone();
    let list = display_list(w);
    pick_display(&list, picked.as_deref()).map(|d| d.rect)
}

#[derive(Serialize, Clone)]
struct DisplayView {
    id: String,
    name: String,
    width: i32,
    height: i32,
    primary: bool,
    touch: bool,
    scale: u32,
}

#[derive(Clone)]
struct Disp {
    id: String,
    name: String,
    rect: (i32, i32, i32, i32),
    primary: bool,
    touch: bool,
    /// The display's scale in percent (Windows' "Scale" setting).
    scale: u32,
}

fn display_list(w: &WebviewWindow) -> Vec<Disp> {
    #[cfg(windows)]
    {
        let _ = w;
        win::displays()
            .into_iter()
            .map(|d| Disp { id: d.id, name: d.name, rect: d.rect, primary: d.primary, touch: d.touch, scale: d.scale })
            .collect()
    }
    #[cfg(not(windows))]
    {
        let primary = w.primary_monitor().ok().flatten();
        w.available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|m| {
                let id = m.name().cloned().unwrap_or_default();
                Disp {
                    name: id.clone(),
                    id,
                    rect: (m.position().x, m.position().y, m.size().width as i32, m.size().height as i32),
                    primary: primary.as_ref().is_some_and(|p| p.position() == m.position()),
                    touch: false,
                    scale: (m.scale_factor() * 100.0).round() as u32,
                }
            })
            .collect()
    }
}

fn pick_display<'a>(list: &'a [Disp], picked: Option<&str>) -> Option<&'a Disp> {
    if let Some(p) = picked {
        if let Some(d) = list.iter().find(|d| d.id == p).or_else(|| list.iter().find(|d| d.name == p)) {
            return Some(d);
        }
    }
    let wide = |d: &&Disp| d.rect.2 as f64 / d.rect.3.max(1) as f64 >= 3.0;
    list.iter()
        .find(|d| d.touch && !d.primary)
        .or_else(|| list.iter().find(wide))
        .or_else(|| list.iter().find(|d| !d.primary))
}

#[derive(Serialize)]
struct Displays {
    list: Vec<DisplayView>,
    /// What Settings picked, or None for automatic.
    picked: Option<String>,
    /// The display the console is on now.
    current: Option<String>,
    /// False when Windows has touchscreens but none of them on the console's display,
    /// so touches land on another display.
    touch_ok: bool,
    /// The console's size after its last move, against its display's.
    fit: Option<Fit>,
}

#[tauri::command]
fn displays(handle: AppHandle, app: State<'_, App>) -> Displays {
    let picked = app.prefs.lock().unwrap().display.clone();
    let Some(w) = handle.get_webview_window("main") else {
        return Displays { list: vec![], picked, current: None, touch_ok: true, fit: None };
    };
    let list = display_list(&w);
    let cur = pick_display(&list, picked.as_deref()).cloned();
    let touch_ok = !list.iter().any(|d| d.touch) || cur.as_ref().is_none_or(|c| c.touch);
    Displays {
        list: list
            .iter()
            .map(|d| DisplayView { id: d.id.clone(), name: d.name.clone(), width: d.rect.2, height: d.rect.3, primary: d.primary, touch: d.touch, scale: d.scale })
            .collect(),
        current: cur.map(|c| c.id),
        picked,
        touch_ok,
        fit: *app.fit.lock().unwrap(),
    }
}

/// Picks the display for the console (None: automatic) and moves it there now.
#[tauri::command]
fn set_display(handle: AppHandle, app: State<'_, App>, id: Option<String>) {
    let p = {
        let mut p = app.prefs.lock().unwrap();
        p.display = id;
        p.clone()
    };
    save_prefs(&handle, &p);
    if let Some(w) = handle.get_webview_window("main") {
        place(&w);
    }
}

/// Opens Windows' touchscreen setup, for touches that land on the wrong display.
#[tauri::command]
fn fix_touch() -> bool {
    #[cfg(windows)]
    return win::fix_touch();
    #[cfg(not(windows))]
    false
}

/// Moves the console onto its display again and says whether it now fills it.
#[tauri::command]
fn refit(handle: AppHandle) -> bool {
    if let Some(w) = handle.get_webview_window("main") {
        place(&w);
    }
    let _ = handle.emit("displays", ());
    handle.state::<App>().fit.lock().unwrap().is_none_or(|f| f.want == f.got)
}

/// Shows each display's name on that display for a few seconds, without taking focus.
#[tauri::command]
fn identify_screens(handle: AppHandle) {
    let Some(w) = handle.get_webview_window("main") else { return };
    let list = display_list(&w);
    let current = pick_display(&list, handle.state::<App>().prefs.lock().unwrap().display.as_deref()).map(|d| d.id.clone());
    let mut labels = Vec::new();
    for (i, d) in list.iter().enumerate() {
        let label = format!("identify-{i}");
        if let Some(old) = handle.get_webview_window(&label) {
            let _ = old.close();
        }
        let (bw, bh) = (720.min(d.rect.2), 200.min(d.rect.3));
        let q = format!(
            "identify.html?name={}&size={}&note={}",
            url_part(&d.name, 80),
            url_part(&format!("{} × {} · {} % scale", d.rect.2, d.rect.3, d.scale), 80),
            url_part(if Some(&d.id) == current.as_ref() { "The console is here" } else { "" }, 40),
        );
        let made = tauri::WebviewWindowBuilder::new(&handle, &label, tauri::WebviewUrl::App(q.into()))
            .decorations(false)
            .always_on_top(true)
            .focused(false)
            .skip_taskbar(true)
            .resizable(false)
            .visible(false)
            .build();
        if let Ok(b) = made {
            // Position first, so the size is taken at the scale of that display.
            let _ = b.set_position(PhysicalPosition::new(d.rect.0 + (d.rect.2 - bw) / 2, d.rect.1 + (d.rect.3 - bh) / 2));
            let _ = b.set_size(tauri::PhysicalSize::new(bw as u32, bh as u32));
            let _ = b.set_position(PhysicalPosition::new(d.rect.0 + (d.rect.2 - bw) / 2, d.rect.1 + (d.rect.3 - bh) / 2));
            let _ = b.show();
            labels.push(label);
        }
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        for l in labels {
            if let Some(b) = handle.get_webview_window(&l) {
                let _ = b.close();
            }
        }
    });
}

fn place(w: &WebviewWindow) {
    match edge_rect(w) {
        Some((x, y, wd, ht)) => {
            #[cfg(windows)]
            let got = win::place(x, y, wd, ht);
            #[cfg(not(windows))]
            let got = {
                let _ = w.set_position(PhysicalPosition::new(x, y));
                let _ = w.set_size(tauri::PhysicalSize::new(wd as u32, ht as u32));
                w.outer_size().ok().map(|s| (x, y, s.width as i32, s.height as i32))
            };
            if let Some(g) = got {
                record_fit(w.app_handle(), (x, y, wd, ht), g);
            }
        }
        None => {
            // Only one display: a 2560 x 720 window on it, at half size in points, so a Retina
            // screen shows it at full resolution and labels stay readable.
            let _ = w.set_size(tauri::LogicalSize::new(1280.0, 360.0));
            let _ = w.set_position(PhysicalPosition::new(40, 40));
        }
    }
}

/// Keeps the console's size against its display's, for Settings and the setup check.
fn record_fit(handle: &AppHandle, want: fit::Rect, got: fit::Rect) {
    let f = Fit { want: (want.2, want.3), got: (got.2, got.3) };
    let changed = handle.state::<App>().fit.lock().unwrap().replace(f) != Some(f);
    if changed {
        let _ = handle.emit("displays", ());
    }
}

/// Whether actionmaps.xml changed since the last look. The first sighting only records it:
/// the console reads the binds anyway when it finds the game.
fn binds_changed(seen: &mut Option<std::time::SystemTime>, now: Option<std::time::SystemTime>) -> bool {
    let changed = seen.is_some() && now.is_some() && *seen != now;
    if now.is_some() {
        *seen = now;
    }
    changed
}

/// Game.log lines for the console, and for phones (who also get them later, on connecting).
fn emit_log(handle: &AppHandle, batch: LogBatch) {
    handle.state::<App>().phones.log_batch(&batch.lines, batch.live, batch.reset);
    let _ = handle.emit("game-log", batch);
}

/// Follows the newest Game.log and sends its lines to the UI.
fn watch_game(handle: AppHandle) {
    std::thread::spawn(move || {
        let mut tail: Option<game::Tail> = None;
        let mut since_scan = Duration::MAX;
        let mut quiet = Duration::ZERO;
        // actionmaps.xml: the game rewrites it when you change a bind or pick a control profile.
        let mut binds_seen: Option<std::time::SystemTime> = None;
        let mut backup_seen: Option<std::time::SystemTime> = None;
        let mut since_binds = Duration::ZERO;
        loop {
            // Look for the channel every few seconds (less often once found), preferring the
            // one the running game is in.
            let asked = handle.state::<App>().rescan.swap(false, Ordering::SeqCst);
            let every = if tail.is_some() { Duration::from_secs(15) } else { Duration::from_secs(5) };
            if asked || since_scan >= every {
                since_scan = Duration::ZERO;
                #[cfg(windows)]
                let from_exe = win::foreground_exe().and_then(|e| game::channel_from_exe(&e));
                #[cfg(not(windows))]
                let from_exe: Option<PathBuf> = None;
                let found = from_exe.or_else(|| game::find_channel(None));
                let state = handle.state::<App>();
                let ready = state.ui_ready.load(Ordering::SeqCst);
                let mut ch = state.channel.lock().unwrap();
                if let Some(c) = found.filter(|c| ready && Some(c) != ch.as_ref()) {
                    let _ = game::install_binds(&c);
                    let mut t = game::Tail::new(c.join("Game.log"));
                    let lines = t.poll();
                    emit_log(&handle, LogBatch { lines, live: false, reset: true });
                    tail = Some(t);
                    *ch = Some(c);
                }
            }
            if let Some(t) = tail.as_mut() {
                let lines = t.poll();
                if std::mem::take(&mut t.restarted) {
                    // The game started over: the console starts over too, as on first load.
                    quiet = Duration::ZERO;
                    emit_log(&handle, LogBatch { lines, live: false, reset: true });
                } else if lines.is_empty() {
                    quiet = quiet.saturating_add(game::POLL);
                } else {
                    quiet = Duration::ZERO;
                    emit_log(&handle, LogBatch { lines, live: true, reset: false });
                }
            }
            since_binds = since_binds.saturating_add(game::POLL);
            if since_binds >= Duration::from_secs(2) {
                since_binds = Duration::ZERO;
                let path = handle.state::<App>().channel.lock().unwrap().as_ref().map(|c| game::actionmaps(c));
                let now = path.as_ref().and_then(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
                // A copy of the binds on every change, the first sighting included, before the UI hears of it.
                if now.is_some() && now != backup_seen {
                    backup_seen = now;
                    let channel = handle.state::<App>().channel.lock().unwrap().clone();
                    let dir = channel.as_deref().and_then(|c| backup_dir(&handle, c));
                    if let (Some(dir), Some(xml)) = (dir, path.as_ref().and_then(|p| std::fs::read_to_string(p).ok())) {
                        let _ = backup::keep(&dir, &xml, std::time::SystemTime::now());
                    }
                    // Our Control Profile follows the player's binds, so loading it adds only what's missing.
                    if let Some(c) = channel.as_deref() {
                        let _ = game::install_binds(c);
                    }
                }
                if binds_changed(&mut binds_seen, now) {
                    let _ = handle.emit("binds", ());
                }
            }
            // Quick while the log is busy, and slower once nothing has happened for a while.
            let wait = if quiet > Duration::from_secs(30) { game::POLL_IDLE } else { game::POLL };
            std::thread::sleep(wait);
            since_scan = since_scan.saturating_add(wait);
            if quiet > Duration::from_secs(30) {
                quiet = quiet.saturating_add(wait - game::POLL);
            }
        }
    });
}

// ---------- phones ----------

/// Settings > Phones: the address, code and QR to pair, and the paired phones.
#[tauri::command]
fn phones_view(app: State<'_, App>) -> phone::View {
    app.phones.view()
}

/// Phones on this network, on or off. Windows asks once to let the app through its firewall.
#[tauri::command]
fn phones_enable(handle: AppHandle, app: State<'_, App>, on: bool) {
    let p = {
        let mut p = app.prefs.lock().unwrap();
        p.phones = on;
        p.clone()
    };
    save_prefs(&handle, &p);
    app.phones.set_enabled(on);
    if on {
        phone::start(std::sync::Arc::new(PhoneHost(handle.clone())));
    }
    let _ = handle.emit("phones", ());
}

/// A phone's plate (swipe, status, power, role, flight or gear) and mode (copy or move).
#[tauri::command]
fn phones_set(handle: AppHandle, app: State<'_, App>, id: String, plate: Option<String>, mode: Option<String>) {
    app.phones.configure(&id, plate.as_deref(), mode.as_deref());
    let _ = handle.emit("phones", ());
}

#[tauri::command]
fn phones_forget(handle: AppHandle, app: State<'_, App>, id: String) {
    app.phones.forget(&id);
    let _ = handle.emit("phones", ());
}

/// Console state this screen changed (a switch set, the page), for every phone.
#[tauri::command]
fn share(app: State<'_, App>, s: serde_json::Map<String, serde_json::Value>) {
    app.phones.share(&s, None);
}

/// The app as phones see it: its files, and the commands a phone may run.
struct PhoneHost(AppHandle);

impl phone::Host for PhoneHost {
    fn phones(&self) -> &phone::Phones {
        &self.0.state::<App>().inner().phones
    }

    fn asset(&self, path: &str) -> Option<(Vec<u8>, String)> {
        let a = self.0.asset_resolver().get(path.to_string())?;
        Some((a.bytes().to_vec(), a.mime_type().to_string()))
    }

    fn call(&self, cmd: &str, args: &serde_json::Value, held: &mut HashSet<String>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<serde_json::Value, String>> + Send + '_>> {
        use serde_json::{to_value, Value};
        let cmd = cmd.to_string();
        let args = args.clone();
        let spec = args["spec"].as_str().map(str::to_string);
        let mode = args["mode"].as_str().unwrap_or("tap").to_string();
        // Hold keys this phone has down, so they can be let go if it drops.
        match (spec.as_deref(), mode.as_str()) {
            (Some(s), "down") if cmd == "key" => { held.insert(s.to_string()); }
            (Some(s), "up") if cmd == "key" => { held.remove(s); }
            _ => {}
        }
        let mine: Vec<String> = if cmd == "release_keys" { held.drain().collect() } else { Vec::new() };
        Box::pin(async move {
            let h = &self.0;
            let app = h.state::<App>();
            let anywhere = args["anywhere"].as_bool().unwrap_or(false);
            match cmd.as_str() {
                "key" => send_key(&app, spec.ok_or("no key")?, mode, args["ms"].as_u64(), anywhere).await.map(|_| Value::Null),
                "game_action" => {
                    let link = app.link.clone();
                    let action = args["action"].as_str().ok_or("no action")?.to_string();
                    link.trigger(&action, None).await.map(Value::from)
                }
                "wheel" => wheel(args["clicks"].as_i64().unwrap_or(0).clamp(-50, 50) as i32, anywhere).map(|_| Value::Null),
                "release_keys" => {
                    self.release(mine.into_iter().collect());
                    Ok(Value::Null)
                }
                "game_info" => to_value(game_info(app)).map_err(|e| e.to_string()),
                "read_binds" => to_value(read_binds(app)).map_err(|e| e.to_string()),
                "user_ships" => to_value(user_ships(h.clone())).map_err(|e| e.to_string()),
                "get_prefs" => to_value(get_prefs(h.clone(), app)).map_err(|e| e.to_string()),
                "world_prices" => to_value(world_prices(h.clone(), app).await?).map_err(|e| e.to_string()),
                "world_status" => to_value(world_status(app).await?).map_err(|e| e.to_string()),
                "world_chart" => to_value(world_chart(h.clone(), app).await?).map_err(|e| e.to_string()),
                "wake_screen" => {
                    let h2 = h.clone();
                    let _ = h.run_on_main_thread(move || wake(&h2));
                    Ok(Value::Null)
                }
                // This PC's console hears what a phone changed.
                "share_local" => {
                    let _ = h.emit("shared", &args["s"]);
                    Ok(Value::Null)
                }
                "check_update" | "load_profile" | "displays" | "perf" => Ok(Value::Null),
                _ => Err("Only on the PC".into()),
            }
        })
    }

    fn changed(&self) {
        let _ = self.0.emit("phones", ());
    }

    fn release(&self, held: HashSet<String>) {
        for spec in held {
            if let Ok(_c) = keys::chord(&spec) {
                self.0.state::<App>().held.lock().unwrap().remove(&spec);
                #[cfg(windows)]
                let _ = win::send(&_c, true);
            }
        }
    }
}

fn tray(handle: &AppHandle) -> tauri::Result<()> {
    let version = MenuItem::with_id(handle, "version", format!("Edge Cockpit {}", handle.package_info().version), false, None::<&str>)?;
    let toggle = MenuItem::with_id(handle, "toggle", "Hide the console", true, None::<&str>)?;
    let settings = MenuItem::with_id(handle, "settings", "Settings", true, None::<&str>)?;
    let setup = MenuItem::with_id(handle, "setup", "Setup check", true, None::<&str>)?;
    let on = handle.state::<App>().prefs.lock().unwrap().autostart;
    let autostart = CheckMenuItem::with_id(handle, "autostart", "Start with Windows", true, on, None::<&str>)?;
    let update = MenuItem::with_id(handle, "update", "Check for updates", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(handle, "quit", "Quit", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(handle);
    let items: [&dyn tauri::menu::IsMenuItem<tauri::Wry>; 10] =
        [&version, &sep()?, &toggle, &settings, &setup, &sep()?, &autostart, &update, &sep()?, &quit_item];
    let menu = Menu::with_items(handle, &items)?;
    handle.manage(TrayToggle(toggle));
    handle.manage(TrayAutostart(autostart));
    TrayIconBuilder::with_id("tray")
        .icon(handle.default_window_icon().cloned().ok_or(tauri::Error::InvalidIcon(std::io::Error::other("no icon")))?)
        .tooltip("Edge Cockpit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, ev| {
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = ev {
                toggle_panel(tray.app_handle());
            }
        })
        .on_menu_event(move |app, ev| match ev.id().as_ref() {
            "toggle" => toggle_panel(app),
            "autostart" => tray_autostart(app),
            id @ ("settings" | "setup" | "update") => tray_open(app, id),
            "quit" => quit(app.clone()),
            _ => {}
        })
        .build(handle)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Starting the app again (from the Start menu while it sits in the tray) shows it.
        .plugin(tauri_plugin_single_instance::init(|h, _, _| wake(h)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(App::default())
        .invoke_handler(tauri::generate_handler![
            key, wheel, ui_ready, user_ships, past_logs, release_keys, game_info, read_binds, install_binds, run_as_admin, quit,
            save_profile, load_profile, save_user_ships, install_profile_binds, binds_backups, read_binds_backup, dismiss_binds_loss, save_page, page_files,
            get_prefs, set_pref, wake_screen, sleep_screen, check_update, install_update, perf,
            displays, set_display, fix_touch, refit, identify_screens, night_backlight, report_issue, report_info, save_report, world_prices, world_status, world_chart,
            phones_view, phones_enable, phones_set, phones_forget, share,
            telemetry_now, game_action, telemetry_setup, telemetry_enable, telemetry_record
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let (prefs, first_run) = load_prefs(&handle);
            #[cfg(windows)]
            if prefs.autostart {
                // Also keeps the path right after the app moves or updates.
                win::set_autostart(true);
            }
            if first_run {
                save_prefs(&handle, &prefs);
            }
            let phones_on = prefs.phones;
            *app.state::<App>().prefs.lock().unwrap() = prefs;
            if let Ok(dir) = handle.path().app_config_dir() {
                app.state::<App>().phones.load(dir.join("phones.json"), phones_on);
            }
            if phones_on {
                phone::start(std::sync::Arc::new(PhoneHost(handle.clone())));
            }
            let w = app.get_webview_window("main").expect("main window");
            #[cfg(windows)]
            {
                let raw = w.hwnd()?.0 as isize;
                let (x, y, wd, ht) = edge_rect(&w).unwrap_or((40, 40, 1600, 450));
                let got = win::setup_panel(raw, x, y, wd, ht);
                record_fit(&handle, (x, y, wd, ht), got);
            }
            #[cfg(not(windows))]
            {
                place(&w);
                w.show()?;
            }
            tray(app.handle())?;
            watch_game(app.handle().clone());
            watch_link(app.handle().clone());
            // The game coming to the front counts as it starting; one snapshot covers a game
            // that was already running.
            #[cfg(windows)]
            {
                let h = handle.clone();
                win::on_game_seen(move |pid| {
                    let h2 = h.clone();
                    let _ = h.run_on_main_thread(move || game_started(&h2, pid));
                });
                if let Some(pid) = win::find_game() {
                    win::knows_game(pid);
                    game_started(&handle, pid);
                }
            }
            if handle.state::<App>().game.load(Ordering::SeqCst) == 0 {
                if std::env::args().any(|a| a == "--background") {
                    idle(&handle);
                } else {
                    wake(&handle);
                }
            }
            // Displays come and go (the Edge sleeping, a resolution change): Windows says so
            // with WM_DISPLAYCHANGE, and the console moves to the right display again.
            #[cfg(windows)]
            {
                let h = handle.clone();
                win::on_display_change(move || {
                    let h2 = h.clone();
                    let _ = h.run_on_main_thread(move || {
                        if let Some(w) = h2.get_webview_window("main") {
                            place(&w);
                        }
                        let _ = h2.emit("displays", ());
                    });
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Edge Cockpit");
}

#[cfg(test)]
mod tests {
    use super::{pick_display, Disp};

    fn d(id: &str, name: &str, w: i32, h: i32, primary: bool, touch: bool) -> Disp {
        Disp { id: id.into(), name: name.into(), rect: (0, 0, w, h), primary, touch, scale: 100 }
    }

    #[test]
    fn binds_change_only_after_the_first_sighting() {
        use std::time::{Duration, UNIX_EPOCH};
        let (a, b) = (UNIX_EPOCH + Duration::from_secs(1), UNIX_EPOCH + Duration::from_secs(2));
        let mut seen = None;
        assert!(!super::binds_changed(&mut seen, None), "no file yet");
        assert!(!super::binds_changed(&mut seen, Some(a)), "first sighting");
        assert!(!super::binds_changed(&mut seen, Some(a)), "unchanged");
        assert!(super::binds_changed(&mut seen, Some(b)), "rewritten");
        assert!(!super::binds_changed(&mut seen, None), "gone for a moment");
        assert!(!super::binds_changed(&mut seen, Some(b)), "back, unchanged");
    }

    #[test]
    fn names_page_files_safely() {
        assert_eq!(super::page_file("My Gladius"), "My Gladius.json");
        assert_eq!(super::page_file("..\\..\\evil/../x"), "evilx.json");
        assert_eq!(super::page_file("  "), "Page.json");
        assert_eq!(super::page_file(&"a".repeat(80)).len(), 45);
    }

    #[test]
    fn encodes_issue_text_for_a_url() {
        assert_eq!(super::url_part("Log lines missing: 4.10 & más", 100), "Log%20lines%20missing%3A%204.10%20%26%20m%C3%A1s");
        assert_eq!(super::url_part("abcdef", 3), "abc");
    }

    #[test]
    fn picks_the_touchscreen_then_a_wide_display_then_any_other() {
        let main = d("1", "DELL", 2560, 1440, true, false);
        let edge = d("2", "XENEON EDGE", 2560, 720, false, true);
        let side = d("3", "LG", 1920, 1080, false, false);
        let id = |l: &[Disp], p: Option<&str>| pick_display(l, p).map(|x| x.id.clone());
        assert_eq!(id(&[main.clone(), side.clone(), edge.clone()], None).as_deref(), Some("2"));
        let edge_no_touch = d("2", "XENEON EDGE", 2560, 720, false, false);
        assert_eq!(id(&[main.clone(), side.clone(), edge_no_touch], None).as_deref(), Some("2"));
        assert_eq!(id(&[main.clone(), side.clone()], None).as_deref(), Some("3"));
        assert_eq!(id(std::slice::from_ref(&main), None), None);
        // A picked display wins, by GDI name or monitor name, and is ignored once it's gone.
        assert_eq!(id(&[main.clone(), side.clone(), edge.clone()], Some("LG")).as_deref(), Some("3"));
        assert_eq!(id(&[main.clone(), side.clone(), edge.clone()], Some("1")).as_deref(), Some("1"));
        assert_eq!(id(&[main, side, edge], Some("gone")).as_deref(), Some("2"));
    }
}
