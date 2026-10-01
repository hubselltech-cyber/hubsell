# Kiến trúc Hubsell cho quy mô 50.000 khách, 1 triệu đơn/ngày

Ngày lập: 29/09/2026. Người lập: Claude (Lead Dev). Trạng thái: **anh Trung đã duyệt hướng 30/09/2026**; giai đoạn 0 đã xong và đang chạy trên prod, giai đoạn 1 bắt đầu 30/09/2026 (thiết kế chi tiết: `docs/SO-CAI-DON.md`).

## 0. Tiến độ (cập nhật 30/09/2026 tối)

| Giai đoạn | Tình trạng |
|---|---|
| 0. Cầm máu | Xong phần đã chốt, đã lên prod (bản `ce65553`) |
| 1. Sổ cái đơn | **Đang làm.** Bước 1 (30/09) đã viết xong và chạy thử đạt trên DB local (7.570 đơn khớp từng đồng, ~960 đơn/giây), CHƯA push: bảng phân mảnh theo tháng + trigger đánh dấu + worker tính lại + đối soát đêm + công cụ so khớp trên HQ; công thức Lãi/Lỗ tách sang `lib/pnl-formula.ts`. Chưa báo cáo nào đọc từ sổ. Việc kế: push để migrate lên prod, so khớp trên dữ liệu thật, rồi chuyển từng báo cáo. Chi tiết `docs/SO-CAI-DON.md` |
| 2. Hàng đợi và webhook | **Bắt đầu 01/10/2026.** Đã thử pg-boss 12.35.1 với bộ gộp kết nối Supabase: chạy được ở cả chế độ phiên lẫn chế độ giao dịch. Bản thiết kế + thứ tự chuyển ở `docs/HANG-DOI-BEN.md`, đang chờ anh Trung duyệt; chưa viết mã |
| 3. Đồng bộ và các worker còn lại | Chưa bắt đầu |
| 4. Vòng đời dữ liệu và quan sát | Chưa bắt đầu (riêng chỉ mục `Order(channelId, deliveredAt)` đã tạo) |

Đã làm ở giai đoạn 0: bỏ trần 2.000 đơn của báo cáo; chặn đánh dấu "đã gỡ" nhầm khi danh mục chưa kéo đủ; gỡ lệnh đẩy tồn bị kẹt; bỏ quyết toán giả lập với gian sàn; đồng bộ đơn báo khi bị cắt; số cảnh báo tồn hiện tổng thật; dải nhắc kỳ vượt 20.000 đơn; các định nghĩa tài chính ở mục 9a; tờ khai theo ngày giao; Tổng quan trừ quảng cáo sàn.

Nhóm quảng cáo ở mục 3.2 (A7, A8, A9) đã sửa 01/10/2026 — chi tiết ở `docs/ADS-NHIP-CANH-BAO.md` mục 12; A7 còn phải kiểm số thật trên prod trong khung 0h–7h sau khi lên. Trợ lý quảng cáo vẫn ở chế độ diễn tập.

Xuất phát: sự cố 29/09 (Báo cáo dòng tiền tháng 8 ra lãi 13,19 triệu thay vì 34,29 triệu do trần 2.000 đơn). Anh Trung yêu cầu: không vá từng lỗi, thiết kế theo giả thuyết 50.000 khách, shop có hàng trăm nghìn đơn, hệ thống xử lý trên 1 triệu đơn/ngày.

---

## 1. Tóm tắt

1. Rà soát toàn bộ mã nguồn (5 mũi) ra **142 điểm**: 25 nghiêm trọng, 43 cao, 47 trung bình, 27 thấp. Khoảng 10 điểm trùng nhau giữa các mũi (cùng một worker được nhìn từ hai phía). Các điểm nặng nhất em đã tự mở mã kiểm lại.
2. 142 điểm này quy về **6 khuôn lỗi**. Sửa 6 khuôn thì hết cả loạt; sửa từng điểm thì tháng sau lại có điểm mới.
3. Phải tách hai loại việc, vì cách xử lý khác hẳn nhau:
   - **Tính đúng** (số sai, mất đơn, bán vượt tồn): không phụ thuộc quy mô, một số đang sai NGAY BÂY GIỜ với khách hiện tại. Phải sửa trước, không chờ mốc nào.
   - **Sức tải** (chậm, trễ): phụ thuộc quy mô. Kiến trúc phải làm xong từ sớm để sau này tăng tải chỉ là thêm máy, không phải viết lại. Tiền hạ tầng thì trả theo mốc tăng trưởng như `capacity-plan.ts` đang làm.
4. Thiết kế đích gồm 4 trụ: **sổ cái đơn**, **hàng đợi việc bền**, **đồng bộ có cam kết đầy đủ**, **tự đối soát**.
5. Lộ trình 5 giai đoạn, khoảng 10 đến 12 tuần. Giai đoạn 0 (cầm máu các lỗi tính đúng) mất khoảng 1 tuần và không đổi cấu trúc database.

---

## 2. Giả thuyết thiết kế và con số tải

| Đại lượng | Giá trị thiết kế | Ghi chú |
|---|---|---|
| Khách (chủ shop) | 50.000 | |
| Gian đã nối | khoảng 100.000 | ước 2 gian/khách |
| Đơn mới | 1.000.000/ngày | trung bình 12 đơn/giây, đỉnh sale gấp 5 đến 10 lần |
| Sự kiện sàn | khoảng 5 triệu/ngày | ước 5 sự kiện/đơn, trung bình 60/giây |
| Lệnh đẩy tồn | khoảng 3 triệu/ngày | ước 1,5 SKU/đơn × 2 gian nối |
| Dung lượng đơn | 3 đến 4 GB/ngày | ước 3 đến 4 KB/đơn gồm dòng hàng, sổ kho, chỉ mục |
| Shop lớn nhất | 300.000 đơn/tháng | |

Các số "ước" là giả định của em, chưa đo. Số đo thật hiện có: tài khoản demo 2.661 đơn/tháng, mỗi báo cáo chạy 1,5 đến 4 giây.

Hạ tầng hiện tại: web 512 MB, worker 512 MB, Supabase Pro 8 GB, 39 USD/tháng. Đây là mốc M1 trong `capacity-plan.ts`.

---

## 3. Kết quả rà soát

### 3.1. Tổng số

| Mũi rà | Nghiêm trọng | Cao | Trung bình | Thấp |
|---|---|---|---|---|
| Quảng cáo | 3 | 8 | 9 | 10 |
| Thuế, hóa đơn, KOC, trợ lý, HQ | 6 | 13 | 10 | 7 |
| Đơn hàng, tồn kho, sản phẩm | 9 | 9 | 12 | 5 |
| Worker, webhook, hạ tầng database | 7 | 13 | 16 | 5 |
| **Cộng** | **25** | **43** | **47** | **27** |

Mũi thứ năm không đếm lỗi mà lập bản đồ công thức Lãi/Lỗ: 40 điểm ghi, 13 nơi đọc.

### 3.2. Đang sai ngay bây giờ, không cần tới quy mô lớn

Cột "Đã kiểm" = em tự mở mã xác nhận, không chỉ dựa vào báo cáo của mũi rà.

| # | Vấn đề | Hậu quả | Đã kiểm |
|---|---|---|---|
| A1 | Đổi tay đơn sang "Đã giao" ở trang Đơn hàng thì hệ thống ghi phí và tiền về **giả lập** rồi đánh dấu đã quyết toán (`orders.ts:432`) | Số bịa lẫn vào Lãi/Lỗ thật | Có |
| A2 | Đơn hủy mà sàn chưa báo tiền hoàn bị tính nguyên giá bán là lãi | Tab "Tất cả" của Lãi/Lỗ tháng 8 thừa 26.049.562 ₫ | Có, số prod |
| A3 | Job đẩy tồn bị kẹt ở trạng thái "đang chạy" sau mỗi lần deploy, không có mã nào gỡ; đối soát tồn bỏ qua SKU đang có job | Tồn trên sàn sai cho tới khi SKU đó đổi tồn lần nữa | Có |
| A4 | Webhook Lazada xử lý trong RAM, không lưu hàng đợi; deploy là mất | Mất sự kiện đổi trạng thái và trừ kho | Có (theo mũi rà, em đọc lại đoạn mã) |
| A5 | Một khái niệm có nhiều định nghĩa: "đơn lỗ" 3 cách, "đơn tính doanh thu" 2 cách, lợi nhuận quảng cáo dùng cột khác Lãi/Lỗ | Hai trang ra hai số | Có |
| A6 | Ngày giao của Shopee và Lazada ghi bằng giờ đồng bộ, không phải giờ sàn báo | Mọi thứ tính theo ngày giao (hạn xuất hóa đơn) bị lệch | Chưa |
| A7 | Shopee từ 00:00 đến 07:00 lấy số quảng cáo "hôm nay" thành hôm qua do dùng giờ máy chủ | Luật chặn tăng vọt mù 7 tiếng mỗi đêm | Có — đã sửa 01/10 |
| A8 | Bảng điểm Trợ lý quảng cáo 90 ngày nhưng chỉ nạp 30 ngày chi tiêu | Chấm đúng/sai của máy bị sai với kế hoạch cũ hơn 30 ngày | Có — đã sửa 01/10 |
| A9 | Tự dừng chiến dịch giới hạn 5 lệnh/ngày, lệnh bật lại được xử lý trước lệnh dừng | Chiến dịch lỗ thứ 6 trở đi vẫn chạy | Có — đã sửa 01/10 (bỏ trần) |
| A10 | Route tạo đơn giả `/mock-order` đang mở trên prod | Rủi ro bảo mật và dữ liệu | Chưa |

### 3.3. Sẽ sai khi khách lớn lên, và sai trong im lặng

| # | Vấn đề | Ngưỡng bắt đầu sai |
|---|---|---|
| B1 | Đồng bộ danh mục có trần trang; SKU ngoài danh sách vừa kéo bị chuyển "đã gỡ" và ngừng đẩy tồn (`product-sync.ts:83`) | Shopee, TikTok 20.000 sản phẩm; Lazada 10.000 |
| B2 | Đồng bộ đơn có trần trang, lần nạp lịch sử 90 ngày bỏ các cửa sổ MỚI nhất, và cờ "cần nạp" vẫn bị hạ | 10.000 đơn (Shopee, Lazada), 2.500 đơn (TikTok) |
| B3 | Biên lãi quảng cáo tính trên tập đơn bị cắt, cờ cắt bị bỏ qua | 20.000 đơn/30 ngày (Shopee, Lazada), 8.000 đơn/60 ngày (TikTok) |
| B4 | Tờ khai thuế quý/năm và ngưỡng doanh thu 1 tỷ tính qua phanh 20.000 đơn; kỳ nhỏ nhất chọn được là một quý | 20.000 đơn/quý |
| B5 | Tự xuất hóa đơn 20 tờ/shop/lượt, 15 phút/lượt, chạy tuần tự mọi shop | 1.920 đơn giao/ngày |
| B6 | Kiểm trạng thái hóa đơn với cơ quan thuế 400 tờ/shop/ngày, chỉ nhìn 30 ngày | 400 hóa đơn/ngày |
| B7 | KOC tính lãi trên 5.000 đơn lấy không theo thứ tự | 5.000 đơn gán KOC/kỳ |
| B8 | Số cảnh báo đồng bộ tồn hiển thị tối đa 100 | 100 cảnh báo |
| B9 | Đối soát hoàn, mã vận đơn, giao thất bại có trần gọi mỗi lượt và luôn ưu tiên cùng một nhóm đơn | 30 đến 60 đơn cần xử lý mỗi lượt |
| B10 | Báo cáo tài chính còn phanh 20.000 đơn (đã báo ra giao diện ở trang Dòng tiền, các trang khác chưa) | 20.000 đơn/kỳ |

### 3.4. Sức tải: không theo kịp

| # | Thành phần | Sức xử lý hiện tại | Nhu cầu ở quy mô thiết kế |
|---|---|---|---|
| C1 | Worker đồng bộ gian | 540 gian/giờ (3 gian mỗi 20 giây) | 100.000 đến 600.000 lượt/giờ |
| C2 | Hàng đợi webhook Shopee | 1 luồng, khoảng 1 việc/giây | khoảng 30 việc/giây |
| C3 | Hàng đợi đẩy tồn | 1 luồng, khoảng 1 việc/giây | khoảng 35 việc/giây |
| C4 | Đồng bộ danh mục | 1.440 gian/ngày | 100.000 gian/đêm |
| C5 | Làm mới token | khoảng 800 gian/giờ | khoảng 12.500 gian/giờ |
| C6 | Đối soát tồn | 1 vòng khoảng 104 giờ | 1 vòng mỗi 6 giờ |
| C7 | Kết nối database của worker | 3 kết nối cho khoảng 14 luồng việc | |
| C8 | Dung lượng database | 8 GB | đầy sau 2 đến 3 ngày |
| C9 | Hạn mức API sàn | TikTok Ads 80.000 lệnh/ngày cho cả app, đủ khoảng 1.700 shop | 50.000 shop |

Sức xử lý ở C2, C3 là suy từ chuỗi lệnh gọi, chưa đo.

Hệ quả nguy hiểm nhất của C1: cửa sổ quét (2 ngày với đơn, 7 ngày với đối soát) ngắn hơn thời gian đi hết một vòng gian (ít nhất 7,7 ngày). Khi đó dữ liệu rơi vào khe hở **mất vĩnh viễn** chứ không chỉ đến trễ.

---

## 4. Chẩn đoán: 6 khuôn lỗi

| Khuôn | Mô tả | Ví dụ |
|---|---|---|
| K1. Cộng trong bộ nhớ server | Kéo từng dòng lên rồi cộng bằng code, nên buộc phải có trần | Mọi báo cáo tài chính, biên lãi quảng cáo, KOC, HQ |
| K2. Trần im lặng | Cắt dữ liệu mà không báo cho nơi gọi và người dùng | B1 đến B10 |
| K3. Coi "chưa đọc hết" là "không có" | Lấy danh sách chưa đầy đủ làm căn cứ để xóa, hạ cờ, đánh dấu đã gỡ | B1, B2 |
| K4. Trạng thái nằm trong RAM | Cờ đang chạy, hàng đợi, bộ đếm, cache nằm trong tiến trình | A4, toàn bộ worker, bộ giới hạn tốc độ gọi sàn |
| K5. Vòng tuần tự qua mọi shop | Một vòng for đi hết khách, thời gian tăng theo số khách | C1, C4, C5, C6, báo cáo tuần, tự xuất hóa đơn |
| K6. Nhiều công thức cho một khái niệm | Mỗi trang tự tính | A5, KOC, Tổng quan cũ, HQ |

---

## 5. Nguyên tắc kiến trúc

Đây là các bất biến, mọi tính năng mới phải tuân theo.

1. **Tiền ghi sổ một lần cho từng đơn, tổng do database cộng.** Không cộng tiền trong bộ nhớ server.
2. **Mọi lần đọc từ sàn phải trả kèm "đầy đủ" hay "bị cắt".** Kết quả bị cắt không được dùng để xóa, hạ cờ hay đánh dấu đã gỡ.
3. **Không có trần im lặng.** Có giới hạn thì phải hiện cho người dùng và đếm lên HQ.
4. **Việc nền là bản ghi bền trong database**, có người nhận, có hạn, có nhịp tim, có thử lại. Không có việc nào chỉ sống trong RAM.
5. **Mọi tiến trình chạy được nhiều bản song song.** Khóa, bộ đếm, giới hạn tốc độ nằm ở nơi dùng chung.
6. **Mỗi khái niệm một định nghĩa**, đặt tên, viết ở một chỗ, có test.
7. **Hệ thống tự phát hiện sai lệch** trước khách: đối soát sổ với đơn gốc hằng đêm, đo độ trễ từng hàng đợi.
8. **Sức tải tăng bằng cách thêm máy**, không bằng cách sửa code.

---

## 6. Thiết kế đích

### 6.1. Sổ cái đơn

**Cấu trúc**

- `OrderLedger`: mỗi đơn một dòng. Chứa toàn bộ kết quả của công thức Lãi/Lỗ (giá trị sản phẩm, voucher, từng nhóm phí, thuế sàn, tiền hoàn, giá vốn, giá vốn thu hồi, doanh thu, lợi nhuận) cùng các cột để lọc và nhóm: chủ shop, gian, sàn, trạng thái giao, trạng thái hoàn, đã quyết toán hay chưa, loại hoàn.
- `OrderLineLedger`: mỗi dòng hàng một dòng. Dùng cho Lãi/Lỗ theo SKU và biên lãi quảng cáo. Phí của đơn được phân bổ xuống dòng theo tỷ trọng, lưu sẵn.
- Ba cột ngày, mỗi cột kèm khóa ngày theo giờ Việt Nam: ngày tạo đơn (cơ sở hiện tại), ngày giao, ngày quyết toán.
- Cột **chủ shop trực tiếp** trên sổ. Hiện bảng đơn không có cột này, 49 truy vấn phải lọc vòng qua bảng gian.
- Chia bảng theo tháng (partition) ngay từ đầu. Làm lúc bảng còn nhỏ thì rẻ, làm sau thì phải dừng hệ thống.

**Giữ sổ luôn đúng**

| Cơ chế | Mục đích |
|---|---|
| Trigger ở database đánh dấu "cần tính lại" khi đơn, dòng hàng hoặc bản kê đối soát đổi | Không phụ thuộc việc lập trình viên nhớ gọi hàm. 40 điểm ghi hiện có, gồm cả các lệnh SQL sửa giá vốn hàng loạt không trả về danh sách đơn, đều được bắt |
| Worker tính lại các đơn bị đánh dấu | Sổ mới trong vài giây |
| Báo cáo tính lại các đơn còn bị đánh dấu trong kỳ trước khi cộng | Số luôn đúng tại thời điểm xem |
| Số phiên bản công thức trên từng dòng | Đổi công thức thì tính lại nền, không trộn hai công thức trong một báo cáo |
| Job đêm tính lại một mẫu đơn từ dữ liệu gốc, so với sổ | Lệch một đồng là báo đỏ lên HQ |

**Không lưu vào sổ**: thuế bổ sung (tính trên tổng kỳ, kẹp về 0 khi lỗ), tên gian, mã SKU kho. Ba thứ này lấy lúc đọc.

**Báo cáo** chuyển thành truy vấn cộng trong database. Trang danh sách từng đơn phân trang ở database. Không còn phanh 20.000.

### 6.2. Hàng đợi việc bền

- Dùng hàng đợi trên chính Postgres. Em nghiêng về thư viện pg-boss (đã có trong danh mục việc của mốc M4). Lý do chọn Postgres thay vì Redis: ghi đơn và xếp việc nằm **chung một giao dịch**, nên không thể có chuyện đơn đã ghi mà việc đẩy tồn bị mất. Ở 60 sự kiện/giây Postgres đủ sức.
- Mỗi việc có: khóa chống trùng, người nhận, hạn giữ, nhịp tim, số lần thử, giãn cách thử lại, hàng đợi lỗi để người xem.
- Việc bị kẹt được gỡ theo hạn giữ, không theo lúc khởi động tiến trình.
- Bốn nhóm hàng đợi tách nhau để nhóm này nghẽn không kéo nhóm kia: sự kiện sàn, đẩy tồn, đồng bộ định kỳ, việc nặng (nạp lịch sử, xuất tệp, nhập Excel).
- Cả ba sàn đi qua cùng một đường nhận webhook: kiểm chữ ký, ghi hàng đợi, trả 200.
- Mọi lệnh gọi sàn có thời hạn chờ. Hiện không lệnh nào có.
- Các việc chạy trong request (so sánh tồn, đồng bộ tay, nối nhanh, nhập Excel, xác nhận hàng loạt) chuyển thành việc nền có thanh tiến độ.

**Đã kiểm 01/10/2026**: pg-boss chạy được qua bộ gộp kết nối của Supabase (kết quả và phần chưa kiểm ở `docs/HANG-DOI-BEN.md` mục 1).

### 6.3. Đồng bộ có cam kết đầy đủ

- **Webhook là đường chính**, quét định kỳ là lưới an toàn.
- Quét theo **mốc nước** của từng gian: lưu thời điểm đã đọc tới, lần sau đọc tiếp từ đó. Không còn cửa sổ cố định 2 ngày, nên không còn khe hở mất dữ liệu.
- Đơn không đổi thì không ghi lại. Hiện mỗi đơn bị ghi lại tới 288 lần trong 2 ngày.
- Mọi hàm đọc từ sàn trả về kiểu `{ dữ liệu, đầy đủ }`. Trình biên dịch buộc nơi gọi xử lý trường hợp chưa đầy đủ.
- Đánh dấu "đã gỡ", hạ cờ nạp lịch sử chỉ được chạy khi lần đọc đầy đủ.
- Nhịp quét theo mức hoạt động: gian vừa có đơn quét dày, gian im ắng quét thưa.

### 6.4. Hạn mức API sàn

Đây là giới hạn **bên ngoài**, kiến trúc nào cũng không vượt được.

- Bộ giới hạn tốc độ và cầu dao dùng chung giữa các tiến trình.
- Ngân sách lệnh gọi theo app và theo shop, ưu tiên việc ảnh hưởng tiền và tồn kho.
- Lập hồ sơ xin nâng hạn mức với từng sàn theo mốc tăng trưởng. TikTok Ads 80.000 lệnh/ngày chỉ đủ khoảng 1.700 shop.

### 6.5. Tồn kho

- Trừ kho và xếp lệnh đẩy tồn trong cùng một giao dịch.
- Gộp lệnh đẩy theo SKU, đẩy theo lô khi sàn cho phép.
- Đối soát tồn chia theo gian, nhận việc qua hàng đợi, chạy song song.
- Giao dịch ghi đơn có thời hạn rõ ràng, khóa theo thứ tự cố định để tránh khóa chéo khi SKU bán chạy.

### 6.6. Thuế và hóa đơn

- Xuất hóa đơn qua hàng đợi theo shop, sức xử lý tăng theo số worker.
- Ràng buộc duy nhất ở database: một đơn một hóa đơn gốc.
- Tờ khai và ngưỡng 1 tỷ tính từ sổ cái.
- Kiểm trạng thái với cơ quan thuế tới khi có kết luận, không bỏ sau 30 ngày.

### 6.7. Quảng cáo

- Biên lãi, hòa vốn, nhịp bán tính từ sổ dòng hàng bằng truy vấn cộng.
- Dùng cùng cột lợi nhuận với trang Lãi/Lỗ.
- Hàng đợi riêng cho nhịp quảng cáo.

### 6.8. Vòng đời dữ liệu

- Chia bảng theo tháng: đơn, dòng hàng, sổ kho, nhật ký webhook, hiệu suất quảng cáo theo ngày.
- Chính sách lưu giữ cho mọi bảng nhật ký.
- Bổ sung chỉ mục còn thiếu (danh sách cụ thể ở phụ lục B).

### 6.9. Quan sát

Trang HQ Sức khỏe thêm: độ trễ và độ dài từng hàng đợi, tỷ lệ lần đọc bị cắt, số đơn lệch sổ, số gian quá hạn quét, thời gian một vòng đối soát.

### 6.10. Hàng rào chống tái phạm

- Test tự động chặn truy vấn cộng tiền có giới hạn số dòng.
- Test chặn biến trạng thái cấp tiến trình trong thư mục worker.
- Danh mục định nghĩa (đơn lỗ, đơn tính doanh thu, lợi nhuận) ở một tệp, các trang chỉ được gọi.

---

## 7. Lộ trình

Nguyên tắc chuyển đổi: chạy song song cũ và mới, so khớp trên dữ liệu prod, khớp thì mới chuyển. Mỗi bước có đường lui.

| Giai đoạn | Nội dung | Thời gian | Đổi database |
|---|---|---|---|
| **0. Cầm máu** | A1 đến A10, B1, B2, A3; hiện cờ "bị cắt" ở mọi trang còn thiếu | 1 tuần | Không |
| **1. Sổ cái đơn** | Bảng sổ, trigger, worker tính lại, dựng sổ cho đơn cũ theo lô; chuyển lần lượt Dòng tiền, Lãi/Lỗ, Tổng quan, Thuế, SKU, KOC, quảng cáo | 3 tuần | Có |
| **2. Hàng đợi và webhook** | Hàng đợi bền; webhook 3 sàn; đẩy tồn; thời hạn chờ cho lệnh gọi sàn | 2 đến 3 tuần | Có |
| **3. Đồng bộ và các worker còn lại** | Mốc nước, cam kết đầy đủ; danh mục, token, đối soát tồn, hóa đơn, báo cáo tuần chuyển sang hàng đợi | 2 đến 3 tuần | Có |
| **4. Vòng đời dữ liệu và quan sát** | Chia bảng theo tháng, lưu giữ, chỉ mục, chỉ số HQ, hàng rào | 2 tuần | Có |

Hạ tầng (số worker, cỡ database) nâng theo mốc trong `capacity-plan.ts`. Sau giai đoạn 3, nâng tải là đổi cấu hình và thêm máy.

**Tiêu chí nghiệm thu giai đoạn 1**: với mọi bộ lọc, số từ sổ khớp từng đồng với số tính từ đơn gốc trên toàn bộ dữ liệu prod; báo cáo tháng của shop 300.000 đơn (dữ liệu sinh thử) trả về dưới 2 giây.

---

## 8. Điều em không cam kết và rủi ro

- **Số của sàn đến trễ hoặc sàn điều chỉnh sau đối soát.** Báo cáo đúng theo dữ liệu đã có và đổi khi sàn gửi số mới.
- **Hạn mức API sàn.** Nếu sàn không nâng, một số tính năng quảng cáo phải giới hạn theo gói.
- **Chi phí hạ tầng ở 1 triệu đơn/ngày** là hàng nghìn USD/tháng. Em chưa lập dự toán chi tiết.
- **Dựng sổ cho đơn cũ** là thao tác đọc nặng nhất của cả lộ trình. Phải chạy theo lô, ngoài giờ cao điểm, có giám sát lưu lượng Supabase.
- **Trigger làm mỗi lần ghi đơn chậm thêm một chút.** Phải đo trước khi bật trên prod.
- Các con số sức xử lý ở mục 3.4 phần lớn là suy luận từ mã, chưa đo tải thật.

---

## 9a. Anh Trung đã chốt (30/09/2026)

| # | Quyết định | Tình trạng |
|---|---|---|
| 1 | Duyệt hướng 4 trụ. Hạ tầng nâng dần theo mốc trong HQ; code làm chuẩn cho quy mô lớn ngay | Đang làm |
| 2 | Đơn lỗ là đơn có lãi < 0 (anh xác nhận lại 30/09) | Đã code: `isLossOrder`, áp cho trang Đơn lỗ, lọc Lợi nhuận âm, chuông cảnh báo, Trợ lý |
| 6 | Đơn hủy coi như doanh thu bằng 0 | Đã code trong công thức gốc; tiền về âm (phí sàn vẫn trừ) giữ nguyên |
| 7 | Đơn chưa có giá vốn loại khỏi lợi nhuận, vẫn tính doanh thu, ghi rõ "X đơn chưa có giá vốn…" | Đã code: Báo cáo dòng tiền, Lãi/Lỗ, Tổng quan, Trợ lý |
| 3 | Đơn ĐANG hoàn không tính vào doanh thu | Đã code: `lib/finance-definitions.ts`, áp cho Tổng quan, Báo cáo dòng tiền, Trợ lý |
| 4 | Quyết toán giả lập bỏ hẳn với gian sàn | Đã code: chỉ còn gian Offline |
| 5 | Tờ khai thuế tính theo ngày sàn báo giao thành công, giống báo cáo thuế của các sàn | Đã code, nằm sau công tắc `TAX_DECLARATION_BY_DELIVERED=1`; bật sau khi sửa mốc giao đơn cũ (xem dưới) |
| 8 | Báo cáo thuế: đơn chưa có giá vốn loại khỏi thuế bổ sung, có cảnh báo "X đơn chưa có giá vốn nên chưa tính vào thuế bổ sung" | Đã code. Chỉ áp khi thuế bổ sung tính trên lợi nhuận; tính trên doanh thu thì giá vốn không ảnh hưởng nên không loại |

**Về quyết định 2.** Đơn thiếu giá vốn mà lãi vẫn âm thì vẫn là đơn lỗ: bổ sung giá vốn chỉ làm số âm thêm. Lãi bằng 0 không phải lỗ.

**Về quyết định 7.** Đẳng thức mới của mọi trang: Doanh thu − Chi phí − phần lợi nhuận của đơn chưa có giá vốn = Lợi nhuận. Báo cáo thuế (`/tax/report`) chưa áp quy tắc này: loại đơn thiếu giá vốn sẽ làm giảm số dự phòng thuế bổ sung, cần anh chốt riêng.

**Về quyết định 3.** "Đang hoàn" là đơn có hàng hoàn chưa xử lý xong: đang chờ về kho, đã quét nhận chưa nhập kho, hoặc hỏng/mất đang chờ khiếu nại. Hoàn đã xong (nhập kho, khiếu nại thắng hoặc thua) thì đơn quay lại báo cáo, tiền hoàn nằm ở dòng "Tiền hoàn trả khách". Thẻ Doanh thu có thêm dòng tham khảo "Đang hoàn/trả".

**Về quyết định 5.** Mốc là lúc sàn báo đơn giao thành công (Shopee: Hoàn thành). Trình tự bật:

1. Deploy bản có `lib/delivered-at.ts`: đơn mới lấy thời điểm sàn cập nhật đơn; đơn cũ tự sửa mỗi khi được đồng bộ lại.
2. Chạy SQL tạo chỉ mục `Order(channelId, deliveredAt)` trên Supabase (`prisma/migrations/20260930090000_order_delivered_at_index`).
3. Chạy một lần `npx tsx scripts/fix-delivered-at.ts` trên Render Shell của worker để sửa mốc giao đơn cũ Shopee và Lazada (mặc định 200 ngày). TikTok không cần, đã dùng mốc của sàn từ đầu.
4. Đặt `TAX_DECLARATION_BY_DELIVERED=1` trên Render (web). Trước bước này tờ khai vẫn cắt theo ngày tạo đơn như cũ.

Lý do phải có công tắc: trước 30/09 mốc giao ghi bằng giờ đồng bộ, đơn nạp lịch sử lúc nối gian mang ngày nạp. Bật tờ khai mới khi chưa sửa thì đơn của quý trước bị xếp nhầm sang quý nối gian.

Giới hạn còn lại: mốc lấy từ "thời điểm sàn cập nhật đơn lần cuối" là xấp xỉ. Đơn đã giao rồi mới phát sinh thay đổi (ví dụ hoàn hàng) mà Hubsell chỉ thấy lần đầu sau thay đổi đó thì mốc sẽ muộn hơn thực tế.

## 9. Việc cần anh Trung chốt (danh sách gốc 29/09)

1. Duyệt hướng 4 trụ và thứ tự 5 giai đoạn.
2. Cho làm giai đoạn 0 ngay.
3. Chốt định nghĩa:
   - Đơn lỗ: lãi nhỏ hơn 0, hay nhỏ hơn hoặc bằng 0? Có tính đơn thiếu giá vốn không?
   - Đơn đang hoàn có tính vào doanh thu không? Hiện Tổng quan loại, Báo cáo dòng tiền tính.
   - Đơn hủy chưa có số hoàn từ sàn: coi doanh thu bằng 0?
4. A1: bỏ hẳn việc ghi quyết toán giả lập khi đổi tay sang "Đã giao", hay chỉ giữ cho gian Offline?
5. Tờ khai thuế tính theo ngày tạo đơn, ngày giao hay ngày quyết toán? Việc này cần ý kiến kế toán.

---

## Phụ lục A. Danh sách điểm ghi làm đổi số của đơn

Sáu nhóm, khoảng 40 điểm: đồng bộ đơn 3 sàn và webhook; đối soát thật và ước tính; đồng bộ hoàn trả; nhận hàng hoàn, khiếu nại, hủy tay; sửa giá vốn và vá giá vốn đơn cũ; xóa gian. Chi tiết tệp và dòng nằm trong báo cáo mũi rà số 5.

## Phụ lục B. Chỉ mục còn thiếu

| Dạng truy vấn | Chỉ mục đề xuất |
|---|---|
| Gian + đã quyết toán + ngày tạo | (gian, đã quyết toán, ngày tạo) |
| Gian + trạng thái giao + ngày tạo | (gian, trạng thái giao, ngày tạo) |
| Theo ngày giao, ngày quyết toán | chỉ mục chứa từng cột ngày |
| Quét mã vận đơn ở kho | (gian, mã vận đơn), (gian, mã vận đơn hoàn) |
| Dòng hàng theo sản phẩm | (sản phẩm) |
| Tìm gian theo mã shop của sàn khi nhận webhook | (sàn, mã shop sàn) |
| Lấy việc webhook theo thứ tự | chỉ mục riêng phần cho việc đang chờ, theo ngày tạo |

Sáu chỉ mục đang thừa (đã được chỉ mục khác bao phủ) nên gỡ để giảm chi phí ghi.
