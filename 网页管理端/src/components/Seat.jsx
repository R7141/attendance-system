import { useDrag, useDrop } from 'react-dnd';

function Seat({ seat, seatNumber, onSeatClick, selectedIds, onEditLabel }) {
  const selected = seat.selected;

  const [{ isDragging }, drag] = useDrag({
    type: 'SEAT_MOVE',
    item: () => ({
      type: 'SEAT_MOVE',
      seat,
      selectedIds,
      dragId: seat.id,
    }),
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [{ isOver }, drop] = useDrop({
    accept: 'SEAT',
    drop: () => ({ id: seat.id }),
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
    }),
  });

  const displayLabel = seat.label || ((seatNumber?.row || '') + (seatNumber?.col || '')) || null;
  const isAisle = seat.isAisle;
  const isOccupied = seat.isOccupied;

  let bgColor, borderColor, textColor, borderStyle;
  if (isAisle) {
    bgColor = selected ? '#66bb6a' : '#c8e6c9';
    borderColor = selected ? '#388e3c' : '#81c784';
    textColor = selected ? 'white' : '#2e7d32';
    borderStyle = 'solid';
  } else if (isOccupied) {
    bgColor = selected ? '#e91e63' : '#fce4ec';
    borderColor = selected ? '#c2185b' : '#e91e63';
    textColor = selected ? 'white' : '#c2185b';
    borderStyle = 'solid';
  } else {
    bgColor = selected ? '#2196F3' : '#e0e0e0';
    borderColor = selected ? '#1976D2' : '#999';
    textColor = selected ? 'white' : 'black';
    borderStyle = 'solid';
  }

  return (
    <div
      ref={(node) => drag(drop(node))}
      className={`seat ${isOver ? 'seat-over' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSeatClick(seat, e);
      }}
      onDoubleClick={() => onEditLabel && onEditLabel(seat)}
      style={{
        width: 60,
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
        cursor: 'pointer',
        borderRadius: '4px',
        transition: 'all 0.15s',
        opacity: isDragging ? 0.3 : 1,
        backgroundColor: bgColor,
        color: textColor,
        border: `${borderStyle} ${isAisle || selected || isOccupied ? '2px' : '1px'} ${borderColor}`,
        fontSize: isAisle ? '16px' : (isOccupied ? '20px' : '14px'),
      }}
      title={displayLabel || (isAisle ? '走道' : '被占用')}
    >
      {isAisle ? (displayLabel || '⊞') : (isOccupied ? '占' : displayLabel)}
    </div>
  );
}

export default Seat;
