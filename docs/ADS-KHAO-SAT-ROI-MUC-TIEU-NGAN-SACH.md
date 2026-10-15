# Khảo sát 15/10/2026 — ROI mục tiêu + ngân sách khởi điểm cho đề xuất "Nên chạy" (TikTok GMV Max, đối chiếu Shopee)

> Bối cảnh: anh Trung xem tab Hòa vốn sản phẩm gian ANO (TikTok) — đề xuất "Nên chạy" đặt ROI mục tiêu = hòa vốn × 1,1
> (biên 21,9% → hòa vốn 4,57 → mục tiêu 5,1 → còn 2,3đ lãi / 100đ doanh thu) và không nói gì về ngân sách. Anh yêu cầu
> làm như chuyên gia quảng cáo: tra tài liệu sàn, tài liệu ngành, đối thủ để ra con số có căn cứ, không chung chung.
> Tệp này = kết quả tra cứu (nguyên văn + link) + phương án em đề xuất + số nào là mặc định tự chọn.
> ✅ **Anh chốt 15/10 tối ("đề xuất khá hợp lý, cứ sửa theo hướng này để anh theo dõi trực tiếp trên shop ANO")** → đã code
> theo mục 3 với các mặc định ở mục 6 (xem mục 7). Theo dõi trên ANO vài tuần rồi mới chỉnh số.

## 1. Đang sai ở đâu (phản biện trước)

| # | Chỗ hiện tại (`product-run-advice.ts`) | Vì sao chưa chuẩn |
|---|---|---|
| 1 | Mục tiêu = hòa vốn × 1,1 (`RUN_ADVICE_SAFE_FACTOR`) | 1,1 là **hệ số vùng vàng** của luật rà chiến dịch Shopee (dangerFactor), tức "dưới mức này là nguy hiểm" — không phải "mức nên đặt". Nó không nói được khách giữ bao nhiêu lãi. Phía Shopee anh đã chốt 08/10 thay bằng **sàn giữ lãi 1 ÷ (biên − lãi muốn giữ)** (`profitFloorRoas`, mặc định 5đ/100đ) nhưng nhận định "Nên chạy" của TikTok chưa đổi theo. |
| 2 | Lấy sàn làm đích ("đặt ROI mục tiêu từ 5,1") | Với GMV Max, **mục tiêu thấp = TikTok tiêu mạnh tay tới khi ROI tụt về đúng mục tiêu** (TikTok: "ROI thấp hơn giúp tăng phân phối… mục tiêu cao hơn có thể hạn chế chi tiêu"). Gian ANO đang đạt 12,85 mà bảo đặt 5,1 là mời sàn kéo ROI từ 12,85 xuống 5,1 — phần tiêu thêm đó là đơn biên (marginal) có ROAS thấp hơn nhiều so với ROI trung bình. Kết quả đúng như anh thấy: hòa vốn hoặc lãi rất mỏng. |
| 3 | So "ROI gian 30 ngày" với hòa vốn sản phẩm | ROI GMV Max là **ROI trộn**: TikTok ghi nhận MỌI đơn của sản phẩm trong lúc chiến dịch chạy, kể cả khách không hề thấy quảng cáo, cả đơn affiliate (mục 2.1). Sản phẩm đã bán tự nhiên 90.000đ/ngày thì với mục tiêu 5,1 sàn được phép tiêu tới 17.600đ/ngày mà ROI vẫn "đạt 5,1" dù quảng cáo không đẻ thêm đơn nào. Mục tiêu càng thấp, phần tiêu "ăn ké" doanh thu tự nhiên càng lớn. |
| 4 | Không có ngân sách | TikTok có công thức chính thức (mục 2.1) và API `bid/recommend` trả ngân sách gợi ý — Hubsell chưa dùng. |
| 5 | "Nên chạy" nói một lần rồi thôi | Không có nhịp: khi nào hạ mục tiêu, hạ bao nhiêu, dừng hạ lúc nào. Luật đó đã có ở `campaign-advice.ts` (hạ 10%, chờ 72 giờ, `stepProfitCheck`) nhưng kết luận "Nên chạy" không nối vào. |

## 2. Căn cứ đã tra (nguyên văn, có link) — 15/10/2026

### 2.1 TikTok chính thức (ads.tiktok.com/help + business-api.tiktok.com)

**Best practices for Product GMV Max** (cập nhật 06/2026) — https://ads.tiktok.com/help/article/best-practices-for-product-gmv-max?lang=vi
- "ROI khuyến nghị = GMV trước đây (không từ LIVE) ÷ Chi phí quảng cáo trước đây."
- "Nên theo ROI khuyến nghị của hệ thống hoặc đặt mục tiêu thấp hơn một chút để đạt kết quả tối ưu."
- "ROI thấp hơn giúp tăng phân phối và GMV, trong khi các mục tiêu cao hơn có thể hạn chế chi tiêu."
- "Ngân sách khuyến nghị = 2 × GMV trước đây (không từ LIVE) ÷ mục tiêu ROI."
- "Giữ mức tiêu thụ ngân sách dưới 80% và tăng ngân sách khi hiệu suất cải thiện."
- "Giữ mỗi cài đặt ROI ít nhất 3 ngày trọn vẹn trước khi điều chỉnh."
- "Nếu bạn không có dữ liệu hiệu suất trước đó, hãy sử dụng ROI và ngân sách khuyến nghị ở giao diện hệ thống."
- (EN) "Review total shop GMV to identify incremental gains after activation."

**API `GET /gmv_max/bid/recommend/`** — https://business-api.tiktok.com/portal/docs/get-the-recommended-gmv-max-roi-target-and-budget/v1.3
- roas_bid: "The ROI is based on the average ROI for your product category." (ANO probe 19/09: 7,2 — không theo sản phẩm, xem ADS-TIKTOK-GMV-MAX.md mục 4)
- budget: "calculated with your average ad spend for your selected products or average ad spend in your product category from the previous 14 days. Higher budgets are recommended to ensure delivery throughout the day because lower budgets may spend more quickly and limit your campaign performance." (ANO: 6.000.000)

**About attribution for GMV Max** (06/2026) — https://ads.tiktok.com/help/article/about-attribution-for-gmv-max?lang=en
- "all paid and organic orders for the products you chose for your campaign will be attributed to GMV Max while the campaign is running… whether or not they engaged with one of your ads."
- Cửa sổ 1 ngày: mua sau 3 ngày không tính.
- **About Product GMV Max** (09/2026): "bao gồm cả đơn hàng từ nội dung tự nhiên và đơn hàng liên kết tiếp thị".
- **Tips to measure product and video quality** (06/2026): "metrics like ROI and Cost per order might not give you the most accurate measure" vì trộn paid + organic.

**About GMV Max auto budget increase** (03/2026) — https://ads.tiktok.com/help/article/about-gmv-max-auto-budget-increase?lang=vi
- "Hệ thống sẽ tăng ngân sách hàng ngày thêm 50%, tối đa 10 lần trong cùng một ngày." Reset hôm sau. Bật được khi "ngân sách hàng ngày lớn hơn chi phí hiện tại × 1,05".
- API create/update: kích hoạt khi "campaign has reached at least 90% of your ROI target and at least 80% of your budget has been used".

**Best practices for Max delivery** (03/2026) — https://ads.tiktok.com/help/article/best-practices-for-max-delivery-optimization?lang=vi
- "Đặt ngân sách hàng ngày bằng ít nhất 10 lần AOV" (cho chế độ Phân phối tối đa / khởi động lạnh, KHÔNG phải chế độ ROI mục tiêu).
- "tăng dần thêm 30% mỗi ngày thay vì tăng đột ngột"; ngân sách Max delivery 1–5 lần chi tiêu thực ở chế độ ROI mục tiêu; ">5 lần … ROI của bạn có thể giảm mạnh".
- "ngân sách sẽ chỉ được chi tiêu nếu đáp ứng ROI mục tiêu" (chế độ ROI mục tiêu).

**About ROI protection** (09/2026) — https://ads.tiktok.com/help/article/about-roi-protection-for-gmv-max-campaigns?lang=en
- Bảo vệ khi ROI ngày < 90% mục tiêu **và** chiến dịch > 20 đơn/ngày; "If you manually raise the Target ROI… or lower it more than once in a day, ROI protection will not apply to the day you made the change." (bản VI cũ hơn: chỉnh tay là mất bảo vệ ngày đó).

**Ngân sách tối thiểu**: KHÔNG có trang chính thức nào nêu mức tối thiểu riêng cho GMV Max (kể cả VND). Gần nhất: phụ lục Marketing API "Budget verification ratio…" — chiến dịch PRODUCT_SALES/STORE VND tối thiểu **100.000đ/ngày** (chuẩn quảng cáo thường, chưa chứng minh áp cho GMV Max). https://business-api.tiktok.com/portal/docs/budget-verification-ratio-and-value-range-for-each-currency/v1.3

**Không tìm thấy ở TikTok**: luật "% tối đa mỗi lần đổi ROI" cho GMV Max (20%/lần chỉ có ở bài Gross Revenue Optimization cũ 02/2025); "bắt đầu từ hòa vốn" hay "hệ số × hòa vốn"; bảng ROI theo ngành; giai đoạn học theo ngày/đơn ngoài "3 ngày trọn".

### 2.2 Shopee chính thức (để hai sàn cùng một giọng)
- https://ads.shopee.vn/learn/faq/398/1800 — "nên tham khảo hiệu suất ROAS lịch sử của Sản phẩm làm cơ sở ban đầu"; "không khuyến nghị… đặt mục tiêu ROAS cao hơn 25% so với giá trị ROAS tối đa mà hệ thống đề xuất"; mặc định ngân sách "Không giới hạn"; tránh sửa trong 7 ngày máy học.
- https://ads.shopee.ph/learn/faq/478/1829 — "Limit changes to 1-2 times daily, with an increase/decrease magnitude of no more than 20%"; "after 7 days of activation, the actual ROAS can reach 80%-120% of the target ROAS"; "To protect ROAS, moderately increase the target ROAS; To protect traffic, maintain the status quo or lower the target ROAS."
- Auto Budget Increase (ads.shopee.sg/learn/faq/531/2099, chỉ đọc được qua snippet): bước tăng 10–300%, mặc định 20%, 1–5 lần/ngày, mặc định 3.

### 2.3 Tài liệu ngành (ROAS mục tiêu từ biên lãi, ngân sách, nhịp chỉnh)
- **Hòa vốn = 1 ÷ biên đóng góp trước quảng cáo** — đồng thuận (Shopify blog, Tracify, Funnelytics, Judeluxe). Tracify: "The 4:1 rule is only the break-even at a 25 percent margin, not an empirical benchmark." https://tracify.ai/en/blog/guter-roas
- **Mục tiêu = 1 ÷ (biên − lãi muốn giữ)** — Funnelytics https://funnelytics.io/tools/break-even-roas-calculator ; dạng Amazon: "Target ACoS = Profit Margin (Before Advertising) – Target Profit Margin (After Advertising)" — Perpetua https://valhalla.perpetua.io/blog-amazon-advertising-cost-of-sale-acos ; DataGlass Labs (SEA, 30/05/2026) https://www.dataglasslabs.com/blog/how-to-set-target-roas-gmv-max : "Target ROAS = 1 ÷ (margin before ads − the margin you want to keep)… Target ROAS should not be the same for every product".
- **Hệ số × hòa vốn**: chỉ là quy ước agency, không nguồn thực nghiệm — Top Growth Marketing 1,3–1,5×; Judeluxe 1,3–1,6×; PeerPush +30–50%; Ecomobi (VN) "cao hơn hòa vốn khoảng 20-30%" https://ecomobi.com/vi/roas-la-gi/ .
- **Neo vào ROAS lịch sử / gợi ý sàn**: Google tROAS "set based on… historical ROAS performance as a reference" https://support.google.com/google-ads/answer/6268637 ; Google App "Use your comparable campaign's achieved ROAS… as a recommended starting tROAS" https://support.google.com/google-ads/answer/15995101 .
- **ROAS biên (marginal) quyết định lãi tuyệt đối**: Bloom Analytics "Any marginal ROAS above [hòa vốn] means your incremental spend is profitable… even when your blended ROAS still looks fine" https://www.bloomanalytics.io/blog/how-to-calculate-marginal-roas ; Eightx "marginal ROAS on new spend is almost always lower than your current blended ROAS" https://eightx.co/tools/ad-spend-scaler .
- **Ngân sách**: TikTok quảng cáo thường (chính thức) "Deep Conversion… 10 x current CPA" https://ads.tiktok.com/help/article/budget-best-practices?lang=en ; Meta ~50 sự kiện/7 ngày → ngân sách ≈ 7× CPA/ngày (thứ cấp, trang Meta không mở được); Google chỉ nói có thể tiêu tới 2× ngân sách ngày. "Ngân sách = X × AOV" không có nguồn uy tín ngoài TikTok Max delivery 10×AOV.
- **Nhịp đổi**: TikTok GMV Max ≥ 3 ngày trọn/mức ROI, ngân sách trong ±50% mức cũ; Shopee ±20%, 1–2 lần/ngày, 7 ngày học; Google App "±15 to 20% range… no more than once every 1 to 2 weeks".
- **Tính tăng thêm (incrementality)**: Blake/Nosko/Tadelis (eBay, Econometrica 2015) https://www.nber.org/papers/w20171 — quảng cáo tới khách đã sẵn mua "returns… are a fraction of conventional non-experimental estimates"; Feedvisor (Amazon, không dẫn nghiên cứu) "30-60% of 'ad-driven' sales were organic purchases". **Không nguồn nào công bố hệ số hiệu chỉnh cho quảng cáo nội sàn** → nếu Hubsell dùng, phải ghi là mặc định tự chọn.
- Benchmark thời trang/phụ kiện: Triple Whale 2025 TikTok paid "Apparel & Accessories 2,49" (DTC, không phải GMV Max); LDH Media (agency VN tự báo, 09/10/2026) GMV Max thời trang 30 ngày ROI 14,67, 7 ngày 7,69, cold start 4,54. Không có số riêng túi xách/balo.

### 2.4 Đối thủ
- **Không tool Việt Nam nào công bố công thức ROI mục tiêu / ngân sách**: Salework Ads (đấu thầu từ khóa Shopee), Sapo, Nhanh.vn, UpBase, GoSELL, Haravan, Pancake, Abit, Metric: không công bố.
- **BigSeller** Auto Rules (Shopee + TikTok): khách tự đặt điều kiện → chỉnh ngân sách / mục tiêu ROAS / tạm dừng; blog VN gợi ý "tiêu <30% ngân sách → hạ ROI 1,5 → 1,3", "quan sát 3 ngày", ngân sách "$500" — ý kiến. https://help.bigseller.com/en_US/detailPage/12/1/9018/content
- **GMVPro** (gmvpro.vn, 499k/tháng, đối thủ sát nhất về GMV Max): rule "Spend ≥ 80% ngân sách → +20%", kiểm vài phút/lần; không công bố cách chọn ROI.
- Agency VN: Admatrix "mỗi lần không quá 20%, tối đa 1 lần/ngày"; Vinh Nguyen "ngân sách ngày = 50 × CPA" (gán cho TikTok nhưng TikTok không nói); TukiGroup/EcomMax/Dream khuyên đặt **cao hơn** gợi ý 10–20%; Hunter Agency "ngân sách = GMV mục tiêu × 8–25%", tăng 15–20%/12–24 giờ khi ROAS ≥ 3,5.
- Kết luận: không ai làm điều Hubsell có thể làm — **nối biên lãi thật từ sổ cái + ROI gian thật + công thức chính thức của TikTok thành một đề xuất có số**. Đây là chỗ hơn đối thủ, đúng định vị "trợ lý quảng cáo đa sàn".

## 3. Phương án đề xuất (chờ anh chốt)

Nguyên tắc: **sàn** (không được thủng) lấy từ biên lãi; **điểm xuất phát** lấy từ số sàn/gian đang đạt (theo TikTok); **hạ từng nấc** khi còn dư ngân sách và lãi tuyệt đối còn tăng (ROAS biên); **ngân sách** theo công thức chính thức của TikTok, chặn bởi mức thử an toàn của Hubsell.

### 3.1 ROI mục tiêu khởi điểm (sản phẩm chưa chạy)
```
sàn giữ lãi   = 1 ÷ (biên trước ads − minKeepPer100/100)        — profitFloorRoas, mặc định 5đ/100đ (anh chốt 08/10 cho Shopee; cùng cấu hình AdsAssistantConfig.profit, TikTok đã đọc sẵn)
mốc đang đạt  = ROI GMV Max của gian 30 ngày (tiêu ≥ 100.000đ)   — đúng công thức "ROI khuyến nghị = GMV ÷ chi phí" của TikTok
              | không có → roas_bid của /gmv_max/bid/recommend/ (trung bình ngành) — TikTok: "không có dữ liệu thì dùng gợi ý hệ thống"
mốc quy về biên = mốc đang đạt × biên đang quảng cáo ÷ biên sản phẩm   — ★ anh chốt 15/10 đêm (mục 7b): giữ CÙNG TỶ LỆ tiền quảng cáo trên biên lãi
              | biên đang quảng cáo = Σ lãi trước ads ÷ Σ doanh thu (đơn đã đối soát) của SKU các chiến dịch có tiêu tiền 30 ngày; không có → biên gian
khởi điểm     = max(sàn giữ lãi, mốc quy về biên × 0,9), làm tròn 0,1  — "thấp hơn một chút" theo TikTok; 0,9 là MẶC ĐỊNH TỰ CHỌN, đối xứng mốc 90% mục tiêu của chính TikTok (ROI protection / auto budget)
```
Câu trong ô: *"Đặt ROI mục tiêu 11,6 (gian đang đạt 12,85, TikTok khuyên theo mức đạt được hoặc thấp hơn một chút). Không đặt dưới 5,9 — dưới đó lãi còn chưa tới 5đ/100đ. Sau mỗi 3 ngày trọn, nếu tiêu dưới 80% ngân sách thì hạ 10% một nấc; lãi ước tính không tăng thêm sau nấc hạ thì dừng."*

Vì sao không bắt đầu từ sàn: mục 1 dòng 2–3. Vì sao không đặt cao hơn mức đạt: TikTok nói mục tiêu cao "hạn chế chi tiêu" — chính ca TC054 (mục tiêu 15, đạt 12–13, tiêu 12–14% ngân sách) là bằng chứng của gian nhà.

### 3.2 Ngân sách ngày
```
theo TikTok   = 2 × GMV ngày của sản phẩm ÷ ROI khởi điểm       — GMV ngày = GMV 30 ngày (mọi đơn đặt, cùng rổ "Đối chiếu doanh thu") ÷ 30
trần thử      = 10% lãi 30 ngày của sản phẩm ÷ 7                 — luật Shopee đang có (testSpendShareOfProfit), MẶC ĐỊNH TỰ CHỌN của Hubsell
trần tồn      = tồn × giá ÷ ROI khởi điểm ÷ 14 ngày              — luật Shopee đang có (minCoverDays)
sàn           = 100.000đ/ngày                                    — mức tối thiểu VND chiến dịch PRODUCT_SALES theo phụ lục API (chưa chứng minh riêng cho GMV Max — ghi rõ trong tooltip)
ngân sách     = max(sàn, min(theo TikTok, trần thử, trần tồn)), làm tròn 10.000; "Chạy thử" lấy một nửa (như Shopee)
```
Ghi chú cho khách: ở chế độ ROI mục tiêu, ngân sách là **trần**, sàn chỉ tiêu khi đạt ROI mục tiêu (TikTok) — thứ quyết định lỗ hay lãi là ROI mục tiêu, không phải ngân sách. Vì vậy ngân sách đặt rộng (×2) là đúng ý TikTok, còn mức thử nhỏ chỉ để khách yên tâm tuần đầu.

Số tham khảo phụ: ngân sách `bid/recommend` của sàn (ANO 6 triệu, tính theo chi tiêu TB 14 ngày của gian/ngành) — hiện trong ô như "sàn gợi ý", không lấy làm số chính vì không theo sản phẩm.

### 3.3 Nhịp sau khi chạy (nối vào `campaign-advice.ts` đã có)
- Giữ mỗi mức ROI **≥ 3 ngày trọn** (TikTok chính thức) — TikTok đã dùng 72 giờ (`TIKTOK_TARGET_STEP_WAIT_HOURS`), khớp; Shopee giữ 48 giờ anh chốt 04/10.
- Hạ **10%/nấc** (anh chốt 04/10, = nửa trần 20% của Shopee; TikTok không công bố %), **tối đa 1 lần/ngày** (hạ quá 1 lần/ngày mất ROI protection — mới, cần thêm).
- Dừng hạ khi `stepProfitCheck` thấy lãi tuyệt đối không tăng (đã có) **hoặc** chạm sàn giữ lãi.
- Tăng ngân sách khi tiêu ≥ 80% và ROI ≥ 90% mục tiêu (hai mốc của TikTok): đề xuất **+30%** (TikTok Max delivery: "tăng dần 30% mỗi ngày"; auto budget của chính TikTok +50%) — thay cho +25% em trình 23/09 chưa được gật. Hoặc chỉ nhắc khách bật "tự tăng ngân sách" của TikTok (sàn tự làm +50% ≤ 10 lần/ngày, reset hôm sau).
- Cảnh báo mới trong ô: "hạ ROI quá 1 lần/ngày hoặc nâng ROI tay = mất bảo vệ ROI ngày đó (TikTok)".

### 3.4 Việc chuyên gia thật sự cần — "lãi tăng thêm so với trước khi chạy" (lát sau)
ROI trộn của TikTok không đo được quảng cáo đẻ thêm bao nhiêu. Cách TikTok tự gợi ý: so tổng GMV trước/sau khi bật. Hubsell có sổ cái → có thể tính **lãi 7 ngày trước khi chạy vs 7 ngày sau** của đúng sản phẩm (cả đơn tự nhiên, trừ chi phí ads). Dương = quảng cáo đáng tiền; âm dù ROI "đạt" = đang ăn ké doanh thu tự nhiên. Đây là cột không đối thủ nào có; làm sau khi 3.1–3.3 chạy ổn. Hệ số hiệu chỉnh kiểu "ROI thật = ROI báo × 0,6" KHÔNG làm — không có nguồn.

## 4. Ví dụ số thật (gian ANO, ảnh chụp 15/10, 60 ngày đối soát)

| Sản phẩm | Biên | Hòa vốn | Hiện tại (×1,1) | Sàn giữ lãi 5đ | Khởi điểm đề xuất | Ngân sách đề xuất |
|---|---|---|---|---|---|---|
| Túi đeo chéo nam ANO chất liệu… (DT 140,5tr/60 ngày ≈ 2,34tr/ngày) | 17,7% | 5,66 | **6,3** → giữ 1,9đ/100đ | 7,9 | **11,6** (12,85 × 0,9) → giữ 9,1đ/100đ | 2 × 2,34tr ÷ 11,6 ≈ **400.000đ/ngày** (trần thử: lãi 30 ngày ≈ 12,4tr × 10% ÷ 7 ≈ 178k → **180.000đ**, Chạy thử 100.000đ) |
| Túi đeo chéo nam ANO, da PU (DT 5,4tr/60 ngày ≈ 90k/ngày, bán 2/8) | 21,9% | 4,57 | **5,1** → giữ 2,3đ/100đ | 5,9 | **11,6** | 2 × 90k ÷ 11,6 ≈ 15k → đụng sàn **100.000đ** (và nói thẳng: bán 8 cái/30 ngày thì quảng cáo riêng sản phẩm này khó có số để học — hợp "Chạy thử") |

Đọc bảng: cùng gian, cùng dữ liệu, đề xuất hiện tại mời sàn kéo ROI từ 12,85 về 5–6; đề xuất mới giữ gần mức gian đang đạt và chỉ hạ khi lãi tuyệt đối còn tăng. (Trần thử 180k < theo TikTok 400k là do luật 10% lãi tháng của Hubsell — anh có thể nới cho sản phẩm "Nên chạy", giữ cho "Chạy thử".)

## 5. Số nào là của ai

| Số | Nguồn |
|---|---|
| Hòa vốn = 1 ÷ biên | Ngành (đồng thuận) |
| Sàn giữ lãi 1 ÷ (biên − 5%) | Công thức Funnelytics/Perpetua/DataGlass; **5đ/100đ mặc định tự chọn**, khách sửa được (đã có cấu hình) |
| Mốc đang đạt = GMV ÷ chi phí 30 ngày; không có thì dùng gợi ý hệ thống | TikTok chính thức |
| × 0,9 "thấp hơn một chút" | TikTok nói "thấp hơn một chút" không nêu %; **0,9 tự chọn**, mượn mốc 90% của TikTok |
| Ngân sách = 2 × GMV ÷ ROI | TikTok chính thức |
| Trần thử 10% lãi tháng, trần tồn 14 ngày, lift 1,5 | Hubsell tự chọn (đang dùng ở Shopee) |
| Sàn 100.000đ | Phụ lục API TikTok cho PRODUCT_SALES VND; chưa chứng minh cho GMV Max |
| 3 ngày trọn/mức ROI; tiêu < 80%; ROI ≥ 90% | TikTok chính thức |
| Hạ 10%/nấc | Anh chốt 04/10 (nửa trần 20% Shopee) |
| Tăng ngân sách +30% | TikTok (Max delivery) — đề xuất, chưa chốt |
| ≤ 1 lần hạ/ngày | TikTok (ROI protection) |

## 6. Chờ anh chốt
1. Khởi điểm = max(sàn giữ lãi, mức gian đang đạt × 0,9)? (hay × 1,0 / × 0,8)
2. Ngân sách: 2 × GMV ÷ ROI của TikTok, chặn bởi trần thử 10% lãi tháng — giữ trần thử cho cả "Nên chạy" hay chỉ "Chạy thử"?
3. Tăng ngân sách +30% hay chỉ nhắc bật "tự tăng ngân sách" của TikTok?
4. Có làm lát 3.4 "lãi tăng thêm so với trước khi chạy" ngay sau không?

Việc code khi chốt: `product-run-advice.ts` (nhận thêm minKeepPer100, gmv30d, price/AOV, roas_bid gợi ý; trả `suggestedRoi`, `floorRoi`, `dailyBudget`, `budgetNote`), route tab Hòa vốn gọi `bid/recommend` 1 lần/gian/ngày khi gian chưa có số, FE ô "Nên chạy" thêm dòng ngân sách + nhịp; `campaign-advice.ts` thêm cảnh báo ≤ 1 lần hạ/ngày + gợi ý tăng ngân sách; test cập nhật; docs ADS-TIKTOK-GMV-MAX.md mục 9 trỏ sang tệp này.

## 7. Đã code 15/10/2026 tối (anh chốt "cứ làm theo hướng này")

Mặc định đã chọn khi anh không nói khác: hệ số 0,9; trần thử 10% lãi tháng CHỈ áp cho "Chạy thử" ("Nên chạy" đi theo công thức TikTok,
chỉ chặn bởi trần tồn); tăng ngân sách +30%; lát 3.4 "lãi tăng thêm so với trước khi chạy" ĐỂ SAU.

- **`product-run-advice.ts`** (viết lại): `floorRoi` = `profitFloorRoas(biên, minKeepPer100)` không dưới hòa vốn (biên không đủ giữ mức
  lãi → sàn = hòa vốn + điều kiện Khả thi báo "Cần dè chừng"); `anchorRoi` = ROI gian 30 ngày (tiêu ≥ 100.000đ); `suggestedRoi` =
  max(sàn, ceil₀,₁(mốc × 0,9)), không mốc → sàn + câu nhắc ROI gợi ý Seller Center; `budget` = `runBudget()` (2 × GMV ngày ÷ ROI → trần tồn
  → [Chạy thử] trần thử + nửa → sàn 100.000 → làm tròn 10.000) kèm `note` kể cách ra số; kết luận in nhịp (3 ngày trọn, < 80% hạ 10% ≤
  1 lần/ngày, ≥ 80% tăng 30%). Điều kiện Khả thi so với **sàn giữ lãi** thay vì hòa vốn × 1,1. 12 test (`tiktok-ads-product-run-advice`),
  có ca ANO thật (biên 17,7% · gian 12,85 · 2,34tr/ngày → 11,6 · sàn 7,9 · 400.000đ).
- **`revenue30d`** thêm vào `TiktokSalesPace` (GMV 30 ngày mọi đơn đặt trừ hủy, chia theo tỷ trọng giá trị hàng): đường rows
  (`salesPaceByGroup`), đường sql (`ledgerTiktokBreakevenByGroup` — lọc `paid` như placedRevenue: test `tiktok-breakeven-sql-db` bắt được
  lệch −800đ ở dòng quà giá 0 mang phần dư làm tròn, đã sửa), công cụ đối chiếu so với dung sai 1đ. `ProductBreakevenRow.revenue30d`.
- **`breakeven.ts`**: route tab đọc `minKeepPer100` của gian (`loadMinKeepPer100`) và truyền `revenue30d` vào nhận định.
- **`campaign-advice.ts`**: `budget_capped` trả `nextBudget` (+30%, `nextBudgetStep`, làm tròn 10.000) + câu "từ X lên Y, giữ 3 ngày trọn;
  hoặc bật Tự tăng ngân sách của TikTok"; `target_binding` thêm "Chỉ giảm một lần trong ngày — giảm lần hai là mất bảo vệ ROI". Hai mốc
  `TIKTOK_BUDGET_USED_PCT` 80 / `TIKTOK_BUDGET_STEP_PCT` 0,3 đặt ở `lib/tiktok-breakeven.ts` để không vòng import.
- **FE** `tiktok-advice-body.tsx`: khối "Ngân sách ngày X · ROI mục tiêu Y · không dưới Z" + câu cách ra số dưới Kết luận; `api.ts` thêm
  `floorRoi` / `minKeepPer100` / `anchorRoi` / `budget` / `nextBudget` (tùy chọn — chịu backend cũ).
- **Kiểm:** tsc backend + frontend sạch; 64 test (6 tệp, gồm 2 tệp DB dev) xanh. Soi UI cục bộ trên gian "Hubsell Demo Store"
  (reviewer@hubsell.vn, cổng 4001 tạm, đã trả lại): sản phẩm biên 32,9% · gian 11,05 · giữ 10đ/100đ (cấu hình của gian) → sàn 4,4 · khởi
  điểm 10 · ngân sách 167.837 → trần thử → nâng lên 100.000 — khớp tính tay.
### 7b. Quy mốc về biên của từng sản phẩm (anh Trung 15/10 đêm, ngay sau khi push `c15b72f9`)

Anh xem: "ROI mục tiêu của tất cả các chiến dịch đều giống nhau thì giá trị của công cụ bị giảm đi rất nhiều — mức hòa vốn khác nhau mà
đề xuất giống nhau anh thấy chưa ổn." Đúng: mốc "ROI gian đang đạt" là một số cho cả gian, nên mọi sản phẩm có sàn dưới 11,6 đều nhận
11,6; chỉ sàn giữ lãi khác nhau.

**Sửa:** thứ giữ nguyên khi chuyển sang sản phẩm khác không phải con số ROI mà là **tỷ lệ tiền quảng cáo trên biên lãi** mà gian đang
đạt: k = (1 ÷ ROI gian) ÷ biên các sản phẩm đang quảng cáo (ANO: 1/12,85 ÷ 17,5% ≈ 44% biên lãi đi vào quảng cáo). Áp cùng k cho sản
phẩm biên m → ROI = 1 ÷ (k × m) = ROI gian × biên đang quảng cáo ÷ m, rồi × 0,9, không dưới sàn. Hệ quả: lãi giữ lại / 100đ tỷ lệ với
biên (biên 21,9% giữ ~11,1đ, biên 14,2% giữ ~7,2đ) — cùng "mức cố gắng" quảng cáo cho mọi sản phẩm. Căn cứ: cách đặt ACoS mục tiêu
theo phần của biên lãi (Perpetua: "Target ACoS = Profit Margin (Before Advertising) – Target Profit Margin (After Advertising)");
DataGlass Labs: "Target ROAS should not be the same for every product… split the catalogue into margin bands and run a campaign per
band". Biên đang quảng cáo = Σ lãi trước ads ÷ Σ doanh thu (đơn đã đối soát 60 ngày) của SKU các chiến dịch có tiêu tiền trong 30 ngày
(`breakevens.base(campaignGroupKey)`); chiến dịch chưa biết SKU → không góp; không có gì → biên toàn gian; không có nốt → dùng thẳng ROI
gian và ô nói rõ. Ví dụ ANO (gian 12,85, biên đang quảng cáo 17,5%):

| Biên sản phẩm | Hòa vốn | Sàn giữ lãi 5đ | Mốc quy về biên | Khởi điểm (× 0,9) | Giữ lại / 100đ |
|---|---|---|---|---|---|
| 32,9% | 3,04 | 3,6 | 6,8 | **6,2** | 16,8đ |
| 21,9% | 4,57 | 5,9 | 10,3 | **9,3** | 11,1đ |
| 17,7% | 5,65 | 7,9 | 12,7 | **11,5** | 9,0đ |
| 14,2% | 7,04 | 10,9 | 15,8 | **14,3** | 7,2đ |
| 7,9% | 12,66 | 34,5 | 28,5 | **34,5** (sàn thắng) | 5đ |

Trường `anchorMargin` + `scaledAnchorRoi` trong kết quả; test "quy mốc về biên từng sản phẩm" 5 biên.

### 7c. Rút gọn chữ (anh Trung 15/10 đêm: "không cần giải thích kỹ tới vậy, chỉ cần kết luận nên đặt ROI bao nhiêu, ngân sách bao nhiêu")

- Kết luận = một câu: "Nên chạy vì đạt cả ba điều kiện. Đặt ROI mục tiêu 9,3, ngân sách 400.000đ/ngày." (Chạy thử: "Chỉ nên chạy thử ngân
  sách nhỏ vì còn phải dè chừng …. Đặt ROI mục tiêu X, ngân sách Y/ngày."). Bỏ hẳn đoạn nhịp 3 ngày / hạ 10% / tăng 30% khỏi ô này —
  nhịp đó là việc của trợ lý chiến dịch sau khi chạy (mục 7d).
- Hai dòng dữ kiện ngắn: "Biên lãi 21,9% → hòa vốn 4,57 · sàn giữ lãi 5,9 (giữ từ 5đ/100đ)." và "ROI gian 30 ngày 12,85 trên biên 17,5%
  (~44% biên lãi đi vào quảng cáo) → quy về biên 21,9% của sản phẩm: 10,3 → khởi điểm 9,3 (× 0,9); đạt đúng mức này còn lãi ~11,1đ/100đ."
- FE: một dòng "ROI mục tiêu 9,3 (không dưới 5,9) · Ngân sách 400.000đ/ngày"; cách ra số (công thức TikTok, trần, sàn) chuyển vào tooltip.
- 12 test cập nhật câu chữ.

### 7d. Rà: trợ lý đã nhắc giảm ROI / tăng hạ ngân sách chưa (anh hỏi 15/10 đêm)

- **TikTok — có, trên trang** (`campaign-advice.ts`, cùng một bộ cho nhãn ở Tổng quan, trang chiến dịch và cột Nhận định tab Hòa vốn):
  `losing` nâng ROI lên hòa vốn + loại video · `target_below` nâng ROI · `budget_capped` **tăng ngân sách** (+30%, từ X lên Y, hoặc bật tự
  tăng của TikTok) · `target_binding` **giảm ROI** 10% một nấc, ≤ 1 lần/ngày, không dưới sàn giữ lãi · `target_watching` giữ 72 giờ ·
  `target_hold` nấc hạ không ra thêm lãi thì giữ. Tự loại video có chuông (auto-run B8).
- **TikTok — chưa có:** chuông chủ động cho các kết luận trên (chỉ thấy khi mở trang; `grep notify` trong tiktok-ads chỉ có tự loại video);
  **hạ ngân sách** không có — chủ đích: ở chế độ ROI mục tiêu ngân sách là trần, TikTok chỉ tiêu khi đạt ROI (lỗ thì nâng ROI / loại
  video chứ không hạ ngân sách).
- **Shopee:** `assessDelivery` (ads-insights) cùng ba kết luận budget_capped / target_binding / target_hold hiện ở bảng Trợ lý khi mở
  trang; `ads-pulse.ts` chỉ là xung ĐỌC số (campaign mới, ngân sách, ROAS mục tiêu, ví) nuôi rule engine, không phải chuông; trong
  integrations/shopee chỉ delivery-fail và returns-sync có `notify` → chuông riêng cho "hạ ROAS / tăng ngân sách" cũng chưa có.
- ~~Đề xuất (chưa làm, chờ anh)~~ → ✅ anh chốt "làm chuông em nhé" → mục 7e.

### 7e. Chuông khi kết luận chiến dịch đổi + tô màu Kết luận (anh chốt 15/10 đêm, "ổn rồi")

- **`advice-alerts.ts`** `runTiktokAdviceAlerts(channel)`: gọi ngay sau `runTiktokAdsDaily` trong worker `order-auto-sync` (mỗi gian một lần
  mỗi ngày, cùng van công bằng); chấm `campaignAdvice` cho mọi chiến dịch đang chạy trên **7 ngày trọn gần nhất, bỏ hôm nay** (cùng cửa
  sổ assessDelivery Shopee) từ số đã có trong DB (không gọi sàn); ghi loại vào cột mới `AdsCampaign.adviceKind` + `adviceKindAt`
  (migration `20261015230000_ads_campaign_advice_kind`, ADD COLUMN DEFAULT ''); **chuông** (`type tiktok-ads-advice`, tiêu đề
  "Tên chiến dịch: nhãn", thân = câu kết luận, link trang chiến dịch) khi loại ĐỔI so với lần trước VÀ loại mới có việc phải làm:
  `losing` · `target_below` · `budget_capped` (tăng ngân sách) · `target_binding` (hạ ROI). Loại giữ / theo dõi / lãi / chưa kết luận chỉ
  ghi. Quay về healthy rồi ghìm lại → chuông lại. Tắt: `ADS_TIKTOK_ADVICE_ALERTS_OFF=1`. Test `tiktok-ads-advice-alerts` (4 ca thuần).
- **Chạy thật trên DB dev** (gian demo 6 chiến dịch): lượt 1 → 6 đổi, 3 chuông (2 ghìm + 1 lỗ); lượt 2 ngay sau → 0/0 (B8). Chuông
  hiện trong danh sách Thông báo với câu kết luận.
- **FE** `tiktok-advice-body.tsx` `ConclusionBlock`: khối Kết luận (ô Nên chạy) / Đề xuất (chẩn đoán chiến dịch) có viền trái + nền + chữ
  theo tông (đỏ lỗ · vàng cần làm · xanh ổn · xám chưa kết luận), nhãn in hoa nhỏ — điểm nhấn anh yêu cầu.
### 7f. Không ra đơn thì sao — ba kết luận mới (anh hỏi 15/10 đêm, chốt "làm như em đề xuất")

Câu hỏi của anh: "chạy theo đề xuất mà không ra đơn thì sao" và "sau bao lâu thì nhận định hạ ROI". Trước đó bộ chẩn đoán chỉ có
"Chưa tiêu tiền" (xám, không chuông) hoặc "Quảng cáo đang lỗ" (khuyên nâng ROI — sai thuốc khi 0 đơn). Nay `campaign-advice.ts` xét
ca 0 đơn TRƯỚC mọi phép so ROI, theo số ngày trọn chiến dịch đã có số (`loadCampaignFullDays`: ngày đầu có dòng AdsCampaignDailyPerf →
hết hôm qua) và mức tiêu:

| Điều kiện | Kết luận | Việc nên làm | Chuông |
|---|---|---|---|
| < 3 ngày trọn, 0 đơn | `learning` "Đang khởi động" (xám) | Giữ nguyên tới hết 3 ngày trọn | không |
| ≥ 3 ngày trọn, 0 đơn, tiêu < 20% ngân sách (hoặc chưa tới 100.000đ) | `no_delivery` "TikTok không phân phối" (vàng) | Hạ ROI một nấc 10%, không dưới sàn giữ lãi, giữ 3 ngày trọn; sát sàn / chạy Phân phối tối đa rồi → thêm video hoặc Phân phối tối đa 3–5 ngày | có |
| ≥ 3 ngày trọn, 0 đơn, tiêu ≥ 20% ngân sách và ≥ 100.000đ | `no_orders` "Tiêu tiền không ra đơn" (đỏ) | ĐỪNG hạ ROI; tạm dừng trong Seller Center, xem lại giá / ảnh / video | có |
| vừa đổi mục tiêu < 72 giờ, 0 đơn | `target_watching` | Giữ nguyên, chưa có đơn lúc học lại là bình thường | không |

Nguồn mốc: 3 ngày trọn = TikTok "Giữ mỗi cài đặt ROI ít nhất 3 ngày trọn vẹn" (Best practices for Product GMV Max); "Phân phối tối đa 3–5
ngày khởi động, ngân sách ≥ 10 × giá trị đơn" = TikTok Best practices for Max delivery; bài Shop Ads cũ (02/2025) "không chỉnh gì 3 ngày
đầu, chạy tối thiểu 7 ngày". **20% ngân sách** và **100.000đ** (= mức ngân sách tối thiểu) là MẶC ĐỊNH TỰ CHỌN
(`TIKTOK_NO_DELIVERY_BUDGET_PCT`, `TIKTOK_MIN_DAILY_BUDGET` ở lib/tiktok-breakeven.ts). Trần "tối đa 2 nấc hạ" CHƯA cưỡng chế (không lưu
số nấc đã hạ) — thay bằng sàn giữ lãi: sát sàn thì thôi hạ. Có đơn hoặc không biết ngày bật → luật cũ nguyên vẹn. **Hai lưới an toàn:** khoảng xem phải đủ 3 ngày trọn (`noOrdersWindowOk` — xem 1 ngày thì
không kết luận) và kết nối quảng cáo còn hiệu lực (mất kết nối → số DB không cập nhật, 0 đơn là thiếu số; gian demo 15/10 từng báo nhầm cả 6
chiến dịch) — không đạt thì truyền `fullDaysRunning = null`. Ba route (Tổng quan, trang
chiến dịch, tab Hòa vốn) + chuông cùng truyền `orders` + `fullDaysRunning`; hai loại mới vào `ADVICE_ALERT_KINDS`. Ô "Nên chạy" thêm câu
trong tooltip: "Không ra đơn thì 3 ngày đầu mất tối đa ngân sách × 3; sau 3 ngày trọn trợ lý sẽ nhắc hạ ROI hoặc tạm dừng". Test: 6 ca mới
ở `tiktok-ads-campaign-advice`, cập nhật `tiktok-ads-advice-alerts`.

- **Sau deploy:** Render chạy migration; log worker `[Auto-sync] "<gian>" nhận định chiến dịch TikTok: N/M đổi kết luận, K chuông` ở lượt
  ngày đầu (lần đầu mọi chiến dịch đều "đổi" từ "" → chuông cho mọi chiến dịch đang có việc — ANO có thể nhận vài chuông một lúc, một lần).

- **Chưa làm:** `bid/recommend` làm mốc khi gian chưa có số (số sàn không theo sản phẩm, 1 SPU → 7,2 / 2 SPU → 4 — chưa đáng tin để tự
  động, khách tự đọc trong Seller Center); lát 3.4; mobile không có ô này. **Theo dõi:** ANO sau deploy — ô Nên chạy phải ra khởi điểm ~11,6
  cho sản phẩm biên 17,7%; sau vài tuần anh so lãi thật rồi mới chỉnh 0,9 / 5đ / +30%.
