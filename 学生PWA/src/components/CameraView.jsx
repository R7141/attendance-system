import { useEffect, useRef, useCallback, useState } from 'react'

export default function CameraView({ onScan, enabled }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const scanningRef = useRef(false)
  const [error, setError] = useState('')

  const startCamera = useCallback(async () => {
    try {
      setError('')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch {
      setError('无法访问摄像头，请检查权限设置')
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

  // QR scanning via Browser API (BarcodeDetector)
  useEffect(() => {
    if (!enabled || !('BarcodeDetector' in window)) return
    scanningRef.current = true
    const detector = new BarcodeDetector({ formats: ['qr_code'] })
    let timer

    const scan = async () => {
      if (!scanningRef.current || !videoRef.current) return
      try {
        const barcodes = await detector.detect(videoRef.current)
        if (barcodes.length > 0) {
          scanningRef.current = false
          onScan(barcodes[0].rawValue)
          return
        }
      } catch {}
      if (scanningRef.current) {
        timer = setTimeout(scan, 500)
      }
    }

    timer = setTimeout(scan, 1000)
    return () => { scanningRef.current = false; clearTimeout(timer) }
  }, [enabled, onScan])

  if (error) return <div className="camera-hint" style={{ color: 'red' }}>{error}</div>

  return (
    <div className="camera-box">
      <video ref={videoRef} playsInline muted />
      <div className="scan-overlay">
        <div className="scan-frame" />
      </div>
    </div>
  )
}
