# Lớp đọc sàn ở quy mô lớn — thiết kế lại (bản 2, 18/10/2026 đêm — anh chốt; Pha A ĐÃ ĐO xong 7 giả thuyết, xem 3b; Pha B "Nền" ĐÃ CODE 19/10, xem 5b; Pha C lát 1 "đọc bóng đơn" chạy thật 19/10, xem 5c; lát 2 "ghi Order" ĐÃ CODE 19/10 chưa bật, xem 5d)

> Bản 1 (18/10 tối) bị anh Trung bác đúng: nó vẫn là mô hình cũ ("quét cửa sổ thời gian,
> có trần trang, chạm trần thì cắm cờ") được sửa cho đỡ hỏng. Bản 2 đổi mô hình.
> Mốc anh đặt: **một shop 4.000 đơn/ngày là bình thường**, hệ thống 50.000 gian; và
> **không làm điều gì chưa chắc** — mọi quyết định dựa trên điều đã kiểm hoặc có thí nghiệm kèm tiêu chí đạt.

## 0. Bản 1 sai ở đâu

| Bản 1 | Vì sao chưa đủ |
|---|---|
| Giữ "trần trang + cờ `truncated`", thêm con trỏ tiếp | Vẫn chấp nhận một lượt đọc KHÔNG TRỌN rồi đoán phần thiếu. Shop 4.000 đơn/ngày thì lượt nào cũng không trọn. Phải thiết kế để **không bao giờ có lượt không trọn**, chỉ có "đang trễ bao nhiêu". |
| Mốc vét dựa vào thứ tự sàn trả về | Shopee không cho chọn thứ tự, TikTok chưa kiểm. Thiết kế đúng **không được phụ thuộc thứ tự**. |
| Nạp 90 ngày gian mới vẫn là một lượt trong suất worker | 4.000 đơn/ngày × 90 ngày = 360.000 đơn ≈ 3.600 trang danh sách + 7.200 lệnh chi tiết Shopee ≈ 11.000 lệnh. Đây là **một công việc dài có tiến độ**, không phải một lượt quét. |
| Vẫn quét mọi gian mỗi 10 phút | 50.000 gian × 6 lượt/giờ × ≥3 lệnh ≈ 250 lệnh/giây chỉ để hỏi "có gì mới không" cho gian phần lớn đang vắng. Không quota nào chịu nổi, dù mã có sạch tới đâu. |
| Trần theo app nằm trong RAM từng tiến trình | Thêm worker là trần nhân đôi. Phải là một **bộ đếm dùng chung**. |
| Chưa có số đo mục tiêu | Không có "thế nào là chạy tốt" thì không biết khi nào xong, không biết khi nào hỏng. |

## 1. Mốc thiết kế và con số

Mốc: 50.000 gian, 1 triệu đơn/ngày (KIEN-TRUC-QUY-MO-TRIEU-DON), trong đó có gian 4.000+ đơn/ngày.

| Đại lượng (gian 4.000 đơn/ngày) | Ước tính | Hệ quả |
|---|---|---|
| Biến động đơn/ngày (mỗi đơn ~4 lần đổi trạng thái) | ~16.000 | 10 phút ≈ 110 biến động ≈ 2 trang danh sách + 3 lệnh chi tiết Shopee — quét tăng dần là nhẹ |
| Nạp 90 ngày | 360.000 đơn, ~11.000 lệnh Shopee, ~540.000 dòng ghi DB | phải là công việc nền có điểm lưu, tốc độ có kiểm soát (bài học sổ cái đè Nano 30/09) |
| Giao dịch ví Shopee/ngày | 4.000–8.000 | đọc lại 30 ngày mỗi giờ = 120.000–240.000 dòng/giờ cho MỘT gian → bắt buộc đọc tăng dần |
| Webhook/ngày | ~16.000 | hộp thư đến hiện có chịu được (pg-boss, HANG-DOI-BEN) |

**4.000 đơn/ngày là MỘT gian, không phải tổng nhiều gian** (anh Trung nhấn 18/10). Đây là ca
khó hơn hẳn: mọi giới hạn sàn (quota theo gian, cửa sổ ≤15 ngày, trang, token trang) tính **theo
từng gian**, không chia nhỏ ra nhiều gian để chạy song song được. Hệ quả cho thiết kế:
- **Thông lượng một gian bị chặn bởi quota của chính gian đó**, không phải bởi worker. Nạp 90 ngày
  gian lớn mất bao lâu là do sàn quyết; phải báo khách thời gian thật (tiến độ %), không hứa "vài phút".
- Gian lớn phải được **nhặt việc liên tục** (lịch theo độ trễ, N1/N6), còn gian nhỏ thưa — chia đều
  theo *độ trễ*, không chia đều theo *số lượt*.
- Mỗi lượt đọc của gian lớn vẫn bị giới hạn K trang (N6) để không chiếm suất, nhưng gian đó quay lại
  ngay khi có suất; độ trễ của nó là số đo riêng trên HQ.
- Webhook: hộp thư đến khóa theo (sàn, gian, **mã đơn**) — đã kiểm `webhook-inbox.ts:60` — nên
  16.000 sự kiện/ngày của một gian chạy song song, không xếp hàng sau nhau theo gian.
- Nhiều gian cộng lại 4.000 đơn/ngày là bài toán khác (dễ hơn: song song theo gian) — không lấy
  trường hợp đó làm mốc.

Số các sàn (đã có trong mã, kiểm docs trước đó): Shopee danh sách 100 đơn/trang, cửa sổ ≤15 ngày, chi tiết 50 đơn/lệnh; TikTok tìm đơn trả cả đơn, có `sort_field` (create_time | update_time — nhưng mã hiện tại KHÔNG gửi, xem 3b H1); Lazada 100 đơn/trang, sort DESC được. Ví Shopee 40 dòng/trang, cửa sổ sàn chê nếu dài (tự chia đôi đã có).

## 1b. Phương thức (làm đúng một lần) ≠ dung lượng (nâng gói dần)

Anh Trung 18/10: "thứ anh cần là một phương thức, còn dung lượng thì phụ thuộc gói nâng dần."
Tiêu chí của thiết kế này: **khi gian/đơn tăng gấp 10, việc phải làm chỉ là nâng gói và đổi số
trong cấu hình — không sửa mã, không đổi mô hình.**

| Phương thức — mã phải đúng từ bây giờ | Dung lượng — nâng khi tới mốc, không sửa mã |
|---|---|
| Con trỏ + điểm lưu từng trang (N2): không mất dữ liệu dù gian lớn tới đâu, chỉ trễ | Số worker Render, số luồng mỗi làn (`ADS_CONCURRENCY`, …) |
| Cửa sổ tự co (N3): không phụ thuộc thứ tự sàn, tự khớp mọi cỡ gian | Gói Supabase (RAM, IOPS, dung lượng) — mốc M1… trên HQ |
| Bộ đếm tốc độ dùng chung (N4): đúng với 1 hay 20 tiến trình | Quota API sàn — mở ticket ở mốc Đ3 (500 gian), nâng là đổi số trần |
| Lùi theo gian + cầu dao chỉ cho lỗi cứng (N5): một gian lỗi không kéo gian khác | Redis thay GCRA-Postgres nếu H5 đo ra DB đuối — đổi phần cài đặt sau giao diện, không đổi logic |
| Làn + thuê bao nhịp tim + chia đều theo độ trễ (N6): một việc chậm không lan | K trang/lượt, Δ cửa sổ, mục tiêu độ trễ — số trong `config/`, đọc env |
| Webhook chính, quét theo độ trễ (N1): tải quét không tỉ lệ với số gian | Hạn mức webhook của sàn (sàn quyết) |
| Mọi thứ đo được trên HQ (N7): biết đang trễ ở đâu trước khi khách biết | — |

Phép thử cho mọi quyết định sau này: "cái này là phương thức hay dung lượng?" — nếu phải sửa mã
khi khách lớn hơn thì đó là lỗi phương thức, không phải thiếu dung lượng.

## 2. Mô hình đích — 7 nguyên lý

**N1 · Webhook là nguồn chính, quét là đối soát.** Đã là định hướng (DONG-BO-GIAI-DOAN-3), nhưng
quét hiện vẫn chạy như nguồn chính (mỗi 10 phút, mọi gian). Đích: quét theo **độ trễ đo được** —
gian có webhook đều đặn thì quét thưa (giờ/ngày) để bắt phần webhook lỡ; gian không có webhook
(sàn chưa bật, gian mới) thì quét dày. Lát 3.3 "bậc VẮNG" là một phần của N1.

**N2 · Con trỏ + điểm lưu từng trang (checkpoint), không có khái niệm "bị cắt".** Mỗi (gian, luồng
dữ liệu: đơn / hoàn / escrow / ví / sao kê …) có **một con trỏ lưu trong DB**: "đã đọc trọn tới mốc
thời gian T". Mỗi lượt đọc tối đa K trang rồi dừng, ghi con trỏ **cùng giao dịch với dữ liệu trang đó**.
Gian lớn chỉ **trễ hơn**, không bao giờ **mất**. Độ trễ = now − T, đo được cho mọi gian.
(Cùng tư duy offset của hàng đợi sự kiện / CDC: tiến độ là trạng thái bền, không phải biến RAM.)

**N3 · Cửa sổ tự co, không phụ thuộc thứ tự sàn trả.** Khi sàn không cho chọn thứ tự (Shopee) hoặc
chưa kiểm được (TikTok), KHÔNG đoán phần thiếu. Thay vào đó: chọn cửa sổ [T, T+Δ] sao cho **đọc trọn
trong ≤K trang**; nếu trang K vẫn còn tiếp → **chia đôi Δ** và đọc lại (đọc trùng vô hại vì upsert).
Đọc trọn cửa sổ thì thứ tự bên trong không quan trọng. Δ tự học theo gian (gian 4.000 đơn/ngày → Δ ≈
vài giờ; gian vắng → Δ = 15 ngày). Mã ví Shopee đã chia đôi khi sàn chê — nay thành luật chung.

**N4 · Một bộ đếm tốc độ dùng chung (GCRA trong Postgres).** Mỗi khóa (app; app×gian; **app×endpoint** — anh chốt 18/10 đêm sau H4: 100 % 429 Ads rơi vào một endpoint, hai gian cùng giây) một dòng, một
mốc thời gian; xin lượt = một UPDATE có điều kiện. O(1), không mảng cửa sổ, đúng giữa nhiều tiến trình,
không mất khi khởi động lại. Giao diện tách riêng để sau này đổi sang Redis nếu DB bận (chưa cần —
chưa có Redis trên hạ tầng). Ban đầu chỉ bật trần ở nơi có bằng chứng sàn giới hạn (Ads Shopee/Lazada;
TikTok theo app×gian đã ghi docs); nơi khác chỉ **đo**, chưa chặn.

**N5 · Lùi theo gian, thích ứng, có xáo trộn; cầu dao chỉ cho lỗi cứng.** 429 tầng gian → gian đó lùi
theo cấp số nhân có xáo trộn toàn phần (full jitter), tôn trọng `Retry-After` nếu sàn gửi; tỷ lệ 429
tăng → hạ tốc cả khóa (AIMD), khỏe → tăng dần. **Cầu dao dừng hẳn chỉ còn cho lỗi không thể tự hết**:
mã vượt trần theo app thật, ủy quyền bị thu hồi. Trạng thái lùi lưu DB. Hết "vài gian lỗi → tắt cả app".

**N6 · Làn riêng, thuê bao có nhịp tim, chia đều giữa gian.** Worker giữ nguyên; đổi cách nhặt việc:
- Làn **đơn+webhook** / **tài chính** / **Ads** / **nạp gian mới** — mỗi làn số luồng riêng (bulkhead:
  một làn kẹt không lan).
- Nhặt việc bằng `FOR UPDATE SKIP LOCKED` (đã dùng ở sổ cái + hóa đơn), **thuê bao (lease) có nhịp tim**
  thay khóa 15' cứng → lượt dài không bị worker khác chạy trùng.
- **Chia đều giữa gian:** mỗi lượt tối đa K trang / X giây rồi trả suất; gian lớn quay lại nhiều lần,
  gian nhỏ không bị đói. Lấp suất ngay khi rảnh, không chờ nhịp 20 giây.
- Làn nạp gian mới: tối đa N gian nạp cùng lúc, tốc độ ghi DB có kiểm soát; tiến độ (%) hiện cho khách.

**N7 · Đo được, có mục tiêu.** Mỗi (gian, luồng) có độ trễ; mục tiêu đề xuất: **99 % gian có độ trễ đơn
< 15 phút**, nạp gian mới 4.000 đơn/ngày xong trong < 2 giờ, 429 tầng gian không làm gian khác trễ.
HQ vẽ **phân bố** độ trễ (p50/p99), số gian đang lùi, tồn từng làn, tỷ lệ 429 theo khóa — thay cho
"gian trễ nhất".

## 3. Giả thuyết phải kiểm TRƯỚC khi viết mã (Pha A)

Không xây gì trên giả thuyết chưa kiểm. Mỗi giả thuyết có cách kiểm và tiêu chí đạt.

| # | Giả thuyết | Cách kiểm (chỉ đọc) | Đạt khi | Nếu không đạt |
|---|---|---|---|---|
| H1 | TikTok `orders/search` tôn trọng `sort_field=update_time` | gọi thật 1 gian, 3 trang, so thứ tự | đơn điệu giảm | dùng N3 (cửa sổ co), không cần thứ tự |
| H2 | Shopee `get_order_list` trong cửa sổ ≤15 ngày trả **đủ** đơn khi đọc hết trang, bất kể thứ tự | đếm đơn 1 ngày qua API vs Seller Center 2 gian | khớp 100 % | tìm mẫu thiếu, báo ticket Shopee kèm request_id |
| H3 | Webhook phủ ≥99 % biến động đơn (nền tảng của N1) | 7 ngày: biến động thấy lần đầu qua webhook vs qua quét (log + sổ cái) | ≥99 % cho gian có webhook | quét vẫn là nguồn chính, N1 lùi lại |
| H4 | 429 Ads Shopee là tầng gian, do 5–7 lệnh dồn trong vài giây | log `[ApiBudget] 429` 24h; thử giãn 5 giây trên 2 gian | 429 giảm rõ | xem lại nhịp xung 30' |
| H5 | GCRA trong Postgres chịu được tải mục tiêu | đo: 1 UPDATE/lệnh; mục tiêu ~300 lệnh/giây ở 1 triệu đơn/ngày | ≥ 300 lệnh/giây và **chi phí xin lượt < 5 % thời gian một lệnh sàn** (anh chốt 18/10 đêm thay cho "p99 < 5 ms" — 4,4 ms là RTT Render↔pooler, không phải DB) | xin lượt theo lô; đổi sang Redis khi tới mốc, giữ giao diện |
| H6 | Số dư ví Shopee = `current_balance` giao dịch mới nhất trong cửa sổ MỚI nhất (1 trang) | so với cách đọc 30 ngày hiện tại trên ANO | khớp từng đồng | giữ cách cũ, chỉ thêm con trỏ |
| H7 | Mỗi gian 4.000 đơn/ngày sinh ~16.000 biến động | đếm trên sổ cái gian lớn nhất hiện có, ngoại suy | sai số < 2× | chỉnh K, Δ |

Pha A xong → bảng này có kết quả thật, ghi vào mục 3 trước khi sang Pha B.

## 3b. Pha A — kết quả kiểm (18/10/2026 đêm, ĐÃ CÓ SỐ THẬT cả 7)

Công cụ: `backend/scripts/pha-a-san-probe.ts` (chỉ đọc sàn) chạy trên **Render shell worker** (commit `8a0ce112`,
21:30–21:50 ngày 18/10) + SQL chỉ đọc trên Supabase (3b.8) + log Render worker 24 giờ. Thay đổi mã duy nhất:
`fetchOrders` TikTok nhận thêm `sortField`/`sortOrder` **tùy chọn** — không truyền = không gửi, worker không đổi.

| # | Kết quả | Số đo thật | Hệ quả cho thiết kế |
|---|---|---|---|
| H1 TikTok tôn trọng `sort_field=update_time` | ✅ ĐẠT khi GỬI · ❌ worker hiện tại KHÔNG gửi | 24/24 gian: gửi `sort_field=update_time` → update_time giảm đơn điệu **đúng cả 24**, 0 đơn ngoài cửa sổ. Không gửi (như worker): **24/24 sai**, và thứ tự thật là **create_time TĂNG dần** (cũ nhất trước — ngược với docs "mặc định DESC" và ngược giả định "ba sàn đọc mới nhất trước" của lát 3.2). **Siêu Thị 8686 TikTok**: cửa sổ 2 ngày có `total_count` **2.577** > trần 2.500 (50 trang × 50) → mỗi lượt đọc 2.500 đơn *cũ nhất*, mốc vét lấy update_time nhỏ nhất đã đọc rồi vét lại một cửa sổ 18 phút, lượt sau lại 2.500 → **mốc nước kẹt** — chính là thẻ đỏ HQ tối 18/10 (log 21:20:35 `2500 đơn`, 21:31:45 vét `1 đơn`). | N2+N3 đúng hướng: không được phụ thuộc thứ tự; cửa sổ phải tự co tới khi đọc trọn. **Vá đúng chỗ ngay được** (không phải vá ngưỡng): gửi `sort_field=update_time, DESC` ở worker TikTok để giả định của mốc vét thành đúng → 8686 hết kẹt; chờ anh chốt. |
| H2 Shopee `get_order_list` đọc hết trang có đủ đơn | ✅ API = DB (Seller Center anh so thêm) | Ngày VN 17/10, trục create_time, đọc hết trang: ANO **34 = 34** DB, Kids Minh Tuyết **35 = 35** DB, 0 chỉ-API / 0 chỉ-DB. (Trục update_time cùng ngày: 81 và 176 đơn — biến động ≈ 2,4–5× đơn mới.) | Cửa sổ đọc trọn → đủ; không cần thứ tự. Anh so Seller Center → Đơn hàng → Ngày đặt 17/10 cho 2 gian là chốt hẳn. |
| H3 Webhook phủ ≥ 99 % | ✅ ĐẠT | 6 ngày, đơn tạo sau khi nối gian ≥ 1 giờ: **Shopee 2.510/2.515 = 99,80 %** (49/50 gian ≥ 99 %, gian còn lại < 10 đơn); **TikTok 2.057/2.057 = 100 %** (22/22). Độ trễ webhook đầu so với giờ đặt: Shopee p50 **2 s**, p95 8 s, p99 18 s (2 đơn > 15'); TikTok p50 = p95 = p99 = **2 s**. Lazada: không có gian thật đang hoạt động trong cửa sổ → chưa đo. | N1 đứng vững: webhook là nguồn chính, quét là đối soát thưa. Mục tiêu N7 "99 % gian trễ < 15'" khả thi vì webhook đã < 20 s. |
| H4 429 Ads do 5–7 lệnh dồn | ❌ KHÔNG ĐÚNG như giả thuyết — là MỘT endpoint | 24 giờ (17/10 23:01 → 18/10 21:27): **12 lần cầu dao đóng** (bậc 0→3, 5'→40'), `api_throttle_states.tripCount` app Ads 2044679 = **125**, app chính 2040029 = 14. **100 % dòng 429 Shopee rơi vào `get_all_cpc_ads_daily_performance`** (cả xung 30' lẫn lịch sử 6 h), mỗi gian 1 lần/xung, 6 lệnh còn lại của xung không bao giờ 429. Hai gian khác nhau 429 cùng giây (17:58:25) → nghi trần theo **app × endpoint**, không chỉ theo gian. Docs Shopee endpoint này không công bố trần. TikTok: 429 `36009002` trên `returns/search`, `retry-after` trống, tự thử lại 1–2 lần là qua. Mã không đọc `Retry-After` (0 chỗ). | N4 khóa phải là **(app, endpoint)** ngoài (app, gian). Cầu dao "bão ≥ 3 gian/10'" đang đóng 12 lần/ngày vì endpoint này lẻ tẻ 429 là bình thường → N5 đúng: lùi theo khóa + AIMD, cầu dao chỉ cho lỗi cứng. Việc nhỏ ngay: gộp daily_performance của xung và lịch sử thành một lệnh/gian/xung. |
| H5 GCRA-Postgres chịu tải | ✅ thông lượng · ⚠️ p99 không < 5 ms | **Render → Supabase Micro (pooler SG), worker đang chạy**: nhiều khóa **1.755 lệnh/giây**, p50 4,4 ms, p95 7,4 ms, p99 38 ms; một khóa nóng hết sức 811/giây p99 34 ms; một khóa ở nhịp thật 300/giây: p50 4,4 ms, p95 9,9 ms, **p99 31 ms**; lượt bị chặn p99 52 ms; 0 lỗi kết nối với 16 kết nối. (Máy dev: 13.900/giây, p99 1,2 ms — trần row lock ≈ 0,15 ms.) | Sàn 4,4 ms là RTT Render↔pooler, không phải DB chậm → tiêu chí "< 5 ms" đặt sai: nên là **chi phí xin lượt < 5 % thời gian một lệnh sàn** (lệnh sàn 200–1.000 ms → p99 31–38 ms = 3–15 %). Phương thức giữ GCRA-Postgres; dung lượng: xin lượt **theo lô** (một lần cho K trang) để chia nhỏ chi phí, Redis chỉ khi tới mốc. Chờ anh chốt tiêu chí mới. |
| H6 Số dư ví = 1 trang mới nhất | ✅ ĐẠT khớp từng đồng | ANO: (a) 1 lệnh, cửa sổ 168 h, trang 0 = 40 dòng **MỚI → CŨ** → **44.505.039 ₫** = (b) quét 30 ngày 40 lệnh / 1.498 giao dịch → 44.505.039 ₫ (tiết kiệm 39 lệnh/lượt). Kids Minh Tuyết: 1 lệnh vs 5 lệnh, **4.149.400 ₫** khớp. Sàn trả trang MỚI → CŨ (docs không nói). | Luồng ví: số dư = 1 lệnh; lệnh rút (withdrawal) đọc tăng dần theo con trỏ (N2). Gian 4.000 đơn/ngày hết đọc lại 120–240 nghìn dòng/giờ. |
| H7 ~16.000 biến động/gian 4.000 đơn | ✅ sai số < 2× (số thật cao hơn) | Sự kiện sàn gửi ÷ đơn mới trong ngày (6 ngày): LUMI SOLAR 5,4–8,0; Gia Dụng RUXI 6,6–7,7; Kids Minh Tuyết 6,0–12,4; Siêu Thị 8686 TikTok ngày nối 17,0 (nạp lại). Trung bình sự kiện/đơn có webhook: Shopee **6,48**, TikTok **5,46**; tối đa một đơn 16–20. | Lấy **6–8 biến động/đơn** → gian 4.000 đơn/ngày ≈ **24.000–32.000 sự kiện/ngày** (≈ 20/phút): hộp thư đến hiện có vẫn nhẹ; K trang/lượt và Δ tính theo số này, không theo 16.000. |

### 3b.1 Việc còn lại cho anh (không chặn Pha B)

1. **Seller Center Shopee** (chốt H2/H6 tới tận màn khách): Đơn hàng → Ngày đặt **17/10** cho ANO (34) và Kids Minh Tuyết (35);
   Tài chính → Số dư TK Shopee: ANO **44.505.039 ₫** (lúc 20:34 VN 18/10), Kids **4.149.400 ₫** (12:56 VN 18/10).
2. ~~Chốt 3 điểm~~ **Anh chốt 18/10 đêm:** (a) ✅ vá ngay — worker TikTok gửi `sort_field` theo đúng trục quét, DESC
   (`tiktokOrderSearchSort`, test `tiktok-order-search-sort.test.ts`); (b) ✅ tiêu chí H5 = "< 5 % thời gian lệnh sàn" + xin lượt
   theo lô (đã sửa bảng mục 3); (c) ✅ khóa N4 thêm (app, endpoint) (đã sửa N4). → Sang Pha B.

### 3b.1b Đóng Pha A (anh Trung 18/10 22:20)

- Anh chốt: **kiểm xong bản vá → commit; Pha B chỉ làm khi anh gọi.** Phần "bật đo chạm trần ở mọi hàm đọc + thẻ HQ chỉ nhìn"
  (mục 5 dòng Pha A) **đề xuất bỏ**: số đo đã có từ probe + log, chỉ 8686 chạm trần; thẻ đo riêng là thứ Pha B thay.
- Kiểm bản vá `f7820681` trên prod (worker live 21:53): lượt 21:50 còn mã cũ → mốc nước 8686 lùi 01:55 → 01:27 ngày 16/10
  (đúng cơ chế kẹt); lượt vét 21:59 (mã mới) đóng cửa sổ 2 phút. Lượt tiến mốc đầu tiên bằng mã mới: xem dòng cuối 3b.1b
  **✅ 22:22:41 lượt tiến mốc đầu tiên bằng mã mới:** vẫn cắt ở 2.500 nhưng mốc vét = `2026-10-16T18:32:08` (phần cũ hơn
  THẬT, không còn cửa sổ 2 phút); **22:23:03 vét xong 00:57 → 18:32, mốc nước = 16/10 18:32:08** (+17 giờ trong một lượt;
  trước đó 3 lượt lùi dần 02:07 → 01:55 → 01:27). Còn ~2 ngày ≈ 2.600 biến động → 1–2 lượt nữa mốc nước tới hiện tại, thẻ HQ xanh.
  Pha A ĐÓNG; Pha B chờ anh gọi.

- **19/10 chiều — mốc 8686 vẫn kẹt, kiểu HAI:** sau `f7820681` sàn trả đúng DESC nhưng gian có > 2.500 biến động/cửa sổ thì mỗi chu kỳ 2 lượt chỉ tiến 6–13 phút (đọc lại mãi 2.500 đơn mới nhất, phần đã đọc không được ghi nhận). Lỗi thiết kế lát 3.2, sửa ở `docs/DONG-BO-GIAI-DOAN-3.md` mục 2.8 (TikTok đọc CŨ → MỚI, `coveredUpToSec`). Đúng hướng N2 "cửa sổ co" của bản này — Pha C đã làm trong đường mới; đường cũ vá tối thiểu để prod không kẹt trong lúc bóng chạy.

### 3b.2 Điều phải sửa trong bản thiết kế sau Pha A

- Mục 1: biến động/ngày của gian 4.000 đơn = **24.000–32.000** (không phải 16.000); webhook/ngày cùng số.
- N3: TikTok có `sort_field` dùng được, nhưng thiết kế vẫn **không dựa vào thứ tự** (Shopee không có; TikTok filter update_time lỏng theo docs).
- N4: khóa GCRA = (app) · (app, gian) · **(app, endpoint)**; trần chỉ bật nơi có bằng chứng — hiện là `get_all_cpc_ads_daily_performance`.
- N5: cầu dao "bão" hiện tại là **giả dương** (12 lần/ngày vì một endpoint lẻ tẻ) → bỏ khi N5 lên, như đã viết.
- N7: thêm số đo "độ trễ webhook" (p50/p99) vào HQ — đã có số nền 2 s / 18 s để so.

### 3b.8 SQL chỉ đọc (Supabase)

**A — H3: webhook phủ bao nhiêu % đơn, trễ bao lâu (6 ngày qua, gian ACTIVE).** `Order.createdAt` là giờ đặt phía sàn;
`webhook_events.createdAt` là giờ Hubsell nhận.
```sql
WITH o AS (
  SELECT o."orderCode", o."createdAt", c."channelName"::text AS src, c."externalShopId" AS shop_id, c."shopName"
  FROM "Order" o JOIN "Channel" c ON c.id = o."channelId"
  WHERE c."channelName" IN ('SHOPEE','TIKTOK','LAZADA') AND c.status = 'ACTIVE'
    AND o."createdAt" >= now() - interval '6 days' AND o."createdAt" < now() - interval '1 hour'
), w AS (
  SELECT source, "shopId", "entityId", min("createdAt") AS first_at, count(*) AS n
  FROM webhook_events
  WHERE source IN ('SHOPEE','TIKTOK','LAZADA') AND "createdAt" >= now() - interval '7 days'
  GROUP BY 1,2,3
)
SELECT o.src, o."shopName", count(*) AS don, count(w.first_at) AS co_webhook,
       round(100.0 * count(w.first_at) / count(*), 2) AS pct_webhook,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM w.first_at - o."createdAt"))) AS p50_tre_giay,
       round(percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM w.first_at - o."createdAt"))) AS p99_tre_giay,
       round(avg(w.n), 2) AS su_kien_moi_don
FROM o LEFT JOIN w ON w.source = o.src AND w."shopId" = o.shop_id AND w."entityId" = o."orderCode"
GROUP BY 1, 2 ORDER BY 1, 3 DESC;
```
Đạt khi `pct_webhook ≥ 99` cho gian có webhook (gian 0 % = sàn chưa bật push cho gian đó — ghi riêng).

**B — H7: biến động/ngày theo gian (sự kiện sàn gửi) so với đơn mới trong ngày, 6 ngày qua, 40 dòng lớn nhất.**
```sql
WITH ev AS (
  SELECT source, "shopId", (("createdAt" + interval '7 hours')::date) AS d,
         count(*) AS su_kien, count(DISTINCT "entityId") AS don_co_su_kien
  FROM webhook_events
  WHERE source IN ('SHOPEE','TIKTOK','LAZADA') AND "createdAt" >= now() - interval '6 days'
  GROUP BY 1, 2, 3
), od AS (
  SELECT c."channelName"::text AS source, c."externalShopId" AS "shopId", c."shopName",
         ((o."createdAt" + interval '7 hours')::date) AS d, count(*) AS don_moi
  FROM "Order" o JOIN "Channel" c ON c.id = o."channelId"
  WHERE o."createdAt" >= now() - interval '6 days'
  GROUP BY 1, 2, 3, 4
)
SELECT od.source, od."shopName", od.d, od.don_moi, ev.su_kien, ev.don_co_su_kien,
       round(ev.su_kien::numeric / NULLIF(od.don_moi, 0), 2) AS su_kien_moi_don_moi
FROM od LEFT JOIN ev ON ev.source = od.source AND ev."shopId" = od."shopId" AND ev.d = od.d
ORDER BY od.don_moi DESC LIMIT 40;
```
Ước tính docs mục 1 là ~4 biến động/đơn; đạt khi số đo nằm trong 2–8.

**C — H4 (phụ): lịch sử cầu dao.**
```sql
SELECT app, "pausedUntil", level, reason, "tripCount", "updatedAt" FROM api_throttle_states;
```

## 4. Thành phần

```
Webhook (3 sàn) ──► hộp thư đến (có) ──► sự kiện đơn ──► upsert idempotent ──► sổ cái
                                                                            ▲
Bộ lập lịch độ trễ ──► Làn đơn ──► Máy đọc con trỏ (N2+N3) ──► cổng gọi sàn (N4+N5) ──► sàn
  (N1, N6)        ├─► Làn tài chính ──► (cùng máy đọc, luồng escrow/ví/sao kê)
                  ├─► Làn Ads ──────► xung/lịch sử Ads (phương án 4 lát 17/10 nằm ở đây)
                  └─► Làn nạp gian mới ──► công việc dài có điểm lưu + tiến độ
HQ: độ trễ p50/p99 theo luồng, gian đang lùi, tồn làn, 429 theo khóa, tiến độ nạp
```

- **Máy đọc con trỏ** là MỘT đoạn mã dùng chung; mỗi (sàn, luồng) chỉ khai: cách gọi 1 trang, cách
  lấy mốc thời gian của dòng, trần cửa sổ của sàn. Hết chuyện mỗi hàm tự chọn trần và tự xử lý cắt.
- **Cổng gọi sàn** là MỘT đoạn mã: xin lượt (N4) → gọi → phân loại lỗi theo bảng từng sàn → lùi/ghi (N5)
  → log 429 kèm request_id. Mọi lệnh đi qua; trần chỉ bật ở khóa có bằng chứng.
- Dữ liệu ghi: upsert theo khóa sàn (có), **con trỏ ghi cùng giao dịch** với trang → at-least-once +
  idempotent = không mất, không nhân đôi.

## 5. Lộ trình — chuyển dần, không cắt một nhát

| Pha | Việc | Bảo đảm |
|---|---|---|
| **A · Đo & kiểm** (2–3 ngày) | Bảng H1–H7; bật đo "chạm trần" ở mọi hàm đọc hiện có + thẻ HQ (chỉ nhìn, không đổi hành vi); đếm biến động/gian; đọc log 429 | Có số thật trước khi thiết kế chi tiết |
| **B · Nền** | Máy đọc con trỏ + cửa sổ co; cổng gọi sàn + GCRA + lùi theo gian lưu DB; làn + thuê bao nhịp tim; sàn giả trong test (gian 20.000 đơn, tiêm 429, đổi thứ tự, trùng dòng, token trang hết hạn); kiểm tính chất: *mọi thứ tự trả về đều ra cùng tập dữ liệu* | Mã mới chưa nối prod; test đỏ đúng các lỗi hôm nay |
| **C · Chuyển từng luồng, chạy bóng** | Thứ tự: đơn 3 sàn → ví/escrow/sao kê → Ads → sản phẩm/đánh giá. Mỗi luồng: bật theo **cờ từng gian**, chạy **song song** với mã cũ 3–7 ngày, so khớp số (đơn, tiền) từng gian, lệch = dừng, tìm gốc. Đạt thì mở rộng theo gian. | Không có "đổi cho tất cả rồi xem" |
| **D · Dọn** | Gỡ mã cũ, cờ, trần trang rải rác; docs hợp đồng đọc sàn thay DONG-BO-GIAI-DOAN-3 mục 1 | Một đường đọc sàn duy nhất |
| **Nạp lại** | Gian đã bị cắt dữ liệu (danh sách từ Pha A): nạp lại bằng làn nạp mới, so trước–sau | Khách không phải tự bấm |

Mỗi pha có số đo trước–sau trên HQ. Pha nào không đạt tiêu chí thì không sang pha sau.

## 5b. Pha B "Nền" — đã làm (19/10/2026, anh: "Tiếp tục triển khai làm pha B, nền")

Ba lát, **chưa nối worker nào** (Pha C mới chuyển từng luồng theo cờ gian). Hai bảng mới + 2 hàm SQL chạy khi
Render `migrate deploy`; không đụng bảng cũ (khóa ngoại tới `Channel` có khối lấy khóa thử lại).

| Lát | Tệp | Việc |
|---|---|---|
| **B1** máy đọc con trỏ (N2+N3) | `lib/cursor-window.ts` (thuần) · `services/cursor-reader.ts` · bảng `sync_cursors` | Mỗi (gian, luồng) một con trỏ "đã đọc TRỌN tới T" + cửa sổ đã học. Đọc trọn cửa sổ trong ≤ K trang thì tiến con trỏ **cùng giao dịch** với trang cuối; tràn → co (có tổng sàn → co theo tỷ lệ ngay trang đầu, không thì chia đôi); ở đáy vẫn tràn → đọc tiếp, **không bao giờ cắt**. Token trang hết hạn → đọc lại cửa sổ. Ngân sách lượt xét ở **ranh cửa sổ**. Lỗi tạm có hẹn chờ → đọc lại đúng trang đó. Hợp đồng adapter: `fetchPage(win, token)`, `rowKey`, `persist(rows, tx)`. |
| **B2** cổng gọi sàn (N4+N5) | `lib/rate-gate.ts` (thuần) · `services/marketplace-gateway.ts` · bảng `api_rate_keys` + hàm `api_rate_take` / `api_rate_penalize` | GCRA nhiều khóa trong **một** vòng đi-về DB, tất cả hoặc không, xin lượt **theo lô** (anh chốt H5). Khóa `(app)` · `(app, gian)` · `(app, endpoint)` (anh chốt sau H4). Trần chỉ bật nơi có bằng chứng: TikTok App × gian, Shopee `get_all_cpc_ads_daily_performance`; khóa khác chỉ lùi + đo (không ghi DB khi xin lượt). Lùi full jitter + tôn trọng Retry-After; 429 không rõ tầng → lùi gian **và** hạ nhịp endpoint (AIMD ×0,5, hồi tuyến tính); "cầu dao" chỉ còn cho lỗi cứng theo app. Bảng phân loại lỗi 3 sàn lấy từ mã hiện có. |
| **B3** làn + thuê bao (N6) | `services/sync-lanes.ts` · cột `lane/dueAt/leaseOwner/leaseUntil` trên `sync_cursors` | Nhặt `FOR UPDATE SKIP LOCKED`, `dueAt` sớm nhất trước (lượt hết ngân sách đặt dueAt = now → quay lại ngay nhưng xếp sau gian chờ lâu hơn). Thuê bao nhịp tim TTL/3 thay khóa 15'; mất thuê bao → hủy lượt, trả việc là no-op. Lấp suất ngay khi trống. Mỗi làn số luồng riêng. `enrollStream` để Pha C ghi danh gian. |

**Bằng chứng (sàn giả `services/__tests__/fake-marketplace.ts`: thứ tự tăng/giảm/ngẫu nhiên/create_time, phân trang offset trên tập
đang đổi, trùng dòng, token hết hạn, 429 tiêm, trần trang âm thầm):** 37 ca mới xanh — `cursor-window` 4, `cursor-reader` 14,
`rate-gate` 6, `marketplace-gateway` 8, `sync-lanes` 4, `read-pipeline` 1 (ghép cả ba: 2 tiến trình × 2 luồng, gian 20.000 đơn
dính 429 10 % + 4 gian nhỏ → đủ dữ liệu, 4 gian nhỏ đuổi kịp TRƯỚC gian lớn, 0 thuê bao mất) + DB thật 11 ca (`cursor-reader-db` 3,
`rate-gate-db` 5 — **20 kết nối tranh cùng khóa dồn 5 → đúng 5 lượt**, `sync-lanes-db` 3 — hai tiến trình nhặt song song không trùng).
tsc sạch. Toàn bộ backend 1.708 pass / 9 fail — 9 ca đỏ là test DB cũ chạy lại sau khi DB dev được áp cột Apple (trước đó cả
nhóm BỎ QUA): DB dev thiếu `fulfillment_batches`, chỉ mục GIN sổ cái, trigger dọn sổ khi xóa gian — **lệch DB dev**, không ca nào
đụng bảng/mã mới; prod có đủ migration.

**Ba điều sàn giả bắt được và đã sửa GỐC (không chỉnh số):**
1. Mốc cuối tính lại mỗi vòng → lượt đuổi theo đồng hồ mãi, không bao giờ "đuổi kịp". Sửa: chốt `now − settle` một lần đầu lượt.
2. Ngân sách lượt (vd 10 trang) cắt giữa cửa sổ cần K = 20 trang, hoặc 429 giữa cửa sổ → bỏ công cả cửa sổ → gian lớn **có thể
   không bao giờ tiến** (429 10 %/trang ⇒ chỉ 0,9²⁰ ≈ 12 % cửa sổ đọc trọn một mạch). Sửa: ngân sách chỉ xét ở ranh cửa sổ (lượt
   dài tối đa ngân sách + K trang) + lỗi tạm có hẹn chờ thì đọc lại đúng trang. Lãng phí tối đa khi chết giữa chừng = 1 cửa sổ ≤ K trang.
3. Vòng làn toàn microtask (sàn trả từ bộ đệm) bỏ đói bộ hẹn giờ → nhịp tim thuê bao không chạy. Sửa: mỗi vòng nhường một nhịp.

**Giả thuyết MỚI H8 (phải đo ở Pha C):** sàn phân trang kiểu offset trên tập đang đổi → một đơn trong cửa sổ đổi trạng thái giữa
lúc đọc (rời cửa sổ) làm đơn khác trượt qua ranh trang và bị lỡ. Sàn giả, đổi 1 đơn trong cửa sổ mỗi 3 lệnh: **không báo tổng
(kiểu Shopee) → lượt tươi lỡ 8 / 4.000 đơn**; **có tổng (TikTok `total_count`, Lazada `countTotal`) → máy đọc thấy tổng trang
đầu ≠ trang cuối → đọc lại cửa sổ → 0 lỡ** (cái giá ở mức đổi cực gắt này ~12× lệnh, trần `MAX_UNSTABLE_REREADS` = 2).
Shopee bù bằng **lượt đối soát trễ** (con trỏ thứ hai đọc lại sau khi dữ liệu lắng — test chứng minh bù đủ) + webhook 99,8 % (H3).
Đo ở Pha C: Shopee `cursor` có phải offset không; tỷ lệ lệch tổng TikTok/Lazada trên gian lớn.

**Số TỰ CHỌN (đều trong `config/marketplace-read.ts`, đọc env, đo lại ở Pha C):** K = 20 trang/cửa sổ; cửa sổ đáy 1', khởi đầu 1 giờ;
settle 2'; ngân sách lượt 40 trang / 60 s; đọc lại tối đa 2 lần/cửa sổ lệch tổng, 5 lần/trang lỗi tạm; chờ tại chỗ ≤ 2 s; lùi gian
1 s → 15', lùi endpoint 1 s → 60 s, lỗi cứng app 5' → 60' (như cầu dao cũ); AIMD sàn 0,1, hồi 60'; trần TikTok 3/s/gian, Shopee
daily_performance 1/s dồn 2; luồng mỗi làn orders 4 · finance 2 · ads 2 · backfill 1; thuê bao 90 s; đuổi kịp → 10'.

**Chạy hai tiến trình cùng một (gian, luồng) vẫn đúng:** con trỏ chỉ tiến ở ranh cửa sổ đã đọc trọn, bên chậm ghi con trỏ cũ hơn
thì chỉ làm đọc lại (trùng, vô hại) — thuê bao để khỏi phí lệnh, không phải điều kiện đúng.

**Việc của Pha C (chưa làm, chờ anh gọi):** adapter `fetchPage/persist` cho đơn 3 sàn (đầu tiên) dùng đường ghi `order-sync-write`
hiện có; cờ từng gian; worker đăng ký `runLane` theo `LANES`; so khớp số với mã cũ 3–7 ngày; thẻ HQ độ trễ p50/p99 (`now − cursorAt`),
gian đang lùi (`api_rate_keys.blockedUntilMs`), 429 theo khóa (`hits`); đo H8.

## 5c. Pha C lát 1 — "đọc bóng đơn" (19/10/2026, anh: "push luôn và làm tiếp")

Lát đầu của "Chuyển từng luồng, chạy bóng": đường đọc MỚI chạy **song song** đường cũ trên gian được ghi danh, **chỉ đọc
danh sách đơn** (Shopee `get_order_list` trục update_time · TikTok `orders/search` sort update_time DESC · Lazada `orders/get`
update_after/before), ghi **bảng bóng** `sync_shadow_orders` (mã đơn, update_time sàn nếu danh sách có, trạng thái sàn, lần đầu/cuối
thấy, số lần thấy). **Không gọi chi tiết, không ghi `Order`, không đổi hành vi worker cũ.** Mục đích: đo đường mới trên sàn thật
trước khi cho nó ghi — độ trễ con trỏ, số lần co cửa sổ, 429 theo khóa, H8, và so tập mã đơn với đường cũ.

| Tệp | Việc |
|---|---|
| `integrations/order-read-adapters.ts` | 3 adapter `fetchPage` qua **cổng gọi sàn** (khóa app/gian/endpoint); phần thuần cửa sổ→tham số, trang→`PageResult`; `persistShadowRows` một INSERT … ON CONFLICT cho cả trang (gộp mã trùng trong trang) |
| `workers/read-lanes.ts` | làn `orders` (`runLane` + `pgLeaseStore`), handler: gian ACTIVE không ngủ đông → `readByCursor` với kho Postgres; 429 lùi ≤ 30 s thì đọc lại đúng trang, dài hơn trả việc cho làn hẹn lại; đuổi kịp → 10' (`LEASE.CAUGHT_UP_RECHECK_MS`), hết ngân sách → tới hạn ngay. Đăng ký trong `workers/index.ts`; `READ_LANES=0` tắt |
| `scripts/shadow-enroll.ts` | `list` / `on <gian>` / `off <gian>` / `compare <gian> [ngày]` — không gọi sàn |
| migration `20261019130000_sync_shadow_orders` | bảng bóng + RLS, FK Channel có khóa thử lại |

**Cờ gian = dòng `sync_cursors` luồng `orders-shadow`** (không thêm cột Channel): có dòng là đọc, xóa dòng là thôi trong ≤ 1 lượt.
Gian chưa ghi danh → worker chỉ hỏi DB mỗi 5 s (một SELECT `FOR UPDATE SKIP LOCKED` trả rỗng). Con trỏ khởi đầu = lúc ghi danh − 30'.

**Kiểm (19/10):** `order-read-adapters.test` 6 ca (tham số 3 sàn, token trang, tổng, Lazada offset, spec qua client giả, sàn lạ ném);
`shadow-orders-db.test` 3 ca DB thật (gộp mã trùng + seenCount + mốc mới nhất; 3 trang TikTok giả → con trỏ tiến + 150 mã; gian ngủ đông
không gọi sàn); `no-module-state` 27/27; tsc sạch. **Chưa chạy trên sàn thật** — bước kế là ghi danh 1–2 gian.

**Ghi danh (SQL dán Supabase — hoặc `npx tsx scripts/shadow-enroll.ts on "<tên gian>"` trên Render shell):**
```sql
INSERT INTO "sync_cursors" ("channelId","stream","cursorAt","windowMs","lane","dueAt","updatedAt")
SELECT id, 'orders-shadow', (now() AT TIME ZONE 'UTC') - interval '30 minutes', 3600000, 'orders', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
FROM "Channel" WHERE "shopName" = '<tên gian>' AND status = 'ACTIVE' AND "channelName" IN ('SHOPEE','TIKTOK','LAZADA')
ON CONFLICT DO NOTHING;
-- Rút:  DELETE FROM "sync_cursors" WHERE stream = 'orders-shadow' AND "channelId" IN (SELECT id FROM "Channel" WHERE "shopName" = '<tên gian>');
```
Đề xuất gian đầu: **Siêu Thị 8686 (TikTok)** — gian lớn nhất, 2.577 biến động/2 ngày (H1), sẽ thấy co cửa sổ + total_count; **ANO (Shopee)** —
không có tổng → đo H8 bằng so khớp. Lazada chưa có gian thật hoạt động (H3).

**Đọc số (SQL chỉ đọc):**
```sql
-- Độ trễ con trỏ + cửa sổ đã học + lượt gần nhất
SELECT c."channelName", c."shopName", round(extract(epoch FROM ((now() AT TIME ZONE 'UTC') - s."cursorAt"))/60) AS tre_phut,
       s."windowMs"/60000 AS cua_so_phut, s."lastStatus", s."lastPages", s."lastRunAt", s."leaseOwner", s."dueAt"
FROM "sync_cursors" s JOIN "Channel" c ON c.id = s."channelId" WHERE s.stream = 'orders-shadow';
-- So khớp (19/10 chạy thật mới thấy: "Order" KHÔNG có cột updatedAt → mốc "đường cũ thấy biến động" lấy từ webhook_events,
-- sàn gửi 99,8–100 % biến động (H3)). Chỉ xét sự kiện có createdAt < cursorAt − 30': đơn đổi TIẾP sau con trỏ có update_time
-- mới hơn → rơi sang cửa sổ kế (lượt 1 ngày 19/10 "sót" 2 đơn vì thế, lượt 2 thấy ngay); sót THẬT là sót bền qua nhiều lượt.
--   don_co_webhook = đơn có sự kiện sàn từ lúc ghi danh · bong_thay = bóng cũng thấy · chi_cu = đường MỚI SÓT → dừng gian, tìm gốc
--   chi_moi (câu dưới) = bóng thấy mà Order không có = đường CŨ sót (hoặc đơn > 90 ngày)
WITH cur AS (SELECT s."channelId", s."cursorAt", c."channelName"::text AS src, c."externalShopId" AS shop, c."shopName"
             FROM "sync_cursors" s JOIN "Channel" c ON c.id = s."channelId" WHERE s.stream = 'orders-shadow'),
     ev AS (SELECT cur."channelId", w."entityId" AS code, min(w."createdAt") AS first_at
            FROM cur JOIN webhook_events w ON w.source = cur.src AND w."shopId" = cur.shop
            WHERE w."createdAt" >= (now() AT TIME ZONE 'UTC') - interval '3 days' AND w."createdAt" < cur."cursorAt" - interval '30 minutes' GROUP BY 1, 2)
SELECT cur."shopName",
       (SELECT count(*) FROM ev WHERE ev."channelId" = cur."channelId") AS don_co_webhook,
       (SELECT count(*) FROM ev WHERE ev."channelId" = cur."channelId" AND EXISTS (SELECT 1 FROM "sync_shadow_orders" s WHERE s."channelId" = ev."channelId" AND s."orderCode" = ev.code)) AS bong_thay,
       (SELECT string_agg(code || '@' || to_char(first_at, 'DD HH24:MI'), ', ') FROM ev WHERE ev."channelId" = cur."channelId"
          AND NOT EXISTS (SELECT 1 FROM "sync_shadow_orders" s WHERE s."channelId" = ev."channelId" AND s."orderCode" = ev.code)) AS chi_cu,
       (SELECT count(*) FROM "sync_shadow_orders" s WHERE s."channelId" = cur."channelId"
          AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."channelId" = s."channelId" AND o."orderCode" = s."orderCode")) AS chi_moi
FROM cur;
-- 429 / lùi theo khóa
SELECT key, failures, factor, hits, to_timestamp("blockedUntilMs"/1000) AS blocked_until, "lastError", "updatedAt" FROM "api_rate_keys" ORDER BY hits DESC;
```
Log worker: `[read-lanes] <sàn> "<gian>" orders-shadow: …` chỉ in khi có gì khác thường (co, đáy tràn, đọc lại, thử lại trang, hết ngân sách);
`[gateway] 429 …` khi lùi; `[cursor-reader] … vẫn lệch tổng` = H8 trên sàn thật.

**Tiêu chí đạt để sang lát 2 (ghi Order qua đường mới, theo cờ gian):** 3–7 ngày trên ≥ 2 gian: `chi_cu` rỗng (sự kiện sàn gửi mà bóng
không thấy — trừ sự kiện không phải đơn, xem tay), trễ con trỏ p99 < 15', không `floorOverflows`, 429 theo khóa không lan sang gian khác
(api_rate_keys chỉ có khóa gian/endpoint). Lệch = dừng gian đó (xóa dòng), tìm gốc, không chỉnh số.

**Chạy thật 19/10 13:12 VN (ghi danh TikTok `Siêu Thị 8686` + Shopee `ANO Official Store` qua SQL trên Supabase):** làn nhặt trong < 2 s sau
INSERT; ANO 1 trang → 2 mã; 8686 3 trang → 132 mã, dải update_time 05:42:47 → 06:10:04 UTC = đúng cửa sổ [ghi danh − 30', now − 2'];
cả hai `caught_up`, trễ 3', thuê bao đã trả, tới hạn lại sau 10'; khóa GCRA `TIKTOK:<app>|shop:7494607438764411097` f0 h0 (0 lần 429);
134/134 mã bóng có trong Order (chi_moi = 0). **Lượt 2 lúc 06:22:09 UTC** (đúng 10' sau, không cần ai nhắc): cửa sổ [06:10:06, 06:20:09],
8686 1 trang +27 mã (159), ANO 1 trang +0; cả hai `caught_up`, trễ 3'. Lộ 3 điều:
(a) `Order` không có `updatedAt` → SQL so khớp đổi sang webhook_events (ở trên).
(b) Shopee `get_order_list` không trả `order_status` nếu không xin `response_optional_fields` → bóng Shopee status NULL — lát 2 đọc chi tiết nên không sửa ở lát 1.
(c) So 33 đơn có webhook của 8686 trong cửa sổ lượt 1: 31 thấy, 2 đơn MỚI (sự kiện 06:02 và 06:08) "sót" — nhưng lượt 2 thấy ngay với
update_time **06:10:50 / 06:16:37** (> con trỏ 06:10:06): đơn đổi tiếp (chuẩn bị hàng) nên update_time nhảy sang cửa sổ kế. KHÔNG phải sót;
SQL so khớp phải chừa 30' sát con trỏ. **Sót thật = sót bền qua nhiều lượt.**
**Số đáng chú ý cho lát 2 (dung lượng):** 132 mã đổi update_time / 28' ở 8686 nhưng chỉ 22 có webhook (99 IN_TRANSIT — mốc vận chuyển làm
nhảy update_time mà sàn không bắn sự kiện) → đọc theo update_time thấy ≈ **5–6× số biến động có webhook** (H7 đếm webhook, không đếm cái này).
TikTok `orders/search` trả trọn đơn nên không tốn lệnh chi tiết; Shopee danh sách → chi tiết sẽ nhân lệnh theo tỷ lệ này — đo trên ANO khi đủ số
(2 đơn/2 lượt chưa nói được gì). Script `scripts/tiktok-search-probe.ts` (chỉ đọc, Render shell) để hỏi thẳng sàn khi nghi sót thật.

**Lát 2 trở đi (chưa làm):** chi tiết đơn + ghi qua `order-sync-write` theo cờ gian; luồng hoàn / tài chính; thẻ HQ p50/p99; Pha D gỡ đường cũ.

### 5c.1 Kiểm 22/10 (3 ngày) + 23/10 (4 ngày) — ĐẠT tiêu chí, chờ anh chốt bật lát 2

Đo qua Chrome anh (Supabase SQL chỉ đọc + Render Logs worker 7 ngày). **Nhắc 22/10 08:00 không chạy được** (Chrome chưa kết nối) — đo tay
lúc ~09:50 22/10 rồi anh bảo "kiểm tra lại" sáng 23/10 (02:10 UTC). Số 23/10:

| Tiêu chí 5c | Siêu Thị 8686 (TikTok) | ANO Official Store (Shopee) | Kết luận |
|---|---|---|---|
| `chi_cu` rỗng (sự kiện sàn từ mốc ghi danh 19/10 05:42 UTC, chừa 30' sát con trỏ) | 3.054 / 3.054 | 257 / 257 | ✅ cả hai NULL (22/10: 2.560/2.560 và 213/213) |
| `chi_moi` (bóng thấy mà Order không có) | 0 (bóng 3.692 mã) | 0 (bóng 260 mã) | ✅ |
| Trễ con trỏ lúc đo (`tre_phut`) | 4' · caught_up · 1 trang · cửa sổ 60' | 5' · caught_up · 1 trang · cửa sổ 60' | ✅ |
| Trễ phát hiện `firstSeenAt − platformUpdatedAt` (chỉ dòng `seenCount = 1`, từ 19/10 07:00; n = 1.376) | min 2' · p50 7' · p90 11,2' · **p99 11,9'** · max 12,0' | Shopee list không trả update_time → không đo được (chỉ có log "trễ 2'") | ✅ p99 < 15' (nhịp 10' + chừa 2') |
| `floorOverflows` / co cửa sổ / lệch tổng (H8) | log 7 ngày: 5 dòng `[read-lanes]` đều "co 0, đáy tràn 0, đọc lại 1–2, trang thử lại 0"; **0 dòng `[cursor-reader]`** | không có dòng nào (gian nhỏ, không có gì khác thường) | ✅ |
| 429 theo khóa | `TIKTOK:<app>|shop:7494607438764411097`: hits 0, factor 1, failures 0 | `SHOPEE:2044679|shop:239068349`: hits 3, factor 1 — cả 3 do **endpoint Ads** (get_product_level_campaign_setting_info 21/10 22:23 UTC), không phải khóa đơn | ✅ không lan; không có khóa endpoint đơn nào bị 429 |

**Ghi chú đọc số:**
- Câu so khớp 5c với `interval 'N days'` thô cho ra 122 + 23 (22/10) / 140 + 11 (23/10) "chi_cu" — **toàn sự kiện trước 19/10 05:42 UTC** (trước lúc bóng
  bắt đầu, con trỏ khởi đầu = ghi danh − 30'). Không phải sót. Lần sau thay `w."createdAt" >= now() − interval` bằng `>= timestamp '<cursorAt ban đầu>'`.
- Khoảng trống không ghi > 20' ở 8686: 20/10 16:08→16:48 UTC (23:08 VN) và 22/10 00:14→00:44 UTC (07:14 VN) — giờ vắng đơn; max trễ phát hiện vẫn 12'
  nên không phải kẹt. ANO trống tới 4 h là bình thường (ít đơn). Chưa đối chiếu với mốc restart worker (nhiều lần boot 19/10 do deploy; OOM 21/10).
- Trễ phát hiện tính trên `seenCount = 1`: dòng thấy lại nhiều lần có `platformUpdatedAt` mới hơn `firstSeenAt` (âm) nên loại — 8686 có 2.291 đơn thấy lại.
- Khóa GCRA theo gian dùng chung giữa Ads và đọc đơn (ANO: 3 lần 429 Ads đã phạt khóa gian) → khi Ads 429, đọc đơn gian đó chậm theo (đúng N5). Để ý khi bật lát 2.
- Dung lượng cho lát 2: 8686 ≈ 920 mã/ngày qua update_time, 62 % đơn thấy lại; ANO 65 mã/ngày.

**Đề xuất bật lát 2 (chờ anh chốt):** gian nhỏ = **ANO Official Store** (Shopee, `cmshe0487007oiz3pg41t2vb0`) — ít đơn, đã có bóng 4 ngày để so,
và đi qua nhánh chi tiết `get_order_detail` theo lô 50 (TikTok không cần chi tiết nên không kiểm được nhánh này). SQL bật ở 5d; theo dõi log
`[read-lanes] … orders: … ghi: tạo/sửa/không đổi/đụng` 7 ngày + so Order hai đường. Nhắc đo lần 3: 26/10 08:30 (`kiem-bong-doc-san-5c-lan-2`).

## 5d. Pha C lát 2 — "ghi Order qua đường mới" (19/10/2026, anh: "code lát 2 … cờ riêng, chưa bật, trong lúc bóng chạy")

Luồng **`orders`** (cờ gian = dòng `sync_cursors` stream `orders` — tách khỏi `orders-shadow`; **CHƯA bật gian nào**). Khác lát 1 ở
hai chỗ: lấy **chi tiết** (Shopee `get_order_detail` ≤ 50 mã/lệnh sau mỗi trang danh sách; Lazada `orders/items/get` ≤ 50 id/lệnh;
TikTok search đã trả trọn đơn) và **ghi Order bằng ĐÚNG hàm upsert của đường cũ** (`upsertShopeeOrderTx` / `upsertTiktokOrderTx`
(mới xuất) / `upsertLazadaOrderTx` + `plan*OrderUpdate` "chỉ ghi khi khác" + bù ảnh dòng hàng) — **một luật ghi đơn, hai đường đọc**.

| Tệp | Việc |
|---|---|
| `integrations/order-write-adapters.ts` | `writeOrderSpec(channel)` → `{ spec, stats }`; `fetchPage` qua cổng (khóa endpoint riêng cho chi tiết: `get_order_detail`, `orders/items/get`); `persist` đọc đơn đã có theo lô → bỏ qua đơn không đổi → upsert; phiếu đẩy tồn Lazada chốt ở `afterCommit` (móc mới của `StreamSpec`) |
| `workers/read-lanes.ts` | luồng `orders` → spec ghi; log `ghi: tạo/sửa/không đổi/đụng` khi có ghi |
| `scripts/shadow-enroll.ts` | `on <gian> --write` bật luồng `orders`; `off` tắt cả hai; `list` hiện cả hai |

**Hai quyết định thiết kế (ghi để Pha D khỏi hỏi lại):**
1. **Ghi từng đơn một giao dịch, con trỏ ghi SAU cả trang** — không gộp cả trang + con trỏ vào một giao dịch như N2 viết. Lý do: webhook
   và worker cũ chạy song song cùng đơn; trong Postgres một lỗi (đụng unique P2002 khi hai bên cùng tạo đơn mới) làm hỏng CẢ giao dịch,
   không thể bỏ qua một đơn rồi ghi tiếp. Bảo đảm N2 giữ nguyên về bản chất: con trỏ chỉ tiến khi mọi đơn của cửa sổ đã commit → chết
   giữa chừng = đọc lại, upsert idempotent = không nhân đôi. Đụng unique → đọc lại dòng rồi ghi lần hai (`stats.raced`), lỗi khác ném ra
   cho làn hẹn lại 5' (không nuốt).
2. **Chưa chuyển các việc phụ của đường cũ**: hỏi lại ước tính escrow Shopee cho đơn đổi trạng thái (`changedOrderCodes`), chuông giao
   thất bại Lazada, mốc nước cũ (`ordersWatermarkAt`), đo "cửa sổ TikTok" — đường cũ vẫn chạy song song trên gian bật cờ nên không mất;
   Pha D chuyển nốt khi tắt đường cũ.

**Kiểm (19/10):** `order-write-adapters.test` 6 ca (client + upsert giả: Shopee 70 mã → 2 lệnh chi tiết 50+20; TikTok không gọi chi tiết, đơn
không đổi không upsert; P2002 → ghi lần hai; Lazada phiếu tồn chốt sau commit, không chốt lại; lỗi khác ném nguyên); `order-write-db.test`
1 ca DB thật (search giả → `upsertTiktokOrderTx` THẬT: 2 đơn + dòng hàng tạo đúng, lượt 2 update_time đổi mà nội dung y hệt → không ghi,
lượt 3 giao xong → DELIVERED; con trỏ tiến); tsc sạch.

**Bật thử (khi tiêu chí 5c đạt + anh chốt) — gian nhỏ trước:**
```sql
INSERT INTO "sync_cursors" ("channelId","stream","cursorAt","windowMs","lane","dueAt","updatedAt")
SELECT id, 'orders', (now() AT TIME ZONE 'UTC') - interval '30 minutes', 3600000, 'orders', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
FROM "Channel" WHERE id = '<channelId>' AND status = 'ACTIVE' ON CONFLICT DO NOTHING;
-- Tắt: DELETE FROM "sync_cursors" WHERE stream = 'orders' AND "channelId" = '<channelId>';
```
Theo dõi: log `[read-lanes] … orders: … ghi: tạo X, sửa Y, không đổi Z, đụng R` (kỳ vọng tạo ≈ 0 và sửa nhỏ vì đường cũ + webhook đã ghi
trước; `đụng` > 0 là bình thường ở đơn mới); `api_rate_keys` có thêm khóa endpoint chi tiết; so số đơn/tiền từng gian như 5c.
**Tiêu chí sang Pha D (tắt đường cũ theo cờ gian):** 7 ngày trên ≥ 2 gian ghi song song: không lệch Order/OrderItem giữa hai đường (SQL so
cột `shippingStatus/returnStatus/totalAmount` theo mã — soạn khi bật), trễ p99 < 15', không lỗi persist lặp.

### 5e. Việc SẼ làm — chờ bóng đạt tiêu chí (anh Trung 19/10: "chưa cần làm ngay thì không làm", nhắc 22/10)

Anh hỏi "Pha D có làm luôn không" → **chưa**: bóng mới chạy ~1 giờ, lát 2 chưa bật gian nào, đường mới còn thiếu 3 việc phụ.
Lịch: **22/10 08:00** nhắc kiểm 3 SQL 5c (bóng đủ 3 ngày) — nhắc trượt (Chrome tắt), đo tay 22/10 + 23/10: **ĐẠT** (5c.1); nhắc 26/10 08:30 đo lần 3.

| Khi nào | Việc | Ghi chú |
|---|---|---|
| Bóng đạt tiêu chí 5c + anh chốt | **Bật lát 2** cho 1 gian nhỏ (SQL 5d) | ghi song song 7 ngày |
| Trước Pha D (làm được khi đã quyết bật lát 2) | **Pha D lát 0 — chuẩn bị, chưa bật gì:** (1) chuyển 3 việc phụ vào đường mới: hỏi lại ước tính escrow Shopee cho đơn đổi trạng thái (`changedOrderCodes` → `syncShopeePendingEscrowEstimates`), chuông giao thất bại Lazada (`noticeLazadaDeliveryFail`), thẻ HQ độ trễ đọc `sync_cursors` thay mốc nước cũ; (2) SQL so lệch hai đường theo mã đơn từng gian (`shippingStatus`/`returnStatus`/`totalAmount`/số dòng hàng); (3) công tắc tắt quét đơn đường cũ THEO GIAN (worker `order-auto-sync` bỏ qua tầng đơn của gian có cờ, webhook giữ nguyên), mặc định tắt | không đụng prod cho tới khi bật cờ |
| 7 ngày song song không lệch | **Pha D**: bật công tắc từng gian → gỡ mã cũ, trần trang rải rác, cờ; docs hợp đồng đọc sàn thay DONG-BO-GIAI-DOAN-3 mục 1 | mỗi bước có số trước–sau |
| Sau đơn | Luồng hoàn / tài chính (ví, escrow, sao kê) / Ads / sản phẩm qua máy đọc con trỏ | theo thứ tự mục 5 |

## 6. Cách bảo đảm "không làm điều chưa chắc"

1. Giả thuyết → thí nghiệm → số → quyết định (mục 3). Không có số thì ghi "tự chọn" và lịch đo.
2. Mã mới chạy **bóng** cạnh mã cũ, so khớp từng gian, bật theo cờ gian, tắt được trong một phút.
3. Mọi sửa dữ liệu prod có bản chạy thử đếm trước–sau + đường hoàn tác (bài học 3.489 lá 18/10).
4. Bộ thử sàn giả chạy trong CI; đụng máy đọc / cổng gọi sàn mà không có test = không merge.
5. Thông số (K trang, Δ, mục tiêu độ trễ, trần GCRA) ở một tệp cấu hình đọc env; mã không rải số.

## 7. Cố ý KHÔNG làm lúc này

- Redis / Kafka / tách dịch vụ: chưa có bằng chứng Postgres không chịu nổi (H5 sẽ đo). Giao diện
  cổng gọi sàn tách sẵn để đổi sau mà không đụng logic.
- Trần theo app cho đơn/tài chính: chưa từng dính 429 tầng app → chỉ đo.
- Viết lại webhook: hộp thư đến + pg-boss đang chạy tốt (HQ xanh).

## 8. Liên hệ tài liệu khác

- ADS-NHIP-CANH-BAO mục 13 (4 lát Ads, anh chốt 17/10) → nằm trọn trong Làn Ads + N4/N5; lịch đo Đ0–Đ4 giữ.
- DONG-BO-GIAI-DOAN-3 lát 3.3 (nhịp theo mức hoạt động) → là N1; lát 3.4 (chia quota) → là N4.
- HANG-DOI-BEN: hộp thư đến webhook giữ nguyên, là nguồn chính theo N1.
