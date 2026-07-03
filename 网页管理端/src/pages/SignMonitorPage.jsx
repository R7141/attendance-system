import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../api';
import './SignMonitorPage.css';

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const DEFAULT_TIME_SLOTS = [
  { id: 1, label: '第1节', start: '08:00', end: '08:45' },
  { id: 2, label: '第2节', start: '08:55', end: '09:40' },
  { id: 3, label: '第3节', start: '10:00', end: '10:45' },
  { id: 4, label: '第4节', start: '10:55', end: '11:40' },
  { id: 5, label: '第5节', start: '14:00', end: '14:45' },
  { id: 6, label: '第6节', start: '14:55', end: '15:40' },
  { id: 7, label: '第7节', start: '16:00', end: '16:45' },
  { id: 8, label: '第8节', start: '16:55', end: '17:40' },
  { id: 9, label: '第9节', start: '19:00', end: '19:45' },
  { id: 10, label: '第10节', start: '19:55', end: '20:40' },
  { id: 11, label: '第11节', start: '20:50', end: '21:35' },
];

const SignMonitorPage = () => {
  const location = useLocation();
  const [courses, setCourses] = useState([]);
  const [rooms, setRooms] = useState([]); // Just IDs or basic info
  const [semesters, setSemesters] = useState([]);
  const [currentSemesterId, setCurrentSemesterId] = useState(null);
  const [semesterTimeSlots, setSemesterTimeSlots] = useState(DEFAULT_TIME_SLOTS);
  const [rosters, setRosters] = useState([]);
  const [autoPickCourse, setAutoPickCourse] = useState(true);
  const [autoPickHint, setAutoPickHint] = useState('');

  const [currentCourse, setCurrentCourse] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [signIns, setSignIns] = useState([]); // Array of sign-in records
  const [selectedSeat, setSelectedSeat] = useState(null); // Seat Label (e.g., "A1")
  const [fixedSeatBySeat, setFixedSeatBySeat] = useState({});
  const [leavesByStudentId, setLeavesByStudentId] = useState({});
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [leaveDraftRows, setLeaveDraftRows] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [isHeatmapModalOpen, setIsHeatmapModalOpen] = useState(false);
  const [heatmapData, setHeatmapData] = useState(null);
  const [heatmapFrom, setHeatmapFrom] = useState('');
  const [heatmapTo, setHeatmapTo] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Canvas Transform State
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const heatmapCanvasRef = useRef(null);

  // --- Initialization ---

  useEffect(() => {
    fetchInitialData();
  }, []);

  const parseTimeToMinutes = (t) => {
    const parts = String(t || '').split(':').map(Number);
    if (parts.length < 2) return 0;
    const h = Number.isFinite(parts[0]) ? parts[0] : 0;
    const m = Number.isFinite(parts[1]) ? parts[1] : 0;
    return h * 60 + m;
  };

  const dateToYMD = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  const coerceTimeSlots = (raw) => {
    if (!raw) return DEFAULT_TIME_SLOTS;
    let arr = null;
    if (Array.isArray(raw)) arr = raw;
    if (!arr && typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed;
      } catch {}
    }
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_TIME_SLOTS;
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i] || {};
      const id = Number(it.id || (i + 1));
      out.push({
        id,
        start: String(it.start || '00:00'),
        end: String(it.end || '00:00'),
        label: String(it.label || `第${id}节`),
      });
    }
    return out;
  };

  const pickCurrentSemester = (list) => {
    const arr = Array.isArray(list) ? list : [];
    const now = new Date();
    const today = dateToYMD(now);
    if (!today) return arr[0] || null;
    for (const s of arr) {
      const start = dateToYMD(s?.start_date);
      const end = dateToYMD(s?.end_date);
      if (!start || !end) continue;
      if (today >= start && today <= end) return s;
    }
    return arr[0] || null;
  };

  const currentWeekIndex = (semester, now) => {
    const startStr = dateToYMD(semester?.start_date);
    if (!startStr) return null;
    const start = new Date(`${startStr}T00:00:00`);
    if (Number.isNaN(start.getTime())) return null;
    const cur = new Date(`${dateToYMD(now)}T00:00:00`);
    if (Number.isNaN(cur.getTime())) return null;
    const diff = cur.getTime() - start.getTime();
    if (diff < 0) return null;
    return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  };

  const courseMatchesWeek = (course, weekIdx) => {
    if (!weekIdx) return true;
    const weeks = Array.isArray(course?.weeks) ? course.weeks : [];
    if (weeks.length > 0) return weeks.includes(weekIdx);
    const startW = Number(course?.start_week || 0);
    const endW = Number(course?.end_week || 0);
    if (startW > 0 && endW > 0) return weekIdx >= startW && weekIdx <= endW;
    return true;
  };

  const findCurrentCourse = (courseList, semester, slots, now) => {
    const list = Array.isArray(courseList) ? courseList : [];
    const dayOfWeek = now.getDay();
    const currentDayIndex = (dayOfWeek + 6) % 7;
    const currentTimeVal = now.getHours() * 60 + now.getMinutes();
    const weekIdx = currentWeekIndex(semester, now);

    return list.find(c => {
      if (!c) return false;
      if (Number(c.dayIndex) !== currentDayIndex) return false;
      if (!courseMatchesWeek(c, weekIdx)) return false;
      const startSlot = slots[Number(c.startSlotIndex)];
      const endSlot = slots[Number(c.endSlotIndex)];
      if (!startSlot || !endSlot) return false;
      const startTime = parseTimeToMinutes(startSlot.start);
      const endTime = parseTimeToMinutes(endSlot.end);
      return currentTimeVal >= (startTime - 15) && currentTimeVal <= (endTime + 15);
    });
  };

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const [semestersData, roomsData, rostersData] = await Promise.all([
        apiFetch('/semesters'),
        apiFetch('/rooms'),
        apiFetch('/rosters'),
      ]);
      setRosters(Array.isArray(rostersData?.rosters) ? rostersData.rosters : []);
      setRooms(Array.isArray(roomsData?.rooms) ? roomsData.rooms : []);

      const semesterList = Array.isArray(semestersData?.semesters) ? semestersData.semesters : [];
      if (semestersData?.semesters?.length > 0) {
        setSemesters(semesterList);
        const pickedSemester = pickCurrentSemester(semesterList);
        if (pickedSemester?.id) {
          setCurrentSemesterId(pickedSemester.id);
          setSemesterTimeSlots(coerceTimeSlots(pickedSemester.time_slots));
        }
      } else {
        setSemesters([]);
        setCurrentSemesterId(null);
        setSemesterTimeSlots(DEFAULT_TIME_SLOTS);
      }

      const pickedSemester = pickCurrentSemester(semesterList);
      const sid = pickedSemester?.id || null;
      const coursesData = sid ? await apiFetch(`/courses?semester_id=${sid}`) : await apiFetch('/courses');
      const courseList = Array.isArray(coursesData?.courses) ? coursesData.courses : [];
      setCourses(courseList);

      const params = new URLSearchParams(location.search || '');
      const qCourseId = Number(params.get('course_id') || 0) || null;
      const qSessionId = Number(params.get('session_id') || 0) || null;
      if (qCourseId) {
        const found = courseList.find(c => c.id === qCourseId);
        if (found) {
          setAutoPickCourse(false);
          handleCourseSelect(found, qSessionId);
        } else {
          const match = findCurrentCourse(courseList, pickedSemester, coerceTimeSlots(pickedSemester?.time_slots), new Date());
          if (match) handleCourseSelect(match);
        }
      } else {
        const match = findCurrentCourse(courseList, pickedSemester, coerceTimeSlots(pickedSemester?.time_slots), new Date());
        if (match) handleCourseSelect(match);
      }

      // We need room details, but /rooms only returns IDs.
      // We'll fetch room details on demand when course is selected.
    } catch (e) {
      console.error(e);
      alert('初始化数据失败: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Auto Selection Logic ---

  useEffect(() => {
    if (!autoPickCourse) return;
    if (!courses || courses.length === 0) return;
    const s = semesters.find(x => x.id === currentSemesterId) || null;
    const tick = () => {
      const match = findCurrentCourse(courses, s, semesterTimeSlots, new Date());
      const now = new Date();
      const nowDay = DAYS[(now.getDay() + 6) % 7];
      const nowHm = now.toTimeString().slice(0, 5);
      if (!match) {
        setAutoPickHint(`未匹配（${nowDay} ${nowHm}）`);
        return;
      }
      setAutoPickHint(`已选：${match.name || match.id}`);
      if (currentCourse?.id === match.id) return;
      handleCourseSelect(match);
    };
    tick();
    const timer = setInterval(tick, 60 * 1000);
    return () => clearInterval(timer);
  }, [autoPickCourse, courses, semesters, currentSemesterId, semesterTimeSlots, currentCourse?.id]);

  // --- Course & Room Handling ---

  const handleCourseSelect = async (course, preferredSessionId) => {
    if (!course) return;
    setCurrentCourse(course);
    setSelectedSeat(null);
    setSignIns([]);
    setActiveSession(null);
    setSessions([]);
    setSelectedSessionId(null);
    setFixedSeatBySeat({});
    setLeavesByStudentId({});
    setIsLeaveModalOpen(false);
    setLeaveDraftRows([]);
    setAlerts([]);
    setIsAlertModalOpen(false);
    setIsHeatmapModalOpen(false);
    setHeatmapData(null);
    
    // Try to find matching room
    // Logic: Course.Location should match Room.room_id
    if (course.location) {
      try {
        const roomData = await apiFetch(`/roomseat?room_id=${course.location}`);
        if (roomData && roomData.seat_pos) {
          // Parse seat_pos if it's a string
          let parsedSeats = roomData.seat_pos;
          if (typeof parsedSeats === 'string') {
             try { parsedSeats = JSON.parse(parsedSeats); } catch(e) { console.error("Parse seat error", e); }
          }
          
          // Handle object wrapper format (e.g. { seats: [...] })
          if (parsedSeats && !Array.isArray(parsedSeats) && Array.isArray(parsedSeats.seats)) {
            parsedSeats = parsedSeats.seats;
          }
          
          // Ensure it's an array
          if (!Array.isArray(parsedSeats)) {
            console.warn("seat_pos is not an array:", parsedSeats);
            parsedSeats = [];
          }

          setCurrentRoom({ ...roomData, seat_pos: parsedSeats });
        } else {
          setCurrentRoom(null); // Room not found or empty
        }
      } catch (e) {
        console.warn("Room not found for location:", course.location);
        setCurrentRoom(null);
      }
    } else {
      setCurrentRoom(null);
    }

    if (course?.fixed_seat_enabled) {
      try {
        const res = await apiFetch(`/courses/${course.id}/fixed-seats`);
        const list = Array.isArray(res?.assignments) ? res.assignments : [];
        const idToName = new Map();
        if (course.memberMode === 'independent') {
          const arr = Array.isArray(course.members) ? course.members : [];
          for (const m of arr) {
            const sid = String(m?.studentId || m?.student_id || '').trim();
            const name = String(m?.name || '').trim();
            if (!sid) continue;
            idToName.set(sid, name);
          }
        } else if (course.memberMode === 'class') {
          const rid = String(course.classRosterId || '').trim();
          const roster = rosters.find(r => String(r.id) === rid);
          const arr = Array.isArray(roster?.members) ? roster.members : [];
          for (const m of arr) {
            const sid = String(m?.studentId || m?.student_id || '').trim();
            const name = String(m?.name || '').trim();
            if (!sid) continue;
            idToName.set(sid, name);
          }
        }

        const next = {};
        for (const a of list) {
          const sid = String(a?.student_id || '').trim();
          const seat = String(a?.seat_label || '').trim();
          if (!sid || !seat) continue;
          next[seat] = { studentId: sid, studentName: idToName.get(sid) || '' };
        }
        setFixedSeatBySeat(next);
      } catch {
        setFixedSeatBySeat({});
      }
    }

    // Load sessions (active + history)
    loadSessions(course.id, preferredSessionId);
  };

  const loadSessions = async (courseId, preferredSessionId) => {
    try {
      const [activeRes, listRes] = await Promise.all([
        apiFetch(`/sessions/active?course_id=${courseId}`),
        apiFetch(`/sessions?course_id=${courseId}&limit=100`)
      ]);

      const active = activeRes?.session || null;
      const list = Array.isArray(listRes?.sessions) ? listRes.sessions : [];
      setActiveSession(active);
      setSessions(list);

      const prefer = Number(preferredSessionId || 0) || null;
      const preferExists = prefer && (active?.id === prefer || list.some(s => s.id === prefer));
      const defaultSessionId = preferExists ? prefer : (active?.id || list[0]?.id || null);
      setSelectedSessionId(defaultSessionId);
      if (defaultSessionId) {
        const shouldPoll = !!active && active.id === defaultSessionId;
        setAutoRefresh(shouldPoll);
        fetchSignIns(defaultSessionId);
      } else {
        setAutoRefresh(false);
        setSignIns([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // --- Session Control ---

  const handleStartSession = async () => {
    if (!currentCourse) return;
    if (!currentRoom) {
      if (!window.confirm("未找到关联教室布局，是否仍要开始签到？（将无法显示座位图）")) return;
    }

    const now = new Date();
    const dayOfWeek = now.getDay();
    const nowDayIndex = (dayOfWeek + 6) % 7;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startSlot = semesterTimeSlots[currentCourse.startSlotIndex];
    const endSlot = semesterTimeSlots[currentCourse.endSlotIndex];
    if (startSlot && endSlot) {
      const startMinutes = parseTimeToMinutes(startSlot.start);
      const endMinutes = parseTimeToMinutes(endSlot.end);
      const inDay = nowDayIndex === currentCourse.dayIndex;
      const inWindow = inDay && nowMinutes >= (startMinutes - 30) && nowMinutes <= endMinutes;
      if (!inWindow) {
        const tip = `当前时间不在该课程时间段(含提前30分钟)内。\n\n课程: ${DAYS[currentCourse.dayIndex]} ${startSlot.start}-${endSlot.end}\n现在: ${DAYS[nowDayIndex]} ${now.toTimeString().slice(0,5)}\n\n仍要开始签到吗？`;
        if (!window.confirm(tip)) return;
      }
    }

    try {
      const tryStart = async () => {
        return apiFetch('/sessions', {
          method: 'POST',
          body: JSON.stringify({
            course_id: currentCourse.id,
            room_id: currentRoom ? currentRoom.room_id : currentCourse.location
          })
        });
      };

      let res;
      try {
        res = await tryStart();
      } catch (e) {
        const msg = String(e.message || '');
        if (e?.status === 409 || msg.includes('该教室已有其他课程正在签到')) {
          const conflict = e?.data?.data?.conflict || e?.data?.conflict;
          const conflictCourseName = conflict?.course?.name || `课程#${conflict?.session?.course_id || ''}`;
          const conflictRoom = conflict?.session?.room_id || (currentRoom ? currentRoom.room_id : currentCourse.location);
          const conflictSessionId = conflict?.session?.id;
          const confirmText = `教室 ${conflictRoom} 正在被「${conflictCourseName}」签到占用。\n\n是否结束该签到并开始新的签到？`;
          if (!conflictSessionId) {
            throw e;
          }
          if (!window.confirm(confirmText)) return;
          await apiFetch(`/sessions/${conflictSessionId}/end`, { method: 'POST' });
          res = await tryStart();
        } else {
          throw e;
        }
      }

      if (res?.session) {
        setActiveSession(res.session);
        setSelectedSessionId(res.session.id);
        setAutoRefresh(true);
        fetchSignIns(res.session.id);
        loadSessions(currentCourse.id);
        alert('签到已开始');
      }
    } catch (e) {
      alert(e.message);
    }
  };

  const handleEndSession = async () => {
    if (!activeSession) return;
    if (!window.confirm("确定要结束当前签到吗？")) return;

    try {
      await apiFetch(`/sessions/${activeSession.id}/end`, { method: 'POST' });
      const endedId = activeSession.id;
      setActiveSession(null);
      setAutoRefresh(false);
      setSelectedSessionId(endedId);
      fetchSignIns(endedId);
      fetchAlerts(endedId);
      if (currentCourse?.id) loadSessions(currentCourse.id);
      alert('签到已结束');
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRemindAbsence = async () => {
    if (!selectedSessionId) {
      alert('请先选择一个签到场次');
      return;
    }
    if (!currentCourse) {
      alert('课程信息不存在');
      return;
    }

    try {
      // 调用API生成缺勤提醒
      await apiFetch(`/sessions/${selectedSessionId}/remind-absence`, { method: 'POST' });
      alert('缺勤提醒已发送');
    } catch (e) {
      alert('发送提醒失败: ' + e.message);
    }
  };

  // --- Polling ---

  const fetchSignIns = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`/sessions/${sessionId}/signins`);
      if (res?.sign_ins) {
        setSignIns(res.sign_ins);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchLeaves = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`/sessions/${sessionId}/leaves`);
      const list = Array.isArray(res?.leaves) ? res.leaves : [];
      const next = {};
      for (const r of list) {
        const sid = String(r?.student_id || '').trim();
        if (!sid) continue;
        next[sid] = String(r?.reason || '').trim();
      }
      setLeavesByStudentId(next);
    } catch {
      setLeavesByStudentId({});
    }
  }, []);

  const fetchAlerts = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`/sessions/${sessionId}/alerts`);
      const list = Array.isArray(res?.alerts) ? res.alerts : [];
      setAlerts(list);
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setLeavesByStudentId({});
      setAlerts([]);
      return;
    }
    fetchLeaves(selectedSessionId);
    fetchAlerts(selectedSessionId);
  }, [selectedSessionId, fetchLeaves, fetchAlerts]);

  useEffect(() => {
    let interval;
    if (autoRefresh && activeSession && selectedSessionId && activeSession.id === selectedSessionId) {
      fetchSignIns(selectedSessionId); // Immediate fetch
      fetchLeaves(selectedSessionId);
      fetchAlerts(selectedSessionId);
      interval = setInterval(() => {
        fetchSignIns(selectedSessionId);
        fetchLeaves(selectedSessionId);
        fetchAlerts(selectedSessionId);
      }, 3000); // Poll every 3 seconds
    }
    return () => clearInterval(interval);
  }, [autoRefresh, activeSession, selectedSessionId, fetchSignIns, fetchLeaves, fetchAlerts]);


  // --- Canvas Rendering ---

  useEffect(() => {
    renderCanvas();
  }, [currentRoom, signIns, selectedSeat, transform, currentCourse, fixedSeatBySeat, leavesByStudentId]); // Add transform dependency

  const renderCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !currentRoom || !currentRoom.seat_pos) return;

    const seats = Array.isArray(currentRoom.seat_pos) 
      ? currentRoom.seat_pos 
      : (currentRoom.seat_pos.seats || []);

    if (!Array.isArray(seats)) return;

    const ctx = canvas.getContext('2d');

    // Adjust canvas size
    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save context state
    ctx.save();
    
    // Apply transform
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    // Draw Seats
    const SEAT_SIZE = 60;
    const GAP = 10;
    const TOTAL_SIZE = SEAT_SIZE + GAP;

    seats.forEach(seat => {
      // 兼容处理：检查 x/y 是像素坐标还是网格坐标
      let x = seat.x;
      let y = seat.y;
      
      if (x < 100 && y < 100) {
         x = seat.x * TOTAL_SIZE + 100;
         y = seat.y * TOTAL_SIZE + 100;
      }

      const width = 40;
      const height = 40;
      const radius = 4;

      // Label compat: seatNumber vs label
      const label = seat.seatNumber || seat.label || '?';

      // Determine Color
      let fillColor = '#e0e0e0'; // Default: Empty (Gray)
      let textColor = '#333';
      
      // Check status (compare with label)
      const signInRecord = signIns.find(s => s.seat_label === label);
      if (signInRecord) {
        const st = String(signInRecord.status || '').trim();
        const q = String(signInRecord.sign_quality || '').trim();
        if (st === 'late') {
          fillColor = '#ef5350';
          textColor = '#fff';
        } else if (q === 'warn') {
          fillColor = '#ffeb3b';
          textColor = '#333';
        } else {
          fillColor = '#4caf50'; // Signed In (Green)
          textColor = '#fff';
        }
      }
      const assigned = fixedSeatBySeat?.[label] || null;
      const leaveStudentId = assigned?.studentId ? String(assigned.studentId).trim() : '';
      const leaveReason = leaveStudentId ? leavesByStudentId?.[leaveStudentId] : '';
      const isOnLeave = !signInRecord && !!currentCourse?.fixed_seat_enabled && !!leaveStudentId && Object.prototype.hasOwnProperty.call(leavesByStudentId || {}, leaveStudentId);
      if (isOnLeave) {
        fillColor = '#ffb74d';
        textColor = '#333';
      }

      // Check selection
      if (selectedSeat === label) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#2196F3'; // Blue border for selection
      } else {
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#999';
      }

      // Draw Rect
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.stroke();

      // Draw Label
      ctx.fillStyle = textColor;
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + width / 2, y + height / 2);

      if (isOnLeave) {
        ctx.fillStyle = '#d84315';
        ctx.font = '10px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('假', x + 3, y + 2);
      }
    });

    // Restore context state
    ctx.restore();
  };

  // --- Mouse Event Handlers for Pan & Zoom ---

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - lastMousePos.x;
    const deltaY = e.clientY - lastMousePos.y;
    
    setTransform(prev => ({
      ...prev,
      x: prev.x + deltaX,
      y: prev.y + deltaY
    }));
    
    setLastMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e) => {
    // e.preventDefault(); // Note: React synthetic events might not support preventDefault for wheel in some cases, but usually ok inside element
    
    const scaleFactor = 1.1;
    const newScale = e.deltaY > 0 ? transform.scale / scaleFactor : transform.scale * scaleFactor;
    
    // Limit scale
    const clampedScale = Math.min(Math.max(0.1, newScale), 5);
    
    // Calculate mouse position relative to canvas
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom towards mouse pointer logic
    // newX = mouseX - (mouseX - oldX) * (newScale / oldScale)
    const newX = mouseX - (mouseX - transform.x) * (clampedScale / transform.scale);
    const newY = mouseY - (mouseY - transform.y) * (clampedScale / transform.scale);

    setTransform({
      x: newX,
      y: newY,
      scale: clampedScale
    });
  };

  const handleCanvasClick = (e) => {
    // If dragging happened (moved significantly), ignore click
    // For simplicity, we assume click is fast and without much movement. 
    // But since we separate MouseDown/Move, a pure click won't trigger Move logic much.
    // However, we should be careful. 
    // Let's rely on standard logic: Transform coordinate back to world space.

    if (!currentRoom || !currentRoom.seat_pos) return;

    const seats = Array.isArray(currentRoom.seat_pos) 
      ? currentRoom.seat_pos 
      : (currentRoom.seat_pos.seats || []);

    const rect = canvasRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert screen coordinates to world coordinates
    const worldX = (screenX - transform.x) / transform.scale;
    const worldY = (screenY - transform.y) / transform.scale;

    const SEAT_SIZE = 60;
    const GAP = 10;
    const TOTAL_SIZE = SEAT_SIZE + GAP;

    // Find clicked seat
    const clickedSeat = seats.find(seat => {
      let x = seat.x;
      let y = seat.y;
      
      if (x < 100 && y < 100) {
         x = seat.x * TOTAL_SIZE + 100;
         y = seat.y * TOTAL_SIZE + 100;
      }
      
      // 这里的 40 是绘制时的 width/height
      return worldX >= x && worldX <= x + 40 && worldY >= y && worldY <= y + 40;
    });

    if (clickedSeat) {
      const label = clickedSeat.seatNumber || clickedSeat.label || '?';
      setSelectedSeat(label);
    } else {
      setSelectedSeat(null);
    }
  };

  const resetTransform = () => {
    setTransform({ x: 0, y: 0, scale: 1 });
  };

  // --- Render Helpers ---

  const warnReasonText = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const map = {
      auth_invalid: '微信登录已失效/未登录',
      wifi_missing: '未连接指定WiFi',
      wifi_not_whitelisted: 'WiFi不在白名单',
      ip_not_whitelisted: '出口IP不在允许范围内',
      gps_missing: '未获取定位',
      gps_out_of_range: '定位不在允许范围内',
    };
    const parts = s
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
    const out = [];
    for (const p of parts) {
      out.push(map[p] || p);
    }
    return out.join('、');
  };

  function getSelectedSeatInfo() {
    if (!selectedSeat) return null;
    const record = signIns.find(s => s.seat_label === selectedSeat);
    const assigned = fixedSeatBySeat?.[selectedSeat] || null;
    const leaveStudentId = assigned?.studentId ? String(assigned.studentId).trim() : '';
    const onLeave = !record && !!currentCourse?.fixed_seat_enabled && !!leaveStudentId && Object.prototype.hasOwnProperty.call(leavesByStudentId || {}, leaveStudentId);
    const leaveReason = leaveStudentId ? leavesByStudentId?.[leaveStudentId] : '';
    
    // Fallback to searching course members if assigned name is missing
    let studentName = assigned?.studentName || '-';
    if (studentName === '-' && assigned?.studentId) {
      const members = getCourseMembers();
      const member = members.find(m => m.studentId === assigned.studentId);
      if (member && member.name) {
        studentName = member.name;
      }
    }

    let statusText = '未签到';
    if (record) {
      if (record.status === 'late') {
        statusText = '迟到';
      } else if (record.status === 'success') {
        statusText = '已签到';
      } else {
        statusText = '签到失败';
      }
    } else if (onLeave) {
      statusText = '请假';
    }
    
    return {
      label: selectedSeat,
      status: statusText,
      signQuality: record ? String(record.sign_quality || 'ok') : '',
      warnReasons: record ? warnReasonText(record.warn_reasons) : '',
      studentName: record ? record.student_name : studentName,
      studentId: record ? record.student_id : (assigned?.studentId || '-'),
      time: record ? new Date(record.time).toLocaleTimeString() : '-',
      leaveReason: onLeave ? (String(leaveReason || '').trim() || '（未填写）') : ''
    };
  }

  const seatInfo = getSelectedSeatInfo();

  const selectedSession = sessions.find(s => s.id === selectedSessionId) || (activeSession && activeSession.id === selectedSessionId ? activeSession : null);

  const formatSessionLabel = (s) => {
    if (!s) return '';
    const start = s.start_time ? new Date(s.start_time).toLocaleString() : '-';
    const end = s.end_time && new Date(s.end_time).getTime() > 0 ? new Date(s.end_time).toLocaleString() : '';
    const status = s.is_active ? '进行中' : (end ? '已结束' : '');
    const count = typeof s.sign_in_count === 'number' ? s.sign_in_count : null;
    const countText = count != null ? `${count}人` : '';
    return `#${s.id} ${status} ${start}${end ? ` ~ ${end}` : ''} ${countText}`.trim();
  };

  const handleSessionSelect = (e) => {
    const id = Number(e.target.value) || null;
    setSelectedSeat(null);
    setSelectedSessionId(id);
    if (!id) {
      setAutoRefresh(false);
      setSignIns([]);
      setLeavesByStudentId({});
      return;
    }
    const shouldPoll = !!activeSession && activeSession.id === id;
    setAutoRefresh(shouldPoll);
    fetchSignIns(id);
    fetchLeaves(id);
    fetchAlerts(id);
  };

  function getCourseMembers() {
    if (!currentCourse) return [];
    const mode = String(currentCourse.memberMode || '').trim();
    if (mode === 'independent') {
      const arr = Array.isArray(currentCourse.members) ? currentCourse.members : [];
      return arr.map(m => ({
        studentId: String(m?.studentId || m?.student_id || '').trim(),
        name: String(m?.name || '').trim(),
      })).filter(m => m.studentId);
    }
    if (mode === 'class') {
      const rid = String(currentCourse.classRosterId || '').trim();
      const roster = rosters.find(r => String(r.id) === rid);
      const arr = Array.isArray(roster?.members) ? roster.members : [];
      return arr.map(m => ({
        studentId: String(m?.studentId || m?.student_id || '').trim(),
        name: String(m?.name || '').trim(),
      })).filter(m => m.studentId);
    }
    return [];
  }

  const openLeaveEditor = () => {
    if (!selectedSessionId) {
      alert('请先选择一个签到场次（或开始签到）后再登记请假');
      return;
    }
    const members = getCourseMembers();
    if (!members || members.length === 0) {
      alert('当前课程为开放签到模式或未配置名单，无法登记请假');
      return;
    }
    Promise.resolve()
      .then(async () => {
        try {
          const res = await apiFetch(`/sessions/${selectedSessionId}/leaves`);
          const list = Array.isArray(res?.leaves) ? res.leaves : [];
          const next = {};
          for (const r of list) {
            const sid = String(r?.student_id || '').trim();
            if (!sid) continue;
            next[sid] = String(r?.reason || '').trim();
          }
          setLeavesByStudentId(next);
          return next;
        } catch {
          setLeavesByStudentId({});
          return {};
        }
      })
      .then((leaveMap) => {
        const signedSet = new Set((signIns || []).map(s => String(s?.student_id || '').trim()).filter(Boolean));
        const rows = members
          .slice()
          .sort((a, b) => a.studentId.localeCompare(b.studentId, 'zh-CN'))
          .map(m => ({
            studentId: m.studentId,
            name: m.name,
            signedIn: signedSet.has(m.studentId),
            onLeave: !signedSet.has(m.studentId) && Object.prototype.hasOwnProperty.call(leaveMap || {}, m.studentId),
            reason: !signedSet.has(m.studentId) ? ((leaveMap || {})[m.studentId] || '') : '',
          }));
        setLeaveDraftRows(rows);
        setIsLeaveModalOpen(true);
      });
  };

  const saveLeaves = async () => {
    if (!selectedSessionId) {
      alert('请先选择一个签到场次（或开始签到）后再保存请假信息');
      return;
    }
    const leaves = (Array.isArray(leaveDraftRows) ? leaveDraftRows : [])
      .filter(r => r?.onLeave && !r?.signedIn && String(r?.studentId || '').trim())
      .map(r => ({ student_id: String(r.studentId).trim(), reason: String(r.reason || '').trim() }));
    await apiFetch(`/sessions/${selectedSessionId}/leaves`, {
      method: 'PUT',
      body: JSON.stringify({ leaves }),
    });
    await fetchLeaves(selectedSessionId);
    setIsLeaveModalOpen(false);
    renderCanvas();
  };

  const openAlertModal = () => {
    setIsAlertModalOpen(true);
  };

  const currentMonthRange = () => {
    const now = new Date();
    const from = dateToYMD(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = dateToYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    return { from, to };
  };

  const loadHeatmap = async (opts) => {
    if (!currentCourse?.id) return;
    const p = new URLSearchParams();
    p.set('course_id', String(currentCourse.id));
    const from = String(opts?.from ?? heatmapFrom ?? '').trim();
    const to = String(opts?.to ?? heatmapTo ?? '').trim();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const res = await apiFetch(`/ai/seat-heatmap?${p.toString()}`);
    const data = res?.seat_pos !== undefined ? res : (res?.data || null);
    setHeatmapData(data);
  };

  const openHeatmapModal = () => {
    const { from: defFrom, to: defTo } = currentMonthRange();
    const from = String(heatmapFrom || defFrom || '').trim();
    const to = String(heatmapTo || defTo || '').trim();
    if (!heatmapFrom && from) setHeatmapFrom(from);
    if (!heatmapTo && to) setHeatmapTo(to);
    setIsHeatmapModalOpen(true);
    loadHeatmap({ from, to }).catch(e => alert(e.message));
  };

  useEffect(() => {
    if (!isHeatmapModalOpen) return;
    if (!heatmapCanvasRef.current) return;
    const data = heatmapData;
    if (!data) return;
    const rawSeats = Array.isArray(data.seat_pos) ? data.seat_pos : (Array.isArray(currentRoom?.seat_pos) ? currentRoom.seat_pos : []);
    const seats = Array.isArray(rawSeats) ? rawSeats : [];
    const canvas = heatmapCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.parentElement ? canvas.parentElement.clientWidth : 1000;
    const h = 520;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    const SEAT_SIZE = 40;
    const GAP = 10;
    const TOTAL_SIZE = SEAT_SIZE + GAP;

    const normalized = seats.map(seat => {
      let x = seat.x;
      let y = seat.y;
      if (x < 100 && y < 100) {
        x = seat.x * TOTAL_SIZE + 40;
        y = seat.y * TOTAL_SIZE + 40;
      }
      const label = seat.seatNumber || seat.label || '?';
      return { x, y, label };
    });

    const xs = normalized.map(s => s.x);
    const ys = normalized.map(s => s.y);
    const minX = xs.length ? Math.min(...xs) : 0;
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxX = xs.length ? Math.max(...xs) : 0;
    const maxY = ys.length ? Math.max(...ys) : 0;
    const pad = 30;
    const scaleX = (w - pad * 2) / Math.max(1, (maxX - minX + SEAT_SIZE));
    const scaleY = (h - pad * 2) / Math.max(1, (maxY - minY + SEAT_SIZE));
    const scale = Math.min(scaleX, scaleY, 2);

    const counts = data?.counts || {};
    const maxCount = Number(data?.max_count || 0) || 0;

    const colorFor = (v) => {
      if (!maxCount || v <= 0) return '#e0e0e0';
      const t = Math.min(1, v / maxCount);
      const r = Math.round(255 * t + 224 * (1 - t));
      const g = Math.round(87 * t + 224 * (1 - t));
      const b = Math.round(34 * t + 224 * (1 - t));
      return `rgb(${r},${g},${b})`;
    };

    for (const s of normalized) {
      const v = Number(counts?.[s.label] || 0) || 0;
      const x = pad + (s.x - minX) * scale;
      const y = pad + (s.y - minY) * scale;
      ctx.beginPath();
      ctx.roundRect(x, y, SEAT_SIZE * scale, SEAT_SIZE * scale, 4);
      ctx.fillStyle = colorFor(v);
      ctx.fill();
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = `${Math.max(10, 12 * scale)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.label, x + (SEAT_SIZE * scale) / 2, y + (SEAT_SIZE * scale) / 2);
    }
  }, [isHeatmapModalOpen, heatmapData, currentRoom]);

  return (
    <div className="sign-monitor-page">
      <div className="monitor-header">
        <div className="header-left">
          <h3>签到状态监控</h3>
          <select 
            className="course-select"
            value={currentCourse?.id || ''}
            onChange={(e) => {
              const id = Number(e.target.value || 0) || null;
              if (!id) return;
              const c = courses.find(c => c.id === id);
              if (!c) return;
              setAutoPickCourse(false);
              setAutoPickHint('已关闭自动跟随');
              handleCourseSelect(c);
            }}
          >
            <option value="">-- 选择课程 --</option>
            {courses.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({DAYS[c.dayIndex]} {semesterTimeSlots[c.startSlotIndex]?.start})
              </option>
            ))}
          </select>
          <label className="autopick-toggle">
            <input
              type="checkbox"
              checked={autoPickCourse}
              onChange={(e) => {
                const next = !!e.target.checked;
                setAutoPickCourse(next);
                setAutoPickHint(next ? '自动跟随已开启' : '自动跟随已关闭');
              }}
            />
            <span>跟随当前时间</span>
          </label>
          {autoPickHint ? <span className="autopick-hint">{autoPickHint}</span> : null}
          {currentCourse && (
            <span className="location-badge">
              📍 {currentCourse.location} {currentRoom ? '(已加载布局)' : '(无布局)'}
            </span>
          )}
        </div>
        <div className="header-right">
          {currentCourse && sessions.length > 0 && (
            <select className="session-select" value={selectedSessionId || ''} onChange={handleSessionSelect}>
              <option value="">-- 创建签到场次 --</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{formatSessionLabel(s)}</option>
              ))}
            </select>
          )}

          {selectedSessionId ? (
            activeSession && activeSession.id === selectedSessionId ? (
              <div className="session-status active">
                <span className="status-dot"></span>
                正在签到 ({signIns.length}人)
                <button className="btn-refresh" onClick={openAlertModal}>异常{alerts.length ? `(${alerts.length})` : ''}</button>
                <button className="btn-refresh" onClick={openHeatmapModal}>热力图</button>
                {currentCourse ? (
                  <button className="btn-refresh" onClick={openLeaveEditor}>登记请假</button>
                ) : null}
                <button className="btn-stop" onClick={handleEndSession}>结束签到</button>
              </div>
            ) : (
              <div className="session-status history">
                <span className="status-dot"></span>
                历史场次 ({signIns.length}人)
                <button className="btn-refresh" onClick={() => fetchSignIns(selectedSessionId)}>刷新</button>
                <button className="btn-refresh" onClick={openAlertModal}>异常{alerts.length ? `(${alerts.length})` : ''}</button>
                <button className="btn-refresh" onClick={openHeatmapModal}>热力图</button>
                {currentCourse ? (
                  <button className="btn-refresh" onClick={openLeaveEditor}>登记请假</button>
                ) : null}
                <button className="btn-refresh" onClick={handleRemindAbsence}>缺勤提醒 </button>
              </div>
            )
          ) : (
            <div className="session-status idle">
              <button className="btn-start" onClick={handleStartSession} disabled={!currentCourse}>开始签到</button>
            </div>
          )}
        </div>
      </div>

      <div className="monitor-content" ref={containerRef}>
        {currentRoom ? (
          <>
            <canvas 
              ref={canvasRef} 
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
              onClick={handleCanvasClick}
              style={{ display: 'block', cursor: isDragging ? 'grabbing' : 'grab' }}
            />
            <div className="canvas-controls">
               <button onClick={resetTransform} title="重置视图">↺</button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            {currentCourse ? '该课程未关联有效的教室布局或教室不存在' : '请先选择一个课程'}
          </div>
        )}
      </div>

      <div className="monitor-footer">
        {selectedSeat ? (
          <div className="seat-detail-panel">
            <div className="detail-item">
              <label>座位号</label>
              <strong>{seatInfo.label}</strong>
            </div>
            <div className="detail-item">
              <label>状态</label>
              <span className={`status-tag ${seatInfo.status === '已签到' ? (seatInfo.signQuality === 'warn' ? 'warn' : 'success') : seatInfo.status === '迟到' ? 'late' : 'pending'}`}>
                {seatInfo.status}
              </span>
            </div>
            {seatInfo.status === '已签到' && seatInfo.signQuality === 'warn' ? (
              <div className="detail-item">
                <label>异常原因</label>
                <span>{seatInfo.warnReasons || '-'}</span>
              </div>
            ) : null}
            <div className="detail-item">
              <label>学生姓名</label>
              <span>{seatInfo.studentName}</span>
            </div>
            <div className="detail-item">
              <label>学号</label>
              <span>{seatInfo.studentId}</span>
            </div>
            <div className="detail-item">
              <label>签到时间</label>
              <span>{seatInfo.time}</span>
            </div>
            {seatInfo.leaveReason ? (
              <div className="detail-item">
                <label>请假原因</label>
                <span>{seatInfo.leaveReason}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="footer-hint">点击座位查看详情</div>
        )}
      </div>

      {isLeaveModalOpen ? (
        <div className="sm-modal-overlay">
          <div className="sm-modal-content">
            <div className="sm-modal-header">
              <h3>登记请假</h3>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn-refresh" onClick={() => setIsLeaveModalOpen(false)}>取消</button>
                <button className="btn-start" onClick={() => saveLeaves().catch(e => alert(e.message))}>保存</button>
              </div>
            </div>
            <div className="sm-modal-body">
              <div className="leave-table">
                <div className="leave-row leave-head">
                  <div>请假</div>
                  <div>姓名</div>
                  <div>学号</div>
                  <div>原因</div>
                </div>
                {leaveDraftRows.map((r, idx) => (
                  <div key={r.studentId} className="leave-row">
                    <div>
                      <input
                        type="checkbox"
                        checked={!!r.onLeave}
                        disabled={!!r.signedIn}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setLeaveDraftRows(prev => prev.map((x, i) => i === idx ? { ...x, onLeave: on } : x));
                        }}
                      />
                    </div>
                    <div>{r.name || '-'}</div>
                    <div>{r.studentId}</div>
                    <div>
                      <input
                        type="text"
                        value={r.reason || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLeaveDraftRows(prev => prev.map((x, i) => i === idx ? { ...x, reason: v } : x));
                        }}
                        disabled={!r.onLeave || !!r.signedIn}
                        placeholder={r.signedIn ? '已签到不可请假' : '选填'}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isAlertModalOpen ? (
        <div className="sm-modal-overlay">
          <div className="sm-modal-content" style={{ width: '1000px', maxWidth: '96vw' }}>
            <div className="sm-modal-header">
              <h3>异常预警</h3>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn-refresh" onClick={() => fetchAlerts(selectedSessionId)}>刷新</button>
                <button className="btn-start" onClick={() => setIsAlertModalOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="sm-modal-body">
              <div className="leave-table">
                <div className="leave-row leave-head" style={{ gridTemplateColumns: '140px 180px 120px 1fr 180px' }}>
                  <div>类型</div>
                  <div>学号</div>
                  <div>座位</div>
                  <div>说明</div>
                  <div>时间</div>
                </div>
                {alerts.map(a => (
                  <div key={a.id} className="leave-row" style={{ gridTemplateColumns: '140px 180px 120px 1fr 180px' }}>
                    <div>{a.kind}</div>
                    <div>{a.student_id}</div>
                    <div>{a.seat_label || '-'}</div>
                    <div>{a.message || '-'}</div>
                    <div>{a.created_at ? new Date(a.created_at).toLocaleString() : '-'}</div>
                  </div>
                ))}
                {!alerts.length ? (
                  <div style={{ padding: '16px', color: '#888' }}>暂无异常预警</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isHeatmapModalOpen ? (
        <div className="sm-modal-overlay">
          <div className="sm-modal-content" style={{ width: '1200px', maxWidth: '96vw' }}>
            <div className="sm-modal-header">
              <h3>座位热力图</h3>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input type="date" className={heatmapFrom ? '' : 'date-empty'} value={heatmapFrom} onChange={(e) => setHeatmapFrom(e.target.value)} />
                <input type="date" className={heatmapTo ? '' : 'date-empty'} value={heatmapTo} onChange={(e) => setHeatmapTo(e.target.value)} />
                <button className="btn-refresh" onClick={() => loadHeatmap({ from: heatmapFrom, to: heatmapTo }).catch(e => alert(e.message))}>查询</button>
                <button className="btn-start" onClick={() => setIsHeatmapModalOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="sm-modal-body">
              <div style={{ width: '100%', overflow: 'auto' }}>
                <canvas ref={heatmapCanvasRef} style={{ width: '100%', height: '520px', display: 'block' }} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SignMonitorPage;
