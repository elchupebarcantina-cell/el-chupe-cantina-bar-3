// Cliente HTTP: una sola puerta de entrada al backend.

async function request(method, path, body, options = {}) {
  const opts = {
    method,
    headers: {},
    credentials: 'same-origin'
  };

  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch('/api' + path, opts);

  if (res.status === 204) return null;

  if (options.blob) {
    if (!res.ok) throw new Error('No fue posible descargar el archivo.');
    return res.blob();
  }

  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await res.json();
  else data = await res.text();

  if (!res.ok) {
    const err = new Error((data && data.error) || 'No fue posible completar la operacion.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p, params) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString() : '';
    return request('GET', p + qs);
  },
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p, b) => request('DELETE', p, b),
  upload: (p, formData) => request('POST', p, formData),
  download: async (p, params, filename) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const blob = await request('GET', p + qs, undefined, { blob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
