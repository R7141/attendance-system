import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getStudentToken, clearStudentSession, apiFetch } from './api'
import LoginPage from './pages/LoginPage'
import ScanPage from './pages/ScanPage'
import ResultPage from './pages/ResultPage'
import ProfilePage from './pages/ProfilePage'
import MainLayout from './components/MainLayout'
import './App.css'

function RequireAuth({ children }) {
  const location = useLocation()
  const [checking, setChecking] = useState(true)
  const [valid, setValid] = useState(false)
  const token = getStudentToken()
  useEffect(() => {
    if (!token) { setChecking(false); return }
    apiFetch('/student/me/profile')
      .then(() => { setValid(true); setChecking(false) })
      .catch(() => { clearStudentSession(); setValid(false); setChecking(false) })
  }, [token])
  if (checking) return <div className="loading-screen">验证登录状态中...</div>
  if (!token || !valid) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/result" element={<RequireAuth><ResultPage /></RequireAuth>} />
      <Route element={<RequireAuth><MainLayout /></RequireAuth>}>
        <Route path="/" element={<ScanPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
