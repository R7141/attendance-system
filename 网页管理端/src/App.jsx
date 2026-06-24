/*
 * @Author: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @Date: 2025-11-10 15:42:59
 * @LastEditors: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @LastEditTime: 2026-04-02 21:16:16
 * @FilePath: \web_console\src\App.jsx
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import React, { useEffect, useState } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, Outlet, Navigate } from 'react-router-dom';
import { apiFetch, clearAuthSession } from './api';
import './App.css';

// 导入页面组件
import SeatEditPage from './pages/SeatEditPage';
import ClassEditPage from './pages/ClassEditPage';
import ClassRosterPage from './pages/ClassRosterPage';
import SignMonitorPage from './pages/SignMonitorPage';
import AttendanceTracePage from './pages/AttendanceTracePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import OrgAuditPage from './pages/OrgAuditPage';
import DataStatsPage from './pages/DataStatsPage';
import SystemSettingsPage from './pages/SystemSettingsPage';

// 导入布局组件
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Breadcrumb from './components/Breadcrumb';
import OrgGuard from './components/OrgGuard';

// 导入拖拽预览层
import CustomDragLayer from './components/CustomDragLayer';

function RequireAuth({ children }) {
  const location = useLocation();
  const [isChecking, setIsChecking] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const token = localStorage.getItem('authToken');

  useEffect(() => {
    if (!token) {
      setIsChecking(false);
      return;
    }
    apiFetch('/me')
      .then(() => {
        setIsValid(true);
        setIsChecking(false);
      })
      .catch((err) => {
        clearAuthSession();
        setIsValid(false);
        setIsChecking(false);
      });
  }, [token]);

  if (isChecking) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>校验登录状态中...</div>;
  }

  if (!token || !isValid) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  
  return children;
}

// ==================== 主布局组件 ====================
function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // 获取当前页面路径
  const getCurrentPage = () => {
    const path = location.pathname;
    return path.substring(1) || 'seat-edit';
  };
  
  // 页面切换处理
  const handlePageChange = (pageId) => {
    navigate(`/${pageId}`);
  };

  return (
    <div className="app-enterprise">
      {/* 顶部栏 */}
      <TopBar />
      
      <div className="main-container">
        {/* 左侧功能栏 */}
        <Sidebar 
          activePage={getCurrentPage()} 
          onPageChange={handlePageChange} 
        />
        
        {/* 右侧内容区域 */}
        <div className="content-wrapper">
          {/* 面包屑 */}
          <Breadcrumb currentPage={getCurrentPage()} />
          
          {/* 页面内容 */}
          <div className="content-area">
            <Outlet />
          </div>
        </div>
      </div>
      
      {/* 拖拽预览层 */}
      <CustomDragLayer />
    </div>
  );
}

// ==================== 主应用 ====================
function App() {
  return (
    <DndProvider backend={HTML5Backend}>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            element={
              <RequireAuth>
                <MainLayout />
              </RequireAuth>
            }
          >
            <Route path="/sign-monitor" element={<OrgGuard><SignMonitorPage /></OrgGuard>} />
            <Route path="/attendance-trace" element={<OrgGuard><AttendanceTracePage /></OrgGuard>} />
            <Route path="/seat-edit" element={<OrgGuard><SeatEditPage /></OrgGuard>} />
            <Route path="/class-edit" element={<OrgGuard><ClassEditPage /></OrgGuard>} />
            <Route path="/class-rosters" element={<OrgGuard><ClassRosterPage /></OrgGuard>} />
            <Route path="/org-audit" element={<OrgAuditPage />} />
            <Route path="/data-stats" element={<OrgGuard><DataStatsPage /></OrgGuard>} />
            <Route path="/system-settings" element={<OrgGuard><SystemSettingsPage /></OrgGuard>} />
            <Route path="/" element={<Navigate to="/seat-edit" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/seat-edit" replace />} />
        </Routes>
      </Router>
    </DndProvider>
  );
}

export default App
