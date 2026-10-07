import { useEffect, useState } from 'preact/hooks';
let current = { loading: true }, source;
const listeners = new Set();
function publish(next) { current = next; for (const listener of listeners) listener(current); }
export function useLiveSchedule() {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState); setState(current);
    if (!source) {
      source = new EventSource('/api/schedule-events');
      source.addEventListener('schedule', e => { try { publish({ ...JSON.parse(e.data), loading: false, failed: false }); } catch { publish({ ...current, failed: true }); } });
      source.onerror = () => publish({ ...current, loading: false, failed: true });
    }
    return () => { listeners.delete(setState); if (!listeners.size) { source.close(); source = null; } };
  }, []);
  return state;
}
