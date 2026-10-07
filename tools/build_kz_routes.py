#!/usr/bin/env python3
"""Строит маршруты железнодорожной сети Казахстана для моделирования движения поездов по всей стране.

Берёт геометрию путей из OpenStreetMap (Overpass API, © участники OpenStreetMap, ODbL 1.0), собирает граф,
находит кратчайшие пути между крупными узлами и пишет public/data/kz-routes.json:
упрощённые ломаные, станции вдоль маршрута и долю электрифицированного участка.
Запуск:  python3 tools/build_kz_routes.py   (нужен интернет; результат кэшируется в /tmp)
"""
import collections, heapq, json, math, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = '/tmp/ov_rail_all.json'
ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
QUERY = '[out:json][timeout:280];area["ISO3166-1"="KZ"][admin_level=2]->.a;way["railway"="rail"][!"service"](area.a);out geom tags;'
R = 6371.0

def hav(a, b):
    p = math.radians(b[0] - a[0]); q = math.radians(b[1] - a[1])
    h = math.sin(p / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(q / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def short(name):
    return re.sub(r'([ -](\d|I))$', '', name)

def fetch_rails():
    if os.path.exists(CACHE):
        return json.load(open(CACHE))['elements']
    for attempt in range(8):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': QUERY}).encode(), headers={'User-Agent': 'ktz-hackathon/1.0 (educational)'})
            raw = urllib.request.urlopen(req, timeout=300).read()
            data = json.loads(raw)
            open(CACHE, 'wb').write(raw)
            return data['elements']
        except Exception as e:  # пробуем другой сервер
            print('overpass:', e, file=sys.stderr); time.sleep(8)
    raise SystemExit('Overpass недоступен')

# узлы сети: (название на карте, широта, долгота, вес)
HUBS = {
 'AST': ('Астана-1', 51.1959, 71.41, 5), 'ALA': ('Алматы-2', 43.274, 76.939, 5), 'KRG': ('Караганда', 49.7931, 73.0948, 4), 'DOS': ('Достык', 45.2529, 82.4867, 4),
 'ALT': ('Алтынколь', 44.1649, 80.2954, 3), 'MOY': ('Мойынты', 47.2183, 73.3604, 3), 'ATY': ('Атырау', 47.1295, 51.9568, 3), 'AKT': ('Актобе-1', 50.2808, 57.2142, 3),
 'KOS': ('Костанай', 53.2274, 63.6063, 2), 'PAV': ('Павлодар', 52.3004, 76.9725, 2), 'SEM': ('Семей', 50.4319, 80.2628, 2), 'PET': ('Петропавловск', 54.8564, 69.1704, 2),
 'KYZ': ('Кызылорда', 44.8547, 65.4954, 2), 'MAN': ('Мангистау', 43.697, 51.309, 2), 'SAR': ('Сарыагаш', 41.4651, 69.1476, 2), 'UKG': ('Усть-Каменогорск', 49.9561, 82.6477, 2),
 'ZHZ': ('Джезказган', 47.7775, 67.6917, 2), 'EKI': ('Экибастуз-1', 51.7511, 75.3174, 2), 'BAL': ('Балхаш 1', 46.861, 74.934, 2), 'TAR': ('Тараз', 42.8697, 71.3789, 1),
 'ARY': ('Арыс 1', 42.4193, 68.7935, 1), 'SHA': ('Шалкар', 47.8341, 59.622, 1), 'KAN': ('Кандагач', 49.4706, 57.4274, 1), 'BEY': ('Бейнеу', 45.3221, 55.1966, 1),
 'KOK': ('Кокшетау I', 53.2888, 69.4232, 1), 'ARK': ('Аркалык', 50.2423, 66.907, 1), 'AKG': ('Актогай', 46.9531, 79.6817, 1), 'HRO': ('Хромтау', 50.305, 58.3718, 1),
 'LIS': ('Лисаковск', 52.5355, 62.4852, 1), 'ATB': ('Атбасар-1', 51.8054, 68.3473, 1),
}
PAIRS = [('AST','ALA'),('AST','KRG'),('AST','PAV'),('AST','PET'),('AST','KOK'),('AST','KOS'),('AST','AKT'),('AST','KYZ'),('AST','ZHZ'),('ALA','ALT'),('DOS','AST'),
 ('KRG','MOY'),('KRG','PAV'),('KRG','ZHZ'),('KRG','EKI'),('KRG','BAL'),('MOY','ZHZ'),('SEM','PAV'),('SEM','UKG'),('SEM','DOS'),('SEM','AST'),('UKG','PAV'),('AKT','ATY'),('AKT','KOS'),
 ('AKT','SHA'),('AKT','KAN'),('SHA','KYZ'),('KYZ','SAR'),('KYZ','ARY'),('ATY','MAN'),('ATY','BEY'),('BEY','MAN'),('BEY','KYZ'),('PET','KOS'),('PET','PAV'),('KOS','ARK'),('ZHZ','AKT'),
 ('EKI','PAV'),('AKG','SEM'),('AKG','DOS'),('LIS','KOS'),('ARK','AST'),('ATB','AST'),('ARY','SAR'),('MAN','AKT'),('KYZ','AKT'),('ALA','TAR')]
MAX_RATIO = 2.1  # путь длиннее прямой более чем в 2,1 раза считаем разрывом данных и пропускаем

def main():
    rails = fetch_rails()
    net = json.load(open(os.path.join(ROOT, 'public/data/kz-stations.json')))
    key = lambda p: (round(p[0], 5), round(p[1], 5))
    pos, adj = {}, collections.defaultdict(dict)
    for w in rails:
        g = [(p['lat'], p['lon']) for p in w['geometry']]
        el = w.get('tags', {}).get('electrified', 'no') != 'no'
        for a, b in zip(g, g[1:]):
            ka, kb = key(a), key(b)
            if ka == kb: continue
            pos[ka], pos[kb] = a, b
            d = hav(a, b)
            if kb not in adj[ka] or adj[ka][kb][0] > d: adj[ka][kb] = (d, el); adj[kb][ka] = (d, el)
    def components():
        seen, sizes = {}, []
        for n in adj:
            if n in seen: continue
            st = [n]; seen[n] = len(sizes); c = 0
            while st:
                x = st.pop(); c += 1
                for y in adj[x]:
                    if y not in seen: seen[y] = len(sizes); st.append(y)
            sizes.append(c)
        return seen, sizes
    seen, _ = components()
    cell = 0.01; grid = collections.defaultdict(list)
    for k, p in pos.items(): grid[(int(p[0] / cell), int(p[1] / cell))].append(k)
    for k, p in list(pos.items()):  # стыкуем обрывы данных: вершины разных компонент ближе 600 м
        ci, cj = int(p[0] / cell), int(p[1] / cell); best, bd = None, 0.6
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for k2 in grid.get((ci + di, cj + dj), []):
                    if seen[k2] != seen[k]:
                        d = hav(p, pos[k2])
                        if d < bd: bd, best = d, k2
        if best: adj[k][best] = (bd, False); adj[best][k] = (bd, False)
    seen, sizes = components()
    main_comp = max(range(len(sizes)), key=lambda i: sizes[i])
    print('вершин', len(adj), 'в основной сети', sizes[main_comp])
    cell2 = 0.05; grid2 = collections.defaultdict(list)
    for k, p in pos.items():
        if seen[k] == main_comp: grid2[(int(p[0] / cell2), int(p[1] / cell2))].append(k)
    def nearest(lat, lon, maxkm=4.0):
        best, bd = None, 1e9; ci, cj = int(lat / cell2), int(lon / cell2)
        for di in range(-3, 4):
            for dj in range(-3, 4):
                for k in grid2.get((ci + di, cj + dj), []):
                    d = hav((lat, lon), pos[k])
                    if d < bd: bd, best = d, k
        return best if best and bd <= maxkm else None
    node = {k: nearest(v[1], v[2]) for k, v in HUBS.items()}
    def dijkstra(src):
        dist, prev, pq = {src: 0.0}, {}, [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, 1e18): continue
            for v, (w, _) in adj[u].items():
                nd = d + w
                if nd < dist.get(v, 1e18): dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
        return dist, prev
    stations = [(r[1], r[2], r[3]) for r in net['stations']]
    routes, cache = [], {}
    for a, b in PAIRS:
        sa, sb = node[a], node[b]
        if sa is None or sb is None: continue
        if sa not in cache: cache[sa] = dijkstra(sa)
        dist, prev = cache[sa]
        if sb not in dist: continue
        path = [sb]
        while path[-1] != sa: path.append(prev[path[-1]])
        path.reverse()
        pts = [pos[k] for k in path]
        length = dist[sb]
        if length / max(hav(pts[0], pts[-1]), 1) > MAX_RATIO or not 80 <= length <= 2200: continue
        electrified = sum(adj[path[i - 1]][path[i]][0] for i in range(1, len(path)) if adj[path[i - 1]][path[i]][1]) / length
        cum = [0.0]
        for i in range(1, len(pts)): cum.append(cum[-1] + hav(pts[i - 1], pts[i]))
        # упрощение ломаной (Дуглас — Пёкер, допуск 0,25 км) в плоской проекции
        lat0 = math.radians(pts[len(pts) // 2][0])
        xy = [(p[1] * math.cos(lat0) * 111.32, p[0] * 110.57) for p in pts]
        keep = {0, len(pts) - 1}; stack = [(0, len(pts) - 1)]
        while stack:
            i, j = stack.pop()
            (x1, y1), (x2, y2) = xy[i], xy[j]; dx, dy = x2 - x1, y2 - y1; norm = math.hypot(dx, dy) or 1e-9
            far, fd = -1, 0.25
            for k in range(i + 1, j):
                d = abs(dy * (xy[k][0] - x1) - dx * (xy[k][1] - y1)) / norm
                if d > fd: far, fd = k, d
            if far >= 0: keep.add(far); stack += [(i, far), (far, j)]
        idx = sorted(keep)
        simple = [[round(pts[i][0], 4), round(pts[i][1], 4), round(cum[i], 2)] for i in idx]
        # станции вдоль маршрута: ближайшая вершина пути не дальше 1,2 км
        pgrid = collections.defaultdict(list)
        for i, p in enumerate(pts): pgrid[(int(p[0] / 0.02), int(p[1] / 0.02))].append(i)
        stops = []
        for name, lat, lon in stations:
            best, bd = None, 1.2; ci, cj = int(lat / 0.02), int(lon / 0.02)
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    for i in pgrid.get((ci + di, cj + dj), []):
                        d = hav((lat, lon), pts[i])
                        if d < bd: bd, best = d, i
            if best is not None: stops.append([name, round(cum[best], 1)])
        stops.sort(key=lambda s: s[1])
        dedup = []
        for s in stops:
            if not dedup or s[0] != dedup[-1][0] and s[1] - dedup[-1][1] > 0.5: dedup.append(s)
        wa, wb = HUBS[a][3], HUBS[b][3]
        routes.append({'id': f'{a}-{b}', 'name': f'{short(HUBS[a][0])} — {short(HUBS[b][0])}', 'from': HUBS[a][0], 'to': HUBS[b][0],
                       'km': round(length, 1), 'electrified': round(electrified, 2), 'weight': max(1, round(math.sqrt(wa * wb))), 'points': simple, 'stops': dedup})
        print(f'{a}-{b}: {length:.0f} км, точек {len(simple)}, станций {len(dedup)}, электрификация {electrified:.0%}')
    out = {'capturedAt': time.strftime('%Y-%m-%d'), 'source': 'https://www.openstreetmap.org/copyright', 'license': 'ODbL-1.0',
           'note': 'Ломаные — реальные пути по OpenStreetMap. Точка: [широта, долгота, километр от начала]. Маршруты между крупными узлами; данные могут быть неполными.',
           'routes': routes}
    path = os.path.join(ROOT, 'public/data/kz-routes.json')
    json.dump(out, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('маршрутов', len(routes), 'размер', os.path.getsize(path) // 1024, 'КБ')

if __name__ == '__main__':
    main()
