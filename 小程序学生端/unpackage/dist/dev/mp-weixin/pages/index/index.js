"use strict";
const common_vendor = require("../../common/vendor.js");
const common_assets = require("../../common/assets.js");
const _sfc_main = common_vendor.defineComponent({
  computed: {
    prettySignRequest() {
      if (!this.signRequest)
        return "-";
      if (typeof this.signRequest === "string")
        return this.signRequest;
      try {
        return common_vendor.UTS.JSON.stringify(this.signRequest);
      } catch (e) {
        return String(this.signRequest);
      }
    }
  },
  data() {
    return {
      apiBase: "http://10.62.128.98:8080",
      wxToken: "",
      wxBound: false,
      studentName: "",
      studentId: "",
      signCode: "",
      signRequest: "",
      connectedWifi: "",
      wifiSSID: "",
      wifiBSSID: "",
      lastLatitude: 0,
      lastLongitude: 0,
      wifiList: [],
      showWifiList: false,
      absences: [],
      showAbsenceModal: false
    };
  },
  onLoad() {
    const t = common_vendor.index.getStorageSync("wx_token");
    if (t)
      this.wxToken = String(t);
    const b = common_vendor.index.getStorageSync("student_binding");
    if (b && b.student_id && b.student_name) {
      this.wxBound = true;
      this.studentId = b.student_id;
      this.studentName = b.student_name;
    }
    this.ensureWxLogin(true).then(() => {
      this.fetchAbsenceAlerts();
    }).catch(() => {
    });
  },
  methods: {
    requestJson(_a) {
      var url = _a.url, method = _a.method, data = _a.data, header = _a.header, timeout = _a.timeout;
      return new Promise((resolve, reject) => {
        common_vendor.index.request({
          url,
          method: method || "GET",
          header: header || new common_vendor.UTSJSONObject({ "content-type": "application/json" }),
          data,
          timeout: timeout || 12e3,
          success: (res) => {
            return resolve(res);
          },
          fail: (err) => {
            return reject(err);
          }
        });
      });
    },
    ensureWxLogin(force = null) {
      if (!force && this.wxToken)
        return Promise.resolve(this.wxToken);
      return new Promise((resolve, reject) => {
        common_vendor.index.login(new common_vendor.UTSJSONObject({
          provider: "weixin",
          success: (r) => {
            const code = r.code;
            if (!code)
              return reject(new Error("获取微信登录凭证失败"));
            this.requestJson({
              url: `${this.apiBase}/wx/login`,
              method: "POST",
              data: new common_vendor.UTSJSONObject({ code }),
              header: new common_vendor.UTSJSONObject({ "content-type": "application/json" }),
              timeout: 12e3
            }).then((res = null) => {
              const body = res.data;
              if (res.statusCode !== 200 || !body || body.code !== 0) {
                return reject(new Error((body === null || body === void 0 ? null : body.message) || "微信登录失败"));
              }
              const data = body.data || new common_vendor.UTSJSONObject({});
              const token = String(data.token || "");
              if (!token)
                return reject(new Error("微信登录失败：缺少token"));
              this.wxToken = token;
              common_vendor.index.setStorageSync("wx_token", token);
              resolve(token);
            }).catch((e = null) => {
              return reject(new Error((e === null || e === void 0 ? null : e.errMsg) || (e === null || e === void 0 ? null : e.message) || "微信登录失败"));
            });
          },
          fail: (err) => {
            return reject(new Error((err === null || err === void 0 ? null : err.errMsg) || "微信登录失败"));
          }
        }));
      });
    },
    outOfChina(lat = null, lng = null) {
      return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
    },
    gcj02ToBd09(lat = null, lng = null) {
      const x = lng;
      const y = lat;
      const z = Math.sqrt(x * x + y * y) + 2e-5 * Math.sin(y * Math.PI * 3e3 / 180);
      const theta = Math.atan2(y, x) + 3e-6 * Math.cos(x * Math.PI * 3e3 / 180);
      const bdLng = z * Math.cos(theta) + 65e-4;
      const bdLat = z * Math.sin(theta) + 6e-3;
      return new common_vendor.UTSJSONObject({ lat: bdLat, lng: bdLng });
    },
    bindStudent() {
      if (!this.studentName.trim() || !this.studentId.trim()) {
        common_vendor.index.showToast({ title: "请先填写姓名和学号", icon: "none" });
        return Promise.reject(new Error("missing student info"));
      }
      this.studentId = this.studentId.trim();
      this.studentName = this.studentName.trim();
      common_vendor.index.setStorageSync("student_binding", new common_vendor.UTSJSONObject({ student_id: this.studentId, student_name: this.studentName }));
      this.wxBound = true;
      common_vendor.index.showToast({ title: "已保存" });
      return Promise.resolve();
    },
    unlockEdit() {
      this.wxBound = false;
      common_vendor.index.showToast({ title: "已解锁，可修改后保存", icon: "none" });
    },
    toggleWifiList() {
      this.showWifiList = !this.showWifiList;
    },
    fetchAbsenceAlerts(retried = null) {
      if (!this.wxToken) {
        common_vendor.index.showToast({ title: "请先登录微信", icon: "none" });
        return null;
      }
      this.requestJson({
        url: `${this.apiBase}/absences/alerts`,
        method: "GET",
        header: new common_vendor.UTSJSONObject({
          "content-type": "application/json",
          Authorization: `Bearer ${this.wxToken}`
        }),
        timeout: 1e4
      }).then((res = null) => {
        var _a, _b, _c;
        const code = (_a = res.data) === null || _a === void 0 ? null : _a.code;
        const msg = String(((_b = res.data) === null || _b === void 0 ? null : _b.message) || "");
        if ((res.statusCode === 401 || res.statusCode === 400 && msg.includes("openid") || msg.includes("未登录") || msg.includes("登录已失效")) && !retried) {
          return this.ensureWxLogin(true).then(() => {
            return this.fetchAbsenceAlerts(true);
          }).catch(() => {
            common_vendor.index.showToast({ title: "登录已失效，请重新登录", icon: "none" });
          });
        }
        if (res.statusCode === 200 && res.data && code === 0) {
          const alerts = ((_c = res.data.data) === null || _c === void 0 ? null : _c.alerts) || [];
          this.absences = Array.isArray(alerts) ? alerts : [];
          this.showAbsenceModal = true;
          return null;
        }
        common_vendor.index.showToast({ title: msg || `请求失败(${res.statusCode})`, icon: "none" });
      }).catch((e = null) => {
        common_vendor.index.showToast({ title: (e === null || e === void 0 ? null : e.errMsg) || (e === null || e === void 0 ? null : e.message) || "网络请求失败", icon: "none" });
      });
    },
    scanQRCode() {
      Promise.resolve().then(() => {
        return this.ensureWxLogin(false).catch(() => {
          return "";
        });
      }).then(() => {
        if (!this.wxBound) {
          common_vendor.index.showToast({ title: "请先绑定学号姓名", icon: "none" });
          throw new Error("not bound");
        }
        common_vendor.index.scanCode(new common_vendor.UTSJSONObject({
          success: (res) => {
            common_vendor.index.__f__("log", "at pages/index/index.uvue:300", "扫描结果：" + res.result);
            this.signCode = res.result;
            let requestData = null;
            try {
              requestData = common_vendor.UTS.JSON.parse(this.signCode);
            } catch (e) {
              common_vendor.index.showToast({ title: "二维码内容不是JSON", icon: "none" });
              return null;
            }
            const proceed = () => {
              const submit = () => {
                const payload = new common_vendor.UTSJSONObject(Object.assign(Object.assign({}, requestData), { student_id: this.studentId.trim(), student_name: this.studentName.trim(), device_id: this.wifiBSSID || "", latitude: this.lastLatitude || 0, longitude: this.lastLongitude || 0 }));
                const formatReasons = (reasons = null) => {
                  const arr = Array.isArray(reasons) ? reasons : [];
                  const map = new common_vendor.UTSJSONObject({
                    auth_invalid: "微信登录已失效/未登录",
                    wifi_missing: "未连接指定 WiFi",
                    wifi_not_whitelisted: "WiFi 不在白名单",
                    ip_not_whitelisted: "出口IP不在允许范围内",
                    gps_missing: "未获取定位",
                    gps_out_of_range: "定位不在允许范围内"
                  });
                  const lines = arr.map((r = null) => {
                    return map[r] || String(r);
                  }).filter(Boolean);
                  return lines.length ? lines.join("\n") : "检测到异常签到";
                };
                const postOnce = (retried = null, confirmed = null) => {
                  payload.confirm_abnormal = !!confirmed;
                  this.requestJson({
                    url: `${this.apiBase}/signin`,
                    method: "POST",
                    header: new common_vendor.UTSJSONObject({
                      "content-type": "application/json",
                      Authorization: `Bearer ${this.wxToken}`
                    }),
                    data: payload,
                    timeout: 15e3
                  }).then((res2 = null) => {
                    var _a, _b, _c, _d, _e;
                    this.signRequest = res2.data;
                    if (res2.statusCode === 401 && !retried) {
                      return this.ensureWxLogin(true).then(() => {
                        return postOnce(true, confirmed);
                      });
                    }
                    if (res2.statusCode === 200 && res2.data && res2.data.code === 1001 && !confirmed) {
                      const reasons = (_b = (_a = res2.data) === null || _a === void 0 ? null : _a.data) === null || _b === void 0 ? null : _b.reasons;
                      common_vendor.index.showModal(new common_vendor.UTSJSONObject({
                        title: "异常签到确认",
                        content: formatReasons(reasons) + "\n\n是否确认继续签到？",
                        success: (r) => {
                          if (r.confirm)
                            postOnce(retried, true);
                        }
                      }));
                      return null;
                    }
                    if (res2.statusCode === 200 && res2.data && res2.data.code === 0) {
                      const status = (_d = (_c = res2.data) === null || _c === void 0 ? null : _c.data) === null || _d === void 0 ? null : _d.status;
                      if (status === "late") {
                        common_vendor.index.showToast({ title: "迟到签到成功" });
                      } else {
                        common_vendor.index.showToast({ title: "签到成功" });
                      }
                    } else {
                      const msg = ((_e = res2.data) === null || _e === void 0 ? null : _e.message) || `签到失败(${res2.statusCode})`;
                      common_vendor.index.showToast({ title: msg, icon: "none" });
                    }
                  }).catch((err = null) => {
                    common_vendor.index.__f__("error", "at pages/index/index.uvue:375", "错误", err);
                    const msg = String((err === null || err === void 0 ? null : err.errMsg) || (err === null || err === void 0 ? null : err.message) || "");
                    if (msg.includes("timeout")) {
                      common_vendor.index.showToast({ title: "请求超时，请检查网络/服务器地址", icon: "none" });
                    } else {
                      common_vendor.index.showToast({ title: "网络请求失败", icon: "none" });
                    }
                  });
                };
                postOnce(false, false);
              };
              common_vendor.index.startWifi(new common_vendor.UTSJSONObject({
                success: () => {
                  common_vendor.index.getConnectedWifi(new common_vendor.UTSJSONObject({
                    success: (res2 = null) => {
                      this.connectedWifi = res2.wifi;
                      this.wifiSSID = res2.wifi.SSID;
                      this.wifiBSSID = res2.wifi.BSSID;
                      submit();
                    },
                    fail: (err = null) => {
                      common_vendor.index.__f__("error", "at pages/index/index.uvue:397", "获取当前连接的wifi 失败:", err);
                      this.connectedWifi = "";
                      this.wifiSSID = "";
                      this.wifiBSSID = "";
                      submit();
                    }
                  }));
                },
                fail: (err = null) => {
                  common_vendor.index.__f__("error", "at pages/index/index.uvue:406", "启动wifi 失败", err);
                  this.connectedWifi = "";
                  this.wifiSSID = "";
                  this.wifiBSSID = "";
                  submit();
                }
              }));
            };
            common_vendor.index.getLocation(new common_vendor.UTSJSONObject({
              type: "gcj02",
              success: (loc) => {
                const lat = loc.latitude || 0;
                const lng = loc.longitude || 0;
                if (lat && lng && !this.outOfChina(lat, lng)) {
                  const bd = this.gcj02ToBd09(lat, lng);
                  this.lastLatitude = bd.lat;
                  this.lastLongitude = bd.lng;
                } else {
                  this.lastLatitude = lat;
                  this.lastLongitude = lng;
                }
                proceed();
              },
              fail: () => {
                this.lastLatitude = 0;
                this.lastLongitude = 0;
                proceed();
              }
            }));
            common_vendor.index.getWifiList(new common_vendor.UTSJSONObject({
              success() {
              },
              fail(err = null) {
                common_vendor.index.__f__("error", "at pages/index/index.uvue:440", "请求获取 Wi-Fi 列表失败:", err);
              }
            }));
            common_vendor.index.onGetWifiList((res2 = null) => {
              this.wifiList = res2.wifiList;
            });
          },
          fail: (err) => {
            common_vendor.index.__f__("error", "at pages/index/index.uvue:449", "扫描失败：", err);
            common_vendor.index.showToast({
              title: "扫描失败，请重试",
              icon: "none"
            });
          }
        }));
      }).catch((err = null) => {
        if (err && err.message && err.message !== "missing student info") {
          common_vendor.index.showToast({ title: err.message, icon: "none" });
        }
      });
    },
    checkAbsenceAlerts() {
      if (!this.wxToken) {
        this.ensureWxLogin(false).then(() => {
          this.fetchAbsenceAlerts(false);
        });
      } else {
        this.fetchAbsenceAlerts(false);
      }
    }
  }
});
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  "raw js";
  return common_vendor.e({
    a: $data.wxBound,
    b: $data.studentName,
    c: common_vendor.o(($event) => $data.studentName = $event.detail.value, "65"),
    d: $data.wxBound,
    e: $data.studentId,
    f: common_vendor.o(($event) => $data.studentId = $event.detail.value, "c6"),
    g: !$data.wxBound
  }, !$data.wxBound ? {
    h: common_vendor.o((...args) => $options.bindStudent && $options.bindStudent(...args), "67")
  } : {
    i: common_vendor.o((...args) => $options.unlockEdit && $options.unlockEdit(...args), "cb")
  }, {
    j: $data.wxBound
  }, $data.wxBound ? {} : {}, {
    k: common_assets._imports_0,
    l: common_vendor.o((...args) => $options.scanQRCode && $options.scanQRCode(...args), "3c"),
    m: common_vendor.o((...args) => $options.checkAbsenceAlerts && $options.checkAbsenceAlerts(...args), "0e"),
    n: common_vendor.t($data.wxToken ? "已登录" : "未登录"),
    o: common_vendor.n($data.wxToken ? "chip-ok" : "chip-warn"),
    p: common_vendor.t($data.wxBound ? "已保存" : "未保存"),
    q: common_vendor.n($data.wxBound ? "chip-ok" : "chip-warn"),
    r: common_vendor.t($data.lastLatitude && $data.lastLongitude ? "已获取" : "未获取"),
    s: common_vendor.n($data.lastLatitude && $data.lastLongitude ? "chip-ok" : "chip-muted"),
    t: common_vendor.t($data.wifiBSSID ? "已连接" : "未连接"),
    v: common_vendor.n($data.wifiBSSID ? "chip-ok" : "chip-warn"),
    w: common_vendor.t($data.signRequest ? "已返回" : "未请求"),
    x: common_vendor.n($data.signRequest ? "chip-ok" : "chip-muted"),
    y: common_vendor.t($data.signCode || "-"),
    z: common_vendor.t($options.prettySignRequest),
    A: common_vendor.t($data.wifiSSID || "-"),
    B: common_vendor.t($data.wifiBSSID || "-"),
    C: common_vendor.t($data.wifiList && $data.wifiList.length ? $data.wifiList.length : 0),
    D: common_vendor.t($data.showWifiList ? "收起列表" : "展开列表"),
    E: common_vendor.o((...args) => $options.toggleWifiList && $options.toggleWifiList(...args), "74"),
    F: $data.showWifiList
  }, $data.showWifiList ? {
    G: common_vendor.f($data.wifiList, (w, idx, i0) => {
      return {
        a: common_vendor.t(w.SSID || "-"),
        b: common_vendor.t(w.BSSID || ""),
        c: idx
      };
    })
  } : {}, {
    H: $data.showAbsenceModal
  }, $data.showAbsenceModal ? common_vendor.e({
    I: $data.absences && $data.absences.length
  }, $data.absences && $data.absences.length ? {
    J: common_vendor.f($data.absences, (alert, index, i0) => {
      return {
        a: common_vendor.t(alert.course_name),
        b: common_vendor.t(new Date(alert.created_at).toLocaleString()),
        c: alert.id || index
      };
    })
  } : {}, {
    K: common_vendor.o(($event) => $data.showAbsenceModal = false, "90"),
    L: common_vendor.o(() => {
    }, "78"),
    M: common_vendor.o(($event) => $data.showAbsenceModal = false, "d9")
  }) : {}, {
    N: common_vendor.sei(common_vendor.gei(_ctx, ""), "view"),
    O: `${_ctx.u_s_b_h}px`,
    P: common_vendor.pvhc(_ctx.$scope.data.virtualHostClass)
  });
}
const MiniProgramPage = /* @__PURE__ */ common_vendor._export_sfc(_sfc_main, [["render", _sfc_render]]);
wx.createPage(MiniProgramPage);
//# sourceMappingURL=../../../.sourcemap/mp-weixin/pages/index/index.js.map
