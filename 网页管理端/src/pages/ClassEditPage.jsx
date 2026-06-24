import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE_URL, getAuthToken } from '../api';
import { useDrag, useDrop } from 'react-dnd';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import proj4 from 'proj4';
import 'proj4leaflet';
import './ClassEditPage.css';

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DEFAULT_SLOTS = [
  { id: 1, start: '08:00', end: '08:45', label: '第1节' },
  { id: 2, start: '08:55', end: '09:40', label: '第2节' },
  { id: 3, start: '10:00', end: '10:45', label: '第3节' },
  { id: 4, start: '10:55', end: '11:40', label: '第4节' },
  { id: 5, start: '14:00', end: '14:45', label: '第5节' },
  { id: 6, start: '14:55', end: '15:40', label: '第6节' },
  { id: 7, start: '16:00', end: '16:45', label: '第7节' },
  { id: 8, start: '16:55', end: '17:40', label: '第8节' },
];

function ClassEditPage() {
  const navigate = useNavigate();
  const [timeSlots, setTimeSlots] = useState(DEFAULT_SLOTS);
  const [isTimeEditMode, setIsTimeEditMode] = useState(false);
  const [timeSlotsSavedAt, setTimeSlotsSavedAt] = useState(0);
  const [courses, setCourses] = useState([]);
  const [pendingCourseUpdates, setPendingCourseUpdates] = useState({});
  const [authUser, setAuthUser] = useState(null);
  
  // Drag State
  // mode: 'select' (create new), 'move' (move existing), 'resize' (resize existing)
  const [dragState, setDragState] = useState(null); 
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentCourse, setCurrentCourse] = useState(null);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [membersDraftRows, setMembersDraftRows] = useState([{ name: '', studentId: '' }]);
  const membersFileRef = useRef(null);
  const [bssidDraftRows, setBssidDraftRows] = useState([{ bssid: '' }]);
  const [ipDraftRows, setIpDraftRows] = useState([{ ip: '' }]);
  const [isGpsModalOpen, setIsGpsModalOpen] = useState(false);
  const [gpsDraft, setGpsDraft] = useState({ lat: 0, lng: 0, radius_m: 50 });
  const [gpsCenterNote, setGpsCenterNote] = useState('');
  const gpsMapElRef = useRef(null);
  const gpsMapRef = useRef(null);
  const gpsMarkerRef = useRef(null);
  const gpsCircleRef = useRef(null);
  const [isFixedSeatModalOpen, setIsFixedSeatModalOpen] = useState(false);
  const [fixedSeatSeats, setFixedSeatSeats] = useState([]);
  const [fixedSeatStudents, setFixedSeatStudents] = useState([]);
  const [fixedSeatMap, setFixedSeatMap] = useState({});
  const [fixedSeatPendingMap, setFixedSeatPendingMap] = useState(null);
  const [classRosters, setClassRosters] = useState([]);
  const [rooms, setRooms] = useState([]); // 新增：教室列表
  
  // Semester State
  const [semesters, setSemesters] = useState([]);
  const [currentSemesterId, setCurrentSemesterId] = useState(null);
  const [semesterWeeks, setSemesterWeeks] = useState(25); // 默认 25 周

  const [isSemesterModalOpen, setIsSemesterModalOpen] = useState(false);
  const [semesterModalMode, setSemesterModalMode] = useState('create'); // create | edit
  const [editingSemesterId, setEditingSemesterId] = useState(null);
  const [newSemesterName, setNewSemesterName] = useState('');
  const [newSemesterStart, setNewSemesterStart] = useState('');
  const [newSemesterEnd, setNewSemesterEnd] = useState('');
  const isOrgOwner = authUser?.role === 'org_owner';

  const prevIsTimeEditModeRef = useRef(false);

  const coerceMembersArray = (members) => {
    if (!Array.isArray(members) || members.length === 0) return [];
    const rows = members.map((m) => {
      if (typeof m === 'string') return { name: m, studentId: '' };
      if (m && typeof m === 'object') {
        return { name: String(m.name || '').trim(), studentId: String(m.studentId || '').trim() };
      }
      return { name: '', studentId: '' };
    });
    return rows
      .map(r => ({ name: String(r?.name || '').trim(), studentId: String(r?.studentId || '').trim() }))
      .filter(r => r.name || r.studentId);
  };

  const toMemberDraftRows = (members) => {
    const arr = coerceMembersArray(members);
    return arr.length ? arr : [{ name: '', studentId: '' }];
  };

  const normalizeMemberRows = (rows) => {
    const cleaned = (Array.isArray(rows) ? rows : [])
      .map(r => ({ name: String(r?.name || '').trim(), studentId: String(r?.studentId || '').trim() }))
      .filter(r => r.name || r.studentId);

    const seen = new Set();
    const out = [];
    for (const r of cleaned) {
      const key = r.studentId ? `id:${r.studentId}` : `name:${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  };

  const toBssidDraftRows = (value) => {
    const str = String(value || '');
    const parts = str
      .split(/[\n\r\t ,;|]+/g)
      .map(s => String(s || '').trim())
      .filter(Boolean);
    const unique = [];
    const seen = new Set();
    for (const p of parts) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ bssid: p });
    }
    return unique.length ? unique : [{ bssid: '' }];
  };

  const normalizeBssidRows = (rows) => {
    const cleaned = (Array.isArray(rows) ? rows : [])
      .map(r => String(r?.bssid || '').trim())
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const b of cleaned) {
      const key = b.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(b);
    }
    return out;
  };

  const toIpDraftRows = (str) => {
    const parts = String(str || '')
      .split(/[\n\r\t ,;|]+/g)
      .map(s => String(s || '').trim())
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const p of parts) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ip: p });
    }
    return out.length ? out : [{ ip: '' }];
  };

  const normalizeIpRows = (rows) => {
    const cleaned = (Array.isArray(rows) ? rows : [])
      .map(r => String(r?.ip || '').trim())
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const p of cleaned) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  };

  const fetchGeoCenter = async () => {
    const browserGeo = await new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      if (!window.isSecureContext) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const lat = Number(p?.coords?.latitude || 0);
          const lng = Number(p?.coords?.longitude || 0);
          if (!lat || !lng) return resolve(null);
          resolve({ lat, lng, note: '已使用浏览器定位' });
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    });
    if (browserGeo) return browserGeo;

    try {
      const ipGeo = await apiFetch('/geo/ip', { method: 'GET' });
      const lat = Number(ipGeo?.lat || 0);
      const lng = Number(ipGeo?.lng || 0);
      if (!lat || !lng) return null;
      const parts = [ipGeo?.country, ipGeo?.region, ipGeo?.city].filter(Boolean);
      const loc = parts.length ? `（${parts.join(' ') }）` : '';
      return { lat, lng, note: `已使用IP定位${loc}` };
    } catch {
      return null;
    }
  };

  const openGpsPicker = async () => {
    if (!currentCourse) return;
    setGpsCenterNote('');
    const enabled = !!currentCourse.gps_enabled;
    const radius_m = Number(currentCourse.gps_radius_m || 50);
    const lat = Number(currentCourse.gps_lat || 0);
    const lng = Number(currentCourse.gps_lng || 0);
    let next = { lat, lng, radius_m: radius_m > 0 ? radius_m : 50 };
    if (!enabled) {
      next = { lat: 0, lng: 0, radius_m: next.radius_m };
    }
    if (!next.lat || !next.lng) {
      const center = await fetchGeoCenter();
      if (center) {
        next = { ...next, lat: center.lat, lng: center.lng };
        setGpsCenterNote(center.note || '');
      } else {
        next = { ...next, lat: 39.9042, lng: 116.4074 };
        setGpsCenterNote('未能自动定位，已默认北京；可点击地图或拖动标记选择地点');
      }
    }
    setGpsDraft(next);
    setIsGpsModalOpen(true);
  };

  const applyGpsDraftToCourse = () => {
    if (!currentCourse) return;
    setCurrentCourse({
      ...currentCourse,
      gps_lat: Number(gpsDraft.lat || 0),
      gps_lng: Number(gpsDraft.lng || 0),
      gps_radius_m: Number(gpsDraft.radius_m || 0),
    });
    setIsGpsModalOpen(false);
  };

  useEffect(() => {
    if (!isGpsModalOpen) return;
    if (!gpsMapElRef.current) return;
    if (gpsMapRef.current) return;

    if (!L.CRS.Baidu) {
      L.CRS.Baidu = new L.Proj.CRS(
        'EPSG:900913',
        '+proj=merc +a=6378206 +b=6356584.314245179 +lat_ts=0.0 +lon_0=0.0 +x_0=0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs',
        {
          resolutions: (() => {
            const res = [];
            for (let i = 0; i < 19; i++) res[i] = Math.pow(2, (18 - i));
            return res;
          })(),
          origin: [0, 0],
          bounds: L.bounds([20037508.342789244, 0], [-20037508.342789244, 20037508.342789244]),
        }
      );
    }

    const icon = L.icon({
      iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).toString(),
      iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).toString(),
      shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).toString(),
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });

    const map = L.map(gpsMapElRef.current, { zoomControl: true, crs: L.CRS.Baidu }).setView([gpsDraft.lat, gpsDraft.lng], 17);
    gpsMapRef.current = map;
    const tileUrl = import.meta.env.VITE_GPS_TILE_URL || `${API_BASE_URL}/tiles/{z}/{x}/{y}.png`;
    const tms = String(import.meta.env.VITE_GPS_TILE_TMS || 'true') === 'true';
    const maxZoom = Number(import.meta.env.VITE_GPS_TILE_MAX_ZOOM || 18);
    L.tileLayer(tileUrl, {
      maxZoom,
      tms,
    }).addTo(map);

    const marker = L.marker([gpsDraft.lat, gpsDraft.lng], { draggable: true, icon }).addTo(map);
    gpsMarkerRef.current = marker;
    const circle = L.circle([gpsDraft.lat, gpsDraft.lng], { radius: Number(gpsDraft.radius_m || 50) }).addTo(map);
    gpsCircleRef.current = circle;

    const updateFromLatLng = (latlng) => {
      const lat = Number(latlng?.lat || 0);
      const lng = Number(latlng?.lng || 0);
      if (!lat || !lng) return;
      setGpsDraft(prev => ({ ...prev, lat, lng }));
    };

    map.on('click', (e) => {
      const latlng = e?.latlng;
      if (!latlng) return;
      marker.setLatLng(latlng);
      circle.setLatLng(latlng);
      updateFromLatLng(latlng);
    });

    marker.on('dragend', () => {
      const latlng = marker.getLatLng();
      circle.setLatLng(latlng);
      updateFromLatLng(latlng);
    });

    return () => {};
  }, [isGpsModalOpen]);

  useEffect(() => {
    if (!isGpsModalOpen) {
      if (gpsMapRef.current) {
        gpsMapRef.current.remove();
        gpsMapRef.current = null;
      }
      gpsMarkerRef.current = null;
      gpsCircleRef.current = null;
      return;
    }
    const marker = gpsMarkerRef.current;
    const circle = gpsCircleRef.current;
    const map = gpsMapRef.current;
    if (!marker || !circle || !map) return;
    marker.setLatLng([gpsDraft.lat, gpsDraft.lng]);
    circle.setLatLng([gpsDraft.lat, gpsDraft.lng]);
    circle.setRadius(Number(gpsDraft.radius_m || 0));
  }, [isGpsModalOpen, gpsDraft.lat, gpsDraft.lng, gpsDraft.radius_m]);
  
  useEffect(() => {
    try {
      const raw = localStorage.getItem('authUser');
      if (raw) setAuthUser(JSON.parse(raw));
    } catch {
      setAuthUser(null);
    }
    fetchSemestersAndRosters();
  }, []);

  useEffect(() => {
    if (currentSemesterId) {
      fetchCourses(currentSemesterId);
    } else {
      setCourses([]);
    }
  }, [currentSemesterId]);

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
    if (!raw) return DEFAULT_SLOTS;
    let arr = null;
    if (Array.isArray(raw)) arr = raw;
    if (!arr && typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed;
      } catch {}
    }
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_SLOTS;
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

  const fetchSemestersAndRosters = async () => {
    try {
      const [semestersData, rostersData, roomsData] = await Promise.all([
        apiFetch('/semesters'),
        apiFetch('/rosters'),
        apiFetch('/rooms')
      ]);
      
      if (rostersData?.rosters) setClassRosters(rostersData.rosters);
      if (roomsData?.rooms) setRooms(roomsData.rooms);

      if (semestersData?.semesters && semestersData.semesters.length > 0) {
        setSemesters(semestersData.semesters);
        // 默认选中最新的学期
        const latest = semestersData.semesters[0];
        setCurrentSemesterId(latest.id);
        calculateSemesterWeeks(latest);
        setTimeSlots(coerceTimeSlots(latest.time_slots));
        setTimeSlotsSavedAt(0);
      } else {
        // 如果没有学期，提示创建
        setSemesters([]);
        setCurrentSemesterId(null);
        setTimeSlots(DEFAULT_SLOTS);
        setTimeSlotsSavedAt(0);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const calculateSemesterWeeks = (semester) => {
    if (!semester || !semester.start_date || !semester.end_date) {
      setSemesterWeeks(25); // 默认值
      return;
    }
    const start = new Date(semester.start_date);
    const end = new Date(semester.end_date);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    const weeks = Math.ceil(diffDays / 7);
    setSemesterWeeks(weeks > 0 ? weeks : 25);
  };

  const handleSemesterChange = (id) => {
    setCurrentSemesterId(Number(id));
    const semester = semesters.find(s => s.id === Number(id));
    calculateSemesterWeeks(semester);
    setTimeSlots(coerceTimeSlots(semester?.time_slots));
    setIsTimeEditMode(false);
    setTimeSlotsSavedAt(0);
    setPendingCourseUpdates({});
  };

  const reloadSemesterTimeSlots = async () => {
    if (!currentSemesterId) return;
    try {
      const data = await apiFetch('/semesters');
      const list = Array.isArray(data?.semesters) ? data.semesters : [];
      setSemesters(list);
      const s = list.find(x => x.id === Number(currentSemesterId)) || null;
      if (s) {
        calculateSemesterWeeks(s);
        setTimeSlots(coerceTimeSlots(s.time_slots));
      }
      setTimeSlotsSavedAt(0);
      setPendingCourseUpdates({});
      fetchCourses(currentSemesterId);
    } catch {
      setTimeSlotsSavedAt(0);
      setPendingCourseUpdates({});
    }
  };

  useEffect(() => {
    const prev = prevIsTimeEditModeRef.current;
    prevIsTimeEditModeRef.current = isTimeEditMode;
    if (prev && !isTimeEditMode) {
      reloadSemesterTimeSlots();
    }
  }, [isTimeEditMode]);

  const fetchCourses = async (semesterId) => {
    try {
      const data = await apiFetch(`/courses?semester_id=${semesterId}`);
      if (data?.courses) setCourses(data.courses);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchData = async () => {
     // 兼容旧代码调用，实际只需刷新课程
     if (currentSemesterId) fetchCourses(currentSemesterId);
  };

  const rosterNameById = useMemo(() => {
    const map = new Map();
    for (const r of classRosters) {
      if (r && r.id) map.set(r.id, r.name || r.id);
    }
    return map;
  }, [classRosters]);
  
  // Handlers for time slot editing
  const handleSlotChange = (index, field, value) => {
    const newSlots = [...timeSlots];
    newSlots[index] = { ...newSlots[index], [field]: value };
    setTimeSlots(newSlots);
  };

  const addSlot = () => {
    const lastSlot = timeSlots[timeSlots.length - 1];
    const newId = (lastSlot?.id || 0) + 1;
    setTimeSlots([...timeSlots, { id: newId, start: '00:00', end: '00:00', label: `第${newId}节` }]);
  };

  const removeSlot = (index) => {
    const idx = Number(index);
    if (!Number.isFinite(idx) || idx < 0) return;
    const hasCourseInSlot = (courses || []).some(c => {
      const start = Number(c?.startSlotIndex);
      const end = Number(c?.endSlotIndex);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return start <= idx && idx <= end;
    });
    if (hasCourseInSlot) {
      alert('该时间段内存在课程安排，无法删除。请先删除/调整相关课程。');
      return;
    }
    const newSlots = [...timeSlots];
    newSlots.splice(index, 1);
    setTimeSlots(newSlots);

    const changes = [];
    const nextCourses = (courses || []).map(c => {
      const start = Number(c?.startSlotIndex);
      const end = Number(c?.endSlotIndex);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return c;
      if (start <= idx) return c;
      const updated = { ...c, startSlotIndex: start - 1, endSlotIndex: end - 1 };
      changes.push(updated);
      return updated;
    });
    if (changes.length > 0) {
      setCourses(nextCourses);
      setPendingCourseUpdates(prev => {
        const next = { ...(prev || {}) };
        for (const u of changes) {
          if (u && u.id != null) next[u.id] = u;
        }
        return next;
      });
    }
  };

  // --- Grid Interaction Logic ---

  const handleCellMouseDown = (e, dayIndex, slotIndex) => {
    if (isTimeEditMode) return;
    if (e.button !== 0) return; // Only left click

    // Check if clicking on empty cell (start selection)
    setDragState({
        mode: 'select',
        startDay: dayIndex,
        startSlot: slotIndex,
        endDay: dayIndex,
        endSlot: slotIndex
    });
  };

  const handleCourseMouseDown = (e, course, isResize = false) => {
    if (isTimeEditMode) return;
    e.stopPropagation(); // Prevent cell click
    if (e.button !== 0) return;

    if (isResize) {
        setDragState({
            mode: 'resize',
            courseId: course.id,
            originalEndSlot: course.endSlotIndex,
            currentEndSlot: course.endSlotIndex
        });
    } else {
        setDragState({
            mode: 'pendingMove',
            courseId: course.id,
            startDay: course.dayIndex,
            startSlot: course.startSlotIndex,
            span: course.endSlotIndex - course.startSlotIndex,
            startX: e.clientX,
            startY: e.clientY
        });
    }
  };

  useEffect(() => {
    if (dragState?.mode !== 'pendingMove') return;

    const onMouseMove = (e) => {
      setDragState(prev => {
        if (prev?.mode !== 'pendingMove') return prev;
        const dx = Math.abs(e.clientX - prev.startX);
        const dy = Math.abs(e.clientY - prev.startY);
        if (dx + dy < 4) return prev;

        return {
          mode: 'move',
          courseId: prev.courseId,
          startDay: prev.startDay,
          startSlot: prev.startSlot,
          offsetSlot: 0,
          currentDay: prev.startDay,
          currentStartSlot: prev.startSlot,
          span: prev.span
        };
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [dragState]);

  const handleMouseEnter = (dayIndex, slotIndex) => {
    if (!dragState) return;

    if (dragState.mode === 'select') {
        if (dayIndex !== dragState.startDay) return; // Restrict to same day
        if (dragState.endSlot === slotIndex) return; // Optimization
        setDragState(prev => ({ ...prev, endSlot: slotIndex }));
    } else if (dragState.mode === 'move') {
        if (dragState.currentDay === dayIndex && dragState.currentStartSlot === slotIndex) return; // Optimization
        setDragState(prev => ({
            ...prev,
            currentDay: dayIndex,
            currentStartSlot: slotIndex
        }));
    } else if (dragState.mode === 'resize') {
        // Resize only affects end slot. Restrict to same day
        const course = courses.find(c => c.id === dragState.courseId);
        if (dayIndex !== course.dayIndex) return;
        if (slotIndex < course.startSlotIndex) return; // Cannot resize above start
        if (dragState.currentEndSlot === slotIndex) return; // Optimization
        
        setDragState(prev => ({
            ...prev,
            currentEndSlot: slotIndex
        }));
    }
  };

  const handleMouseUp = () => {
    if (!dragState) return;

    if (dragState.mode === 'select') {
        // Open create modal
        const start = Math.min(dragState.startSlot, dragState.endSlot);
        const end = Math.max(dragState.startSlot, dragState.endSlot);
        openCreateModal({
            dayIndex: dragState.startDay,
            startSlotIndex: start,
            endSlotIndex: end
        });
    } else if (dragState.mode === 'move') {
        // Commit move
        const newEndSlot = dragState.currentStartSlot + dragState.span;
        if (newEndSlot < timeSlots.length) {
            const course = courses.find(c => c.id === dragState.courseId);
            if (course) {
                const updated = { 
                    ...course, 
                    dayIndex: dragState.currentDay, 
                    startSlotIndex: dragState.currentStartSlot, 
                    endSlotIndex: newEndSlot 
                };
                
                // Optimistic update
                setCourses(prev => prev.map(c => 
                    c.id === dragState.courseId ? updated : c
                ));

                // API Update
                apiFetch(`/courses/${course.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(updated)
                }).catch(e => {
                    console.error(e);
                    fetchData(); // Revert on error
                });
            }
        }
    } else if (dragState.mode === 'resize') {
        // Commit resize
        const course = courses.find(c => c.id === dragState.courseId);
        if (course) {
            const updated = { ...course, endSlotIndex: dragState.currentEndSlot };
            
            // Optimistic update
            setCourses(prev => prev.map(c => 
                c.id === dragState.courseId ? updated : c
            ));

            // API Update
            apiFetch(`/courses/${course.id}`, {
                method: 'PUT',
                body: JSON.stringify(updated)
            }).catch(e => {
                console.error(e);
                fetchData(); // Revert on error
            });
        }
    }

    setDragState(null);
  };

  // --- Helpers ---

  const handleSaveSemester = async () => {
    if (!newSemesterName.trim()) {
      alert('请输入学期名称');
      return;
    }
    
    // 简单的校验逻辑
    if (newSemesterStart && newSemesterEnd) {
      if (newSemesterEnd < newSemesterStart) {
        alert('结束日期不能早于开始日期');
        return;
      }
    }

    try {
      let res;
      if (semesterModalMode === 'edit' && editingSemesterId) {
        res = await apiFetch(`/semesters/${editingSemesterId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: newSemesterName,
            start_date: newSemesterStart,
            end_date: newSemesterEnd,
          }),
        });
      } else {
        res = await apiFetch('/semesters', {
          method: 'POST',
          body: JSON.stringify({ 
            name: newSemesterName,
            start_date: newSemesterStart,
            end_date: newSemesterEnd
          })
        });
      }
      setNewSemesterName('');
      setNewSemesterStart('');
      setNewSemesterEnd('');
      setSemesterModalMode('create');
      setEditingSemesterId(null);
      setIsSemesterModalOpen(false);
      
      // Refresh list and select new
      const data = await apiFetch('/semesters');
      if (data?.semesters) {
        setSemesters(data.semesters);
        const selectId = (semesterModalMode === 'edit' && editingSemesterId) ? editingSemesterId : res?.id;
        const picked = data.semesters.find(s => s.id === selectId) || data.semesters[0] || null;
        if (picked) {
          setCurrentSemesterId(picked.id);
          calculateSemesterWeeks(picked);
          setTimeSlots(coerceTimeSlots(picked.time_slots));
        }
      }
    } catch (e) {
      alert(e.message);
    }
  };

  const openCreateSemester = () => {
    setSemesterModalMode('create');
    setEditingSemesterId(null);
    setNewSemesterName('');
    setNewSemesterStart('');
    setNewSemesterEnd('');
    setIsSemesterModalOpen(true);
  };

  const openEditSemester = () => {
    if (!currentSemesterId) return;
    const s = semesters.find(x => x.id === Number(currentSemesterId));
    if (!s) return;
    setSemesterModalMode('edit');
    setEditingSemesterId(s.id);
    setNewSemesterName(String(s.name || ''));
    setNewSemesterStart(dateToYMD(s.start_date));
    setNewSemesterEnd(dateToYMD(s.end_date));
    setIsSemesterModalOpen(true);
  };

  const saveTimeSlotsToSemester = async () => {
    if (!currentSemesterId) return;
    const s = semesters.find(x => x.id === Number(currentSemesterId));
    if (!s || !String(s.name || '').trim()) {
      alert('未找到当前学期');
      return;
    }
    try {
      await apiFetch(`/semesters/${currentSemesterId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: s.name,
          time_slots: timeSlots,
        }),
      });

      const updates = pendingCourseUpdates || {};
      const ids = Object.keys(updates);
      if (ids.length > 0) {
        await Promise.all(ids.map(id => {
          const updated = updates[id];
          return apiFetch(`/courses/${updated.id}`, {
            method: 'PUT',
            body: JSON.stringify(updated),
          });
        }));
        setPendingCourseUpdates({});
      }

      setTimeSlotsSavedAt(Date.now());
      const data = await apiFetch('/semesters');
      if (data?.semesters) setSemesters(data.semesters);
      alert(ids.length > 0 ? '已保存当前学期时间段与课程表调整' : '已保存当前学期时间段');
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDeleteSemester = async () => {
    if (!currentSemesterId) return;
    if (!window.confirm('确定删除当前学期吗？该学期下的所有课程也将被删除！')) return;
    
    try {
      await apiFetch(`/semesters/${currentSemesterId}`, { method: 'DELETE' });
      
      // Refresh
      const data = await apiFetch('/semesters');
      if (data?.semesters && data.semesters.length > 0) {
        setSemesters(data.semesters);
        setCurrentSemesterId(data.semesters[0].id);
        calculateSemesterWeeks(data.semesters[0]);
        setTimeSlots(coerceTimeSlots(data.semesters[0].time_slots));
      } else {
        setSemesters([]);
        setCurrentSemesterId(null);
        setCourses([]);
        setTimeSlots(DEFAULT_SLOTS);
      }
    } catch (e) {
      alert(e.message);
    }
  };

  const openCreateModal = (initialData) => {
      if (!currentSemesterId) {
        alert('请先创建或选择一个学期');
        return;
      }
      setCurrentCourse({
          id: null,
          semester_id: currentSemesterId, // 关联当前学期
          name: '',
          location: '',
          dayIndex: initialData.dayIndex,
          startSlotIndex: initialData.startSlotIndex,
          endSlotIndex: initialData.endSlotIndex,
          color: '#3498db',
          memberMode: 'all',
          members: [],
          weeks: [], // 新增
          bssid_enabled: false,
          bssid_list: '',
          gps_enabled: false,
          gps_lat: 0,
          gps_lng: 0,
          gps_radius_m: 0,
          ip_enabled: false,
          ip_list: '',
          classRosterId: '',
          fixed_seat_enabled: false
      });
      setBssidDraftRows([{ bssid: '' }]);
      setIpDraftRows([{ ip: '' }]);
      setFixedSeatPendingMap(null);
      setIsModalOpen(true);
  };

  const parseSeatPosToSeats = (seatPos) => {
    let v = seatPos;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { v = null; }
    }
    if (v && !Array.isArray(v) && Array.isArray(v.seats)) {
      v = v.seats;
    }
    if (!Array.isArray(v)) return [];
    return v
      .map(s => ({
        seatNumber: String(s?.seatNumber || s?.seat_label || s?.label || '').trim(),
        x: Number(s?.x || 0),
        y: Number(s?.y || 0),
      }))
      .filter(s => s.seatNumber && Number.isFinite(s.x) && Number.isFinite(s.y));
  };

  const sortSeatNumber = (a, b) => {
    const pa = String(a || '').toUpperCase().match(/^([A-Z]+)(\d+)$/);
    const pb = String(b || '').toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!pa || !pb) return String(a || '').localeCompare(String(b || ''), 'zh-CN');
    if (pa[1] !== pb[1]) return pa[1].localeCompare(pb[1]);
    return Number(pa[2]) - Number(pb[2]);
  };

  const getFixedSeatStudents = (course) => {
    if (!course) return [];
    if (course.memberMode === 'independent') {
      return coerceMembersArray(course.members)
        .map(r => ({ studentId: String(r.studentId || '').trim(), name: String(r.name || '').trim() }))
        .filter(r => r.studentId);
    }
    if (course.memberMode === 'class') {
      const rid = String(course.classRosterId || '').trim();
      const roster = classRosters.find(r => String(r.id) === rid);
      return coerceMembersArray(roster?.members)
        .map(r => ({ studentId: String(r.studentId || '').trim(), name: String(r.name || '').trim() }))
        .filter(r => r.studentId);
    }
    return [];
  };

  const autoAssignFixedSeat = (students, seats, currentMap) => {
    const next = { ...(currentMap || {}) };
    const usedSeats = new Set(Object.values(next).filter(Boolean));
    const orderedSeats = [...(seats || [])].sort((a, b) => sortSeatNumber(a.seatNumber, b.seatNumber));
    const orderedStudents = [...(students || [])].sort((a, b) => a.studentId.localeCompare(b.studentId, 'zh-CN'));
    let seatIdx = 0;
    for (const s of orderedStudents) {
      if (next[s.studentId]) continue;
      while (seatIdx < orderedSeats.length && usedSeats.has(orderedSeats[seatIdx].seatNumber)) seatIdx++;
      if (seatIdx >= orderedSeats.length) break;
      const seatLabel = orderedSeats[seatIdx].seatNumber;
      next[s.studentId] = seatLabel;
      usedSeats.add(seatLabel);
      seatIdx++;
    }
    return next;
  };

  const openFixedSeatEditor = async (courseArg) => {
    const course = courseArg || currentCourse;
    if (!course) return false;
    if (String(course.memberMode || '') === 'all') {
      alert('开放模式不支持固定座位，请选择独立名单或引用班级');
      return false;
    }
    if (!course.location) {
      alert('请先选择教室，再开启固定座位');
      return false;
    }
    const students = getFixedSeatStudents(course);
    if (!students.length) {
      alert('名单中缺少学生学号，无法开启固定座位');
      return false;
    }
    let roomData;
    try {
      roomData = await apiFetch(`/roomseat?room_id=${encodeURIComponent(course.location)}`);
    } catch (e) {
      alert(e.message || '获取教室座位布局失败');
      return false;
    }
    const seats = parseSeatPosToSeats(roomData?.seat_pos);
    if (!seats.length) {
      alert('该教室未配置座位布局，无法开启固定座位');
      return false;
    }

    let baseMap = {};
    if (course.id) {
      try {
        const res = await apiFetch(`/courses/${course.id}/fixed-seats`);
        const arr = Array.isArray(res?.assignments) ? res.assignments : [];
        for (const a of arr) {
          const sid = String(a?.student_id || '').trim();
          const seat = String(a?.seat_label || '').trim();
          if (!sid || !seat) continue;
          baseMap[sid] = seat;
        }
      } catch {
        baseMap = {};
      }
    } else if (fixedSeatPendingMap) {
      baseMap = { ...fixedSeatPendingMap };
    }

    const nextMap = autoAssignFixedSeat(students, seats, baseMap);
    setFixedSeatSeats(seats);
    setFixedSeatStudents(students);
    setFixedSeatMap(nextMap);
    setIsFixedSeatModalOpen(true);
    return true;
  };

  const saveFixedSeatMapping = async () => {
    if (!currentCourse) return;
    const assignments = Object.entries(fixedSeatMap || {})
      .filter(([sid, seat]) => String(sid || '').trim() && String(seat || '').trim())
      .map(([student_id, seat_label]) => ({ student_id, seat_label }));

    if (currentCourse.id) {
      await apiFetch(`/courses/${currentCourse.id}/fixed-seats`, {
        method: 'PUT',
        body: JSON.stringify({ assignments }),
      });
      setIsFixedSeatModalOpen(false);
      return;
    }

    setFixedSeatPendingMap({ ...fixedSeatMap });
    setIsFixedSeatModalOpen(false);
  };

  const handleSaveCourse = async () => {
      // Generate weeks array for backend compatibility if needed
      const startWeek = parseInt(currentCourse.start_week || 1);
      const endWeek = parseInt(currentCourse.end_week || semesterWeeks);

      const normalizedBssidList = normalizeBssidRows(bssidDraftRows).join('\n');
      if (isOrgOwner && currentCourse.bssid_enabled && !normalizedBssidList) {
          alert('开启BSSID校验时必须填写BSSID列表');
          return;
      }

      const gpsEnabled = !!currentCourse.gps_enabled;
      const gpsLat = Number(currentCourse.gps_lat || 0);
      const gpsLng = Number(currentCourse.gps_lng || 0);
      const gpsRadiusM = Number(currentCourse.gps_radius_m || 0);
      if (gpsEnabled) {
          if (!gpsLat || !gpsLng || gpsRadiusM <= 0) {
              alert('开启GPS校验时必须设置地点与半径');
              return;
          }
      }

      const ipEnabled = !!currentCourse.ip_enabled;
      const normalizedIpList = normalizeIpRows(ipDraftRows).join('\n');
      if (ipEnabled && !normalizedIpList) {
          alert('开启出口IP校验时必须填写允许的IP段（CIDR）');
          return;
      }
      
      if (startWeek > endWeek) {
          alert('开始周不能大于结束周');
          return;
      }
      if (endWeek > semesterWeeks) {
          alert(`结束周不能超过本学期总周数 (${semesterWeeks}周)`);
          return;
      }

      const weeksArray = [];
      for (let i = startWeek; i <= endWeek; i++) {
          weeksArray.push(i);
      }

      const courseData = {
          ...currentCourse,
          semester_id: currentSemesterId,
          weeks: weeksArray,
          start_week: startWeek,
          end_week: endWeek,
          bssid_enabled: isOrgOwner ? !!currentCourse.bssid_enabled : false,
          bssid_list: isOrgOwner && currentCourse.bssid_enabled ? normalizedBssidList : '',
          gps_enabled: !!currentCourse.gps_enabled,
          gps_lat: currentCourse.gps_enabled ? gpsLat : 0,
          gps_lng: currentCourse.gps_enabled ? gpsLng : 0,
          gps_radius_m: currentCourse.gps_enabled ? gpsRadiusM : 0,
          ip_enabled: ipEnabled,
          ip_list: ipEnabled ? normalizedIpList : ''
      };

      try {
          let savedId = currentCourse.id;
          if (currentCourse.id) {
              await apiFetch(`/courses/${currentCourse.id}`, {
                  method: 'PUT',
                  body: JSON.stringify(courseData)
              });
          } else {
              const created = await apiFetch('/courses', {
                  method: 'POST',
                  body: JSON.stringify(courseData)
              });
              savedId = created?.id || null;
          }
          if (courseData.fixed_seat_enabled && savedId) {
              const mapToSave = fixedSeatPendingMap || fixedSeatMap;
              const hasMap = mapToSave && Object.keys(mapToSave).length > 0;
              if (hasMap) {
                  const assignments = Object.entries(mapToSave || {})
                    .filter(([sid, seat]) => String(sid || '').trim() && String(seat || '').trim())
                    .map(([student_id, seat_label]) => ({ student_id, seat_label }));
                  await apiFetch(`/courses/${savedId}/fixed-seats`, {
                    method: 'PUT',
                    body: JSON.stringify({ assignments }),
                  });
                  setFixedSeatPendingMap(null);
              }
          }
          setIsModalOpen(false);
          fetchData();
      } catch (e) {
          alert(e.message);
      }
  };
  
  const handleDeleteCourse = async () => {
      if (currentCourse.id) {
          if (!window.confirm('确定删除?')) return;
          try {
              await apiFetch(`/courses/${currentCourse.id}`, { method: 'DELETE' });
              setIsModalOpen(false);
              fetchData();
          } catch (e) {
              alert(e.message);
          }
      }
  };

  const deleteCourseById = async (courseId) => {
      if (!courseId) return;
      if (!window.confirm('确定删除?')) return;
      try {
          await apiFetch(`/courses/${courseId}`, { method: 'DELETE' });
          fetchData();
          if (currentCourse?.id === courseId) {
              setIsModalOpen(false);
              setCurrentCourse(null);
          }
      } catch (e) {
          alert(e.message);
      }
  };

  const openMembersEditor = () => {
      if (!currentCourse) return;
      setMembersDraftRows(toMemberDraftRows(currentCourse.members));
      setIsMembersModalOpen(true);
  };

  const saveMembersEditor = () => {
      const dup = (() => {
        const seen = new Set();
        const dups = new Set();
        for (const r of (Array.isArray(membersDraftRows) ? membersDraftRows : [])) {
          const sid = String(r?.studentId || '').trim();
          if (!sid) continue;
          if (seen.has(sid)) dups.add(sid);
          else seen.add(sid);
        }
        return Array.from(dups);
      })();
      if (dup.length) {
        alert(`学号重复：${dup.join(', ')}`);
        return;
      }
      const members = normalizeMemberRows(membersDraftRows);
      setCurrentCourse(prev => ({ ...prev, memberMode: 'independent', members }));
      setIsMembersModalOpen(false);
  };

  const addMemberRow = () => {
    setMembersDraftRows(prev => [...prev, { name: '', studentId: '' }]);
  };

  const updateMemberRow = (index, patch) => {
    setMembersDraftRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeMemberRow = (index) => {
    setMembersDraftRows(prev => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [{ name: '', studentId: '' }];
    });
  };

  const downloadMembersTemplate = async () => {
    const token = getAuthToken();
    const url = `${API_BASE_URL}/members/template`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      let msg = '下载失败';
      try {
        const j = JSON.parse(text);
        msg = j?.message || msg;
      } catch {
        msg = text || msg;
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'members_template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const importMembersFromExcel = async (file) => {
    if (!file) return [];
    const token = getAuthToken();
    const url = `${API_BASE_URL}/members/import`;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new Error(data?.message || '导入失败');
    }
    if (data && typeof data === 'object' && 'code' in data) {
      if (data.code !== 0) throw new Error(data.message || '导入失败');
      const members = data?.data?.members;
      return Array.isArray(members) ? members : [];
    }
    return Array.isArray(data?.members) ? data.members : [];
  };

  const isSelected = (dayIndex, slotIndex) => {
      if (!dragState || dragState.mode !== 'select') return false;
      if (dragState.startDay !== dayIndex) return false;
      const min = Math.min(dragState.startSlot, dragState.endSlot);
      const max = Math.max(dragState.startSlot, dragState.endSlot);
      return slotIndex >= min && slotIndex <= max;
  };

  // Helper to find phantom course for move
  const getPhantomCourse = (dragState) => {
      if (!dragState || dragState.mode !== 'move') return null;
      const original = courses.find(c => c.id === dragState.courseId);
      if (!original) return null;
      return { 
          ...original, 
          dayIndex: dragState.currentDay,
          startSlotIndex: dragState.currentStartSlot, 
          endSlotIndex: dragState.currentStartSlot + dragState.span 
      };
  };

  return (
    <div className="class-edit-page">
      <div className="page-header">
        <div className="header-left">
          <h2>课程管理</h2>
          <div className="semester-selector">
            <select 
              value={currentSemesterId || ''} 
              onChange={(e) => handleSemesterChange(e.target.value)}
              className="semester-select"
            >
              {semesters.length === 0 && <option value="">无学期</option>}
              {semesters.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className="btn-icon" onClick={openCreateSemester} title="新建学期">+</button>
            {currentSemesterId && (
              <button className="btn-icon" onClick={openEditSemester} title="编辑当前学期">✎</button>
            )}
            {currentSemesterId && (
              <button className="btn-icon btn-danger-icon" onClick={handleDeleteSemester} title="删除当前学期">🗑️</button>
            )}
          </div>
          {currentSemesterId && (() => {
            const s = semesters.find(x => x.id === Number(currentSemesterId));
            const start = dateToYMD(s?.start_date);
            const end = dateToYMD(s?.end_date);
            if (!start && !end) return null;
            return (
              <div className="semester-dates">
                {start || '-'} ~ {end || '-'}
              </div>
            );
          })()}
        </div>
        <div className="controls">
          <label className="toggle-switch">
            <input 
              type="checkbox" 
              checked={isTimeEditMode} 
              onChange={(e) => setIsTimeEditMode(e.target.checked)} 
            />
            <span className="slider"></span>
            <span className="label-text">编辑时间段</span>
          </label>
        </div>
      </div>

      <div className="schedule-container" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        <div className="schedule-grid" style={{ gridTemplateRows: `50px repeat(${timeSlots.length}, 1fr)` }}>
          <div className="grid-header-cell time-header">时间 / 星期</div>
          {DAYS.map((day, index) => (
            <div key={index} className="grid-header-cell">{day}</div>
          ))}

          {timeSlots.map((slot, slotIndex) => (
            <React.Fragment key={slot.id}>
              {/* Time Slot Label */}
              <div 
                className={`time-slot-cell ${isTimeEditMode ? 'editing' : ''}`}
                style={{
                  gridColumn: 1,
                  gridRow: slotIndex + 2
                }}
              >
                {isTimeEditMode ? (
                  <div className="slot-editor">
                    <input 
                      value={slot.label} 
                      onChange={(e) => handleSlotChange(slotIndex, 'label', e.target.value)}
                      placeholder="名称"
                      className="slot-input small"
                    />
                    <div className="time-range">
                      <input 
                        type="time" 
                        value={slot.start} 
                        onChange={(e) => handleSlotChange(slotIndex, 'start', e.target.value)}
                        className="slot-input"
                      />
                      <span>-</span>
                      <input 
                        type="time" 
                        value={slot.end} 
                        onChange={(e) => handleSlotChange(slotIndex, 'end', e.target.value)}
                        className="slot-input"
                      />
                    </div>
                    <button
                      className="remove-slot-btn"
                      disabled={(courses || []).some(c => {
                        const start = Number(c?.startSlotIndex);
                        const end = Number(c?.endSlotIndex);
                        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
                        return start <= slotIndex && slotIndex <= end;
                      })}
                      title={(courses || []).some(c => {
                        const start = Number(c?.startSlotIndex);
                        const end = Number(c?.endSlotIndex);
                        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
                        return start <= slotIndex && slotIndex <= end;
                      }) ? '该时间段内存在课程安排，无法删除' : '删除时间段'}
                      onClick={() => removeSlot(slotIndex)}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="slot-display">
                    <span className="slot-label">{slot.label}</span>
                    <span className="slot-time">{slot.start} - {slot.end}</span>
                  </div>
                )}
              </div>

              {/* 1. Background Grid Cells Layer */}
              {DAYS.map((_, dayIndex) => (
                  <div 
                    key={`${dayIndex}-${slotIndex}`} 
                    className={`grid-cell ${isSelected(dayIndex, slotIndex) ? 'selected' : ''}`}
                    style={{
                        gridColumn: dayIndex + 2,
                        gridRow: slotIndex + 2,
                        zIndex: 1, // Base layer
                        display: 'flex'
                    }}
                    onMouseDown={(e) => handleCellMouseDown(e, dayIndex, slotIndex)}
                    onMouseEnter={() => handleMouseEnter(dayIndex, slotIndex)}
                  />
              ))}
            </React.Fragment>
          ))}

          {/* 2. Courses Layer */}
          {courses.map(course => {
              // Hide if moving (original)
              if (dragState?.mode === 'move' && dragState.courseId === course.id) return null;
              
              // Handle resizing phantom effect
              let displayCourse = course;
              if (dragState?.mode === 'resize' && dragState.courseId === course.id) {
                  displayCourse = { ...course, endSlotIndex: dragState.currentEndSlot };
              }

              return (
                  <CourseBlock 
                      key={course.id} 
                      course={displayCourse} 
                      isTimeEditMode={isTimeEditMode}
                      isPhantom={false}
                      onMouseDown={(e) => handleCourseMouseDown(e, course)}
                      onResizeDown={(e) => handleCourseMouseDown(e, course, true)}
                      onDelete={deleteCourseById}
                      onDoubleClick={(e) => {
                          if (!isTimeEditMode) {
                              e.stopPropagation();
                              const next = { memberMode: 'all', classRosterId: '', bssid_enabled: false, bssid_list: '', ip_enabled: false, ip_list: '', fixed_seat_enabled: false, ...course, members: coerceMembersArray(course.members) };
                              setCurrentCourse(next);
                              setBssidDraftRows(toBssidDraftRows(next.bssid_list));
                              setIpDraftRows(toIpDraftRows(next.ip_list));
                              setIsModalOpen(true);
                          }
                      }}
                  />
              );
          })}

          {/* 3. Moving Phantom Layer */}
          {dragState?.mode === 'move' && (
              <CourseBlock 
                  course={getPhantomCourse(dragState)} 
                  isTimeEditMode={isTimeEditMode}
                  isPhantom={true}
                  onMouseDown={() => {}} // Phantom shouldn't trigger events
                  onResizeDown={() => {}}
                  onDelete={() => {}}
                  onDoubleClick={() => {}}
              />
          )}

        </div>
        
        {isTimeEditMode && (
          <div className="add-slot-row">
            <button onClick={addSlot} className="add-slot-btn">+ 添加时间段</button>
            <button onClick={saveTimeSlotsToSemester} className="add-slot-btn primary">保存到当前学期</button>
            {timeSlotsSavedAt ? <span className="time-slots-saved">已保存</span> : null}
            {Object.keys(pendingCourseUpdates || {}).length > 0 ? <span className="time-slots-pending">课程表调整待保存</span> : null}
          </div>
        )}
      </div>

      {/* Semester Modal */}
      {isSemesterModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '400px' }}>
            <h3>{semesterModalMode === 'edit' ? '编辑学期' : '新建学期'}</h3>
            <div className="form-group">
              <label>学期名称</label>
              <input 
                value={newSemesterName} 
                onChange={e => setNewSemesterName(e.target.value)}
                placeholder="例如：2023-2024 秋季学期"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>开始时间 (周一)</label>
              <input 
                type="date"
                value={newSemesterStart} 
                onChange={e => setNewSemesterStart(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>结束时间 (周日)</label>
              <input 
                type="date"
                value={newSemesterEnd} 
                onChange={e => setNewSemesterEnd(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setIsSemesterModalOpen(false)}>取消</button>
              <button className="btn-primary" onClick={handleSaveSemester}>{semesterModalMode === 'edit' ? '保存' : '创建'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Course Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>{currentCourse.id ? '编辑课程' : '新建课程'}</h3>
            
            <div className="modal-body">
              <div className="form-row" style={{ marginBottom: '12px' }}>
                <div className="form-group">
                  <label>课程名称</label>
                  <input 
                    value={currentCourse.name} 
                    onChange={e => setCurrentCourse({...currentCourse, name: e.target.value})}
                    placeholder="请输入课程名称"
                  />
                </div>
                <div className="form-group">
                  <label>上课地点 (关联教室)</label>
                  <select 
                    value={currentCourse.location || ''} 
                    onChange={e => {
                      const nextLoc = e.target.value;
                      if (currentCourse.fixed_seat_enabled && nextLoc !== (currentCourse.location || '')) {
                        if (!window.confirm('更换教室会影响固定座位分配，是否先关闭固定座位？')) return;
                        setFixedSeatPendingMap(null);
                        setFixedSeatMap({});
                        setCurrentCourse({ ...currentCourse, location: nextLoc, fixed_seat_enabled: false });
                        return;
                      }
                      setCurrentCourse({ ...currentCourse, location: nextLoc });
                    }}
                    className="select-input"
                  >
                    <option value="">请选择教室</option>
                    {rooms.map(room => (
                      <option key={room.room_id} value={room.room_id}>
                        {room.name ? `${room.name} (${room.room_id})` : room.room_id}
                      </option>
                    ))}
                    <option value={currentCourse.location} disabled hidden>{currentCourse.location}</option>
                  </select>
                </div>
              </div>
              
              <div className="form-row" style={{ marginBottom: '12px' }}>
                <div className="form-group">
                  <label>开始周 (1-{semesterWeeks})</label>
                  <input 
                    type="number" 
                    min="1" 
                    max={semesterWeeks}
                    value={currentCourse.start_week || 1} 
                    onChange={e => setCurrentCourse({...currentCourse, start_week: parseInt(e.target.value)})}
                  />
                </div>
                <div className="form-group">
                  <label>结束周 (1-{semesterWeeks})</label>
                  <input 
                    type="number" 
                    min="1" 
                    max={semesterWeeks}
                    value={currentCourse.end_week || semesterWeeks} 
                    onChange={e => setCurrentCourse({...currentCourse, end_week: parseInt(e.target.value)})}
                  />
                </div>
              </div>

              {isOrgOwner && (
                <div className="form-group">
                  <label>BSSID 校验</label>
                  <label className="radio-option" style={{ marginBottom: '8px' }}>
                    <input
                      type="checkbox"
                      checked={!!currentCourse.bssid_enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setCurrentCourse({ ...currentCourse, bssid_enabled: enabled });
                        if (enabled) setBssidDraftRows(toBssidDraftRows(currentCourse.bssid_list));
                      }}
                    />
                    <span>开启BSSID校验</span>
                  </label>
                  {currentCourse.bssid_enabled && (
                    <>
                      <div className="bssid-grid">
                        <div className="bssid-grid-header">BSSID</div>
                        <div className="bssid-grid-header bssid-grid-op">操作</div>
                        {bssidDraftRows.map((row, idx) => (
                          <div key={idx} className="bssid-grid-row">
                            <input
                              className="text-input"
                              placeholder="aa:bb:cc:dd:ee:ff"
                              value={row.bssid}
                              onChange={(e) => setBssidDraftRows(prev => prev.map((r, i) => (i === idx ? { ...r, bssid: e.target.value } : r)))}
                            />
                            <div className="bssid-grid-op">
                              <button
                                type="button"
                                className="btn-danger btn-small"
                                onClick={() => setBssidDraftRows(prev => {
                                  const next = prev.filter((_, i) => i !== idx);
                                  return next.length ? next : [{ bssid: '' }];
                                })}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="bssid-toolbar">
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => setBssidDraftRows(prev => [...prev, { bssid: '' }])}
                        >
                          + 增加一行
                        </button>
                        <div className="hint-text">当前共 {normalizeBssidRows(bssidDraftRows).length} 条</div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="form-group">
                  <label>GPS 校验</label>
                  <label className="radio-option" style={{ marginBottom: '8px' }}>
                    <input
                      type="checkbox"
                      checked={!!currentCourse.gps_enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setCurrentCourse({
                          ...currentCourse,
                          gps_enabled: enabled,
                          gps_lat: enabled ? Number(currentCourse.gps_lat || 0) : 0,
                          gps_lng: enabled ? Number(currentCourse.gps_lng || 0) : 0,
                          gps_radius_m: enabled ? Number(currentCourse.gps_radius_m || 50) : 0,
                        });
                      }}
                    />
                    <span>开启GPS校验</span>
                  </label>
                  {currentCourse.gps_enabled && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <button type="button" className="btn-secondary btn-small" onClick={openGpsPicker}>选择地点</button>
                      <div className="hint-text">
                        {currentCourse.gps_lat && currentCourse.gps_lng
                          ? `(${Number(currentCourse.gps_lat).toFixed(6)}, ${Number(currentCourse.gps_lng).toFixed(6)}) · ${Number(currentCourse.gps_radius_m || 0)}m`
                          : '未设置'}
                      </div>
                    </div>
                  )}
              </div>

              <div className="form-group">
                  <label>出口IP 段校验（最终出口IP，不是局域网IP）</label>
                  <label className="radio-option" style={{ marginBottom: '8px' }}>
                    <input
                      type="checkbox"
                      checked={!!currentCourse.ip_enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setCurrentCourse({
                          ...currentCourse,
                          ip_enabled: enabled,
                          ip_list: enabled ? String(currentCourse.ip_list || '') : '',
                        });
                        if (enabled) setIpDraftRows(toIpDraftRows(currentCourse.ip_list));
                      }}
                    />
                    <span>开启出口IP校验</span>
                  </label>
                  {currentCourse.ip_enabled && (
                    <>
                      <div className="bssid-grid">
                        <div className="bssid-grid-header">IP段（CIDR）</div>
                        <div className="bssid-grid-header bssid-grid-op">操作</div>
                        {ipDraftRows.map((row, idx) => (
                          <div key={idx} className="bssid-grid-row">
                            <input
                              className="text-input"
                              placeholder="1.2.3.0/24"
                              value={row.ip}
                              onChange={(e) => setIpDraftRows(prev => prev.map((r, i) => (i === idx ? { ...r, ip: e.target.value } : r)))}
                            />
                            <div className="bssid-grid-op">
                              <button
                                type="button"
                                className="btn-danger btn-small"
                                onClick={() => setIpDraftRows(prev => {
                                  const next = prev.filter((_, i) => i !== idx);
                                  return next.length ? next : [{ ip: '' }];
                                })}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="bssid-toolbar">
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => setIpDraftRows(prev => [...prev, { ip: '' }])}
                        >
                          + 增加一行
                        </button>
                        <div className="hint-text">当前共 {normalizeIpRows(ipDraftRows).length} 条</div>
                      </div>
                      <div className="hint-text">不在允许IP段内会走异常签到确认</div>
                    </>
                  )}
              </div>

              <div className="form-group">
                <label>成员模式</label>
                <div className="member-mode">
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="memberMode"
                      checked={currentCourse.memberMode === 'independent'}
                      onChange={() => {
                        setFixedSeatPendingMap(null);
                        setFixedSeatMap({});
                        setCurrentCourse({ ...currentCourse, memberMode: 'independent', fixed_seat_enabled: false });
                      }}
                    />
                    <span>独立名单</span>
                  </label>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="memberMode"
                      checked={currentCourse.memberMode === 'class'}
                      onChange={() => {
                        setFixedSeatPendingMap(null);
                        setFixedSeatMap({});
                        setCurrentCourse({ ...currentCourse, memberMode: 'class', fixed_seat_enabled: false });
                      }}
                    />
                    <span>引用班级</span>
                  </label>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="memberMode"
                      checked={currentCourse.memberMode === 'all'}
                      onChange={() => {
                        setFixedSeatPendingMap(null);
                        setFixedSeatMap({});
                        setCurrentCourse({ ...currentCourse, memberMode: 'all', fixed_seat_enabled: false });
                      }}
                    />
                    <span>无名单(开放)</span>
                  </label>
                </div>

                {currentCourse.memberMode === 'independent' && (
                  <div className="member-mode-detail">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="member-summary">已添加 {Array.isArray(currentCourse.members) ? currentCourse.members.length : 0} 人</span>
                      <button type="button" className="btn-secondary btn-small" onClick={openMembersEditor}>编辑成员</button>
                    </div>
                  </div>
                )}

                {currentCourse.memberMode === 'class' && (
                  <div className="member-mode-detail">
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <select
                        className="select-input"
                        style={{ flex: 1 }}
                        value={currentCourse.classRosterId || ''}
                        onChange={(e) => {
                          setFixedSeatPendingMap(null);
                          setFixedSeatMap({});
                          setCurrentCourse({ ...currentCourse, classRosterId: e.target.value, fixed_seat_enabled: false });
                        }}
                      >
                        <option value="">请选择班级</option>
                        {classRosters.map(r => (
                          <option key={r.id} value={r.id}>{r.name || r.id}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        onClick={() => navigate('/class-rosters')}
                      >
                        管理
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {currentCourse.memberMode !== 'all' ? (
                <div className="form-group">
                  <label>固定座位</label>
                  <label className="radio-option" style={{ marginBottom: '8px' }}>
                    <input
                      type="checkbox"
                      checked={!!currentCourse.fixed_seat_enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        if (!enabled) {
                          setCurrentCourse({ ...currentCourse, fixed_seat_enabled: false });
                          return;
                        }
                        const next = { ...currentCourse, fixed_seat_enabled: true };
                        setCurrentCourse(next);
                        openFixedSeatEditor(next).then((opened) => {
                          if (!opened) setCurrentCourse(prev => ({ ...prev, fixed_seat_enabled: false }));
                        });
                      }}
                    />
                    <span>开启固定座位</span>
                  </label>
                  {currentCourse.fixed_seat_enabled && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        onClick={() => openFixedSeatEditor()}
                      >
                        编辑分配
                      </button>
                      <div className="hint-text">开启后学生仅可在分配座位签到</div>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="form-group">
                  <label>卡片颜色</label>
                  <div className="color-picker">
                      {['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#7f8c8d', '#34495e'].map(c => (
                          <div 
                              key={c} 
                              className={`color-swatch ${currentCourse.color === c ? 'active' : ''}`}
                              style={{ backgroundColor: c }}
                              onClick={() => setCurrentCourse({...currentCourse, color: c})}
                          />
                      ))}
                  </div>
              </div>
              
              <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>时间段</label>
                  <div className="time-info" style={{ fontSize: '13px', color: '#666' }}>
                      {DAYS[currentCourse.dayIndex]} {timeSlots[currentCourse.startSlotIndex]?.label} ({timeSlots[currentCourse.startSlotIndex]?.start}) - {timeSlots[currentCourse.endSlotIndex]?.label} ({timeSlots[currentCourse.endSlotIndex]?.end})
                  </div>
              </div>
            </div>
            
            <div className="modal-actions">
              {currentCourse.id ? (
                  <button className="btn-delete" onClick={handleDeleteCourse}>删除</button>
              ) : <div></div>}
              <div className="right-actions">
                  <button onClick={() => { setIsModalOpen(false); setDragState(null); }}>取消</button>
                  <button className="btn-primary" onClick={handleSaveCourse}>保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && isMembersModalOpen && (
        <div className="modal-overlay modal-overlay-top">
          <div className="modal-content modal-content-wide">
            <h3>编辑成员（独立名单）</h3>
            <div className="form-group">
              <label>成员列表</label>
              <div className="members-grid">
                <div className="members-grid-header">姓名</div>
                <div className="members-grid-header">学号</div>
                <div className="members-grid-header members-grid-op">操作</div>
                {membersDraftRows.map((row, idx) => (
                  <React.Fragment key={idx}>
                    <input
                      className="text-input"
                      placeholder="姓名"
                      value={row.name}
                      onChange={(e) => updateMemberRow(idx, { name: e.target.value })}
                    />
                    <input
                      className="text-input"
                      placeholder="学号"
                      value={row.studentId}
                      onChange={(e) => updateMemberRow(idx, { studentId: e.target.value })}
                    />
                    <button type="button" className="btn-danger btn-small" onClick={() => removeMemberRow(idx)}>
                      删除
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <div className="members-toolbar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <button type="button" className="btn-secondary" onClick={addMemberRow}>+ 增加一行</button>
                  <button type="button" className="btn-secondary" onClick={() => downloadMembersTemplate().catch(e => alert(e.message))}>下载模板</button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => membersFileRef.current?.click()}
                  >
                    Excel导入
                  </button>
                  <input
                    ref={membersFileRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      importMembersFromExcel(f)
                        .then((members) => {
                          const rows = coerceMembersArray(members);
                          setMembersDraftRows(prev => [...(Array.isArray(prev) ? prev : []), ...rows].filter(r => (r?.name || r?.studentId)));
                        })
                        .catch((err) => alert(err.message));
                    }}
                  />
                </div>
                <div className="member-summary">共 {normalizeMemberRows(membersDraftRows).length} 人</div>
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setIsMembersModalOpen(false)}>取消</button>
              <div className="right-actions">
                <button className="btn-primary" onClick={saveMembersEditor}>保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && isGpsModalOpen && (
        <div className="modal-overlay modal-overlay-top">
          <div className="modal-content modal-content-wide">
            <h3>选择签到地点与半径</h3>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px' }}>
                <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                  <label>半径（米）</label>
                  <input
                    type="number"
                    min="1"
                    value={gpsDraft.radius_m}
                    onChange={(e) => setGpsDraft(prev => ({ ...prev, radius_m: Number(e.target.value || 0) }))}
                  />
                </div>
                <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <div className="hint-text">
                    {Number(gpsDraft.lat).toFixed(6)}, {Number(gpsDraft.lng).toFixed(6)}
                  </div>
                  {gpsCenterNote ? <div className="hint-text">{gpsCenterNote}</div> : null}
                </div>
              </div>
              <div className="gps-map" ref={gpsMapElRef} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => setGpsDraft(prev => ({ ...prev, lat: 0, lng: 0 }))}
                >
                  清除
                </button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button type="button" onClick={() => setIsGpsModalOpen(false)}>取消</button>
                  <button type="button" className="btn-primary" onClick={applyGpsDraftToCourse}>确定</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && isFixedSeatModalOpen && (
        <div className="modal-overlay modal-overlay-top">
          <div className="modal-content modal-content-wide" style={{ width: '1200px', maxWidth: '96vw' }}>
            <h3>固定座位分配</h3>
            <div className="modal-body">
              <FixedSeatEditor
                seats={fixedSeatSeats}
                students={fixedSeatStudents}
                seatMap={fixedSeatMap}
                onChangeSeatMap={setFixedSeatMap}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn-secondary btn-small"
                    onClick={() => setFixedSeatMap(autoAssignFixedSeat(fixedSeatStudents, fixedSeatSeats, fixedSeatMap))}
                  >
                    自动分配
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-small"
                    onClick={() => setFixedSeatMap({})}
                  >
                    清空
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button type="button" onClick={() => setIsFixedSeatModalOpen(false)}>取消</button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => saveFixedSeatMapping().catch(e => alert(e.message))}
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const DND_STUDENT = 'DND_STUDENT';

const FixedSeatStudentItem = ({ student, seatLabel }) => {
  const [{ isDragging }, dragRef, dragPreview] = useDrag(() => ({
    type: DND_STUDENT,
    item: { kind: 'STUDENT', studentId: student.studentId, studentName: student.name || '' },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  }), [student.studentId, student.name]);

  useEffect(() => {
    const emptyImage = new Image();
    emptyImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    dragPreview(emptyImage, { captureDraggingState: false });
  }, [dragPreview]);

  return (
    <div
      ref={dragRef}
      style={{
        padding: '6px 8px',
        border: '1px solid #ddd',
        borderRadius: '6px',
        background: '#fff',
        cursor: 'grab',
        opacity: isDragging ? 0.5 : 1,
        display: 'flex',
        justifyContent: 'space-between',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '13px', color: '#333' }}>{student.name || student.studentId}</div>
        <div style={{ fontSize: '12px', color: '#888' }}>{student.studentId}</div>
      </div>
      <div style={{ fontSize: '12px', color: seatLabel ? '#333' : '#999', whiteSpace: 'nowrap', marginTop: '2px' }}>
        {seatLabel ? `→ ${seatLabel}` : '未分配'}
      </div>
    </div>
  );
};

const FixedSeatSeat = ({ seat, assignedStudent, onDropStudent }) => {
  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: DND_STUDENT,
    drop: (item) => onDropStudent?.(String(item?.studentId || ''), seat.seatNumber),
    collect: (monitor) => ({ isOver: monitor.isOver({ shallow: true }) }),
  }), [seat.seatNumber, onDropStudent]);

  return (
    <div
      ref={dropRef}
      style={{
        position: 'absolute',
        left: seat.left,
        top: seat.top,
        width: seat.size,
        height: seat.size,
        borderRadius: '6px',
        border: isOver ? '2px solid #4a90e2' : '1px solid #bbb',
        background: assignedStudent ? '#eaf3ff' : '#f7f7f7',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2px',
        overflow: 'hidden',
      }}
      title={assignedStudent ? `${seat.seatNumber} - ${assignedStudent.name || assignedStudent.studentId}` : seat.seatNumber}
    >
      <div style={{ fontSize: '12px', color: '#333', lineHeight: 1 }}>{seat.seatNumber}</div>
      {assignedStudent ? (
        <div style={{ fontSize: '11px', color: '#555', lineHeight: 1.1, textAlign: 'center' }}>
          {assignedStudent.name || assignedStudent.studentId}
        </div>
      ) : (
        <div style={{ fontSize: '11px', color: '#999', lineHeight: 1.1 }}>空</div>
      )}
    </div>
  );
};

const FixedSeatEditor = ({ seats, students, seatMap, onChangeSeatMap }) => {
  const studentById = useMemo(() => {
    const m = new Map();
    for (const s of students || []) m.set(String(s.studentId), s);
    return m;
  }, [students]);

  const seatToStudent = useMemo(() => {
    const m = new Map();
    for (const [sid, seat] of Object.entries(seatMap || {})) {
      if (!sid || !seat) continue;
      m.set(String(seat), String(sid));
    }
    return m;
  }, [seatMap]);

  const assign = (studentId, seatLabel) => {
    const sid = String(studentId || '').trim();
    const seat = String(seatLabel || '').trim();
    if (!sid || !seat) return;
    onChangeSeatMap?.((prev) => {
      const next = { ...(prev || {}) };
      for (const [k, v] of Object.entries(next)) {
        if (v === seat) delete next[k];
      }
      next[sid] = seat;
      return next;
    });
  };

  const unassign = (studentId) => {
    const sid = String(studentId || '').trim();
    if (!sid) return;
    onChangeSeatMap?.((prev) => {
      const next = { ...(prev || {}) };
      delete next[sid];
      return next;
    });
  };

  const [{ isOver }, unassignDropRef] = useDrop(() => ({
    accept: DND_STUDENT,
    drop: (item) => unassign(String(item?.studentId || '')),
    collect: (monitor) => ({ isOver: monitor.isOver({ shallow: true }) }),
  }), []);

  const size = 40;
  const xs = (seats || []).map(s => Number(s.x || 0));
  const ys = (seats || []).map(s => Number(s.y || 0));
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const w = (maxX - minX + 1) * size;
  const h = (maxY - minY + 1) * size;

  const visualSeats = (seats || []).map(s => ({
    ...s,
    size,
    left: (Number(s.x || 0) - minX) * size,
    top: (Number(s.y || 0) - minY) * size,
  }));

  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
      <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          ref={unassignDropRef}
          style={{
            padding: '8px',
            borderRadius: '8px',
            border: isOver ? '2px dashed #4a90e2' : '1px dashed #bbb',
            background: '#fafafa',
            fontSize: '12px',
            color: '#666',
          }}
        >
          将学生拖到这里取消分配
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'auto', maxHeight: '420px' }}>
          {(students || []).map(s => (
            <FixedSeatStudentItem
              key={s.studentId}
              student={s}
              seatLabel={seatMap?.[s.studentId] || ''}
            />
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #eee', borderRadius: '8px', background: '#fff' }}>
        <div style={{ position: 'relative', width: Math.max(w, 520), height: Math.max(h, 420), margin: '10px' }}>
          {visualSeats.map(seat => {
            const sid = seatToStudent.get(seat.seatNumber);
            const stu = sid ? studentById.get(sid) : null;
            return (
              <FixedSeatSeat
                key={seat.seatNumber}
                seat={seat}
                assignedStudent={stu}
                onDropStudent={assign}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Subcomponent for Course Block
const CourseBlock = ({ course, isTimeEditMode, isPhantom, onMouseDown, onResizeDown, onDelete, onDoubleClick }) => {
    if (!course) return null;
    const span = course.endSlotIndex - course.startSlotIndex + 1;
    
    return (
        <div 
            className="course-block-content"
            style={{
                gridColumn: course.dayIndex + 2,
                gridRow: `${course.startSlotIndex + 2} / span ${span}`,
                backgroundColor: course.color,
                zIndex: isPhantom ? 15 : 10,
                opacity: isPhantom ? 0.7 : 1,
                cursor: !isTimeEditMode && !isPhantom ? 'move' : undefined,
                pointerEvents: isPhantom ? 'none' : 'auto',
                margin: '1px',
                borderRadius: '4px',
                position: 'relative' // Ensure resize handle is positioned correctly
            }}
            onMouseDown={onMouseDown}
            onDoubleClick={onDoubleClick}
        >
            {!isTimeEditMode && !isPhantom && (
                <button
                    type="button"
                    className="course-delete-btn"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete?.(course.id);
                    }}
                    aria-label="删除课程"
                >
                    ×
                </button>
            )}
            <div className="course-name">{course.name}</div>
            <div className="course-location">{course.location}</div>
            {/* Resize Handle */}
            {!isTimeEditMode && !isPhantom && (
                <div 
                    className="resize-handle"
                    onMouseDown={onResizeDown}
                />
            )}
        </div>
    );
};


export default ClassEditPage;
