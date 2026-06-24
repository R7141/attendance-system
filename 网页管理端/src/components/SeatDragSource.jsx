import { useEffect } from 'react';
import { useDrag } from 'react-dnd';

const ItemTypes = { SEAT: 'SEAT' };

// ==================== 拖拽源组件 ====================
function SeatDragSource({ type, count = 1 }) {
  const [{ isDragging }, drag, dragPreview] = useDrag({
    type: ItemTypes.SEAT,
    item: { type, count },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  // 禁用默认拖拽图片（修复按钮文字出现在拖拽预览中的问题）
  useEffect(() => {
    const emptyImage = new Image();
    emptyImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    dragPreview(emptyImage, { captureDraggingState: false });
  }, [dragPreview]);

  return (
    <div
      ref={drag}
      className="seat-drag-source"
      style={{
        opacity: isDragging ? 0.5 : 1,
        cursor: 'grab',
        userSelect: 'none',
        padding: '6px 10px',
        backgroundColor: '#f0f0f0',
        border: '1px solid #ccc',
        borderRadius: '4px',
        marginBottom: '8px',
      }}
    >
      {type === 'SINGLE' && '单个座位'}
      {type === 'ROW' && `一行座位(${count}个)`}
      {type === 'COLUMN' && `一列座位(${count}个)`}
    </div>
  );
}

export default SeatDragSource;
