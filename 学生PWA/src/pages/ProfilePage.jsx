import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStudentInfo, clearStudentSession, apiFetch } from '../api'

export default function ProfilePage() {
  const info = getStudentInfo()
  const navigate = useNavigate()

  const [studentClass, setStudentClass] = useState(
    () => localStorage.getItem('studentClass') || ''
  )
  const [editingClass, setEditingClass] = useState(false)
  const [classInput, setClassInput] = useState(studentClass)
  const [autoClass, setAutoClass] = useState(null)

  useEffect(() => {
    apiFetch('/student/me/class')
      .then(data => {
        const c = data?.class_name || ''
        if (c) {
          setStudentClass(c)
          localStorage.setItem('studentClass', c)
        }
        setAutoClass(c)
      })
      .catch(() => setAutoClass(''))
  }, [])

  const handleSaveClass = () => {
    const val = classInput.trim()
    setStudentClass(val)
    localStorage.setItem('studentClass', val)
    setEditingClass(false)
  }

  const handleLogout = () => {
    clearStudentSession()
    navigate('/login', { replace: true })
  }

  const classRow = () => {
    if (autoClass) {
      return <span className="profile-value">{autoClass}</span>
    }
    if (autoClass === null) {
      return <span className="profile-value">{studentClass || '加载中...'}</span>
    }
    if (editingClass) {
      return (
        <div className="profile-edit-group">
          <input
            type="text"
            value={classInput}
            onChange={e => setClassInput(e.target.value)}
            placeholder="输入班级名称"
            autoFocus
            className="profile-input"
          />
          <button className="btn btn-primary btn-small" onClick={handleSaveClass}>保存</button>
          <button className="btn btn-outline btn-small" onClick={() => setEditingClass(false)}>取消</button>
        </div>
      )
    }
    return (
      <span className="profile-value profile-editable" onClick={() => { setClassInput(studentClass); setEditingClass(true) }}>
        {studentClass || '点击设置'}
      </span>
    )
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="profile-avatar">{info?.student_name?.charAt(0) || '?'}</div>
        <div className="profile-name">{info?.student_name || '-'}</div>
      </div>

      <div className="profile-card">
        <div className="profile-row">
          <span className="profile-label">学号</span>
          <span className="profile-value">{info?.student_id || '-'}</span>
        </div>
        <div className="profile-row">
          <span className="profile-label">姓名</span>
          <span className="profile-value">{info?.student_name || '-'}</span>
        </div>
        <div className="profile-row">
          <span className="profile-label">班级</span>
          {classRow()}
        </div>
      </div>

      <div className="profile-actions">
        <button className="btn btn-outline btn-danger" onClick={handleLogout}>
          退出登录
        </button>
      </div>
    </div>
  )
}
