/*
 * @Author: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @Date: 2026-03-01 17:40:37
 * @LastEditors: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @LastEditTime: 2026-03-04 21:08:03
 * @FilePath: \sign_in_system_server\管理端\web_console\src\api.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : 'http://127.0.0.1:8080';

export function getAuthToken() {
  return localStorage.getItem('authToken') || '';
}

export function setAuthSession({ token, user }) {
  if (token) localStorage.setItem('authToken', token);
  if (user) localStorage.setItem('authUser', JSON.stringify(user));
}

export function clearAuthSession() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
}

export async function apiFetch(path, options = {}) {
  let url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  if (!options.method || options.method === 'GET') {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}_t=${Date.now()}`;
  }
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body != null) headers.set('Content-Type', 'application/json');
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const token = getAuthToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearAuthSession();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
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
