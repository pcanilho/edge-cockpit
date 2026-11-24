# Game telemetry

Star Citizen has a local gRPC service that shares your ship's and character's state with apps on the same PC. Edge Cockpit reads it when it is on. It is off by default, CIG hasn't documented it, and it can change with any patch. Without it, the console runs from `Game.log` and your keys.

## Turning it on

Settings > Game link > Turn telemetry on does both of these. Restart the RSI Launcher and the game afterwards.

| Build | Switch |
|---|---|
| 4.10 LIVE | User environment variable `GRPC_CLIENT_SERVER_ENABLED=true`. Read only. |
| 5.0 PTU | `server.game.telemetry.enabled=1` in the channel's `user.cfg`. Reads, and takes commands. |

`Game.log` says `Local services server is running on 127.0.0.1:2942` when the game starts it. The stream begins once your character spawns. The status screen says **Telemetry linked** until then, **Telemetry live** after, and **Telemetry: no answer** when it's turned on but the running game doesn't answer (restart the RSI Launcher). The port is `grpc.client.server.port` in `user.cfg`, or 2942.

## The service

`sc.game.telemetry.v1.GameTelemetryService`. It uses plain HTTP/2 (h2c) on 127.0.0.1 only, with no TLS, no auth and no reflection. The console speaks it with `h2` and hand-written `prost` messages (`app/src-tauri/src/telemetry.rs`), so it has no protoc step.

| RPC | Request | Response |
|---|---|---|
| `TelemetryStream` | empty | stream of frames, about 17 a second |
| `ListTriggerableActions` | empty | `1: repeated { 1: action_name }`. Asked again every 5 s while it lists none (menu, loading), then every minute |
| `TriggerGameAction` | `1: action_name`, `2: hold_ms` (optional) | `1: status`, `2: message` |

`TriggerGameAction` status: 1 ok, 2 unknown action, 3 map inactive (not in this seat or mode), 4 rate limited, 5 failed, 6 hold not allowed, 7 filtered.

A press goes through the game when it is a tap, the game lists its action, and Settings > Game link > Send commands through the game is on. Any other status, no answer within 1.5 s, or a hold sends your key instead. Settings shows which path the last press took. A key with no keyboard bind still works when the game takes its action; its cap reads GAME.

## Fields the console reads

Proto3 leaves out zero and false, so a missing value can mean either. The console shows nothing for a value it can't tell apart from "not sent".

Frame: `3: vehicle`, `4: weapons`, `6: actor`. Each section counts as stale 1.5 s after its last frame.

**vehicle** (`VehicleFrame 2: state`)

| Field | Use |
|---|---|
| `1 name`, `2 class_name` | which ship |
| `5 lights_enabled` | Lights |
| `7 annunciators` (`1 pwr` … `10 misl`) | the ten warning lights: 1 nominal, 2 off, 3/4 minor flashing/on, 5/6 major flashing/on |
| `8 flight.1 state` | `1 is_landed`; `2 gear`, `3 vtol`: 1 retracted, 2 deploying, 3 deployed, 4 retracting |
| `8 flight.2 settings` | `{1 enabled, 2 active}` for `1` coupled, `2` ESP, `3` gravity comp, `4` G-safe, `7` speed limiter, `8` proximity assist, `10` stability, `16` wind comp. A setting the ship doesn't offer (`enabled` false) stays unknown. Also `12`/`13` advanced HUD in SCM/NAV, `19` light amplification. |
| `8 flight.3 instruments` | `1 speed` (m/s), `5 boost.3 reserves` (0–1), `7 radar_altitude` (m; the largest float means none), `8 vertical_speed_indicator` (m/s) |
| `9 power` | `1` power plants, `2` engines, `3` weapons, `8` shield generators |
| `10 shields.1 level` | 0–1 |
| `11 health` | hull, 0–1; exactly 0 reads as not sent |
| `12 master_mode` | `1 mode` (1 NAV, 2 SCM), `2 spooled` |

**weapons**: `1 settings` (`4` staggered fire, `8` gimbals locked); `4 weapons` (`2 is_powered`, `3 ready_to_fire`) for guns ready; `5 countermeasures` (`1 type`: 1 decoy, 2 noise; `2 amount`). The game sends no maximum.

**actor**: `1 vitals` (`1` health, `2` oxygen, `3` hunger, `4` thirst, `5` body temperature as `{1 current, 2 max}`; `7 heart_rate`, `8 gravity`); `2 state` (`1 locomotion`: 1 on foot, 2 EVA, 3 seated; `2 crew_role`: 1 pilot, 2 gunner, 3 crew); `3 environment` (`1 external_temperature`, `3 breathable_atmosphere`). Vitals show only on foot or in EVA.

4.10.3 LIVE (recorded in an RSI Galaxy) also leaves out shields, hull, master mode, vertical speed and radar altitude; the status display then shows only what came. `app/test/fixtures/telemetry-galaxy-410.json` is a frame from that recording.

Not sent, so never shown: door open and lock state (in the schema, empty in 5.0 PTU), port locks, flashlight, auto precision, the gun group, death and respawn. The game also refuses door, lock and port commands; your keys still work for those.

## Recordings

Settings > Game link > Record telemetry saves up to ten minutes of the stream to `Documents\Edge Cockpit\telemetry-<time>.sctl`:

1. One line of JSON: `{"app":"edge-cockpit","format":1,"service":…,"actions":[…],"presses":[[ms,action,result]…],"frames":N}`.
2. Then per frame: milliseconds since the start (u32, big-endian), length (u32, big-endian), and the `TelemetryStream` message bytes.

`app/test/fixtures/telemetry-prospector.json` is a real 5.0 PTU frame (MISC Prospector, landed, pilot seat) the tests run against.

## References

Field numbers are interop facts, checked against three independent extractions from the game binary: [Sokren/sc-telemetry-deck](https://github.com/Sokren/sc-telemetry-deck) (schema), [zolij/sc-telemetry-gateway](https://github.com/zolij/sc-telemetry-gateway) (Apache-2.0) and our own. No code or schema files are copied from them.
