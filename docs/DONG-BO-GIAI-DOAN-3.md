# Giai đoạn 3 — Đồng bộ có cam kết đầy đủ và các worker còn lại

Ngày lập: 14/10/2026. Người lập: Claude (Lead Dev). Thiết kế gốc: `docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md` mục 6.3–6.5 (anh Trung duyệt hướng 30/09/2026). Kế hoạch 7 lát trình 12/10/2026, anh Trung duyệt làm lần lượt 14/10/2026.

## 0. Tiến độ

| Lát | Nội dung | Đổi DB | Tình trạng |
|---|---|---|---|
| 3.0 | Gỡ đuôi giai đoạn 1 (9 công tắc env đường lui + đường đọc đơn gốc) | Không | ✅ 14/10 `1ce3bd31` — chi tiết `docs/SO-CAI-DON.md` mục 9.8 |
| 3.1 | Hợp đồng "dữ liệu + đầy đủ" cho mọi lượt đọc sàn + sửa Lazada kéo đơn ASC→DESC | Không | ✅ 14/10 — mục 1 dưới |
| 3.2 | Mốc nước từng gian thay cửa sổ cứng 2 ngày | Có: 2 cột NULL trên `Channel` (trình SQL trước) | Chưa |
| 3.3 | Nhịp quét theo mức hoạt động (webhook vừa tới thì lùi quét; gian vắng 7 ngày → 6 giờ; có đơn 10 phút → 5 phút) | Không | Chưa — các số là mặc định tự chọn, anh chưa nhận |
| 3.4 | Bộ giới hạn tốc độ dùng chung ở DB, áp mọi API sàn | Có (bảng nhỏ) | Chưa |
| 3.5 | Worker còn vòng for → vé (token-refresh, lazada-renewal, stock-reconcile, weekly-report, ads-daily-summary) | Có (1–2 cột lịch) | Chưa |
| 3.6 | Chỉ số HQ: gian quá hạn quét, tỷ lệ lần đọc bị cắt, trễ mốc nước lớn nhất; test hàng rào | Không | Chưa |

Mỗi lát một lần đẩy (hai lần nếu có công tắc), đường lui = revert commit trừ khi ghi khác.

## 1. Lát 3.1 — hợp đồng "dữ liệu + đầy đủ" (14/10/2026)

### 1.1. Vì sao

Mọi hàm đọc sàn theo trang đều có chốt chặn số trang (Shopee 100 trang/lượt đơn, TikTok 50 trang/lát, Lazada 100 trang; yêu cầu hoàn 50 / 40 / 40 trang). Chạm chốt là còn dữ liệu chưa đọc. Trước 29/09 việc này im lặng; 29/09 ba hàm đồng bộ đơn bắt đầu trả `truncated` nhưng chỉ worker đơn ghi log, ba hàm quét yêu cầu hoàn vẫn im. Riêng Lazada kéo đơn `sort_direction=ASC` nên khi bị cắt, phần mất là đơn **mới nhất** — ngược hai sàn kia.

### 1.2. Làm gì

- `backend/src/integrations/sync-contract.ts`: hai kiểu chung. `SyncCompleteness { pages; truncated }` cho kết quả lượt đồng bộ (đọc + ghi); `ReadCompleteness { complete }` cho lượt đọc thuần (adapter danh mục đã có từ 29/09). Hàm `incompleteReadMessage` cho một dòng log thống nhất, từ khóa `CHƯA ĐỦ`.
- Sáu kết quả đồng bộ `extends SyncCompleteness`: ba hàm đơn (đã có cờ, chỉ gắn hợp đồng) + ba hàm quét yêu cầu hoàn (`syncShopeeReturns`, `syncTiktokReturns`, `syncLazadaReturns`) nay đếm `pages` và đặt `truncated` khi hết trần trang mà sàn vẫn báo còn.
- Worker `order-auto-sync.ts`: một hàm `warnIfIncomplete(channel, "đơn" | "yêu cầu hoàn", r, backfill?)` thay `warnIfTruncated`, gọi ở cả sáu chỗ.
- Lazada `client.ts` `getOrders`: `sort_direction=DESC` cho cả trục `updated_at` lẫn `created_at`. Với phân trang offset, DESC còn an toàn hơn khi có biến động giữa chừng: đơn vừa đổi nhảy lên đầu, các trang sau chỉ đọc trùng (upsert vô hại); ASC thì đơn đó nhảy xuống cuối, trang kế hụt một dòng ở biên — mất đơn không ai biết.
- Test `integrations/__tests__/sync-contract.test.ts`: khóa bằng kiểu (`expectTypeOf`) — hàm nào bỏ cờ là `tsc` đỏ, Render build đỏ (Render biên dịch cả test); kèm 3 ca kiểm chuỗi log.

### 1.3. Cố ý KHÔNG làm ở lát này

- **Không ghi "lần đọc chưa đủ" xuống cột / không đếm lên HQ** (kế hoạch 12/10 có ghi "ghi cột + đếm HQ"): không có cột sẵn để ghi mà lát này cam kết không migration; đếm trong RAM thì trang HQ (tiến trình web) không thấy số của worker. Lát 3.2 thêm cột mốc nước trên `Channel` — "mốc nước không tiến" chính là tín hiệu đúng hơn "số lần bị cắt", và lát 3.6 đưa lên HQ.
- **Lượt nạp lịch sử gian mới chưa đủ vẫn hạ cờ `historyBackfillPending`** (giữ hành vi cũ): giữ cờ thì mỗi lượt lại nạp 90 ngày và lại chạm cùng một chốt. Phần thiếu do mốc nước (3.2) bù dần.
- Các hàm đọc khác có trần trang (sao kê TikTok/Lazada, ví Shopee, báo cáo quảng cáo) chưa gắn hợp đồng — chúng không quyết định "đơn có hay không", xếp vào 3.5/3.6 khi đụng tới.

### 1.4. Kiểm sau deploy

1. Render Logs worker lọc `CHƯA ĐỦ`: dòng cũ của đơn vẫn ra (nếu có gian lớn), dòng mới `yêu cầu hoàn CHƯA ĐỦ` xuất hiện khi gian có hơn 2.500 (Shopee) / 2.000 (TikTok/Lazada) yêu cầu hoàn trong cửa sổ — bình thường là không có dòng nào.
2. Gian Lazada: log `[Auto-sync] Lazada "…": +N đơn mới` vẫn chạy sau deploy (sàn nhận `sort_direction=DESC`); đơn Lazada mới nhất vào Hubsell như trước (so với Seller Center một đơn vừa tạo).
3. Không có dòng `[Auto-sync] Lỗi đồng bộ đơn gian` mới cho Lazada trong 30 phút đầu.

Đường lui: revert commit. Không migration, không đổi env.
