# Số đo gốc 12/10/2026 — băng thông worker (bước 0)

Bảng xuất nguyên văn từ Supabase SQL Editor (prod, chỉ đọc) lúc ~09:20 VN ngày
12/10/2026, bộ đếm `pg_stat_statements` từ 30/09 06:04 UTC (11,85 ngày), TRƯỚC
khi reset lúc 10:00 VN cùng ngày. Phân tích ở
`../BANG-THONG-WORKER-CO-VIEC-THI-GOI.md` mục 2.

| Tệp | Nội dung |
|---|---|
| `pgss-top-calls.md` | 40 câu gọi nhiều nhất (calls, rows, giây, độ dài câu) |
| `pgss-groups.md` | Gom theo nhóm (tx, pg-boss, order_update, …) kèm MB chữ |
| `pgss-top-rows.md` | 25 câu trả nhiều dòng nhất |
| `prod-counts.md` | Quy mô prod: gian/đơn theo sàn, đơn 2 ngày, chờ escrow, chưa quyết toán |

Để so "sau" với "trước": chạy lại ba câu SELECT tương ứng (ghi trong mục 2 của
tài liệu chính) sau khi lát A/B/C chạy ≥ 24 giờ.
