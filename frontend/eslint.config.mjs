import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      /*
       * BỘ RULE REACT COMPILER (eslint-plugin-react-hooks v6) — tắt hai rule dưới.
       *
       * Chúng "tuýt còi" những pattern React hoàn toàn hợp lệ mà cả app đang
       * dùng, không phải lỗi thật và không chặn build:
       *
       * - set-state-in-effect: gọi setState trong effect để reset form khi mở
       *   dialog, hay làm mờ khối trong lúc tải lại (component Refreshing). Đây
       *   là escape-hatch chuẩn của React; ép bỏ sẽ phải remount bằng key ở
       *   ~20 chỗ, lợi bất cập hại.
       * - incompatible-library: thư viện `xlsx` (xuất/nhập Excel) không tương
       *   thích React Compiler. Không sửa được ở tầng code ứng dụng.
       *
       * exhaustive-deps VẪN BẬT — rule đó bắt bug thiếu dependency thật.
       */
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/incompatible-library": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
