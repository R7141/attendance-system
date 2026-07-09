import { Outlet, useLocation, useNavigate } from 'react-router-dom'

export default function MainLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  const tabs = [
    { path: '/', label: '签到', icon: '📷' },
    { path: '/profile', label: '我的', icon: '👤' },
  ]

  return (
    <div className="main-layout">
      <div className="layout-body">
        <Outlet />
      </div>
      <nav className="tab-bar">
        {tabs.map(tab => (
          <div
            key={tab.path}
            className={'tab-item' + (location.pathname === tab.path ? ' active' : '')}
            onClick={() => navigate(tab.path)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </div>
        ))}
      </nav>
    </div>
  )
}
