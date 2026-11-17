# THUẾ NHÀ THẦU — NCC NƯỚC NGOÀI NÀO PHẢI KHAI THAY

> Kết quả tra cứu ngày **08/10/2026** (Claude tra, anh Trung hỏi). Nguồn: cổng NCC nước ngoài của
> Tổng cục Thuế `https://etaxvn.gdt.gov.vn/nccnn` → mục **List of registered foreign providers** →
> để trống ô tìm, bấm Search → **322** NCC đã đăng ký (7 trang). Danh sách này đổi liên tục
> (mỗi tháng thêm vài chục tên) → **tra lại trước khi thêm NCC mới** hoặc mỗi đầu quý.

## ★ Câu hỏi mang đi hỏi cơ quan thuế (soạn 17/11/2026)

Anh Trung 17/11: "Liên quan tới thuế làm cẩn thận … Có cơ hội anh sẽ hỏi bên thuế xem thế nào." Mọi kết luận
trong tệp này và mục thuế của `docs/APPLE-IAP-MUA-GOI-TRONG-APP.md` là em đọc luật, CHƯA phải trả lời của cơ
quan thuế. Hỏi cơ quan thuế quản lý trực tiếp Hubsell (MST 0111626360), xin trả lời bằng văn bản nếu được.

1. **Hoa hồng Apple giữ lại.** Công ty bán gói phần mềm trong app iOS. Apple Distribution International
   (MST 9000000486) thu tiền khách, giữ hoa hồng 15–30 %, chuyển phần còn lại sau ~45 ngày. Hợp đồng Apple
   (Exhibit C mục 17) ghi Apple tự áp thuế nhà thầu Việt Nam trên hoa hồng và trừ vào tiền chuyển về.
   → Công ty có phải khai 01/NTNN cho phần hoa hồng này không? Nếu không, cần lưu chứng từ gì?
2. **Hóa đơn bán qua App Store.** Công ty đang xuất hóa đơn đủ giá khách trả, ngay ngày khách mua (theo
   Công văn 1063/CT-CS). → Đúng chưa? Hay được lập theo báo cáo đối soát của Apple, chậm nhất ngày 07 tháng
   sau (như hỏi đáp Cục Thuế câu 35 cho Google Play)? Phần chênh hóa đơn và tiền thực nhận ghi chi phí bán
   hàng — đúng chưa?
3. **Anthropic (Claude).** Hóa đơn đứng tên công ty, có dòng "VAT – Vietnam (10%)", Anthropic có MST
   9000020034. Từ 01/07/2026 đã trả 4 hóa đơn, 14.196.746 đ. → Công ty có phải khấu trừ nộp thay thêm thuế
   TNDN 5 % (hoặc cả GTGT) không? Nếu phải: khai bù 4 kỳ đã qua thế nào, phạt bao nhiêu?
4. **4 khoản lỡ trả bằng thẻ công ty** cho nhà cung cấp chưa đăng ký thuế Việt Nam (Render, Supabase,
   Google Play, Apple Developer — 27/09 → 05/10/2026, 4.107.563 đ), xử lý thành tạm ứng giám đốc và chuyển
   hoàn. → Như vậy có còn phát sinh nghĩa vụ nộp thay không?

Mang theo: hóa đơn Hubsell số 00000017 (bán qua App Store), bản PDF hợp đồng Apple (Schedule 2 + Exhibits),
báo cáo tài chính Apple đầu tiên (khi có, ~đầu 12/2026), hóa đơn Anthropic K2U9SLOU-0010, Công văn
1063/CT-CS. Có trả lời thì ghi ngay vào đây (ngày, người trả lời, nguyên văn).

## ★ Rà lại theo luật mới — 17/11/2026 (nhóm CÔNG TY trả tiền)

Luật đổi từ 01/07/2026: Thông tư 80/2021 (Điều 79) và Nghị định 126/2020 hết hiệu lực. Thay bằng Nghị định
252/2026/NĐ-CP + Thông tư 89/2026 + Thông tư 90/2026. Mục này thay cho mọi chỗ bên dưới còn ghi "Điều 79
TT 80/2021", "5 % + 5 %", "04.1-ĐK-TCT". Đây là em (Claude) đọc luật, CHƯA phải ý kiến kế toán hay cơ quan thuế.

### Kết luận từng nhà cung cấp

| Nhà cung cấp | Công ty đã trả từ 01/07/2026? | Kết luận | Mức chắc |
|---|---|---|---|
| **Anthropic, PBC** (Claude API + gói claude.ai) | Có — 4 hóa đơn, 14.196.746 đ | **Không phải khai thay.** Căn cứ: Anthropic có MST 9000020034; hóa đơn đứng tên công ty, có dòng "VAT – Vietnam (10%)"; nhà cung cấp tự khai thì tờ khai của họ gồm cả GTGT lẫn TNDN (Công văn 5351/CT-CS) | **Vừa.** Phần GTGT chắc. Phần TNDN 5 % là suy luận, chưa có giấy của Anthropic. Điều khoản của Anthropic không giúp mình (xem dưới) |
| **TikTok Pte. Ltd.** (quảng cáo) | **Chưa.** Sổ quỹ HQ 01/07 → 17/11 không có khoản TikTok nào. Tài khoản quảng cáo nằm trong BC "CTY TNHH MOT MINH TAO", anh trả bằng quét mã | **Chưa phát sinh gì cho Hubsell.** Nếu sau này công ty trả: áp như Anthropic. Đã có Công văn 7279/TNI-QLDN2 đúng ca TikTok Pte. Ltd.: không phải khai nếu TikTok tự khai cho doanh thu đó và hóa đơn đã gồm thuế Việt Nam | Chưa xem hóa đơn TikTok thật |
| **Hostinger** (hubsell.tech) | **Chưa.** Kỳ 2026 mua tài khoản cá nhân | **Chưa phát sinh.** Gia hạn 16/07/2027: em đề nghị giữ cá nhân. Đổi sang công ty thì áp như Anthropic | — |

Nhóm mua cá nhân (Render, Supabase, Vercel, Cloudflare, Zoho, Apple Developer, Google Play…): **không đổi**.

### Vì sao Anthropic "không phải khai thay" mà chỉ chắc mức vừa

Luật mới (khoản 3 Điều 43 Nghị định 252) giao doanh nghiệp Việt Nam khấu trừ nộp thay TRƯỚC. Chỉ thoát khi
có căn cứ nhà cung cấp đã tự khai nộp cho chính khoản đó (hỏi đáp Cục Thuế câu 18). Em soát từng căn cứ:

| Căn cứ | Có không | Chi tiết |
|---|---|---|
| Nhà cung cấp có MST Việt Nam | ✅ | Anthropic, PBC — 9000020034, đăng ký 06/03/2026 (cổng NCCNN, kiểm 08/10/2026, hôm nay chưa kiểm lại) |
| Hóa đơn đứng tên công ty + có dòng thuế Việt Nam | ✅ | Mở lại hóa đơn K2U9SLOU-0010 hôm nay: "Đến Cong Ty TNHH Cong Nghe Hubsell", 200,00 + "VAT – Vietnam (10%)" 22,22 = 222,22 USD. 22,22 = 10 % của 222,22 → em hiểu đây là thuế tính trên doanh thu kiểu nhà cung cấp nước ngoài tự khai, không phải VAT cộng thêm 10 % thông thường |
| Nhà cung cấp tự khai thì nộp cả TNDN | ✅ (gián tiếp) | Công văn 5351/CT-CS ngày 29/07/2026 của Cục Thuế: nhà cung cấp nước ngoài trực tiếp kê khai thì số thuế phải nộp tính theo pháp luật thuế GTGT **và** thuế TNDN. Thuế TNDN là thuế của chính họ nên không bao giờ hiện trên hóa đơn gửi khách |
| Luật cho phép đường "tự khai" song song | ✅ | Thông tư 90/2026: nhà cung cấp dùng MST để "trực tiếp khai, nộp thuế … **hoặc** cung cấp mã số thuế cho tổ chức kinh doanh tại Việt Nam … để thực hiện khấu trừ, nộp thay". Điều 31 Thông tư 89 vẫn giữ nguyên đường tự khai |
| Cơ quan thuế đã trả lời ca giống hệt | ⚠️ không chốt | Hỏi đáp Bộ Tài chính số 166088 (06/10/2026): công ty mua phần mềm AI trên web nhà cung cấp Tây Ban Nha, có MST Việt Nam, hóa đơn có "VAT/CIT 15%". Thuế cơ sở 7 TP.HCM chỉ trích luật (Điều 31 Thông tư 89, khoản 4 Điều 43) rồi bảo "căn cứ tình hình thực tế … để thực hiện", KHÔNG nói phải nộp thay, cũng không nói được miễn |
| Hợp đồng ghi nhà cung cấp tự lo thuế Việt Nam | ❌ | Điều khoản thương mại của Anthropic (API), mục H.2: phí chưa gồm thuế trừ khi hóa đơn ghi; khách tự nộp thuế khấu trừ nếu có và phải bù cho Anthropic nhận đủ. Điều khoản người dùng (gói claude.ai) không nói gì về thuế khấu trừ. Hỏi đáp Cục Thuế câu 34: hợp đồng không ghi nhà cung cấp tự lo thì bên Việt Nam khấu trừ |
| Giấy xác nhận Anthropic đã khai TNDN cho khoản của Hubsell | ❌ | Không tìm thấy trang trợ giúp nào của Anthropic nói về thuế Việt Nam. Chưa hỏi Anthropic |

Tóm lại: 4 điểm thuận, 2 điểm thiếu, 1 câu trả lời lửng. Em nghiêng về "không phải khai thay" vì nộp nữa là
nộp trùng: Anthropic đã thu và khai thuế trên chính doanh thu này. Rủi ro còn lại: cơ quan thuế quản lý
Hubsell đòi giấy xác nhận mà mình chưa có.

### Nếu cơ quan thuế bắt khai: số tiền, hạn, thủ tục

Bốn hóa đơn Anthropic công ty đã trả (số VND trên HQ prod, đọc 17/11/2026; 0008 chưa khớp sao kê):

| Hóa đơn | Ngày trả | Đã trả (đ) | Chỉ thiếu TNDN 5 % | Xấu nhất: GTGT 10 % + TNDN 5 % | Hạn khai theo lần |
|---|---|---|---|---|---|
| XSX3Y4AB-0001 (API) | 28/09/2026 | 144.207 | 7.590 | 14.421 + 8.349 = 22.770 | 08/10/2026 |
| K2U9SLOU-0008 (Max) | 07/10/2026 | 5.763.475 | 303.341 | 576.348 + 333.675 = 910.023 | 17/10/2026 |
| K2U9SLOU-0009 (dùng thêm) | 18/10/2026 | 2.598.003 | 136.737 | 259.800 + 150.411 = 410.211 | 28/10/2026 |
| K2U9SLOU-0010 (Ultra) | 07/11/2026 | 5.691.061 | 299.530 | 569.106 + 329.482 = 898.588 | 17/11/2026 |
| **Cộng** | | **14.196.746** | **747.198** | **2.241.592** | |

- **Cột "chỉ thiếu TNDN":** coi GTGT Anthropic đã thu là đã nộp. TNDN = số đã trả ÷ 0,95 × 5 %.
- **Cột "xấu nhất":** theo hỏi đáp Cục Thuế câu 24, coi cả số đã trả là tiền chưa thuế. GTGT = số đã trả ×
  10 %. TNDN = (số đã trả + GTGT) ÷ 0,95 × 5 %. Tức nộp trùng phần GTGT Anthropic đã thu.
- **Tiền chậm nộp** (0,03 %/ngày, tính tới 17/11/2026): khoảng 3.700 đ (chỉ TNDN) tới 11.200 đ (xấu nhất).
  Mức 0,03 % lấy từ bài tóm tắt Luật Quản lý thuế 108/2025, em chưa đọc nguyên văn điều đó.
- **Phạt chậm nộp tờ khai:** có, em CHƯA tra mức theo luật mới.
- Mỗi tháng sau: gói Ultra 222,22 USD ≈ 5,7 triệu → thêm ≈ 300.000 đ (chỉ TNDN) hoặc ≈ 900.000 đ (xấu nhất).

Thủ tục nếu phải khai:

1. **Xin mã số thuế nộp thay.** Mẫu **04.1-ĐKT** (Thông tư 90/2026, khoản 6 Điều 7, điểm b), nộp cơ quan thuế
   quản lý trực tiếp. Được cấp mã **10 chữ số**, thông báo mẫu 11-MST. Tên mẫu cũ 04.1-ĐK-TCT và "13 số" ở
   các mục dưới là theo luật cũ. Thời hạn cấp cho tổ chức em chưa đọc.
2. **Tờ khai 01/NTNN,NCCNN** (Thông tư 89/2026, Điều 32 + điểm 17 Phụ lục I), nộp điện tử. Điền **Phần II,
   nhóm I — Nhà cung cấp nước ngoài**: tên, MST 9000020034, số tiền + ngày thanh toán, doanh thu và tỷ lệ
   GTGT, doanh thu và tỷ lệ TNDN.
3. **Hạn.** Khai theo từng lần trả: chậm nhất ngày thứ 10 kể từ ngày tiếp theo ngày trả (Điều 10 Nghị định
   252). Trả nhiều lần trong tháng thì được đăng ký khai theo tháng, hạn ngày 20 tháng sau (Điều 30 Thông tư
   89; hai công văn Tây Ninh và Khánh Hòa áp điều này cho ca TikTok).

### Việc em đề nghị (anh chốt)

1. **Giữ "không khai thay" cho Anthropic, nhưng đi xin căn cứ.** Gửi Anthropic một thư hỏi: họ có tự khai
   nộp GTGT + TNDN tại Việt Nam (MST 9000020034) cho doanh thu từ khách doanh nghiệp không. Lưu thư trả lời
   cùng hóa đơn + ảnh chụp cổng NCCNN.
2. **Muốn chắc hẳn:** gửi văn bản hỏi cơ quan thuế quản lý Hubsell, kèm một hóa đơn Anthropic. Trả lời của
   họ mới là thứ ràng buộc.
3. **Đường lùi không rủi ro:** từ kỳ 07/12 chuyển Anthropic về mua cá nhân như nhóm kia. Lý do giống hôm
   08/10: đang miễn TNDN nên chi phí vào công ty không lợi đồng thuế nào, VAT trên hóa đơn Anthropic cũng
   không được khấu trừ.
4. **Dọn 4 tờ nhóm cá nhân còn nằm trên HQ** (Apple, Google, Render, Supabase — treo từ 09/10) và chuyển
   hoàn tạm ứng 4.107.563 đ. Bốn tờ này trả bằng thẻ công ty sau 01/07/2026 cho nhà cung cấp CHƯA đăng ký
   thuế. Còn nằm trong sổ công ty thì đúng diện phải nộp thay, không có đường miễn nào.
5. Thẻ "Thuế nhà thầu" trên tab Lịch thuế của HQ (`tax-calendar-section.tsx`) còn chữ theo luật cũ. Chưa sửa.

### Văn bản đã đọc 17/11/2026

| Văn bản | Đọc ở đâu | Lấy được gì |
|---|---|---|
| Thông tư 89/2026/TT-BTC, Điều 30, 31, 32 — nguyên văn | [thuvienphapluat.vn](https://thuvienphapluat.vn/van-ban/Thue-Phi-Le-Phi/Thong-tu-89-2026-TT-BTC-huong-dan-Luat-Quan-ly-thue-va-Nghi-dinh-252-2026-ND-CP-714011.aspx), mở bằng trình duyệt | Điều 30: nhà thầu nước ngoài, khai theo lần trả, được đăng ký khai tháng. Điều 31: nhà cung cấp nước ngoài tự khai trực tiếp hoặc qua ủy quyền. Điều 32: doanh nghiệp Việt Nam nộp thay theo khoản 3 Điều 43 thì hồ sơ theo điểm 17 Phụ lục I, nộp điện tử cho cơ quan thuế quản lý mình |
| Thông tư 90/2026/TT-BTC, Điều 4 khoản 2, Điều 7 khoản 6 và 8 — nguyên văn | [thuvienphapluat.vn](https://thuvienphapluat.vn/van-ban/Thue-Phi-Le-Phi/Thong-tu-90-2026-TT-BTC-dang-ky-thue-280130.aspx) | Điểm đ khoản 2 Điều 4: nhà cung cấp nước ngoài không phải đăng ký thuế nếu toàn bộ doanh thu đã được khấu trừ nộp thay. Điểm h.2: doanh nghiệp phương pháp khấu trừ nộp thay cho nhà cung cấp nước ngoài phải đăng ký. Khoản 6 Điều 7: mẫu 04.1-ĐKT. Khoản 8 Điều 7: nhà cung cấp nước ngoài đăng ký bằng mẫu 01/NCCNN |
| Mẫu 01/NTNN,NCCNN — qua bài hướng dẫn từng chỉ tiêu | [thuvienphapluat.vn](https://thuvienphapluat.vn/hoi-dap-phap-luat/huong-dan-lap-to-khai-01ntnn-nccn-ke-khai-thue-nha-thau-nuoc-ngoai-tt892026-138110452.html) | Phần I cho nhà thầu, Phần II cho nhà cung cấp nước ngoài (nhóm I) và cá nhân không cư trú (nhóm II). Bài này kết luận hạn khai theo lần là "ngày 20 tháng sau" — SAI so với Điều 10 Nghị định 252 mà chính bài trích (ngày thứ 10) |
| Công văn 5351/CT-CS ngày 29/07/2026, Cục Thuế gửi VCCI — nguyên văn | [thuvienphapluat.vn](https://thuvienphapluat.vn/cong-van/Doanh-nghiep/Cong-van-5351-CT-CS-2026-xu-ly-vuong-mac-doanh-nghiep-717674.aspx) | Nhà cung cấp nước ngoài trực tiếp kê khai thì tính thuế theo pháp luật GTGT và TNDN |
| Hỏi đáp Bộ Tài chính số 166088, trả lời của Thuế cơ sở 7 TP.HCM — nguyên văn (ảnh quét) | [portal.mof.gov.vn](https://portal.mof.gov.vn/hoidapcstc/home/cthoidap/166088) | Ca giống hệt Hubsell, trả lời không chốt |
| Công văn 7279/TNI-QLDN2 ngày 13/08/2026, Thuế tỉnh Tây Ninh — CHỈ đọc bài tóm tắt | [Crowe Việt Nam](https://www.crowe.com/vn/vi-vn/news/paying-fees-to-tiktok-must-enterprises-pay-fct-on-its-behalf) | Không phải nộp thay cho TikTok Pte. Ltd. nếu TikTok tự khai cho doanh thu thu từ doanh nghiệp và hóa đơn đã gồm thuế Việt Nam. Hóa đơn TikTok không được khấu trừ GTGT đầu vào. Phí được tính chi phí nếu hóa đơn đủ tên, địa chỉ, MST công ty + trả không dùng tiền mặt |
| Công văn 4176/KHH-QLDN3 ngày 05/08/2026, Thuế tỉnh Khánh Hòa — CHỈ đọc bài tóm tắt | [thue.man.net.vn](https://thue.man.net.vn/cong-van-4176/) | Nói về nhịp khai (theo lần / theo tháng) phí TikTok. Bài tóm tắt viết theo hướng doanh nghiệp vẫn nộp thay, không nhắc ngoại lệ tự khai |
| Điều khoản thương mại (mục H.2) và điều khoản người dùng của Anthropic | [commercial-terms](https://www.anthropic.com/legal/commercial-terms), [consumer-terms](https://www.anthropic.com/legal/consumer-terms) — đọc qua công cụ tóm tắt, câu trích bị cắt đoạn | Xem bảng căn cứ ở trên |
| Hóa đơn K2U9SLOU-0010, trang thanh toán claude.ai, Hóa đơn đầu vào + sổ quỹ HQ prod | Trình duyệt, chỉ đọc | Số liệu bảng tính ở trên. claude.ai không có hóa đơn nào sau 07/11/2026 |

Các văn bản đọc buổi sáng (Nghị định 252 Điều 40, 43–46; bộ 37 hỏi đáp Cục Thuế; Công văn 1063/CT-CS) nằm
ở mục "Thuế + sổ sách cho khoản Apple" trong `docs/APPLE-IAP-MUA-GOI-TRONG-APP.md`. Em không đọc lại.

### Chưa kiểm được

- Phụ lục I Thông tư 89 (mẫu 01/NTNN,NCCNN bản gốc): là tệp đính kèm phải tải về, em chưa tải.
- Nguyên văn hai công văn Tây Ninh và Khánh Hòa.
- Anthropic có thật sự khai TNDN cho doanh thu từ Hubsell không: chưa hỏi Anthropic.
- Anthropic còn trong danh sách cổng NCCNN hôm nay không (lần kiểm gần nhất 08/10/2026).
- Trang hóa đơn console Anthropic (API): chưa mở lại. HQ chỉ có một tờ API ngày 28/09/2026.
- Hóa đơn TikTok quảng cáo thật: pháp nhân nào, có dòng thuế gì. Khoản nạp 660.000 đ ngày 09/11 trả từ tài
  khoản nào em chưa thấy sao kê; chỉ biết sổ quỹ HQ không ghi.
- Mức phạt chậm nộp tờ khai và thời hạn cấp mã số thuế nộp thay cho tổ chức theo luật mới.

## ★ Chính sách Hubsell — anh Trung chốt tối 08/10/2026

| Nhóm NCC | Ai mua | Hóa đơn / thẻ | Sổ sách công ty | Thuế nhà thầu |
|---|---|---|---|---|
| **Chưa đăng ký thuế VN** (Render, Supabase, Vercel, Zoho, Apple, Google, Expo, GitHub…) | **Cá nhân** anh Trung | Tên Nguyen Trung Hieu, không MST, thẻ cá nhân | KHÔNG hoàn ứng, KHÔNG ghi sổ quỹ, KHÔNG nạp Hóa đơn đầu vào HQ | **Không khai 01/NTNN**, không đăng ký MST nộp thay (đã bỏ tờ 04.1-ĐK-TCT) |
| **Đã đăng ký thuế VN** (Anthropic API + Claude Max, Hostinger) | Công ty | CÔNG TY TNHH CÔNG NGHỆ HUBSELL + MST 0111626360, thẻ công ty | Ghi sổ quỹ, nạp Hóa đơn đầu vào như thường | Không khai thay — căn cứ cũ Điều 79 TT 80/2021 đã hết hiệu lực 01/07/2026; căn cứ mới + mức chắc xem mục "Rà lại theo luật mới — 17/11/2026" ở trên |

**Lý do:** NQ 198/2025/QH15 miễn thuế TNDN 3 năm cho DNNVV kể từ ngày cấp GCN lần đầu → Hubsell
miễn tới ~09/2029. Đưa chi phí ngoại vào công ty không giảm được đồng thuế nào, trong khi nộp thay
≈ 10,8% số đã trả (÷0,95÷0,95 − 1) là chi phí ròng, cộng thêm một tờ khai mỗi tháng và thủ tục xin
MST nộp thay. **Mốc đổi sang công ty:** khi gọi vốn hoặc doanh thu đủ lớn — khi đó phần "Nguyên
tắc" dưới đây là hướng dẫn sẵn.

**Đã làm đêm 08/10:** Render → tên Nguyen Trung Hieu, bỏ VAT number, thẻ cá nhân. Supabase → tên
cá nhân, xóa Tax ID, thẻ cá nhân. Vercel: tài khoản cá nhân gói miễn phí, không cần làm gì.
Anthropic: hóa đơn API XSX3Y4AB-0001 đã có VAT VN 10% + MST 9000020034 → giữ công ty.

**Thẻ công ty MB Visa 5692 đã lỡ trả cho nhóm cá nhân** → anh chuyển hoàn tạm ứng về TK công ty,
nội dung "Hoan tam ung", kế toán ghi tạm ứng giám đốc (không phải chi phí, không phát sinh thuế
nhà thầu):

| Khoản | Ngày trả | Số tiền |
|---|---|---|
| Render tháng 9 (HĐ GBLZFLHB-0003) | 02/10/2026 | 239.958 ₫ |
| Supabase Pro (HĐ CKOEAN-00002) | 27/09/2026 | 648.414 ₫ |
| Google Play phí đăng ký (PDS.8004-4011-1444-49513) | 01/10/2026 | 648.534 ₫ |
| Apple Developer Program (MD16509292) | 05/10/2026 | 2.570.657 ₫ |
| **Tổng hoàn tạm ứng** | | **4.107.563 ₫** |

**Dọn HQ (Kế toán → Hóa đơn đầu vào + Sổ quỹ), anh bấm tay 09/10:** xóa 4 tờ trên (nút Xóa
trên dòng, xác nhận → tự xóa phiếu chi liên kết; Supabase 27/09 nằm ở khoảng Quý 3); thêm phiếu
chi Mắt Bão 610.920 ₫ ngày 10/09/2026 (HĐ 45410, anh trả tiền cá nhân = chi hộ, khoản mục Phần
mềm & hạ tầng); sửa khoản THU 99.000 ₫ ngày 17/09/2026 (test payOS) khỏi doanh thu. Khoản THU
99.000 ₫ ngày 06/10 của Nguyễn Văn Hiển (gói Starter, HĐ 00000001) là doanh thu thật — giữ.

## Nguyên tắc (áp dụng khi NCC chưa đăng ký đứng tên công ty)

> Viết 08/10/2026 theo luật cũ. Từ 01/07/2026 đã đổi: mức thuế 10 % GTGT + 5 % TNDN, tờ khai tên
> 01/NTNN,NCCNN, mã số thuế nộp thay xin bằng mẫu 04.1-ĐKT, và nhà cung cấp đã đăng ký KHÔNG còn tự động
> được miễn khai thay. Bản đúng: mục "Rà lại theo luật mới — 17/11/2026" ở đầu tệp.

- Thuế nhà thầu phát sinh khi **công ty Việt Nam trả tiền dịch vụ cho NCC nước ngoài**. Tờ khai
  **01/NTNN** trên eTax, tách khỏi tờ GTGT / TNDN của chính công ty — nhưng **một tờ gom mọi NCC**,
  mỗi NCC một dòng trong bảng kê. Không phải mỗi NCC một tờ.
- NCC nước ngoài đã **đăng ký thuế trực tiếp** trên cổng NCCNN và tự khai nộp → bên mua Việt Nam
  **không khấu trừ, không khai thay** (Điều 79 Thông tư 80/2021/TT-BTC). Hóa đơn của họ sẽ có dòng
  thuế Việt Nam do họ thu.
- Phải dò đúng **pháp nhân ghi trên hóa đơn**, không dò tên thương hiệu: Apple có Apple Distribution
  International Ltd. trong danh sách nhưng hóa đơn Developer Program do **Apple Inc.** xuất; Google
  có Google Asia Pacific Pte Ltd nhưng phí Play do **Google LLC** xuất.
- Kỳ khai: từng lần (10 ngày kể từ ngày trả) hoặc đăng ký khai **theo tháng** (hạn ngày 20 tháng
  sau). Hubsell trả đều hàng tháng → khai theo tháng.
- Mức kê SaaS: 5% GTGT + 5% TNDN, gross-up `tiền đã trả ÷ 0,95 ÷ 0,95`. GTGT nộp thay không được
  khấu trừ (doanh thu Hubsell không chịu GTGT) → vào chi phí.

## Bảng NCC Hubsell đang trả tiền

| NCC (pháp nhân trên hóa đơn) | Dịch vụ · nhịp | Trong danh sách NCCNN? | Cách khai | Căn cứ đã kiểm |
|---|---|---|---|---|
| **Anthropic, PBC** | Claude API (HQ đọc hóa đơn) + Claude Max — hàng tháng | ✅ MST 9000020034, đăng ký 06/03/2026 | **Công ty mua · không khai thay (rà 17/11/2026, mức chắc vừa)** — phần GTGT có dòng thuế trên hóa đơn; phần TNDN dựa vào việc Anthropic tự khai, chưa có giấy xác nhận. Nếu bị bắt khai: 4 hóa đơn đã trả = 747.198 đ (chỉ TNDN) tới 2.241.592 đ (xấu nhất) | **17/11/2026:** mở lại hóa đơn 0010: "VAT – Vietnam (10%)" 22,22 USD, không có dòng TNDN. Điều khoản thương mại Anthropic mục H.2 giao thuế khấu trừ cho khách → hợp đồng không phải căn cứ miễn. Dòng 97 danh sách. ✅ Đã kiểm hóa đơn API XSX3Y4AB-0001 (28/09/2026): ghi "VAT Registration: Vietnam VAT 9000020034", thu VAT Việt Nam 10% ($0,56 trên $5), Bill to có VN TIN 0111626360. ✅ 09/11/2026 kiểm lại: tổ chức console đã đổi tên HUBSELL TECHNOLOGY CO., LTD. + địa chỉ công ty; hóa đơn Claude Ultra K2U9SLOU-0010 ngày 07/11/2026 (200 + VAT VN 10% 22,22 = 222,22 USD, thẻ công ty Visa 5692) ghi "Đến Cong Ty TNHH Cong Nghe Hubsell" |
| **Hostinger PTE Ltd.** | Tên miền hubsell.tech — 1 năm, hết hạn 16/07/2027 | ✅ MST 9000000302 (27/05/2022) | **Kỳ 2026 mua tài khoản cá nhân (anh nhớ, 09/11/2026) → không đưa lên HQ.** Gia hạn 2027: em đề nghị giữ cá nhân; đưa vào công ty thì phải có căn cứ Hostinger tự khai cho khoản đó như Anthropic (rà 17/11/2026) | RDAP: registrar HOSTINGER operations UAB (IANA 1636). Thư Hostinger 16/07/2026, hóa đơn H_47006397: 182.900 + 5.230 ICANN + **28.220 thuế** = 216.350₫ → Hostinger đã thu thuế VN. ⚠️ Chưa thấy PDF hóa đơn — kiểm pháp nhân ghi trên PDF đúng là Hostinger PTE Ltd. |
| **TikTok Pte. Ltd.** | Quảng cáo TikTok — chạy thử 09–13/11/2026, nạp 600.000 + 10 % thuế | ✅ MST 9000000084 (04/04/2022); ByteDance Pte. Ltd. 9000000655 | **Công ty CHƯA trả khoản nào (sổ quỹ HQ tới 17/11/2026 không có)** → chưa phát sinh. Tài khoản quảng cáo thuộc BC "CTY TNHH MOT MINH TAO", anh trả bằng quét mã. Nếu công ty trả về sau: áp như Anthropic | Công văn 7279/TNI-QLDN2 (Tây Ninh, 13/08/2026, đọc qua bài tóm tắt): không nộp thay nếu TikTok tự khai cho doanh thu đó + hóa đơn đã gồm thuế Việt Nam. ⚠️ Chưa xem hóa đơn TikTok thật |
| **Render** | Backend + worker SG — hàng tháng | ❌ | **Mua cá nhân · không khai** | Không có tên nào chứa "Render". 08/10 đã đổi billing tên cá nhân + thẻ cá nhân |
| **Supabase** | Database Pro — hàng tháng | ❌ | **Mua cá nhân · không khai** | Không có. 08/10 đã đổi tên cá nhân, xóa Tax ID, thẻ cá nhân |
| **Vercel** | Frontend app + landing — gói miễn phí | ❌ | **Mua cá nhân · không khai** | Không có. Tài khoản cá nhân, chưa trả tiền |
| **Cloudflare, Inc.** (Mỹ) | R2 — kho video đóng hàng; CHƯA đăng ký tài khoản (khảo sát 14/11/2026) | ❌ | **Mua cá nhân · không khai** | 14/11/2026 quét đủ 7 trang, 334 NCC: không tên nào chứa "Cloudflare". Điều khoản tự phục vụ mục 20: dịch vụ do Cloudflare, Inc., 101 Townsend St., San Francisco cung cấp, không nêu pháp nhân nào ở Việt Nam hay châu Á. Trang "Sales tax" của Cloudflare (cập nhật 29/05/2026) không có Việt Nam → hóa đơn không thu VAT Việt Nam. Khi đăng ký: tên Nguyen Trung Hieu, ô VAT/GST để trống, thẻ cá nhân. Chưa tra Cổng đăng ký doanh nghiệp quốc gia xem có công ty con / văn phòng đại diện nào không (không đổi kết luận: bên bán trên hóa đơn vẫn là Cloudflare, Inc.) |
| **Zoho** (Mail Lite) | dev@hubsell.vn — 12 USD/năm, gia hạn 19/09/2027 | ❌ | **Mua cá nhân · không khai** | Không có. Kỳ 2027 trả thẻ cá nhân |
| **Apple Inc.** | Apple Developer Program — 99 USD/năm, trả 05/10/2026 | ❌ (chỉ có Apple Distribution International Ltd., MST 9000000486) | **Mua cá nhân · không khai** | Thư Zoho 05/10 "Your Apple invoice #MD16509292": Sold To NGUYEN TRUNG HIEU, 99 USD, tax 0, chân thư "Apple Inc." Lỡ trả thẻ công ty 2.570.657₫ → hoàn tạm ứng |
| **Google LLC** | Phí nhà phát triển Google Play — 25 USD một lần, trả 01/10/2026 | ❌ (chỉ có Google Asia Pacific Pte Ltd, MST 9000000415) | **Mua cá nhân · không khai** | Thư Zoho 01/10 "Google: Cảm ơn bạn": Developer Registration Fee 25 USD, thuế 0, Google LLC, Mountain View. Lỡ trả thẻ công ty 648.534₫ → hoàn tạm ứng |
| Expo (EAS), GitHub | Build mobile, kho mã — gói miễn phí | ❌ | Khi trả tiền → cũng mua cá nhân | Chưa phát sinh |

NCC Việt Nam xuất hóa đơn GTGT thường, **không** thuộc thuế nhà thầu: MISA meInvoice, Mắt Bão
(hubsell.vn, hóa đơn số 45410 ngày 10/09/2026 đã đứng tên công ty + MST — anh trả tiền cá nhân →
phiếu chi "chi hộ"), payOS.

## Việc còn treo

1. ✅ Tên Anthropic đã là công ty (kiểm 09/11/2026). Mỗi tháng nạp hóa đơn Claude Ultra vào Hóa đơn đầu vào HQ + phiếu chi sổ quỹ; VAT 10% trên đó KHÔNG đưa vào [23] 01/GTGT (không phải hóa đơn điện tử VN). ✅ 09/11/2026 đã đặt Visa 5692 (thẻ công ty) làm mặc định trên claude.ai thay cho 9998 (thẻ đã trả các kỳ tên cá nhân). claude.ai không hiện tên trên từng thẻ; tên + MST trên hóa đơn lấy từ thông tin thanh toán của tài khoản (Bill to), không theo thẻ — 0009/0010 trả bằng 5692 đều đã ra tên công ty.
   Đối chiếu 09/11/2026 toàn bộ hóa đơn claude.ai: K2U9SLOU-0001 → 0007 (11/06 → 05/10/2026, Claude
   Pro → Max, cộng 533,97 USD) ghi Bill to "xwearhn@gmail.com's Organization", KHÔNG MST, trả Visa 9998
   → KHÔNG đưa lên HQ (không đủ căn cứ chi phí công ty). Từ 0008 (07/10) đứng tên công ty + MST:
   0008 đã có, 0009 (18/10, 100 USD extra usage, Visa 5692) + 0010 (07/11, 222,22 USD Ultra, Visa 5692)
   em up lên HQ 09/11, chờ anh duyệt. API XSX3Y4AB-0001 (28/09) đã ở quý 3.
   Đối chiếu sao kê MB 10/10→09/11 (09/11/2026): sửa số VND 0009/0010 theo số MB trừ thật
   (2.598.003 / 5.691.061) + 2 phiếu chi "Phí giao dịch thẻ Visa nước ngoài" (34.294 / 75.122, khoản
   mục Phí ngân hàng — MB tách dòng phí ≈1,32 %) + phiếu thu lãi 366. Quy tắc: khoản trả thẻ nước ngoài
   ghi ĐÚNG số VND trên sổ phụ, phí thẻ ghi dòng riêng, không ghi phiếu "chênh lệch" gộp.
   ⏳ Còn 157.602 lệch thuộc 23/09→09/10 — chờ sao kê đoạn đó.
2. ⏳ Anh chuyển hoàn tạm ứng 4.107.563₫ + dọn HQ (xem mục chính sách ở đầu).
3. ⏳ Hostinger: kiểm PDF hóa đơn ghi pháp nhân PTE Ltd. khi gia hạn 07/2027.
4. ⏳ 28/10/2026 kiểm Supabase + Render kỳ tới trừ đúng thẻ cá nhân; 05/09/2027 Zoho; 20/09/2027
   Apple — đều phải thẻ cá nhân, hóa đơn tên cá nhân.
5. Khi gọi vốn / doanh thu đủ lớn → mở lại: xin MST nộp thay (từ 01/07/2026 là mẫu 04.1-ĐKT, mã 10 số;
   mã thủ tục 1.008494 là số ghi 08/10, chưa kiểm còn đúng không), rồi tờ 01/NTNN,NCCNN (1.008333) trên
   dichvucong.gdt.gov.vn, đăng ký khai theo tháng.
6. ⏳ 17/11/2026 — chờ anh chốt 5 việc ở mục "Rà lại theo luật mới" (thư hỏi Anthropic · văn bản hỏi cơ quan
   thuế · có chuyển Anthropic về mua cá nhân từ kỳ 07/12 không · dọn 4 tờ nhóm cá nhân trên HQ + hoàn tạm
   ứng · sửa thẻ Lịch thuế).

### Tư liệu cũ (trước khi chốt 08/10, giữ để tham khảo)

- Apple 99 USD (05/10) và Google 25 USD (01/10): nếu công ty nhận chi phí thì hạn khai từng lần
  Google 11/10/2026, Apple 15/10/2026 → ĐÃ CHỐT để cá nhân, không khai.
- Supabase 648.414₫ trả 27/09 từng được coi là lần đầu phát sinh thuế nhà thầu (nộp thay ≈ 70.050₫:
  682.541 ÷0,95 = 718.464 ×5% GTGT + 682.541 ×5% TNDN) → ĐÃ CHỐT không khai, hoàn tạm ứng.
- Cổng mới dichvucong.gdt.gov.vn: form 01/NTNN có ô "Mã số thuế nộp thay" trống → công ty chưa có
  MST nộp thay 13 số, phải nộp 04.1-ĐK-TCT trước. Tờ khai cũ trên thuedientu.gdt.gov.vn không đăng
  ký được 01/NTNN (lỗi dòng 01/TTĐB NĐ 373/2025). Ký bằng plugin TCT SigningHub.

## Những tên khác trong danh sách có thể dùng sau

OpenAI (OpenAI, L.L.C. + OpenAI OpCo, LLC), Amazon Web Services Inc., DigitalOcean, GoDaddy,
Neon Commerce, Paddle, Canva, Adobe, Microsoft Regional Sales Pte Ltd, Meta Platforms Ireland,
TikTok Pte. Ltd., ByteDance Pte. Ltd., Shopee International XI, Midjourney, Eleven Labs, DeepL,
Zoom, Mixpanel, SEMrush, Ahrefs, Wix, Squarespace, Udemy. Chọn NCC trong nhóm này thì đỡ việc khai.

## Cách tra lại nhanh

Mở `https://etaxvn.gdt.gov.vn/nccnn` → "List of registered foreign providers" → bấm Search với ô
trống → 7 trang. Bảng nằm trong iframe; nếu nhờ Claude tra, script lấy `window.__nccnn` qua
`fetch` từng trang `pn=1..7` rồi lọc theo regex tên NCC (đã làm 08/10/2026).
