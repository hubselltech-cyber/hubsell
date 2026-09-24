# TIẾN ĐỘ DỰ ÁN HUBSELL

## 🔜 Định hướng phiên sau (Next)
- [ ] **Trung tâm điều hành — Đợt 3 (làm cả thể khi TikTok Shop cấp API):** triển khai theo KHUNG ĐẶC TẢ đã viết sẵn cuối phần detector trong `backend/src/services/ops-alerts.ts` — (7) khách bom hàng `customer-refusal` (dữ liệu `Order.customerPhone` + đơn CANCELLED đã có sẵn), (8) mở rộng `ads-spike` cho Lazada/TikTok (cần client API chi ads theo ngày của 2 sàn), (9) `tax-error` lỗi hóa đơn/ký số (chờ module Invoicing chạy thương mại). Khung OpsAlert/UI dùng chung — chỉ cần viết detector rồi thêm vào mảng `detectors`.
- [ ] **Module theo dõi lệnh rút ví → ngân hàng:** để cột "Tiền đã thu về" (bảng Cash Flow) có số THẬT thay vì giữ chỗ 0đ.
- [ ] **Cắm dữ liệu thật cho các cột giữ chỗ** ở bảng Shopee/TikTok (thuế, Flash Sale, chiết khấu PVC, SFR/VAT, trợ giá VC, nạp ví QC…) khi có luồng đồng bộ đối soát từ sàn.
- [ ] Tiếp tục nghiệp vụ Hóa đơn/Thuế thật (xem mục dưới): tính VAT đầu ra động theo `vatRate` từng SKU; adapter gọi API NCC; đối soát hoa hồng đại lý theo `partnerCode`/`apiKey`.

## ✅ Trung tâm điều hành — Cảnh báo THẬT (06/08/2026, Đợt 1 + 2 đã chạy production)
> Bảng `OpsAlert` HỢP NHẤT cho mọi detector (unique `ownerId×type×dedupeKey`; OPEN/RESOLVED/AUTO_CLOSED — detector TỰ ĐÓNG thẻ khi điều kiện hết; tick tay = ẩn tới khi tái phát) + `OpsCenterVisit` (mốc nhãn "Mới"). Quét khi GET `/api/command-center/state`, throttle 10'/shop, không cần cron. Đã verify sống: thẻ "2 đơn giao gần đây bị LỖ" + deep-link đúng trang.
- [x] **Đợt 1:** 4 detector — cháy hàng (SKU có đơn 30 ngày nhưng tồn khả dụng ≤ 0, gom theo gian), gian mất kết nối/hết uỷ quyền, đơn lỗ 7 ngày (CÙNG luật `computePnlRow` với trang Đơn lỗ), chênh phí ship chờ khiếu nại 30 ngày. Action kind `navigate` deep-link (`/products`, `/channels`, `/operations-assistant/loss-orders`, `/warehouse/shipping-alerts`).
- [x] **Đợt 2:** detector sàn trễ đồng bộ (3 cột bookkeeping `lastSyncAt/lastSyncError/syncFailCount` trên `Channel`, worker order-auto-sync ghi mỗi nhịp; ≥3 nhịp lỗi liên tiếp → báo) + Ads Shopee đột biến (AdSpend ngày gần nhất ≥1.5× TB 7 ngày & ≥100k, đơn không tăng theo → nút mở Seller Center, link ngoài `window.open`). "Lệch tồn dai dẳng" đã có sẵn từ trước (3 lượt đối soát fail → `InventorySyncAlert`).
- [x] **UI:** nhãn "Mới" theo lần mở trước (`POST /seen`), nhãn DEMO trên thẻ mock, thẻ THẬT xếp trên DEMO bất kể mức độ, Nhật ký chia "Hôm nay / Trước đó".

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
- [ ] **Còn phải làm (nghiệp vụ thật):** tính VAT đầu ra động theo `vatRate` từng SKU; hiện thực adapter gọi API thật cho từng NCC; luồng đối soát Thuế & hoa hồng đại lý theo `partnerCode`/`apiKey`; cân nhắc mã hoá khóa bí mật khi lưu (hiện lưu thô cho môi trường dev). *(Ghi chú 19/09/2026: dòng này viết từ 07/2026 — adapter MISA + VAT động đã LIVE từ 23–24/08, xem PROGRESS; còn lại thật sự: mã hóa secret meInvoice at-rest.)*
- [x] **19/09/2026 — Gia cố luồng xuất hóa đơn trước khi khách xuất số lượng lớn** (chi tiết ở PROGRESS phiên 19/09 khuya): đơn vị tính (mặc định shop + theo SKU), hóa đơn bán hàng ký hiệu đầu 2 bỏ thuế suất, mốc xuất tự động DELIVERED / SETTLED + chỉ đơn giao từ ngày bật, dịch mã lỗi NCC ra việc cần làm + ngắt mạch worker (`integrations/invoice/invoice-errors.ts` + `auto-issue-policy.ts`), tự nối lại khi MISA báo trùng mã đơn, kiểm MST người mua, quà tặng 0đ, khối Tự động dạng thẻ chọn.
- [x] **19/09/2026 — Mã hóa bí mật NCC hóa đơn trong DB** (AES-256-GCM, AAD theo chủ shop, xoay khóa, chuyển đổi tự động lúc khởi động) — thiết kế + sổ tay ở `docs/BAO-MAT-MA-HOA-BI-MAT.md`.
- [x] **Bật mã hóa trên production — XONG 19/09/2026 23:47:** anh Trung tạo khóa `k1` + đặt `SECRET_ENC_KEYS` trên Render; log xác nhận `[SecretBox] BẬT — khóa đang dùng "k1"` + `Chuyển đổi… quét 0 ô, mã hóa 0, lỗi 0` (production chưa có shop nào lưu bí mật NCC hóa đơn nên không có gì để chuyển — từ nay lưu vào là mã hóa).
- [x] **24/09/2026 11:11 — HOÀN TẤT MÃ HÓA:** anh Trung xác nhận đã cất khóa dự phòng; Claude đặt `SECRET_ENC_REQUIRED=1` trên Render (Chrome anh) → deploy dep-daqa5gojo6nc73dn2t9g Live, log `[SecretBox] BẬT — khóa đang dùng "k1"` + `quét 0 ô, mã hóa 0, lỗi 0`. Từ nay thiếu khóa là máy chủ từ chối khởi động.
- [ ] Mã hóa token các sàn (Shopee / Lazada / TikTok) bằng chính `lib/secret-box.ts` — đợt riêng, rủi ro thấp hơn mật khẩu meInvoice.
- [x] **24/09/2026 — Ticket MISA ĐÓNG** (`docs/MISA-TICKET-TAI-NGUYEN-HOA-DON.md`): MISA trả lời 21/09 CHƯA có API số hóa đơn còn lại (sẽ ghi nhận); anh Trung chốt tạm đóng, giữ cơ chế 3 mã lỗi hết tài nguyên + chuông chỉ chỗ mua, không làm đếm lùi.

## ✅ Đã hoàn thành (Done)

### 📊 Module "Lãi/Lỗ Thực Hiện" — đối soát lợi nhuận chi tiết theo sàn
> Menu con độc lập trong Quản lý Tài chính (`/finance/realized-pnl`).
- [x] **Tab phân tầng theo sàn:** Tổng quan Lợi nhuận | Shopee | TikTok Shop | Lazada. Bảng thiết kế riêng từng sàn — `ShopeeProfitTable` (24 cột), `TiktokProfitTable` (27 cột), `GenericProfitTable` (Tổng quan/Lazada); header 2 tầng nhóm màu (tiêu đề nhóm căn giữa, nền slate đồng nhất, border phân tầng). Phân trang 20/50/100.
- [x] **Backend `GET /api/finance/realized-pnl`:** phân trang + lọc (sàn/thời gian/trạng thái) + summary theo sàn; giá vốn lấy `costPriceAtSale` snapshot. Các cột chưa có dữ liệu thật (thuế, Flash Sale, chiết khấu PVC, SFR/VAT, trợ giá VC, nạp ví QC…) **giữ chỗ 0đ**, có ghi chú dưới bảng.
- [x] **Bộ lọc nhanh "Lợi nhuận âm"** (chỉ hiện đơn lỗ) — backend `lossOnly`, lọc trước phân trang + summary.
- [x] **Checkbox tích chọn đơn + xuất Excel theo lựa chọn:** cột checkbox đầu bảng (select-all `rowSpan` 2 tầng + trạng thái *indeterminate*, checkbox từng hàng, căn giữa — helper chung `SelectAllTh`/`RowCheckTd`). Nút **Xuất file Excel**: CÓ chọn → chỉ xuất đúng đơn đã chọn (lưu object nên xuất được cả khi sang trang khác); KHÔNG chọn → xuất **toàn bộ theo filter** (gom mọi trang). **Reset lựa chọn** khi đổi tab hoặc đổi bộ lọc.
- [x] **Dọn giao diện Tab Tổng quan:** gỡ hàng badge lãi/lỗ theo sàn (trùng tab sàn) và **gỡ hẳn khối 4 Summary Cards** để bảng đẩy lên, tập trung vào data.
- [x] Dọn dẹp: gỡ prototype `/order-reconciliation` + `shopee-fee-mapper.ts` (đã thay bằng module này).

### 💵 Bảng "Phân bổ dòng tiền theo gian hàng" (Cash Flow) — trang Báo cáo dòng tiền
> Nằm dưới thẻ tổng quan, trên biểu đồ (`/finance/analytics`).
- [x] **Backend `GET /api/finance/cash-flow`:** bóc dòng tiền MỖI gian theo trạng thái vòng đời — đang đi đường / chờ đối soát / đã đối soát / đã thu về / tổng dự kiến. Liệt kê theo **danh sách channel** (kết nối gian mới là **tự có thêm dòng**, không hardcode); phân loại ưu tiên theo **vị trí thực của tiền** (đã quyết toán → trong ví).
- [x] **Frontend `CashFlowTable`:** map động danh sách gian; **dropdown lọc theo sàn** (client, ẩn/hiện tức thì); hàng **TỔNG CỘNG** dùng `.reduce()` (tô nền + in đậm, tự tính lại theo dòng đang lọc).
- [x] **Tối ưu UI/UX header + số liệu:** header nền `bg-slate-100` + chữ `font-semibold text-slate-700` (cột Tổng `font-bold text-slate-800`) + `border-b-2` rõ ranh giới; số tiền `text-sm font-medium`, cột "Tổng dòng tiền dự kiến" `font-semibold text-slate-900`; padding `py-3.5`; căn phải cột tiền, căn giữa checkbox → tăng tương phản, làm rõ luồng tiền theo công đoạn.
- [ ] **Còn phải làm:** cột **"Tiền đã thu về"** đang giữ chỗ 0đ — cần **module theo dõi lệnh rút ví về ngân hàng** để có số thật.

- [x] Tách ô lọc "Tất cả gian hàng" màn Liên kết SP thành 2 Dropdown phân tầng (Sàn → Shop con) — component `ChannelFilter` dùng chung mọi trang báo cáo.
- [x] **Lưu bền vững trạng thái Trung tâm điều hành (fix mất dữ liệu khi F5).** Trước đây "Đã xử lý" / chat / nhật ký chỉ sống trong React state nên F5 là reset sạch. Nay đã lưu xuống Postgres theo `ownerId`:
  - 3 model Prisma: `OpsResolvedAlert` (cảnh báo đã xử lý), `OpsChatMessage` (tin thảo luận, body JSON), `OpsActivity` (nhật ký) — migration `20260723015037_command_center_persistence`.
  - Route `backend/src/routes/command-center.ts`: `GET /state` (đọc khi load/F5), `POST /resolve` (đánh dấu/bỏ đánh dấu + nhật ký), `POST /chat` (tin mới + nhật ký). Gác `requireAuth + adminOnly` (khối này chỉ Admin thấy).
  - Frontend `command-center.tsx`: load state khi mở trang rồi **ghép với seed demo**; mọi thao tác ghi backend (optimistic, lỗi thì tự tải lại). API client trong `lib/api.ts`.
  - Đã kiểm chứng end-to-end trên trình duyệt: tick Đã xử lý + gửi chat → **F5 vẫn giữ nguyên** trạng thái mờ, đủ lịch sử chat & nhật ký.
- [x] Phân quyền nhân viên theo ma trận (Shop x Chức năng) và làm sạch màn Kênh bán.
- [x] Thống nhất luồng logic Kho vật lý làm gốc, chặn bán khống khi tồn kho bằng 0.
