import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';
import './AuthPages.css';

function RegisterPage() {
  const navigate = useNavigate();
  const [registerMode, setRegisterMode] = useState('user'); // user | org_creator
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState('');
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiFetch('/orgs');
        setOrgs(data.orgs || []);
      } catch {
        setOrgs([]);
      }
    };
    load();
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!username.trim()) return setError('请输入用户名');
    if (!password) return setError('请输入密码');
    if (password !== password2) return setError('两次密码不一致');

    if (registerMode === 'org_creator' && !orgName.trim()) return setError('请输入组织名称');

    setLoading(true);
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          register_mode: registerMode,
          org_id: orgId ? Number(orgId) : 0,
          org_name: orgName
        })
      });

      if (registerMode === 'user') {
        if (orgId) {
          setSuccessMsg('注册成功：已提交所属组织申请（待审核），需组织审核通过后生效。请返回登录。');
        } else {
          setSuccessMsg('注册成功：未选择组织，已自动创建个人组织并直接通过。请返回登录。');
        }
      } else {
        setSuccessMsg('注册成功：已作为组织创建者直接通过。请返回登录。');
      }
    } catch (err) {
      setError(err?.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">注册</h2>
        <p className="auth-subtitle">创建账号并选择所属组织</p>
        {error && <div className="auth-error">{error}</div>}
        {successMsg && <div className="auth-error" style={{ borderColor: '#c8e6c9', background: '#f1f8e9', color: '#2e7d32' }}>{successMsg}</div>}
        <form className="auth-form" onSubmit={onSubmit}>
          <div className="auth-field">
            <label>注册类型</label>
            <div className="auth-radio-group">
              <label className="auth-radio">
                <input
                  type="radio"
                  name="registerMode"
                  checked={registerMode === 'user'}
                  onChange={() => setRegisterMode('user')}
                />
                普通用户（选择所属组织，待审核）
              </label>
              <label className="auth-radio">
                <input
                  type="radio"
                  name="registerMode"
                  checked={registerMode === 'org_creator'}
                  onChange={() => setRegisterMode('org_creator')}
                />
                组织创建者（直接通过）
              </label>
            </div>
          </div>

          <div className="auth-field">
            <label>用户名</label>
            <input className="auth-input" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>

          <div className="auth-row">
            <div className="auth-field" style={{ flex: 1 }}>
              <label>密码</label>
              <input className="auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="auth-field" style={{ flex: 1 }}>
              <label>确认密码</label>
              <input className="auth-input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </div>
          </div>

          {registerMode === 'user' ? (
            <div className="auth-field">
              <label>所属组织</label>
              <select className="auth-select" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">不选择（个人使用）</option>
                {orgs.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <div className="auth-hint">选择组织会进入待审核；不选择组织会自动创建个人组织并直接通过。</div>
            </div>
          ) : (
            <div className="auth-field">
              <label>组织名称</label>
              <input className="auth-input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              <div className="auth-hint">创建者注册会自动创建组织并直接通过。</div>
            </div>
          )}

          <div className="auth-actions">
            <button className="auth-btn primary" type="submit" disabled={loading}>
              {loading ? '提交中...' : '注册'}
            </button>
            <a className="auth-link" onClick={() => navigate('/login')}>
              返回登录
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RegisterPage;
