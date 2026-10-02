# Đơn hoàn và sao kê của đơn — cách Hubsell lấy số từ sàn

Ngày lập: 02/10/2026. Người lập: Claude (Lead Dev), theo yêu cầu anh Trung sau đợt sửa lỗi 02/10/2026.

Trang này mô tả MỘT việc: tiền và trạng thái hoàn của một đơn được đọc từ sàn như thế nào, lưu ở đâu, và vì sao. Công thức lãi/lỗ nằm ở `backend/src/lib/pnl-formula.ts` và `docs/SO-CAI-DON.md`, trang này không lặp lại.

---

## 1. Hai lỗi 02/10/2026 và gốc chung

| Lỗi | Biểu hiện | Số trên prod |
|---|---|---|
| Thiếu bản ghi yêu cầu hoàn | Đơn trả hàng, hàng đã về, nhưng Lãi/Lỗ ghi "khách giữ hàng" và trừ nguyên giá vốn. Ca gốc: đơn TikTok 585860564513293743 gian Giày Dép Đức Khải, lỗ 144.620 thay vì 4.620 | Khoảng 630 đơn ở 18 gian TikTok + Shopee |
| Sao kê bị ghi đè | Đơn có dòng bán và dòng hoàn ở hai bản kê khác ngày chỉ còn dòng hoàn, tiền quyết toán âm gần bằng giá bán. Ca gốc: đơn TikTok 586047642877461564 gian LUMI SOLAR, −688.636 thay vì −195.997 | 43 đơn ở 5 gian TikTok |

Gốc chung: Hubsell đồng bộ theo CỬA SỔ THỜI GIAN HẸP (2 / 7 ngày gần nhất) rồi coi phần mình thấy là toàn bộ. Dữ liệu của một đơn thật ra rải theo thời gian: yêu cầu hoàn có thể đã xong trước ngày nối gian, dòng hoàn có thể nằm ở bản kê nhiều tuần sau dòng bán.

Hai quy tắc rút ra, áp cho mọi sàn:

1. **Đơn có tiền hoàn mà chưa từng đọc yêu cầu hoàn thì phải hỏi sàn theo mã đơn**, không chờ nó lọt vào cửa sổ quét.
2. **Sao kê của đơn là tổng mọi dòng sàn đã ghi cho đơn đó.** Lượt quét hẹp không được ghi đè sao kê bằng riêng phần nó thấy.

---

## 2. Yêu cầu hoàn

### 2.1 Số của sàn lưu trên đơn

| Cột của `Order` | Ý nghĩa |
|---|---|
| `returnSolution` | Sàn chốt: `RETURN_REFUND` (hàng về) hay `REFUND_ONLY` (khách giữ hàng). Null = chưa biết |
| `platformRefundAmount` | Tiền hoàn sàn báo trên yêu cầu hoàn |
| `platformReturnStatus` | Trạng thái yêu cầu hoàn nguyên văn của sàn |
| `returnDeliveredAt` | Sàn xác nhận kiện hoàn đã về tay người bán → Lãi/Lỗ thu hồi giá vốn |
| `returnStatus` | Trục của KHO (chờ nhận / đã nhận / hỏng…). Đồng bộ sàn chỉ đổi qua lại `NONE` ↔ `AWAITING` |
| `returnLookupAt` | Mốc Hubsell đã đọc yêu cầu hoàn của sàn cho đơn này. Null = chưa đọc lần nào |

Lãi/Lỗ đọc các cột này: đơn có tiền hoàn mà `returnSolution` trống bị coi là khách giữ hàng (mất giá vốn). Vì thế thiếu bản ghi hoàn là sai tiền.

### 2.2 Hai đường đọc

| | Lượt quét theo thời gian | Lượt quét bù theo mã đơn |
|---|---|---|
| Khi nào | Mỗi lượt quét nhanh (2 ngày), lượt giờ quét sâu 7 ngày | Tầng giờ, ngay sau đối soát |
| Đọc gì | Yêu cầu hoàn có biến động trong cửa sổ | Đơn có tiền hoàn trên sao kê, chưa có giải pháp hoàn, `returnLookupAt` trống |
| TikTok | `returns/search` lọc `update_time` | `returns/search` lọc `order_ids`, lô 20 đơn, tối đa 200 đơn / gian / lượt |
| Shopee | `get_return_list` lọc `update_time` | `get_escrow_detail` → `return_order_sn_list` → `get_return_detail`, tối đa 40 đơn / gian / lượt (`get_return_list` không lọc được theo mã đơn) |
| Lazada | Reverse Order API | Chưa có |

Mỗi đơn chỉ hỏi sàn MỘT lần ở đường quét bù: hỏi xong là đóng mốc `returnLookupAt`, kể cả khi sàn không có yêu cầu nào (đơn đó giữ cách tính cũ). Lượt quét theo thời gian cũng đóng mốc cho đơn nó đọc được.

Yêu cầu trả hàng đã xong từ trước khi Hubsell đọc được (sàn báo kiện đã về tay): ghi giải pháp, tiền hoàn, mốc kiện về, nhưng KHÔNG đưa vào "Chờ nhận hàng hoàn" và không gửi thông báo, vì kho không còn kiện nào để quét.

Mã: `integrations/return-lookup.ts` (tìm đơn chờ hỏi, đóng mốc — dùng chung), `integrations/tiktok/returns-sync.ts`, `integrations/shopee/returns-sync.ts`. Câu tìm đơn đi theo chỉ mục một phần `Order_return_lookup_pending_idx`.

---

## 3. Sao kê của đơn

### 3.1 Quy tắc

Dòng tiền của một đơn rải ở nhiều "mảnh" của sàn. Mỗi sao kê lưu danh sách các mảnh đã cộng vào nó; lượt quét so danh sách đó với phần nó đang thấy (`integrations/settlement-merge.ts`, hàm `planSettlementWrite`):

| Tình huống | Hành động |
|---|---|
| Lượt này thấy đủ mọi mảnh đã biết | Ghi từ các dòng đang có |
| Có dòng mới, và có mảnh đã biết nằm ngoài lượt này | Đọc lại các dòng nằm ngoài lượt, cộng chung rồi mới ghi |
| Không có gì mới, lượt này chỉ thấy một phần | Không ghi |

Đọc lại không được (sàn lỗi, thiếu dòng) thì giữ sao kê đang lưu, lượt sau thử lại. Không bao giờ ghi nửa chừng.

### 3.2 Theo từng sàn

| Sàn | Mảnh | Cột lưu danh sách | Đọc lại phần nằm ngoài lượt bằng |
|---|---|---|---|
| TikTok | Bản kê (statement) | `tiktok_order_settlements.statementIds` | Đọc lại bản kê cũ theo mã bản kê, mỗi bản kê một lần cho mọi đơn cần nó |
| Lazada | Ngày giao dịch, khóa `ngày#số dòng` | `lazada_order_settlements.lineDayKeys` | Đọc trọn giao dịch của đơn (`trade_order_id`) |
| Shopee | Không chia mảnh | — | `get_escrow_detail` trả trọn số của một đơn mỗi lần gọi nên không dính lỗi này |

Sao kê ghi trước 02/10/2026 chưa có danh sách: TikTok coi bản kê ghi sau cùng (`statementId`) là mảnh duy nhất đã biết; Lazada đọc trọn theo đơn ở lần kế đơn xuất hiện trong lượt quét.

### 3.3 Dựng lại sao kê

Bản sửa chặn lỗi từ nay về sau; đơn ĐÃ bị ghi đè không tự lành vì bản kê của nó đã ra khỏi cửa sổ 7 ngày. Cờ `Channel.settlementRebuildPending` bảo worker đọc lại TOÀN BỘ bản kê của gian từ đơn cũ nhất, xong không lỗi mới hạ cờ. Hiện chỉ TikTok có đường dựng lại.

Bật cờ khi: cách dựng sao kê đổi, hoặc phát hiện sao kê đã ghi sai. Bật bằng migration hoặc một câu `UPDATE` trên bảng `Channel`.

Sổ cái đơn tự tính lại khi sao kê hoặc đơn đổi (trigger), không cần làm gì thêm.

---

## 4. Gọi API TikTok: một cửa

Mọi lời gọi nghiệp vụ TikTok Shop đi qua `callApi` (`integrations/tiktok/client.ts`), và `callApi` đi qua lớp giới hạn ở `integrations/tiktok/rate-limit.ts`. Căn cứ: tài liệu "Rate limits" của TikTok Shop (partner.tiktokshop.com/docv2/page/rate-limits, đọc 02/10/2026).

| Việc | Cách làm | Căn cứ |
|---|---|---|
| Nhận diện quá tải | HTTP 429 hoặc mã 36009002 → `TiktokRateLimitError`, log kèm HTTP status, mã, request_id | Docs mục 4.1 |
| Làm mượt | Các lời gọi cùng gian, cùng loại (đọc / ghi) cách nhau tối thiểu 1 / nhịp giây. Nhịp khởi điểm: đọc 3 lượt/giây, ghi 1 lượt/giây | Đầu thấp của bảng gợi ý, docs mục 2.2 (sàn ghi rõ đây không phải hạn mức bảo đảm) |
| Khi bị chặn | Giảm nửa nhịp của gian đó (sàn dưới 0,2 lượt/giây), tăng lại 25% mỗi 10 phút yên ổn | Docs: giảm rồi tăng 20–30% mỗi 10–15 phút. Mức "giảm nửa" là tự chọn |
| Nghỉ-thử-lại | `max(Retry-After, min(1 giây × 2^n + lệch 0–500 ms, 60 giây))`, tối đa 5 lần | Docs mục 5.6 |
| Lệnh ghi | KHÔNG tự thử lại (tránh ghi trùng), trừ khi nơi gọi khai `retryWhenThrottled` | Docs mục 5.5 |

Làm mượt chạy trong từng tiến trình (web và worker mỗi bên một bộ đếm). Hạn mức của sàn là động, không có con số cố định; nhịp thật phải đo dần trên prod.

---

## 5. Điểm đã biết, chưa làm

| # | Việc | Ghi chú |
|---|---|---|
| 1 | Cờ `can_buyer_keep_item` của TikTok | Tài liệu có ghi, mã đã đọc cờ (coi như chỉ hoàn tiền), nhưng dữ liệu thật 02/10/2026 (khoảng 360 đơn hoàn) chưa đơn nào mang cờ và mẫu log không có trường này. Nhánh này mới được kiểm bằng test |
| 2 | Lazada chưa có quét bù yêu cầu hoàn theo mã đơn | Prod 02/10 chưa thấy gian Lazada nào có đơn dính. Đơn Lazada có tiền hoàn nằm lại trong chỉ mục `Order_return_lookup_pending_idx` vì không ai đóng mốc — vô hại, chỉ mục to dần chậm |
| 3 | Chỉ mục `Order_return_lookup_pending_idx` rộng hơn câu tìm một chút | Gồm cả đơn đã ghi mốc kiện hoàn về mà chưa đóng mốc. Không ảnh hưởng kết quả |
| 4 | Quét bù Shopee nhớ "đơn lỗi nghỉ 6 giờ" trong bộ nhớ tiến trình | Khởi động lại là mất, đơn đó được hỏi lại sớm hơn. Cùng cách với phần điền mã vận đơn trong cùng tệp |
| 5 | Lazada chưa có đường dựng lại sao kê | Sao kê Lazada ghi kiểu cũ tự được đọc lại khi đơn xuất hiện trong lượt quét; đơn không xuất hiện nữa thì giữ nguyên |
| 6 | Lượt đối soát TikTok mỗi giờ đọc lại toàn bộ bản kê 7 ngày | Bản kê đã chốt không đổi. Bỏ qua bản kê đã đọc sẽ cắt phần lớn lượt gọi tài chính và bớt việc sổ cái bị đánh dấu tính lại hàng giờ |
| 7 | Việc dài (dựng lại sao kê, nạp lịch sử) hỏng giữa chừng thì chạy lại từ đầu | Cần con trỏ tiến độ theo gian (xem `docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md` mục 6.3) |
| 8 | Cầu dao chung và làn ưu tiên cho TikTok | `services/api-budget.ts` đã có cho quảng cáo; chưa nối cho API đơn / tài chính TikTok |
| 9 | 6 đơn mất dòng bán của gian Dao Em Liên 68 | Gian đã ngắt kết nối từ 01/10/2026; cờ dựng lại vẫn bật, nối lại là tự sửa |

---

## 6. Câu kiểm trên prod (chỉ đọc)

Đơn TikTok mất dòng bán (phải bằng 0, trừ gian đã ngắt):

```sql
select count(*) from tiktok_order_settlements
where estimated = false and "grossSales" = 0 and "refundGross" < 0;
```

Đơn còn chờ hỏi sàn về yêu cầu hoàn, theo gian:

```sql
select c."channelName", c."shopName", count(*)
from "Order" o join "Channel" c on c.id = o."channelId"
where o."returnLookupAt" is null and o."shippingStatus" <> 'CANCELLED'
  and o."refundedAmount" > 0 and o."returnSolution" is null
group by 1, 2 order by 3 desc;
```

Gian còn bật cờ dựng lại sao kê:

```sql
select "channelName", "shopName", status from "Channel" where "settlementRebuildPending";
```
