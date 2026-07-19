import express from "express";
import cors from "cors";

import { Role } from "@prisma/client";
import { requireAuth, requireChannel, requireRole } from "./auth";
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

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Kiểm tra sức khỏe máy chủ (công khai)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "hubsell-backend" });
  });

  // Đăng nhập / đăng ký (công khai)
  app.use("/api/auth", authRouter);

  // Webhook từ sàn (công khai — sàn xác thực bằng token của kênh, không dùng JWT)
  app.use("/api/webhooks", webhooksRouter);

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

  // Quản lý nhân viên + phân quyền gian hàng — chỉ Admin
  app.use("/api/staff", requireAuth, adminOnly, staffRouter);

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
