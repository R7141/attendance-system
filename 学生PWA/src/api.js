export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || '';

export function getStudentToken() {
  return localStorage.getItem('studentToken') || '';
}
export function setStudentToken(token) {
  localStorage.setItem('studentToken', token);
}
export function clearStudentSession() {
  localStorage.removeItem('studentToken');
  localStorage.removeItem('studentInfo');
}
export function getStudentInfo() {
  try {
    const raw = localStorage.getItem('studentInfo');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function setStudentInfo(info) {
  localStorage.setItem('studentInfo', JSON.stringify(info));
}

export async function apiFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : API_BASE_URL + path;
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body != null)
    headers.set('Content-Type', 'application/json');
  if (!headers.has('Accept'))
    headers.set('Accept', 'application/json');
  const token = getStudentToken();
  if (token && !headers.has('Authorization'))
    headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401) {
      clearStudentSession();
      if (window.location.pathname !== '/login')
        window.location.href = '/login';
    }
    const msg = data?.message || data?.Message || '请求失败';
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (data && typeof data === 'object' && 'code' in data) {
    if (data.code !== 0) {
      const err = new Error(data.message || '请求失败');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data.data;
  }
  return data;
}
