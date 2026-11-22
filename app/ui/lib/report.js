// Report a problem: one plain text file with what a bug report needs, the player's
// handle, other players' names, ID numbers and addresses taken out. Nothing is sent:
// the player attaches the file to the GitHub issue if they want to.

// Places in Game.log lines that name a player.
const NAMED = [
  /\bnickname: ([^,\s]+)/g,
  /CActor::Kill: '([^']+)'/g,
  /\bkilled by '([^']+)'/g,
  /\bPlayer: ([\w-]+)/g,
  /\bPlayer '([^']+)'/g,
  /\bActor '([^']+)'/g,
  /\bname ([\w-]+) -/g,
  /channel '[^']*? : ([\w-]+)'/g,
  /"Party ([\w-]+) (?:connected|disconnected)/g,
  /"([\w-]+) Party Invite Received/g,
  /"([\w-]+) has started to QT/g,
  /Calibration (?:Started|Complete) By ([\w-]+)/g,
];
// Spawned AI and things, not people: kept, since they help to read the log.
const NOT_PEOPLE = /^(PU_|NPC_|AI_|[A-Z]{3,5}_)|_\d+$/;

/** The player names in some log lines. */
export function namesIn(lines) {
  const out = new Set();
  for (const line of lines) for (const re of NAMED) for (const m of line.matchAll(re)) {
    const n = m[1];
    if (n && n.length > 2 && !NOT_PEOPLE.test(n)) out.add(n);
  }
  return out;
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Log lines with `me` as <you>, other named players as <player>, long numbers as <id>, IPv4 addresses as <ip>. */
export function redact(lines, me) {
  const names = [...namesIn(lines)].filter(n => n !== me).sort((a, b) => b.length - a.length);
  const swaps = [...(me ? [[me, '<you>']] : []), ...names.map(n => [n, '<player>'])]
    .map(([n, to]) => [new RegExp(`(?<![\\w-])${escRe(n)}(?![\\w-])`, 'g'), to]);
  return lines.map(line => {
    let s = line;
    for (const [re, to] of swaps) s = s.replace(re, to);
    return s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>').replace(/\d{6,}/g, '<id>');
  });
}

/**
 * The report file. `d` carries: version, os, webview, screens [{ name, width, height, scale, touch, current }],
 * game { channel, build, changelist, running }, binds { total, missing, stick, shared, copies, lost },
 * page, ship, settings (object), missing (patch watch), lines (raw Game.log lines), me (handle).
 */
export function reportText(d) {
  const screens = (d.screens || []).map(s => `  ${s.current ? '*' : '-'} ${s.name} ${s.width}x${s.height}${s.scale ? ` at ${Math.round(s.scale * 100)} %` : ''}${s.touch ? ' (touch)' : ''}`);
  const g = d.game || {}, b = d.binds || {};
  const lines = redact(d.lines || [], d.me);
  return [
    'Edge Cockpit report',
    `Made ${d.at || new Date().toISOString()}. Player handle, other players' names, ID numbers and addresses are replaced.`,
    '',
    `Edge Cockpit ${d.version || '?'}`,
    `${d.os || 'Windows ?'} · WebView2 ${d.webview || '?'}`,
    'Screens (* the console):',
    ...(screens.length ? screens : ['  none reported']),
    `Game: ${g.channel || 'not found'}${g.build ? ` ${g.build}` : ''}${g.changelist ? ` (changelist ${g.changelist})` : ''}${g.running ? ', running' : ', not running'}`,
    `Keybinds: ${b.total ?? '?'} keys, ${b.missing ?? 0} with no keyboard key, ${b.stick ?? 0} joystick only, ${b.shared ?? 0} sharing a key. Binds copies: ${b.copies ?? 0}${b.lost ? ', binds look reset' : ''}`,
    `Showing: ${d.page || '?'}${d.ship ? ` · ship ${d.ship}` : ''}`,
    `Log lines missing: ${d.missing || 'none'}`,
    `Settings: ${JSON.stringify(d.settings || {})}`,
    '',
    `Last ${lines.length} Game.log lines the console read:`,
    ...lines,
    '',
  ].join('\n');
}

/** The issue's body: short enough for a link, the file carries the rest. */
export function issueBody(d, path) {
  const g = d.game || {};
  return [
    '### What happened',
    '',
    '(What you pressed or did, what you expected, and what happened instead.)',
    '',
    '### Details',
    '',
    `- Edge Cockpit ${d.version || '?'}, ${d.os || 'Windows ?'}, WebView2 ${d.webview || '?'}`,
    `- Game: ${g.channel || 'not found'}${g.build ? ` ${g.build}` : ''}`,
    `- Screen: ${(d.screens || []).filter(s => s.current).map(s => `${s.name} ${s.width}x${s.height}${s.scale ? ` at ${Math.round(s.scale * 100)} %` : ''}`).join(', ') || '?'}`,
    '',
    `Report file: drag ${path || 'report.txt'} here (Explorer has it selected). Read it first if you like: it is plain text.`,
  ].join('\n');
}
