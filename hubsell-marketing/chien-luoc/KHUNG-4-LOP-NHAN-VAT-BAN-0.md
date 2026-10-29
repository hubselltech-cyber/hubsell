# Khung 4 lớp nhân vật "Trợ lý Hubsell" — bản 0 (29/10/2026, CHƯA CÓ NỘI DUNG)

Theo mục 5.1 bản phản biện 25/10 (anh chốt 27/10): nhân vật **học từ hội thoại người thật** bằng 4 lớp tài liệu nạp thẳng vào prompt (prompt caching), **không fine-tune**. Tệp này chỉ là **khung**: mục nào, ghi thế nào, đánh dấu thế nào. Nội dung điền khi anh gửi 20–30 hội thoại mẫu và khi chạy bóng có dữ liệu.

Luật đứng trên mọi lớp: **không bịa số**, bảng khả năng từng sàn (định vị 15/10 mục 4) thắng văn phong; mẫu nào hứa vội hay nói số ước chừng → loại khỏi lớp 2 dù khách đã chịu. Tin do AI gửi ký "— Trợ lý Hubsell" (Luật 134/2025 Điều 11 k.1).

---

## 0. Quy tắc ẩn danh (áp cho MỌI mẫu trước khi vào kho)

| Thứ trong hội thoại gốc | Thay bằng | Ghi chú |
|---|---|---|
| Tên khách, tên Zalo | `[KHÁCH]` | kể cả biệt danh, tên con |
| SĐT, email, link cá nhân, địa chỉ | **bỏ hẳn** | không giữ dạng che `09xx` |
| Tên gian hàng / shop | `[GIAN]` | tên sản phẩm riêng cũng thay nếu nhận ra được chủ |
| Số doanh thu, số đơn, số tiền của khách | `[SỐ]` | giữ **đơn vị + độ lớn tương đối** nếu cần ý ("vài trăm đơn/ngày" → `[SỐ] đơn/ngày`) |
| Ảnh, file khách gửi | **không lấy**; ghi `[ẢNH: mô tả 1 dòng]` | mô tả không chứa số/tên |
| Tên anh Trung | giữ "anh Trung" | là người của Hubsell |
| Tên sàn, tên tính năng Hubsell, số phí sàn công khai | giữ nguyên | là tri thức chung |

Mỗi hội thoại sau ẩn danh có mã `HT-001…`, **không lưu bảng đối chiếu** mã ↔ khách (để không khôi phục được). Thư mục thô (chưa ẩn danh) `hubsell-marketing/khach-hang/mau-hoi-thoai-tho/` **không commit**; thư mục đã ẩn danh `hubsell-marketing/khach-hang/mau-hoi-thoai/` commit được.

---

## 1. Lớp 1 — Văn phong (anh duyệt)

Mỗi mục một câu luật + 1–2 ví dụ **trích từ mẫu thật** (mã HT). Chưa điền.

| Mục | Luật (điền sau) | Ví dụ từ mẫu |
|---|---|---|
| Xưng hô (em / anh-chị; khi nào "mình") | | |
| Độ dài một tin, nhịp 2–3 tin ngắn hay 1 tin | | |
| Câu mở hội thoại | | |
| Câu chốt / câu hẹn | | |
| Từ lóng seller được dùng (đơn ảo, cắn phí, escrow, hòa vốn ROAS…) — chỉ khi khách dùng trước? | | |
| Chữ chuyên môn tránh khi khách chưa dùng | | |
| Dấu câu, emoji, viết tắt | | |
| Cách nói "không biết" / "em hỏi lại anh Trung" | | |
| Cách từ chối (giảm giá, hứa tính năng) | | |

**Cách ghi phản ví dụ:** câu máy nháp bị anh sửa nhiều → ghi cặp `nháp → câu anh gửi` dưới mục tương ứng, đánh `✘`.

---

## 2. Lớp 2 — Kịch bản theo ý định (anh đánh dấu tốt/xấu)

Danh mục ý định **khởi điểm (tự chọn, sẽ chỉnh theo mẫu thật)**:

| Mã | Ý định | An toàn cho lát 1? |
|---|---|---|
| I-01 | Hỏi giá / gói | ✔ (chỉ đọc bảng giá, không giảm) |
| I-02 | Hỏi "có hỗ trợ sàn X không" | ✔ (bảng khả năng từng sàn) |
| I-03 | Hỏi cách nối gian / nối gian làm sao | ✔ |
| I-04 | Ngại nối gian (sợ lộ dữ liệu, sợ sàn khóa) | ✔ có mẫu, ✘ nếu hỏi sâu bảo mật |
| I-05 | So với công cụ khác | ✔ không nói xấu đối thủ, không bịa |
| I-06 | Hỏi thuế / phí cho ca riêng của họ | ✘ chuyển người + "đối chiếu kế toán" |
| I-07 | Hỏi số của gian họ (ROAS, lãi lỗ) | ✘ chuyển người (cần vào HQ) |
| I-08 | Lỗi nối gian / lỗi app | ✘ phiếu kỹ thuật |
| I-09 | Đòi giảm giá / xin dùng thử dài | ✘ chuyển người |
| I-10 | Nổi nóng / phàn nàn | ✘ chuyển người ngay |
| I-11 | Rác / không liên quan | ✔ trả lời ngắn hoặc im |
| I-12 | Khách tự nói đã xong (nối gian xong, mua xong) | ✔ cảm ơn + bước kế |

**Mỗi mẫu trong lớp 2 ghi theo mẫu này:**

```
### HT-0xx · I-0y · kết cục: nối gian | trả tiền | im | từ chối
Bối cảnh (1 dòng, đã ẩn danh):
Khách: …
Anh: …
Khách: …
Anh: …
Đánh dấu: ✔ dùng làm mẫu | ✘ không dùng (lý do: hứa vội / số ước chừng / lệch định vị / khách không chịu) | ? chờ anh
Điểm đáng học (1–2 gạch đầu dòng):
```

Lúc trả lời, máy lấy **3–5 mẫu ✔ cùng ý định** gần nhất làm few-shot. Mẫu ✘ vẫn giữ (để biết tránh), không nạp vào prompt.

---

## 3. Lớp 3 — Lúc chuyển người (anh duyệt)

Hai nguồn: (a) luật đặt trước (I-06…I-10 ở trên), (b) **điểm anh tự nhảy vào** khi chạy bóng — máy ghi mọi hội thoại mà `oa_send_text` có `admin_id` xuất hiện **sau** khi AI đã có nháp, kèm câu khách ngay trước đó.

| Mục | Điền sau |
|---|---|
| Tín hiệu trong câu khách khiến anh nhảy vào (từ ngữ, kiểu câu) | |
| Câu AI nên nói khi chuyển ("em nối anh Trung, …") — độ dài, có hẹn giờ không | |
| Việc AI làm trước khi chuyển (tóm tắt cho anh, hỏi thêm 1 câu, hay chuyển ngay) | |
| Khi anh đã trả lời xong, AI tiếp lại thế nào (im / cảm ơn / hỏi bước kế) | |
| Khách hỏi "em là người hay máy" | trả lời thật, 1 câu, không xin lỗi dài |

Mỗi dòng có ví dụ HT.

---

## 4. Lớp 4 — Kiến thức kỹ thuật đã kiểm (người trả lời phiếu duyệt)

Lớn dần từ phiếu kỹ thuật (mục 5.3). **Chỉ vào lớp 4 khi câu trả lời đã được gửi cho khách bởi người kỹ thuật hoặc đã duyệt.** Mẫu ghi:

```
### KT-0xx · Chủ đề: nối gian Shopee | TikTok | Lazada | giá vốn | tồn kho | ads | thanh toán | app mobile
Câu khách hỏi (ẩn danh):
Trả lời đã gửi (nguyên văn người kỹ thuật, hoặc bản AI viết lại ĐÃ DUYỆT):
Nguồn trong docs/: (đường dẫn tệp + mục)
Ngày: · Người duyệt:
Còn đúng tới: (ngày kiểm lại, nếu phụ thuộc sàn)
```

Câu nào phụ thuộc số (phí sàn, thuế) → bắt buộc có "Nguồn trong docs/" ; không có nguồn → không vào lớp 4, AI trả "em hỏi lại anh Trung".

---

## 5. Bản ghi chạy bóng (bước A) — cấu trúc một dòng

| Trường | Ý nghĩa |
|---|---|
| `conversation_id` | OA user_id (hash) |
| `consent` | đồng ý / không / chưa bấm (từ nút trong lời chào) — **không đồng ý → không vào kho mẫu**, vẫn đo tỷ lệ |
| `customer_msg` | tin khách (ẩn danh khi vào kho) |
| `intent`, `confidence` | máy phân loại (I-xx + độ tin) |
| `ai_draft` | nháp AI (không gửi) |
| `human_msg` | câu anh gửi (từ `oa_send_text` có `admin_id`) |
| `gap` | **nguyên văn** / **sửa nhẹ** (đổi từ, thêm 1 ý) / **sửa nặng** (khác ý) / **bỏ** (anh không trả lời hoặc trả lời khác hẳn) — anh gán hoặc máy gán sơ bộ rồi anh sửa |
| `handoff_signal` | anh nhảy vào ở ý định "an toàn"? → nguồn cho lớp 3 |
| `outcome` | nối gian / trả tiền / im / từ chối — điền sau 7 ngày (đọc qua API HQ theo email nếu khách đã đăng ký) |

**Cổng mở lát 1 (tự chọn):** `nguyên văn + sửa nhẹ ≥ 80 %` trên 30 hội thoại gần nhất, tính riêng cho ý định an toàn. Chỉnh ngưỡng sau khi có số thật tuần 3.

---

## 6. Phiên bản

| Bản | Ngày | Thay đổi |
|---|---|---|
| 0 | 29/10/2026 | Khung, chưa nội dung |
