/*
 * @Author: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @Date: 2026-01-03 21:20:07
 * @LastEditors: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @LastEditTime: 2026-04-15 11:41:09
 * @FilePath: \sign_in_system_server\管理端\web_console\src\components\TopBar.jsx
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { useNavigate } from 'react-router-dom';
import { clearAuthSession } from '../api';

function TopBar() {
  const navigate = useNavigate();
  let username = '';
  try {
    const raw = localStorage.getItem('authUser');
    const u = raw ? JSON.parse(raw) : null;
    username = u?.username || '';
  } catch {
    username = '';
  }

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <div className="system-name">签到后台管理系统</div>
      </div>
      <div className="top-bar-right">
        <div className="top-bar-actions">
          <button
            className="top-bar-btn"
            onClick={() => {
              clearAuthSession();
              navigate('/login', { replace: true });
            }}
          >
            退出{username ? `（${username}）` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TopBar;
