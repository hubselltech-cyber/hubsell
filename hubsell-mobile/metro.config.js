const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const path = require("path");

const config = getDefaultConfig(__dirname);

// Trần cỡ chữ theo cài đặt máy (23/11/2026): mọi `import … from "react-native"`
// trong src/ đi qua shims/react-native-font-scale.js — Text / TextInput có sẵn
// maxFontSizeMultiplier. Tệp đó và node_modules vẫn lấy react-native gốc.
// ⚠️ Tệp chặn PHẢI nằm NGOÀI src/: Metro nhớ kết quả tìm module theo THƯ MỤC gọi,
// để trong src/lib thì import "react-native" của chính nó vòng về nó (TextInput
// undefined — đã dính khi thử 23/11).
const SRC_DIR = path.join(__dirname, "src") + path.sep;
const FONT_SCALE_SHIM = path.join(__dirname, "shims", "react-native-font-scale.js");

// react-native-pager-view không có bản web — Metro vẫn bundle tĩnh dù code đã
// guard Platform.OS, nên trả module rỗng khi build web.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName.startsWith("react-native-pager-view")) {
    return { type: "empty" };
  }
  if (moduleName === "react-native") {
    const origin = path.normalize(context.originModulePath);
    if (origin.startsWith(SRC_DIR)) {
      return { type: "sourceFile", filePath: FONT_SCALE_SHIM };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./src/global.css" });
