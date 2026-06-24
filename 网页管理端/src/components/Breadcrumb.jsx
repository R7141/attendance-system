/*
 * @Author: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @Date: 2026-01-03 21:20:18
 * @LastEditors: 毛茸茸结社 12832731+mrrjs@user.noreply.gitee.com
 * @LastEditTime: 2026-02-13 22:30:10
 * @FilePath: \web_console\src\components\Breadcrumb.jsx
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// ==================== 面包屑组件 ====================
function Breadcrumb({ currentPage }) {
  const pageNames = {
    'sign-monitor': '签到监控',
    'seat-edit': '座位编辑',
    'class-edit': '课程管理',
    'class-rosters': '班级名单',
    'attendance-trace': '考勤追溯',
    'org-audit': '组织审核',
    'data-stats': '数据统计',
    'system-settings': '系统设置',
  };

  return (
    <div className="breadcrumb">
      <span className="breadcrumb-item">首页</span>
      <span className="breadcrumb-separator">/</span>
      <span className="breadcrumb-item active">{pageNames[currentPage] || '未知页面'}</span>
    </div>
  );
}

export default Breadcrumb;
