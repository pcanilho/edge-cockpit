//! Windows only: sending keys, keeping the game in front, elevation, seeing the game
//! start and stop, the Edge backlight and starting with Windows.
//!
//! The panel window is WS_EX_NOACTIVATE, so touching it never activates it. WebView2
//! can still move focus on its own, so a foreground hook hands the foreground straight
//! back to the window that had it (normally the game) whenever the panel gets it.

use crate::keys::Key;
use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use std::sync::OnceLock;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY,
    KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, MOUSEEVENTF_WHEEL, MOUSEINPUT, VIRTUAL_KEY,
};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
};
use windows::Win32::UI::Shell::{DefSubclassProc, IsUserAnAdmin, SetWindowSubclass, ShellExecuteW};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowLongPtrW, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, EVENT_SYSTEM_FOREGROUND, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SW_SHOWNOACTIVATE, SW_SHOWNORMAL, WINEVENT_OUTOFCONTEXT,
    WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
};

static PANEL: AtomicIsize = AtomicIsize::new(0);
static LAST_OTHER: AtomicIsize = AtomicIsize::new(0);
static OUR_PID: AtomicU32 = AtomicU32::new(0);
/// The game process we already know about, and the last other process we checked.
static GAME_PID: AtomicU32 = AtomicU32::new(0);
static NOT_GAME: AtomicU32 = AtomicU32::new(0);
static ON_GAME: OnceLock<Box<dyn Fn(u32) + Send + Sync>> = OnceLock::new();

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

fn is_game(exe: &str) -> bool {
    exe.to_ascii_lowercase().ends_with("starcitizen.exe")
}

/// Calls `f` with the game's process id when a Star Citizen window comes to the front.
/// Driven by the foreground hook, so it costs nothing while nothing changes.
pub fn on_game_seen(f: impl Fn(u32) + Send + Sync + 'static) {
    let _ = ON_GAME.set(Box::new(f));
}

/// Forgets the game process, so its next window counts as a new start.
pub fn forget_game() {
    GAME_PID.store(0, Ordering::SeqCst);
}

pub fn knows_game(pid: u32) {
    GAME_PID.store(pid, Ordering::SeqCst);
}

fn hwnd(v: isize) -> HWND {
    HWND(v as *mut _)
}

fn pid_of(w: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(w, Some(&mut pid)) };
    pid
}

/// Makes the panel a top-most tool window that never activates, shows it without
/// taking focus, and starts the foreground hook. Call once, from the UI thread.
pub fn setup_panel(raw: isize, x: i32, y: i32, w: i32, h: i32) {
    PANEL.store(raw, Ordering::SeqCst);
    OUR_PID.store(std::process::id(), Ordering::SeqCst);
    let win = hwnd(raw);
    unsafe {
        let ex = GetWindowLongPtrW(win, GWL_EXSTYLE) as u32;
        let ex = (ex | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0) & !WS_EX_APPWINDOW.0;
        SetWindowLongPtrW(win, GWL_EXSTYLE, ex as isize);
        let _ = SetWindowPos(win, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE | SWP_FRAMECHANGED);
        // No frame at all: Windows 11 rounds corners and draws a 1px border on top-level
        // windows, even borderless ones, unless told not to.
        let no_round = DWMWCP_DONOTROUND;
        let _ = DwmSetWindowAttribute(win, DWMWA_WINDOW_CORNER_PREFERENCE, &no_round as *const _ as *const _, std::mem::size_of_val(&no_round) as u32);
        let no_border: u32 = DWMWA_COLOR_NONE;
        let _ = DwmSetWindowAttribute(win, DWMWA_BORDER_COLOR, &no_border as *const _ as *const _, 4);
        // Mouse, pen and touch each ask the window whether a press should activate it.
        let _ = SetWindowSubclass(win, Some(no_activate), 1, 0);
        let _ = ShowWindow(win, SW_SHOWNOACTIVATE);
        let fg = GetForegroundWindow();
        if pid_of(fg) != std::process::id() {
            LAST_OTHER.store(fg.0 as isize, Ordering::SeqCst);
        }
        // Out of context hooks run on this thread's message loop (Tauri's).
        let _: HWINEVENTHOOK = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
    }
}

/// Shows the panel again after it was hidden, without taking focus.
pub fn show_no_activate() {
    let raw = PANEL.load(Ordering::SeqCst);
    if raw != 0 {
        unsafe {
            let _ = ShowWindow(hwnd(raw), SW_SHOWNOACTIVATE);
        }
    }
}

/// Re-applies size and top-most, for when the display layout changes.
pub fn place(x: i32, y: i32, w: i32, h: i32) {
    let raw = PANEL.load(Ordering::SeqCst);
    if raw != 0 {
        unsafe {
            let _ = SetWindowPos(hwnd(raw), Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE);
        }
    }
}

const WM_MOUSEACTIVATE: u32 = 0x0021;
const WM_POINTERACTIVATE: u32 = 0x024B;
const MA_NOACTIVATE: isize = 3;
const PA_NOACTIVATE: isize = 3;

unsafe extern "system" fn no_activate(w: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
    match msg {
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE),
        WM_POINTERACTIVATE => LRESULT(PA_NOACTIVATE),
        _ => unsafe { DefSubclassProc(w, msg, wp, lp) },
    }
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    w: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if w.0.is_null() {
        return;
    }
    if pid_of(w) == OUR_PID.load(Ordering::SeqCst) {
        // We got the foreground (WebView2 moved focus): give it back.
        let prev = hwnd(LAST_OTHER.load(Ordering::SeqCst));
        if !prev.0.is_null() && unsafe { IsWindow(Some(prev)) }.as_bool() {
            let _ = unsafe { SetForegroundWindow(prev) };
        }
    } else {
        LAST_OTHER.store(w.0 as isize, Ordering::SeqCst);
        let pid = pid_of(w);
        if pid != GAME_PID.load(Ordering::SeqCst) && pid != NOT_GAME.load(Ordering::SeqCst) {
            if exe_of_pid(pid).is_some_and(|e| is_game(&e)) {
                GAME_PID.store(pid, Ordering::SeqCst);
                if let Some(f) = ON_GAME.get() {
                    f(pid);
                }
            } else {
                NOT_GAME.store(pid, Ordering::SeqCst);
            }
        }
    }
}

/// The running Star Citizen process, found with one process snapshot (used once at start).
pub fn find_game() -> Option<u32> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = None;
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                if String::from_utf16_lossy(&e.szExeFile[..len]).eq_ignore_ascii_case("StarCitizen.exe") {
                    found = Some(e.th32ProcessID);
                    break;
                }
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        found
    }
}

/// Blocks until the process exits. False if Windows would not let us wait on it.
pub fn wait_exit(pid: u32) -> bool {
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE};
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) else { return false };
        WaitForSingleObject(h, INFINITE);
        let _ = CloseHandle(h);
        true
    }
}

/// True while a process with this id is still running.
pub fn alive(pid: u32) -> bool {
    use windows::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    const STILL_ACTIVE: u32 = 259;
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code).is_ok();
        let _ = CloseHandle(h);
        ok && code == STILL_ACTIVE
    }
}

/// Reads the backlight (VCP 0x10) of the display under the rectangle over DDC/CI and,
/// with `level`, sets it. Returns the level it had, or None when the display does not
/// answer DDC/CI.
pub fn backlight(x: i32, y: i32, w: i32, h: i32, level: Option<u32>) -> Option<u32> {
    use windows::Win32::Devices::Display::{
        DestroyPhysicalMonitors, GetNumberOfPhysicalMonitorsFromHMONITOR, GetPhysicalMonitorsFromHMONITOR,
        GetVCPFeatureAndVCPFeatureReply, SetVCPFeature, PHYSICAL_MONITOR,
    };
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONULL};
    unsafe {
        let mon = MonitorFromPoint(POINT { x: x + w / 2, y: y + h / 2 }, MONITOR_DEFAULTTONULL);
        if mon.is_invalid() {
            return None;
        }
        let mut n = 0u32;
        GetNumberOfPhysicalMonitorsFromHMONITOR(mon, &mut n).ok()?;
        if n == 0 {
            return None;
        }
        let mut mons = vec![PHYSICAL_MONITOR::default(); n as usize];
        GetPhysicalMonitorsFromHMONITOR(mon, &mut mons).ok()?;
        let pm = mons[0].hPhysicalMonitor;
        let (mut cur, mut max) = (0u32, 0u32);
        let mut ok = GetVCPFeatureAndVCPFeatureReply(pm, 0x10, None, &mut cur, Some(&mut max)) != 0;
        if let Some(l) = level {
            ok = SetVCPFeature(pm, 0x10, l) != 0;
        }
        let _ = DestroyPhysicalMonitors(&mons);
        ok.then_some(cur)
    }
}

/// Starts the app hidden at sign-in (HKCU Run), or stops doing so.
pub fn set_autostart(on: bool) -> bool {
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
    let name = wide("Edge Cockpit");
    unsafe {
        if on {
            let Ok(exe) = std::env::current_exe() else { return false };
            let val = wide(&format!("\"{}\" --background", exe.to_string_lossy()));
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PCWSTR(key.as_ptr()),
                PCWSTR(name.as_ptr()),
                REG_SZ.0,
                Some(val.as_ptr() as *const _),
                (val.len() * 2) as u32,
            )
            .is_ok()
        } else {
            let r = RegDeleteKeyValueW(HKEY_CURRENT_USER, PCWSTR(key.as_ptr()), PCWSTR(name.as_ptr()));
            r.is_ok() || r == ERROR_FILE_NOT_FOUND
        }
    }
}

/// The exe name of the window in front, e.g. "StarCitizen.exe".
pub fn foreground_exe() -> Option<String> {
    unsafe {
        let w = GetForegroundWindow();
        if w.0.is_null() {
            return None;
        }
        exe_of_pid(pid_of(w))
    }
}

fn exe_of_pid(pid: u32) -> Option<String> {
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// When the panel took the foreground anyway, hand it back before sending keys,
/// since SendInput types into whatever is in front.
pub fn restore_game_focus() {
    unsafe {
        let fg = GetForegroundWindow();
        if !fg.0.is_null() && pid_of(fg) == std::process::id() {
            let prev = hwnd(LAST_OTHER.load(Ordering::SeqCst));
            if !prev.0.is_null() {
                let _ = SetForegroundWindow(prev);
            }
        }
    }
}

fn event(k: Key, up: bool) -> INPUT {
    let mut flags = KEYEVENTF_SCANCODE;
    if k.extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: k.scan, dwFlags: KEYBD_EVENT_FLAGS(flags.0), time: 0, dwExtraInfo: 0 },
        },
    }
}

/// Sends key downs (in order) or key ups (in reverse). Fails when Windows blocks the
/// input, which happens when the game runs as administrator and the panel does not.
pub fn send(keys: &[Key], up: bool) -> Result<(), String> {
    let mut inputs: Vec<INPUT> = keys.iter().map(|k| event(*k, up)).collect();
    if up {
        inputs.reverse();
    }
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("blocked".into())
    }
}

/// Turns the mouse wheel by `clicks` notches (positive is away from you). Star Citizen
/// reads the wheel for the speed limiter, mining laser power and beam spacing.
pub fn wheel(clicks: i32) -> Result<(), String> {
    let n = clicks.unsigned_abs().min(20) as usize;
    let step = if clicks > 0 { 120 } else { -120 };
    let one = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: step as _, dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0 } },
    };
    let inputs = vec![one; n];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("blocked".into())
    }
}

pub fn is_elevated() -> bool {
    unsafe { IsUserAnAdmin() }.as_bool()
}

/// Starts this exe again as administrator (Windows asks first). True if it started.
pub fn relaunch_elevated() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    let file = wide(&exe.to_string_lossy());
    let verb = wide("runas");
    let args = wide("--elevated");
    let r = unsafe {
        ShellExecuteW(None, PCWSTR(verb.as_ptr()), PCWSTR(file.as_ptr()), PCWSTR(args.as_ptr()), PCWSTR::null(), SW_SHOWNORMAL)
    };
    r.0 as isize > 32
}

/// True when the window in front runs as administrator. Windows silently drops keys
/// sent to it from a normal process, so the panel says so instead.
pub fn foreground_elevated() -> bool {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return false;
        }
        let Ok(proc_) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid_of(fg)) else { return false };
        let mut token = HANDLE::default();
        let mut elevated = false;
        if OpenProcessToken(proc_, TOKEN_QUERY, &mut token).is_ok() {
            let mut e = TOKEN_ELEVATION::default();
            let mut len = 0u32;
            if GetTokenInformation(token, TokenElevation, Some(&mut e as *mut _ as *mut _), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut len).is_ok() {
                elevated = e.TokenIsElevated != 0;
            }
            let _ = CloseHandle(token);
        }
        let _ = CloseHandle(proc_);
        elevated
    }
}
