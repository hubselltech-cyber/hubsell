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
| 10 | Phần Lazada của mục 3 chưa chạy thật lần nào | Prod 02/10/2026 không còn gian Lazada thật nào đang nối (Hi.Bé hết hạn ủy quyền, DarkMan đã ngắt, chỉ còn gian demo). Mới kiểm bằng test. Khi có gian Lazada nối lại: xem log `[Lazada Settle]` có dòng "Không đọc trọn được" / "CHƯA đọc trọn được" không, và đếm sao kê Lazada đã có `lineDayKeys` |
| 11 | Chưa biết TikTok có trả tiêu đề `Retry-After` khi báo quá tải không | Chỉ log worker trả lời được: dòng `[TikTok] QUA TAI ...` in sẵn `retry-after <số hoặc ->`. Tới 22:50 ngày 02/10/2026 chưa đọc log sau lần đưa lên (xem mục 7) |

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

Sao kê TikTok ghi sau một mốc, theo gian (xem lượt giờ có chạy và chạy trong bao lâu; thay mốc giờ UTC):

```sql
select c."shopName", count(*), min(s."updatedAt"), max(s."updatedAt"),
       count(*) filter (where s.estimated = false and s."grossSales" = 0 and s."refundGross" < 0) as mat_dong_ban
from tiktok_order_settlements s
join "Order" o on o.id = s."orderId"
join "Channel" c on c.id = o."channelId"
where s."updatedAt" > timestamp '2026-10-02 14:54:08'
group by 1 order by 1;
```

---

## 7. Đưa lên prod 02/10/2026 và kết quả kiểm

Bản `356ef42` (mục 3 phần Lazada, mục 4, tệp này) lên prod lúc 21:54 ngày 02/10/2026. Kiểm bằng các câu ở mục 6 trên Supabase (chỉ đọc), lúc 22:50:

| Điểm kiểm | Kết quả |
|---|---|
| Migration `20261002220000_lazada_settlement_line_day_keys` | Áp xong 21:54:08, không bị hoàn tác; cột `lineDayKeys` có trên prod |
| Lượt giờ của 11 gian TikTok đang nối | Cả 11 gian chạy xong lượt đầu trên bản mới, 0 lỗi liên tiếp. Từ lúc đến hạn tới lúc ghi xong sao kê: 9 giây đến 1 phút 37 giây (gian nhiều nhất LUMI SOLAR 993 sao kê) |
| Nhịp quét nhanh | Vẫn 9–11 phút như trước khi đưa lên |
| Đơn mất dòng bán | 0 trong 2.212 sao kê ghi sau khi đưa lên; toàn hệ thống vẫn 6 (gian Dao Em Liên 68, mục 5 điểm 9) |
| Cờ dựng lại sao kê | Chỉ còn gian Dao Em Liên 68 |

Chưa kiểm được: thời gian lượt giờ TRƯỚC khi đưa lên (không có số để so, chỉ biết sau khi đưa lên không nghẽn); có lần nào bị sàn báo quá tải rồi thử lại thành công không (database không để dấu, xem mục 5 điểm 11); phần Lazada (mục 5 điểm 10).

---

## 8. Khảo sát 29/10/2026 — kho quét kiện về mà app báo "Không hoàn" (khách: "cập nhật đơn hoàn rất chậm, bấm Đồng bộ từ sàn mới có")

### 8.1 Ca thật và số prod (Supabase chỉ đọc, 29/10 ~21:30)

Gian Hellokityhh (TikTok) quét kiện đơn `586686865006495180` trên app → bảng kết quả ghi **Không hoàn**.

| Điểm kiểm | Kết quả |
|---|---|
| Đơn trong DB | `shippingStatus` CANCELLED, `returnStatus` NONE, `returnRequestedAt` / `returnLookupAt` / `returnTrackingCode` đều NULL |
| Webhook TikTok của đơn | 3 sự kiện về cùng giây 17:17:06 ngày 28/10 (giờ VN): type 11 `cancellations_role: SYSTEM`, `CANCELLATION_REQUEST_COMPLETE`; type 2 `reverse_type 1`, `reverse_user 4`, `reverse_order_status 100`; type 1 `order_status: CANCEL`. Cả 3 xử lý lúc 17:37:15 — **hàng đợi chờ 20 phút** |
| Hàng đợi webhook TikTok 7 ngày | p50 0 giây, **p95 10–17 phút, max ~50 phút** (type 1: 325.962 sự kiện; type 12 yêu cầu hoàn: 10.417) |
| Kho quét 30 ngày (toàn hệ thống) | Shopee 110 kiện, **34 báo "Không hoàn" lúc quét (30 là đơn CANCELLED)**; TikTok 101 kiện, **31 "Không hoàn" (31/31 CANCELLED)**; Lazada 12 kiện, 0 |
| Chuông "Sàn đã hủy đơn đã chuẩn bị hàng" 30 ngày | TikTok "Giao gói hàng thất bại" **1.029**, "Package delivery failed" 2, "Gói hàng bị thất lạc" 3, "Gói hàng bị hư hỏng" 1, "Tự động hủy do quá thời gian lấy hàng" 18; Shopee "Failed Delivery" **165**, "Parcel lost in transit" 3, "Seller did not Ship" 3 |

### 8.2 Gốc — ba lớp, lớp 1 là chính

1. **Kiện "giao thất bại → sàn hủy → quay đầu" không nằm trên trục hoàn.** TikTok chỉ gắn AWAITING từ `returns/search` (yêu cầu trả hàng của khách); Shopee từ `order_status = TO_RETURN` hoặc `get_return_list`; đơn **CANCELLED sau khi đã bàn giao vận chuyển** không thuộc cả hai nguồn → mãi là NONE. Ước ~1.200 kiện/tháng toàn hệ thống (bảng trên). Nút "Đồng bộ từ sàn" cũng đi đúng hai nguồn đó nên **không chữa được loại này** — khách thấy "có" sau khi bấm là cho yêu cầu trả hàng thật (lớp 2), không phải kiện giao thất bại. Mã: `tiktok/service.ts` không đụng `returnStatus`; `shopee/service.ts shopeeReturnStatus` chỉ TO_RETURN; Lazada `lazadaReturnStatus` bắt chuỗi "return" (Lazada đặt trạng thái `returned` cho kiện giao thất bại nên Lazada 0 ca).
2. **Yêu cầu trả hàng thật về chậm 10–60 phút.** Webhook TikTok type 12 / type 2 về ngay nhưng `handleTiktokOrderJob` chỉ kéo lại chi tiết đơn (chi tiết đơn không mang yêu cầu hoàn) → cờ chỉ được gắn ở lượt `syncTiktokReturns` tầng nhanh (10' → giãn 60' khi gian im ắng). Shopee: yêu cầu hoàn trên đơn COMPLETED không có push (docs mục 2.2), cũng chờ `syncShopeeReturns` 10'. `GET /api/orders/lookup` chỉ tự hỏi sàn khi **không tìm thấy đơn**; đơn thấy mà NONE thì trả về ngay, không hỏi lại.
3. **Hàng đợi webhook kẹt ~10:00 mỗi sáng** (p95 10–17 phút) — đã ghi ở PROGRESS 27/10, thuộc đại tu 5e (anh chốt giữ thứ tự đại tu), không mở lát riêng.

### 8.3 Phương án (anh chốt 29/10 đêm: A + C giữ; B đã gỡ — mục 8.7)

| # | Lát | Làm gì | Hiệu quả |
|---|---|---|---|
| A — **ĐÃ LÀM 29/10/2026 đêm** (mục 8.4) | Luật chung 3 sàn "hủy sau khi bàn giao = kiện quay đầu" | Trong `plan{Shopee,Tiktok,Lazada}OrderUpdate`: đơn đang SHIPPING / DELIVERED (đã có `trackingCode`, đã bàn giao) mà sàn chuyển CANCELLED → `returnStatus` NONE → AWAITING, `returnRequestedAt` = `cancel_time`/`update_time`, `returnSolution` RETURN_REFUND, `platformReturnStatus` = `CANCELLED_AFTER_SHIP` + lý do sàn. Loại trừ hủy **trước khi lấy hàng** (prev PENDING/PROCESSED: "quá thời gian lấy hàng", "Seller did not Ship" — kiện còn ở shop). Mọi webhook (TikTok 1/2/11, Shopee code 3, Lazada reverse) đều qua upsert này → cờ gắn theo nhịp webhook, không cần quét. Nhãn kho: "Chờ hàng về · giao thất bại". | Xóa ~95 % ca "Không hoàn" lúc quét (61/65 ca 30 ngày là đơn CANCELLED) |
| B — **ĐÃ GỠ 29/10/2026 đêm** (mục 8.5, 8.7) | Webhook yêu cầu hoàn hỏi đúng đơn | TikTok type 12 / 2 trong `handleTiktokOrderJob` → `searchReturns({ orderIds: [orderId] })` rồi `applyTiktokReturnGroups` (cùng khuôn type 11 đã làm với `cancellations/search` 23/10). Shopee không có push cho return trên đơn COMPLETED → giữ quét 10'. | Yêu cầu trả hàng TikTok lên cờ theo nhịp webhook thay vì 10–60' |
| C — **ĐÃ LÀM 29/10/2026 đêm** (mục 8.6) | Lượt quét hỏi sàn đúng đơn | `/orders/lookup`: đơn thấy mà NONE và đã bàn giao → hỏi sàn MỘT lần cho đúng đơn (TikTok `returns/search order_ids`; Shopee `get_order_detail` + `get_escrow_detail → return_order_sn_list`) trước khi trả "Không hoàn"; cooldown theo đơn. | Bịt nốt ca worker/hàng đợi trễ; tốn 1–2 call/lượt quét trượt |

Tồn kho: luật hiện hành `restoreStockTx` cộng lại kho ngay khi sàn báo CANCELLED (kể cả kiện còn đang quay đầu), nhập kho hoàn sau đó bị `stockRestoredAt` chặn cộng trùng → lát A không đổi số kho; chỉ ghi nhận để nếu anh muốn "cộng kho khi kho quét nhận" thì là lát đổi luật kho riêng.

Chưa kiểm: ý nghĩa `reverse_type 1` / `reverse_user 4` của webhook type 2 theo docs (suy từ ca thật: hủy / hệ thống); TikTok Get Package Detail có trạng thái "đang hoàn về" riêng không; chữ `cancel_reason` đổi theo ngôn ngữ shop (đã thấy cả tiếng Việt lẫn tiếng Anh) nên lát A dựa trên **trạng thái trước** chứ không dựa chữ.

### 8.4 Lát A đã làm (29/10/2026 đêm) — anh chốt: "Sàn chuyển CANCELLED là ship đã phát giao không thành công rồi"

| Phần | Mã |
|---|---|
| Luật thuần dùng chung | `integrations/cancelled-after-ship.ts`: `cancelledAfterShipReturnFields(existing, nextStatus, at)` → đơn đang SHIPPING / DELIVERED chuyển CANCELLED và trục hoàn còn NONE → `returnStatus` AWAITING, `returnRequestedAt` = mốc sàn, `returnSolution` RETURN_REFUND, `platformReturnStatus` = `CANCELLED_AFTER_SHIP`. Dựa trạng thái TRƯỚC, không dựa chữ `cancel_reason`; hủy khi còn Chờ xử lý / Đã xử lý (chưa lấy hàng) giữ Đã hủy như cũ; kho đã quét / đã có yêu cầu hoàn thì không đụng |
| Nối 3 planner | `planTiktokOrderUpdate` (thêm tham số `now`, select thêm `returnStatus` + `returnRequestedAt`; mốc = `cancel_time` → `update_time`), `planShopeeOrderUpdate` (mốc = `update_time`), `planLazadaOrderUpdate` (mốc = `updated_at`; `failed_delivery` / `shipped_back` vốn đã ánh xạ CANCELLED). Webhook lẫn quét nền đều đi qua planner → cờ gắn theo nhịp webhook |
| Chuông | `cancel-request.ts` `orderCancelledMessage` (thuần, có test): có `returning` → "Sàn đã hủy…", câu cuối "Kiện đã bàn giao sẽ quay về shop — Hubsell đã chuyển đơn sang Chờ hàng về", link `/warehouse/returns`; Lazada không nói ai hủy mà kiện quay đầu thì ghi "Sàn" |
| Giao diện | Web Đối soát đơn hoàn: dòng "Sàn báo hoàn …" thêm "· giao thất bại, kiện quay đầu"; Lãi/Lỗ ô nguồn hoàn dịch mã thành chữ; app Quét đơn hoàn: dòng vàng "Giao thất bại · sàn đã hủy · kiện đang quay về shop" dưới mã đơn (đi bản mobile kế) |
| Không đổi | Tồn kho (restoreStockTx đã cộng khi hủy, `stockRestoredAt` chặn trùng), P&L (`returnGoodsRecovered` coi đơn hủy không mất vốn; cờ AWAITING không đổi kết quả), quét bù theo mã đơn (`returnSolution` đã có → không hỏi lại) |
| Đổi có chủ ý | Phễu Tổng quan: đơn hủy sau giao nay nằm ô Hoàn/Trả (RETURNING_STATUSES) tới khi kho nhập kho / chốt khiếu nại, như đơn Shopee TO_RETURN — trước đây nằm ô Đã hủy |
| Kiểm | vitest `order-sync-write.test.ts` +6 ca (helper thuần, TikTok ca thật 586686865006495180, TikTok hủy trước lấy hàng, Shopee Failed Delivery + lượt sau rỗng, Lazada failed_delivery + kho đã quét), `cancel-request-plan.test.ts` +2 ca → 35/35 xanh; tsc backend / frontend / mobile sạch; eslint sạch. Chưa kiểm trên trình duyệt (cần đơn thật chuyển trạng thái) |
| Giới hạn | Chỉ áp cho đơn ĐÃ CÓ trong DB rồi mới thấy hủy (planner); đơn lần đầu đọc đã CANCELLED không biết trạng thái trước → giữ Đã hủy. Đơn hủy sau giao TRƯỚC khi đưa lên không được vá ngược (kho quét vẫn nhận được như cũ) |

### 8.5 Lát B đã làm rồi GỠ (29/10/2026 đêm) — webhook TikTok type 12 hỏi yêu cầu hoàn đúng đơn (xem 8.7)

| Phần | Mã |
|---|---|
| Hàm mới | `tiktok/returns-sync.ts` `syncTiktokReturnsForOrders(channel, orderIds)`: `returns/search` lọc `order_ids` (tối đa 40 trang), sàn trả yêu cầu của đơn không hỏi → ném lỗi không ghi (như quét bù), rồi `applyTiktokReturnGroups` với bộ quyết định của lượt quét thường (yêu cầu đang sống vẫn cắm AWAITING; sàn từ chối / hủy → hạ cờ; kiện về → mốc `returnDeliveredAt`) |
| Nối webhook | `tiktok/webhook-queue.ts` `handleTiktokOrderJob`: sau khi kéo chi tiết đơn, nếu `type = 12` (RETURN_STATUS_CHANGE) thì gọi hàm trên cho đúng mã đơn, cùng khuôn type 11 → `cancellations/search`. Lỗi nuốt + log `[Webhook TikTok] Lỗi hỏi yêu cầu hoàn đơn …`, không làm hỏng việc đơn (lượt quét nền 10–60 phút vẫn là lưới đỡ). Type 2 (bản cũ, bắn cả hủy lẫn hoàn) không nối để khỏi gọi đôi |
| Đường lui | env `TIKTOK_RETURN_WEBHOOK_LOOKUP=0` trên worker → tắt, về cách cũ |
| Tải sàn | 7 ngày prod có 10.417 sự kiện type 12 ≈ 1.500/ngày ≈ 1 call/phút toàn hệ thống, mỗi call 1 đơn. Rủi ro đã biết: `returns/search` gian lớn hay 429 `36009002` (docs/CUNG-HOA-LOP-GOI-SAN.md) — call này nằm trong việc webhook nên dính 429 thì việc ngủ trong slot như quét hoàn hiện nay (đại tu 5e); theo dõi log sau deploy, tắt bằng đường lui nếu hàng đợi sáng 10:00 xấu đi |
| Kiểm | `tiktok-returns-webhook-db.test.ts` 4 ca (cắm cờ + mốc sàn + giải pháp; webhook lặp idempotent + sàn từ chối hạ cờ; không yêu cầu / đơn lạ / mã rỗng; bộ lọc vô hiệu ném lỗi) + `tiktok-returns-backfill-db` + `tiktok-returns-sync` xanh; tsc sạch. `tiktok-webhook-inbox.test.ts` đỏ 1 ca chờ pg-boss quá 12 s — đỏ cả trên bản chưa sửa, test đó không gửi type 12 |
| Chưa làm | Shopee: yêu cầu hoàn trên đơn COMPLETED không có push → vẫn quét 10 phút. Lát C (lookup hỏi sàn đúng đơn trước khi trả "Không hoàn") chờ anh |

### 8.6 Lát C đã làm (29/10/2026 đêm) — màn quét hỏi sàn đúng đơn trước khi trả "Không hoàn"

| Phần | Mã |
|---|---|
| Luật + điều phối | `integrations/return-refresh.ts`: `needsReturnRefresh` (đơn SHIPPING / DELIVERED mà trục hoàn còn NONE — kiện đã rời shop), `claimReturnRefresh` (mỗi đơn 5 phút một lần, nhớ tối đa 5.000 đơn trong tiến trình), `canAskPlatform` (gian ACTIVE, còn token, không ngủ đông, app có cấu hình), `refreshReturnStateForOrder` hai bước: (1) kéo lại chi tiết đơn qua đúng đường webhook (`processTiktokOrderEvent` / `processShopeeOrderEvent` + `finishStockPush`, `processLazadaOrderPush`) → luật lát A bắt luôn ca hủy sau giao chưa kịp về; (2) hỏi yêu cầu hoàn theo mã đơn. Lỗi bước nào cũng nuốt + log `[Lookup] Hỏi sàn đơn …` |
| Hàm hỏi theo đơn | TikTok dùng `syncTiktokReturnsForOrders` (lát B); Shopee mới `syncShopeeReturnsForOrder` (`get_escrow_detail` → `return_order_sn_list` → `get_return_detail`, không phải lịch sử); Lazada mới `syncLazadaReturnsForOrder` (Reverse Order API lọc `trade_order_id`), thân vòng lặp của `syncLazadaReturns` tách thành `applyLazadaReturnGroup` dùng chung |
| Route | `GET /api/orders/lookup`: sau lượt tra đầu, đơn thấy + không nhập nhằng + không phải `?detail=1` + `needsReturnRefresh` → hỏi sàn rồi tra lại; trả thêm `askedPlatform: true` khi có hỏi. Đơn CANCELLED còn NONE (hủy trước khi đưa lát A lên) không hỏi (sàn không có gì mới) — app ghi "Sàn đã hủy đơn này, chưa có yêu cầu hoàn — kiện về tay thì bấm Quét nhận" |
| Tải sàn | Chỉ phát sinh khi kho quét kiện mà đơn còn NONE (30 ngày prod: 65 ca, nay phần lớn đã được lát A/B bắt trước) → vài call/ngày; 2–3 call mỗi lượt, cooldown 5 phút/đơn |
| Kiểm | `return-refresh.test.ts` 7 ca (luật đáng hỏi, cooldown, gian hỏi được, thứ tự hai bước TikTok, Shopee/Lazada đúng hàm, lỗi một bước không chặn bước kia, quét lặp không hỏi lại); `lazada-returns-sync` + `shopee-returns-sync` + `shopee-returns-backfill-db` + `tiktok-returns-webhook-db` xanh sau tách hàm; tsc backend + mobile sạch. Chưa kiểm trên máy thật (cần kiện thật về kho) |

### 8.7 Anh Trung gỡ lát B (29/10/2026 đêm) — nguyên tắc: sàn đã gọi rồi thì chỉ lấy về

Anh hỏi: "Cái này có thể ảnh hưởng sức khỏe HQ? Phần này không cần quá nhanh, chậm 30 phút cũng không sao, sao phải gọi API lên sàn nhiều lần trong khi phần đơn hàng đã gọi rồi, mình chỉ lấy về?" Đối chiếu từng lát theo số lượt gọi sàn:

| Lát | Gọi thêm sàn | Kết luận |
|---|---|---|
| A | 0 — luật đọc trên chi tiết đơn đã về qua webhook / quét 10 phút | Đúng nguyên tắc, xử lý 61/65 ca → **giữ** |
| B | ~1.500 call/ngày (`returns/search` mỗi sự kiện type 12), nằm trong việc webhook nên 429 là ngủ trong slot | Chỉ để nhanh hơn 10–60 phút so với lượt quét tầng nhanh (một call đọc cả gian) → **gỡ**: bỏ khối type 12 trong `webhook-queue.ts` + env đường lui; `syncTiktokReturnsForOrders` giữ vì lát C dùng, test giữ |
| C | 2–3 call chỉ khi kho quét kiện mà đơn còn NONE, nghỉ 5 phút/đơn; sau lát A còn rất ít ca | Tải gần bằng không → **giữ** |

Chi tiết đơn TikTok không mang yêu cầu trả hàng (API riêng) — vì thế yêu cầu hoàn vẫn do lượt quét tầng nhanh đọc, chậm tối đa 10–60 phút, anh chấp nhận.
