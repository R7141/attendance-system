import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, setStudentToken, setStudentInfo } from '../api'

export default function LoginPage() {
  const [sid, setSid] = useState('')
  const [pwd, setPwd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!sid.trim() || !pwd.trim()) { setError('请输入学号和密码'); return }
    setLoading(true); setError('')
    try {
      const data = await apiFetch('/student/login', {
        method: 'POST',
        body: JSON.stringify({ student_id: sid.trim(), password: pwd }),
      })
      setStudentToken(data.token)
      setStudentInfo(data.student)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>课堂签到</h1>
        <p>学生端</p>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>学号</label>
            <input type="text" placeholder="请输入学号"
              value={sid} onChange={e => setSid(e.target.value)}
              autoFocus autoComplete="username" />
          </div>
          <div className="input-group">
            <label>密码</label>
            <input type="password" placeholder="初始密码 123456"
              value={pwd} onChange={e => setPwd(e.target.value)}
              autoComplete="current-password" />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: 12 }}>
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  )
}
