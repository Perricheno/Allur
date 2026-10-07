// Скачивает станции и остановочные пункты Казахстана из OpenStreetMap (Overpass API) и пишет public/data/kz-stations.json.
// Данные © участники OpenStreetMap, лицензия ODbL 1.0. Запуск: node tools/build-kz-network.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const query = tag => `[out:json][timeout:100];area["ISO3166-1"="KZ"][admin_level=2]->.a;(node["railway"="${tag}"](area.a););out body;`;
async function fetchElements(tag) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'ktz-hackathon/1.0 (educational)', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query(tag))}` });
      if (res.ok) return (await res.json()).elements;
    } catch { /* пробуем другой сервер */ }
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error(`Overpass недоступен для railway=${tag}`);
}
const skip = new Set(['subway', 'light_rail', 'monorail', 'tram']);
const round = x => Math.round(x * 1e4) / 1e4;
function pack(elements, fallback) {
  return elements.filter(e => !skip.has(e.tags?.station)).map(e => {
    const t = e.tags || {};
    const ru = t['name:ru'] || t.name || t['name:kk'] || fallback;
    const kk = t['name:kk'] && t['name:kk'] !== ru ? t['name:kk'] : undefined;
    return [e.id, ru, round(e.lat), round(e.lon), ...(kk ? [kk] : [])];
  }).sort((a, b) => a[1].localeCompare(b[1], 'ru'));
}
const stations = pack(await fetchElements('station'), 'Станция без названия');
const halts = pack(await fetchElements('halt'), 'Остановочный пункт');
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/kz-stations.json', import.meta.url), JSON.stringify({
  capturedAt: new Date().toISOString().slice(0, 10), source: 'https://www.openstreetmap.org/copyright', license: 'ODbL-1.0',
  note: 'Формат записи: [osmId, название, широта, долгота, название по-казахски (если отличается)]. Данные OpenStreetMap могут быть неполными.',
  stations, halts,
}));
console.log(`станций: ${stations.length}, остановочных пунктов: ${halts.length}`);
