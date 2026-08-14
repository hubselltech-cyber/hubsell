/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  // "class" để colorScheme.set() ghi đè tay Sáng/Tối được (mặc định "media"
  // chỉ bám hệ thống); chọn "Hệ thống" NativeWind vẫn tự bám Appearance.
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
};
