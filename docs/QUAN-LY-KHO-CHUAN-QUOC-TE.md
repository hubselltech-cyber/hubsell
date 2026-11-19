# Quản lý kho bản chuẩn quốc tế — khảo sát hiển thị, thuật toán, phạm vi tác động (12/11/2026)

> Anh Trung 12/11: "lên phương án khảo sát phần Quản lý kho bản chuẩn quốc tế… khảo sát kỹ cách thức hiển thị, thuật toán tính, phạm vi tác động liên quan tới kiểm kê, nhập/xuất".
> Nối tiếp [TONG-KHO-DANG-GIU-CHO-DON.md](TONG-KHO-DANG-GIU-CHO-DON.md) (11/11: cột "Chờ giao", bản 2). Đối thủ Việt (Sapo, KiotViet, Salework) đã khảo sát ở [QUAN-LY-KHO-TAI-CAU-TRUC.md](QUAN-LY-KHO-TAI-CAU-TRUC.md) mục 11, không làm lại.
> Trạng thái: **CHƯA CODE.** Số prod đã đo 12/11 (chỉ đọc) ở mục 11. Anh chốt 12/11: "Chia theo shop" + "Chuẩn quốc tế như thế nào thì em cứ làm như vậy" → bảng chốt ở đầu mục 9. Thiết kế lát 1 (chạy bóng) ở mục 13; **lát 1 ĐÃ PUSH 12/11 `6bf5eaf6`, đang chạy bóng trên prod — ngày chuyển 3.776 đơn, đối chiếu lần đầu lệch 0 (mục 13.11); soi mỗi ngày tới ~19/11 rồi mới sang lát 2.**

## 0. Tóm tắt

1. **Chuẩn quốc tế thống nhất 6 điểm** (9 hệ thống: Shopify, Odoo, NetSuite, Zoho Inventory, Cin7 Core, Linnworks, Veeqo, SAP, Amazon FBA):
   - Tồn kho (On hand) là hàng thực có trong kho, GỒM cả hàng đã có đơn chưa giao. Có thể bán = Tồn kho − Đang giữ − Không bán.
   - Đơn chốt chỉ GIỮ hàng. Tồn kho chỉ giảm khi hàng rời kho (giao cho đơn vị vận chuyển). Nhặt hàng, đóng gói không làm đổi tồn.
   - Kiểm kê so số đếm với Tồn kho (không so với Có thể bán), ghi PHẦN CHÊNH thành một bút toán, không ghi đè.
   - Hàng đang về (đặt nhà cung cấp) nằm ngoài Tồn kho tới khi nhận.
   - Hàng hoàn chỉ cộng lại khi kho NHẬN được kiện, thường kèm lựa chọn nhập lại hay bỏ.
   - Số đẩy lên sàn là Có thể bán, có thể trừ thêm một khoảng đệm.
2. **Hubsell lệch ở 4 chỗ gốc:** (a) trừ sổ lúc đơn chốt; (b) đơn hủy sau khi đã giao được cộng sổ ngay khi kiện còn trên đường về; (c) Kiểm kê ghi đè sổ bằng số đếm; (d) Nhật ký kho chỉ có một cột số, không tách giữ / xuất.
3. **Tin tốt:** sổ hiện tại (`quantityInStock`) chính là "Có thể bán" theo nghĩa Shopify (trước khi trừ giữ đơn chưa thanh toán và tồn an toàn). Shopify cũng lưu Có thể bán thành một số riêng và tính Tồn kho bằng phép cộng. Vậy **không cần đổi nghĩa cột lõi**: giữ sổ làm "tồn bán", thêm ngăn "Đang giữ", Tồn kho = tồn bán + đang giữ + không bán. Cách này để nguyên 23 tệp backend đang đọc sổ và nguyên phần đẩy tồn lên sàn.
4. **Số đẩy lên sàn gần như không đổi.** Có thể bán đổi đúng ở các thời điểm như hôm nay, trừ MỘT ca: đơn hủy sau khi giao (xem mục 9, câu 2).
5. **Việc phải làm thật** gồm: một sự kiện mới "xuất kho khi giao cho vận chuyển", đổi luật hủy sau giao, Kiểm kê viết lại theo số trong kho, Nhật ký kho ba ngăn, đổi nghĩa cột Tồn kho ở mọi màn cùng một lúc (16 tệp web, 2 tệp mobile, Excel, hướng dẫn).
6. **Em đề xuất đi 6 lát, lát đầu chạy bóng** (mục 8): bộ đếm mới chạy song song và được đối chiếu hằng đêm với câu "Chờ giao" đã có trên prod, khớp đủ lâu rồi mới đổi màn.

## 1. Chuẩn quốc tế nói gì

Mức xác minh: **[đọc]** = đã mở trang chính thức và đọc thấy; **[trích]** = lấy từ đoạn trích của công cụ tìm kiếm trên trang chính thức, chưa đọc cả trang (toàn bộ Cin7, một phần SAP / Veeqo); **[nhớ]** = từ trí nhớ, chưa có nguồn. Danh sách nguồn ở mục 12.

### 1.1. Bộ số

| Hệ thống | Tên các số | Công thức | Thứ tự cột |
|---|---|---|---|
| Shopify | On hand · Available · Committed · Unavailable · Incoming | On hand = Committed + Unavailable + Available. Unavailable gồm hỏng, chờ kiểm, tồn an toàn, khác **[đọc]** | Unavailable · Committed · Available · On hand · Incoming **[đọc]** |
| Odoo | On Hand · Free to Use · Incoming · Outgoing | Free to Use = On Hand chưa bị giữ **[đọc]** | On Hand · Free to Use · Incoming · Outgoing **[đọc]** |
| NetSuite | On Hand · Committed · Available · On Order · Back Ordered · In Transit | Available = On Hand − Committed; On Hand gồm cả Committed **[đọc]** | không có tài liệu |
| Zoho Inventory | Stock on Hand · Committed Stock · Available for Sale | Available = On Hand − Committed **[đọc]** | On Hand · Committed · Available **[đọc]** |
| Cin7 Core | On Hand · Allocated · Available · On Order | Available = On Hand − Allocated **[trích]** | chưa kiểm được |
| Linnworks | Stock Level · In Orders · Available · Due | Available = tổng − phần giữ cho đơn mở **[đọc]** | không có tài liệu |
| Veeqo | On-hand · Allocated · Available · Incoming | Available = On-hand − Allocated **[đọc]** | không có tài liệu |
| SAP | Unrestricted-use · Quality inspection · Blocked · Reserved | chỉ Unrestricted luôn dùng được **[đọc]** | không có tài liệu |
| Amazon FBA | Fulfillable · Reserved · Inbound · Unfulfillable | không có tài liệu | — |

Sapo (đã khảo sát 11/11) cùng họ: Tồn kho = Có thể bán + Đang giao dịch + Đang đóng gói.

### 1.2. Vòng đời một đơn

| Hệ thống | Lúc GIỮ hàng | Lúc TRỪ Tồn kho | Hủy / hoàn sau khi giao |
|---|---|---|---|
| Shopify | đơn được đặt **[đọc]** | tạo fulfillment (tài liệu lập trình; trang trợ giúp không viết thẳng) **[đọc]** | ô "Restock" khi hoàn tiền, mặc định bật; đơn từ sàn nối qua Marketplace Connect KHÔNG tự nhập lại **[đọc / trích]** |
| Odoo | cấu hình: lúc xác nhận / tay / N ngày trước **[đọc]** | xác nhận phiếu giao **[trích]** | phiếu trả; chỉ cộng khi xác nhận phiếu nhận **[trích]** |
| NetSuite | lúc nhập / duyệt đơn **[đọc]** | phiếu giao đánh dấu Shipped; Picked, Packed không ghi sổ **[đọc]** | phiếu trả không tác động tới khi nhận; ô Restock, bỏ chọn = xóa sổ **[trích]** |
| Zoho | đơn tạo, chưa giao **[đọc]** | chế độ "tồn thực": lúc Shipment; chế độ "tồn kế toán": lúc Invoice **[đọc]** | chỉ cộng khi nhận hàng trả **[trích]** |
| Cin7 | duyệt đơn **[trích]** | duyệt bước Ship **[trích]** | thẻ Restock, chọn vị trí nhập lại **[trích]** |
| Linnworks | đơn tải về **[trích]** | đơn "processed" **[trích]** | không có tài liệu |
| Veeqo | đơn kéo về **[đọc]** | đơn shipped **[đọc]** | nút restock hoặc nhận hàng trả chia "nhập lại / bỏ" **[trích]** |
| SAP | reservation **[trích]** | post goods issue **[trích]** | hàng trả nằm ở kho chặn tới khi kiểm **[trích]** |

Ngoại lệ duy nhất: chế độ "tồn kế toán" của Zoho trừ theo chứng từ, gần với cách Hubsell đang làm. Zoho vẫn hiện song song khối "tồn thực".

### 1.3. Bán vượt, tồn âm

- Shopify: bật "tiếp tục bán khi hết hàng" thì Available được âm **[trích]**.
- NetSuite: Available không bao giờ âm; On Hand có thể âm, có tùy chọn chặn **[đọc / trích]**.
- Odoo: cho On Hand âm **[đọc]**. Cin7: chặn **[trích]**. Linnworks: không hiện dưới 0 và KHÔNG ghi dòng lịch sử khi trừ ở 0 (mất dấu vết) **[đọc]**.
- Không có đồng thuận. Cách Hubsell đang làm (cho âm để lộ bán vượt, đẩy sàn `max(0, …)`) nằm trong vùng chấp nhận được.

### 1.4. Kiểm kê

| Hệ thống | So với số nào | Hàng biến động trong lúc đếm | Kết quả |
|---|---|---|---|
| SAP | số sổ tại thời điểm "đóng băng" | hai cách: chặn mọi phiếu của mã đang đếm, hoặc đóng băng số sổ. Ví dụ tài liệu: sổ 100, nhập thêm 20, đếm 90 → chênh 10 chứ không phải 30 **[đọc / trích]** | ghi chênh ở bước riêng |
| NetSuite | ảnh chụp On Hand theo ô lúc bấm Start **[đọc]** | người đếm tự cộng trừ, hoặc bật "chụp lại" | duyệt → sinh phiếu điều chỉnh; trạng thái Open · Started · Pending Approval · Approved |
| Odoo | On Hand (gồm hàng đã giữ) **[đọc]** | không đóng băng; có biến động thì hỏi xác nhận | sinh một bút toán chuyển từ / tới vị trí ảo "Điều chỉnh tồn", không ghi đè; có "yêu cầu đếm" giao cho người, để trống số = đếm mù |
| Cin7 | — | KHÓA vị trí; đơn từ sàn nằm chờ tới khi xong **[trích]** | có nháp, hoàn tác |
| Shopify (2026) | cột Expected (tài liệu không nói rõ là On hand hay Available) **[đọc]** | không có tài liệu | Draft · In progress · Review · Completed; duyệt / từ chối từng mã; ghi vào lịch sử điều chỉnh |
| Zoho | — | huy hiệu "Variation" cho mã có giao dịch trong lúc đếm **[đọc]** | duyệt → phiếu điều chỉnh, lý do mặc định "Stock taking results" |
| Linnworks (WMS) | — | hàng đã nhặt chưa xuất bị loại khỏi màn đếm rồi cộng lại lúc nộp **[đọc]** | — |

Đồng thuận: so với số TRONG KHO; kết quả là bút toán chênh; hệ đầy đủ có phiên đếm + bước duyệt. Khác nhau ở cách xử lý biến động trong lúc đếm (khóa / chụp / cảnh báo).

### 1.5. Sửa tay, nhập, chuyển, đẩy sàn, sổ

- **Sửa tay (Shopify):** sửa được cả Available lẫn On hand, kiểu "đặt thành" hoặc "cộng trừ"; Committed không sửa được. Lý do chọn từ danh sách: Correction, Count, Damaged, Promotion or donation, Received, Return restock, Theft or loss **[đọc]**.
- **Lịch sử điều chỉnh (Shopify):** cột Ngày · Hoạt động · Người làm · Unavailable · Committed · Available · On hand · Incoming; mỗi ô hiện phần đổi trước, số mới sau **[đọc]**.
- **Nhập hàng:** mọi hệ thống chỉ tăng On hand lúc NHẬN. Chuyển kho có ngăn "đang chuyển" (NetSuite, Odoo, Cin7).
- **Số đẩy sàn:** Linnworks gửi Available, có trần "Max Listed" theo kênh / theo mã **[đọc]**; Cin7 gửi Available trừ đệm **[trích]**; Veeqo gửi Available, mỗi gian một luật (trần, ngưỡng, %) **[đọc]**.
- **Sổ:** Odoo ghi mọi thay đổi thành bút toán "từ vị trí → tới vị trí" (khách hàng, nhà cung cấp, hao hụt là vị trí ảo) **[đọc]**; NetSuite: Picked / Packed không ghi sổ, Shipped mới ghi và mới tính giá vốn **[đọc / trích]**; Shopify: các ngăn số + nhật ký điều chỉnh có lý do, không phải kế toán kép **[đọc]**.

## 2. Hubsell hôm nay (đọc mã 12/11)

| Việc | Ở đâu | Đang làm |
|---|---|---|
| Sổ | `Product.quantityInStock`; theo vị trí ở `product_stock_levels`; cửa ghi duy nhất `services/stock-ledger.ts` `applyStockDelta` | Sổ = tổng các vị trí BÁN ĐƯỢC. Ô "không bán" nằm ngoài sổ. Cho âm. |
| Đơn chưa thanh toán | `holdStockTx` (Shopee UNPAID / INVOICE_PENDING, Lazada unpaid; TikTok không giữ) | cộng `holdQuantity`, không đụng sổ |
| Đơn chốt | `deductStockTx` (3 sàn) | trừ sổ + trừ vị trí ngay, ghi nhật ký loại SYNC có `orderId` + `locationId`, mốc `stockDeductedAt` |
| Giao cho vận chuyển | — | KHÔNG có tác động kho nào. `shippingStatus` sang SHIPPING do webhook, quét lô, làn đọc con trỏ, sửa tay cùng ghi |
| Hủy trước giao | `restoreStockTx`; hủy tay ở `routes/orders.ts:653` | cộng lại sổ đúng vị trí đã trừ |
| Hủy SAU giao (giao thất bại, kiện quay đầu) | `restoreStockTx` + `cancelled-after-ship.ts` | cộng lại sổ NGAY lúc sàn báo hủy; đơn cắm cờ "Chờ hàng về"; lúc kho nhận kiện thì `stockRestoredAt` chặn không cộng nữa |
| Nhận hàng hoàn | `POST /orders/:id/return`, `/returns/bulk-inbound` | nguyên vẹn + chưa cộng → cộng cả số đã trừ (không theo số lượng trả từng dòng), về ô "Nhận hoàn" nếu có |
| Nhập / xuất tay, phiếu nhiều mã | `POST /inventory/adjust`, `/adjust-bulk` | cộng trừ sổ; chặn xuất quá `quantityInStock` (không tính phần giữ) |
| Sửa ô Tồn kho, Excel đè | `POST /inventory/set`, `/products/import` | ghi đè sổ = số gõ |
| Kiểm kê | `POST /inventory/stocktake` | ghi đè sổ (hoặc số tại vị trí) = số đếm; bản nháp ở localStorage; không phiên, không duyệt |
| Chuyển vị trí, Cất lên kệ | `transferStockTx` | tổng không đổi, trừ khi qua ô "không bán" thì sổ đổi |
| Số đẩy sàn | `availableToPush` | `max(0, sổ − giữ − an toàn)` |
| Chờ giao (11/11) | `services/stock-awaiting-ship.ts` | chỉ đọc, tính từ nhật ký trừ × đơn chưa giao của gian đang hoạt động |

Số prod đã có từ trước (không đo mới hôm nay): 11/11 có 3.680 đơn đã trừ kho chưa giao ở gian đang hoạt động (16 chủ shop có nhật ký trừ thật, 494 đơn, 570 sản phẩm), thêm 4.120 đơn ở gian ngủ đông / mất kết nối. Đo 29/10 ([DON-HOAN-VA-SAO-KE.md](DON-HOAN-VA-SAO-KE.md) mục 8): 30 ngày có khoảng 1.194 đơn sàn hủy sau khi giao thất bại (TikTok 1.029, Shopee 165).

## 3. Đối chiếu: lệch ở đâu

| # | Chuẩn | Hubsell | Hậu quả hôm nay |
|---|---|---|---|
| 1 | Đơn chốt = giữ; Tồn kho đứng yên | trừ sổ ngay | Cột "Tồn kho" thấp hơn hàng thực có đúng bằng số chờ giao. Khách đếm kho không khớp. |
| 2 | Giao cho vận chuyển = trừ Tồn kho | không có sự kiện | Nhật ký kho không có dòng "hàng rời kho"; không trả lời được "hôm qua xuất bao nhiêu". |
| 3 | Hủy sau giao: không cộng tới khi nhận kiện | cộng ngay | Sổ có hàng mà kho chưa có → đẩy lên sàn → có thể bán hàng chưa về. Kiện về hỏng thì số đã cộng không bao giờ bị rút lại. |
| 4 | Kiểm kê so với Tồn kho, ghi chênh | ghi đè sổ bằng số đếm | Đếm cả kiện đã gói chưa giao → cộng lại hàng đã bán → bán vượt (rủi ro đã ghi 11/11, chưa vá). Đơn về giữa lúc đếm cũng làm sai. |
| 5 | Sửa tay có lý do theo danh sách | lý do gõ tự do | Không thống kê được hỏng / mất / tặng. |
| 6 | Lịch sử hiện từng ngăn số | một cột "Thay đổi" + "Tồn sau" | Không phân biệt giữ với xuất. |
| 7 | Rào xuất tay theo Có thể bán | theo sổ, bỏ qua phần giữ | Nhỏ (giữ gần như luôn 0). |
| 8 | Có "Đang về" (đặt nhà cung cấp) | chưa có đặt hàng, chỉ có phiếu nhập | Ngoài phạm vi đợt này. |
| 9 | Giá trị tồn tính trên Tồn kho | `max(0, sổ) × giá vốn` | Thiếu giá trị hàng chờ giao + hàng ô không bán. |

Điểm Hubsell ĐÃ đúng chuẩn: một cửa ghi sổ có nhật ký từng dòng kèm vị trí và người làm; số đẩy sàn là Có thể bán trừ đệm; ô "không bán" chính là ngăn Unavailable; hàng hoàn có nơi nhận riêng; đơn chưa thanh toán đã là "giữ".

Lỗ có sẵn thấy kèm khi rà (chưa sửa, sẽ nằm gọn trong lát 2 vì các hàm này phải viết lại):
- Hủy tay (`orders.ts:653`) không khóa dòng đơn, không kiểm `stockRestoredAt`, không nhả giữ → chạy đua với webhook hủy có thể cộng hai lần.
- `/return` và `bulk-inbound` đọc `stockRestoredAt` ngoài giao dịch, không khóa → cùng kiểu chạy đua.
- Shopee / TikTok chỉ tác động kho ở đường webhook; quét lô cố ý không đụng kho. Lỡ webhook thì đơn không bao giờ được trừ.
- Công thức "còn hàng" mỗi nơi một kiểu: đẩy sàn `sổ − giữ − an toàn`; cảnh báo sắp hết `sổ − giữ`; lọc "Hết hàng" trên web `sổ ≤ 0`; mobile `sổ − giữ ≤ 0`.
- Không có test cho hủy tay, nhận hoàn, nhập / xuất, sửa tồn, Kiểm kê, Excel, xuất mẫu KOC.

## 4. Mô hình đề xuất

### 4.1. Bộ số

| Số hiện cho khách | Nghĩa | Tính từ |
|---|---|---|
| **Tồn kho** | hàng thực có trong kho | tồn bán + đang giữ (đã chốt) + không bán |
| **Đang giữ** | hàng đã có đơn, còn trong kho | đơn đã chốt chưa giao + đơn chưa thanh toán |
| **Không bán** | hàng lỗi / chờ kiểm (chỉ hiện khi shop có ô không bán) | tổng các ô `sellable = false` |
| **Có thể bán** | số đẩy lên sàn | `max(0, tồn bán − giữ chưa thanh toán − an toàn)` — KHÔNG đổi |

Ví dụ của khách 11/11: **Tồn kho 44 · Đang giữ 10 · Có thể bán 34.** Cột "Chờ giao" hôm qua đổi tên thành "Đang giữ" và dời lên TRƯỚC Có thể bán: lúc này nó nằm trong Tồn kho thật nên gọi "giữ" là đúng, khách quen Sapo đọc không còn trừ hai lần. Thứ tự cột theo Zoho (cũng là trật tự trong công thức của NetSuite và Sapo), đọc từ trái sang là một phép trừ.

### 4.2. Hai cách cài, em chọn A

| | A — giữ sổ làm "tồn bán", thêm ngăn Đang giữ | B — đổi sổ thành "trong kho" |
|---|---|---|
| `quantityInStock` | giữ nguyên nghĩa | đổi nghĩa |
| Thêm | `Product.committedQuantity`, `product_stock_levels.committed`, `Order.stockShippedAt`, nhật ký thêm ngăn | cũng các cột đó |
| 23 tệp backend đang đọc sổ (đẩy sàn, đối soát 6 giờ, cảnh báo sắp hết, trợ lý quảng cáo, sao chép sản phẩm…) | không đổi | phải soi và sửa từng tệp; sót một tệp là đẩy nhầm số trong kho lên sàn → bán vượt |
| Nhật ký trừ theo đơn (dùng cho hoàn kho, phiếu nhặt theo vị trí, giá vốn đơn cũ) | giữ nguyên, đổi nhãn thành "Giữ cho đơn" | phải dựng lại |
| Giống ai | Shopify: lưu từng ngăn, On hand là tổng | Odoo |

Kết quả khách nhìn thấy như nhau. A ít chỗ có thể sai hơn hẳn.

### 4.3. Bảng sự kiện

| Sự kiện | Tồn kho | Đang giữ | Có thể bán | So với hôm nay |
|---|---|---|---|---|
| Đơn chưa thanh toán về | 0 | +n | −n | sàn nhận như cũ |
| Đơn chốt (Chờ lấy hàng) | 0 | +n | −n | sàn nhận như cũ; cột Tồn kho thôi giảm |
| Giao cho vận chuyển | −n | −n | 0 | MỚI: dòng "Xuất kho đơn X" |
| Hủy trước khi giao | 0 | −n | +n | sàn nhận như cũ |
| Hủy / giao thất bại SAU khi giao | 0 | 0 | 0 | **ĐỔI: thôi cộng ngay**, hàng sang "Đang hoàn về" |
| Kho nhận kiện, nguyên vẹn | +n | 0 | +n (vào ô không bán thì 0) | cộng lúc này thay vì lúc sàn báo hủy |
| Kho nhận kiện, hỏng / mất | 0 | 0 | 0 | hết cảnh số đã cộng không rút lại được |
| Nhập / xuất tay | ±n | 0 | ±n | như cũ |
| Chuyển vị trí bán ↔ ô không bán | 0 | 0 | ∓n | Tồn kho đứng yên (hôm nay cột Tồn kho nhảy) |
| Kiểm kê lệch d | +d | 0 | +d | ghi chênh thay vì ghi đè |
| Bán vượt (hết hàng vẫn có đơn) | 0 | +n | âm (sàn nhận 0) | như cũ; Đang giữ > Tồn kho là dấu hiệu nợ hàng |

## 5. Thuật toán

### 5.1. Xuất kho khi giao cho vận chuyển

- **Mốc:** đơn rời nhóm Chờ xử lý / Đã xử lý sang Đang giao hoặc Đã giao theo trạng thái sàn (Shopee SHIPPED trở đi, TikTok IN_TRANSIT trở đi, Lazada shipped trở đi). Đúng định nghĩa "chưa giao" của cột Chờ giao đang chạy trên prod. Không gọi thêm sàn.
- **Theo TRẠNG THÁI, không theo bước chuyển:** điều kiện là "đã giữ, chưa xuất, chưa hủy, trạng thái thuộc nhóm đã giao". Lý do: quét lô và làn đọc con trỏ ghi `shippingStatus` mà không đi qua phần kho, nên không thể móc vào chỗ ghi trạng thái (hơn 10 chỗ).
- **Hai đường cùng một hàm, có mốc `stockShippedAt` chống lặp:** (1) trong giao dịch xử lý webhook, ngay cạnh chỗ giữ / hoàn hiện nay; (2) một lượt quét bù theo lô bằng SQL trên chỉ mục bán phần (cùng kiểu `Order_stock_awaiting_ship_idx`), bắt các đơn đổi trạng thái qua đường khác.
- **Theo vị trí:** vị trí đã chọn từ lúc giữ (như hôm nay chọn lúc trừ), nên phiếu nhặt vẫn chỉ đúng kệ. Lúc xuất trừ `committed` của đúng vị trí đó.
- **TikTok giao một phần (PARTIALLY_SHIPPING):** sổ đang theo cả đơn, không theo kiện. Đề xuất xuất cả đơn khi sang IN_TRANSIT; ca hiếm, ghi rõ ở chú thích.
- **Biên bản bàn giao của Hubsell** (quét kiện lúc giao ship) là mốc sát thực tế hơn trạng thái sàn, nhưng không phải shop nào cũng dùng. Để làm mốc tùy chọn ở lát sau.

### 5.2. Hủy và hàng hoàn

- Hủy khi CHƯA có `stockShippedAt`: nhả giữ (Đang giữ −, Có thể bán +). Như hôm nay.
- Hủy khi ĐÃ có `stockShippedAt`: không đụng số nào. Đơn vào "Chờ hàng về" (cờ này đã có từ 29/10).
- Kho nhận kiện: nguyên vẹn → cộng Tồn kho, về ô Nhận hoàn nếu shop đặt; hỏng / mất → không cộng. Cộng theo số lượng thực trả từng dòng (`OrderItem.returnedQuantity`) thay vì cả đơn.
- Mọi đường (webhook, hủy tay, nhận lẻ, nhận tất cả) đi qua một bộ hàm có khóa dòng đơn + mốc, vá luôn hai lỗ chạy đua ở mục 3.
- Sàn báo hủy mà Hubsell chưa từng thấy trạng thái đã giao (lỡ webhook): coi như hủy trước giao, giống hôm nay, không tệ hơn.

### 5.2.1. Chia theo shop (anh chốt 12/11)

Mỗi chủ shop một chế độ cho đơn hủy / giao thất bại SAU khi đã giao:

| Chế độ | Lúc sàn báo hủy | Lúc kho quét nhận kiện | Màn Tổng kho |
|---|---|---|---|
| **Cộng khi nhận kiện** (đúng chuẩn) | không đổi số nào; đơn vào "Chờ hàng về" | nguyên vẹn → cộng Tồn kho; hỏng → không cộng | Tồn kho là hàng thực có |
| **Cộng khi sàn báo hủy** (cách đang chạy) | cộng Tồn kho + Có thể bán ngay | không cộng nữa | dòng nhắc "đang tính cả N sản phẩm chưa về kho", N = hàng của đơn còn "Chờ hàng về" |

Phần dưới đây là đề xuất của em cho lát 2, anh chưa duyệt từng ý:

- **Không tự chuyển shop nào.** Mọi shop hiện có bắt đầu ở "cộng khi sàn báo hủy" để ngày lên bản không shop nào đổi số. Lý do em lùi một bước so với câu "shop đã quét nhận thì theo chuẩn": 4 shop đã quét cũng mới quét 5 đơn, chưa rõ họ có quét ĐỦ mọi kiện không; tự chuyển mà họ quét sót là mất tồn.
- Shop đã từng quét nhận hàng hoàn (5 shop theo số 12/11) thấy một hộp mời bật chế độ chuẩn, nói rõ được gì, mất gì; gạt đi là không hiện lại. Shop khác tự bật ở cài đặt kho.
- Bật chế độ chuẩn chỉ áp cho đơn hủy TỪ lúc bật. Đơn đã cộng sổ trước đó giữ nguyên, không rút lại.
- Chế độ chuẩn cần lối thoát để "Chờ hàng về" không treo mãi: một nút "kiện không về" (bỏ, không cộng) cho từng đơn hoặc cả lô quá N ngày. N chưa có căn cứ, cần hỏi khách hoặc đo thời gian kiện quay đầu thật.
- Số "N sản phẩm chưa về kho" tính từ đơn còn "Chờ hàng về" đã cộng sổ. Cần chỉ mục bán phần riêng trên `Order` (prod không còn chỉ mục theo `returnStatus`, mục 11.4).

### 5.3. Kiểm kê

- **Số sổ trên phiếu = Tồn kho tại vị trí** (tồn bán tại vị trí + đang giữ tại vị trí). Kiện đã gói chưa giao là hàng trong kho → ĐẾM. Không cần công tắc "số đếm gồm kiện đã gói" như thiết kế 11/11.
- **Lợi lớn của mô hình mới:** đơn mới về giữa lúc đếm KHÔNG làm đổi Tồn kho. Chỉ còn ba thứ làm lệch trong lúc đếm: shipper lấy hàng, nhập / xuất tay, nhận hàng hoàn.
- **Ghi chênh, không ghi đè:** chênh = số đếm − số sổ LÚC ĐẾM dòng đó; số mới = số hiện tại + chênh. Cách này tương đương "đóng băng số sổ" của SAP: hàng rời kho sau lúc đếm không bị cộng ngược lại.
- **Biến động sau lúc đếm:** dòng nào có xuất / nhập sau thời điểm đếm thì hiện huy hiệu (kiểu Zoho) kèm con số, mặc định giữ phần chênh, có nút "đếm lại". Không khóa kho (không chặn được đơn sàn) và không lặng lẽ.
- **Nhật ký:** "Kiểm kê 12/11 tại Kệ A1: sổ 44, đếm 42, chênh −2", loại Điều chỉnh.
- **Phiên đếm + duyệt + biên bản in** (Draft → Đang đếm → Chờ duyệt → Đã chốt, nhiều người đếm, đếm mù): hệ đầy đủ đều có. Hubsell đang giữ nháp ở trình duyệt của một máy. Xếp vào lát sau; trùng với mục "kiểm kê theo phiên + quyền" và "Biên bản kiểm kê in được" đã nằm trong danh sách chờ từ 05/11.

### 5.4. Sửa tay, nhập / xuất, Excel

- **Sửa ô Tồn kho và Excel cột "Tồn kho":** số gõ là số TRONG KHO. Máy tính tồn bán = số gõ − đang giữ − không bán. Gõ thấp hơn Đang giữ thì hộp cảnh báo "đang giữ 10 cho đơn, kho chỉ còn 6 → thiếu 4", có nút vẫn lưu (theo luật cảnh báo, không khóa cứng).
- **Tệp Excel cũ:** khách còn tệp xuất trước ngày đổi (cột Tồn kho = số cũ) mà nhập lại sau ngày đổi thì tồn bị hạ đúng bằng phần đang giữ. Cần đổi tên cột trong mẫu mới và nhận diện mẫu cũ.
- **Nhập / xuất tay, phiếu nhiều mã:** cộng trừ như cũ. Rào xuất đổi sang "không quá Có thể bán", vượt thì cảnh báo có nút bỏ qua.
- **Lý do theo danh sách** (thêm ô ghi chú tự do): Nhập hàng · Hàng hoàn nhập lại · Bán ngoài sàn · Hỏng · Mất / thất lạc · Tặng / dùng nội bộ · Sửa sai số. Danh sách này em dựng theo Shopify, chưa hỏi khách.
- **Chuyển vị trí, Cất lên kệ:** không đổi thuật toán. Chỉ đổi câu chữ: qua ô không bán thì Tồn kho đứng yên, Có thể bán đổi.
- **"Đang về" từ nhà cung cấp:** chuẩn có, Hubsell chưa có phiếu đặt hàng. Không làm trong đợt này.

### 5.5. Hiển thị

- **Tổng kho:** Tồn kho · Đang giữ · (Không bán) · Có thể bán · Vị trí · Bán trên · Giá trị tồn. Chú thích rê chuột của Có thể bán: "Tồn kho 44 − đang giữ 10 − an toàn 0 = 34". Dòng cha cộng các phân loại như cũ.
- **Nhật ký kho** kiểu lịch sử điều chỉnh của Shopify: mỗi dòng ba ô Đang giữ · Có thể bán · Tồn kho, mỗi ô ghi phần đổi và số sau. Loại dòng: Giữ cho đơn · Xuất cho đơn · Nhả giữ (hủy) · Nhận hàng hoàn · Nhập · Xuất · Kiểm kê · Sửa số · Chuyển vị trí. Dòng cũ trước ngày đổi giữ nguyên, chỉ có một ô.
- **Lọc "Hết hàng", cảnh báo sắp hết, ô đỏ, mobile:** thống nhất một luật theo Có thể bán. Hôm nay bốn nơi bốn công thức.
- **Giá trị tồn** = Tồn kho × giá vốn (gồm hàng đang giữ và ô không bán). Con số sẽ TĂNG so với hôm nay. Không dính Dòng tiền / Lãi lỗ: đã kiểm, không mã tài chính nào đọc nhật ký kho, trừ đường tính giá vốn dự phòng cho đơn cũ không có dòng hàng, và đường này vẫn chạy vì cách A giữ nguyên nhật ký giữ.
- **Hộp so số trước khi bật đồng bộ:** cột Tồn · Giữ · An toàn · Sẽ đẩy vẫn cộng đúng nếu "Giữ" gồm cả đơn đã chốt.
- **Vị trí:** mỗi vị trí hiện tồn tại chỗ, chú thích "trong đó giữ cho đơn N".

## 6. Phạm vi tác động

### 6.1. Backend

| Nhóm | Tệp / chỗ | Mức |
|---|---|---|
| Sổ | `services/stock-ledger.ts` (thêm ngăn giữ, số trong kho sau từng bút toán) | sửa lõi |
| Đơn | `integrations/order-stock.ts` (thêm hàm xuất; hủy rẽ nhánh trước / sau giao) | sửa lõi |
| 3 sàn | `shopee/service.ts`, `tiktok/service.ts`, `lazada/service.ts` (gọi hàm xuất theo trạng thái) | sửa nhỏ, 3 chỗ |
| Quét bù | worker mới theo lô + chỉ mục bán phần mới trên `Order` | mới |
| Hủy tay, nhận hoàn | `routes/orders.ts` (3 đường), `routes/warehouse.ts` | viết lại phần kho |
| Cửa ghi tay | `routes/inventory.ts` (`/adjust`, `/set`, `/adjust-bulk`, `/stocktake` + 2 route phiếu đếm), `routes/products.ts` (Excel), `routes/stock-locations.ts` (`set-level`), `routes/koc.ts` (rào xuất mẫu) | sửa |
| Đọc để hiển thị | `routes/products.ts` (danh sách, lọc Hết hàng, tổng nhóm), `routes/inventory.ts` (nhật ký), `services/low-stock.ts`, `services/ops-alerts.ts` (câu chữ thông báo) | sửa |
| Phiếu nhặt | `services/fulfillment/pick-location.ts` | không đổi (cách A) |
| Đẩy sàn, đối soát 6 giờ, trợ lý quảng cáo, sao chép sản phẩm, trợ lý chat | `inventory-push.ts`, `stock-push-worker.ts`, `stock-reconcile.ts`, `ads-recommend-data.ts`, `listing-copy/source.ts`, `routes/assistant.ts`, `routes/operations.ts` | **không đổi (cách A)** |
| Schema | 3 cột bộ đếm / mốc + cột ngăn ở `InventoryLog` + 1 chỉ mục bán phần; migration chỉ thêm cột có mặc định, không viết lại bảng | mới |
| Chuyển dữ liệu ngày đổi | một câu SQL theo lô: điền `committed` từ đúng câu Chờ giao; đơn của gian ngủ đông / mất kết nối đánh dấu đã xuất | một lần |
| Script / seed | `scripts/shopee-bulk-test-scenarios.ts` (đang trừ thẳng, bỏ qua sổ), 3 seed | sửa cho khớp |

### 6.2. Web (16 tệp đọc số tồn) + mobile (2 tệp)

| Màn | Tệp | Đổi gì |
|---|---|---|
| Tổng kho | `app/products/page.tsx`, `inline-stock-editor.tsx`, `awaiting-ship.tsx`, `stock-value.tsx`, `stock-levels-cell.tsx` | cột, nghĩa ô sửa, chú thích, Giá trị tồn |
| Nhập / xuất | `adjust-stock-dialog.tsx`, `app/products/receive/page.tsx` | rào theo Có thể bán, cột "Tồn sau", lý do theo danh sách |
| Kiểm kê | `app/products/stocktake/page.tsx`, `lib/stocktake.ts` | số sổ mới, thời điểm đếm từng dòng, huy hiệu biến động |
| Vị trí | `stock-transfer-dialog.tsx`, `stock-locations-dialog.tsx`, `app/products/putaway/page.tsx` | câu chữ "tồn bán" |
| Nhật ký kho | `inventory-log-table.tsx`, `product-history-dialog.tsx` | ba ô số, loại dòng mới |
| Đồng bộ | `sync-settings-dialog.tsx`, `sku-settings-dialog.tsx`, `bulk-stock-settings-dialog.tsx`, `channel-products-page.tsx`, `channel-links-popover.tsx` | công thức trong câu chữ |
| Đơn hàng, đơn hoàn | `app/orders/page.tsx`, `return-dialog.tsx`, `app/warehouse/returns/page.tsx`, `claim-dialog.tsx` | câu "hủy đơn tự cộng lại tồn kho", "đã cộng từ lúc hủy" |
| Excel, in tem, KOC | `lib/excel.ts`, `print-labels-dialog.tsx`, `koc/sample-export-modal.tsx` | cột, số theo tồn nào |
| Hướng dẫn, trang giới thiệu | `lib/guide-tours.ts` (≥ 8 câu), landing (`pricing.tsx`, `tour.tsx`) | câu "bán 1 thì kho trừ 1"; ảnh tour kho chụp lại |
| Mobile | `screens/StockPage.tsx`, `types/api.ts` | nhãn, luật hết hàng, thêm Đang giữ; đi OTA |

Mười nhóm câu chữ sẽ SAI nghĩa nếu không sửa cùng lúc (đã liệt kê có tệp + dòng khi rà): chú thích Chờ giao "đã trừ khỏi Tồn kho"; mọi công thức "Có thể bán = Tồn − giữ − an toàn"; "khả dụng (tồn − đang giữ)"; "Giữ N" chỉ là đơn chưa thanh toán; lọc "Hết hàng (tồn kho ≤ 0)"; câu hủy đơn cộng lại tồn; câu "bán 1 trừ 1"; rào "tồn kho hiện tại N"; nhãn "tồn bán"; "tồn ban đầu lấy theo số trên sàn".

→ Phần hiển thị phải lên MỘT LƯỢT cho một shop (web + câu chữ + Excel), mobile OTA cùng ngày. Không lên từng màn.

### 6.3. Test

Phải viết mới cho: xuất khi giao (webhook + quét bù, chống lặp, đơn nhiều vị trí), hủy trước / sau giao, nhận hoàn theo số lượng dòng, chạy đua hủy tay × webhook, Kiểm kê ghi chênh có biến động giữa chừng, sửa tay / Excel theo số trong kho, bất biến "Tồn kho = tồn bán + giữ + không bán" sau mọi thao tác. 19 tệp test kho hiện có giữ nguyên nghĩa với cách A.

## 7. Rủi ro

| Rủi ro | Mức | Cách chặn |
|---|---|---|
| Bộ đếm Đang giữ trôi (sót một đường xuất / hủy) | cao | Lát 1 chạy bóng. Đối chiếu hằng đêm với câu Chờ giao đang chạy trên prod (hai cách tính độc lập). Lệch thì báo, không tự sửa. |
| Thôi cộng ngay khi hủy sau giao → shop không quét nhận hoàn bị thiếu tồn, mất đơn | cao, đụng doanh thu khách | Anh chốt chế độ (mục 9 câu 2). Đo prod trước. |
| Gian mất kết nối / ngủ đông: đơn đứng im ở "giữ" mãi, Tồn kho phình | vừa | Ngày đổi: đánh dấu đã xuất. Về sau: gian rời trạng thái hoạt động thì đơn giữ của gian đó ra khỏi Tồn kho, nối lại thì quét bù. |
| Lỡ webhook giao hàng → hàng đã đi mà còn "giữ" | vừa | Lượt quét bù theo trạng thái. 11/11 gian đang hoạt động có 0 đơn kẹt quá 7 ngày. |
| Khách nhập lại tệp Excel cũ | vừa | Đổi tên cột + nhận diện mẫu cũ. |
| Ngày đổi, khách thấy Tồn kho tăng vọt | vừa | Dải thông báo một lần "Tồn kho từ nay là hàng trong kho, gồm cả hàng đã có đơn chưa giao" + hướng dẫn. Có thể bán không đổi nên sàn không nhảy số. |
| Kiểm kê giữa lúc chuyển đổi | vừa | Lát Kiểm kê lên CÙNG lát hiển thị, không lệch nhịp. |
| Khối lượng ghi tăng (thêm một bút toán mỗi đơn lúc giao) | thấp | Một UPDATE + một dòng nhật ký mỗi dòng hàng; quét bù theo lô, không lặp từng đơn. Supabase từng cạn Disk IO → đo trên bản bóng trước. |

## 8. Lộ trình đề xuất

| Lát | Việc | Khách thấy gì | Đảo lại được |
|---|---|---|---|
| 0 | Đo prod, chỉ đọc (danh sách ở 9.3) | không | — |
| 1 | **Bóng:** cột bộ đếm + mốc giữ / rời kho + hàm xuất (Biên bản bàn giao, webhook, quét bù) + đối chiếu hằng đêm. Sổ, màn, số đẩy sàn không đổi. **Thiết kế chi tiết ở mục 13.** | không | tắt cờ |
| 2 | Hủy sau giao + nhận hoàn theo chuẩn, gom ba đường vào một bộ hàm có khóa | tồn về lúc nhận kiện (theo chế độ anh chốt) | cờ theo shop |
| 3 | **Hiển thị + cửa ghi, lên một lượt theo cờ shop:** Tổng kho, Nhật ký ba ngăn, sửa tay, Excel, nhập / xuất, Giá trị tồn, lọc Hết hàng, câu chữ, hướng dẫn; **kèm Kiểm kê so Tồn kho + ghi chênh + huy hiệu biến động**; mobile OTA cùng ngày | đổi lớn | cờ theo shop |
| 4 | Lý do theo danh sách + báo cáo hao hụt | thêm | — |
| 5 | Kiểm kê theo phiên: nhiều người, duyệt, biên bản in, đếm mù | thêm | — |
| 6 | (tùy chọn) "Đang về" từ nhà cung cấp. Biên bản bàn giao làm mốc xuất đã dời lên lát 1 sau khi anh chốt theo chuẩn. | thêm | — |

Thứ tự bật: shop công ty → 2–3 shop tình nguyện trong 16 shop đang có hàng chờ giao → toàn bộ. Lát "Kiểm kê: cột Chờ giao + công tắc" còn treo từ 11/11: nếu anh chốt đi bản chuẩn thì BỎ lát tạm đó, vì lát 3 thay hẳn; rủi ro Kiểm kê cộng lại hàng đã bán vẫn còn tới lúc lát 3 lên.

## 9. Chờ anh chốt → ĐÃ CHỐT 12/11

> **Anh 12/11: "Chuẩn quốc tế như thế nào thì em cứ làm như vậy."** Em áp câu này cho mọi câu còn mở dưới đây; riêng câu 2 anh đã chọn "Chia theo shop" trước đó nên giữ nguyên.
>
> | Câu | Chốt theo chuẩn | Căn cứ |
> |---|---|---|
> | 1. Cách cài | **A** — giữ sổ làm tồn bán, thêm ngăn Đang giữ | Chuẩn quy định con số khách thấy và thời điểm đổi số, không quy định cột lưu bên trong. Shopify lưu Available riêng, On hand là phép cộng (mục 1.1). Đây là lựa chọn kỹ thuật của em, không phải điều chuẩn bắt buộc. |
> | 2. Hủy sau giao | **Chia theo shop** (anh chọn) | Chế độ "cộng khi nhận kiện" là chuẩn; chế độ còn lại là ngoại lệ có nhãn cho shop không quét nhận. |
> | 3. Mốc rời kho | **Kho xác nhận bàn giao HOẶC sàn báo đã lấy hàng, cái nào tới trước** | Chuẩn trừ tồn ở bước kho xác nhận xuất (NetSuite "Shipped", Cin7 "Ship", Veeqo "shipped"). Ở Hubsell bước đó là Biên bản bàn giao; shop không dùng thì trạng thái sàn là tín hiệu rời kho duy nhất. |
> | 4. Tên cột | **Đang giữ** | Committed / Allocated. |
> | 5. Sửa ô Tồn kho | **đặt số trong kho** | Odoo, Zoho sửa On hand. Shopify cho sửa cả Available; không làm, vì hai cửa sửa cho một con số dễ nhầm. |
> | 6. Giá trị tồn | **tính trên Tồn kho** (gồm hàng đang giữ + ô không bán) | Odoo tính Total Value trên On Hand. Con số sẽ tăng so với hôm nay. |
> | 7. Lý do nhập / xuất | **danh sách cố định theo Shopify** + ô ghi chú | Mục 1.5. Không hỏi khách trước. |
>
> Phần dưới giữ nguyên để lưu vết các phương án đã cân nhắc.

### 9.1. Ba câu quyết định hướng

1. **Cách cài A** (giữ sổ làm tồn bán, thêm ngăn Đang giữ, Tồn kho là phép cộng) — em chọn — hay B (đổi nghĩa sổ)?
2. **Hủy sau khi giao: tồn về lúc nào?** → ✅ **ANH CHỐT 12/11: "Chia theo shop" (phương án b).** Chi tiết cách chia ở mục 5.2.1.
   - (a) Đúng chuẩn cho mọi shop: chỉ cộng khi kho bấm nhận kiện. Shop không dùng Đối soát đơn hoàn sẽ thiếu tồn dần.
   - (b) Theo shop — em chọn: shop đã dùng quét nhận hoàn thì theo chuẩn; shop chưa dùng thì giữ cách cũ (cộng khi sàn báo hủy) và hiện rõ "đang tính cả N sản phẩm chưa về kho". Có công tắc để shop tự chuyển. Số prod 12/11 (mục 11.2): 5 / 32 shop từng quét nhận; 967 sản phẩm của 16 shop đang nằm trên sổ mà kho chưa xác nhận về.
   - (c) Giữ cách cũ cho tất cả: Tồn kho không bao giờ là số trong kho thật, lệch chuẩn ở điểm 5.
3. **Mốc "rời kho":** trạng thái sàn báo đã lấy hàng (em chọn, mọi shop dùng được, không gọi thêm sàn) hay Biên bản bàn giao của Hubsell?

### 9.2. Câu nhỏ hơn

4. Tên cột: "Đang giữ" (em chọn, khớp Sapo) hay giữ "Chờ giao"?
5. Sửa ô Tồn kho = đặt số trong kho (em chọn), hay cho sửa cả Có thể bán như Shopify?
6. Giá trị tồn tính cả hàng đang giữ + ô không bán (đúng chuẩn, số tăng) hay giữ như cũ?
7. Danh sách lý do ở 5.4 có cần hỏi vài khách trước không?

### 9.3. Số prod — ĐÃ ĐO 12/11 (anh: "Đo prod trước"), kết quả ở mục 11

Còn một số chưa đo được: từ lúc chốt tới lúc shipper lấy trung bình bao lâu (chưa có mốc giờ rời kho; lát 1 thêm mốc rồi mới đo).

## 11. Số prod đo 12/11/2026 (chỉ đọc, Supabase SQL Editor)

Cách đo: xem cỡ bảng trước; bảng nhỏ (`InventoryLog` 129.000 dòng / 27 MB, `Product` 72.500 dòng / 38 MB) đọc thẳng; bảng `Order` (877.000 dòng / 502 MB) chỉ đi qua khóa chính hoặc chỉ mục bán phần, đã xem kế hoạch chạy trước từng câu. Câu đầu em soạn theo `returnStatus` bị planner chọn quét cả bảng (chỉ mục `Order_returnStatus_idx` trong migration cũ KHÔNG còn trên prod) → bỏ, đổi sang đi từ nhật ký kho.

### 11.1. Ai đang dùng phần nào của kho

| Việc | Dòng nhật ký 30 ngày | Số chủ shop 30 ngày | Từ trước tới nay |
|---|---|---|---|
| Đơn sàn trừ kho | 62.398 | 32 | 64.308 dòng / 32 shop |
| Đơn hủy cộng lại | 6.616 | 32 | 6.838 / 32 |
| Gieo tồn từ số trên sàn lúc nối | 47.648 | 34 | 48.420 / 36 |
| Sửa thẳng ô Tồn kho | 80 | 7 | 82 / 8 |
| Nhập / xuất lẻ từng mã | 42 | 7 | 43 / 7 |
| Kiểm kê | 16 | 3 | 16 / 3 |
| Phiếu nhiều mã | 7 | 1 | 7 / 1 |
| Chuyển vị trí | 0 | 0 | 6 / 1 |
| Excel đè tồn | 0 | 0 | 0 |

- Sản phẩm kho: 72.512 mã của 37 chủ shop. 103 mã đang âm sổ ở 12 shop (tổng −2.121). Đang giữ cho đơn chưa thanh toán: 14 mã, 16 sản phẩm. Chưa mã nào đặt tồn an toàn riêng.
- Vị trí: 2 shop dùng (4 vị trí). **Chưa shop nào có ô "không bán"**, chưa shop nào đặt nơi nhận hoàn. 16 dòng vị trí đang âm.

→ Cỡ tác động của việc đổi mô hình hiện rất nhỏ: Kiểm kê 3 shop, sửa ô Tồn kho 8 shop, vị trí 2 shop, Excel đè chưa ai dùng. Đổi lúc này rẻ hơn nhiều so với để sau. Cột "Không bán" chưa cần hiện ở lát 3.

### 11.2. Đơn hủy sau khi giao (cờ có từ 29/10, tức 14 ngày số liệu)

| | Đơn | Sản phẩm | Chủ shop |
|---|---|---|---|
| Đã cộng sổ lúc sàn báo hủy, kho CHƯA nhận kiện | 374 | 967 | 16 |
| — trong đó đã quá 7 ngày | 208 | 563 | 10 |
| Đã cộng sổ, kho đã quét nhận | 5 | 6 | tối đa 4 |

Tuổi của 374 đơn chưa nhận: 0–3 ngày 46 · 3–7 ngày 120 · 7–14 ngày 208.

- 18 shop có đơn hủy sau giao đã cộng sổ; trong đó nhiều nhất 4 shop từng quét nhận loại kiện này. Tính mọi loại hàng hoàn (cả 14 đơn khách trả hàng nhập kho qua màn Đối soát đơn hoàn) thì toàn hệ thống có **5 shop từng quét nhận** trên 32 shop có kho chạy theo đơn.
- 379 đơn hủy sau giao thì chỉ 5 đơn (1,3 %) được quét nhận. Trong 14 ngày có cờ, số đơn còn "Chờ hàng về" chỉ giảm nhờ 5 lượt quét đó.
- Chưa có ca nào "đã cộng sổ rồi kho báo hỏng" (0 đơn).

→ Trả lời câu 2: nếu áp đúng chuẩn cho mọi shop (chỉ cộng khi quét nhận), ít nhất 14 / 18 shop sẽ không có lại số hàng này chừng nào chưa đổi thói quen; hiện là 967 sản phẩm sau 14 ngày. Ngược lại, giữ cách cũ thì 967 sản phẩm này đang nằm trên sổ và trên sàn dù kho chưa xác nhận đã về. Phương án (b) theo shop có căn cứ; với shop không quét, cần thêm một lối thoát để hàng "Chờ hàng về" không treo mãi (ví dụ nút "đã nhận hết kiện tới ngày X"), em chưa thiết kế.

### 11.3. Đơn đã giữ, chưa giao (qua chỉ mục `Order_stock_awaiting_ship_idx`)

| Gian | Đơn | Chủ shop | Quá 3 ngày | Quá 7 ngày |
|---|---|---|---|---|
| Đang hoạt động | 3.702 | 54 | 98 | 0 |
| Đang hoạt động, ngủ đông | 3.445 | 52 | 2.054 | 258 |
| Mất kết nối | 416 | 9 | 416 | 411 |
| Mất kết nối + ngủ đông | 286 | 3 | 286 | 34 |

- Gian đang hoạt động: 97 % đơn rời kho trong 3 ngày, không đơn nào quá 7 ngày. Đây là căn cứ cho luật "gian không còn hoạt động thì đơn giữ của gian đó ra khỏi Tồn kho" và cho ngưỡng báo "giữ quá 7 ngày là bất thường".
- 4.147 đơn kẹt ở gian ngủ đông / mất kết nối: nếu tính vào Đang giữ thì Tồn kho phình sai.

### 11.4. Thấy thêm khi đo

- 8.962 dòng trừ kho theo đơn (TikTok 5.926, Shopee 3.036; 17/10 → 10/11; tối đa 7 shop) có `orderId` rỗng, tức đơn đã bị xóa còn nhật ký ở lại. Em CHƯA kiểm mã đường nào xóa đơn (nhiều khả năng xóa gian). Với mô hình mới đây là một ca phải xử lý: xóa đơn đang giữ thì phải nhả giữ, nếu không bộ đếm Đang giữ treo vĩnh viễn. Thêm vào danh sách test lát 1.
- Chỉ mục `Order_returnStatus_idx` không còn trên prod → mọi câu lọc theo `returnStatus` trên bảng Order đều quét cả bảng. Lát 2 (nhận hàng hoàn) cần chỉ mục bán phần riêng cho "Chờ hàng về".

## 13. Thiết kế lát 1 — chạy bóng (12/11/2026; đã code trên local, xem 13.9 — chỗ nào 13.9 nói khác thì 13.9 đúng)

Mục tiêu: sổ biết thêm hai điều mà hôm nay chưa biết — hàng nào đang giữ cho đơn, và đơn nào đã rời kho — mà KHÔNG đổi con số nào khách thấy, không đổi số đẩy sàn, không thêm dòng nào vào Nhật ký kho. Chạy đủ lâu, đối chiếu khớp, rồi mới làm lát 2 và 3.

### 13.1. Cột mới (chỉ thêm, không viết lại bảng)

| Bảng | Cột | Nghĩa |
|---|---|---|
| `Product` | `committedQuantity Int default 0` | hàng của đơn đã chốt, chưa rời kho |
| `product_stock_levels` | `committed Int default 0` | như trên, theo vị trí |
| `Order` | `stockCommittedAt DateTime?` | đơn này ĐANG được tính trong bộ đếm giữ (từ lúc nào) |
| `Order` | `stockShippedAt DateTime?` | đơn đã ra khỏi bộ đếm giữ vì hàng rời kho |
| `Order` | `stockShipSource String?` | `HANDOVER` · `PLATFORM` · `CHANNEL_INACTIVE` · `CUTOVER` — để đo và gỡ rối |

- Chỉ mục bán phần `Order_stock_committed_idx ON "Order"("channelId") WHERE "stockCommittedAt" IS NOT NULL AND "stockShippedAt" IS NULL AND "stockRestoredAt" IS NULL`: đúng tập đơn đang giữ (vài nghìn dòng), dùng cho quét bù, đối chiếu và số "Đang giữ" về sau. Dựng `CONCURRENTLY` tay trước khi push như chỉ mục 11/11.
- Vì sao cần `stockCommittedAt` riêng thay vì dùng `stockDeductedAt`: hơn 60.000 đơn cũ đã trừ kho và đã giao từ lâu. Nếu lấy "đã trừ, chưa có mốc rời kho" làm điều kiện thì phải UPDATE toàn bộ đơn cũ một lần. Có mốc riêng thì ngày chuyển chỉ đụng đúng tập đang chờ giao (3.702 đơn theo số 12/11).
- Migration đụng `Order`: thêm cột nullable, mở đầu bằng khối lấy khóa có `lock_timeout` + thử lại theo khuôn `20260930230000_order_ledger` (bẫy deadlock lúc deploy).

### 13.2. Bốn chỗ ghi

| Lúc | Hàm | Làm gì thêm |
|---|---|---|
| Đơn chốt | `deductStockTx` → `applyStockDelta` thêm tùy chọn `reserve` | cùng câu UPDATE trừ sổ: `committedQuantity += n`; vị trí: `committed += n`; đánh `stockCommittedAt`. Đơn về lần đầu đã ở trạng thái đã giao thì giữ rồi xuất luôn trong cùng giao dịch. |
| Hàng rời kho | `shipStockTx` (MỚI, trong `order-stock.ts`) | khóa dòng đơn; nếu đang giữ + chưa xuất + chưa hủy: đọc các dòng nhật ký trừ của đơn (số lượng, vị trí) → `committedQuantity −= n`, `committed −= n`, đánh `stockShippedAt` + nguồn. Sổ và Có thể bán KHÔNG đổi → không đẩy sàn. |
| Hủy trước khi rời kho | `restoreStockTx`, hủy tay `orders.ts:653`, hai đường nhận hoàn | dùng chung một hàm `releaseCommittedTx`: đang giữ + chưa xuất thì `committed −= n`. Phần cộng lại sổ giữ nguyên như hôm nay (lát 2 mới đổi). |
| Xóa gian | `services/channel-delete.ts` | trước vòng xóa đơn: một câu SQL nhả giữ toàn bộ đơn đang giữ của gian đó. Đã kiểm: đây là đường DUY NHẤT xóa đơn (`DELETE FROM "Order"`), khớp với 8.962 dòng nhật ký mất đơn ở mục 11.4. |

`shipStockTx` được gọi ở ba nơi, nơi nào tới trước thì thắng, nơi sau thấy mốc và bỏ qua:

1. **Biên bản bàn giao** (`routes/packing.ts`, sau khi đơn được "giành" vào biên bản): nguồn `HANDOVER`.
2. **Webhook đơn** ba sàn, ngay cạnh chỗ gọi `deductStockTx`: trạng thái sàn thuộc nhóm đã giao (Shopee SHIPPED / TO_CONFIRM_RECEIVE / COMPLETED; TikTok IN_TRANSIT / DELIVERED / COMPLETED; Lazada shipped trở đi): nguồn `PLATFORM`.
3. **Lượt quét bù** (worker, mỗi vài phút): bắt đơn mà trạng thái đã đổi qua đường không đụng kho (quét lô, làn đọc con trỏ, sửa tay) và đơn của gian không còn hoạt động.

### 13.3. Lượt quét bù — một câu SQL mỗi lô, không lặp từng đơn

```sql
WITH due AS (
  SELECT o.id,
         CASE WHEN c.status <> 'ACTIVE' OR c."hibernatedAt" IS NOT NULL
              THEN 'CHANNEL_INACTIVE' ELSE 'PLATFORM' END AS src
  FROM "Order" o JOIN "Channel" c ON c.id = o."channelId"
  WHERE o."stockCommittedAt" IS NOT NULL AND o."stockShippedAt" IS NULL AND o."stockRestoredAt" IS NULL
    AND (o."shippingStatus" IN ('SHIPPING','DELIVERED')
         OR c.status <> 'ACTIVE' OR c."hibernatedAt" IS NOT NULL)
  LIMIT 500 FOR UPDATE OF o SKIP LOCKED),
q AS (
  SELECT il."productId", il."locationId", SUM(-il."changeQuantity")::int AS qty
  FROM due JOIN "InventoryLog" il ON il."orderId" = due.id AND il."changeQuantity" < 0
  GROUP BY 1, 2),
p AS (
  UPDATE "Product" pr SET "committedQuantity" = pr."committedQuantity" - s.qty
  FROM (SELECT "productId", SUM(qty)::int AS qty FROM q GROUP BY 1) s WHERE pr.id = s."productId"),
l AS (
  UPDATE "product_stock_levels" lv SET "committed" = lv."committed" - q.qty
  FROM q WHERE lv."productId" = q."productId" AND lv."locationId" = q."locationId")
UPDATE "Order" o SET "stockShippedAt" = (now() AT TIME ZONE 'UTC'), "stockShipSource" = due.src
FROM due WHERE o.id = due.id;
```

- `SKIP LOCKED` để không tranh với webhook đang giữ khóa dòng đơn; đơn bị bỏ qua thì lượt sau lấy.
- Gian không còn hoạt động: nhả giữ ngay, không chờ hạn tuổi. Căn cứ: 4.147 đơn kẹt ở các gian này (mục 11.3). Em KHÔNG đặt hạn tuổi cho gian đang hoạt động: 12/11 không đơn nào quá 7 ngày, nhưng đơn đặt trước của sàn có thể hợp lệ lâu hơn, chưa có số để chọn ngưỡng.
- Nhịp chạy và cỡ lô (500) là mặc định em tự chọn; chỉnh sau khi có số của bản bóng.
- Đơn sàn đã ghi CANCELLED qua quét lô mà chưa từng được cộng lại sổ (lỡ webhook hủy) là lỗ có sẵn, lát 1 không sửa; lượt đối chiếu đếm và báo.

### 13.4. Ngày chuyển (một lần, ngay sau khi migration lên)

Một câu SQL theo lô, cùng hình dạng câu quét bù nhưng chiều ngược lại: lấy đúng tập của câu Chờ giao đang chạy trên prod (đơn PENDING / PROCESSED, đã trừ, chưa hủy, gian đang hoạt động không ngủ đông) → cộng `committedQuantity`, `committed`, đánh `stockCommittedAt = stockDeductedAt`. Đơn ngoài tập (đã giao, gian chết) không đụng. Chạy bằng worker qua bảng `maintenance_jobs` như việc điền mã vạch 05/11, xong là thôi.

### 13.5. Đối chiếu hằng đêm — điều kiện để sang lát 2

Ba phép so, ghi kết quả vào `maintenance_jobs` + log `[stock-committed-check]`, lệch thì BÁO, không tự sửa:

1. **Bộ đếm ↔ đơn:** `Product.committedQuantity` = tổng nhật ký trừ của các đơn đang giữ (theo chỉ mục mới). Lệch = sót một đường ghi.
2. **Bộ đếm ↔ câu Chờ giao** (`stock-awaiting-ship.ts`, tính theo `shippingStatus`, độc lập với các mốc mới). Lệch tạm thời do quét bù chưa tới là bình thường; lệch đứng yên qua hai đêm là lỗi.
3. **Theo vị trí:** tổng `committed` các vị trí = `committedQuantity` (shop có vị trí).

Kèm số đo cho lát sau: phân bố thời gian từ `stockCommittedAt` tới `stockShippedAt` (số 9.3 còn thiếu), tỉ lệ nguồn `HANDOVER` / `PLATFORM`, biên bản bàn giao sớm hơn trạng thái sàn bao lâu.

Điều kiện sang lát 2: phép 1 và 3 lệch 0 trong 7 đêm liên tiếp; phép 2 không có lệch đứng yên. Con số 7 đêm là em tự chọn (đủ một vòng tuần của đơn), chưa có căn cứ khác.

### 13.6. Test phải có trước khi push (trên DB thật, qua đúng các hàm)

- Chốt → giữ; giao → xuất; webhook giao bắn lại → không trừ hai lần.
- Đơn về lần đầu đã ở trạng thái đã giao → giữ rồi xuất, bộ đếm về 0.
- Hủy trước khi rời kho qua cả bốn đường (webhook, hủy tay, nhận lẻ, nhận tất cả) → nhả giữ đúng một lần.
- Hủy sau khi rời kho → bộ đếm không đổi (đã về 0 lúc xuất).
- Đơn trừ rải hai vị trí → `committed` từng vị trí đúng.
- Biên bản bàn giao xuất trước, webhook sàn tới sau → bỏ qua; và ngược lại.
- Quét bù: đơn SHIPPING do quét lô ghi; gian ngủ đông; gian mất kết nối; đơn đang bị webhook khóa thì bỏ qua.
- Xóa gian có đơn đang giữ → bộ đếm về 0.
- Hai webhook song song cùng đơn; hai đơn song song cùng mã.
- Bất biến sau mỗi ca: sổ, `holdQuantity`, số đẩy sàn y như trước khi có lát 1.

### 13.7. Không làm ở lát 1

- Không đổi màn nào, không đổi câu chữ, không thêm dòng Nhật ký kho, không đổi luật cộng lại tồn khi hủy sau giao (lát 2), không đổi Kiểm kê (lát 3).
- Cột "Chờ giao" trên Tổng kho vẫn chạy bằng câu cũ cho tới lát 3.
- Tắt khẩn: biến môi trường `STOCK_COMMITTED_OFF=1` → bốn chỗ ghi bỏ qua phần bộ đếm; bật lại thì chạy lại bước 13.4.

### 13.8. Rủi ro riêng của lát 1

| Rủi ro | Cách chặn |
|---|---|
| Thêm việc ghi vào đường nóng của webhook đơn | Lúc chốt: gộp vào câu UPDATE sẵn có, không thêm câu. Lúc giao: thêm một UPDATE mỗi mã. Đo thời gian giao dịch webhook trước / sau trên local với dữ liệu giả cỡ 400.000 đơn như 11/11. |
| Migration khóa bảng `Order` lúc deploy | Khuôn lấy khóa có thử lại; chỉ mục dựng tay `CONCURRENTLY` trước. |
| Supabase Disk IO | Ngày chuyển chỉ ghi ~3.700 dòng đơn; quét bù chạy trên chỉ mục vài nghìn dòng. |
| Biên bản bàn giao lập nhầm (kiện chưa đi) | Lát 1 chỉ là bộ đếm bóng nên chưa hại gì; số đo ở 13.5 cho biết có nên giữ nguồn này khi lên lát 3. |

### 13.9. ĐÃ CODE trên local 12/11/2026 (anh: "Code lát 1") — CHƯA commit, CHƯA lên prod

**Tệp**

| Tệp | Việc |
|---|---|
| `prisma/schema.prisma` + migration `20261112210000_stock_committed_shadow` | 5 cột + chỉ mục `Order_stock_committed_idx`; khối lấy khóa cả ba bảng một lệnh, có thử lại |
| `services/stock-ledger.ts` | `applyStockDelta` nhận `reserve`: cộng bộ đếm giữ trong CÙNG câu UPDATE trừ sổ; công tắc `stockCommittedOn()` |
| `integrations/order-stock.ts` | `deductStockTx` giữ + đánh mốc; `shipStockTx`, `releaseCommittedTx`, `hasLeftWarehouse` (mới); `restoreStockTx` nhả giữ trước khi cộng sổ |
| `services/stock-committed.ts` (mới) | theo lô: `shipOrdersTx` (bàn giao), `sweepShipped` (quét bù), `releaseCommittedOfChannel` (xóa gian), ngày chuyển, đối chiếu, `resetCommitted` |
| `workers/stock-committed.ts` (mới) + `workers/index.ts` | nhịp 2 phút: ngày chuyển (một lần) → quét bù → đối chiếu mỗi 24 giờ |
| `shopee/service.ts`, `tiktok/service.ts`, `lazada/service.ts` | sau `deductStockTx`: trạng thái đã giao thì `shipStockTx(…, "PLATFORM")` |
| `routes/orders.ts` | hủy tay + `restoreReturnStockTx` (nhận lẻ, nhận tất cả) gọi `releaseCommittedTx` |
| `routes/packing.ts` | lập Biên bản bàn giao → `shipOrdersTx(…, "HANDOVER")` |
| `services/channel-delete.ts` | nhả giữ của gian trước vòng xóa đơn |

**Lệch so với thiết kế ở trên (đã sửa trong lúc code, có lý do)**

1. **Hủy trước khi rời kho thì XÓA mốc `stockCommittedAt`** (không dựa vào `stockRestoredAt`). Nhờ vậy hàm nhả giữ tự chống lặp ở cả bốn đường hủy, và vị từ chỉ mục gọn lại: `stockCommittedAt IS NOT NULL AND stockShippedAt IS NULL`. Bất biến: bộ đếm = tổng nhật ký trừ của đúng các đơn thỏa vị từ này.
2. **Quét bù không còn là một câu SQL** mà là một giao dịch 4–5 câu cho cả lô (vẫn không lặp từng đơn): chọn đơn `FOR UPDATE SKIP LOCKED` → khóa dòng vị trí rồi dòng sản phẩm theo id tăng dần → cộng trừ → đánh mốc. Lý do: một câu CTE không bảo đảm thứ tự khóa, dễ khóa chéo với webhook đang trừ kho cùng mã.
3. **`deductStockTx` nay trừ các dòng hàng theo thứ tự mã cố định.** Trước đây theo thứ tự dòng đơn, hai đơn cùng chứa A và B ngược thứ tự có thể khóa chéo nhau. Đổi này chỉ đổi thứ tự dòng nhật ký trong một đơn.
4. **Cỡ lô mặc định 200** (thiết kế ghi 500), tối đa 20 lô mỗi nhịp; chỉnh bằng `STOCK_COMMITTED_BATCH`. Vẫn là số tự chọn.
5. **Chưa đo tự động thời gian từ lúc giữ tới lúc rời kho.** Không có đường đọc rẻ theo `stockShippedAt` (không chỉ mục, bảng 500 MB). Cột `stockShipSource` và hai mốc đã có trên từng đơn; khi cần thì đo một lần bằng câu đi từ nhật ký kho như mục 11.
6. Xóa gian: đơn đang giữ được đánh dấu rời kho với nguồn `CHANNEL_INACTIVE` (đằng nào cũng sắp bị xóa).
7. Tắt khẩn rồi bật lại: gọi tay `resetCommitted()` (về 0 mọi bộ đếm, gỡ mốc, xóa dấu "đã chuyển"); nhịp worker kế tiếp tự chạy lại ngày chuyển.

**Kiểm trên local**

- `npx tsc --noEmit` backend: sạch.
- Test mới `integrations/__tests__/stock-committed.test.ts`: 16 ca trên DB thật, qua đúng các hàm (chốt, rời kho, bắn lại, chưa thanh toán rồi chốt, hủy trước / sau khi rời kho, nhả giữ riêng, đơn nhiều mã, dòng chưa nối SKU, song song, công tắc khẩn, bàn giao cả lô, quét bù theo trạng thái, gian mất kết nối + ngủ đông, xóa gian, ngày chuyển, hai vị trí, đối chiếu bắt được số sai). Mọi ca đều kiểm sổ và `holdQuantity` đi y như trước.
- `tiktok-webhook-inbox.test.ts`: thêm kiểm bộ đếm ở ca chốt và ca hủy + 1 ca mới "chốt rồi IN_TRANSIT" đi qua webhook thật tới hàng đợi → 8 / 8.
- Chạy lại 12 tệp test kho sẵn có (chờ giao, chạy đua, chống lặp, vị trí, ô không bán, webhook Shopee, hàng đợi Lazada, ghi đơn, phân bổ, phiếu, sắp hết) + `app-return`: tất cả qua.
- `channel-delete-db.test.ts`: 3 / 6 ca ĐỎ, nhưng đỏ y hệt khi em tạm cất thay đổi của `channel-delete.ts` → có từ trước (sổ đơn trên DB dev), không do lát này.
- Câu chọn đơn của quét bù trên DB local đi qua `Order_stock_committed_idx` (đã xem kế hoạch chạy).
- Một nhịp worker chạy thử trên DB local: ngày chuyển xong, đối chiếu lệch 0, nhịp hai không làm gì.

**CHƯA kiểm**

- Chưa test qua route cho Biên bản bàn giao, hủy tay, nhận hàng hoàn (mới test các hàm bên dưới).
- Nhánh "đã giao" của Shopee và Lazada chưa có test đi qua webhook (TikTok có). Ba chỗ nối giống nhau từng dòng.
- Chưa đo trên dữ liệu lớn: thời gian giao dịch webhook trước / sau, quét bù với vài nghìn đơn.
- Ngày chuyển mới chạy trên dữ liệu test; DB local không có đơn chờ giao thật ở gian đang hoạt động.
- Chưa lên prod, chưa đối chiếu đêm nào.

**Trước khi push (theo đúng thứ tự, chạy tay ở Supabase SQL Editor, ngoài giờ cao điểm)**

1. Ba lệnh `ALTER TABLE … ADD COLUMN IF NOT EXISTS` trong tệp migration, từng lệnh, có `SET lock_timeout = '5s'`.
2. `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_stock_committed_idx" ON "Order" ("channelId") WHERE "stockCommittedAt" IS NOT NULL AND "stockShippedAt" IS NULL;` rồi kiểm `indisvalid`.
3. Push. Migration trong repo toàn `IF NOT EXISTS` nên bỏ qua. Khoảng 2 phút sau khi worker lên, log `[stock-committed] ngày chuyển XONG: đưa N đơn…` (N kỳ vọng quanh 3.700 theo số 12/11), sau đó một dòng `đối chiếu`.

Bước 1 là ghi lược đồ trên prod → cần anh gật như hôm qua với chỉ mục Chờ giao.

### 13.10. Prod ĐÃ CHUẨN BỊ 12/11/2026 ~15:05 (anh: "Chuẩn bị prod") — bước 1 + 2 xong, CHƯA push

Chạy qua Supabase SQL Editor trong Chrome. Trước khi chạy: Postgres 17.6, 3 phiên đang hoạt động, không giao dịch treo.

- **Thêm cột:** ba giao dịch riêng, mỗi bảng một lệnh (`BEGIN; SET LOCAL lock_timeout = '3s'; ALTER TABLE … ADD COLUMN IF NOT EXISTS …; COMMIT;`), thứ tự `product_stock_levels` → `Product` → `Order`. Cả ba báo thành công ngay lần đầu, không phải thử lại. Kiểm `information_schema`: đủ 5 cột, `committedQuantity` và `committed` là `integer NOT NULL DEFAULT 0`, ba cột trên `Order` là nullable.
- **Chỉ mục:** `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_stock_committed_idx" …` xong trong dưới 10 giây. Kiểm: `indisvalid = true`, `indisready = true`, cỡ 8 kB (chưa đơn nào có mốc giữ), định nghĩa đúng vị từ.
- **Kế hoạch chạy trên prod** của câu chọn đơn quét bù: `Index Scan using "Order_stock_committed_idx"`, không quét bảng.
- Mã đang chạy trên prod (bản cũ) không đọc các cột mới nên không bị ảnh hưởng.
- Chưa có số nào vào bộ đếm: việc đó chỉ bắt đầu sau khi push (worker chạy ngày chuyển).

**Thấy kèm trên trang Supabase (chỉ đọc, em không đổi gì):** tổ chức đang gắn nhãn "Exceeding usage limits". Trang Usage ghi: gói Pro, kỳ 27/10 → 27/11, "You have exceeded your Pro Plan quota in this billing cycle. Disable your spend cap to continue using Supabase without restrictions." Các mục em đọc được: Egress 147 / 250 GB (59 %), Disk Size 740 GB-Hrs, Small Compute 365 giờ ($7,52), Micro Compute 26 giờ ($0,35); các mục khác gần 0. Em CHƯA xác định mục nào vượt và Supabase sẽ hạn chế gì — cần anh xem.

**Còn lại:** anh push master → sau ~2 phút soi log worker `[stock-committed]` (dòng "ngày chuyển XONG: đưa N đơn…", N kỳ vọng quanh 3.700; rồi dòng "đối chiếu").

### 13.11. ĐÃ PUSH 12/11/2026 ~15:17 (anh: "Em push luôn lên nhé") — lát 1 ĐANG CHẠY BÓNG trên prod

- Push `5b17d56b..6bf5eaf6`. Backend `/health` báo đúng bản `6bf5eaf6` sau 120 giây. Migration `20261112210000_stock_committed_shadow` ghi hoàn tất, không rollback (cột và chỉ mục đã có nên các lệnh bỏ qua).
- **15:21** (trước nhịp đầu của worker): đã có 1 đơn mới tự vào bộ đếm → đường ghi lúc đơn chốt chạy trên prod.
- **15:22:00 ngày chuyển XONG: 3.776 đơn** đang chờ giao vào bộ đếm (số đo 12/11 sáng là 3.702).
- **15:22:02 đối chiếu lần đầu** (đọc từ `maintenance_jobs`, chỉ đọc):

  | Phép so | Kết quả |
  |---|---|
  | Bộ đếm ↔ tính lại từ đơn đang giữ | 520 = 520, lệch 0 mã |
  | Theo vị trí | lệch 0 |
  | Bộ đếm ↔ cách tính của cột "Chờ giao" | 520 = 520, lệch 0 mã |
  | Đơn đang giữ | 3.778 đơn của 52 chủ shop |
  | Đơn đã hủy còn giữ | 0 |
  | Đơn giữ lâu nhất | 118 giờ (gần 5 ngày) |
  | Bộ đếm âm | 0 mã |

  520 sản phẩm trên 3.778 đơn: phần lớn đơn thuộc shop chưa nối sản phẩm kho nên không có nhật ký trừ (khớp với nhận xét 11/11).
- Em đọc kết quả qua bảng `maintenance_jobs` và bộ đếm trên Supabase; CHƯA đọc log Render của worker, CHƯA thấy lượt quét bù nào chạy thật (mới 1 nhịp), CHƯA có Biên bản bàn giao nào đi qua đường mới.
- **Từ đây:** mỗi 24 giờ worker tự đối chiếu và ghi đè dòng `stock-committed-check` (cột `processed` = số chỗ lệch cứng, `cursor` = chi tiết). Đủ 7 lần liên tiếp lệch cứng 0 (tức khoảng 19/11) thì sang lát 2. Lưu ý bảng chỉ giữ LẦN ĐỐI CHIẾU CUỐI, không giữ lịch sử: muốn chắc "7 đêm liên tiếp" phải soi mỗi ngày hoặc đọc log `[stock-committed] đối chiếu` trên Render.

### 13.12. Nhật ký đối chiếu hằng ngày (lịch tự soi `kho-chuan-quoc-te-soi-doi-chieu`, 16:00 mỗi ngày 13 → 19/11/2026)

Bảng `maintenance_jobs` chỉ giữ lần đối chiếu cuối, nên mỗi ngày ghi lại một dòng ở đây. "Lệch cứng" = lệch mã + lệch vị trí, PHẢI bằng 0. "Đã giao chưa quét" = đơn đang giữ mà trạng thái đã Đang giao / Đã giao tại lúc soi; quét bù chạy 2 phút một lần nên số này phải nhỏ (vài đơn), lớn và không giảm là worker không chạy.

| Ngày soi | Lần đối chiếu (giờ VN) | Lệch cứng | Bộ đếm = từ đơn | Lệch với "Chờ giao" | Đơn đang giữ | Đã hủy còn giữ | Đã giao chưa quét | Bộ đếm âm | Ghi chú |
|---|---|---|---|---|---|---|---|---|---|
| 12/11 | 12/11 15:22 | 0 | 520 = 520 | 0 | 3.778 | 0 | chưa đo | 0 | lần đầu, ngay sau ngày chuyển |
| 13/11 (soi 19:51) | 13/11 15:22 | 0 | 337 = 337 | 0 | 1.151 | 0 | 0 | 0 | ĐẠT, lần 2/7. Lúc soi còn 784 đơn đang giữ, bộ đếm 162. Đơn đang giữ giảm mạnh so với 12/11 (3.778 → 1.151 cùng giờ); em đoán là hàng dồn sau đợt 11/11 đã giao hết, CHƯA kiểm nguyên nhân. Đơn giữ lâu nhất 135 giờ. |
| 14/11 (soi 16:10) | 13/11 15:22 (chưa có lần mới) | 0 | 337 = 337 | 0 | 1.151 | 0 | 0 | 0 | KHÔNG TÍNH, chuỗi giữ 2/7: dòng đối chiếu vẫn là lần 13/11, cách 25 giờ (≤ 26 nên chưa coi là worker hỏng, nhưng lẽ ra đã có lần 14/11 ~15:22; em đoán worker khởi động lại làm lệch nhịp 24 giờ, CHƯA kiểm log). Số sống lúc soi: 732 đơn đang giữ, bộ đếm 231, bộ đếm âm 0. Mai vẫn là 13/11 → xem log Render. |
| 15/11 (soi 19:48) | 14/11 16:59 (lần mới so với lượt soi 14/11; CHƯA có lần 15/11) | 0 | 155 = 155 | 0 | 672 | 0 | 0 | 0 | Lần đối chiếu 14/11 16:59 sạch → chuỗi đối chiếu lệch cứng 0 là 3/7 (12/11, 13/11, 14/11). NHƯNG NHỊP TRỄ, lượt soi hôm nay KHÔNG ĐẠT tiêu chí "cách ≤ 26 giờ": dòng cách 27 giờ, lần 15/11 lẽ ra chạy ~17:01 mà 19:48 vẫn chưa có. Các lần: 12/11 15:22 → 13/11 15:22 → 14/11 16:59 (trễ 1 giờ 37 phút) → 15/11 trễ hơn 2 giờ 47 phút. Theo mã (`workers/stock-committed.ts`), nhịp 2 phút nào cũng hỏi "đủ 24 giờ chưa" nên lẽ ra chỉ trễ ≤ 2 phút; em ĐOÁN `runCommittedCheck` lỗi (quá giờ câu lệnh?) và nhịp sau thử lại, hoặc worker khởi động lại liên tục — CHƯA kiểm log. Quét bù có vẻ vẫn chạy (đã giao chưa quét 0). Số sống lúc soi: 842 đơn đang giữ, bộ đếm 639, bộ đếm âm 0. Cần anh xem log Render `hubsell-worker-sg`, từ khóa `stock-committed` (dòng `lỗi một nhịp`). Đơn giữ lâu nhất 128 giờ. |
| 16/11 (soi ~16:00) | 14/11 16:59 (chưa có lần mới) | 0 | 155 = 155 | 0 | 672 | 0 | 0 | 0 | KHÔNG TÍNH, chuỗi giữ 3/7: dòng đối chiếu vẫn là lần 14/11, cách 47 giờ (> 26). Đã biết trước (mục 13.13 + 13.14: quét bù lỗi đứng trước bước đối chiếu; 15/11 20:30 đã giãn nhịp 1 giờ/lần bằng `STOCK_COMMITTED_SWEEP_MS`), không phải tin mới; từ lúc giãn nhịp tới giờ (~19,5 giờ) vẫn chưa có lần đối chiếu nào chạy được — CHƯA đọc log Render hôm nay. Số sống lúc soi: 567 đơn đang giữ, bộ đếm 428, bộ đếm âm 0, đã giao chưa quét 0, đã hủy còn giữ 0 → bộ đếm chưa có dấu hiệu sai. Anh đã chốt đợi hết 19/11. |
| 17/11 (soi 16:10) | 14/11 16:59 (chưa có lần mới) | 0 | 155 = 155 | 0 | 672 | 0 | 0 | 0 | KHÔNG TÍNH, chuỗi giữ 3/7: dòng đối chiếu vẫn là lần 14/11, cách 71 giờ (> 26). Đã biết (13.13 + 13.14), không phải tin mới; ~44 giờ sau khi giãn nhịp 1 giờ/lần vẫn chưa có lần đối chiếu nào — CHƯA đọc log Render. Số sống lúc soi: 276 đơn đang giữ, bộ đếm 210, bộ đếm âm 0, đã giao chưa quét 0, đã hủy còn giữ 0. Còn 2 lượt (18, 19/11) mà cần thêm 4 lần → chuỗi 7/7 KHÔNG thể đủ trong lịch này. |
| 18/11 (soi tối) | 14/11 16:59 (chưa có lần mới) | 0 | 155 = 155 | 0 | 672 | 0 | 0 | 0 | KHÔNG TÍNH, chuỗi giữ 3/7: dòng đối chiếu vẫn là lần 14/11, cách 99 giờ (> 26). Đã biết (13.13 + 13.14), không phải tin mới; ~3 ngày sau giãn nhịp vẫn chưa có lần đối chiếu nào — CHƯA đọc log Render. Số sống lúc soi: 216 đơn đang giữ, bộ đếm 140, bộ đếm âm 0, đã giao chưa quét 0, đã hủy còn giữ 0. Còn 1 lượt (19/11). |
| 19/11 (soi ~18:00) | 14/11 16:59 (chưa có lần mới) | 0 | 155 = 155 | 0 | 672 | 0 | 0 | 0 | KHÔNG TÍNH, chuỗi DỪNG ở 3/7 — LƯỢT CUỐI của lịch: dòng đối chiếu vẫn là lần 14/11, cách 121 giờ (> 26). Đã biết (13.13 + 13.14), không phải tin mới; ~4 ngày sau giãn nhịp vẫn chưa có lần đối chiếu nào — CHƯA đọc log Render. Số sống lúc soi: 212 đơn đang giữ, bộ đếm 133, bộ đếm âm 0, đã giao chưa quét 0, đã hủy còn giữ 0 → bộ đếm chưa có dấu hiệu sai. KHÔNG đủ điều kiện sang lát 2; việc kế = anh quyết mục 13.14 (thiết kế lại lát 1, chuỗi 7 lần đếm lại). |

Đủ 7 dòng liên tiếp lệch cứng 0 (dòng 12/11 tính là dòng 1) → trình anh lát 2. Có dòng lệch cứng khác 0 → dừng đếm, soi nguyên nhân trước, KHÔNG tự sửa số trên prod.

### 13.13. Nhịp đối chiếu trễ: câu QUÉT BÙ quét cả bảng đơn (soi 15/11 ~20:00, anh: "Em xem đi") — CHƯA SỬA, chờ anh

**Đã kiểm (chỉ đọc: log Render `hubsell-worker-sg`, `pg_stat_statements`, EXPLAIN trên prod):**

- Log worker: `[stock-committed] lỗi một nhịp, nhịp sau làm lại` đều 2 phút một lần (thấy liên tục 18:17 → 19:55 ngày 15/11; trước 18:17 chưa cuộn xem). Lý do Prisma ghi: `Transaction already closed … The timeout for this transaction was 5000 ms, however 22625 / 25435 ms passed`.
- Giao dịch đó là `sweepShippedBatch` (quét bù). Trong `runStockCommittedTick`, quét bù chạy TRƯỚC `checkIfDue` trong cùng một `try` → quét bù lỗi thì nhịp đó không đối chiếu. Đây là lý do lần 14/11 trễ 1 giờ 37 phút và lần 15/11 chưa có.
- EXPLAIN câu chọn đơn của quét bù trên prod: `Index Scan using "Order_pkey"` + lọc, KHÔNG dùng `Order_stock_committed_idx`. Máy lập kế hoạch tưởng có 5.889 đơn đang giữ / 5.380 đơn cần quét (thật: 848 đang giữ, 0 cần quét) nên chọn đi dọc khóa chính theo `ORDER BY o."id" LIMIT` — không có dòng khớp thì đi hết bảng đơn. Đúng bẫy đã ghi: không `ORDER BY id LIMIT` trên bảng Order. (12/11 mục 13.10 kiểm thấy câu này đi qua chỉ mục — kế hoạch đã đổi theo thống kê bảng.)
- `pg_stat_statements` cho đúng câu đó: **2.296 lần gọi, trung bình 9,8 giây, lâu nhất 41,8 giây, tổng 22.403 giây (≈ 6,2 giờ), 59,6 triệu khối đọc từ đĩa**. 2.296 lần ≈ mỗi 2 phút từ 12/11 → chậm từ ngày đầu, nhịp nào dưới 5 giây thì qua, trên 5 giây thì lỗi.
- Log 7 ngày: đối chiếu chạy đúng 3 lần (12/11 15:22:02, 13/11 15:22:20, 14/11 16:59:23), cả 3 lệch 0. Quét bù có dòng ghi lần cuối 14/11 16:59:21 (16 đơn của gian không còn hoạt động).
- Lúc soi: 848 đơn đang giữ, 0 đơn thuộc gian không hoạt động, 0 đơn đã giao chưa quét → bộ đếm CHƯA sai, nhưng quét bù đang không làm được việc khi có đơn cần quét.

**Hệ quả:** (1) chuỗi 7 lần đối chiếu đứng lại ở 3/7; (2) quét bù hỏng → đơn giao qua đường không đụng kho sẽ dồn lại trong bộ đếm; (3) database chịu một lượt quét bảng đơn ~10–25 giây mỗi 2 phút — tải đọc đĩa lớn trên Supabase (liên quan sự cố Disk IO 28/10), CHƯA đo IO balance hiện tại.

**Hướng sửa em đề xuất (CHƯA code) — ⚠️ mục 1 dưới đây em ĐÃ RÚT LẠI cùng tối 15/11, xem 13.14:**

1. Viết lại câu chọn đơn của `sweepShippedBatch`: gom tập đơn đang giữ vào CTE `MATERIALIZED` (chỉ vị từ của chỉ mục một phần, không `ORDER BY` / `LIMIT`), rồi mới nối `Channel`, lọc, sắp xếp, cắt lô, và khóa dòng ở câu ngoài. EXPLAIN dạng này trên prod 15/11: `Index Scan using "Order_stock_committed_idx"` — đi qua chỉ mục (mới xem kế hoạch, chưa đo thời gian chạy thật).
2. Tách `checkIfDue` ra `try` riêng để quét bù lỗi không chặn đối chiếu (và ngược lại).
3. Xem cùng dạng `ORDER BY o."id" LIMIT … FOR UPDATE` ở `cutoverCommittedBatch` và `releaseCommittedOfChannel` (hai câu này có điều kiện khác, chưa EXPLAIN).
4. Thêm ca test + EXPLAIN lại trên prod sau khi lên.

Tạm thời không cần đổi mã: đặt `STOCK_COMMITTED_SWEEP_MS=3600000` trên Render (nhịp 1 giờ thay vì 2 phút) sẽ giảm tải quét ~30 lần, nhưng không chữa gốc. KHÔNG nên tắt `STOCK_COMMITTED_OFF=1` (bật lại phải `resetCommitted`, mất chuỗi).

### 13.14. Rà soát theo mô hình shop lớn (15/11 tối, anh: "xem kế hoạch cho mô hình shop lớn có bị ảnh hưởng không, không đi vá lẻ") — ĐỀ XUẤT, anh chưa duyệt, CHƯA code

**Kết luận: CÓ ảnh hưởng, và hướng sửa số 1 ở mục 13.13 (CTE MATERIALIZED) em RÚT LẠI vì chính nó là vá lẻ.** Ba lỗ ở tầng thiết kế:

**Lỗ 1 — cách đánh dấu "đơn đang giữ" bằng HAI cột làm database ước lượng sai có hệ thống, và sai tăng dần theo thời gian.**

- Vị từ `stockCommittedAt IS NOT NULL AND stockShippedAt IS NULL`. Máy lập kế hoạch nhân hai tỉ lệ như thể độc lập: (đơn từng được giữ) × (đơn chưa có mốc xuất). Đo prod 15/11 (`pg_stats`): 0,63 % × 99,45 % × 939.972 dòng = 5.889 — khớp đúng con số trong EXPLAIN; thật chỉ 848.
- Đối chiếu ca thứ hai cùng công thức: tập "Chờ giao" (`Order_stock_awaiting_ship_idx`): 39,25 % × 0,87 % × 99,54 % = 3.195 — cũng khớp EXPLAIN.
- "Đơn từng được giữ" chỉ tăng (mọi đơn có trừ kho từ 12/11 đều đi qua), nên ước lượng sẽ leo từ 0,6 % lên hàng chục % của bảng trong vài tháng, dù tập thật vẫn chỉ ~1.000 đơn. ANALYZE không chữa được (thống kê đang mới: autoanalyze 15/11 18:32).
- Hệ quả: mọi câu dựa vào vị từ này (quét bù, đối chiếu hằng đêm, và các màn lát 2–3 sẽ đọc "đơn đang giữ") đều có ngày bị chọn kế hoạch quét cả bảng. CTE MATERIALIZED chỉ gỡ được cái bẫy `ORDER BY id LIMIT` hôm nay; khi ước lượng đủ lớn máy sẽ chọn quét tuần tự cả bảng thay cho chỉ mục một phần. Phần "khi nào lật" là em SUY từ công thức ước lượng (đã khớp 2 ca trên prod), CHƯA thử điểm lật.

**Lỗ 2 — quét bù là "dò cả tập mỗi 2 phút để tìm việc hiếm".** Chi phí theo cỡ tập đang giữ (hoặc cả bảng khi kế hoạch sai), không theo số việc cần làm. Hôm nay 848 đơn; khách 12.000 đơn/ngày thêm ~12–25 nghìn; ở giả thuyết 1 triệu đơn/ngày là 1–2 triệu đơn mỗi lượt. Trái với nguyên tắc đã có ở `KIEN-TRUC-QUY-MO-TRIEU-DON.md` mục 6.3 ("webhook là đường chính, quét định kỳ là lưới an toàn") và khuôn K5.

**Lỗ 3 — kiến trúc quy mô lớn chưa có hàng rào và đèn báo cho loại lỗi này.** Lỗi chạy 3 ngày, ngốn ≈ 6,2 giờ thời gian database, không dấu hiệu nào trên HQ đỏ; chỉ lộ nhờ lịch soi cho việc khác. Mục 6.9 (quan sát) không có "câu lệnh chậm" hay "worker lỗi lặp"; mục 6.10 (hàng rào) không có gì về kế hoạch câu lệnh. Luật "không `ORDER BY id LIMIT` trên Order" đã nằm trong memory từ 10/11 mà vẫn tái phạm → luật ghi nhớ không phải hàng rào.

**Số đo prod 15/11 (chỉ đọc; `pg_stat_statements` tính từ 12/10):**

| Mục | Số |
|---|---|
| Bảng `Order` | 939.972 dòng, 511 MB + 391 MB chỉ mục |
| Câu quét bù (3,2 ngày) | 2.300 lần, TB 9,8 giây, 22.510 giây ≈ 7.000 giây/ngày |
| Câu nặng kế tiếp (34 ngày) | 31.626 giây ≈ 930 giây/ngày → quét bù đang nặng gấp ~7 lần |
| Đọc đĩa của quét bù | 59,8 triệu khối trong 3,2 ngày; cả hệ thống ≈ 1.445 triệu khối trong 34 ngày |
| Câu khác TB > 1,5 giây, > 200 lần gọi | 11 câu, CHƯA soi: 3 dạng đọc `Channel` (TB 3,2–6,6 giây), đếm `Order` có OFFSET (TB 4,1 giây, max 103 giây), 2 câu gộp toàn bảng `Order` theo tháng (TB 2,0–2,4 giây), cập nhật giá vốn `OrderItem` (TB 4,3 giây), đếm `webhook_events` (TB 3,3 giây)… |

**Với khách 10–12 nghìn đơn/ngày:** bảng đơn thêm ~360.000 dòng/tháng, nạp lịch sử có thể làm bảng gấp đôi ngay → mỗi lượt quét sai kế hoạch dài gấp đôi (20–50 giây mỗi 2 phút). Tức là lỗi này lớn theo đúng thứ mình sắp thêm vào.

**Hướng em đề xuất (thứ tự làm):**

0. **Cầm máu, không phải sửa:** giãn `STOCK_COMMITTED_SWEEP_MS=3600000` trên Render → tải quét giảm ~30 lần. Đối chiếu vẫn sẽ không chạy đều; chấp nhận, vì chuỗi 7 lần phải ĐẾM LẠI sau khi đổi thiết kế.
1. **Sửa thiết kế lát 1** (viết thiết kế trình anh trước, có thử trên DB local):
   - Một dấu DUY NHẤT cho "đang giữ": một cột chỉ khác NULL trong lúc giữ (đặt lúc chốt, xóa về NULL trong cùng câu UPDATE đánh mốc xuất) + chỉ mục một phần trên đúng cột đó → ước lượng lấy từ một cột nên sát thật, không thêm lệnh ghi trên đường nóng. Phương án kia: bảng nhỏ riêng chứa đơn đang giữ (chắc hơn nữa nhưng thêm 2 lệnh ghi mỗi đơn). Em nghiêng một cột; chốt sau khi thử.
   - Nhả giữ THEO SỰ KIỆN: gian ngắt kết nối / ngủ đông → nhả đơn của gian đó ngay tại sự kiện; các đường đổi trạng thái giao không qua kho → gọi `shipStockTx` tại chỗ ghi. Quét bù lùi về lưới an toàn chạy thưa. CHƯA đếm chính xác có bao nhiêu đường ghi trạng thái giao.
   - Đối chiếu tách khỏi quét bù (lỗi bên này không chặn bên kia).
   - Thử trước khi code: DB local dữ liệu giả với ~50 % đơn "đã từng giữ" → chứng minh thiết kế cũ lật kế hoạch và thiết kế mới không lật.
2. **Bổ sung hai hàng rào chung vào kiến trúc quy mô lớn** (mục 6.9 + 6.10): (a) HQ Sức khỏe thêm dấu hiệu "câu lệnh chậm" đọc từ `pg_stat_statements` và "worker lỗi lặp" (đếm ở database, không ở RAM); (b) test kế hoạch câu lệnh cho các câu worker chạy định kỳ trên bảng lớn, chạy trên dữ liệu giả có phân bố xấu.
3. **Soi 11 câu chậm còn lại**, phân loại "lớn theo một shop" hay "lớn theo cả hệ thống", trước khi khách lớn nối gian.

**Hệ quả với lộ trình kho:** lát 2 lùi lại; chuỗi 7 lần đối chiếu đếm lại từ đầu sau khi thiết kế mới lên.

**Khách có bị ảnh hưởng không (anh hỏi 15/11 ~20:30; đo trang Observability → Database của Supabase, 60 phút gần nhất 19:26–20:26):** CPU database rảnh 50–85 %, phần bận lớn nhất là chờ đĩa (IOwait ~10–25 %), IOPS trung bình ~902. Database CHƯA nghẽn → lúc này không có bằng chứng khách thấy chậm. Nhịp quét bù tự nó không đổi gì ở phía khách (bản bóng: không màn nào đọc bộ đếm, số đẩy sàn không dùng); ảnh hưởng chỉ có thể là gián tiếp, qua việc ăn phần đọc đĩa dùng chung. CHƯA đo: số dư Disk IO (trang này không hiện), thời gian phản hồi các màn của khách, giờ cao điểm ban ngày.

**Anh chốt 15/11 tối: "Phần kho mình vẫn đang chạy bóng hẹn 19/11. Đợi xong rồi làm."** → KHÔNG viết thiết kế, KHÔNG code lát 1 trước khi hết lịch 19/11. Lịch soi 16–19/11 vẫn chạy và ghi dòng vào 13.12. Em đã nêu với anh hai điều (anh chưa trả lời): (1) tới 19/11 chuỗi sẽ KHÔNG đủ 7/7 vì quét bù lỗi chặn đối chiếu, nên bản bóng không tự "xong" vào 19/11; (2) trong lúc đợi, câu quét bù vẫn quét bảng đơn mỗi 2 phút — việc giãn nhịp bằng `STOCK_COMMITTED_SWEEP_MS` (bước 0) là đổi cấu hình, không đụng mã, chờ anh cho phép.

**✅ Bước 0 ĐÃ LÀM 15/11 20:30 (anh: "Giãn nhịp đi"):** thêm biến môi trường `STOCK_COMMITTED_SWEEP_MS=3600000` cho dịch vụ `hubsell-worker-sg` trên Render (trang Environment → "Save and deploy", không dựng lại; deploy `dep-dbsr7njl550s7398qelg` thành công sau ~15 giây, bản mã không đổi). Chỉ worker, không đụng dịch vụ web. Từ đây quét bù + bước kiểm "đã tới hạn đối chiếu chưa" chạy 1 giờ một lần (nhịp đầu ~2 phút sau mỗi lần worker khởi động). Gỡ: xóa biến này rồi deploy lại là về 2 phút. Kiểm log sau khi đổi (đọc tới 20:37:24): bản worker mới chạy nhịp đầu lúc 20:33:04 (vẫn `lỗi một nhịp`, vì câu quét bù chưa sửa), sau đó KHÔNG có nhịp 20:35 → nhịp đã giãn; nhịp kế dự kiến ~21:33 (chưa xem). Trước khi đổi, lỗi lặp đều 2 phút tới 20:29:43.

**19/11: phép thử ở mục 14.2 BÁC một suy đoán của mục này.** Ở Lỗ 1 em viết "khi ước lượng đủ lớn máy sẽ chọn quét tuần tự cả bảng thay cho chỉ mục một phần", kể cả với câu CTE MATERIALIZED. Thử tới mức 50 % đơn "đã từng giữ" thì câu CTE vẫn đi qua chỉ mục một phần. Phần còn đúng: ước lượng sai tăng theo đúng công thức, và mọi câu có `ORDER BY id LIMIT` hoặc nối bảng trên tập này đều xấu dần. Thiết kế ở mục 14 đã sửa theo kết quả thử.

## 14. Thiết kế lại lát 1 (19/11/2026, anh: "Viết thiết kế") — ĐỀ XUẤT, chờ anh duyệt, CHƯA code

Hết hạn chạy bóng 19/11 với chuỗi dừng ở 3/7 (mục 13.12). Mục này thay phần "Hướng em đề xuất" số 1 của 13.14. Mọi con số dưới đây đo trên DB local bằng `backend/scripts/stock-committed-plan-probe.ts`; chưa đo gì thêm trên prod hôm nay.

### 14.1. Tóm tắt thay đổi so với bản đang chạy

| # | Bản đang chạy (12/11) | Bản mới | Vì sao |
|---|---|---|---|
| 1 | "Đang giữ" = `stockCommittedAt` có VÀ `stockShippedAt` trống | "Đang giữ" = `stockCommittedAt` có. Lúc rời kho, cùng câu UPDATE ghi `stockShippedAt` và XÓA `stockCommittedAt` | Máy ước lượng từ một cột thì sát thật ở mọi mức (14.2 bảng 1) |
| 2 | Chỉ mục `Order_stock_committed_idx ("channelId")` theo hai cột | `Order_stock_held_idx ("channelId", "id") WHERE "stockCommittedAt" IS NOT NULL`; bỏ chỉ mục cũ | Câu đọc theo từng gian có `ORDER BY id` lấy thứ tự thẳng từ chỉ mục (14.2 bảng 3) |
| 3 | Câu quét bù: lọc "đang giữ" + trạng thái + gian, `ORDER BY id LIMIT` trong MỘT câu | Gom tập đang giữ trước (CTE MATERIALIZED, không `LIMIT` bên trong), lọc và cắt lô ở ngoài; tách hai nhánh thành hai câu | Một cột CHƯA đủ: ở 20.000 đơn giữ, câu dạng cũ vẫn đi dọc cả bảng (14.2 bảng 3) |
| 4 | Đơn rời kho qua quét lô / làn đọc con trỏ / sửa tay chỉ được quét bù bắt | Gọi rời kho ngay tại chỗ ghi trạng thái, trong hàm ghi đơn dùng chung của từng sàn (14.4) | Quét bù lùi về lưới an toàn |
| 5 | Quét bù 2 phút/lần, đứng trước đối chiếu trong cùng một `try` | Quét bù 1 giờ/lần; đối chiếu chạy `try` riêng, lịch riêng | Lỗi bên này không chặn bên kia (gốc của chuỗi 3/7) |
| 6 | Bảng chỉ giữ lần đối chiếu cuối, phải soi tay mỗi ngày | Dòng đối chiếu tự đếm số lần liên tiếp lệch 0 | Không cần lịch soi nữa |

Không đổi: năm cột đã thêm trên prod, cách cộng bộ đếm lúc đơn chốt, mọi con số khách thấy, số đẩy sàn. Vẫn là bản bóng.

`stockCommittedAt` bị xóa lúc rời kho không làm mất thông tin: giá trị của nó luôn bằng `stockDeductedAt` (`deductStockTx` ghi cùng một `now`, ngày chuyển ghi `= stockDeductedAt`; đã đọc mã 19/11).

### 14.2. Phép thử trên DB local (19/11)

Bảng đơn giả 470.000 dòng (nửa prod), 230 MB, mỗi dòng rộng như prod; đơn "đã từng giữ" là các đơn mới nhất; 285 gian sống. Thử năm mức "đã từng giữ" từ 0,63 % (đúng mức prod 15/11) tới 50 %, hai giá trị `random_page_cost` (4 và 1,1). Ba cách đánh dấu: hai cột (đang chạy), một cột (A), bảng nhỏ riêng chỉ chứa đơn đang giữ (B). Lệnh chạy lại:

```
npx tsx scripts/stock-committed-plan-probe.ts
npx tsx scripts/stock-committed-plan-probe.ts --held 20000 --due 20 --fractions 0.2,0.5
```

**Bảng 1 — máy ước lượng tập đang giữ bao nhiêu dòng (thật: 424).**

| Đã từng giữ | Hai cột | Hai cột + thống kê mcv | Hai cột + thống kê biểu thức | Một cột (A) | Bảng riêng (B) |
|---|---|---|---|---|---|
| 0,63 % | 2.852 | 2.820 | 2.930 | 454 | 424 |
| 2 % | 9.642 | 9.220 | 9.522 | 580 | 424 |
| 5 % | 22.097 | 21.904 | 21.812 | 548 | 424 |
| 10 % | 41.973 | 42.582 | 42.745 | 407 | 424 |
| 50 % | 117.646 | 117.732 | 117.745 | 423 | 424 |

Ở 0,63 % máy local đoán gấp 6,7 lần thật; prod 15/11 là 5.889 / 848 = 6,9 lần. Cùng một hiện tượng. Hai cách "chữa rẻ" bằng `CREATE STATISTICS` không đổi được ước lượng.

**Bảng 2 — số khối 8 kB mỗi câu phải đụng, 424 đơn đang giữ, không có đơn nào cần quét bù** (`random_page_cost` 4; cả bảng đơn ≈ 29.400 khối).

| Câu | Hai cột, 0,63 % | Hai cột, 50 % | Một cột, 0,63 % | Một cột, 50 % | Bảng riêng, 50 % |
|---|---|---|---|---|---|
| Quét bù, dạng đang chạy | 33.070 | 34.037 | 89 | 702 | 2.552 |
| Quét bù, dạng CTE | 89 | 89 | 89 | 89 | chưa thử |
| Đếm đơn đang giữ | 87 | 87 | 87 | 87 | 4 |
| Đối chiếu (nối nhật ký kho) | 120 | 2.641 | 120 | 1.784 | 1.701 |
| Đọc đơn đang giữ của một gian | 113 | 33.241 | 113 | 88 | 57 |

Câu quét bù dạng đang chạy đi dọc khóa chính cả bảng ở mọi mức với hai cột. Với `random_page_cost` 1,1 nó thoát ở mức 0,63 % nhưng dính lại từ 2 %. Câu đọc một gian của hai cột lật sang đi dọc cả bảng từ mức 5 % (10 % nếu `random_page_cost` 1,1). Câu đối chiếu của hai cột ở mức 50 % chạy 214 ms, của một cột 3,7 ms trên cùng dữ liệu, vì máy tưởng tập lớn nên đọc hết nhật ký kho.

**Bảng 3 — cỡ shop lớn: 20.000 đơn đang giữ, 20 đơn cần quét bù, đã từng giữ 50 %.**

| Câu | Hai cột | Một cột, chỉ mục (gian) | Một cột, chỉ mục (gian, mã đơn) | Bảng riêng |
|---|---|---|---|---|
| Quét bù, dạng đang chạy | 73.209 | 73.209 | 73.209 | 120.309 |
| Quét bù nhánh "đã giao", `ORDER BY id LIMIT` | 33.209 | 33.209 | 33.209 | chưa thử |
| Như trên, bỏ `ORDER BY` | 30.375 (quét tuần tự) | 30.375 | 30.375 | chưa thử |
| Quét bù, dạng CTE | 4.022 | 4.022 | 4.125 | chưa thử |
| Quét bù nhánh "gian ngắt", câu riêng | 33.759 | 32 | 32 | chưa thử |
| Đọc đơn đang giữ của một gian | 30.010 | 30.010 | 870 | 547 |
| Đếm đơn đang giữ | 4.020 | 4.020 | 4.123 | 167 |
| Đối chiếu (nối nhật ký kho) | 6.574 | 6.566 | 6.669 | 2.880 |

**Năm điều rút ra:**

1. Đánh dấu bằng hai cột làm ước lượng phồng theo đúng tỉ lệ đơn "đã từng giữ"; thống kê mở rộng không chữa được. Một cột cho ước lượng lệch dưới 40 % ở cả năm mức.
2. Một cột CHƯA đủ cho câu quét bù. Ở 20.000 đơn giữ, máy nhân tiếp "đang giữ" với "trạng thái đã giao" như hai điều độc lập (đoán 16.000 đơn cần quét, thật 20), nên `LIMIT` lại kéo nó sang đi dọc khóa chính hoặc quét tuần tự. Chỉ dạng "gom tập đang giữ trước, cắt lô sau" là đứng vững: chi phí theo cỡ tập đang giữ (4.022 khối cho 20.000 đơn).
3. Chỉ mục một cột `("channelId")` chưa đủ cho câu đọc theo gian có `ORDER BY id LIMIT`: gian có 3.000 đơn giữ là đi dọc cả bảng. Chỉ mục `("channelId", "id")` đưa về 870 khối.
4. Bảng riêng (B) đếm rẻ nhất nhưng quét bù đắt nhất (120.309 khối: mỗi đơn giữ phải nhảy về bảng đơn qua khóa chính để xem trạng thái), và thêm hai lệnh ghi mỗi đơn. Em chọn một cột.
5. Em nói sai ở 13.14: câu CTE trên hai cột KHÔNG lật sang quét cả bảng (89 khối ở mọi mức, 4.022 khối ở 20.000 đơn giữ). Tức là hướng "vá CTE" em rút lại hôm 15/11 thật ra chữa được câu quét bù. Nó không chữa được ba câu còn lại (đọc theo gian, đối chiếu, và mọi câu lát 2–3 sẽ viết trên tập này), nên em vẫn đề xuất đổi sang một cột, và dùng dạng CTE cho quét bù.

### 14.3. Ba luật viết câu đọc tập "đang giữ"

1. Vị từ duy nhất là `"stockCommittedAt" IS NOT NULL`, khai ở một hằng dùng chung, khớp từng chữ với chỉ mục.
2. Không đặt `LIMIT` cùng tầng với một điều kiện lọc thêm trên tập này (trạng thái, gian). Gom tập trong CTE `MATERIALIZED` trước, lọc và cắt ở ngoài.
3. `ORDER BY "id"` chỉ dùng khi đã cố định `"channelId"` (thứ tự lấy từ chỉ mục). Câu toàn nền tảng không sắp xếp trong SQL; cần thứ tự khóa thì sắp danh sách mã ở tầng ứng dụng rồi khóa theo `id = ANY(...)` như `shipOrdersTx` đang làm.

Áp luật này cho cả `cutoverCommittedBatch` và `releaseCommittedOfChannel` (đang có `ORDER BY id LIMIT … FOR UPDATE`). Dạng khóa của câu quét bù mới (chọn mã không khóa, rồi khóa theo danh sách với `SKIP LOCKED`) em CHƯA thử; thử bằng script lúc code.

### 14.4. Rời kho theo sự kiện

Đã đếm 19/11 bằng một lượt rà toàn bộ `backend/src` (trừ test): 21 chỗ ghi `Order.shippingStatus`, không có câu SQL thô nào ghi cột này. Em tự đọc lại hai chỗ (`routes/orders.ts:798`, `routes/warehouse.ts:573`) và vị trí ba hàm ghi đơn; các chỗ còn lại em lấy theo kết quả rà, đọc lại từng chỗ lúc code.

| Nhóm | Chỗ ghi | Hôm nay | Bản mới |
|---|---|---|---|
| Webhook đơn ba sàn | `processShopeeOrderEvent`, `processTiktokOrderEvent`, `processLazadaOrderPush` | Có gọi `shipStockTx` | Giữ |
| Lazada quét lô + làn đọc con trỏ | `syncLazadaOrders`, `order-write-adapters` | Có gọi (nằm trong `upsertLazadaOrderTx`) | Giữ |
| Shopee, TikTok quét lô + làn đọc con trỏ + đồng bộ hàng hoàn | `syncShopeeOrders`, `syncTiktokOrders`, `order-write-adapters`, `applyShopeeReturnGroup` | KHÔNG gọi | Đưa lời gọi vào `upsertShopeeOrderTx` và `upsertOrderTx` (TikTok), theo cách Lazada đang làm: đơn đang có dấu giữ mà trạng thái mới là Đang giao / Đã giao thì rời kho trong cùng giao dịch |
| Đổi trạng thái tay | `PATCH /api/orders/:id/status` nhánh không hủy (`routes/orders.ts:798`) | KHÔNG gọi, không nằm trong giao dịch | Bọc giao dịch + gọi rời kho |
| Biên bản bàn giao | `routes/packing.ts` | Có gọi `shipOrdersTx` | Giữ |
| Ghi Đã hủy bằng tay | hủy tay (`orders.ts:846`), xử lý hoàn (`orders.ts:2136`), quét nhận hoàn ở kho (`warehouse.ts:573`) | Hủy tay có nhả giữ; xử lý hoàn chỉ nhả khi hàng nguyên vẹn và chưa cộng lại sổ; quét nhận hoàn không nhả | Không đổi ở lát này (xem 14.8) |
| Chuẩn bị hàng, đơn thử, worker tài khoản demo | 7 chỗ | Không gọi. Chuẩn bị hàng chỉ ghi Đã xử lý; worker demo có ghi Đang giao / Đã giao cho đơn của tài khoản demo | Không đụng; quét bù bắt nếu có |

Cả ba hàm ghi đơn đều đã đọc dòng đơn cũ trước khi ghi (`existing = await tx.order.findUnique`), nên phép kiểm "đơn đang có dấu giữ" không thêm câu đọc nào. Cột `stockCommittedAt` đã nằm trong phần `select` của chúng chưa thì em CHƯA đọc; đọc lúc code. Lời gọi này chỉ đụng bộ đếm giữ, không đụng sổ và không đẩy sàn, nên không trái với quy ước "quét lô không trừ kho" (`tiktok/service.ts:478`).

**Gian ngắt kết nối / ngủ đông: em đổi ý so với 13.14, KHÔNG gắn vào sự kiện.** Đếm ra 10 chỗ đưa gian khỏi trạng thái sống (ngắt tay, hai webhook thu hồi quyền, ba chỗ làm mới token, nhắc gia hạn Lazada, một câu SQL thô ở `auth-loss.ts`, xóa tài khoản, ngủ đông theo trang 200 chủ shop). Gắn lời gọi vào 10 chỗ là 10 chỗ để quên. Thay vào đó quét bù giữ nhánh này thành một câu riêng đi từ danh sách gian không sống sang chỉ mục: 32 khối ở cả hai cỡ thử, không phụ thuộc cỡ tập đang giữ. **(Sửa 19/11 đêm: con số 32 khối chỉ đúng khi gian chết không có đơn. Ở ca nửa số gian đã chết câu riêng này đi dọc cả bảng; bản đã code gộp nhánh này vào câu chọn dạng CTE — xem 14.11 mục 1.)**

### 14.5. Quét bù và đối chiếu

- **Quét bù** chạy 1 giờ/lần (mặc định em tự chọn; hôm nay prod đang chạy đúng nhịp này qua `STOCK_COMMITTED_SWEEP_MS`). Hai câu tách, mỗi câu `try` riêng: nhánh "sàn đã báo rời kho" dạng CTE, nhánh "gian không còn sống" đi từ bảng gian. **(Sửa 19/11 đêm: bản đã code dùng MỘT câu chọn dạng CTE cho cả hai nhánh — 14.11 mục 1.)**
- **Quét bù bắt được đơn ở nhánh thứ nhất = còn một đường ghi chưa gọi rời kho.** Ghi số đó vào `maintenance_jobs` và log mức cảnh báo, để biết mà bịt, không coi là chạy bình thường.
- **Đối chiếu** có `try` riêng và giờ chạy riêng, không còn đứng sau quét bù. Ba phép so giữ như 13.5. Thêm một số đo: đơn đã có `stockShippedAt` mà còn dấu giữ, tính là lệch cứng.
- **Chuỗi tự đếm:** dòng `stock-committed-check` giữ thêm số lần liên tiếp lệch cứng 0 và mốc lần lệch gần nhất. Điều kiện sang lát 2 vẫn là 7 lần liên tiếp; đếm lại từ 0 khi bản mới lên.
- **Mốc phải xem lại quét bù:** 20.000 đơn giữ tốn khoảng 4.000 khối mỗi lượt. Tới khoảng 200.000 đơn đang giữ (≈ 40.000 khối, 320 MB mỗi giờ) thì thêm chỉ mục theo trạng thái trên tập đang giữ. Con số 200.000 là em tự chọn từ phép nhân trên, chưa có căn cứ khác.

### 14.6. Đưa lên prod

| Bước | Việc | Ai làm |
|---|---|---|
| 1 | Code + test trên local, chạy lại script thử với đúng các câu cuối cùng | Em |
| 2 | Prod, chạy tay ngoài giờ cao điểm: `CREATE INDEX CONCURRENTLY "Order_stock_held_idx" …`, kiểm `indisvalid` | Em chạy sau khi anh gật (ghi lược đồ prod, như 12/11) |
| 3 | Push. Nhịp đầu của worker chạy việc một lần: xóa dấu giữ của các đơn đã có `stockShippedAt`, theo lô, đọc qua chỉ mục mới | Anh cho push |
| 4 | Xóa biến `STOCK_COMMITTED_SWEEP_MS` trên Render (mã mới tự mặc định 1 giờ) | Em, sau khi anh gật |
| 5 | Soi lần đối chiếu đầu. Lệch cứng 0 thì chuỗi bắt đầu đếm. Khác 0 thì dừng, soi, không tự sửa số | Em |
| 6 | `DROP INDEX CONCURRENTLY "Order_stock_committed_idx"` khi bản cũ không còn chạy | Em chạy sau khi anh gật |
| 7 | EXPLAIN trên prod cho bốn câu định kỳ + xem `pg_stat_statements` sau 24 giờ | Em |

Hai điểm cần biết ở bước 3:

- Trong vài phút deploy, bản web cũ còn chạy có thể ghi `stockShippedAt` mà không xóa dấu. Đối chiếu lần đầu sẽ đếm đúng các đơn này. Nếu có, chạy lại việc dọn một lần bằng tay; em không để nó tự dọn mãi vì sẽ che lỗi thật.
- Bộ đếm chưa được đối chiếu từ 14/11. Số sống mỗi ngày không có dấu hiệu sai, nhưng chỉ lần đối chiếu đầu của bản mới mới xác nhận được. Lệch thì dựng lại bằng `resetCommitted()` + ngày chuyển; câu ngày chuyển phải thêm điều kiện `"stockShippedAt" IS NULL` để không giữ lại đơn đã bàn giao.

### 14.7. Test và hàng rào

- **Test chức năng** (DB thật, qua đúng hàm), thêm vào 16 ca đang có: rời kho xóa dấu và gọi lại không trừ hai lần; quét lô Shopee / TikTok sang Đang giao thì đơn ra khỏi bộ đếm ngay; đổi trạng thái tay; việc dọn một lần; ngày chuyển bỏ qua đơn đã bàn giao; chuỗi đối chiếu tăng và về 0 đúng lúc; quét bù lỗi không chặn đối chiếu.
- **Hàng rào kế hoạch câu lệnh:** script thử ở 14.2 giữ lại trong `backend/scripts/`, cập nhật theo đúng câu cuối cùng, chạy lại mỗi khi sửa một câu định kỳ trên bảng đơn. Em CHƯA có cách tự động hóa nó thành test trên bảng đơn thật: Postgres 17 không cho giả thống kê bảng, nên phải dựng bảng giả riêng như script đang làm.
- **Đèn báo lúc chạy:** mỗi nhịp tự ghi thời gian chạy và số lỗi liên tiếp vào `maintenance_jobs`. Đưa lên HQ Sức khỏe thuộc mục 2 của 13.14, không nằm trong lát này.

### 14.8. Không làm ở lát này

- Hai hàng rào chung trên HQ và việc soi 11 câu chậm (13.14 mục 2 và 3).
- Đơn sàn bị ghi Đã hủy qua quét lô mà chưa cộng lại sổ (lỗ có sẵn, 13.3). Đối chiếu tiếp tục đếm "đã hủy còn giữ"; cả tuần chạy bóng số này bằng 0.
- Quét nhận hàng hoàn ở kho (`routes/warehouse.ts:573`) ghi Đã hủy mà không nhả giữ. Thường đơn đã rời kho từ trước nên không còn dấu; em chưa kiểm có ca nào ngược lại.
- Gian ngủ đông thức lại: đơn đã bị đưa khỏi bộ đếm lúc gian ngủ không được giữ lại. Bản bóng chưa ai đọc số này; lát 2 phải trả lời.

### 14.9. Chưa kiểm

- Bảng thử bằng nửa prod và xếp gọn lý tưởng (đơn mới nằm liền nhau). Trên prod các lệnh UPDATE làm dòng nằm rải hơn, nên số khối của cách một cột sẽ cao hơn bảng 2 và 3; em chưa đo mức chênh.
- Thời gian (ms) đo trên máy local khi dữ liệu đã nằm trong bộ đệm; không so được với prod. Dùng số khối làm thước.
- `random_page_cost` của prod em chưa xem, nên thử cả 4 và 1,1. Postgres local 17.10, prod 17.6 (số đọc 12/11).
- Chưa đo chi phí ghi của ba cách. Cách một cột không thêm lệnh ghi nào so với hôm nay.
- Shopee `TO_RETURN` được quy thành Đã giao nhưng nhánh kho của webhook Shopee bỏ qua trạng thái này; Lazada chỉ chạy phần kho khi trạng thái đổi. Em chưa lần hết hai ca này; quét bù vẫn bắt được nếu chúng lọt. (19/11 đêm: ca Shopee đã được bịt ở hàm ghi đơn dùng chung, 14.11 mục 3; ca Lazada vẫn chưa lần.)
- Tỉ lệ đơn "đã từng giữ" trên prod hôm nay (15/11 là 0,63 %).

### 14.10. Chờ anh

1. ~~Duyệt thiết kế này để em code trên local~~ → anh duyệt 19/11 đêm ("ok em làm đi. Phần này quan trọng làm cẩn thận nhé"), đã code, xem 14.11.
2. Tắt lịch soi `kho-chuan-quoc-te-soi-doi-chieu` (đã hết lượt 19/11).
3. Commit (em chưa commit).
4. Ba việc trên prod ở 14.6, mỗi việc cần anh gật riêng: dựng chỉ mục mới (bước 2), push (bước 3), xóa biến `STOCK_COMMITTED_SWEEP_MS` (bước 4), bỏ chỉ mục cũ (bước 6).

### 14.11. ĐÃ CODE trên local 19/11/2026 đêm — CHƯA commit, CHƯA đụng prod

**Tệp**

| Tệp | Việc |
|---|---|
| `prisma/migrations/20261120090000_stock_committed_single_mark` + chú thích `schema.prisma` | chỉ mục `Order_stock_held_idx ("channelId", "id") WHERE "stockCommittedAt" IS NOT NULL`. Không thêm cột. Chỉ mục cũ CHƯA bỏ (bước 6) |
| `integrations/order-stock.ts` | `shipStockTx` ghi mốc rời kho và xóa dấu giữ trong một câu; `releaseCommittedTx` chỉ còn nhìn một dấu; thêm nguồn `MANUAL` |
| `services/stock-committed.ts` | viết lại: một vị từ `HELD_ORDER`; quét bù = câu chọn dạng CTE (không khóa) + giao dịch ngắn khóa theo danh sách mã; ngày chuyển cùng dạng, bỏ qua đơn đã có mốc rời kho; `clearShippedMarks` (gỡ dấu còn sót, một lần); đối chiếu thêm số "đã rời kho còn dấu" và chuỗi tự đếm |
| `workers/stock-committed.ts` | hai nhịp riêng: bảo trì 1 giờ (ngày chuyển → gỡ dấu sót → quét bù, mỗi bước một `try`) và đối chiếu (hỏi 10 phút một lần); ghi sổ nhịp ở `maintenance_jobs` khóa `stock-committed-sweep` |
| `integrations/shopee/service.ts`, `integrations/tiktok/service.ts` | hàm ghi đơn dùng chung gọi rời kho khi đơn còn dấu giữ mà sàn báo Đang giao / Đã giao; bộ cột "đơn cũ" đọc thêm `stockCommittedAt` |
| `routes/orders.ts` | `PATCH /:id/status` nhánh không hủy: bọc giao dịch + gọi rời kho, nguồn `MANUAL` |
| `scripts/stock-committed-plan-probe.ts` | thêm đúng hai câu quét bù bản mới + ca "nửa số gian đã chết" |
| Test | `stock-committed.test.ts` 16 → 21 ca; `order-write-db.test.ts` thêm kiểm rời kho qua làn đọc con trỏ TikTok; ba bộ dựng "đơn cũ" thêm cột mới; `no-module-state.test.ts` thêm cờ `checking` |

**Lệch so với thiết kế ở trên (sửa trong lúc code, có số đo)**

1. **Quét bù là MỘT câu chọn cho cả hai nhánh, không tách hai câu như 14.5.** Em thử ca gần prod hơn: nửa số gian đã ngắt / ngủ đông và vẫn còn đơn cũ, đơn đang giữ chỉ ở gian sống. Câu riêng cho nhánh "gian ngắt" mà em đo được 32 khối ở 14.2 thì ở ca này đi dọc cả khóa chính: 33.489 khối. Câu chọn dạng CTE gộp hai nhánh vẫn 4.125 khối ở 20.000 đơn giữ, 92 khối ở 424 đơn giữ. Con số "32 khối, không phụ thuộc cỡ tập đang giữ" ở 14.4 vì vậy KHÔNG đúng cho prod; quyết định không gắn sự kiện vào 10 chỗ ghi gian vẫn giữ.
2. **Giữ thêm một chốt chặn `"stockShippedAt" IS NULL` ở mọi đường trừ bộ đếm.** Lý do: giữa lúc bản mới lên và lúc việc gỡ dấu chạy xong, đơn đã rời kho theo bản cũ vẫn còn dấu; không có chốt này thì webhook tới trong khoảng đó sẽ trừ bộ đếm lần hai. Gặp dấu sót thì các hàm chỉ gỡ dấu, không trừ.
3. **Rời kho trong hàm ghi đơn không chỉ khi trạng thái vừa đổi** mà mỗi khi đơn còn dấu giữ và sàn đang báo Đang giao / Đã giao. Bắt được cả đơn đã bị ghi trạng thái từ trước mà chưa ra khỏi bộ đếm, và bịt luôn ca Shopee `TO_RETURN` nêu ở 14.9.
4. **Chuỗi đối chiếu có thêm luật "một đêm chỉ tính một lần":** lần trước cách chưa tới nửa nhịp thì không cộng. Chặn việc chạy lại bằng tay hoặc hai tiến trình worker cùng đối chiếu làm chuỗi nhảy hai nấc.
5. **Giờ đối chiếu không trôi:** bản cũ so đúng 24 giờ tính từ lúc chạy XONG nên mỗi ngày muộn thêm một nhịp. Nay hỏi 10 phút một lần và coi là tới hạn sớm 5 phút.
6. **Ngày chuyển không đánh dấu "xong" nếu cả lô vừa chọn không khóa được đơn nào**; nhịp sau chạy tiếp.

**Kiểm trên local**

- `npx tsc --noEmit` và `npm run build` backend: sạch.
- `stock-committed.test.ts` 21 / 21. Ca mới: dấu còn sót không bị trừ lần hai qua bốn đường (rời kho, nhả giữ, bàn giao theo lô, quét bù) và gỡ một lần là sạch; Shopee ghi đơn qua hàm dùng chung; đổi trạng thái tay qua đúng route HTTP; ngày chuyển bỏ qua đơn đã bàn giao; luật chuỗi; `runCommittedCheck` ghi chuỗi.
- Thử tắt lời gọi rời kho mới trong hai hàm ghi đơn: ca Shopee và ca TikTok qua làn đọc con trỏ đều đỏ, bật lại thì xanh. Tức là hai ca này thật sự canh được lời gọi.
- Cả bộ backend: 2.798 ca qua. 25 ca đỏ lượt đầu, trong đó 1 ca do em (hàng rào biến cấp module, đã sửa). 24 ca còn lại em chạy lại trên bản gốc (tạm cất phần sửa): 23 ca đỏ y hệt, đều là test so sổ cái trên DB local đang có 4 dòng sổ bẩn của đơn thử `DEMOPL-*` (phiên khác dựng trưa 19/11), `channel-delete-db` và `retention-db` đỏ có từ trước. Ca thứ 24 là `upload-db` "HẾT GIỜ": chạy riêng ba lần trên cùng mã ra 1 qua, 2 đỏ, và nó không import tệp nào em sửa.
- Một nhịp worker chạy thật trên DB local: gỡ dấu sót 0 đơn, đối chiếu lệch 0, chuỗi 1, sổ nhịp ghi đủ. DB local không có đơn đang giữ nên lượt này chỉ chứng minh các câu chạy được.
- Script thử với đúng câu bản mới (bảng 470.000 dòng, đã từng giữ 50 %):

  | Câu | 424 đơn giữ | 20.000 đơn giữ | 20.000 đơn giữ, nửa số gian đã chết |
  |---|---|---|---|
  | Quét bù bản mới: chọn | 92 khối | 4.125 khối | 4.125 khối |
  | Quét bù bản mới: khóa 200 mã | 391 khối | 500 khối | 510 khối |
  | Đọc đơn đang giữ của một gian | 118 khối | 877 khối | 845 khối |
  | Quét bù dạng cũ (để so) | 97 khối | 73.209 khối | 73.209 khối |

**CHƯA kiểm**

- Chưa chạy trên prod, chưa EXPLAIN trên prod, chưa đo `random_page_cost` prod.
- Câu chọn của ngày chuyển (dạng CTE mới) chưa đưa vào script thử; nó chỉ chạy một lần, hoặc khi dựng lại bộ đếm.
- Ca hai giao dịch chạy đua thật (webhook và quét bù cùng một đơn) chỉ có test "ba lượt rời kho song song" từ trước; chưa có test riêng cho bước khóa `SKIP LOCKED` của quét bù.
- Đường Lazada không đổi mã; em không viết thêm test cho nó.
- Chưa đếm trên prod có bao nhiêu đơn còn dấu sót để ước lượng việc gỡ dấu chạy bao lâu.
- Worker demo ghi Đang giao / Đã giao cho đơn tài khoản demo không gọi rời kho; nếu đơn demo có trừ kho thì quét bù sẽ bắt và log cảnh báo.

### 14.12. ĐÃ LÊN PROD 19/11/2026 ~21:17 (anh: "Em làm nốt đi rồi push. Mình sẽ check thật trên tài khoản admin@hubsell.vn luôn")

Commit `fed244e2` (mã) + `ecf47893` (tài liệu), push `7ba02958..ecf47893`. Mọi số dưới đây đọc trên prod bằng câu SELECT qua Supabase SQL Editor và log Render.

**Trước khi push (21:14)**

- Postgres 17.6, `random_page_cost` = 1,1 (lần đầu xem được). Bảng đơn ≈ 956.000 dòng. Không phiên nào đang chạy, không giao dịch treo.
- 282 đơn đang giữ thật, bộ đếm 200; khoảng 7.000 đơn còn dấu của bản hai cột (ước từ thống kê bảng, 0,74 %).
- `CREATE INDEX CONCURRENTLY "Order_stock_held_idx"` xong trong dưới 10 giây: hợp lệ, 608 kB, 7.909 dòng.
- EXPLAIN ANALYZE câu chọn quét bù bản mới trên prod, lúc tập còn 7.909 đơn có dấu: đi qua `Order_stock_held_idx`, máy ước 7.033 dòng, đụng 7.824 khối (2.446 đọc từ đĩa), 1,55 giây, ra 106 đơn cần quét.

**Sau khi push**

- 21:17:04 migration `20261120090000_stock_committed_single_mark` ghi xong, không rollback. `/health` báo bản `ecf47893` sau 120 giây.
- 21:19:10 nhịp đầu của worker (log `hubsell-worker-sg`):
  - gỡ dấu còn sót của 7.626 đơn đã rời kho;
  - quét bù đưa 106 đơn của gian không còn hoạt động ra khỏi bộ đếm, 0 sản phẩm (các đơn này không có nhật ký trừ kho). Nhánh "sàn đã giao" bắt 0 đơn. Cả nhịp 3,9 giây, không lỗi;
  - đối chiếu: 179 đơn đang giữ, bộ đếm 203 = tính lại từ đơn 203 = theo "Chờ giao" 203; lệch 0 mã, 0 vị trí, 0 đơn đã rời kho còn dấu; đã hủy còn giữ 0; **chuỗi 1**.
- Dòng log cuối của bản cũ là `lỗi một nhịp` lúc 20:30:25; sau 21:19 không còn dòng lỗi nào (xem tới 21:22).
- 21:24: 181 đơn còn dấu, 0 dấu sót, bộ đếm 207, không mã nào âm.

**Tài khoản admin@hubsell.vn trên prod (5 gian, đều đang nối):** 12 đơn đang giữ, đều Chờ xử lý, trên 9 mã. Bộ đếm từng mã bằng đúng số tính lại từ đơn: BL003-DEN 1, TC006-XAMNHAT 1, TC020-XAM 1, TC023-DEN 1, TC025-XAM 2, TC077 2, TC078-DEN 1, TC111 2, TUI006-XAM 1; lệch 0. Em đọc bằng SQL, không đăng nhập tài khoản. Trên màn hình anh đối được bằng cột "Chờ giao" ở Tổng kho của chín mã này (cột đó tính theo trạng thái đơn, độc lập với bộ đếm).

**Bước 14.6 đã làm / chưa làm**

| Bước | Trạng thái |
|---|---|
| 2. Dựng chỉ mục mới | Xong 21:15 |
| 3. Push + việc gỡ dấu một lần | Xong 21:17–21:19 |
| 4. Xóa biến `STOCK_COMMITTED_SWEEP_MS` trên Render | Xong, lưu bằng "Save only" (không khởi động lại worker; giá trị cũ trùng mặc định mới nên hành vi không đổi). Còn 52 biến |
| 5. Soi lần đối chiếu đầu | Xong: lệch cứng 0, chuỗi 1 |
| 6. Bỏ chỉ mục cũ `Order_stock_committed_idx` | Xong 21:28 (anh: "Em chạy đi", sau khi lượt đầu bị công cụ chặn ở hộp xác nhận "destructive" của Supabase). `DROP INDEX CONCURRENTLY IF EXISTS`; kiểm sau đó: bảng đơn còn `Order_stock_awaiting_ship_idx` + `Order_stock_held_idx`, không chỉ mục nào không hợp lệ; câu đếm đơn đang giữ đi qua chỉ mục mới, 253 khối, 2 ms. Migration `20261120093000_drop_order_stock_committed_idx` (`DROP INDEX IF EXISTS`) để các database dev khớp prod; trên prod nó không tìm thấy gì nên không lấy khóa |
| 7. EXPLAIN + `pg_stat_statements` sau 24 giờ | EXPLAIN câu chọn đã làm (trên). `pg_stat_statements` sau 24 giờ CHƯA |

Lần deploy thứ hai (commit `d9f34702`, chỉ có migration dọn): 21:32:05 migration ghi xong, không rollback; 21:34:09 nhịp bảo trì đầu sau khi worker khởi động lại chạy 36 ms, quét bù 0 đơn, không lỗi; 185 đơn còn dấu, 0 dấu sót, bộ đếm 211, không mã nào âm. Đối chiếu chưa tới hạn nên không chạy lại (đúng thiết kế).

**Còn lại**

- Chuỗi cần 7 lần liên tiếp: lần 1 là 19/11 21:19, sớm nhất đủ vào 25/11 ~21:19. Đọc bằng `SELECT cursor FROM maintenance_jobs WHERE key = 'stock-committed-check'` (trường `streak`); không cần lịch soi.
- Dòng `stock-committed-sweep`: `processed` > 0 nghĩa là quét bù bắt được đơn "sàn đã giao", tức còn một đường ghi trạng thái chưa gọi rời kho. Lúc 21:19 là 0.
- Lịch `kho-chuan-quoc-te-soi-doi-chieu` em không tắt được (công cụ chặn). Nó chỉ chạy ngày 13–19/11 nên lượt kế là 13/11/2027.
- Sau khi gỡ dấu sót, thống kê bảng còn cũ: máy vẫn ước tập đang giữ 6.984 dòng (thật 181) cho tới lượt autoanalyze kế. Câu vẫn đi đúng chỉ mục; em chưa xem lại sau autoanalyze.
- Chưa thấy trên prod: một đơn thật đi từ Chờ xử lý sang Đang giao qua quét lô / làn đọc con trỏ / đổi tay với bản mới (mới 5 phút sau deploy). Lần đối chiếu 20/11 sẽ cho biết.

## 15. Lát 2 + 3 — ĐÃ CODE 19/11/2026 đêm (anh: "Làm hết luôn dứt điểm phần kho"); ĐÃ LÊN PROD ~23:04, xem 19.1 — chưa shop nào bật

Hai lát lên CÙNG một lượt mã, nhưng bật theo HAI công tắc riêng của từng shop, cả hai mặc định là hành vi cũ. Ngày lên bản không shop nào đổi số, không màn nào đổi.

| Công tắc (`shop_sync_settings`) | Giá trị | Ai đổi |
|---|---|---|
| `stockModel` | `LEGACY` (mặc định) · `ON_HAND` | chỉ đổi bằng SQL, shop không tự đổi được. Đây là công tắc của lát 3 |
| `restockOnReturn` | `ON_CANCEL` (mặc định) · `ON_RECEIVE` | chủ shop tự đổi ở trang Đối soát đơn hoàn. Đây là công tắc của lát 2 |

### 15.1. Lát 2 — hủy sau giao + nhận hàng hoàn

- **Một bộ hàm có khóa** (`integrations/order-stock.ts`): `restoreStockTx` (hủy: nhả giữ nếu hàng chưa rời kho; đã rời kho thì theo công tắc), `restoreReturnedStockTx` (kho bấm nhận kiện). Ba đường cũ (hủy tay, nhận hoàn từng đơn, nhận hoàn cả lô ở `routes/orders.ts`) đều gọi vào đây; hàm riêng `restoreReturnStockTx` đã bỏ. Cả hai khóa dòng đơn trước khi đọc `stockRestoredAt` → hết cảnh hủy tay chạy đua với webhook cộng hai lần.
- **`ON_RECEIVE`:** đơn đã rời kho mà hủy thì KHÔNG cộng; đơn chuyển "Chờ hàng về". Kho bấm Nhập kho mới cộng, theo số lượng từng dòng thực nhận. Hỏng / mất không cộng.
- **`ON_CANCEL`:** như cũ. Tổng kho của shop ON_HAND hiện một dòng "Tồn kho đang tính cả N sản phẩm của M đơn hủy sau khi giao mà kho chưa nhận kiện" (đọc qua chỉ mục mới `Order_return_awaiting_idx`).
- **Màn:** nút "Cộng tồn khi …" ở thanh công cụ trang Đối soát đơn hoàn (`components/warehouse/restock-mode-control.tsx`), chỉ chủ shop thấy, hộp nói rõ được gì mất gì. Đổi chỉ áp cho đơn hủy từ lúc đổi. Trang Đơn hàng đổi câu chữ ở hộp hủy đơn và hộp duyệt yêu cầu hủy.
- **Nhận hàng ở kho** (`routes/warehouse.ts`) và đổi trạng thái tay giờ gọi `shipStockTx(…, "MANUAL")` trong cùng giao dịch.

### 15.2. Lát 3 — hiển thị + cửa ghi theo "hàng trong kho"

Máy chủ gắn `stockModel` vào từng sản phẩm của danh sách; mọi màn đọc qua `frontend/src/lib/stock-model.ts` (`isOnHand`, `stockShown`, `heldShown`). Shop `ON_HAND` thấy:

- **Tổng kho:** Tồn kho = sổ + đang giữ cho đơn đã chốt + ô không bán; cột "Đang giữ" (đã chốt + chưa thanh toán) đứng trước "Có thể bán"; Có thể bán và số đẩy sàn KHÔNG đổi. Dải giải thích một lần (bấm Đã hiểu là thôi). Lọc Hết hàng theo khả dụng. Giá trị tồn tính trên hàng trong kho.
- **Sửa ô Tồn kho, Excel:** số gõ là hàng trong kho (`setOnHandAbsolute`). Gõ thấp hơn phần đang giữ → máy chủ trả 409 `BELOW_HELD` kèm số thiếu, màn hỏi lại, có nút "Vẫn lưu". Excel: ô Tồn kho trống thì không đụng tồn (trước đây đè về 0 — sửa cho cả shop cũ); tệp xuất từ bản cũ (có cột "Chờ giao") được đọc theo nghĩa cũ và báo rõ.
- **Kiểm kê nhanh:** số sổ là hàng trong kho, chốt ghi PHẦN CHÊNH so với số sổ lúc đếm; huy hiệu biến động + nút đếm lại.
- **Nhật ký kho:** ba ô Đang giữ · Có thể bán · Tồn kho, mỗi ô phần đổi + số sau. `InventoryLog` thêm `kind`, `heldChange`, `heldAfter`, `onHandAfter`. Dòng "Xuất cho đơn" / "Thôi giữ" (đổi 0 trên sổ) chỉ shop ON_HAND thấy.
- **Thống kê, hộp Nhập / Xuất, phiếu nhiều mã, lịch sử một mã, vị trí:** câu chữ + số theo hàng trong kho.
- **Mobile** (`screens/StockPage.tsx`): số "Tồn" và "giữ" theo cách của shop; câu chặn xuất nói rõ "xuất được tối đa N (giữ M cho đơn)". Máy chủ cũ / shop cũ thì app hiện y như trước.

### 15.3. Lệch thiết kế, có lý do

| Thiết kế (mục 5) | Đã làm | Vì sao |
|---|---|---|
| Rào xuất tay theo "Có thể bán", vượt thì cảnh báo có nút bỏ qua | GIỮ rào cứng theo sổ tồn bán | Xuất quá phần chưa có đơn giữ là lấy hàng của đơn đã chốt; đổi rào là đổi hành vi cho mọi shop, không nằm trong công tắc. Câu báo lỗi của shop ON_HAND đã nói rõ ba số |
| Hộp mời 5 shop đã quét nhận hoàn bật chế độ chuẩn | CHƯA làm | Nút tự đổi đã có ở trang Đối soát; mời ai là việc bật cho khách, chờ anh |
| Nút "kiện không về" cho cả lô quá N ngày | CHƯA làm | N chưa có căn cứ (mục 5.2.1). Từng đơn vẫn đóng được bằng luồng hỏng / mất sẵn có |
| Bảng Nhật ký không rộng thêm | Bảng vốn đã cuộn ngang ở ≤ 1440 (10 cột). Ba ô số thêm 92 px, em thu cột Lý do (2 dòng, 15rem) nên bảng HẸP hơn bản cũ 100 px, nhưng vẫn cuộn | Muốn hết cuộn phải gộp cột, là việc thiết kế lại bảng |

### 15.4. Đã kiểm / chưa kiểm

- Test mới chạy app Express thật trên DB local: `stock-returns.test.ts` 15 ca, `stock-on-hand.test.ts` 16 ca; cùng `stock-committed.test.ts` 21 ca. Cả bộ backend sau khi xong lát 5: 2.848 qua, 23 đỏ — đúng 23 ca đỏ có sẵn từ trước (so tên từng ca với bản gốc).
- Soi màn trên local, shop dev ở ON_HAND, có mã rộng nhất (mã 60 ký tự, tồn 11.020, giá trị trên 1 tỷ): Tổng kho 1280 / 1366 / 1440 / 1536 / 1700 không tràn; Nhật ký, Kiểm kê, Thống kê, Đối soát đơn hoàn ở 1280 + 1440, sáng + tối. Sửa trong lúc soi: ô Tồn kho tràn 7 px ở 1280; chữ dải thông báo mất trong giao diện tối; mã SKU dài đẩy bảng Kiểm kê cuộn ngang; nhãn nút "Cộng tồn…" làm thanh công cụ Đối soát rớt dòng ở 1280.
- **Chưa kiểm:** prod (chưa đụng); một đơn thật đi hết vòng hủy sau giao → nhận kiện ở chế độ `ON_RECEIVE`; mobile chỉ kiểm kiểu, chưa chạy trên máy; Excel với tệp thật của khách; trang giới thiệu và hướng dẫn (`guide-tours.ts` không có câu nào sai nghĩa, landing chưa rà).

## 16. Lát 4 — lý do theo danh sách + báo cáo "Hàng hỏng, mất & chênh kiểm kê" — ĐÃ CODE 19/11/2026 đêm; ĐÃ LÊN PROD ~23:04 (19.1)

- **Danh sách** (`backend/src/lib/stock-reason.ts`, bản sao ở `frontend/src/lib/` và `hubsell-mobile/src/lib/`): Nhập = Nhập hàng · Hàng hoàn nhập lại · Sửa sai số; Xuất = Bán ngoài sàn · Hỏng · Mất / thất lạc · Tặng / dùng nội bộ · Sửa sai số. Dựng theo Shopify (mục 1.5), chưa hỏi khách.
- **Không bắt buộc.** `/adjust` và `/adjust-bulk` nhận thêm `reasonCode`; mã ghi vào `InventoryLog.kind`, câu Lý do = tên lý do, ghi chú nối sau. Không gửi mã thì ghi y như trước. Mã sai chiều bị từ chối, không ghi gì.
- **App mobile bản cũ** gửi nguyên câu chip ("Hàng hỏng", "Bán ngoài sàn"…) không có mã → máy chủ tự suy ra mã, giữ nguyên câu. Khách chưa cập nhật app vẫn vào đúng nhóm của báo cáo.
- **Màn:** hàng chip "Lý do" ở hộp Nhập / Xuất và trang phiếu nhiều mã (nhập chọn sẵn "Nhập hàng", xuất để trống); ô chữ cũ thành "Ghi chú". Mobile: chip theo danh sách chuẩn, thêm "Mất / thất lạc", bỏ "Kiểm lại thấy dư / thiếu" (thành "Sửa sai số").
- **Báo cáo** `GET /api/inventory/loss-report` + hộp ở tab Nhật ký kho (nút "Hỏng, mất & kiểm kê"): kỳ 30 / 90 / 365 ngày; mỗi nhóm tách giảm và tăng; giá trị = số lượng × giá vốn HIỆN TẠI, chỉ người thấy tài chính; 20 mã giảm ròng nhiều nhất. Nhóm: Hỏng · Mất · Tặng / nội bộ · Chênh kiểm kê · Sửa số trên bảng / Excel · Sửa sai số · Điều chỉnh chưa phân loại (dòng ghi trước ngày có danh sách) · Xuất không ghi lý do. Không gồm đơn sàn, Bán ngoài sàn, Nhập hàng. Không dùng chữ "Hao hụt" (anh 13/11).
- **Quy mô:** `InventoryLog` không có cột chủ shop. Câu báo cáo đi từ SKU của shop, mỗi SKU dò chỉ mục bán phần mới `InventoryLog_manual_idx ("productId","createdAt") WHERE "orderId" IS NULL` — dòng của đơn sàn không nằm trong chỉ mục. Trên DB local bảng nhỏ nên máy chọn quét cả bảng; ép tắt quét bảng thì câu đi đúng chỉ mục. Đã EXPLAIN trên prod (19.1): 652 ms cho shop 43.912 mã, máy chưa dùng chỉ mục mới.
- **Test:** `stock-reasons.test.ts` 7 ca (không mã = như cũ; có mã; suy mã từ chip mobile cũ; mã sai chiều; phiếu nhiều mã; báo cáo đúng nhóm, không lẫn shop khác / đơn sàn; khoảng ngày sai).
- **Áp cho MỌI shop** (không theo công tắc): thêm một hàng chip và một nút, không đổi số nào.

## 17. Lát 5 — Kiểm kê theo phiên — ĐÃ CODE 19/11/2026 đêm; ĐÃ LÊN PROD ~23:04 (19.1)

Trang Kiểm kê nhanh giữ nguyên. Phiên là cách THÊM, vào bằng nút "Kiểm kê theo phiên" ở góc trang Kiểm kê.

- **Bảng mới** (migration `20261120110000_stocktake_sessions`, hai bảng rỗng, RLS bật): `stocktake_sessions` (COUNTING → PENDING → APPROVED | CANCELLED; chụp `stockModel` lúc mở), `stocktake_lines` (số đếm, số sổ lúc đếm, ai đếm; lúc duyệt thêm phần chênh đã áp).
- **Route** `/api/stocktakes` (`routes/stocktakes.ts`), cùng quyền với các route kho: mở phiên, danh sách, chi tiết, ghi số đếm, gửi duyệt, mở lại, hủy, duyệt.
- **Nhiều người đếm:** số đếm nằm ở máy chủ. Quét là "cộng thêm" ngay trong câu lệnh (`ON CONFLICT … counted + n`) → hai máy quét cùng một mã không mất lượt (test bắn 10 lượt song song). Trang tự đọc lại 15 giây một lần.
- **Duyệt:** chỉ chủ shop. Ghi PHẦN CHÊNH = số đếm − số sổ lúc đếm, cho MỌI shop (khác trang nhanh của shop cũ vốn ghi đè): phiên có thể treo nhiều giờ trước khi duyệt, ghi đè sẽ cộng ngược hàng đã bán trong lúc chờ. Chạy theo lô 50 dòng mỗi giao dịch, dòng nào áp xong đánh dấu trong cùng giao dịch → đứt giữa chừng bấm duyệt lại chạy tiếp; hai người bấm cùng lúc thì `FOR UPDATE SKIP LOCKED` chia dòng, không dòng nào áp hai lần. Hủy / mở lại khóa dòng phiên trước nên không chen được vào giữa lúc duyệt.
- **Đếm mù:** người không phải chủ shop không nhận số sổ / phần lệch khi phiên đang đếm (API không trả, màn ẩn hai cột). Phiếu của vị trí vẫn đọc từ route cũ có trả số sổ nên đây là che để đếm khách quan, không phải rào bảo mật.
- **Biên bản in** `/print/stocktake/<id>`: A4, in bằng trình duyệt, theo mẫu 05-VT lược bớt, không có cột tiền.
- **Giới hạn:** 2.000 mã / phiên, 200 mã / lượt gửi, 20 phiên đang mở / shop.
- **Test:** `stocktake-sessions.test.ts` 10 ca (cộng dồn song song; đếm mù; nhân viên không duyệt được; chênh so sổ lúc đếm ở shop cũ và shop ON_HAND; theo vị trí; hai lượt duyệt cùng lúc; mở lại / hủy; mã bị xóa sau lúc đếm).
- **Đã chạy trên local:** mở phiên → gõ số → quét hai lần → gửi duyệt → mở lại → sửa → gửi → duyệt → xem bản in; sáng + tối, 1280 + 1440.
- **Chưa làm / chưa kiểm:** quyền duyệt cho nhân viên (hiện chỉ chủ shop); mobile chưa có màn phiên; hai máy thật cùng đếm; máy quét thật; đường "xóa cả Tổng kho" và xóa tài khoản chưa biết hai bảng mới (không có khóa ngoại tới chủ shop, giống `stock_vouchers`).

## 18. Lát 6 ("Đang về" từ nhà cung cấp) — KHÔNG làm trong đợt này

Cần phiếu đặt hàng nhà cung cấp, là một phần mới (đặt → nhận một phần → nhận đủ), không phải một lát của kho hiện có. Mục 5.4 đã ghi "không làm trong đợt này". Em đề xuất tách thành việc riêng khi anh cần.

## 19. Đưa lát 2 → 5 lên prod — bước 1–3 ĐÃ LÀM 19/11 ~23:04 (19.1); bước 4–5 chờ anh

1. **Trước khi push, chạy tay ở Supabase SQL Editor, ngoài giờ cao điểm** (bảng `Order` và `InventoryLog` lớn, `CREATE INDEX` thường sẽ chặn ghi):
   - `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_return_awaiting_idx" ON "Order" ("channelId") WHERE "returnStatus" = 'AWAITING';`
   - `CREATE INDEX CONCURRENTLY IF NOT EXISTS "InventoryLog_manual_idx" ON "InventoryLog" ("productId", "createdAt") WHERE "orderId" IS NULL;`
   - kiểm `indisvalid = true` cho cả hai.
2. **Commit + push.** Migration `20261120100000_stock_on_hand_model` thêm 2 cột cài đặt + 4 cột `InventoryLog` (chỉ đổi metadata, có `lock_timeout` + thử lại); `20261120110000_stocktake_sessions` tạo hai bảng rỗng.
3. **Sau push:** EXPLAIN câu báo cáo lát 4 và câu "chưa về kho" trên prod; xem log worker không có dòng lỗi mới.
4. **Mobile:** màn kho đã sửa trên master (1.5.0). Shop bật `ON_HAND` mà nhân viên còn dùng app cũ sẽ thấy số "Tồn" theo cách cũ trên app, khác web → phải ra bản app / OTA TRƯỚC khi bật cho shop đó. OTA cho khách 1.4.3 phải dựng từ nhánh `ota/1.4.3-ten-khong-cat`, em chưa đụng.
5. **Bật `ON_HAND`:** từng shop bằng SQL (`UPDATE shop_sync_settings SET "stockModel" = 'ON_HAND' WHERE "userId" = …`, shop chưa có dòng cài đặt thì `INSERT`). Thứ tự ở mục 8: shop công ty → 2–3 shop tình nguyện → toàn bộ. Em đề nghị shop công ty (admin@hubsell.vn) trước, shop khách đợi chuỗi đối chiếu đủ 7/7 (sớm nhất 25/11) vì Tồn kho của shop ON_HAND cộng thẳng bộ đếm "đang giữ" vào.
6. **Tắt lại:** đặt `stockModel` về `LEGACY` là màn về như cũ ngay; sổ tồn bán không bị cách hiển thị đụng tới nên không phải chuyển dữ liệu. Riêng Kiểm kê / sửa ô / Excel đã ghi trong lúc ON_HAND thì đã là bút toán thật.

### 19.1. ĐÃ LÊN PROD 19/11/2026 ~23:04 (anh: "anh nghĩ cứ push đi") — bước 1, 2, 3 xong; CHƯA bật ON_HAND cho shop nào

Commit `df53e87f` (mã) + `71eb5fbf` (tài liệu), push `c21c3143..71eb5fbf`. Số dưới đây đọc trên prod bằng câu SELECT / EXPLAIN qua Supabase SQL Editor.

**Trước khi push (23:00)**

- Bảng đơn 932 MB, 955.610 dòng; `InventoryLog` 56 MB, 135.799 dòng, trong đó 106.902 dòng không gắn đơn. Không giao dịch nào treo quá 30 giây.
- `CREATE INDEX CONCURRENTLY "Order_return_awaiting_idx"`: hợp lệ, 152 kB. `CREATE INDEX CONCURRENTLY "InventoryLog_manual_idx"`: hợp lệ, 6.184 kB. Không chỉ mục nào không hợp lệ trên cả database.
- `next build` trên máy em qua (có đủ ba trang mới).

**Sau khi push**

- 23:04:30 hai migration ghi xong, không rollback. 23:04:45 `/health` báo `71eb5fbf`. Web prod: `/products/stocktake/sessions` và `/print/stocktake/<id>` trả 200 (trang không tồn tại trả 404).
- Ba route mới trả 401 khi chưa đăng nhập (đã gắn). Em KHÔNG đăng nhập tài khoản nào trên prod, nên chưa bấm thử màn nào trên prod.
- `shop_sync_settings` có 2 dòng, đều `LEGACY / ON_CANCEL`; các shop còn lại chưa có dòng nên dùng mặc định. Không shop nào đổi cách.
- 23:06:35 worker chạy nhịp bảo trì đầu sau khi khởi động lại: quét bù 0 đơn, không lỗi. Bộ đếm không mã nào âm.
- 23:07:00 dòng nhật ký đầu tiên do bản mới ghi (một đơn sàn trừ kho): `kind` RESERVE, đổi −1, tồn bán sau 29, đang giữ +1 → 1, hàng trong kho sau 30; khớp sản phẩm lúc đọc (sổ 29, giữ cho đơn 1, giữ tạm 0).
- **Câu "chưa về kho"** (shop có nhiều đơn Chờ hàng về nhất): đi qua `Order_return_awaiting_idx`, 6 ms, 2.512 khối. Cả hệ thống đang có 16.952 đơn Chờ hàng về của 163 shop.
- **Câu báo cáo lát 4** (shop nhiều mã nhất, 43.912 mã, kỳ 365 ngày): 652 ms, 172.107 khối. Máy đi từng mã rồi dò `InventoryLog_productId_idx`, KHÔNG dùng `InventoryLog_manual_idx` — bảng nhật ký còn nhỏ và phần lớn dòng không gắn đơn nên hai chỉ mục gần như nhau. Chấp nhận được cho một hộp mở theo yêu cầu, nhưng thời gian tăng theo SỐ MÃ của shop chứ không theo số dòng tay; muốn nhanh hẳn phải có cột chủ shop trên `InventoryLog`. Chưa làm.

**Còn lại**

- Chưa thấy trên prod: một lượt nhập / xuất có chọn lý do, một phiên kiểm kê, một lượt hủy sau giao ở `ON_RECEIVE` (chưa ai dùng; em không đăng nhập để thử).
- Bước 4 (mobile) và 5 (bật ON_HAND từng shop) chưa làm, chờ anh.
- Chuỗi đối chiếu lát 1 vẫn 1/7 (lần kế ~21:19 ngày 20/11).

## 12. Nguồn

Shopify: help.shopify.com/en/manual/products/inventory/fundamentals/inventory-states · …/inventory/managing-inventory-quantities/adjustment-history · …/inventory-and-locations/adjusting-inventory/adjusting-inventory-quantities · …/inventory-and-locations/inventory-counts/performing-and-reviewing-counts · …/fulfillment/managing-orders/canceling-orders · shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps/manage-quantities-states

Odoo: odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html · …/cycle_counts.html · …/shipping_receiving/reservation_methods.html · odoo.com/documentation/18.0/…/warehouses_storage/reporting/stock.html

NetSuite (docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/): section_N2262573 (các số tồn) · section_N1229796 (Picked / Packed / Shipped) · section_N2296970 + section_N2299731 (Inventory Count) · section_N2281482 (Commit)

Zoho Inventory: zoho.com/us/inventory/kb/items/stock-tracking-mode.html · …/help/items/stock-counts.html · …/help/sales-returns/sales-returns-overview.html

Cin7 Core (help.core.cin7.com, chỉ đọc được đoạn trích): Product Availability Report · Stocktake · Processing a sale · Buffer inventory

Linnworks (help.linnworks.com/support/solutions/articles/): 7000031150 · 7000032976 · 7000034390 · 7000057020

Veeqo: help.veeqo.com/en/articles/3804463-stock-allocation · …/3804436-inventory-rules-for-your-stores · …/3803293-managing-refunds-and-returns

SAP: help.sap.com (Physical Inventory: posting block, freezing book inventory; stock types; goods issue)

Amazon: developer-docs.amazon/sp-api/docs/fba-inventory-api

Chưa có nguồn chắc: định nghĩa "allocated" của APICS; công thức Forecasted của Odoo; tùy chọn tồn âm của SAP.
