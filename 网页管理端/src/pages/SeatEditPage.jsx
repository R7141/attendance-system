import { useState, useEffect } from 'react';
import { apiFetch, API_BASE_URL, getAuthToken } from '../api';
import CountSelector from '../components/CountSelector';
import Canvas from '../components/Canvas';

const SEAT_SIZE = 60;
const GAP = 20;
const PADDING = 50;

function computeGridPos(rows, cols) {
  const rowY = [];
  let y = PADDING;
  for (let r = 0; r < rows; r++) { rowY[r] = y; y += SEAT_SIZE + GAP; }
  const colX = [];
  let x = PADDING;
  for (let c = 0; c < cols; c++) { colX[c] = x; x += SEAT_SIZE + GAP; }
  return { colX, rowY };
}

function findNearestGrid(px, py, colX, rowY) {
  let nearestR = -1, nearestC = -1, minDist = Infinity;
  for (let r = 0; r < rowY.length; r++) {
    for (let c = 0; c < colX.length; c++) {
      const cx = colX[c] + SEAT_SIZE / 2, cy = rowY[r] + SEAT_SIZE / 2;
      const dist = Math.hypot(px - cx, py - cy);
      if (dist < minDist) { minDist = dist; nearestR = r; nearestC = c; }
    }
  }
  return minDist < SEAT_SIZE ? { row: nearestR, col: nearestC } : null;
}

function detectPattern(labels) {
  const parsed = labels.map(label => {
    const m = label.match(/^([^\d]*?)(\d+)$/);
    return m ? { prefix: m[1], num: parseInt(m[2]), width: m[2].length } : null;
  });
  if (parsed.some(p => !p)) throw new Error('所有手动编号必须包含数字后缀');
  const first = parsed[0];
  if (parsed.some(p => p.prefix !== first.prefix)) throw new Error('编号前缀不一致');
  if (parsed.some(p => p.width !== first.width)) throw new Error('编号位数不一致');
  const sorted = [...parsed].sort((a, b) => a.num - b.num);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].num !== sorted[i - 1].num + 1) throw new Error('手动编号不连续，无法自动扩充');
  }
  return { prefix: first.prefix, width: first.width, maxNum: Math.max(...parsed.map(p => p.num)) };
}

function SeatEditPage() {
  const [seats, setSeats] = useState([]);
  const [roomRows, setRoomRows] = useState(8);
  const [roomCols, setRoomCols] = useState(10);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [roomNameInput, setRoomNameInput] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  const [roomList, setRoomList] = useState([]);
  const [blockRows, setBlockRows] = useState(2);
  const [blockCols, setBlockCols] = useState(2);
  const [editingSeat, setEditingSeat] = useState(null);
  const [editLabelInput, setEditLabelInput] = useState('');
  const [placeRow, setPlaceRow] = useState(1);
  const [placeCol, setPlaceCol] = useState(1);

  // 位置编辑
  const [editingPositionSeat, setEditingPositionSeat] = useState(null);
  const [editRowInput, setEditRowInput] = useState('');
  const [editColInput, setEditColInput] = useState('');

  // 网格变化时重新计算座位位置
  useEffect(() => {
    const { colX, rowY } = computeGridPos(roomRows, roomCols);
    setSeats(prev => prev.map(s =>
      s.gridRow != null && s.gridCol != null && s.gridRow < roomRows && s.gridCol < roomCols
        ? { ...s, x: colX[s.gridCol] ?? s.x, y: rowY[s.gridRow] ?? s.y }
        : s
    ).filter(s => s.gridRow == null || s.gridCol == null || (s.gridRow < roomRows && s.gridCol < roomCols)));
  }, [roomRows, roomCols]);

  const getSeatExportData = (seats) => {
    return seats
      .filter(s => !s.isOccupied && !s.isAisle && s.gridRow != null && s.gridCol != null)
      .map(seat => ({
        seatNumber: seat.label || (seat.seatNumber ? `${seat.seatNumber.row}${seat.seatNumber.col}` : ''),
        x: seat.gridCol,
        y: seat.gridRow,
      }));
  };

  // 放置座位块
  const handlePlaceBlock = (startR, startC) => {
    for (let r = startR; r < startR + blockRows; r++) {
      for (let c = startC; c < startC + blockCols; c++) {
        if (r < 0 || r >= roomRows || c < 0 || c >= roomCols) {
          alert('超出画布范围，请重新选择位置');
          return;
        }
        if (seats.find(s => s.gridRow === r && s.gridCol === c)) {
          alert('块内部分位置已被占用，请重新选择位置');
          return;
        }
      }
    }

    const { colX, rowY } = computeGridPos(roomRows, roomCols);
    const newSeats = [];
    for (let r = startR; r < startR + blockRows; r++) {
      for (let c = startC; c < startC + blockCols; c++) {
        newSeats.push({
          id: `seat-${Date.now()}-${r}-${c}-${Math.random()}`,
          gridRow: r,
          gridCol: c,
          x: colX[c],
          y: rowY[r],
          selected: true,
          isOccupied: false,
          isAisle: false,
          label: null,
          seatNumber: null,
        });
      }
    }
    setSeats(prev => [...prev.map(s => ({ ...s, selected: false })), ...newSeats]);
  };

  // 点击网格
  const handleCellClick = (r, c) => {
    const existing = seats.find(s => s.gridRow === r && s.gridCol === c);
    if (existing) {
      setSeats(prev => prev.map(s =>
        s.id === existing.id ? { ...s, selected: !s.selected } : { ...s, selected: false }
      ));
    } else {
      handlePlaceBlock(r, c);
    }
  };

  const handleSeatClick = (clickedSeat, e) => {
    if (e && e.ctrlKey) {
      setSeats(prev => prev.map(s =>
        s.id === clickedSeat.id ? { ...s, selected: !s.selected } : s
      ));
    } else {
      setSeats(prev => prev.map(s =>
        s.id === clickedSeat.id ? { ...s, selected: !s.selected } : { ...s, selected: false }
      ));
    }
  };

  // 拖拽吸附（含交换）
  const handleSnapSeat = (positions) => {
    const { colX, rowY } = computeGridPos(roomRows, roomCols);
    setSeats(prev => {
      const arr = [...prev];
      for (const pos of positions) {
        const nearest = findNearestGrid(pos.targetX, pos.targetY, colX, rowY);
        if (!nearest) continue;
        const srcIdx = arr.findIndex(s => s.id === pos.id);
        if (srcIdx < 0) continue;
        const srcRow = arr[srcIdx].gridRow, srcCol = arr[srcIdx].gridCol;

        const tgtIdx = arr.findIndex(s => s.id !== pos.id && s.gridRow === nearest.row && s.gridCol === nearest.col);
        if (tgtIdx >= 0) {
          arr[tgtIdx] = { ...arr[tgtIdx], gridRow: srcRow, gridCol: srcCol, x: colX[srcCol] ?? arr[tgtIdx].x, y: rowY[srcRow] ?? arr[tgtIdx].y };
        }
        arr[srcIdx] = { ...arr[srcIdx], gridRow: nearest.row, gridCol: nearest.col, x: colX[nearest.col], y: rowY[nearest.row] };
      }
      return arr;
    });
  };

  // 编辑编号
  const handleEditLabel = (seat) => {
    setEditingSeat(seat);
    setEditLabelInput(seat.label || '');
  };

  const handleSaveLabel = () => {
    setSeats(prev => prev.map(s =>
      s.id === editingSeat.id ? { ...s, label: editLabelInput.trim() || null } : s
    ));
    setEditingSeat(null);
  };

  const handleCancelLabel = () => setEditingSeat(null);

  // 自动编号
  const handleAutoNumber = (mode) => {
    const validSeats = seats.filter(s => !s.isOccupied && !s.isAisle && s.gridRow != null && s.gridCol != null);
    if (validSeats.length === 0) { alert('没有可编号的座位'); return; }

    const labeled = validSeats.filter(s => s.label);
    const unlabeled = validSeats.filter(s => !s.label);
    if (unlabeled.length === 0) { alert('所有座位已编号，无需补充'); return; }

    let nextNum = 1, prefix = 'A', width = 0;
    if (labeled.length > 0) {
      try {
        const pattern = detectPattern(labeled.map(s => s.label));
        prefix = pattern.prefix; width = pattern.width; nextNum = pattern.maxNum + 1;
      } catch (e) { alert(e.message); return; }
    }

    const sorted = [...validSeats].sort((a, b) =>
      mode === 'horizontal'
        ? (a.gridRow - b.gridRow || a.gridCol - b.gridCol)
        : (a.gridCol - b.gridCol || a.gridRow - b.gridRow)
    );

    const labeledIds = new Set(labeled.map(s => s.id));

    setSeats(prev => {
      const arr = [...prev];
      let counter = nextNum;
      for (const s of sorted) {
        if (labeledIds.has(s.id)) continue;
        const idx = arr.findIndex(x => x.id === s.id);
        if (idx < 0) continue;
        const padded = width > 0 ? String(counter).padStart(width, '0') : String(counter);
        arr[idx] = { ...arr[idx], label: prefix + padded };
        counter++;
      }
      return arr;
    });

    alert(`编号完成，已补充 ${unlabeled.length} 个座位`);
  };

  // 状态切换
  const handleToggleOccupied = () => {
    if (!seats.some(s => s.selected)) { alert('请先选中座位'); return; }
    setSeats(prev => prev.map(s =>
      s.selected ? { ...s, isOccupied: !s.isOccupied, isAisle: false } : s
    ));
  };

  const handleToggleAisle = () => {
    if (!seats.some(s => s.selected)) { alert('请先选中座位'); return; }
    setSeats(prev => prev.map(s =>
      s.selected ? { ...s, isAisle: !s.isAisle, isOccupied: false } : s
    ));
  };

  const handleRestore = () => {
    if (!seats.some(s => s.selected)) { alert('请先选中座位'); return; }
    setSeats(prev => prev.map(s =>
      s.selected ? { ...s, isOccupied: false, isAisle: false } : s
    ));
  };

  const handleDeleteSelected = () => {
    setSeats(prev => prev.filter(s => !s.selected));
  };

  const handleClearAll = () => {
    if (window.confirm('确定要清空所有座位吗？')) {
      setSeats([]);
    }
  };

  // 清空编号
  const handleClearLabel = () => {
    if (!seats.some(s => s.selected)) { alert('请先选中座位'); return; }
    setSeats(prev => prev.map(s =>
      s.selected ? { ...s, label: null } : s
    ));
  };

  // 添加座位（在指定位置放置块）
  const handlePlaceSeatAt = () => {
    const startR = placeRow - 1;
    const startC = placeCol - 1;
    if (startR < 0 || startR >= roomRows || startC < 0 || startC >= roomCols) {
      alert('超出画布范围，请重新输入行列');
      return;
    }
    handlePlaceBlock(startR, startC);
  };

  // 编辑位置
  const handleEditPosition = () => {
    const sel = seats.find(s => s.selected);
    if (!sel) { alert('请先选中一个座位'); return; }
    setEditingPositionSeat(sel);
    setEditRowInput(String(sel.gridRow + 1));
    setEditColInput(String(sel.gridCol + 1));
  };

  const handleSavePosition = () => {
    const newRow = parseInt(editRowInput, 10) - 1;
    const newCol = parseInt(editColInput, 10) - 1;
    if (isNaN(newRow) || isNaN(newCol) || newRow < 0 || newRow >= roomRows || newCol < 0 || newCol >= roomCols) {
      alert('行列超出画布范围');
      return;
    }
    const conflict = seats.find(s => s.id !== editingPositionSeat.id && s.gridRow === newRow && s.gridCol === newCol);
    if (conflict) {
      alert('该位置已被占用');
      return;
    }
    const { colX, rowY } = computeGridPos(roomRows, roomCols);
    setSeats(prev => prev.map(s =>
      s.id === editingPositionSeat.id ? { ...s, gridRow: newRow, gridCol: newCol, x: colX[newCol], y: rowY[newRow] } : s
    ));
    setEditingPositionSeat(null);
  };

  const handleCancelPosition = () => setEditingPositionSeat(null);

  // 房间操作
  const fetchRoomList = async () => {
    try {
      const data = await apiFetch('/rooms');
      let formattedRooms = [];
      if (data && Array.isArray(data.rooms)) {
        formattedRooms = data.rooms.map(r => ({ id: r?.room_id, name: `${r?.room_id || ''}` })).filter(r => r.id);
      } else if (data && Array.isArray(data.room_ids)) {
        formattedRooms = data.room_ids.map(id => ({ id, name: `${id}` })).filter(r => r.id);
      }
      setRoomList(formattedRooms);
    } catch (error) { console.error('获取房间列表失败:', error); }
  };

  useEffect(() => { fetchRoomList(); }, []);

  const handleImportSeats = async (room) => {
    const roomId = room || selectedRoom;
    if (!roomId) { alert('请先选择房间'); return; }
    try {
      const data = await apiFetch(`/roomseat?room_id=${encodeURIComponent(roomId)}`);
      if (data && data.seat_pos) {
        const seatPosObj = typeof data.seat_pos === 'string' ? JSON.parse(data.seat_pos) : data.seat_pos;
        if (seatPosObj && Array.isArray(seatPosObj.seats)) {
          const imported = seatPosObj.seats;
          const maxX = Math.max(...imported.map(s => s.x)) + 1;
          const maxY = Math.max(...imported.map(s => s.y)) + 1;
          const rows = Math.max(roomRows, maxY);
          const cols = Math.max(roomCols, maxX);
          if (rows !== roomRows) setRoomRows(rows);
          if (cols !== roomCols) setRoomCols(cols);
          const { colX, rowY } = computeGridPos(rows, cols);
          const convertedSeats = imported.map((s, index) => ({
            id: `seat-${Date.now()}-${index}`,
            gridRow: s.y, gridCol: s.x,
            x: colX[s.x] || 0, y: rowY[s.y] || 0,
            selected: false, isOccupied: false, isAisle: false,
            label: s.seatNumber || null, seatNumber: null,
          }));
          setSeats(convertedSeats);
          alert(`成功导入 ${convertedSeats.length} 个座位`);
        }
      } else { setSeats([]); }
    } catch (error) { alert('读取失败: ' + error.message); }
  };

  const handleSaveToBackend = async () => {
    if (!selectedRoom) { alert('请先选择房间'); return; }
    const seatPos = { seats: getSeatExportData(seats) };
    try {
      const result = await apiFetch('/room', { method: 'POST', body: JSON.stringify({ org_id: null, room_id: selectedRoom, seat_pos: seatPos, bssid_list: "" }) });
      alert(result.message || '保存成功');
      fetchRoomList();
      await handleImportSeats(selectedRoom);
    } catch (error) { alert('保存失败: ' + error.message); }
  };

  const handleCreateRoom = async () => {
    if (!roomNameInput.trim()) { alert('请输入房间名称'); return; }
    const seatPos = { seats: getSeatExportData(seats) };
    try {
      const roomId = roomNameInput.trim();
      const result = await apiFetch('/room', { method: 'POST', body: JSON.stringify({ id: null, org_id: null, room_id: roomId, seat_pos: seatPos, bssid_list: "" }) });
      alert(result.message || '创建成功');
      setShowCreateRoomModal(false);
      setRoomNameInput('');
      fetchRoomList();
      setSelectedRoom(roomId);
      await handleImportSeats(roomId);
    } catch (error) { alert('创建失败: ' + error.message); }
  };

  const handleExportSeatQRCodesZip = async () => {
    if (!selectedRoom) { alert('请先选择房间'); return; }
    try {
      const token = getAuthToken();
      if (!token) { alert('未登录'); return; }
      const res = await fetch(`${API_BASE_URL}/room/qrcodes?room_id=${encodeURIComponent(selectedRoom)}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.text()) || '导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `room_${selectedRoom}_qrcodes.zip`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (error) { alert('导出失败: ' + error.message); }
  };

  return (
    <div className="seat-edit-page">
      <div className="content-header"><h2>座位编辑</h2></div>
      <div className="app-content">
        <div className="toolbar">
          <h3>房间网格配置</h3>
          <div className="drag-sources">
            <div className="seat-group">
              <CountSelector value={roomRows} onChange={setRoomRows} label="房间行数" />
            </div>
            <div className="seat-group">
              <CountSelector value={roomCols} onChange={setRoomCols} label="房间列数" />
            </div>

            <div className="seat-group">
              <CountSelector value={blockRows} onChange={setBlockRows} label="块行数" />
            </div>
            <div className="seat-group">
              <CountSelector value={blockCols} onChange={setBlockCols} label="块列数" />
            </div>
            <p style={{ fontSize: '12px', color: '#999', marginBottom: '10px' }}>
              💡 鼠标移到画布预览座位块 | 单击空格放置块<br />
              块中已有座位或超出边界会报错<br />
              双击座位编辑编号 | Ctrl+点击多选 | 拖拽移动
            </p>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <h4 style={{ fontSize: '14px', marginBottom: '8px', color: '#666' }}>编号操作</h4>
            <button onClick={() => handleAutoNumber('horizontal')} style={btnStyle('#ff9800')}>横向编号</button>
            <button onClick={() => handleAutoNumber('vertical')} style={btnStyle('#ff9800')}>纵向编号</button>
            <button onClick={() => {
              const sel = seats.find(s => s.selected);
              if (!sel) { alert('请先选中一个座位'); return; }
              handleEditLabel(sel);
            }} style={btnStyle('#9c27b0')}>编辑编号</button>
            <button onClick={handleClearLabel} style={btnStyle('#f44336')}>清空编号</button>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <h4 style={{ fontSize: '14px', marginBottom: '8px', color: '#666' }}>座位位置编辑</h4>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <input type="number" min="1" max={roomRows} value={placeRow}
                onChange={e => setPlaceRow(Math.max(1, Math.min(roomRows, Number(e.target.value))))}
                style={{ width: '50px', padding: '6px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'center' }}
                placeholder="行" />
              <span style={{ lineHeight: '32px', color: '#999' }}>行</span>
              <input type="number" min="1" max={roomCols} value={placeCol}
                onChange={e => setPlaceCol(Math.max(1, Math.min(roomCols, Number(e.target.value))))}
                style={{ width: '50px', padding: '6px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'center' }}
                placeholder="列" />
              <span style={{ lineHeight: '32px', color: '#999' }}>列</span>
            </div>
            <button onClick={handlePlaceSeatAt} style={btnStyle('#e91e63')}>添加座位</button>
            <button onClick={handleEditPosition} style={btnStyle('#e91e63')}>编辑坐标</button>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <h4 style={{ fontSize: '14px', marginBottom: '8px', color: '#666' }}>状态编辑</h4>
            <button onClick={handleToggleOccupied} style={btnStyle('#607d8b')}>被占用</button>
            <button onClick={handleToggleAisle} style={btnStyle('#4caf50')}>设为走道</button>
            <button onClick={handleRestore} style={btnStyle('#795548')}>恢复</button>
          </div>

          <div className="actions">
            <button onClick={handleDeleteSelected}>删除选中</button>
            <button onClick={handleClearAll}>清空画布</button>
          </div>

          <div className="export-actions">
            <h4>数据库接口</h4>
            <div style={{ marginTop: '10px', marginBottom: '10px' }}>
              <label htmlFor="roomSelect">选择房间: </label>
              <select id="roomSelect" value={selectedRoom} onChange={(e) => { setSelectedRoom(e.target.value); handleImportSeats(e.target.value); }}
                style={{ width: '100%', padding: '6px', marginTop: '5px', border: '1px solid #ddd', borderRadius: '4px' }}>
                <option value="">请选择房间</option>
                {roomList.map(room => (<option key={room.id} value={room.id}>{room.name}</option>))}
              </select>
            </div>
            <button onClick={handleExportSeatQRCodesZip} className="export-btn export-debug">导出座位二维码(压缩包)</button>
            <button onClick={handleSaveToBackend} className="export-btn save">保存到当前房间</button>
            <button onClick={() => setShowCreateRoomModal(true)} className="export-btn create">创建房间</button>
          </div>
        </div>

        <div className="canvas-container">
          <Canvas
            seats={seats}
            roomRows={roomRows}
            roomCols={roomCols}
            blockRows={blockRows}
            blockCols={blockCols}
            onCellClick={handleCellClick}
            onSeatClick={handleSeatClick}
            onSnapSeat={handleSnapSeat}
            onEditLabel={handleEditLabel}
          />
        </div>
      </div>

      {/* 编辑编号悬浮窗 */}
      {editingSeat && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '320px' }}>
            <h3>编辑编号</h3>
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '12px' }}>
              座位 ({editingSeat.gridRow + 1}, {editingSeat.gridCol + 1})
            </p>
            <input
              type="text"
              value={editLabelInput}
              onChange={e => setEditLabelInput(e.target.value)}
              className="modal-input"
              placeholder="输入编号（留空清除）"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSaveLabel(); if (e.key === 'Escape') handleCancelLabel(); }}
            />
            <div className="modal-actions">
              <button onClick={handleCancelLabel} className="modal-btn cancel">取消</button>
              <button onClick={handleSaveLabel} className="modal-btn create">确认</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑位置悬浮窗 */}
      {editingPositionSeat && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '320px' }}>
            <h3>编辑坐标</h3>
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '12px' }}>
              座位 ({editingPositionSeat.gridRow + 1}, {editingPositionSeat.gridCol + 1})
            </p>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>行</label>
                <input type="number" min="1" max={roomRows} value={editRowInput}
                  onChange={e => setEditRowInput(e.target.value)}
                  className="modal-input"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleSavePosition(); if (e.key === 'Escape') handleCancelPosition(); }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>列</label>
                <input type="number" min="1" max={roomCols} value={editColInput}
                  onChange={e => setEditColInput(e.target.value)}
                  className="modal-input"
                  onKeyDown={e => { if (e.key === 'Enter') handleSavePosition(); if (e.key === 'Escape') handleCancelPosition(); }} />
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={handleCancelPosition} className="modal-btn cancel">取消</button>
              <button onClick={handleSavePosition} className="modal-btn create">确认</button>
            </div>
          </div>
        </div>
      )}

      {/* 创建房间悬浮窗 */}
      {showCreateRoomModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>创建新房间</h3>
            <div>
              <label htmlFor="roomName">房间名称:</label>
              <input id="roomName" type="text" value={roomNameInput} onChange={e => setRoomNameInput(e.target.value)}
                placeholder="请输入房间名称" className="modal-input" />
            </div>
            <div className="modal-actions">
              <button onClick={() => { setShowCreateRoomModal(false); setRoomNameInput(''); }} className="modal-btn cancel">取消</button>
              <button onClick={handleCreateRoom} className="modal-btn create">创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle = (bg) => ({
  width: '100%', padding: '10px', backgroundColor: bg, color: 'white',
  border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '500',
  marginBottom: '8px',
});

export default SeatEditPage;
