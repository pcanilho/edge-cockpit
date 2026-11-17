"""After a Star Citizen patch, check what changed for the deck.

Usage:
    python scripts/check_patch.py path/to/new/defaultProfile.xml [--binds binds/layout_edge_cockpit_exported.xml]

Compares the deck layout with the patch's defaultProfile.xml and reports:
  - deck actions the patch removed or renamed, with the closest new names
  - actions whose trigger (tap, hold, double tap...) changed
  - actions that gained or lost a default keyboard key
  - keys in our keybind file that the patch now uses for something else

Exits 1 when the deck needs fixing (a removed action or a key clash), so it can
gate a script. Fix the names in scripts/build_layout.py, then rebuild:
    python scripts/build_layout.py new/defaultProfile.xml > layouts/star-citizen.json
"""
import argparse
import difflib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def combo(s):
    return frozenset(t.strip().lower() for t in s.split('+') if t.strip())


def is_keyboard(kb):
    return bool(kb) and not any(m in kb for m in ('mouse', 'mwheel', 'maxis'))


def load_profile(path):
    """name -> (actionmap, default keyboard key, activation mode), plus every keyboard combo in use."""
    acts, used = {}, {}
    for am in ET.parse(path).getroot().iter('actionmap'):
        for a in am.findall('action'):
            kb = (a.get('keyboard') or '').strip()
            acts.setdefault(a.get('name'), (am.get('name'), kb, a.get('activationMode', '')))
            if kb:
                used.setdefault(combo(kb), []).append(a.get('name'))
            for k in a.iter('keyboard'):
                for s in [k.get('input', '')] + [c.get('input', '') for c in k]:
                    if s.strip():
                        used.setdefault(combo(s), []).append(a.get('name'))
    return acts, used


def sub_keys(k):
    """Every action a deck key sends: its own, its long press and double tap extras and a macro's steps."""
    out = [k] if k.get('action') else []
    out += list((k.get('more') or {}).values())
    out += [st['key'] for st in k.get('steps', []) if st.get('key')]
    return out


def deck_keys():
    data = json.loads((ROOT / 'layouts/star-citizen.json').read_text(encoding='utf-8'))
    keys = [k for d in data['decks'] if d['id'] == 'rail' for k in d['keys'] if k.get('action')]
    for d in data['decks']:
        for pg in d.get('pages', []):
            keys += [s for row in pg['rows'] for k in row if k for s in sub_keys(k)]
    seen, out = set(), []
    for k in keys:
        if k['action'] not in seen:
            seen.add(k['action'])
            out.append(k)
    return out


def our_binds(path):
    out = {}
    if not path.exists():
        return out
    for a in ET.parse(path).getroot().iter('action'):
        for rb in a.iter('rebind'):
            m = re.fullmatch(r'kb\d*_(.+)', rb.get('input', '').strip())
            if m:
                out[a.get('name')] = m.group(1)
    return out


def check(profile, binds_path):
    acts, used = load_profile(profile)
    keys = deck_keys()
    binds = our_binds(binds_path)
    removed, trigger, keyboard, clashes = [], [], [], []

    for k in keys:
        name = k['action']
        if name not in acts:
            same_map = [n for n, v in acts.items() if v[0] == k['actionmap']]
            close = difflib.get_close_matches(name, same_map or list(acts), n=3, cutoff=0.6)
            removed.append(f'{k["label"]} ({k["actionmap"]}-{name})'
                           + (f': maybe {", ".join(close)}' if close else ''))
            continue
        amap, kb, activation = acts[name]
        if activation != (k.get('activation') or ''):
            trigger.append(f'{k["label"]}: {k.get("activation") or "press"} -> {activation or "press"}')
        if is_keyboard(kb) and k['needsKeyboardBind']:
            keyboard.append(f'{k["label"]} now has a default key, {kb}: its line in the keybind file can go')
        elif not is_keyboard(kb) and not k['needsKeyboardBind']:
            keyboard.append(f'{k["label"]} lost its default key {k["defaultKey"]}: it needs one in the keybind file')
        if amap != k['actionmap']:
            removed.append(f'{k["label"]}: moved from {k["actionmap"]} to {amap}')

    for action, key in binds.items():
        others = [n for n in used.get(combo(key), []) if n != action]
        if others:
            clashes.append(f'{key} ({action}) is now also the default for {", ".join(sorted(set(others)))}')

    sections = [
        ('Removed or renamed (the deck key will do nothing)', removed),
        ('Key clashes in the keybind file', clashes),
        ('Trigger changed (check tap vs hold on the deck)', trigger),
        ('Default keyboard key changed', keyboard),
    ]
    return sections, len(keys)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('profile', type=Path, help="the patch's defaultProfile.xml")
    ap.add_argument('--binds', type=Path, default=ROOT / 'binds/layout_edge_cockpit_exported.xml')
    args = ap.parse_args()
    sections, n = check(args.profile, args.binds)
    for title, items in sections:
        if items:
            print(f'{title}:')
            print('\n'.join(f'  - {i}' for i in items))
    if not any(items for _, items in sections):
        print(f'No changes for the deck: all {n} actions are still there and unchanged.')
    if sections[0][1] or sections[1][1]:
        sys.exit(1)


if __name__ == '__main__':
    main()
