# VAT QUẢNG CÁO TRONG BÁO CÁO TÀI CHÍNH / DÒNG TIỀN — KHẢO SÁT + PHƯƠNG ÁN + BẢN ĐÃ CODE

> 26/11/2026. Anh Trung: "lên phương án xem thêm VAT quảng cáo, anh muốn đưa vào báo cáo tài chính, báo cáo dòng tiền. Anh nhớ không nhầm là 10% đối với TikTok và 8% với Shopee thì phải".
> Hiện trạng: anh bấm "Làm theo đề xuất" ~10:33 26/11 → **lát 1 (báo cáo) + công tắc ĐÃ CODE và LÊN PROD `67995ff1` 10:56 26/11 (anh: "Push luôn")** — xem **mục 8** (cái đã làm, bảng trước / sau, việc còn lại). Mục 1–7 là khảo sát + đề xuất gốc. Ba ảnh K1–K3 ở mục 5 vẫn cần.
> Đây là chuyện thuế: mỗi ý ghi mức chắc; chưa phải ý kiến của cơ quan thuế hay kế toán.

## 1. Kết luận ngắn

- Anh nhớ **đúng cho năm 2026**: TikTok 10%, Shopee 8%. Thiếu hai chi tiết: Shopee 8% **chỉ tới hết 31/12/2026** (chưa có văn bản kéo dài → 01/01/2027 về 10%); trước 01/07/2025 thì ngược lại (TikTok 5%, Shopee 10%).
- Cả hai sàn **cộng VAT thêm lúc nạp tiền** (nạp 100.000 trả 108.000 / 110.000), tài khoản quảng cáo nhận đủ số chưa thuế. Nên con số "chi phí quảng cáo" sàn báo — thứ Hubsell đang lấy — **nhiều khả năng là số CHƯA gồm VAT**. Không trang chính chủ nào nói thẳng câu này (mục 5 là cách kiểm).
- Hubsell hiện chưa có chỗ nào tính VAT quảng cáo. Riêng phần quảng cáo Shopee **trích từ tiền đơn** thì VAT đã nằm sẵn trong số trừ của đơn.
- **Quy mô 30 ngày (27/10–25/11, SQL chỉ đọc trên prod, theo giả định "số sàn báo là chưa VAT"):** khoảng **448 triệu** tiền VAT quảng cáo chưa nằm trong báo cáo nào — TikTok ≈ 368 triệu (136 gian, 115 chủ shop, gian lớn nhất ≈ 50 triệu), Shopee ≈ 79 triệu (99 gian, 85 chủ shop, lớn nhất ≈ 6 triệu), Lazada ≈ 1 triệu (1 gian, mức 8% là giả định). Chưa tách tài khoản demo.
- Hệ quả lớn hơn cả báo cáo: **ROI / ROAS hòa vốn của Trợ lý quảng cáo đang thấp hơn thật 8–10%** với gian tự nạp tiền quảng cáo (mục 4.4) — phải mô phỏng từng chiến dịch trước khi đụng.

## 2. Sự thật về thuế (nguồn + mức chắc)

| Sàn | Ai bán quảng cáo | Mức 2026 | Thu lúc nào | Số sàn báo là | Mức chắc |
|---|---|---|---|---|---|
| TikTok (Ads Manager, GMV Max) | TikTok Pte. Ltd. (nước ngoài, tự khai thuế ở VN) | **10%** từ 01/07/2025 (trước đó 5% — theo đại lý) | Cộng thêm lúc thanh toán: 1.000 + 100 = 1.100 | Chưa gồm VAT (suy luận: thuế là bản ghi riêng ở tab Chi phí) | Mức %: chắc · thời điểm: khá chắc · số báo cáo / API: khá chắc |
| Shopee (Dịch vụ Hiển thị) | Pháp nhân Việt Nam, hóa đơn GTGT | **8%** từ 01/07/2025 tới 31/12/2026 (trước đó 10%) | Lúc nạp: nạp 100.000 trả 108.000; "gói nạp đặc biệt" thì giá đã gồm VAT | Chưa gồm VAT (suy luận: số dư ghi theo số chưa thuế) | Mức % + thời điểm: chắc · số báo cáo: khá chắc |
| Lazada (Dịch vụ Tài trợ) | Công ty TNHH Recess (VN) | Điều khoản chỉ nói phí chưa gồm thuế; **không có nguồn chính chủ nêu %** (theo luật có lẽ 8%) | Không nêu | Chưa gồm thuế (điều khoản) | Có VAT: chắc · mức % + thời điểm: chưa rõ |

Nguồn chính:
- TikTok: `ads.tiktok.com/help/article/vietnam-vat-cit` (cập nhật 07/2025, bảng ví dụ 1.000 + 100 = 1.100; căn cứ Luật Thuế GTGT 48/2024/QH15); `ads.tiktok.com/help/article/about-transaction` (tab Giao dịch gồm thuế, tab Chi phí ghi "thuế ước tính" thành bản ghi riêng).
- Shopee: `banhang.shopee.vn/edu/article/25329` (thông báo 14/05/2026: Dịch vụ Hiển thị thuế GTGT 8% tại thời điểm thanh toán, 01/07/2025–31/12/2026, căn cứ Nghị quyết 204/2025/QH15); `banhang.shopee.vn/edu/article/2192` (màn nạp: giá 100.000, VAT 8.000, tổng 108.000).
- Lazada: điều khoản Dịch vụ Tài trợ trên `terms.alicdn.com` (hiệu lực 11/08/2026), Phần B Điều 5.
- Luật: Nghị quyết 204/2025/QH15 (giảm 2% từ 01/07/2025 tới hết 31/12/2026; quảng cáo và dịch vụ sàn không nằm trong nhóm loại trừ); Luật 48/2024 Điều 9 khoản 3 (nhà cung cấp nước ngoài qua nền tảng số: 10%).
- Trong repo đã có sẵn: `docs/SHOPEE-NAP-VI-QUANG-CAO-TRU-TRUNG.md` dòng 15 (nạp ví trích từ đơn = % × 1,08 — đã gồm VAT 8%, CHẮC, soi từ đơn thật); ghi nhớ chạy thử TikTok Ads 09/11 (nạp 600.000 trả 660.000, số dư và chi phí tính trên 600.000).

Vì sao khác nhau: TikTok bán qua pháp nhân nước ngoài (10%, không thuộc diện giảm theo cách các sàn đang áp), Shopee qua pháp nhân Việt Nam theo phương pháp khấu trừ (được giảm còn 8%). Căn cứ văn bản cho việc "nước ngoài không được giảm" em **không tìm được công văn nào nói thẳng** — chỉ biết cả TikTok lẫn Shopee (với pháp nhân nước ngoài của họ) đều đang thu 10%.

VAT này là chi phí thật hay được khấu trừ:
- **Hộ / cá nhân kinh doanh** (nộp GTGT theo tỷ lệ % doanh thu): không khấu trừ đầu vào → VAT quảng cáo là chi phí thật. Chắc.
- **Công ty theo phương pháp khấu trừ:** VAT 8% trên hóa đơn Shopee khấu trừ được nếu lấy hóa đơn theo mã số thuế công ty (khá chắc) → không phải chi phí. VAT 10% của TikTok: theo một công văn địa phương (Thuế tỉnh Tây Ninh 13/08/2026, em chỉ đọc được bản tóm tắt) chứng từ TikTok Pte. Ltd. không phải hóa đơn GTGT Việt Nam, không được khấu trừ → vẫn là chi phí. Khá chắc, cần kế toán xác nhận.

## 3. Hubsell đang làm gì với tiền quảng cáo (đã đọc mã)

- Một bảng `AdSpend` (mỗi gian mỗi ngày một số `amount`), không có cột thuế. Shopee lấy `expense` của `get_all_cpc_ads_daily_performance`; TikTok lấy `cost` của báo cáo GMV Max (Marketing API); Lazada lấy `spend` của báo cáo Sponsored Discovery.
- Phần quảng cáo sàn trừ thẳng trong đơn đã nằm trong phí của đơn: Shopee `Order.adWalletTopup` (nạp ví trích từ đơn, **đã gồm VAT**), TikTok `feeGmvMax` (`gmv_max_ad_fee_amount` + voucher — **chưa biết** đã gồm VAT chưa).
- Luật "hướng A" (anh chốt 10/11): báo cáo chỉ cộng thêm **phần vượt** = max(0, chi phí sàn báo − phần đã trừ trong đơn), tính trong MỘT hàm `summarizeAdsSpend` (`backend/src/services/ads-spend.ts`). Bốn báo cáo đi qua hàm này: Báo cáo dòng tiền, Tổng quan, Lãi/Lỗ thực hiện, Trợ lý. → thêm VAT chỉ phải sửa một chỗ tính.
- Bốn chỗ đọc thẳng `AdSpend` để HIỂN THỊ / đối chiếu (dòng "Chi quảng cáo" của Trợ lý, trang Trợ lý quảng cáo, đối chiếu Shopee Ads, cảnh báo quảng cáo đột biến) — giữ số sàn báo, chỉ cần thêm chữ "chưa gồm VAT".
- ROI / ROAS hòa vốn KHÔNG đọc `AdSpend`: hòa vốn = 1 ÷ biên lãi trước quảng cáo (`lib/ads-margin.ts`, `lib/tiktok-breakeven.ts`), ROI thực tế đọc `AdsCampaignDailyPerf.expense`. → cộng VAT vào báo cáo KHÔNG tự làm đổi hòa vốn.
- Lỗ nhỏ có sẵn ở Shopee: phép "phần vượt" đang trừ khoản nạp ví ĐÃ gồm VAT khỏi chi phí CHƯA gồm VAT (hai gốc thuế khác nhau) → phần ngoài đơn bị thiếu khoảng nạp ví × 8/108. 30 ngày: 985 → 991 triệu (thiếu ≈ 6 triệu toàn hệ thống).
- Trường thuế trên phí quảng cáo trong bản kê TikTok (`cps_shop_ads_commission_tax_amount`) không được lưu riêng, rơi vào "Phí khác"; chưa thấy trên đơn thật của 3 gian của anh.

## 4. Phương án

### 4.1 Công thức (mỗi gian, mỗi kỳ)

- `S` = Σ chi phí quảng cáo sàn báo (chưa VAT). `r` = thuế suất theo NGÀY tiêu (bảng 4.2); kỳ vắt qua hai mức thì dùng mức bình quân theo tiền.
- `F` = Σ quảng cáo đã trừ trong đơn. `F₀` = phần chưa VAT của nó: Shopee `F ÷ (1 + r)` (chắc là đã gồm VAT); TikTok tạm lấy `F` (chưa biết — K1 mục 5 quyết định).
- **Quảng cáo ngoài đơn** = max(0, S − F₀) — như hiện nay, chỉ sửa gốc so cho Shopee.
- **Thuế GTGT quảng cáo** (dòng MỚI) = Quảng cáo ngoài đơn × r.
- Phần VAT nằm trong khoản trừ ở đơn KHÔNG cộng lại (đã ở phí đơn).

Ví dụ Shopee, một tháng tiêu 10.000.000 (sàn báo), trong đó 5.400.000 trích từ đơn (= 5.000.000 + VAT): ngoài đơn = 10.000.000 − 5.000.000 = 5.000.000; VAT = 400.000; tổng tiền quảng cáo trong báo cáo = 5.400.000 + 5.000.000 + 400.000 = 10.800.000 = đúng tiền thật rời túi. Hiện nay báo cáo ra 10.000.000.

### 4.2 Bảng thuế suất — một tệp cấu hình theo ngày

`backend/src/config/ads-vat.ts` (mới), mỗi dòng có nguồn:

| Sàn | Từ ngày | Tới ngày | Mức |
|---|---|---|---|
| TikTok | 01/07/2025 | — | 10% |
| TikTok | — | 30/06/2025 | 5% (theo đại lý — khá chắc) |
| Shopee | 01/07/2025 | 31/12/2026 | 8% |
| Shopee | 01/01/2027 | — | 10% (mặc định theo luật nếu không có văn bản kéo dài) |
| Shopee | — | 30/06/2025 | 10% |
| Lazada | — | — | **0% cho tới khi có ảnh hóa đơn thật** (K3) |

Tính lúc ĐỌC (không lưu cột VAT vào `AdSpend`): sửa mức hay thêm văn bản mới thì số quá khứ tự đúng theo ngày, không phải chạy lại dữ liệu, không cần migration.

Đây là **phân bổ theo ngày tiêu**. Thuế thật thu theo ngày NẠP — nạp 30/12/2026 (8%) tiêu sang tháng 1/2027 thì báo cáo sẽ tính 10% cho phần tiêu tháng 1, lệch 2% của phần đó. Hubsell không có dữ liệu ngày nạp (Shopee không có API tiền nạp / ưu đãi — đã hỏi 20/11) nên em đề xuất chấp nhận và ghi chú.

### 4.3 Hiện ở đâu

- **Báo cáo dòng tiền, Tổng quan, Lãi/Lỗ (Tổng quan lợi nhuận), Trợ lý:** dưới dòng Quảng cáo thêm dòng con **"Thuế GTGT quảng cáo (TikTok 10%, Shopee 8%)"**; tổng chi phí và lợi nhuận ròng gồm dòng này. Tooltip: "Sàn cộng thêm thuế lúc bạn nạp tiền quảng cáo. Hubsell ước theo chi phí sàn báo × thuế suất; phần quảng cáo sàn trích từ tiền đơn đã gồm thuế nên không cộng lại."
- **API:** số quảng cáo đang trả (`platformAdsSpend`) đổi thành ĐÃ gồm VAT, thêm trường `adsVat` cho dòng con → app mobile bản cũ vẫn khép đẳng thức Doanh thu − Chi phí = Lợi nhuận, không cần OTA; dòng con trên app làm sau.
- **Màn quảng cáo (Trợ lý quảng cáo, chi tiết chiến dịch):** giữ số sàn báo, thêm chữ nhỏ "chưa gồm VAT" — để còn so được với Seller Center.

### 4.4 ROI / ROAS hòa vốn — lát RIÊNG, chưa đụng

- Sàn tính ROI = doanh thu ÷ chi phí CHƯA VAT. Với gian tự nạp tiền quảng cáo, tiền thật bỏ ra = chi phí × (1 + r) → mức ROI hòa vốn thật = hòa vốn hiện tại × (1 + r). Ví dụ biên lãi 20% → hòa vốn đang báo 5,0; thật ra phải 5,5 (TikTok) / 5,4 (Shopee).
- Tức Trợ lý quảng cáo đang coi một số chiến dịch là "trên hòa vốn" trong khi tính đủ thuế là lỗ nhẹ. Đây là thay đổi vào trái tim sản phẩm → **phải mô phỏng trước / sau từng chiến dịch** (luật anh đặt), có cả hai ca thật TC054 / TC079, rồi mới quyết. Không gộp vào lát báo cáo.
- Với gian TikTok trả GMV Max bằng tiền đơn: có cộng × 1,1 hay không tùy K1.

### 4.5 Shop là công ty (được khấu trừ)

- Một công tắc theo chủ shop: **"Tính thuế GTGT quảng cáo vào chi phí"**, mặc định BẬT (đa số khách là hộ / cá nhân kinh doanh). Công ty khấu trừ thuế tắt đi — hoặc tinh hơn: tắt riêng phần Shopee / Lazada (TikTok vẫn là chi phí). Em đề xuất bản đầu một công tắc chung, để ở trang cấu hình thuế có sẵn.

## 5. Phải kiểm trước khi code (em không tự kiểm được — cần anh)

| | Kiểm gì | Cách | Vì sao |
|---|---|---|---|
| K1 | Dòng trừ GMV Max trong bản kê TikTok đã gồm VAT 10% chưa | Gian TikTok của anh (hoặc một gian trả GMV Max bằng tiền đơn): chụp bản kê một ngày có dòng "Nạp tiền quảng cáo từ số dư đã quyết toán" + chi phí GMV Max cùng ngày trong Seller Center. Tỷ lệ ≈ 1,10 = đã gồm; ≈ 1,00 = chưa | Quyết định `F₀` của TikTok và có nhân × 1,1 cho ROI hay không. Prod chỉ có 1 gian so được (tỷ lệ 1,01 trên 13 triệu / 2 tháng) — dấu hiệu "chưa gồm", quá yếu để kết luận |
| K2 | `expense` Shopee là số chưa VAT | Gian Shopee của anh: chụp Lịch sử giao dịch nạp tiền một tháng (số nạp + VAT) và tổng chi tiêu tháng đó trong Shopee Ads | Prod có 1 gian nạp ví ÷ chi tiêu = 1,09 (2 triệu) — khớp "chưa VAT" nhưng chỉ một gian nhỏ |
| K3 | Lazada thu VAT mức nào, lúc nào | Ảnh màn nạp tiền / hóa đơn Sponsored Solutions của một gian Lazada | Không có nguồn chính chủ nêu % |
| K4 | Số trước / sau từng shop | Em tự chạy bằng SQL chỉ đọc sau khi có K1–K2, gửi anh bảng 20 shop đổi nhiều nhất | Luật "đo trước / sau rồi mới push" |

Còn mở từ trước, liên quan: Shopee chưa trả lời ticket 20/11 (tiền ưu đãi quảng cáo có nằm trong `expense` không) — nếu có thì chi phí và VAT ước sẽ cao hơn thật ở gian dùng tiền ưu đãi.

## 6. Lát làm (sau khi anh chốt)

- **Lát 0 — kiểm số (không code):** K1–K4.
- **Lát 1 — báo cáo:** `config/ads-vat.ts` + sửa `summarizeAdsSpend` + trường `adsVat` + dòng con ở 3 trang web và Trợ lý + chữ "chưa gồm VAT" ở màn quảng cáo + test (kỳ vắt qua 31/12/2026, gian trả cả trong đơn lẫn ngoài đơn, gian không có quảng cáo, công tắc tắt). Không migration. Trước khi push: bảng trước / sau theo shop.
- **Lát 2 — công tắc công ty khấu trừ** (một cột cấu hình).
- **Lát 3 — ROI / ROAS hòa vốn có VAT:** mô phỏng từng chiến dịch, trình anh, rồi mới quyết làm hay chỉ ghi chú.
- **Sau:** dòng con trên app mobile (OTA); Lazada khi có K3; nhắc ~20/12/2026 kiểm văn bản kéo dài giảm 2% sang 2027.

## 7. Việc anh chốt

1. Cách tính: **ước theo chi phí sàn báo × thuế suất theo ngày tiêu** (không có dữ liệu ngày nạp)? (em đề xuất: đồng ý, có ghi chú)
2. Hiện thành **dòng con riêng** dưới Quảng cáo, hay gộp thẳng vào số Quảng cáo? (em đề xuất: dòng con — khách đối chiếu được với Seller Center)
3. Mặc định **BẬT cho mọi shop** ngay khi lên (lợi nhuận hiện trên báo cáo của shop chạy quảng cáo sẽ giảm đúng bằng tiền thuế — cần một dòng thông báo trong app), hay để shop tự bật? (em đề xuất: bật mặc định, vì đó là tiền thật)
4. Có làm công tắc cho công ty khấu trừ ngay bản đầu không? (em đề xuất: có, một công tắc chung)
5. Lát 3 (hòa vốn có VAT): cho em mô phỏng trước rồi trình, hay tạm chưa đụng? (em đề xuất: mô phỏng ngay sau lát 1)
6. Anh giúp 3 ảnh K1–K3 (mục 5).

## 8. ĐÃ CODE 26/11/2026 (anh: "Làm theo đề xuất" → "Push luôn") — LÊN PROD `67995ff1` 10:56

Làm theo các mặc định ở mục 7: ước theo ngày tiêu, dòng riêng, bật mặc định cho mọi shop, có công tắc cho công ty khấu trừ. Lát 3 (hòa vốn có VAT) CHƯA đụng.

### 8.1 Tệp

| Lớp | Tệp | Việc |
|---|---|---|
| Thuế suất | `backend/src/config/ads-vat.ts` (mới) | `adsVatRate(sàn, ngày)`: TikTok 5 % → 10 % từ 01/07/2025; Shopee 10 % → 8 % (01/07/2025–31/12/2026) → 10 %; Lazada 0. `adsChargedInOrderIncludesVat`: chỉ Shopee. Đường lui `ADS_VAT_OFF=1` |
| Phép tính | `backend/src/services/ads-spend.ts` → `summarizeAdsSpend` | thêm `vat`, `vatByDay`, `vatByChannel` (tách khỏi `total`); Shopee bóc thuế khỏi khoản trích từ đơn trước khi trừ; không truyền `vatAsCost` = y như cũ |
| Cấu hình | `ShopTaxSetting.adsVatAsCost` (migration `20261126160000_shop_tax_ads_vat_as_cost`, mặc định true) + `config/tax-config.ts` + `routes/tax.ts` (GET / PUT `/api/tax/settings`, trường không gửi = giữ nguyên) | công tắc theo chủ shop |
| Dòng tiền | `routes/finance.ts` | dòng chi phí mới `adsVat` "Thuế GTGT quảng cáo" ngay dưới dòng Ads (bóc theo sàn, chỉ hiện khi > 0); tổng cột Chi phí, lợi nhuận thực tế, chuỗi theo ngày đều gồm thuế |
| Lãi/Lỗ | `routes/finance.ts` (insights) + `profit-bridge-card.tsx` | bậc "Quảng cáo sàn" gồm thuế, tooltip nêu số thuế; trường `bridge.adsVat` |
| Tổng quan | `routes/analytics.ts` + `app/page.tsx` | nhóm ADS gồm thuế (cùng lợi nhuận ròng với Dòng tiền), nhãn "Chi phí quảng cáo (gồm thuế GTGT)" khi có thuế; trường `platformAdsVat` |
| Trợ lý | `routes/assistant.ts` | lợi nhuận kỳ + câu trả lời lãi / lỗ gồm thuế; dòng "Quảng cáo sàn (gồm thuế GTGT)" |
| Cài đặt | `app/invoicing/tax-settings/page.tsx` | thẻ "Thuế GTGT quảng cáo" + công tắc, lưu ngay khi gạt (không lưu kèm số đang gõ dở ở khối trên) |
| App mobile | không sửa | màn Dòng tiền vẽ theo danh sách `costs.items` của API nên dòng mới tự hiện, tổng tự đúng — CHƯA thử trên máy thật |

Dòng "Chi phí quảng cáo sàn (Ads)" GIỮ số sàn báo (chưa thuế) để còn đối chiếu với Seller Center; thuế là dòng ngay dưới.

### 8.2 Bảng trước / sau trên prod (SQL chỉ đọc, 30 ngày 27/10–25/11)

- **158 chủ shop** đổi số. Tiền quảng cáo ngoài đơn trong báo cáo: **4.678 triệu → 5.131 triệu (+453 triệu)** = thuế TikTok ≈ 368 + thuế Shopee ≈ 79 + phần Shopee sửa gốc so ≈ 6.
- Lợi nhuận ròng trên báo cáo của từng shop giảm đúng bằng phần tăng của shop đó (30 ngày): ≥ 10 triệu: 10 chủ shop · 5–10 triệu: 12 · 1–5 triệu: 47 · 100 nghìn–1 triệu: 60 · dưới 100 nghìn: 29. Trung vị ≈ 737 nghìn. Tám shop đổi nhiều nhất: 50,0 · 35,8 · 24,9 · 24,7 · 22,6 · 22,6 · 22,5 · 13,0 triệu.
- Chưa tách tài khoản demo / tài khoản thử. Lazada không đổi (thuế suất 0).
- ROI / ROAS hòa vốn, biên lãi quảng cáo, Trợ lý quảng cáo: KHÔNG đổi (không đọc đường này) — nên không có bảng theo chiến dịch.

### 8.3 Đã kiểm

- Test: `ads-spend.test.ts` thêm 8 ca thuế (tự nạp hết, Shopee trích một phần / trích trọn, TikTok trừ trong đơn, kỳ vắt qua 31/12/2026, Lazada, tắt, `ADS_VAT_OFF`), `ads-vat.test.ts` 4 ca; 9 ca cũ của `summarizeAdsSpend` không sửa vẫn xanh. Cả bộ backend: 3.086 qua, 21 đỏ — đúng 10 tệp `*-ledger-db` / `ads-*-db` / `channel-delete-db` và đúng số ca đỏ có sẵn như lượt chạy trước khi thêm thuế (10:04 cùng ngày). Kiểm kiểu hai phía + eslint tệp web đã sửa: sạch.
- Màn local (gieo 5 ngày × 200.000 ₫ quảng cáo Shopee, đã xóa): Dòng tiền hiện "Chi phí quảng cáo sàn (Ads) 1.000.000" + "Thuế GTGT quảng cáo 80.000"; lợi nhuận ròng Dòng tiền = Tổng quan = Lãi/Lỗ; gạt công tắc tắt → thuế về 0, ba trang cùng tăng 80.000; bật lại → về như cũ, % thuế bổ sung không bị đụng.

### 8.4 Chưa làm / chưa kiểm

- **Đã push 10:54, lên prod 10:56 26/11:** `/health` đúng commit `67995ff1`; SQL chỉ đọc: migration `20261126160000` xong, 3 dòng cấu hình thuế đều đang bật (shop chưa có dòng cấu hình cũng coi như bật); tệp JS của trang Thuế bổ sung trên `app.hubsell.vn` đã có trường mới. CHƯA đăng nhập tài khoản thật để nhìn màn prod và CHƯA so số một shop thật trước / sau trên màn.
- Lùi gấp nếu cần: đặt `ADS_VAT_OFF=1` trên dịch vụ web Render (không cần deploy lại mã, không đụng dữ liệu).
- ~~Thông báo cho khách~~ → ĐÃ GỬI chuông 11:13 26/11 (mục 9).
- Chữ "chưa gồm thuế GTGT" ở màn Trợ lý quảng cáo / chi tiết chiến dịch: chưa thêm.
- K1–K3 (mục 5) chưa có ảnh: TikTok trừ trong đơn đang coi là chưa gồm thuế; Lazada 0 %.
- Lát 3 (ROI / ROAS hòa vốn có thuế): chưa mô phỏng.
- App mobile: chưa nhìn trên máy thật; dòng con riêng trên donut app nếu cần chỉnh thì OTA sau.
- Số trên local chỉ có gian Shopee; ca TikTok mới qua test, chưa nhìn màn với dữ liệu thật.

## 9. Chuông báo khách — ĐÃ GỬI 11:13 26/11/2026 (anh duyệt câu chữ → "Gửi chuông")

- **Ai nhận:** chủ shop có tiền quảng cáo TikTok / Shopee trong 30 ngày (28/10–26/11) và đang để tính thuế vào chi phí. Shop không chạy quảng cáo, shop chỉ có Lazada, shop đã tắt công tắc: không nhận.
- **Kết quả trên prod (SQL chỉ đọc 11:16):** 157 chuông cho 157 chủ shop, gửi lúc 11:13:55; việc `ads-vat-notice-2026-11-26` trong `maintenance_jobs` đã có `doneAt`, `processed = 157`. Chỉ chuông (web + danh sách thông báo trong app), KHÔNG đẩy về điện thoại.
- **Câu đã gửi** — loại `system` (mục "Thông báo hệ thống", khách không tắt được), bấm vào mở Báo cáo dòng tiền:
  - Tiêu đề: Báo cáo có thêm dòng "Thuế GTGT quảng cáo"
  - Nội dung: Khi bạn nạp tiền quảng cáo, sàn cộng thêm thuế GTGT (TikTok 10%, Shopee 8%) ngoài số tiền quảng cáo. Từ hôm nay, Báo cáo dòng tiền, Tổng quan và Lãi/Lỗ tính thêm khoản thuế này vào chi phí, nên lợi nhuận hiển thị sẽ thấp hơn trước đúng bằng tiền thuế, kể cả khi bạn xem lại các kỳ cũ. Shop là công ty được khấu trừ thuế GTGT có thể tắt ở Hóa đơn & Thuế › Thuế bổ sung.
- **Bản dài để trả lời qua Zalo / thư** (ký "Hiếu — Hubsell"): đã soạn trong phiên 26/11, chưa gửi ai, KHÔNG lưu vào repo (bài một lần).
- **Sửa kèm:** chuông web trước cắt nội dung còn 2 dòng → thông báo loại `system` nay hiện đủ chữ (`frontend/src/components/shell/notification-bell.tsx`); các loại khác vẫn 2 dòng. App mobile vẫn cắt 3 dòng với loại này (chưa OTA).
- **Mã gửi:** việc một lần, đã chạy xong nên ĐÃ GỠ khỏi repo (worker + dịch vụ + test nằm ở commit `1cda64e4`, gỡ ở commit kế). Dòng `maintenance_jobs` giữ lại làm dấu đã gửi. Muốn gửi một đợt thông báo khác: lấy lại khuôn ở `1cda64e4` (giữ việc bằng UPDATE có điều kiện + bỏ qua người đã có chuông).
- **Chưa làm:** shop bắt đầu chạy quảng cáo SAU hôm nay sẽ không có chuông này (chỉ thấy tooltip ở dòng thuế).
