# Sản phẩm trên sàn — thiết kế lại (khảo sát 05/11/2026; cả 4 lát ĐÃ LÀM trên local — mục 12 + 13, chưa push)

> Anh Trung 05/11: "Phần sản phẩm sàn đang quá rối. Cần phương án chuyên nghiệp hơn, khảo sát trong và ngoài nước. Suy nghĩ kỹ việc
> nối sản phẩm sàn vào kho tổng hay làm ngược lại thì hợp lý. Đặc biệt quan tâm trải nghiệm và thao tác của khách."
> Mục 0–11 là bản khảo sát + thiết kế; **mục 12 là phần đã làm** (anh bảo làm hết trên local, em tự quyết 5 câu mục 10). Đọc mục 0 rồi mục 12. **Mục 13 (anh chốt lại): trang CHỈ NỐI, đã gỡ mọi đường "Đưa vào kho" / "Tạo SKU" — mục 13 thắng các mục trước.**
> Nguyên tắc nền (docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 0): Tổng kho = hàng của mình, SKU chuẩn là tài sản; nối gian là việc của khách.

## 0. Kết luận một phút

1. **Hướng nối: kho là mỏ neo, sàn là hàng đợi.** Mọi nền tảng khảo sát (Sellbrite, Linnworks, Shopify Marketplace Connect, BigSeller,
   Sapo, UpBase) đều làm cùng một kiểu: *danh sách việc* là các listing trên sàn chưa nối, *đích* là sản phẩm kho. Không ai bắt khách
   đứng từ kho đi tìm từng listing. Lý do: thứ "sai" là listing (chưa biết nó là hàng nào), thứ "đúng" là kho. Hubsell đang đúng
   hướng này; cái rối không nằm ở hướng mà ở **cách bày việc**.
2. **Việc thật của khách không phải "nối" mà là ba việc khác nhau**, hiện bị trộn vào một bảng: (a) *đưa hàng sàn vào kho lần đầu*
   (shop anh: 2.036/2.419 chưa nối → đây là việc chính, làm theo LÔ, không thể gõ từng dòng); (b) *nối một sản phẩm lẻ* khi
   mã không khớp (việc hiếm, cần một hộp chọn tốt); (c) *dọn rác* (1.155 listing "sàn đã gỡ" đang nằm lẫn trong hàng đợi và không
   bao giờ cần nối).
3. **Màn hình mới**: bảng **theo sản phẩm sàn, mỗi sản phẩm một dòng, không bung sẵn**; mỗi dòng một chip trạng thái và MỘT nút
   chính theo trạng thái; nối chi tiết làm trong **ngăn kéo** bên phải (phân loại sàn ↔ SKU kho); tạo vào kho theo lô có **bảng rà
   mã** trước khi tạo; listing sàn đã gỡ **ẩn mặc định**; sản phẩm không muốn quản lý có nút **Bỏ qua**. Bỏ ô gõ mã + 2 nút trên
   từng phân loại, bỏ bung sẵn mọi dòng, bỏ 5 chip + 2 select + ô tìm chen một hàng.
4. **Tự khớp vẫn chỉ trùng mã chính xác** (luật anh chốt, memory `feedback-khach-phai-dat-sku-giong-nhau`); học Sapo thêm *chế độ an
   toàn*: mã sàn trùng với nhiều SKU kho hoặc nhiều listing cùng mã → không tự nối, đưa vào nhóm "Cần rà".

## 1. Vì sao trang hiện tại rối (mổ xẻ ảnh anh gửi)

| # | Thấy gì | Vì sao gây rối |
| --- | --- | --- |
| 1 | Hai câu dẫn (dòng đèn + "Sản phẩm thô kéo từ…") trước khi tới việc | Hai lần giải thích, không câu nào nói "anh cần làm gì bây giờ". |
| 2 | Hàng lọc: 5 chip đếm + 2 select + ô tìm, chen một hàng | 5 chip là 2 chiều khác nhau (nối / trạng thái sàn) đặt cạnh nhau như một dãy. |
| 3 | Mọi sản phẩm **bung sẵn** mọi phân loại | 2.419 sản phẩm × ~3 phân loại = bảng dài vô tận; mắt không tìm được "sản phẩm" nữa, chỉ thấy dòng. |
| 4 | Mỗi phân loại một **ô gõ mã** + nút **Nối** + nút **Tìm** | 3 điều khiển × hàng nghìn dòng. Gõ mã là thao tác của người đã thuộc mã kho — khách mới không thuộc. |
| 5 | Dòng đã nối lại có 2 nút khác (**Đổi**, **Gỡ nối**) | Bốn kiểu nút cùng một cột, tùy dòng — không học được quy luật. |
| 6 | Nút "Tạo SKU kho (2)" ở dòng cha, nằm trong cột "Mã SKU Tổng kho" | Hành động quan trọng nhất của khách mới bị giấu trong một ô bảng. |
| 7 | Hai nút lớn "Tự khớp + tạo SKU" (đen) và "Đồng bộ từ sàn" (xanh) ngang hàng | Một cái là việc nguy hiểm (tạo hàng loạt), một cái là việc phụ (kéo lại danh mục) — cùng cỡ, cùng tầm mắt. |
| 8 | "Sàn đã gỡ 1.155" nằm lẫn trong "Chưa liên kết 2.036" | Khoảng một nửa hàng đợi là rác; khách tưởng mình còn 2.036 việc. |
| 9 | Không có "Bỏ qua" | Quà tặng 0 đ, combo, mẫu thử… khách không muốn quản tồn vẫn đếm là "chưa nối" mãi mãi. |
| 10 | Đích của liên kết là *mã* chứ không phải *sản phẩm kho* | Khách phải nghĩ bằng mã; hộp chọn theo tên có nhưng là nút phụ "Tìm". |
| 11 | Không có bước xác nhận cho việc hàng loạt | "Tự khớp + tạo SKU" tạo 2.000 SKU một phát, mã lấy nguyên từ sàn kể cả mã lỏng — ngược với mục 0 QUAN-LY-KHO. |

Kết luận: trang được thiết kế cho **một người thuộc mã, nối tay từng dòng** (khách 22/10 xin "kiểu Salework"). Khách đó có thật nhưng là
thiểu số; đa số (như shop anh) đứng trước 2.000 listing chưa nối và cần đưa hàng vào kho theo lô.

## 2. Số liệu shop anh (ảnh 05/11) nói gì

| Số | Ý nghĩa |
| --- | --- |
| 2.419 sản phẩm sàn, **2.036 chưa nối (84 %)** | Việc chính là nhập kho lần đầu theo lô, không phải nối lẻ. |
| 383 đã nối | Nối tay/khớp mã đã chạy một phần — những cái này là chuẩn để học. |
| **1.155 "sàn đã gỡ" (48 %)** | Gần nửa bảng là listing không còn bán. Mặc định phải ẩn khỏi hàng đợi; chỉ hiện khi khách cố ý lọc. |
| Túi TUI002: 3 phân loại, nối 1/3 | Có ca *nối một phần* — trạng thái cần tách riêng, vì tồn sẽ đẩy lệch giữa các màu. |
| Thắt lưng TLN009-B / TLN013-B: mã sàn chuẩn, 4/4 chưa nối | Mã có, kho chưa có → "Đưa vào Tổng kho" một bấm là đúng việc, không cần gõ gì. |

→ Trước khi code lát 1 nên chạy SQL prod (chỉ đọc) đếm trên toàn bộ khách: tỷ lệ chưa nối, tỷ lệ delisted, tỷ lệ listing có mã sàn
hợp lệ vs mã máy/trống, tỷ lệ nối một phần. Số này quyết định ưu tiên lát 2 (tạo theo lô) có đáng làm trước không.

## 3. Khảo sát: người khác bày việc thế nào

| Nền tảng | Đơn vị việc | Tự khớp | Nối tay từ phía nào | Tạo mới từ listing | Trùng / thiếu mã | Điểm đáng học |
| --- | --- | --- | --- | --- | --- | --- |
| **Sellbrite** (US) | Listing trên sàn; lọc "Unlinked" | Theo SKU khi import | Từ listing: "Find & Link Product" → hộp tìm theo SKU/tên | "Build product" chỉ khi kho chưa có | Mã khác nhau → nối tay; cảnh báo import tạo trùng | Một nút trên listing, hộp tìm theo tên; khuyên sửa mã sàn cho trùng |
| **Linnworks** (UK) | Channel Mapping: listing trái, kho phải, đếm Linked/Unlinked | "Link All by SKU" | Chọn listing → nút Link | "Create All" cho listing không có hàng kho | Đổi SKU phải gỡ nối rồi nối lại | Đếm rõ hai số; tạo-tất-cả cho phần còn lại |
| **Shopify Marketplace Connect** | Listing, chia 3 nhóm **Ready to list / Close match / No match** | SKU, UPC, tên | Dropdown "Shopify SKU" ngay trên dòng → "Confirm match" | Không (phải có SP Shopify) | Close match phải duyệt | **Nhóm theo độ chắc + "Approve all" + "Review matches" trước khi link** — luồng duyệt theo lô tốt nhất |
| **BigSeller** (SEA) | Merchant SKU (kho) ↔ Store SKU (sàn); lọc Unmapped | "Auto Mapping" trùng tên mã, không phân biệt hoa thường, có luật tiền/hậu tố | Màn "By Product" chọn từng cái; import Excel | "Auto Create Merchant SKUs" khi đơn về mang mã lạ | Đổi tên mã sàn = đứt nối | Hai khái niệm mã rất rõ; tạo mã kho từ đơn về |
| **Sapo** (VN) | Sản phẩm sàn | Theo SKU; **chế độ an toàn** chỉ nối SKU duy nhất | Từ sản phẩm sàn; **nối ngay trên màn đơn hàng** chưa mapping | Tạo SP Sapo từ sàn, nối đúng listing nguồn | **Tab "Sản phẩm trùng SKU"** để rà tay; có lịch sử liên kết | Trùng mã không tự nối; nối tại đơn hàng; log |
| **UpBase** (VN) | Sản phẩm sàn | — | Từ sản phẩm sàn | "Tạo sản phẩm kho" từng cái và **hàng loạt** | Lọc đã/chưa liên kết kho | Tạo kho hàng loạt từ sàn là hành động hạng nhất |
| **Salework** (VN, mẫu 22/10) | Phân loại sàn | — | Ô gõ mã kho trên từng phân loại | Tạo SP kho cho cả sản phẩm | — | Nhanh cho người thuộc mã; chính là bản Hubsell đang có |

Ba điều rút ra: (1) **không ai nối từ kho ra sàn làm luồng chính**, nhưng ai cũng cho tạo kho từ sàn hàng loạt; (2) nền tảng tốt nhất
(Shopify) không bắt người dùng gõ gì — *máy đề xuất, người duyệt theo lô, có bước xem lại trước khi áp*; (3) VN (Sapo) coi trùng mã là
ca phải rà tay, không tự quyết.

## 4. Trả lời câu hỏi lớn: nối sàn → kho hay kho → sàn?

**Cả hai chiều phải có, nhưng không ngang hàng:**

| | Sàn → kho (hàng đợi) | Kho → sàn (đường phụ) |
| --- | --- | --- |
| Ai dùng | Khách mới, khách vừa đăng hàng mới trên sàn, khách dọn listing | Khách đã có kho chuẩn, đang đứng ở một SKU và hỏi "nó bán ở gian nào?" |
| Câu hỏi | "Listing này là hàng nào trong kho?" | "SKU này đang nối những listing nào, còn thiếu gian nào?" |
| Vì sao là chính | Listing là thứ *chưa biết danh tính* → phải có người gán. Hàng đợi tự nhiên là tập listing chưa nối. | SKU kho đã biết danh tính; từ kho đi tìm listing là đi tìm kim trong 2.419 cái. |
| Chỗ đặt | Trang **Sản phẩm trên sàn** | Tổng kho › dòng SKU › "Bán trên" / "Nối gian" (đã có, giữ) |

Năm nguyên tắc thiết kế rút từ đó:
1. **Đơn vị việc là SẢN PHẨM sàn, không phải phân loại.** Phân loại chỉ hiện khi mở sản phẩm.
2. **Đích là SẢN PHẨM KHO (tên + mã), không phải mã.** Khách chọn bằng tìm tên/mã; máy ghép phân loại theo mã, khách sửa chỗ lệch.
3. **Mỗi trạng thái một hành động chính.** Chưa nối → "Nối" hoặc "Đưa vào Tổng kho"; nối một phần → "Nối nốt"; đã nối → không nút, chỉ ⋯.
4. **Việc hàng loạt phải có bước xem lại.** Tự khớp và Tạo theo lô đều hiện bảng kết quả dự kiến → khách duyệt → áp.
5. **Rác không nằm trong hàng đợi.** Sàn đã gỡ và Bỏ qua ẩn mặc định, có số đếm riêng để tìm lại.

## 5. Mô hình trạng thái một sản phẩm sàn

```
            ┌────────────┐  tất cả phân loại đã nối   ┌──────────┐
   kéo về → │  CHƯA NỐI  │ ─────────────────────────→ │  ĐÃ NỐI  │
            └────────────┘                            └──────────┘
                 │  nối 1..n-1 phân loại                   ▲
                 ▼                                         │ nối nốt
            ┌──────────────┐ ──────────────────────────────┘
            │ NỐI MỘT PHẦN │   (cảnh báo: tồn các màu còn lại không đẩy)
            └──────────────┘
   Cờ chéo (độc lập với trên): SÀN ĐÃ GỠ (listing không còn trên sàn) · BỎ QUA (khách không quản tồn món này)
```

- Hàng đợi mặc định = CHƯA NỐI + NỐI MỘT PHẦN, **không** gồm Sàn đã gỡ / Bỏ qua.
- "Bỏ qua" là cột mới `ChannelProduct.ignoredAt` (hoặc cờ ở cấp sản phẩm sàn); bỏ qua rồi vẫn nhận đơn, chỉ không đếm là việc.
- Số đếm trên dải tóm tắt: **Cần nối N** (hàng đợi) · Đã nối M · Sàn đã gỡ K · Bỏ qua J.

## 6. Màn hình mới

### 6.1 Khung trang

```
Sản phẩm trên sàn                                                   [Lấy sản phẩm mới từ sàn]
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Cần nối 881 ●   Đã nối 383   Sàn đã gỡ 1.155   Bỏ qua 0        [Mọi sàn ▾] [Mọi gian ▾] [Tìm… ] │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
 Đã chọn 0   [Tự khớp mã trùng]  [Đưa vào Tổng kho…]  [Bỏ qua]                  ← thanh hàng loạt, hiện khi tick
┌────┬──────────────────────────────────────┬──────────┬────────────┬───────────────┬────────────────┐
│ ☐  │ Sản phẩm trên sàn                    │ Phân loại│ Giá · Tồn  │ Trạng thái    │                │
├────┼──────────────────────────────────────┼──────────┼────────────┼───────────────┼────────────────┤
│ ☐  │ ▸ [ảnh] Túi đeo chéo nam… TUI002     │ 3        │ 230.000 · 0│ ● Nối 1/3     │ [Nối nốt]   ⋯  │
│    │   Shopee · DarkMan Store · 2859702393│          │            │               │                │
│ ☐  │ ▸ [ảnh] Thắt lưng da nam… TLN009     │ 4        │ 110.000·39 │ ○ Chưa nối    │ [Đưa vào kho] ⋯│
│ ☐  │ ▸ [ảnh] Áo thun cotton… (mã máy)     │ 2        │ 135.000 · 7│ ○ Chưa nối    │ [Nối]        ⋯ │
└────┴──────────────────────────────────────┴──────────┴────────────┴───────────────┴────────────────┘
```

- **Một dòng = một sản phẩm sàn, thu gọn.** Bấm ▸ mới bung phân loại (chỉ đọc: tên phân loại, mã sàn, tồn sàn, mã kho đã nối).
- **Nút chính đổi theo ngữ cảnh**: mã sàn hợp lệ & kho chưa có → **Đưa vào kho** (tạo + nối, một bấm, không gõ); mã sàn trùng SKU kho
  có sẵn → **Nối** (một bấm, vì chắc); mã máy / trống → **Nối** mở ngăn kéo; nối một phần → **Nối nốt**; đã nối → chỉ ⋯ (Gỡ nối, Đổi).
- Menu ⋯: Mở ngăn kéo, Bỏ qua / Bỏ cờ bỏ qua, Xem trên sàn, Gỡ nối.
- Hai nút lớn hiện tại bỏ: "Đồng bộ từ sàn" thành nút phụ góc phải (đổi tên **Lấy sản phẩm mới từ sàn**, đúng chữ bên Sao chép);
  "Tự khớp + tạo SKU" tách làm hai hành động hàng loạt có bước xem lại (6.3, 6.4).
- Lọc: dải số là bộ lọc (bấm số = lọc), còn lại chỉ 2 select + 1 ô tìm. Chip "Đang bán trên sàn" bỏ (đã là mặc định khi ẩn Sàn đã gỡ).

### 6.2 Ngăn kéo "Nối sản phẩm" (drawer phải, ~560px)

```
┌ Nối: Túi đeo chéo nam chống nước… (Shopee · DarkMan Store) ───────────────────────── ✕ ┐
│ Hàng kho:  [🔍 Tìm theo tên hoặc mã kho…                      ]   hoặc  [+ Tạo mới từ listing] │
│            ● TUI002 — Túi đeo chéo nam chống nước (3 phân loại)   ← gợi ý vì mã trùng          │
│ ───────────────────────────────────────────────────────────────────────────────────────────── │
│ Phân loại sàn        Mã sàn            →   SKU kho                                             │
│ Đen                  TUI002 (Đen)      →   [TUI002-DEN ▾]          ✓ khớp mã                   │
│ Xám                  TUI002 (Xám)      →   [TUI002-XAM ▾]          đã nối                      │
│ Xanh                 TUI002 (Xanh)     →   [— chọn — ▾]  (gợi ý: TUI002-XANH)  [Tạo SKU này]   │
│ ───────────────────────────────────────────────────────────────────────────────────────────── │
│ ☐ Lấy tồn trên sàn làm tồn ban đầu cho SKU tạo mới                                              │
│                                                         [Hủy]   [Nối 2 phân loại]              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Chọn **sản phẩm kho** (dòng cha) một lần → máy ghép từng phân loại theo mã trùng, rồi theo tên phân loại trùng; chỗ không ghép được
  để trống kèm gợi ý. Khách chỉ sửa chỗ lệch bằng dropdown (chỉ liệt kê phân loại của sản phẩm kho đã chọn, nên ngắn).
- "Tạo SKU này" cho một phân loại thiếu: sinh mã theo mã gốc của sản phẩm kho + đuôi phân loại (luật `variantSkuSuffix` sẵn có), bắt
  đúng mẫu SKU — đúng nguyên tắc mục 0 QUAN-LY-KHO (mọi cửa vào kho ra mã chuẩn).
- Cùng ngăn kéo dùng cho chiều ngược (Tổng kho › Nối gian): mở với sản phẩm kho cố định, ô tìm chuyển sang tìm listing.

### 6.3 Tự khớp mã trùng — có bước xem lại (học Shopify + Sapo)

Bấm → hộp kết quả dự kiến, 3 nhóm: **Khớp chắc** (mã sàn = đúng một SKU kho) · **Cần rà** (mã sàn trùng ≥2 SKU kho, hoặc ≥2 listing
khác gian cùng mã nhưng khác tên/giá nhiều) · **Không khớp**. Khách bỏ tick dòng không muốn → **Áp N liên kết**. Chỉ nhóm Khớp chắc được
áp; Cần rà đi vào ngăn kéo từng cái. Không có gợi ý mờ theo tên/giá (anh chốt 22/10: chỉ trùng mã) — nếu sau này anh đổi ý, nhóm
"Gần khớp" cắm vào đúng chỗ này.

### 6.4 "Đưa vào Tổng kho" theo lô — có bảng rà mã

Tick N sản phẩm (hoặc "mọi sản phẩm chưa nối ở gian này") → bảng rà:

```
Sản phẩm sàn                 Phân loại   Mã sàn                     Mã gốc kho        Kết quả
Thắt lưng da nam TLN009      4           TLN009-B, TLN013-B, …      (giữ mã sàn)      tạo 4 SKU, nối 4
Áo thun cotton (mã máy)      2           SPE-1234-1, SPE-1234-2     [ATC-01   ]  ●    tạo ATC-01-DEN, ATC-01-TRANG
Dầu gội nhuộm (51)           51          DGB-01 … DGB-51            (giữ mã sàn)      tạo 51, nối 51
                                                                                  [Tạo 57 SKU & nối]
```

- Dòng mã sàn hợp lệ: giữ nguyên, không gõ. Dòng mã máy / trống / ngắn sai mẫu: ô **Mã gốc** bắt buộc (đỏ tới khi điền), máy sinh mã
  phân loại. Trùng với kho có sẵn → báo ngay, đổi sang "Nối" thay vì tạo.
- Đây là nơi 2.036 listing của shop anh được xử lý trong vài phút thay vì vài ngày; cũng là nơi áp "SKU chuẩn là việc của mình".
- **Khác với "Sao chép từ sàn" ở Tổng kho**: ở đó là chép thành hàng ĐỘC LẬP (không nối) cho khách muốn quản kho trước; ở đây là
  *nhập kho từ sàn và nối luôn*, vì danh tính đã rõ (cùng mã, cùng nguồn). Cần anh xác nhận hai nghĩa này (mục 10, câu 2).

### 6.5 Chỗ khác liên quan (lát sau)

- **Nối ngay trên đơn hàng** (Sapo, BigSeller): đơn về có dòng chưa nối → nhãn + nút "Nối" mở cùng ngăn kéo. Đây là lúc khách *đau* nhất
  (đơn không trừ kho), nên tỷ lệ hoàn thành cao hơn mọi lời nhắc.
- **Tổng kho › dòng SKU**: cột "Bán trên" giữ; "Nối gian" mở ngăn kéo chiều ngược.
- **Lịch sử liên kết** (Sapo có): ai nối / gỡ gì lúc nào — ghi `InventoryLog`-kiểu riêng hoặc OpsActivity; cần cho shop có nhân viên.

## 7. Đo thao tác trên ba kịch bản

| Kịch bản | Hiện tại | Thiết kế mới |
| --- | --- | --- |
| Khách mới, 2.000 listing, mã sàn chuẩn ~70 % | Tự khớp + tạo SKU một phát (không xem lại, mã lỏng cũng thành SKU) hoặc gõ 2.000 ô | Tick tất cả → bảng rà → điền mã gốc cho ~30 % sản phẩm mã máy → một nút. Ước 10–20 phút, mã sạch 100 %. |
| Khách có kho chuẩn, 300 SKU, mã sàn lệch tiền tố | Gõ mã kho vào từng phân loại (≈ 900 ô) | Tự khớp → nhóm Không khớp 300 → mở ngăn kéo từng sản phẩm, chọn sản phẩm kho một lần, máy ghép phân loại theo tên: ≈ 300 lần chọn thay vì 900 lần gõ. (Lát sau: luật tiền/hậu tố như BigSeller giảm về gần 0.) |
| Một sản phẩm mới đăng hôm nay, 3 màu | Bấm Đồng bộ từ sàn → cuộn tìm → gõ 3 ô | Lấy sản phẩm mới từ sàn → dòng mới lên đầu hàng đợi, nút **Đưa vào kho** một bấm. |

## 8. Bỏ gì so với hiện tại, vì sao

- Bỏ **bung sẵn mọi phân loại** → bảng theo sản phẩm. (Salework-style vẫn còn: mở ngăn kéo là thấy đủ phân loại, gõ được.)
- Bỏ **ô gõ mã trên từng dòng** → chọn sản phẩm kho rồi máy ghép. Người thuộc mã vẫn gõ được trong ô tìm của ngăn kéo (tìm theo mã).
- Bỏ **2 nút lớn ngang hàng** → một nút phụ "Lấy sản phẩm mới từ sàn" + thanh hàng loạt hiện khi tick.
- Bỏ **"Tự khớp + tạo SKU" một phát** → hai việc tách bạch, mỗi việc có bước xem lại.
- Bỏ chip "Đang bán trên sàn / Sàn đã gỡ" khỏi hàng lọc → thành số đếm trên dải, Sàn đã gỡ ẩn mặc định.
- Giữ: `view=grouped` backend, `link-by-sku`, `createProductsFromChannelProducts`, hộp Tự khớp (chỉ thêm bước xem lại), "Nối thêm gian
  cho SKU X" (chuyển thành ngăn kéo chiều ngược), dải đích.

## 9. Lộ trình lát (mỗi lát độc lập, kiểm local 1280/1440 sáng tối)

| Lát | Việc | Backend đụng |
| --- | --- | --- |
| **1. Bảng theo sản phẩm + ngăn kéo + rác ra khỏi hàng đợi** | Dải 4 số, bảng thu gọn, nút chính theo trạng thái, ngăn kéo nối (chọn SP kho → ghép phân loại), cờ Bỏ qua, ẩn Sàn đã gỡ mặc định | Cột `ignoredAt`; `GET /mappings?view=grouped` trả thêm trạng thái gộp (linked/partial/unlinked) + đếm 4 nhóm; `POST /mappings/link-batch {pairs[]}` |
| **2. Đưa vào Tổng kho theo lô với bảng rà mã** | Chọn N sản phẩm → bảng rà → tạo + nối; luật mã chuẩn | Dùng lại `createProductsFromChannelProducts` với `skuById`, thêm kiểm `SKU_PATTERN` + trùng kho |
| **3. Tự khớp có bước xem lại + chế độ an toàn** | Hộp 3 nhóm, Cần rà khi mã trùng nhiều nơi | `autoMatchChannelProducts` tách thành `preview` + `apply` |
| **4. Nối trên đơn hàng + lịch sử liên kết** | Nhãn ở Chờ xử lý, ngăn kéo tại chỗ; log ai nối gì | Bảng/log liên kết |

Lát 1 là lát thay đổi cảm nhận nhiều nhất; lát 2 là lát cứu shop anh (2.036 listing). Em đề xuất làm 1 rồi 2 liền nhau.

## 10. Năm câu cần anh chốt

1. **Hướng**: đồng ý "kho là mỏ neo, sàn là hàng đợi" (mục 4) — Sản phẩm trên sàn là hàng đợi việc, Tổng kho chỉ giữ "Nối gian" làm đường phụ?
2. **Hai nghĩa của "tạo từ sàn"**: ở Sản phẩm trên sàn, "Đưa vào Tổng kho" = tạo **và nối luôn** (danh tính rõ); ở Tổng kho, "Sao chép từ
   sàn" = tạo **độc lập**. Giữ cả hai với tên khác nhau, hay gộp về một nghĩa?
3. **Ẩn "Sàn đã gỡ" mặc định** và thêm cờ **Bỏ qua** (cột mới) — đồng ý?
4. **Tự khớp vẫn chỉ trùng mã**; có cho em làm thêm luật tiền/hậu tố do khách khai (kiểu BigSeller: "mã sàn = DM-" + mã kho) ở lát 3 không?
5. **Người thuộc mã (khách Salework 22/10)**: với thiết kế mới họ gõ mã trong ô tìm của ngăn kéo (1 lần/sản phẩm) thay vì 1 ô/phân loại.
   Anh có cần giữ thêm chế độ "gõ mã từng dòng" như hiện tại không? Em đề xuất **không**, để một cách làm.

## 11. Nguồn khảo sát (đọc 05/11/2026)

- Sellbrite — [Step 4: Link listings to products](https://support.sellbrite.com/en/articles/3367178-step-4-link-listings-to-sellbrite-products), [Why you need SKUs](https://support.sellbrite.com/en/articles/3367160-why-you-need-skus), [Build products with listing imports](https://intercom.help/sellbrite/en/articles/3367210-build-products-with-listing-imports)
- Linnworks — [Inventory linking](https://desktop.linnworks.com/Doc/inventory_linking), [Rakuten UK inventory mapping](https://desktop.linnworks.com/Doc/Rakuten_UK_InventoryMapping.html), [Sears inventory mapping](https://www.linnworks.com/Doc/Sears_Inventory_Mapping.html)
- Shopify — [Link existing marketplace listings to Shopify products](https://help.shopify.com/en/manual/online-sales-channels/marketplace-connect/products/link-existing)
- BigSeller — [SKU Mapping](https://help.bigseller.pro/en_US/detailPage/4/1/3415/content), [Master product management](https://www.bigseller.pro/blog/articleDetails/3029/How-to-Manage-Multiple-E-Commerce-Stores-Easily-with-Master-Product-Management.htm)
- Sapo — [Liên kết sản phẩm sàn](https://www.sapo.vn/cap-nhat-tinh-nang/lien-ket-san-pham-san), [Nâng cấp luồng kết nối sàn 4 bước](https://www.sapo.vn/cap-nhat-tinh-nang/nang-cap-luong-ket-noi-san-tmdt), [Liên kết sản phẩm trên màn hình đơn hàng](https://www.sapo.vn/cap-nhat-tinh-nang/Lien-ket-san-pham-tren-man-hinh-don-hang-kenh-san-TMDT)
- UpBase — [Sản phẩm sàn](https://upbase.gitbook.io/ups/tinh-nang-san-pham/van-hanh/san-pham/san-pham-san)
- Salework — mẫu khách gửi 22/10/2026 (docs/HANG-HOA-CHA-CON-PHAN-LOAI.md mục 2.6)
- Hubsell hiện tại — `frontend/src/components/products/link-manager.tsx`, `backend/src/routes/mappings.ts`, docs/HANG-HOA-CHA-CON-PHAN-LOAI.md mục 2.5–2.7, docs/KHAO-SAT-SAO-CHEP-SAN-PHAM-DANG-HANG-LOAT-29-10.md (đối thủ 29/10)

## 12. ĐÃ LÀM cả 4 lát trên local (05/11/2026, anh: "làm tất cả các lát trên local không cần hỏi lại") — commit local, CHƯA push

**Năm câu mục 10 em tự quyết theo đề xuất:** (1) giữ hướng sàn = hàng đợi, kho = đích; (2) giữ hai nghĩa — ở đây "Đưa vào kho" = tạo + nối,
ở Tổng kho "Sao chép từ sàn" = độc lập; (3) ẩn Sàn đã gỡ mặc định + cờ Bỏ qua; (4) CHƯA làm luật tiền/hậu tố mã; (5) bỏ chế độ gõ mã từng dòng.

**Mã (web):** `components/products/channel-products/` thay `link-manager.tsx` (đã xóa): `channel-products-page.tsx` (dải 4 số, lọc sàn/gian/tìm,
thanh hàng loạt, bảng theo sản phẩm thu gọn, ▸ bung phân loại chỉ đọc, menu ⋯), `link-drawer.tsx` (ngăn kéo nối), `bulk-create-dialog.tsx`
(bảng rà mã), `auto-match-dialog.tsx` (xem lại 2 nhóm + đếm không khớp), `mapping-history-dialog.tsx`, `shared.ts` (gom nhóm, trạng thái,
luật mã chuẩn, gợi ý ghép phân loại). Trang `/products/marketplace` bọc `ChannelProductsPage`. Trang Đơn hàng: `order-products-cell.tsx` có nút
"Nối kho" trên dòng `productId null`, mở cùng ngăn kéo (`source="order"`).

**Mã (backend, `routes/mappings.ts`):** `GET /mappings?view=grouped&bucket=queue|linked|delisted|ignored` (HAVING theo nhóm; trả mọi phân loại
của sản phẩm + `buckets` đếm 4 nhóm theo SẢN PHẨM); `POST /ignore`; `POST /link-batch {pairs}` (≤ 500, cùng hậu xử lý với /link); `GET
/auto-match/preview`; `GET /lookup?channelId&sku`; `GET /logs`; ghi lịch sử ở /link, /link-by-sku, /unlink, /create-products, /ignore,
/link-batch. Schema: `ChannelProduct.ignoredAt`, bảng `mapping_logs` (migration `20261105090000_channel_product_ignore_mapping_logs`, khóa
ChannelProduct có thử lại, RLS). `GET /orders` trả thêm `items.productId`.

**Chỉnh so với bản thiết kế sau khi soi local:**
- **Nút chính của sản phẩm chưa nối luôn là "Đưa vào kho"**: mã sàn chuẩn → một bấm; có mã máy / sàn để trống mã → "Đưa vào kho…" mở bảng rà
  mã cho riêng sản phẩm đó. Nút phụ **"Nối"** (nối với hàng kho có sẵn) đứng cạnh. Lý do: sản phẩm 51 phân loại có 1 mã trống mà mở ngăn kéo
  thì phải bấm 51 lần. Nối một phần → "Nối nốt" (ngăn kéo, phân loại chưa nối xếp lên đầu).
- **"Cần rà" của tự khớp** = cùng một gian có ≥ 2 phân loại mang cùng mã, hoặc SKU kho đang Ngừng bán (mã kho là duy nhất theo shop nên không
  có ca "một mã sàn ↔ hai SKU kho").
- **Nút "Nối kho" trên đơn chỉ hiện khi shop CÓ dùng kho** (trang đơn đang xem có ít nhất một dòng đã nối). Shop không nối gì thì mọi dòng đều
  chưa nối — hiện nút ở đó là nhắc việc khách không làm (mục 0 QUAN-LY-KHO).
- Ngăn kéo là hộp thoại rộng (chưa có primitive Sheet trượt phải) — cùng nội dung như mục 6.2.

**Lỗi tìm ra khi soi (đã sửa):** (a) sàn để TRỐNG mã (TikTok không có seller_sku về chuỗi rỗng) bị `createProductsFromChannelProducts` bỏ qua
lặng lẽ dù khách đã gõ mã gốc → nay dùng MÃ GỐC-ĐUÔI như mã máy; (b) `OR: []` của Prisma không lọc gì → tab trống ("Bỏ qua 0") hiện cả
bảng → trang không có nhóm thì không hỏi dòng; (c) **em đã thêm lớp `dark:` thủ công trái luật màu** (globals.css đã lật thang trong .dark) ở
cả mã mới lẫn 3 chỗ đã push sáng nay (viên số Đồng bộ tồn kho, dải kết quả phiếu kho, hộp vàng form sao chép) → gỡ hết 53 lớp, soi lại tối.

**Kiểm local (demo@hubsell.tech, cổng 4001, 1440 sáng + tối):** dải Cần nối 7 · Đã nối 8 · Sàn đã gỡ 10 · Bỏ qua 0; "Đưa vào kho…" sản phẩm 51
phân loại: thiếu mã gốc thì nút khóa, gõ DGB → tạo & nối, sang "Nối 50/51" (lộ lỗi a) → "Nối nốt": ngăn kéo tự chọn đúng sản phẩm kho, dòng
còn lại bấm Tạo SKU ra `DGB-MAU-SAC-DEN-TUYEN-SO-LUONG-3-GOI` → Đã nối 9; tick 2 → Bỏ qua → tab Bỏ qua 2 → Bỏ cờ; Lịch sử ghi đủ CREATE /
IGNORE / UNIGNORE; Tự khớp (0 khớp, 6 không khớp); tab trống đúng câu; trang Đơn hàng có nút Nối kho, dòng không có trong danh mục báo đúng.
tsc FE/BE + eslint sạch; đã dọn dữ liệu thử (10 SKU demo như cũ). **Chưa thử:** ca tự khớp có cặp thật (demo không có mã trùng), chiều ngược
"Nối vào X" từ Tổng kho bằng tay trên UI (đã soi mã + tsc), gian thật, 1280.

**Chưa làm / nợ:** luật tiền/hậu tố mã (câu 4); `one-click-link-dialog.tsx` + `/quick-link` cũ vẫn còn (Tổng kho dòng trống, hộp Cài đặt đồng
bộ) — nên thay bằng luồng mới ở lát sau; tour Kho `/guide` còn tả UI cũ; mobile chưa có; số liệu prod (tỷ lệ chưa nối / delisted / mã máy)
chưa đo.

## 13. Anh chốt lại 05/11 (sau khi xem local): trang này CHỈ NỐI, không tạo sản phẩm kho — ĐÃ LÀM trên local, chưa push

> Anh: "Không cần nút đưa vào kho, việc kiểm soát sản phẩm kho hoàn toàn sẽ nằm ở bên Kho tổng, nút Nối nay đổi thành Nối kho."

**Thay cho các ý ở mục 6, 9, 12 có chữ "Đưa vào kho" / "Tạo SKU" — đọc mục này là bản đúng. Đừng đề xuất thêm lại đường tạo SKU kho ở trang này.**

- **Gỡ:** nút chính "Đưa vào kho" / "Đưa vào kho…" trên từng dòng; nút "Đưa vào Tổng kho…" ở thanh hàng loạt; hộp bảng rà mã
  (`bulk-create-dialog.tsx` đã xóa); trong ngăn kéo nối gỡ ô "Tạo SKU" từng dòng và nút "Tạo SKU kho mới cho N phân loại chưa ghép".
  Lý do gỡ luôn phần trong ngăn kéo: cùng là tạo sản phẩm kho từ trang sàn, trái câu "hoàn toàn nằm ở bên Kho tổng".
- **Nút chính nay là "Nối kho"** (trước là nút phụ "Nối"); nối dở vẫn "Nối nốt"; chiều ngược vẫn "Nối vào <mã>". Tiêu đề ngăn kéo
  "Nối kho: <tên>". Menu ⋯ chỉ còn mục nối khi dòng không có nút chính mở ngăn kéo (Đã nối → "Xem / đổi liên kết"; tab Bỏ qua → "Nối kho…").
- **Hàng chưa có trong kho:** ngăn kéo báo "tạo sản phẩm này ở Tổng kho trước rồi quay lại nối" (chữ Tổng kho là link mở tab mới);
  phân loại chưa có SKU kho tương ứng thì để "chưa ghép" + một dòng chỉ sang Tổng kho. Tự khớp mã trùng đổi câu "Không khớp" tương ứng.
- **Giữ nguyên:** dải 4 số, Bỏ qua, Lịch sử, Tự khớp mã trùng (chỉ nối), nút "Nối kho" trên dòng đơn. Backend KHÔNG đổi:
  `POST /mappings/create-products` và `/link-by-sku` còn vì hộp "Tự khớp + tạo SKU" cũ (dòng trống Tổng kho, hộp Cài đặt đồng bộ)
  đang gọi — hộp đó nằm bên Tổng kho nên hợp nguyên tắc. `shared.ts` bỏ `unlinkedAllStandard`, `skuFromRoot`, `variantSkuSuffix`.
- **Hệ quả cần biết (em đã nói với anh):** khách mới có nghìn listing mà kho trống thì đường tạo hàng loạt từ sàn chỉ còn hộp "Tự khớp +
  tạo SKU" cũ ở Tổng kho; "Sao chép sản phẩm từ sàn" là từng sản phẩm một. Ngăn kéo chỉ tìm SKU kho ĐANG BÁN (SKU Ngừng bán không ra).
- **Kiểm local (demo, 1440 sáng + tối):** 7 dòng Cần nối đều một nút "Nối kho"; ngăn kéo không còn ô tạo; nối thật Áo thun → TUI-TOTE-01
  (Cần nối 7→6, Đã nối 8→9) rồi gỡ + xóa log thử, demo về 7/8/10/0; tsc + eslint sạch; không lớp `dark:`.
