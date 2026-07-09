import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStudentInfo, clearStudentSession } from '../api'

export default function ProfilePage() {
  const info = getStudentInfo()
  const navigate = useNavigate()

  const [studentClass, setStudentClass] = useState(
    () => localStorage.getItem('studentClass') || ''
  )
  const [editingClass, setEditingClass] = useState(false)
  const [classInput, setClassInput] = useState(studentClass)

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
          {editingClass ? (
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
          ) : (
            <span className="profile-value profile-editable" onClick={() => { setClassInput(studentClass); setEditingClass(true) }}>
              {studentClass || '点击设置'}
            </span>
          )}
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
