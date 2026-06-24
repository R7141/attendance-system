import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, setAuthSession } from '../api';
import './AuthPages.css';

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const from = location.state?.from || '/seat-edit';

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      setAuthSession({ token: data.token, user: data.user });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">登录</h2>
        <p className="auth-subtitle">使用账号密码进入管理端</p>
        {error && <div className="auth-error">{error}</div>}
        <form className="auth-form" onSubmit={onSubmit}>
          <div className="auth-field">
            <label>用户名</label>
            <input
              className="auth-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="auth-field">
            <label>密码</label>
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="auth-actions">
            <button className="auth-btn primary" type="submit" disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </button>
            <a className="auth-link" onClick={() => navigate('/register')}>
              去注册
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;

