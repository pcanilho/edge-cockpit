"""Check that the layout and the panel's glyphs agree. Runs in CI on every PR.

Usage: python scripts/check_layout.py

Fails when the layout is malformed, a key names a glyph that doesn't exist, or a key presses an
action that isn't in the game's 4.x keybinds (layouts/sc-actions-4x.json, the action names from
the game's defaultProfile.xml). Refresh that list when a patch renames actions.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROLES = {'critical', 'toggle', 'select', 'hold', 'menu', 'action', 'macro'}
errors = []


def err(msg):
    errors.append(msg)


layout = json.loads((ROOT / 'layouts/star-citizen.json').read_text(encoding='utf-8'))
glyphs = set(re.findall(r"^\s+'?([a-z-]+)'?:\s*'", (ROOT / 'app/ui/lib/glyphs.js').read_text(encoding='utf-8'), re.M))

if layout.get('format') != 'xeneon-sc-deck/3':
    err(f"unexpected format {layout.get('format')!r}")
decks = {d['id']: d for d in layout.get('decks', [])}
main, rail = decks.get('main'), decks.get('rail')
if not main or not rail:
    err('layout needs a rail and a main deck')
    main, rail = {'pages': []}, {'keys': []}

cols, rows = main.get('grid', [8, 4])


# The bottom row (flight and panic keys) must be identical on every page.
def fixed_cells(pg):
    return [(k or {}).get('label') for k in pg['rows'][-1]]


decked = [pg for pg in main['pages'] if not pg.get('side')]  # the left deck is a page of its own shape
if decked:
    ref = fixed_cells(decked[0])
    for pg in decked[1:]:
        if fixed_cells(pg) != ref:
            err(f'{pg["id"]}: bottom row differs from {main["pages"][0]["id"]}')

page_ids = set()
for pg in main['pages']:
    pid = pg['id']
    page_ids.add(pid)
    if pg['theme'].get('glyph') not in glyphs:
        err(f'{pid}: page glyph {pg["theme"].get("glyph")!r} not in glyphs.js')
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', pg['theme'].get('accent', '')):
        err(f'{pid}: accent must be a #rrggbb colour')
    if len(pg['rows']) != (4 if pg.get('side') else rows):
        err(f'{pid}: expected {rows} rows, found {len(pg["rows"])}')
    for r, row in enumerate(pg['rows']):
        width = sum((k or {}).get('span', 1) for k in row)
        if width != cols:
            err(f'{pid} row {r + 1}: keys fill {width} columns, expected {cols}')
        for k in row:
            if not k:
                continue
            where = f'{pid} / {k.get("label")}'
            for field in ('label', 'action', 'actionmap', 'press', 'role', 'icon', 'needsKeyboardBind'):
                if field not in k:
                    err(f'{where}: missing {field}')
            if k.get('role') not in ROLES:
                err(f'{where}: unknown role {k.get("role")!r}')
            if k.get('icon') not in glyphs:
                err(f'{where}: glyph {k.get("icon")!r} not in glyphs.js')
            if k.get('role') in ('toggle', 'select') and 'state' not in k:
                err(f'{where}: {k["role"]} key needs a state')
            for how, sub in (k.get('more') or {}).items():
                if how not in ('double', 'hold'):
                    err(f'{where}: second action slot {how!r} must be double or hold')
                if k.get('role') not in ('action', 'menu') or sub.get('press') != 'tap' or 'state' in sub:
                    err(f'{where}: second actions only pair plain tap keys')
            if k.get('role') == 'macro':
                steps = k.get('steps') or []
                if not any('key' in st for st in steps):
                    err(f'{where}: a macro needs at least one key')
                for st in steps:
                    if 'page' in st and st['page'] not in [p['id'] for p in main['pages']]:
                        err(f'{where}: macro opens unknown page {st["page"]!r}')
                    if 'key' in st and (st['key'].get('press') != 'tap' or 'state' in st['key']):
                        err(f'{where}: macro step {st["key"].get("label")!r} must be a plain tap key')
    for g in pg.get('groups', []):
        if g['col'] + g['w'] > cols or g['row'] + g['h'] > (4 if pg.get('side') else rows):
            err(f'{pid}: group {g["label"]!r} runs off the grid')

for k in rail['keys']:
    if k.get('type') == 'page':
        if k['page'] not in page_ids:
            err(f'rail: tab points at unknown page {k["page"]!r}')
    elif k.get('icon') not in glyphs:
        err(f'rail: unknown glyph {k.get("icon")!r}')

role_ids = {r['id'] for r in layout.get('roles', [])}
for pg in main['pages']:
    if pg.get('role'):
        if pg['role']['id'] not in role_ids or pg['profile'] != pg['role']['id']:
            err(f'{pg["id"]}: bad role {pg["role"]!r}')
        if pg['role']['tab'] not in page_ids:
            err(f'{pg["id"]}: role lights unknown tab {pg["role"]["tab"]!r}')
    elif pg.get('side'):
        if pg['profile'] != pg['side']:
            err(f'{pg["id"]}: the {pg["side"]} deck has a profile of its own')
    elif pg.get('profile') != 'main':
        err(f'{pg["id"]}: a general page belongs in the main profile')
    if pg.get('event') and pg.get('tab') not in page_ids:
        err(f'{pg["id"]}: event page lights unknown tab {pg.get("tab")!r}')
for rid in role_ids:
    if rid not in page_ids:
        err(f'role {rid}: no full page (one without hidden keys)')
ships = json.loads((ROOT / 'layouts/ships.json').read_text(encoding='utf-8'))['ships']
for cls, ship in ships.items():
    if ship['role'] not in role_ids:
        err(f'ships.json: {cls} has unknown role {ship["role"]!r}')
for where, pid in layout.get('defaultPages', {}).items():
    if pid not in page_ids:
        err(f'defaultPages.{where}: unknown page {pid!r}')

# Every action the console presses must exist in the game's 4.x keybinds, in the same actionmap.
GAME = {m: set(a) for m, a in json.loads((ROOT / 'layouts/sc-actions-4x.json').read_text(encoding='utf-8'))['actions'].items()}


def walk(node, where=''):
    if isinstance(node, dict):
        if node.get('action') and node.get('actionmap'):
            am, act = node['actionmap'], node['action']
            if am not in GAME:
                err(f'{node.get("label", where)}: actionmap {am!r} not in the 4.x keybinds')
            elif act not in GAME[am]:
                elsewhere = [m for m, a in GAME.items() if act in a]
                err(f'{node.get("label", where)}: {act!r} not in {am}' + (f' (found in {", ".join(elsewhere)})' if elsewhere else ' (gone from 4.x)'))
        for k, v in node.items():
            walk(v, node.get('label', where))
    elif isinstance(node, list):
        for v in node:
            walk(v, where)


walk(layout)
if errors:
    print('\n'.join(errors))
    sys.exit(f'{len(errors)} problem(s) found')
keys = sum(1 for pg in main['pages'] for row in pg['rows'] for k in row if k)
print(f'Layout OK: {len(main["pages"])} pages, {keys} keys, {len(glyphs)} glyphs')
