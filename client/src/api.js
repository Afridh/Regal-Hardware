import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('sepos_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  const loc = localStorage.getItem('sepos_location');
  if (loc) cfg.headers['X-Location-Id'] = loc;
  return cfg;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
      localStorage.removeItem('sepos_token');
      window.dispatchEvent(new Event('sepos:logout'));
    }
    return Promise.reject(err);
  },
);

/** Extract a readable message from an axios error. */
export const errMsg = e => e?.response?.data?.error || e?.message || 'Request failed';

// convenience wrappers returning data directly
export const get  = (url, params) => api.get(url, { params }).then(r => r.data);
export const post = (url, body) => api.post(url, body).then(r => r.data);
export const put  = (url, body) => api.put(url, body).then(r => r.data);
export const del  = url => api.delete(url).then(r => r.data);
