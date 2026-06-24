/*
 * @Author: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @Date: 2026-01-03 21:17:44
 * @LastEditors: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @LastEditTime: 2026-03-01 17:51:41
 * @FilePath: \sign_in_system_server\管理端\web_console\src\pages\SystemSettingsPage.jsx
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// ==================== 系统设置页面 ====================
function SystemSettingsPage() {
  return (
    <div className="settings-page">
      <div className="content-header">
        <h2>系统设置</h2>
      </div>
      <div className="settings-content">
        <div className="settings-card">
          <h3>基础设置</h3>
          <div className="settings-form">
            <div className="form-group">
              <label htmlFor="systemName">系统名称</label>
              <input type="text" id="systemName" placeholder="请输入系统名称" className="form-input" />
            </div>
            <div className="form-group">
              <label htmlFor="systemLogo">系统Logo</label>
              <input type="file" id="systemLogo" className="form-input" />
            </div>
          </div>
        </div>
        <div className="settings-card">
          <h3>用户设置</h3>
          <div className="settings-form">
            <div className="form-group">
              <label htmlFor="userRole">用户角色</label>
              <select id="userRole" className="form-input">
                <option value="admin">管理员</option>
                <option value="user">普通用户</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="userPermission">用户权限</label>
              <div className="permission-checkboxes">
                <label><input type="checkbox" /> 座位编辑</label>
                <label><input type="checkbox" /> 数据统计</label>
                <label><input type="checkbox" /> 系统设置</label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SystemSettingsPage;
