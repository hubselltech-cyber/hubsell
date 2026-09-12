import "dotenv/config";
import fs from "fs";
import http from "http";
import https from "https";
import { createApp } from "./app";
import { startNotificationSseBridge } from "./services/notifications";
import { resolveHubsellRole, startAllWorkers } from "./workers";

const PORT = Number(process.env.PORT) || 4000;

// ============================================================
// VAI TIẾN TRÌNH (HUBSELL_ROLE, 12/09/2026) — xem workers/index.ts.
//   all (mặc định): web + worker cùng tiến trình (production hôm nay).
//   web           : chỉ API + SSE, không worker.
//   worker        : chỉ worker nền, KHÔNG mở cổng HTTP (Render Background Worker).
// Worker khởi động ở đây (KHÔNG ở app.ts) để test dựng createApp() không gọi API sàn.
// ============================================================
const role = resolveHubsellRole();
console.log(`[Role] Tiến trình chạy vai "${role}"`);

if (role === "worker" || role === "all") {
  startAllWorkers();
}

if (role === "worker") {
  // Không có HTTP — giữ tiến trình sống bằng chính các timer worker (timer đã
  // unref nên cần một mỏ neo); thoát êm khi Render gửi SIGTERM lúc deploy.
  const anchor = setInterval(() => {}, 60 * 60 * 1000);
  const shutdown = (sig: string) => {
    console.log(`[Role] Worker nhận ${sig} — dừng`);
    clearInterval(anchor);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  console.log("✅ Hubsell worker đang chạy (không mở cổng HTTP)");
} else {
  startWebServer();
}

function startWebServer(): void {
  const app = createApp();
  // Cầu SSE: worker ở tiến trình khác ghi thông báo vào DB → web đẩy tới trình
  // duyệt đang mở (vai "all" thì notify() đẩy thẳng, cầu chỉ là lưới an toàn).
  startNotificationSseBridge();

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
}
