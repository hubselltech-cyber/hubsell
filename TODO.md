# TIẾN ĐỘ DỰ ÁN HUBSELL

## ⏳ Đang thực hiện (In Progress)
- [ ] Tách ô lọc "Tất cả gian hàng" ở màn Liên kết sản phẩm thành 2 Dropdown phân tầng độc lập (Chọn Sàn -> Chọn Shop con).

## 🧩 Chuẩn bị triển khai — Module Hóa đơn điện tử, Đối soát Thuế & Chữ ký số
> Đã dựng khung để nối nghiệp vụ thật. Phần cảnh báo/P&L còn là placeholder; riêng **cấu hình NCC hóa đơn đã LƯU BỀN VỮNG** (bảng `InvoiceConfig`), sẵn sàng cho tích hợp API thương mại.
- [x] **SKU gốc — Section "Thông tin Thuế & Hóa đơn":** thêm `taxName` + `vatRate` (0/5/8/10) vào bảng Product (migration `20260723021741_product_tax_invoice_fields`); form thêm SKU có ô "Tên sản phẩm trên hóa đơn" + dropdown thuế suất; backend `products.ts` nhận & validate (POST/PATCH).
- [x] **Settings — "Cấu hình Hóa đơn & Chữ ký số":** trang mới `/settings` (menu "Cấu hình", chỉ Admin) với dropdown phương thức ký (USB Token / Cloud HSM), input Nhà cung cấp / Client ID / Secret Key, nút "Kiểm tra kết nối" → toast Sandbox/Giữ chỗ.
- [x] **Trung tâm điều hành — nhóm "THUẾ":** thêm tag `tax` (nhãn THUẾ) vào bộ lọc Nhật ký. Đã **gỡ thẻ thông báo tĩnh** khỏi danh sách cảnh báo real-time; thay bằng **Empty State (Beta)** khi lọc THUẾ ở Nhật ký ("Tính năng đối soát Thuế tự động đang được thiết lập (Beta)"). Luồng Thuế sau này CHỈ phát cảnh báo khi có lỗi (lỗi kết nối API hóa đơn, lỗi ký số…).
- [x] **Báo cáo P&L — 2 dòng chi phí giữ chỗ:** "Thuế VAT đầu ra (Dự kiến)" và "Thuế Affiliate quy đổi (Tạm tính)", mặc định 0đ.
- [x] **NÂNG CẤP Multi-Vendor Adapter + lưu bền vững (chuẩn bị API thương mại/đại lý):**
  - Dropdown NCC linh hoạt: **MISA meInvoice · Viettel Sinvoice · Bkav eHoadon · Khác (Custom API)** — registry `frontend/src/lib/invoice-vendors.ts` (thêm NCC chỉ sửa 1 chỗ); chọn Custom hiện ô Endpoint API.
  - Bảng `InvoiceConfig` (migration `20260723023105_invoice_config_multi_vendor`): `provider/signMethod/partnerCode/clientId/secretKey/apiKey/customApiUrl`, khóa theo `(ownerId, channelId)`. **`partnerCode`** = mã đại lý Hubsell (đối soát hoa hồng); **`apiKey` RIÊNG cho từng gian hàng** (channelId != null).
  - Đóng gói độc lập: backend `routes/invoice-config.ts` (`GET/PUT /` + `PUT /channels/:id`), frontend `components/settings/invoice-config-section.tsx`. Trường bí mật (secretKey/apiKey) chỉ trả về dạng **che (••••1234)**; để trống khi lưu = giữ khóa cũ.
  - Đã kiểm chứng end-to-end: lưu → **F5 vẫn giữ** provider/partnerCode/secret che; api_key riêng theo từng gian.
- [ ] **Còn phải làm (nghiệp vụ thật):** tính VAT đầu ra động theo `vatRate` từng SKU; hiện thực adapter gọi API thật cho từng NCC; luồng đối soát Thuế & hoa hồng đại lý theo `partnerCode`/`apiKey`; cân nhắc mã hoá khóa bí mật khi lưu (hiện lưu thô cho môi trường dev).

## ✅ Đã hoàn thành (Done)
- [x] **Lưu bền vững trạng thái Trung tâm điều hành (fix mất dữ liệu khi F5).** Trước đây "Đã xử lý" / chat / nhật ký chỉ sống trong React state nên F5 là reset sạch. Nay đã lưu xuống Postgres theo `ownerId`:
  - 3 model Prisma: `OpsResolvedAlert` (cảnh báo đã xử lý), `OpsChatMessage` (tin thảo luận, body JSON), `OpsActivity` (nhật ký) — migration `20260723015037_command_center_persistence`.
  - Route `backend/src/routes/command-center.ts`: `GET /state` (đọc khi load/F5), `POST /resolve` (đánh dấu/bỏ đánh dấu + nhật ký), `POST /chat` (tin mới + nhật ký). Gác `requireAuth + adminOnly` (khối này chỉ Admin thấy).
  - Frontend `command-center.tsx`: load state khi mở trang rồi **ghép với seed demo**; mọi thao tác ghi backend (optimistic, lỗi thì tự tải lại). API client trong `lib/api.ts`.
  - Đã kiểm chứng end-to-end trên trình duyệt: tick Đã xử lý + gửi chat → **F5 vẫn giữ nguyên** trạng thái mờ, đủ lịch sử chat & nhật ký.
- [x] Phân quyền nhân viên theo ma trận (Shop x Chức năng) và làm sạch màn Kênh bán.
- [x] Thống nhất luồng logic Kho vật lý làm gốc, chặn bán khống khi tồn kho bằng 0.
