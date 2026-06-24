import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE_URL, getAuthToken } from '../api';
import './ClassRosterPage.css';

function coerceMembersArray(members) {
  if (!Array.isArray(members) || members.length === 0) return [];
  return members
    .map((m) => {
      if (typeof m === 'string') return { name: m, studentId: '' };
      if (m && typeof m === 'object') {
        return { name: String(m.name || '').trim(), studentId: String(m.studentId || '').trim() };
      }
      return { name: '', studentId: '' };
    })
    .map(r => ({ name: String(r?.name || '').trim(), studentId: String(r?.studentId || '').trim() }))
    .filter(r => r.name || r.studentId);
}

function normalizeMemberRows(rows) {
  const cleaned = (Array.isArray(rows) ? rows : [])
    .map(r => ({ name: String(r?.name || '').trim(), studentId: String(r?.studentId || '').trim() }))
    .filter(r => r.name || r.studentId);

  const seen = new Set();
  const out = [];
  for (const r of cleaned) {
    const key = r.studentId ? `id:${r.studentId}` : `name:${r.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function ClassRosterPage() {
  const navigate = useNavigate();
  const [rosters, setRosters] = useState([]);
  const [newRosterName, setNewRosterName] = useState('');
  const [editingRosterId, setEditingRosterId] = useState(null);
  const [membersDraftRows, setMembersDraftRows] = useState([{ name: '', studentId: '' }]);
  const membersFileRef = useRef(null);

  const fetchRosters = async () => {
    try {
      const data = await apiFetch('/rosters');
      setRosters(Array.isArray(data.rosters) ? data.rosters : []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchRosters();
  }, []);

  const rosterById = useMemo(() => {
    const map = new Map();
    for (const r of rosters) {
      if (r?.id) map.set(r.id, r);
    }
    return map;
  }, [rosters]);

  const addRoster = async () => {
    const name = newRosterName.trim();
    if (!name) return;
    try {
      await apiFetch('/rosters', {
        method: 'POST',
        body: JSON.stringify({ name, members: [] })
      });
      setNewRosterName('');
      fetchRosters();
    } catch (err) {
      alert(err.message);
    }
  };

  const deleteRoster = async (id) => {
    if (!window.confirm('确定要删除吗？')) return;
    try {
      await apiFetch(`/rosters/${id}`, { method: 'DELETE' });
      if (editingRosterId === id) {
        setEditingRosterId(null);
        setMembersDraftRows([{ name: '', studentId: '' }]);
      }
      fetchRosters();
    } catch (err) {
      alert(err.message);
    }
  };

  const updateRosterNameLocal = (id, name) => {
    setRosters(prev => prev.map(r => (r.id === id ? { ...r, name } : r)));
  };

  const saveRosterName = async (id) => {
    const roster = rosterById.get(id);
    if (!roster) return;
    try {
      await apiFetch(`/rosters/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: roster.name, members: roster.members })
      });
    } catch (err) {
      console.error(err);
      fetchRosters(); // 失败还原
    }
  };

  const openMembersEditor = (id) => {
    const roster = rosterById.get(id);
    setEditingRosterId(id);
    const members = coerceMembersArray(roster?.members);
    setMembersDraftRows(members.length ? members : [{ name: '', studentId: '' }]);
  };

  const saveMembersEditor = async () => {
    if (!editingRosterId) return;
    const dup = (() => {
      const seen = new Set();
      const dups = new Set();
      for (const r of (Array.isArray(membersDraftRows) ? membersDraftRows : [])) {
        const sid = String(r?.studentId || '').trim();
        if (!sid) continue;
        if (seen.has(sid)) dups.add(sid);
        else seen.add(sid);
      }
      return Array.from(dups);
    })();
    if (dup.length) {
      alert(`学号重复：${dup.join(', ')}`);
      return;
    }
    const members = normalizeMemberRows(membersDraftRows);
    const roster = rosterById.get(editingRosterId);
    try {
      await apiFetch(`/rosters/${editingRosterId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: roster.name, members })
      });
      setEditingRosterId(null);
      setMembersDraftRows([{ name: '', studentId: '' }]);
      fetchRosters();
    } catch (err) {
      alert(err.message);
    }
  };

  const memberCountDraft = useMemo(() => normalizeMemberRows(membersDraftRows).length, [membersDraftRows]);

  const addMemberRow = () => {
    setMembersDraftRows(prev => [...prev, { name: '', studentId: '' }]);
  };

  const updateMemberRow = (index, patch) => {
    setMembersDraftRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeMemberRow = (index) => {
    setMembersDraftRows(prev => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [{ name: '', studentId: '' }];
    });
  };

  const downloadMembersTemplate = async () => {
    const token = getAuthToken();
    const url = `${API_BASE_URL}/members/template`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      let msg = '下载失败';
      try {
        const j = JSON.parse(text);
        msg = j?.message || msg;
      } catch {
        msg = text || msg;
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'members_template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const importMembersFromExcel = async (file) => {
    if (!file) return [];
    const token = getAuthToken();
    const url = `${API_BASE_URL}/members/import`;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new Error(data?.message || '导入失败');
    }
    if (data && typeof data === 'object' && 'code' in data) {
      if (data.code !== 0) throw new Error(data.message || '导入失败');
      const members = data?.data?.members;
      return Array.isArray(members) ? members : [];
    }
    return Array.isArray(data?.members) ? data.members : [];
  };

  return (
    <div className="class-roster-page">
      <div className="page-header">
        <h2>班级成员名单</h2>
        <div className="controls">
          <button type="button" className="btn-secondary" onClick={() => navigate('/class-edit')}>
            返回课程管理
          </button>
        </div>
      </div>

      <div className="roster-create">
        <input
          className="text-input"
          placeholder="新建班级名称，如：高一(1)班"
          value={newRosterName}
          onChange={(e) => setNewRosterName(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={addRoster}>
          新建班级
        </button>
      </div>

      <div className="roster-list">
        {rosters.length === 0 ? (
          <div className="empty-hint">暂无班级名单，先新建一个班级。</div>
        ) : (
          rosters.map(r => (
            <div key={r.id} className="roster-card">
              <div className="roster-main">
                <input
                  className="text-input"
                  value={r.name || ''}
                  onChange={(e) => updateRosterNameLocal(r.id, e.target.value)}
                  onBlur={() => saveRosterName(r.id)}
                />
                <div className="roster-meta">成员：{Array.isArray(r.members) ? r.members.length : 0} 人</div>
              </div>
              <div className="roster-actions">
                <button type="button" className="btn-secondary" onClick={() => openMembersEditor(r.id)}>
                  编辑成员
                </button>
                <button type="button" className="btn-danger" onClick={() => deleteRoster(r.id)}>
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editingRosterId && (
        <div className="modal-overlay">
          <div className="modal-content modal-content-wide">
            <h3>编辑成员：{rosterById.get(editingRosterId)?.name || editingRosterId}</h3>
            <div className="form-group">
              <label>成员列表</label>
              <div className="members-grid">
                <div className="members-grid-header">姓名</div>
                <div className="members-grid-header">学号</div>
                <div className="members-grid-header members-grid-op">操作</div>
                {membersDraftRows.map((row, idx) => (
                  <div key={idx} className="members-grid-row">
                    <input
                      className="text-input"
                      placeholder="姓名"
                      value={row.name}
                      onChange={(e) => updateMemberRow(idx, { name: e.target.value })}
                    />
                    <input
                      className="text-input"
                      placeholder="学号"
                      value={row.studentId}
                      onChange={(e) => updateMemberRow(idx, { studentId: e.target.value })}
                    />
                    <button type="button" className="btn-danger btn-small" onClick={() => removeMemberRow(idx)}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <div className="members-toolbar">
                <div className="members-toolbar-left">
                  <button type="button" className="btn-secondary" onClick={addMemberRow}>+ 增加一行</button>
                  <button type="button" className="btn-secondary" onClick={() => downloadMembersTemplate().catch(e => alert(e.message))}>下载模板</button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => membersFileRef.current?.click()}
                  >
                    Excel导入
                  </button>
                  <input
                    ref={membersFileRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      importMembersFromExcel(f)
                        .then((members) => {
                          const rows = coerceMembersArray(members);
                          setMembersDraftRows(prev => [...(Array.isArray(prev) ? prev : []), ...rows].filter(r => (r?.name || r?.studentId)));
                        })
                        .catch((err) => alert(err.message));
                    }}
                  />
                </div>
                <div className="hint-text">当前共 {memberCountDraft} 人</div>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => { setEditingRosterId(null); setMembersDraftRows([{ name: '', studentId: '' }]); }}>
                取消
              </button>
              <div className="right-actions">
                <button type="button" className="btn-primary" onClick={saveMembersEditor}>
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClassRosterPage;
