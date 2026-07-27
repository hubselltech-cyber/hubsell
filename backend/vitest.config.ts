import { defineConfig } from "vitest/config";

// Test chạy trên DATABASE THẬT của môi trường dev (backend/.env) — dữ liệu
// test tự tạo với tiền tố TEST- và tự dọn ở afterAll. Vì các file test dùng
// chung một DB nên chạy TUẦN TỰ từng file (fileParallelism: false) để không
// giẫm chân nhau; các test race bên trong file vẫn tự Promise.all song song.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
