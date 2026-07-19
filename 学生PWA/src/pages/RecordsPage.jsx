import { useState, useEffect } from 'react'
import { apiFetch } from '../api'

export default function RecordsPage() {
  const [records, setRecords] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const pageSize = 20

  const loadRecords = async (p) => {
    setLoading(true)
    try {
      const data = await apiFetch(`/student/me/records?page=${p}&page_size=${pageSize}`)
      if (p === 1) {
        setRecords(data.records)
      } else {
        setRecords(prev => [...prev, ...data.records])
      }
      setTotal(data.total)
      setPage(p)
    } catch (e) {
      console.error('加载考勤记录失败', e)
    }
    setLoading(false)
  }

  useEffect(() => { loadRecords(1) }, [])

  const hasMore = records.length < total

  return (
    <div className="records-page">
      <div className="records-header">
        <h2>考勤记录</h2>
        <span className="records-count">共 {total} 条</span>
      </div>

      {records.length === 0 && !loading ? (
        <div className="records-empty">暂无考勤记录</div>
      ) : (
        <div className="records-list">
          {records.map(r => (
            <div key={r.id} className="record-card">
              <div className="record-top">
                <span className="record-course">{r.course_name}</span>
                <span className={'record-badge ' + (r.sign_quality === 'warn' ? 'badge-warn' : r.status === 'late' ? 'badge-late' : 'badge-success')}>
                  {r.sign_quality === 'warn' ? '异常' : r.status === 'late' ? '迟到' : '正常'}
                </span>
              </div>
              <div className="record-info">
                <span>{new Date(r.sign_time).toLocaleString('zh-CN')}</span>
                <span>{r.room_id} · {r.seat_label}</span>
              </div>
              {r.warn_reasons && (
                <div className="record-warn">⚠ {r.warn_reasons}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <button className="btn btn-outline btn-load-more" onClick={() => loadRecords(page + 1)} disabled={loading}>
          {loading ? '加载中...' : '加载更多'}
        </button>
      )}
    </div>
  )
}
