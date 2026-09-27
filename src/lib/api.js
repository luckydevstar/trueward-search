/**
 * The browser's only way to the data.
 *
 * Every call lands on a route handler in src/app/api/, which runs as the
 * signed-in user and lets RLS decide. There is no Supabase client on this
 * side of the wire except the one that signs in.
 */
async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  list: (params) => req(`/jobs?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
  create: (job) => req('/jobs', { method: 'POST', body: job }),
  update: (id, patch) => req(`/jobs/${id}`, { method: 'PATCH', body: patch }),
  remove: (id, permanent = false) => req(`/jobs/${id}${permanent ? '?permanent=1' : ''}`, { method: 'DELETE' }),
  dismissMany: (ids) => req('/jobs/dismiss', { method: 'POST', body: { ids } }),
  restoreMany: (ids) => req('/jobs/restore', { method: 'POST', body: { ids } }),
  status: () => req('/status'),
  refresh: () => req('/refresh', { method: 'POST', body: {} }),
};
