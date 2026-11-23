# Hạn khiếu nại đơn hoàn — quy định 3 sàn + phương án cột "Hạn khiếu nại"

> 23/11/2026. Anh Trung gửi ảnh tab **Video đóng hàng → Đơn hoàn**: "mỗi đơn trả hàng trên sàn đều có một thời gian khiếu
> nại nhất định. Thời gian đó bắt đầu khi nào, kết thúc khi nào là điều quan trọng nhất để nhắc khách 'hạn khiếu nại'.
> Đầu tiên hãy kiểm tra nội dung mới nhất về quy định của các sàn để lên phương án thêm cột 'Hạn khiếu nại'."
>
> Trạng thái: **ĐÃ TRA QUY ĐỊNH + LÊN PHƯƠNG ÁN, CHƯA CODE.** Chờ anh chốt các câu ở mục 5.
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
