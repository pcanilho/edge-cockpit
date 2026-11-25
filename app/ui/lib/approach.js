// Follow game opens the Approach page by itself around the ground, from what the game sends:
// landing when the gear starts down or radar altitude drops under 300 m while descending, takeoff
// when Landed turns to Flying. It hands the page back 5 s after touchdown, or once radar altitude
// has stayed above 400 m with the gear up for 5 s. The 300 to 400 m gap and the 5 s hold keep it
// from flapping; the altitude rule re-arms only after the ship has been above 400 m.
export const OPEN_BELOW = 300, CLOSE_ABOVE = 400, HOLD_MS = 5000, SINKING = -1;
const DOWN = new Set([2, 3]); // gear lowering or down
const UP = 1;

/** A fresh state: nothing open, nothing seen yet. */
export const idle = () => ({ open: null, landed: null, gear: null, armed: false, since: 0 });

/**
 * One telemetry update. `d` holds { landed, gear, ralt, vsi } (null when not sent).
 * Returns { state, act } where act is 'open', 'close' or null.
 */
export function step(s, d, now) {
  const next = { ...s, landed: d.landed ?? s.landed, gear: d.gear ?? s.gear };
  const high = d.ralt != null && d.ralt > CLOSE_ABOVE;
  if (high) next.armed = true;
  let act = null;
  if (!s.open) {
    const tookOff = s.landed === true && d.landed === false;
    const gearDown = d.landed === false && DOWN.has(d.gear) && s.gear != null && !DOWN.has(s.gear);
    const sinking = d.landed === false && s.armed && d.ralt != null && d.ralt < OPEN_BELOW && d.vsi != null && d.vsi < SINKING;
    if (tookOff || gearDown || sinking) { next.open = tookOff ? 'takeoff' : 'landing'; next.since = 0; act = 'open'; }
  } else {
    // What ends it: on the ground, or clear of it with the gear up.
    const done = d.landed === true || (d.landed === false && high && (d.gear == null || d.gear === UP));
    if (!done) next.since = 0;
    else if (!s.since) next.since = now;
    else if (now - s.since >= HOLD_MS) { next.open = null; next.since = 0; next.armed = false; act = 'close'; }
  }
  return { state: next, act };
}
