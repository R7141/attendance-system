import { useDragLayer } from 'react-dnd';

// ==================== 公共函数：座位渲染 ====================
function renderSeatShape(type, count) {
  const SEAT_SIZE = 60;
  const GAP = 10;

  if (type === 'SINGLE') {
    return (
      <div
        className="preview-seat"
        style={{
          width: SEAT_SIZE,
          height: SEAT_SIZE,
          backgroundColor: 'rgba(0, 123, 255, 0.7)',
          border: '2px solid #007bff',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          color: 'white',
        }}
      >
        A1
      </div>
    );
  } else if (type === 'ROW') {
    return (
      <div style={{ display: 'flex' }}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="preview-seat"
            style={{
              width: SEAT_SIZE,
              height: SEAT_SIZE,
              backgroundColor: 'rgba(0, 123, 255, 0.7)',
              border: '2px solid #007bff',
              borderRadius: '4px',
              marginRight: i < count - 1 ? GAP : 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              color: 'white',
            }}
          >
            A{i + 1}
          </div>
        ))}
      </div>
    );
  } else if (type === 'COLUMN') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="preview-seat"
            style={{
              width: SEAT_SIZE,
              height: SEAT_SIZE,
              backgroundColor: 'rgba(0, 123, 255, 0.7)',
              border: '2px solid #007bff',
              borderRadius: '4px',
              marginBottom: i < count - 1 ? GAP : 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              color: 'white',
            }}
          >
            {String.fromCharCode(65 + i)}1
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ==================== 拖拽预览层 ====================
function CustomDragLayer() {
  const { item, isDragging, currentOffset } = useDragLayer((monitor) => ({
    item: monitor.getItem(),
    isDragging: monitor.isDragging(),
    currentOffset: monitor.getClientOffset(), // 使用鼠标指针的实际位置，而不是拖拽源的左上角位置
  }));

  if (!isDragging || !item || !currentOffset) return null;

  const { x, y } = currentOffset;
  const SEAT_SIZE = 60;
  const GAP = 20;

  // 计算预览元素的尺寸，用于调整鼠标位置到元素中心
  let previewWidth = SEAT_SIZE;
  let previewHeight = SEAT_SIZE;
  
  if (item.kind === 'STUDENT') {
    previewWidth = 260;
    previewHeight = 52;
  } else if (item.type === 'ROW') {
    previewWidth = item.count * SEAT_SIZE + (item.count - 1) * GAP;
  } else if (item.type === 'COLUMN') {
    previewHeight = item.count * SEAT_SIZE + (item.count - 1) * GAP;
  }

  // 调整预览位置，使鼠标指针位于元素中心
  const adjustX = x - previewWidth / 2 - 8; // 减去padding的一半
  const adjustY = y - previewHeight / 2 - 8; // 减去padding的一半

  return (
    <div
      className="custom-drag-layer"
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        top: 0,
        left: 0,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          transform: `translate(${adjustX}px, ${adjustY}px)`,
          padding: '8px',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          borderRadius: '4px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
        }}
      >
        {item.kind === 'STUDENT' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '240px' }}>
            <div style={{ fontSize: '13px', color: '#333' }}>{item.studentName || item.studentId}</div>
            <div style={{ fontSize: '12px', color: '#888' }}>{item.studentId}</div>
          </div>
        ) : (
          renderSeatShape(item.type, item.count)
        )}
      </div>
    </div>
  );
}

export default CustomDragLayer;
