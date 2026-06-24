import { useDrop } from 'react-dnd';

// ==================== 单个座位组件 ====================
function Seat({ seat, seatNumber, onSeatClick }) {
  const [{ isOver }, drop] = useDrop({
    accept: 'SEAT',
    drop: () => ({ id: seat.id }),
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
    }),
  });

  return (
    <div
      ref={drop}
      className={`seat ${isOver ? 'seat-over' : ''}`}
      onClick={() => onSeatClick(seat)}
      style={{
        width: 60,
        height: 60,
        backgroundColor: seat.selected ? '#2196F3' : '#e0e0e0',
        color: seat.selected ? 'white' : 'black',
        border: '1px solid #999',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
        cursor: 'pointer',
      }}
    >
      {seatNumber.row}
      {seatNumber.col}
    </div>
  );
}

export default Seat;
