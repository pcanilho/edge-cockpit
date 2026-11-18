// Phones as extra screens. The app serves the console on the home network; a phone opens
// it in the browser, pairs once with a six-digit code shown in Settings, and from then on
// shows plates and presses keys here, as the console does. Keys are always sent by this PC.
//
// One listener answers plain HTTP for the console's files and a WebSocket at /link for
// everything else. Only private addresses are served, and the Host header must be an IP
// address or a .local name (no DNS rebinding). A paired phone holds a random token and
// proves it by answering a fresh challenge with HMAC-SHA256, so the token itself never
// travels again after pairing.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

/// The port phones remember on their home screen, so it stays the same.
pub const PORT: u16 = 47823;
/// A pairing code is good for two minutes and five tries.
const CODE_TTL: Duration = Duration::from_secs(120);
const CODE_TRIES: u32 = 5;
/// Game.log lines kept for a phone that connects later (the console's own filter keeps it small).
const LOG_KEEP: usize = 20_000;
/// What a phone may show: a plate of the ship page, or any plate with a swipe.
pub const PLATES: [&str; 6] = ["swipe", "status", "power", "role", "flight", "gear"];

#[derive(Serialize, Deserialize, Clone)]
pub struct Phone {
    pub id: String,
    pub name: String,
    /// Hex of 32 random bytes.
    token: String,
    /// One of PLATES.
    pub plate: String,
    /// "copy" (the plate shows here and on the phone) or "move" (only on the phone).
    pub mode: String,
    /// Unix seconds when last connected.
    pub seen: u64,
}

#[derive(Serialize, Clone)]
pub struct PhoneView {
    id: String,
    name: String,
    plate: String,
    mode: String,
    online: bool,
    seen: u64,
}

#[derive(Serialize, Clone)]
pub struct View {
    enabled: bool,
    /// The address to open on the phone, or None while off or without a network.
    url: Option<String>,
    /// The pairing code, while on.
    code: Option<String>,
    /// Seconds the code has left.
    ttl: u64,
    /// The address as a QR code, an SVG.
    qr: Option<String>,
    list: Vec<PhoneView>,
    /// Plates moved off this screen to a phone that is online.
    moved: Vec<String>,
}

struct Conn {
    phone: String,
    tx: UnboundedSender<String>,
    /// Hold keys this phone has down, released if it drops.
    held: HashSet<String>,
}

#[derive(Default)]
struct Inner {
    enabled: bool,
    running: bool,
    code: String,
    code_at: Option<Instant>,
    tries: u32,
    list: Vec<Phone>,
    live: HashMap<u64, Conn>,
    next: u64,
    log: Vec<String>,
    /// Console state every screen shares: switch states, the page, local positions.
    shared: serde_json::Map<String, Value>,
    file: Option<PathBuf>,
}

#[derive(Default)]
pub struct Phones(Mutex<Inner>);

fn now_s() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn random_hex(n: usize) -> String {
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).expect("system random");
    hex(&b)
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}

/// HMAC-SHA256 (RFC 2104).
pub fn hmac(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let pad = |b: u8| k.iter().map(|x| x ^ b).collect::<Vec<_>>();
    let inner = Sha256::new().chain_update(pad(0x36)).chain_update(msg).finalize();
    Sha256::new().chain_update(pad(0x5c)).chain_update(inner).finalize().into()
}

/// Compares in constant time.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

/// Home network addresses only: 10/8, 172.16/12, 192.168/16, link-local, loopback, IPv6 ULA and link-local.
pub fn private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_private() || v.is_link_local() || v.is_loopback(),
        IpAddr::V6(v) => {
            if let Some(v4) = v.to_ipv4_mapped() {
                return private(IpAddr::V4(v4));
            }
            v.is_loopback() || (v.segments()[0] & 0xfe00) == 0xfc00 || (v.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// A Host header we serve: a private IP literal, or a .local name, with or without our port.
pub fn host_ok(host: &str) -> bool {
    let bare = match host.strip_prefix('[') {
        Some(rest) => rest.split(']').next().unwrap_or(""),
        None => match host.rsplit_once(':') {
            Some((h, p)) if p.parse::<u16>().is_ok() && !h.contains(':') => h,
            _ => host,
        },
    };
    if let Ok(ip) = bare.parse::<IpAddr>() {
        return private(ip);
    }
    let lower = bare.to_ascii_lowercase();
    lower.len() > 6 && lower.ends_with(".local") && lower.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

/// The address other devices reach this PC on: the one the default route uses.
pub fn lan_ip() -> Option<IpAddr> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    // No packet is sent: connecting a UDP socket only picks the route.
    s.connect("192.0.2.1:9").ok()?;
    let ip = s.local_addr().ok()?.ip();
    (private(ip) && !ip.is_loopback()).then_some(ip)
}

/// A friendly name from the browser's user agent.
pub fn device_name(ua: &str) -> String {
    let base = if ua.contains("iPhone") {
        "iPhone"
    } else if ua.contains("iPad") || (ua.contains("Macintosh") && ua.contains("Mobile")) {
        "iPad"
    } else if ua.contains("Android") {
        if ua.contains("Mobile") { "Android" } else { "Android tablet" }
    } else if ua.contains("CrOS") {
        "Chromebook"
    } else if ua.contains("Windows") {
        "Windows PC"
    } else if ua.contains("Macintosh") {
        "Mac"
    } else if ua.contains("Linux") {
        "Linux PC"
    } else {
        "Browser"
    };
    base.to_string()
}

impl Phones {
    pub fn load(&self, file: PathBuf, enabled: bool) {
        let mut g = self.0.lock().unwrap();
        g.list = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        g.file = Some(file);
        g.enabled = enabled;
    }

    fn save(g: &Inner) {
        if let Some(f) = &g.file {
            let _ = std::fs::create_dir_all(f.parent().unwrap_or(f));
            let _ = std::fs::write(f, serde_json::to_string_pretty(&g.list).unwrap_or_default());
        }
    }

    pub fn enabled(&self) -> bool {
        self.0.lock().unwrap().enabled
    }

    fn fresh_code(g: &mut Inner) {
        let mut b = [0u8; 4];
        getrandom::fill(&mut b).expect("system random");
        g.code = format!("{:06}", u32::from_le_bytes(b) % 1_000_000);
        g.code_at = Some(Instant::now());
        g.tries = 0;
    }

    pub fn view(&self) -> View {
        let mut g = self.0.lock().unwrap();
        let url = (g.enabled && g.running).then(lan_ip).flatten().map(|ip| match ip {
            IpAddr::V6(v) => format!("http://[{v}]:{PORT}/"),
            IpAddr::V4(v) => format!("http://{v}:{PORT}/"),
        });
        if g.enabled && g.code_at.is_none_or(|t| t.elapsed() >= CODE_TTL) {
            Self::fresh_code(&mut g);
        }
        let online: HashSet<&str> = g.live.values().map(|c| c.phone.as_str()).collect();
        let list: Vec<PhoneView> = g
            .list
            .iter()
            .map(|p| PhoneView { id: p.id.clone(), name: p.name.clone(), plate: p.plate.clone(), mode: p.mode.clone(), online: online.contains(p.id.as_str()), seen: p.seen })
            .collect();
        let moved = list.iter().filter(|p| p.online && p.mode == "move" && p.plate != "swipe" && p.plate != "status").map(|p| p.plate.clone()).collect();
        View {
            enabled: g.enabled,
            // The QR also carries the code (after #, so it never reaches the server as a path):
            // a scan pairs at once. It is on the same screen as the code, and expires with it.
            qr: url.as_deref().map(|u| qr_svg(&format!("{u}#pair={}", g.code))),
            url,
            code: g.enabled.then(|| g.code.clone()),
            ttl: g.code_at.map(|t| CODE_TTL.saturating_sub(t.elapsed()).as_secs()).unwrap_or(0),
            list,
            moved,
        }
    }

    pub fn set_enabled(&self, on: bool) {
        let mut g = self.0.lock().unwrap();
        g.enabled = on;
        if !on {
            // Dropping the senders closes every link.
            g.live.clear();
        }
    }

    /// Changes a phone's plate and mode. Returns the connections to tell.
    pub fn configure(&self, id: &str, plate: Option<&str>, mode: Option<&str>) -> bool {
        let mut g = self.0.lock().unwrap();
        let Some(p) = g.list.iter_mut().find(|p| p.id == id) else { return false };
        if let Some(pl) = plate.filter(|pl| PLATES.contains(pl)) {
            p.plate = pl.to_string();
        }
        if let Some(m) = mode.filter(|m| *m == "copy" || *m == "move") {
            p.mode = m.to_string();
        }
        let msg = json!({ "t": "ev", "name": "phone-config", "p": { "plate": p.plate, "mode": p.mode, "name": p.name } }).to_string();
        Self::save(&g);
        for c in g.live.values().filter(|c| c.phone == id) {
            let _ = c.tx.send(msg.clone());
        }
        true
    }

    pub fn forget(&self, id: &str) {
        let mut g = self.0.lock().unwrap();
        g.list.retain(|p| p.id != id);
        g.live.retain(|_, c| c.phone != id);
        Self::save(&g);
    }

    /// Keeps the log for phones that connect later, and passes the batch on.
    pub fn log_batch(&self, lines: &[String], live: bool, reset: bool) {
        let mut g = self.0.lock().unwrap();
        if reset {
            g.log.clear();
            g.shared.clear();
        }
        g.log.extend(lines.iter().cloned());
        if g.log.len() > LOG_KEEP {
            let cut = g.log.len() - LOG_KEEP;
            g.log.drain(..cut);
        }
        if g.live.is_empty() {
            return;
        }
        let msg = json!({ "t": "ev", "name": "game-log", "p": { "lines": lines, "live": live, "reset": reset } }).to_string();
        for c in g.live.values() {
            let _ = c.tx.send(msg.clone());
        }
    }

    /// An event for every phone (the screen going dark, and so on).
    pub fn broadcast(&self, name: &str, payload: Value) {
        let g = self.0.lock().unwrap();
        let msg = json!({ "t": "ev", "name": name, "p": payload }).to_string();
        for c in g.live.values() {
            let _ = c.tx.send(msg.clone());
        }
    }

    /// Shared console state from one screen, for all the others. `from` is the phone link, or None for this PC.
    pub fn share(&self, s: &serde_json::Map<String, Value>, from: Option<u64>) {
        let mut g = self.0.lock().unwrap();
        merge(&mut g.shared, s);
        let msg = json!({ "t": "ev", "name": "shared", "p": s }).to_string();
        for (id, c) in &g.live {
            if Some(*id) != from {
                let _ = c.tx.send(msg.clone());
            }
        }
    }

}

/// Shared state merges one level deep: an object updates the entries it names (null removes
/// one), and null removes the whole key.
pub fn merge(into: &mut serde_json::Map<String, Value>, s: &serde_json::Map<String, Value>) {
    for (k, v) in s {
        match (v, into.get_mut(k)) {
            (Value::Null, _) => {
                into.remove(k);
            }
            (Value::Object(add), Some(Value::Object(have))) => {
                for (k2, v2) in add {
                    if v2.is_null() {
                        have.remove(k2);
                    } else {
                        have.insert(k2.clone(), v2.clone());
                    }
                }
            }
            _ => {
                into.insert(k.clone(), v.clone());
            }
        }
    }
}

/// The QR code for an address, as an SVG: black on white, as phone cameras expect.
pub fn qr_svg(url: &str) -> String {
    use qrcode::render::svg;
    qrcode::QrCode::new(url.as_bytes())
        .map(|c| c.render::<svg::Color>().min_dimensions(160, 160).quiet_zone(true).dark_color(svg::Color("#000000")).light_color(svg::Color("#ffffff")).build())
        .unwrap_or_default()
}

// ---------------- the server ----------------

/// What the server needs from the app: files, and the console's commands.
pub trait Host: Send + Sync + 'static {
    fn phones(&self) -> &Phones;
    fn asset(&self, path: &str) -> Option<(Vec<u8>, String)>;
    /// Runs a console command for a phone. `held` tracks hold keys this phone has down.
    fn call(&self, cmd: &str, args: &Value, held: &mut HashSet<String>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send + '_>>;
    /// The phone list changed (paired, connected, dropped): tell this PC's console.
    fn changed(&self);
    /// Releases keys a dropped phone was holding.
    fn release(&self, held: HashSet<String>);
}

/// Starts the listener once; it stays up while the app runs and refuses everyone while off.
/// The console's name on the home network, announced over mDNS while devices are on.
pub const LOCAL_NAME: &str = "edge-cockpit.local";

/// Announces LOCAL_NAME (and an HTTP service) at the LAN address while devices are on, and
/// follows the address when it changes. Off, nothing is announced.
fn announce<H: Host>(host: std::sync::Arc<H>) {
    announce_at(move || if host.phones().enabled() { lan_ip() } else { None });
}

fn announce_at(at: impl Fn() -> Option<IpAddr> + Send + 'static) {
    std::thread::spawn(move || {
        let Ok(daemon) = mdns_sd::ServiceDaemon::new() else { return };
        let full = "edge-cockpit._http._tcp.local.";
        let mut now: Option<IpAddr> = None;
        loop {
            let want = at();
            if want != now {
                if now.is_some() {
                    let _ = daemon.unregister(full);
                }
                if let Some(ip) = want {
                    let props: &[(&str, &str)] = &[("path", "/")];
                    if let Ok(info) = mdns_sd::ServiceInfo::new("_http._tcp.local.", "edge-cockpit", &format!("{LOCAL_NAME}."), ip, PORT, props) {
                        let _ = daemon.register(info);
                    }
                }
                now = want;
            }
            std::thread::sleep(Duration::from_secs(10));
        }
    });
}

pub fn start<H: Host>(host: std::sync::Arc<H>) {
    {
        let mut g = host.phones().0.lock().unwrap();
        if g.running {
            return;
        }
        g.running = true;
    }
    announce(host.clone());
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", PORT)).await {
            Ok(l) => l,
            Err(_) => {
                host.phones().0.lock().unwrap().running = false;
                host.changed();
                return;
            }
        };
        loop {
            let Ok((stream, peer)) = listener.accept().await else { continue };
            if !private(peer.ip()) || !host.phones().enabled() {
                continue;
            }
            let _ = stream.set_nodelay(true);
            let h = host.clone();
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(Duration::from_secs(60 * 60 * 24), serve(h, stream, peer)).await;
            });
        }
    });
}

struct Request {
    path: String,
    host: String,
    origin: Option<String>,
    upgrade: bool,
    ua: String,
}

fn parse_head(head: &str) -> Option<Request> {
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    if first.next()? != "GET" {
        return None;
    }
    let path = first.next()?.to_string();
    let (mut host, mut origin, mut upgrade, mut ua) = (String::new(), None, false, String::new());
    for l in lines {
        let Some((k, v)) = l.split_once(':') else { continue };
        let v = v.trim();
        match k.trim().to_ascii_lowercase().as_str() {
            "host" => host = v.to_string(),
            "origin" => origin = Some(v.to_string()),
            "upgrade" => upgrade = v.eq_ignore_ascii_case("websocket"),
            "user-agent" => ua = v.chars().take(300).collect(),
            _ => {}
        }
    }
    Some(Request { path, host, origin, upgrade, ua })
}

async fn serve<H: Host>(host: std::sync::Arc<H>, stream: tokio::net::TcpStream, _peer: SocketAddr) -> std::io::Result<()> {
    // Read the request head without taking it, so a WebSocket handshake can still read it.
    let mut buf = vec![0u8; 8192];
    let head = loop {
        let n = tokio::time::timeout(Duration::from_secs(10), stream.peek(&mut buf)).await.map_err(|_| std::io::ErrorKind::TimedOut)??;
        if n == 0 {
            return Ok(());
        }
        if let Some(end) = buf[..n].windows(4).position(|w| w == b"\r\n\r\n") {
            break String::from_utf8_lossy(&buf[..end]).into_owned();
        }
        if n == buf.len() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    };
    let Some(req) = parse_head(&head) else { return reply(stream, 405, "text/plain", b"GET only".to_vec(), "").await };
    if !host_ok(&req.host) {
        return reply(stream, 421, "text/plain", b"Use the address from Settings".to_vec(), "").await;
    }
    let route = req.path.split(['?', '#']).next().unwrap_or("/").to_string();
    if route == "/link" && req.upgrade {
        // Only the console's own page may open the link.
        let me = format!("http://{}", req.host);
        if req.origin.as_deref() != Some(me.as_str()) {
            return reply(stream, 403, "text/plain", b"Wrong origin".to_vec(), "").await;
        }
        let ws = match tokio_tungstenite::accept_async(stream).await {
            Ok(ws) => ws,
            Err(_) => return Ok(()),
        };
        link(host, ws, req.ua).await;
        return Ok(());
    }
    // Read and drop the request we peeked.
    let mut stream = stream;
    {
        use tokio::io::AsyncReadExt;
        let mut sink = vec![0u8; head.len() + 4];
        let _ = stream.read_exact(&mut sink).await;
    }
    let file = if route == "/" { "/index.html".to_string() } else { route };
    if file.contains("..") {
        return reply(stream, 404, "text/plain", b"Not found".to_vec(), "").await;
    }
    let csp = format!(
        "default-src 'self'; script-src 'self'; connect-src 'self' ws://{h} http://{n}:{p} https://api.fleetyards.net https://fleetyards.net https://storage.fltyrd.net; img-src 'self' data: https://api.fleetyards.net https://fleetyards.net https://storage.fltyrd.net; media-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        h = req.host,
        n = LOCAL_NAME,
        p = PORT
    );
    match host.asset(&file) {
        Some((bytes, mime)) => reply(stream, 200, &mime, bytes, &csp).await,
        None => reply(stream, 404, "text/plain", b"Not found".to_vec(), "").await,
    }?;
    Ok(())
}

async fn reply(mut stream: tokio::net::TcpStream, code: u16, mime: &str, body: Vec<u8>, csp: &str) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;
    let reason = match code {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Misdirected Request",
    };
    let mut head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n",
        body.len()
    );
    if !csp.is_empty() {
        head.push_str(&format!("Content-Security-Policy: {csp}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(&body).await?;
    stream.shutdown().await
}

type Ws = tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>;

async fn link<H: Host>(host: std::sync::Arc<H>, ws: Ws, ua: String) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    let (mut out, mut inp) = ws.split();
    let nonce = random_hex(32);
    if out.send(Message::text(json!({ "t": "hello", "nonce": nonce, "v": 1 }).to_string())).await.is_err() {
        return;
    }
    // The first message pairs or proves the phone.
    let first = match tokio::time::timeout(Duration::from_secs(120), inp.next()).await {
        Ok(Some(Ok(Message::Text(t)))) => serde_json::from_str::<Value>(&t).unwrap_or(Value::Null),
        _ => return,
    };
    let phones = host.phones();
    let who: Result<(Phone, Option<String>), &str> = match first["t"].as_str() {
        Some("pair") => {
            let code = first["code"].as_str().unwrap_or("");
            let mut g = phones.0.lock().unwrap();
            let fresh = g.code_at.is_some_and(|t| t.elapsed() < CODE_TTL) && g.tries < CODE_TRIES;
            g.tries += 1;
            if fresh && same(code.as_bytes(), g.code.as_bytes()) {
                let base = device_name(&ua);
                let n = g.list.iter().filter(|p| p.name == base || p.name.starts_with(&format!("{base} "))).count();
                let name = if n == 0 { base } else { format!("{base} {}", n + 1) };
                let p = Phone { id: random_hex(8), name, token: random_hex(32), plate: "swipe".into(), mode: "copy".into(), seen: now_s() };
                g.list.push(p.clone());
                Phones::save(&g);
                // A used code is spent.
                Phones::fresh_code(&mut g);
                let token = p.token.clone();
                Ok((p, Some(token)))
            } else {
                if g.tries >= CODE_TRIES {
                    Phones::fresh_code(&mut g);
                }
                Err("code")
            }
        }
        Some("auth") => {
            let g = phones.0.lock().unwrap();
            let id = first["id"].as_str().unwrap_or("");
            match g.list.iter().find(|p| p.id == id) {
                Some(p) => {
                    let want = hmac(&unhex(&p.token).unwrap_or_default(), nonce.as_bytes());
                    let got = unhex(first["mac"].as_str().unwrap_or("")).unwrap_or_default();
                    if same(&want, &got) {
                        Ok((p.clone(), None))
                    } else {
                        Err("unknown")
                    }
                }
                None => Err("unknown"),
            }
        }
        _ => Err("unknown"),
    };
    let (phone, token) = match who {
        Ok(w) => w,
        Err(why) => {
            let _ = out.send(Message::text(json!({ "t": "denied", "why": why }).to_string())).await;
            host.changed();
            return;
        }
    };
    let (tx, mut rx) = unbounded_channel::<String>();
    let conn = {
        let mut g = phones.0.lock().unwrap();
        if let Some(p) = g.list.iter_mut().find(|p| p.id == phone.id) {
            p.seen = now_s();
        }
        Phones::save(&g);
        g.next += 1;
        let n = g.next;
        g.live.insert(n, Conn { phone: phone.id.clone(), tx: tx.clone(), held: HashSet::new() });
        n
    };
    let mut welcome = json!({ "t": "ok", "id": phone.id, "name": phone.name, "plate": phone.plate, "mode": phone.mode });
    if let Some(t) = token {
        welcome["token"] = Value::String(t);
    }
    let _ = tx.send(welcome.to_string());
    host.changed();
    // Writer: everything for this phone goes out in order.
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(m) = rx.recv().await {
            if out.send(Message::text(m)).await.is_err() {
                break;
            }
        }
        let _ = out.close().await;
    });
    let mut held = HashSet::new();
    while let Ok(Some(Ok(msg))) = tokio::time::timeout(Duration::from_secs(90), inp.next()).await {
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Ping(_) | Message::Pong(_) => continue,
            _ => break,
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        // Still allowed? Forgetting a phone or turning phones off drops it.
        if !phones.0.lock().unwrap().live.contains_key(&conn) {
            break;
        }
        match v["t"].as_str() {
            Some("ping") => {
                let _ = tx.send(json!({ "t": "pong", "at": v["at"] }).to_string());
            }
            Some("call") => {
                let n = v["n"].clone();
                let cmd = v["cmd"].as_str().unwrap_or("").to_string();
                let args = v["args"].clone();
                let res = match cmd.as_str() {
                    "ui_ready" => {
                        let (log, shared) = {
                            let g = phones.0.lock().unwrap();
                            (g.log.clone(), g.shared.clone())
                        };
                        let _ = tx.send(json!({ "t": "ev", "name": "game-log", "p": { "lines": log, "live": false, "reset": true } }).to_string());
                        let _ = tx.send(json!({ "t": "ev", "name": "shared", "p": shared }).to_string());
                        Ok(Value::Null)
                    }
                    "share" => {
                        if let Some(s) = args["s"].as_object() {
                            phones.share(s, Some(conn));
                            host.call("share_local", &args, &mut held).await.map(|_| Value::Null)
                        } else {
                            Err("bad".into())
                        }
                    }
                    "phone_set" => {
                        phones.configure(&phone.id, args["plate"].as_str(), args["mode"].as_str());
                        host.changed();
                        Ok(Value::Null)
                    }
                    _ => host.call(&cmd, &args, &mut held).await,
                };
                let reply = match res {
                    Ok(val) => json!({ "t": "ret", "n": n, "ok": true, "v": val }),
                    Err(e) => json!({ "t": "ret", "n": n, "ok": false, "e": e }),
                };
                let _ = tx.send(reply.to_string());
            }
            _ => {}
        }
        if let Some(c) = phones.0.lock().unwrap().live.get_mut(&conn) {
            c.held.clone_from(&held);
        }
    }
    phones.0.lock().unwrap().live.remove(&conn);
    host.release(held);
    drop(tx);
    writer.abort();
    host.changed();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_matches_rfc_4231() {
        // Test case 2.
        let mac = hmac(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(hex(&mac), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn serves_home_network_hosts_only() {
        assert!(host_ok("192.168.1.20:47823"));
        assert!(host_ok("10.0.0.5"));
        assert!(host_ok("gaming-pc.local:47823"));
        assert!(host_ok("[fe80::1]:47823"));
        assert!(!host_ok("8.8.8.8:47823"));
        assert!(!host_ok("evil.example.com:47823"));
        assert!(!host_ok("evil.com#.local"));
        assert!(private("172.20.1.1".parse().unwrap()));
        assert!(!private("172.32.1.1".parse().unwrap()));
    }

    #[test]
    fn merges_shared_state() {
        let mut m = serde_json::Map::new();
        let a = json!({ "st": { "gear": "down", "lights": "on" }, "page": "mining" });
        merge(&mut m, a.as_object().unwrap());
        merge(&mut m, json!({ "st": { "lights": null, "vtol": "on" } }).as_object().unwrap());
        assert_eq!(Value::Object(m.clone()), json!({ "st": { "gear": "down", "vtol": "on" }, "page": "mining" }));
        merge(&mut m, json!({ "st": null }).as_object().unwrap());
        assert_eq!(Value::Object(m), json!({ "page": "mining" }));
    }

    #[test]
    fn names_devices() {
        assert_eq!(device_name("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)"), "iPhone");
        assert_eq!(device_name("Mozilla/5.0 (Linux; Android 15; Pixel 8) Mobile Safari/537.36"), "Android");
        assert_eq!(device_name("Mozilla/5.0 (Linux; Android 15; SM-X710) Safari/537.36"), "Android tablet");
        assert_eq!(device_name("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0"), "Windows PC");
        assert_eq!(device_name("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"), "Mac");
    }
    struct Fake {
        phones: Phones,
        calls: Mutex<Vec<String>>,
    }
    impl Host for Fake {
        fn phones(&self) -> &Phones {
            &self.phones
        }
        fn asset(&self, path: &str) -> Option<(Vec<u8>, String)> {
            (path == "/index.html").then(|| (b"<!doctype html>".to_vec(), "text/html".into()))
        }
        fn call(&self, cmd: &str, _args: &Value, held: &mut HashSet<String>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send + '_>> {
            self.calls.lock().unwrap().push(cmd.to_string());
            if cmd == "key" {
                held.insert("F".into());
            }
            Box::pin(async { Ok(Value::Null) })
        }
        fn changed(&self) {}
        fn release(&self, held: HashSet<String>) {
            for k in held {
                self.calls.lock().unwrap().push(format!("release {k}"));
            }
        }
    }

    async fn get(host: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", PORT)).await.unwrap();
        s.write_all(format!("GET / HTTP/1.1\r\nHost: {host}\r\n\r\n").as_bytes()).await.unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        out
    }

    type Client = tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>;
    async fn open(origin: &str) -> Result<Client, String> {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut req = format!("ws://127.0.0.1:{PORT}/link").into_client_request().unwrap();
        req.headers_mut().insert("origin", origin.parse().unwrap());
        let s = tokio::net::TcpStream::connect(("127.0.0.1", PORT)).await.unwrap();
        tokio_tungstenite::client_async(req, s).await.map(|(ws, _)| ws).map_err(|e| e.to_string())
    }
    async fn send(ws: &mut Client, v: Value) {
        use futures_util::SinkExt;
        ws.send(tokio_tungstenite::tungstenite::Message::text(v.to_string())).await.unwrap();
    }
    async fn next(ws: &mut Client) -> Value {
        use futures_util::StreamExt;
        loop {
            match tokio::time::timeout(Duration::from_secs(5), ws.next()).await.expect("a reply in time") {
                Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t))) => return serde_json::from_str(&t).unwrap(),
                Some(Ok(_)) => continue,
                _ => return Value::Null,
            }
        }
    }

    /// The name resolves on the network (multicast, so not in CI): WAN_IP=<this host's address>.
    #[test]
    #[ignore]
    fn live_announces_the_name() {
        let ip: IpAddr = std::env::var("WAN_IP").expect("WAN_IP").parse().unwrap();
        announce_at(move || Some(ip));
        let d = mdns_sd::ServiceDaemon::new().unwrap();
        let rx = d.resolve_hostname(&format!("{LOCAL_NAME}."), Some(5000)).unwrap();
        let mut found = false;
        while let Ok(ev) = rx.recv() {
            match ev {
                mdns_sd::HostnameResolutionEvent::AddressesFound(_, a) => {
                    found = a.iter().any(|x| x.to_ip_addr() == ip);
                    break;
                }
                mdns_sd::HostnameResolutionEvent::SearchTimeout(_) => break,
                _ => {}
            }
        }
        assert!(found, "{LOCAL_NAME} did not resolve to {ip}");
    }

    /// The whole link on a real socket: files, the Host and Origin checks, pairing, proving, a call, and keys let go on a drop.
    #[test]
    fn pairs_and_proves_over_the_link() {
        let host = std::sync::Arc::new(Fake { phones: Phones::default(), calls: Mutex::new(vec![]) });
        host.phones.set_enabled(true);
        start(host.clone());
        tauri::async_runtime::block_on(async {
            tokio::time::sleep(Duration::from_millis(200)).await;
            assert!(get(&format!("127.0.0.1:{PORT}")).await.starts_with("HTTP/1.1 200"));
            assert!(get("evil.example.com").await.starts_with("HTTP/1.1 421"));
            let me = format!("http://127.0.0.1:{PORT}");
            assert!(open("http://evil.example.com").await.is_err());

            // A wrong code is refused; the right one pairs and hands out a token.
            let mut ws = open(&me).await.unwrap();
            assert_eq!(next(&mut ws).await["t"], "hello");
            send(&mut ws, json!({ "t": "pair", "code": "x" })).await;
            assert_eq!(next(&mut ws).await["why"], "code");
            let code = host.phones.view().code.unwrap();
            let mut ws = open(&me).await.unwrap();
            next(&mut ws).await;
            send(&mut ws, json!({ "t": "pair", "code": code })).await;
            let ok = next(&mut ws).await;
            assert_eq!(ok["t"], "ok");
            let (id, token) = (ok["id"].as_str().unwrap().to_string(), ok["token"].as_str().unwrap().to_string());
            drop(ws);

            // Later the phone proves itself with the token, which never travels again.
            let mut ws = open(&me).await.unwrap();
            let hello = next(&mut ws).await;
            send(&mut ws, json!({ "t": "auth", "id": id, "mac": "00" })).await;
            assert_eq!(next(&mut ws).await["why"], "unknown");
            let mut ws2 = open(&me).await.unwrap();
            let nonce = next(&mut ws2).await["nonce"].as_str().unwrap().to_string();
            assert_ne!(nonce, hello["nonce"].as_str().unwrap());
            let mac = hex(&hmac(&unhex(&token).unwrap(), nonce.as_bytes()));
            send(&mut ws2, json!({ "t": "auth", "id": id, "mac": mac })).await;
            let ok = next(&mut ws2).await;
            assert_eq!(ok["t"], "ok");
            assert!(ok.get("token").is_none());
            assert!(host.phones.view().list[0].online);

            // A call runs on the PC and answers; the key it holds is let go when the phone drops.
            send(&mut ws2, json!({ "t": "call", "n": 7, "cmd": "key", "args": {} })).await;
            let ret = next(&mut ws2).await;
            assert_eq!((ret["t"].as_str(), ret["n"].as_u64(), ret["ok"].as_bool()), (Some("ret"), Some(7), Some(true)));
            drop(ws2);
            tokio::time::sleep(Duration::from_millis(200)).await;
            assert_eq!(*host.calls.lock().unwrap(), vec!["key".to_string(), "release F".to_string()]);
            assert!(!host.phones.view().list[0].online);
        });
    }
}
