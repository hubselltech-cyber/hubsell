# Hạn khiếu nại đơn hoàn — quy định 3 sàn + phương án cột "Hạn khiếu nại"

> 23/11/2026. Anh Trung gửi ảnh tab **Video đóng hàng → Đơn hoàn**: "mỗi đơn trả hàng trên sàn đều có một thời gian khiếu
> nại nhất định. Thời gian đó bắt đầu khi nào, kết thúc khi nào là điều quan trọng nhất để nhắc khách 'hạn khiếu nại'.
> Đầu tiên hãy kiểm tra nội dung mới nhất về quy định của các sàn để lên phương án thêm cột 'Hạn khiếu nại'."
>
> Trạng thái: đã tra quy định (mục 1), kiểm API bằng dữ liệu thật (mục 6–7), **lát 1 máy chủ LÊN PROD 23/11 ~15:25
> (`9d131697`, mục 8–9)**. Chưa có giao diện. Hai câu ở mục 5 vẫn chờ anh.
>
> Tra trước đó (13/11, `DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md` mục 8.3) đã có số Shopee / TikTok; lần này đọc lại trang
> chính thức, có thêm Lazada (lần trước không đọc được) và các trường hạn trong API.

## 1. Quy định từng sàn (đọc trang chính thức 23/11/2026)

Ký hiệu: **[đọc]** = đã đọc toàn văn trang chính thức; **[suy]** = em suy ra, chưa trang nào nói thẳng.

### 1.1 Shopee

| Ca | Hạn | Bắt đầu tính từ | Ghi chú | Nguồn |
|---|---|---|---|---|
| Khách trả hàng, kiện về sai / hỏng / thiếu / đã dùng | **2 ngày** (tính cả thứ 7, CN, trừ ngày lễ) | Đơn "cập nhật trả hàng thành công cho Người bán" **hoặc** sau ngày nhận hàng hoàn dự kiến — **"tùy điều kiện nào đến trước"** (câu mới ở bản 06/11/2026). Khách tự gửi: từ lúc khách xác nhận đã gửi | Nút Khiếu nại chỉ hiện trong 2 ngày. Video / hình mở hàng là bằng chứng bắt buộc (Mall) | **[đọc]** banhang.shopee.vn/edu/article/563 (06/11/2026), /10626 (20/08/2026), /3647 (03/11/2025), /22227 (22/09/2025) |
| Shopee "Hoàn tiền ngay" (không cần trả hàng) | 2 ngày | Lúc Shopee gửi thông báo Hoàn tiền ngay | Quá hạn = mất quyền khiếu nại | **[đọc]** /563, /10626 |
| Giao không thành công / hủy khi đang giao, kiện hoàn về hỏng / thiếu / rỗng | **7 ngày** | "sau khi đơn hàng được cập nhật trạng thái chuyển hoàn thành công" | Câu chữ đọc được hai nghĩa; em hiểu là "trong vòng 7 ngày" **[suy]**. Bằng chứng: video đóng gói có mã đơn + mã vận đơn, video mở kiện 6 mặt, biên bản đồng kiểm nếu kiện không nguyên đai | **[đọc]** /10499 (03/07/2025) |
| Chưa nhận được hàng hoàn (khách trả) | 2 ngày | Sau ngày nhận hàng hoàn dự kiến (hiện trên Kênh Người Bán, tự ẩn khi đã qua) | | **[đọc]** /563, /3647 |

- Khách: gửi trả trong 6 ngày; xin trả trong 15 ngày từ lúc giao thành công.
- Blog bên ngoài ghi "2 ngày làm việc" / "24 giờ với SPX" — trang chính thức không có, **không dùng**.
- API `v2.returns.get_return_detail` (đọc open.shopee.com): `due_date` = hạn cuối người bán xử lý; `return_ship_due_date` = hạn
  khách gửi hàng; **`return_seller_due_date` = hạn người bán xử lý sau khi khách đã gửi** — nhiều khả năng chính là mốc 2 ngày
  (đã gồm câu "tùy điều kiện nào đến trước"), tài liệu không nói rõ; `seller_compensation_due_date` = hạn người bán xin đền bù.
  **Hubsell chưa đọc trường nào trong số này** (`ShopeeReturnEntry` chưa khai).

### 1.2 TikTok Shop

| Ca | Hạn | Bắt đầu tính từ | Hết hạn | Nguồn |
|---|---|---|---|---|
| Yêu cầu trả hàng mới | 1 ngày | Lúc người bán nhận yêu cầu | Tự chấp thuận | **[đọc]** seller-vn knowledge_id=1766935302801169 (29/10/2026) |
| **Kiện trả đã về — kiểm hàng** | **2 ngày** (48 giờ) | Trạng thái trả hàng thành "Đã giao" | Tự chấp thuận hoàn tiền; bài 04/11/2025 ghi thêm: **không khiếu nại được** quyết định đó | **[đọc]** 1766935302801169, 6819122768905985 |
| Khiếu nại sau hoàn tiền (hoàn tiền nhanh, kiện đã về) | 7 ngày lịch | Kiện trả hàng chuyển "Đã giao" | Không trang nào nói | **[đọc]** 1766935302801169 |
| Hoàn tiền nhanh, kiện CHƯA về | 7 ngày | Từ ngày thứ 6 sau khi khách tải vận đơn (khách tự gửi: ngày thứ 15) | | **[đọc]** như trên (bài 08/01/2026 ghi 3 ngày — vênh) |
| Chỉ hoàn tiền / thua tranh chấp | 7 ngày lịch | Lúc khoản hoàn tiền được xử lý | | **[đọc]** như trên |
| Giao thất bại / thất lạc / hỏng do vận chuyển (đòi bồi thường) | **tối đa 40 ngày** | Lần cập nhật trạng thái vận chuyển gần nhất ("Đã giao", "Đã nhận hàng trả lại", "Gói hàng bị thất lạc"…) | Bị từ chối | **[đọc]** 6837808157378305 (26/05/2025) |

- Bài 08/01/2026: đã bấm **"Xác nhận kiện hàng"** thì hết quyền khiếu nại. Hubsell **không** gọi lệnh xác nhận kiện nào
  (`APPROVE_RECEIVED_PACKAGE` không có trong mã) — kho bấm "Nhận hàng" ở Hubsell không làm mất quyền khiếu nại trên sàn.
- **Khớp dữ liệu thật của mình** (docs đối soát mục 18.8): khi kiện về, sàn đặt hạn `SELLER_RESPOND_RECEIVE_PACKAGE` =
  `update_time` + đúng 48 giờ (6 / 6 mẫu); kiện còn trên đường thì hạn = lúc khách gửi + 14 ngày.
- Cửa sổ 2 ngày kiểm hàng và 7 ngày khiếu nại chạy song song từ cùng một mốc **[suy]** → việc an toàn là kiểm + khiếu nại
  trong 48 giờ.

### 1.3 Lazada (lần đầu đọc được trang chính thức)

Nguồn chính: "Hướng dẫn tạo yêu cầu khiếu nại", sellercenter.lazada.vn/helpcenter … questionId=1000150226, **cập nhật
20/11/2026**. Quá hạn thì hệ thống chặn gửi ("Quá thời gian gửi khiếu nại"). Trang chỉ ghi "ngày", không nói lịch hay làm việc.

| Ca | Hạn | Bắt đầu tính từ | Nguồn |
|---|---|---|---|
| Khách trả hàng (100 % nhà bán VN theo quy trình DRTM) — kiểm hàng | **2 ngày** để Hoàn tiền hoặc "Chuyển đến tư vấn viên" | Kiện về tới nhà bán (nhà bán bấm "Xác nhận đã nhận hàng hoàn trả" để bắt đầu kiểm). Quá hạn: hệ thống tự quyết, có thể tính điểm vi phạm | **[đọc]** questionId=1000152885 (16/01/2025) |
| Khách trả — hàng bị tráo / thiếu / hỏng | **7 ngày** | Ngày kiện hoàn về thành công | **[đọc]** 1000150226 |
| Không đồng ý quyết định tranh chấp DRTM | 14 ngày | Ngày nhà bán nhận hàng trả lại | **[đọc]** 1000150226 |
| Không đồng ý "Chỉ hoàn tiền" | 7 ngày | Ngày Lazada duyệt hoàn tiền | **[đọc]** 1000150226 |
| Giao thất bại, kiện hoàn về hỏng / thiếu | **7 ngày** | "kể từ ngày gói hàng được hoàn lại thành công"; bắt buộc biên bản đồng kiểm + video mở kiện + video đóng gói | **[đọc]** 1000150226 |
| Sàn báo "Đã trả lại kho" mà không nhận được | 7 ngày | Lúc trạng thái đổi | **[đọc]** 1000150226 |
| Kiện đứng yên lâu | chỉ gửi được **sau** 25 ngày từ lúc bàn giao vận chuyển | | **[đọc]** 1000150226 |

- Đã để hết hạn nộp bằng chứng hoặc đã đồng ý hoàn tiền → không khiếu nại được nữa.
- Con số "90 ngày" của blog cũ (lần tra 13/11) **sai so với trang hiện tại → bỏ**.
- API: `sla` ("seller operation sla in milliseconds", giá trị mẫu trông như MỐC thời gian) có thể là hạn 2 ngày kiểm hàng
  — **chưa kiểm bằng dữ liệu thật**; `is_dispute`, `whqc_decision`, `ofc_status`. Không có trường hạn khiếu nại 7 / 14 ngày,
  không có trường "ngày kiện về tới nhà bán".

### 1.4 Gộp lại — điều quan trọng nhất cho khách

**Kiện khách trả về tới shop: cả 3 sàn chỉ cho 2 ngày.** Quá 2 ngày thì sàn tự hoàn tiền (TikTok, Lazada) hoặc nút khiếu nại
biến mất (Shopee). Hạn 7 ngày (TikTok, Lazada) chỉ là cửa khiếu nại chạy song song, không phải lý do để chờ.
**Kiện giao thất bại quay về: Shopee 7 ngày, Lazada 7 ngày, TikTok 40 ngày.**

## 2. Mốc Hubsell đang có (đọc mã 23/11)

| Mốc cần | Shopee | TikTok | Lazada |
|---|---|---|---|
| Kiện khách trả về tới shop | `returnDeliveredAt` — lấy `update_time` của `get_return_detail` khi `LOGISTICS_DELIVERY_DONE` (có thể trễ hơn giờ thật); đơn kho đã quét thì ghi bằng giờ quét | `returnDeliveredAt` = `update_time` lúc kiện về (LÊN PROD 23/11, `64563bc2`) — **chính xác** | **không có** (mã cố ý không ghi `returnDeliveredAt` vì enum Lazada không đủ) |
| Hạn sàn trả nguyên văn | có trong API (`return_seller_due_date`…), **chưa đọc** | `seller_next_action_response[].deadline` — **đã đọc** trong `tiktokReturnParcelArrivedAt` nhưng **không lưu** | `sla` (chưa rõ nghĩa), **chưa đọc** |
| Kiện giao thất bại quay về tới shop | **không lưu** (ô "Trạng thái vận chuyển" hỏi hãng lúc xem, không ghi DB) | không lưu | không lưu |
| Kho quét nhận kiện | `returnedAt` (cả 3 sàn) | | |

## 3. Phương án đề xuất

### 3.1 Cột hiện gì — MỘT hạn, hạn gần nhất còn tác dụng

Không hiện ba bốn con số. Mỗi đơn chỉ một ô, theo giai đoạn của kiện:

| Giai đoạn | Ô hiện | Màu |
|---|---|---|
| Kiện chưa về | "Chưa tính · chờ kiện về" | xám |
| Kiện đã về, còn hạn | **"Còn 1 ngày 4 giờ"**, dòng dưới "đến 14:30 25/11 · Shopee 2 ngày" | đỏ khi ≤ 24 giờ, cam khi ≤ 48 giờ, thường khi còn hơn |
| Quá hạn | "Quá hạn 3 giờ" | xám đỏ |
| Kho đã nhập kho nguyên vẹn | "Không cần" | xám nhạt |
| Thiếu mốc, không suy được | "Chưa rõ" (không đoán) | xám |

Rê chuột vào ô: luật đang áp ("Shopee · khách trả hàng · 2 ngày kể từ lúc kiện về") + hạn khiếu nại muộn hơn nếu có
("TikTok còn cửa khiếu nại 7 ngày tới 30/11").

### 3.2 Bảng luật (một hàm thuần, một chỗ để đổi số)

| Sàn · loại hoàn | Ưu tiên 1: hạn sàn trả | Ưu tiên 2: tính theo luật | Mốc lùi khi thiếu |
|---|---|---|---|
| Shopee · khách trả | `return_seller_due_date` (sau khi kiểm bằng dữ liệu thật — lát 0) | `returnDeliveredAt` + 2 ngày | kho quét `returnedAt` + 2 ngày, gắn chữ "ước tính" |
| Shopee · giao thất bại | — | mốc chuyển hoàn thành công + 7 ngày (chưa có mốc) | `returnedAt` + 7 ngày, "ước tính" |
| TikTok · khách trả | `deadline` của `SELLER_RESPOND_RECEIVE_PACKAGE` khi kiện đã về (đã chắc) | `returnDeliveredAt` + 48 giờ | `returnedAt` + 48 giờ, "ước tính" |
| TikTok · giao thất bại | — | lần cập nhật vận chuyển cuối + 40 ngày | `returnedAt` + 40 ngày, "ước tính" |
| Lazada · khách trả | `sla` (nếu lát 0 xác nhận là hạn kiểm hàng) | mốc kiện về + 2 ngày (chưa có mốc) | `returnedAt` + 2 ngày, "ước tính" |
| Lazada · giao thất bại | — | mốc hoàn thành công + 7 ngày | `returnedAt` + 7 ngày, "ước tính" |

⚠️ Mốc lùi "kho quét" luôn **muộn hơn** giờ kiện về thật → hạn hiện ra **muộn hơn** hạn sàn. Vì vậy phải ghi chữ "ước tính ·
tính từ lúc kho nhận, hạn sàn có thể sớm hơn" — không được để khách tưởng còn thời gian. Đây là lý do lát 0 + lát 1 ưu tiên
đọc hạn sàn trả nguyên văn.

### 3.3 Lưu ở đâu

Một cột mới `Order.returnComplaintDueAt` (+ nguồn: sàn / luật / ước tính), do **một hàm thuần** tính, ghi ở các chỗ đã chạm
đơn hoàn: đồng bộ yêu cầu hoàn 3 sàn + 4 đường kho (nhận / nhập / báo hỏng lẻ và hàng loạt). Chỉ mục một phần cho đơn còn hạn.
Lý do lưu thay vì tính lúc đọc: thẻ đếm "Sắp hết hạn", sắp xếp theo hạn và chuông nhắc đều cần lọc bằng SQL trên 50.000 khách
(chuẩn thiết kế 50.000 khách, không tính lặp từng dòng). **0 call sàn thêm**: TikTok + Lazada lấy từ lượt `returns/search` / `getreverseordersforseller`
đang chạy; Shopee lấy trong lượt `get_return_detail` đã gọi để dò kiện về (nếu `get_return_list` có sẵn trường thì càng rẻ —
lát 0 kiểm).

Không đụng sổ cái, không đụng Lãi/Lỗ, không đụng quảng cáo.

### 3.4 Các lát

| Lát | Việc | Ghi chú |
|---|---|---|
| 0 | Script CHỈ ĐỌC (như `tiktok-return-leg-probe.ts`): in trường hạn của ~10 yêu cầu Shopee + ~10 yêu cầu Lazada đang mở, so với mốc kiện về / kho quét | Chạy trên Render Shell worker; trả lời: `return_seller_due_date` có = kiện về + 2 ngày không, có trong `get_return_list` không; `sla` của Lazada là gì |
| 1 | Hàm thuần + bảng luật + cột `returnComplaintDueAt` + ghi từ đồng bộ và thao tác kho + test | Không giao diện |
| 2 | Web: cột "Hạn khiếu nại" ở tab Đơn hoàn (Video đóng hàng) + thẻ "Sắp hết hạn khiếu nại" (đã có trong thiết kế mục 58.3 tài liệu video) + sắp xếp theo hạn | Soi 1280–1700 sáng + tối |
| 3 | Chuông nhắc khi còn ≤ 24 giờ mà kho chưa báo hỏng / chưa nhập kho + app mobile | Dùng hệ chuông có sẵn |

## 4. Chưa chắc / để ý

- Shopee "7 ngày sau khi chuyển hoàn thành công" có thể là "sau 7 ngày mới được khiếu nại" — em đọc là "trong vòng".
- TikTok: mốc bắt đầu 7 ngày khiếu nại vênh giữa ba bài (29/10/2026: lúc kiện Đã giao; 04/11/2025: lúc hoàn tiền; 08/01/2026:
  lúc nút hiện ra) — lấy bài mới nhất.
- Lazada: trang không nói ngày lịch hay ngày làm việc → em tính ngày lịch (hạn sớm hơn = an toàn hơn).
- Hạn đổi theo sàn bất cứ lúc nào → hạn sàn trả nguyên văn luôn thắng số tự tính.

## 5. Câu chờ anh chốt

1. Ô hiện **một hạn gần nhất** (2 ngày kiểm hàng với kiện khách trả) như mục 3.1 — hay anh muốn thấy hạn khiếu nại 7 ngày?
2. Cột đặt ở tab Đơn hoàn của Video đóng hàng thôi, hay cả trang **Đối soát đơn hoàn** (nơi kho thật sự xử lý)?
3. Cho em làm lát 0 (script chỉ đọc, anh push + mở Render Shell như lần TikTok) trước khi code?

## 6. API có trả sẵn hạn không (23/11 chiều — anh: "cái trả hàng này hình như có API về thời gian khiếu nại, em thử kiểm tra")

**Có.** Đọc lại trang tài liệu gốc open.shopee.com 23/11 (hai lệnh Hubsell ĐANG gọi, chỉ chưa đọc các trường này):

| Trường | Ở lệnh nào | Mô tả nguyên văn của Shopee | Em hiểu là |
|---|---|---|---|
| `due_date` | `get_return_list` + `get_return_detail` | "The last time seller deal with this return." | hạn cuối người bán xử lý yêu cầu |
| `return_ship_due_date` | list + detail | "The due date for buyer to ship order." | hạn khách gửi hàng trả |
| **`return_seller_due_date`** | **list + detail** | "The due date for seller to deal with this return when buyer have shipped order." | **hạn người bán xử lý sau khi khách đã gửi = ứng viên số 1 cho "Hạn khiếu nại"** |
| `seller_proof.seller_evidence_deadline` | chỉ detail | "the deadline for submitting the evidence" | hạn nộp bằng chứng khi sàn đòi |
| `seller_compensation.seller_compensation_due_date` | chỉ detail | "the deadline for requesting the compensation" | hạn xin đền bù (kiện hoàn hỏng / mất) |
| `negotiation.offer_due_date` | chỉ detail | "offer_due_date" | hạn trả lời đề nghị thương lượng |
| `seller_proof_status`, `seller_compensation_status`, `negotiation_status` | list + detail | trạng thái từng việc | biết người bán còn được nộp / xin / thương lượng không |

- `return_seller_due_date` nằm ngay trong `get_return_list` — lệnh mà lượt quét hoàn nào cũng gọi → **0 call thêm**.
- TikTok: `seller_next_action_response[].deadline` (đã kiểm bằng payload thật sáng 23/11). Lazada: `reverse_order_lines[].sla`.
- **CHƯA kiểm bằng giá trị thật** của Shopee / Lazada: tài liệu chỉ một dòng mỗi trường, chưa biết `return_seller_due_date`
  có đúng = kiện về + 2 ngày không, có đổi khi kiện về không (như TikTok), và ở đơn giao thất bại có gì.
- Script chỉ đọc đã viết: `backend/scripts/return-due-date-probe.ts <channelId> [soNgay=3]` — tự nhận sàn của gian; Shopee
  ≤ 2 trang list + 6 detail, TikTok 1 trang, Lazada 1 trang; in từng trường hạn cạnh mốc kho quét / sàn báo kiện về của Hubsell
  và khoảng cách theo giờ. tsc sạch. **Chưa commit, chưa chạy** — máy local không có token gian thật, phải chạy trên Render
  Shell worker (cần push).

## 7. Giá trị THẬT (23/11 14:29, script chạy trên Render Shell worker, bản `e359d476`)

Anh: "Push và chạy đi". Gian Shopee có nhiều kiện hoàn kho vừa quét nhất 5 ngày qua (96 kiện), `get_return_list` 3 ngày:
**66 yêu cầu** (34 `PROCESSING`, 28 `ACCEPTED`, 4 `CANCELLED`) + 6 `get_return_detail`.

### 7.1 Shopee — `return_seller_due_date` ĐÚNG là hạn khiếu nại, có sẵn trong lượt list

Khóa thật của mỗi dòng `get_return_list` (nhiều hơn tài liệu): `due_date`, `return_ship_due_date`, `return_seller_due_date`,
`seller_evidence_deadline`, `negotiation`, `negotiation_status`, `seller_proof_status`, `seller_compensation_status`,
`is_arrived_at_warehouse`, `follow_up_action_list`, `return_refund_request_type`, `validation_type`, `is_seller_arrange`,
`is_shipping_proof_mandatory`, `reassessed_request_reason`… (hai khóa `is_arrived_at_warehouse`, `follow_up_action_list`
chưa in giá trị).

34 yêu cầu `PROCESSING` chia đúng ba nhóm, không dòng nào lệch:

| Giai đoạn | Số dòng | `return_seller_due_date` | Ví dụ |
|---|---|---|---|
| Khách CHƯA gửi hàng | 10 | trống (0) | tạo 22/11 12:41 → `due_date` 24/11 12:41 (tạo + 2 ngày), `return_ship_due_date` 25/11 12:41 |
| Khách đã gửi, kiện ĐANG trên đường | 11 | một ngày tương lai, luôn **23:59** (26/11, 27/11, 28/11 23:59) = hạn tạm theo ngày nhận hàng hoàn dự kiến | cách `update_time` 82–130 giờ |
| Kiện ĐÃ VỀ shop (Hubsell có mốc sàn báo về) | 13 | **= `update_time` + đúng 48,0 giờ** (13 / 13) | về 22/11 12:20 → hạn 24/11 12:20 |

- Tức là sàn làm y như TikTok: khi kiện về, đặt lại hạn = giờ kiện về + 48 giờ. Khớp câu chữ chính sách "2 ngày kể từ khi trả
  hàng thành công **hoặc** sau ngày nhận hàng hoàn dự kiến, tùy điều kiện nào đến trước" — hạn tạm 23:59 chính là vế "dự kiến".
- 28 yêu cầu `ACCEPTED`: hạn giữ nguyên sau khi đóng (không trôi theo `update_time`). So với mốc `returnDeliveredAt` Hubsell
  đang lưu: phần lớn đúng 48,0 giờ, vài dòng 46–47 giờ → **mốc kiện về của Hubsell có khi trễ 1–2 giờ** (lấy `update_time` lúc
  đọc, không phải lúc kiện về). Giờ kiện về thật = `return_seller_due_date` − 48 giờ.
- Yêu cầu "chỉ hoàn tiền" (`return_solution` 1) và yêu cầu đã hủy: không có hạn nào.
- 1 dòng lạ: `ACCEPTED`, không có `return_ship_due_date`, hạn 21/11 13:28 sớm hơn mốc Hubsell ghi 5 phút — nhiều khả năng là
  loại trả ngay khi giao / đồng kiểm (`return_refund_request_type` ≠ 0), chưa soi.
- 6 `get_return_detail`: `seller_evidence_deadline`, `seller_compensation_due_date`, `offer_due_date` đều **null** ở mẫu này
  (không yêu cầu nào đang bị đòi bằng chứng / xin đền bù) → chưa biết giá trị khi có; detail không thêm gì cho hạn chính.

**Bằng chứng khách đang lỡ hạn:** nhiều kiện về 18–19/11 (hạn 20–21/11) mà kho quét cả lô lúc 20/11 17:04. Một yêu cầu hạn
20/11 12:37, kho quét 17:04 — **sau hạn 4,5 giờ**; các yêu cầu khác còn 19–24 giờ. Đây đúng là thứ cột "Hạn khiếu nại" phải báo.

### 7.2 Lazada — chưa có dữ liệu để soi

3 gian Lazada đang hoạt động: 2 gian trả 0 yêu cầu trong 10 ngày, 1 gian (gian demo) thiếu token. `sla` vẫn chưa rõ nghĩa.

### 7.3 Hệ quả cho phương án

- **Shopee khách trả hàng: đọc thẳng `return_seller_due_date` từ `get_return_list`** — 0 call thêm, không cần tự cộng 2 ngày,
  không cần mốc kiện về. Kiện chưa về: hiện hạn tạm kèm chữ "dự kiến"; kiện về: hạn chốt.
- TikTok: `seller_next_action_response[].deadline` (đã kiểm sáng 23/11). Hai sàn này phủ gần hết đơn hoàn của khách.
- Lazada + mọi ca giao thất bại: vẫn tính theo luật ở mục 3.2 (chưa có hạn sàn trả).
- Việc phụ có thể làm cùng lát: sửa `returnDeliveredAt` Shopee = hạn − 48 giờ cho chính xác — **đụng cột Lãi/Lỗ đang đọc, phải đo
  trước**, không gộp vào lát cột hạn.

## 8. Lát 1 máy chủ (23/11 chiều) — commit `9d131697`, lên prod mục 9

Anh: "Duyệt, làm lát 1". Phạm vi: máy chủ LƯU hạn sàn trả + hàm tính hạn để lát giao diện đọc. Không có giao diện, không
đụng sổ cái / Lãi/Lỗ / quảng cáo, **0 call sàn thêm**.

**Cột mới trên `Order`** (migration `20261123160000_order_return_complaint_due`, chỉ thêm cột — Postgres sửa metadata, lấy
khóa có `lock_timeout` + thử lại như migration 20/11; chưa có chỉ mục, để lát giao diện dựng `CONCURRENTLY`):

| Cột | Ý nghĩa |
|---|---|
| `returnComplaintDueAt` | hạn khiếu nại nguyên văn của sàn. Trống = sàn chưa / không cho hạn |
| `returnComplaintDueProvisional` | `true` = hạn TẠM của Shopee lúc kiện còn trên đường |

Trigger sổ cái có danh sách cột riêng, không gồm hai cột này → ghi hạn không làm bẩn sổ.

**Ai ghi** (cùng lượt đồng bộ yêu cầu hoàn đang chạy, chỉ ghi khi giá trị đổi):

| Sàn | Lấy từ | Luật |
|---|---|---|
| Shopee | `return_seller_due_date` của yêu cầu sống mới nhất (`planReturnUpdate`) | > 0 → lưu; rơi đúng 23:59:59 giờ VN → đánh dấu TẠM (11 / 11 mẫu tạm rơi vào giây này, 0 / 13 mẫu chốt); sàn trả 0 → xóa hạn tạm đang lưu, giữ hạn chốt |
| TikTok | hạn `SELLER_RESPOND_RECEIVE_PACKAGE` (`tiktokReturnSellerDue` trong `planTiktokReturnUpdate`) | chỉ nhận khi hạn = kiện về + 48 giờ ± 1 giờ, so với `update_time` hoặc mốc kiện về đã lưu; kiện trên đường (hạn = khách gửi + 14 ngày) KHÔNG lưu; yêu cầu đóng rồi thì giữ hạn đã lưu |
| Cả hai | yêu cầu bị hủy / chỉ hoàn tiền (khách giữ hàng) | xóa hạn |
| Lazada, kiện giao thất bại | — | không có hạn sàn → để trống, tính theo luật lúc hiện |

**Hàm thuần `backend/src/lib/return-complaint-due.ts`:**
- `COMPLAINT_WINDOW_HOURS` — bảng luật một chỗ: khách trả 48 giờ cả 3 sàn; giao thất bại Shopee 168, Lazada 168, TikTok 960 giờ.
- `complaintDueOf(order)` → `NOT_NEEDED` (không phải đơn hoàn / đã nhập kho nguyên vẹn / đã đền / đã xóa sổ) · `NOT_STARTED`
  (kiện chưa về, sàn chưa cho hạn) · `UNKNOWN` (sàn không có luật, hoặc kiện đã về mà không có mốc giờ) · `DUE` kèm nguồn:
  `platform` (sàn trả, chốt) / `platform_provisional` (sàn trả, tạm) / `rule` (luật + mốc sàn báo kiện về) / `estimate`
  (luật + giờ kho quét — phải hiện chữ "ước tính"). Dùng lại `returnShippingOf` nên cùng cách tin mốc với cột Trạng thái vận chuyển.
- `complaintDuePatch`, `shopeeSellerDue`, `isEndOfDayVn` — phần ghi idempotent.

**Test:** `lib/__tests__/return-complaint-due.test.ts` (23 ca) + thêm vào `shopee-returns-sync.test.ts` (7 ca) và
`tiktok-returns-sync.test.ts` (8 ca) bằng số của payload thật + 1 ca ghi thật xuống database ở
`tiktok-returns-for-orders-db.test.ts`. tsc sạch. Cả bộ backend: 2.947 qua, 24 trượt ở 12 tệp sổ cái / xóa gian / giữ video —
chạy lại 3 tệp trong số đó trên mã CHƯA sửa vẫn trượt y hệt ("còn dòng bẩn" trong database local) → có từ trước, không do lát này.

**Chưa làm / chưa kiểm:**
- Chưa chạy với sàn thật (lượt đồng bộ Shopee ghi thật xuống database chỉ kiểm qua hàm thuần; ca ghi database mới có ở TikTok).
- Đơn hoàn có từ trước: không điền lại; yêu cầu nào còn biến động thì lượt đồng bộ kế tiếp tự ghi (Shopee quét 7 ngày biến động).
- Chưa có chỉ mục, chưa có API / cột giao diện (lát 2), chưa có chuông (lát 3).
- Mốc `returnDeliveredAt` Shopee trễ 1–2 giờ: KHÔNG sửa trong lát này.

## 9. Lên prod 23/11 (anh: "Push đi")

**Deploy:** worker áp migration lúc 15:15:24 → 15:15:41 (17 giây, phải chờ khóa bảng đơn) và lên bản mới. Web chạy
`prisma migrate deploy` CÙNG LÚC → chờ khóa cố vấn của Prisma quá 10 giây (`P1002 … advisory lock`) → exit 1 → Render đánh
"Deploy failed", web giữ bản cũ `e359d47` (chạy bình thường với hai cột thêm). Không phải lỗi mã. Em bấm Manual Deploy → Deploy
latest commit cho web; `/health` báo `9d131697` lúc ~15:25. Bẫy đã ghi vào memory gotcha migration.

**Soi database prod ~15:27 (≈ 10 phút sau khi worker lên, SQL chỉ đọc):**

| Sàn | Đơn có hạn | Số gian | Hạn tạm | Hạn khớp đúng mốc kiện về + 48 giờ (± 1 giờ) | Kho đã quét | Đã quá hạn mà kho chưa quét | Còn ≤ 24 giờ |
|---|---|---|---|---|---|---|---|
| Shopee | 100 | 9 | 18 (cả 18 rơi 23:59 giờ VN) | 35 / 80 đơn hạn chốt có mốc kiện về | 0 | 48 | 23 |
| TikTok | 107 | 14 | 0 | 106 / 107 | 3 | 7 | 50 |

- TikTok khớp gần trọn (106 / 107) — đúng như thiết kế.
- Shopee: hạn tạm đúng 18 / 18. Hạn chốt chỉ 35 / 80 khớp `returnDeliveredAt` + 48 giờ → mốc kiện về Shopee Hubsell đang lưu lệch
  nhiều hơn "1–2 giờ" đã thấy ở mục 7 (mốc lấy `update_time` lúc đọc chi tiết, có thể trễ cả ngày). Hạn hiển thị KHÔNG bị ảnh
  hưởng vì lấy thẳng của sàn; chỉ Lãi/Lỗ đọc mốc kiện về — chưa đo, không sửa trong lát này.
- 48 đơn Shopee + 7 đơn TikTok đã quá hạn mà kho chưa quét: shop không dùng màn quét kho, hoặc lỡ hạn thật — chưa phân biệt được.
- Mới 9 gian Shopee / 14 gian TikTok có hạn: lượt quét hoàn chạy theo lịch từng gian, các gian còn lại sẽ có dần. Đơn kho đã quét
  từ trước (vd gian chạy thử mục 7) chưa thấy hạn — đợi lượt quét của gian đó rồi kiểm lại.

**Chưa làm:** soi lại sau vài giờ (đủ gian, đơn kho đã quét có hạn chưa); lát 2 giao diện chờ anh chốt 2 câu mục 5.

## 10. Soi lại prod 25/11 tối (tác vụ hẹn giờ, SQL chỉ đọc qua Supabase SQL Editor trên Chrome của anh)

Một câu SQL gom theo sàn trên toàn bộ đơn có `returnStatus` ≠ NONE (chạy một lần, đừng lặp):

| Sàn | Đơn có hạn (23/11 → 25/11) | Số gian | Hạn tạm | Hạn chốt khớp mốc kiện về + 48 giờ (± 1 giờ) | Có hạn mà kho đã quét | Quá hạn, kho chưa quét | Còn ≤ 24 giờ | Kho quét 5 ngày qua → có hạn | Đơn hoàn đang mở → có hạn |
|---|---|---|---|---|---|---|---|---|---|
| Shopee | 100 → **774** | 9 → **46** | 129 | 455 / 635 (72 %, 23/11: 44 %) | 107 | **440** | 65 | 164 → 100 (61 %), 7 gian | 2.580 → 750 (29 %) |
| TikTok | 107 → **295** | 14 → **37** | 0 | 294 / 295 | 97 | 18 | 121 | 1.031 → 97 (9 %), 15 gian | 17.665 → 291 (1,6 %) |
| Lazada | 0 | 0 | — | — | — | — | — | 3 → 0 | 24 → 0 |

- **Đã phủ thêm gian**: Shopee 9 → 46 gian, TikTok 14 → 37 gian. Đơn kho đã quét có hạn rồi (Shopee 107, TikTok 97).
- **Shopee khớp mốc kiện về tốt hơn** (72 %) vì đơn mới có mốc tốt hơn; phần lệch vẫn là mốc `returnDeliveredAt` Hubsell lưu trễ —
  không ảnh hưởng hạn hiển thị (lấy thẳng của sàn). Vẫn KHÔNG sửa `returnDeliveredAt` trong lát này.
- **TikTok chỉ 9 % đơn kho quét 5 ngày có hạn sàn** — đúng thiết kế lát 1 (TikTok chỉ lưu hạn khi bắt được lúc kiện về, đơn cũ không
  điền lại). 934 đơn còn lại sẽ hiện "**ước tính** đến …" (luật 48 giờ từ giờ kho quét — hạn thật có thể sớm hơn, ô có ghi chữ).
- **17.665 đơn hoàn TikTok đang mở** (phần lớn `AWAITING` lâu ngày) → hiện "Chưa tính · chờ kiện về". Đây là số lớn nhất bảng, không
  phải lỗi lát 2; đáng xem riêng ở lát sau (đơn treo AWAITING có còn là hoàn thật không).
- **440 đơn Shopee quá hạn mà kho chưa quét** (23/11: 48) — shop không dùng màn quét kho hoặc lỡ hạn thật; chưa phân biệt được.
  Con số này là lý do thẻ "Sắp hết hạn" chỉ đếm đơn **còn** hạn (không gộp đơn đã quá hạn vào thẻ).

## 11. Lát 2 giao diện (25/11 tối) — LÊN PROD `3c792064` (mục 12)

Anh nhắn "Làm luôn lát 2" khi tác vụ hẹn giờ đang chạy → em tự chốt 2 câu mục 5 theo đề xuất:
1. **Một ô = một hạn gần nhất** (hạn kiểm hàng 2 ngày với kiện khách trả). Cửa khiếu nại 7 ngày của TikTok / Lazada chỉ nằm trong ô
   chi tiết (rê / bấm), không thêm số thứ hai.
2. **Chỉ tab Đơn hoàn (Video đóng hàng)** trong lát này. Trang Đối soát đơn hoàn để lát sau nếu anh muốn — nói lại một câu là em làm
   (hàm máy chủ `complaintDueSql` + ô `ComplaintDueCell` dùng lại được ngay).

**Máy chủ** (`services/pack-video/library.ts` `listReturnOrders`, route `GET /api/pack-videos/returns?sort=`):
- Mỗi dòng có thêm `complaintDue` = `complaintDueOf` (lát 1) dạng JSON: state + dueAt + nguồn + số giờ luật.
- Thẻ mới `due_soon` "Sắp hết hạn khiếu nại" = ca còn mở (AWAITING / RECEIVED / DAMAGED), hạn **> bây giờ và ≤ 24 giờ** nữa
  (cùng mốc tô đỏ, cùng mốc chuông lát 3). Mốc là mặc định em chọn theo docs 3.1, chưa có số đo.
- `sort=due`: còn hạn gần nhất trước → đã quá hạn → không có hạn; thẻ "Sắp hết hạn" mặc định sắp theo hạn.
- Biểu thức SQL `lib/return-complaint-due-sql.ts` `complaintDueSql()` — bản SQL của `complaintDueOf`, đọc số giờ từ cùng bảng
  `COMPLAINT_WINDOW_HOURS`. Test `lib/__tests__/return-complaint-due-sql-db.test.ts` so SQL với hàm thuần trên **1.792 tổ hợp**
  (4 sàn × 7 tình trạng kho × có/không hạn sàn × mốc kho × 4 mốc sàn × 4 trạng thái sàn) — khớp 100 %.
- ⚠️ **Bẫy đã gặp**: cột thời gian của `Order` là `timestamp` KHÔNG múi giờ; so với tham số Date thì Postgres đổi cột theo múi phiên
  → lệch 7 giờ trên database local (phiên giờ VN). Đã ép tham số về `(… ::timestamptz AT TIME ZONE 'UTC')`. Test db bắt được.
- **Không thêm chỉ mục** → không có bước `CREATE INDEX CONCURRENTLY` trên prod trước khi push. Lý do: thẻ đếm + lọc + sắp chạy
  trên đúng tập đơn hoàn của MỘT shop mà 4 thẻ cũ đã quét sẵn (cùng câu `count(*) FILTER`), biểu thức `COALESCE(hạn sàn, luật)`
  không dùng được chỉ mục B-tree trên một cột; cả hệ thống có ~20 nghìn đơn hoàn đang mở cộng MỌI shop nên tập của một shop nhỏ hơn nhiều (chưa đo thời gian câu trên prod — đo khi lên). Khi lát 3
  (chuông quét MỌI shop) cần thì dựng chỉ mục một phần `(channelId, returnComplaintDueAt) WHERE returnStatus IN (…)` lúc đó.

**Giao diện** (`components/orders/videos/returns-tab.tsx`, `complaint-due-cell.tsx`, `video-filters.tsx`, `lib/return-complaint-due.ts`):
- Cột **Hạn khiếu nại** đứng ngay sau Mã đơn (ở 1280 bảng vốn phải cuộn ngang — cột quan trọng nhất phải thấy không cần cuộn).
- Ô theo docs 3.1: "Còn 1 ngày 4 giờ" + dòng phụ "đến 14:30 25/11 · Shopee 2 ngày"; đỏ ≤ 24 giờ, cam ≤ 48 giờ; "dự kiến đến 23:59
  26/11 · Shopee" (hạn tạm); "ước tính đến …" (nguồn kho quét); "Quá hạn 3 giờ" + "hết lúc …"; "Chưa tính · chờ kiện về";
  "Không cần"; "Chưa rõ". Đếm ngược làm tròn XUỐNG, tự nhảy mỗi phút. Rê / bấm = ô chi tiết (luật, nguồn hạn, cửa 7 ngày TikTok/Lazada).
- Thẻ thứ 4 "Sắp hết hạn khiếu nại" (đỏ nổi khi > 0); bốn thẻ một hàng từ 1280.
- Sắp xếp tại tiêu đề cột: "Hạn khiếu nại" (gần hết hạn trước) / "Sàn báo hoàn" (mới nhất trước).
- Để vừa 1700 không cuộn ngang với dữ liệu rộng nhất (mã TikTok 18 số + tên gian dài): gộp **Loại hoàn** thành dòng phụ dưới giờ báo
  hoàn, **tên gian** xuống dòng 2 cạnh mã vận đơn. Đo: 1700 → bảng 1.348 / khung 1.348 px.
- **Sửa kèm một lỗi có sẵn**: `returnTypeLabel` đọc `returnType` như cờ có / không trong khi máy chủ luôn gửi chuỗi → kiện giao thất
  bại cũng hiện "Khách trả hàng". Giờ so đúng `"FAILED_DELIVERY"`.

**Đã kiểm**: tsc backend + frontend sạch, eslint sạch, test db 17 qua (cô lập video + thẻ mới + sắp theo hạn + so SQL ↔ hàm thuần);
local seed 14 ca (`backend/scripts/_tmp-hkn-seed.ts`, TỆP TẠM — chạy `cleanup` rồi xóa) soi 1280 + 1700, sáng + tối, ô chi tiết, thẻ lọc;
không lỗi console. **Chưa kiểm**: dữ liệu prod thật trên giao diện; trang Đối soát đơn hoàn; app mobile.

## 12. Lên prod 25/11 tối (anh: "Push lên prod")

- Push `3c792064` (chỉ tệp lát 2 + docs; tệp seed tạm đã `cleanup` và xóa). Không có migration → không có bẫy khóa Prisma.
  Render backend báo `3c792064` lúc 20:55, Vercel "Deployment has completed" 20:56.
- **Soi màn thật** (Chrome của anh, tài khoản admin@hubsell.vn, tab Đơn hoàn, sắp theo hạn): thẻ 4 / 6 / **0** / 461; bảng 1.568 px vừa
  khung, không cuộn ngang. Dòng đầu "Còn 3 ngày 3 giờ · dự kiến đến 23:59 26/11 · Shopee" (hạn tạm), sau đó các đơn kho báo hỏng cũ
  hiện "**Quá hạn 55 ngày 8 giờ** · hết lúc 12:07 29/09" (nguồn ước tính từ giờ kho quét), rồi "Chưa tính · chờ kiện về", "Không cần".
- Để ý: đơn kho báo hỏng từ 09–10/2026 chưa chốt khiếu nại hiện "Quá hạn … ngày" — đúng theo luật 2 ngày, nhưng con số dài có thể
  làm khách giật mình. **Anh chốt 25/11: "Giữ nguyên"** — vẫn hiện "Quá hạn N ngày …", không đổi cách nói.
- Chưa đo thời gian câu đếm thẻ trên shop đông đơn hoàn nhất; chưa có chỉ mục (dựng khi lát 3 chuông).

## 13. Tác vụ hẹn giờ chạy lại 20:04 ngày 25/11 — không làm gì thêm

- Tác vụ `han-khieu-nai-lat-2-giao-dien` nổ đúng giờ hẹn 20:00 25/11, nhưng lát 2 **đã lên prod từ trước** (mục 10–12).
- ⚠️ **Nhãn ngày ở mục 10–12 lệch:** commit `3c792064` có giờ git **23/11/2026 20:53** (đứng trước các commit 23–24/11), dòng soi
  màn "Còn 3 ngày 3 giờ · đến 23:59 26/11" cũng khớp tối 23/11 → lát 2 thật ra làm và lên prod **tối 23/11**; chữ "25/11 tối" và cột
  "23/11 → 25/11" ở mục 10 nên đọc là **23/11 ~15:27 → 23/11 tối**. Chưa sửa chữ trong các mục đó (đợi anh xác nhận).
- **Soi lại prod lần này: CHƯA LÀM** — Claude in Chrome không kết nối lúc 20:04 (không ai ở máy để mở). Chưa có số thật của 25/11.
- Không code, không commit, không push. Việc còn mở giữ nguyên: cột ở trang Đối soát đơn hoàn; lát 3 chuông (kèm chỉ mục).

## 14. Khảo sát giao diện + đề xuất thiết kế lại (25/11 tối — anh: "nghiên cứu kỹ lưỡng từ cấu trúc cho tới giao diện") — CHƯA CODE, chờ anh duyệt

### 14.1 Cách khảo sát

- Đọc mã tab Đơn hoàn (`returns-tab.tsx`, `complaint-due-cell.tsx`, `video-filters.tsx`, `lib/return-complaint-due.ts`), máy chủ
  `listReturnOrders`, và trang Đối soát đơn hoàn (`app/warehouse/returns/page.tsx`, `returns-filters.tsx`).
- Soi màn thật trên **local** (prod không vào được: Chrome của anh đang đăng nhập tài khoản HQ, cổng Video đóng hàng đóng với tài
  khoản đó): seed 3 gian tên dài + 20 đơn phủ mọi trạng thái hạn (`backend/scripts/_tmp-hkn2-seed.ts`, TỆP TẠM).
- Tham khảo cách công cụ có "hạn xử lý" trình bày (Jira Service Management, Appfire SLA panel — tài liệu nhà cung cấp, là thông lệ chứ
  không phải nghiên cứu): màu theo bậc thời gian còn lại; **không chỉ dựa vào màu** (kèm biểu tượng); quá hạn hiện số thời gian đã
  quá; sắp theo độ gấp; và cảnh báo "mệt báo động" khi gần như dòng nào cũng tô màu. Cách Shopee / TikTok bày màn trả hàng trong trang
  người bán: **chưa mở lại được hôm nay** (tìm trên web không ra tài liệu mô tả) — không dùng làm căn cứ.

### 14.2 Số đo màn hiện tại (local, 20 đơn thử, 1366 × 768)

| Điều đo | Kết quả |
|---|---|
| Đơn gấp nhất ("Còn 34 phút") nằm dòng thứ mấy khi mở tab | **dòng 9 / 20** (mặc định sắp theo giờ sàn báo hoàn) |
| Số dòng thấy được không cần cuộn | **1 dòng** (bảng bắt đầu ở 597 px; local có 3 dải thông báo mà prod thường không có — chưa đo prod) |
| Bề ngang bảng / khung | **1.312 / 1.014 px** → phải cuộn ngang; cột Tình trạng kho + Thao tác nằm ngoài màn |
| Dòng tô đỏ / cam | 4 đỏ, 4 cam; trong 4 cam có cả hạn "dự kiến" và "ước tính" |
| Cao mỗi dòng | 79 px (ô nào cũng 2 dòng chữ) |

### 14.3 Chẩn đoán — vấn đề nằm ở cấu trúc trước, cái ô sau

1. **Đặt sai chỗ (nặng nhất).** Cột nằm trong tab Đơn hoàn của Video đóng hàng. (a) Cổng Video đóng hàng mới mở cho
   `admin@hubsell.vn` → **hiện chưa khách nào thấy hạn**. (b) Tab này chỉ chủ shop thấy (`STAFF_TABS` chỉ có tab Video) — nhân viên
   kho, người thật sự kiểm kiện, không thấy. (c) Nút Nhận hàng / Nhập kho / Báo hỏng / Khiếu nại đều ở trang **Đối soát đơn hoàn**;
   ở tab Đơn hoàn dòng đỏ không có nút nào để làm việc cần làm.
2. **Trang không phải danh sách việc.** Mặc định sắp theo giờ báo hoàn, trộn ca đã đóng ("Không cần") với ca đang cháy. Prod tối
   23/11: thẻ 4 / 6 / **0** / 461 — số to nhất là thẻ ít việc nhất.
3. **Mệt báo động.** Hạn kiện khách trả sinh ra đã là 48 giờ → ngưỡng "cam ≤ 48 giờ" tô cam **mọi** kiện vừa về; cam hết nghĩa.
   Đơn "Quá hạn 55 ngày" (ước tính) đứng lẫn trong danh sách vô thời hạn (câu chữ anh đã chốt giữ — ở đây chỉ nói chuyện xếp chỗ).
4. **Độ chắc của hạn không nhìn ra.** Hạn sàn chốt, hạn "dự kiến" (Shopee, kiện còn trên đường) và hạn "ước tính" (từ giờ kho quét,
   hạn thật có thể SỚM hơn) cùng cỡ, cùng đậm, cùng màu — khác nhau một chữ ở dòng phụ.
5. **Tín hiệu chỉ bằng màu chữ.** Không biểu tượng, không nền; ở giao diện tối và với người khó phân biệt đỏ / cam thì yếu.
6. **Dòng phụ dài và lặp.** "đến 16:10 27/11 · TikTok 2 ngày": tên sàn đã có ở huy hiệu đầu dòng, "2 ngày" là luật (để trong ô chi
   tiết). Phải tự nhẩm "27/11 là mai hay mốt".
7. **Thiếu công cụ tìm.** Tab Đơn hoàn không có ô tìm mã đơn, không lọc gian, không lọc ngày (trang Đối soát có đủ).
8. **Không có gì kéo khách vào.** Không chuông, không số ở menu. Khách ít mở app → bảng đẹp mấy cũng không ai nhìn kịp 48 giờ.
9. **Chưa kiểm (đúng / sai dữ liệu):** đơn khách ĐÃ gửi khiếu nại trên sàn (Shopee `JUDGING`, TikTok `…REQUEST_REJECT`) có còn đếm
   ngược / hiện "Quá hạn" không. `complaintDueOf` không đọc các trạng thái này. Cần một câu SQL đếm trên prod trước khi kết luận.

### 14.4 Đề xuất cấu trúc — ba tầng, theo thứ tự giá trị

**Tầng 1 — Kéo (lát 3 đã có trong kế hoạch, em đề nghị đưa lên trước việc đánh bóng bảng):** chuông "Còn N kiện hoàn phải kiểm trước
HH:MM" + số đỏ cạnh mục Đối soát đơn hoàn ở menu. Dùng hệ chuông có sẵn; cần chỉ mục một phần (dựng CONCURRENTLY tay trước khi push).

**Tầng 2 — Trang Đối soát đơn hoàn là nhà chính của hạn** (mọi khách có, nhân viên kho có quyền, nút thao tác sẵn):
- **Gộp vào cột "Thời gian chờ" thành một cột "Thời hạn"** — mỗi dòng chỉ một đồng hồ, đúng đồng hồ đang chạy: kiện chưa về → "Chờ 6
  ngày" (như hiện nay); kiện đã về → "Còn 9 giờ" + "hết 05:40 mai". Không thêm cột (bảng đang 8 cột), không thêm bề ngang.
- **Dải nhắc mỏng một dòng** (chỗ dải cam đang có, cùng kiểu anh đã duyệt 13/11): "4 kiện phải kiểm trong 24 giờ · gần nhất còn 34
  phút — Xem". Bấm = lọc + sắp theo hạn. Chỉ hiện khi có số. Không thêm thẻ thứ 6.
- Nút ở cột Thao tác giữ nguyên (Nhận hàng / Nhập kho / Báo hỏng / Khiếu nại) — hạn đứng cạnh đúng nút phải bấm.

**Tầng 3 — Tab Đơn hoàn (Video đóng hàng) giữ vai "hồ sơ bằng chứng"**, dùng chung ô hạn mới: thẻ "Sắp hết hạn khiếu nại" lên đầu
hàng thẻ; khi thẻ đó > 0 thì mở tab sắp theo hạn; thêm ô tìm mã đơn / mã vận đơn.

### 14.5 Đề xuất ô hạn (dùng chung cho cả hai trang)

| Tình huống | Dòng chính | Dòng phụ | Dấu hiệu |
|---|---|---|---|
| Còn ≤ 24 giờ, hạn sàn chốt | **Còn 9 giờ 28 phút** | hết 05:40 mai | viên nền hồng + đồng hồ, chữ đỏ đậm |
| Còn > 24 giờ, hạn sàn chốt | Còn 1 ngày 19 giờ | hết 16:10 Thứ Sáu 27/11 | chữ thường, không màu |
| Hạn dự kiến (Shopee, kiện trên đường) | Còn 1 ngày 3 giờ | dự kiến · hết 23:59 mai | chữ xám hơn, **không tô đỏ / cam** (kiện chưa về, chưa có gì để kiểm) |
| Hạn ước tính (từ giờ kho quét) | Còn khoảng 1 ngày | ước tính · hạn sàn có thể sớm hơn | chữ "khoảng" + gạch chân chấm; mốc tô đỏ: xem câu hỏi 4 |
| Quá hạn | Quá hạn 5 giờ 25 phút (giữ câu chữ anh chốt) | hết lúc 14:46 hôm nay | xám, xếp sau nhóm còn hạn |
| Chưa tính / Chưa rõ / Không cần | như hiện nay | — | xám nhạt, **một dòng** (dòng thấp lại) |

- **Bỏ bậc cam cho kiện khách trả** (48 giờ sinh ra đã cam). Cam chỉ còn cho hạn dài (giao thất bại 7 / 40 ngày) khi còn ≤ 48 giờ.
  Mốc đỏ 24 giờ = **mặc định em chọn**, chưa có số đo; lý do: còn chưa tới một ngày làm việc của kho.
- Mốc tuyệt đối nói bằng "hôm nay / đêm nay / mai" khi trong 2 ngày tới, xa hơn mới ghi thứ + ngày.
- Bỏ tên sàn + "2 ngày" khỏi dòng phụ (đưa vào ô chi tiết rê / bấm, mỗi dữ kiện một dòng như hiện nay).

### 14.6 Thứ tự lát em đề xuất

| Lát | Việc | Ghi chú |
|---|---|---|
| 2b | Ô hạn mới (14.5) + sửa tab Đơn hoàn (thẻ lên đầu, ô tìm, sắp mặc định) | chỉ giao diện, không migration |
| 2c | Cột "Thời hạn" + dải nhắc ở Đối soát đơn hoàn | `complaintDueSql` dùng lại; đo thời gian câu trên shop đông đơn hoàn nhất trước |
| 3 | Chuông + số ở menu + chỉ mục một phần | dựng chỉ mục CONCURRENTLY tay trước khi push |
| — | Câu SQL đếm đơn đã khiếu nại trên sàn (mục 14.3 điểm 9) | chỉ đọc; quyết có cần trạng thái "Đã khiếu nại" không |

### 14.7 Câu chờ anh

1. Nhà chính của hạn chuyển sang **Đối soát đơn hoàn** — anh đồng ý không?
2. Ở Đối soát: **gộp** vào cột Thời gian chờ thành "Thời hạn" (em đề xuất) hay thêm cột riêng?
3. Làm chuông (lát 3) **trước** hay sau khi sửa bảng?
4. Hạn "ước tính" luôn muộn hơn hạn thật: có tô đỏ sớm hơn để bù không? Em chưa có số đo độ lệch — cần đo
   `returnedAt − returnDeliveredAt` trên prod trước khi chọn số.

## 15. Lát 2b + 2c ĐÃ CODE trên local (25/11 tối — anh: "ok em cứ làm đi anh xem") — CHƯA commit / push

Anh hỏi lại "chuyển" nghĩa là gì → chốt: cột hạn **hiện ở cả hai trang** (Đối soát đơn hoàn là nơi chính, tab Đơn hoàn giữ), mã tính
hạn + ô hiển thị dùng chung. Chuông (lát 3) chưa làm.

### 15.1 Máy chủ

- `lib/return-complaint-due.ts`: thêm `COMPLAINT_DUE_SOON_HOURS` (24), `ComplaintDueView`, `complaintDueView()` (dời từ `library.ts`,
  hai trang cùng dùng). `lib/return-complaint-due-sql.ts`: thêm `utcTs()` + `complaintDueSoonSql(now)`.
- `GET /api/pack-videos/returns`: thêm `q` (mã đơn / mã vận đơn / mã vận đơn chiều hoàn, chứa chuỗi, không phân biệt hoa thường; số
  trên thẻ không đổi theo ô tìm). `sort=due`: đơn **vừa** quá hạn đứng trước đơn quá hạn lâu (trước đó ngược lại — "Quá hạn 55 ngày"
  đứng đầu nhóm quá hạn).
- `GET /api/warehouse/returns`: mỗi dòng thêm `complaintDue`; `summary.dueSoon` + `dueSoonNearestAt`; bộ lọc `status=DUE_SOON` (sắp
  theo hạn gần nhất, vẫn tôn trọng ô tìm / chip vận chuyển / phạm vi gian, **bỏ qua bộ lọc ngày** — việc gấp không được biến mất vì
  đang xem kỳ khác). Một câu SQL `loadDueSoon` (trần 500 dòng) phục vụ cả ba.
- ⚠️ **Chi phí chưa đo:** trang Đối soát tự làm mới 30 giây / lần → mỗi lượt thêm MỘT câu quét đơn hoàn đang mở của shop
  (`returnStatus IN (AWAITING, RECEIVED, DAMAGED)` + biểu thức hạn). Cùng cỡ với câu `groupBy` trang đã chạy sẵn, nhưng **phải
  EXPLAIN ANALYZE trên shop đông đơn hoàn nhất của prod trước khi push**; chậm thì dựng chỉ mục một phần
  `(channelId, returnComplaintDueAt) WHERE returnStatus IN (…)` bằng CREATE INDEX CONCURRENTLY tay.
- Test: `isolation-db.test.ts` thêm ca thứ tự quá hạn + ô tìm (kể cả ký tự `%` `_`); 3 tệp test hạn **40 / 40 qua**. tsc backend sạch.
  Chưa có test cho route `/api/warehouse/returns` (route này vốn không có test).

### 15.2 Ô hạn mới (`components/shared/complaint-due-cell.tsx` — dời từ `orders/videos/`, `lib/return-complaint-due.ts`)

| Tình huống | Hiện |
|---|---|
| Còn ≤ 24 giờ, hạn có căn cứ (sàn chốt / luật / ước tính) | viên nền hồng + đồng hồ "Còn 9 giờ 13 phút", dòng phụ "hết 05:40 ngày mai" |
| Hạn TẠM của sàn còn ≤ 24 giờ | chữ đỏ, không viên — **khác đề xuất 14.5** ("không tô màu"): bản Shopee 06/11 ghi hạn tính "hoặc sau ngày nhận hàng hoàn dự kiến, tùy điều kiện nào đến trước" nên hạn tạm vẫn có thể là hạn thật; em chưa kiểm được điều gì xảy ra khi qua mốc này mà kiện chưa về → giữ tín hiệu, yếu hơn một bậc |
| Còn > 24 giờ | chữ thường; **bỏ bậc cam** cho kiện khách trả. Cam chỉ còn cho kiện giao thất bại (hạn 7 / 40 ngày) khi còn ≤ 48 giờ |
| Hạn tạm còn > 24 giờ | chữ xám, "dự kiến · hết 23:59 ngày mai" |
| Hạn ước tính | gạch chân chấm dòng chính + "ước tính · hết 00:10 T6 27/11" |
| Quá hạn | "Quá hạn 5 giờ 40 phút" (giữ câu chữ), dòng phụ "hết 14:46 hôm nay" |
| Chưa tính / Chưa rõ / Không cần | một dòng ("Chưa tính · chờ kiện về") |

Mốc giờ: "hôm nay / ngày mai / hôm qua"; trong 6 ngày thì kèm thứ ("T6 27/11"); xa hơn chỉ ghi ngày. Tên sàn + "2 ngày" bỏ khỏi dòng
phụ (vẫn ở ô chi tiết rê / bấm). Viên dùng cặp `bg-rose-50 + text-rose-700`: ở giao diện tối lật thành chữ hồng nhạt trên nền đỏ sẫm
(thử `text-red-600` trước — tương phản khoảng 3 : 1, yếu).

### 15.3 Tab Đơn hoàn (Video đóng hàng)

- Mặc định **sắp theo hạn**; thẻ "Sắp hết hạn khiếu nại" lên đầu hàng thẻ; thêm ô tìm mã đơn / mã vận đơn (thay câu mô tả).
- Gộp **Video đóng + Video khui thành một cột Video** (hai dòng "Đóng · 0:51" / "Khui · chưa quay"); Tình trạng kho tách phần sau dấu
  "·" xuống dòng phụ; giờ báo hoàn bỏ năm khi là năm nay; tên gian cắt ngắn hơn.
- Đo (20 đơn thử, tên gian 55 ký tự, mã TikTok 18 số): **1366 → bảng 1.014 / khung 1.014 px, không cuộn ngang** (trước: 1.312 /
  1.014); 1700 → 1.348 / 1.348; 1280 → 1.016 / 928 (còn cuộn 88 px, cột hạn vẫn trong màn). Không ô nào tràn. Đơn gấp nhất: dòng 1
  (trước: dòng 9).

### 15.4 Trang Đối soát đơn hoàn

- Cột "Thời gian chờ" đổi tên **"Thời hạn"**, một đồng hồ mỗi dòng: đơn có hạn → đếm ngược (ô hạn dùng chung); hạn tạm còn hơn 24
  giờ hoặc chưa có hạn → số ngày chờ như trước.
- **Cột Thời hạn dời lên ngay sau Mã đơn** (ngoài đề xuất ban đầu): ở 1366 cột cũ nằm tại 1.217 px trong khung 1.029 px — phải cuộn
  ngang mới thấy. Giờ ở 485 px.
- **Dải nhắc đỏ một dòng đặt TRÊN hàng thẻ**: "4 đơn hoàn sắp hết hạn khiếu nại · gần nhất còn 14 phút — Xem 4 đơn". Bấm = lọc + sắp
  theo hạn, bấm lại "Bỏ lọc". Chỉ hiện khi có số.
- Sửa kèm lỗi có sẵn: tên gian dài không cắt làm cột Mã đơn phình tới 617 px → cắt `max-w-40` + tooltip.
- Đã thử: bấm dải → 4 dòng đúng thứ tự hạn, nút Nhận hàng / Nhập kho / Báo hỏng / Cập nhật khiếu nại ngay cùng dòng; sáng + tối.

### 15.5 Chưa làm / chưa kiểm

- Chưa commit, chưa push. Seed tạm `backend/scripts/_tmp-hkn2-seed.ts` còn trong database local (chạy `cleanup` rồi xóa tệp).
- Chưa đo câu `loadDueSoon` trên prod (mục 15.1). Chưa soi màn prod thật.
- Trang Đối soát vẫn cuộn ngang ở 1366 (bảng 8 cột có sẵn) — không thuộc lát này.
- Đang lọc "sắp hết hạn" thì mũi tên sắp xếp ở tiêu đề Thời hạn không có tác dụng (danh sách luôn theo hạn) — chưa ẩn.
- App mobile dùng cùng API Đối soát: chỉ nhận thêm trường, chưa hiện hạn.
- Chuông + số ở menu (lát 3); đơn đã khiếu nại trên sàn có còn đếm ngược không (14.3 điểm 9); độ lệch hạn ước tính (14.7 câu 4).

## 16. Đo prod câu "sắp hết hạn" (25/11 ~20:40, anh: "Ổn, đo prod đi") → PHẢI có chỉ mục trước khi push

Đo bằng Supabase SQL Editor trên Chrome của anh, chỉ đọc, mỗi câu chạy MỘT lần.

1. **Chọn shop nặng nhất** (đếm đơn `AWAITING` theo chủ shop — đi qua chỉ mục một phần sẵn có): shop đứng đầu **3.206 đơn chờ hàng
   về / 1 gian**, kế tiếp 1.948 / 2 gian và 1.580 / 3 gian.
2. **`EXPLAIN (ANALYZE, BUFFERS)` câu `loadDueSoon`** của shop đó (bản CHƯA có vị từ chỉ mục):

| Điều đo | Kết quả |
|---|---|
| Thời gian | **6.866 ms** (bộ đệm nguội: 26.908 trang đọc đĩa + 9.436 trang có sẵn) |
| Đường đi | `Index Scan using "Order_channelId_idx"` — quét **hết đơn của gian** rồi mới lọc `returnStatus` |
| Số dòng ra | 0 (shop này lúc đo không có đơn nào sắp hết hạn) |

   Chưa đo lần hai (bộ đệm ấm) — không lặp câu nặng trên prod; kể cả ấm vẫn là 36 nghìn trang mỗi 30 giây cho mỗi người đang mở trang.

**Kết luận:** không được push bản mục 15 khi chưa có chỉ mục. Câu `groupBy` sẵn có của trang Đối soát và câu đếm thẻ của tab Đơn
hoàn (đã trên prod, hiện chỉ tài khoản admin dùng) cùng kiểu đi qua `Order_channelId_idx` — **chưa đo**, ghi lại để đo trước khi mở
cổng Video đóng hàng cho khách.

### 16.1 Cách sửa (đã code trên local, chưa commit)

- Chỉ mục một phần **`Order_return_complaint_due_idx`** `("channelId") WHERE "returnStatus" IN ('AWAITING','RECEIVED','DAMAGED') AND
  ("returnComplaintDueAt" IS NOT NULL OR "returnDeliveredAt" IS NOT NULL OR "returnedAt" IS NOT NULL)` — chỉ chứa đơn hoàn còn mở
  CÓ ít nhất một mốc để tính hạn; hàng nghìn đơn `AWAITING` treo chưa có mốc nào không nằm trong chỉ mục.
  Migration `20261125210000_order_return_complaint_due_idx` (chỉ `CREATE INDEX IF NOT EXISTS`, không đổi cột, không đụng trigger).
- `complaintDueCandidateSql()` (`lib/return-complaint-due-sql.ts`) = đúng vị từ đó, `loadDueSoon` thêm vào WHERE. Test db so trên
  1.792 tổ hợp: đơn nào có hạn thì vị từ luôn đúng (không loại nhầm đơn nào).
- **Kiểm local** (12.683 đơn, câu SQL do chính mã sinh ra): `Index Scan using "Order_return_complaint_due_idx"`, 0,3 ms, ra đúng 4
  đơn thử. Trên prod **chưa kiểm** — chỉ kiểm được sau khi dựng chỉ mục.
- tsc backend sạch; 3 tệp test hạn 40 / 40.

### 16.2 Việc phải làm trên prod TRƯỚC khi push (anh chạy ở Supabase SQL Editor, ngoài giờ cao điểm)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_return_complaint_due_idx"
  ON "Order" ("channelId")
  WHERE "returnStatus" IN ('AWAITING', 'RECEIVED', 'DAMAGED')
    AND ("returnComplaintDueAt" IS NOT NULL OR "returnDeliveredAt" IS NOT NULL OR "returnedAt" IS NOT NULL);
```

Rồi kiểm `SELECT indisvalid FROM pg_index WHERE indexrelid = '"Order_return_complaint_due_idx"'::regclass;` phải ra `true`
(ra `false` = dựng dở, phải `DROP INDEX CONCURRENTLY` rồi dựng lại). Sau đó em chạy lại EXPLAIN của mục 16 với vị từ mới để xác nhận
trước khi anh cho push.

### 16.3 ĐÃ DỰNG chỉ mục trên prod + đo lại (25/11 ~21:00, anh: "Em tự mở chrome lên chạy đi")

- Trước khi dựng: bảng `Order` ≈ 1.123.583 dòng, 641 MB; `statement_timeout` của SQL Editor = 2 phút; chưa có chỉ mục này.
- Chạy đúng câu ở 16.2 (một lệnh, không gộp lệnh khác — CONCURRENTLY không chạy trong transaction): **"Success" sau khoảng 40–70
  giây**. Kiểm: `indisvalid = true`, `indisready = true`, cỡ **144 kB**, ước ~16.008 dòng trên cả hệ thống.
- **Đo lại câu `loadDueSoon` (có vị từ chỉ mục) của cùng shop 3.206 đơn chờ:**

| | Trước | Sau |
|---|---|---|
| Đường đi | `Order_channelId_idx` (hết đơn của gian) | **`Order_return_complaint_due_idx`** |
| Thời gian | 6.866 ms | **303 ms** (lần 2: 345 ms) |
| Trang đệm | 36.344 | **1.866** |

- Lần chạy thứ hai không nhanh hơn (vẫn ~1.000 trang đọc đĩa) → bộ đệm prod không giữ các trang này; coi **~0,3 giây** là mức thật của
  shop nặng nhất, không phải "vài mili giây".
- Vì sao còn 1.866 trang: shop này có khoảng nghìn rưỡi đơn hoàn còn mở ĐÃ có mốc (kiện về mà kho chưa quét / báo hỏng chưa chốt, đa
  số quá hạn từ lâu) — chúng vẫn nằm trong chỉ mục và bị đọc mỗi lượt. Muốn gọn hơn nữa thì phải lưu sẵn "hạn hiệu lực" thành cột để
  chỉ mục sắp theo hạn — **để lát 3 (chuông)**, không làm trong lát này.
- Đã dọn: 20 đơn + 17 video + 3 gian thử trên database local, xóa `_tmp-hkn2-seed.ts`.
- **Còn lại trước khi push:** anh cho lệnh commit + push. Migration trong repo chỉ `CREATE INDEX IF NOT EXISTS` → trên prod sẽ bỏ qua
  (chỉ mục đã có), không có bẫy khóa.
