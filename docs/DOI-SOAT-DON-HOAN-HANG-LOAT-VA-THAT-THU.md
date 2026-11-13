# Đối soát đơn hoàn — ô tích thao tác hàng loạt + dòng "Thất thu hàng mất/hỏng"

> 13/11/2026. Anh Trung: "thêm nút tích ở đầu để thực hiện các tác vụ như Nhập kho, Báo hỏng, Nhận hàng… hàng loạt nhanh hơn" + "khảo sát kỹ để thiết kế chuẩn chuyên nghiệp, các đơn hỏng phải được tính vào chi phí".
>
> **Trạng thái: ĐÃ LÀM cả hai lát (mục 9 + 10).** Luật cuối anh chốt ở mục 5.7; các mục 5.1–5.6 là quá trình đi tới luật đó, giữ để biết vì sao KHÔNG làm đền bù tự động, G4, trừ lại tồn.
>
> Việc để lại: (a) thêm bậc / lát "Thất thu" vào hai biểu đồ của app mobile — **nhắc anh khi nâng cấp app bản sau**; (b) ba route xử lý lẻ của kho vẫn tự ghi "Đã hủy" (G4, mục 3); (c) tiền đền bù chưa tự vào báo cáo.

## 1. Tóm tắt

1. Ô tích: làm được ngay bằng khung có sẵn (`DataTable` có cột ô tích, `BulkBar` thanh nổi đáy màn — trang Đơn hàng đang dùng). Anh chốt: **tích theo từng trang, tích bao nhiêu tác động bấy nhiêu đơn** (tối đa 100 đơn/trang), không có "chọn tất cả đơn khớp bộ lọc".
2. Hàng hỏng **hiện chưa vào Lợi nhuận ròng một cách chắc chắn**. Có 4 lỗ hổng (mục 3), đều đã kiểm bằng số prod. Lỗ lớn nhất không nằm ở đơn hỏng mà ở chỗ kho bấm Nhận hàng / Nhập kho là đơn bị đổi sang "Đã hủy".
3. Đề xuất: một dòng chi phí riêng **"Thất thu hàng mất/hỏng"** (hỏng / mất / tráo), tính ngay lúc kho báo hỏng; tiền đền bù tự vào **Thu khác**; thôi đổi đơn sang "Đã hủy" khi kho xử lý hoàn.

## 2. Hiện trạng trong mã

### 2.1 Vòng đời đơn hoàn (`Order.returnStatus`)

| Trạng thái | Nghĩa | Ai đổi | Tồn kho |
|---|---|---|---|
| AWAITING | Chờ hàng về | sàn báo hoàn / sàn hủy sau khi đã giao cho ship | không đổi |
| RECEIVED | Đã nhận · chờ nhập kho | kho quét hoặc bấm Nhận hàng — `POST /api/warehouse/returns/:id/receive` | không đổi |
| RECEIVED_INTACT | Đã nhập kho | `POST /api/orders/:id/return` (INTACT) hoặc `POST /api/orders/returns/bulk-inbound` | cộng lại, chặn trùng bằng `stockRestoredAt` |
| DAMAGED | Hàng hỏng · chờ khiếu nại | `POST /api/orders/:id/return` (DAMAGED) | không cộng |
| CLAIM_SETTLED | Đã được đền bù (nhập số tiền) | `POST /api/warehouse/returns/:id/claim` | không đổi |
| WRITTEN_OFF | Hao hụt / xóa sổ | cùng route trên, nhánh "không được đền" | không đổi |

Thao tác hàng loạt duy nhất đang có: nút "Nhập kho tất cả đơn đã nhận" (không chọn được đơn nào, gom mọi đơn RECEIVED).

### 2.2 Đơn hỏng đi vào báo cáo thế nào

- `lib/pnl-formula.ts` `returnGoodsRecovered`: DAMAGED / WRITTEN_OFF → **không thu hồi giá vốn** (đúng). CLAIM_SETTLED → coi như **thu hồi đủ giá vốn**, không nhìn số tiền đền.
- `Order.compensationAmount` chỉ được đọc ở trang Đối soát đơn hoàn. Không báo cáo tài chính nào dùng. Muốn có trong Thu khác khách phải tự nhập tay.
- `lib/finance-definitions.ts`: "đơn đang hoàn" = AWAITING / RECEIVED / **DAMAGED**; "đơn tính doanh thu" = không hủy và không đang hoàn. Tổng quan + Báo cáo dòng tiền chỉ cộng đơn tính doanh thu (cả doanh thu lẫn giá vốn).
- Ba route xử lý hoàn của kho (`receive`, `return`, `bulk-inbound`) đều ghi `shippingStatus = CANCELLED` ("đơn hoàn về coi như kết thúc vòng đời giao hàng"). Lượt đồng bộ sau của sàn thấy khác thì ghi lại DELIVERED (`planShopeeOrderUpdate`…). Tức một đơn hoàn sau khi kho xử lý là "Đã hủy" hay "Đã giao" tùy sàn có đụng lại đơn đó hay không.

## 3. Bốn lỗ hổng — số prod 13/11/2026 (SQL chỉ đọc, Supabase)

| # | Lỗ hổng | Số prod |
|---|---|---|
| G1 | Đơn **hỏng đang chờ khiếu nại** bị loại khỏi Tổng quan / Dòng tiền (nằm trong nhóm "đang hoàn"). Shop không bấm chốt khiếu nại thì giá vốn hàng hỏng treo mãi. | 45 đơn, giá vốn 6,13 triệu (42 đơn tài khoản nội bộ, **3 đơn / 3 shop khách, 323.000 đ**) |
| G2 | Đơn **sàn hủy do giao thất bại**, kiện về bị hỏng: đơn hủy không bao giờ là đơn tính doanh thu → giá vốn hàng hỏng không bao giờ vào Lợi nhuận ròng, kể cả sau khi chốt khiếu nại. | 1 đơn hỏng + 1 đơn đã đền |
| G3 | Đơn **thắng khiếu nại**: coi như thu hồi đủ vốn, tiền đền không vào báo cáo. | 14 đơn (13 nội bộ). Ca khách: vốn 115.000 đ, được đền 278.600 đ → báo cáo ghi lỗ 1.620 đ, thật ra lãi |
| G4 | Kho xử lý hoàn → đơn thành **"Đã hủy"** → rơi khỏi doanh thu; số dương sàn trả bị kẹp về 0. | 129 đơn khách đã nhận hàng rồi mới trả, đang nằm "Đã hủy" vì kho xử lý (60 Đã nhận, 68 Đã nhập kho, 1 Hàng hỏng). Trong đó 20 đơn sàn vẫn trả tiền về, tổng 2.504.874 đ, nhưng sổ kẹp doanh thu về 0 |

Ghi thêm:
- Chưa có ca "tồn đã cộng lúc sàn hủy, sau đó kho báo hỏng" (0 đơn). Nhưng có 2.490 đơn Chờ hàng về + 228 đơn Đã nhận thuộc loại này — khi có ô tích Báo hỏng thì ca này sẽ xuất hiện (mục 5.4).
- Đơn hỏng đã chốt "không được đền" mà sàn vẫn ghi Đã giao thì giá vốn **đã** vào Dòng tiền, nhưng nằm lẫn trong dòng Giá vốn — shop không thấy mình mất bao nhiêu vì hàng hỏng.

### Quy mô cho thao tác hàng loạt

- Chờ hàng về: **15.358 đơn / 129 shop**. 54 shop trên 20 đơn, 22 shop trên 100, 7 shop trên 500, nhiều nhất 3.206.
- Theo tuổi đơn: ≤ 14 ngày 4.285 · 15–30 ngày 6.806 · 31–60 ngày 3.962 · > 60 ngày 305.
- Đã nhận chờ nhập kho: 563 đơn / 20 shop, nhiều nhất 162.
- Hỏng / đền / xóa sổ ở shop khách: 4 đơn. Luồng báo hỏng gần như chưa ai dùng — sửa cách tính lúc này không làm số của khách nhảy đáng kể.

## 4. Thiết kế ô tích

### 4.1 Cách chọn (anh chốt 13/11)

- Cột ô tích ở đầu mỗi dòng + ô tích ở tiêu đề = chọn cả trang đang xem.
- **Tích bao nhiêu tác động bấy nhiêu.** Trang 100 dòng thì tối đa 100 đơn một lượt; khách 200 đơn làm hai lượt. Không có "chọn tất cả N đơn khớp bộ lọc".
- Đổi trang, đổi tab, đổi bộ lọc, đổi từ khóa → bỏ chọn (cùng luật trang Đơn hàng: chỉ đơn đang thấy trên màn mới bị tác động).

### 4.2 Thanh thao tác (nổi ở đáy màn khi có đơn được tích)

"Đã chọn N đơn" + các nút, mỗi nút ghi sẵn **số đơn nó xử lý được** và tự khóa khi bằng 0:

| Nút | Áp cho đơn đang | Kết quả | Hỏi lại? |
|---|---|---|---|
| Nhận hàng (n) | Chờ hàng về | Đã nhận · chờ nhập kho | không |
| Nhập kho (n) | Đã nhận, Chờ hàng về | Đã nhập kho, cộng tồn | không (cùng mức với nút "Nhập kho tất cả" đang có) |
| Báo hỏng / mất (n) | Chờ hàng về, Đã nhận | Hàng hỏng · chờ khiếu nại | **có** — hộp chọn lý do, ghi rõ số đơn, số sản phẩm, tổng giá vốn sẽ ghi vào Thất thu |
| Không được đền (n) | Hàng hỏng | Hao hụt / xóa sổ | có |

- "Đã được đền bù" giữ theo từng đơn (mỗi đơn một số tiền).
- Đơn được tích mà không hợp nút đang bấm thì bỏ qua; xong việc báo "đã xử lý X · bỏ qua Y · lỗi Z (kèm mã đơn)".
- Nút "Nhập kho tất cả đơn đã nhận" hiện có: giữ.

### 4.3 Lý do báo hỏng (danh sách, kèm ô ghi chú tự do)

Hỏng / vỡ · Thiếu hàng · Bị tráo hàng · Đã qua sử dụng, không bán lại được · Mất, kiện không về.
Lưu thành cột riêng trên đơn (hiện chỉ có ô ghi chú tự do nên không thống kê được). Sapo dùng 4 lý do gần giống: Thiếu hàng, thất lạc · Hư hỏng · Tráo hàng · Không xác định. Chưa hỏi khách.

### 4.4 Mặt sau

- Đổi trạng thái thuần (Nhận hàng, Không được đền): một câu cập nhật theo danh sách id có điều kiện trạng thái hiện tại — không vòng lặp từng đơn.
- Nhập kho, Báo hỏng (có đụng tồn): mỗi đơn một giao dịch như `bulk-inbound` hiện nay, tối đa 100 đơn một lần gọi. Cộng tồn vẫn chỉ đi qua `/api/orders/*` (nơi duy nhất có chốt `stockRestoredAt`).
- Bảng chuyển sang `DataTable` dùng chung (có sẵn cột ô tích ghim trái, menu Cột) — cùng khung trang Đơn hàng.
- Mobile: chưa đụng ở đợt này.

## 5. Thiết kế tài chính — hàng hỏng vào chi phí

### 5.1 Luật đề xuất

1. **Tính ngay lúc kho báo hỏng**, không đợi kết quả khiếu nại: hàng đã mất là mất; tiền đền là khoản thu riêng, có thì ghi sau. → "Hàng hỏng · chờ khiếu nại" ra khỏi nhóm "đang hoàn".
2. Một dòng chi phí riêng **"Thất thu hàng mất/hỏng"** ở Báo cáo dòng tiền, Tổng quan, cầu nối của Lãi/Lỗ, mobile = Σ giá vốn chưa thu hồi của đơn Hàng hỏng / Hao hụt / Đã được đền bù. Tách khỏi dòng Giá vốn để không cộng hai lần. Cộng cả đơn sàn đã hủy (G2).
3. **Tiền đền bù** tự vào Thu khác (dòng "Đền bù hàng hoàn"); đơn đã được đền vẫn ghi mất giá vốn. Kết quả ròng của đơn = tiền đền − giá vốn. Thông tư 200 / 133 cho phép cả hai cách: trừ thẳng tiền đền vào khoản mất, hoặc ghi thu nhập khác (mục 8.2); em chọn tách dòng vì có ca tiền đền lớn hơn giá vốn.
4. Kỳ ghi nhận: em đề xuất **theo ngày tạo đơn**, cùng cách Hubsell đang ghi tiền hoàn và mọi số khác của sổ cái (cầu nối Lãi/Lỗ ↔ Dòng tiền vẫn khớp từng đồng). Chuẩn kế toán thì ghi vào **kỳ phát hiện hỏng** (mục 8.2) — đây là chỗ đề xuất của em lệch chuẩn, anh chốt ở mục 7 câu 5. Hệ quả của cách theo ngày tạo đơn: báo hỏng muộn làm số tháng trước đổi, giống đơn hoàn hiện nay.

### 5.2 Thôi đổi đơn sang "Đã hủy" khi kho xử lý hoàn (G4)

Ba route của kho không ghi `shippingStatus` nữa; trạng thái giao hàng chỉ do sàn quyết định. Đơn sàn đã hủy vẫn là Đã hủy; đơn khách nhận rồi trả vẫn là Đã giao + cờ hoàn. Cần sửa lại 129 đơn cũ đang bị đổi oan (đọc lại trạng thái từ sàn hoặc suy từ mốc đã giao).

### 5.3 Ảnh hưởng tới sổ cái

- Không tăng phiên bản công thức (tăng là tính lại cả ~740.000 dòng, hơn 1 giờ, Supabase đang sát hạn mức). Chỉ đánh dấu tính lại đúng nhóm đơn bị đổi luật: khoảng 60 đơn hỏng / đền / xóa sổ + 129 đơn ở mục 5.2.
- Thêm một cột tiền đền bù vào sổ.
- Trước khi đẩy: đo trước / sau từng chiến dịch quảng cáo (hòa vốn đọc sổ) theo luật đổi tài chính.

### 5.4 Tồn kho khi báo hỏng đơn đã cộng tồn lúc sàn hủy

Đơn giao thất bại: tồn đã được cộng lại ngay lúc sàn hủy. Kiện về mà hỏng thì hiện không rút lại → sổ có hàng mà kho không có. Việc này đã nằm trong lát 2 của Quản lý kho bản chuẩn quốc tế (docs `QUAN-LY-KHO-CHUAN-QUOC-TE.md`, chưa làm). Với ô tích Báo hỏng, ca này sẽ có thật, nên đợt này cần ít nhất: báo hỏng đơn đã cộng tồn → trừ lại đúng số đã cộng, ghi Nhật ký kho lý do "Hàng hoàn hỏng / mất".

### 5.5 Anh chốt 13/11 (lượt 2)

**Tên dòng: "Thất thu", không dùng "Hao hụt".** Trang Lãi/Lỗ thực hiện đã có thẻ **"Thất thu do đơn hoàn"** (3 khoản: giá vốn chưa thu hồi · tiền sàn giữ lại · hoàn tiền khách giữ hàng — `computeReturnLoss`). Để không có hai con số khác nhau cùng mang một tên, em đặt dòng mới là **"Thất thu hàng mất/hỏng"** và cho nó thành một phần nhìn thấy được của "Thất thu do đơn hoàn" (tách khoản "giá vốn chưa thu hồi" thành: khách giữ hàng · hàng hỏng / mất). Cùng một số, cùng một tên ở Lãi/Lỗ, Dòng tiền, Tổng quan. Nhãn trạng thái "Hao hụt / xóa sổ" và tab "Hao hụt/Khiếu nại" của trang Đối soát: chưa đổi, chờ anh nói.

**Nguyên tắc về đơn hủy (anh nêu):** hủy hay không là theo API đơn của sàn; việc của Hubsell chỉ là đối soát xem đã nhận lại kiện chưa. Hủy luôn (chưa giao cho ship) thì không vào đối soát; đang giao mà hủy thì là đơn hoàn, phải vào đối soát.
- Mã hiện tại đã đúng hai ý này từ 29/10 (`integrations/cancelled-after-ship.ts`): chỉ đơn Đang giao / Đã giao bị sàn hủy mới vào "Chờ hàng về". Prod 13/11: 2.490 đơn Chờ hàng về + 228 Đã nhận + 45 Đã nhập kho thuộc loại này.
- Chỗ **trái** nguyên tắc là G4: ba route của kho tự ghi "Đã hủy" lên đơn mà sàn KHÔNG hủy (khách nhận rồi mới trả, sàn vẫn ghi Đã giao). Mục 5.2 chính là đưa mã về đúng nguyên tắc này.
- Câu còn mở: đơn đang giao mà hủy hiện nằm trục "Đã hủy" của tài chính nên tiền sàn trừ trên đơn (cước chiều đi / chiều về) không vào "Thất thu do đơn hoàn" và không vào Lợi nhuận ròng. Riêng nhóm đang mở trên prod: 2.490 đơn Chờ hàng về −40,8 triệu; 228 đơn Đã nhận −7,1 triệu; 45 đơn Đã nhập kho −1,1 triệu (toàn hệ thống, mọi shop). Nếu "tính là đơn hoàn" cả về tiền thì khoản này vào Thất thu; nếu chỉ để đối soát kiện thì giữ như hiện nay (anh chốt 30/09: đơn hủy doanh thu 0).

### 5.6 Anh chốt 13/11 (lượt 3) — bản rút gọn

Anh: "Hàng hoàn về mà nguyên vẹn thì trừ theo API trong Lãi/Lỗ thực hiện. Hàng về rồi mình báo hỏng thì thêm một cột **Thất thu hàng mất/hỏng** vào chi phí. Anh có thấy lỗ hổng nào đâu."

Em rà lại theo luật này:
- G1 và G2 không phải việc riêng: chúng chỉ mô tả vì sao hôm nay đơn hỏng chưa vào chi phí. Dòng mới lấp cả hai, miễn là nó (a) cộng **mọi đơn kho đã báo hỏng**, kể cả đơn sàn đã hủy và đơn chưa chốt khiếu nại, không lọc theo "đơn tính doanh thu"; (b) **tách khỏi dòng Giá vốn** với đơn hỏng mà giá vốn đang nằm sẵn trong đó, để không cộng hai lần.
- Đã chốt theo câu của anh: tính **lúc báo hỏng**; là **một dòng trong Chi phí**; tên **"Thất thu hàng mất/hỏng"**.
- Tiền sàn trừ trên đơn đang giao mà hủy: giữ như hiện nay (đã có ở Lãi/Lỗ thực hiện theo API, không đưa thêm vào Dòng tiền) — em hiểu vậy từ câu của anh, mục 7 câu 6 đóng.
- Còn lại ngoài dòng mới: tiền đền bù (G3) và lỗi kho tự ghi "Đã hủy" (G4). G4 làm sai đúng vế "nguyên vẹn thì trừ theo API": đơn khách trả một phần, sàn vẫn trả tiền cho phần khách giữ; kho quét nhận xong đơn thành "Đã hủy" → Lãi/Lỗ ghi doanh thu 0 (20 đơn, 2.504.874 đ).

### 5.7 Anh chốt 13/11 (lượt 4) — luật cuối

Anh: "Chỉ cần kho quét hàng hoàn và báo là hỏng thì tính là thất thu và trừ đi giá vốn của hàng đó là được."

- Một luật duy nhất: đơn kho đã **báo hỏng** → giá vốn phần hàng đó = **Thất thu hàng mất/hỏng**, trừ vào lợi nhuận.
- Không đổi công thức sổ: đơn đã được đền bù giữ cách hiện nay (coi như không mất vốn); tiền đền bù không tự vào báo cáo; lỗi kho tự ghi "Đã hủy" (G4) **không làm trong đợt này** — chỉ ghi lại ở mục 3.
- Trừ lại tồn khi báo hỏng đơn đã cộng tồn lúc sàn hủy: để lát 2 của kho chuẩn quốc tế.
- Cách tính trên sổ (không cần tính lại sổ): Σ trên đơn có trạng thái Hàng hỏng hoặc Hao hụt / xóa sổ của `returnLossCost`, riêng đơn sàn đã hủy (không có loại hoàn) lấy `costSnapshot`. Phần đã nằm sẵn trong dòng Giá vốn thì tách ra để không cộng hai lần.

## 6. Các lát

| Lát | Nội dung | Đụng tài chính |
|---|---|---|
| 1 | Ô tích + thanh thao tác + 4 nút + lý do báo hỏng + trừ lại tồn (5.4) | không |
| 2 | Dòng "Thất thu hàng mất/hỏng" + đền bù vào Thu khác + đơn hỏng ra khỏi "đang hoàn" (5.1) | có |
| 3 | Thôi đổi sang "Đã hủy" + sửa 129 đơn cũ (5.2) | có |

Lát 1 làm độc lập được. Lát 2 và 3 nên đi cùng nhau vì cùng đụng nhóm đơn hoàn trong sổ.

## 7. Chờ anh chốt

1. Hàng hỏng tính vào chi phí **ngay lúc báo hỏng** (em đề xuất) hay đợi chốt khiếu nại?
2. Dòng riêng "Thất thu hàng mất/hỏng" + tiền đền bù tự vào Thu khác (em đề xuất) hay gộp trong Giá vốn?
3. Thôi đổi đơn sang "Đã hủy" khi kho xử lý hoàn — đổi số doanh thu của 129 đơn cũ.
4. Báo hỏng thì trừ lại tồn đã cộng lúc sàn hủy — làm ngay ở lát 1 hay đợi lát 2 của kho chuẩn quốc tế?
5. Kỳ ghi nhận thất thu: theo ngày tạo đơn (em đề xuất, nhất quán với sổ) hay theo ngày báo hỏng (đúng chuẩn kế toán, nhưng là trục thời gian thứ hai trong báo cáo)?
6. Tiền sàn trừ trên đơn đang giao mà hủy (mục 5.5): tính vào Thất thu và Lợi nhuận ròng, hay chỉ đối soát kiện như hiện nay?

## 8. Chuẩn ngành (khảo sát tài liệu 13/11/2026)

Nhãn: **[đọc]** = đã mở đúng trang tài liệu; **[tìm kiếm]** = chỉ thấy ở kết quả tìm kiếm; **[suy ra]**.

### 8.1 Thao tác hàng loạt

- **Sapo OmniAI** có đúng luồng anh muốn: ở trang Hàng hoàn "tích chọn các đơn cần xử lý" → Nhận hàng trả → chọn "Nhập kho" hoặc "Không nhập kho nếu sản phẩm lỗi, hỏng"; kèm quét nhiều mã vận đơn một lúc. Mỗi đơn có hai trạng thái độc lập: trạng thái sàn và trạng thái thực nhận của shop **[đọc]** help.sapo.vn/xem-va-xu-ly-hang-hoan-kenh-san-tmdt
- **Nhanh.vn**: nhập hoàn theo từng đơn bằng quét mã; hàng thất lạc tạo "đơn đền bù", sau nhập số tiền đền hoặc 0 đ **[đọc]** pos.manual.nhanh.vn (Trả hàng hoàn tiền đơn sàn). **KiotViet**: tích nhiều đơn chỉ để tạo phiếu thu chi **[đọc]**.
- **Shopee, TikTok Shop, Shopify**: không có thao tác hàng loạt cho hàng hoàn / khiếu nại trong tài liệu đã đọc **[đọc]**. Lazada, Haravan, Salework, ShipXanh: không tìm được tài liệu.
- Chuẩn giao diện (Shopify, IBM Carbon, SAP Fiori, PatternFly, HashiCorp Helios, eBay) **[đọc]**:
  - thanh thao tác chỉ hiện khi có dòng được chọn, luôn kèm số đếm;
  - phải nói rõ "tất cả" là trang đang xem hay mọi kết quả; không giữ được lựa chọn qua trang thì **bỏ chọn mỗi lần bảng đổi** (Helios) — khớp chốt của anh;
  - nút bật nếu áp được cho ít nhất một dòng đã chọn; dòng không hợp lệ bị bỏ qua và báo "X trên Y" (SAP Fiori);
  - thao tác không hoàn tác được phải hỏi lại, ghi con số thật trong lời hỏi (Shopify, Helios);
  - xong thì bỏ chọn + làm tươi bảng; lỗi thì giữ lựa chọn để thử lại (Shopify).

### 8.2 Hàng hoàn hỏng trong sổ sách

- **Hàng không nhập lại thì giá vốn ở lại làm chi phí; nhập lại thì đảo giá vốn**: sellerboard ("If the unit is returned in damaged condition, its COGS becomes your loss"), Lifetimely, A2X, TrueProfit **[đọc]**.
- **Có dòng / tài khoản riêng cho hàng mất, hỏng**: Odoo (vị trí ảo Inventory Loss + tài khoản lỗ riêng, hiện ở nhóm chi phí), Zoho, NetSuite, sellerboard (dòng "Value of returned items") **[đọc]**.
- **Hàng hỏng tách khỏi tồn bán được**: Shopify (ngăn Unavailable → Damaged), Odoo, Nhanh.vn ("Tồn có thể bán = Tồn trong kho − Tạm giữ − Lỗi") **[đọc]**.
- **Kỳ ghi nhận = kỳ phát hiện**, không lùi về ngày bán: NetSuite nói rõ; A2X, Lifetimely, Profit Calc ghi theo ngày hoàn; TrueProfit và Lifetimely cho chọn lại "theo ngày đơn" **[đọc]**.
- **Kế toán Việt Nam** — Thông tư 200/2014 Điều 89 điểm đ và Thông tư 133/2016 Điều 62: "phần giá trị hàng tồn kho hao hụt, mất mát, kế toán phải tính ngay vào giá vốn hàng bán (sau khi trừ đi các khoản bồi thường, nếu có)" **[đọc toàn văn]**. Tiền bồi thường của bên thứ ba cũng có thể ghi thu nhập khác (TK 711 — Điều 93 TT200, Điều 65 TT133) **[đọc]**; chọn cách nào cho tiền đền của sàn / hãng vận chuyển là diễn giải, văn bản không có ví dụ riêng **[suy ra]**. Thông tư 99/2025 (thay TT200 từ 01/01/2026) giữ nguyên quy tắc này theo nguồn thứ cấp, chưa đọc văn bản gốc **[tìm kiếm]**.
- Không phần mềm Việt Nam nào (Sapo, KiotViet, Nhanh.vn) có tài liệu nói hàng hoàn hỏng vào báo cáo lợi nhuận ở dòng nào.

### 8.3 Thời hạn khiếu nại của sàn (ngắn — lý do nên báo hỏng nhanh)

| Sàn | Luồng | Hạn | Nguồn |
|---|---|---|---|
| Shopee | Khách trả hàng, hàng về có vấn đề | 2 ngày từ khi kiện trả giao tới người bán (tính cả thứ 7, CN) | **[đọc]** banhang.shopee.vn/edu/article/3647, 10626 |
| Shopee | Giao không thành công, hàng hoàn hỏng / thiếu / rỗng | 7 ngày từ khi chuyển hoàn thành công; cần video mở hàng 6 mặt | **[đọc]** article/10499 |
| TikTok | Khiếu nại yêu cầu trả hàng | 7 ngày lịch; đã bấm "Xác nhận kiện hàng" thì hết khiếu nại | **[đọc]** seller-vn.tiktok.com (cập nhật 08/01/2026) |
| TikTok | Kiện thất lạc / hỏng do vận chuyển | tối đa 40 ngày | **[đọc]** (cập nhật 26/05/2025) |
| Lazada | — | không đọc được trang chính thức; blog bên ngoài ghi 90 ngày | **[tìm kiếm]** |

Không sàn nào công bố công thức mức đền bù.

Ý cho sau này, chưa nằm trong ba lát: hiện "còn N ngày để khiếu nại" trên dòng Hàng hỏng.

## 9. Lát 1 đã code trên local (13/11/2026) — chưa commit, chưa lên prod

**Mặt sau**
- `backend/src/lib/return-bulk.ts` — đọc danh sách id (1–100, bỏ trùng), tập trạng thái được thao tác, nối ghi chú. Test `lib/__tests__/return-bulk.test.ts` 7 ca.
- `POST /api/warehouse/returns/bulk-receive` `{ ids }` — Chờ hàng về → Đã nhận; hai câu cập nhật theo tập id trong một giao dịch.
- `POST /api/orders/returns/bulk-inbound` nhận thêm `{ ids }` — nhập kho đúng các đơn đang tích (Chờ hàng về + Đã nhận); không gửi `ids` thì vẫn là nút "Nhập kho tất cả đơn đã nhận" như cũ. Trả thêm `skipped`.
- `POST /api/orders/returns/bulk-damaged` `{ ids, reason?, note? }` — Chờ hàng về / Đã nhận → Hàng hỏng; lý do + ghi chú nối vào `returnNote` (không thêm cột).
- Ba đường hàng loạt **không ghi `shippingStatus`** (hủy theo API sàn). Ba route xử lý lẻ cũ vẫn ghi CANCELLED — chưa đổi, chờ anh.

**Giao diện**
- `frontend/src/components/warehouse/returns-bulk-bar.tsx` — thanh nổi đáy màn 3 nút, mỗi nút kèm số đơn xử lý được, tự khóa khi 0; hộp Báo hỏng có 4 lý do (Hỏng / vỡ · Thiếu hàng · Bị tráo hàng · Mất, kiện không về) + ghi chú. Nhập kho mà có đơn chưa quét nhận thì hỏi lại một câu.
- `frontend/src/app/warehouse/returns/page.tsx` — cột ô tích đầu dòng + ô chọn cả trang (có trạng thái "một phần"); chỉ đơn Chờ hàng về / Đã nhận tích được; lựa chọn gắn với đúng tab + bộ lọc + trang đang xem.
- Bỏ so với bản thiết kế mục 4.2: nút "Không được đền" hàng loạt (giữ theo từng đơn cho gọn).

**Đã kiểm trên local** (tài khoản demo, DB local, 1440 px, sáng + tối): chọn cả trang 20 đơn → thanh hiện đúng số; Nhận hàng 3 đơn, Báo hỏng 2 đơn, Nhập kho 2 đơn → số trên các tab đổi đúng, đối chiếu DB đúng trạng thái + ghi chú, `shippingStatus` giữ nguyên Đã giao. `tsc` hai nơi + eslint sạch.

**Chưa kiểm:** cộng tồn thật khi nhập kho hàng loạt (đơn demo không có nhật ký trừ kho nên cộng 0 — đường cộng tồn là hàm cũ `restoreReturnStockTx`, không sửa); cả bộ test backend chưa chạy.

**Ghi nhận khi soi:** ở màn 1440 px bảng này vốn đã phải cuộn ngang trong hộp (rộng hơn hộp 233 px trước khi thêm cột; cột ô tích thêm 32 px). Màn 1720 px của anh vẫn vừa. Chưa xử lý.

## 10. Lát 2 đã code trên local (13/11/2026) — dòng "Thất thu hàng mất/hỏng" — chưa commit, chưa lên prod

**Luật** (mục 5.7): đơn kho đã báo hỏng (Hàng hỏng, hoặc Hao hụt / xóa sổ sau khi chốt không được đền) → giá vốn phần hàng đó là Thất thu, trừ vào lợi nhuận. Đơn đã được đền bù và hàng nguyên vẹn: không đổi.

**Cách tính** — `backend/src/lib/damaged-loss.ts`, đọc cột sổ đã có, KHÔNG tăng `LEDGER_FORMULA_VERSION`, không tính lại sổ:
- Đơn có loại hoàn: `returnLossCost` (đơn trả một phần chỉ tính phần bị trả). Đơn sàn đã hủy (không có loại hoàn): `costSnapshot`.
- `ledgerDamagedLoss` (services/order-ledger.ts) trả ba số: `total` (cả dòng), `inActive` (phần đã nằm trong giá vốn của đơn tính doanh thu), `outside` (phần của đơn hủy + đơn hỏng chờ khiếu nại).
- Dòng Giá vốn = giá vốn cũ − `inActive`; Lợi nhuận ròng trừ thêm đúng `outside` → không cộng hai lần, đẳng thức Doanh thu − Chi phí + Thu khác − Thuế = LN ròng vẫn đóng.

**Nơi đã nối**
- Báo cáo dòng tiền `/api/finance/analytics`: dòng mới ở **cuối cột Chi phí** (anh: "chuyển thất thu xuống dưới cùng"), chỉ hiện khi > 0; `cashFlowNetProfit` nhận thêm `damagedLossOutside`. Web tự hiện (đọc danh sách dòng từ backend).
- Tổng quan `/api/analytics`: trường mới `damagedLoss`, `damagedLossInCost`; phần `outside` cộng vào `totalOperatingExpense` để thác nước của app bản cũ vẫn đóng. Web `app/page.tsx`: bậc "Thất thu" sau bậc Vận hành + lát cuối trên vòng Cơ cấu chi phí.
- Cầu nối Lãi/Lỗ → Lợi nhuận ròng (`/realized-pnl/insights`): dùng chung phép tính, phần chênh "đơn hủy + đang hoàn" bớt đi đúng `outside`.
- Trợ lý hỏi đáp (`routes/assistant.ts`): câu "lãi bao nhiêu" + báo cáo kỳ trừ cùng số, thêm dòng Thất thu.

**Đã kiểm trên local** (tài khoản demo, kỳ 01/07 → 13/11): Dòng tiền Σ các dòng = tổng cột (906.357.000); Doanh thu − Chi phí + Thu khác − Thuế = 504.520.297 = Lợi nhuận ròng Dòng tiền = Lợi nhuận ròng Tổng quan = đáy cầu nối Lãi/Lỗ. Thất thu 1.705.000 (469.000 đã nằm trong giá vốn, 1.236.000 ngoài). Đối chiếu độc lập từ đơn gốc: 14/16 đơn khớp từng đồng; 2 đơn lệch 397.000 là 2 đơn demo em tự đưa từ "Đã nhập kho" về "Chờ hàng về" rồi báo hỏng — dòng hàng còn cờ "đã nhập lại kho" nên sổ coi là đã thu hồi vốn. Test `lib/__tests__/damaged-loss.test.ts` 9 ca; cả `src/lib` 423 ca qua; `tsc` + eslint sạch.

**Chưa làm / chưa kiểm**
- Mobile chưa sửa giao diện: Lợi nhuận ròng trên app vẫn đúng bằng web; khoản thất thu tạm nằm trong bậc Giá vốn / Vận hành cho tới khi OTA.
- Test tích hợp có DB (`integrations/__tests__/*-db`) chưa chạy; màn Tổng quan mới kiểm số qua API, chưa soi hình.
- Ca hiếm: dòng hàng sàn đã đánh "đã nhập lại kho" mà kho vẫn báo hỏng thì thất thu ra 0 (giữ luật thu hồi vốn hiện có của sổ).
- Quảng cáo: hòa vốn / biên lãi đọc thẳng sổ cái, sổ không đổi → không ảnh hưởng (suy từ mã, chưa đo trên prod).

## 11. Thu gọn đầu trang + lọc thời gian + ô quét bắn liên tục (13/11/2026, sau khi lát 1 + 2 lên prod) — đã commit + push 13/11

Anh Trung gửi ảnh prod: khối ô quét "chiếm nhiều diện tích… thu nhỏ trên web và chuyển xuống dưới", "cần thêm bộ lọc thời gian để seller dễ kiểm soát"; xem bản đầu trên local: "lộn xộn, và rải màu cam cho nhỏ lại"; "test lại phần quét bằng máy mã vạch xem chuột có bị nhảy lung tung không… khách đã bắn là bắn liên tục".

### 11.1 Bố cục — bản anh chốt (lượt 4)

Anh gửi lại ảnh prod, khoanh hai chỗ: "Bỏ cái nút màu xanh đi và thay cái nút quét đơn vào đúng vị trí đó. Bộ lọc thời gian thì để khu vực anh khoanh đỏ là xong." Từ trên xuống:

1. **Đầu trang, một dòng:** ô quét gọn ở bên trái (chỗ nút "Nhập kho tất cả" cũ) · bên phải là bộ lọc thời gian + nút đồng bộ chỉ còn biểu tượng.
2. Bốn thẻ số.
3. Dải nhắc quá hạn: một dòng chữ nhỏ.
4. Tab trạng thái (trái) + lọc gian + ô tìm 256 px (phải) — như bố cục gốc.
5. Bảng.

Đoạn chữ giới thiệu và thẻ ô quét to ở đầu trang đã bỏ; chú thích ô quét nằm trong tooltip.

Ở màn 1672 px (màn của anh) cả hai dòng đều nằm gọn một dòng. Ở 1440 và 1280 px ô tìm xuống dòng dưới tab — giống bản đang chạy trên prod (5 tab đã rộng 803 px), em không đổi vì anh không yêu cầu.

Ba bản em tự xếp trước đó anh đều gạt — đừng làm lại:
- Dồn ô quét + bộ lọc xuống sát bảng, ô nằm rải hai đầu ("lộn xộn").
- Ô tìm kéo giãn hết dòng ("quá dài nên rất rối").
- Một thanh dồn trái gom cả ô quét, gian, ngày, ô tìm ("xấu").

**Nút "Nhập kho tất cả (N)" đã gỡ** ("không cần thiết vì đã có thể tích chọn và có thanh nhập kho bên dưới; vì nút này mà bố cục bị rối"), kèm mã chỉ phục vụ nó: chế độ không có `ids` của `POST /api/orders/returns/bulk-inbound` (giờ bắt buộc `ids`, gọi thiếu trả 400). Muốn nhập cả loạt: tab Đã nhận → tích cả trang → Nhập kho (tối đa 100 đơn một lượt).

### 11.2 Lọc thời gian

- `GET /api/warehouse/returns?from=&to=` — lọc theo **ngày sàn báo hoàn** (`returnRequestedAt`); danh sách, số trên tab và bốn thẻ cùng theo kỳ. Mặc định "Toàn bộ thời gian" (đơn chờ về có thể rất cũ); đơn chưa rõ mốc chỉ hiện khi không lọc.
- Web dùng `DateRangePicker` chuẩn (`allowAll`).

### 11.3 Ô quét: lỗi mất mã khi bắn liên tục — có thật, đã sửa

**Thử trước khi sửa** (local, gõ như máy quét: mã + Enter, 4 mã liên tiếp): chỉ mã đầu được ghi nhận; 3 mã sau mất, không báo gì. `document.activeElement` vẫn là ô quét nên nhìn như con trỏ còn đó.

**Gốc** (`components/shared/scan-code-box.tsx`): ô bị `disabled` trong lúc tra mã trước. Trình duyệt ngừng đưa phím vào ô đã khóa và không tự trả lại sau khi mở khóa; lệnh `focus()` gọi lúc ô còn khóa không có tác dụng. Lỗi có từ trước, không phải do đợt sửa bố cục; màn Đóng gói (`/orders/packing`) dùng chung ô này nên cũng dính.

**Sửa** — một chỗ, cả hai màn:
- Ô không bao giờ bị khóa khi đang xử lý. Mã vừa bắn vào **hàng chờ** (trần 50, mức tự chọn), ô trống ngay cho mã kế; hàng chờ chạy lần lượt.
- Mã lỗi hiện ở dòng đỏ "Mã vừa lỗi: …" dưới ô, không nằm lại trong ô (nằm lại thì dính liền vào mã kế).
- `grabTyping` (bật ở Đối soát đơn hoàn): gõ phím khi con trỏ đang ở nút / ô tích / nền trang thì con trỏ tự về ô quét — tránh Enter của máy quét bấm lại nút vừa bấm. Không đụng ô nhập khác, không chạy khi có hộp thoại mở.
- Trang không còn khóa ô quét theo đơn đang nhận; `onFound` trả Promise để hàng chờ đợi đơn trước ghi xong.

**Thử sau khi sửa** (local):
- 4 mã liên tiếp (có 1 mã quét trùng): 3 đơn Đã nhận + 1 câu báo trùng, con trỏ ở ô quét suốt.
- Tích ô chọn cả trang rồi bắn mã: con trỏ tự về ô quét, đơn được nhận, ô tích không bị đổi.
- Bắn dồn 4 mã trong 0,27 giây: đủ 4 đơn Đã nhận, đúng thứ tự.

**Chưa thử:** máy quét thật; ca mã lỗi / mã chưa có trong hệ thống (trên local sẽ gọi sàn bằng tài khoản demo nên em không bắn); màn Đóng gói mới mở lên xem (ô có, con trỏ đúng chỗ), chưa quét thật; camera.

### 11.4 Dọn theo sau khi gỡ nút "Nhập kho tất cả" + việc để lại

Đã sửa chữ ở mọi nơi còn nhắc nút cũ: bài hướng dẫn "Giữ tiền" (`frontend/src/lib/guide-tours.ts` hai bước đầu), lời đọc tương ứng (`frontend/scripts/generate-guide-voice.js`), mốc chờ + ô quét trong script chụp ảnh (`frontend/scripts/capture-live-tour-assets.js`), câu trả lời của Trợ lý hỏi đáp, dòng chú thích ở màn Kho của app mobile, ghi chú trong worker demo.

Để lại, chưa làm:
- **Ảnh + giọng đọc của bài hướng dẫn "Giữ tiền" bước 1–2** (`gt-returns.png`, `voice/giutien/step-1.mp3`, `step-2.mp3`) vẫn là bản cũ: ảnh còn nút xanh và khối ô quét to, giọng còn đọc "bấm Nhập kho tất cả". Phải chụp lại trên bản đang chạy và sinh lại giọng (tốn credit) — chữ trên màn đã đúng.
- Dòng chú thích mới trên app mobile chỉ tới tay khách ở bản app / OTA sau.

