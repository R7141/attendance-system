"use strict";
const common_vendor = require("../../common/vendor.js");
const _sfc_main = common_vendor.defineComponent({
  data() {
    return {
      apiBase: "http://10.62.128.98:8080",
      token: "",
      me: null,
      username: "",
      password: "",
      loading: false,
      semesters: [],
      courses: [],
      rosters: [],
      currentSemesterId: null,
      currentCourse: null,
      currentRoom: null,
      sessions: [],
      activeSession: null,
      selectedSessionId: null,
      signIns: [],
      signInBySeat: {},
      fixedSeatBySeat: {},
      leavesByStudentId: {},
      leaveDraftRows: [],
      showLeaveEditor: false,
      alerts: [],
      showAlerts: false,
      autoRefresh: true,
      showSignInList: false,
      selectedSeatLabel: "",
      SEAT_SIZE: 60,
      canvasWidth: 1600,
      canvasHeight: 1200,
      seats: [],
      pollTimer: null
    };
  },
  onLoad() {
    const t = common_vendor.index.getStorageSync("teacher_token");
    if (t) {
      this.token = t;
      this.bootstrap();
    }
  },
  onUnload() {
    this.clearPolling();
  },
  computed: {
    coursePickerLabels() {
      return (this.courses || []).map((c) => {
        return c.name || `课程#${c.id}`;
      });
    },
    coursePickerIndex() {
      if (!this.currentCourse || !this.courses || !this.courses.length)
        return 0;
      const idx = this.courses.findIndex((c) => {
        return c.id === this.currentCourse.id;
      });
      return idx >= 0 ? idx : 0;
    },
    sessionPickerLabels() {
      return (this.sessions || []).map((s) => {
        const tag = this.activeSession && s.id === this.activeSession.id ? "（进行中）" : "";
        return `#${s.id}${tag}`;
      });
    },
    sessionPickerIndex() {
      if (!this.selectedSessionId || !this.sessions || !this.sessions.length)
        return 0;
      const idx = this.sessions.findIndex((s) => {
        return s.id === this.selectedSessionId;
      });
      return idx >= 0 ? idx : 0;
    },
    selectedSessionLabel() {
      if (!this.selectedSessionId)
        return "";
      const s = common_vendor.UTS.arrayFind(this.sessions || [], (x) => {
        return x.id === this.selectedSessionId;
      });
      if (!s)
        return `#${this.selectedSessionId}`;
      return `#${s.id}${this.activeSession && this.activeSession.id === s.id ? "（进行中）" : ""}`;
    },
    courseSubline() {
      if (!this.currentCourse)
        return "";
      const mode = String(this.currentCourse.memberMode || "").trim();
      if (mode === "all") {
        const loc0 = this.currentCourse.location || "-";
        return `${loc0} · 开放签到`;
      }
      const total = this.getCourseMembers(this.currentCourse).length;
      const loc = this.currentCourse.location || "-";
      return `${loc} · 共${total}人`;
    },
    signedCount() {
      return Array.isArray(this.signIns) ? this.signIns.length : 0;
    },
    expectedCount() {
      const c = this.currentCourse;
      if (!c)
        return 0;
      const mode = String(c.memberMode || "").trim();
      if (mode === "all")
        return 0;
      return this.getCourseMembers(c).length;
    },
    signedExpectedCount() {
      var e_1, _a;
      const c = this.currentCourse;
      if (!c)
        return 0;
      const mode = String(c.memberMode || "").trim();
      if (mode === "all")
        return 0;
      const members = this.getCourseMembers(c);
      const set = new Set(members.map((m = null) => {
        return String(m.studentId || "").trim();
      }).filter(Boolean));
      let cnt = 0;
      try {
        for (var _b = common_vendor.__values(this.signIns || []), _c = _b.next(); !_c.done; _c = _b.next()) {
          var s = _c.value;
          const sid = String((s === null || s === void 0 ? null : s.student_id) || "").trim();
          if (sid && set.has(sid))
            cnt++;
        }
      } catch (e_1_1) {
        e_1 = { error: e_1_1 };
      } finally {
        try {
          if (_c && !_c.done && (_a = _b.return))
            _a.call(_b);
        } finally {
          if (e_1)
            throw e_1.error;
        }
      }
      return cnt;
    },
    showProgress() {
      return this.expectedCount > 0;
    },
    progressPercent() {
      const total = Number(this.expectedCount || 0);
      if (!total)
        return 0;
      const p = Math.floor(Number(this.signedExpectedCount || 0) / total * 100);
      if (p < 0)
        return 0;
      if (p > 100)
        return 100;
      return p;
    },
    progressText() {
      const total = Number(this.expectedCount || 0);
      const signed = Number(this.signedExpectedCount || 0);
      return total ? `${signed}/${total}（${this.progressPercent}%）` : "";
    },
    selectedSeatRecord() {
      if (!this.selectedSeatLabel)
        return null;
      return common_vendor.UTS.arrayFind(this.signIns || [], (s) => {
        return s.seat_label === this.selectedSeatLabel;
      }) || null;
    },
    selectedSeatInfo() {
      var _a, _b, _c, _d;
      const label = String(this.selectedSeatLabel || "").trim();
      if (!label)
        return new common_vendor.UTSJSONObject({ statusText: "", studentName: "", studentId: "", timeText: "", warnText: "", leaveReason: "" });
      const rec = ((_a = this.signInBySeat) === null || _a === void 0 ? null : _a[label]) || null;
      if (rec) {
        const q = String((rec === null || rec === void 0 ? null : rec.sign_quality) || "ok").trim();
        const base = String((rec === null || rec === void 0 ? null : rec.status) || "").trim() === "late" ? "迟到" : "已签到";
        const statusText = q === "warn" ? base === "迟到" ? "迟到(异常)" : "异常签到" : base;
        return new common_vendor.UTSJSONObject({
          statusText,
          studentName: String((rec === null || rec === void 0 ? null : rec.student_name) || "").trim(),
          studentId: String((rec === null || rec === void 0 ? null : rec.student_id) || "").trim(),
          timeText: this.formatTime(rec === null || rec === void 0 ? null : rec.time),
          warnText: q === "warn" ? this.warnReasonText(rec === null || rec === void 0 ? null : rec.warn_reasons) : "",
          leaveReason: ""
        });
      }
      const fixedEnabled = !!((_b = this.currentCourse) === null || _b === void 0 ? null : _b.fixed_seat_enabled);
      if (fixedEnabled) {
        const a = ((_c = this.fixedSeatBySeat) === null || _c === void 0 ? null : _c[label]) || null;
        const sid = String((a === null || a === void 0 ? null : a.studentId) || "").trim();
        const name = String((a === null || a === void 0 ? null : a.studentName) || "").trim();
        const hasLeave = !!sid && Object.prototype.hasOwnProperty.call(this.leavesByStudentId || new common_vendor.UTSJSONObject({}), sid);
        const leaveReason = hasLeave ? String(((_d = this.leavesByStudentId) === null || _d === void 0 ? null : _d[sid]) || "").trim() : "";
        return new common_vendor.UTSJSONObject({
          statusText: hasLeave ? "请假" : "未签到",
          studentName: name,
          studentId: sid,
          timeText: "",
          warnText: "",
          leaveReason: hasLeave ? leaveReason || "（无）" : ""
        });
      }
      return new common_vendor.UTSJSONObject({ statusText: "未签到", studentName: "", studentId: "", timeText: "", warnText: "", leaveReason: "" });
    }
  },
  methods: {
    requestJson(_a) {
      var url = _a.url, method = _a.method, data = _a.data, header = _a.header;
      return new Promise((resolve, reject) => {
        common_vendor.index.request({
          url,
          method: method || "GET",
          data,
          header: header || new common_vendor.UTSJSONObject({ "content-type": "application/json" }),
          success: (res) => {
            return resolve(res);
          },
          fail: (err) => {
            return reject(err);
          }
        });
      });
    },
    apiFetch(path = null, _a) {
      var _b = _a == void 0 ? new common_vendor.UTSJSONObject({}) : _a, method = _b.method, data = _b.data;
      const header = new common_vendor.UTSJSONObject({ "content-type": "application/json" });
      if (this.token)
        header["Authorization"] = `Bearer ${this.token}`;
      return this.requestJson({
        url: `${this.apiBase}${path}`,
        method: method || "GET",
        data,
        header
      }).then((res = null) => {
        var _a2;
        if (res.statusCode === 401) {
          this.logout();
          return Promise.reject(new Error("登录已失效"));
        }
        if (res.statusCode !== 200 || !res.data || res.data.code !== 0) {
          return Promise.reject(new Error(((_a2 = res.data) === null || _a2 === void 0 ? null : _a2.message) || "请求失败"));
        }
        return res.data.data;
      });
    },
    doLogin() {
      if (this.loading)
        return null;
      const u = (this.username || "").trim();
      const p = (this.password || "").trim();
      if (!u || !p) {
        common_vendor.index.showToast({ title: "请输入账号密码", icon: "none" });
        return null;
      }
      this.loading = true;
      this.requestJson({
        url: `${this.apiBase}/auth/login`,
        method: "POST",
        data: new common_vendor.UTSJSONObject({ username: u, password: p }),
        header: new common_vendor.UTSJSONObject({ "content-type": "application/json" })
      }).then((res = null) => {
        var _a, _b, _c;
        if (res.statusCode !== 200 || !res.data || res.data.code !== 0) {
          common_vendor.index.showToast({ title: ((_a = res.data) === null || _a === void 0 ? null : _a.message) || "登录失败", icon: "none" });
          return null;
        }
        const token = ((_c = (_b = res.data) === null || _b === void 0 ? null : _b.data) === null || _c === void 0 ? null : _c.token) || "";
        if (!token) {
          common_vendor.index.showToast({ title: "登录失败", icon: "none" });
          return null;
        }
        this.token = token;
        common_vendor.index.setStorageSync("teacher_token", token);
        this.password = "";
        this.bootstrap();
      }).catch((e = null) => {
        common_vendor.index.showToast({ title: (e === null || e === void 0 ? null : e.message) || "网络错误", icon: "none" });
      }).finally(() => {
        this.loading = false;
      });
    },
    logout() {
      this.clearPolling();
      this.token = "";
      this.me = null;
      this.username = "";
      this.password = "";
      this.semesters = [];
      this.courses = [];
      this.currentSemesterId = null;
      this.currentCourse = null;
      this.currentRoom = null;
      this.sessions = [];
      this.activeSession = null;
      this.selectedSessionId = null;
      this.signIns = [];
      this.selectedSeatLabel = "";
      this.seats = [];
      common_vendor.index.removeStorageSync("teacher_token");
    },
    bootstrap() {
      this.loading = true;
      Promise.resolve().then(() => {
        return this.apiFetch("/me");
      }).then((me = null) => {
        this.me = me;
        return this.apiFetch("/semesters");
      }).then((s = null) => {
        const list = Array.isArray(s === null || s === void 0 ? null : s.semesters) ? s.semesters : [];
        this.semesters = list;
        const latest = list[0] || null;
        this.currentSemesterId = latest ? latest.id : null;
        if (!this.currentSemesterId)
          return Promise.resolve([]);
        return Promise.all([
          this.apiFetch(`/courses?semester_id=${this.currentSemesterId}`),
          this.apiFetch("/rosters").catch(() => {
            return new common_vendor.UTSJSONObject({ rosters: [] });
          })
        ]);
      }).then((arr = null) => {
        const c = Array.isArray(arr) ? arr[0] : arr;
        const r = Array.isArray(arr) ? arr[1] : null;
        const list = Array.isArray(c === null || c === void 0 ? null : c.courses) ? c.courses : [];
        this.rosters = Array.isArray(r === null || r === void 0 ? null : r.rosters) ? r.rosters : [];
        this.courses = list;
        const picked = this.autoPickCourse(list);
        if (picked) {
          return this.selectCourse(picked);
        }
        if (list[0]) {
          return this.selectCourse(list[0]);
        }
        return Promise.resolve();
      }).catch((e = null) => {
        common_vendor.index.showToast({ title: (e === null || e === void 0 ? null : e.message) || "初始化失败", icon: "none" });
      }).finally(() => {
        this.loading = false;
      });
    },
    autoPickCourse(courseList = null) {
      if (!Array.isArray(courseList) || !courseList.length)
        return null;
      const timeSlots = [
        new common_vendor.UTSJSONObject({ id: 0, start: "08:00", end: "08:45" }),
        new common_vendor.UTSJSONObject({ id: 1, start: "08:55", end: "09:40" }),
        new common_vendor.UTSJSONObject({ id: 2, start: "10:00", end: "10:45" }),
        new common_vendor.UTSJSONObject({ id: 3, start: "10:55", end: "11:40" }),
        new common_vendor.UTSJSONObject({ id: 4, start: "14:00", end: "14:45" }),
        new common_vendor.UTSJSONObject({ id: 5, start: "14:55", end: "15:40" }),
        new common_vendor.UTSJSONObject({ id: 6, start: "16:00", end: "16:45" }),
        new common_vendor.UTSJSONObject({ id: 7, start: "16:55", end: "17:40" }),
        new common_vendor.UTSJSONObject({ id: 8, start: "19:00", end: "19:45" }),
        new common_vendor.UTSJSONObject({ id: 9, start: "19:55", end: "20:40" }),
        new common_vendor.UTSJSONObject({ id: 10, start: "20:50", end: "21:35" })
      ];
      const parseTime = (t = null) => {
        const _a = common_vendor.__read((t || "00:00").split(":").map(Number), 2), h = _a[0], m = _a[1];
        return h * 60 + m;
      };
      const now = /* @__PURE__ */ new Date();
      const dayOfWeek = now.getDay();
      const currentDayIndex = (dayOfWeek + 6) % 7;
      const currentTimeVal = now.getHours() * 60 + now.getMinutes();
      return common_vendor.UTS.arrayFind(courseList, (c = null) => {
        if (c.dayIndex !== currentDayIndex)
          return false;
        const startSlot = timeSlots[c.startSlotIndex];
        const endSlot = timeSlots[c.endSlotIndex];
        if (!startSlot || !endSlot)
          return false;
        const startTime = parseTime(startSlot.start);
        const endTime = parseTime(endSlot.end);
        return currentTimeVal >= startTime - 15 && currentTimeVal <= endTime + 15;
      }) || null;
    },
    onCoursePickerChange(e = null) {
      var _a;
      const idx = Number(((_a = e === null || e === void 0 ? null : e.detail) === null || _a === void 0 ? null : _a.value) || 0);
      const c = (this.courses || [])[idx];
      if (c)
        this.selectCourse(c);
    },
    selectCourse(course = null) {
      this.clearPolling();
      this.currentCourse = course;
      this.currentRoom = null;
      this.sessions = [];
      this.activeSession = null;
      this.selectedSessionId = null;
      this.signIns = [];
      this.signInBySeat = new common_vendor.UTSJSONObject({});
      this.fixedSeatBySeat = new common_vendor.UTSJSONObject({});
      this.leavesByStudentId = new common_vendor.UTSJSONObject({});
      this.leaveDraftRows = [];
      this.alerts = [];
      this.showLeaveEditor = false;
      this.showAlerts = false;
      this.selectedSeatLabel = "";
      this.seats = [];
      return this.loadRoomForCourse(course).then(() => {
        return this.loadFixedSeats(course);
      }).then(() => {
        return this.loadSessions(course.id);
      });
    },
    loadRoomForCourse(course = null) {
      const roomId = ((course === null || course === void 0 ? null : course.location) || "").trim();
      if (!roomId)
        return Promise.resolve();
      return this.apiFetch(`/roomseat?room_id=${encodeURIComponent(roomId)}`).then((r = null) => {
        this.currentRoom = r || null;
        const raw = r === null || r === void 0 ? null : r.seat_pos;
        let parsed = raw;
        if (typeof parsed === "string") {
          try {
            parsed = common_vendor.UTS.JSON.parse(parsed);
          } catch (e) {
            parsed = null;
          }
        }
        if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.seats))
          parsed = parsed.seats;
        if (!Array.isArray(parsed))
          parsed = [];
        this.applySeats(parsed);
      }).catch((e = null) => {
        this.currentRoom = null;
        this.seats = [];
        common_vendor.index.showToast({ title: (e === null || e === void 0 ? null : e.message) || "加载教室失败", icon: "none" });
      });
    },
    applySeats(seatList = null) {
      const padding = 24;
      const seatOuter = Math.max(Number(this.SEAT_SIZE || 0), 58);
      let minX = Infinity;
      let minY = Infinity;
      let maxRight = 0;
      let maxBottom = 0;
      const raw = (seatList || []).map((s = null, idx = null) => {
        const seatNumber = (s === null || s === void 0 ? null : s.seatNumber) || (s === null || s === void 0 ? null : s.label) || "";
        const x = Number((s === null || s === void 0 ? null : s.x) || 0);
        const y = Number((s === null || s === void 0 ? null : s.y) || 0);
        let px = x * this.SEAT_SIZE + padding;
        let py = y * this.SEAT_SIZE + padding;
        if (!(x < 100 && y < 100)) {
          px = x;
          py = y;
        }
        if (px < minX)
          minX = px;
        if (py < minY)
          minY = py;
        return new common_vendor.UTSJSONObject({ idx, seatNumber, px, py });
      });
      if (!isFinite(minX))
        minX = 0;
      if (!isFinite(minY))
        minY = 0;
      const shiftX = minX < padding ? padding - minX : 0;
      const shiftY = minY < padding ? padding - minY : 0;
      const out = raw.map((_a) => {
        var idx = _a.idx, seatNumber = _a.seatNumber, px = _a.px, py = _a.py;
        const x = px + shiftX;
        const y = py + shiftY;
        const right = x + seatOuter;
        const bottom = y + seatOuter;
        if (right > maxRight)
          maxRight = right;
        if (bottom > maxBottom)
          maxBottom = bottom;
        return new common_vendor.UTSJSONObject({
          id: `seat-${idx}`,
          x,
          y,
          seatNumber,
          status: 0,
          displayName: "",
          badge: ""
        });
      });
      this.canvasWidth = Math.max(320, Math.ceil(maxRight + padding));
      this.canvasHeight = Math.max(360, Math.ceil(maxBottom + padding));
      this.seats = out;
      this.recomputeSeatStates();
    },
    loadFixedSeats(course = null) {
      if (!(course === null || course === void 0 ? null : course.fixed_seat_enabled))
        return Promise.resolve();
      const id = course.id;
      if (!id)
        return Promise.resolve();
      return this.apiFetch(`/courses/${id}/fixed-seats`).then((d = null) => {
        var e_2, _a, e_3, _b;
        const list = Array.isArray(d === null || d === void 0 ? null : d.assignments) ? d.assignments : [];
        const idToName = /* @__PURE__ */ new Map();
        const members = this.getCourseMembers(course);
        try {
          for (var members_1 = common_vendor.__values(members), members_1_1 = members_1.next(); !members_1_1.done; members_1_1 = members_1.next()) {
            var m = members_1_1.value;
            const sid = String((m === null || m === void 0 ? null : m.studentId) || "").trim();
            const name = String((m === null || m === void 0 ? null : m.name) || "").trim();
            if (!sid)
              continue;
            idToName.set(sid, name);
          }
        } catch (e_2_1) {
          e_2 = { error: e_2_1 };
        } finally {
          try {
            if (members_1_1 && !members_1_1.done && (_a = members_1.return))
              _a.call(members_1);
          } finally {
            if (e_2)
              throw e_2.error;
          }
        }
        const next = new common_vendor.UTSJSONObject({});
        try {
          for (var list_1 = common_vendor.__values(list), list_1_1 = list_1.next(); !list_1_1.done; list_1_1 = list_1.next()) {
            var a = list_1_1.value;
            const sid = String((a === null || a === void 0 ? null : a.student_id) || "").trim();
            const seat = String((a === null || a === void 0 ? null : a.seat_label) || "").trim();
            if (!sid || !seat)
              continue;
            next[seat] = new common_vendor.UTSJSONObject({ studentId: sid, studentName: common_vendor.UTS.mapGet(idToName, sid) || "" });
          }
        } catch (e_3_1) {
          e_3 = { error: e_3_1 };
        } finally {
          try {
            if (list_1_1 && !list_1_1.done && (_b = list_1.return))
              _b.call(list_1);
          } finally {
            if (e_3)
              throw e_3.error;
          }
        }
        this.fixedSeatBySeat = next;
        this.recomputeSeatStates();
      }).catch(() => {
        this.fixedSeatBySeat = new common_vendor.UTSJSONObject({});
      });
    },
    loadSessions(courseId = null) {
      if (!courseId)
        return Promise.resolve();
      return Promise.all([
        this.apiFetch(`/sessions/active?course_id=${courseId}`),
        this.apiFetch(`/sessions?course_id=${courseId}&limit=100`)
      ]).then((_a) => {
        var _b;
        var _c = common_vendor.__read(_a, 2), a = _c[0], l = _c[1];
        const active = (a === null || a === void 0 ? null : a.session) || null;
        const list = Array.isArray(l === null || l === void 0 ? null : l.sessions) ? l.sessions : [];
        this.activeSession = active;
        this.sessions = list;
        const defaultId = (active === null || active === void 0 ? null : active.id) || ((_b = list[0]) === null || _b === void 0 ? null : _b.id) || null;
        this.selectedSessionId = defaultId;
        if (defaultId) {
          return Promise.all([
            this.fetchSignIns(defaultId),
            this.fetchLeaves(defaultId),
            this.fetchAlerts(defaultId)
          ]).then(() => {
            this.setupPolling();
          });
        }
        this.clearPolling();
        return Promise.resolve();
      }).catch((e = null) => {
        common_vendor.index.showToast({ title: (e === null || e === void 0 ? null : e.message) || "加载场次失败", icon: "none" });
      });
    },
    onSessionPickerChange(e = null) {
      var _a;
      const idx = Number(((_a = e === null || e === void 0 ? null : e.detail) === null || _a === void 0 ? null : _a.value) || 0);
      const s = (this.sessions || [])[idx];
      if (!s)
        return null;
      this.selectedSessionId = s.id;
      Promise.all([this.fetchSignIns(s.id), this.fetchLeaves(s.id), this.fetchAlerts(s.id)]).then(() => {
        return this.setupPolling();
      });
    },
    fetchSignIns(sessionId = null) {
      if (!sessionId)
        return Promise.resolve();
      return this.apiFetch(`/sessions/${sessionId}/signins`).then((d = null) => {
        var e_4, _a;
        this.signIns = Array.isArray(d === null || d === void 0 ? null : d.sign_ins) ? d.sign_ins : [];
        const m = new common_vendor.UTSJSONObject({});
        try {
          for (var _b = common_vendor.__values(this.signIns || []), _c = _b.next(); !_c.done; _c = _b.next()) {
            var s = _c.value;
            const seat = String((s === null || s === void 0 ? null : s.seat_label) || "").trim();
            if (!seat)
              continue;
            m[seat] = s;
          }
        } catch (e_4_1) {
          e_4 = { error: e_4_1 };
        } finally {
          try {
            if (_c && !_c.done && (_a = _b.return))
              _a.call(_b);
          } finally {
            if (e_4)
              throw e_4.error;
          }
        }
        this.signInBySeat = m;
        this.recomputeSeatStates();
      }).catch((e = null) => {
        common_vendor.index.showToast({ title: (e === null || e === void 0 ? null : e.message) || "加载签到失败", icon: "none" });
      });
    },
    fetchLeaves(sessionId = null) {
      if (!sessionId)
        return Promise.resolve();
      return this.apiFetch(`/sessions/${sessionId}/leaves`).then((d = null) => {
        var e_5, _a;
        const rows = Array.isArray(d === null || d === void 0 ? null : d.leaves) ? d.leaves : [];
        const m = new common_vendor.UTSJSONObject({});
        try {
          for (var rows_1 = common_vendor.__values(rows), rows_1_1 = rows_1.next(); !rows_1_1.done; rows_1_1 = rows_1.next()) {
            var r = rows_1_1.value;
            const sid = String((r === null || r === void 0 ? null : r.student_id) || "").trim();
            if (!sid)
              continue;
            m[sid] = String((r === null || r === void 0 ? null : r.reason) || "");
          }
        } catch (e_5_1) {
          e_5 = { error: e_5_1 };
        } finally {
          try {
            if (rows_1_1 && !rows_1_1.done && (_a = rows_1.return))
              _a.call(rows_1);
          } finally {
            if (e_5)
              throw e_5.error;
          }
        }
        this.leavesByStudentId = m;
        this.recomputeSeatStates();
      }).catch(() => {
        this.leavesByStudentId = new common_vendor.UTSJSONObject({});
        this.recomputeSeatStates();
      });
    },
    fetchAlerts(sessionId = null) {
      if (!sessionId)
        return Promise.resolve();
      return this.apiFetch(`/sessions/${sessionId}/alerts`).then((d = null) => {
        this.alerts = Array.isArray(d === null || d === void 0 ? null : d.alerts) ? d.alerts : [];
      }).catch(() => {
        this.alerts = [];
      });
    },
    recomputeSeatStates() {
      var _a;
      const fixedEnabled = !!((_a = this.currentCourse) === null || _a === void 0 ? null : _a.fixed_seat_enabled);
      const next = (this.seats || []).map((seat) => {
        var _a2, _b;
        const label = seat.seatNumber;
        const rec = ((_a2 = this.signInBySeat) === null || _a2 === void 0 ? null : _a2[label]) || null;
        let status = 0;
        let displayName = "";
        let badge = "";
        if (rec) {
          const q = String((rec === null || rec === void 0 ? null : rec.sign_quality) || "").trim();
          const st = String((rec === null || rec === void 0 ? null : rec.status) || "").trim();
          if (st === "late") {
            status = 4;
            badge = "迟";
          } else {
            status = q === "warn" ? 2 : 1;
          }
          displayName = String((rec === null || rec === void 0 ? null : rec.student_name) || "").trim();
        } else if (fixedEnabled) {
          const a = ((_b = this.fixedSeatBySeat) === null || _b === void 0 ? null : _b[label]) || null;
          if (a) {
            const sid = String(a.studentId || "").trim();
            const name = String(a.studentName || "").trim();
            displayName = name || sid;
            const hasLeave = !!sid && Object.prototype.hasOwnProperty.call(this.leavesByStudentId || new common_vendor.UTSJSONObject({}), sid);
            if (hasLeave) {
              status = 3;
              badge = "假";
            }
          }
        }
        return new common_vendor.UTSJSONObject(Object.assign(Object.assign({}, seat), { status, displayName, badge }));
      });
      this.seats = next;
    },
    setupPolling() {
      this.clearPolling();
      if (!this.autoRefresh)
        return null;
      if (!this.activeSession || !this.selectedSessionId || this.activeSession.id !== this.selectedSessionId)
        return null;
      this.pollTimer = setInterval(() => {
        this.fetchSignIns(this.selectedSessionId);
        this.fetchLeaves(this.selectedSessionId);
        this.fetchAlerts(this.selectedSessionId);
      }, 3e3);
    },
    clearPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },
    toggleAutoRefresh() {
      this.autoRefresh = !this.autoRefresh;
      this.setupPolling();
    },
    refreshAll() {
      if (!this.currentCourse)
        return null;
      this.loadSessions(this.currentCourse.id);
    },
    toggleLeaveEditor() {
      if (!this.selectedSessionId) {
        common_vendor.index.showToast({ title: "请先选择场次", icon: "none" });
        return null;
      }
      this.showLeaveEditor = !this.showLeaveEditor;
      if (this.showLeaveEditor) {
        this.openLeaveEditor();
      }
    },
    openLeaveEditor() {
      const members = this.getCourseMembers(this.currentCourse);
      const arr = members.slice().sort((a = null, b = null) => {
        return String(a.studentId).localeCompare(String(b.studentId), "zh-CN");
      }).map((m = null) => {
        var _a;
        return new common_vendor.UTSJSONObject({
          studentId: String(m.studentId || "").trim(),
          name: String(m.name || "").trim(),
          onLeave: Object.prototype.hasOwnProperty.call(this.leavesByStudentId || new common_vendor.UTSJSONObject({}), String(m.studentId || "").trim()),
          reason: String(((_a = this.leavesByStudentId) === null || _a === void 0 ? null : _a[String(m.studentId || "").trim()]) || "")
        });
      }).filter((x = null) => {
        return x.studentId;
      });
      this.leaveDraftRows = arr;
    },
    toggleLeaveRow(idx = null) {
      const rows = Array.isArray(this.leaveDraftRows) ? this.leaveDraftRows : [];
      const r = rows[idx];
      if (!r)
        return null;
      r.onLeave = !r.onLeave;
      if (!r.onLeave)
        r.reason = "";
      this.leaveDraftRows = rows;
    },
    saveLeaves() {
      if (!this.selectedSessionId)
        return null;
      const leaves = (Array.isArray(this.leaveDraftRows) ? this.leaveDraftRows : []).filter((r = null) => {
        return (r === null || r === void 0 ? null : r.onLeave) && String((r === null || r === void 0 ? null : r.studentId) || "").trim();
      }).map((r = null) => {
        return new common_vendor.UTSJSONObject({ student_id: String(r.studentId).trim(), reason: String(r.reason || "").trim() });
      });
      this.apiFetch(`/sessions/${this.selectedSessionId}/leaves`, new common_vendor.UTSJSONObject({
        method: "PUT",
        data: new common_vendor.UTSJSONObject({ leaves })
      })).then(() => {
        this.showLeaveEditor = false;
        this.fetchLeaves(this.selectedSessionId);
        common_vendor.index.showToast({ title: "已保存", icon: "none" });
      }).catch((e = null) => {
        common_vendor.index.showToast({ title: (e === null || e === void 0 ? null : e.message) || "保存失败", icon: "none" });
      });
    },
    toggleAlerts() {
      this.showAlerts = !this.showAlerts;
      if (this.showAlerts && this.selectedSessionId) {
        this.fetchAlerts(this.selectedSessionId);
      }
    },
    startSession() {
      var _a, _b;
      if (!this.currentCourse)
        return null;
      const roomId = (((_a = this.currentRoom) === null || _a === void 0 ? null : _a.room_id) || ((_b = this.currentCourse) === null || _b === void 0 ? null : _b.location) || "").trim();
      common_vendor.index.showModal(new common_vendor.UTSJSONObject({
        content: `确定开始签到吗？
课程：${this.currentCourse.name}
教室：${roomId || "-"}`,
        success: (r) => {
          if (!r.confirm)
            return null;
          this.apiFetch("/sessions", new common_vendor.UTSJSONObject({
            method: "POST",
            data: new common_vendor.UTSJSONObject({ course_id: this.currentCourse.id, room_id: roomId })
          })).then((d = null) => {
            if (d === null || d === void 0 ? null : d.session) {
              this.activeSession = d.session;
              this.selectedSessionId = d.session.id;
              this.autoRefresh = true;
              this.fetchSignIns(d.session.id).then(() => {
                return this.setupPolling();
              });
              this.loadSessions(this.currentCourse.id);
              common_vendor.index.showToast({ title: "已开始", icon: "none" });
            }
          }).catch((e = null) => {
            common_vendor.index.showToast({ title: (e === null || e === void 0 ? null : e.message) || "开始失败", icon: "none" });
          });
        }
      }));
    },
    endSession() {
      if (!this.activeSession)
        return null;
      common_vendor.index.showModal(new common_vendor.UTSJSONObject({
        content: "确定结束当前签到吗？",
        success: (r) => {
          if (!r.confirm)
            return null;
          const id = this.activeSession.id;
          this.apiFetch(`/sessions/${id}/end`, new common_vendor.UTSJSONObject({ method: "POST" })).then(() => {
            var _a;
            this.activeSession = null;
            this.autoRefresh = false;
            this.setupPolling();
            this.fetchSignIns(id);
            if ((_a = this.currentCourse) === null || _a === void 0 ? null : _a.id)
              this.loadSessions(this.currentCourse.id);
            common_vendor.index.showToast({ title: "已结束", icon: "none" });
          }).catch((e = null) => {
            common_vendor.index.showToast({ title: (e === null || e === void 0 ? null : e.message) || "结束失败", icon: "none" });
          });
        }
      }));
    },
    toggleSignInList() {
      this.showSignInList = !this.showSignInList;
    },
    selectSeat(label = null) {
      this.selectedSeatLabel = label === this.selectedSeatLabel ? "" : label;
    },
    seatClass(seat = null) {
      return new common_vendor.UTSJSONObject({
        ok: seat.status === 1,
        warn: seat.status === 2,
        leave: seat.status === 3,
        late: seat.status === 4,
        empty: seat.status === 0,
        selected: seat.seatNumber === this.selectedSeatLabel
      });
    },
    seatStyle(seat = null) {
      return new common_vendor.UTSJSONObject({ left: seat.x + "px", top: seat.y + "px" });
    },
    warnReasonText(raw = null) {
      var e_6, _a;
      const s = String(raw || "").trim();
      if (!s)
        return "";
      const map = new common_vendor.UTSJSONObject({
        auth_invalid: "微信登录已失效/未登录",
        wifi_missing: "未连接指定WiFi",
        wifi_not_whitelisted: "WiFi不在白名单",
        gps_missing: "未获取定位",
        gps_out_of_range: "定位不在允许范围内",
        ip_not_whitelisted: "出口IP不在允许范围内"
      });
      const parts = s.split(",").map((x) => {
        return x.trim();
      }).filter(Boolean);
      const out = [];
      try {
        for (var parts_1 = common_vendor.__values(parts), parts_1_1 = parts_1.next(); !parts_1_1.done; parts_1_1 = parts_1.next()) {
          var p = parts_1_1.value;
          out.push(map[p] || p);
        }
      } catch (e_6_1) {
        e_6 = { error: e_6_1 };
      } finally {
        try {
          if (parts_1_1 && !parts_1_1.done && (_a = parts_1.return))
            _a.call(parts_1);
        } finally {
          if (e_6)
            throw e_6.error;
        }
      }
      return out.join("、");
    },
    getCourseMembers(course = null) {
      if (!course)
        return [];
      const mode = String(course.memberMode || "").trim();
      if (mode === "independent") {
        const arr = Array.isArray(course.members) ? course.members : [];
        return arr.map((m = null) => {
          return new common_vendor.UTSJSONObject({
            studentId: String((m === null || m === void 0 ? null : m.studentId) || (m === null || m === void 0 ? null : m.student_id) || "").trim(),
            name: String((m === null || m === void 0 ? null : m.name) || "").trim()
          });
        }).filter((m = null) => {
          return m.studentId;
        });
      }
      if (mode === "class") {
        const rid = String(course.classRosterId || "").trim();
        const roster = common_vendor.UTS.arrayFind(this.rosters || [], (r) => {
          return String(r === null || r === void 0 ? null : r.id) === rid;
        });
        const arr = Array.isArray(roster === null || roster === void 0 ? null : roster.members) ? roster.members : [];
        return arr.map((m = null) => {
          return new common_vendor.UTSJSONObject({
            studentId: String((m === null || m === void 0 ? null : m.studentId) || (m === null || m === void 0 ? null : m.student_id) || "").trim(),
            name: String((m === null || m === void 0 ? null : m.name) || "").trim()
          });
        }).filter((m = null) => {
          return m.studentId;
        });
      }
      return [];
    },
    formatTime(v = null) {
      if (!v)
        return "-";
      const s = String(v);
      if (s.length >= 19)
        return s.slice(0, 19).replace("T", " ");
      return s;
    }
  }
});
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  "raw js";
  var _a;
  return common_vendor.e({
    a: !$data.token
  }, !$data.token ? {
    b: $data.username,
    c: common_vendor.o(($event) => $data.username = $event.detail.value, "cb"),
    d: $data.password,
    e: common_vendor.o(($event) => $data.password = $event.detail.value, "54"),
    f: common_vendor.o((...args) => $options.doLogin && $options.doLogin(...args), "ce"),
    g: $data.loading
  } : common_vendor.e({
    h: common_vendor.t(((_a = $data.me) == null ? void 0 : _a.username) || "已登录"),
    i: common_vendor.t($data.activeSession ? "签到进行中" : "无进行中签到"),
    j: common_vendor.n($data.activeSession ? "chip-ok" : "chip-warn"),
    k: common_vendor.t($data.autoRefresh ? "自动刷新" : "手动刷新"),
    l: common_vendor.t($data.currentCourse ? $data.currentCourse.name : "选择课程"),
    m: $options.coursePickerLabels,
    n: $options.coursePickerIndex,
    o: common_vendor.o((...args) => $options.onCoursePickerChange && $options.onCoursePickerChange(...args), "34"),
    p: common_vendor.t($options.selectedSessionLabel || "选择场次"),
    q: $options.sessionPickerLabels,
    r: $options.sessionPickerIndex,
    s: common_vendor.o((...args) => $options.onSessionPickerChange && $options.onSessionPickerChange(...args), "79"),
    t: common_vendor.t($options.courseSubline),
    v: common_vendor.t($data.autoRefresh ? "⏸" : "▶"),
    w: common_vendor.o((...args) => $options.toggleAutoRefresh && $options.toggleAutoRefresh(...args), "5a"),
    x: common_vendor.o((...args) => $options.refreshAll && $options.refreshAll(...args), "06"),
    y: common_vendor.o((...args) => $options.toggleLeaveEditor && $options.toggleLeaveEditor(...args), "71"),
    z: common_vendor.o((...args) => $options.toggleSignInList && $options.toggleSignInList(...args), "70"),
    A: common_vendor.o((...args) => $options.toggleAlerts && $options.toggleAlerts(...args), "e2"),
    B: !$data.activeSession
  }, !$data.activeSession ? {
    C: common_vendor.o((...args) => $options.startSession && $options.startSession(...args), "da"),
    D: !$data.currentCourse
  } : {
    E: common_vendor.o((...args) => $options.endSession && $options.endSession(...args), "44")
  }, {
    F: common_vendor.f($data.seats, (seat, k0, i0) => {
      return common_vendor.e({
        a: common_vendor.t(seat.seatNumber),
        b: seat.displayName
      }, seat.displayName ? {
        c: common_vendor.t(seat.displayName)
      } : {}, {
        d: seat.badge
      }, seat.badge ? {
        e: common_vendor.t(seat.badge)
      } : {}, {
        f: seat.id,
        g: common_vendor.n($options.seatClass(seat)),
        h: common_vendor.s($options.seatStyle(seat)),
        i: common_vendor.o(($event) => $options.selectSeat(seat.seatNumber), seat.id)
      });
    }),
    G: !$data.seats.length
  }, !$data.seats.length ? {} : {}, {
    H: $data.canvasWidth + "px",
    I: $data.canvasHeight + "px",
    J: $options.showProgress
  }, $options.showProgress ? {
    K: common_vendor.t($options.progressText),
    L: $options.progressPercent + "%"
  } : {
    M: common_vendor.t($options.signedCount)
  }, {
    N: common_vendor.o((...args) => $options.logout && $options.logout(...args), "fc"),
    O: $data.selectedSeatLabel
  }, $data.selectedSeatLabel ? common_vendor.e({
    P: common_vendor.t($data.selectedSeatLabel),
    Q: common_vendor.t($options.selectedSeatInfo.statusText),
    R: $options.selectedSeatInfo.studentId || $options.selectedSeatInfo.studentName
  }, $options.selectedSeatInfo.studentId || $options.selectedSeatInfo.studentName ? {
    S: common_vendor.t($options.selectedSeatInfo.studentName || "-"),
    T: common_vendor.t($options.selectedSeatInfo.studentId || "-")
  } : {}, {
    U: $options.selectedSeatInfo.timeText
  }, $options.selectedSeatInfo.timeText ? {
    V: common_vendor.t($options.selectedSeatInfo.timeText)
  } : {}, {
    W: $options.selectedSeatInfo.warnText
  }, $options.selectedSeatInfo.warnText ? {
    X: common_vendor.t($options.selectedSeatInfo.warnText)
  } : {}, {
    Y: $options.selectedSeatInfo.leaveReason
  }, $options.selectedSeatInfo.leaveReason ? {
    Z: common_vendor.t($options.selectedSeatInfo.leaveReason)
  } : {}) : {}, {
    aa: $data.showSignInList
  }, $data.showSignInList ? common_vendor.e({
    ab: common_vendor.t($data.signIns.length),
    ac: common_vendor.o((...args) => $options.toggleSignInList && $options.toggleSignInList(...args), "f6"),
    ad: common_vendor.f($data.signIns, (s, idx, i0) => {
      return {
        a: common_vendor.t(s.student_name || "-"),
        b: common_vendor.t(s.student_id || "-"),
        c: common_vendor.t(s.seat_label || "-"),
        d: common_vendor.t(s.status === "late" ? " · 迟到" : ""),
        e: common_vendor.t(s.sign_quality === "warn" ? " · 异常" : ""),
        f: common_vendor.t($options.formatTime(s.time)),
        g: idx
      };
    }),
    ae: !$data.signIns.length
  }, !$data.signIns.length ? {} : {}, {
    af: common_vendor.o(() => {
    }, "8b"),
    ag: common_vendor.o((...args) => $options.toggleSignInList && $options.toggleSignInList(...args), "69")
  }) : {}, {
    ah: $data.showAlerts
  }, $data.showAlerts ? common_vendor.e({
    ai: common_vendor.t($data.alerts.length),
    aj: common_vendor.o((...args) => $options.toggleAlerts && $options.toggleAlerts(...args), "2f"),
    ak: common_vendor.f($data.alerts, (a, idx, i0) => {
      return {
        a: common_vendor.t(a.message || "-"),
        b: common_vendor.t(a.student_id || "-"),
        c: common_vendor.t(a.seat_label || "-"),
        d: common_vendor.t($options.formatTime(a.created_at)),
        e: idx
      };
    }),
    al: !$data.alerts.length
  }, !$data.alerts.length ? {} : {}, {
    am: common_vendor.o(() => {
    }, "b1"),
    an: common_vendor.o((...args) => $options.toggleAlerts && $options.toggleAlerts(...args), "c2")
  }) : {}, {
    ao: $data.showLeaveEditor
  }, $data.showLeaveEditor ? common_vendor.e({
    ap: common_vendor.o((...args) => $options.saveLeaves && $options.saveLeaves(...args), "1a"),
    aq: common_vendor.f($data.leaveDraftRows, (r, idx, i0) => {
      return {
        a: common_vendor.t(r.onLeave ? "✓" : ""),
        b: !!r.onLeave ? 1 : "",
        c: common_vendor.o(($event) => $options.toggleLeaveRow(idx), r.studentId),
        d: common_vendor.t(r.name || "-"),
        e: common_vendor.t(r.studentId),
        f: !r.onLeave,
        g: r.reason,
        h: common_vendor.o(($event) => r.reason = $event.detail.value, r.studentId),
        i: r.studentId
      };
    }),
    ar: !$data.leaveDraftRows.length
  }, !$data.leaveDraftRows.length ? {} : {}, {
    as: common_vendor.o(() => {
    }, "2b"),
    at: common_vendor.o((...args) => $options.toggleLeaveEditor && $options.toggleLeaveEditor(...args), "ab")
  }) : {}), {
    av: common_vendor.sei(common_vendor.gei(_ctx, ""), "view"),
    aw: `${_ctx.u_s_b_h}px`,
    ax: common_vendor.pvhc(_ctx.$scope.data.virtualHostClass)
  });
}
const MiniProgramPage = /* @__PURE__ */ common_vendor._export_sfc(_sfc_main, [["render", _sfc_render], ["__scopeId", "data-v-00a60067"]]);
wx.createPage(MiniProgramPage);
//# sourceMappingURL=../../../.sourcemap/mp-weixin/pages/index/index.js.map
