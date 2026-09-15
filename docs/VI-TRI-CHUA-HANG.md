# Vị trí chứa hàng — nhiều kho nhỏ / kệ / ô

Kế hoạch chốt với anh Trung ngày 15/09/2026. Chưa làm, hẹn làm sau.

## 1. Bài toán

- Seller nhỏ thường thuê **2-3 kho nhỏ gần nhau thay cho một kho lớn**. Nhu cầu thật là biết
  **còn bao nhiêu hàng ở kho nào**, không cần định tuyến đơn theo tỉnh hay theo gian hàng.
- Khách có kho rộng cần vị trí tới kệ, tầng, ô để nhặt hàng và kiểm kê.
- Khách doanh nghiệp sau này cần khu vực, sức chứa, gợi ý cất hàng, nối WMS ngoài.
- Không được đóng cửa với khách lớn, nhưng khách một kho **không được thấy gì rườm rà**.

## 2. Nguyên tắc thiết kế

1. **Kho và kệ/ô là cùng một thứ**: một bảng vị trí dạng cây cha-con. Shop nhỏ dùng một dòng,
   kho rộng dùng nhiều tầng, doanh nghiệp dùng cây sâu hơn. Khách tự đặt tên, không phải học khái niệm khu/dãy/tầng.
2. **Ẩn bằng sự vắng mặt, không công tắc cài đặt**: chưa tạo vị trí thứ hai thì giao diện y hệt hôm nay.
   Chỉ có một nút "Thêm vị trí chứa hàng" trong trang Hàng hóa. Tạo xong là cột và ô chọn tự xuất hiện.
3. **Tồn tính theo cặp SKU × vị trí**, tổng vẫn là một con số như hôm nay. Sàn chỉ nhận tổng.
4. **Mapping SKU sàn ↔ SKU kho không đổi**: vị trí nằm dưới SKU kho, sàn không biết hàng ở đâu.
5. **Không thu tiền theo số kho** (khác KiotViet 150k/kho/tháng). Vị trí không giới hạn ở mọi gói.
   Quét ô khi nhặt/kiểm kê mở từ Pro. Tầng WMS (khu, sức chứa, gợi ý cất, nối WMS ngoài) chờ khách Business/Enterprise hỏi.

## 3. Mô hình dữ liệu

```
StockLocation           -- vị trí chứa hàng, cây cha-con
  id, userId, parentId?, name, code (in tem/mã vạch), sortOrder (thứ tự ưu tiên trừ hàng),
  isDefault (vị trí gốc, mỗi shop đúng 1), sellable (đợt 2: ô hàng lỗi/hoàn không tính tồn bán),
  createdAt

ProductStockLevel       -- tồn theo vị trí
  productId, locationId, quantity        @@unique([productId, locationId])

Product.quantityInStock  GIỮ NGUYÊN = tổng quantity các vị trí sellable (số cache, bất biến phải giữ)
InventoryLog.locationId  THÊM (nullable) để hủy đơn trả về đúng vị trí đã trừ
InventoryLogType         THÊM TRANSFER (chuyển vị trí, tổng không đổi)
```

Migration: tạo vị trí gốc "Kho chính" cho mọi shop, đổ toàn bộ tồn hiện có vào đó.
**ALTER trên Supabase trước khi push** (bài học 09/08).

## 4. Luồng nghiệp vụ

| Việc | Cách làm | Hiện khi nào |
|---|---|---|
| Nhập hàng | Phiếu nhập thêm ô chọn vị trí, nhớ lần chọn cuối | ≥ 2 vị trí |
| Xem tồn | Cột "Đang ở" trong bảng Hàng hóa: `Kho 1: 40 · Kho 2: 15`, bấm mở chi tiết | ≥ 2 vị trí |
| Đơn bán trừ | Tự động theo thứ tự ưu tiên vị trí (kéo thả một lần); vị trí nào đủ cả dòng thì lấy, không thì trừ lần lượt. Không hỏi trên từng đơn | luôn |
| Hủy đơn / hoàn | Trả về đúng vị trí đã trừ (đọc `InventoryLog.locationId`); hàng hoàn nhập kho vào vị trí gốc hoặc ô chọn trên bulk "Nhập kho tất cả" | luôn |
| Chuyển vị trí | Một màn: từ đâu, sang đâu, SKU, số lượng, **xem trước số thay đổi** trước khi xác nhận. Không có trạng thái "đang chuyển" (kho gần nhau) | ≥ 2 vị trí |
| Sửa tồn tại vị trí | Sửa số ngay trong chi tiết "Đang ở" (thay kiểm kê ở đợt 1) | ≥ 2 vị trí |
| Xóa vị trí | Chặn khi còn hàng, bắt chuyển đi trước (học Shopify) | — |
| Thêm vị trí thứ hai | Mọi SKU tự có số 0 ở đó, không hỏi gì (học Shopify) | — |

Người lấy hàng đôi khi lấy ở kho khác cho tiện: không chặn, số lệch lộ ra khi kiểm kê theo vị trí (đợt 2) và chỉnh một lần.

## 5. Kết quả rà code (15/09)

- Chưa có model kho nào; tồn là cột `Product.quantityInStock`.
- **13 chỗ ghi** tồn: `integrations/order-stock.ts` (deduct/restore), `routes/inventory.ts` (adjust/set),
  `routes/koc.ts` (hàng mẫu), `routes/mappings.ts` (seed tồn theo sàn), `routes/orders.ts` (hủy/hoàn),
  `routes/products.ts` (tạo/Excel), `routes/webhooks.ts`. 2 chỗ ghi `holdQuantity`, 12 chỗ tạo InventoryLog.
- Mọi ghi đi qua `enqueueStockPush()` (`integrations/inventory-push.ts`); mọi đọc "có thể bán" qua
  `availableToPush()` và `availableInStock()` (`services/low-stock.ts`).
- ~33 chỗ đọc backend, 26 file frontend, **0 file mobile**, 5 file test.
- Chưa có tính năng kiểm kê thật (chỉ `/api/inventory/set`). Phiếu nhặt hàng không đọc tồn.
- Kết luận: giữ `quantityInStock` làm tổng cache thì **chỗ đọc và engine đồng bộ sàn không phải sửa**,
  chỉ gom 13 chỗ ghi vào một helper `applyStockDelta(tx, productId, locationId | null, delta, ...)`.

## 6. Điểm mạnh đối thủ đáng chép

| Của ai | Chép gì |
|---|---|
| Sapo | Ưu tiên kho: đủ hàng cả đơn → thứ tự cấu hình; tách Tồn / Có thể bán / Đang chuyển |
| Nhanh.vn | Vị trí 4 cấp, sinh hàng loạt cú pháp `Kệ [1-3]`, in mã vạch dán kệ, danh sách "chưa kiểm còn tồn", gộp nhiều phiếu kiểm |
| Odoo / Zoho | Một vị trí gốc mặc định, chưa mở rộng thì không hỏi vị trí |
| ShipHero | Cờ Sellable/Pickable: ô hàng lỗi/hoàn không tính tồn bán; pick-down lấy ô ít hàng trước |
| Shopify | Thêm location thứ hai → mọi SP tự có số 0; chặn tắt location khi còn việc treo |
| KiotViet | Chuyển kho có cột "Thực tế" khi nhận, lệch phải ghi chú |

Bẫy tránh: Zoho bắt điền 0 cho mọi bin khi kiểm kê; Sapo bị than "chọn nhầm chi nhánh → lệch tồn";
KiotViet thu thêm theo kho.

## 7. Kế hoạch triển khai

**Đợt 1 (một buổi):**
1. Schema + migration + SQL Supabase chạy tay trước.
2. Helper ghi tồn duy nhất, gom 13 chỗ; trừ theo ưu tiên; hủy trả đúng vị trí.
3. Trang Hàng hóa: nút "Thêm vị trí chứa hàng", cột "Đang ở", ô chọn vị trí trên phiếu nhập,
   màn chuyển vị trí có xem trước, sửa số tại vị trí.
4. Cập nhật 5 file test, chạy `npx tsc --noEmit` trước khi push (tsc Render compile cả test).

**Đợt 2:**
- In "Lấy ở Kho 2" trên phiếu nhặt hàng ghép vận đơn A6.
- Kiểm kê theo vị trí: chỉ đếm ô có hàng, đếm lại chỉ SKU lệch, gộp nhiều phiếu.
- Cờ "không bán" cho ô hàng lỗi, gắn với luồng hoàn 2 công đoạn.
- Sinh vị trí hàng loạt + in tem mã vạch.
- Quét ô trên app mobile khi nhập và nhặt.

**Sau này (Business/Enterprise, khi có khách hỏi):** khu vực, sức chứa, gợi ý cất hàng, bổ sung theo tầng,
map vị trí ↔ Shopee `location_id` (cột `channelStockLocationId` đã có), nối WMS ngoài.
