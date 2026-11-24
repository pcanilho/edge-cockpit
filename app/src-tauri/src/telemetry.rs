//! Star Citizen's game link: a local gRPC service (`sc.game.telemetry.v1.GameTelemetryService`)
//! the game hosts on 127.0.0.1 once the player turns it on. It streams the ship, weapons and
//! character about 17 times a second and, from 5.0, takes actions by name.
//!
//! CIG publishes no schema. The messages below are our own description of the fields the
//! console reads, with the field numbers the game uses (docs/telemetry.md lists them). Fields
//! the console doesn't read are skipped when decoding. The service has no reflection, TLS or
//! authentication, and only listens on the loopback address.

use bytes::{Buf, BufMut, Bytes, BytesMut};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const DEFAULT_PORT: u16 = 2942;
const SERVICE: &str = "sc.game.telemetry.v1.GameTelemetryService";
/// A section of the stream that stops arriving is gone (you left the seat, or the game paused it).
const STALE: Duration = Duration::from_millis(1500);
/// The UI gets at most this many updates a second, and only when something changed.
const EMIT_EVERY: Duration = Duration::from_millis(100);

#[allow(clippy::derive_partial_eq_without_eq)]
pub mod pb {
    use serde::Serialize;

    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Availability {
        #[prost(bool, tag = "1")]
        pub enabled: bool,
        #[prost(bool, tag = "2")]
        pub active: bool,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Gauge {
        #[prost(float, tag = "1")]
        pub current: f32,
        #[prost(float, tag = "2")]
        pub max: f32,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct DoorState {
        /// 1 opened, 2 closed.
        #[prost(int32, tag = "1")]
        pub open_state: i32,
        /// 1 unlocked, 2 locked.
        #[prost(int32, tag = "2")]
        pub lock_state: i32,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct FlightSettings {
        #[prost(message, optional, tag = "1")]
        pub ifcs_coupled: Option<Availability>,
        #[prost(message, optional, tag = "2")]
        pub ifcs_esp: Option<Availability>,
        #[prost(message, optional, tag = "3")]
        pub ifcs_gravity_compensation: Option<Availability>,
        #[prost(message, optional, tag = "4")]
        pub ifcs_g_safe: Option<Availability>,
        #[prost(message, optional, tag = "5")]
        pub ifcs_cruise_mode: Option<Availability>,
        #[prost(message, optional, tag = "7")]
        pub ifcs_speed_limiter: Option<Availability>,
        #[prost(message, optional, tag = "8")]
        pub ifcs_proximity_assist: Option<Availability>,
        #[prost(message, optional, tag = "10")]
        pub ifcs_stability: Option<Availability>,
        #[prost(bool, tag = "12")]
        pub advanced_hud_enabled_scm: bool,
        #[prost(bool, tag = "13")]
        pub advanced_hud_enabled_nav: bool,
        #[prost(message, optional, tag = "16")]
        pub ifcs_wind_compensation: Option<Availability>,
        #[prost(bool, tag = "19")]
        pub flight_light_amplification: bool,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct FlightState {
        #[prost(bool, tag = "1")]
        pub is_landed: bool,
        /// 1 retracted, 2 deploying, 3 deployed, 4 retracting.
        #[prost(int32, optional, tag = "2")]
        pub gear: Option<i32>,
        #[prost(int32, optional, tag = "3")]
        pub vtol: Option<i32>,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Boost {
        #[prost(bool, tag = "1")]
        pub engaged: bool,
        #[prost(float, tag = "3")]
        pub reserves: f32,
        #[prost(bool, tag = "4")]
        pub critical: bool,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Instruments {
        #[prost(float, tag = "1")]
        pub speed: f32,
        /// 0 to 1. Not every ship sends it.
        #[prost(float, optional, tag = "2")]
        pub hydrogen_fuel: Option<f32>,
        /// Current G and the peak the game recorded.
        #[prost(message, optional, tag = "4")]
        pub g_meter: Option<Gauge>,
        #[prost(message, optional, tag = "5")]
        pub boost: Option<Boost>,
        /// The largest float when no ground is in range.
        #[prost(float, tag = "7")]
        pub radar_altitude: f32,
        #[prost(float, tag = "8")]
        pub vertical_speed_indicator: f32,
        /// Degrees.
        #[prost(float, optional, tag = "10")]
        pub heading: Option<f32>,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Flight {
        #[prost(message, optional, tag = "1")]
        pub state: Option<FlightState>,
        #[prost(message, optional, tag = "2")]
        pub settings: Option<FlightSettings>,
        #[prost(message, optional, tag = "3")]
        pub instruments: Option<Instruments>,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Power {
        #[prost(bool, tag = "1")]
        pub powerplants: bool,
        #[prost(bool, tag = "2")]
        pub engines: bool,
        #[prost(bool, tag = "3")]
        pub weapons: bool,
        #[prost(bool, tag = "4")]
        pub coolers: bool,
        #[prost(bool, tag = "5")]
        pub life_support: bool,
        #[prost(bool, tag = "6")]
        pub gravity_generators: bool,
        #[prost(bool, tag = "7")]
        pub sensors: bool,
        #[prost(bool, tag = "8")]
        pub shield_generators: bool,
        #[prost(bool, tag = "9")]
        pub shield_emitters: bool,
    }
    /// Warning lights. 1 nominal, 2 off, 3 minor flashing, 4 minor on, 5 major flashing, 6 major on.
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Annunciators {
        #[prost(int32, tag = "1")]
        pub pwr: i32,
        #[prost(int32, tag = "2")]
        pub wpn: i32,
        #[prost(int32, tag = "3")]
        pub thr: i32,
        #[prost(int32, tag = "4")]
        pub shld: i32,
        #[prost(int32, tag = "5")]
        pub cool: i32,
        #[prost(int32, tag = "6")]
        pub qdrv: i32,
        #[prost(int32, tag = "7")]
        pub radr: i32,
        #[prost(int32, tag = "8")]
        pub prox: i32,
        #[prost(int32, tag = "9")]
        pub hit: i32,
        #[prost(int32, tag = "10")]
        pub misl: i32,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Shields {
        #[prost(float, tag = "1")]
        pub level: f32,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct MasterMode {
        /// 1 NAV, 2 SCM, 3 stealth.
        #[prost(int32, tag = "1")]
        pub mode: i32,
        #[prost(bool, tag = "2")]
        pub spooled: bool,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Vehicle {
        #[prost(string, tag = "1")]
        pub name: String,
        #[prost(string, tag = "2")]
        pub class_name: String,
        #[prost(bool, tag = "5")]
        pub lights_enabled: bool,
        #[prost(message, optional, tag = "6")]
        pub doors: Option<DoorState>,
        #[prost(message, optional, tag = "7")]
        pub annunciators: Option<Annunciators>,
        #[prost(message, optional, tag = "8")]
        pub flight: Option<Flight>,
        #[prost(message, optional, tag = "9")]
        pub power: Option<Power>,
        #[prost(message, optional, tag = "10")]
        pub shields: Option<Shields>,
        #[prost(float, tag = "11")]
        pub health: f32,
        #[prost(message, optional, tag = "12")]
        pub master_mode: Option<MasterMode>,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct VehicleFrame {
        #[prost(message, optional, tag = "2")]
        pub state: Option<Vehicle>,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct WeaponsSettings {
        #[prost(bool, tag = "4")]
        pub staggered_fire: bool,
        #[prost(bool, tag = "8")]
        pub gimbals_locked: bool,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Weapon {
        /// The item's class name, e.g. "KLWE_LaserRepeater_S1".
        #[prost(string, tag = "1")]
        pub name: String,
        #[prost(bool, tag = "2")]
        pub is_powered: bool,
        #[prost(bool, tag = "3")]
        pub ready_to_fire: bool,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Countermeasure {
        /// 1 decoy, 2 noise.
        #[prost(int32, tag = "1")]
        pub r#type: i32,
        #[prost(uint32, tag = "2")]
        pub amount: u32,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct WeaponsFrame {
        #[prost(message, optional, tag = "1")]
        pub settings: Option<WeaponsSettings>,
        #[prost(message, repeated, tag = "4")]
        pub weapons: Vec<Weapon>,
        #[prost(message, repeated, tag = "5")]
        pub countermeasures: Vec<Countermeasure>,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Vitals {
        #[prost(message, optional, tag = "1")]
        pub health: Option<Gauge>,
        #[prost(message, optional, tag = "2")]
        pub oxygen: Option<Gauge>,
        #[prost(message, optional, tag = "3")]
        pub hunger: Option<Gauge>,
        #[prost(message, optional, tag = "4")]
        pub thirst: Option<Gauge>,
        #[prost(message, optional, tag = "5")]
        pub body_temperature: Option<Gauge>,
        #[prost(float, tag = "7")]
        pub heart_rate: f32,
        #[prost(float, tag = "8")]
        pub gravity: f32,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct Environment {
        #[prost(float, tag = "1")]
        pub external_temperature: f32,
        #[prost(bool, tag = "3")]
        pub breathable_atmosphere: bool,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct ActorState {
        /// 1 on foot, 2 EVA, 3 seated.
        #[prost(int32, tag = "1")]
        pub locomotion: i32,
        /// 1 pilot, 2 gunner, 3 crew.
        #[prost(int32, tag = "2")]
        pub crew_role: i32,
        /// The seat's entity name, e.g. "AEGS_Avenger_SCItem_Seat_Pilot_877343717572".
        #[prost(string, tag = "3")]
        pub seat_name: String,
        /// aUEC.
        #[prost(int64, optional, tag = "4")]
        pub uec_balance: Option<i64>,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct ActorFrame {
        #[prost(message, optional, tag = "1")]
        pub vitals: Option<Vitals>,
        #[prost(message, optional, tag = "2")]
        pub state: Option<ActorState>,
        #[prost(message, optional, tag = "3")]
        pub environment: Option<Environment>,
    }
    #[derive(Clone, PartialEq, prost::Message, Serialize)]
    pub struct TurretFrame {
        #[prost(bool, tag = "1")]
        pub light_amplification: bool,
    }
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct StreamResponse {
        #[prost(message, optional, tag = "3")]
        pub vehicle: Option<VehicleFrame>,
        #[prost(message, optional, tag = "4")]
        pub weapons: Option<WeaponsFrame>,
        #[prost(message, optional, tag = "6")]
        pub actor: Option<ActorFrame>,
        #[prost(message, optional, tag = "8")]
        pub turret: Option<TurretFrame>,
    }
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct Empty {}
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct TriggerRequest {
        #[prost(string, tag = "1")]
        pub action_name: String,
        #[prost(uint32, optional, tag = "2")]
        pub hold_ms: Option<u32>,
    }
    /// 1 ok, 2 unknown action, 3 map inactive, 4 rate limited, 5 failed, 6 hold not allowed, 7 filtered.
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct TriggerResponse {
        #[prost(int32, tag = "1")]
        pub status: i32,
        #[prost(string, tag = "2")]
        pub message: String,
    }
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct Triggerable {
        #[prost(string, tag = "1")]
        pub action_name: String,
    }
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct ListResponse {
        #[prost(message, repeated, tag = "1")]
        pub actions: Vec<Triggerable>,
    }
}

/// What the console knows from the stream: the last of each section, while it is fresh.
#[derive(Serialize, Clone, PartialEq, Default, Debug)]
pub struct Live {
    pub vehicle: Option<pb::Vehicle>,
    pub weapons: Option<pb::WeaponsFrame>,
    pub actor: Option<pb::ActorFrame>,
    pub turret: Option<pb::TurretFrame>,
}

/// The link as the UI sees it.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Update {
    /// "off" (nothing answers), "linked" (the game answers but sends nothing yet, as in the
    /// menu or before your character spawns), "live" (state arriving).
    pub link: &'static str,
    pub port: u16,
    /// Actions the game takes by name; empty on a game that only shares state (4.10).
    pub actions: Vec<String>,
    pub live: Live,
}

#[derive(Default)]
struct Sections {
    vehicle: Option<(Instant, pb::Vehicle)>,
    weapons: Option<(Instant, pb::WeaponsFrame)>,
    actor: Option<(Instant, pb::ActorFrame)>,
    turret: Option<(Instant, pb::TurretFrame)>,
}

impl Sections {
    fn merge(&mut self, msg: pb::StreamResponse, now: Instant) {
        if let Some(v) = msg.vehicle.and_then(|v| v.state) {
            self.vehicle = Some((now, v));
        }
        if let Some(w) = msg.weapons {
            self.weapons = Some((now, w));
        }
        if let Some(a) = msg.actor {
            self.actor = Some((now, a));
        }
        if let Some(t) = msg.turret {
            self.turret = Some((now, t));
        }
    }
    fn live(&self, now: Instant) -> Live {
        fn fresh<T: Clone>(s: &Option<(Instant, T)>, now: Instant) -> Option<T> {
            s.as_ref().filter(|(t, _)| now.duration_since(*t) < STALE).map(|(_, v)| v.clone())
        }
        Live { vehicle: fresh(&self.vehicle, now), weapons: fresh(&self.weapons, now), actor: fresh(&self.actor, now), turret: fresh(&self.turret, now) }
    }
}

/// One gRPC message on the wire: no compression, its length, then the bytes.
pub fn frame(msg: &impl prost::Message) -> Bytes {
    let body = msg.encode_to_vec();
    let mut b = BytesMut::with_capacity(5 + body.len());
    b.put_u8(0);
    b.put_u32(body.len() as u32);
    b.extend_from_slice(&body);
    b.freeze()
}

/// The next whole message in `buf`, if one has arrived. Compressed messages are skipped: the
/// console never asks for compression, so the game shouldn't send any.
pub fn take(buf: &mut BytesMut) -> Option<Option<Bytes>> {
    if buf.len() < 5 {
        return None;
    }
    let len = u32::from_be_bytes([buf[1], buf[2], buf[3], buf[4]]) as usize;
    if buf.len() < 5 + len {
        return None;
    }
    let compressed = buf[0] != 0;
    buf.advance(5);
    let body = buf.split_to(len).freeze();
    Some((!compressed).then_some(body))
}

type Client = h2::client::SendRequest<Bytes>;

/// The open link, for actions; None while the game doesn't answer.
pub struct Link {
    client: Mutex<Option<(Client, u16)>>,
    /// A recording in progress: raw messages as the game sent them, for a bug report or to
    /// check a new game build. Every field is kept, including the ones the console doesn't read.
    rec: Mutex<Option<Recording>>,
}

impl Default for Link {
    fn default() -> Self {
        Link { client: Mutex::new(None), rec: Mutex::new(None) }
    }
}

/// About ten minutes of the stream.
const REC_MAX: usize = 12_000;

pub struct Recording {
    start: Instant,
    actions: Vec<String>,
    frames: Vec<(u32, Bytes)>,
}

impl Link {
    pub fn record(&self) {
        *self.rec.lock().unwrap() = Some(Recording { start: Instant::now(), actions: vec![], frames: vec![] });
    }
    /// Ends the recording: a JSON header line, then each message as milliseconds since the
    /// start (u32, big-endian), its length (u32) and its bytes. docs/telemetry.md reads it.
    pub fn stop(&self) -> Option<Vec<u8>> {
        let r = self.rec.lock().unwrap().take()?;
        let head = serde_json::json!({ "app": "edge-cockpit", "format": 1, "service": SERVICE, "actions": r.actions, "frames": r.frames.len() });
        let mut out = head.to_string().into_bytes();
        out.push(b'\n');
        for (ms, b) in r.frames {
            out.extend_from_slice(&ms.to_be_bytes());
            out.extend_from_slice(&(b.len() as u32).to_be_bytes());
            out.extend_from_slice(&b);
        }
        Some(out)
    }
    fn keep(&self, msg: &Bytes, actions: &[String]) {
        if let Some(r) = self.rec.lock().unwrap().as_mut() {
            if r.actions.is_empty() {
                r.actions = actions.to_vec();
            }
            if r.frames.len() < REC_MAX {
                r.frames.push((r.start.elapsed().as_millis().min(u32::MAX as u128) as u32, msg.clone()));
            }
        }
    }
}

fn request(port: u16, method: &str) -> http::Request<()> {
    http::Request::builder()
        .method("POST")
        .uri(format!("http://127.0.0.1:{port}/{SERVICE}/{method}"))
        .header("content-type", "application/grpc")
        .header("te", "trailers")
        .body(())
        .expect("static request")
}

fn grpc_status(h: &http::HeaderMap) -> Option<i32> {
    h.get("grpc-status").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok())
}

/// A call with one message each way.
async fn unary<Req: prost::Message, Resp: prost::Message + Default>(client: &Client, port: u16, method: &str, msg: &Req) -> Result<Resp, String> {
    let mut client = client.clone().ready().await.map_err(|e| e.to_string())?;
    let (resp, mut send) = client.send_request(request(port, method), false).map_err(|e| e.to_string())?;
    send.send_data(frame(msg), true).map_err(|e| e.to_string())?;
    let resp = resp.await.map_err(|e| e.to_string())?;
    // A failure with no body comes back as headers only.
    if let Some(s) = grpc_status(resp.headers()).filter(|s| *s != 0) {
        return Err(format!("grpc-status {s}"));
    }
    let mut body = resp.into_body();
    let mut buf = BytesMut::new();
    while let Some(chunk) = body.data().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        let _ = body.flow_control().release_capacity(chunk.len());
        buf.extend_from_slice(&chunk);
    }
    if let Some(s) = body.trailers().await.ok().flatten().as_ref().and_then(grpc_status).filter(|s| *s != 0) {
        return Err(format!("grpc-status {s}"));
    }
    match take(&mut buf) {
        Some(Some(b)) => Resp::decode(b).map_err(|e| e.to_string()),
        _ => Err("empty reply".into()),
    }
}

impl Link {
    /// Asks the game to run an action. Ok("ok") when it did; otherwise why not:
    /// "no-link", "unknown", "inactive", "rate-limited", "failed", "hold", "filtered".
    pub async fn trigger(&self, action: &str, hold_ms: Option<u32>) -> Result<&'static str, String> {
        let Some((client, port)) = self.client.lock().unwrap().clone() else { return Ok("no-link") };
        let req = pb::TriggerRequest { action_name: action.to_string(), hold_ms };
        let call = unary::<_, pb::TriggerResponse>(&client, port, "TriggerGameAction", &req);
        let resp = tokio::time::timeout(Duration::from_millis(1500), call).await.map_err(|_| "timeout".to_string())??;
        Ok(status_name(resp.status))
    }
}

pub fn status_name(s: i32) -> &'static str {
    match s {
        1 => "ok",
        2 => "unknown",
        3 => "inactive",
        4 => "rate-limited",
        6 => "hold",
        7 => "filtered",
        _ => "failed",
    }
}

/// The port the game listens on: `grpc.client.server.port` in the channel's user.cfg, or 2942.
pub fn port_for(channel: Option<&Path>) -> u16 {
    channel
        .and_then(|c| std::fs::read_to_string(c.join("user.cfg")).ok())
        .and_then(|cfg| cfg_value(&cfg, "grpc.client.server.port"))
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

fn cfg_key(line: &str) -> Option<(String, &str)> {
    let line = line.trim();
    if line.starts_with(';') || line.starts_with("--") || line.starts_with('#') {
        return None;
    }
    let (k, v) = line.split_once('=').or_else(|| line.split_once(char::is_whitespace))?;
    Some((k.trim().to_ascii_lowercase().replace('-', "."), v.trim()))
}

fn cfg_value(cfg: &str, key: &str) -> Option<String> {
    cfg.lines().filter_map(cfg_key).filter(|(k, _)| k == key).map(|(_, v)| v.to_string()).next_back()
}

pub const CFG_KEY: &str = "server.game.telemetry.enabled";

/// user.cfg with telemetry turned on or off: our one line is added or taken out, the rest kept.
pub fn with_telemetry(cfg: &str, on: bool) -> String {
    let nl = if cfg.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<&str> = cfg.lines().filter(|l| cfg_key(l).is_none_or(|(k, _)| k != CFG_KEY)).collect();
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    let line = format!("{CFG_KEY}=1");
    if on {
        lines.push(&line);
    }
    let mut out = lines.join(nl);
    if !out.is_empty() {
        out.push_str(nl);
    }
    out
}

pub fn cfg_on(cfg: &str) -> bool {
    cfg_value(cfg, CFG_KEY).is_some_and(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true"))
}

/// "live" while any section is fresh, else "linked": the game answers but shares nothing yet.
fn state_of(live: &Live) -> &'static str {
    if live.vehicle.is_some() || live.weapons.is_some() || live.actor.is_some() { "live" } else { "linked" }
}

/// The channel folders next to `channel` (LIVE, PTU…) that exist.
pub fn sibling_channels(channel: &Path) -> Vec<PathBuf> {
    let Some(root) = channel.parent() else { return vec![channel.to_path_buf()] };
    let mut out: Vec<PathBuf> = crate::game::CHANNELS.iter().map(|c| root.join(c)).filter(|p| p.is_dir()).collect();
    if !out.iter().any(|p| p == channel) {
        out.push(channel.to_path_buf());
    }
    out
}

/// Follows the game link for as long as the app runs. `channel` names the game's folder (for
/// the port), `emit` gets every change, `link` keeps the connection for actions.
pub async fn run(link: std::sync::Arc<Link>, channel: impl Fn() -> Option<PathBuf>, emit: impl Fn(Update)) {
    let mut last: Option<Update> = None;
    let mut send = |u: Update| {
        if last.as_ref() != Some(&u) {
            emit(u.clone());
            last = Some(u);
        }
    };
    loop {
        let port = port_for(channel().as_deref());
        let _ = session(&link, port, &mut send).await;
        *link.client.lock().unwrap() = None;
        send(Update { link: "off", port, actions: vec![], live: Live::default() });
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn session(link: &Link, port: u16, send: &mut impl FnMut(Update)) -> Result<(), String> {
    let tcp = tokio::time::timeout(Duration::from_secs(1), tokio::net::TcpStream::connect(("127.0.0.1", port)))
        .await
        .map_err(|_| "timeout".to_string())?
        .map_err(|e| e.to_string())?;
    let _ = tcp.set_nodelay(true);
    let (client, conn) = h2::client::handshake(tcp).await.map_err(|e| e.to_string())?;
    let driver = tokio::spawn(async move {
        let _ = conn.await;
    });
    let result = stream(link, client, port, send).await;
    driver.abort();
    result
}

async fn stream(link: &Link, client: Client, port: u16, send: &mut impl FnMut(Update)) -> Result<(), String> {
    // A game that only shares state (4.10) answers "unimplemented": no actions.
    let actions = match tokio::time::timeout(Duration::from_secs(2), unary::<_, pb::ListResponse>(&client, port, "ListTriggerableActions", &pb::Empty {})).await {
        Ok(Ok(list)) => list.actions.into_iter().map(|a| a.action_name).collect(),
        _ => vec![],
    };
    *link.client.lock().unwrap() = Some((client.clone(), port));
    let mut ready = client.ready().await.map_err(|e| e.to_string())?;
    let (resp, mut tx) = ready.send_request(request(port, "TelemetryStream"), false).map_err(|e| e.to_string())?;
    tx.send_data(frame(&pb::Empty {}), true).map_err(|e| e.to_string())?;
    let resp = resp.await.map_err(|e| e.to_string())?;
    if grpc_status(resp.headers()).is_some_and(|s| s != 0) {
        return Err("refused".into());
    }
    let mut body = resp.into_body();
    let mut buf = BytesMut::new();
    let mut sections = Sections::default();
    let mut emitted = Instant::now() - EMIT_EVERY;
    let mut pending = false;
    send(Update { link: "linked", port, actions: actions.clone(), live: Live::default() });
    loop {
        // Wake at least every half second, so a section that stopped arriving goes stale.
        let next = tokio::time::timeout(Duration::from_millis(500), body.data()).await;
        let now = Instant::now();
        match next {
            Ok(Some(chunk)) => {
                let chunk = chunk.map_err(|e| e.to_string())?;
                let _ = body.flow_control().release_capacity(chunk.len());
                buf.extend_from_slice(&chunk);
                while let Some(msg) = take(&mut buf) {
                    if let Some(b) = &msg {
                        link.keep(b, &actions);
                    }
                    if let Some(m) = msg.and_then(|b| pb::StreamResponse::decode(b).ok()) {
                        sections.merge(m, now);
                        pending = true;
                    }
                }
            }
            Ok(None) => return Ok(()),
            Err(_) => pending = true,
        }
        if pending && now.duration_since(emitted) >= EMIT_EVERY {
            pending = false;
            emitted = now;
            let live = sections.live(now);
            send(Update { link: state_of(&live), port, actions: actions.clone(), live });
        }
    }
}

use prost::Message as _;

#[cfg(test)]
mod tests {
    use super::*;

    fn prospector() -> pb::StreamResponse {
        let av = |enabled, active| Some(pb::Availability { enabled, active });
        pb::StreamResponse {
            vehicle: Some(pb::VehicleFrame {
                state: Some(pb::Vehicle {
                    name: "MISC_Prospector_877602860529".into(),
                    class_name: "MISC_Prospector".into(),
                    annunciators: Some(pb::Annunciators { pwr: 1, wpn: 1, thr: 2, shld: 4, cool: 2, qdrv: 2, radr: 1, prox: 1, hit: 1, misl: 1 }),
                    flight: Some(pb::Flight {
                        state: Some(pb::FlightState { is_landed: true, gear: Some(3), vtol: Some(3) }),
                        settings: Some(pb::FlightSettings { ifcs_coupled: av(true, true), ifcs_esp: av(true, false), ifcs_speed_limiter: av(true, true), ..Default::default() }),
                        instruments: Some(pb::Instruments { speed: 0.0, boost: Some(pb::Boost { reserves: 1.0, ..Default::default() }), radar_altitude: 4.433704, vertical_speed_indicator: 0.0, ..Default::default() }),
                    }),
                    power: Some(pb::Power { powerplants: true, engines: false, weapons: true, shield_generators: true, ..Default::default() }),
                    shields: Some(pb::Shields { level: 1.0 }),
                    health: 1.0,
                    master_mode: Some(pb::MasterMode { mode: 2, spooled: true }),
                    ..Default::default()
                }),
            }),
            weapons: Some(pb::WeaponsFrame {
                settings: Some(pb::WeaponsSettings { gimbals_locked: true, staggered_fire: false }),
                weapons: vec![pb::Weapon { name: "KLWE_LaserRepeater_S1".into(), is_powered: true, ready_to_fire: true }; 2],
                countermeasures: vec![pb::Countermeasure { r#type: 1, amount: 48 }, pb::Countermeasure { r#type: 2, amount: 5 }],
            }),
            actor: None,
        }
    }

    #[test]
    fn frames_round_trip_in_pieces() {
        let mut wire = BytesMut::new();
        wire.extend_from_slice(&frame(&prospector()));
        wire.extend_from_slice(&frame(&pb::StreamResponse::default()));
        // Arriving a few bytes at a time, as HTTP/2 data frames may split it.
        let mut buf = BytesMut::new();
        let mut got = vec![];
        for piece in wire.chunks(7) {
            buf.extend_from_slice(piece);
            while let Some(m) = take(&mut buf) {
                got.push(pb::StreamResponse::decode(m.unwrap()).unwrap());
            }
        }
        assert_eq!(got, vec![prospector(), pb::StreamResponse::default()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn skips_fields_it_does_not_read() {
        // A field the console doesn't describe (force feedback, 7) decodes as if absent.
        let mut b = prospector().encode_to_vec();
        b.extend_from_slice(&[0x3a, 0x02, 0x25, 0x00]);
        assert_eq!(pb::StreamResponse::decode(&b[..]).unwrap(), prospector());
    }

    /// Fields as the game puts them on the wire, from a real Avenger Titan frame: hydrogen,
    /// G meter (current 0 left out), heading, the full power set and the balance.
    #[test]
    fn reads_gauge_fields() {
        let mut ins = Vec::new();
        ins.extend_from_slice(&[0x15]); ins.extend_from_slice(&0.9986225f32.to_le_bytes()); // 2 hydrogen_fuel
        ins.extend_from_slice(&[0x22, 0x05, 0x15]); ins.extend_from_slice(&3.4770613f32.to_le_bytes()); // 4 g_meter { max }
        ins.extend_from_slice(&[0x55]); ins.extend_from_slice(&359.99857f32.to_le_bytes()); // 10 heading
        let i = pb::Instruments::decode(&ins[..]).unwrap();
        assert_eq!(i.hydrogen_fuel, Some(0.9986225));
        assert_eq!(i.g_meter, Some(pb::Gauge { current: 0.0, max: 3.4770613 }));
        assert_eq!(i.heading, Some(359.99857));
        assert_eq!(pb::Instruments::decode(&[][..]).unwrap().hydrogen_fuel, None);
        // powerplants, engines, weapons, coolers, life support, sensors, shield generators and emitters on; no gravity generators.
        let p = pb::Power::decode(&[0x08, 1, 0x10, 1, 0x18, 1, 0x20, 1, 0x28, 1, 0x38, 1, 0x40, 1, 0x48, 1][..]).unwrap();
        assert!(p.coolers && p.life_support && p.sensors && p.shield_emitters && !p.gravity_generators);
        // uec_balance 15001986 as a varint.
        let mut a = vec![0x20];
        let mut n = 15001986u64;
        while n >= 0x80 { a.push((n as u8) | 0x80); n >>= 7; }
        a.push(n as u8);
        assert_eq!(pb::ActorState::decode(&a[..]).unwrap().uec_balance, Some(15001986));
        // A weapon's class name (1) and a seat name (3); a turret frame with light amplification on.
        let mut w = vec![0x0a, 21];
        w.extend_from_slice(b"KLWE_LaserRepeater_S1");
        w.extend_from_slice(&[0x10, 1, 0x18, 1]);
        let w = pb::Weapon::decode(&w[..]).unwrap();
        assert_eq!((w.name.as_str(), w.is_powered, w.ready_to_fire), ("KLWE_LaserRepeater_S1", true, true));
        let mut st = vec![0x10, 2, 0x1a, 11];
        st.extend_from_slice(b"Turret_Seat");
        let st = pb::ActorState::decode(&st[..]).unwrap();
        assert_eq!((st.crew_role, st.seat_name.as_str()), (2, "Turret_Seat"));
        let r = pb::StreamResponse::decode(&[0x42, 2, 0x08, 1][..]).unwrap();
        assert!(r.turret.unwrap().light_amplification);
    }

    #[test]
    fn sections_go_stale() {
        let t0 = Instant::now();
        let mut s = Sections::default();
        s.merge(prospector(), t0);
        // A later frame with only the weapons keeps the ship.
        s.merge(pb::StreamResponse { weapons: prospector().weapons, ..Default::default() }, t0 + Duration::from_millis(500));
        assert!(s.live(t0 + Duration::from_millis(600)).vehicle.is_some());
        let later = s.live(t0 + STALE + Duration::from_millis(100));
        assert!(later.vehicle.is_none());
        assert!(later.weapons.is_some());
    }

    #[test]
    fn user_cfg_line() {
        let cfg = "r_DisplayInfo = 0\r\n; note\r\nserver.game.telemetry.enabled = 0\r\n\r\n";
        let on = with_telemetry(cfg, true);
        assert_eq!(on, "r_DisplayInfo = 0\r\n; note\r\nserver.game.telemetry.enabled=1\r\n");
        assert!(cfg_on(&on) && !cfg_on(cfg));
        assert_eq!(with_telemetry(&on, false), "r_DisplayInfo = 0\r\n; note\r\n");
        assert_eq!(with_telemetry("", true), "server.game.telemetry.enabled=1\n");
        assert_eq!(with_telemetry("server.game.telemetry.enabled=1\n", false), "");
        assert_eq!(port_for(None), DEFAULT_PORT);
        assert_eq!(cfg_value("grpc.client.server.port = 2950\n", "grpc.client.server.port").as_deref(), Some("2950"));
    }

    #[test]
    fn status_names() {
        assert_eq!(status_name(1), "ok");
        assert_eq!(status_name(7), "filtered");
        assert_eq!(status_name(0), "failed");
    }

    /// A stand-in game: answers ListTriggerableActions and TriggerGameAction, and streams frames.
    #[tokio::test]
    async fn talks_to_a_game() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut conn = h2::server::handshake(tcp).await.unwrap();
            while let Some(Ok((req, mut respond))) = conn.accept().await {
                let path = req.uri().path().to_string();
                tokio::spawn(async move {
                    let ok = http::Response::builder().header("content-type", "application/grpc").body(()).unwrap();
                    let mut tx = respond.send_response(ok, false).unwrap();
                    let mut trailers = http::HeaderMap::new();
                    trailers.insert("grpc-status", "0".parse().unwrap());
                    if path.ends_with("/ListTriggerableActions") {
                        tx.send_data(frame(&pb::ListResponse { actions: vec![pb::Triggerable { action_name: "v_lights".into() }] }), false).unwrap();
                        tx.send_trailers(trailers).unwrap();
                    } else if path.ends_with("/TriggerGameAction") {
                        tx.send_data(frame(&pb::TriggerResponse { status: 7, message: String::new() }), false).unwrap();
                        tx.send_trailers(trailers).unwrap();
                    } else {
                        for _ in 0..3 {
                            tx.send_data(frame(&prospector()), false).unwrap();
                            tokio::time::sleep(Duration::from_millis(30)).await;
                        }
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        tx.send_trailers(trailers).unwrap();
                    }
                });
            }
        });
        let link = Link::default();
        let mut seen = vec![];
        let recorder = Link::default();
        recorder.record();
        recorder.keep(&frame(&prospector()).slice(5..), &["v_lights".to_string()]);
        let file = recorder.stop().unwrap();
        let nl = file.iter().position(|b| *b == b'\n').unwrap();
        let head: serde_json::Value = serde_json::from_slice(&file[..nl]).unwrap();
        assert_eq!(head["frames"], 1);
        let len = u32::from_be_bytes(file[nl + 5..nl + 9].try_into().unwrap()) as usize;
        assert_eq!(pb::StreamResponse::decode(&file[nl + 9..nl + 9 + len]).unwrap(), prospector());
        let mut keep = |u| seen.push(u);
        let streaming = session(&link, port, &mut keep);
        let (result, status) = tokio::join!(streaming, async {
            tokio::time::sleep(Duration::from_millis(100)).await;
            link.trigger("v_lights", None).await
        });
        assert!(result.is_ok());
        assert!(link.stop().is_none());
        assert_eq!(status, Ok("filtered"));
        // Linked as soon as the game answers, live once it sends state.
        assert_eq!(seen[0].link, "linked");
        assert!(seen.iter().any(|u| u.link == "live"));
        assert_eq!(seen[0].actions, vec!["v_lights".to_string()]);
        let last = seen.iter().rev().find(|u| u.live.vehicle.is_some()).expect("a ship");
        assert_eq!(last.link, "live");
        assert_eq!(last.live.vehicle.as_ref().unwrap().class_name, "MISC_Prospector");
        assert_eq!(last.live.weapons.as_ref().unwrap().countermeasures[0].amount, 48);
    }
}
