import { useRef } from 'react';
import { useDrop } from 'react-dnd';
import Seat from './Seat';

// ==================== 辅助函数：动态计算座位号 ====================
function calculateSeatNumbers(seats) {
  if (!seats || seats.length === 0) return {};
  
  const minX = Math.min(...seats.map(seat => seat.x));
  const minY = Math.min(...seats.map(seat => seat.y));
  const maxY = Math.max(...seats.map(seat => seat.y));
  
  const seatNumbers = {};
  const SEAT_SIZE = 60;
  const GAP = 20;
  
  seats.forEach(seat => {
    // 如果座位对象有显式 seatNumber，优先使用
    if (seat.seatNumber) {
      const match = String(seat.seatNumber).match(/^([A-Z])(\d+)$/i);
      if (match) {
        seatNumbers[seat.id] = {
          row: match[1].toUpperCase(),
          col: parseInt(match[2], 10)
        };
        return;
      }
    }
    // 否则通过坐标计算座位号
    const colIndex1 = Math.round((seat.x - minX) / (SEAT_SIZE + GAP));
    const rowIndex2 = Math.round((maxY - seat.y) / (SEAT_SIZE + GAP));
    
    seatNumbers[seat.id] = {
      row: String.fromCharCode(65 + colIndex1),
      col: rowIndex2 + 1
    };
  });
  
  return seatNumbers;
}

// ==================== 主画布 ====================
function Canvas({ seats, onAddSeat, onSeatClick, width, height }) {
  const canvasRef = useRef(null);
  const SEAT_SIZE = 60;
  const GAP = 20;
  
  // 动态计算所有座位的编号
  const seatNumbers = calculateSeatNumbers(seats);
  
  // 使用传入的固定宽度和高度，不再动态计算
  const canvasSize = {
    width: width || '100%',
    height: height || '80vh'
  };

  const [{ isOver }, drop] = useDrop({
    accept: 'SEAT',
    drop: (item, monitor) => {
      const offset = monitor.getClientOffset();
      const rect = canvasRef.current.getBoundingClientRect();
      let x = offset.x - rect.left;
      let y = offset.y - rect.top;

      // 计算预览元素的尺寸，用于调整放置位置，使鼠标指针位于元素中心
      let previewWidth = SEAT_SIZE;
      let previewHeight = SEAT_SIZE;
      
      if (item.type === 'ROW') {
        previewWidth = item.count * SEAT_SIZE + (item.count - 1) * GAP;
      } else if (item.type === 'COLUMN') {
        previewHeight = item.count * SEAT_SIZE + (item.count - 1) * GAP;
      }

      // 调整放置位置，使鼠标指针位于元素中心
      const adjustedX = x - previewWidth / 2;
      const adjustedY = y - previewHeight / 2;

      const gridX = Math.max(
        0,
        Math.round(adjustedX / (SEAT_SIZE + GAP)) * (SEAT_SIZE + GAP)
      );
      const gridY = Math.max(
        0,
        Math.round(adjustedY / (SEAT_SIZE + GAP)) * (SEAT_SIZE + GAP)
      );

      const baseTime = Date.now();

      if (item.type === 'SINGLE') {
        onAddSeat({
          id: `${baseTime}-single`,
          x: gridX,
          y: gridY,
          selected: false,
        });
      } else if (item.type === 'ROW') {
        for (let i = 0; i < item.count; i++) {
          onAddSeat({
            id: `${baseTime}-row-${i}`,
            x: gridX + i * (SEAT_SIZE + GAP),
            y: gridY,
            selected: false,
          });
        }
      } else if (item.type === 'COLUMN') {
        for (let i = 0; i < item.count; i++) {
          onAddSeat({
            id: `${baseTime}-col-${i}`,
            x: gridX,
            y: gridY + i * (SEAT_SIZE + GAP),
            selected: false,
          });
        }
      }
      return { x: gridX, y: gridY };
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
    }),
  });

  return (
    <div
      ref={(node) => {
        drop(node);
        canvasRef.current = node;
      }}
      className={`canvas ${isOver ? 'canvas-over' : ''}`}
      style={{
        position: 'relative',
        width: canvasSize.width,
        height: canvasSize.height,
        border: '2px dashed #aaa',
        borderRadius: '8px',
        backgroundColor: '#fafafa',
        overflow: 'hidden', // 画布本身不需要滚动，滚动由父容器处理
      }}
    >
      {seats.map((seat) => (
        <div
          key={seat.id}
          style={{
            position: 'absolute',
            left: seat.x,
            top: seat.y,
          }}
        >
          <Seat 
            seat={seat} 
            seatNumber={seatNumbers[seat.id] || { row: '?', col: '?' }} 
            onSeatClick={onSeatClick} 
          />
        </div>
      ))}
    </div>
  );
}

export default Canvas;
