"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const common_vendor = require("./common/vendor.js");
if (!Math) {
  "./pages/index/index.js";
}
const _sfc_main = common_vendor.defineComponent({
  onLaunch: function() {
    common_vendor.index.__f__("log", "at App.uvue:7", "App Launch");
  },
  onShow: function() {
    common_vendor.index.__f__("log", "at App.uvue:10", "App Show");
  },
  onHide: function() {
    common_vendor.index.__f__("log", "at App.uvue:13", "App Hide");
  },
  onExit: function() {
    common_vendor.index.__f__("log", "at App.uvue:34", "App Exit");
  }
});
function createApp() {
  const app = common_vendor.createSSRApp(_sfc_main);
  return {
    app
  };
}
createApp().app.mount("#app");
exports.createApp = createApp;
//# sourceMappingURL=../.sourcemap/mp-weixin/app.js.map
