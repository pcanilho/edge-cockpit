"""Write a Star Citizen keybind file that binds every deck action that has no keyboard key.

The panel sends keyboard keys, so these actions need one.
Each gets a free key from a pool that Star Citizen leaves unused by default
(right Ctrl / right Shift with F1-F12), so nothing you already use is overwritten.

Usage:
    python scripts/build_binds.py path/to/defaultProfile.xml > binds/layout_edge_cockpit_exported.xml

Then copy the file to
    StarCitizen\\LIVE\\USER\\Client\\0\\Controls\\Mappings
and in game load it from Options > Keybindings > Advanced Controls Customization >
Control Profiles, with Keyboard and Mouse ticked.

The game keeps keyboard keys and mouse buttons in one Keyboard/Mouse slot. Some actions
have a mouse button there by default (quantum engage is the left button), so our key would
take its place. Those also get their mouse button back on the mouse device.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import quoteattr

ROOT = Path(__file__).resolve().parent.parent
PROFILE = 'edge-cockpit'
NAV = ['insert', 'home', 'pgup', 'delete', 'end', 'pgdn']
NUMPAD = [f'np_{n}' for n in range(10)] + ['np_divide', 'np_multiply', 'np_subtract', 'np_period']
# Right Ctrl / right Shift with F1-F12 first, then more right Ctrl chords. Shift is never paired with the
# numpad (it turns numpad keys into arrows), and Ctrl+Alt+Delete is left alone.
POOL = ([f'{mods}+f{n}' for mods in ('rctrl', 'rshift', 'rctrl+rshift') for n in range(1, 13)]
        + [f'rctrl+{k}' for k in NAV + NUMPAD] + [f'rctrl+rshift+{k}' for k in NAV]
        + [f'rctrl+lalt+{k}' for k in [f'f{n}' for n in range(1, 13)] + NAV + NUMPAD if k != 'delete']
        + [f'rshift+{k}' for k in NAV]
        + [f'rctrl+lalt+rshift+f{n}' for n in range(1, 13)])


def combo(s):
    """A key combination as a set of tokens, so 'f5+lalt' and 'lalt+f5' compare equal."""
    return frozenset(t.strip().lower() for t in s.split('+') if t.strip())


def used_keys(default_profile):
    used = set()
    for el in ET.parse(default_profile).getroot().iter():
        if el.tag == 'action' and el.get('keyboard', '').strip():
            used.add(combo(el.get('keyboard')))
        if el.tag == 'keyboard':
            for s in [el.get('input', '')] + [c.get('input', '') for c in el]:
                if s.strip():
                    used.add(combo(s))
    return used


MOUSE_BUTTON = re.compile(r'(?:[lr](?:ctrl|shift|alt)\+)*mouse\d')


def mouse_defaults(default_profile):
    """Actions whose default keyboard bind is a mouse button ('mouse1', 'lalt+mouse1')."""
    out = {}
    for el in ET.parse(default_profile).getroot().iter('action'):
        kb = el.get('keyboard', '').strip().lower()
        if MOUSE_BUTTON.fullmatch(kb):
            out[el.get('name')] = kb
    return out


def sub_keys(k):
    """Every action a deck key sends: its own, its long press and double tap extras and a macro's steps."""
    out = [k] if k.get('action') else []
    out += list((k.get('more') or {}).values())
    out += [st['key'] for st in k.get('steps', []) if st.get('key')]
    return out


def deck_actions():
    data = json.loads((ROOT / 'layouts/star-citizen.json').read_text(encoding='utf-8'))
    keys = [k for k in next(d for d in data['decks'] if d['id'] == 'rail')['keys'] if k.get('action')]
    for page in next(d for d in data['decks'] if d['id'] == 'main')['pages']:
        keys += [s for row in page['rows'] for k in row if k for s in sub_keys(k)]
    keys += next((d['keys'] for d in data['decks'] if d['id'] == 'extras'), [])
    seen, out = set(), []
    for k in keys:
        if k['needsKeyboardBind'] and k['action'] not in seen:
            seen.add(k['action'])
            out.append(k)
    return out


def current_binds():
    """The keys the committed keybind file already gives, so a rebuild doesn't move them."""
    path = ROOT / 'binds/layout_edge_cockpit_exported.xml'
    if not path.exists():
        return {}
    out = {}
    for a in ET.parse(path).getroot().iter('action'):
        for rb in a.iter('rebind'):
            m = re.fullmatch(r'kb\d*_(.+)', rb.get('input', '').strip())
            if m:
                out[a.get('name')] = m.group(1)
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    used = used_keys(sys.argv[1])
    mouse = mouse_defaults(sys.argv[1])
    free = [p for p in POOL if combo(p) not in used]
    actions = deck_actions()
    # Keep each action's key from the current file when it's still free.
    keep = {a: k for a, k in current_binds().items() if k in free and a in {x['action'] for x in actions}}
    free = [p for p in free if p not in keep.values()]
    todo = [k for k in actions if k['action'] not in keep]
    if len(todo) > len(free):
        sys.exit(f'Need {len(todo)} more free keys but the pool has {len(free)}')
    assigned = dict(keep, **{k['action']: key for k, key in zip(todo, free)})

    maps = {}
    for k in actions:
        maps.setdefault(k['actionmap'], []).append((k, assigned[k['action']]))

    out = [
        f'<ActionMaps version="1" optionsVersion="2" rebindVersion="2" profileName="{PROFILE}">',
        f' <CustomisationUIHeader label="{PROFILE}" description="Edge Cockpit: keys for console actions with no default keyboard bind" image="">',
        '  <devices>',
        '   <keyboard instance="1"/>',
        *(['   <mouse instance="1"/>'] if any(k['action'] in mouse for k in actions) else []),
        '  </devices>',
        ' </CustomisationUIHeader>',
        ' <modifiers/>',
    ]
    for amap, items in maps.items():
        out.append(f' <actionmap name={quoteattr(amap)}>')
        for k, key in items:
            out.append(f'  <!-- {k["label"]} -->')
            out.append(f'  <action name={quoteattr(k["action"])}>')
            out.append(f'   <rebind input="kb1_{key}"/>')
            if k['action'] in mouse:
                # Our key takes the Keyboard/Mouse slot; the button moves to the mouse device.
                out.append(f'   <rebind input="mo1_{mouse[k["action"]]}"/>')
            out.append('  </action>')
        out.append(' </actionmap>')
    out.append('</ActionMaps>')
    print('\n'.join(out))


if __name__ == '__main__':
    main()
