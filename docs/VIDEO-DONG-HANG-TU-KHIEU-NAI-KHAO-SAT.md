# Quay video đóng hàng + tự khiếu nại đơn hoàn — khảo sát API 3 sàn (13/11/2026)

> Anh Trung 13/11: "anh đang muốn làm phương án quay video đóng hàng hôm trước mình khảo sát. Anh cần em kiểm tra API của
> các sàn liên quan tới vấn đề trả hàng hoàn tiền xem có auto khiếu nại được không để đưa ra phương án làm."
> Trạng thái: KHẢO SÁT XONG TRÊN TÀI LIỆU, CHƯA GỌI THỬ LỆNH GHI NÀO, CHƯA CODE. Chờ anh chốt mục 6.

## 1. Trả lời ngắn

- **Tự khiếu nại vòng đầu làm được qua API ở cả 3 sàn** (từ chối yêu cầu hoàn / mở tranh chấp kèm bằng chứng).
- **Video chỉ nộp được ở 2 chỗ:** Shopee (`upload_proof`) và Lazada nhánh "chỉ hoàn tiền" (`startDispute`).
  TikTok và Lazada nhánh "trả hàng hoàn tiền" chỉ nhận **ảnh**.
  **(sửa 14/11 — câu về Shopee SAI:** trang gốc open.shopee.com của `v2.returns.upload_proof` chỉ có tham số `photo[] {url, thumbnail}`
  + `description`, KHÔNG có `proof_video`. Qua API, Shopee chỉ nhận ảnh. Chỗ nhận video còn lại duy nhất là Lazada "chỉ hoàn tiền",
  và chỗ đó vẫn chưa đọc được trang gốc. Xem mục 16.6.)
- → Mẫu số chung của 3 sàn là **ảnh cắt từ video + lời mô tả**. Video gốc là phần đính thêm ở nơi sàn nhận.
- **Kháng nghị sau khi sàn đã phán** (appeal) không thấy API ở sàn nào → chỉ soạn sẵn hồ sơ + mở đúng trang sàn.
- Hubsell hiện chỉ ĐỌC yêu cầu hoàn (`integrations/*/returns-sync.ts`), chưa lưu hạn trả lời, chưa có lệnh ghi nào.

## 2. Bảng API từng sàn

### 2.1 Shopee — nhóm `v2.returns.*` (15 lệnh)

| Lệnh | Việc | Tham số chính |
|---|---|---|
| `get_return_list` / `get_return_detail` | đọc (đã dùng) | lọc được `status`, `negotiation_status`, `seller_proof_status`, `seller_compensation_status` |
| `get_return_dispute_reason` | lý do khiếu nại hợp lệ cho đúng yêu cầu này | `return_sn` |
| `convert_image` | tải ảnh lên, nhận URL của Shopee | ảnh ≤ 10 MB |
| **`dispute`** | mở khiếu nại | `return_sn`, `email` (bắt buộc), `dispute_reason` (bắt buộc), `dispute_text_reason`, `images[]` — **chỉ ảnh** |
| **`upload_proof`** | nộp bằng chứng | ~~`return_sn`, `proof_text[]`, `proof_image[]`, `proof_video[]`~~ **(sửa 14/11, theo trang gốc):** `return_sn`, `photo[] {url, thumbnail}` (nên dùng URL do `convert_image` trả), `description` — **không có trường video** |
| `query_proof` | xem bằng chứng đã nộp | `return_sn` |
| `confirm` | đồng ý hoàn tiền | `return_sn` |
| `get_available_solutions` / `offer` / `accept_offer` | thương lượng (hoàn một phần…) | `solution` 0 = trả hàng hoàn tiền, 1 = chỉ hoàn tiền; `refund_amount` |
| `cancel_dispute` | rút khiếu nại bồi thường | chỉ khi `ACCEPTED` + `COMPENSATION_REQUESTED` |

- `dispute` dùng được khi `return_status` là `REQUESTED`, `PROCESSING`, `ACCEPTED`.
- Hạn: đọc `due_date`, `return_ship_due_date`, `return_seller_due_date` của từng yêu cầu. Tài liệu không nêu số ngày cố định.
- Nguồn: bản mô tả của SDK công khai chép từ tài liệu Shopee (trang gốc open.shopee.com hôm nay không đọc được).

### 2.2 TikTok Shop — Return & Refund API 202309

| Lệnh | Việc |
|---|---|
| `POST /return_refund/202309/returns/search` | đọc (đã dùng); có trường `arbitration_status` |
| `GET /return_refund/202309/returns/{return_id}/records` | lịch sử trao đổi |
| `GET /return_refund/202309/reject_reasons` | lý do từ chối hợp lệ (đã có hàm đọc, dùng cho yêu cầu hủy) |
| `POST …/returns/{return_id}/approve` | `decision`: `APPROVE_REFUND` / `APPROVE_RETURN` / `APPROVE_REPLACEMENT` / `APPROVE_RECEIVED_PACKAGE` |
| **`POST …/returns/{return_id}/reject`** | `decision` + `reject_reason` + `comment` + `images[] {image_id, mime_type, width, height}` |
| Get Decision Eligibility (bản 202601) | hỏi trước: quyết định nào đang được phép + lý do tương ứng |

- `decision` khi từ chối: `REJECT_REFUND`, `REJECT_RETURN`, `REJECT_REPLACEMENT` (lúc yêu cầu đang chờ shop) và
  `REJECT_RECEIVE_PACKAGE` (sau khi kiện trả về tới kho, shop kiểm thấy sai). Tài liệu ghi hai cách viết
  `REJECT_RECEIVE_PACKAGE` / `REJECT_RECEIVED_PACKAGE` → phải thử mới biết.
- **Không có trường video.** Không thấy lệnh kháng nghị (Seller Appeal) nào trong nhóm API.
- Quyền cần: `seller.return_refund.basic` — cùng họ với `cancellations/approve|reject` Hubsell đã gọi từ 23/10.
- Nguồn: trang hướng dẫn tích hợp của một nhà tích hợp (ghi nguyên thân lệnh `reject`) + kết quả tìm kiếm trang Partner Center.
  Trang gốc partner.tiktokshop.com hôm nay không đọc được.

### 2.3 Lazada — nhóm Reverse order

| Lệnh | Việc | Tham số chính |
|---|---|---|
| `/reverse/getreverseordersforseller` | đọc (đã dùng) | lọc `dispute_in_progress`, `return_to_type` RTM / RTW; mỗi dòng có `is_dispute`, `sla` |
| `/order/reverse/return/detail/list`, `/history/list` | chi tiết + lịch sử | |
| `/order/reverse/reason/list` | lý do từ chối — bắt buộc cho mọi lệnh từ chối | `reverse_order_line_id` |
| **`/order/reverse/return/update`** | trả hàng hoàn tiền | `action`: `agreeReturn`, `refuseReturn`, `agreeRefund`, `refuseRefund`, `confirmDelivery`, `instantRefund`; `reason_id`, `comment`, `image_info[] {name, url}` — **chỉ ảnh** |
| **`/order/reverse/onlyrefund/seller/decide`** | chỉ hoàn tiền | `action`: `agreeRefund` / **`startDispute`**; `comment` + `image_info_list[]` bắt buộc khi khiếu nại; **`video_info_list[] {cover_url, video_url}`** |

- Lỗi sàn tự nêu: 108 thiếu lý do, 109 thiếu lời giải thích, 110 thiếu ảnh khi từ chối hoàn tiền, 111 không cho từ chối
  nhiều dòng một lượt (mỗi lần một dòng hàng), 114 yêu cầu này không hỗ trợ thao tác đó.
- Nguồn: bản chép tài liệu Lazada trong một SDK công khai. Trang gốc open.lazada.com chỉ hiện khung, không đọc được nội dung.

## 3. Chưa kiểm — phải thử thật trước khi thiết kế chi tiết

Chưa gọi một lệnh ghi nào. Năm giả thuyết cần thử trên yêu cầu hoàn thật của tài khoản công ty:

1. Shopee `upload_proof.proof_video` nhận URL bất kỳ hay phải là tệp tải qua lệnh của Shopee; giới hạn dung lượng / thời lượng.
2. Shopee `upload_proof` dùng ở bước nào (chỉ khi sàn đòi bằng chứng — `seller_proof_status` — hay lúc nào cũng nộp được).
3. TikTok `images[].image_id` lấy từ lệnh tải ảnh nào; cách viết đúng của `REJECT_RECEIVE(D)_PACKAGE`.
4. Lazada `image_info.url` / `video_url` có bắt buộc là địa chỉ của Lazada không; thị trường VN có mở `startDispute` không.
5. Hạn trả lời thực tế từng sàn (đọc từ trường hạn của chính yêu cầu, không tự đặt số).

Không có căn cứ nào về việc sàn phạt shop khiếu nại thua nhiều — chưa tìm, chưa khẳng định được theo hướng nào.

## 4. Hệ quả cho thiết kế

- **Bằng chứng chuẩn = 4–6 ảnh cắt từ video** (khung thấy rõ mã vận đơn, khung hàng nằm trong hộp, khung dán kín) + lời mô tả
  soạn sẵn. Cách này nộp được ở mọi sàn, mọi nhánh. Video gốc đính thêm ở Shopee và Lazada chỉ-hoàn-tiền.
- **Cần hai loại video, không phải một:** đóng hàng (chứng minh giao đủ, đúng) và khui kiện hoàn (chứng minh khách trả sai /
  thiếu / đã dùng). Ca thứ hai ứng thẳng với `REJECT_RECEIVE_PACKAGE` của TikTok, `refuseRefund` của Lazada và hạn
  `return_seller_due_date` của Shopee.
- **Phải lưu hạn trả lời** vào yêu cầu hoàn (hiện `returns-sync` không lưu) — không có hạn thì không xếp được việc tự nộp.
- **Video phải nằm ở nơi máy chủ lấy được** nếu muốn tự nộp lúc chủ shop không mở máy. Lưu ở máy shop thì chỉ làm được
  "một nút khi shop đang mở app".

## 5. Phương án đề xuất (5 lát)

| Lát | Việc | Đổi gì |
|---|---|---|
| 0 | Script thử 5 giả thuyết mục 3 trên yêu cầu hoàn thật của tài khoản công ty, anh duyệt từng lệnh ghi | không đổi sản phẩm |
| 1 | Lưu hạn trả lời + trạng thái tranh chấp vào yêu cầu hoàn; nút **Đồng ý / Khiếu nại** trên web, ảnh shop tự tải lên (khuôn `cancel-request-decide.ts`) | 1 migration, không cần video |
| 2 | Quay ở màn Đã đóng gói: quét mã vận đơn → tự quay, quét mã kế → tự cắt; quay khui kiện ở màn Đối soát đơn hoàn | web trước, mobile sau |
| 3 | Đơn có yêu cầu hoàn → tự tìm video theo mã vận đơn → cắt ảnh → soạn hồ sơ → chủ shop bấm **Gửi** | một nút |
| 4 | Tự nộp theo luật, bật theo từng gian và từng lý do (vd chỉ "thiếu hàng", "sai hàng", "hộp rỗng") | mặc định TẮT |

Lát 1 có giá trị ngay cả khi chưa có video và là chỗ thử lệnh ghi với rủi ro thấp nhất, nên em xếp trước phần quay.

## 6. Chờ anh chốt

1. **Nơi lưu video.** (A) kho tệp của Hubsell, nén nhỏ, giữ có hạn — tự nộp được cả khi shop tắt máy; (B) thư mục trên máy
   shop — không tốn tiền lưu nhưng chỉ nộp được khi máy đang mở. Em nghiêng về A cho đơn có rủi ro, nhưng **chưa có số chi phí
   thật**: ước lượng thô của em (480p, khoảng 2 MB một đơn, giữ 45 ngày) là số em tự chọn, chưa đo tệp thật, chưa lấy báo giá.
   Không dùng Supabase Storage cho video.
2. **Mức tự động.** Em đề xuất tới lát 3 (một nút) là bản bán được; lát 4 chỉ mở sau khi có số thắng / thua thật.
3. **Thứ tự.** Làm lát 0 → 1 trước (em đề xuất), hay vào thẳng phần quay video.

## 7. Nguồn (phần 1)

- Shopee: https://github.com/congminh1254/shopee-sdk/blob/main/docs/managers/returns.md
- TikTok: https://help.useresponse.com/hemi/knowledge-base/article/marketplaces-tiktok-marketplace-integration-v2-tiktok-order-management-tiktok-claims-handle ·
  https://partner.tiktokshop.com/docv2/page/get-decision-eligibility-202601 ·
  https://partner.tiktokshop.com/docv2/page/return-refund-and-cancel-api-overview
- Lazada: https://github.com/xKeNcHii/lazada-sdk/blob/main/docs/api/return-and-refund-api.md ·
  https://open.lazada.com/apps/doc/api?path=%2Forder%2Freverse%2Freturn%2Fupdate
- Bản khảo sát cũ hơn (23/10, sơ bộ): `THONG-BAO-DAY-MOBILE.md` mục 6. Ý tưởng gốc + ShipXanh: memory 06/11.

---

# PHẦN 2 — Khảo sát chuyên sâu phần QUAY và LƯU (13/11/2026 đêm)

> Anh Trung 13/11: "Dự án này thì sớm muộn cũng phải làm. Việc seller tự nộp bằng chứng hay Hubsell nộp thay mình để cổng sau.
> Thứ anh cần là việc khảo sát chuyên sâu" — 6 ý: (1) quét mã vạch hay camera tự nhận, (2) thiết bị + nhiều bàn đóng hàng,
> (3) lưu ở máy chủ khác, chất lượng + nén, (4) chi phí một video (sẽ thu phí riêng), (5) xóa theo trạng thái đơn,
> (6) phân vùng / bảng / cột / phân tầng dữ liệu. Mốc tính: **mỗi shop 1.000 đơn/ngày** (anh giao).
> Phần nộp bằng chứng lên sàn (phần 1) để cổng sau.

## 8. Số thật trên prod (chỉ đọc, sổ `order_ledger`, đơn TẠO trong tháng 9/2026, đo 13/11)

| | Shopee | TikTok | Lazada |
|---|---|---|---|
| Đơn tạo | 46.843 | 172.210 | 618 |
| Đơn hủy | 9.646 (20,6 %) | 25.598 (14,9 %) | 12 |
| Đã giao | 37.207 | 146.617 | 606 |
| Đã giao có tiền hoàn | 1.603 (4,3 % đơn đã giao) | 3.931 (2,7 %) | 17 (2,8 %) |
| Tạo → giao (ngày): giữa / 90 % / 99 % | 4,9 / 7,2 / 16,1 | 2,6 / 3,9 / 6,1 | 2,5 / 3,3 / 5,1 |
| Giao → đối soát (ngày): giữa / 90 % / 99 % | 0 / 0 / 1 | 2,5 / 2,9 / 14,6 | 2 / 2 / 2 |
| Giao → khách xin hoàn (ngày): giữa / 90 % / 99 % / muộn nhất | 0 / 3 / 10,9 / 11 (178 đơn) | 1,5 / 11,2 / 14,6 / 15,3 (537 đơn) | 1,8 / 2,8 / 3 / 3 (17 đơn) |
| **Xin hoàn SAU khi đã đối soát** | **79 / 177 = 45 %** | **197 / 480 = 41 %** | 8 / 17 |

- Quy mô shop: 147 chủ shop có đơn, tổng 219.671 đơn. Đơn/ngày theo shop: giữa 9, 75 % dưới 52, 90 % dưới 147, 99 % dưới 352,
  lớn nhất 919. 24 shop từ 100 đơn/ngày, 1 shop từ 500, chưa shop nào tới 1.000. → mốc 1.000 đơn/ngày là mốc trần.
- **Giới hạn của số này:** mốc "khách xin hoàn" (`Order.returnRequestedAt`) chỉ có ở 547 / 3.938 đơn TikTok có loại hoàn (14 %) và
  194 / 1.599 đơn Shopee (12 %) — phần còn lại sổ biết là có hoàn nhưng không có mốc giờ. Chưa tìm vì sao. Các dòng độ trễ ở trên
  tính trên mẫu có mốc. **(sửa 14/11: đã tìm ra — mục 16.4. Thiếu mốc là chuyện của đơn CŨ; đơn tạo tháng 10 thì phần lớn đã có mốc.
  Tỷ lệ 41–45 % cũng không ổn định giữa các tháng — mục 16.5.)**
- Shopee "giao → đối soát = 0 ngày": mốc giao của Shopee trong sổ gần như trùng mốc tiền về, nên với Shopee "ngày sau giao" thực
  chất đếm từ lúc đơn hoàn tất.
- Không tách được "hủy trước khi gói" và "hủy sau khi gói" từ dữ liệu hiện có (đa số shop in phiếu ở Seller Center nên mốc in của
  Hubsell trống). Khi có video thì chính bản ghi video là mốc "đã gói".
- Không có số đo thời lượng đóng một kiện. Mọi phép tính dung lượng dùng thời lượng giả định, ghi rõ ở từng chỗ.

## 9. Quét mã vạch hay camera tự nhận mã (ý 1)

> Nguồn: tra web 13/11, chưa thử trên thiết bị thật. "(ước)" = phép tính của em, chưa đo.

**Kết luận: máy tính để bàn thì dùng máy quét cầm tay; điện thoại / máy tính bảng thì để camera tự nhận. Hai cách cùng tồn tại, sản phẩm tự chọn theo thiết bị.**

| Điểm | Máy quét cầm tay | Camera trên cao tự nhận mã |
|---|---|---|
| Độ chắc | Gần như tuyệt đối, kể cả nhãn nhăn, bóng | Camera 1080p treo cao 60 cm chỉ được khoảng 0,8 điểm ảnh cho mỗi vạch mã (ước), trong khi các hãng đọc mã yêu cầu 1,5–3 → **không đọc được**. Muốn đọc phải giơ nhãn sát ống kính ≤ 25 cm |
| Trình duyệt | Không cần gì (máy quét là bàn phím) | Bộ đọc mã có sẵn của Chrome **không chạy trên Windows** (chỉ macOS, ChromeOS, Android) → phải nhúng thư viện đọc mã |
| Thư viện miễn phí | — | zxing: ảnh nét đọc tốt, ảnh mờ chỉ đọc được khoảng 10 % (đo của hãng đối thủ) |
| Thư viện trả tiền | — | STRICH 99–249 €/tháng theo lượt quét; Dynamsoft khoảng 1.400 USD/năm cho 10.000 lượt → không hợp |
| Tải máy | 0 | quét mọi khung hình chiếm khoảng 3/4 một lõi CPU (ước) |
| Thao tác nhân viên | thêm một động tác bấm cò | rảnh tay, nhưng phải giơ nhãn đúng chỗ và chờ nhận |
| Tiền thiết bị | 0,9–2,2 triệu / máy quét 2D | 0 |

- Trên **điện thoại / máy tính bảng** thì ngược lại: camera có lấy nét tự động, nhãn ở gần, Android có bộ đọc mã sẵn → camera tự nhận là
  cách tự nhiên. Màn `/orders/packing` hiện tại đã quét bằng camera điện thoại theo đúng cách này.
- Mã QR trên vận đơn có ô to hơn mã vạch nên camera đọc dễ hơn; nếu làm camera tự nhận trên máy tính thì ưu tiên QR.
- Đối thủ: E-CAM, Effi Track, EcomPMS, Dohana đều dùng đầu đọc mã để bắt đầu quay. Ship Xanh: điện thoại tự dò QR, **mã kế tiếp tự
  cắt clip trước**, có mã dừng riêng; máy tính dùng máy quét.
- Luật cắt clip đề xuất (giống Ship Xanh): quét mã A → bắt đầu quay A; quét mã B → đóng clip A, mở clip B; quá N giây không có mã mới
  → tự đóng. Khớp luôn với mốc `packingDoneAt` đang có.
- **Chưa kiểm:** cỡ thật của vạch mã trên vận đơn 3 sàn (phép tính 0,8 điểm ảnh dựa trên ước lượng vạch 0,35–0,45 mm); tỷ lệ đọc thật
  của zxing trên nhãn nhiệt.

Nguồn: https://developer.chrome.com/docs/capabilities/shape-detection · https://caniuse.com/mdn-api_barcodedetector ·
https://www.dynamsoft.com/codepool/benchmark-barcode-reading-javascript-zxing-wasm-dynamsoft-barcode-reader.html ·
https://strich.io/ · https://shipxanh.com/?p=14427 · https://ghn.vn/blogs/tip-ban-hang/phan-mem-quay-video-dong-hang

## 10. Thiết bị + nhiều bàn đóng hàng (ý 2)

**Trả lời thẳng: không bắt buộc mỗi bàn một máy tính.** Mỗi bàn cần ba thứ: một camera, một cách đọc mã, và một thiết bị đang mở Hubsell.
Thiết bị đó có thể là điện thoại hoặc máy tính bảng.

| Cách bố trí | Mỗi bàn cần | Tiền mỗi bàn (ước, ghép từ giá niêm yết) | Hợp với | Điểm yếu |
|---|---|---|---|---|
| **A. Mỗi bàn một máy tính** (máy sẵn có) | webcam 1080p lấy nét tự động + máy quét + tay kẹp + đèn | 2–5 triệu | shop đã có máy tính ở bàn in phiếu | mỗi bàn một máy |
| **B. Một máy tính cho 2–3 bàn** | như A + cáp nối dài; máy quét chạy chế độ cổng COM để phần mềm biết máy quét nào của bàn nào | 2–5 triệu + phần chia | kho 2–3 bàn sát nhau | giới hạn của cổng USB (khoảng 2 webcam 1080p trên một bộ điều khiển); trình duyệt treo là dừng mọi bàn; 4 bàn trở lên phải thử |
| **C. Mỗi bàn một điện thoại / máy tính bảng trên giá** | giá đỡ; máy cũ dùng lại được | 0,3 triệu (máy cũ) – 4 triệu (máy mới) | kho nhiều bàn, không muốn mua máy tính | pin + nhiệt khi cắm sạc cả ngày |
| D. Camera an ninh (IP) + phần mềm cài tại kho | camera 0,4–1,5 triệu + máy nhỏ chạy phần mềm | 2–4 triệu + công lắp | khách lớn đã có sẵn hệ camera | phải viết, cài, bảo trì phần mềm riêng trên máy khách; ống kính góc rộng khó đọc nhãn; hỗ trợ nặng nhất |

**Đề xuất:** bản đầu làm A (web) và C (web trên điện thoại trước, app sau). B là tùy chọn nâng cao. D để sau, chỉ khi có khách lớn đòi.

Thiết bị (giá niêm yết các trang bán lẻ lúc tra, chưa rõ ngày cập nhật):

| Loại | Mẫu | Giá | Ghi chú |
|---|---|---|---|
| Webcam | Rapoo C280 (2K, lấy nét tự động) | 820.000–849.000 đ | ứng viên giá tốt nhất |
| Webcam | Logitech C920e (1080p, lấy nét tự động) | 1.990.000 đ | mẫu tham chiếu |
| Webcam | Logitech C270 (720p, nét cố định) | 399.000 đ | **không nên**: 720p không đủ đọc nhãn |
| Máy quét | SingPC Scan-2623TR (2D, không dây) | 900.000 đ | |
| Máy quét | Zebra DS2208 (2D, có dây) | 2.199.000 đ | |
| Máy quét | Antech AS 1280i (1D, có dây) | 1.150.000 đ | nên chọn loại 2D để đọc cả QR |
| Phụ kiện | tay kẹp webcam, đèn LED thanh | 0,3–0,7 triệu (không có nguồn giá) | đèn đặt chéo để nhãn nhiệt và băng keo không lóa |

- Camera nên treo 45–50 cm, khung hình chỉ phủ **tấm lót đóng hàng khoảng 50 × 35 cm**. Phủ cả bàn 84 cm thì chữ số vận đơn chỉ
  còn khoảng 7 điểm ảnh ở 1080p — sát ngưỡng đọc (ước).
- Bẫy của máy quét kiểu bàn phím: cửa sổ Hubsell mất tiêu điểm là mã quét rơi đi chỗ khác. Màn quay nên chạy ở cửa sổ riêng, và về
  sau hỗ trợ máy quét chế độ cổng COM (Ship Xanh đang khuyên khách dùng cách này).
- **Chưa kiểm:** số webcam tối đa trên một máy trong Chrome (không có số công bố); webcam nào giữ được 10 khung/giây ổn định; quay +
  quét cùng lúc trên app Expo.

Nguồn giá: https://memoryzone.com.vn/webcam-may-tinh-rapoo-c280 · https://meta.vn/webcam-logitech-c920e-p79111 · https://hacom.vn/webcam ·
https://www.anphatpc.com.vn/dau-doc-ma-vach-2d-zebra-ds2208.html ·
https://www.anphatpc.com.vn/may-quet-ma-vach-2d-cam-tay-khong-day-singpc-scan-2623tr.html

## 11. Chất lượng video, cách nén, kho lưu, chi phí (ý 3 + 4)

### 11.1 Chất lượng + nén

Nguyên tắc rút từ số liệu camera an ninh (cảnh tĩnh, tay chuyển động — giống bàn đóng hàng):

- **Giữ độ phân giải, hạ số khung hình.** Giảm 30 → 10 khung/giây tiết kiệm 47–64 % dung lượng (IPVM, Hanwha đo); giảm tiếp 10 → 5
  chỉ thêm khoảng 30–35 % (ước) mà động tác tay bắt đầu giật. Chọn **10 khung/giây**.
- **Khung hình chính thưa** (4–5 giây một khung) lợi thêm 15–30 % với cảnh có tay chuyển động (ước; cảnh đứng yên hẳn mới được 70 %).
- **Không thu tiếng:** thêm 3–5 % dung lượng, lại ghi giọng nhân viên.
- **Nén ngay tại máy quay, máy chủ không nén lại.** Tiền CPU để máy chủ nén lại phải lưu khoảng 20 tháng mới hòa vốn (ước) — video của
  mình sống 3 tuần.
- Chrome trên Windows quay được thẳng tệp MP4 H.264 (từ bản 126), nhưng mặc định 2,5 Mbps (khoảng 19 MB/phút) → **phải tự đặt bitrate**;
  tệp ra thiếu thông tin thời lượng → máy chủ sửa vỏ tệp (không nén lại) lúc nhận.
  **(sửa 14/11: "máy chủ sửa vỏ tệp" không còn đúng với cách tải thẳng lên R2 — tệp không đi qua máy chủ nào. Phải ra tệp MP4
  thường ngay tại trình duyệt; và trình ghi sẵn của Chrome KHÔNG cho đặt khoảng khung hình chính. Xem mục 16.2.)**

Thang chất lượng đề xuất — **toàn bộ là ước tính** neo vào số camera an ninh có nguồn (1080p 10 khung/giây: 1.086–1.136 kbps với khung
chính mỗi giây; 720p: 536–700 kbps), chưa quay thử cảnh đóng hàng thật:

| Bậc | Cấu hình | Bitrate | MB / phút | Clip 45 giây | Dùng khi |
|---|---|---|---|---|---|
| A — mặc định | 1080p, 10 khung/giây, H.264 MP4, không tiếng | ≈ 800 kbps | ≈ 6,0 | ≈ 4,5 MB | đọc được số vận đơn ngay trên bàn |
| B — tiết kiệm | 720p, 10 khung/giây | ≈ 400–450 kbps | ≈ 3,0–3,4 | ≈ 2,4 MB | khung hình hẹp ≤ 50 cm hoặc nhân viên giơ nhãn sát camera |
| C — tối thiểu | 720p, 5–8 khung/giây | ≈ 250–300 kbps | ≈ 2,0 | ≈ 1,6 MB | shop rất nhạy chi phí; hình giật |
| Không nên | 480p | — | — | — | không đọc được nhãn, không thấy rõ món nhỏ |

- Shopee Singapore giới hạn video bằng chứng 30 MB và 1 phút. Chưa thấy quy định tương ứng cho người bán ở Việt Nam. Bậc A: clip 5 phút mới chạm 30 MB.
- **Phải đo trước khi chốt:** quay 20 kiện thật ở ba bậc bằng chính webcam định khuyên khách, xem lại bằng mắt có đọc được số vận đơn
  và nhận ra món hàng không; đo luôn thời lượng đóng một kiện (hiện không có số).

Nguồn: https://ipvm.com/reports/frame-rate-surveillance-guide · https://learncctv.com/what-is-bitrate-of-ip-camera-best-explanation/ ·
https://blog.addpipe.com/mediarecorder-video-bitrates/ · https://blog.addpipe.com/duration-in-mp4-files-produced-by-chrome-safari/ ·
https://optiview.dolby.com/?p=19972 · https://help.shopee.sg/portal/4/article/76632

### 11.2 Kho lưu riêng — giá đọc trên trang chính thức 13/11

Tỷ giá dùng: 1 USD = 25.910 đ (Vietcombank bán ra 13/11). Giá chưa gồm thuế nhà thầu / VAT với nhà cung cấp nước ngoài.

| Kho | Giá lưu / GB-tháng | Phí ghi một tệp | Tải xuống | Lưu tối thiểu | Ở đâu | Ghi chú |
|---|---|---|---|---|---|---|
| **Cloudflare R2 Standard** | 0,015 USD | 4,5 USD / triệu tệp | 0 | không | "châu Á – TBD", không cam kết nước nào | tài liệu rõ nhất; tự hết hạn theo tiền tố + số ngày |
| **Bizfly Simple Storage, lớp Cold** | 504 đ (+10 % VAT) | không thấy nêu | 280 đ/GB | chưa thấy tài liệu | Việt Nam | có tự hết hạn theo tiền tố + ngày |
| VNG vStorage Instant Archive | 530 đ (gói) | "không giới hạn" | miễn 3 TB/tháng | không | Việt Nam | chưa tìm được tài liệu tự hết hạn |
| OVHcloud Standard 1 vùng | ≈ 0,0081 USD | 0 | 0 | không | có ở Singapore (chưa tách được giá theo thành phố) | một trung tâm dữ liệu |
| Backblaze B2 | 0,00695 USD | 0 | miễn tới 3× dung lượng | không | chỉ Mỹ / châu Âu | tải lên từ VN chậm |
| AWS S3 Standard Singapore | 0,025 USD | 5 USD / triệu tệp | 0,12 USD/GB | không | Singapore | đắt gấp đôi, không thêm lợi |
| Wasabi | 0,00799 USD | 0 | 0 | **90 ngày** | Singapore | loại: video của mình sống khoảng 3 tuần mà bị tính đủ 90 ngày |
| Tự dựng máy chủ lưu trữ | ≈ 4,4 USD / TB-tháng khi đầy (3 máy, nhân ba) | — | — | — | châu Âu | chỉ có lãi khi đang lưu trên khoảng 40 TB; phải tự lo ổ hỏng, giám sát |

Loại hẳn mọi lớp "lưu lạnh" có thời gian tối thiểu (R2 IA, S3 IA, Glacier, Storj): video xóa sau 2–22 ngày vẫn bị tính đủ 30–90 ngày.

**Luật Việt Nam (không phải ý kiến pháp lý):** lưu ở máy chủ nước ngoài là "chuyển dữ liệu cá nhân xuyên biên giới" (Nghị định 356/2025
Điều 17) — video lộ tên, SĐT, địa chỉ trên vận đơn và hình nhân viên kho. Nghĩa vụ là lập và nộp hồ sơ đánh giá tác động trong 60 ngày,
không phải bị cấm. Hệ thống chính đang ở Singapore nên nghĩa vụ này nhiều khả năng đã có sẵn; lưu video TRONG NƯỚC thì riêng phần video
không rơi vào diện này.

**Em nghiêng về kho trong nước (Bizfly Cold, dự phòng VNG)** vì ba lý do: không phát sinh thêm hồ sơ xuyên biên giới cho video, hóa đơn
VAT tiền Việt (không vướng thuế nhà thầu), máy quay ở Việt Nam tải lên gần hơn. Đắt hơn R2 khoảng 0,4 đ một video — không đáng kể.
**Chưa đủ để chốt:** chưa thử tải thẳng từ trình duyệt lên Bizfly (đường dẫn ký sẵn + CORS), chưa rõ lớp Cold có thời gian tối thiểu
không, chưa thấy cam kết độ bền dữ liệu. Nếu một trong ba điểm trượt thì dùng R2. Mã viết qua một lớp "kho" đổi được nhà cung cấp.

### 11.3 Chi phí lưu MỘT video (ý 4)

Công thức: dung lượng × giá/GB-tháng × số ngày giữ ÷ 30 + phí ghi tệp.
Mốc tính: bậc A (1080p, 10 khung/giây), clip 45 giây ≈ 4,5 MB, giữ trung bình 22 ngày theo luật mục 12. **Thời lượng 45 giây và
dung lượng 4,5 MB là giả định, chưa đo.**

| Phương án | R2 | Bizfly Cold (đã cộng VAT) | OVH Singapore |
|---|---|---|---|
| **Mốc tính: 4,5 MB, giữ 22 ngày** | **1,40 đ** | **1,83 đ** | 0,69 đ |
| Clip 30 giây (3 MB), 22 ngày | 0,97 đ | 1,22 đ | — |
| Clip 90 giây (9 MB), 22 ngày | 2,68 đ | 3,66 đ | — |
| Bậc B 720p, 45 giây (2,4 MB), 22 ngày | 0,80 đ | 0,98 đ | — |
| Giữ cứng 60 ngày (4,5 MB) | 3,61 đ | 4,99 đ | — |
| Xóa lúc đối soát, 5,5 ngày (4,5 MB) | 0,44 đ | 0,46 đ | — |

**Shop 1.000 đơn/ngày** (30.000 video/tháng, luôn có khoảng 22.000 video ≈ 99 GB nằm kho):

| | R2 | Bizfly Cold |
|---|---|---|
| Luật theo trạng thái (đề xuất) | ≈ 42.000 đ/tháng | ≈ 55.000 đ/tháng |
| Giữ cứng 60 ngày | ≈ 108.000 đ/tháng | ≈ 150.000 đ/tháng |
| Xóa lúc đối soát | ≈ 13.000 đ/tháng | ≈ 14.000 đ/tháng |

- Xóa lúc đối soát chỉ rẻ hơn luật đề xuất **khoảng 30.000–40.000 đ một shop một tháng**, đổi lại mất bằng chứng ở 41–45 % ca hoàn
  (mục 12.1). Không đáng.
- Quy mô 1.000 shop × 1.000 đơn/ngày: khoảng 99 TB nằm kho, R2 ≈ 1.620 USD/tháng ≈ 42 triệu đ. Tới mức này tự dựng máy chủ bắt đầu
  có lãi (ngưỡng khoảng 40 TB).
- **Không lưu sẵn bộ ảnh cắt.** Mỗi tệp ảnh là một lần ghi (0,12 đ trên R2); 5 ảnh = 0,58 đ, gần nửa tiền lưu cả video. Ảnh chỉ cắt
  từ video khi đơn có yêu cầu hoàn (vài phần trăm số đơn).
- Mỗi video tải lên bằng MỘT lệnh ghi; chia nhiều phần thì phí ghi nhân ba.
- **Chưa tính:** database riêng cho sổ bản ghi, máy chủ nhận / sửa vỏ tệp, công hỗ trợ khách lắp camera, thuế với nhà cung cấp nước
  ngoài. Em chưa có báo giá cho các khoản cố định này; với vài chục shop đầu chúng lớn hơn tiền lưu.
- Băng thông phía shop: 1.000 video × 4,5 MB = 4,5 GB tải lên mỗi ngày — cáp quang thì ổn, 4G thì nặng.

### 11.4 Căn cứ để đặt giá bán

- **Giá vốn biến đổi ≈ 1,5–2 đ một video** (mốc tính trên); clip dài gấp đôi thì ≈ 3–4 đ.
- Thị trường Việt Nam: 50.000–370.000 đ/tháng cho shop nhỏ và vừa, đa số tính theo bàn hoặc theo dung lượng; **Ship Xanh cho miễn phí** **(sửa 14/11 khuya: SAI — Ship Xanh thu 18–25 đ/phút, xem mục 28)**
  kèm cloud 30 ngày; không ai ở Việt Nam tính theo đơn. Dobybot (Thái) tính theo video, khoảng 300–480 đ một đơn (tỷ giá baht ước).
- Ba cách thu, với shop 1.000 đơn/ngày:

| Cách thu | Ví dụ | Shop 1.000 đơn/ngày trả | Nhận xét |
|---|---|---|---|
| Theo video đã quay | 10 đ / video | 300.000 đ/tháng | khớp với giá vốn (tiền lưu tăng theo số video); cùng kiểu "tính thẳng" như phí vượt gói; đo sẵn ở `pack_usage_daily` |
| Theo bàn đóng hàng | 100.000 đ / bàn / tháng | 300.000–500.000 đ (3–5 bàn) | khách quen kiểu này (BoxCam, Camsight); nhưng shop lớn ít bàn trả ít trong khi tốn kho nhiều |
| Theo gói dung lượng | 150.000 đ / 100 GB | 150.000 đ | khách phải tự hiểu GB; shop quay clip dài bị phạt |

  Em nghiêng về **thu theo video**. Con số 10 đ chỉ là ví dụ để thấy biên; giá thật anh chốt.
- Lưu ý: Shopee ToS 6 (vi) cấm khai thác thương mại "Shopee Content". Video là nội dung của chính shop quay, không phải dữ liệu lấy từ
  Shopee, nhưng vận đơn lọt vào khung hình — em chưa đọc đủ để khẳng định điều khoản này không áp.

Nguồn giá kho: https://developers.cloudflare.com/r2/pricing/ · https://bizflycloud.vn/s3-simple-storage/bang-gia ·
https://docs.greennode.ai/vstorage/object-storage/cach-tinh-phi · https://www.ovhcloud.com/en/public-cloud/prices/ ·
https://www.backblaze.com/cloud-storage/pricing · https://wasabi.com/pricing/faq ·
https://www.vietnam-briefing.com/news/vietnam-personal-data-protection-regulation-decree-356.html

## 12. Vòng đời video theo trạng thái đơn (ý 5)

### 12.1 Điều số liệu nói

Ý "sàn đã đối soát thì xóa luôn" **không an toàn**: 41–45 % ca xin hoàn đến sau khi đơn đã đối soát (TikTok đối soát ở khoảng
2,5 ngày sau giao, khách còn xin hoàn tới ngày 15). Xóa lúc đối soát là mất bằng chứng ở gần một nửa số ca cần dùng.
Mốc đúng để xóa là **hết hạn khách được xin hoàn**, không phải lúc tiền về.

### 12.2 Bảng luật đề xuất

| # | Trạng thái đơn | Việc với video | Căn cứ của con số |
|---|---|---|---|
| L1 | Quay xong nhưng 3 ngày không khớp được đơn nào | xóa | 3 ngày: em tự chọn |
| L2 | Đơn hủy khi kiện CHƯA rời kho (hủy ngang) | xóa sau 24 giờ | 24 giờ: em tự chọn, phòng trạng thái sàn về trễ |
| L3 | Đơn hủy khi kiện ĐÃ giao cho hãng (kiện quay đầu) | giữ tới khi kho quét nhận kiện + 7 ngày; kho báo hỏng / mất → chuyển sang "giữ" (L5) | video đóng hàng là bằng chứng đòi hãng vận chuyển; 7 ngày: em tự chọn |
| L4 | Đã giao, không có yêu cầu hoàn | xóa ở mốc giao + hạn xin hoàn của sàn + 2 ngày: Shopee, TikTok, Lazada thường = **17 ngày**; gian LazMall = **32 ngày** | chính sách sàn (mục 14.3): người mua có 15 ngày, LazMall 30 ngày; khớp prod tháng 9 (muộn nhất 15,3 ngày TikTok, 11 Shopee); 2 ngày biên em tự chọn. **(sửa 14/11: tháng 10 Shopee có ca 16,2 ngày, TikTok 15,6 → biên 2 ngày quá sát; đề xuất nâng lên 5 ngày = xóa ở giao + 20 ngày, LazMall 35 — mục 16.5)** |
| L5 | Có yêu cầu hoàn / có tiền hoàn / kho báo hỏng, mất | chuyển sang ngăn "giữ", giữ tới khi ca đóng + 10 ngày | TikTok cho người bán kháng nghị trong 7 ngày lịch (mục 14.3) + 3 ngày biên em tự chọn |
| L6 | Trần cứng mọi trường hợp | xóa ở ngày thứ 90 kể từ lúc quay, báo trước cho shop | Shopee DPP 10.6: không giữ dữ liệu cá nhân người mua quá 90 ngày (vận đơn lọt vào khung hình) |
| L7 | Shop tắt gói video / hết hạn trả phí | ngừng quay; video đang có đi tiếp theo L1–L6 | — |
| — | Đơn đã đối soát | **không phải mốc xóa** | mục 12.1 |

Nhận diện "có yêu cầu hoàn" phải dùng mọi dấu hiệu sổ đang có (`returnRequestedAt`, `returnStatus ≠ NONE`, loại hoàn, tiền hoàn > 0),
vì riêng mốc xin hoàn đang thiếu ở khoảng 86 % đơn có hoàn (mục 8).

### 12.3 Số video nằm trong kho — shop 1.000 đơn/ngày

Giả định: 1.000 video/ngày; 94 % đơn giao bình thường, 4 % có hoàn (giữ trung bình 45 ngày — em giả định), 2 % kiện quay đầu
(30 ngày — em giả định); tạo → giao 3–5 ngày theo mục 8.

| Cách xóa | Ngày giữ trung bình | Video nằm kho | So với giữ cứng 60 ngày |
|---|---|---|---|
| Giữ cứng 60 ngày (như vận đơn đã in) | 60 | 60.000 | 100 % |
| **Luật L1–L6 (đề xuất)** | ≈ 22 | ≈ 22.000 | ≈ 37 % |
| Xóa lúc đối soát (ý ban đầu) | ≈ 5,5 | ≈ 5.500 | ≈ 9 % — nhưng mất 41–45 % ca hoàn |

## 13. Quản lý bản ghi + phân tầng dữ liệu (ý 6)

### 13.1 Nguyên tắc

1. **Tách hẳn khỏi hệ thống chính:** kho tệp riêng + cơ sở dữ liệu riêng cho sổ bản ghi video. Database chính của Hubsell
   không nhận thêm dòng nào cho mỗi video (1.000 shop × 1.000 đơn = 1 triệu dòng thêm + 1 triệu dòng xóa mỗi ngày — đúng loại tải
   đã làm cạn Disk IO hôm 28/10).
2. **Xóa theo trạng thái do sổ của mình điều khiển**, không trông vào quy tắc tự hết hạn của kho tệp (kho chỉ biết tuổi tệp, không
   biết trạng thái đơn). Quy tắc tự hết hạn của kho chỉ làm **lưới an toàn** phòng khi việc dọn của mình hỏng.
3. **Dịch vụ video tự hỏi trạng thái đơn theo lô**, chỉ cho đơn đang có video, không gọi sàn, không ghi vào database chính.

### 13.2 Năm tầng dữ liệu

| Tầng | Nằm ở đâu | Chứa gì | Sống bao lâu |
|---|---|---|---|
| T0 | Máy quay (bộ nhớ trình duyệt / app) | tệp vừa quay, hàng chờ tải lên khi rớt mạng | tới khi kho xác nhận đã nhận |
| T1 | Kho tệp, ngăn `hot/` | mọi video mới (ảnh bằng chứng KHÔNG lưu sẵn — cắt từ video khi cần, mục 11.3) | theo L1–L4; lưới an toàn của kho: 60 ngày (phủ gian LazMall 32 ngày sau giao + thời gian giao) |
| T2 | Kho tệp, ngăn `hold/` | video của đơn có hoàn / khiếu nại / hỏng mất (khoảng 4–6 % số đơn) | theo L5; lưới an toàn của kho: 95 ngày |
| T3 | Database riêng của dịch vụ video | sổ bản ghi (một dòng một video), nhật ký thao tác | dòng sống tới khi video bị xóa + 30 ngày để tra |
| T4 | Database riêng | số gộp theo ngày để tính tiền và để HQ xem | lâu dài (rất nhỏ) |

Chuyển T1 → T2 là chép + xóa một tệp, chỉ xảy ra với vài phần trăm đơn. Hai ngăn hai lưới an toàn khác nhau nên việc dọn có hỏng
cả tháng thì kho cũng không phình vô hạn.

### 13.3 Đường dẫn tệp

`{ngăn}/{ownerId}/{ngày quay, giờ VN}/{channelId}.{orderId}.{loại}{số thứ tự}.mp4`
(ví dụ `hot/u_abc/2026-11-13/ch_12.ord_998.pack1.mp4`)

- **Chủ shop đứng đầu:** shop rời / tắt gói / sàn yêu cầu xóa thì dọn bằng một tiền tố; đo dung lượng từng shop bằng một lệnh liệt kê;
  sau này shop lớn muốn kho riêng thì chuyển nguyên tiền tố.
- **Ngày đứng thứ hai:** để người soát và để lệnh liệt kê không phải đi qua hàng triệu tệp cùng lúc.
- **`channelId` trong tên tệp:** đáp ứng yêu cầu tách dữ liệu từng sàn ở mức logic (Shopee DPP 10.1), giống cách làm của vận đơn đã in.
  Tên sàn không cần nằm trong đường dẫn — có ở cột của sổ.
- Khác vận đơn đã in (ngày đứng đầu, dọn bằng cách liệt kê thư mục ngày): ở đây việc dọn chạy theo sổ nên ngày đứng đầu không còn lợi.

### 13.4 Bảng trong database riêng

| Bảng | Một dòng là | Cột chính | Phân mảnh / chỉ mục |
|---|---|---|---|
| `pack_stations` | một bàn đóng hàng | chủ shop, tên bàn, loại thiết bị, camera, lần cuối hoạt động | nhỏ |
| `pack_videos` | một video | chủ shop, gian, sàn, đơn, mã đơn, mã vận đơn, loại (đóng / khui), bàn, người quay, giờ quay, thời lượng, dung lượng, khổ hình, số khung/giây, bộ mã hóa, kho nào, ngăn, đường dẫn, số ảnh cắt, mã băm tệp, trạng thái (đang tải / đã lưu / đang giữ / đã xóa / mất), **hạn xóa**, luật đang áp, giờ xóa | **phân mảnh theo TUẦN của ngày quay**; chỉ mục (chủ shop, mã vận đơn), (chủ shop, đơn), (chủ shop, giờ quay giảm dần), chỉ mục một phần trên hạn xóa cho dòng còn sống |
| `pack_video_events` | một thao tác | video, ai, việc (xem, tải, gửi sàn, đổi ngăn, xóa vì luật nào), giờ | phân mảnh theo tháng |
| `pack_usage_daily` | một (chủ shop, gian, ngày) | số video, số giây, dung lượng tải lên, dung lượng × ngày đã lưu, số video đang giữ | khóa chính ba cột |
| `pack_settings` | một chủ shop / gian | bật-tắt, mức chất lượng, mức giữ, hạn mức | nhỏ |

- Phân mảnh theo tuần: 1 triệu dòng/ngày thì mỗi mảnh khoảng 7 triệu dòng, tối đa khoảng 15 mảnh còn sống. Hết trần 90 ngày thì **bỏ
  nguyên mảnh**, không xóa từng dòng nên không phình bảng. "Theo tuần" là em tự chọn, chưa đo.
- Cột **hạn xóa** là trung tâm: mỗi lần biết trạng thái đơn đổi thì tính lại hạn theo bảng luật 12.2; việc dọn chỉ là "lấy dòng tới
  hạn → xóa tệp → đánh dấu đã xóa", chạy theo lô nhỏ, có giới hạn nhịp.
- Mã băm tệp ghi lúc tải lên để chứng minh video không bị sửa sau khi quay.
- `pack_usage_daily` là nguồn duy nhất cho hóa đơn phần video: tính theo số video hay theo dung lượng × ngày đều lấy được từ đây.

### 13.5 Cách biết trạng thái đơn mà không đụng hệ thống chính

- Backend Hubsell mở MỘT đường đọc nội bộ: nhận tối đa 500 mã đơn của một chủ shop, trả trạng thái giao, mốc giao, dấu hiệu hoàn,
  mốc đối soát — đọc theo khóa chính, không quét bảng, không gọi sàn, không ghi gì.
- Dịch vụ video chỉ hỏi ở các **mốc kiểm**: 1 ngày sau quay (hủy ngang?), mỗi 2 ngày tới khi giao, một lần ở hạn xóa (có hoàn không?),
  và mỗi 3 ngày với đơn đang giữ. Khoảng 6–8 lượt hỏi cho một đơn trong cả vòng đời. Shop 1.000 đơn/ngày ≈ 7.000 dòng đọc/ngày,
  gộp 500 dòng một lần = khoảng 14 lần gọi/ngày.
- Chậm vài giờ không sao: luật xóa tính bằng ngày.

## 14. Đối thủ, giá họ bán, quy định của sàn

> Giá là giá niêm yết trên trang nhà cung cấp lúc đọc 13/11; chưa dùng thử sản phẩm nào.

### 14.1 Việt Nam

| Sản phẩm | Bắt đầu quay bằng | Lưu ở đâu, bao lâu | Giá | Nhiều bàn |
|---|---|---|---|---|
| **Ship Xanh** (kèm phần mềm đa kênh) | điện thoại tự dò QR, mã kế tự cắt clip; máy tính dùng máy quét (bàn phím hoặc cổng COM); nhận camera an ninh | cloud 30 ngày | **ghi "miễn phí"**, không nêu giới hạn **(sửa 14/11 khuya: SAI — Ship Xanh thu 18–25 đ/phút, xem mục 28)** | một máy tính nhiều nhân viên, mỗi người một máy quét COM |
| ASCAM / ECAM | máy quét hoặc camera đọc mã | ổ cứng máy khách không hạn; cloud bán riêng | bản quyền 3 / 5 / 8,5 triệu đ/năm theo máy tính; cloud 150.000 đ/tháng cho 100 GB (60 ngày) → 800.000 đ cho 1 TB (365 ngày) | gói Extend trở lên không giới hạn số bàn |
| CAM CHECK | quét mã | cloud của họ hoặc Google Drive / OneDrive của shop; miễn phí giữ ≤ 30 ngày | 0 đ (500 video) · 49.000 đ (50 GB, 10.000 video) · 117.000 đ (200 GB) · 242.000 đ/tháng (500 GB, 100.000 video) | chạy trên trình duyệt |
| BoxCam | quét mã, mã kế kết thúc | mặc định ở máy; cloud 7–35 ngày theo gói | 0 đ · 89.000 đ (1 bàn, 50 GB) · 249.000 đ (3 bàn) · 369.000 đ/tháng (6 bàn, 250 GB) | bán theo số bàn |
| Camsight / Camzone | camera hai mắt tự nhận nhãn (một mắt soi nhãn 30 × 30 cm) | tại chỗ, "khoảng 2 GB/ngày" | 129.000 đ/tháng/bàn; 4 bàn 306.000 đ | bán theo số bàn |
| DEUS | đọc QR | cloud 30–45 ngày | 120.000 đ (< 20 đơn/ngày) · 160.000 đ · 240.000 đ/tháng (khoảng 100 đơn/ngày); trên 100 đơn/ngày: liên hệ | — |
| CamViewer | quét mã | máy khách | 150.000 đ/tháng/thiết bị | — |
| Effitrack | camera đọc mã; app điện thoại ra lệnh quay | ổ cứng máy khách | "chỉ với 50.000 đ/tháng" | tới 11+ bàn |
| Boxme (kho thuê) | kho quay mọi đơn | trích được trong 15 ngày sau giao | thu phí mỗi lần trích | — |

Không thấy tính năng này ở Sapo, Nhanh.vn, Pancake, KiotViet, Salework, UpBase. BigSeller và UpSeller có, lưu ở máy khách.

### 14.2 Nước ngoài (mô hình giá đáng chú ý)

- **Dobybot (Thái Lan): trả trước theo số video**, 0,40–0,60 baht một đơn; tự gửi link video cho khách qua chat của sàn.
- PackProof (Indonesia): Rp 412.000/tháng cho 10.000 lượt quét. Realpacking (Hàn): 55 USD/tháng/ghế, 30 ngày. vAudit: 50 USD/bàn/tháng,
  giữ thêm 60 / 90 ngày +15 / +25 USD. Eshopbox (Ấn Độ): giữ 60 ngày, giữ lâu hơn ₹1/video/tháng.
- Mọi sản phẩm đọc được đều **cắt clip theo từng đơn**; không thấy ai bán kiểu "quay liên tục rồi tra theo giờ quét".

### 14.3 Quy định của sàn (trang chính thức)

| | Shopee VN | TikTok Shop VN | Lazada VN |
|---|---|---|---|
| Người mua được xin hoàn trong | 15 ngày từ khi giao | 15 ngày (6 ngày với vài ngành) + tới 10 ngày để gửi hàng trả | 15 ngày; **LazMall 30 ngày** |
| Người bán phải trả lời trong | 2 ngày lịch, quá hạn tự hoàn tiền | duyệt yêu cầu 1 ngày; kiểm hàng hoàn 2 ngày; kháng nghị 7 ngày, chỉ một lần; bổ sung bằng chứng 24 giờ | 2 ngày; bổ sung bằng chứng 24 giờ |
| Yêu cầu với video đóng gói | ảnh HOẶC video, thấy đủ đúng sản phẩm, **có mã vận đơn** | thấy mã đơn / mã vận đơn / QR, đúng hàng, đủ số lượng; **liên tục, rõ, không chỉnh sửa** | chỉ khuyến nghị quay |
| Video khui kiện hoàn | mạnh nhất: có mặt tài xế, rõ 6 mặt kiện | **bắt buộc** khi kháng nghị sai hàng / thiếu hàng / đã dùng / hư hỏng; đủ 6 mặt kiện | khuyến nghị quay trước khi mở |
| Định dạng / dung lượng video | không thấy nêu | không thấy nêu | không thấy nêu |

Hệ quả:
- Hạn trả lời chỉ 1–2 ngày → **tìm ra đúng video trong vài giây** quan trọng hơn hình đẹp.
- TikTok đòi video liên tục, không chỉnh sửa → clip lưu phải là nguyên đoạn quay của một kiện; mọi thứ chèn thêm (mã đơn, giờ) phải chèn
  ngay lúc quay.
- TikTok: bấm "Xác nhận kiện hàng" là mất quyền khiếu nại → màn khui kiện hoàn của mình phải quay TRƯỚC khi cho bấm nhận.
- Ca dài nhất còn phải xuất trình video: TikTok khoảng 45 ngày từ lúc đóng gói, LazMall trên 60 ngày (ước) → mức 25–30 ngày của đối thủ
  không phủ hết; luật giữ theo trạng thái (mục 12) phủ được.

Nguồn: https://shipxanh.com/?p=14427 · https://ghihinh.com/ · https://quayvideodongdon.com/pricing · https://boxcam.me/ · https://deus.vn/ ·
https://camviewer.vn/ · https://effitrack.me/cac-goi-giai-phap/ · https://www.dobybot.com/en/pricing ·
https://banhang.shopee.vn/edu/article/10626 ·
https://seller-vn.tiktok.com/university/essay?knowledge_id=1766935302801169&default_language=vi-VN ·
https://sellercenter.lazada.vn/helpcenter/s/faq/knowledge?categoryId=1000028676&m_station=faq&questionId=1000152885

## 15. Tóm tắt trả lời 6 ý + việc phải đo + chờ anh chốt

| Ý của anh | Trả lời | Mức chắc |
|---|---|---|
| 1. Quét mã hay camera tự nhận | Máy tính: máy quét cầm tay. Điện thoại / máy tính bảng: camera tự nhận. Mã kế tiếp tự cắt clip | tính trên giấy + đối thủ; chưa thử thiết bị |
| 2. Thiết bị, nhiều bàn | Không bắt buộc mỗi bàn một máy tính: mỗi bàn một điện thoại / máy tính bảng trên giá là đủ; một máy tính gánh được 2–3 bàn | giá niêm yết; số webcam / máy chưa đo |
| 3. Lưu ở máy chủ khác, nén | Kho tệp riêng + database riêng. 1080p, 10 khung/giây, H.264, không tiếng, nén tại máy quay, máy chủ không nén lại | thang bitrate là ước tính |
| 4. Chi phí một video | ≈ 1,5–2 đ (4,5 MB, giữ 22 ngày); shop 1.000 đơn/ngày ≈ 42.000–55.000 đ/tháng tiền lưu | giá kho đọc trang chính thức; dung lượng + thời lượng giả định |
| 5. Xóa theo trạng thái đơn | Hủy ngang: xóa sau 24 giờ. Giao xong không hoàn: xóa ở giao + 17 ngày. Có hoàn: giữ tới khi ca đóng + 10 ngày. Trần 90 ngày. **Đối soát không phải mốc xóa** | số prod tháng 9 + chính sách sàn |
| 6. Phân vùng, bảng, tầng | 5 tầng dữ liệu; đường dẫn chủ shop → ngày → gian.đơn; 5 bảng, `pack_videos` phân mảnh theo tuần, cột hạn xóa điều khiển việc dọn | thiết kế, chưa đo |

**Một buổi đo sẽ xóa được phần lớn chỗ "ước tính"** (1 webcam lấy nét tự động + 1 máy quét + vài chục kiện thật):
1. Quay 20 kiện ở ba bậc A / B / C → xem có đọc được số vận đơn, nhận ra món hàng; lấy dung lượng thật.
2. Bấm giờ đóng một kiện → thay số giả định 45 giây.
3. Thử thư viện đọc mã trên khung hình thật ở 25 / 40 / 60 cm.
4. Tải thử 50 tệp thẳng từ trình duyệt (cáp quang + 4G) lên Bizfly và R2 → chốt kho.

**Anh Trung 13/11 đêm: "anh đang tính dùng R2 cho rẻ"** → hướng hiện tại là Cloudflare R2 Standard; thử trên hạn mức miễn phí của R2
(10 GB lưu, 1 triệu lượt ghi, 10 triệu lượt đọc mỗi tháng, tải xuống không tính tiền; lớp Infrequent Access không có miễn phí).
Việc kéo theo khi dùng R2: tên xuất hóa đơn là công ty, thuế nhà thầu, bổ sung kho này vào hồ sơ chuyển dữ liệu ra nước ngoài.

**Anh Trung 13/11 đêm: "Đặt lịch tối mai khảo sát một lần nữa. Rồi đưa ra phương án từng lát rồi mới làm."** → đã đặt việc chạy một lần
lúc 20:00 ngày 14/11/2026 (`hubsell-video-dong-hang-khao-sat-lan-2`): khảo sát lại các điểm chưa kiểm (R2, quay trong trình duyệt, cỡ mã
vạch thật, mốc xin hoàn bị thiếu, số prod một tháng khác, trang gốc của sàn, Ship Xanh) rồi viết phương án từng lát vào PHẦN 3 của tệp
này. Không viết mã cho tới khi anh duyệt lát.

**Chờ anh chốt:**
1. ~~Kho trong nước hay R2~~ → anh nghiêng R2 (13/11), chốt hẳn sau khi tải thử.
2. Cách xóa: luật theo trạng thái (em đề xuất) hay vẫn xóa lúc đối soát để tiết kiệm khoảng 30.000–40.000 đ một shop một tháng.
3. Cách thu phí: theo video (em nghiêng), theo bàn, hay theo dung lượng.
4. Có làm buổi đo trước khi thiết kế chi tiết không, và đo ở kho của shop nào.

---

# PHẦN 3 — Khảo sát lần hai + phương án từng lát (14/11/2026)

> Anh Trung 13/11: "Đặt lịch tối mai khảo sát một lần nữa. Rồi đưa ra phương án từng lát rồi mới làm."
> Phiên hẹn giờ 20:00 14/11, anh không có mặt. **Chỉ khảo sát + đề xuất. Không viết mã, không commit, không push.**
> Cách ghi mức chắc: **[gốc]** = đọc trên trang chính thức; **[gốc-tt]** = trang chính thức nhưng đọc qua công cụ tóm tắt, chưa đối
> chiếu từng chữ; **[phụ]** = nguồn bên thứ ba; **[prod]** = SQL chỉ đọc trên prod; **[mã]** = đọc mã; **[chưa]** = chưa kiểm được.

## 16. Kết quả khảo sát lần hai

### 16.1 Cloudflare R2 (mục A) — [gốc-tt], developers.cloudflare.com/r2

| Điểm | Kết quả | Hệ quả |
|---|---|---|
| Giá Standard | 0,015 USD/GB-tháng; ghi (Class A) 4,5 USD/triệu; đọc (Class B) 0,36 USD/triệu; tải xuống 0 đ; xóa 0 đ; không có thời gian lưu tối thiểu | **khớp lần một** |
| Miễn phí | 10 GB-tháng + 1 triệu lượt ghi + 10 triệu lượt đọc mỗi tháng, chỉ lớp Standard | khớp lần một. 10 GB ≈ 2.200 video 4,5 MB nằm kho: đủ cho buổi đo và một shop khoảng 100 đơn/ngày |
| Cách tính | GB-tháng = trung bình của đỉnh mỗi ngày; **làm tròn LÊN** tới 1 GB và 1 triệu lượt, tính theo cả tài khoản | sai số tối đa +0,015 USD và +4,5 USD mỗi tháng cho CẢ tài khoản, không phải mỗi shop |
| Có bắt gắn thẻ không | tài liệu ghi phải "hoàn tất bước thanh toán để thêm gói R2", không nói rõ thẻ | **[chưa]** — lúc anh bật R2 màn hình sẽ cho biết |
| Đường dẫn ký sẵn | hạn 1 giây → 7 ngày; có GET / HEAD / PUT / DELETE; **không có kiểu POST biểu mẫu**; **chỉ chạy trên tên miền `…r2.cloudflarestorage.com`, không dùng được tên miền riêng**; khóa được `Content-Type` bằng cách ký tiêu đề; **không có cách chặn cỡ tệp** | phải bật CORS trên bucket; cỡ tệp kiểm SAU khi tải (đọc `HeadObject`), quá cỡ thì xóa |
| CORS | khai nguồn (origin) của app, phương thức `PUT`, tiêu đề `Content-Type`, lộ `ETag`; đường dẫn hết hạn trả 403 không kèm CORS nên trình duyệt báo nhầm thành lỗi CORS | hạn ký đặt dư (vd 1 giờ) và bắt lỗi này riêng |
| Giới hạn | một lệnh PUT tối đa khoảng 5 GiB; số tệp / bucket không giới hạn; ghi cùng MỘT khóa tối đa 1 lần/giây; không thấy trần ghi theo bucket | một video = một lệnh PUT là đủ, không cần chia phần |
| Tự hết hạn | theo tiền tố + số ngày; tối đa **1.000 luật** / bucket; xóa "thường trong 24 giờ" sau hạn; xóa không tính tiền | dùng làm lưới an toàn được, không dùng làm luật chính (trễ tới 1 ngày) |
| Chép giữa hai tiền tố | `CopyObject` = một lượt ghi (≈ 0,12 đ); không có lệnh đổi tên | xem đề xuất bỏ ngăn `hold/` bên dưới |
| Vị trí | gợi ý `apac` là "cố gắng, không bảo đảm", không nêu nước nào; chỉ có vùng pháp lý eu / us / fedramp, **không có vùng châu Á** | hồ sơ chuyển dữ liệu ra nước ngoài không ghi được tên nước cụ thể |
| Điều khoản về video | điều khoản hạn chế video áp cho CDN khi KHÔNG dùng dịch vụ trả tiền; R2 thuộc nhóm dịch vụ được phép chứa nội dung; đường dẫn ký sẵn không đi qua CDN | không thấy gì cấm lưu video trên R2 |
| Độ bền / nhất quán | thiết kế 11 số 9; ghi đồng bộ; đọc-ngay-sau-ghi nhất quán | `HeadObject` ngay sau khi trình duyệt tải xong là xác nhận tin được |
| Mã băm | ghi chú phát hành 2023 nói PutObject nhận sha256, nhưng bảng tương thích chỉ liệt kê Content-MD5 | **[chưa]** — thử ở lát 0 |

**Tính lại mục 11.3:** 4,5 MB giữ 22 ngày = 1,28 đ lưu + 0,12 đ ghi = **1,40 đ** — đúng số lần một. Shop 1.000 đơn/ngày = 99 GB + 30.000
lượt ghi = 1,62 USD ≈ **42.000 đ/tháng** — đúng. Nếu nâng biên xóa lên giao + 20 ngày (mục 16.5): giữ trung bình ≈ 25 ngày →
**≈ 1,57 đ/video, ≈ 47.000 đ/tháng**. Thêm một lượt `HeadObject` mỗi video: +280 đ/tháng, bỏ qua được.

**Không tìm thấy lý do nào để R2 không dùng được.** Hai điểm phải thiết kế quanh: không chặn được cỡ tệp lúc tải, và không có tên miền riêng.

**Đề xuất mới — bỏ ngăn `hold/` (đổi mục 13.2):** việc xóa đã do sổ của mình điều khiển, trần cứng là 90 ngày cho mọi video. Vậy chỉ cần
MỘT tiền tố với MỘT lưới an toàn 95 ngày; "đang giữ" là một cột trong sổ, không phải chỗ nằm của tệp. Bớt được bước chép + xóa, bớt một
loại lỗi (chép xong chưa kịp xóa). Cái giá: nếu việc dọn của mình hỏng, kho phình tới 95 ngày thay vì 60 — với shop 1.000 đơn/ngày là
tối đa khoảng 185.000 đ/tháng, và có cảnh báo dung lượng thì không tới mức đó.

### 16.2 Quay trong trình duyệt (mục B)

| Điểm | Kết quả | Mức chắc |
|---|---|---|
| Trình ghi sẵn (MediaRecorder) ra MP4 H.264 | Chrome 126 trở lên, cả máy tính lẫn Android | [gốc-tt] chromestatus.com/feature/5163469011943424 |
| Tệp ra | MP4 **phân mảnh**, thời lượng ghi 0; trình phát của Windows không hiện thời lượng, không tua được; VLC phát được | [phụ] blog.addpipe.com (thử trên Chrome 147) |
| Đặt bitrate | có tham số; Chrome "gần như theo", vượt khoảng 10 % | [phụ]; tài liệu gốc không cam kết |
| Đặt số khung hình | đặt ở lúc xin camera (`frameRate`), là "gần nhất có thể"; webcam có theo 10 khung/giây không thì không tài liệu nào nói | **[chưa]** |
| **Đặt khoảng khung hình chính** | tham số có trên MDN, nhưng chromestatus ghi **chưa phát hành, không còn phát triển** | [gốc-tt] chromestatus.com/feature/5117302963437568 — hai nguồn lệch nhau, coi như KHÔNG dùng được |
| Cách khác: WebCodecs + thư viện Mediabunny | giấy phép MPL-2.0 (dùng trong sản phẩm thương mại được, sửa thư viện thì phải công bố phần sửa); xuất **MP4 thường** (`fastStart: 'in-memory'`); nhận thẳng luồng camera; có `bitrate` và `keyFrameInterval` | [gốc-tt] mediabunny.dev, github.com/Vanilagy/mediabunny. Tệp ra có ghi thời lượng không: trang không nói → **[chưa]** |
| Bộ đọc mã sẵn của Chrome trên Windows | không có (chỉ macOS, ChromeOS, Android) | [gốc-tt] — **xác nhận lần một** |
| Tab bị ẩn / cửa sổ thu nhỏ có còn quay không | không tài liệu nào nói | **[chưa]** — phải thử |
| Máy quét kiểu bàn phím khi cửa sổ mất tiêu điểm | mã rơi ra ngoài (suy từ cách hệ điều hành chia bàn phím) | suy luận |
| Máy quét qua WebHID | Chrome **chặn** thiết bị khai là bàn phím → máy quét phải chuyển sang chế độ khác | [gốc-tt] developer.chrome.com/docs/capabilities/hid |
| Máy quét qua cổng COM (Web Serial) | Chrome / Edge 89+ trên Windows; lần đầu phải bấm cấp quyền, lần sau tự nhận; tab ẩn có còn nhận không: không nói | [gốc-tt]; phần tab ẩn **[chưa]** |
| Android Chrome | bộ đọc mã sẵn có từ bản 83 (cần Google Play Services), có `code_128` và `qr_code`; quay MP4 từ bản 126; **quay + đọc mã cùng lúc trên một luồng: không tài liệu nào nói**; giữ màn hình sáng được, nhưng tự nhả khi tab ẩn | [gốc-tt]; phần cùng lúc **[chưa]** |
| Hàng chờ khi rớt mạng | một trang được dùng tới 60 % ổ đĩa; vài trăm MB không vấn đề | [gốc-tt] MDN |
| Số webcam trên một máy | không có giới hạn công bố; số băng thông USB trên mạng lệch nhau, không dùng được | **[chưa]** |
| App mobile | dự án đang ở **Expo 57, expo-camera 57, React Native 0.86** [mã: `hubsell-mobile/package.json`]. Tài liệu expo-camera có `videoBitrate`, `videoQuality`, **không có số khung hình**, không nói quét mã được hay không trong lúc quay. VisionCamera làm được cả hai nhưng là thư viện gốc mới → phải build lại app nộp kho, không vá OTA được | [gốc-tt] docs.expo.dev, visioncamera.margelo.com; phần cùng lúc **[chưa]** |

**Lần một sai / thiếu ở đây:**
1. "Máy chủ sửa vỏ tệp lúc nhận" mâu thuẫn với việc tải thẳng lên R2 (không có máy chủ nào ở giữa). Phải ra tệp chuẩn ngay ở trình duyệt.
2. "Khung hình chính thưa 4–5 giây" không đặt được bằng trình ghi sẵn của Chrome.

→ **Đường chính đề xuất đổi thành WebCodecs + Mediabunny** (đặt được bitrate, khung chính, ra MP4 thường). Trình ghi sẵn chỉ làm
đường lùi. Đây vẫn là lựa chọn trên giấy: lát 0 phải quay thật bằng cả hai cách rồi mới chốt.

### 16.3 Cỡ thật của mã vạch trên vận đơn (mục C) — **không đo được**

Trong dự án không có tệp vận đơn PDF nào: `backend/.local-uploads` chỉ có `product-images`, git không theo dõi tệp PDF nào, các tệp PDF
còn lại là hóa đơn. Phép tính "0,8 điểm ảnh / vạch" ở mục 9 **vẫn là ước tính**. Đo ở lát 0: in một vận đơn thật của mỗi sàn, đo bằng thước.

### 16.4 Vì sao mốc `returnRequestedAt` thiếu (mục D) — [mã] + [prod]

Mốc này chỉ được ghi ở MỘT tình huống: lượt đồng bộ thấy yêu cầu hoàn **còn sống, có hàng quay về**, và đơn đang ở `NONE` → chuyển
`AWAITING` (`shopee/returns-sync.ts` dòng 189–192, `tiktok/returns-sync.ts` dòng 206–209, Lazada cùng khuôn). Ba nhóm KHÔNG có mốc:

1. **Chỉ hoàn tiền, khách giữ hàng** — không cắm `AWAITING` nên không ghi mốc; nếu đã ghi thì bị xóa về null.
2. **Quét bù lịch sử** (`historical` / `skipAwaiting`, làm từ 02/10): yêu cầu đã xong trước khi Hubsell đọc được → ghi tiền hoàn, không ghi mốc.
3. **Yêu cầu đã hủy / đóng** — mốc bị xóa về null.

Số prod khớp với nhóm 2: đơn tạo tháng 8 gần như không có mốc (TikTok 37 đơn, Shopee 118), tháng 9 có 12–14 %, **tháng 10 TikTok có
8.907 đơn đã giao mang mốc trong khi 9.755 đơn đã giao có tiền hoàn** (hai tập không trùng hẳn nhau, chỉ để thấy cỡ). Tức "thiếu 86 %"
là chuyện của đơn cũ, không phải lỗi đang chảy. Giờ tạo yêu cầu của sàn (`create_time`) có sẵn trong mọi lượt đồng bộ, chỉ là không lưu
cho nhóm 1.

Hệ quả cho luật xóa: vẫn phải nhận diện "có hoàn" bằng mọi dấu hiệu (mục 12.2), vì nhóm 1 không bao giờ có mốc.

### 16.5 Số prod tháng khác (mục E) — [prod], 2 câu SQL chỉ đọc, mỗi câu một phân mảnh `order_ledger`

| Đơn tạo trong | Sàn | Đơn | Hủy | Đã giao | Đã giao có tiền hoàn | Có mốc xin hoàn + đã đối soát | **Xin hoàn SAU đối soát** | Giao → xin hoàn: giữa / 90 % / 99 % / muộn nhất (ngày) |
|---|---|---|---|---|---|---|---|---|
| Tháng 8 | Shopee | 36.088 | 7.695 | 28.393 | 1.208 | 118 | 54 = **46 %** | −2,5 / 2,5 / 7,8 / **91,6** |
| Tháng 8 | TikTok | 128.867 | 22.667 | 106.200 | 3.262 | 36 | 23 = **64 %** | 1,8 / 4,8 / 14,2 / 15,5 |
| Tháng 9 (lần một) | Shopee | 46.843 | 9.646 | 37.207 | 1.603 | 177 | 79 = 45 % | 0 / 3 / 10,9 / 11 |
| Tháng 9 (lần một) | TikTok | 172.210 | 25.598 | 146.617 | 3.931 | 480 | 197 = 41 % | 1,5 / 11,2 / 14,6 / 15,3 |
| Tháng 10 | Shopee | 52.793 | 10.360 | 40.618 | 1.950 | 900 | 278 = **31 %** | 0,2 / 3,3 / 11,8 / **16,2** |
| Tháng 10 | TikTok | 298.886 | 37.040 | 260.496 | 9.755 | 9.482 | 1.760 = **19 %** | 0,4 / 3,9 / 12,7 / 15,6 |
| Tháng 10 | Lazada | 682 | 28 | 654 | 23 | 23 | 11 | 1,8 / 2,8 / 2,9 / 2,9 |

Đọc bảng:
- **Kết luận lần một đứng vững: đối soát không phải mốc xóa.** Tháng nào cũng có một phần lớn ca xin hoàn đến sau đối soát.
- **Con số "41–45 %" thì KHÔNG ổn định:** 19 % → 64 % tùy tháng. Tháng 8 mẫu rất nhỏ (36 và 118 đơn). Tháng 10 mẫu lớn nhất và đầy đủ
  mốc nhất, nhưng **chưa khép**: đơn tạo cuối tháng 10 hôm nay vẫn còn trong hạn xin hoàn, nên 19 % và 31 % là mức sàn. Từ nay nên nói
  "khoảng 1/5 tới 1/2", đừng dẫn một con số.
- **Ngày muộn nhất TikTok lặp lại đều: 15,3 – 15,6 ngày** qua ba tháng. Shopee có ca 16,2 ngày (tháng 10) và một ca lẻ 91,6 ngày
  (tháng 8, chưa soi). → Luật L4 "giao + 17 ngày" chỉ dư 0,8 ngày so với ca Shopee muộn nhất. **Đề xuất nâng biên từ 2 lên 5 ngày:
  xóa ở giao + 20 ngày (LazMall 35).** 5 ngày là em tự chọn; tốn thêm khoảng 5.000 đ/tháng cho shop 1.000 đơn/ngày.
- Shopee có trị giữa âm ở tháng 8: mốc giao của Shopee trong sổ đến trễ hơn thực tế (đã ghi ở mục 8) — số ngày của Shopee đọc dè dặt.
- Quy mô tháng 10: TikTok 298.886 đơn, gấp 1,7 lần tháng 9.

### 16.6 Trang gốc của sàn (mục F)

- **Shopee `v2.returns.upload_proof` — đọc được bằng Chrome [gốc]:** tham số chỉ có `return_sn`, `photo[] {url, thumbnail}`,
  `description`. Lời mô tả có nhắc "pictures and videos converted into URLs" nhưng **bảng tham số không có trường video nào**. Lỗi
  `format.unsupport`, `proof.overdue`, `number.error`. Bản SDK bên thứ ba lần một dựa vào ghi `proof_video[]` là **sai so với trang gốc**.
  → Đã sửa mục 1 và 2.1. Mẫu số chung "ảnh cắt từ video + lời mô tả" càng đúng: qua API, Shopee và TikTok đều chỉ nhận ảnh.
- Sau trang đầu, Chrome đòi người bấm xác nhận từng thao tác trên open.shopee.com → em dừng, không tìm đường vòng. `convert_image`,
  `dispute`, trang TikTok và Lazada: **[chưa]**.
- Giới hạn video bằng chứng duy nhất có nguồn vẫn là Shopee **Singapore, phía người mua**: 10 MB/ảnh, 30 MB và 1 phút/video [gốc-tt].
  Chưa có nguồn cho Việt Nam, cho người bán, cho TikTok, cho Lazada.
- Hệ quả cho phần quay: không sàn nào bắt một định dạng video qua API → MP4 H.264 là lựa chọn an toàn (mở được ở mọi nơi khi người bán
  tự nộp tay). **Ảnh cắt phải là JPG / PNG dưới 10 MB.**

### 16.7 Ship Xanh (mục G) — [gốc-tt], trang công khai, không tạo tài khoản

- Vẫn ghi **miễn phí** **(sửa 14/11 khuya: SAI — Ship Xanh thu 18–25 đ/phút, xem mục 28)**; trang giá: "Hầu hết mọi tính năng… đều miễn phí", chỉ thu ba thứ theo lượt (sao chép sản phẩm, đẩy sản phẩm,
  AI Flash Sale). Có câu "sau này sẽ thu phí một số tính năng khác", không nêu tên.
- Lưu **30 ngày trên cloud** — chỉ một câu ở trang Tính năng. Không nêu: giới hạn số video / dung lượng / số bàn, độ phân giải, có
  tiếng hay không, sau 30 ngày thì sao.
- **Điện thoại không cần app:** mở trình duyệt, đăng nhập, bấm Ghi hình, tự dò QR. Đơn kế tự cắt clip đơn trước, có tiếng báo. Đơn cuối
  quét mã QR "SXSTOP" in sẵn.
- Máy quét: chế độ bàn phím (cửa sổ phải mở, ô nhập phải đang chọn) hoặc **cổng COM — họ khuyên dùng**, thu nhỏ cửa sổ vẫn chạy, nhiều
  nhân viên chung một máy tính.
- Camera an ninh: dán link RTSP; có bài hướng dẫn cho 8 hãng; họ tự ghi là "cần nâng cấp phần cứng / phần mềm" mới chạy tự động.
- **Có quay khui hàng hoàn**, tự chuyển đơn sang "đã nhận đơn hoàn", tự phát hiện đơn hủy và đơn trùng.
- Video in mã bằng chứng + giờ quay ở góc; có link xem theo đơn (theo lời một khách đánh giá).
- App iOS thêm quay video từ bản 4.0.14, vẫn còn sửa lỗi ghi hình ở bản 13/10.

Đối chiếu: không có gì mâu thuẫn lần một. Điều mới đáng chú ý: **họ làm web trên điện thoại trước, app sau** — cùng thứ tự em đề xuất;
và **họ đã có sẵn quay khui hàng hoàn** — với mình đó là lát 5.

### 16.8 Bảng tổng: xác nhận / sai / chưa kiểm

| | Nội dung |
|---|---|
| **Xác nhận** | Giá + hạn mức miễn phí R2; 1,40 đ/video và 42.000 đ/tháng; R2 tải thẳng từ trình duyệt được, tự hết hạn theo tiền tố được; Chrome Windows quay được MP4 H.264; Chrome Windows không có bộ đọc mã sẵn; đối soát không phải mốc xóa; TikTok muộn nhất ≈ 15,5 ngày; Ship Xanh miễn phí + cloud 30 ngày + mã kế tự cắt clip |
| **Lần một sai** | (1) Shopee nhận video qua API — sai, chỉ ảnh. (2) "Máy chủ sửa vỏ tệp" — không khớp với tải thẳng. (3) Khung chính thưa — trình ghi sẵn không đặt được. (4) "41–45 %" như một hằng số — thực tế 19–64 %. (5) "Thiếu mốc 86 %" như lỗi chung — chỉ là đơn cũ. (6) Biên 2 ngày của L4 — quá sát |
| **Vẫn chưa kiểm** | R2 có bắt gắn thẻ không; R2 nhận mã băm sha256 không; cỡ vạch mã thật; dung lượng + thời lượng clip thật; webcam có theo 10 khung/giây; tab ẩn có còn quay / còn nhận mã; Android quay + đọc mã cùng lúc; expo-camera quay + quét cùng lúc; tệp Mediabunny có thời lượng; số webcam / máy; trang gốc TikTok + Lazada; định dạng video bằng chứng ở VN; ca Shopee 91,6 ngày |

Gần hết cột "chưa kiểm" là thứ **chỉ thiết bị thật mới trả lời được** — tra thêm tài liệu không ra nữa. Đó là việc của lát 0.

## 17. Phương án từng lát (ĐỀ XUẤT — chưa làm lát nào)

Nguyên tắc chung cho mọi lát:
- Công tắc theo từng chủ shop, **mặc định TẮT**, nằm trong database RIÊNG của phần video. Shop không bật thì không thấy gì đổi.
- **Database chính không có migration nào** từ lát 0 tới lát 6. Chỗ duy nhất chạm hệ thống chính: một đường ĐỌC trạng thái đơn theo lô (lát 3).
- Tệp video đi thẳng trình duyệt → R2. Không tệp nào đi qua máy chủ Hubsell.
- Luồng khách là MỘT việc: quét mã. Không nút quay, không nút dừng, không nút tải lên.

### 17.1 Bảng các lát

| Lát | Khách thấy gì | Phạm vi | Đụng tệp / bảng | Migration DB chính | Phụ thuộc | Độ lớn |
|---|---|---|---|---|---|---|
| **0. Đo / thử** | không gì | trang thử chạy ở máy, ngoài sản phẩm; bucket R2 miễn phí | một trang HTML thử trong `tools/` (không vào `frontend/`) | không | anh tạo tài khoản R2 + có webcam, máy quét | nhỏ |
| **1. Quay + tải lên** (a) | ở màn Quét đóng gói: quét mã là tự quay, quét mã kế là tự cắt; đèn "đang quay / đã lưu / đang chờ mạng" | web máy tính + dịch vụ video + R2 | `frontend/…/orders/packing/`, `scan-code-box.tsx` (chỉ thêm, không đổi hành vi cũ); mới: dịch vụ video, bảng `pack_settings`, `pack_videos` (chỉ thêm dòng) | không | lát 0 | lớn |
| **2. Sổ + tìm video** (b) | nút "Xem video" ở dòng đơn; trang Video: gõ / quét mã vận đơn ra video trong vài giây; tải về; link xem có hạn | web + dịch vụ video | bảng Đơn hàng (thêm một nút), trang mới; chỉ mục của `pack_videos`, `pack_video_events` | không | lát 1 | vừa |
| **3. Vòng đời xóa** (c) | dòng "tự xóa ngày …" cạnh mỗi video; video của đơn có hoàn ghi "đang giữ" | dịch vụ video + backend chính (một đường đọc) | mới: `GET` nội bộ trạng thái đơn theo lô ≤ 500 mã; việc dọn theo cột hạn xóa; luật tự hết hạn 95 ngày trên R2 | không | lát 1 | vừa |
| **4. Đo dùng + tính tiền** (d) | shop thấy tháng này quay bao nhiêu video, phí bao nhiêu; HQ thấy từng shop | dịch vụ video + HQ + phần gói | `pack_usage_daily`; trang HQ; nối vào hóa đơn gói | **tùy cách thu** — xem quyết định Q4 | lát 1, 3 | vừa |
| **5. Quay khui kiện hoàn** (e) | ở Đối soát đơn hoàn: quét kiện là tự quay, quay xong mới cho bấm nhận | web + dịch vụ video | màn quét hàng hoàn (`scan-return-box.tsx`), thêm loại "khui" vào `pack_videos` | không | lát 1, 2 | vừa |
| **6a. Web trên điện thoại** (f) | điện thoại trên giá: camera tự nhận mã, tự quay, không cần máy quét | web (Android trước) | màn Quét đóng gói bản điện thoại | không | lát 1; kết quả đo Android ở lát 0 | vừa |
| **6b. App mobile** (f) | như 6a trong app | `hubsell-mobile` | màn quét của app; có thể thêm thư viện camera gốc | không | 6a; **phải build nộp kho** | lớn |
| **7. Cổng sau: nộp sàn** (g) | đơn có yêu cầu hoàn → hồ sơ soạn sẵn (ảnh cắt + lời) → bấm Gửi | backend chính + web | `returns-sync` (lưu hạn trả lời), lệnh ghi lên 3 sàn | **có** (hạn trả lời) | lát 2, 5; lát 0 của phần 1 (mục 5) | lớn |

### 17.2 Từng lát

**Lát 0 — Đo / thử.** Mục tiêu: thay mọi chữ "ước" bằng số, trước khi dựng gì lớn.
- Việc: một trang thử chạy ở máy (không thuộc sản phẩm, không deploy) quay bằng HAI cách (trình ghi sẵn và WebCodecs + Mediabunny) ở ba
  bậc A / B / C; tải thẳng lên bucket R2 miễn phí bằng đường dẫn ký sẵn.
- Đo: (1) dung lượng + thời lượng thật của 30–50 kiện; (2) nhìn lại có đọc được số vận đơn, nhận ra món hàng; (3) tệp có thời lượng,
  tua được trên Windows / điện thoại; (4) webcam có giữ 10 khung/giây; (5) thu nhỏ cửa sổ / đổi tab: còn quay không, máy quét bàn phím
  và cổng COM còn nhận mã không; (6) tải 50 tệp qua cáp quang và 4G: thời gian, tỷ lệ hỏng; (7) R2 có nhận mã băm sha256, `HeadObject`
  có trả đúng cỡ; (8) đo vạch mã trên một vận đơn in thật của mỗi sàn; (9) điện thoại Android: quay + bộ đọc mã sẵn cùng lúc được không;
  (10) hai webcam trên một máy.
- Xong khi: có bảng số thay mục 11.1, 11.3 và cột "chưa kiểm" ở 16.8; chốt được đường quay (WebCodecs hay trình ghi sẵn) và bậc mặc định.
- Rủi ro: thấp. Không chạm prod, không chạm sản phẩm. Bucket thử xóa sau khi đo.
- Anh làm: tạo tài khoản Cloudflare + bật R2 (tên công ty — xem ghi chú mục 15); một webcam lấy nét tự động + một máy quét 2D; chọn
  kho để quay (kho của anh hoặc một shop thân). Khóa R2 anh tự dán vào tệp cấu hình ở máy, em không nhập.

**Lát 1 — Quay + tải lên.** Mục tiêu: shop bật công tắc thì mỗi kiện quét ở màn Quét đóng gói có một video nằm trên R2.
- Luật clip: quét mã A → quay A; quét mã B → đóng A, mở B; quá N giây không có mã mới → tự đóng (N lấy từ số đo lát 0). Đơn bị chặn
  (đã hủy…) vẫn quay — đó là bằng chứng kiện bị bỏ lại.
- Rớt mạng: tệp nằm hàng chờ trong trình duyệt, tự tải lại; **không khóa ô quét trong lúc tải** (bài học Kiểm kê 09/11).
- Dịch vụ video: cấp đường dẫn ký sẵn (kiểm quyền shop + công tắc), ghi một dòng `pack_videos` khi `HeadObject` xác nhận, quá cỡ thì xóa.
- Kiểm local: quay 20 kiện với đơn seed, rút mạng giữa chừng, hai tab cùng quét; đơn hủy; shop tắt công tắc không thấy gì. Kiểm prod:
  bật cho tài khoản công ty, quay 10 kiện thật, soi tệp trên R2.
- Rủi ro: (1) quay làm chậm thao tác quét — phải đo độ trễ từ lúc quét tới lúc ô sẵn sàng; (2) máy yếu rớt khung; (3) quyền camera bị
  trình duyệt hỏi lại.
- Anh làm: chốt Q1, Q2, Q3 bên dưới.

**Lát 2 — Sổ + tìm video.** Mục tiêu: có yêu cầu hoàn thì tìm ra đúng video trong vài giây (hạn trả lời của sàn chỉ 1–2 ngày).
- Xem video bằng đường dẫn ký sẵn hạn ngắn; mọi lượt xem / tải ghi `pack_video_events`. Link chia sẻ cho người ngoài: có hạn, đếm lượt.
- Kiểm: tìm theo mã vận đơn, mã đơn; nhân viên bị giới hạn gian không thấy video gian khác; đơn có 2 video (quay lại) hiện cả hai.
- Rủi ro: lộ video qua link chia sẻ → hạn mặc định ngắn, shop tự thu hồi được.

**Lát 3 — Vòng đời xóa.** Mục tiêu: kho không phình, shop biết video nào còn tới ngày nào.
- Backend chính thêm MỘT đường đọc: nhận ≤ 500 mã đơn của một chủ shop, trả trạng thái giao / mốc giao / dấu hiệu hoàn. Đọc theo khóa
  chính, không quét bảng, không gọi sàn, không ghi.
- Việc dọn: lấy dòng tới hạn → xóa tệp → đánh dấu; theo lô nhỏ, có giới hạn nhịp. Lưới an toàn 95 ngày trên R2.
- Chạy bóng trước: tuần đầu chỉ GHI "sẽ xóa", không xóa thật; soát danh sách rồi mới bật (đúng cách làm hạ tầng đã chốt).
- Kiểm: test cho từng luật L1–L7 bằng đơn seed ở mọi trạng thái; trên prod soát danh sách chạy bóng với đơn có hoàn thật.
- Rủi ro: **xóa nhầm video của đơn có hoàn** là lỗi không sửa lại được → vì vậy mới chạy bóng, và mọi dấu hiệu hoàn đều chặn xóa.
- Anh làm: chốt Q5.

**Lát 4 — Đo dùng + tính tiền.** Mục tiêu: thu được tiền, shop thấy trước mình trả bao nhiêu.
- `pack_usage_daily` gộp mỗi đêm; trang cho shop + trang HQ. Cách nối vào hóa đơn tùy Q4.
- Rủi ro: thu riêng kéo theo cổng thanh toán + kỳ gói phụ (điều anh từng tránh ở vận đơn đã in 06/11) → em đề xuất tính như **phí vượt**:
  cộng thẳng vào hóa đơn gói, cùng cơ chế đã chạy từ 11/11.
- Lát này có thể làm SAU lát 5 nếu anh muốn cho vài shop dùng thử miễn phí trước.

**Lát 5 — Quay khui kiện hoàn.** Mục tiêu: bằng chứng khách trả sai / thiếu / đã dùng.
- Ở màn quét hàng hoàn: quét kiện → quay → nhắc "quay đủ 6 mặt kiện trước khi mở" → quay xong mới hiện nút nhận.
- Video khui luôn ở trạng thái "đang giữ" (đơn này chắc chắn có hoàn).
- Rủi ro: thêm một bước cho kho ở luồng đang chạy ổn → chỉ hiện với shop đã bật, và có nút Bỏ qua (cảnh báo, không khóa cứng).

**Lát 6a / 6b — Điện thoại.** 6a là web trên Android (camera tự nhận mã) — chỉ làm nếu lát 0 cho thấy quay + đọc mã cùng lúc chạy được.
iPhone: Safari không có bộ đọc mã sẵn → phải nhúng thư viện đọc mã, để sau. 6b là app: nếu expo-camera không quay + quét cùng lúc được
thì phải thêm thư viện camera gốc → build nộp kho, không vá OTA; **không nâng Expo**.

**Lát 7 — Cổng sau: nộp sàn.** Giữ nguyên hướng phần 1 (mục 5), với một điều chỉnh: bằng chứng qua API ở Shopee và TikTok là ẢNH.
Để không bị chặn đường về sau, các lát trước chỉ cần giữ ba thứ: clip nguyên đoạn không chỉnh sửa, mã vận đơn + giờ quay nằm trong
sổ, và cắt được ảnh JPG từ video khi cần.

### 17.3 Quyết định chờ anh (kèm đề xuất của em)

| # | Chốt trước lát | Câu hỏi | Em đề xuất | Vì sao |
|---|---|---|---|---|
| Q0 | 0 | Có làm lát 0 không, đo ở kho nào | **Làm.** Kho nào anh ra vào dễ nhất | 13 điểm ở 16.8 không tra tài liệu ra được; dựng lát 1 trên số ước là dựng trên cát |
| Q1 | 1 | Dịch vụ video chạy ở đâu | **Database riêng là bắt buộc.** Phần mã: một dịch vụ nhỏ riêng trên Render, cùng repo | đúng ý anh "không động hệ thống chính"; phần video sập không kéo theo đơn hàng. Tốn thêm khoảng 7 USD/tháng (giá em nhớ, chưa đọc lại bảng giá Render hôm nay) |
| Q2 | 1 | Chất lượng mặc định | Bậc A (1080p, 10 khung/giây), **chốt lại sau lát 0** | 720p rẻ hơn 0,6 đ/video nhưng rủi ro không đọc được nhãn — tiết kiệm không đáng |
| Q3 | 1 | Máy quét: bàn phím hay cổng COM | Lát 1 chỉ bàn phím (đang có sẵn); cổng COM thêm sau nếu lát 0 cho thấy mất tiêu điểm là vấn đề thật | bớt phạm vi lát đầu |
| Q4 | 4 | Cách thu phí | **Theo video, cộng vào hóa đơn gói như phí vượt** | khớp giá vốn; không cần cổng thanh toán riêng. Lưu ý: Ship Xanh cho miễn phí — mình bán được là nhờ giữ video theo trạng thái đơn (phủ ca 45–60 ngày) và nằm chung chỗ với đơn, không phải nhờ "có quay video" |
| Q5 | 3 | Cách xóa | **Theo trạng thái đơn**, biên 5 ngày (giao + 20), trần 90 ngày | ba tháng số liệu đều cho thấy xóa lúc đối soát là mất bằng chứng ở 1/5 tới 1/2 số ca; chênh chi phí chỉ khoảng 30.000–40.000 đ/shop/tháng |
| Q6 | 3 | Bỏ ngăn `hold/`, dùng một tiền tố | **Bỏ** | mục 16.1 |
| Q7 | 5 | Thứ tự lát 4 và 5 | 5 trước 4 nếu cho dùng thử miễn phí; 4 trước 5 nếu thu tiền ngay | tùy anh muốn có doanh thu sớm hay có bộ tính năng ngang Ship Xanh sớm |

**Phản biện một điểm anh đang nghiêng:** R2 "cho rẻ" là đúng về tiền, và lần hai không tìm ra lý do kỹ thuật nào để bỏ. Nhưng rẻ hơn
kho trong nước chỉ khoảng 0,4 đ/video; cái giá thật của R2 là giấy tờ: không có vùng châu Á, không cam kết nước lưu, kéo theo thuế nhà
thầu và hồ sơ chuyển dữ liệu ra nước ngoài. Anh đã chốt R2 thì em làm R2 hết mình; em chỉ đề nghị mã viết qua một lớp "kho" để đổi nhà
cung cấp không phải viết lại.

**Chưa làm trong phiên này:** không viết mã, không tạo tài khoản R2, không gọi lệnh ghi nào lên prod hay lên sàn. Hai câu SQL là SELECT.

## 19. Hai video TikTok anh gửi 14/11 ("Thử xem học được gì không em")

> Em xem bằng cách cắt khung hình + chép lời thoại tại máy. Chỉ ghi điều THẤY trong video; chưa vào trang, chưa dùng thử sản phẩm nào.

**Video 1 (23 giây) — bản demo của donghangnhanh.vn** (tên trên áo; sản phẩm tên Dohana — lần một có nhắc tên ở mục 9 nhưng chưa
khảo sát; chi tiết ở mục 20). Trả lời câu khách hỏi
"chỉ có 1 cam thôi thì có cần máy quét không?":
- Bộ đồ: laptop Windows chạy web trong trình duyệt + MỘT webcam trên tay kẹp cao khoảng nửa mét trên bàn. Có máy quét nằm trên bàn nhưng không dùng.
- Nhân viên **giơ tem vận đơn lên gần webcam** → phần mềm đọc mã, **nói "Bắt đầu"** → gói hàng → giơ tem đơn kế → "kết thúc đơn cũ và
  bắt đầu đơn mới luôn". Không chạm máy tính.
- Màn hình: tiêu đề "Tạo video Đóng hàng"; trạng thái "Quét mã đơn để bắt đầu ghi hình" / "Đang ghi lại video"; ô "Nhập mã đơn tại đây"
  (gõ tay khi không đọc được); mục Chọn Camera ghi "DHN Wide 1080p" (webcam mang tên họ → họ bán kèm thiết bị); ghi chú "nên quay dưới 5 phút".
- **Chữ in thẳng vào hình lúc quay:** một đường link xem video (`dhn.io.vn/tracking/…`), dòng "Tracking Code: SPXVN…", giờ quay ở góc dưới.

**Video 2 (34 giây) — một chủ shop mỹ phẩm kể chuyện:**
- Lời: "Từ hồi gắn cái cam này tôi mới biết… nhận đủ hàng rồi mà cứ nói thiếu món này món kia, toàn những món mắc tiền nhất trong đơn."
  Đơn 800–900 nghìn, 10 món, khách lấy hết hàng ra, dán lại, quay video khui hàng nói shop giao giấy lộn; "check cam lại mới thấy mình giao đủ".
  "Cam này sẽ quét mã vận đơn… bấm mã vận đơn lên là nó hiện video quay đơn hàng đó."
- Hình: **gói hàng ngồi dưới sàn**, không bàn, không máy tính, không máy quét trong khung hình. Một camera kiểu an ninh màu trắng gắn trên
  chân đứng, chĩa xuống khoảng 1 m. Tem vận đơn đặt trên sàn cạnh hộp. Không thấy phần mềm nào nên em không biết họ dùng sản phẩm gì.

**Học được gì:**

| # | Điều thấy | Hệ quả cho phương án |
|---|---|---|
| 1 | Trên máy tính Windows, webcam 1080p ĐỌC được mã khi giơ tem lên gần. Khớp phép tính lần một (phải giơ sát), nhưng lần một kết luận "máy tính thì dùng máy quét" là **quá chặt** | "Không cần máy quét" là câu khách hỏi và là điểm bán của đối thủ. Thêm vào lát 0: thử thư viện đọc mã miễn phí trên khung hình webcam khi giơ tem. Nếu đạt, lát 1 nhận cả hai cách (máy quét HOẶC giơ tem); Q3 sửa theo |
| 2 | Tiếng nói "Bắt đầu" để nhân viên không phải nhìn màn hình | Lát 1: phát tiếng lúc bắt đầu / chuyển đơn / lỗi (đã có `lib/beep.ts`) |
| 3 | Mã vận đơn + giờ quay in vào hình ngay lúc quay | Khớp yêu cầu "không chỉnh sửa" của TikTok (mục 14.3). Đường WebCodecs vẽ chữ lên khung trước khi nén được — thêm vào lát 0 để đo có làm tụt số khung hình không |
| 4 | Có link xem video cho người ngoài, in luôn trong hình | Lát 2 đã có link chia sẻ; cân nhắc in mã ngắn vào hình thay vì cả đường link |
| 5 | Có ô gõ mã tay + trần 5 phút một clip | Lát 1: giữ ô nhập tay; trần 5 phút là một mốc tham khảo cho "N giây tự đóng" |
| 6 | Shop nhỏ gói dưới sàn, không có máy tính ở chỗ gói | Bộ "máy tính + webcam + máy quét" không vừa với nhóm này. **Điện thoại trên chân đứng (lát 6a) nên kéo lên sớm hơn**, ngay sau lát 2 — đề xuất, chờ anh |
| 7 | Nỗi đau khách tự nói ra: khách báo thiếu đúng món đắt nhất; "bấm mã vận đơn là ra video" | Xác nhận lát 2 (tìm trong vài giây) là thứ khách cảm nhận được. Dùng lại làm ý kịch bản video sau này (nỗi đau → nhẹ nhõm) |

**Không rút ra được từ hai video:** thời lượng gói một kiện thật (video 1 là diễn, video 2 bị cắt cảnh), giá và giới hạn của
donghangnhanh.vn, camera trong video 2 đọc mã bằng cách nào.

## 18. Nguồn (phần 3)

R2: https://developers.cloudflare.com/r2/pricing/ · /r2/api/s3/presigned-urls/ · /r2/buckets/cors/ · /r2/platform/limits/ ·
/r2/buckets/object-lifecycles/ · /r2/reference/data-location/ · /r2/reference/durability/ · /r2/buckets/event-notifications/ ·
https://www.cloudflare.com/service-specific-terms-developer-platform/
Quay: https://chromestatus.com/feature/5163469011943424 · https://chromestatus.com/feature/5117302963437568 ·
https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/MediaRecorder · https://blog.addpipe.com/duration-in-mp4-files-produced-by-chrome-safari/ ·
https://mediabunny.dev/guide/output-formats · https://github.com/Vanilagy/mediabunny · https://developer.chrome.com/docs/capabilities/hid ·
https://developer.chrome.com/docs/capabilities/serial · https://developer.chrome.com/docs/capabilities/shape-detection ·
https://docs.expo.dev/versions/latest/sdk/camera/ · https://visioncamera.margelo.com/docs/guides/code-scanning
Sàn: https://open.shopee.com/documents/v2/v2.returns.upload_proof?module=102&type=1 · https://help.shopee.sg/portal/4/article/76632
Ship Xanh: https://shipxanh.com/tdcpt_case_studies/quay-video-dong-goi-khui-hang/ · https://shipxanh.com/bang-gia/ ·
https://shipxanh.com/tinh-nang/ · https://shipxanh.com/?p=14427 · https://apps.apple.com/app/id6475646185


---

# PHẦN 4 — Đối thủ mở rộng (Việt Nam, Trung Quốc, quốc tế) + gói mở rộng + thiết bị sơ bộ (14/11/2026 đêm)

> Anh Trung 14/11: "anh nghĩ nên mở rộng kiểm tra và tìm kiếm thông tin của nhiều đối thủ khác, thậm chí là cả các nhà cung cấp từ nước
> ngoài như Trung Quốc, nơi hàng đầu về mảng logistic này. Anh muốn khách dùng Hubsell sẽ mua được gói mở rộng để mua gói video đóng hàng
> này. Sau này mình cần khảo sát để bán thiết bị như camera nữa."
> Cách làm: 4 luồng tra web song song, chỉ đọc trang công khai, không tạo tài khoản, không dùng thử. Mức chắc: **[tự mở]** = em tự mở
> trang bằng trình duyệt và đọc; **[tra]** = luồng tra đọc trên trang qua công cụ tóm tắt, em chưa đối chiếu từng chữ; **[phụ]** = nguồn
> bên thứ ba / đoạn trích tìm kiếm; **[chưa]** = không tìm thấy hoặc không mở được. Số khách hàng các hãng đều là tự công bố.

## 20. Việt Nam — đông hơn lần một tưởng

### 20.1 Dohana (donghangnhanh.vn, web app dhn.io.vn) — đối thủ trong video anh gửi

Bảng giá **[tự mở]** donghangnhanh.vn/vi, giá đã gồm VAT, trả 6 tháng −8 %, 12 tháng −12 %:

| Gói | Giá | Dung lượng | Tài khoản | Lưu online | Gian sàn | Ghi chú |
|---|---|---|---|---|---|---|
| Miễn phí | 0 đ, thử 5 ngày | 500 MB trong 5 ngày đầu | 1 | 20 ngày | — | chỉ app điện thoại; 5.000 video/tháng lưu trên máy |
| Cơ bản | 100.000 đ/tháng | 40 GB | 2 | 25 ngày, tự xóa | 2 | app + web |
| Tiết kiệm | 279.000 đ/tháng | 120 GB | 10 | 25 ngày, tự xóa | 3 | app + web |
| Cao cấp | 400.000 đ/tháng | 200 GB | 20 | chỉnh 15–35 ngày | 5 | tặng 2 giấy phép bản máy tính |
| Khởi đầu | 800.000 đ / vị trí / 12 tháng | lưu trên máy tính | theo vị trí | online 20 ngày; máy tối đa 90 ngày | — | bản máy tính |

- Tự công bố "2.000+ cửa hàng, 40M+ video" **[tự mở]**. Có điểm trải nghiệm ở Hà Nội và TP.HCM.
- Tính năng **[tự mở]**: 2 camera cùng lúc (toàn cảnh + soi mã); đồng bộ đơn Shopee + TikTok, **hiện danh sách sản phẩm của đơn ngay trên
  màn đóng gói**; cảnh báo đơn hủy lúc đóng; quay khui hàng hoàn + xác nhận nhập hàng hoàn; lưu bằng chứng bàn giao cho hãng vận chuyển;
  báo cáo năng suất từng nhân viên; "Genlink" tự ghép video và lấy link.
- Có bán camera, chân, máy quét nhưng không niêm yết giá; bán qua đại lý một combo 1 camera + phần mềm 60 GB một tháng giá 1.333.000 đ **[tra]**.
- Dung lượng thật của họ: mẫu trong tài liệu API là video 7 giây = 1,77 MB, tức khoảng **15 MB/phút** **[tra]** — gấp 2,5 lần mức 6 MB/phút
  em ước cho Hubsell. Đây là số thật đầu tiên có được về cỡ tệp của một sản phẩm đang bán.
- Quy ra giá mỗi video (em tự tính, clip 45 giây ≈ 11 MB theo cỡ tệp của họ, lưu 25 ngày): gói 100.000 đ chứa được khoảng 4.400
  video/tháng ≈ **23 đ/video**; gói 400.000 đ khoảng 22.000 video/tháng ≈ **18 đ/video**.
- Chưa biết: link xem có công khai / có hết hạn không; đầy dung lượng thì dừng quay hay xóa bản cũ; có nhận camera an ninh không.

### 20.2 Các hãng Việt Nam khác chưa có ở lần một **[tra]**

| Hãng | Bắt đầu quay bằng | Lưu | Cách tính tiền + giá | Điểm đáng chú ý |
|---|---|---|---|---|
| **Ecombox Tracking** (ecombox.vn) | quét QR / mã vạch | cloud 20–30 ngày | theo GB, theo NĂM, người dùng không giới hạn: 1,8 tr (50 GB) · 3 tr (100 GB) · 5,4 tr (250 GB) · 9 tr (500 GB) · 15 tr (1 TB) | là một sản phẩm trong bộ Omni / WMS của họ — mô hình gần mình nhất; tự nhận có AI phát hiện thiếu hàng |
| **EPack** (epack.vn) | camera đọc QR, chạy trình duyệt | cloud, tự xóa sau 30 ngày | theo dung lượng (không đọc được số); combo 2 camera + 2 giá đỡ 1.800.000 đ | đóng dấu mã đơn + giờ lên từng khung hình; link xem có hạn |
| **Carrot Packing** | điện thoại quét; ghi kèm camera an ninh | Google Drive CỦA SHOP hoặc cloud 1 TB | phí app 550.000 – 1.250.000 đ/năm; cloud 1 TB 280.000 đ/tháng | tách đơn đi / hàng hoàn; tính lương khoán theo số kiện đóng |
| **EcomPMS** | quét mã | máy khách | thuê không giới hạn video: 300.000 đ/tháng · 3 tr/năm | bán kèm camera |
| **Simple Replay** (ATP Software) | điện thoại nhận QR | cloud 30 ngày | **theo số video**: 1.500 video 600.000 đ · 4.500 video 1,5 tr · 9.000 video 2,7 tr (≈ 300–400 đ/video) | 3 loại video: đóng hàng / giao hãng vận chuyển / đồng kiểm hàng trả; in QR dán lên gói để khách xem |
| **VieCam / PackCam** (Việt POS) | camera đọc mã | cloud | bản quyền 4–6 tr/năm + phần cứng | tự nhận đếm số món cho vào đơn, chính xác 90–95 % |
| **An Thành Phát** (thợ lắp camera) | đầu đọc mã vạch | máy khách / máy chủ họ | phần mềm 500.000 đ mua đứt, bản online +1 tr/năm; trọn bộ 4,65–5,65 tr | kênh bán = thợ lắp camera |
| ASCAM (cập nhật) | — | — | thêm bảng **ASC-Cloud bán riêng theo GB**: 100 GB 150.000 đ (60 ngày) · 300 GB 300.000 đ (90 ngày) · 500 GB 450.000 đ (180 ngày) · 1 TB 800.000 đ (365 ngày) | số ngày lưu tăng theo bậc |

### 20.3 Các phần mềm bán hàng đa kênh lớn — chưa ai tự làm **[tra]**

| Phần mềm | Có quay video đóng hàng không |
|---|---|
| Sapo | Không tự làm. Có app bên thứ ba Effitrack trên kho ứng dụng Sapo |
| Pancake POS, KiotViet, Haravan | Không tự làm. Cam Check cắm vào bằng API |
| Nhanh.vn | Không thấy (màn đóng gói chỉ quét mã) |
| UpBase | Bảng tính năng có dòng "tùy chọn quay video lúc đóng gói", không rõ gói và giá |
| Salework, TPos, Abit, Atosa | Không tìm thấy — chưa đọc hết trang tính năng nên "không thấy" chưa phải "không có" |
| Ship Xanh, BigSeller, UpSeller | Có (đã biết) |

**Đọc bảng:** ở Việt Nam, video đóng hàng chủ yếu là sản phẩm ĐỨNG RIÊNG, và các hãng lớn để bên thứ ba cắm vào. Một phần mềm đa sàn có
sẵn video gắn thẳng vào đơn mới chỉ có Ship Xanh (miễn phí) và hai hãng gốc Trung Quốc. Đây là khoảng trống thật cho "gói mở rộng".

**Lần một thiếu:** em ghi "không ai ở Việt Nam tính theo đơn" — sai một phần: Simple Replay tính theo số video. Và khung giá
"50.000–370.000 đ/tháng" phải nới thành khoảng 100.000 đ/tháng tới 15 triệu/năm.

## 21. Trung Quốc

### 21.1 Sàn đòi gì — Douyin viết rõ nhất

Bản lấy ý kiến sửa "Tiêu chuẩn chứng cứ khiếu nại của người bán" của Douyin **[tự mở]** (school.jinritemai.com; là bản lấy ý kiến,
chưa chắc là bản hiệu lực):
- Khách báo gửi sai / gửi sót / hộp rỗng → người bán chọn một trong các chứng cứ, trong đó có **video đóng hàng**: phải thấy "toàn bộ quá
  trình cho hàng vào hộp, dán kín hộp và dán tem vận đơn", thấy rõ hàng, thấy rõ mã vận đơn.
- Hàng hoàn có vấn đề → **video khui hàng hoàn**: "đầy đủ, không cắt ghép; lúc mở và kiểm, kiện không được rời khung hình"; quay bù sau
  khi đã mở, **quay thành nhiều đoạn**, không quay trọn kiện đều bị coi là chứng cứ vô hiệu.
- Có nhận **chứng cứ cân nặng** (cân lúc gửi khớp cân của hãng vận chuyển).
- Không quy định độ dài, định dạng, dung lượng.

Taobao / Tmall, Pinduoduo, JD: không tìm được văn bản chính thức **[chưa]**.

**Hệ quả cho mình:** cùng hướng với TikTok Shop Việt Nam (mục 14.3). Clip phải là MỘT đoạn liền từ lúc quét tới khi dán tem xong —
đúng luật "mã kế mới cắt" mình đã chọn. Kiểu "cắt vài giây quanh lúc quét" từ đầu ghi camera an ninh không đạt.

### 21.2 Bốn kiểu làm ở Trung Quốc **[tra]**

| Kiểu | Ai làm | Phục vụ ai | Nhà cung cấp gánh lưu trữ? |
|---|---|---|---|
| 1. App điện thoại / phần mềm máy tính + webcam, mỗi đơn một tệp, lưu TẠI CHỖ | PutPack, 码上录, 慧录云, EC (MFEC), 京速证, PackingProof (mã nguồn mở) | shop nhỏ, 1–5 bàn | không — lưu máy khách, NAS, hoặc ổ mây của chính khách |
| 2. Phần mềm quản lý đơn gọi webcam ngay trong màn quét, mỗi đơn một tệp, tải lên mây | UpSeller, TOPWMS, 旺店通, 万里牛 | shop vừa đã dùng phần mềm quản lý đơn | có — số ngày lưu theo bậc gói |
| 3. Camera an ninh + đầu ghi quay liên tục, phần mềm chỉ lưu mốc quét rồi cắt đoạn | 聚水潭, 吉客云, 云事通 | kho vừa và lớn đã có camera | không |
| 4. Thiết bị chuyên dụng của hãng camera | Hikvision (máy chủ + camera 4K + máy cầm tay), TP-LINK (camera tự đọc tem, đầu ghi lưu 100.000 bản ghi) | kho thuê ngoài, hàng chục nghìn kiện/ngày | không |

Hubsell đang đi kiểu 2. Hai sản phẩm cùng kiểu đáng soi nhất:
- **UpSeller** **[tự mở]** trang hướng dẫn: quay là một tùy chọn của màn quét giao hàng; mỗi đơn đúng một video; lưu máy, mây hoặc cả
  hai; **số ngày lưu trên mây theo bậc gói**; xem video ngay trong chi tiết đơn; quay lỗi KHÔNG chặn việc quét giao hàng. Luồng tra còn
  đọc được: có thời lượng tối thiểu (chưa đủ thì chưa cho quét đơn kế) và tối đa (tự dừng), mặc định 720p **[tra]**.
- **TOPWMS** **[tra]**: chạy trình duyệt, quét đơn A là quay, quét hàng của đơn B mới dừng A; 10 phút không thao tác tự dừng; mỗi nhà
  cung cấp 500 MB miễn phí rồi mua thêm; lỗi thường gặp họ tự ghi: **quét đơn kế quá sớm làm video trước bị cụt**.

### 21.3 Giá thấy được ở Trung Quốc **[tra]** (1 tệ ≈ 3.935 đ, tỷ giá 23/10 từ nguồn phụ)

- PutPack (app): miễn phí 50 video/ngày; trả tiền 12 tệ/tháng · 88 tệ/năm · 198 tệ trọn đời (≈ 47.000 / 346.000 / 779.000 đ). Video lưu ở máy khách.
- 码上录: miễn phí 20 đơn/ngày.
- Phần mềm EC: bán theo máy tính, mã kích hoạt phát qua NGƯỜI BÁN CAMERA — phần mềm đi theo kênh bán thiết bị.
- Bộ thiết bị bán lẻ trên JD: Hikvision "bộ đóng hàng thương mại điện tử 4K + máy quét không dây" 579 tệ (≈ 2,28 tr); 汇博士 2 camera
  679 tệ; 驿七 Q1 2 camera có chân, không cần máy quét 1.089 tệ; inboz 500–2.800 tệ.
- Các phần mềm quản lý đơn lớn (聚水潭, 旺店通, 万里牛, 吉客云): không công bố giá; 万里牛 chỉ mở tính năng ở hai bậc gói cao.

**Nhận xét:** ở Trung Quốc phần mềm gần như cho không, tiền nằm ở thiết bị và ở gói phần mềm quản lý đơn. Không thấy ai bán lưu trữ
video trên mây thành món chính. Ngược với Việt Nam, nơi tiền nằm ở GB lưu trữ.

## 22. Quốc tế

### 22.1 Giá quy ra mỗi video **[tra]**, tỷ giá một nguồn ngày 11/11, giả định 1 đơn = 1 video

| Sản phẩm · nước | Cách tính | ≈ đồng / video |
|---|---|---|
| Dobybot · Thái | mua trước 16.000 / 40.000 / 100.000 lượt, hạn 24 tháng | 457 / 381 / 304 |
| Dobybot kèm gửi tin cho khách | như trên | 913 / 761 / 685 |
| DispatchO · Ấn Độ | bậc 300 → 15.000 đơn, có phí vượt | 453 → 145; phí vượt 545 → 136 |
| TrackVid · Ấn Độ | mua trước, chọn số ngày lưu lúc mua | từ 272 |
| PackFlow · Malaysia | bậc theo đơn + giờ video + số bàn | 384 / 189 / 110 |
| PackRight · Ấn Độ | bậc theo lượt, đầy thì xoay vòng | ≈ 165 |
| Boxwitness · Canada | bậc theo hộp | 1.946 / 502 / 330 |
| Realpacking · Hàn | 50.000 won / giấy phép / tháng, trần 15 GB | ≈ 184–637 |
| Rabot · Mỹ | 149 USD / bàn / tháng, tối thiểu 10 bàn | ≈ 733 |
| **So sánh trong nước** | Simple Replay 300–400 · Dohana ≈ 18–23 (em tự quy từ GB) | |

Mặt bằng công cụ cho shop ở Đông Nam Á và Ấn Độ: **150–450 đ/video**. Việt Nam bán theo GB nên quy ra rẻ hơn hẳn, khoảng vài chục đồng.

### 22.2 Bảy kiểu đóng gói **[tra]**

| Kiểu | Ví dụ | Khách phải hiểu gì trước | Khi vượt |
|---|---|---|---|
| A. Có sẵn trong gói gốc | Unicommerce (cả 3 gói), Eshopbox | không gì | không có khái niệm vượt |
| B. Module bật thêm, giá riêng | EasyEcom EasyVMS, Logiwa | dùng hay không | giới hạn bằng số ngày lưu |
| C. Theo bàn / giấy phép | Rabot, Realpacking | số bàn | mua thêm thời hạn lưu |
| **D. Bậc có hạn mức video + phí vượt tự tính** | DispatchO, VuDrop | số đơn/tháng | không dừng, tính tiền từng video vượt |
| E. Mua trước lượt, hạn dài | Dobybot, TrackVid, UpSeller (gói nạp nhỏ mua trong app) | số video định mua | hết thì nạp thêm |
| F. Trần cứng | PackRight (đầy thì bản cũ bị thay) | số đơn | xoay vòng hoặc lên bậc |
| G. Thời hạn lưu là trục bán thêm | Boxwitness 90 → 180 → 365, ASC-Cloud 60 → 365, Rabot +60 / +90 | cần giữ bao lâu | hết hạn là xóa |

Gần hết chỉ bắt khách hiểu MỘT con số: số video. GB chỉ thấy ở Realpacking và ở Việt Nam.

## 23. Rút ra cho Hubsell

### 23.1 Mình đứng ở đâu

- Đối thủ đông và đã chín: Dohana tự nhận 2.000 shop, có cả đồng bộ đơn sàn, cảnh báo đơn hủy, khui hàng hoàn. **"Có quay video" không
  còn là điểm khác biệt.**
- Điểm mình có mà sản phẩm đứng riêng khó có: (1) khách không phải mua, cài, nối thêm một phần mềm; (2) video nằm ngay trong dòng đơn,
  cạnh Đối soát đơn hoàn và Kiểm toán phí; (3) **giữ video theo trạng thái đơn** thay vì 20–30 ngày cứng — mọi đối thủ Việt Nam đọc được
  đều xóa theo số ngày, trong khi ca khiếu nại dài nhất tới 45–60 ngày (mục 14.3); (4) màn Quét đóng gói đã chặn sẵn đơn hủy.
- Điểm mình thua lúc ra mắt: chưa có 2 camera, chưa có app, chưa có thiết bị bán kèm, chưa có điểm trải nghiệm.

### 23.2 Ý đáng chép, xếp vào lát nào

| Ý | Thấy ở | Đề xuất xếp vào |
|---|---|---|
| Hiện danh sách sản phẩm của đơn trên màn đóng gói | Dohana | lát 1 — mình có sẵn dữ liệu đơn, gần như không tốn |
| Thời lượng tối thiểu trước khi cho quét đơn kế; tự dừng khi quá lâu | UpSeller, TOPWMS, Dohana (5 phút) | lát 1 — chống video cụt |
| Quay lỗi không được chặn việc quét | UpSeller | lát 1 — nguyên tắc |
| In mã vận đơn + giờ vào hình lúc quay | Dohana, EPack, CamBox, PutPack | lát 1 (đo ở lát 0) |
| Mã băm SHA-256 từng tệp để chống cãi "video đã sửa" | PallasMark, DispatchO | lát 1 ghi mã băm, lát 2 hiện ra |
| Link xem có hạn; in QR cho khách tự xem | Simple Replay, PackCapture, Mify | lát 2 (link); QR để sau |
| Hàng hoàn: nhắc quay 6 mặt, kiện không rời khung hình, gắn nhãn tốt / hỏng | Douyin, Eshopbox, UniCapture | lát 5 |
| Video / ảnh lúc bàn giao cho hãng vận chuyển | Dohana, Simple Replay | lát mới sau lát 5 — nối vào Biên bản bàn giao đang có |
| Năng suất từng nhân viên từ số kiện đã quay | Dohana, Carrot | sau lát 2, gần như miễn phí vì sổ đã có người quay + giờ |
| 2 camera (toàn cảnh + soi tem) | Dohana, EC, Camsight, VieCam | sau lát 6a — đo ở lát 0 xem 1 camera 2K có đủ không |
| Hồ sơ khiếu nại PDF có ảnh trích | DispatchO, Boxwitness | lát 7 |
| Cân nối vào video | EC, Dobybot | để sau, chỉ ghi nhận |
| Cho khách lưu vào Google Drive / ổ của chính họ làm bậc rẻ | Carrot, CamBox, PutPack | **em không đề xuất**: mất quyền điều khiển vòng đời xóa, và mất luôn thứ mình bán |
| AI đếm món, nhận sai hàng | Rabot, VieCam, Ecombox | không làm ở giai đoạn này |

## 24. Gói mở rộng — đề xuất (anh chưa chốt)

Anh đã nói rõ: khách dùng Hubsell **mua thêm gói mở rộng** để có video đóng hàng. Tức không nằm sẵn trong gói, không bán cho người ngoài.
Đề xuất dưới đây thay cho ý "cộng vào hóa đơn như phí vượt" em nêu ở mục 17 (Q4).

### 24.1 Tính theo cái gì

| Cách | Hợp ở điểm nào | Vướng ở điểm nào |
|---|---|---|
| **A. Hạn mức video/tháng theo bậc, vượt thì tính thẳng theo đơn giá bậc** (em đề xuất) | khách chỉ cần biết MỘT con số — và đó là số đơn/tháng họ đã quen ở gói chính; khớp giá vốn; dùng lại đúng cơ chế phí vượt "tính thẳng" đã chạy từ 12/2026 | thị trường Việt Nam quen nghe GB |
| B. Theo GB như Dohana, Ecombox, ASCAM | khách so giá được ngay với đối thủ | khách phải tự đổi phút quay ra GB; clip dài bị phạt; mình nén tốt hơn thì khách lại trả ít hơn |
| C. Theo bàn đóng hàng | dễ hiểu với kho | shop lớn ít bàn trả ít trong khi tốn kho nhiều |

### 24.2 Thang giá ví dụ (số em tự đặt để thấy biên, anh chốt số thật)

| Bậc | Video / tháng | Giá / tháng | Đơn giá | Vượt | So với Dohana cho cùng lượng (em tự quy) |
|---|---|---|---|---|---|
| V1 | 1.000 | 39.000 đ | 39 đ | 39 đ/video | gói 100.000 đ |
| V2 | 3.000 | 89.000 đ | 30 đ | 30 đ/video | gói 100.000 đ |
| V3 | 10.000 | 199.000 đ | 20 đ | 20 đ/video | gói 279.000 đ |
| V4 | 30.000 (≈ 1.000 đơn/ngày) | 399.000 đ | 13 đ | 13 đ/video | gói 279.000–400.000 đ tùy cỡ tệp |

- Giá vốn lưu trữ ≈ 1,6 đ/video nếu tệp 4,5 MB (ước), ≈ 3,6 đ nếu tệp to như Dohana (11 MB). Ở cả hai trường hợp tiền lưu dưới 30 %
  giá bán của bậc rẻ nhất. **Chưa tính** chi phí cố định (dịch vụ video, database riêng), hoa hồng giới thiệu 10 %, công hỗ trợ lắp camera.
- Căn cứ đặt số: thấp hơn hoặc ngang Dohana ở mọi mức; thấp hơn nhiều so với nhóm tính theo video (300–450 đ). Không có căn cứ nào khác.
- **Thời hạn giữ không chia bậc:** một lời hứa duy nhất "giữ tới khi hết hạn khiếu nại của đơn". Đây là điểm khác đối thủ; chia bậc
  theo ngày như họ là tự bỏ điểm đó. Nếu sau này có khách đòi giữ lâu hơn 90 ngày thì vướng điều khoản Shopee (mục 12.2 L6).
- **Dùng thử:** nên có, vì Dohana cho thử (Ship Xanh KHÔNG cho không — sửa 14/11 khuya, mục 28). Ví dụ 14 ngày hoặc 300 video đầu (số em tự chọn).

### 24.3 Việc phải quyết khi làm gói mở rộng

| # | Câu hỏi | Em đề xuất | Vì sao |
|---|---|---|---|
| G1 | Tính theo video, GB hay bàn | theo video (cách A) | mục 24.1 |
| G2 | Kỳ của gói mở rộng | kỳ riêng 30 ngày tính từ ngày mua, lúc đầu chỉ bán kỳ 1 tháng | tránh bài toán khớp kỳ với gói chính — điều từng làm anh bỏ thu phí riêng ở vận đơn đã in (06/11) |
| G3 | Vượt hạn mức | không dừng quay; tính thẳng theo đơn giá bậc, thu như phí vượt của gói chính | dừng quay giữa ca là mất bằng chứng đúng lúc cần |
| G4 | Gói chính hết hạn / ngủ đông | ngừng quay; video đang có đi tiếp theo luật xóa | khớp luật ngủ đông 15/10 |
| G5 | Hết hạn gói mở rộng mà chưa gia hạn | ngừng quay sau ân hạn ngắn; video cũ vẫn xem được tới hạn xóa | khách không mất bằng chứng đã trả tiền |
| G6 | Hoa hồng giới thiệu 10 % có áp cho gói mở rộng không | anh quyết | ảnh hưởng thẳng tới biên |
| G7 | Shop mua gói chính nào mới được mua gói mở rộng | mọi gói đang trả tiền; dùng thử gói chính thì dùng thử luôn video | đơn giản |

**Hệ quả kỹ thuật (đổi mục 17):** gói mở rộng là một dòng thuê bao thứ hai → lát 4 CÓ migration ở các bảng gói của database chính
(không đụng bảng đơn), có màn mua trong `/settings/plan`, có luồng payOS và hóa đơn riêng. Câu "không migration tới lát 6" ở mục 17
không còn đúng cho lát 4. Em chưa đọc lại mã phần gói trong phiên này; phải đọc trước khi ước độ lớn — nhiều khả năng lát 4 từ "vừa"
thành "lớn".

## 25. Thiết bị — bản đồ sơ bộ (chưa chọn nhà cung cấp, chưa phải phương án bán)

### 25.1 Thị trường đang bán gì **[tra]**

| Ai | Bán gì | Giá |
|---|---|---|
| Camsight / Camzone | camera 2 ống kính (một mắt soi tem 30 × 30 cm, một mắt rộng), không cần máy quét | 1,9 tr + phần mềm 129.000 đ/tháng; bảo hành 24 tháng |
| ASCAM | 2 camera + đèn báo + chân (+ máy quét) | 4,5–6,5 tr/bàn + phần mềm 3 tr/năm; gói thấp KHÓA theo camera của họ |
| EPack | 2 camera + 2 giá đỡ | 1,8 tr |
| An Thành Phát và các thợ lắp camera | camera + giá + máy quét + cáp + phần mềm + công lắp | 2,5–5,65 tr |
| Dobybot (Thái) | bán lẻ từng món: webcam 990 baht, webcam zoom 3.500 baht, tay kẹp 350, chân sàn 750, máy quét 1.990–3.600 | không khóa thiết bị |
| Bán lẻ Trung Quốc (JD) | bộ Hikvision 4K + máy quét không dây | 579 tệ ≈ 2,28 tr |

Thị trường chia hai phe: **phần mềm thuần nhận mọi webcam USB** (Dohana, DEUS, Cam Check, Dobybot) và **bán bộ camera an ninh + khóa
phần mềm theo bậc** (ASCAM, VieCam, Camsight). Cấu hình lặp lại nhiều nhất là 2 camera mỗi bàn.

### 25.2 Ba bộ tự ghép từ hàng có sẵn ở Việt Nam **[tra]** — chưa thử món nào

| Bộ | Camera | Giá đỡ | Máy quét | Đèn | Tổng / bàn |
|---|---|---|---|---|---|
| Tiết kiệm | Hikvision DS-U02 1080p nét cố định, 449.000 đ | chân kẹp bàn 200.000 đ | SingPC 2D có dây 800.000 đ | đèn kẹp 95.000 đ | ≈ 1,5 tr |
| Tiêu chuẩn | Rapoo C280 2K lấy nét tự động, 849.000 đ | chân kẹp bàn 200.000 đ | SingPC 2D để bàn 1.350.000 đ | đèn đôi 270.000 đ | ≈ 2,7 tr |
| Cao | Logitech C920e, 1.999.000 đ | chân sàn 300.000 đ | Zebra DS9308 rảnh tay, có chế độ cổng COM, 2.695.000 đ | đèn đôi 270.000 đ | ≈ 5,3 tr |

### 25.3 Bốn điều cần biết trước khi nghĩ tới bán thiết bị

1. **Camera an ninh (IP) nhập khẩu từ 01/01/2026 phải chứng nhận hợp quy** theo QCVN 135:2024 **[tra]** (quatest3.com.vn). Webcam USB
   không thấy nằm trong phạm vi quy chuẩn này. → nếu bán, bán webcam USB dễ hơn hẳn. Không phải ý kiến pháp lý; phải hỏi đơn vị chứng nhận.
2. **In nhãn riêng cần mua 500–1.000 chiếc** (số thấy trên Alibaba **[tra]**); mua mẫu 1–10 chiếc thì dễ. Webcam 1080p lấy nét tự động
   giá xưởng khoảng 20–27 USD/chiếc; thuế nhập khẩu webcam 15 % + VAT 10 % **[tra]**.
3. **Một camera 1080p phủ cả tấm lót 50 × 35 cm khó đọc số vận đơn** (phép tính của luồng tra, khớp phép tính lần một). Đó là lý do các
   bộ chuyên dụng dùng 2 camera hoặc 2K / 4K. Khuyên thiết bị nào phải chờ số đo của lát 0.
4. **Trình duyệt không đọc thẳng camera an ninh.** Ai nhận camera an ninh đều phải có phần mềm cầu nối cài ở máy khách (Ship Xanh, Cam
   Check, Carrot). Với Hubsell đó là một nhánh sản phẩm khác, không nằm trong 8 lát.

**Đề xuất trình tự cho phần thiết bị** (chờ anh): (1) lát 0 mua 2–3 webcam khác tầm giá để đo; (2) ra mắt với trang "thiết bị khuyên
dùng" — chỉ khuyên, chưa bán; (3) có vài chục shop dùng thật mới khảo sát kỹ việc bán: nguồn hàng, bảo hành, hợp quy, tồn kho.

## 26. Chưa kiểm được trong lượt này

- Tin rao trên Shopee / Lazada / TikTok Shop / Taobao / 1688: công cụ tra không mở được. Giá sỉ thật phải hỏi xưởng.
- Giá của các phần mềm quản lý đơn Trung Quốc lớn; quy định video của Taobao, Pinduoduo, JD.
- EPack (bảng giá tải động), BoxCam (trang dựng bằng JS), PackProof và vAudit (không tìm lại được trang giá).
- Webcam "DHN Wide 1080p" của Dohana: không thấy công khai ở đâu.
- Văn bản hợp quy hiện hành cho thiết bị có Wi-Fi / Bluetooth (máy quét không dây).
- Phần lớn bảng ở phần này là **[tra]** — đọc qua công cụ tóm tắt. Em tự mở lại ba trang: bảng giá Dohana, tiêu chuẩn chứng cứ Douyin,
  hướng dẫn UpSeller. Trước khi dùng một con số để đặt giá bán, mở lại đúng trang đó.

## 27. Nguồn (phần 4)

Việt Nam: https://donghangnhanh.vn/vi · https://docs.dohana.vn/docs/video/detail-video · https://ecombox.vn/plans · https://epack.vn/ ·
https://videodonghang.io.vn · https://ecompms.com/ · https://atpsoftware.vn/simple-replay · https://vietpos.vn/he-thong-giam-sat-dong-goi-hang-hoa-2.html ·
https://ghihinh.com/bang-gia/ · https://apps.sapo.vn/effitrack · https://quayvideodongdon.com/blogs/huong-dan-ket-noi-pancake ·
https://upbase.asia/omnichannel-ecommerce-management · https://camzone.vn
Trung Quốc: https://school.jinritemai.com/doudian/web/articlev0/aJnt1AHYq6ar · https://www.upseller.com/zh-CN/help-doc-article-3392 ·
https://www.topwms.com/warehouse_help_center/article_10041.html · https://www.hrbmofei.com/ · https://app.putpack.cn/ · https://www.mashanglu.cn/ ·
https://github.com/PackingProof/PackingProof-Desktop · https://www.inboz.cn/zixun-zhongxin/article-10/ · https://www.ithome.com/0/792/574.htm ·
https://dir.jd.com/guide/jd-geo-guide-dian-shang-da-bao-fa-huo-jian-kong-she-xiang-tou-v1
Quốc tế: https://www.dobybot.com/en/pricing · https://www.realpacking.com/ko/pricing · https://help.eshopbox.com/portal/en/kb/articles/parcel-proof ·
https://help.bigseller.pro/en_US/detailPage/25/1/9312/content · https://vms.easyecom.io · https://rabot.us/pricing/ · https://apps.shopify.com/boxwitness ·
https://apps.shopify.com/pallasmark · https://apps.shopify.com/vudrop · https://upseller.com/en/pricing/ · https://www.dobybot.com/en/shop
Thiết bị + quy chuẩn: https://www.phucanh.vn/webcam-hikvision-ds-u02.html · https://www.phucanh.vn/webcam-logitech-c920e.html ·
https://tanphat.com.vn/may-quet-ma-vach-2d-de-ban.html · https://www.quatest3.com.vn/se-ap-dung-quy-chuan-ky-thuat-ve-thiet-bi-camera-giam-sat-tu-ngay-152 ·
https://extendmax.vn/thu-tuc-nhap-khau-camera-webcam


---

# PHẦN 5 — Kế hoạch từng lát bản 2: điện thoại trước, tính theo đơn, thiết kế cho 1.000 đơn/ngày (14/11/2026 khuya)

> Anh Trung 14/11: "Anh nghĩ mình tính theo số đơn là lãi nhất. Vì có nhiều đơn hàng sẽ bị hủy ngang nên thời gian lưu video của mình ngắn
> và tiết kiệm băng thông hơn. Hơn nữa họ chỉ đơn giản là lưu video chứ không làm gì khác, việc khiếu nại mọi thứ đều thủ công hết (sau
> này mình sẽ theo vài trường hợp tự động, báo cáo kết quả khiếu nại, thống kê rõ ràng hơn họ)."
> Anh đã hỏi người dùng Ship Xanh, 4 điều họ có: (1) quay bằng điện thoại — shop nhỏ rất thích vì không cần đầu tư thiết bị; (2) nối được
> camera trong nhà; (3) tự mua camera riêng được; (4) hai lựa chọn lưu: local và cloud.
> "Nhu cầu mình là bán thiết bị nhưng không cần thiết khách phải mua thiết bị của mình… mình sẽ mở một Hubsell Shop bên trong… tính sau."
> "Em cần thiết kế theo hướng này trước. Không cần nóng vội. Cái anh cần là một kế hoạch từng lát. Anh chưa có camera, chúng ta có thể
> test điện thoại nên làm trước. Giả định 1 shop 1.000 đơn/ngày thì cần có phương án thiết kế tân tiến nhất để không bị chậm, quá tải
> việc tải video lên, tải video xuống của khách hàng."
> **Phần này thay bảng lát ở mục 17 và đề xuất giá ở mục 24.** Chưa viết mã, chưa commit.

## 28. Sửa một điều sai lớn: Ship Xanh CÓ thu tiền video

Ảnh anh gửi từ một người dùng Ship Xanh (bảng giá trong app của họ):

| | Đơn vị | Mức 1 | Mức 2 | Mức 3 |
|---|---|---|---|---|
| Video local | phút | 18 đ | 19 đ | 21 đ |
| Video cloud | phút | 22 đ | 24 đ | 25 đ |

- Trừ dần vào ví nạp trước ("như dùng điện thoại"), không bán gói tháng; nạp nhiều thì đơn giá thấp hơn; nạp từ 5 triệu được tặng 50 %.
- Màn quay trên điện thoại: một nút quay, chọn CAM SAU / CAM TRƯỚC, dòng "không giới hạn dung lượng, truy xuất video bằng mã vận đơn".
- **Lưu ở máy khách vẫn thu 18–21 đ/phút** — tức họ bán phần mềm, không bán chỗ lưu.
- Trang công khai của họ ghi "miễn phí" nên cả lần một lẫn lần hai em đều kết luận sai. Bài học: giá thật phải hỏi người đang dùng.
- Quy ra: clip 45 giây lưu cloud ≈ **17–19 đ/đơn**; shop 1.000 đơn/ngày ≈ 500.000–560.000 đ/tháng. Cao hơn Dohana (279.000–400.000 đ).

## 29. Tính lại cho shop 1.000 đơn/ngày

Giả định ghi rõ: 30 ngày/tháng; clip 45 giây (CHƯA đo); cỡ tệp hai mức — 5,6 MB (mục tiêu của mình, khoảng 1 Mbps) và 11 MB (cỡ tệp
thật của Dohana, mục 20.1); ca làm 8 giờ; 3 điện thoại quay.

| Đại lượng | Tệp 5,6 MB | Tệp 11 MB |
|---|---|---|
| Tải lên mỗi ngày | 5,6 GB | 11 GB |
| Trung bình cả shop trong ca | 125 kiện/giờ ≈ 1,6 Mbps | ≈ 3,1 Mbps |
| Lúc cao điểm (em giả định gấp đôi trung bình) | ≈ 3,1 Mbps | ≈ 6,1 Mbps |
| Thời gian tải một clip ở đường lên 10 Mbps | ≈ 4,5 giây | ≈ 9 giây |
| Nằm kho (giữ trung bình 25 ngày) | 140 GB | 275 GB |
| Tiền R2 mỗi tháng | ≈ 58.000 đ | ≈ 110.000 đ |
| **Giá vốn lưu trữ mỗi đơn** | **≈ 1,9 đ** | **≈ 3,7 đ** |

- **Băng thông không phải chỗ nghẽn.** Mỗi điện thoại cứ 45–85 giây mới có một clip mới, trong khi tải một clip mất 5–9 giây. Hàng chờ
  chỉ dồn khi mạng rất yếu hoặc rớt. Chỗ có thể làm chậm là thiết kế: nếu việc quét phải chờ tải lên thì kho đứng hình.
- Dùng 4G thì tốn 5,6–11 GB dữ liệu mỗi ngày cho cả shop → cần công tắc "chỉ tải khi có Wi-Fi".
- Tốc độ đường lên thật của mạng ở kho: em không có số, đo ở lát 0.
- **Ý của anh về đơn hủy ngang là đúng hướng:** tính theo đơn thì đơn hủy vẫn là một đơn đã quay, nhưng video của nó xóa sau 24 giờ thay
  vì 25 ngày. Trên prod tháng 10, đơn hủy chiếm 12–20 % số đơn (mục 16.5), nhưng không tách được bao nhiêu trong đó hủy SAU khi gói
  (mục 8) → chưa ước được tiết kiệm bao nhiêu. Khi có sổ video thì đo được ngay.
- Toàn hệ thống nếu có 1.000 shop cỡ này: 1 triệu clip/ngày, trung bình 12 clip/giây, cao điểm khoảng 70 clip/giây, 5,6–11 TB/ngày.

## 30. Thiết kế để không chậm, không quá tải

Mười nguyên tắc, mỗi cái trả lời một kiểu nghẽn cụ thể:

| # | Nguyên tắc | Chống cái gì |
|---|---|---|
| 1 | **Video không bao giờ đi qua máy chủ Hubsell.** Điện thoại tải thẳng lên R2 qua điểm vào gần nhất của Cloudflare | máy chủ Hubsell quá tải; hóa đơn băng thông Render (đã từng dính 03/11) |
| 2 | **Quét không chờ gì cả.** Ba tầng tách rời: quay → hàng chờ trên máy → tải nền. Đọc được mã là quay ngay, không đợi máy chủ trả lời; tra đơn chạy song song | kho đứng hình khi mạng chậm |
| 3 | **Nén ngay lúc quay bằng bộ mã hóa phần cứng của điện thoại, khống chế bitrate.** Tệp nhỏ là cách giảm tải rẻ nhất: quay mặc định của điện thoại nặng gấp 10–20 lần mức cần | băng thông, tiền lưu, thời gian tải xuống |
| 4 | **Hàng chờ nằm trên bộ nhớ máy, không nằm trong RAM.** Tắt tab, sập trình duyệt, hết pin: mở lại là tải tiếp | mất video |
| 5 | **Tải 2 clip song song mỗi máy, thử lại giãn dần.** Clip thường (dưới khoảng 50 MB) một lệnh ghi; clip lớn hoặc mạng yếu thì chia phần 5 MiB, đứt đâu tải lại đó | mạng chập chờn; R2 tính 3 lượt ghi cho mỗi tệp chia phần nên không chia phần tệp nhỏ |
| 6 | **Xin quyền tải theo LÔ, báo xong theo LÔ.** Mỗi bàn xin một lần 50 đường dẫn ký sẵn; báo kết quả gộp mỗi 30 giây | dịch vụ video không phải trả lời từng clip: 1 triệu clip/ngày chỉ còn dưới 1 lượt gọi/giây |
| 7 | **Sổ ghi theo lô vào database riêng, phân mảnh theo tuần** | Disk IO của database chính (sự cố 28/10) |
| 8 | **Đối chiếu ban đêm:** liệt kê kho theo ngày, so với sổ, tìm tệp mồ côi và dòng thiếu tệp | lệch sổ ↔ kho mà không ai biết |
| 9 | **Xem video: đường dẫn ký sẵn hạn ngắn + tệp MP4 có mục lục ở đầu + tải theo đoạn.** Bấm là phát, tua không cần tải hết. Không tạo ảnh thu nhỏ; danh sách đọc từ sổ | tải xuống chậm; R2 không tính tiền tải xuống |
| 10 | **Rào mềm:** clip tối đa 5 phút; hàng chờ trên máy quá khoảng 2 GB thì cảnh báo, không khóa; giới hạn nhịp xin quyền theo shop | một shop hỏng làm ảnh hưởng shop khác |

Hai số "50 đường dẫn" và "2 GB" là em tự chọn, chỉnh sau khi đo.

**Phần tải xuống gần như không phải vấn đề:** shop chỉ xem video khi có khiếu nại, tức vài phần trăm số đơn — shop 1.000 đơn/ngày khoảng
30–50 lượt xem mỗi ngày. Clip 5–11 MB tải trong vài giây.

**Bước nâng cấp để dành** (chưa cần ở vài chục shop đầu): cho R2 tự báo "tệp đã tới" vào hàng đợi thay vì máy khách báo; chuyển phần
cấp quyền sang chạy ngay tại Cloudflare. Cả hai đều thêm một nền tảng mới phải học và vận hành, nên em xếp sau.

## 31. Bốn yêu cầu từ người dùng Ship Xanh — làm bằng gì

| Yêu cầu | Làm được bằng | Giới hạn đã kiểm |
|---|---|---|
| 1. Quay bằng điện thoại | **Web trên điện thoại**, không cần cài app (Ship Xanh cũng làm vậy). Màn quét của Hubsell đã mở được camera điện thoại và đọc mã bằng thư viện `html5-qrcode` (`scan-code-box.tsx`) | Android Chrome có bộ đọc mã sẵn; **iPhone Safari không có** (chỉ sau cờ thử nghiệm) → iPhone dùng thư viện đọc mã đang có. Cả hai quay được. Quay + đọc mã cùng lúc trên một luồng camera: **chưa thử** |
| 2. Nối camera trong nhà | Trình duyệt không đọc thẳng camera an ninh → cần một phần mềm cầu nối nhỏ cài ở máy tính của shop | Chưa thử gì. Ship Xanh tự ghi là "cần nâng cấp phần cứng / phần mềm". Xếp lát muộn |
| 3. Tự mua camera riêng | Webcam USB trên máy tính: trình duyệt nhận mọi webcam chuẩn | Như đã khảo sát (mục 16.2, 25) |
| 4. Lưu local hoặc cloud | Cloud = R2. Local = shop chọn một thư mục, tệp ghi thẳng vào đó, Hubsell chỉ giữ dòng sổ | Chọn thư mục để ghi: Chrome máy tính từ bản 86, **Chrome Android từ bản 132**, iPhone Safari **không có** → iPhone muốn lưu local phải chờ app |

Hệ quả của lưu local cần nói rõ với khách: video nằm ở máy nào thì chỉ máy đó mở được; Hubsell không giữ hộ, không tự xóa hộ, và
**không tự nộp khiếu nại thay được**. Phần tự động anh định làm sau chỉ chạy với video lưu cloud — đó là lý do tự nhiên để khách chọn cloud.

## 32. Tính tiền theo đơn

Anh đã chốt hướng: **tính theo số đơn**. So với ba đối thủ gần nhất:

| | Cách tính | Shop 1.000 đơn/ngày trả khoảng |
|---|---|---|
| Ship Xanh | theo phút, trừ ví | 500.000–560.000 đ/tháng (clip 45 giây, cloud) |
| Dohana | theo GB, gói tháng | 279.000–400.000 đ/tháng |
| Simple Replay | theo video | vượt xa gói lớn nhất của họ (9.000 video 2,7 triệu) |
| **Hubsell (thang ví dụ ở mục 24.2, đổi "video" thành "đơn")** | theo đơn | 399.000 đ/tháng ≈ 13 đ/đơn |

Tính theo đơn lợi cho mình ở ba chỗ: đơn hủy ngang vẫn tính nhưng gần như không tốn chỗ lưu; clip ngắn hay dài khách không phải nghĩ;
và mình nén tốt hơn thì lãi về mình chứ không về khách. Giá vốn lưu trữ 1,9–3,7 đ/đơn → biên gộp trên tiền lưu khoảng 70–85 % ở mức 13 đ.

Còn ba điểm anh cần chốt (em nêu đề xuất):

| # | Câu hỏi | Em đề xuất | Vì sao |
|---|---|---|---|
| T1 | "Đơn" là đơn nào | **đơn có video** trong tháng (một đơn quay lại nhiều lần vẫn tính một) | tính theo mọi đơn của gói chính thì đơn giản hơn và lãi hơn, nhưng shop chỉ quay một phần đơn sẽ thấy bị tính oan |
| T2 | Lưu local giá bao nhiêu so với cloud | rẻ hơn cloud nhưng không miễn phí (Ship Xanh: local ≈ 80 % giá cloud) | mình vẫn tốn phần mềm, sổ, hỗ trợ; miễn phí local thì khó ai mua cloud |
| T3 | Gói tháng theo bậc + vượt tính thẳng, hay trừ ví nạp trước như Ship Xanh | gói tháng theo bậc | khớp cách gói chính đang bán; trừ ví là một hệ thanh toán thứ hai phải dựng |

## 33. Các lát (bản 2)

Nguyên tắc giữ nguyên: mỗi lát giao được riêng; công tắc theo shop, mặc định TẮT; luồng khách là MỘT việc — đưa tem vào camera.

| Lát | Khách thấy gì | Phạm vi | Database chính | Phụ thuộc | Độ lớn |
|---|---|---|---|---|---|
| **0. Đo bằng điện thoại** | không gì | trang thử mở trên điện thoại + bucket R2 miễn phí | không | anh tạo tài khoản R2; có điện thoại + chân đứng | nhỏ |
| **1. Quay bằng điện thoại, lưu cloud** | mở màn Quét đóng gói trên điện thoại, đưa tem vào là quay, tem kế là cắt; đèn "đang quay / đã lưu / chờ mạng" | web điện thoại + dịch vụ video + R2 | không | lát 0 | lớn |
| **2. Tìm + xem video** | nút "Xem video" ở dòng đơn; gõ / quét mã vận đơn ra video; tải về; link xem có hạn | web | không | lát 1 | vừa |
| **3. Vòng đời xóa theo trạng thái đơn** | "tự xóa ngày…" cạnh mỗi video; đơn có hoàn ghi "đang giữ" | dịch vụ video + một đường ĐỌC ở backend chính | không | lát 1 | vừa |
| **4. Lưu local** | chọn "Cloud" hoặc "Máy này"; video local vẫn tìm ra theo mã vận đơn, ghi rõ nằm ở máy nào | web (Android + máy tính) | không | lát 1, 2 | vừa |
| **5. Gói mở rộng tính theo đơn** | mua gói video trong trang Gói dịch vụ; thấy đã dùng bao nhiêu đơn | dịch vụ video + phần gói + HQ | **có** (bảng gói, không đụng bảng đơn) | lát 1–4; anh chốt T1–T3 | lớn |
| **6. Máy tính + webcam + máy quét** | bàn có máy tính: webcam tự mua, quét bằng máy quét hoặc đưa tem vào webcam | web máy tính | không | lát 1; cần một webcam để thử | vừa |
| **7. Quay khui kiện hoàn** | ở Đối soát đơn hoàn: quét kiện là quay, nhắc quay đủ 6 mặt, quay xong mới cho nhận | web | không | lát 1, 2 | vừa |
| **8. App điện thoại** | như lát 1 trong app; iPhone lưu local được; chạy bền hơn khi khóa màn hình | `hubsell-mobile`, build nộp kho | không | lát 1–4 | lớn |
| **9. Camera trong nhà** | chọn camera an ninh sẵn có làm nguồn quay | phần mềm cầu nối cài ở máy shop + web | không | lát 6; một buổi thử khả thi trước | lớn, rủi ro cao nhất |
| **10. Khiếu nại** | hồ sơ soạn sẵn (ảnh cắt + lời) → tự nộp vài loại ca → báo cáo thắng / thua, thống kê | backend chính + web | **có** | lát 2, 7; phần 1 mục 5 | lớn |
| Sau | Hubsell Shop bán thiết bị | — | — | anh tính sau | — |

### Từng lát

**Lát 0 — Đo bằng điện thoại.** Không đổi sản phẩm. Một trang thử mở bằng trình duyệt điện thoại (camera đòi HTTPS; dự án đã có sẵn
`start-https.bat` + chứng chỉ cho mạng nội bộ), quay và tải thẳng lên bucket R2 miễn phí.
- Đo trên Android và iPhone: (1) đặt điện thoại trên chân, tem nằm trên bàn / sàn ở 40–60 cm có đọc được mã không, QR và mã vạch;
  (2) quay + đọc mã cùng lúc có chạy không, máy có nóng, pin tụt bao nhiêu mỗi giờ khi cắm sạc; (3) đặt bitrate có ăn không — cỡ tệp
  thật ở 720p và 1080p; (4) tệp có tua được trên Windows và điện thoại không; (5) cắt clip khi đổi tem mất bao lâu, có hụt hình không;
  (6) khóa màn hình / chuyển app thì sao; (7) tải 50 clip qua Wi-Fi và 4G: thời gian, tỷ lệ hỏng, tắt trình duyệt rồi mở lại có tải
  tiếp không; (8) bấm giờ gói 30–50 kiện thật; (9) xem lại có nhận ra món hàng, đọc được tem không; (10) in chữ mã vận đơn + giờ vào hình.
- Xong khi: có bảng số thật thay mục 29; chốt được bậc chất lượng mặc định và đường quay.
- Anh làm: tạo tài khoản Cloudflare + bật R2 (tên công ty); cho em biết anh có điện thoại Android, iPhone hay cả hai; một chân đứng
  điện thoại; vài chục kiện thật có tem. Khóa R2 anh tự dán vào tệp cấu hình ở máy.
- Rủi ro: thấp. Bucket thử xóa sau khi đo.

**Lát 1 — Quay bằng điện thoại, lưu cloud.** Lát lớn nhất; dựng luôn bộ khung của mục 30 (hàng chờ trên máy, tải nền, xin quyền theo lô).
- Đụng: `frontend/src/components/orders/packing/`, `shared/scan-code-box.tsx` (chỉ thêm; hành vi quét hiện tại giữ nguyên với shop chưa
  bật); mới: dịch vụ video, database riêng với `pack_settings`, `pack_videos`.
- Giữ nguyên các rào đang có: đơn hủy báo đỏ; không khóa ô quét. Thêm: phải quay đủ thời lượng tối thiểu mới nhận tem kế; quay lỗi
  không chặn việc quét; tiếng báo khi bắt đầu / đổi đơn; hiện sản phẩm của đơn trên màn; chỉ tải khi có Wi-Fi (tùy chọn).
- Kiểm local: 30 kiện seed trên điện thoại thật qua HTTPS nội bộ, tắt Wi-Fi giữa chừng, tắt trình duyệt giữa chừng, hai điện thoại cùng
  quét, đơn hủy. Kiểm prod: bật cho tài khoản công ty, 20 kiện thật, soi tệp trên R2 và dòng sổ.
- Rủi ro: trình duyệt điện thoại dừng camera khi khóa màn hình hoặc chuyển app (gần như chắc chắn — phải giữ màn hình sáng); nóng máy
  khi quay cả ca; iPhone đọc mã chậm hơn Android.
- Anh chốt trước: nơi chạy dịch vụ video (Q1 mục 17.3), bậc chất lượng mặc định.

**Lát 2 — Tìm + xem video.** Như mục 17.2. Thêm: mã băm tệp hiện ở trang video; link xem có hạn, thu hồi được.

**Lát 3 — Vòng đời xóa.** Như mục 17.2: một đường đọc trạng thái đơn theo lô ở backend chính, chạy bóng một tuần trước khi xóa thật.
Luật ở mục 12.2 với biên 5 ngày (giao + 20). Đây cũng là lát cho ra con số "đơn hủy ngang tiết kiệm bao nhiêu".

**Lát 4 — Lưu local.** Shop chọn nơi lưu; với "Máy này", shop chọn thư mục một lần, tệp đặt tên theo mã vận đơn, sổ ghi tên máy + tên
tệp + mã băm. Không tải lên, không tự xóa. Trang tìm video báo "video nằm ở máy Bàn 2" và chỉ phát được trên đúng máy đó.
- Rủi ro: trình duyệt hỏi lại quyền thư mục sau khi khởi động lại; khách xóa tệp rồi hỏi Hubsell → lời cảnh báo phải rõ ngay lúc chọn.
- iPhone trên web không làm được; nói rõ trong màn chọn.

**Lát 5 — Gói mở rộng tính theo đơn.** Đếm đơn có video theo tháng từ sổ; màn mua trong `/settings/plan`; thu qua luồng thanh toán
đang có; vượt hạn mức không dừng quay. Trước lát này shop thử dùng miễn phí theo danh sách anh bật tay. Em phải đọc lại mã phần gói
trước khi ước kỹ.

**Lát 6 — Máy tính + webcam.** Dùng lại toàn bộ khung của lát 1; thêm chọn camera, đọc mã từ webcam khi đưa tem vào, và máy quét cầm
tay như hiện có. Cần một webcam để thử — khi đó mới mua.

**Lát 7 — Khui kiện hoàn.** Như mục 17.2, thêm lời nhắc theo chuẩn sàn: quay đủ 6 mặt trước khi mở, kiện không rời khung hình, một
đoạn liền.

**Lát 8 — App.** Làm sau khi web điện thoại đã chạy ổn, vì app phải build nộp kho và không vá nhanh được. Lý do cần app: iPhone lưu
local, chạy bền khi khóa màn hình, điều khiển camera sâu hơn. Không nâng Expo.

**Lát 9 — Camera trong nhà.** Trước khi nhận lát này cần một buổi thử khả thi riêng với một camera thật. Đây là lát duy nhất bắt
Hubsell phát hành và bảo trì phần mềm cài trên máy khách.

**Lát 10 — Khiếu nại.** Chỗ anh muốn hơn đối thủ: hồ sơ soạn sẵn, tự nộp vài loại ca, báo cáo kết quả, thống kê. Qua API, Shopee và
TikTok chỉ nhận ảnh (mục 16.6) nên hồ sơ = ảnh cắt từ video + lời mô tả. Chỉ chạy với video lưu cloud.

## 34. Chờ anh

1. **Lát 0:** anh có điện thoại Android, iPhone hay cả hai để thử; và anh tạo tài khoản R2 khi nào.
2. **T1–T3** (mục 32): đơn nào thì tính; giá local so với cloud; gói tháng hay trừ ví.
3. Nơi chạy dịch vụ video (Q1), cách xóa (Q5), bỏ ngăn `hold/` (Q6) — ba câu cũ ở mục 17.3 vẫn mở.
4. Thứ tự: em xếp lưu local (lát 4) trước tính tiền (lát 5) vì giá local phải có thì bảng giá mới đủ. Nếu anh muốn thu tiền sớm thì đổi chỗ được.

## 35. Mức chắc của phần này

- Đã kiểm trên tài liệu gốc qua công cụ tóm tắt: bộ đọc mã sẵn (Android Chrome có từ bản 83; Safari chỉ sau cờ thử nghiệm); quay video
  trên Safari iPhone có từ iOS 14; chọn thư mục để ghi (Chrome 86, Chrome Android 132, Safari không); R2 chia phần tối thiểu 5 MiB, các
  phần phải bằng nhau trừ phần cuối, tải lại được phần hỏng; R2 có khóa tạm giới hạn theo tiền tố.
- Đọc mã: `scan-code-box.tsx` đã dùng `html5-qrcode` với camera sau của điện thoại, 10 khung/giây.
- **Chưa kiểm:** mọi thứ về điện thoại thật (lát 0); định dạng tệp iPhone quay ra; khóa tạm của R2 dùng từ trình duyệt được không
  (tài liệu không nói — nên em chọn đường dẫn ký sẵn theo lô); phần mềm cầu nối camera an ninh; tốc độ mạng ở kho.
- Giá Ship Xanh lấy từ một ảnh chụp màn hình của một người dùng; ba cột giá em hiểu là ba mức nạp, chưa có lời giải thích của họ.

Nguồn: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/BarcodeDetector.json · …/api/MediaRecorder.json · …/api/Window.json ·
https://developers.cloudflare.com/r2/objects/multipart-objects/ · https://developers.cloudflare.com/r2/api/s3/temporary-credentials/


## 36. Anh sửa hướng: quay từ APP, mục "Quay video đóng gói" ở tab Tổng quan dưới ô Giá vốn (14/11 khuya)

> Anh Trung: "Quay bằng điện thoại mình vẫn phải thiết kế mở camera từ app mobile chứ em nhỉ. Thêm phần Quay video đóng gói trong tab
> Tổng quan → bên dưới Giá vốn."
> → **Thay lát 0, lát 1 và lát 8 của mục 33.** Web trên điện thoại không còn là đường chính. Chưa viết mã.

### 36.1 App đang có gì (đọc mã `hubsell-mobile`)

- Màn **Quét đóng gói** đã có sẵn (`src/screens/PackScanScreen.tsx`): camera quét liên tục, giữ màn hình sáng, âm + rung + màn báo, cửa
  chống bắn lặp, danh sách đơn hủy. Lối vào: nút "Đóng gói" ở Đơn hàng và công tắc ở tab QR giữa (lối của nhân viên).
- Tab Tổng quan (`src/screens/OverviewPage.tsx`), khối "Thiết lập": hàng 1 = Gian hàng · Giá vốn; hàng 2 = Chi phí vận hành · **một ô
  trống giữ chỗ nằm ngay dưới Giá vốn** (anh dặn 12/11 "về sau còn thêm các mục khác bên cạnh"). Ô "Quay video đóng gói" vào đúng chỗ này,
  không phải dời gì.
- App dùng thư viện camera `expo-camera` 57.0.3 trên Expo 57. Gói đọc / ghi tệp `expo-file-system` đã có sẵn trong app.

### 36.2 Một chỗ vướng kỹ thuật phải biết trước — Android không vừa quay vừa đọc mã được bằng thư viện đang dùng

Đọc mã gốc của `expo-camera` 57.0.3 trong `node_modules`:
- **Android** (`ExpoCameraView.kt`, đoạn ghép các luồng camera): bộ đọc mã chỉ được gắn khi camera ở chế độ CHỤP. Ở chế độ QUAY, thư
  viện chỉ gắn khung xem + bộ quay. → Đang quay thì **không đọc được mã**. Đây là mã, không phải suy đoán.
- **iPhone** (`CameraSessionManager.swift`): bộ đọc mã được bật khi dựng phiên camera, không phụ thuộc chế độ → nhiều khả năng vừa quay
  vừa đọc được. Chưa chạy thử.
- Quay không tiếng: trên iPhone, khi tắt tiếng thư viện không gắn micro → không cần xin quyền micro. Android: tài liệu không nói rõ.
- Tài liệu chính thức của thư viện (bản v57) không nói gì về việc quét trong lúc quay, không có tùy chọn số khung hình; có `videoBitrate`
  và `videoQuality`.

Hệ quả: luồng "đưa tem kế vào là tự cắt clip trước" **làm được trên iPhone (cần thử), không làm được trên Android** nếu giữ thư viện hiện tại.

Ba cách đi:

| Cách | Luồng của người gói | Cần gì | Điểm yếu |
|---|---|---|---|
| **A. Hai nhịp, giữ thư viện đang có** | đưa tem vào → app tự chuyển sang quay → gói xong chạm một nút to "Xong" (hoặc tự dừng theo giờ) → app quay về quét | không thêm thư viện gốc; có thể vá OTA được trên bản app đang chạy | mỗi kiện thêm một lần chạm; chuyển chế độ camera mất chừng nửa giây tới một giây (ước, chưa đo) |
| **B. Đổi sang thư viện camera khác cho màn này** (VisionCamera) | đưa tem vào là quay, tem kế là cắt — đúng luồng một việc | thêm thư viện gốc → **bản build mới nộp hai kho**; chỉnh được số khung hình, bitrate | chưa kiểm thư viện đó chạy với Expo 57; lỗi phần gốc không vá OTA được |
| C. iPhone tự động, Android hai nhịp | mỗi hệ một kiểu | như A | hai luồng khác nhau, khó hướng dẫn khách |

Em nghiêng **làm lát 0 thử cả A và B trên máy thật rồi mới chọn**: A cho kết quả nhanh và không phải nộp kho; B mới là luồng anh muốn
về lâu dài. Em không đề xuất C.

### 36.3 Ô "Quay video đóng gói" ở Tổng quan

- Vị trí: ô trống hàng 2 khối Thiết lập, ngay dưới Giá vốn, cùng cỡ với các ô khác (dùng `QuickTile` đang có).
- Ô mang TRẠNG THÁI như các ô bên cạnh, không phải lối tắt chết: "Chưa bật" (xám) · "Hôm nay 132 video" (xanh) · "3 video chờ tải" (vàng)
  · "Tải lỗi" (đỏ).
- Bấm vào mở màn Quay video đóng gói: công tắc bật / tắt, nơi lưu (Cloud / Máy này), chất lượng, số video hôm nay, hàng chờ tải, và nút
  **Bắt đầu quay** → mở màn Quét đóng gói ở chế độ có quay.
- **Điểm em cần anh biết:** tab Tổng quan chỉ có ở tài khoản chủ shop. Nhân viên gói hàng vào app ở khu nhân viên, không có tab này — họ
  vào Quét đóng gói từ tab QR giữa. Vậy khi shop đã bật, màn Quét đóng gói phải tự quay ở MỌI lối vào, kể cả lối của nhân viên; ô ở Tổng
  quan là nơi chủ shop bật, cài và theo dõi.

### 36.4 Lát sửa lại

| Lát | Nội dung mới | Ghi chú |
|---|---|---|
| **0. Đo trong app** | bản thử cài riêng lên máy anh: (1) cách A — quét rồi quay bằng thư viện đang có; (2) cách B — thư viện mới, vừa quay vừa đọc mã; đo cỡ tệp, nóng máy, pin, thời gian cắt clip; tải thử lên R2 miễn phí, cả lúc tắt app giữa chừng | không đụng bản app đang trên kho |
| **1. Quay trong app, lưu cloud + ô ở Tổng quan** | ô dưới Giá vốn; màn cài đặt; Quét đóng gói có quay; hàng chờ tải nền; dịch vụ video + R2 | đường phát hành (OTA hay build nộp kho) tùy kết quả lát 0 |
| 2–7, 9–10 | giữ như mục 33 | lát 2 (tìm + xem video) làm cả trên app lẫn web |
| ~~8. App~~ | gộp vào lát 0–1 | |
| Web trên điện thoại | bỏ khỏi kế hoạch | giữ làm đường lùi nếu cả A lẫn B đều trượt |

Lưu local trong app: tệp nằm trong vùng lưu của app thì làm được ngay. Muốn khách tự thấy tệp trong thư viện ảnh / ứng dụng Tệp thì cần
thêm một thư viện gốc nữa — tính ở lát 4.

Ràng buộc phát hành đã biết: bản 1.4.3 đang nộp dở; cập nhật OTA chỉ tới được máy cùng số phiên bản app; thêm thư viện gốc là phải build
mới và nộp cả hai kho; không nâng Expo.

### 36.5 Chưa kiểm

- iPhone có thật sự đọc mã trong lúc quay không (mới đọc mã nguồn).
- VisionCamera có chạy với Expo 57 / React Native 0.86 không; quay + đọc mã cùng lúc trên Android có ổn không (bản cũ của thư viện này
  từng có báo lỗi khi bật nhiều luồng cùng lúc — mục 16.2).
- Tải lên nền khi app bị đưa xuống dưới / khóa màn hình.
- Định dạng và cỡ tệp thật mà điện thoại quay ra ở từng mức chất lượng.


## 37. Anh chốt cách B — thư viện camera mới, bỏ cách A (14/11 khuya)

> Anh Trung: "Anh cần phương án B, A thì bỏ qua luôn vì cái anh cần là tự động."
> → Cách A (hai nhịp, chạm "Xong") và cách C **bỏ hẳn, đừng đề xuất lại**. Luồng phải là: đưa tem vào là quay, tem kế là tự cắt. Chưa viết mã.

### 37.1 Đã kiểm về thư viện (trang chính thức + kho gói npm, đọc qua công cụ tóm tắt)

| Điểm | Kết quả |
|---|---|
| Thư viện | `react-native-vision-camera` bản **5.2.4**. Bản 4 đã ngừng bảo trì ("V4 is no longer actively maintained") → chỉ dùng bản 5 |
| Phải cài kèm | `react-native-nitro-modules` (0.37.2), `react-native-nitro-image`, và gói đọc mã riêng `react-native-vision-camera-barcode-scanner` (5.2.4, dùng ML Kit) — tổng cộng **4 gói gốc mới** |
| Đọc mã | chạy trên cả iPhone và Android; có `code-128` và `qr-code`; gắn như MỘT đầu ra của camera |
| Nhiều đầu ra cùng lúc | tài liệu cho gắn nhiều đầu ra vào cùng một camera, độ phân giải "được thương lượng giữa các đầu ra". **Không có câu nào nói rõ quay + đọc mã cùng lúc chạy được trên mọi máy, cũng không nêu giới hạn** |
| Quay | mặc định không tiếng, chỉ khi bật tiếng mới cần quyền micro; Android ra MP4, iPhone mặc định MOV nhưng đặt được MP4; **mỗi clip phải tạo một bộ quay mới** (không dùng lại được) |
| Bitrate, số khung hình, bộ mã hóa | nằm ở trang cấu hình bộ quay, em chưa đọc được nội dung; phần giới thiệu ghi hỗ trợ 30–240 khung/giây |
| Yêu cầu phiên bản | kho gói không ghi mức tối thiểu của React Native; tài liệu không nêu → **chưa biết có dựng được với Expo 57 / React Native 0.86 không** |
| Với Expo | phải dựng bản gốc mới (`prebuild`), không chạy trong Expo Go; quyền khai trong cấu hình app |

### 37.2 Hệ quả với app đang có

- App sẽ có HAI thư viện camera: `expo-camera` giữ nguyên cho các màn quét hiện tại; thư viện mới chỉ dùng cho màn quét có quay. Không
  đụng màn nào đang chạy.
- Thêm thư viện gốc → **bản app mới (đề xuất 1.5.0) nộp cả hai kho**; cập nhật OTA không mang được phần này tới bản 1.4.x.
- Dòng xin quyền camera hiện ghi "để quét mã vận đơn trên kiện hàng hoàn" → phải sửa cho đúng việc quay video đóng gói, kẻo Apple hỏi.
- Gói đọc mã dùng ML Kit → dung lượng app tăng; tăng bao nhiêu phải đo.
- Bản 1.4.3 đang nộp dở phải xong trước, không trộn hai việc vào một bản.

### 37.3 Lát 0 (bản chốt) — ba cửa phải qua, theo thứ tự, trượt cửa nào dừng ở cửa đó và báo anh

Làm trên một nhánh thử riêng, không vào bản phát hành, không đụng `master`.

| Cửa | Câu hỏi | Cách kiểm | Trượt thì |
|---|---|---|---|
| **1. Dựng được không** | 4 gói mới có dựng được với Expo 57 / React Native 0.86 trên Android và iPhone không | dựng bản thử (hồ sơ `development` trong `eas.json` đã có sẵn; Android dựng được ngay tại máy anh vì máy đã có Android SDK) | báo anh; đường còn lại là vá thư viện đang dùng hoặc web trên điện thoại — chưa chọn trước |
| **2. Vừa quay vừa đọc mã** | đang quay, đưa tem khác vào có đọc ra mã không | một màn thử: quay liên tục, đếm số lần đọc được mã; thử trên ít nhất một máy Android tầm thấp và một iPhone nếu có | như trên |
| **3. Cắt clip có kịp không** | từ lúc đọc mã mới tới lúc clip mới bắt đầu ghi mất bao lâu, có hụt hình không | đo bằng đồng hồ trong khung hình | nếu hụt quá lâu: thử chế độ quay bền của thư viện, hoặc quay một tệp dài rồi đánh mốc — phải báo anh vì đụng yêu cầu "một đoạn liền" của sàn |

Qua cả ba cửa mới đo tiếp: cỡ tệp theo từng mức bitrate và số khung hình; đọc tem ở 40–60 cm; nóng máy và pin trong một giờ; tệp có
tua được không; tải 50 clip lên R2 miễn phí qua Wi-Fi và 4G, kể cả khi đưa app xuống dưới và khi tắt app giữa chừng; bấm giờ gói kiện thật.

**Anh cần làm cho lát 0:**
1. Cho em biết máy thử là Android, iPhone hay cả hai. Android: em dựng tệp cài tại máy, anh cài thẳng. iPhone: phải dựng qua Expo và
   đăng ký máy của anh vào danh sách máy thử — hạn mức dựng miễn phí của Expo tháng này còn hay hết em chưa kiểm.
2. Tạo tài khoản Cloudflare + bật R2 (tên công ty) cho phần tải thử. Cửa 1–3 chưa cần R2, làm trước được.
3. Một chân đứng điện thoại và vài chục kiện có tem thật.

### 37.4 Lát 1 (sau khi lát 0 qua)

Quay trong app + lưu cloud + ô "Quay video đóng gói" dưới Giá vốn (mục 36.3). Bản 1.5.0, nộp hai kho. Các lát 2–7, 9–10 giữ nguyên mục 33.

### 37.5 Chưa kiểm

Mọi thứ ở ba cửa trên. Trang cấu hình bộ quay (bitrate, số khung hình, bộ mã hóa). Mức tăng dung lượng app. Yêu cầu phiên bản iOS / Android
tối thiểu của bộ 4 gói. Hạn mức dựng Expo tháng 11.

Nguồn: https://registry.npmjs.org/react-native-vision-camera/latest · https://registry.npmjs.org/react-native-vision-camera-barcode-scanner/latest ·
https://registry.npmjs.org/react-native-nitro-modules/latest · https://visioncamera.margelo.com/docs/guides/code-scanning ·
https://visioncamera.margelo.com/docs/guides/recording-videos · https://visioncamera.margelo.com/docs/camera-outputs ·
https://github.com/mrousavy/react-native-vision-camera


## 38. Lát 0 — kết quả tới 14/11 15:50: CỬA 1 QUA, cửa 2 và 3 chờ người cầm máy

> Anh Trung: "Làm, Android trước" · "Em chuyển sang ổ D:\HubsellVideo" · "Em cứ cài tiếp và test xong lát 0 nhé. Mình vẫn phải làm trên
> local trước, anh test chán rồi mới đưa vào bán công khai nên em cứ từ từ làm."

### 38.1 Nơi làm

- Nhánh `thu/video-dong-goi-lat-0`, mở thành một thư mục làm việc riêng tại **`D:\HubsellVideo`** (git worktree). Thư mục dự án chính và
  `master` không bị đụng. Chưa commit gì trên nhánh thử.
- Bộ nhớ đệm của npm và của trình dựng nằm trong `D:\HubsellVideo\.cache-thu\` (đã loại khỏi git bằng `.git/info/exclude`). Bộ công cụ
  Android còn thiếu (NDK 27, build-tools 35 / 36, nền tảng 36) tự tải về `E:\Android\sdk`.
- Tệp đổi trên nhánh thử: `hubsell-mobile/package.json` + `package-lock.json` (4 gói mới), `app.json` (tên "Hubsell Thu Video", mã gói
  `vn.hubsell.thuvideo`, bỏ tệp dịch vụ Google để cài song song với app thật), `src/app/index.tsx` (mở thẳng màn thử),
  `src/app/video-test.tsx` (màn thử), thư mục `android/` do `expo prebuild` sinh ra.

### 38.2 Cửa 1 — dựng được không: **QUA**

| Việc | Kết quả |
|---|---|
| Cài 4 gói | `react-native-vision-camera` 5.2.4, `react-native-vision-camera-barcode-scanner` 5.2.4, `react-native-nitro-modules` 0.37.2, `react-native-nitro-image` 0.15.2 — npm không báo xung đột |
| Kiểm kiểu | `tsc --noEmit` sạch với màn thử |
| Dựng lần 1 | **thất bại sau 17 phút** vì trình dựng hết bộ nhớ (Metaspace) ở `:expo-updates:kspReleaseKotlin` và bước soát mã — không liên quan thư viện camera |
| Dựng lần 2 | nới `org.gradle.jvmargs` lên `-Xmx4096m -XX:MaxMetaspaceSize=1536m`, `--max-workers=3`, bỏ ba tác vụ `lintVital*` → **BUILD SUCCESSFUL** |
| Tệp cài | `D:\HubsellVideo\hubsell-mobile\android\app\build\outputs\apk\release\app-release.apk`, 74,9 MB, chỉ cho chip 64-bit |
| Cài lên máy | Galaxy Note8 (SM-N950F, Android 9, API 28) qua cáp: cài thành công, app chạy, nhật ký có `Running "main"`, **không có lỗi sập** lúc khởi động |

Cấu hình bản dựng: Expo 57, React Native 0.86.2, Gradle 9.3.1, JDK 17, NDK 27.1, Kotlin 2.1.20, minSdk 24, compileSdk 36.

Lệnh dựng lại (chạy trong `D:\HubsellVideo\hubsell-mobile\android`, Git Bash):
`GRADLE_USER_HOME=/d/HubsellVideo/.cache-thu/gradle NODE_ENV=production CI=1 ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=3 -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease`

### 38.3 Điều phát hiện thêm ở cửa 1

- **Thư viện mới kéo bản CameraX của cả app lên bản thử nghiệm.** `expo-camera` khai CameraX 1.6.0, thư viện mới khai 1.7.0-alpha03; trình
  dựng chọn bản cao hơn cho cả hai (đã xem cây phụ thuộc: `camera-core:1.6.0 -> 1.7.0-alpha03`). Biên dịch qua, nhưng các màn quét đang
  chạy bằng `expo-camera` sẽ chạy trên một bản CameraX mà nó chưa được thử cùng → **phải thử lại mọi màn quét cũ** trước khi coi cách B
  dùng được cho bản phát hành. Bản thử hiện mở thẳng màn thử nên chưa thử được việc này.
- Máy dựng cần nới bộ nhớ như trên; cấu hình mặc định của Expo (2 GB) không đủ khi có thêm bộ gói này. EAS dựng trên máy của Expo nên
  chưa chắc gặp, chưa kiểm.
- Ổ D còn khoảng 9,7 GB sau hai lần dựng; `D:\HubsellVideo` đang chiếm khoảng 8 GB.

### 38.4 Cửa 2 và 3 — CHƯA THỬ ĐƯỢC

Điện thoại đang khóa bằng mã (màn nhập mã hiện ra sau khi vuốt). Em không nhập mã, nên chưa nhìn thấy camera chạy. Việc thử cũng cần
người đưa tem thật vào trước ống kính.

Màn thử (`src/app/video-test.tsx`) làm gì:
- Camera sau, gắn cùng lúc hai đầu ra: quay (MP4, không tiếng) và đọc mã (Code 128 + QR, độ phân giải đầy đủ).
- Đọc được mã khi chưa quay → mở clip. Mã lạ xuất hiện sau 1,5 giây đầu của clip → đóng clip cũ, mở clip mới (1,5 giây là số em tự chọn để
  mã vạch và QR của cùng một tem không bị coi là hai tem).
- Dòng **"Đọc mã khi đang quay: N"** — N tăng = qua cửa 2.
- Nhật ký từng clip: mã, **"cắt … ms"** (cửa 3), thời lượng, cỡ tệp, đường dẫn tệp.
- Nút đổi 720p / 1080p, bitrate 800k / 1500k / 3000k, 15 / 30 khung hình mỗi giây, và DỪNG.

### 38.5 Chưa kiểm

Cửa 2, cửa 3; chất lượng hình và cỡ tệp thật; các màn quét cũ trên CameraX mới; bản iPhone; mức tăng dung lượng app so với bản đang
phát hành; tải lên R2. Lúc em kiểm, điện thoại báo **không sạc qua cáp này** (pin 37 %) — nếu thử lâu cần cáp / cổng khác.


## 39. Lát 0 — anh thử trên Note8 (14/11 ~16:50): CỬA 2 QUA, CỬA 3 QUA (2 mẫu), lộ một lỗi luật cắt

> Anh Trung (kèm ảnh chụp màn thử): "Tem 1 thì thấy đang quay, sang tem 2 thì nó cứ đếm tiếp thôi lên tới tận 33 luôn."

### 39.1 Đọc từ ảnh anh gửi

Cấu hình lúc thử: 720p · 800k · 15 khung hình/giây.

| Clip | Mã | Cắt | Dài | Cỡ tệp | Ghi chú |
|---|---|---|---|---|---|
| #1 | `…236474` (mã vạch) | — | 23,9 giây | 2,3 MB | tem 1 |
| #2 | `…s/ALIfL0VLNKnL` (đuôi một mã QR) | 164 ms | 9,2 giây | 0,9 MB | **clip thừa** — QR bị coi là tem mới |
| #3 | `…326484` (mã vạch) | 177 ms | đang quay | — | tem 2 |

Dòng đếm: "Đọc mã khi đang quay: 33 · tổng lượt đọc: 34".

### 39.2 Kết luận từng cửa

- **Cửa 2 — QUA.** 33 trên 34 lượt đọc xảy ra lúc máy đang quay. Thư viện mới vừa quay vừa đọc mã được trên Android (điều `expo-camera`
  không làm được, mục 36).
- **Cửa 3 — QUA với 2 mẫu.** Đóng clip cũ + mở clip mới mất 164 ms và 177 ms. Số này đo từ lúc phần mã JS nhận được mã tới lúc clip mới
  bắt đầu ghi; **chưa** gồm thời gian bộ đọc mã nhận ra mã trong khung hình. Mới 2 mẫu, một cấu hình, một máy — chưa đủ để coi là số chắc.
- **Con số 33 không phải lỗi, mà là chữ em đặt gây hiểu nhầm.** Nó đếm từng lần máy đọc ra mã (cùng một tem để trước ống kính thì cứ
  đọc lại hoài), không phải số tem. Đã đổi chữ + thêm dòng "Số clip đã mở".

### 39.3 Lỗi thật: 2 tem ra 3 clip

Luật cắt bản 1: mã lạ xuất hiện sau 1,5 giây đầu của clip = tem mới. Tem vận đơn có cả mã vạch lẫn mã QR; QR được đọc ra muộn (sau 23,9
giây) nên bị coi là tem mới → mở clip #2 thừa, rồi mã vạch của tem 2 mở clip #3. Chưa biết QR đó thuộc tem 1 hay tem 2 — cả hai trường
hợp đều là cắt sai.

Đã sửa trên nhánh thử (luật bản 2, chỉ để thử) — **sửa 14/11 17:20: luật bản 2 SAI, xem mục 40**:
- Chỉ **mã vạch Code 128** mới mở / cắt clip. Mã QR chỉ ghi lại để xem, không bao giờ cắt.
- Mã thấy trong 1,5 giây đầu của clip vẫn coi là cùng tem.
- Nhật ký từng clip thêm dòng "mã khác: …" liệt kê mọi mã thấy trong lúc quay clip đó, kèm loại (vạch / QR) → dùng để biết tem thật của
  từng hãng có mấy mã.

**Luật bản 2 vẫn chưa phải luật của bản thật.** Tem nào có hai mã vạch Code 128 (ví dụ mã vận đơn + mã đơn) vẫn có thể bị cắt sai. Bản
thật phải cắt theo ĐƠN: mã đọc ra đem tra đơn (như màn quét Đã đóng gói đang làm), tra ra đơn KHÁC đơn đang quay mới cắt; mã không tra ra
đơn nào thì bỏ qua. Việc này thuộc lát 1, chưa làm.

### 39.4 Số đầu tiên về cỡ tệp

720p · 800k · 15 khung hình/giây: 2,3 MB cho 23,9 giây và 0,9 MB cho 9,2 giây → khoảng **5,8 MB mỗi phút** (≈ 0,77–0,78 Mbps, sát mức
800k đã đặt). Hai mẫu, đọc từ màn hình (làm tròn 0,1 MB), chưa mở tệp ra kiểm. Để so: Dohana khoảng 15 MB/phút (PHẦN 4).

### 39.5 Các sửa khác trên màn thử (bản dựng 3, 17:02)

- Clip ghi ra thư mục ngoài của app (`/sdcard/Android/data/vn.hubsell.thuvideo/files/thu/`) để máy tính kéo về được qua cáp; bản trước
  ghi vào thư mục tạm, bản dựng release không cho đọc → **3 clip anh vừa quay em không lấy về được**. Không ghi được ra ngoài thì màn thử
  tự quay về thư mục tạm và báo dòng vàng.
- Dòng "Cấu hình máy chọn" trước hiện `{}` → nay hiện số khung hình/giây, định dạng điểm ảnh, kiểu lấy nét.
- Mỗi clip ghi kèm cấu hình lúc quay (độ phân giải · bitrate · khung hình/giây) để so cỡ tệp.
- Đổi cấu hình giữa chừng thì dòng "ĐANG QUAY" tắt theo (trước còn treo).

Dựng lại mất 50 giây, cài đè lên Note8 thành công (17:04), app đã mở sẵn sau màn khóa. `tsc` sạch.

### 39.6 Điều lộ ra, để dành cho lát 1

- **Không có gì tự dừng clip.** Trong ảnh, máy nằm úp trên bàn mà vẫn "ĐANG QUAY". Bản thật cần luật tự đóng clip (ví dụ quá N giây không
  thấy mã / quá thời lượng trần) — chưa chọn số, cần đo thời gian đóng gói thật trước.
- Pin Note8 tụt 37 % → 27 % từ 15:50 tới 17:04 (gồm lúc anh thử); cắm cáp mà không sạc, máy báo không có nguồn vào. 30,2 °C lúc 17:04.

### 39.7 Chưa kiểm

Luật cắt bản 2 trên tem thật; mở tệp clip ra xem (độ phân giải thật, số khung hình, tua được không, đọc được chữ trên tem không); cỡ tệp
ở 1080p / 1500k / 3000k / 30 khung hình; cắt clip khi đổi tem liên tục nhiều lần; nóng máy khi quay lâu; các màn quét cũ trên CameraX
mới; iPhone; tải lên R2.


## 40. Lát 0 — lần thử thứ hai của anh (14/11 17:11–17:14): 4 tem ra 1 clip, luật cắt bản 2 SAI, đổi sang bản 3

> Anh Trung: "Anh thấy là khi chuyển mã vận đơn nó chưa tự cắt clip. Và nó còn đếm cái gì mà 14/tổng 15 trong khi anh chỉ chuyển qua lại
> có 2-3 mã vận đơn."

### 40.1 Em đã kéo clip về và xem (lần đầu có tệp thật)

Tệp `clip-1794651076818-1.mp4`, kéo qua cáp bằng `adb pull` về thư mục tạm của phiên, soi bằng `ffprobe` + cắt khung hình.

| Điều kiểm | Kết quả |
|---|---|
| Hình | 720×1280 (dọc), H.264 Baseline, 15 khung hình/giây, 2.596 khung |
| Dài / cỡ | 172,9 giây / 17,77 MB → **≈ 6,2 MB mỗi phút**, bitrate hình 803 kbps (đặt 800k) |
| Khung khóa | mỗi 1 giây một khung → tua tới giây bất kỳ được |
| Vỏ tệp | phần chỉ mục (`moov`) nằm ĐẦU tệp, trước phần hình → phát / tua qua mạng theo từng đoạn được, không phải tải cả tệp |
| Nội dung | 0–6 giây tem `…236474`; 12–24 giây tem `…326484`; 30–48 giây tem `…863404`; 54–72 giây tem `…716144`; từ 78 giây tới hết là máy nằm trên bàn (100 giây thừa, tới khi anh bấm DỪNG) |
| Đọc chữ | mã vận đơn in to và mã phân tuyến đọc rõ ở 720p · 800k; chữ nhỏ không đọc được — nhưng tem đang là **ảnh hiện trên màn hình máy tính**, bản thân ảnh gốc đã nhòe, chưa kết luận được cho tem giấy |

### 40.2 Vì sao 4 tem chỉ ra 1 clip

Màn thử ghi lại các mã đã thấy trong clip: mã vạch `…236474` (tem 1, mở clip), QR đường link `…p/s/ALIfL0VLNKnL`, và **QR `…863404`
— chính là mã vận đơn của tem 3**.

- **Tem TikTok × J&T có hai QR:** QR bên phải mang đúng mã vận đơn (cùng giá trị với mã vạch); QR góc dưới trái là đường link mở app.
- **Luật bản 2 (chỉ mã vạch mới cắt) sai:** tem 3 chỉ được đọc qua QR, nên bị xếp vào "QR lẻ, không cắt". Lỗi của em: sửa lỗi lần 1 bằng
  cách đoán "QR = không phải mã vận đơn" mà chưa nhìn tem thật.
- **Tem 2 và tem 4 không được đọc lần nào**, cả mã vạch lẫn QR. Ở khung hình cắt ra, các vạch của mã vạch dính vào nhau — ảnh tem trên màn
  hình máy tính quá nhòe so với tem in. Không luật cắt nào cứu được ca này; phải thử bằng tem giấy, hoặc phóng ảnh tem cho đầy khung hình.
- Số "14 / tổng 15" vẫn là số LƯỢT máy đọc ra mã (15 lượt trong 72 giây có tem), không phải số tem. Đã bỏ dòng đó, thay bằng số đo bên dưới.

### 40.3 Luật cắt bản 3 (bản dựng 5, 17:18) — vẫn chỉ để thử

- Cắt theo **giá trị**, không theo loại mã: giá trị trông như mã vận đơn (8–30 chữ số / chữ cái, không có dấu của đường link) mà chưa thấy
  trong clip đang quay = tem mới. Mã vạch và QR mang cùng một mã vận đơn là MỘT giá trị nên không cắt nhầm. Đường link chỉ ghi lại.
- Ngưỡng 8–30 ký tự là số em tự chọn để thử, không có căn cứ từ bảng mã của các hãng.
- Vẫn giữ: mã thấy trong 1,5 giây đầu của clip coi là cùng tem.
- Còn hở (biết trước): tem có HAI mã khác giá trị cùng trông như mã vận đơn (ví dụ mã vận đơn + mã đơn hàng) sẽ bị cắt nhầm nếu mã thứ hai
  được đọc sau 1,5 giây. Chỉ luật của bản thật mới đóng được: mã tra ra ĐƠN, khác đơn đang quay mới cắt (lát 1).

### 40.4 Số đo mới trên màn thử

- "Máy soi N khung/giây · đã soi X khung, Y khung thấy mã" — thư viện gọi lại cho mọi khung đã soi, kể cả khung không có mã, nên đếm được.
- "quay W×H · soi mã W×H" — độ phân giải thật của hai luồng.
- Nút mới **soi vừa / soi cao** (độ phân giải khung hình đem đi đọc mã). Đo trên Note8 lúc chưa quay, không có tem trong khung:

| Mức | Khung soi mã | Tốc độ soi |
|---|---|---|
| soi vừa (mặc định mới) | 1440×1080 | 15–16 khung/giây |
| soi cao (hai lần thử trước dùng mức này) | 4032×3024 | 15 khung/giây |

  Tức là lúc chưa quay, bộ đọc mã theo kịp camera ở cả hai mức. **Chưa đo lúc đang quay và lúc có tem trong khung** — đó mới là số cần.
- 4 lần đọc gần nhất hiện trên màn (giờ · đang quay hay chưa · loại mã · đuôi mã); mọi lần đọc và mọi lần mở / đóng clip ghi ra nhật ký
  máy để em đọc lại qua cáp.

### 40.5 Điều lộ ra thêm

- Clip thừa 100 giây vì không có gì tự dừng (đã nêu ở 39.6) — lần này có số: 100 / 173 giây của tệp là cảnh mặt bàn, ≈ 10 MB bỏ đi.
- Pin Note8: 27 % (17:04) → 18 % (17:19), 35,2 °C, vẫn không sạc qua cáp máy tính. Cần sạc bằng củ sạc trước khi thử tiếp.
- Khung hình cắt từ clip có tên + địa chỉ người nhận trên tem → các tệp đó chỉ nằm ở thư mục tạm của phiên, không đưa vào dự án.

### 40.6 Chưa kiểm

Luật bản 3 trên tem (chưa ai đưa tem vào bản dựng 5); tốc độ soi lúc đang quay; tem giấy thật; tem Shopee / Lazada có mấy mã, mã gì;
cỡ tệp ở cấu hình khác; đổi tem liên tục nhiều lần; các màn quét cũ trên CameraX mới; iPhone; R2.


## 41. Lát 0 — lần thử thứ ba của anh (14/11 17:21–17:23, bản dựng 5): luật bản 3 CẮT ĐÚNG, thêm báo "tem đã quay rồi"

> Anh Trung: "anh quay từ tem 1, tem 2, tem 3 thì anh test là quay vào tem 1.. làm linh tinh.. quay tem 1 rồi quay sang tem 2.... lặp lại
> như tem 1 rồi quay tem 3... Sau đó anh quay lại tem 1 thì nó không báo là đã quay rồi mà tính là quay thành video thứ 4."

### 41.1 Nhật ký máy + 4 clip kéo về

| Clip | Mã | Cắt | Dài | Cỡ tệp thật |
|---|---|---|---|---|
| #1 | `…236474` (tem 1) | — | 33,6 giây | 3,80 MB |
| #2 | `…326484` (tem 2) | 153 ms | 32,5 giây | 3,68 MB |
| #3 | `…863404` (tem 3) | 147 ms | 23,4 giây | 2,81 MB |
| #4 | `…236474` (tem 1 lần hai) | 166 ms | 10,3 giây | 1,44 MB |

- **Luật bản 3 chạy đúng:** 3 tem ra 3 clip; đưa tem 1 vào lại giữa lúc đang quay clip tem 1 thì không cắt; đường link QR không cắt.
- **Cửa 3 nay có 5 mẫu:** 147, 153, 164, 166, 177 ms (vẫn một máy, một cấu hình).
- **Mức "soi vừa" đọc mã dày hơn hẳn:** 388 lượt đọc trong 99 giây (lần thử hai ở "soi cao": 15 lượt trong 72 giây có tem). Chưa tách
  được bao nhiêu là nhờ đổi mức soi, bao nhiêu là nhờ anh đưa tem rõ hơn — hai thứ đổi cùng lúc.
- **Máy đọc QR dễ hơn mã vạch khoảng 3 lần** (387 lượt QR, 116 lượt mã vạch). Tem 2 và tem 3 đều được nhận ra qua QR trước; mã vạch tới
  sau 0,4 giây và 2,3 giây. → Bản thật không được chỉ dựa vào mã vạch.

### 41.2 Điều anh bắt được: tem đã quay rồi mà vẫn mở clip mới

Đúng — luật bản 3 chỉ nhớ các mã của clip ĐANG quay, không nhớ các clip đã đóng. Tem 1 quay lại sau tem 3 nên bị coi là tem mới (clip #4).

Sửa trên nhánh thử (luật bản 4, bản dựng 6, 17:28):
- Màn thử giữ một **sổ tem đã quay xong** trong phiên. Tem trong sổ mà đưa vào lại → hiện dải cam đè lên hình camera
  "⚠ Tem … ĐÃ QUAY RỒI (clip #N) — không quay lại", **không mở clip mới và không cắt clip đang quay**. Dải tự tắt sau 3 giây không thấy
  tem đó nữa.
- Dòng đếm "Báo tem đã quay rồi: N lần"; nút **XÓA SỔ TEM** để thử lại từ đầu mà không phải tắt app.
- Tem cũ còn lọt trong khung lúc vừa mở clip mới không bị tính vào clip mới.

Việc để lát 1 quyết (em chưa chọn thay anh):
- Bản thật thì "đã quay rồi" phải hỏi SỔ TRÊN MÁY CHỦ theo đơn, không phải sổ trong phiên — hai điện thoại cùng kho, hoặc mở lại app,
  vẫn phải báo.
- Có cho **quay lại** một đơn đã có video không (đóng lại hàng, quay hỏng)? Nếu có thì bằng nút nào, và video cũ giữ hay thay? Màn quét
  Đã đóng gói đang báo "đã đóng gói rồi" — nên theo cùng cách.
- Báo bằng hình thôi thì người đóng hàng không nhìn màn sẽ lỡ → cần tiếng / rung như màn quét đang có.

### 41.3 Cỡ tệp thật: có 0,4 MB cố định mỗi clip

Mỗi tệp dành sẵn khoảng **400 KB ở đầu tệp** cho phần chỉ mục (đo ở cả 5 tệp đã kéo về: phần hình luôn bắt đầu ở byte 400.036), rồi mới
tới hình ≈ 6,1 MB mỗi phút (≈ 809 kbps). Tức là:

| Clip dài | Cỡ tệp ước tính |
|---|---|
| 10 giây | ≈ 1,4 MB |
| 30 giây | ≈ 3,4 MB |
| 60 giây | ≈ 6,5 MB |
| 120 giây | ≈ 12,5 MB |

- Số 5,8 MB/phút ở mục 39.4 và số màn thử hiện ("3,24 MB" cho tệp thật 3,80 MB) **thấp hơn thật**: thư viện báo cỡ phần hình, không tính
  400 KB đầu tệp. Số đúng để tính dung lượng là số trong bảng này.
- 1.000 đơn/ngày → riêng phần cố định đã ≈ 0,4 GB mỗi ngày. Chưa tìm cách giảm (chưa đọc xem thư viện có cho chỉnh không).

### 41.4 Chưa kiểm

Luật bản 4 trên tem (bản dựng 6 chưa ai đưa tem vào); tem giấy thật; tem Shopee / Lazada; tốc độ soi lúc đang quay ở từng mức soi (so
công bằng, cùng một cách đưa tem); cỡ tệp ở cấu hình khác; màn quét cũ trên CameraX mới; iPhone; R2. Pin Note8 còn 11 %, 36,6 °C lúc
17:28, vẫn không sạc qua cáp máy tính. Anh Trung: "Xong lần này để anh sạc máy tối làm tiếp."


## 42. Thời lượng clip tùy ngành hàng — có đơn đóng 15 phút (anh Trung, 14/11 ~17:40)

> Anh Trung: "Anh chỉ mới test phần cắt clip theo tem thôi. Còn về thời gian thì còn tùy so với ngành hàng nữa. Cần phải tham khảo thêm,
> có những sản phẩm đóng gói mất 15 phút là chuyện bình thường. Lát tiếp theo là làm gì em nhỉ"

### 42.1 Hệ quả (tính từ số đo ở mục 41.3: 0,4 MB cố định + 6,1 MB mỗi phút ở 720p · 800k · 15 khung hình/giây)

| Clip dài | Cỡ tệp ước tính | Lưu R2 một tháng (0,015 USD / GB) |
|---|---|---|
| 1 phút | ≈ 6,5 MB | ≈ 0,0001 USD |
| 5 phút | ≈ 31 MB | ≈ 0,0005 USD |
| 15 phút | ≈ 92 MB | ≈ 0,0014 USD |

- Một đơn 15 phút tốn chỗ gấp khoảng 14 lần một đơn 1 phút. **Thu theo số đơn mà không có trần thời lượng thì shop đóng lâu được lợi, shop
  đóng nhanh gánh.** Ship Xanh thu theo phút (mục 28) nhiều khả năng vì lý do này. Anh đã chốt thu theo đơn — em không đề xuất lại theo GB;
  điều cần thêm vào câu T1–T3 là: mỗi đơn gồm tối đa bao nhiêu phút, quá thì tính thế nào.
- **Luật tự dừng clip (mục 39.6, 40.5) không được là một số giây ngắn cố định.** Phải theo shop / ngành hàng, hoặc chỉ dừng khi có tem kế
  / người đóng bấm.
- Tải lên: tệp 92 MB phải tải theo từng mảnh và nối lại được khi rớt mạng (R2 cho mảnh tối thiểu 5 MiB, PHẦN 3) — tải một lần cả tệp
  không còn hợp lý.
- Điện thoại: quay liên tục 15 phút mỗi đơn, cả ca → nóng máy / pin là rủi ro thật. Lần thử hôm nay máy lên 36,6 °C sau các clip ngắn.

### 42.2 Chưa có số

Thời gian đóng gói thật theo từng ngành hàng (chưa đo ở kho nào, chưa hỏi khách); quay 15 phút liên tục trên điện thoại có nóng / sập
không; bitrate thấp hơn (hoặc 480p) còn đọc được tem không — nếu được thì clip dài rẻ hơn nhiều.

### 42.3 Việc tiếp theo em đề xuất: làm nốt lát 0, chưa sang lát 1

1. Thử lại bản dựng 6 (báo tem đã quay rồi) — tối 14/11, anh sạc máy xong.
2. **Quay dài 15–20 phút một clip** trên máy cắm sạc: nhiệt độ, pin, cỡ tệp, tệp có mở / tua được không, đang quay dài có còn đọc tem kế không.
3. Tem giấy thật của cả ba sàn (mỗi hãng vận chuyển một tem): tem có mấy mã, mã gì, đọc ở khoảng cách đóng hàng thật.
4. Mở lại các màn quét cũ của app trên nhánh thử (CameraX bị kéo lên bản thử nghiệm, mục 38.3).
5. Tải thử lên R2: tệp 6 MB và tệp 92 MB, có rớt mạng giữa chừng, có tắt app giữa chừng — cần anh tạo tài khoản R2.
6. iPhone — sau cùng.

Lát 1 (quay trong app thật + tải lên + ô dưới Giá vốn) chỉ nên bắt đầu khi 2, 3, 4 có số, và anh chốt: nơi chạy dịch vụ video (Q1), cách
xóa (Q5), "đơn" tính thế nào + trần phút mỗi đơn (T1–T3), có cho quay lại đơn đã có video không (mục 41.2). Bản app 1.4.3 cũng phải nộp
xong trước.


---

# PHẦN 6 — Khảo sát: các app để trần THỜI GIAN hay trần DUNG LƯỢNG, chạm trần giữa đơn thì sao (14/11 tối)

> Anh Trung: "Vậy thì bây giờ anh cần em khảo sát các ứng dụng trên thế giới họ để trần thời gian hay trần dung lượng. Mình tham khảo thì
> sẽ tốt hơn vì người ta đã nghiên cứu kỹ rồi. Trong trường hợp trần dung lượng mà khách hàng chưa đóng xong đơn thì thế nào? Khách cần mua
> thêm dung lượng hay phương án như thế nào"

Cách làm: ba lượt tra song song (Việt Nam + Đông Nam Á · Trung Quốc · quốc tế), chỉ đọc trang công khai, không tạo tài khoản. 45 sản phẩm.

**Độ tin của số liệu — đọc trước:**
- Phần lớn trang được đọc qua công cụ tóm tắt → câu chữ dưới đây là diễn lại, không phải trích nguyên văn. Trước khi dùng một con số để
  chốt giá, mở lại đường dẫn.
- Dohana, EPack, Ship Xanh: một số điều lấy từ **tệp mã / tệp chữ mà web app của họ phát công khai** (không đăng nhập). Nó cho biết app được
  viết để làm gì, không phải thứ em thấy chạy trong tài khoản thật.
- "Không thấy" = không có trên trang công khai đọc được, chưa phải "không có".

## 43. Họ bán theo cái gì

| Trục bán | Ai dùng | Nhận xét |
|---|---|---|
| **GB + số ngày lưu** | Dohana (40 / 120 / 200 GB), Ecombox (50 GB – 1 TB, theo năm), EPack (5 / 50 / 130 / 250 GB), CamBox, Cam Check, ASC-Cloud; Realpacking (Hàn, 15 / 30 / 50 GB mỗi giấy phép mỗi tháng) | **kiểu chính ở Việt Nam**, hiếm ở nước ngoài |
| **Số đơn / số video mỗi tháng + số ngày lưu** | DispatchO, Boxwitness, VuDrop, PallasMark, Parcel Proof Video, PackRight (bản Shopify), Simple Replay, Dobybot (mua trước, hạn 24 tháng) | **kiểu chính ở quốc tế** |
| **Phút / giờ video** | Ship Xanh ("từ 18 đ / phút video được ghi", trừ ví nạp trước), PackCapture (khối 200 giờ) | thiểu số |
| **Số đơn + số giờ video cùng lúc** | PackFlow (Malaysia): 1.000 đơn + 40 giờ · 5.000 đơn + 200 giờ · 20.000 đơn + 800 giờ → ngân sách ≈ 2,4 phút mỗi đơn | sát bài toán của mình nhất |
| **Giá mỗi video theo cỡ tệp × số ngày lưu** | TrackVid (Ấn Độ): số điểm trừ cho một video tùy bậc MB và 30 / 60 / 90 ngày | cùng ý: video to trả nhiều hơn |
| **Theo bàn / giấy phép, không trần** | Rabot, vAudit (bản bán thẳng), ASCAM, Effitrack, 慧录云, MFEC | lưu trên máy khách hoặc lưu không giới hạn |
| **Không bán lưu trữ (máy / đầu ghi của khách)** | gần hết Trung Quốc: 码上录, PutPack, 万里牛, 聚水潭, 旺店通, Hikvision, TP-LINK; BigSeller | không có gì để chạm trần ngoài ổ đĩa |

Bậc miễn phí hay dùng trần SỐ ĐƠN MỖI NGÀY: 码上录 20 đơn/ngày, PutPack 50/ngày, Simple Replay 20 video/ngày.

## 44. Trần thời lượng cho MỘT video

Thiểu số có. Ở đâu có thì hầu hết là **chốt an toàn chống quên tắt máy, do chủ shop chỉnh được**, không phải cách tính tiền.

| Sản phẩm | Trần | Chạm trần thì |
|---|---|---|
| Dohana | mặc định 5 phút (không thấp hơn 5, nâng được theo tài khoản) | báo trước 30 giây rồi tự dừng và lưu; không tách tệp |
| EPack | chủ shop tự đặt, hai chế độ | "nhắc": nhắc rồi quay tiếp, lưu bình thường · "cứng": dừng và **bỏ luôn lần quay đó** |
| UpSeller | chủ shop đặt cả tối thiểu lẫn tối đa | tới tối đa thì tự dừng và lưu; chưa đủ tối thiểu thì chưa cho quét đơn kế |
| Unicommerce UniCapture | 2 phút, quản lý nâng được | tự dừng và lưu |
| TrackVid | không có trần | tới 5 phút hiện đếm ngược, 1 phút sau dừng **trừ khi người đóng bấm quay tiếp** |
| 慧录云 | tự chọn 30 giây / 1–10 phút / không giới hạn | tự dừng và lưu |
| Realpacking | tự đặt; có thêm lựa chọn tự tách theo khoảng | kết thúc và lưu |
| EasyEcom | có trần, không công bố số (một đoạn trích tìm kiếm nói 20 phút — chưa kiểm được) | dừng; quét tiếp cùng đơn thì ra bản ghi mới |
| PallasMark · Parcel Proof Video | **trần theo gói**: 3 / 5 phút · 30 giây / 1 / 3 / 5 phút | không ghi |
| Ecombox | trong tệp chữ của trang có bộ gói cũ / chưa dùng: 10 phút · 15 phút · không giới hạn theo gói | chưa xác nhận đang chạy |
| ASCAM, BigSeller, TOPWMS, 吉客云, Boxwitness, Eshopbox | không trần | TOPWMS tự dừng sau 10 phút không thao tác; BigSeller tự dừng khi hình đứng yên N giây |

**Luật sàn Trung Quốc cấm cắt video.** Douyin (bản lấy ý kiến 23/07/2026) và Taobao đều đòi video đóng hàng / khui hàng liền một mạch, không
cắt, không quay từng đoạn — quay từng đoạn là chứng cứ không hợp lệ. Vì vậy không hãng nào tự tách video của một đơn khi chạm trần. Shopee /
TikTok / Lazada ở Việt Nam chưa thấy luật tương tự (chưa tra), nhưng đây là lý do để **không bao giờ tự cắt đôi video của một đơn**.

## 45. Hết hạn mức thì sao — câu anh hỏi

**Không sản phẩm thương mại nào ghi là cắt ngang video đang quay vì hết hạn mức.** Hành vi được ghi ra chia sáu kiểu:

| Kiểu | Ai | Chi tiết |
|---|---|---|
| A. Quay tiếp, tự tính phí vượt | DispatchO · VuDrop · Parcel Proof Video | DispatchO viết thẳng: việc quay không bao giờ dừng ở hạn mức; đơn vượt tính theo đơn giá của gói (₹0,5–2 / đơn), cộng vào hóa đơn kỳ sau. VuDrop: mỗi clip vượt trừ một "lượt tải lên" mua thêm (≈ 49,5 won). |
| B. Quay tiếp, chỉ nhắc nâng gói | Boxwitness gói trả tiền | không phí vượt |
| C. Chặn video MỚI cho tới khi nạp / nâng / sang kỳ | TrackVid · PallasMark · Dohana (màn khóa "hết gói lưu trữ") · PackFlow ("có thể tạm dừng") · Boxwitness miễn phí | Boxwitness ghi rõ: **hộp đang đóng dở vẫn được lưu**. Dohana cảnh báo đỏ khi còn cách trần 500 đơn vị. TrackVid báo nhiều lần khi gần hết. |
| D. Vẫn quay, giữ trên máy, tải lên bị từ chối | EPack | video nằm trên thiết bị 7 ngày; chủ shop nâng gói hoặc xóa bớt rồi bấm Thử lại. Không xóa gì của khách. |
| E. Mua thêm dung lượng | Ecombox: 2.000 đ / GB / tháng · 吉客云: phải mở rộng hoặc dọn trước ngày hôm sau | Ecombox không ghi là tự tính hay phải mua trước rồi mới quay tiếp |
| F. Tự xoay vòng, ghi đè bản cũ nhất | PackRight (Shopify) · ASC-Cloud · đầu ghi TP-LINK | rủi ro: mất đúng video đang cần cho khiếu nại |

Ngoài ngành, để đối chiếu: Zoom — đang ghi mà đầy dung lượng thì ghi nốt cuộc họp rồi mới khóa (theo trả lời trên diễn đàn Zoom, chưa đối
chiếu bài chính thức); Loom bản miễn phí — đếm ngược từ 5:00, hết giờ là dừng; Cloudflare Stream — vượt số phút đã mua thì từ chối tệp tải
lên; Mux — không trần, tính tiền theo phút.

Khi tới hạn thanh toán mà không trả: DispatchO dừng quay sau 15 ngày có báo trước nhưng **không xóa sớm** video đã lưu; EPack hạ về gói miễn
phí sau 3 ngày, không xóa; Dohana khóa sau 2 ngày, xóa dữ liệu sau 1 tháng.

## 46. Cỡ tệp người ta công bố (để so với số mình đo: 0,4 MB + 6,1 MB / phút)

| Nguồn | Số |
|---|---|
| Dohana (máy tính trên trang) | ≈ 30 MB / phút; 10 GB ≈ 150–250 video; web app quay 1280×720, 30 khung hình/giây |
| EPack (máy tính trên trang) | ≈ 12 MB / phút, cảnh nhiều chi tiết ≈ 17 MB |
| MFEC (Trung Quốc) | ≈ 2 MB / giây, khuyên 2 TB mỗi bàn cho 30 ngày |
| Dobybot | ≈ 20 MB / video (em tự chia GB cho số video trong bảng gói) |
| TrackVid | bậc mặc định "dưới 50 MB" một video |

Tệp của mình nhỏ hơn Dohana khoảng 5 lần và EPack khoảng 2 lần — nhưng mới đo ở 720p · 800k · 15 khung hình/giây với ảnh tem trên màn hình,
chưa biết mức đó có đủ nét cho tem giấy và cho khiếu nại không.

## 47. Rút ra cho Hubsell — đề xuất của em, anh chưa chốt

1. **Giữ thu theo số đơn** (anh đã chốt). Đây cũng là kiểu chính của quốc tế; GB là kiểu Việt Nam, và là kiểu sinh ra đúng câu anh hỏi
   "đầy giữa chừng thì sao".
2. **Không lộ trần dung lượng ra cho khách.** Khách không biết một đơn nặng bao nhiêu MB; mình biết.
3. **Xử lý đơn đóng lâu bằng "lượt", không bằng GB:** một lượt = một video tới N phút; video dài hơn thì cứ mỗi N phút tính thêm một lượt.
   Cùng ý với PackFlow (đơn + giờ video) và TrackVid (giá theo bậc cỡ tệp), nhưng khách chỉ phải hiểu một đơn vị. Con số N chưa chọn: 5 phút
   là mốc Dohana, TrackVid, PallasMark cùng dùng; mình cần số thời gian đóng gói thật theo ngành trước khi chốt.
4. **Chạm hạn mức thì KHÔNG dừng quay, KHÔNG cắt video đang quay** — theo kiểu A (DispatchO). Lượt vượt cộng vào hóa đơn kỳ sau theo đơn
   giá của gói. Hubsell đã có sẵn cơ chế phí vượt tính thẳng cho gói chính (11/11), dùng lại được. Báo trước ở 80 % và 100 %.
5. **Trần thời lượng một video = chốt an toàn do chủ shop đặt, kiểu "nhắc rồi cho quay tiếp"** (TrackVid, EPack chế độ nhắc). Không dùng
   kiểu dừng cứng, càng không dùng kiểu bỏ video (EPack chế độ cứng). Đây cũng là lời giải cho việc "máy úp trên bàn vẫn quay" (mục 39.6).
6. **Không bao giờ tự cắt đôi video của một đơn** (luật Douyin / Taobao; ở Việt Nam chưa tra nhưng không có lý do làm khác).
7. **Không xoay vòng ghi đè bản cũ** (kiểu F). Video chỉ bị xóa theo luật vòng đời đã bàn (mục Q5).
8. **Khách nợ tiền:** dừng nhận video mới sau một thời hạn có báo trước, không xóa sớm video đã lưu (DispatchO, EPack).

Việc còn phải anh chốt (thêm vào T1–T3): N phút mỗi lượt; đơn giá lượt vượt; có cho shop tự đặt "chặn khi hết hạn mức" thay vì tính phí vượt
không (một số chủ shop sợ hóa đơn bất ngờ hơn là sợ thiếu video).

## 48. Chưa kiểm được

- Ship Xanh: hết tiền trong ví thì quay tiếp hay khóa; đầu trên của giá theo phút (trang công khai chỉ ghi "từ 18 đ", ảnh khách gửi anh
  ghi 18–25 đ).
- Dohana: ai đặt số phút và trần trên là bao nhiêu; khóa có nổ giữa lúc đang quay không.
- Ecombox: mua thêm GB là tự tính hay phải mua trước; bộ gói có trần 10 / 15 phút có đang chạy không.
- Simple Replay, CamBox, Cam Check, Dobybot, PackFlow, Realpacking: hết hạn mức thì sao — không công bố.
- 旺店通, 聚水潭, 万里牛: trung tâm trợ giúp phải đăng nhập, không đọc được.
- Luật chứng cứ video của Shopee / TikTok Shop / Lazada Việt Nam (có cấm video cắt đoạn không, giới hạn cỡ tệp khi nộp).
- Thời gian đóng gói thật theo ngành hàng — vẫn chưa có số.

## 49. Nguồn (phần 6)

Việt Nam + Đông Nam Á: donghangnhanh.vn/vi · donghangnhanh.vn/vi/term · dhn.io.vn (tệp mã công khai) · app.shipxanh.com/locales/vi/translation.json ·
shipxanh.com/bang-gia · ecombox.vn/plans · epack.vn · epack.vn/chinh-sach-bao-mat · epack.vn/huong-dan/ket-noi-san-va-quay-video ·
atpsoftware.vn/simple-replay · ghihinh.com/bang-gia · quayvideo.com/faq · quayvideodongdon.com · cambox.vn · effitrack.me/cac-goi-giai-phap ·
upseller.com/es/help-doc-article-3395 · help.bigseller.com/en_US/detailPage/25/1/9312/content · dobybot.com/pricing · pack-flow.app/faq ·
pack-flow.app/terms · apps.shopify.com/packflow-2 · trang App Store của Dohana, Ecombox, Carrot Packing.

Quốc tế: dispatcho.in · dispatcho.in/faq · dispatcho.in/terms · trackvid.in/pricing.html · trackvid.in/features/video-management-system.html ·
apps.shopify.com/packright-1 · vaudit.ai/pricing · support.easyecom.io/portal/en/kb/articles/vms · support.unicommerce.com/?p=16193 ·
help.eshopbox.com/portal/en/kb/articles/parcel-proof · realpacking.com/ko/pricing · docs.realpacking.com · vudrop.com/pricing · vudrop.com/terms ·
boxwitness.com/pricing · boxwitness.com/faq · rabot.us/pricing · pallasmark.com/pricing · apps.shopify.com/parcel-proof-video ·
support.atlassian.com/loom/docs/how-long-can-i-record · developers.cloudflare.com/stream/faq · mux.com/docs/pricing/video.

Trung Quốc: mashanglu.cn · tokrec.cn · app.putpack.cn · hrbmofei.com · topwms.com/warehouse_help_center/article_10041.html ·
jackyun.com/official/cloudDetail.html?courseCode=KC202212050009 · hikmall.com/solution/detail?contentId=1441670 · tp-link.com.cn/product_3651.html ·
github.com/PackingProof/PackingProof-Desktop · github.com/yuge-hk/pack-record · school.jinritemai.com/doudian/web/articlev0/aJnt1AHYq6ar (Douyin) ·
helpcenter.taobao.com/servicehall/knowledge_detail?kwdContentId=683571945267259392 (Taobao).


## 50. Anh nêu hướng: bán gói theo SỐ PHÚT (14/11 tối) — em đồng ý, anh chưa chốt số

> Anh Trung: "Nếu bán gói theo số phút thì sao? Mình ngầm hiểu là một video khoảng 1 phút chẳng hạn rồi các gói sẽ tính theo như vậy. Ví
> dụ mình cân gói 100 video mặc định bán 100 phút với giá bao nhiêu đó. Như vậy khách hoàn toàn có thể quay video theo kiểu đó là thích quay
> bao nhiêu lâu cũng được."

### 50.1 Vì sao em thấy hướng này tốt hơn đề xuất "lượt" của em ở mục 47

- **Chi phí của mình chạy đúng theo phút.** Tệp = 0,4 MB cố định + 6,1 MB mỗi phút (mục 41.3). Lưu R2 0,015 USD / GB / tháng → khoảng
  0,00009 USD cho một phút video lưu một tháng, tức ≈ 2,3 đ nếu tính 25.000 đ một USD (tỷ giá em tự lấy tròn). Mới là tiền chỗ chứa; chưa
  tính lượt ghi, máy chủ, hỗ trợ.
- **Không cần trần thời lượng, không cần luật làm tròn "mỗi N phút một lượt".** Đơn 15 phút dùng 15 phút, hết.
- **Có tiền lệ:** Ship Xanh (18–25 đ / phút), PackFlow (đơn + giờ video), PackCapture (khối 200 giờ).
- Thay đổi so với điều anh chốt trước ("tính theo số đơn"): đơn vị bán đổi từ đơn sang phút; lý do thu theo dùng thật thay vì theo GB vẫn
  giữ nguyên.

### 50.2 Năm điều phải định cùng lúc, không thì hướng này phản tác dụng

1. **Tên gói phải là PHÚT, "≈ N video" chỉ là dòng phụ.** Bán "gói 100 video" mà shop đóng 3 phút một đơn chỉ quay được 33 đơn → khách
   thấy bị lừa.
2. **Trừ theo GIÂY, hiển thị theo phút.** Làm tròn lên một phút mỗi video thì shop đóng 20 giây một đơn trả gấp ba. Phần cố định 0,4 MB mỗi
   tệp chỉ tương đương khoảng 4 giây video, nên không cần mức tối thiểu lớn.
3. **Clip quay thừa giờ là tiền của KHÁCH.** Lần thử 14/11: 100 trên 173 giây là cảnh mặt bàn. Thu theo phút thì mình hưởng lợi từ việc
   khách quên tắt — phải có nhắc khi quay lâu / không thấy hoạt động (mục 47 điểm 5), không thì mất lòng tin.
4. **Giá một phút gắn với một số ngày lưu cố định.** Lưu 30 ngày và lưu 90 ngày chênh chi phí gấp ba. Hoặc mỗi gói một số ngày lưu, hoặc
   có bậc giá theo ngày lưu (TrackVid làm vậy).
5. **Hết phút thì sao** — vẫn là câu ở mục 45: quay tiếp + tính phút vượt (em nghiêng về cách này), hay khóa đơn mới cho tới khi nạp. Kèm:
   phút dư cuối tháng có cộng dồn không (gói tháng), hay bán kiểu ví nạp trước như Ship Xanh.

### 50.3 Mốc giá để anh cân (chưa phải đề xuất giá)

| Mốc | đ / phút |
|---|---|
| Tiền chỗ chứa của mình, lưu 30 ngày | ≈ 2,3 |
| Ship Xanh, lưu trên máy khách | 18–21 |
| Ship Xanh, lưu cloud 30 ngày | 22–25 |
| Thang ví dụ em tự đặt ở mục 24.2 (1.000 → 30.000 video / tháng), nếu coi 1 video = 1 phút | 39 → 13 |

Quy ra phút thì thang ví dụ ở mục 24.2 đắt hơn Ship Xanh ở hai bậc nhỏ (39 và 30 đ) và rẻ hơn ở hai bậc lớn (20 và 13 đ) — khi
chốt giá phải đặt lại cả thang theo phút.

### 50.4 Chưa có

Thời gian đóng gói trung bình thật của khách Hubsell (để biết "1 video ≈ 1 phút" có đúng không); chi phí ngoài chỗ chứa; chất lượng hình
cuối cùng (đổi 720p · 800k thì số MB mỗi phút đổi theo).


## 51. ANH CHỐT cách bán (14/11 tối): gói theo GIỜ, không nhắc phần thừa, hết giờ thì DỪNG

> Anh Trung: "1. Gói 100 giờ, 200 giờ. Kiểu như vậy. Ghi chú khách tự cân đối thời gian quay của một video để chọn gói phù hợp → điều này
> giúp mình việc shop bỏ quên điện thoại mà không quay. 2. Phần thừa: không cần nhắc vì mình có lịch sử quay và video quay rõ ràng. Mình đã
> đóng khung thời gian tổng, khách sẽ phải tự nhanh nhẹn mà làm. 3. Hết thì dừng không cho quay thêm → gói này bán cho người có nhu cầu
> thật nên không sợ họ không gia hạn. 4. Vấn đề cần quan tâm là mình upload video tối đa bao nhiêu MB. 5. Nguyên lý up video theo dạng xếp
> hàng lên từng ngăn hạ tầng lưu trữ hay như thế nào để hàng chục nghìn shop dùng cùng lúc, hàng triệu video tải lên mà không bị ảnh hưởng.
> Đây mới là cái khó."

| Điều | Anh chốt | Thay cho |
|---|---|---|
| Đơn vị bán | **gói theo GIỜ quay** (100 giờ, 200 giờ...), kèm ghi chú khách tự cân thời gian mỗi video | "theo số đơn" (PHẦN 5), "lượt N phút" (mục 47), các thang giá ví dụ theo video (mục 24.2) |
| Quay thừa | **không nhắc**; có lịch sử quay + video để khách tự xem | đề xuất "nhắc rồi cho quay tiếp" của em (mục 47 điểm 5, mục 50.2 điểm 3) — BỎ |
| Hết giờ | **dừng, không cho quay thêm** cho tới khi mua gói mới | đề xuất "quay tiếp + phí vượt" của em (mục 47 điểm 4) — BỎ |

Ba chi tiết em đề xuất thêm để chốt trên chạy được (anh chưa duyệt):
- **Video đang quay dở lúc giờ về 0 thì quay nốt rồi mới khóa.** Không hãng nào cắt ngang (mục 45); phần lố trừ vào gói mua sau.
- **Báo sắp hết giờ** (ví dụ còn 10 %) bằng chuông sẵn có. Đây là báo số dư, khác với nhắc quay thừa mà anh đã bỏ — không có nó thì shop bị
  khóa giữa ca mới biết.
- **Trừ theo giây**, hiển thị theo giờ : phút.

Mốc để anh cân giá gói (tiền chỗ chứa, lưu 30 ngày, 6,1 MB mỗi phút, 25.000 đ một USD — chưa gồm máy chủ, lượt ghi, hỗ trợ):

| Gói | Tiền chỗ chứa của mình | Ship Xanh bán cùng lượng (22–25 đ / phút cloud) |
|---|---|---|
| 100 giờ = 6.000 phút ≈ 37 GB | ≈ 14.000 đ | 132.000–150.000 đ |
| 200 giờ = 12.000 phút ≈ 73 GB | ≈ 27.000 đ | 264.000–300.000 đ |

Chưa chốt: giá từng gói; giờ có hạn dùng không (theo tháng hay mua đứt dùng dần); số ngày lưu.

## 52. Một video tối đa bao nhiêu MB

**Giới hạn của Cloudflare R2** (trang giới hạn + trang tải nhiều mảnh, đọc lại 14/11):

| Giới hạn | Số |
|---|---|
| Một tệp tải MỘT lần | tối đa 5 GiB |
| Một tệp tải theo MẢNH | tối đa 4,995 TiB, tối đa 10.000 mảnh |
| Cỡ mảnh | 5 MiB – 5 GiB; mọi mảnh trừ mảnh cuối phải bằng nhau |
| Mảnh tải dở | tự hủy sau 7 ngày (chỉnh được) |
| Ghi vào CÙNG một tên tệp | 1 lần / giây (mình không bao giờ ghi lại cùng tên) |
| Số tệp, tổng dung lượng một ngăn | không giới hạn |
| Thao tác QUẢN LÝ ngăn | 50 / giây mỗi ngăn — không áp cho đọc / ghi tệp |

Tức là R2 không phải thứ giới hạn. Tệp của mình (720p · 800k · 15 khung hình/giây, mục 41.3):

| Video dài | Cỡ tệp | Cách tải |
|---|---|---|
| 1 phút | ≈ 6,5 MB | một lần |
| 5 phút | ≈ 31 MB | một lần |
| 15 phút | ≈ 92 MB | theo mảnh 8 MiB (11 mảnh) |
| 60 phút | ≈ 366 MB | theo mảnh (44 mảnh) |
| 2 giờ | ≈ 732 MB | theo mảnh (88 mảnh) |

Đề xuất của em (số em tự chọn, chưa đo):
- **Tệp tới 32 MB (≈ 5 phút) tải một lần; lớn hơn thì tải theo mảnh 8 MiB.** Rớt mạng chỉ phải tải lại mảnh đang dở, không phải cả tệp.
- **Trần kỹ thuật một video: 60 phút (≈ 366 MB).** Tới trần thì dừng và LƯU, tem kế mở video mới. Không phải để nhắc khách (anh đã bỏ nhắc),
  mà vì ba rủi ro kỹ thuật: (a) tệp MP4 chỉ đóng chỉ mục khi dừng — máy hết pin / app bị tắt giữa chừng thì nhiều khả năng mất cả video,
  video càng dài mất càng nhiều (**chưa thử**); (b) điện thoại quên qua đêm = một tệp ~3 GB, đầy máy; (c) chưa biết video dài hơn ~20 phút
  thì chỉ mục có còn nằm đầu tệp không (mỗi tệp chỉ dành sẵn 400 KB cho chỉ mục). Ba điều này đo ở bài "quay dài" của lát 0 (mục 42.3).

## 53. Nguyên lý tải lên cho hàng chục nghìn shop, hàng triệu video

### 53.1 Bài toán bằng số (ví dụ: 20.000 shop × 100 video/ngày × 1 phút)

| Thứ | Số |
|---|---|
| Video | 2 triệu / ngày ≈ 23 / giây trung bình, giờ cao điểm ước gấp 3 ≈ 70 / giây |
| Dữ liệu đổ vào | ≈ 13 TB / ngày ≈ 1,2 Gbps trung bình, cao điểm ≈ 3,6 Gbps |
| Đang lưu (giữ 30 ngày) | ≈ 390 TB ≈ 5.850 USD / tháng tiền chỗ chứa |
| Dòng sổ | ≈ 60 triệu / tháng |
| Phí lượt ghi (mỗi video một lần tải) | ≈ 9 USD / ngày |

1,2–3,6 Gbps không bao giờ được đi qua máy chủ Hubsell (worker Render từng đuối băng thông 03/11). Mọi thứ dưới đây xoay quanh điều đó.

### 53.2 Sáu nguyên lý

1. **Video đi THẲNG từ điện thoại lên Cloudflare.** Máy chủ Hubsell chỉ phát "vé tải lên" (đường dẫn có chữ ký, hết hạn sau ít phút) và
   ghi sổ. Triệu video là tải của Cloudflare — thứ họ sinh ra để gánh — không phải của mình.
2. **Hàng chờ nằm trên TỪNG điện thoại, không có hàng chờ chung.** Mỗi máy tự xếp video của nó, tải 1–2 tệp một lúc, rớt thì tự thử lại
   với thời gian chờ tăng dần + lệch ngẫu nhiên. 20.000 shop = 20.000 hàng chờ độc lập; shop này nghẽn không kéo shop khác. Không có điểm
   thắt chung nào để "hàng triệu video" dồn vào.
3. **Quay không bao giờ chờ tải.** Quay xong là tệp nằm trên máy + một dòng trong hàng chờ; người đóng hàng sang đơn kế ngay. Mạng chậm
   thì hàng chờ dài ra, việc đóng hàng không chậm đi.
4. **Một lần gọi máy chủ cho mỗi video, gộp được.** Lúc quét tem: tra đơn + kiểm còn giờ + nhận vé (một lần gọi — đằng nào cũng phải tra
   đơn). Lúc tải xong: báo "đã lên" theo lô (ví dụ 10 video hoặc 60 giây một lần). Cao điểm ≈ 70 lần gọi / giây cho cả hệ — một dịch vụ nhỏ
   gánh được, miễn là nó tách khỏi máy chủ chính.
5. **Sổ video ở database RIÊNG, chia theo tuần.** 60 triệu dòng / tháng không được nằm chung với đơn hàng (Supabase từng cạn Disk IO
   28/10). Hết hạn lưu thì bỏ nguyên tuần, không xóa từng dòng.
6. **"Ngăn" chia theo NGÀY QUAY, xóa bằng luật của Cloudflare.** Tên tệp dạng `v1/<ngày quay>/<shop>/<đơn>-<mã>.mp4`. R2 không giới hạn số
   tệp hay tốc độ ghi theo ngăn, nên chia ngăn KHÔNG phải để chịu tải mà để **xóa rẻ**: một luật "xóa mọi thứ dưới ngày X" thay cho hàng
   triệu lệnh xóa từng tệp.

### 53.3 Khóa khi hết giờ (điều 3 anh chốt) nằm ở đâu

Ở lần gọi lúc quét tem (nguyên lý 4): máy chủ trả "còn giờ / hết giờ". Hết thì app không mở video mới. Giờ được trừ khi video báo "đã lên",
theo thời lượng thật của tệp. Nhiều điện thoại cùng shop dùng chung một số dư trên máy chủ nên không quay lố được quá các video đang dở.
**Mất mạng lúc quét:** em đề xuất vẫn cho quay (nguyên lý 3) và trừ giờ khi có mạng lại, chấp nhận lố một ít — cần anh đồng ý, vì nó nới
điều "hết thì dừng".

### 53.4 Cái khó thật nằm ở điện thoại, không ở Cloudflare

- **Tải khi app chạy nền / bị tắt.** Android hay giết app nền; iPhone chỉ cho tải nền qua cơ chế riêng. Shop đóng 1.000 đơn/ngày mà mạng yếu
  thì hàng chờ dồn tới cuối ca — lúc đó người ta cất điện thoại. Chưa thử; đây là phép đo nặng nhất còn lại của lát 0.
- **Bộ nhớ máy.** Hàng chờ 500 video chưa lên ≈ 3 GB. Cần ngưỡng "máy sắp đầy thì dừng quay" (Carrot chặn ở 200 MB trống).
- **Mạng của shop.** Quay sinh 0,8 Mbps mỗi máy; đường lên của shop phải nhanh hơn thế thì hàng chờ mới không dài mãi. Chưa đo ở shop nào.
- **Dồn sau sự cố.** Cloudflare hoặc máy chủ mình nghẽn 30 phút rồi thông → mọi máy cùng đẩy. Lệch ngẫu nhiên ở nguyên lý 2 là để chặn việc này.

### 53.5 Chưa kiểm / cần anh chốt

- Chưa thử tải lên R2 lần nào (cần tài khoản R2 của công ty). Tốc độ tải từ Việt Nam lên R2 chưa đo; R2 không có vùng lưu riêng ở châu Á (PHẦN 3).
- Đường dẫn có chữ ký cho tải THEO MẢNH: trang R2 không nói rõ, phải thử.
- **Số ngày lưu.** Nguyên lý 6 chỉ rẻ khi hạn lưu tính từ NGÀY QUAY (ví dụ 30 / 45 / 60 ngày cố định theo gói) — mọi đối thủ đều làm vậy.
  Cách "giữ tới khi hết hạn khiếu nại của từng đơn" (mục 24.2, Q5) thì mỗi tệp một hạn riêng, xóa đắt và phức tạp hơn nhiều ở quy mô này.
  Em đề xuất: cố định N ngày từ ngày quay, riêng đơn đang có yêu cầu hoàn / khiếu nại thì giữ thêm. Cần anh chốt N.
  **(sửa 14/11 tối: anh chốt giữ theo từng đơn; xóa không đắt như em viết — xem mục 54.)**
- Các con số 32 MB, 8 MiB, 60 phút, lô 10 video / 60 giây, hệ số cao điểm ×3 là số em tự chọn để tính, chưa có số đo.


## 54. ANH CHỐT cách xóa (14/11 tối): giữ tới qua hạn khiếu nại, hệ thống TỰ XÓA theo trạng thái đơn

> Anh Trung: "Lưu video thì tất nhiên là lưu tới qua hạn khiếu nại. Nhưng vẫn phải đảm bảo các tiêu chuẩn hệ thống của mình tự xóa video
> các đơn hàng hủy, hủy ngang, đã đối soát, hết hạn khiếu nại chứ."

### 54.1 Em rút đề xuất "cố định N ngày từ ngày quay" (mục 53.5) — và sửa một điều em nói sai

Ở mục 53.5 em viết xóa theo từng đơn "đắt và phức tạp hơn nhiều". **Phần "đắt" là sai.** Đọc lại bảng giá và bảng lệnh của R2 (14/11):
- Lệnh xóa tệp **miễn phí**; R2 Standard **không có thời gian lưu tối thiểu** (xóa sớm không bị tính bù).
- Có lệnh xóa theo lô (nhiều tệp một lần gọi). 2 triệu tệp / ngày ≈ vài nghìn lần gọi / ngày.
- R2 **không hỗ trợ gắn nhãn cho tệp**, nên không dùng được kiểu "gắn nhãn hết hạn rồi để Cloudflare tự xóa" — hạn xóa của từng video phải
  nằm trong sổ của mình.

Phần "phức tạp hơn" thì đúng, nhưng nằm ở sổ chứ không ở kho: sổ video phải biết trạng thái đơn.

### 54.2 Luật xóa = bảng L1–L7 ở mục 12.2 (đã có từ lần khảo sát một), đối chiếu với bốn loại anh nêu

| Anh nêu | Luật trong bảng 12.2 | Ghi chú |
|---|---|---|
| Đơn hủy ngang (kiện CHƯA rời kho) | L2: xóa sau 24 giờ | 24 giờ là số em tự chọn, phòng trạng thái sàn về trễ |
| Đơn hủy (kiện ĐÃ giao hãng, quay đầu) | L3: giữ tới khi kho quét nhận kiện + 7 ngày; kho báo hỏng / mất thì giữ tiếp | video đóng hàng là bằng chứng đòi hãng vận chuyển khi kiện về thiếu / hỏng |
| Hết hạn khiếu nại | L4: xóa ở ngày giao + 20 ngày (LazMall + 35) | prod: yêu cầu hoàn muộn nhất 15,3–15,6 ngày TikTok, 16,2 ngày Shopee |
| Đang có yêu cầu hoàn / khiếu nại | L5: giữ tới khi ca đóng + 10 ngày | |
| Trần cứng | L6: xóa ở ngày thứ 90 từ lúc quay | Shopee không cho giữ dữ liệu người mua quá 90 ngày |
| **Đã đối soát (tiền về)** | **không phải mốc xóa** | xem 54.3 |

### 54.3 Riêng "đã đối soát": em đề nghị KHÔNG dùng làm mốc xóa một mình

Số prod (mục 12.1, 16): TikTok đối soát khoảng 2,5 ngày sau giao, người mua còn xin hoàn tới ngày 15. **Tháng nào cũng có 19–64 % yêu cầu
hoàn đến SAU khi đơn đã đối soát.** Xóa lúc tiền về là mất bằng chứng đúng ở những ca cần nó. Câu "lưu tới qua hạn khiếu nại" của anh đã
phủ ca này: đơn đã đối soát VÀ đã qua hạn khiếu nại thì xóa (chính là L4).

Nếu "đã đối soát" anh nói là **đối soát đơn hoàn của Hubsell** (kho đã quét nhận kiện hoàn, không lệch) thì đó là mốc xóa hợp lệ — đang
nằm trong L3 / L5.

### 54.4 Cách chạy ở quy mô lớn (thay nguyên lý 6 của mục 53.2)

1. **Mỗi video trong sổ có một "hạn xóa".** Lúc tải lên, hạn = ngày quay + 90 (L6).
2. **Đơn đổi trạng thái thì hạn xóa đổi theo**: hủy trước khi gửi → +24 giờ; đã giao → ngày giao + 20; có yêu cầu hoàn → bỏ hạn, chờ ca đóng.
   Máy chủ chính đã biết các mốc này (sổ đơn, Đối soát đơn hoàn); việc mới là báo sang sổ video.
3. **Một bộ dọn chạy định kỳ**: lấy các video quá hạn, xóa theo lô, đánh dấu vào sổ. Không quét kho, không quét bảng đơn.
4. **Lưới an toàn:** một luật duy nhất của Cloudflare trên cả kho — "xóa mọi tệp già hơn 90 ngày". Sổ có lỗi / mất tin báo thì video vẫn
   không nằm quá trần. Tên tệp vẫn chia theo ngày quay để dễ kiểm.
5. **Không cần ngăn "giữ" riêng** (trả lời Q6): "giữ" chỉ là một cờ trong sổ. Trần 90 ngày vẫn áp cho cả video đang giữ.
6. **Chạy bóng trước** (lát 3): bộ dọn chỉ ghi "sẽ xóa tệp nào, vì luật nào" vài tuần, đối chiếu với đơn thật rồi mới cho xóa thật.

Với gói theo giờ (mục 51), xóa sớm không ảnh hưởng số giờ của khách — giờ đã trừ lúc quay. Xóa sớm là tiền chỗ chứa mình tiết kiệm.

### 54.5 Chưa kiểm

Lệnh xóa theo lô của R2 nhận tối đa bao nhiêu tệp một lần (trang không ghi); luật Cloudflare xóa trễ tới 24 giờ (PHẦN 3); cách báo trạng
thái đơn sang sổ video mà không thêm tải cho database chính (thiết kế ở lát 3); tỷ lệ đơn hủy trước khi gửi trên prod (dữ liệu hiện không
tách được "hủy trước khi gói" và "hủy sau khi gói", mục 8).
