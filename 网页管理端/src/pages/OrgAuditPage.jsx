import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

function OrgAuditPage() {
  const [me, setMe] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [applyOrgId, setApplyOrgId] = useState('');
  const [pendingUsers, setPendingUsers] = useState([]);
  const [membersInfo, setMembersInfo] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      const user = await apiFetch('/me');
      setMe(user);
      try {
        const list = await apiFetch('/orgs');
        setOrgs(list.orgs || []);
      } catch {
        setOrgs([]);
      }

      if (user.role === 'org_owner' && user.org_id) {
        const data = await apiFetch(`/orgs/${user.org_id}/pending-users`);
        setPendingUsers(data.users || []);
      } else {
        setPendingUsers([]);
      }

      if (user.org_status === 'approved' && user.org_id) {
        const m = await apiFetch(`/orgs/${user.org_id}/members`);
        setMembersInfo(m);
      } else {
        setMembersInfo(null);
      }

      if (user.pending_org_id) {
        setApplyOrgId(String(user.pending_org_id));
      }
    } catch (err) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const approve = async (userId) => {
    if (!me?.org_id) return;
    setError('');
    try {
      await apiFetch(`/orgs/${me.org_id}/pending-users/${userId}/approve`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err?.message || '操作失败');
    }
  };

  const reject = async (userId) => {
    if (!me?.org_id) return;
    setError('');
    try {
      await apiFetch(`/orgs/${me.org_id}/pending-users/${userId}/reject`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err?.message || '操作失败');
    }
  };

  const removeMember = async (userId) => {
    if (!me?.org_id) return;
    setError('');
    try {
      await apiFetch(`/orgs/${me.org_id}/members/${userId}/remove`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err?.message || '移出失败');
    }
  };

  const apply = async () => {
    if (!applyOrgId) return;
    setError('');
    try {
      await apiFetch(`/orgs/${applyOrgId}/apply`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err?.message || '申请失败');
    }
  };

  if (loading && !me) return <div style={{ padding: 20 }}>加载中...</div>;
  if (error) return <div style={{ padding: 20, color: '#c62828' }}>{error}</div>;

  if (!me) return <div style={{ padding: 20 }}>未登录</div>;
  const orgNameById = (id) => {
    const found = orgs.find(o => String(o.id) === String(id));
    return found?.name || String(id || '');
  };

  if (me.role !== 'org_owner') {
    const status = me.org_status || 'none';
    const isApproved = status === 'approved' && me.org_id;
    const isPending = status === 'pending' && me.pending_org_id;

    return (
      <div style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>所属组织</h2>
        {isApproved ? (
          <>
            <div style={{ color: '#666', marginBottom: 10 }}>状态：已生效</div>
            <div style={{ fontWeight: 600 }}>当前组织：{orgNameById(me.org_id)}</div>
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>组织成员</div>
              {!membersInfo ? (
                <div style={{ color: '#666' }}>加载中...</div>
              ) : (
                <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', background: '#fafafa', padding: 10, fontSize: 12, color: '#666' }}>
                    <div>用户名</div>
                    <div style={{ textAlign: 'right' }}>角色</div>
                  </div>
                  {membersInfo.members.map(m => (
                    <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', padding: 10, borderTop: '1px solid #eee' }}>
                      <div style={{ fontWeight: 600 }}>{m.username}{m.is_owner ? '（创建者）' : ''}</div>
                      <div style={{ textAlign: 'right', color: '#666' }}>{m.role}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ color: '#666', marginBottom: 10 }}>
              状态：{isPending ? `待审核（${orgNameById(me.pending_org_id)}）` : '未加入组织'}
            </div>
            <div style={{ marginBottom: 10, color: '#666', fontSize: 13 }}>
              {isPending ? '可重新选择组织并再次提交申请。' : '选择组织后提交申请，等待组织审核通过后生效。'}
            </div>
            <div style={{ maxWidth: 420, display: 'flex', gap: 10, alignItems: 'center' }}>
              <select
                value={applyOrgId}
                onChange={(e) => setApplyOrgId(e.target.value)}
                style={{ flex: 1, padding: '10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff' }}
              >
                <option value="">请选择组织</option>
                {orgs.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <button
                onClick={apply}
                disabled={!applyOrgId}
                style={{
                  padding: '10px 14px',
                  borderRadius: 6,
                  border: '1px solid #2196F3',
                  background: '#2196F3',
                  color: '#fff',
                  cursor: applyOrgId ? 'pointer' : 'not-allowed',
                  opacity: applyOrgId ? 1 : 0.7
                }}
              >
                {isPending ? '重新申请' : '申请加入'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!me.org_id) return <div style={{ padding: 20 }}>当前账号未绑定组织</div>;

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>组织审核</h2>
      {membersInfo && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>组织成员</div>
          <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px', background: '#fafafa', padding: 10, fontSize: 12, color: '#666' }}>
              <div>用户名</div>
              <div style={{ textAlign: 'right' }}>角色</div>
              <div style={{ textAlign: 'right' }}>操作</div>
            </div>
            {membersInfo.members.map(m => (
              <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px', padding: 10, borderTop: '1px solid #eee', alignItems: 'center' }}>
                <div style={{ fontWeight: 600 }}>{m.username}{m.is_owner ? '（创建者）' : ''}</div>
                <div style={{ textAlign: 'right', color: '#666' }}>{m.role}</div>
                <div style={{ textAlign: 'right' }}>
                  {m.is_owner ? (
                    <span style={{ color: '#999', fontSize: 12 }}>-</span>
                  ) : (
                    <button
                      onClick={() => removeMember(m.id)}
                      style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ffcdd2', background: '#ffcdd2', color: '#c62828', cursor: 'pointer' }}
                    >
                      移出组织
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ color: '#666', marginBottom: 12 }}>待审核用户：{pendingUsers.length} 人</div>
      {pendingUsers.length === 0 ? (
        <div style={{ color: '#666' }}>暂无待审核用户</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pendingUsers.map(u => (
            <div
              key={u.id}
              style={{
                border: '1px solid #ddd',
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{u.username}</div>
                <div style={{ fontSize: 12, color: '#666' }}>状态：{u.org_status}</div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => approve(u.id)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #2196F3', background: '#2196F3', color: '#fff', cursor: 'pointer' }}>
                  通过
                </button>
                <button onClick={() => reject(u.id)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ffcdd2', background: '#ffcdd2', color: '#c62828', cursor: 'pointer' }}>
                  驳回
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default OrgAuditPage;
