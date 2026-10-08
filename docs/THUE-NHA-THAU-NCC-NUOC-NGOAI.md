# THUẾ NHÀ THẦU — NCC NƯỚC NGOÀI NÀO PHẢI KHAI THAY

> Kết quả tra cứu ngày **08/10/2026** (Claude tra, anh Trung hỏi). Nguồn: cổng NCC nước ngoài của
> Tổng cục Thuế `https://etaxvn.gdt.gov.vn/nccnn` → mục **List of registered foreign providers** →
> để trống ô tìm, bấm Search → **322** NCC đã đăng ký (7 trang). Danh sách này đổi liên tục
> (mỗi tháng thêm vài chục tên) → **tra lại trước khi thêm NCC mới** hoặc mỗi đầu quý.

## Nguyên tắc

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
| **Anthropic, PBC** | Claude Max — hàng tháng | ✅ MST 9000020034, đăng ký 06/03/2026 | **Không khai thay** | Dòng 97 danh sách. Hóa đơn Claude phải có dòng thuế VN — chỉ lưu invoice |
| **Hostinger PTE Ltd.** | Tên miền hubsell.tech — 1 năm, hết hạn 16/07/2027 | ✅ MST 9000000302 (27/05/2022) | **Không khai thay** | RDAP: registrar HOSTINGER operations UAB (IANA 1636). Thư Hostinger 16/07/2026, hóa đơn H_47006397: 182.900 + 5.230 ICANN + **28.220 thuế** = 216.350₫ → Hostinger đã thu thuế VN. ⚠️ Chưa thấy PDF hóa đơn — kiểm pháp nhân ghi trên PDF đúng là Hostinger PTE Ltd. |
| **Render** | Backend + worker SG — hàng tháng | ❌ | Khai 01/NTNN + nộp thay | Không có tên nào chứa "Render" |
| **Supabase** | Database Pro — hàng tháng | ❌ | Khai 01/NTNN + nộp thay | Không có |
| **Vercel** | Frontend app + landing — hàng tháng | ❌ | Khai 01/NTNN + nộp thay | Không có |
| **Zoho** (Mail Lite) | dev@hubsell.vn — 12 USD/năm, gia hạn 19/09/2027 | ❌ | Khai 01/NTNN + nộp thay | Không có |
| **Apple Inc.** | Apple Developer Program — 99 USD/năm, trả 05/10/2026 | ❌ (chỉ có Apple Distribution International Ltd., MST 9000000486) | Khai 01/NTNN + nộp thay | Thư Zoho 05/10 "Your Apple invoice #MD16509292": Sold To NGUYEN TRUNG HIEU, 99 USD, tax 0, chân thư "Apple Inc." Hóa đơn đứng tên **cá nhân** |
| **Google LLC** | Phí nhà phát triển Google Play — 25 USD một lần, trả 01/10/2026 | ❌ (chỉ có Google Asia Pacific Pte Ltd, MST 9000000415) | Khai 01/NTNN + nộp thay | Thư Zoho 01/10 "Google: Cảm ơn bạn": Developer Registration Fee 25 USD, thuế 0, Google LLC, Mountain View |
| Expo (EAS), GitHub | Build mobile, kho mã — gói miễn phí | ❌ | Khi bắt đầu trả tiền → khai thay | Chưa phát sinh |

NCC Việt Nam xuất hóa đơn GTGT thường, **không** thuộc thuế nhà thầu: MISA meInvoice, Mắt Bão
(hubsell.vn, hóa đơn số 45410 ngày 10/09/2026 đã đứng tên công ty + MST), payOS.

## Việc anh Trung cần quyết / làm

1. **Apple 99 USD (05/10) và Google 25 USD (01/10) đang đứng tên cá nhân, trả thẻ cá nhân.** Nếu
   công ty nhận hai khoản này làm chi phí (hoàn ứng) thì phát sinh thuế nhà thầu ngay, hạn khai
   từng lần: Google **11/10/2026**, Apple **15/10/2026**. Nếu để là chi cá nhân thì không khai nhưng
   cũng không được tính chi phí. Em nghiêng về: để cá nhân cho đợt này (số nhỏ, hồ sơ chưa gọn),
   từ kỳ gia hạn sau đổi billing sang tên công ty rồi khai đúng nhịp.
2. Render / Supabase / Vercel / Zoho: lần trả đầu tiên **đứng tên công ty** là mốc bắt đầu nghĩa vụ
   → trước đó phải sửa billing (bước "Sửa billing các NCC ngoại" ở tab Lịch thuế). Ngay kỳ đầu
   nộp kèm đăng ký khai theo tháng.
3. Kiểm hai hóa đơn PDF: Claude (có dòng thuế VN chưa?) và Hostinger (pháp nhân PTE Ltd.?). Nếu
   hóa đơn Claude KHÔNG có dòng thuế VN → hỏi Anthropic billing vì họ đã đăng ký từ 06/03/2026.

## Những tên khác trong danh sách có thể dùng sau

OpenAI (OpenAI, L.L.C. + OpenAI OpCo, LLC), Amazon Web Services Inc., DigitalOcean, GoDaddy,
Neon Commerce, Paddle, Canva, Adobe, Microsoft Regional Sales Pte Ltd, Meta Platforms Ireland,
TikTok Pte. Ltd., ByteDance Pte. Ltd., Shopee International XI, Midjourney, Eleven Labs, DeepL,
Zoom, Mixpanel, SEMrush, Ahrefs, Wix, Squarespace, Udemy. Chọn NCC trong nhóm này thì đỡ việc khai.

## Cách tra lại nhanh

Mở `https://etaxvn.gdt.gov.vn/nccnn` → "List of registered foreign providers" → bấm Search với ô
trống → 7 trang. Bảng nằm trong iframe; nếu nhờ Claude tra, script lấy `window.__nccnn` qua
`fetch` từng trang `pn=1..7` rồi lọc theo regex tên NCC (đã làm 08/10/2026).
