import { useEffect, useRef, useCallback, useState } from 'react'
import jsQR from 'jsqr'

export default function CameraView({ onScan, enabled }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const scanningRef = useRef(false)
  const [error, setError] = useState('')

  const startCamera = useCallback(async () => {
    try {
      setError('')
      let constraints = { facingMode: 'environment' }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: constraints,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch (err) {
      let msg = ''
      if (err.name === 'NotAllowedError') {
        msg = '相机权限被拒绝，请在浏览器设置中允许相机访问'
      } else if (err.name === 'NotFoundError') {
        msg = '未找到摄像头设备'
      } else if (err.name === 'NotReadableError') {
        msg = '摄像头被其他应用占用，请关闭后重试'
      } else if (err.name === 'OverconstrainedError') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true })
          streamRef.current = stream
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            await videoRef.current.play()
          }
          return
        } catch {
          msg = '摄像头不兼容，请尝试其他浏览器'
        }
      } else if (err.name === 'SecurityError') {
        msg = '摄像头需要 HTTPS 安全连接，当前证书可能不被信任'
      } else {
        msg = `摄像头访问失败 (${err.name})`
      }
      setError(msg)
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    if (enabled) { startCamera() } else { stopCamera() }
    return () => stopCamera()
  }, [enabled, startCamera, stopCamera])

  useEffect(() => {
    if (!enabled) return
    scanningRef.current = true

    const scan = () => {
      if (!scanningRef.current || !videoRef.current || !canvasRef.current) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video.readyState < 2) {
        if (scanningRef.current) setTimeout(scan, 800)
        return
      }
      try {
        canvas.width = 360
        canvas.height = 360
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, 360, 360)
        const imageData = ctx.getImageData(0, 0, 360, 360)
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        if (code) {
          scanningRef.current = false
          if (navigator.vibrate) navigator.vibrate(100)
          onScan(code.data)
          return
        }
      } catch {}
      if (scanningRef.current) {
        setTimeout(scan, 800)
      }
    }

    const timer = setTimeout(scan, 1000)
    return () => { scanningRef.current = false; clearTimeout(timer) }
  }, [enabled, onScan])

  if (error) return <div className="camera-hint" style={{ color: 'red' }}>{error}</div>

  return (
    <div className="camera-box">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div className="scan-overlay">
        <div className="scan-frame" />
      </div>
    </div>
  )
}
