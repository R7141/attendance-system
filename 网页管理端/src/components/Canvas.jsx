import { useState, useMemo, useCallback } from 'react';
import { useDrop } from 'react-dnd';
import Seat from './Seat';

const SEAT_SIZE = 60;
const GAP = 20;
const PADDING = 50;

function computeGridPos(rows, cols) {
  const rowY = [];
  let y = PADDING;
  for (let r = 0; r < rows; r++) {
    rowY[r] = y;
    y += SEAT_SIZE + GAP;
  }
  const colX = [];
  let x = PADDING;
  for (let c = 0; c < cols; c++) {
    colX[c] = x;
    x += SEAT_SIZE + GAP;
  }
  return { colX, rowY };
}

function findNearestGrid(px, py, colX, rowY) {
  let nearestR = -1, nearestC = -1;
  let minDist = Infinity;
  for (let r = 0; r < rowY.length; r++) {
    for (let c = 0; c < colX.length; c++) {
      const cx = colX[c] + SEAT_SIZE / 2;
      const cy = rowY[r] + SEAT_SIZE / 2;
      const dist = Math.hypot(px - cx, py - cy);
      if (dist < minDist) {
        minDist = dist;
        nearestR = r;
        nearestC = c;
      }
    }
  }
  return minDist < SEAT_SIZE ? { row: nearestR, col: nearestC } : null;
}

function Canvas({ seats, roomRows, roomCols, blockRows, blockCols, onCellClick, onSeatClick, onSnapSeat, onEditLabel }) {
  const [dragOffset, setDragOffset] = useState(null);
  const [dragSelectedIds, setDragSelectedIds] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);

  const { colX, rowY } = useMemo(() => computeGridPos(roomRows, roomCols), [roomRows, roomCols]);

  const canvasWidth = colX.length > 0 ? colX[colX.length - 1] + SEAT_SIZE + PADDING : 800;
  const canvasHeight = rowY.length > 0 ? rowY[rowY.length - 1] + SEAT_SIZE + PADDING : 600;

  const seatMap = useMemo(() => {
    const map = {};
    seats.forEach(s => {
      if (s.gridRow != null && s.gridCol != null) {
        map[`${s.gridRow}-${s.gridCol}`] = s;
      }
    });
    return map;
  }, [seats]);

  const selectedIds = seats.filter(s => s.selected).map(s => s.id);

  const [, drop] = useDrop({
    accept: 'SEAT_MOVE',
    hover: (item, monitor) => {
      if (!monitor.isOver()) return;
      const clientOffset = monitor.getClientOffset();
      const initialOffset = monitor.getInitialClientOffset();
      if (!clientOffset || !initialOffset) return;
      setDragOffset({
        dx: clientOffset.x - initialOffset.x,
        dy: clientOffset.y - initialOffset.y,
      });
      setDragSelectedIds(item.selectedIds);
    },
    drop: (item, monitor) => {
      const clientOffset = monitor.getClientOffset();
      const initialOffset = monitor.getInitialClientOffset();
      setDragOffset(null);
      setDragSelectedIds(null);
      if (!clientOffset || !initialOffset) return;
      const dx = clientOffset.x - initialOffset.x;
      const dy = clientOffset.y - initialOffset.y;
      if (dx === 0 && dy === 0) return;

      const positions = seats
        .filter(s => item.selectedIds.includes(s.id))
        .map(s => ({ id: s.id, targetX: s.x + dx, targetY: s.y + dy }));
      onSnapSeat(positions);
    },
  });

  const isSeatDragging = (seatId) => dragSelectedIds && dragSelectedIds.includes(seatId);

  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const c = Math.round((mx - PADDING) / (SEAT_SIZE + GAP));
    const r = Math.round((my - PADDING) / (SEAT_SIZE + GAP));
    if (r >= 0 && r < roomRows && c >= 0 && c < roomCols) {
      const cellX = colX[c], cellY = rowY[r];
      if (mx >= cellX && mx < cellX + SEAT_SIZE && my >= cellY && my < cellY + SEAT_SIZE) {
        setHoveredCell({ r, c });
        return;
      }
    }
    setHoveredCell(null);
  }, [roomRows, roomCols, colX, rowY]);

  const handleMouseLeave = useCallback(() => {
    setHoveredCell(null);
  }, []);

  const showPreview = hoveredCell && blockRows > 0 && blockCols > 0;

  const elements = [];

  // 渲染全部网格
  for (let r = 0; r < roomRows; r++) {
    for (let c = 0; c < roomCols; c++) {
      const x = colX[c];
      const y = rowY[r];
      const seat = seatMap[`${r}-${c}`];
      const dragging = seat && isSeatDragging(seat.id);

      if (seat && !dragging) {
        // 有座位且未被拖拽 → 渲染座位（z-index 3 覆盖网格）
        const dragPreview = dragSelectedIds && dragSelectedIds.includes(seat.id);
        const renderX = dragPreview && dragOffset ? seat.x + dragOffset.dx : seat.x;
        const renderY = dragPreview && dragOffset ? seat.y + dragOffset.dy : seat.y;

        elements.push(
          <div
            key={seat.id}
            style={{
              position: 'absolute',
              left: renderX,
              top: renderY,
              zIndex: 3,
            }}
          >
            <Seat
              seat={seat}
              seatNumber={seat.seatNumber || { row: '', col: '' }}
              onSeatClick={onSeatClick}
              selectedIds={selectedIds}
              onEditLabel={onEditLabel}
            />
          </div>
        );
      } else {
        // 无座位 或 座位正在被拖拽 → 渲染空格占位
        const isAisleBg = seat?.isAisle;

        elements.push(
          <div
            key={`cell-${r}-${c}`}
            onClick={() => onCellClick(r, c)}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: SEAT_SIZE,
              height: SEAT_SIZE,
              borderRadius: '4px',
              cursor: 'pointer',
              zIndex: 1,
              backgroundColor: isAisleBg ? '#c8e6c9' : 'transparent',
              border: isAisleBg
                ? '2px solid #81c784'
                : (seat?.isOccupied ? '2px dashed #e91e63' : '1px dashed #ddd'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              color: '#2e7d32',
            }}
          >
            {isAisleBg ? '⊞' : ''}
          </div>
        );
      }

      // 座位块预览覆盖层 (z-index 2，在空格之上、座位之下)
      if (showPreview) {
        const startR = hoveredCell.r;
        const startC = hoveredCell.c;
        if (r >= startR && r < startR + blockRows && c >= startC && c < startC + blockCols) {
          const hasSeat = seat != null;
          elements.push(
            <div
              key={`preview-${r}-${c}`}
              className={hasSeat ? 'block-preview-occupied' : 'block-preview-empty'}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: SEAT_SIZE,
                height: SEAT_SIZE,
                zIndex: 2,
              }}
            />
          );
        }
      }
    }
  }

  return (
    <div
      ref={drop}
      className="canvas"
      style={{
        position: 'relative',
        width: canvasWidth,
        height: canvasHeight,
        border: '2px dashed #aaa',
        borderRadius: '8px',
        backgroundColor: '#fafafa',
        overflow: 'hidden',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {elements}
    </div>
  );
}

export default Canvas;
