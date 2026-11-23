/**
 * TRẦN CỠ CHỮ THEO CÀI ĐẶT MÁY (23/11/2026).
 *
 * Vì sao có tệp này: anh Trung chụp màn Tổng quan trên máy Samsung để cỡ chữ hệ
 * thống lớn — chữ phóng theo máy, vượt khung, "Shopee" gãy thành "Shope / e",
 * "TB 147 k/đơn" bị cắt, chữ đè lên nhau. App chưa từng giới hạn hệ số phóng chữ
 * (Android cho tới 2,0×), mà mọi bố cục chỉ được soi ở cỡ chữ mặc định.
 *
 * Cách làm: metro.config.js trỏ MỌI `import … from "react-native"` trong src/
 * sang tệp này (tệp nằm NGOÀI src/ để require bên dưới lấy react-native gốc).
 * Tệp chuyển tiếp nguyên react-native, chỉ thay Text và TextInput bằng bản có
 * sẵn `maxFontSizeMultiplier = MAX_FONT_SCALE` — chữ vẫn to lên theo máy (người
 * cần chữ lớn vẫn được), nhưng dừng ở mức bố cục còn chịu được. Màn nào cần khác
 * thì truyền `maxFontSizeMultiplier` riêng (prop truyền vào đè mặc định).
 *
 * ⚠️ Không dùng Text.defaultProps: React 19 bỏ defaultProps cho component hàm,
 *    Text của RN 0.86 là component hàm nên gán vào không có tác dụng.
 * ⚠️ Không dùng `export * from "react-native"`: Babel chép giá trị mọi khóa ngay
 *    lúc nạp → gọi hết getter lười của RN (nạp cả Clipboard, PushNotificationIOS…,
 *    chậm khởi động + hộp cảnh báo vàng — đã dính khi thử 23/11). Ở đây mỗi khóa
 *    là một getter chuyển tiếp, dùng tới đâu nạp tới đó như RN gốc.
 * ⚠️ Viết JSX (không React.createElement) để lời gọi đi qua jsx-runtime của
 *    NativeWind — className trên Text mới được đổi thành style.
 */
const React = require("react");
const RN = require("react-native");

/** Hệ số phóng chữ tối đa: máy để chữ to hơn mức này thì app dừng ở mức này. */
const MAX_FONT_SCALE = 1.2;

const Text = React.forwardRef(function Text(props, ref) {
  return <RN.Text maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} ref={ref} />;
});

const TextInput = React.forwardRef(function TextInput(props, ref) {
  return <RN.TextInput maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} ref={ref} />;
});
// Giữ phần tĩnh của TextInput (useKeyboardScroll dùng TextInput.State.currentlyFocusedInput).
TextInput.State = RN.TextInput.State;

const out = { MAX_FONT_SCALE, Text, TextInput };
for (const key of Object.keys(RN)) {
  if (key in out) continue;
  Object.defineProperty(out, key, { enumerable: true, get: () => RN[key] });
}
module.exports = out;
