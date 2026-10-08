// Shared adapter for the design/3D layer. This file does not render or alter the UI.
export function createAllurModelClient({ baseUrl = '' } = {}) {
  async function request(path, { body, signal } = {}) {
    const response = await fetch(baseUrl + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
    return data;
  }
  return {
    state: signal => request('/api/state', { signal }),
    catalog: signal => request('/api/model', { signal }),
    command: (body, signal) => request('/api/actions', { body, signal }),
    compare: (body, signal) => request('/api/scenarios/compare', { body, signal }),
    comparison: (id, signal) => request(`/api/scenarios/jobs/${encodeURIComponent(id)}`, { signal }),
    comparisons: signal => request('/api/scenarios/jobs', { signal }),
    subscribe(onState, onConnection = () => {}) {
      const stream = new EventSource(baseUrl + '/api/events'); let revision = -1, active = true;
      const refresh = new AbortController();
      const accept = state => { if (active && state.revision >= revision) { revision = state.revision; onState(state); } };
      stream.onopen = () => onConnection('connected');
      stream.onerror = () => onConnection('reconnecting');
      stream.addEventListener('state', event => {
        try { accept(JSON.parse(event.data)); }
        catch (error) { onConnection('invalid_data', error); }
      });
      // Mobile browsers suspend tabs; fetch a fresh snapshot when the phone wakes up.
      const resume = () => { if (document.visibilityState === 'visible') request('/api/state', { signal: refresh.signal }).then(accept).catch(() => {}); };
      document.addEventListener('visibilitychange', resume);
      return () => { active = false; refresh.abort(); stream.close(); document.removeEventListener('visibilitychange', resume); };
    },
  };
}
