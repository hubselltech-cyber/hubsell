# THUẾ NHÀ THẦU — NCC NƯỚC NGOÀI NÀO PHẢI KHAI THAY

> Kết quả tra cứu ngày **08/10/2026** (Claude tra, anh Trung hỏi). Nguồn: cổng NCC nước ngoài của
> Tổng cục Thuế `https://etaxvn.gdt.gov.vn/nccnn` → mục **List of registered foreign providers** →
> để trống ô tìm, bấm Search → **322** NCC đã đăng ký (7 trang). Danh sách này đổi liên tục
> (mỗi tháng thêm vài chục tên) → **tra lại trước khi thêm NCC mới** hoặc mỗi đầu quý.

## ★ Chính sách Hubsell — anh Trung chốt tối 08/10/2026

| Nhóm NCC | Ai mua | Hóa đơn / thẻ | Sổ sách công ty | Thuế nhà thầu |
|---|---|---|---|---|
| **Chưa đăng ký thuế VN** (Render, Supabase, Vercel, Zoho, Apple, Google, Expo, GitHub…) | **Cá nhân** anh Trung | Tên Nguyen Trung Hieu, không MST, thẻ cá nhân | KHÔNG hoàn ứng, KHÔNG ghi sổ quỹ, KHÔNG nạp Hóa đơn đầu vào HQ | **Không khai 01/NTNN**, không đăng ký MST nộp thay (đã bỏ tờ 04.1-ĐK-TCT) |
| **Đã đăng ký thuế VN** (Anthropic API + Claude Max, Hostinger) | Công ty | CÔNG TY TNHH CÔNG NGHỆ HUBSELL + MST 0111626360, thẻ công ty | Ghi sổ quỹ, nạp Hóa đơn đầu vào như thường | Không khai thay (NCC tự nộp, Điều 79 TT 80/2021) |

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
| **Anthropic, PBC** | Claude API (HQ đọc hóa đơn) + Claude Max — hàng tháng | ✅ MST 9000020034, đăng ký 06/03/2026 | **Công ty mua · không khai thay** | Dòng 97 danh sách. ✅ Đã kiểm hóa đơn API XSX3Y4AB-0001 (28/09/2026): ghi "VAT Registration: Vietnam VAT 9000020034", thu VAT Việt Nam 10% ($0,56 trên $5), Bill to có VN TIN 0111626360. ⏳ Tên Bill to còn là "TRUNGHIEUMMO's Individual Org" → anh đổi thành CÔNG TY TNHH CÔNG NGHỆ HUBSELL trong console Anthropic (Settings → Organization) |
| **Hostinger PTE Ltd.** | Tên miền hubsell.tech — 1 năm, hết hạn 16/07/2027 | ✅ MST 9000000302 (27/05/2022) | **Công ty mua · không khai thay** | RDAP: registrar HOSTINGER operations UAB (IANA 1636). Thư Hostinger 16/07/2026, hóa đơn H_47006397: 182.900 + 5.230 ICANN + **28.220 thuế** = 216.350₫ → Hostinger đã thu thuế VN. ⚠️ Chưa thấy PDF hóa đơn — kiểm pháp nhân ghi trên PDF đúng là Hostinger PTE Ltd. |
| **Render** | Backend + worker SG — hàng tháng | ❌ | **Mua cá nhân · không khai** | Không có tên nào chứa "Render". 08/10 đã đổi billing tên cá nhân + thẻ cá nhân |
| **Supabase** | Database Pro — hàng tháng | ❌ | **Mua cá nhân · không khai** | Không có. 08/10 đã đổi tên cá nhân, xóa Tax ID, thẻ cá nhân |
| **Vercel** | Frontend app + landing — gói miễn phí | ❌ | **Mua cá nhân · không khai** | Không có. Tài khoản cá nhân, chưa trả tiền |
| **Zoho** (Mail Lite) | dev@hubsell.vn — 12 USD/năm, gia hạn 19/09/2027 | ❌ | **Mua cá nhân · không khai** | Không có. Kỳ 2027 trả thẻ cá nhân |
| **Apple Inc.** | Apple Developer Program — 99 USD/năm, trả 05/10/2026 | ❌ (chỉ có Apple Distribution International Ltd., MST 9000000486) | **Mua cá nhân · không khai** | Thư Zoho 05/10 "Your Apple invoice #MD16509292": Sold To NGUYEN TRUNG HIEU, 99 USD, tax 0, chân thư "Apple Inc." Lỡ trả thẻ công ty 2.570.657₫ → hoàn tạm ứng |
| **Google LLC** | Phí nhà phát triển Google Play — 25 USD một lần, trả 01/10/2026 | ❌ (chỉ có Google Asia Pacific Pte Ltd, MST 9000000415) | **Mua cá nhân · không khai** | Thư Zoho 01/10 "Google: Cảm ơn bạn": Developer Registration Fee 25 USD, thuế 0, Google LLC, Mountain View. Lỡ trả thẻ công ty 648.534₫ → hoàn tạm ứng |
| Expo (EAS), GitHub | Build mobile, kho mã — gói miễn phí | ❌ | Khi trả tiền → cũng mua cá nhân | Chưa phát sinh |

NCC Việt Nam xuất hóa đơn GTGT thường, **không** thuộc thuế nhà thầu: MISA meInvoice, Mắt Bão
(hubsell.vn, hóa đơn số 45410 ngày 10/09/2026 đã đứng tên công ty + MST — anh trả tiền cá nhân →
phiếu chi "chi hộ"), payOS.

## Việc còn treo

1. ⏳ Anh đổi tên tổ chức Anthropic sang CÔNG TY TNHH CÔNG NGHỆ HUBSELL (giữ MST, thẻ công ty).
2. ⏳ Anh chuyển hoàn tạm ứng 4.107.563₫ + dọn HQ (xem mục chính sách ở đầu).
3. ⏳ Hostinger: kiểm PDF hóa đơn ghi pháp nhân PTE Ltd. khi gia hạn 07/2027.
4. ⏳ 28/10/2026 kiểm Supabase + Render kỳ tới trừ đúng thẻ cá nhân; 05/09/2027 Zoho; 20/09/2027
   Apple — đều phải thẻ cá nhân, hóa đơn tên cá nhân.
5. Khi gọi vốn / doanh thu đủ lớn → mở lại: 04.1-ĐK-TCT xin MST nộp thay (thủ tục 1.008494), rồi
   01/NTNN (1.008333) trên dichvucong.gdt.gov.vn, đăng ký khai theo tháng.

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
