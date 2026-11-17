"""Build layouts/ships.json: every ship and ground vehicle, with its deck role and
the optional kit it carries (missiles, QED, EMP, tractor beam).

Data comes from the Star Citizen Wiki API (https://api.star-citizen.wiki), which
reads the game files. layouts/ship-overrides.json corrects anything it gets wrong,
and each player can pin ships to other roles on their own PC (see README).

Usage:
    python scripts/build_ships.py --fetch           # download, then build
    python scripts/build_ships.py --from DIR        # build from pages saved earlier (p1.json, p2.json...)
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = 'https://api.star-citizen.wiki/api/v2/vehicles?page[size]=50&page[number]={}'
ROLES = ['light-fighter', 'heavy-fighter', 'multi-crew', 'mining', 'salvage', 'cargo', 'medical', 'ground']
KIT = {'MissileLauncher': 'missiles', 'BombLauncher': 'missiles', 'QuantumInterdictionGenerator': 'qed',
       'EMP': 'emp', 'TractorBeam': 'tractor', 'TowingBeam': 'tractor'}
HEAVY = ('heavy fighter', 'gunship', 'gun ship', 'bomber', 'destroyer', 'frigate', 'corvette', 'interdiction')
LIGHT = ('fighter', 'interceptor', 'racing', 'snub')
FREIGHT = ('freight', 'cargo', 'transport', 'hauler')


def fetch(out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    page, last = 1, 1
    while page <= last:
        req = urllib.request.Request(API.format(page), headers={'User-Agent': 'edge-cockpit/1.0', 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
        (out_dir / f'p{page}.json').write_bytes(body)
        last = json.loads(body)['meta']['last_page']
        page += 1
        time.sleep(0.5)


def equipped(ports, out):
    for p in ports or []:
        item = p.get('equipped_item')
        if item and item.get('type'):
            out.add(item['type'])
        equipped(p.get('ports'), out)
    return out


def role_of(v):
    roles = (v.get('role') or '').lower()
    career = (v.get('career') or '').lower()
    crew = (v.get('crew') or {}).get('max') or 1
    if v.get('is_vehicle') or career == 'ground':
        return 'ground'
    if 'mining' in roles or (v.get('ore_capacity') or 0) > 0:
        return 'mining'
    if 'salvage' in roles:
        return 'salvage'
    if 'medical' in roles:
        return 'medical'
    if any(w in roles for w in HEAVY):
        return 'heavy-fighter' if crew <= 3 else 'multi-crew'
    if any(w in roles for w in LIGHT) and crew <= 2:
        return 'light-fighter'
    if any(w in roles for w in FREIGHT) or career in ('transporter', 'transport'):
        return 'cargo'
    return 'multi-crew' if crew >= 2 else 'light-fighter'


def build(pages_dir):
    vehicles = [v for f in sorted(pages_dir.glob('p*.json'), key=lambda f: int(f.stem[1:]))
                for v in json.loads(f.read_text(encoding='utf-8'))['data']]
    ships, version = {}, None
    for v in vehicles:
        if not (v.get('is_spaceship') or v.get('is_vehicle')) or not v.get('class_name'):
            continue
        kit = {KIT[t] for t in equipped(v.get('ports'), set()) if t in KIT}
        role = role_of(v)
        if role == 'cargo':
            kit.add('tractor')  # the API rarely lists cargo tractors; most haulers have one
        ships[v['class_name']] = {'name': v.get('game_name') or v.get('name') or v['class_name'],
                                  'role': role, 'has': sorted(kit)}
        version = version or v.get('version')

    overrides = json.loads((ROOT / 'layouts/ship-overrides.json').read_text(encoding='utf-8'))['ships']
    for cls, o in overrides.items():
        o = {'role': o} if isinstance(o, str) else o
        if o.get('role') and o['role'] not in ROLES:
            sys.exit(f'ship-overrides.json: {cls} has unknown role {o["role"]!r}')
        base = ships.get(cls, {'name': cls, 'role': 'multi-crew', 'has': []})
        ships[cls] = {**base, **{k: o[k] for k in ('name', 'role', 'has') if k in o}}

    return {'source': 'https://api.star-citizen.wiki', 'gameVersion': version,
            'roles': ROLES, 'ships': dict(sorted(ships.items()))}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--fetch', action='store_true')
    g.add_argument('--from', dest='src', type=Path)
    args = ap.parse_args()
    src = args.src
    if args.fetch:
        src = ROOT / '.cache/vehicles'
        fetch(src)
    out = build(src)
    (ROOT / 'layouts/ships.json').write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    counts = {r: sum(1 for s in out['ships'].values() if s['role'] == r) for r in ROLES}
    print(f'{len(out["ships"])} ships and vehicles ({out["gameVersion"]}): ' + ', '.join(f'{r} {n}' for r, n in counts.items()))


if __name__ == '__main__':
    main()
