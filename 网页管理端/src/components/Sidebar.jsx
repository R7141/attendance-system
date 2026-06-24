/*
 * @Author: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @Date: 2026-01-03 21:19:53
 * @LastEditors: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @LastEditTime: 2026-03-04 20:57:00
 * @FilePath: \sign_in_system_server\管理端\web_console\src\components\Sidebar.jsx
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// ==================== 左侧功能栏组件 ====================
import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

function Sidebar({ activePage, onPageChange }) {
  const [user, setUser] = useState(null);
  const [isPersonalOrg, setIsPersonalOrg] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadUser = async () => {
      try {
        const raw = localStorage.getItem('authUser');
        if (raw) {
          const u = JSON.parse(raw);
          if (mounted) setUser(u);
        }
      } catch {
        if (mounted) setUser(null);
      }
    };
    loadUser();
    return () => { mounted = false; };
  }, []);

  const menuItems = [
    { id: 'sign-monitor', name: '签到监控', icon: '📊' },
    { id: 'attendance-trace', name: '考勤追溯', icon: '🗂️' },
    { id: 'seat-edit', name: '座位编辑', icon: '🪑' },
    { id: 'class-edit', name: '课程管理', icon: '⚙️' },
    { id: 'class-rosters', name: '班级名单', icon: '👥' },
  ];

  // 判断是否显示“组织审核”
  // 1. 如果是 user，始终显示（为了让他能申请加入组织，或者查看状态）
  //    注意：用户需求是“用户注册时选择了个人使用...登陆后应当没有组织页”。
  //    但如果是“user”角色，说明他不是“个人使用”（个人使用会自动变为 owner）。
  //    所以 user 角色应该保留入口。
  // 2. 如果是 org_owner：
  //    - 如果是个人组织 (isPersonalOrg)，隐藏。
  //    - 否则显示。
  const shouldShowOrgMenu = user && (
    user.role === 'user' || 
    (user.role === 'org_owner' && !isPersonalOrg)
  );

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2 className="logo">签到系统</h2>
      </div>
      <nav className="sidebar-nav">
        {menuItems.map(item => (
          <div 
            key={item.id}
            className={`nav-item ${activePage === item.id ? 'active' : ''}`}
            onClick={() => onPageChange(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-text">{item.name}</span>
          </div>
        ))}
        {/* 动态显示组织审核 */}
        {shouldShowOrgMenu && (
             <div 
            className={`nav-item ${activePage === 'org-audit' ? 'active' : ''}`}
            onClick={() => onPageChange('org-audit')}
          >
            <span className="nav-icon">✅</span>
            <span className="nav-text">组织审核</span>
          </div>
        )}
      </nav>
      <div className="sidebar-footer">
        <div className="user-info">
          <div className="user-avatar">👤</div>
          <div className="user-name">{user ? user.username : '未登录'}</div>
        </div>
      </div>
    </div>
  );
}

export default Sidebar;
