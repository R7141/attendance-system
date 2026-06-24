import { useState, useEffect } from 'react';
import { apiFetch, API_BASE_URL, getAuthToken } from '../api';

// 导入子组件
import SeatDragSource from '../components/SeatDragSource';
import CountSelector from '../components/CountSelector';
import Canvas from '../components/Canvas';

// ==================== 座位编辑页面 ====================
function SeatEditPage() {
  const [seats, setSeats] = useState([]);
  const [rowCount, setRowCount] = useState(3);
  const [columnCount, setColumnCount] = useState(3);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [roomNameInput, setRoomNameInput] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  const [roomList, setRoomList] = useState([]);
  
  // 画布大小设置
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [canvasHeight, setCanvasHeight] = useState(600);

  // 自动生成座位参数
  const [autoTotalSeats, setAutoTotalSeats] = useState(48);
  const [autoColumns, setAutoColumns] = useState(8);
  const [autoLayout, setAutoLayout] = useState('horizontal'); // 'horizontal' | 'vertical'
  const [autoAlign, setAutoAlign] = useState('left'); // 'left' | 'center' | 'right'

  const SEAT_SIZE = 60;
  const GAP = 20;
  const TOTAL_SIZE = SEAT_SIZE + GAP;
  const PADDING = 100;

  // 自动生成座位
  const handleAutoGenerate = () => {
    const total = parseInt(autoTotalSeats, 10);
    const cols = parseInt(autoColumns, 10);
    if (!total || total < 1) { alert('请输入有效的总座位数'); return; }
    if (!cols || cols < 1) { alert('请输入有效的列数'); return; }
    
    if (seats.length > 0 && !window.confirm('将清空现有座位，是否继续？')) return;

    const fullRows = Math.floor(total / cols);
    const partialSeats = total % cols;
    const rows = partialSeats > 0 ? fullRows + 1 : fullRows;
    const baseTime = Date.now();
    const generated = [];

    const getAlignOffset = (count, max, align) => {
      if (align === 'center') return (max - count) / 2;
      if (align === 'right') return max - count;
      return 0;
    };

    if (autoLayout === 'horizontal') {
      for (let r = 0; r < rows; r++) {
        const isLastRow = r === rows - 1 && partialSeats > 0;
        const seatsInRow = isLastRow ? partialSeats : cols;
        const offset = isLastRow ? getAlignOffset(partialSeats, cols, autoAlign) : 0;

        for (let c = 0; c < seatsInRow; c++) {
          generated.push({
            id: `${baseTime}-auto-h-${r}-${c}`,
            x: (c + offset) * TOTAL_SIZE + PADDING,
            y: r * TOTAL_SIZE + PADDING,
            seatNumber: String.fromCharCode(65 + c) + (rows - r),
            selected: false,
          });
        }
      }
    } else {
      for (let c = 0; c < cols; c++) {
        const isLastCol = c === cols - 1 && partialSeats > 0;
        const seatsInCol = isLastCol ? partialSeats : rows;
        const offset = isLastCol ? getAlignOffset(partialSeats, rows, autoAlign) : 0;

        for (let r = 0; r < seatsInCol; r++) {
          generated.push({
            id: `${baseTime}-auto-v-${c}-${r}`,
            x: c * TOTAL_SIZE + PADDING,
            y: (r + offset) * TOTAL_SIZE + PADDING,
            seatNumber: String.fromCharCode(65 + r) + (c + 1),
            selected: false,
          });
        }
      }
    }

    setSeats(generated);

    // 自动调整画布大小
    const neededWidth = cols * TOTAL_SIZE + PADDING * 2;
    const neededHeight = rows * TOTAL_SIZE + PADDING * 2;
    setCanvasWidth(Math.max(800, neededWidth));
    setCanvasHeight(Math.max(600, neededHeight));
  };

  const autoRows = (() => {
    const t = parseInt(autoTotalSeats, 10);
    const c = parseInt(autoColumns, 10);
    if (!t || !c) return 0;
    const full = Math.floor(t / c);
    return t % c > 0 ? full + 1 : full;
  })();

  const handleAddSeat = (newSeat) => {
    setSeats((prev) => [...prev, newSeat]);
  };

  const handleSeatClick = (clickedSeat) => {
    setSeats((prev) =>
      prev.map((seat) =>
        seat.id === clickedSeat.id
          ? { ...seat, selected: !seat.selected }
          : { ...seat, selected: false }
      )
    );
  };

  const handleDeleteSelected = () => {
    setSeats((prev) => prev.filter((seat) => !seat.selected));
  };

  const handleClearAll = () => {
    if (window.confirm('确定要清空所有座位吗？')) setSeats([]);
  };

  // 获取房间列表
  const fetchRoomList = async () => {
    try {
      const data = await apiFetch('/rooms');
      let formattedRooms = [];
      if (data && Array.isArray(data.rooms)) {
        formattedRooms = data.rooms
          .map((room) => ({ id: room?.room_id, name: `${room?.room_id || ''}` }))
          .filter((r) => r.id);
      } else if (data && Array.isArray(data.room_ids)) {
        formattedRooms = data.room_ids
          .map((roomId) => ({ id: roomId, name: `${roomId}` }))
          .filter((r) => r.id);
      }
      setRoomList(formattedRooms);
    } catch (error) {
      console.error('获取房间列表失败:', error);
    }
  };

  // 组件挂载时获取房间列表
  useEffect(() => {
    fetchRoomList();
  }, []);

  // 导入座位
  const handleImportSeats = async (room)=>{
    var roomId;
    if (!room) {
        roomId = selectedRoom;
    }else{
      roomId = room;
    }
      if (!roomId) {
        alert('请先选择房间');
        return;
      }
      
      try {
        const data = await apiFetch(`/roomseat?room_id=${encodeURIComponent(roomId)}`);
        console.log('读取结果:', data);
        
        if (data && data.seat_pos) {
          const SEAT_SIZE = 60;
          const GAP = 20;
          const TOTAL_SIZE = SEAT_SIZE + GAP;
          
          // data.seat_pos 可能已经是对象，也可能是 JSON 字符串
          // apiFetch 会尝试解析 JSON，所以这里直接用
          const seatPosObj = typeof data.seat_pos === 'string' ? JSON.parse(data.seat_pos) : data.seat_pos;
          
          if (seatPosObj && Array.isArray(seatPosObj.seats)) {
            const Seats = seatPosObj.seats;
            const minX = Math.min(...Seats.map(seat => seat.x));
            const minY = Math.min(...Seats.map(seat => seat.y));
            
            const convertedSeats = Seats.map((seat, index) => ({
              id: `imported-seat-${index}-${Date.now()}`,
              x: seat.x * TOTAL_SIZE + 100,
              y: seat.y * TOTAL_SIZE + 100,
              seatNumber: seat.seatNumber || undefined,
              selected: false
            }));
            
            setSeats(convertedSeats);
            alert(`成功导入 ${convertedSeats.length} 个座位`);
          }
        } else {
          setSeats([]);
        }
      } catch (error) {
        console.error('读取失败:', error);
        alert('读取失败: ' + error.message);
      }
  };

  // 导出座位数据到控制台
  const handleExportSeats = () => {
    if (seats.length === 0) {
      alert('当前画布上没有座位');
      return;
    }

    // 计算座位的行列号，与Canvas组件中的逻辑一致
    const minX = Math.min(...seats.map(seat => seat.x));
    const minY = Math.min(...seats.map(seat => seat.y));
    const maxX = Math.max(...seats.map(seat => seat.x));
    const maxY = Math.max(...seats.map(seat => seat.y));
    const SEAT_SIZE = 60;
    const GAP = 20;
    const TOTAL_SIZE = SEAT_SIZE + GAP;

    // 准备座位数据，使用行列号作为seatNumber
    const seatPos = {
      seats: seats.map(seat => {
        // 计算行列索引
        const colIndex = Math.round((seat.x - minX) / TOTAL_SIZE);
        const rowIndex = Math.round((maxY - seat.y) / TOTAL_SIZE);
        
        // 生成行列号
        const row = String.fromCharCode(65 + colIndex); // A, B, C...
        const col = rowIndex + 1; // 1, 2, 3...
        
        return {
          seatNumber: `${row}${col}`, // 使用A1, B1等格式作为座位号
          x: Math.round(seat.x / TOTAL_SIZE), // 转换为相对坐标
          y: Math.round(seat.y / TOTAL_SIZE)
        };
      })
    };

    // 输出到控制台
    console.log('座位数据:');
    console.log(JSON.stringify(seatPos, null, 2));
    alert('座位数据已输出到控制台');
  };

  const handleExportSeatQRCodesZip = async () => {
    if (!selectedRoom) {
      alert('请先选择房间');
      return;
    }

    try {
      const token = getAuthToken();
      if (!token) {
        alert('未登录');
        return;
      }

      const url = `${API_BASE_URL}/room/qrcodes?room_id=${encodeURIComponent(selectedRoom)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = '导出失败';
        try {
          const data = text ? JSON.parse(text) : null;
          msg = data?.message || data?.Message || msg;
        } catch {
          msg = text || msg;
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `room_${selectedRoom}_qrcodes.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('导出二维码失败:', error);
      alert('导出失败: ' + error.message);
    }
  };

  const seatToExportData = (seat) => {
    const colIndex = Math.round((seat.x - PADDING) / TOTAL_SIZE);
    const rowIndex = Math.round((seat.y - PADDING) / TOTAL_SIZE);
    const row = String.fromCharCode(65 + colIndex);
    const col = rowIndex + 1;
    return {
      seatNumber: seat.seatNumber || `${row}${col}`,
      x: Math.round(seat.x / TOTAL_SIZE),
      y: Math.round(seat.y / TOTAL_SIZE)
    };
  };

  // 保存座位数据到后端
  const handleSaveToBackend = async () => {
    if (!selectedRoom) {
      alert('请先选择房间');
      return;
    }

    const seatPos = {
      seats: seats.map(seatToExportData)
    };

    try {
      const result = await apiFetch('/room', {
        method: 'POST',
        body: JSON.stringify({
          org_id: null,
          room_id: selectedRoom,
          seat_pos: seatPos,
          bssid_list: ""
        })
      });

      alert(result.message || '保存成功');
      fetchRoomList();
    } catch (error) {
      console.error('保存座位数据失败:', error);
      alert('保存失败: ' + error.message);
    }
  };

  // 创建房间
  const handleCreateRoom = async () => {
    if (!roomNameInput.trim()) {
      alert('请输入房间名称');
      return;
    }

    const seatPos = {
      seats: seats.map(seatToExportData)
    };

    try {
      const result = await apiFetch('/room', {
        method: 'POST',
        body: JSON.stringify({
          id: null,
          org_id: null,
          room_id: roomNameInput.trim(),
          seat_pos: seatPos,
          bssid_list: ""
        })
      });

      alert(result.message || '创建成功');
      setShowCreateRoomModal(false);
      setRoomNameInput('');
      fetchRoomList();
      setSelectedRoom(roomNameInput.trim());
    } catch (error) {
      console.error('创建房间失败:', error);
      alert('创建失败: ' + error.message);
    }
  };

  // 删除房间
  const handleDeleteRoom = async () => {
    if (!selectedRoom) {
      alert('请先选择房间');
      return;
    }
    if (!window.confirm(`确定删除房间「${selectedRoom}」吗？该操作不可撤销。`)) return;

    try {
      const result = await apiFetch(`/room?room_id=${encodeURIComponent(selectedRoom)}`, {
        method: 'DELETE'
      });
      alert(result.message || '删除成功');
      setSelectedRoom('');
      setSeats([]);
      fetchRoomList();
    } catch (error) {
      console.error('删除房间失败:', error);
      alert('删除失败: ' + error.message);
    }
  };

  return (
    <div className="seat-edit-page">
      <div className="content-header">
        <h2>座位编辑</h2>
      </div>
      <div className="app-content">
        <div className="toolbar">
          <h3>拖拽元素</h3>

          <div className="drag-sources">
            <SeatDragSource type="SINGLE" />

            <div className="seat-group">
              <CountSelector value={rowCount} onChange={setRowCount} label="一行座位数量" />
              <SeatDragSource type="ROW" count={rowCount} />
            </div>

            <div className="seat-group">
              <CountSelector value={columnCount} onChange={setColumnCount} label="一列座位数量" />
              <SeatDragSource type="COLUMN" count={columnCount} />
            </div>
            
            {/* 画布大小设置 */}
            <div className="seat-group" style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
              <h4 style={{ marginBottom: '15px', fontSize: '14px', color: '#495057', fontWeight: '600' }}>画布大小设置</h4>
              <div style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label style={{ minWidth: '100px', fontSize: '14px', color: '#6c757d', fontWeight: '500' }}>宽度: {canvasWidth}px</label>
                <button 
                  onClick={() => setCanvasWidth(Math.max(400, canvasWidth - 100))} 
                  style={{ 
                    width: '28px', 
                    height: '28px', 
                    border: '1px solid #ddd', 
                    backgroundColor: 'white', 
                    borderRadius: '4px', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontSize: '16px', 
                    fontWeight: 'bold',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                >-</button>
                <button 
                  onClick={() => setCanvasWidth(canvasWidth + 100)} 
                  style={{ 
                    width: '28px', 
                    height: '28px', 
                    border: '1px solid #ddd', 
                    backgroundColor: 'white', 
                    borderRadius: '4px', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontSize: '16px', 
                    fontWeight: 'bold',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                >+</button>
                <input 
                  type="number" 
                  value={canvasWidth} 
                  onChange={(e) => setCanvasWidth(Math.max(400, parseInt(e.target.value) || 400))} 
                  style={{ 
                    width: '100px', 
                    padding: '6px', 
                    border: '1px solid #ddd', 
                    borderRadius: '4px',
                    fontSize: '14px',
                    transition: 'border-color 0.2s'
                  }} 
                  onFocus={(e) => e.target.style.borderColor = '#1976d2'}
                  onBlur={(e) => e.target.style.borderColor = '#ddd'}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label style={{ minWidth: '100px', fontSize: '14px', color: '#6c757d', fontWeight: '500' }}>高度: {canvasHeight}px</label>
                <button 
                  onClick={() => setCanvasHeight(Math.max(400, canvasHeight - 100))} 
                  style={{ 
                    width: '28px', 
                    height: '28px', 
                    border: '1px solid #ddd', 
                    backgroundColor: 'white', 
                    borderRadius: '4px', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontSize: '16px', 
                    fontWeight: 'bold',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                >-</button>
                <button 
                  onClick={() => setCanvasHeight(canvasHeight + 100)} 
                  style={{ 
                    width: '28px', 
                    height: '28px', 
                    border: '1px solid #ddd', 
                    backgroundColor: 'white', 
                    borderRadius: '4px', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontSize: '16px', 
                    fontWeight: 'bold',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                >+</button>
                <input 
                  type="number" 
                  value={canvasHeight} 
                  onChange={(e) => setCanvasHeight(Math.max(400, parseInt(e.target.value) || 400))} 
                  style={{ 
                    width: '100px', 
                    padding: '6px', 
                    border: '1px solid #ddd', 
                    borderRadius: '4px',
                    fontSize: '14px',
                    transition: 'border-color 0.2s'
                  }} 
                  onFocus={(e) => e.target.style.borderColor = '#1976d2'}
                  onBlur={(e) => e.target.style.borderColor = '#ddd'}
                />
              </div>
            </div>

            {/* 自动生成座位 */}
            <div className="seat-group" style={{ marginTop: '20px', padding: '15px', backgroundColor: '#e8f4fd', borderRadius: '8px', border: '1px solid #b3d8f0' }}>
              <h4 style={{ marginBottom: '15px', fontSize: '14px', color: '#1976d2', fontWeight: '600' }}>自动生成座位</h4>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '13px', color: '#555', display: 'block', marginBottom: '4px' }}>总座位数</label>
                <input
                  type="number" min="1" max="200"
                  value={autoTotalSeats}
                  onChange={(e) => setAutoTotalSeats(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: '100%', padding: '6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '13px', color: '#555', display: 'block', marginBottom: '4px' }}>每行列数</label>
                <input
                  type="number" min="1" max="50"
                  value={autoColumns}
                  onChange={(e) => setAutoColumns(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  style={{ width: '100%', padding: '6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: '12px', fontSize: '13px', color: '#666' }}>
                将生成 {autoRows} 行 × {autoColumns || '-'} 列，共 {autoTotalSeats} 个座位
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '13px', color: '#555', display: 'block', marginBottom: '6px' }}>排列方式</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <label
                    onClick={() => setAutoLayout('horizontal')}
                    style={{
                      flex: 1, padding: '8px', textAlign: 'center', cursor: 'pointer', borderRadius: '6px', fontSize: '13px', userSelect: 'none',
                      backgroundColor: autoLayout === 'horizontal' ? '#1976d2' : '#f0f0f0',
                      color: autoLayout === 'horizontal' ? '#fff' : '#333',
                      border: autoLayout === 'horizontal' ? '1px solid #1976d2' : '1px solid #ddd',
                    }}
                  >
                    <div style={{ fontWeight: '600', marginBottom: '2px' }}>横排</div>
                    <div style={{ fontSize: '11px', opacity: '0.8' }}>A1 A2 A3…</div>
                  </label>
                  <label
                    onClick={() => setAutoLayout('vertical')}
                    style={{
                      flex: 1, padding: '8px', textAlign: 'center', cursor: 'pointer', borderRadius: '6px', fontSize: '13px', userSelect: 'none',
                      backgroundColor: autoLayout === 'vertical' ? '#1976d2' : '#f0f0f0',
                      color: autoLayout === 'vertical' ? '#fff' : '#333',
                      border: autoLayout === 'vertical' ? '1px solid #1976d2' : '1px solid #ddd',
                    }}
                  >
                    <div style={{ fontWeight: '600', marginBottom: '2px' }}>竖排</div>
                    <div style={{ fontSize: '11px', opacity: '0.8' }}>A1 B1 C1…</div>
                  </label>
                </div>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '13px', color: '#555', display: 'block', marginBottom: '6px' }}>末尾行/列对齐</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[
                    { key: 'left', label: '左对齐' },
                    { key: 'center', label: '居中' },
                    { key: 'right', label: '右对齐' },
                  ].map(opt => (
                    <label key={opt.key} onClick={() => setAutoAlign(opt.key)}
                      style={{
                        flex: 1, padding: '6px 4px', textAlign: 'center', cursor: 'pointer', borderRadius: '6px', fontSize: '12px', userSelect: 'none',
                        backgroundColor: autoAlign === opt.key ? '#1976d2' : '#f0f0f0',
                        color: autoAlign === opt.key ? '#fff' : '#333',
                        border: autoAlign === opt.key ? '1px solid #1976d2' : '1px solid #ddd',
                      }}
                    >{opt.label}</label>
                  ))}
                </div>
              </div>
              <button
                onClick={handleAutoGenerate}
                style={{
                  width: '100%', padding: '8px', backgroundColor: '#1976d2', color: 'white', border: 'none', borderRadius: '6px',
                  fontSize: '14px', fontWeight: '600', cursor: 'pointer', transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#1565c0'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#1976d2'}
              >生成座位</button>
            </div>
          </div>

          <div className="actions">
            <button onClick={handleDeleteSelected}>删除选中</button>
            <button onClick={handleClearAll}>清空画布</button>
          </div>
          
          <div className="export-actions">
            <h4>数据库接口</h4>
            <div style={{ marginTop: '10px', marginBottom: '10px' }}>
              <label htmlFor="roomSelect">选择房间: </label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <select 
                  id="roomSelect"
                  value={selectedRoom}
                  onChange={(e) => {
                    setSelectedRoom(e.target.value);
                    handleImportSeats(e.target.value);   
                  }}
                  style={{
                    flex: 1,
                    padding: '6px',
                    marginTop: '5px',
                    border: '1px solid #ddd',
                    borderRadius: '4px'
                  }}
                >
                  <option value="">请选择房间</option>
                  {roomList.map(room => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
                {selectedRoom && (
                  <button
                    onClick={handleDeleteRoom}
                    title="删除当前房间"
                    style={{
                      marginTop: '5px',
                      padding: '6px 10px',
                      backgroundColor: '#e74c3c',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '600',
                      whiteSpace: 'nowrap'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = '#c0392b'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = '#e74c3c'}
                  >删除</button>
                )}
              </div>
            </div>
            {/* <button onClick={handleExportSeats} className="export-btn export-debug">控制台导出座位数据(调试)</button> */}
            <button onClick={handleExportSeatQRCodesZip} className="export-btn export-debug">导出座位二维码(压缩包)</button>
            <button onClick={handleSaveToBackend} className="export-btn save">保存到当前房间</button>
            <button onClick={() => setShowCreateRoomModal(true)} className="export-btn create">创建房间</button>
          </div>
        </div>

        <div className="canvas-container">
          <Canvas 
            seats={seats} 
            onAddSeat={handleAddSeat} 
            onSeatClick={handleSeatClick} 
            width={canvasWidth} 
            height={canvasHeight} 
          />
        </div>
      </div>
      
      {/* 创建房间悬浮窗 */}
      {showCreateRoomModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>创建新房间</h3>
            <div>
              <label htmlFor="roomName">房间名称:</label>
              <input
                id="roomName"
                type="text"
                value={roomNameInput}
                onChange={(e) => setRoomNameInput(e.target.value)}
                placeholder="请输入房间名称"
                className="modal-input"
              />
            </div>
            <div className="modal-actions">
              <button 
                onClick={() => {
                  setShowCreateRoomModal(false);
                  setRoomNameInput('');
                }}
                className="modal-btn cancel"
              >
                取消
              </button>
              <button 
                onClick={handleCreateRoom}
                className="modal-btn create"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SeatEditPage;
