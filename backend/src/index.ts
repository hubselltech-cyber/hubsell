import "dotenv/config";
import fs from "fs";
import http from "http";
import https from "https";
import { createApp } from "./app";
import { startShopeeOrderAutoSync } from "./integrations/shopee/auto-sync";

const PORT = Number(process.env.PORT) || 4000;
const app = createApp();

// Worker tự đồng bộ đơn Shopee theo nhịp — khởi động ở đây (KHÔNG ở app.ts)
// để test dựng createApp() không vô tình gọi API sàn thật.
startShopeeOrderAutoSync();

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

// ============================================================
// LISTENER HTTP PHỤ (mặc định tắt) — chỉ để callback OAuth Shopee tới được.
//
// Shopee đăng ký redirect domain http://hubsell.tech (cổng 80, http). Sau khi
// map hubsell.tech → 127.0.0.1 bằng file hosts, trình duyệt gọi callback vào
// cổng 80. Server chính vẫn HTTPS :4000 phục vụ frontend; đây chỉ mở thêm một
// listener HTTP dùng chung `app` cho callback. CHỈ dùng ở LOCAL.
// ============================================================
const extraHttpPort = Number(process.env.SHOPEE_CALLBACK_HTTP_PORT) || 0;
if (extraHttpPort && extraHttpPort !== PORT) {
  const httpServer = http.createServer(app);
  httpServer.on("error", (e) => {
    console.error(
      `   ⚠️  Không mở được cổng HTTP phụ ${extraHttpPort} (callback Shopee): ${
        (e as Error).message
      } — server chính vẫn chạy bình thường.`
    );
  });
  httpServer.listen(extraHttpPort, () => {
    console.log(
      `   ↪ Cổng HTTP phụ cho callback Shopee: http://localhost:${extraHttpPort} (vd http://hubsell.tech)`
    );
  });
}
