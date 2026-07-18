import express from "express";
import cors from "cors";

import { requireAdmin, requireAuth } from "./auth";
import authRouter from "./routes/auth";
import analyticsRouter from "./routes/analytics";
import dashboardRouter from "./routes/dashboard";
import productsRouter from "./routes/products";
import ordersRouter from "./routes/orders";
import channelsRouter from "./routes/channels";
import inventoryRouter from "./routes/inventory";
import mappingsRouter from "./routes/mappings";
import webhooksRouter from "./routes/webhooks";

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

  // Các API dữ liệu — BẮT BUỘC đăng nhập.
  // Staff (nhân viên) chỉ được: Sản phẩm, Kho, Đơn hàng, xem danh sách kênh.
  // Admin (chủ shop) mới được: Dashboard tài chính, Analytics, cấu hình kênh, mapping.
  app.use("/api/dashboard", requireAuth, requireAdmin, dashboardRouter);
  app.use("/api/analytics", requireAuth, requireAdmin, analyticsRouter);
  app.use("/api/products", requireAuth, productsRouter);
  app.use("/api/orders", requireAuth, ordersRouter);
  app.use("/api/inventory", requireAuth, inventoryRouter);
  app.use("/api/mappings", requireAuth, requireAdmin, mappingsRouter);

  // Kênh bán: xem danh sách cho mọi người đã đăng nhập (bộ lọc đơn hàng cần),
  // còn kết nối/ngắt/danh mục sàn thì chỉ Admin (gác trong router bên dưới).
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
