import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

/**
 * 组织状态检查组件
 * 当组织未通过审核时，显示灰色遮罩并阻断子组件渲染（避免数据请求）
 */
export default function OrgGuard({ children }) {
  const [status, setStatus] = useState('loading'); // loading | approved | pending | none
  const [orgName, setOrgName] = useState('');

  useEffect(() => {
    let mounted = true;
    const checkStatus = async () => {
      try {
        const user = await apiFetch('/me');
        if (mounted) {
          if (user.role === 'org_owner') {
            setStatus('approved'); // 创建者视为已通过
          } else {
            const isApproved = user.org_status === 'approved' && user.org_id;
            setStatus(isApproved ? 'approved' : (user.org_status || 'none'));
            if (user.org_status === 'pending') {
              // 可选：如果pending，可能想展示申请的组织名，但这需要额外查组织列表或后端返回pending_org_name
              // 目前后端/me只返回pending_org_id，暂不展示名字
            }
          }
        }
      } catch (err) {
        if (mounted) setStatus('none');
      }
    };
    checkStatus();
    return () => { mounted = false; };
  }, []);

  if (status === 'loading') {
    return <div className="org-guard-loading">加载中...</div>;
  }

  if (status === 'approved') {
    return children;
  }

  // 未通过审核：显示遮罩
  return (
    <div className="org-guard-mask">
      <div className="org-guard-content">
        <div className="org-guard-icon">🔒</div>
        <h3>功能暂不可用</h3>
        <p>
          {status === 'pending' 
            ? '您的组织申请正在审核中，请等待通过后使用。' 
            : '您尚未加入任何组织或申请被驳回。'}
        </p>
        <a href="/org-audit" className="org-guard-link">前往组织管理</a>
      </div>
    </div>
  );
}
