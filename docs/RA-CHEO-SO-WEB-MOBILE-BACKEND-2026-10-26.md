# Rà chéo số liệu web ↔ mobile ↔ backend — 26/10/2026

> Vì sao có tệp này: khách gửi ảnh tab Tài chính app (ảnh 11:43 26/10) hỏi "sao dữ liệu không khớp": thẻ Lợi nhuận ròng 107 k, bảng Lợi nhuận theo khoản 66.894 + 173.826, biên 24,3 % ở thẻ nhưng 19,7 % dưới thác nước. Gốc: dòng Lợi nhuận thực tế thật ra **−66.894** (Ads khi chưa có đơn đối soát) mà app in `Math.abs` mất dấu. Lỗi sống từ 03/10 qua 6 bản build. Anh Trung: "khách nào cũng kêu không đúng và bỏ đi không gia hạn gói" → rà toàn bộ số hiện ở 3 nơi trước build 1.4.1 (08:30 01/11).
>
> Cách rà: 4 agent đọc mã song song, mỗi agent một nhóm màn (Tài chính · Tổng quan · Quảng cáo · Đơn/Kho/Gói), liệt kê từng nhánh `if` hiển thị của web rồi đối chiếu mobile và backend theo 7 ca của [DUA-APP-LEN-CH-PLAY-APP-STORE.md mục 9](DUA-APP-LEN-CH-PLAY-APP-STORE.md). Tổng 65 điểm; dưới đây là điểm đã sửa, điểm để lại có lý do, và điểm chờ anh chốt.

## 1. Gốc lớn nhất — hai "Lợi nhuận ròng" khác công thức ở backend (ĐÃ SỬA)

Mobile xếp thẻ **Lợi nhuận ròng tạm tính** (`/api/finance/analytics` → `breakdown.profit.total`) ngay trên thác nước **Bóc tách dòng tiền** (`/api/analytics` → `netProfit`). Web cũng vậy ở Tổng quan (KPI Lợi nhuận đọc finance, thác nước đọc analytics). Hai endpoint cùng đọc sổ cái đơn nhưng lệch nhau đúng 3 khoản:

| Khoản | Báo cáo dòng tiền (thẻ) | Tổng quan (thác) trước 26/10 |
|---|---|---|
| Thu vận hành khác (đền bù, thưởng nhập tay) | **cộng** | không |
| Thuế bổ sung dự phòng (shop cài % ở Hóa đơn & Thuế) | **trừ** | không |
| Chi phí nhập tay khi **lọc một gian/sàn** | lọc theo `manualTxnScope` | lấy **cả shop** (cờ `operatingExpenseIsShopWide`) |

Phần đơn hai bên vốn bằng nhau: `profitAfterTax = platformRevenue − cost` (pnl-formula.ts:381) và `platformDeduction = revenueGross − platformRevenue` (order-ledger.ts:262).

**Sửa (backend, một đẳng thức cho cả hai):**
- `lib/net-profit.ts` `netProfitAfterProvision()` = LN gộp − phí sàn − chi phí vận hành − LN đơn thiếu vốn + thu khác − thuế dự phòng(LN trước thuế). Test `lib/__tests__/net-profit.test.ts` chứng minh bằng số với 3 đơn (có đơn thiếu vốn, đơn lỗ) rằng công thức Tổng quan = công thức Dòng tiền = 52.200 đ.
- `lib/channel-filter.ts` `manualTxnScope(req, scope)` dùng chung; `routes/finance.ts` bỏ bản chép tay; `routes/analytics.ts` áp cùng luật cho chi phí + thu nhập nhập tay, đọc `getShopTaxConfig`, trả thêm `operatingIncome`, `additionalTax`; `operatingExpenseIsShopWide` luôn `false` (giữ trường).
- Web `app/page.tsx` + mobile `FinancePage.tsx` thác nước thêm 2 bậc cuối: **Thu khác** (amount âm → vẽ "+" xanh) và **Thuế DP**; bậc = 0 chart tự bỏ.

⚠️ **Bản 1.4.0 đang trên App Store** gọi backend mới sẽ thấy thác "không đóng" (Σ bậc ≠ Lãi ròng) đúng bằng thu khác − thuế DP ở shop có hai khoản này — chỉ tới khi 1.4.1 lên. Chấp nhận: số Lãi ròng đúng quan trọng hơn thác đóng.

## 2. Đã sửa theo từng nhóm màn

### Tài chính (mobile)
| # | Lỗi | Sửa |
|---|---|---|
| 1 | Khoản con cột Lợi nhuận in `Math.abs` mất dấu (ảnh khách) | prop `signed`: "− đỏ / + xanh" (commit 27de220d) |
| 2 | Biên % trên thẻ cũng `Math.abs` (−25,7 % thành 25,7 %) | `BreakdownTile.pct` giữ dấu, chỉ pill ▲/▼ bỏ dấu |
| 3 | Thẻ in gọn "107 k" nhưng khoản con in đủ 106.932 ₫ | thẻ in **đủ** `formatMoney` + `adjustsFontSizeToFit` 70 % |
| 4 | % "Trợ giá sàn" (âm) mất dấu | % âm luôn có "−" ở mọi nhóm |
| 5 | Kỳ trống 9 dòng "− 0 ₫ 0,0%" | ≥ 2 dòng 0 → gom "N khoản khác" như web |
| 6 | Số đơn "(1234)" không nhóm nghìn, thiếu chữ đơn | "· 1.234 đơn" |
| 7 | Cột % cố định 44 px gãy dòng với "−6689,4%" | `min-w-[44px] shrink-0` |
| 8 | Bảng Tiền theo gian hàng không kéo số mới từ sàn (web có) | `refreshCashFlow()` POST rồi mới GET |
| 9 | `compactMoney` 999.950.000 → "1000 tr"; dấu "-" hyphen khác "−" của bậc | làm tròn trước rồi chọn đơn vị; dấu U+2212 |
| 10 | Chú thích thiếu vốn không nói % là biên | thêm câu "% mỗi dòng là biên lợi nhuận…" |

Web: `breakdown-card.tsx` % khoản con đổi từ "12.34%" sang `fmtPct` "12,3%" (cùng cách viết với share/delta và app).

### Tổng quan (mobile)
| # | Lỗi | Sửa |
|---|---|---|
| 1 | Tỷ trọng kênh bỏ Offline / gian đã xoá → tâm donut + % lệch web | thêm kênh ngoài 3 sàn có tiền, nhãn Offline/Khác |
| 2 | Hôm qua tải hỏng → `prev = 0` → pill "▲ mới" sai | `prev = null` → `DeltaPill` ẩn |
| 3 | Tổng "Nhịp lãi 14 ngày" luôn xanh và khác định nghĩa với số Lợi nhuận ngay trên | **bỏ số tổng** (web không có), sparkline đổi màu theo dấu lợi nhuận hôm nay, 14 ngày bằng nhau thì không vẽ |
| 4 | % ▲/▼ ≥ 100 làm tròn nguyên ("150%" vs web "150,4%") | luôn 1 số lẻ |
| 5 | % kênh làm tròn nguyên (33+33+33 = 99) | 1 số lẻ như web |
| 6 | "Chưa có đơn" theo doanh thu ≤ 0 (đơn quà 0 ₫ bị coi chưa có) | theo số đơn như web |
| 7 | Số đếm thô 1234 | `groupVN` khắp trang |
| 8 | Thẻ đơn hoàn đếm mọi ngày, cạnh phễu đếm hôm nay | nhãn "(mọi ngày)" |

### Quảng cáo (mobile)
| # | Lỗi | Sửa |
|---|---|---|
| 1 | Video TikTok: "Tất cả" đếm cả video 0 ₫ + đã loại (web chỉ video đang tiêu) | `spending = cost > 0 && !excluded`, danh sách mặc định = spending |
| 2 | "Cần xem" chỉ `flag` (web: flag + grace + protected) | `needsReview` như web |
| 3 | Hòa vốn "Lỗ sẵn" / "Chưa tin được" biến thành "—" | `fmtBreakeven()` + `isLosingCampaign()` trong `lib/tiktok-ads.ts`, dùng ở thẻ, hộp, đầu màn video |
| 4 | Màu ROI TikTok: xanh dù dưới mục tiêu; hộp lại đỏ | đỏ khi dưới mục tiêu hoặc đang lỗ, còn lại trung tính (như web) |
| 5 | Shopee ROAS thiếu vùng vàng sát hòa vốn (< 1,1×) | `roasTone` red/amber/emerald |
| 6 | "Cần xử lý" Shopee thiếu `grace` | FLAGGED thêm grace |
| 7 | ROAS "3,00x" (web "3x") | bỏ số 0 thừa |
| 8 | Biên lãi TikTok làm tròn nguyên | 1 số lẻ |
| 9 | Cắt ngân sách từ không giới hạn in "0 ₫ →" | "không giới hạn →" |
| 10 | "Nên chạy" cộng cả "Chạy thử" | chỉ bậc run |
| 11 | Lãi giữ ở nấc kế in 2 lần, 2 cách làm tròn | bỏ dòng lặp |
| 12 | CPA video / giá SP gợi ý in gọn | in đủ |
| 13 | Số đếm thô | `groupVN` |

### Đơn hàng · Kho · Hoàn
| # | Lỗi | Sửa |
|---|---|---|
| 1 | Tồn kho đỏ chỉ khi tồn = 0 (web: tồn − giữ ≤ 0) | cùng luật web; "Hết hàng · giữ N" |
| 2 | Nhập vào vị trí "không bán" báo "10 → 15" rồi lưu xong vẫn 10 | vị trí không bán: tồn bán không đổi, nút "…kho chờ kiểm — tồn bán giữ N" |
| 3 | Đầu danh sách đơn luôn in tổng mọi trạng thái | số của bộ lọc đang xem + "khớp bộ lọc" |
| 4 | Trạng thái hoàn 3 nơi 3 tên; web /orders thiếu WRITTEN_OFF | thống nhất: Chờ hàng về · Đã nhận · chờ nhập kho · Hàng hỏng · chờ khiếu nại sàn · Đã được đền bù · Hao hụt / xóa sổ (app `labels.ts`, web 2 trang) |
| 5 | Mã vận đơn chiều đi bị gọi "VĐ hoàn" | chỉ gọi VĐ hoàn khi có mã hoàn |
| 6 | Hạn khách xin hủy: web `Math.round` → quá hạn 1–29 phút vẫn "còn dưới 1 giờ" | web cùng nấc với app (phút / giờ / ngày / quá hạn) |
| 7 | Thẻ đơn không có "Chưa thanh toán" (web có) | thêm `paymentStatus` vào thẻ |
| 8 | Chi tiết đơn dòng đậm là tiền hàng ≠ tổng tiền trên thẻ | dòng đậm = Tổng tiền đơn; tiền hàng là dòng phụ |
| 9 | "N sản phẩm" nhưng đếm SKU phẳng (web "N sản phẩm · M SKU") | "N SKU" |
| 10 | "chờ N ngày" cho hàng đã về (backend trả số ngày đi đường) | "về sau N ngày" |

## 3. Để lại có lý do (không sửa)
- **Viết gọn tiền trên thẻ chỉ số Tổng quan / Quảng cáo / donut / thác nước** ("45,6 tr") — điện thoại không đủ chỗ, anh chốt từ 13/08; chỉ thẻ Tài chính 2×2 đổi sang số đủ vì khoản con ngay dưới in đủ.
- **Giá gói trên iPhone = giá Apple StoreKit** (299.000 ₫) khác bảng giá web (290.000 ₫): bậc giá Apple, không đổi được — ghi nhận, nên ghi một câu ở trang gói web khi có dịp.
- **Chuỗi "lãi/ngày" 14 ngày** (sparkline) vẫn không có thu khác / thuế dự phòng (hai khoản không theo ngày) — đã bỏ số tổng nên không còn chỗ so.
- **Nhãn 320 px**: agent ước lượng hero Tổng quan hai cột 28 px có thể gãy chữ với "−123,5 tr" — chưa đo trên máy; nằm trong checklist mục 9 trước build.
- Ngưỡng "quá 14 ngày" ghi cứng trên app (web đọc `thresholds`) — bằng nhau hôm nay; đổi hằng số backend thì sửa cả hai.
- Lint `expo lint` còn 38 lỗi baseline (react-compiler set-state-in-effect, no-unescaped-entities) ở các dòng không thuộc lượt sửa này.

## 4. Chờ anh chốt
1. **Kỳ mặc định tab Tài chính mobile = Hôm nay**, web Báo cáo dòng tiền = 30 ngày. Khách mở hai bên không đụng bộ lọc sẽ thấy 4 thẻ khác hẳn. Đề xuất: mobile cũng 30 ngày (Tổng quan vẫn hôm nay).
2. **Shopee Quảng cáo mobile mặc định Hôm nay**, web 7 ngày (anh chốt 04/10). Cùng hiện tượng.
3. **Đổi ngưỡng cảnh báo tab "Cần xử lý" Shopee**: nay app = web (bỏ đếm chiến dịch Hubsell đã tự dừng/cắt). Nếu anh muốn giữ "đã ra tay" trong tab thì đổi lại cả web.

## 5. Kiểm
- `npx tsc --noEmit` sạch: backend, frontend, hubsell-mobile.
- `vitest run src/lib` backend: 25 tệp, 223 test qua (có `net-profit.test.ts` mới).
- Chưa chạy app thật (Expo Go) và chưa mở web dev — checklist mục 9 chạy trước build 01/11.
