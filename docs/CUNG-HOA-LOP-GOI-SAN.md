# Lớp đọc sàn ở quy mô lớn — thiết kế lại (bản 2, 18/10/2026 đêm — anh chốt; Pha A ĐÃ ĐO xong 7 giả thuyết, xem 3b)

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
