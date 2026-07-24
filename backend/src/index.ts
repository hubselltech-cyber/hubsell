import "dotenv/config";
import fs from "fs";
import https from "https";
import { createApp } from "./app";

const PORT = Number(process.env.PORT) || 4000;
const app = createApp();

// ============================================================
// HTTP mặc định; bật HTTPS khi có SSL_KEY_FILE + SSL_CERT_FILE trỏ tới cert hợp lệ.
//
// HTTPS cần cho việc test OAuth/webhook TikTok thật ở local: trang callback chạy
// https://localhost:3000 gọi API — nếu API còn http sẽ bị chặn mixed-content.
// Tạo cert bằng `bash scripts/gen-certs.sh`. Bỏ trống 2 biến = chạy HTTP như cũ.
// ============================================================
const keyFile = process.env.SSL_KEY_FILE;
const certFile = process.env.SSL_CERT_FILE;
const hasCertConfig = Boolean(keyFile && certFile);
const certFilesExist =
  hasCertConfig && fs.existsSync(keyFile!) && fs.existsSync(certFile!);

if (certFilesExist) {
  const server = https.createServer(
    { key: fs.readFileSync(keyFile!), cert: fs.readFileSync(certFile!) },
    app
  );
  server.listen(PORT, () => {
    console.log(`✅ Hubsell backend (HTTPS) đang chạy tại https://localhost:${PORT}`);
    console.log(`   Kiểm tra:  https://localhost:${PORT}/health`);
    console.log(`   (Cert tự ký — mở link trên 1 lần rồi bấm "vẫn tiếp tục" để trình duyệt tin.)`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`✅ Hubsell backend đang chạy tại http://localhost:${PORT}`);
    console.log(`   Kiểm tra:  http://localhost:${PORT}/health`);
    if (hasCertConfig) {
      console.log(
        `   ⚠️  Đã đặt SSL_KEY_FILE/SSL_CERT_FILE nhưng không thấy file cert → đang chạy HTTP. Chạy: bash scripts/gen-certs.sh`
      );
    }
  });
}
