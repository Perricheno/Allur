import { useEffect, useState } from 'preact/hooks';

let current = { events: [], startedAt: null, through: null, loading: true, failed: false };
const listeners = new Set();
let source;
const emit = () => { for (const fn of listeners) fn(current); };
function connect() {
  source = new EventSource('/api/network-events');
  source.addEventListener('archive', message => {
    try { current = { ...JSON.parse(message.data), loading: false, failed: false }; emit(); }
    catch { current = { ...current, loading: false, failed: true }; emit(); }
  });
  source.addEventListener('batch', message => {
    try {
      const batch = JSON.parse(message.data);
      const ids = new Set(current.events.map(e => e.id));
      current = { ...current, through: batch.through, events: [...current.events, ...batch.events.filter(e => !ids.has(e.id))], failed: false };
      emit();
    } catch { current = { ...current, failed: true }; emit(); }
  });
  source.onerror = () => { current = { ...current, loading: false, failed: true }; emit(); };
}
export function useNetworkArchive() {
  const [value, setValue] = useState(current);
  useEffect(() => {
    listeners.add(setValue);
    if (!source) connect();
    setValue(current);
    return () => { listeners.delete(setValue); if (!listeners.size) { source?.close(); source = null; } };
  }, []);
  return value;
}
