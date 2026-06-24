// ==================== 数量选择器 ====================
function CountSelector({ value, onChange, label }) {
  return (
    <div className="count-selector" style={{ marginBottom: '10px' }}>
      <label>{label}: </label>
      <button onClick={() => onChange(Math.max(1, value - 1))}>-</button>
      <span style={{ margin: '0 10px' }}>{value}</span>
      <button onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export default CountSelector;
