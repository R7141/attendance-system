// ==================== 数据统计页面 ====================
function DataStatsPage() {
  return (
    <div className="stats-page">
      <div className="content-header">
        <h2>数据统计</h2>
      </div>
      <div className="stats-content">
        <div className="stats-card">
          <h3>座位使用情况</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-value">128</div>
              <div className="stat-label">总座位数</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">96</div>
              <div className="stat-label">已使用</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">32</div>
              <div className="stat-label">空闲</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">75%</div>
              <div className="stat-label">使用率</div>
            </div>
          </div>
        </div>
        <div className="stats-card">
          <h3>房间统计</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-value">8</div>
              <div className="stat-label">总房间数</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">5</div>
              <div className="stat-label">已使用</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">3</div>
              <div className="stat-label">空闲</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DataStatsPage;
