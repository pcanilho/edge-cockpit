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
}
