# Phương án: Trợ lý quảng cáo TikTok trên app di động

Ngày: 16/10/2026. Người yêu cầu: anh Trung ("rất quan trọng, nghiên cứu kỹ như senior, chú ý
trải nghiệm người dùng"). Người soạn: Claude.

**Trạng thái 16/10 khuya: ANH CHỐT GỘP vào bản 1.1.0 ("cũng tương đối dễ dùng, gộp cả TikTok Ads
vào rồi update một lượt cả 2 kho") → LÁT 1 + 2 ĐÃ CODE**, soi giả lập web local (tài khoản demo
reviewer@, 6 chiến dịch giả; màn Video soi bằng dữ liệu giả vì gian local không có token TikTok
thật), sáng/tối. Khác với phương án ở trên, đã chốt khi soi:
- Thẻ Cần xử lý **không có đoạn kết luận** (anh 16/10: "quá dài, bỏ hẳn như Shopee") — chỉ nhãn + tên + MỘT nút; căn cứ ở hộp chi tiết.
- Chip TikTok có **bộ lọc ngày riêng, mặc định 7 ngày** (số TikTok trễ tới 11 giờ, "Hôm nay" toàn 0); Shopee / Lazada giữ kỳ của họ.
- Gian đã nối nhưng **kết nối hỏng** (hủy ủy quyền / token hết hạn): vẫn hiện số cũ + dải đỏ, như web; chỉ gian chưa nối mới chỉ đường về web.
- Mã: `hubsell-mobile/src/{api/ads-tiktok.ts, lib/tiktok-ads.ts, components/TiktokAdsSection.tsx, components/TiktokCampaignSheet.tsx, screens/TiktokVideosScreen.tsx, app/tiktok-campaign.tsx}`; `AdsPage.tsx` thêm chip; types ở `types/api.ts`; thêm `expo-clipboard`. Backend 0 thay đổi.
- Lát 3 (thông báo đẩy) chưa làm. Câu hỏi 3–4 mục 9 còn mở (luật Cần xử lý đang là mặc định tự chọn).

**17/10 — anh xem thật trên máy (ANO, 4 việc "Mục tiêu đang ghìm phân phối") và chốt 4 điều, bản 1.2.0:**
1. **Bỏ hẳn khối "Cần xử lý" trên 4 số** (cả TikTok lẫn Shopee / Lazada) — khối này không có trần: API
   trả toàn bộ chiến dịch, app vẽ hết → 100 việc = 100 thẻ chồng lên chỉ số; đã có tab Cần xử lý. Tab
   Cần xử lý nay xếp nặng trước, thẻ có vạch trái theo mức nặng + **MỘT nút** của khối cũ (Xem video /
   Mở Seller Center; Shopee: câu Đề xuất). Số đếm in trên tab.
2. **Tab "Tất cả" → "Gợi ý"** như Shopee (`components/TiktokRecommendSection.tsx`): đọc
   `GET /api/quang-cao/tiktok/product-breakeven` (chỉ DB, backend 0 đổi) → sản phẩm CHƯA chạy quảng cáo
   có `runAdvice` Nên chạy / Chạy thử, tối đa 3 dòng + Xem thêm; hộp chi tiết = số của SP → 3 điều kiện
   (khả thi · đà bán · tồn) → kết luận → **ROI mục tiêu khởi điểm + ngân sách ngày** → Mở Seller Center
   (TikTok không có API tạo chiến dịch). Chiến dịch đã dừng gấp lại dưới tab Đang chạy ("Xem N chiến
   dịch đã dừng"). Cách ra số ngân sách (`budget.note`, ~6 dòng) cố ý không in.
3. **Chế độ Tự loại video xuống dòng riêng, màu riêng** (`TIKTOK_AUTO_MODE_PILL`): xanh da trời =
   Diễn tập, tím = Đang loại thật; tránh xanh lá của "Đang chạy" và đỏ / vàng của nhận định.
4. Soi giả lập web local reviewer@ (6 chiến dịch, 12 SP → Gợi ý 5 nên chạy) ở 320 / 360px, sáng + tối; tsc sạch.

Tài liệu gốc phải đọc trước khi code: [ADS-TIKTOK-GMV-MAX.md](ADS-TIKTOK-GMV-MAX.md) (API, luật,
bẫy), [KHAO-SAT-TRO-LY-QUANG-CAO-MOBILE.md](KHAO-SAT-TRO-LY-QUANG-CAO-MOBILE.md) (bố cục Shopee
trên app đã chốt 04–05/10), [ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md](ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md).

## 1. Kết luận trước

1. **Không chép màn Shopee sang TikTok được.** Shopee trên app là "canh tiền → tạm dừng / bật
   lại". Với TikTok, API chỉ cho Hubsell làm MỘT việc lên sàn: **loại / khôi phục video** trong
   chiến dịch GMV Max. Tạm dừng, bật lại, đổi ngân sách, đổi ROI mục tiêu, tạo chiến dịch đều
   phải làm trong Seller Center (đã probe, TikTok trả 40002, ticket #4455484 — docs GMV Max mục 4).
2. Vì vậy màn TikTok trên app phải trả lời đúng ba việc khách cầm điện thoại muốn làm:
   - **Sáng mở app**: hôm qua TikTok tiêu bao nhiêu, ra bao nhiêu đơn, lãi hay lỗ, chiến dịch
     nào đang có vấn đề.
   - **Trợ lý nói "video này đang đốt tiền"**: xem danh sách, bấm loại ngay tại chỗ (đây là việc
     duy nhất app làm được thật, và cũng là việc mobile có lợi thế: khách không ngồi máy tính).
   - **Trợ lý bảo "hạ ROI / tăng ngân sách / tạm dừng"**: đọc căn cứ, bấm mở Seller Center làm
     tay. App không giả vờ có nút mà không có.
3. **Dùng lại 100% API web đang chạy**, backend không phải sửa (chi tiết mục 6). Việc nằm hết ở
   app: khoảng 3 lát, 2–3 ngày công, trình mô phỏng cho anh duyệt trước từng lát như lần Shopee.
4. **Đề xuất về build (phản biện):** KHÔNG giữ bản 1.0.1 chờ TikTok. Nộp 1.0.1 ngay với sửa nút
   trở về màn Quét + câu chữ ngủ đông (11 gian đang ngủ dần 16–22/10, khách đang đọc câu hứa
   sai). TikTok Ads đi bản **1.1**, một lần nộp riêng. Lý do: mỗi lần nộp là một lần Apple duyệt;
   tính năng mới có rủi ro bị hỏi (lần 7 Apple đã soi màn Trợ lý), gộp vào sẽ kéo cả sửa lỗi
   nhỏ theo. Anh chốt ngược thì em gộp, nhưng phải thêm ~3 ngày trước khi build.

## 2. TikTok khác Shopee ở đâu (sự thật từ mã, không suy đoán)

| Việc | Shopee / Lazada trên app (đã có) | TikTok (API Hubsell đang có) |
|---|---|---|
| Tạm dừng / bật lại chiến dịch | Có, lệnh thật lên sàn | **Không** — chỉ trong Seller Center |
| Đổi ngân sách / ROI mục tiêu | Shopee: trả lại ngân sách, nâng ROAS | **Không** — Trợ lý chỉ **khuyên** nấc kế tiếp |
| Tạo chiến dịch | Shopee: từ tab Gợi ý | **Không** |
| Loại / khôi phục video | Không có khái niệm | **Có**, lệnh thật, ≤ 400 video / lần, sàn ngấm ~5–20 phút |
| Trợ lý tự xử lý | Chế độ chung cả gian: Tắt / Diễn tập / Thật | **Theo từng chiến dịch**, chỉ cho việc loại video; bật Thật phải qua 1 ngày diễn tập thật |
| Nhận định | `verdict` 6 loại + quyết định Theo dõi / Bỏ qua | `advice` 13 loại (lỗ, không ra đơn, không phân phối, mục tiêu dưới hòa vốn, ngân sách chặn, mục tiêu ghìm, …) có căn cứ + kết luận + nấc ROI kế tiếp; **không** có Theo dõi / Bỏ qua |
| Ví quảng cáo | Dải đỏ hết tiền | Không có số dư trong API |
| Chuông | Trung tâm điều hành | Chuông web `tiktok-ads-advice` + `tiktok-ads-auto`; app chưa có thông báo đẩy |
| Độ trễ số | Theo xung 30' | Chi phí từng video trễ tới **11 giờ**; ROI gồm cả đơn tự nhiên |
| Ảnh + tên video | — | Qua oEmbed công khai, **đang bị TikTok chặn 503 từ 16/10** (bẫy riêng) |

Hệ quả thiết kế: thẻ "Cần xử lý" của TikTok không được kết thúc bằng nút Tạm dừng. Mỗi thẻ phải
kết thúc bằng đúng một trong hai: **"Xem video → Loại"** (app làm được) hoặc **"Mở Seller
Center"** (app dẫn đi). Bài học khảo sát 04/10 vẫn đúng: app báo triệu chứng mà không có chỗ xử lý
là app bị chê (Meta, Amazon).

## 3. Người dùng và tình huống

Chủ shop (ADMIN), có gian TikTok đã nối tài khoản quảng cáo trên web, chạy GMV Max tạo trong
Seller Center (ANO: TC054; sắp tới DarkMan). Nhân viên có quyền `ads.tiktok` xem được, không bấm
loại video (backend `requireAdmin`).

| Tình huống | Khi nào | App phải cho thấy trong ≤ 2 chạm |
|---|---|---|
| A. Kiểm sáng | 7–9h, 20 giây | Tiền tiêu hôm qua, đơn, ROI so hòa vốn, lãi/lỗ ước tính, có chiến dịch nào "đỏ" không |
| B. Loại video | Khi chuông / khi diễn tập báo "sẽ loại N video" | Danh sách video tiêu không ra đơn, chọn, bấm Loại, xác nhận |
| C. Làm theo đề xuất | Khi nhận định bảo hạ ROI / tăng ngân sách / tạm dừng | Căn cứ ngắn từng dòng + nấc kế tiếp + nút mở Seller Center |
| D. Kiểm lệnh đã ngấm | Sau khi loại 20–30 phút | Dòng lịch sử: Đã gửi / Đang chờ TikTok / TikTok từ chối, và nút Khôi phục cả lệnh |

Không thiết kế cho: cấu hình luật tự loại (hộp thoại 949 dòng trên web, có rào diễn tập), đối
chiếu diễn tập, hòa vốn sản phẩm, kết nối tài khoản quảng cáo (OAuth), sao chép luật. Đây là
việc làm một lần hoặc nhìn lại, để ở web (đúng luật "việc một lần để tab riêng" và kết luận 5 của
khảo sát 04/10).

## 4. Bố cục đề xuất

Vị trí: cùng trang **Quảng cáo** (trang 3 dãy vuốt Trang chủ), thêm chip sàn **TikTok** thứ ba
cạnh Shopee · Lazada. Không tạo tab đáy mới, không tách trang: khách đã quen một chỗ xem quảng cáo.

### 4.1 Màn chính (chip TikTok)

Từ trên xuống, giữ đúng khung Shopee để khách không học lại; chỉ đổi thứ TikTok không có.

1. **Bộ lọc ngày chuẩn** (giữ). Mặc định 7 ngày như web.
2. **Hàng chip sàn**: Shopee · Lazada · **TikTok**. Góc phải không hiện "Trợ lý: diễn tập" (TikTok
   không có chế độ chung) → thay bằng dòng nhỏ **"Số tới hh:mm"** từ `adsSyncedAt`, vì số TikTok trễ
   và khách hay hỏi "sao chưa thấy tiền hôm nay".
3. **Chip gian** (giữ): chỉ gian đã nối quảng cáo. Gian chưa nối → dải vàng như Shopee: "Gian này
   chưa nối tài khoản quảng cáo TikTok. Mở Hubsell trên máy tính → Trợ lý quảng cáo TikTok → Kết nối."
   Một câu, không hướng dẫn nhiều bước.
4. **Cần xử lý (N)** — thẻ, xếp theo mức nặng (mục 5). Mỗi thẻ: nhãn nhận định (màu theo `tone`),
   tên chiến dịch, một dòng kết luận của Trợ lý (`advice.conclusion`), và **một nút**:
   - Tiêu tiền không ra đơn / Quảng cáo đang lỗ → nút **Xem video** (mở màn 4.3, lọc sẵn "Chưa ra đơn").
   - Mục tiêu dưới hòa vốn / Không phân phối / Mục tiêu ghìm / Ngân sách chặn → nút **Mở Seller Center**.
   - Diễn tập hôm qua "sẽ loại N video" (`auto.lastRunMode = dry_run`, `lastRunExclude > 0`) → thẻ
     xám "Trợ lý định loại N video (diễn tập)" → nút **Xem video** (lọc "Máy sẽ loại").
   Không có gì → một dòng xanh "Không có chiến dịch nào cần xử lý" như Shopee.
5. **Số của kỳ**: giữ lưới 2×2 của Shopee nhưng đổi nội dung theo 5 số TikTok mà web và Seller
   Center đều dùng, gộp cho vừa 4 ô:
   - Chi phí quảng cáo (đỏ) · phụ: "N chiến dịch đang chạy"
   - Doanh thu GMV Max · phụ: "N đơn · CPA x đ" (CPA là số anh coi quan trọng, đặt sát hai số sinh ra nó)
   - ROI · phụ: "Hòa vốn của shop y" (không tô màu, như Shopee — ô Lãi nói màu)
   - Lãi/lỗ ước tính (đỏ/xanh) · phụ: "ước tính" — chữ mờ khi hòa vốn mượn của gian (`breakeven.source = shop`), đúng cách web làm
6. **Hàng tab**: Đang chạy · Cần xử lý · Tất cả. **Không có tab Gợi ý** (TikTok không tạo được chiến dịch). Ba tab chia đều một hàng.
7. **Thẻ chiến dịch**: tên (2 dòng) · dòng trạng thái "Đang chạy · ROI mục tiêu 15 · Tự loại: Diễn tập" · chip nhận định · ba số: **Chi phí · ROI thực / hòa vốn · Lãi ước tính**. Giống hệt thẻ Shopee về vị trí, chỉ "ROAS" đổi thành "ROI" theo cách TikTok gọi.

### 4.2 Hộp chi tiết chiến dịch (trượt lên khi bấm thẻ)

Giữ khung CampaignSheet của Shopee, đổi ruột:

- Tên, trạng thái, chip nhận định.
- Bảng số: Chi phí · Doanh thu · Đơn · CPA · ROI thực · ROI mục tiêu · Hòa vốn (nguồn: chiến dịch / sản phẩm / gian) · Lãi/lỗ ước tính · Ngân sách ngày + "đã dùng ~x%".
- **Căn cứ của Trợ lý**: `advice.points[]` mỗi ý một dòng gạch đầu dòng; **Kết luận** riêng bên dưới (đúng điểm 11 khẩu vị bảng).
- Dòng Đề xuất (nền vàng, bóng đèn) = `advice.text`; kèm "Nấc kế tiếp: ROI 13,5 (giữ lãi ≥ 5 đ/100 đ)" khi có `nextTarget`, hoặc "Còn 31 giờ mới nên đổi tiếp" khi `watchHoursLeft`.
- **Nút**: tối đa hai.
  - **Xem video (N chưa ra đơn)** — luôn có khi chiến dịch đang chạy.
  - **Mở Seller Center** — chỉ khi `advice.editInSellerCenter`. Mở `https://seller-vn.tiktok.com/` bằng trình duyệt hệ thống; [SUY ĐOÁN] app TikTok Seller có thể bắt link này mở thẳng app, chưa kiểm — ghi rõ ở mục 8.
- Không có Tạm dừng / Bật lại / Theo dõi thêm / Bỏ qua.

### 4.3 Màn Video (trang riêng, không popup)

Đây là màn làm việc chính của TikTok trên app → trang riêng `/tiktok-campaign/[id]` đẩy lên trên
tab (có mũi tên quay lại, địa chỉ mở được từ thông báo sau này). Lý do trang riêng: cần chỗ cho
danh sách dài, chọn nhiều, thanh hành động dính đáy (điểm 8 khẩu vị bảng).

- **Đầu trang**: tên chiến dịch · "ROI mục tiêu 15 · thực 11,4 · hòa vốn 5,6" · ba số nhỏ: đang
  phân phối x/y video · chưa ra đơn N · tiêu không ra đơn z đ.
- **Chip lọc có số đếm** (một chạm, không ô nhập): Tất cả · **Chưa ra đơn** · ROI dưới mục tiêu ·
  Máy sẽ loại · Cần xem · Đang học · Đã loại. Mặc định mở theo chip mà thẻ Cần xử lý dẫn vào.
- **Dòng video** (bảng ngang không vừa điện thoại → dòng 2 tầng):
  - Tầng 1: ô chọn · ảnh bìa 48px (nếu oEmbed có; không có → ô xám có chữ "TikTok") · tên video
    hoặc "@kênh · mã video" · nút sao chép mã · trạng thái (Đang chạy / Đang học / Đã loại / Đang chờ TikTok).
  - Tầng 2: **Chi phí · Đơn · CPA · ROI** (tiền trước, % không đưa lên app). Dòng 0 đơn nền hồng nhạt như web.
  - Có nhãn "Tự động: Sẽ loại / Cần xem / Ân hạn…" khi chiến dịch có luật, bấm vào hiện lý do.
  - Sắp xếp: mặc định 0 đơn trước, rồi chi phí giảm dần (đúng thứ tự backend trả). Không làm sắp xếp theo cột trên điện thoại — bảng không có tiêu đề cột.
- **Thanh hành động dính đáy** khi có video được chọn: "Loại 3 video khỏi chiến dịch" (đỏ) hoặc
  "Khôi phục 2 video" (xanh). Bấm → hộp xác nhận nêu số: "3 video này tiêu 1.240.000 đ, 0 đơn
  trong 7 ngày. TikTok áp dụng sau ~20 phút." → nút thật. Lệnh thật lên sàn nên luôn xác nhận,
  nhất quán với Shopee và web.
- **Chân trang** một dòng mờ: "Chi phí từng video cập nhật trễ tới 11 giờ; ROI gồm cả đơn tự nhiên."
- **Tab Lịch sử** (tab thứ hai, chỉ gọi khi mở; thực tế là 10 dòng đã nằm sẵn trong cùng API):
  thời gian · Loại/Khôi phục N video · nguồn (thủ công / tự động) · trạng thái (Đã gửi / Đang
  chờ / Diễn tập — chưa loại / TikTok từ chối) · căn cứ · nút **Khôi phục cả lệnh** có xác nhận.
- Chỉ chủ shop thấy ô chọn và thanh hành động; chiến dịch không ở trạng thái đang chạy thì
  không có ô chọn (backend trả 409).

### 4.4 Những gì cố ý KHÔNG đưa lên app (đợt này)

| Không làm | Vì sao |
|---|---|
| Hộp cấu hình Tự động loại video (3 chế độ, 10 ô số, chạy thử, rào diễn tập) | Làm một lần, nhiều rào 409; sai một ô là máy loại nhầm video. Để web. App chỉ **hiện** chế độ. |
| Nút "Loại ngay" cho chế độ Thật (`run-now`) | Cần đối chiếu `expectedVideoIds`, dễ 409 `plan_changed`; đợt 2 khi có thông báo đẩy dẫn thẳng vào. |
| Tab Hòa vốn sản phẩm + gợi ý "Nên chạy / Chạy thử" | Đọc rồi vẫn phải tạo trong Seller Center; đọc trên máy tính tiện hơn. Đợt 3 nếu khách hỏi. |
| Đối chiếu diễn tập | Báo cáo nhìn lại, không xem hằng ngày (điểm 10 khẩu vị). |
| Biểu đồ chi / doanh thu theo ngày | Màn hẹp, 4 số đủ; web có. |
| Kết nối tài khoản quảng cáo | OAuth TikTok Business, dải vàng chỉ đường về web. |
| Ô "Lãi tối thiểu giữ lại (đ/100 đ)" | Cấu hình, để web. |

## 5. Luật xếp "Cần xử lý" cho TikTok

Thẻ hiện khi chiến dịch **đang chạy** và một trong hai:

1. `advice.tone = warn`, xếp theo thứ tự mức nặng (tiền đang mất trước):
   `no_orders` (tiêu không ra đơn) → `losing` (đang lỗ) → `no_delivery` (không phân phối) →
   `target_below` (mục tiêu dưới hòa vốn) → `budget_capped` (ngân sách chặn) → `target_binding`
   (mục tiêu ghìm). Trong cùng loại: chi phí kỳ giảm dần.
2. `auto.lastRunMode = dry_run` và `auto.lastRunExclude > 0` trong 24 giờ: "Trợ lý định loại N video".

Không hiện: `healthy`, `target_watching` (đang chờ 72 giờ), `target_hold`, `learning`, `no_spend`,
`no_breakeven`, `paused`. Các loại này vẫn thấy ở chip nhận định trên thẻ chiến dịch.

Thứ tự trên là **mặc định tự chọn** theo nguyên tắc "tiền đang mất đứng trước tiền có thể kiếm
thêm"; chưa có nguồn ngoài. Web chưa có khối Cần xử lý cho TikTok, nên nếu anh duyệt, em đề
xuất đưa cùng luật này lên web sau để hai nơi nói một giọng.

## 6. Kỹ thuật

- **Backend: 0 thay đổi.** App gọi đúng API web:
  - `GET /api/quang-cao/tiktok?channelId&from&to` → tổng quan + chiến dịch (có `advice`, `auto`,
    `breakeven`, `estProfit`, `adsSyncedAt`). Bỏ qua `series`.
  - `GET /api/quang-cao/tiktok/campaigns/:id/videos?from&to` → video + 10 dòng lịch sử + totals.
    Gọi TikTok 2–3 lượt, chỉ khi mở màn Video; cache theo id + kỳ trong phiên.
  - `POST …/campaigns/:id/videos/action {action: REMOVE|ADD, items[]}` → loại / khôi phục.
  - `GET …/video-meta?ids=` ≤ 24 mã, chỉ cho trang đang nhìn; lỗi thì bỏ qua lặng lẽ (đang 503).
  - `POST …/refresh {channelId}` cho kéo-xuống-làm-mới.
  - Chuỗi quyền của route: `ads.tiktok` + `requirePlanUnlocked` → app xử lý 403 PLAN_LOCKED bằng
    thẻ khóa như Shopee (đã có `PlanLockedCard`).
- **App** (`hubsell-mobile`):
  - `types/api.ts`: thêm `TiktokAdsOverview`, `TiktokCampaignDto`, `TiktokCampaignAdvice`,
    `TiktokVideosResponse` chép đúng kiểu ở `frontend/src/lib/api.ts` 2994–3166. **Không** nhét
    `"tiktok"` vào `AdsPlatform` hiện có: shape khác hẳn, pause/resume/decision sẽ 404.
  - `api/ads-tiktok.ts` riêng.
  - `screens/AdsPage.tsx`: chip TikTok → render `TiktokAdsSection` (file mới), giữ nguyên nhánh Shopee/Lazada.
  - `components/TiktokCampaignSheet.tsx`, route `app/tiktok-campaign/[id].tsx` (+ `screens/TiktokVideosScreen.tsx`).
  - Bẫy đã biết: typed routes `.expo/types/router.d.ts` phải vá tay khi thêm route (như `/plan`);
    `Modal` + `navigationBarTranslucent`; 4 tab flex-1 (nay 3).
- **Thông báo đẩy**: app chưa cài `expo-notifications`, backend chưa lưu token thiết bị. Chuông
  `tiktok-ads-advice` / `tiktok-ads-auto` đã có trên web → đợt 2 nối push từ đúng hai chuông này,
  bấm mở thẳng màn Video. Đây là lát làm TikTok mobile thực sự có giá trị (khảo sát 04/10 kết luận 3).

## 7. Lát việc và ước lượng

| Lát | Nội dung | Công | Nộp kho |
|---|---|---|---|
| 1 | Chip TikTok, 4 số, Cần xử lý, thẻ chiến dịch, hộp chi tiết (đọc + mở Seller Center) | 1 ngày | 1.1 |
| 2 | Màn Video: lọc chip, chọn nhiều, Loại / Khôi phục có xác nhận, tab Lịch sử + Khôi phục cả lệnh | 1–1,5 ngày | 1.1 |
| 3 | Thông báo đẩy từ 2 chuông TikTok (expo-notifications + bảng token + worker gửi), mở thẳng màn | 1,5–2 ngày | 1.2 |
| — | Mô phỏng web cho anh duyệt sau lát 1 và sau lát 2, trước khi build | trong công trên | |

Soi trước khi giao: màn 320 / 375 / 430, giao diện tối, gian chưa nối, gói khóa, chiến dịch đã
dừng (không ô chọn), oEmbed hỏng (không ảnh), lệnh 409 (chiến dịch vừa dừng).

## 8. Rủi ro và chỗ hở

- **oEmbed đang bị chặn** → màn Video có thể không có ảnh / tên trong thời gian dài. Thiết kế dòng
  video đứng được bằng "@kênh · mã video + sao chép + mở trên TikTok"; nếu còn chặn lâu, làm theo
  hướng docs GMV Max (gọi từ máy khách / lưu caption DB) — trên app, gọi oEmbed **từ điện thoại
  khách** (IP dân cư) có thể qua được; đáng thử ở lát 2, ghi nhận kết quả.
- **Link mở Seller Center**: chưa biết app TikTok Seller có bắt `seller-vn.tiktok.com` không
  [SUY ĐOÁN]. Nếu không, khách rơi vào web mobile của Seller Center, vẫn làm được nhưng phải đăng nhập.
- **Lệnh loại video từ điện thoại** là lệnh thật, không có "diễn tập" cho thao tác tay → hộp xác
  nhận phải nêu số như trên; 30 ngày sau khi khách khôi phục tay, máy không tự loại lại (đã có ở backend).
- **Số trễ 11 giờ**: khách sáng xem thấy video "0 đơn" có thể chỉ vì chưa cập nhật → chip "Chưa ra
  đơn" phải đi kèm cửa sổ ≥ 3 ngày trọn như luật `MIN_FULL_DAYS`; dòng chân trang nói rõ.
- **Apple**: màn có chữ "Trợ lý" và lệnh thật; lần 7 Apple từng nghi AI bên thứ ba. Giữ câu chữ
  "Hubsell nhận định", không dùng chữ AI; ghi chú người duyệt mô tả đúng.

## 9. Câu hỏi cần anh chốt

1. Nộp 1.0.1 ngay (sửa Quét + ngủ đông), TikTok đi 1.1 — hay gộp một lần (chậm ~3 ngày)?
2. Phạm vi 1.1 = lát 1 + lát 2 (có loại video) — hay chỉ lát 1 (xem + dẫn sang Seller Center)?
3. Luật "Cần xử lý" mục 5 (mặc định tự chọn) — anh có muốn đổi thứ tự hay bỏ loại nào?
4. Thông báo đẩy (lát 3) làm ngay sau 1.1 hay để khi có thêm khách TikTok?
