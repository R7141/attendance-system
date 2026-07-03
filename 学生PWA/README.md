# 课堂签到 - 学生端 PWA

基于 Vite + React 构建的渐进式 Web 应用（PWA），供学生扫码签到使用。

## 功能

- 学号 + 密码登录（初始密码 123456）
- 摄像头扫码签到
- 签到结果展示（成功 / 异常 / 失败）
- 异常签到确认提交
- 支持离线缓存（PWA）

## 开发

```bash
npm run dev
```

默认端口 5175，可通过 `.env` 文件中的 `VITE_API_BASE_URL` 配置后端地址（默认 `http://127.0.0.1:8080`）。

## 构建

```bash
npm run build
```

构建产物输出到 `dist/` 目录，支持 PWA 离线访问。

## 技术栈

- Vite 6
- React 19
- react-router-dom
- vite-plugin-pwa
- BarcodeDetector API（浏览器原生）
