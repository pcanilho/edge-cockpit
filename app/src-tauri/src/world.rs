// The World page's data from the web: commodity prices that players report to UEX
// (uexcorp.space) and the server status on RSI's status page. Fetched only while the
// page is open, at most every 30 minutes for prices and 5 for the status, and cut down
// here so the console gets a few kilobytes, not megabytes.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const UEX: &str = "https://api.uexcorp.space/2.0";
const RSI_STATUS: &str = "https://status.robertsspaceindustries.com/index.json";
/// UEX caches prices for 30 minutes and the status page for 5, so asking sooner gets nothing new.
const PRICES_EVERY_MS: u64 = 30 * 60_000;
const LISTS_EVERY_MS: u64 = 12 * 3_600_000;
const STATUS_EVERY_MS: u64 = 5 * 60_000;
/// A price nobody has reported for a week is left out rather than shown as the best.
const REPORT_MAX_AGE_S: u64 = 7 * 86_400;
/// The systems the page offers, by their UEX names.
pub const SYSTEMS: [&str; 3] = ["Stanton", "Pyro", "Nyx"];

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A place with trade terminals: a station, city or outpost, and the names it goes by.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Place {
    pub name: String,
    pub system: String,
    /// The planet it orbits or sits on, for "nearby".
    pub planet: Option<String>,
    pub moon: Option<String>,
    /// Its orbit on UEX: "Pyro V Lagrange Point 4" for a Lagrange station.
    pub orbit: Option<String>,
    /// Other names of it on UEX (Grim HEX for Green Imperial Housing Exchange).
    pub aliases: Vec<String>,
}

/// The best price for one commodity at one place, from all its terminals. `buy` is what you
/// pay, `sell` what you get; 0 when nobody reported one this week. Times are Unix seconds.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Quote {
    pub place: usize,
    pub name: String,
    pub buy: f64,
    pub buy_at: u64,
    pub sell: f64,
    pub sell_at: u64,
    /// SCU the cheapest terminal had for sale when the buy price was reported; 0 when unknown.
    #[serde(default)]
    pub buy_scu: u64,
    /// The best paying terminal's own stock when the sell price was reported, as the game's
    /// terminal shows it: 1 empty to 7 full, 0 when unknown.
    #[serde(default)]
    pub sell_status: u8,
}

/// Every place with prices in the systems the page offers. `offline` when the network
/// failed and these are the prices saved at `fetched`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Market {
    pub fetched: u64,
    pub offline: bool,
    pub places: Vec<Place>,
    pub quotes: Vec<Quote>,
    /// Commodity name to its UEX kind (Metal, Gas, Vice…), for the search chips.
    pub kinds: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServiceStatus {
    pub name: String,
    pub status: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Status {
    pub fetched: u64,
    /// operational, degraded, partial or major, as the status page says.
    pub summary: String,
    pub services: Vec<ServiceStatus>,
}

// ---------- UEX rows (only the fields we use) ----------
#[derive(Deserialize)]
struct Envelope<T> {
    status: String,
    #[serde(default = "Vec::new")]
    data: Vec<T>,
}

#[derive(Deserialize, Clone)]
pub struct Terminal {
    id: u64,
    #[serde(default)]
    star_system_name: Option<String>,
    #[serde(default)]
    space_station_name: Option<String>,
    #[serde(default)]
    city_name: Option<String>,
    #[serde(default)]
    outpost_name: Option<String>,
    #[serde(default)]
    planet_name: Option<String>,
    #[serde(default)]
    moon_name: Option<String>,
    #[serde(default)]
    orbit_name: Option<String>,
    #[serde(default)]
    displayname: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    is_available_live: u8,
    #[serde(default)]
    is_visible: u8,
}

#[derive(Deserialize, Clone)]
pub struct CommodityRow {
    name: String,
    #[serde(default)]
    kind: Option<String>,
}

#[derive(Deserialize)]
pub struct PriceRow {
    id_terminal: u64,
    #[serde(default)]
    commodity_name: Option<String>,
    #[serde(default)]
    price_buy: f64,
    #[serde(default)]
    price_sell: f64,
    #[serde(default)]
    date_modified: u64,
    #[serde(default, deserialize_with = "or_zero")]
    scu_buy: f64,
    #[serde(default, deserialize_with = "or_zero")]
    status_sell: f64,
}

/// UEX sends null for a stock nobody reported.
fn or_zero<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(Option::<f64>::deserialize(d)?.unwrap_or(0.0))
}

/// Places with trade terminals in the live game, and the lowest buy and highest sell of each
/// commodity at each, counting only prices reported in the last week.
pub fn market(rows: &[PriceRow], terminals: &[Terminal], now_s: u64) -> (Vec<Place>, Vec<Quote>) {
    let mut places: Vec<Place> = Vec::new();
    let mut at: HashMap<u64, usize> = HashMap::new();
    for t in terminals.iter().filter(|t| t.is_available_live == 1 && t.is_visible == 1) {
        let Some(sys) = t.star_system_name.as_deref().filter(|s| SYSTEMS.contains(s)) else { continue };
        let display = t.displayname.as_deref().or(t.name.as_deref()).filter(|n| !n.is_empty());
        let Some(name) = [&t.space_station_name, &t.city_name, &t.outpost_name].into_iter().flatten().map(String::as_str)
            .find(|n| !n.is_empty()).or(display) else { continue };
        let i = match places.iter().position(|p| p.name == name && p.system == sys) {
            Some(i) => i,
            None => {
                places.push(Place { name: name.into(), system: sys.into(), planet: t.planet_name.clone(), moon: t.moon_name.clone(), orbit: t.orbit_name.clone(), aliases: vec![] });
                places.len() - 1
            }
        };
        if let Some(d) = display.filter(|d| *d != name && !places[i].aliases.iter().any(|a| a == d)) {
            places[i].aliases.push(d.into());
        }
        at.insert(t.id, i);
    }
    let mut quotes: HashMap<(usize, &str), Quote> = HashMap::new();
    for r in rows {
        let (Some(name), Some(&place)) = (r.commodity_name.as_deref(), at.get(&r.id_terminal)) else { continue };
        if r.date_modified + REPORT_MAX_AGE_S < now_s {
            continue;
        }
        let q = quotes.entry((place, name)).or_insert_with(|| Quote { place, name: name.into(), buy: 0.0, buy_at: 0, sell: 0.0, sell_at: 0, buy_scu: 0, sell_status: 0 });
        if r.price_buy > 0.0 && (q.buy == 0.0 || r.price_buy < q.buy) {
            (q.buy, q.buy_at, q.buy_scu) = (r.price_buy, r.date_modified, r.scu_buy.max(0.0) as u64);
        }
        if r.price_sell > 0.0 && r.price_sell > q.sell {
            (q.sell, q.sell_at, q.sell_status) = (r.price_sell, r.date_modified, r.status_sell.clamp(0.0, 7.0) as u8);
        }
    }
    // Only places with a price, numbered afresh.
    let mut used: Vec<usize> = quotes.keys().map(|k| k.0).collect();
    used.sort_unstable();
    used.dedup();
    let renumber: HashMap<usize, usize> = used.iter().enumerate().map(|(n, &i)| (i, n)).collect();
    let mut quotes: Vec<Quote> = quotes.into_values().filter(|q| q.buy > 0.0 || q.sell > 0.0)
        .map(|q| Quote { place: renumber[&q.place], ..q }).collect();
    quotes.sort_by(|a, b| (a.place, &a.name).cmp(&(b.place, &b.name)));
    (used.into_iter().map(|i| places[i].clone()).collect(), quotes)
}

#[derive(Deserialize)]
struct RsiIndex {
    #[serde(rename = "summaryStatus")]
    summary: String,
    #[serde(default)]
    systems: Vec<ServiceStatus>,
}

pub fn parse_status(json: &[u8], now: u64) -> Result<Status, String> {
    let ix: RsiIndex = serde_json::from_slice(json).map_err(|e| format!("status page: {e}"))?;
    Ok(Status { fetched: now, summary: ix.summary, services: ix.systems })
}

fn parse_uex<T: for<'de> Deserialize<'de>>(json: &[u8], what: &str) -> Result<Vec<T>, String> {
    let env: Envelope<T> = serde_json::from_slice(json).map_err(|e| format!("UEX {what}: {e}"))?;
    if env.status != "ok" {
        return Err(format!("UEX {what}: {}", env.status));
    }
    Ok(env.data)
}

// ---------- fetching, with what we had as the fallback ----------
/// Terminals and commodities change with patches, not by the hour.
#[derive(Clone)]
struct Lists {
    at: u64,
    terminals: Vec<Terminal>,
    commodities: Vec<CommodityRow>,
}

#[derive(Default)]
pub struct Cache {
    lists: Mutex<Option<Lists>>,
    prices: Mutex<Option<Market>>,
    status: Mutex<Option<Status>>,
    chart: Mutex<Option<Chart>>,
}

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("EdgeCockpit/", env!("CARGO_PKG_VERSION"), " (+https://github.com/pcanilho/edge-cockpit)"))
            .timeout(Duration::from_secs(25))
            .build()
            .unwrap_or_default()
    })
}

async fn get(url: &str) -> Result<Vec<u8>, String> {
    let r = client().get(url).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("{url}: HTTP {}", r.status().as_u16()));
    }
    r.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}

async fn fetch_market(cache: &Cache) -> Result<Market, String> {
    let now = now_ms();
    let held = cache.lists.lock().unwrap().clone().filter(|l| now - l.at < LISTS_EVERY_MS);
    let lists = match held {
        Some(l) => l,
        None => {
            let terminals: Vec<Terminal> = parse_uex(&get(&format!("{UEX}/terminals")).await?, "terminals")?;
            let commodities: Vec<CommodityRow> = parse_uex(&get(&format!("{UEX}/commodities")).await?, "commodities")?;
            let l = Lists { at: now, terminals, commodities };
            *cache.lists.lock().unwrap() = Some(l.clone());
            l
        }
    };
    let rows: Vec<PriceRow> = parse_uex(&get(&format!("{UEX}/commodities_prices_all")).await?, "prices")?;
    let (places, quotes) = market(&rows, &lists.terminals, now / 1000);
    if quotes.is_empty() {
        return Err("UEX sent no prices for the live game".into());
    }
    let kinds = lists.commodities.into_iter().filter_map(|c| Some((c.name, c.kind?))).collect();
    Ok(Market { fetched: now, offline: false, places, quotes, kinds })
}

/// Fresh prices when the last ones are 30 minutes old; on a network failure the last
/// prices we had (from memory or the file), marked offline.
pub async fn prices(cache: &Cache, file: Option<PathBuf>) -> Result<Market, String> {
    let held = cache.prices.lock().unwrap().clone();
    if let Some(p) = held.as_ref().filter(|p| !p.offline && now_ms() - p.fetched < PRICES_EVERY_MS) {
        return Ok(p.clone());
    }
    match fetch_market(cache).await {
        Ok(p) => {
            if let Some(f) = &file {
                if let Ok(json) = serde_json::to_vec(&p) {
                    let _ = std::fs::create_dir_all(f.parent().unwrap_or(f));
                    let _ = std::fs::write(f, json);
                }
            }
            *cache.prices.lock().unwrap() = Some(p.clone());
            Ok(p)
        }
        Err(e) => {
            let saved = held.or_else(|| file.and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice::<Market>(&b).ok()));
            match saved {
                Some(mut p) => {
                    p.offline = true;
                    *cache.prices.lock().unwrap() = Some(p.clone());
                    Ok(p)
                }
                None => Err(e),
            }
        }
    }
}

/// The RSI status page, at most every 5 minutes. A failure is an error: an old status is not shown.
pub async fn status(cache: &Cache) -> Result<Status, String> {
    if let Some(s) = cache.status.lock().unwrap().clone().filter(|s| now_ms() - s.fetched < STATUS_EVERY_MS) {
        return Ok(s);
    }
    let s = parse_status(&get(RSI_STATUS).await?, now_ms())?;
    *cache.status.lock().unwrap() = Some(s.clone());
    Ok(s)
}

// ---------- the system chart ----------
// What the Map page's chart draws: each system's star, planets, moons, Lagrange points and
// gateways, and the stations and cities that belong to them. UEX gives no positions that
// agree with each other, so this is order and parentage only; the console lays it out.
const CHART_EVERY_MS: u64 = 7 * 86_400_000;

/// A body on the chart. `kind`: planet, moon, lagrange, gateway or asteroid (a base or field
/// that is neither). `slot`: a planet's place from its star (Stanton III is 3). `parent`: the
/// planet a moon or Lagrange point belongs to. `point`: a Lagrange point's number.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ChartBody {
    pub name: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub point: Option<u8>,
}

/// A station or city, and the body it orbits or sits on.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ChartPlace {
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    pub kind: String,
    pub body: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ChartSystem {
    pub name: String,
    pub bodies: Vec<ChartBody>,
    pub places: Vec<ChartPlace>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Chart {
    pub fetched: u64,
    pub offline: bool,
    pub systems: Vec<ChartSystem>,
}

#[derive(Deserialize)]
pub struct OrbitRow {
    name: String,
    #[serde(default)]
    name_origin: Option<String>,
    #[serde(default)]
    star_system_name: Option<String>,
    #[serde(default)]
    is_available: u8,
    #[serde(default)]
    is_available_live: u8,
    #[serde(default)]
    is_visible: u8,
    #[serde(default)]
    is_lagrange: u8,
    #[serde(default)]
    is_planet: u8,
    #[serde(default)]
    is_star: u8,
    #[serde(default)]
    is_jump_point: u8,
}

/// A moon, a station or a city: where it is, and what it is called.
#[derive(Deserialize)]
pub struct PlaceRow {
    name: String,
    #[serde(default)]
    nickname: Option<String>,
    #[serde(default)]
    star_system_name: Option<String>,
    #[serde(default)]
    planet_name: Option<String>,
    #[serde(default)]
    orbit_name: Option<String>,
    #[serde(default)]
    moon_name: Option<String>,
    #[serde(default)]
    is_available: u8,
    #[serde(default)]
    is_available_live: u8,
    #[serde(default)]
    is_visible: u8,
}

const fn shown(available: u8, live: u8, visible: u8) -> bool {
    visible == 1 && (live == 1 || available == 1)
}

/// I to VI.
fn roman(s: &str) -> Option<u8> {
    let n = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"].iter().position(|r| *r == s)?;
    Some(n as u8 + 1)
}

/// "Pyro Gateway (Stanton system)" -> "Pyro Gateway".
fn plain(name: &str) -> String {
    name.split(" (").next().unwrap_or(name).trim().to_string()
}

/// Bodies and places per system, from UEX's orbits, moons, stations and cities.
pub fn chart(orbits: &[OrbitRow], moons: &[PlaceRow], stations: &[PlaceRow], cities: &[PlaceRow]) -> Vec<ChartSystem> {
    let mut out = Vec::new();
    for sys in SYSTEMS {
        let in_sys = |s: &Option<String>| s.as_deref() == Some(sys);
        let mut bodies: Vec<ChartBody> = Vec::new();
        let mut planets: Vec<String> = Vec::new();
        for o in orbits.iter().filter(|o| in_sys(&o.star_system_name) && shown(o.is_available, o.is_available_live, o.is_visible)) {
            if o.is_star == 1 {
                continue;
            }
            let body = if o.is_planet == 1 {
                // Stanton III, Pyro VI: the numeral is the planet's place from its star.
                let slot = o.name_origin.as_deref().and_then(|n| n.rsplit(' ').next()).and_then(roman);
                planets.push(o.name.clone());
                ChartBody { name: o.name.clone(), kind: "planet".into(), slot, parent: None, point: None }
            } else if o.is_lagrange == 1 {
                let Some((planet, n)) = o.name.split_once(" Lagrange Point ") else { continue };
                ChartBody { name: o.name.clone(), kind: "lagrange".into(), slot: None, parent: Some(planet.into()), point: n.trim().parse().ok() }
            } else if o.is_jump_point == 1 {
                ChartBody { name: plain(&o.name), kind: "gateway".into(), slot: None, parent: None, point: None }
            } else {
                ChartBody { name: o.name.clone(), kind: "asteroid".into(), slot: None, parent: None, point: None }
            };
            bodies.push(body);
        }
        // A Lagrange point names its planet in its own case (microTech, not MicroTech): use the planet's.
        let planet = |n: &str| planets.iter().find(|p| p.eq_ignore_ascii_case(n)).cloned();
        bodies.retain_mut(|b| match b.parent.as_deref() {
            Some(p) if b.kind == "lagrange" => planet(p).map(|p| b.parent = Some(p)).is_some(),
            _ => true,
        });
        for m in moons.iter().filter(|m| in_sys(&m.star_system_name) && shown(m.is_available, m.is_available_live, m.is_visible)) {
            let Some(p) = m.planet_name.as_deref().and_then(planet) else { continue };
            bodies.push(ChartBody { name: m.name.clone(), kind: "moon".into(), slot: None, parent: Some(p), point: None });
        }
        bodies.sort_by(|a, b| (a.slot.unwrap_or(99), &a.kind, &a.name).cmp(&(b.slot.unwrap_or(99), &b.kind, &b.name)));
        // A place belongs to its moon, else its orbit (a planet, Lagrange point, gateway or base).
        let body_of = |r: &PlaceRow| -> Option<String> {
            let find = |n: &str| bodies.iter().find(|b| b.name.eq_ignore_ascii_case(n) || b.name.eq_ignore_ascii_case(&plain(n))).map(|b| b.name.clone());
            r.moon_name.as_deref().and_then(find).or_else(|| r.orbit_name.as_deref().and_then(find)).or_else(|| r.planet_name.as_deref().and_then(find))
        };
        let mut places = Vec::new();
        for (rows, kind) in [(stations, "station"), (cities, "city")] {
            for r in rows.iter().filter(|r| in_sys(&r.star_system_name) && shown(r.is_available, r.is_available_live, r.is_visible)) {
                let Some(body) = body_of(r) else { continue };
                let aliases = r.nickname.iter().filter(|n| !n.is_empty() && **n != r.name).cloned().collect();
                places.push(ChartPlace { name: r.name.clone(), aliases, kind: kind.into(), body });
            }
        }
        if !bodies.is_empty() {
            out.push(ChartSystem { name: sys.into(), bodies, places });
        }
    }
    out
}

async fn fetch_chart() -> Result<Chart, String> {
    let orbits: Vec<OrbitRow> = parse_uex(&get(&format!("{UEX}/orbits")).await?, "orbits")?;
    let moons: Vec<PlaceRow> = parse_uex(&get(&format!("{UEX}/moons")).await?, "moons")?;
    let stations: Vec<PlaceRow> = parse_uex(&get(&format!("{UEX}/space_stations")).await?, "stations")?;
    let cities: Vec<PlaceRow> = parse_uex(&get(&format!("{UEX}/cities")).await?, "cities")?;
    let systems = chart(&orbits, &moons, &stations, &cities);
    if systems.is_empty() {
        return Err("UEX sent no systems".into());
    }
    Ok(Chart { fetched: now_ms(), offline: false, systems })
}

/// The chart, fetched once a week (bodies change with patches); the saved one when offline.
pub async fn chart_data(cache: &Cache, file: Option<PathBuf>) -> Result<Chart, String> {
    let held = cache.chart.lock().unwrap().clone();
    let saved = || file.as_ref().and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice::<Chart>(&b).ok());
    let held = held.or_else(saved);
    if let Some(c) = held.as_ref().filter(|c| !c.offline && now_ms().saturating_sub(c.fetched) < CHART_EVERY_MS) {
        *cache.chart.lock().unwrap() = Some(c.clone());
        return Ok(c.clone());
    }
    match fetch_chart().await {
        Ok(c) => {
            if let (Some(f), Ok(json)) = (&file, serde_json::to_vec(&c)) {
                let _ = std::fs::create_dir_all(f.parent().unwrap_or(f));
                let _ = std::fs::write(f, json);
            }
            *cache.chart.lock().unwrap() = Some(c.clone());
            Ok(c)
        }
        Err(e) => match held {
            Some(mut c) => {
                c.offline = true;
                *cache.chart.lock().unwrap() = Some(c.clone());
                Ok(c)
            }
            None => Err(e),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TERMINALS: &str = r#"{"status":"ok","data":[
      {"id":1,"star_system_name":"Stanton","city_name":"Area 18","planet_name":"ArcCorp","displayname":"Area18","is_available_live":1,"is_visible":1},
      {"id":6,"star_system_name":"Stanton","city_name":"Area 18","planet_name":"ArcCorp","displayname":"Area 18 TDD","is_available_live":1,"is_visible":1},
      {"id":2,"star_system_name":"Stanton","outpost_name":"HDMS-Anderson","planet_name":"Hurston","moon_name":"Aberdeen","displayname":"HDMS-Anderson","is_available_live":1,"is_visible":1},
      {"id":3,"star_system_name":"Pyro","space_station_name":"Ruin Station","displayname":null,"name":"Ruin Station","is_available_live":1,"is_visible":1},
      {"id":4,"star_system_name":"Stanton","displayname":"Gone","is_available_live":0,"is_visible":1},
      {"id":5,"star_system_name":"Castra","displayname":"Elsewhere","is_available_live":1,"is_visible":1}]}"#;
    const NOW: u64 = 1_800_000_000;

    fn rows() -> Vec<PriceRow> {
        let d = |h: u64| NOW - h * 3600;
        parse_uex(format!(r#"{{"status":"ok","data":[
          {{"id_terminal":1,"commodity_name":"Gold","price_buy":0,"price_sell":31000,"status_sell":7,"date_modified":{}}},
          {{"id_terminal":2,"commodity_name":"Gold","price_buy":24360,"price_sell":29000,"date_modified":{}}},
          {{"id_terminal":6,"commodity_name":"Gold","price_buy":26000,"price_sell":0,"scu_buy":12,"status_sell":null,"date_modified":{}}},
          {{"id_terminal":4,"commodity_name":"Gold","price_buy":100,"price_sell":99999,"date_modified":{}}},
          {{"id_terminal":5,"commodity_name":"Gold","price_buy":100,"price_sell":99999,"date_modified":{}}},
          {{"id_terminal":2,"commodity_name":"Scrap","price_buy":10,"price_sell":0,"date_modified":{}}},
          {{"id_terminal":3,"commodity_name":"Scrap","price_buy":0,"price_sell":3700,"date_modified":{}}}]}}"#,
          d(5), d(18), d(2), d(1), d(1), d(24 * 8), d(15)).as_bytes(), "prices").unwrap()
    }

    #[test]
    fn best_buy_and_sell_per_place() {
        let t: Vec<Terminal> = parse_uex(TERMINALS.as_bytes(), "terminals").unwrap();
        let (places, quotes) = market(&rows(), &t, NOW);
        let name = |q: &Quote| places[q.place].name.as_str();
        let q: Vec<_> = quotes.iter().map(|q| (name(q), q.name.as_str(), q.buy, q.sell)).collect();
        // Area18's two terminals make one place: the lowest buy and the highest sell of both.
        assert_eq!(q, [("Area 18", "Gold", 26000.0, 31000.0), ("HDMS-Anderson", "Gold", 24360.0, 29000.0), ("Ruin Station", "Scrap", 0.0, 3700.0)]);
        assert_eq!(quotes[0].sell_at, NOW - 5 * 3600);
        // Stock as reported with each best price: Area18's full terminal pays most, the other sells 12 SCU.
        assert_eq!((quotes[0].buy_scu, quotes[0].sell_status), (12, 7));
        assert_eq!((quotes[1].buy_scu, quotes[1].sell_status), (0, 0));
        // Not in the live game, outside the systems offered, or only a week-old report: left out.
        assert_eq!(places.len(), 3);
        assert_eq!(places[0].aliases, ["Area18", "Area 18 TDD"]);
        assert_eq!((places[1].planet.as_deref(), places[1].moon.as_deref()), (Some("Hurston"), Some("Aberdeen")));
    }


    #[test]
    fn chart_orders_and_parents() {
        let orbits: Vec<OrbitRow> = parse_uex(br#"{"status":"ok","data":[
          {"name":"ArcCorp","name_origin":"Stanton III","star_system_name":"Stanton","is_available":1,"is_available_live":1,"is_visible":1,"is_planet":1},
          {"name":"MicroTech","name_origin":"Stanton IV","star_system_name":"Stanton","is_available":1,"is_available_live":1,"is_visible":1,"is_planet":1},
          {"name":"microTech Lagrange Point 1","star_system_name":"Stanton","is_available":1,"is_available_live":1,"is_visible":1,"is_lagrange":1},
          {"name":"Nowhere Lagrange Point 2","star_system_name":"Stanton","is_available":1,"is_available_live":1,"is_visible":1,"is_lagrange":1},
          {"name":"Pyro Gateway (Stanton system)","star_system_name":"Stanton","is_available":1,"is_available_live":1,"is_visible":1,"is_jump_point":1},
          {"name":"Stanton (Star)","star_system_name":"Stanton","is_available":1,"is_available_live":1,"is_visible":1,"is_star":1},
          {"name":"Nyx I","star_system_name":"Nyx","is_available":0,"is_available_live":0,"is_visible":0,"is_planet":1},
          {"name":"Delamar","star_system_name":"Nyx","is_available":1,"is_available_live":0,"is_visible":1}]}"#, "orbits").unwrap();
        let moons: Vec<PlaceRow> = parse_uex(br#"{"status":"ok","data":[{"name":"Lyria","star_system_name":"Stanton","planet_name":"ArcCorp","is_available":1,"is_available_live":1,"is_visible":1}]}"#, "moons").unwrap();
        let stations: Vec<PlaceRow> = parse_uex(br#"{"status":"ok","data":[
          {"name":"MIC-L1 Shallow Frontier Station","nickname":"MIC-L1","star_system_name":"Stanton","orbit_name":"microTech Lagrange Point 1","is_available":1,"is_available_live":1,"is_visible":1},
          {"name":"Pyro Gateway (Stanton)","nickname":"Pyro Gateway (Stanton)","star_system_name":"Stanton","orbit_name":"Pyro Gateway (Stanton system)","is_available":1,"is_available_live":1,"is_visible":1},
          {"name":"Wikelo Emporium Kinga Station","star_system_name":"Stanton","is_available":1,"is_available_live":1,"is_visible":1}]}"#, "stations").unwrap();
        let cities: Vec<PlaceRow> = parse_uex(br#"{"status":"ok","data":[
          {"name":"Area 18","star_system_name":"Stanton","planet_name":"ArcCorp","orbit_name":"ArcCorp","is_available":1,"is_available_live":1,"is_visible":1},
          {"name":"Levski","star_system_name":"Nyx","orbit_name":"Delamar","is_available":1,"is_available_live":1,"is_visible":1}]}"#, "cities").unwrap();
        let c = chart(&orbits, &moons, &stations, &cities);
        let st = &c[0];
        let b: Vec<_> = st.bodies.iter().map(|b| (b.name.as_str(), b.kind.as_str(), b.slot, b.parent.as_deref(), b.point)).collect();
        // Planets by their place from the star; the Lagrange point takes its planet's name; no star, no orphan point.
        assert_eq!(b, [("ArcCorp", "planet", Some(3), None, None), ("MicroTech", "planet", Some(4), None, None), ("Pyro Gateway", "gateway", None, None, None),
            ("microTech Lagrange Point 1", "lagrange", None, Some("MicroTech"), Some(1)), ("Lyria", "moon", None, Some("ArcCorp"), None)]);
        let p: Vec<_> = st.places.iter().map(|p| (p.name.as_str(), p.kind.as_str(), p.body.as_str())).collect();
        // A station with no orbit is left out: there is nothing to draw it next to.
        assert_eq!(p, [("MIC-L1 Shallow Frontier Station", "station", "microTech Lagrange Point 1"), ("Pyro Gateway (Stanton)", "station", "Pyro Gateway"), ("Area 18", "city", "ArcCorp")]);
        assert_eq!(st.places[0].aliases, ["MIC-L1"]);
        // Nyx: hidden planets left out; Delamar is in the game though not marked live.
        assert_eq!(c[1].name, "Nyx");
        assert_eq!(c[1].bodies.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(), ["Delamar"]);
        assert_eq!(c[1].places[0].body, "Delamar");
    }

    #[test]
    fn uex_errors_are_errors() {
        assert!(parse_uex::<Terminal>(br#"{"status":"requests_limit_reached","data":[]}"#, "terminals").is_err());
        assert!(parse_uex::<Terminal>(b"<html>", "terminals").is_err());
    }

    #[test]
    fn reads_the_status_page() {
        let s = parse_status(br#"{"summaryStatus":"disrupted","systems":[{"name":"Platform","status":"operational","category":"x"},{"name":"Persistent Universe","status":"degraded"}]}"#, 7).unwrap();
        assert_eq!(s.summary, "disrupted");
        assert_eq!(s.services.iter().map(|x| (x.name.as_str(), x.status.as_str())).collect::<Vec<_>>(),
            [("Platform", "operational"), ("Persistent Universe", "degraded")]);
    }

    /// Against the live services: cargo test -- --ignored live_
    #[test]
    #[ignore]
    fn live_prices_and_status() {
                let cache = Cache::default();
        let p = tauri::async_runtime::block_on(prices(&cache, None)).unwrap();
        for sys in SYSTEMS {
            let n = p.places.iter().filter(|x| x.system == sys).count();
            eprintln!("{sys}: {n} places");
            assert!(n > 5, "{sys} has only {n} places");
        }
        let a18 = p.places.iter().position(|x| x.name == "Area 18").unwrap();
        let gold = p.quotes.iter().find(|q| q.place == a18 && q.name == "Gold");
        eprintln!("{} quotes, {} kinds; Gold at Area 18: {gold:?}", p.quotes.len(), p.kinds.len());
        eprintln!("{} bytes as JSON", serde_json::to_vec(&p).unwrap().len());
        // WORLD_DUMP=path keeps what the console would get, for UI previews.
        if let Ok(path) = std::env::var("WORLD_DUMP") {
            std::fs::write(path, serde_json::to_vec(&p).unwrap()).unwrap();
        }
        let s = tauri::async_runtime::block_on(status(&cache)).unwrap();
        eprintln!("RSI: {} {:?}", s.summary, s.services);
        assert!(!s.services.is_empty());
        // Asked again within 30 minutes: the same prices, no new request.
        let again = tauri::async_runtime::block_on(prices(&cache, None)).unwrap();
        assert_eq!(again.fetched, p.fetched);
    }

    /// The chart from UEX: cargo test -- --ignored live_chart (CHART_DUMP=path keeps it, for UI previews).
    #[test]
    #[ignore]
    fn live_chart() {
        let cache = Cache::default();
        let c = tauri::async_runtime::block_on(chart_data(&cache, None)).unwrap();
        for s in &c.systems {
            eprintln!("chart {}: {} bodies, {} places", s.name, s.bodies.len(), s.places.len());
        }
        assert!(c.systems.iter().any(|s| s.name == "Stanton" && s.bodies.iter().filter(|b| b.kind == "planet").count() == 4));
        if let Ok(path) = std::env::var("CHART_DUMP") {
            std::fs::write(path, serde_json::to_vec(&c).unwrap()).unwrap();
        }
        eprintln!("{} bytes as JSON", serde_json::to_vec(&c).unwrap().len());
    }
}
