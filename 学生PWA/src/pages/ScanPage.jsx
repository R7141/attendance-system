import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, getStudentInfo, clearStudentSession } from '../api'
import CameraView from '../components/CameraView'

export default function ScanPage() {
  const info = getStudentInfo()
  const navigate = useNavigate()
  const [scanning, setScanning] = useState(true)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleScan = useCallback((qrText) => {
    setScanning(false)
    setError('')
    try {
      const qr = JSON.parse(qrText)
      setPreview(qr)
    } catch {
      setError('无效的二维码格式')
      setTimeout(() => setScanning(true), 2000)
    }
  }, [])

  const handleSignIn = async () => {
    if (!preview) return
    setLoading(true)
    setError('')
    try {
      const body = {
        student_id: info?.student_id || '',
        student_name: info?.student_name || '',
        seat: preview.seat || '',
        room: preview.room || '',
        sig: preview.sig || '',
        iat: preview.iat || '',
        ttl: preview.ttl || '',
        ver: preview.ver || '',
        confirm_abnormal: false,
      }
      const result = await apiFetch('/signin', { method: 'POST', body: JSON.stringify(body) })
      navigate('/result', { state: { status: 'success', message: result.message, data: result } })
    } catch (err) {
      if (err.data?.code === 1001) {
        navigate('/result', {
          state: { status: 'confirm', message: err.message, reasons: err.data?.data?.reasons, signBody: body },
        })
      } else {
        navigate('/result', { state: { status: 'error', message: err.message } })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleRetry = () => {
    setPreview(null)
    setError('')
    setScanning(true)
  }

  const handleLogout = () => {
    clearStudentSession()
    navigate('/login', { replace: true })
  }

  return (
    <div className="scan-page">
      <div className="scan-header">
        <h2>扫码签到</h2>
        <span className="student-info">
          {info?.student_name} ({info?.student_id})
          <a className="logout-link" onClick={handleLogout}>退出</a>
        </span>
      </div>
      <div className="camera-section">
        {scanning && <CameraView onScan={handleScan} enabled={scanning} />}
        {error && <div className="camera-hint" style={{ color: 'red' }}>{error}</div>}
        {!scanning && !preview && <div className="camera-hint">等待扫码...</div>}
      </div>
      {preview && (
        <div className="preview-section">
          <p><strong>教室：</strong>{preview.room || '-'}</p>
          <p><strong>座位：</strong>{preview.seat || '-'}</p>
          {error && <p style={{ color: 'red', fontSize: 13, marginBottom: 8 }}>{error}</p>}
          <button className="btn btn-primary" onClick={handleSignIn} disabled={loading}>
            {loading ? '签到中...' : '确认签到'}
          </button>
          <button className="btn btn-outline" onClick={handleRetry} style={{ marginTop: 8 }} disabled={loading}>
            重新扫码
          </button>
        </div>
      )}
      {!preview && scanning && !error && (
        <div className="camera-hint">将二维码放入取景框内自动识别</div>
      )}
    </div>
  )
}
