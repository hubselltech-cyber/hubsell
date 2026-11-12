# Quản lý kho bản chuẩn quốc tế — khảo sát hiển thị, thuật toán, phạm vi tác động (12/11/2026)

> Anh Trung 12/11: "lên phương án khảo sát phần Quản lý kho bản chuẩn quốc tế… khảo sát kỹ cách thức hiển thị, thuật toán tính, phạm vi tác động liên quan tới kiểm kê, nhập/xuất".
> Nối tiếp [TONG-KHO-DANG-GIU-CHO-DON.md](TONG-KHO-DANG-GIU-CHO-DON.md) (11/11: cột "Chờ giao", bản 2). Đối thủ Việt (Sapo, KiotViet, Salework) đã khảo sát ở [QUAN-LY-KHO-TAI-CAU-TRUC.md](QUAN-LY-KHO-TAI-CAU-TRUC.md) mục 11, không làm lại.
> Trạng thái: **CHƯA CODE.** Số prod đã đo 12/11 (chỉ đọc) ở mục 11. Anh chốt 12/11: "Chia theo shop" + "Chuẩn quốc tế như thế nào thì em cứ làm như vậy" → bảng chốt ở đầu mục 9. Thiết kế lát 1 (chạy bóng) ở mục 13; **lát 1 ĐÃ CODE trên local 12/11 (mục 13.9), chưa commit, chưa lên prod.**

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
