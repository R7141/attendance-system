import { useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { apiFetch } from '../api'

export default function ResultPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state || {}
  const { status, message, reasons, signBody } = state
  const [confirming, setConfirming] = useState(false)
  const [finalResult, setFinalResult] = useState(null)

  const handleConfirm = async () => {
    if (!signBody) return
    setConfirming(true)
    try {
      const result = await apiFetch('/signin', {
        method: 'POST',
        body: JSON.stringify({ ...signBody, confirm_abnormal: true }),
      })
      setFinalResult({ status: 'success', message: result.message })
    } catch (err) {
      setFinalResult({ status: 'error', message: err.message })
    } finally {
      setConfirming(false)
    }
  }

  const displayStatus = finalResult ? finalResult.status : status
  const displayMessage = finalResult ? finalResult.message : message

  const iconMap = {
    success: '✅',
    confirm: '⚠️',
    error: '❌',
  }
  const titleMap = {
    success: '签到成功',
    confirm: '签到异常',
    error: '签到失败',
  }

  return (
    <div className="result-page">
      <div className={'result-icon ' + displayStatus}>{iconMap[displayStatus] || iconMap.error}</div>
      <div className="result-title">{titleMap[displayStatus] || '签到结果'}</div>
      <div className="result-detail">{displayMessage}</div>
      {reasons && reasons.length > 0 && (
        <div className="result-reasons">
          {reasons.map((r, i) => (
            <div className="reason-item" key={i}><span className="dot" />{r}</div>
          ))}
        </div>
      )}
      <div className="result-actions">
        {status === 'confirm' && !finalResult && (
          <button className="btn btn-success" onClick={handleConfirm} disabled={confirming}>
            {confirming ? '提交中...' : '确认签到'}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => navigate('/', { replace: true })}>
          返回首页
        </button>
      </div>
    </div>
  )
}
