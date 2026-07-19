import express from "express";
import cors from "cors";

import { requireAdmin, requireAuth, requireChannel } from "./auth";
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

  // Các API dữ liệu — BẮT BUỘC đăng nhập + BẮT BUỘC đã kết nối ít nhất 1 gian hàng.
  // requireChannel = Onboarding guard: chưa có kênh nào → trả 409 code NO_CHANNEL.
  // Staff (nhân viên) chỉ được: Sản phẩm, Kho, Đơn hàng, xem danh sách kênh.
  // Admin (chủ shop) mới được: Dashboard tài chính, Analytics, cấu hình kênh, mapping, nhân viên.
  app.use("/api/dashboard", requireAuth, requireAdmin, requireChannel, dashboardRouter);
  app.use("/api/analytics", requireAuth, requireAdmin, requireChannel, analyticsRouter);
  app.use("/api/expenses", requireAuth, requireAdmin, requireChannel, expensesRouter);
  app.use("/api/finance", requireAuth, requireAdmin, requireChannel, financeRouter);
  app.use("/api/products", requireAuth, requireChannel, productsRouter);
  app.use("/api/orders", requireAuth, requireChannel, ordersRouter);
  app.use("/api/inventory", requireAuth, requireChannel, inventoryRouter);
  app.use("/api/warehouse", requireAuth, requireChannel, warehouseRouter);
  app.use("/api/mappings", requireAuth, requireAdmin, requireChannel, mappingsRouter);

  // Quản lý nhân viên + phân quyền gian hàng — chỉ Admin
  app.use("/api/staff", requireAuth, requireAdmin, staffRouter);

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
