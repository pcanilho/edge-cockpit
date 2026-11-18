// Maker backdrops for the status screen: line art drawn here, on the 338 x 588 screen. No game
// assets. Each returns the inner markup of an SVG; colour comes from currentColor.
export const ART = {
  DRAK: () => { let p = ''; for (let i = -4; i < 14; i++) p += `<path d="M${i * 46} 300 l120 -120 h26 l-120 120z" fill="currentColor" opacity=".14"/>`;
    for (let y = 40; y < 420; y += 34) p += `<circle cx="318" cy="${y}" r="3.2" fill="currentColor" opacity="0.50"/><circle cx="20" cy="${y}" r="3.2" fill="currentColor" opacity="0.50"/>`;
    return p + '<path d="M40 470 h258 M40 476 h258" stroke="currentColor" stroke-width="2" opacity="0.45"/>'; },
  AEGS: () => { let p = ''; for (let i = 0; i < 9; i++) p += `<path d="M${-60 + i * 52} 588 L${120 + i * 52} 140 L${170 + i * 52} 140" stroke="currentColor" stroke-width="1.5" fill="none" opacity="${.14 + i * .035}"/>`;
    return p + '<path d="M0 120 L338 60 M0 128 L338 68" stroke="currentColor" stroke-width="2" opacity="0.54"/>'; },
  ORIG: () => { let p = ''; for (let r = 60; r < 520; r += 34) p += `<circle cx="300" cy="120" r="${r}" stroke="currentColor" stroke-width="1" fill="none" opacity="${Math.max(.09, .5 - r / 1400)}"/>`; return p; },
  MISC: () => { let p = ''; for (let x = 0; x <= 338; x += 26) p += `<path d="M${x} 0 V588" stroke="currentColor" opacity="0.14"/>`; for (let y = 0; y <= 588; y += 26) p += `<path d="M0 ${y} H338" stroke="currentColor" opacity="0.14"/>`;
    return p + '<circle cx="169" cy="140" r="96" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.54"/><path d="M169 30 V250 M59 140 H279" stroke="currentColor" stroke-dasharray="4 6" opacity="0.60"/>'; },
  ANVL: () => { let p = ''; for (let i = 0; i < 14; i++) p += `<path d="M0 ${80 + i * 36} Q 90 ${50 + i * 36 + (i % 3) * 12} 170 ${80 + i * 36} T 338 ${70 + i * 36}" stroke="currentColor" fill="none" opacity="${.13 + (i % 4) * .05}"/>`;
    return p + '<path d="M24 24 h40 M24 24 v40 M314 24 h-40 M314 24 v40" stroke="currentColor" stroke-width="2.5" opacity="0.60"/>'; },
  RSI: () => { let p = ''; for (let r = 0; r < 7; r++) p += `<circle cx="169" cy="${980 + r * 6}" r="${860 + r * 6}" stroke="currentColor" fill="none" opacity="${.5 - r * .06}"/>`;
    for (let y = 40; y < 300; y += 30) p += `<path d="M24 ${y} h290 M24 ${y + 4} h290" stroke="currentColor" opacity="0.12"/>`;
    return p + '<path d="M24 24 h80 M24 28 h80 M314 24 h-80 M314 28 h-80" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>'; },
  CRUS: () => { let p = ''; for (let row = 0; row < 9; row++) for (let i = 0; i < 4; i++) p += `<rect x="${18 + i * 80 + (row % 2) * 40}" y="${40 + row * 34}" width="56" height="12" rx="6" fill="currentColor" opacity="${.07 + ((row + i) % 3) * .03}"/>`;
    return p + '<path d="M0 360 C 110 320 228 320 338 360" stroke="currentColor" stroke-width="2" fill="none" opacity="0.45"/>'; },
  ARGO: () => { let p = ''; for (let i = -6; i < 6; i++) p += `<path d="M${i * 36} 0 l60 0 l-90 90 l-60 0z" fill="currentColor" opacity=".16" transform="translate(220 0)"/>`;
    for (let y = 120; y < 460; y += 28) p += `<rect x="14" y="${y}" width="10" height="10" fill="currentColor" opacity="0.4"/><rect x="314" y="${y}" width="10" height="10" fill="currentColor" opacity="0.4"/>`;
    return p + '<path d="M40 470 h258" stroke="currentColor" stroke-width="6" opacity="0.35"/>'; },
  CNOU: () => { let p = ''; for (let y = 30; y < 300; y += 22) for (let x = 20; x < 330; x += 22) p += `<circle cx="${x}" cy="${y}" r="1.6" fill="currentColor" opacity="0.28"/>`;
    return p + '<path d="M0 300 L60 240 L96 270 L150 200 L196 252 L240 214 L290 262 L338 230" stroke="currentColor" stroke-width="2" fill="none" opacity="0.5"/><path d="M0 318 L70 270 L120 296 L180 246 L250 290 L338 262" stroke="currentColor" fill="none" opacity="0.25"/>'; },
};
