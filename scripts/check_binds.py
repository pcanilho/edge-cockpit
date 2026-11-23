"""Check that no key in the edge-cockpit control profile presses a game action of its own.

The console presses a bind's keys in order and lets go in reverse: for RCtrl+LAlt+F5 the game
sees RCtrl, then RCtrl+LAlt, then RCtrl+LAlt+F5. The game fires a key's own action even while
it is held for a chord (right Shift alone is Lock rotation), so every one of those steps must be
free in every part of the game, whatever the press type (tap, hold, double tap).

    python scripts/check_binds.py                      check binds/ against layouts/sc-keyboard-4x.json
    python scripts/check_binds.py --dump defaultProfile.xml > layouts/sc-keyboard-4x.json
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULTS = ROOT / 'layouts/sc-keyboard-4x.json'
BINDS = ROOT / 'binds/layout_edge_cockpit_exported.xml'
# Windows itself acts on these whatever the game does.
WINDOWS = [{'lalt', 'f4'}, {'ralt', 'f4'}, {'lctrl', 'lalt', 'delete'}, {'rctrl', 'lalt', 'delete'}, {'lctrl', 'escape'}, {'rctrl', 'escape'}]


def combo(s):
    return frozenset(t.strip().lower() for t in s.split('+') if t.strip())


def dump(profile):
    """Every keyboard default in defaultProfile.xml: actionmap, action, keys, press type."""
    out = []
    for amap in ET.parse(profile).getroot().iter('actionmap'):
        for a in amap.iter('action'):
            mode = a.get('activationMode') or a.get('activationmode') or ''
            binds = [(a.get('keyboard', ''), mode)]
            binds += [(k.get('input', ''), k.get('activationMode') or mode) for k in a.iter('keyboard')]
            for kb, m in binds:
                if kb.strip():
                    out.append([amap.get('name'), a.get('name'), kb.strip().lower(), m])
    return {'source': 'Star Citizen 4.x defaultProfile.xml, via Boxxy-Binder AllBinds.xml', 'binds': out}


def problems(defaults, xml):
    bound = {}
    for amap, action, kb, mode in defaults['binds']:
        bound.setdefault(combo(kb), []).append(f'{amap}/{action} ({mode or "press"})')
    out, seen = [], {}
    keys = [(a.get('name'), m.group(1)) for a in ET.fromstring(xml).iter('action') for rb in a.iter('rebind')
            if (m := re.fullmatch(r'kb\d*_(.+)', rb.get('input', '').strip()))]
    # The spare keys the app swaps in follow the same rules.
    spare = re.search(r'<!-- spare:(.*?)-->', xml)
    keys += [('spare', k) for k in (spare.group(1).split() if spare else [])]
    for name, spec in keys:
        parts = [p.strip().lower() for p in spec.split('+')]
        # Each step the game sees while the console presses the keys in order.
        for i in range(1, len(parts) + 1):
            step = frozenset(parts[:i])
            for hit in bound.get(step, []):
                out.append(f'{name} {spec}: {"+".join(parts[:i])} is {hit}')
        if any(w <= set(parts) for w in WINDOWS):
            out.append(f'{name} {spec}: Windows acts on it')
        if combo(spec) in seen:
            out.append(f'{name} {spec}: also {seen[combo(spec)]}')
        seen[combo(spec)] = name
    return out


def main():
    if sys.argv[1:2] == ['--dump']:
        print(json.dumps(dump(sys.argv[2]), indent=1))
        return
    found = problems(json.loads(DEFAULTS.read_text(encoding='utf-8')), BINDS.read_text(encoding='utf-8'))
    for p in found:
        print(p)
    if found:
        sys.exit(f'{len(found)} profile keys press a game or Windows action')
    print('profile keys are free in every part of the game')


if __name__ == '__main__':
    main()
