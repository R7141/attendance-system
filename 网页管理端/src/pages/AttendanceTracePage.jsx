import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE_URL, getAuthToken } from '../api';
import './AttendanceTracePage.css';

function AttendanceTracePage() {
  const navigate = useNavigate();
  const [authUser, setAuthUser] = useState(null);
  const isOrgOwner = authUser?.role === 'org_owner';

  const [courses, setCourses] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [hasMore, setHasMore] = useState(false);

  const [filterRosterId, setFilterRosterId] = useState('');
  const [filterCourseId, setFilterCourseId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('authUser');
      if (raw) setAuthUser(JSON.parse(raw));
    } catch {
      setAuthUser(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const [rostersRes, coursesRes] = await Promise.all([
          apiFetch('/rosters'),
          apiFetch(isOrgOwner ? '/attendance/courses' : '/courses'),
        ]);
        if (!mounted) return;
        setRosters(Array.isArray(rostersRes?.rosters) ? rostersRes.rosters : []);
        setCourses(Array.isArray(coursesRes?.courses) ? coursesRes.courses : []);
      } catch (e) {
        if (mounted) alert(e.message);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [isOrgOwner]);

  const rosterNameById = useMemo(() => {
    const m = new Map();
    for (const r of rosters || []) m.set(String(r.id), String(r.name || r.id));
    return m;
  }, [rosters]);

  const courseLabel = (c) => {
    if (!c) return '';
    const base = c.name ? `${c.name} (#${c.id})` : `#${c.id}`;
    return c.username ? `${base} · ${c.username}` : base;
  };

  const runQuery = async (opts) => {
    const nextPage = Number(opts?.page || page) || 1;
    const nextPageSize = Number(opts?.page_size || pageSize) || 50;
    const nextRosterId = opts?.roster_id ?? filterRosterId;
    const nextCourseId = opts?.course_id ?? filterCourseId;
    const nextFrom = opts?.from ?? filterFrom;
    const nextTo = opts?.to ?? filterTo;

    if (nextPageSize !== pageSize) setPageSize(nextPageSize);
    if (nextRosterId !== filterRosterId) setFilterRosterId(nextRosterId);
    if (nextCourseId !== filterCourseId) setFilterCourseId(nextCourseId);
    if (nextFrom !== filterFrom) setFilterFrom(nextFrom);
    if (nextTo !== filterTo) setFilterTo(nextTo);
    if (nextPage !== page) setPage(nextPage);

    const p = new URLSearchParams();
    if (nextRosterId) p.set('roster_id', nextRosterId);
    if (nextCourseId) p.set('course_id', nextCourseId);
    if (nextFrom) p.set('from', nextFrom);
    if (nextTo) p.set('to', nextTo);
    p.set('limit', String(nextPageSize));
    p.set('offset', String(Math.max(0, (nextPage - 1) * nextPageSize)));

    setIsLoading(true);
    try {
      const res = await apiFetch(`/attendance/sessions?${p.toString()}`);
      setSessions(Array.isArray(res?.sessions) ? res.sessions : []);
      setHasMore(!!res?.has_more);
    } catch (e) {
      alert(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authUser) return;
    runQuery({ page: 1 });
  }, [authUser]);

  const downloadExport = async (sessionId) => {
    const sid = Number(sessionId || 0) || 0;
    if (!sid) throw new Error('无效的场次ID');
    const token = getAuthToken();
    const url = `${API_BASE_URL}/attendance/sessions/${sid}/export`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      let msg = '导出失败';
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
    a.download = `attendance_session_${sid}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="attendance-trace-page">
      <div className="trace-header">
        <h2>考勤追溯</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button className="btn-secondary" onClick={() => runQuery({ page: 1 })} disabled={isLoading}>查询</button>
          <button
            className="btn-secondary"
            onClick={() => runQuery({ page: 1, roster_id: '', course_id: '', from: '', to: '' })}
            disabled={isLoading}
          >
            重置
          </button>
        </div>
      </div>

      <div className="trace-filters">
        <div className="filter-item">
          <label>班级</label>
          <select value={filterRosterId} onChange={(e) => setFilterRosterId(e.target.value)}>
            <option value="">全部</option>
            {rosters.map(r => (
              <option key={r.id} value={r.id}>{r.name || r.id}</option>
            ))}
          </select>
        </div>
        <div className="filter-item">
          <label>课程</label>
          <select value={filterCourseId} onChange={(e) => setFilterCourseId(e.target.value)}>
            <option value="">全部</option>
            {courses.map(c => (
              <option key={c.id} value={c.id}>{courseLabel(c)}</option>
            ))}
          </select>
        </div>
        <div className="filter-item">
          <label>开始日期</label>
          <input
            type="date"
            className={filterFrom ? '' : 'date-empty'}
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
          />
        </div>
        <div className="filter-item">
          <label>结束日期</label>
          <input
            type="date"
            className={filterTo ? '' : 'date-empty'}
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
          />
        </div>
      </div>

      <div className="trace-table-wrap">
        <table className="trace-table">
          <thead>
            <tr>
              <th>场次ID</th>
              <th>课程</th>
              <th>班级</th>
              <th>教室</th>
              <th>开始时间</th>
              <th>结束时间</th>
              <th>状态</th>
              <th>签到人数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>
                  <div className="cell-title">{s.course_name || `#${s.course_id}`}</div>
                  <div className="cell-sub">{s.teacher_username ? `授课：${s.teacher_username}` : ''}</div>
                </td>
                <td>{s.class_roster_id ? (rosterNameById.get(String(s.class_roster_id)) || s.class_roster_id) : '-'}</td>
                <td>{s.room_id || '-'}</td>
                <td>{s.start_time ? new Date(s.start_time).toLocaleString() : '-'}</td>
                <td>{s.end_time ? new Date(s.end_time).toLocaleString() : '-'}</td>
                <td>{s.is_active ? '进行中' : '已结束'}</td>
                <td>{typeof s.sign_in_count === 'number' ? s.sign_in_count : '-'}</td>
                <td>
                  <button
                    className="btn-small"
                    onClick={() => navigate(`/sign-monitor?course_id=${s.course_id}&session_id=${s.id}`)}
                  >
                    查看详情
                  </button>
                  {!s.is_active ? (
                    <button
                      className="btn-small"
                      style={{ marginLeft: '8px' }}
                      onClick={() => downloadExport(s.id).catch(e => alert(e.message))}
                      disabled={isLoading}
                    >
                      导出Excel
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!sessions.length && (
              <tr>
                <td colSpan={9} className="empty-row">{isLoading ? '加载中...' : '暂无数据'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="trace-pagination">
        <div className="page-size">
          <span>每页</span>
          <select value={pageSize} onChange={(e) => runQuery({ page: 1, page_size: Number(e.target.value) })}>
            {[20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>条</span>
        </div>
        <div className="page-actions">
          <button className="btn-small" disabled={isLoading || page <= 1} onClick={() => runQuery({ page: page - 1 })}>上一页</button>
          <span className="page-indicator">第 {page} 页</span>
          <button className="btn-small" disabled={isLoading || !hasMore} onClick={() => runQuery({ page: page + 1 })}>下一页</button>
        </div>
      </div>
    </div>
  );
}

export default AttendanceTracePage;
