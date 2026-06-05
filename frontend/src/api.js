const API_BASE = '';

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, ...data };
}

export const userApi = {
  login: (username) => api('/api/users/login', { method: 'POST', body: { username } }),
  list: () => api('/api/users'),
};

export const batchApi = {
  list: () => api('/api/batches'),
  create: (batch) => api('/api/batches', { method: 'POST', body: batch }),
  get: (id) => api(`/api/batches/${id}`),
};

export const discountApi = {
  list: () => api('/api/discounts'),
  create: (batch_id, discount_rate) =>
    api('/api/discounts', { method: 'POST', body: { batch_id, discount_rate } }),
  publish: (id, operator) =>
    api(`/api/discounts/${id}/publish`, { method: 'POST', body: { operator } }),
  revoke: (id) => api(`/api/discounts/${id}/revoke`, { method: 'POST' }),
};

export const tagApi = {
  list: () => api('/api/tags'),
};
