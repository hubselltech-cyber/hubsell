import express from "express";
import cors from "cors";

import { Role } from "@prisma/client";
import {
  requireAuth,
  requireChannel,
  requirePlatformAdmin,
  requireRole,
} from "./auth";
import adminRouter from "./routes/admin";
import authRouter from "./routes/auth";
import analyticsRouter from "./routes/analytics";
import expensesRouter from "./routes/expenses";
import dashboardRouter from "./routes/dashboard";
import productsRouter from "./routes/products";
import ordersRouter from "./routes/orders";
import warehouseRouter from "./routes/warehouse";
import channelsRouter from "./routes/channels";
import inventoryRouter from "./routes/inventory";
import mappingsRouter from "./routes/mappings";
import webhooksRouter from "./routes/webhooks";
import staffRouter from "./routes/staff";
import financeRouter from "./routes/finance";
import commandCenterRouter from "./routes/command-center";
import invoiceConfigRouter from "./routes/invoice-config";
import taxRouter from "./routes/tax";
import testMisaSandboxRouter from "./routes/test-misa-sandbox";
import operationsRouter from "./routes/operations";

// ============================================================
// CORS — ALLOWLIST thay cho mở toang (beta multi-user).
//
// Chỉ nhận request trình duyệt từ frontend chính thức + môi trường dev local.
// Thêm origin (vd URL preview Vercel của một PR) bằng env CORS_ORIGINS, phân
// tách dấu phẩy — KHÔNG mở khoá *.vercel.app vì bất kỳ ai cũng host được app
// lạ dưới domain đó.
//
// Request KHÔNG có header Origin (webhook sàn gọi server-to-server, curl,
// health-check của Render) vẫn đi qua: CORS là hàng rào của TRÌNH DUYỆT, các
// luồng máy-gọi-máy được bảo vệ bằng chữ ký webhook / JWT riêng.
// ============================================================
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>([
    "https://hubsell.tech",
    "https://www.hubsell.tech",
    "http://localhost:3000",
    "https://localhost:3000",
  ]);
  if (process.env.APP_FRONTEND_URL) origins.add(process.env.APP_FRONTEND_URL);
  for (const o of (process.env.CORS_ORIGINS ?? "").split(",")) {
    const trimmed = o.trim().replace(/\/$/, "");
    if (trimmed) origins.add(trimmed);
  }
  return origins;
}

export function createApp() {
  const app = express();

  const allowedOrigins = buildAllowedOrigins();
  app.use(
    cors({
      origin(origin, callback) {
        // Origin lạ: trả false (không set header CORS) chứ KHÔNG ném lỗi —
        // ném lỗi sẽ rơi vào error-handler thành 500 gây nhiễu log.
        callback(null, !origin || allowedOrigins.has(origin));
      },
    })
  );
  // Giữ lại THÂN REQUEST THÔ (req.rawBody) khi parse JSON — webhook TikTok phải
  // ký/kiểm chữ ký trên đúng nguyên văn body, serialize lại là sai chữ ký.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // Kiểm tra sức khỏe máy chủ (công khai). version = SHA commit đang chạy
  // (Render tự đặt RENDER_GIT_COMMIT) — để xác minh deploy đã lên code mới.
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "hubsell-backend",
      version: process.env.RENDER_GIT_COMMIT ?? "dev",
    });
  });

  // Đăng nhập / đăng ký (công khai)
  app.use("/api/auth", authRouter);

  // Webhook từ sàn (công khai — xác thực bằng CHỮ KÝ trên body, không dùng JWT).
  // Mount cả 2 dạng: /api/webhooks (TikTok đã đăng ký từ trước) và /api/webhook
  // (số ít — URL đăng ký Push Shopee: http://hubsell.tech/api/webhook/shopee).
  app.use("/api/webhooks", webhooksRouter);
  app.use("/api/webhook", webhooksRouter);
  // Dạng /v1 — URL đăng ký với MISA meInvoice: /v1/webhooks/misa-meinvoice.
  app.use("/v1/webhooks", webhooksRouter);

  // ============================================================
  // PHÂN QUYỀN 2 LỚP
  //
  // Lớp 1 — VAI TRÒ quyết định vào được API nào (chặn ngay tại đây):
  //   ADMIN     : toàn bộ
  //   SALES     : đơn hàng, kho, sản phẩm, và Tổng quan (doanh thu, số đơn)
  //   WAREHOUSE : đơn hàng, kho, sản phẩm — KHÔNG một API tài chính nào
  //
  // Lớp 2 — PHẠM VI GIAN HÀNG quyết định thấy bao nhiêu dữ liệu trong API đó.
  //   Nạp ở requireAuth (req.allowedChannelIds), áp bởi channelScope() ở từng
  //   truy vấn. SALES bị bó theo gian được phân công; ADMIN và WAREHOUSE thấy hết.
  //
  // Chỉ số nhạy cảm (giá vốn, lợi nhuận, chi phí) còn bị lọc thêm một lớp nữa
  // ngay trong controller bằng canSeeFinancials() — SALES vào được /analytics
  // nhưng không nhận được các trường đó.
  //
  // requireChannel = Onboarding guard: shop chưa có gian nào → 409 NO_CHANNEL.
  // ============================================================
  const adminOnly = requireRole(Role.ADMIN);
  const notWarehouse = requireRole(Role.ADMIN, Role.SALES);
  const anyRole = requireRole(Role.ADMIN, Role.SALES, Role.WAREHOUSE);

  app.use("/api/dashboard", requireAuth, notWarehouse, requireChannel, dashboardRouter);
  app.use("/api/analytics", requireAuth, notWarehouse, requireChannel, analyticsRouter);
  app.use("/api/expenses", requireAuth, adminOnly, requireChannel, expensesRouter);
  app.use("/api/finance", requireAuth, adminOnly, requireChannel, financeRouter);
  app.use("/api/products", requireAuth, anyRole, requireChannel, productsRouter);
  app.use("/api/orders", requireAuth, anyRole, requireChannel, ordersRouter);
  app.use("/api/inventory", requireAuth, anyRole, requireChannel, inventoryRouter);
  app.use("/api/warehouse", requireAuth, anyRole, requireChannel, warehouseRouter);
  app.use("/api/mappings", requireAuth, adminOnly, requireChannel, mappingsRouter);

  // QUẢN TRỊ NỀN TẢNG — chỉ tài khoản có cờ isPlatformAdmin (chủ nền tảng
  // Hubsell), KHÔNG phải ADMIN của shop. Không gác requireChannel: số liệu
  // toàn hệ thống không phụ thuộc shop của người xem có gian hay không.
  app.use("/api/admin", requireAuth, requirePlatformAdmin, adminRouter);

  // Quản lý nhân viên + phân quyền gian hàng — chỉ Admin
  app.use("/api/staff", requireAuth, adminOnly, staffRouter);

  // Trung tâm điều hành — khối demo trên Dashboard, chỉ Admin thấy nên gác adminOnly.
  // KHÔNG gác requireChannel: trạng thái (đã xử lý/chat/nhật ký) không phụ thuộc kênh.
  app.use("/api/command-center", requireAuth, adminOnly, commandCenterRouter);

  // Cấu hình Hóa đơn điện tử & Chữ ký số (Multi-Vendor) — chỉ Admin.
  app.use("/api/invoice-config", requireAuth, adminOnly, invoiceConfigRouter);

  // Test sandbox MISA (Hóa đơn đầu vào + eSign) — chỉ Admin; trên production
  // router tự chặn 503 trừ khi bật MISA_SANDBOX_TEST_ENABLED=1 (xem file route).
  app.use("/api/test/misa-sandbox", requireAuth, adminOnly, testMisaSandboxRouter);

  // Hóa đơn & Thuế: cấu hình Thuế bổ sung + Báo cáo thuế — chỉ Admin.
  // Không gác requireChannel (giống invoice-config) để trang cấu hình thuế
  // vẫn mở được khi shop chưa nối gian nào.
  app.use("/api/tax", requireAuth, adminOnly, taxRouter);

  // Trợ lý vận hành (CSKH đa kênh): chat + đánh giá + ngữ cảnh sản phẩm.
  // CSKH là việc của SALES nên gác notWarehouse (khớp canAccessOperations bên FE).
  app.use("/api/operations", requireAuth, notWarehouse, requireChannel, operationsRouter);

  // Kênh bán: xem danh sách cho mọi người đã đăng nhập (KHÔNG gác requireChannel để
  // onboarding còn kết nối được), kết nối/ngắt/danh mục sàn thì chỉ Admin (gác trong router).
  app.use("/api/channels", requireAuth, channelsRouter);

  // Xử lý route không tồn tại
  app.use((_req, res) => {
    res.status(404).json({ error: "Không tìm thấy đường dẫn (route)" });
  });

  // Xử lý lỗi tập trung
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error("[Lỗi API]", err);
      res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
    }
  );

  return app;
}
