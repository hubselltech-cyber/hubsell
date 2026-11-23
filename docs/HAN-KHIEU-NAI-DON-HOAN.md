# Hạn khiếu nại đơn hoàn — quy định 3 sàn + phương án cột "Hạn khiếu nại"

> 23/11/2026. Anh Trung gửi ảnh tab **Video đóng hàng → Đơn hoàn**: "mỗi đơn trả hàng trên sàn đều có một thời gian khiếu
> nại nhất định. Thời gian đó bắt đầu khi nào, kết thúc khi nào là điều quan trọng nhất để nhắc khách 'hạn khiếu nại'.
> Đầu tiên hãy kiểm tra nội dung mới nhất về quy định của các sàn để lên phương án thêm cột 'Hạn khiếu nại'."
>
> Trạng thái: đã tra quy định (mục 1), kiểm API bằng dữ liệu thật (mục 6–7), **lát 1 máy chủ đã code trên local, chưa
> commit / chưa lên prod (mục 8)**. Chưa có giao diện. Hai câu ở mục 5 vẫn chờ anh.
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

## 8. Lát 1 đã code trên local (23/11 chiều) — CHƯA commit, CHƯA lên prod

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
