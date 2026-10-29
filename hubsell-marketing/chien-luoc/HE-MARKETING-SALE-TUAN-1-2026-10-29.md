# Hệ Marketing-Sale — Tuần 1 (29/10/2026): kiểm giả thuyết, hồ sơ, việc tay

Trạng thái: **tuần 1 không code — chỉ kiểm, soạn, trình anh**. Phiên chạy tự động 08:30 29/10/2026 theo lịch anh chốt tối 25/10. Bản phản biện gốc + quyết định đã chốt (mục 4, 5): [PHAN-BIEN-HE-MULTI-AGENT-MARKETING-SALE-2026-10-25.md](PHAN-BIEN-HE-MULTI-AGENT-MARKETING-SALE-2026-10-25.md).

Tệp đi kèm tuần 1:
- Khung 4 lớp nhân vật bản 0 (chưa nội dung): [KHUNG-4-LOP-NHAN-VAT-BAN-0.md](KHUNG-4-LOP-NHAN-VAT-BAN-0.md)
- Hồ sơ TikTok Accounts API cho anh nộp: [../kenh/tiktok/HO-SO-ACCOUNTS-API-2026-10-29.md](../kenh/tiktok/HO-SO-ACCOUNTS-API-2026-10-29.md)

Luật khi đọc tệp này: số/ngưỡng em tự chọn đều ghi **(tự chọn)**; nguồn ghi kèm link + ngày kiểm; chỗ chưa chắc ghi **⏳**. Em không gửi gì cho khách, không nộp hồ sơ, không code.

---

## 0. Kết luận ngắn (7 giả thuyết + 1 thêm)

| # | Giả thuyết | Kết luận | Chắc | Hệ quả thiết kế |
|---|---|---|---|---|
| 1 | TikTok có API hợp lệ cho tin nhắn riêng (DM)? | **CÓ** — Business Messaging API (Open Beta APAC), nhưng cổng nặng: chỉ tài khoản Business "Advanced Access"/VBA, developer phải qua *Data Security & Privacy Review* (bảng hỏi DDQ, duyệt tay, không theo dõi được), **không được nhắn người chưa nhắn mình**, giới hạn 10 tin/48 giờ đầu | Cao | Tuần 1–3 **vẫn tay**: anh dán 1 tin mẫu có link OA. Đưa Business Messaging vào lát 3, chỉ nộp DSPR khi lát 0–1 đã chạy |
| 2 | OA "tin tư vấn" 48 giờ: điều kiện, phí, gói nào | Trong **48 giờ** sau tương tác cuối của khách: **miễn phí không giới hạn** (từ 01/01/2026); ngoài 48 giờ nhưng trong 7 ngày: **55 đ/tin** (gói Tăng trưởng có sẵn 500 tin/tháng). **Gọi API cần gói Tăng trưởng 2.500.000 đ/năm** (đã gồm VAT), OA phải **xác thực** | Cao (giá), TB (gói Cơ bản có gọi API không — xem 2.2) | Chi phí cố định ~2,5 tr/năm. Xác thực OA là việc tay số 1 |
| 3 | Webhook OA: nhận tin khách, trả lời API, nhiều quản trị viên cùng hội thoại | **CÓ** webhook `user_send_*` (ký SHA-256, phải trả 200 trong **2 giây**, có retry 30 s→1 giờ); trả lời qua `openapi.zalo.me/v3.0/oa/message/cs`; OA Manager có 6 vai + "Chỉ định nhân viên xử lý" (gói Tiêu chuẩn trở lên) | Cao (webhook), TB (nhiều người gõ cùng một hội thoại — tài liệu không nói thẳng, suy từ webhook có `admin_id`) | Webhook chỉ ghi hàng đợi rồi trả 200; xử lý sau |
| 4 | ZNS mẫu "chăm sóc" kèm nút mở OA cho người CHỈ để lại số | **KHÔNG làm được như mong**: mẫu phải thể hiện người nhận **đã có giao dịch với doanh nghiệp**; nội dung "mời quan tâm OA" bắt buộc **Tag 3 Hậu mãi** (bị xét như quảng bá). Giá 200 đ/tin (chưa VAT), nút thứ 2 trở đi +100 đ | Cao | Bỏ nhánh "khách chỉ để số → ZNS". Đổi câu xin số thành "bấm link này nhắn em". ZNS giữ cho lát 2 (khách **đã đăng ký** app = đã có giao dịch) |
| 5 | Webhook có trả CẢ tin quản trị viên gửi từ OA Admin? | **CÓ** — tài liệu chính thức: "Khi OA gửi tin nhắn đến người dùng **thông qua Open API hay từ cửa sổ chat OA Admin**", sự kiện `oa_send_text`, có `sender.admin_id` (chỉ khi gửi từ tool chat oa.zalo.me/chatv2) | Cao | **Chạy bóng làm được như mục 5.2**: anh trả lời trong OA như thường, máy ghi câu anh gửi; phân biệt AI (API) ↔ anh (`admin_id`). ⏳ app OA mobile có `admin_id` không — thử tuần 2 |
| 6 | OA có cách gọi/tag một quản trị viên trong hội thoại? | **KHÔNG** có API/webhook chỉ định; chỉ có nút tay "Chỉ định nhân viên xử lý" trong OA Manager. Có webhook **gắn nhãn người dùng** (nhãn làm cờ nhìn thấy trong OA Manager) | Cao | Báo người kỹ thuật bằng **email platform admin + chấm đỏ HQ** (module Yêu cầu hỗ trợ có sẵn) + nhóm Zalo nội bộ; gắn nhãn "Cần kỹ thuật" lên khách để anh lọc trong OA Manager |
| 7 | Luật 91/2025: dùng hội thoại làm mẫu AI cần thông báo hay đồng ý? Có luật minh bạch AI? | **Đồng ý riêng** (Điều 9: rõ ràng, **riêng cho từng mục đích**, "im lặng không được coi là đồng ý"); thông báo trong lời chào **không đủ**. Điều 30: xử lý bằng AI phải đúng mục đích + phân loại rủi ro. **Luật Trí tuệ nhân tạo 134/2025/QH15 Điều 11 k.1** (hiệu lực 01/03/2026): người dùng phải **nhận biết đang tương tác với AI**; Điều 9 k.1b: không nhận biết = rủi ro trung bình | Cao về trích dẫn (nguồn thứ cấp nguyên văn; thuvienphapluat chặn), ⏳ đối chiếu Công báo | (a) 20–30 mẫu cũ: **ẩn danh triệt để** trước khi vào kho; (b) OA: nút **Đồng ý / Không** trong lời chào, chỉ hội thoại bấm Đồng ý vào kho mẫu; (c) persona **không được giả người** — không còn là khẩu vị, là luật |
| + | Facebook Page: `pages_manage_posts`, `pages_messaging` cần App Review? | Advanced Access **cần App Review + Business Verification**; `pages_messaging` chỉ cho trải nghiệm **khách khởi tạo** | TB (chưa đọc trang Access Levels mới) | Để sau lát 1; Page mình quản trị có thể dùng Standard Access khi dev — ⏳ kiểm khi làm |

---

## 1. Câu chưa chốt: persona — xin anh trả lời đầu phiên kế

Em giữ đề xuất: **"Trợ lý Hubsell"**, học *cách nói* của anh (xưng em, câu ngắn, từ lóng seller), ký tên trợ lý, có nút "Gọi anh Trung", **không phủ nhận là AI khi bị hỏi**. Hai điều mới so với 25/10 làm đề xuất này mạnh hơn:

1. **Luật 134/2025 Điều 11 k.1** (nguyên văn): *"Nhà cung cấp bảo đảm hệ thống trí tuệ nhân tạo tương tác trực tiếp với con người được thiết kế và vận hành để người sử dụng nhận biết khi đang tương tác với hệ thống, trừ trường hợp pháp luật có quy định khác."* Hệ của mình **mới**, không được 12 tháng chuyển tiếp (Điều 35 chỉ cho hệ đã vận hành trước 01/03/2026). Persona "Nam" giả người = vi phạm trực tiếp.
2. **Luật 91/2025 Điều 30 k.4**: xử lý dữ liệu cá nhân bằng AI *"phải thực hiện phân loại theo mức độ rủi ro"*; Luật AI Điều 9 k.1b xếp "người dùng không nhận biết chủ thể tương tác là AI" vào **rủi ro trung bình** → thêm nghĩa vụ.

Cách để khách vẫn thấy "đúng người trong video": OA mang ảnh anh, tên có Hubsell, lời chào nói rõ *"anh Trung đọc hết, phần kỹ thuật anh trả lời trực tiếp; tin trả lời nhanh do Trợ lý Hubsell soạn"*. Trong **giai đoạn chạy bóng** AI chưa gửi gì nên lời chào chưa cần câu AI; thêm câu đó khi vào lát 0.

Nếu anh chốt ngược: em làm theo và ghi lý lẽ hai bên vào mục này, nhưng em bảo lưu bằng chữ vì đây là nghĩa vụ luật, không phải khẩu vị.

---

## 2. Chi tiết từng giả thuyết (ngày kiểm: 29/10/2026)

### 2.1 TikTok DM — Business Messaging API

**Bằng chứng (đọc trực tiếp docs qua trình duyệt):**
- Trang tổng quan: *"TikTok Business Messaging API is now in **Open Beta in APAC, LATAM, METAP, and North America**."* — [business-messaging-api/v1.3](https://business-api.tiktok.com/portal/docs/business-messaging-api/v1.3)
- Quyền truy cập: *"Business Messaging API developers are required to complete necessary reviews as a prerequisite"* — Data Security & Privacy Review: nộp intake form → trong **10 ngày làm việc** TikTok gửi email *"TikTok/ByteDance Third-Party Due Diligence Questionnaire (DSPR DDQ)"*; khuyến nghị kèm ISO 27001 / SOC 2 / báo cáo pentest; *"progress tracking is not available"*. Chỉ hỗ trợ *"TikTok Accounts with Advanced Access or Verified Business Accounts (VBA). General TikTok Accounts are not eligible."* Không quản được **TikTok Shop Messages** (hệ riêng). — [access-to-business-messaging-api/v1.3](https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3)
- Quản lý DM: *"You are **prohibited from initiating a conversation** or messaging any TikTok user who has not started a conversation with you."* Gửi text/ảnh/thẻ Q&A qua `/business/message/send/`, nhận tin qua webhook. — [manage-direct-messages](https://business-api.tiktok.com/portal/docs/manage-direct-messages-for-a-business-account/v1.3)
- Giới hạn (hội thoại không theo dõi lẫn nhau): **10 tin trong 48 giờ đầu**; khách trả lời → không giới hạn trong 48 giờ kế; quá 48 giờ im → tối đa **3 tin** thêm. — [messaging-limits](https://business-api.tiktok.com/portal/docs/messaging-limits-for-business-messaging-api/v1.3)
- Link mở DM từ ngoài: `tiktok.me/{username}?message=...` (chỉ app mobile). — [unlock-conversations](https://business-api.tiktok.com/portal/docs/unlock-conversations/v1.3)
- Cấp tài khoản: General → Advanced Access (nối TikTok for Business / Business Center chưa xác minh) → VBA (xác minh doanh nghiệp). — [about-tiktok-account-entitlements](https://ads.tiktok.com/help/article/about-tiktok-account-entitlements)

**Kết luận:** API có, hợp lệ ở Việt Nam, nhưng DSPR DDQ là bảng hỏi an ninh cấp doanh nghiệp, duyệt tay, không hẹn ngày; tài khoản anh phải là Business có Advanced Access (⏳ anh cho em biết tài khoản TikTok anh đang là loại gì). Với lượng DM hiện tại, **copy-dán 1 tin mẫu** rẻ hơn mọi thứ. Ghi vào lát 3; nộp DSPR khi lát 0–1 chạy ổn và có số DM/ngày đáng làm (ngưỡng tự chọn: > 20 DM/ngày).

### 2.2 Zalo OA — tin tư vấn 48 giờ, phí, gói

**Bằng chứng:**
- Chính sách tin OA (oa.zalo.me, đăng 15/01/2024): tin Tư vấn — *"Người dùng có tương tác hoặc cho phép tương tác, và tương tác cuối nằm trong khoảng 07 ngày"*; *"08 tin đầu tiên, gửi trong vòng 48 giờ kể từ lần tương tác cuối… đặt lại khi người dùng có tương tác mới"*; ngoài hạn mức **55 đ/tin**. — [Chính sách gửi tin](https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099)
- Tài liệu developer (API kiểm hạn mức `POST /v3.0/oa/quota/message`): *"Từ ngày 1/1/2026, đối tác có thể gửi tin Tư vấn **miễn phí không giới hạn trong khung 48h**… Sau ngày 1/3/2026: sẽ dừng trả về thuộc tính này"* (cs_reply). Điều kiện gửi tin Tư vấn: *"User có tương tác với OA trong vòng 7 ngày"*, gửi 24/24. — [Kiểm tra hạn mức](https://developers.zalo.me/docs/official-account/tin-nhan/quan-ly-tin-nhan/kiem-tra-han-muc-gui-tin-nhan) · [Điều kiện gửi tin Tư vấn](https://developers.zalo.me/docs/official-account/tin-nhan/tin-tu-van/dieu-kien-gui-tin-tu-van)
- Bảng giá gói từ 01/06/2026 (**"Dành cho OA đã xác thực"**, giá gồm VAT 10 %), đọc trực tiếp 29/10: — [zalo.solutions/oa/pricing](https://zalo.solutions/oa/pricing)

| | Cơ bản (miễn phí) | Tiêu chuẩn | Tăng trưởng | Toàn diện |
|---|---|---|---|---|
| Giá | 0 | 1.000.000 đ/năm | **2.500.000 đ/năm** (~208 k/tháng) | 6.000.000 đ/năm |
| Tài khoản nhân viên | 3 | 5 | 15 | 100 |
| Tích hợp Zalo Open API | — | — | **Có**, 100 req/phút | Có, 2.000 req/phút |
| Số app được ủy quyền | 1 | 1 | 3 | không giới hạn |
| Tin Tư vấn ngoài 48 giờ có sẵn/tháng | — | — | **500** | 2.000 |
| Chatbot (kịch bản) | — | — | 10 | 50 |
| Chỉ định nhân viên xử lý hội thoại | — | Có | Có | Có |
| Ngoài gói | tin Tư vấn ngoài 48 giờ 55 đ/tin; ZBS Template Message theo bảng riêng | | | |

⏳ Cột Cơ bản ghi "1 app được ủy quyền" nhưng dòng "Tích hợp Zalo Open API" trống → em hiểu **gọi API gửi tin cần Tăng trưởng**; trang hỏi-đáp có câu "dùng phần mềm bên thứ 3 chăm sóc qua OA thì có cần mua gói không" nhưng em không đọc được câu trả lời. Anh xem câu đó khi mua, hoặc em thử gói Cơ bản tuần 2 trước khi trả tiền (rẻ hơn hỏi).

**Kết luận:** Chi phí cố định **2,5 triệu/năm**; trong 48 giờ miễn phí → Sales Agent trả lời không tốn tiền tin; chỉ tốn khi nhắc lại người im > 48 giờ (55 đ/tin, 500 tin/tháng có sẵn). OA phải **xác thực doanh nghiệp** trước (mục 4 việc tay).

### 2.3 Webhook OA và nhiều quản trị viên

**Bằng chứng (developers.zalo.me, đọc qua iframe stc-developers.zdn.vn):**
- Webhook tổng quan: POST JSON, header `X-ZEvent-Signature` = `sha256(appId + data + timeStamp + OAsecretKey)`; **"Phản hồi tất cả sự kiện webhook với http status code = 200 OK… tối đa 2 giây"**; retry sau 30 s, 5 phút, 15 phút, 30 phút, 1 giờ (header `num_retry`); không đáp → bị hủy đăng ký, phải xin lại. OA phải cấp `Official_Account_Access_Token` cho app. — [Giới thiệu về Webhook](https://developers.zalo.me/docs/official-account/webhook/tong-quan)
- Sự kiện khách gửi: `user_send_text|image|link|audio|video|sticker|location|business_card|file`, payload `sender.id`, `recipient.id`, `message.text/msg_id`, `attachments`, `quote_msg_id`, `user_id_by_app`. — [Sự kiện người dùng gửi tin nhắn](https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-nguoi-dung-gui-tin-nhan)
- Nhóm sự kiện "Quản lý": quan tâm/bỏ quan tâm OA, **gắn/gỡ nhãn người dùng**, tạo/xóa nhãn, người dùng đồng ý cấp quyền tương tác, **người dùng Zalo thực hiện quyền chủ thể dữ liệu** (hữu ích cho giả thuyết 7), cập nhật thông tin người dùng.
- OA Manager: 6 vai (Quản trị viên, Soạn nội dung, Phân tích viên, Chăm sóc KH, Nhân viên quảng cáo, Quản lý gói); "Chỉ định nhân viên xử lý" tại màn chat (gói Tiêu chuẩn+), lọc hội thoại theo nhân viên. — [Quản lý hội thoại](https://oa.zalo.me/home/documents/guides/quan-ly-hoi-thoai_1287955702315829050)

**Kết luận:** Đủ để (1) nhận tin khách, (2) trả lời bằng API tin Tư vấn, (3) anh trả lời tay cùng hội thoại từ OA Manager/app (webhook báo lại, xem 2.5). Thiết kế bắt buộc: route webhook **chỉ ghi hàng đợi rồi trả 200 ngay** (2 giây), xử lý AI phía sau — đúng luật quy mô thương mại.

### 2.4 ZNS / ZBS Template Message cho người chỉ để lại số

**Bằng chứng:**
- Quy định duyệt mẫu (Zalo Business Solutions): *"Mẫu tin cần thể hiện user (đối tượng nhận tin) **đã từng có giao dịch với doanh nghiệp**"* (ngoại lệ duy nhất: OTP tạo tài khoản). Tag 2 Chăm sóc khách hàng: *"Không đính kèm mục đích 'Mời quan tâm OA'"*; *"Mẫu có nội dung mời quan tâm (follow) OA **bắt buộc gắn Tag 3 – Hậu mãi**"*; link/hotline phải nằm ở nút CTA; không hỗ trợ CTA dẫn tới kịch bản chatbot. — [Quy định chung khi kiểm duyệt mẫu](https://zalo.solutions/news/quy-dinh-chung-khi-kiem-duyet-mau-tin-zns/baujzpyvjjrz7776m)
- Giá (chưa VAT): template xác thực/chuyển khoản/voucher **300 đ**; các loại còn lại **200 đ**; nút CTA đầu mỗi hạng mục miễn phí, từ nút thứ 2 **+100 đ/nút**; gửi theo UID được trợ giá hơn gửi theo SĐT. — [zalo.solutions/zns/pricing](https://zalo.solutions/zns/pricing)
- Từ 01/01/2026 ZNS hợp nhất vào **ZBS Template Message**, trang giải pháp ghi *"không yêu cầu điều kiện follow OA trước đó"* và *"chỉ từ 200đ"*. — [zalo.solutions/zns](https://zalo.solutions/zns)

**Kết luận:** Người xem video TikTok để lại số **chưa có giao dịch** với Hubsell, và nút kéo về OA là "mời quan tâm OA" → mẫu rơi vào Tag 3 quảng bá, khả năng bị từ chối cao hoặc duyệt kèm tiêu chí khuyến mãi. **Bỏ nhánh này.** Giữ ZNS cho **lát 2**: khách đã tạo tài khoản Hubsell (= đã có giao dịch dịch vụ) chưa nối gian → mẫu Tag 2 "Tài khoản đã tạo, chưa nối gian" + nút mở hướng dẫn, ~200–300 đ/tin.

### 2.5 Webhook có trả tin quản trị viên gửi từ OA Admin — ĐIỀU KIỆN CHẠY BÓNG

**Bằng chứng (nguyên văn tài liệu chính thức):** *"Khi Official Account gửi tin nhắn đến người dùng **thông qua Open API hay từ cửa sổ chat OA Admin**, hệ thống Zalo sẽ gửi một request HTTP đến Webhook Url đã đăng ký của ứng dụng."* Sự kiện `oa_send_text|image|gif|list|file|sticker`; `sender.id` = OA, **`sender.admin_id` = "Id của admin OA nhắn tin (Chỉ có khi OA gửi tin nhắn bằng tool chat OA - https://oa.zalo.me/chatv2)"**; có `msg_id`, `quote_msg_id`, `timestamp`. — [Sự kiện Official Account gửi tin nhắn cho người dùng](https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-official-account-gui-tin-nhan-cho-nguoi-dung)

**Kết luận:** Chạy bóng theo mục 5.2 **làm được đúng như anh muốn**: anh trả lời trong OA như bình thường, máy nhận `oa_send_text` có `admin_id` → ghi "câu anh thực gửi"; tin do AI gửi sau này qua API không có `admin_id` → phân biệt sạch. Hai điểm thử tuần 2: (a) app OA trên điện thoại (Mini App) có kèm `admin_id` không; (b) webhook `oa_send_*` có cần bật riêng trong cài đặt app (trang tổng quan ghi "Hãy bật Event Webhook mà bạn muốn nhận").

### 2.6 Gọi/tag quản trị viên trong hội thoại

**Bằng chứng:** không có endpoint/webhook "chỉ định" trong danh mục Open API và webhook (đã liệt kê toàn bộ nhóm Tin nhắn + Quản lý ở 2.3); OA Manager chỉ có nút tay "Chỉ định nhân viên xử lý" (Tiêu chuẩn+). Có webhook **gắn nhãn người dùng** (nhãn hiện trong OA Manager).

**Kết luận:** Báo người kỹ thuật bằng đường có sẵn: tạo phiếu qua API HQ → **email mọi platform admin + chấm đỏ HQ** (module Yêu cầu hỗ trợ đã làm) + tin vào **nhóm Zalo nội bộ** (nhóm GMF của OA: GMF-10 25.000 đ/tháng, hoặc nhóm Zalo thường anh tự xem). Thêm: gắn nhãn "Cần kỹ thuật" lên khách để anh lọc nhanh trong OA Manager (⏳ kiểm API gắn nhãn tuần 2).

### 2.7 Luật 91/2025/QH15 và Luật 134/2025/QH15

**Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15** (thông qua 26/06/2025, hiệu lực 01/01/2026; nguồn toàn văn: [congluatviet.vn](https://congluatviet.vn/van-ban/luat-bao-ve-du-lieu-ca-nhan-91-2025-qh15) — thuvienphapluat trả 403; ⏳ anh/kế toán đối chiếu Công báo):
- **Điều 9 (Sự đồng ý):** k.2 chỉ có hiệu lực khi *"dựa trên sự tự nguyện và biết rõ"* loại dữ liệu, mục đích, bên xử lý, quyền; k.3 *"được thể hiện bằng phương thức rõ ràng, cụ thể, có thể in, sao chép bằng văn bản"*; k.4 **"được thể hiện riêng cho từng mục đích"**, không gắn điều kiện phải đồng ý mục đích khác, **"Sự im lặng hoặc không phản hồi không được coi là sự đồng ý"**.
- **Điều 19 (không cần đồng ý):** bảo vệ tính mạng; khẩn cấp/an ninh; cơ quan nhà nước; **"thực hiện thỏa thuận của chủ thể dữ liệu với cơ quan, tổ chức, cá nhân có liên quan"**; trường hợp khác theo luật. → Trả lời khách trong hội thoại họ mở = thực hiện thỏa thuận hỗ trợ, không cần đồng ý riêng. **Dùng hội thoại làm mẫu huấn luyện giọng là mục đích khác** → không rơi vào Điều 19.
- **Điều 28 (quảng cáo):** xử lý dữ liệu để quảng cáo phải có đồng ý, phải có cách từ chối, tuân thủ luật tin rác → khớp quyết định đã chốt (không nhắn chủ động ngoài OA).
- **Điều 30 (dữ liệu lớn, AI…):** k.1 *"đúng mục đích và giới hạn trong phạm vi cần thiết"*; k.4 xử lý bằng AI *"phải thực hiện phân loại theo mức độ rủi ro để có biện pháp bảo vệ dữ liệu cá nhân phù hợp"*; k.6 Chính phủ quy định chi tiết (⏳ nghị định).
- Không có điều riêng "tiếp thị trực tiếp"; không có điều "thông báo xử lý" chung — chỉ quyền *"được biết về hoạt động xử lý"* (Điều 4).

**Luật Trí tuệ nhân tạo 134/2025/QH15** (thông qua 10/12/2025, hiệu lực **01/03/2026** — Điều 34; nguồn toàn văn: [hethongphapluat.com](https://hethongphapluat.com/law-no-134-2025-qh15-dated-december-10-2025-on-artificial-intelligence.html)):
- **Điều 11 k.1:** *"Nhà cung cấp bảo đảm hệ thống trí tuệ nhân tạo tương tác trực tiếp với con người được thiết kế và vận hành để người sử dụng nhận biết khi đang tương tác với hệ thống, trừ trường hợp pháp luật có quy định khác."* k.5: duy trì minh bạch suốt quá trình cung cấp. k.6: Chính phủ quy định hình thức thông báo.
- **Điều 3:** "Nhà cung cấp" = đưa hệ thống ra thị trường/đưa vào sử dụng dưới tên mình, không phụ thuộc tự phát triển hay không → **Hubsell là nhà cung cấp** của Trợ lý Hubsell (dù chạy trên Claude); "Bên triển khai" = dùng hệ thống trong hoạt động thương mại → Hubsell cũng là bên triển khai.
- **Điều 9 k.1b:** rủi ro trung bình khi người dùng *"không nhận biết được chủ thể tương tác là hệ thống trí tuệ nhân tạo"*.
- **Điều 35 chuyển tiếp:** 12 tháng chỉ cho hệ **đã vận hành trước 01/03/2026** → hệ mới của mình áp dụng ngay.
- **Nghị định 142/2026/NĐ-CP** (hiệu lực 01/05/2026) Điều 18 chi tiết thông báo/gắn nhãn **nội dung** AI tạo (âm thanh, hình, video, văn bản gây nhầm lẫn), bên triển khai tự chọn hình thức rõ ràng, dễ nhận; Bộ KH&CN công bố hướng dẫn kỹ thuật (⏳ chưa đọc). Hình thức thông báo "đang nói với AI" chưa thấy điều riêng → tự chọn hình thức rõ ràng trong lời chào + chữ ký tin.

**Kết luận & cách làm:**
1. **Mẫu khởi đầu 20–30 hội thoại Zalo cá nhân:** ẩn danh triệt để **trước** khi vào kho (tên → [KHÁCH], SĐT/email bỏ, tên gian → [GIAN], số doanh thu/đơn → [SỐ], ảnh không lấy). ⏳ Em chưa kiểm luật có định nghĩa "dữ liệu đã khử nhận dạng" nằm ngoài phạm vi không — nên vẫn coi là rủi ro thấp còn dư, không phải bằng 0.
2. **Chạy bóng + lát 0 trên OA:** lời chào có câu thông báo **và hai nút Đồng ý / Không đồng ý** (quick reply); chỉ hội thoại bấm Đồng ý mới vào kho mẫu; không bấm vẫn được hỗ trợ bình thường (Điều 9 k.4b). Lưu bằng chứng đồng ý (msg_id, thời điểm) — Điều 9 k.3 "có thể in, sao chép".
3. **Minh bạch AI:** tin do AI gửi ký "— Trợ lý Hubsell"; lời chào nói rõ; khi khách hỏi "em là người hay máy" → trả lời thật. Đây là lý do pháp lý thứ hai cho mục 1.
4. Webhook "người dùng Zalo thực hiện quyền chủ thể dữ liệu" (2.3) → khi khách yêu cầu xóa, xóa cả bản trong kho mẫu.

### 2.8 Facebook Page (thêm)

Meta Permissions Reference `pages_messaging`: *"Business Verification is required for all apps making requests for Advanced Access"*; mục đích cho phép: *"create user-initiated interactive experiences"*, hỗ trợ khách, xác nhận đơn. `pages_manage_posts` phụ thuộc `pages_show_list` + `pages_read_engagement`. Standard Access cho Page do chính mình quản trị: ⏳ chưa đọc trang Access Levels mới. Để lát 1+ (phủ kênh từ 1 video).

---

## 3. Phiếu kỹ thuật từ OA ↔ module Yêu cầu hỗ trợ (chỉ đọc mã, chưa sửa)

**Hiện trạng mã (29/10):**
- `SupportRequest` (`backend/prisma/schema.prisma` ~2821): **`userId` bắt buộc** (chủ shop, Cascade), `requesterName`, `content`, `phone?` (E.164 snapshot), `status NEW/IN_PROGRESS/DONE`, `reply` (khách thấy) / `note` (nội bộ), `assigneeId`, `attachments[]` (Supabase Storage, dọn 7 ngày sau `doneAt`), `customerSeenAt`. Tạo qua `POST /api/support-requests` (**JWT khách**, trần 5 phiếu mở/shop) → email mọi platform admin → HQ tab `/admin/customers?tab=support` (`requirePlatformPermission("hq.customers")`). Khách xem/trả lời trong app.
- `ConsultLead` (~2788): `name`, **`email` bắt buộc**, `phone` bắt buộc, `source` chỉ 2 giá trị (`pricing-enterprise` | `floating-consult`), `status NEW/CONTACTED/CONVERTED/DROPPED`, `note`, `assigneeId`; tạo qua `POST /api/public/consult-lead` (public, honeypot, gộp trùng 24 giờ theo email/SĐT); HQ tab Lead tư vấn. **Không có `reply`** cho khách — đây là lead bán, không phải phiếu kỹ thuật.
- `User.phone` E.164 nullable → khớp khách OA theo SĐT chỉ khi khách OA cho số (Zalo OA không trả SĐT khách; chỉ có `user_id` OA, trừ khi khách bấm chia sẻ thông tin — webhook "đồng ý chia sẻ thông tin").
- Hệ Sales ở Supabase project riêng (đã chốt) → **không ghi thẳng DB prod**; hiện backend chưa có endpoint nội bộ kiểu khóa dịch vụ cho máy gọi (chỉ JWT người dùng hoặc webhook sàn có secret riêng).

**Ba phương án:**

| | A. Mở rộng `SupportRequest` cho khách chưa tài khoản | B. Khách OA chưa tài khoản → `ConsultLead`, có tài khoản → `SupportRequest` | C. Phiếu nằm ở hệ Sales, HQ chỉ nhận báo |
|---|---|---|---|
| Thay đổi | `userId` → nullable; thêm `source` (`app` / `zalo_oa`), `externalRef` (OA user_id + link hội thoại), `contactName`, `contactPhone?`; endpoint nội bộ `POST /api/internal/support-requests` xác thực bằng khóa dịch vụ (env, header) do hệ Sales gọi; khớp `userId` theo SĐT/email nếu có; HQ thêm chip lọc "Từ Zalo OA" | Thêm `source = zalo-oa` cho ConsultLead, nới `email` nullable; phiếu kỹ thuật thật chỉ tạo khi khớp tài khoản | Bảng `tickets` trong Supabase Sales; gửi email admin + tin nhóm Zalo; HQ không có tab |
| Ưu | **Một hàng đợi** cho HQ, email + chấm đỏ + ảnh đính kèm + `reply`/`note` dùng lại hết; đúng bản chất "phiếu kỹ thuật" | Không đụng SupportRequest; ConsultLead đã có tab Sale | Không đụng schema prod; nhanh nhất |
| Nhược | Migration đụng bảng đang chạy; mọi chỗ đọc `userId` (`/mine`, email) phải chịu null; FE HQ phải vẽ khách không tài khoản | Hai nơi xử lý một khách; ConsultLead không có `reply`, status là trạng thái bán; nới `email` làm hỏng gộp trùng | Hai hộp phiếu; HQ mất lịch sử; lớp 4 (kiến thức kỹ thuật) không có nguồn chuẩn |
| Chi phí ước (tự chọn) | ~1 ngày code + test | ~0,5 ngày, nhưng nợ thiết kế | ~0,5 ngày |

**Đề xuất: A**, làm lát nhỏ ở tuần 3 (khi lát 0 cần phiếu thật): (1) migration thêm cột, `userId` nullable; (2) endpoint nội bộ có khóa dịch vụ + giới hạn tốc độ; (3) HQ chip lọc + hiện tên/SĐT khách OA thay tài khoản; (4) câu trả lời `reply` được hệ Sales đọc lại (GET nội bộ) để AI viết lại dễ hiểu **và người kỹ thuật duyệt** trước khi gửi (mục 5.3). Chưa code tới khi anh gật.

---

## 4. Việc tay cho anh (theo thứ tự)

1. **Tạo Zalo OA Doanh nghiệp** tại oa.zalo.me bằng Zalo cá nhân anh (anh là Quản trị viên). **Nộp hồ sơ xác thực trong 14 ngày từ khi tạo** ([Hướng dẫn xác thực](https://oa.zalo.me/home/documents/guides/huong-dan-xac-thuc_70)):
   - Công văn xác thực theo mẫu Zalo (tải ở trang hướng dẫn), có dấu/chữ ký công ty — scan hoặc ảnh bản gốc.
   - Giấy chứng nhận đăng ký doanh nghiệp **đủ các trang**, có dấu + chữ ký cơ quan cấp (CÔNG TY TNHH CÔNG NGHỆ HUBSELL, MST 0111626360).
   - Người đại diện pháp luật: tên, **số điện thoại Zalo**, số CCCD; người đại diện sẽ nhận **yêu cầu xác nhận qua Zalo, phải bấm trong 48 giờ** (không bấm được thì dùng công văn thay).
   - Duyệt 2–3 ngày làm việc (trang khác ghi tới 7), có thể bị đòi bổ sung.
2. **Tên OA.** Cách 1 xác thực theo tên doanh nghiệp/tên gian hàng; cách 2 theo nhãn hiệu đã **cấp văn bằng** (đơn 4-2026-54845 chưa cấp → chưa dùng được); cách 3 tên khác cần giấy chứng minh tên sản phẩm/dịch vụ. Đề xuất đặt **"Hubsell"** (chữ có trong tên công ty; ⏳ Zalo có nhận tên rút gọn không — nếu bị từ chối thì "Công nghệ Hubsell"). "Hubsell · anh Trung" nhiều khả năng không qua xác thực → **mặt anh để ở ảnh đại diện + ảnh bìa + lời chào**, không ở tên.
3. **Gói:** sau khi xác thực, mua **Tăng trưởng 2.500.000 đ/năm** (hoặc để em thử gói Cơ bản tuần 2 trước, mục 2.2). Hóa đơn ghi tên công ty + MST.
4. **Lấy link + QR OA** (Chia sẻ OA qua QR & URL, có ở mọi gói) → đưa vào **bio TikTok** + **ghim bình luận đầu mỗi video**.
5. **Tin mẫu dán vào inbox TikTok** (anh duyệt mới dùng; em soạn 2 bản, giọng anh, không hứa số):
   - Bản 1: *"Chào anh/chị, em là Trung bên Hubsell. Để em hướng dẫn kỹ hơn và gửi tài liệu cho tiện, anh/chị bấm vào đây nhắn em qua Zalo nhé: zalo.me/[ID-OA]. Em đọc hết, có gì cứ hỏi."*
   - Bản 2 (ngắn): *"Anh/chị nhắn em bên Zalo này cho dễ gửi hướng dẫn nhé: zalo.me/[ID-OA] — Trung, Hubsell."*
6. **Lời chào OA** (hiện khi khách mở hội thoại; anh duyệt mới dùng). Giai đoạn chạy bóng (anh trả lời, AI chưa gửi): *"Chào anh/chị, đây là Zalo của Hubsell — anh Trung đọc hết và trả lời ở đây. Hubsell đang cải thiện chất lượng hỗ trợ: hội thoại này có thể được dùng làm mẫu sau khi đã xóa thông tin cá nhân (tên, số điện thoại, tên gian). Anh/chị bấm **Đồng ý** hoặc **Không đồng ý** bên dưới — chọn gì cũng được hỗ trợ như nhau. Anh/chị đang cần: nối gian · xem lãi lỗ · trợ lý quảng cáo?"* Khi vào lát 0 thêm câu: *"Tin trả lời nhanh do Trợ lý Hubsell (AI) soạn, anh Trung duyệt; hỏi 'gọi anh Trung' là anh vào ngay."*
7. **Chọn 20–30 hội thoại Zalo cá nhân CHỐT ĐƯỢC** (đủ các ý định: hỏi giá, hỏi sàn nào, ngại nối gian, so công cụ khác, hỏi thuế/phí, lỗi nối gian, đòi giảm giá, khách nổi nóng) → copy chữ (hoặc chụp màn hình) thành từng tệp, đặt vào `hubsell-marketing/khach-hang/mau-hoi-thoai-tho/` (thư mục này **không commit** — em sẽ ghi vào .gitignore khi nhận). Em ẩn danh theo quy tắc ở khung 4 lớp rồi mới đưa vào kho mẫu. Nếu tiện, ghi kèm **kết cục** mỗi hội thoại (nối gian / trả tiền / im / từ chối).
8. **Cho em biết tài khoản TikTok anh** là Personal hay Business, có "Advanced Access"/VBA chưa (ảnh màn Cài đặt → Tài khoản). Accounts API nhận cả Personal; Business Messaging sau này cần Business.
9. **Nộp hồ sơ TikTok Accounts API** theo tệp [HO-SO-ACCOUNTS-API-2026-10-29.md](../kenh/tiktok/HO-SO-ACCOUNTS-API-2026-10-29.md) trên Chrome (em không nộp thay). Lưu nguyên văn email trả lời vào tệp đó.
10. Tuần 2: tạo ứng dụng tại developers.zalo.me (App) và liên kết OA, cấp quyền "gửi tin và thông báo qua OA" — em hướng dẫn từng bước khi tới.

---

## 5. Khung 4 lớp bản 0

Tách tệp riêng: [KHUNG-4-LOP-NHAN-VAT-BAN-0.md](KHUNG-4-LOP-NHAN-VAT-BAN-0.md) — chỉ khung mục, cách ghi, cách đánh dấu tốt/xấu, quy tắc ẩn danh, mẫu bản ghi chạy bóng. Nội dung điền khi anh gửi 20–30 hội thoại.

---

## 6. Đề xuất lịch tuần 2–3 (chờ anh gật)

| Tuần | Việc | Điều kiện vào |
|---|---|---|
| **Tuần 2 (03–09/11)** | Anh: OA xác thực xong, link lên bio, gửi mẫu hội thoại. Em: dựng thư mục mã riêng (đề xuất `hubsell-sales/`, Next.js route webhook + Supabase riêng gói Free), webhook OA **chỉ ghi** (`user_send_*`, `oa_send_*` có `admin_id`), kiểm 2 điểm ⏳ của 2.5; ẩn danh mẫu → **bản 0 của 4 lớp** anh duyệt. **Bước A chạy bóng** bắt đầu ngay khi có tin thật: AI soạn nháp song song, không gửi, ghi nháp + câu anh gửi + kết cục | OA xác thực; anh gật persona + thư mục |
| **Tuần 3 (10–16/11)** | Chạy bóng đủ **1 tuần hoặc 30 hội thoại** (tự chọn) → đo tỷ lệ nháp ≈ câu anh gửi; viết bản 1 của lớp 1–3 từ chỗ lệch. Nếu anh gật phương án phiếu A: lát nhỏ `SupportRequest` nguồn OA. **Bước B lát 0**: AI soạn, anh bấm Gửi/Sửa/Bỏ trong HQ (hoặc trong OA Manager nếu HQ chưa kịp — em đề xuất HQ để ghi được thao tác) | Bản 0 4 lớp đã duyệt |
| **Cổng mở lát 1** | ≥ 80 % nháp gửi nguyên văn hoặc sửa nhẹ trên 30 hội thoại gần nhất (tự chọn, chỉnh theo số thật sau bước A); chỉ ý định an toàn (hỏi giá, hỏi nối gian, hỏi "có sàn X không") | Đo xong lát 0 |
| **Khi TikTok duyệt scope** | Nối bình luận video → phân loại → nháp trả lời kéo về OA (lát 0 trước) | Email duyệt |

Lịch nhắc **10/11/2026 08:30** (kiểm anh đã nộp Accounts API chưa / TikTok trả lời gì, OA xác thực tới đâu, đã nhận mẫu hội thoại chưa): em **chưa tạo được** — phiên tự động không có quyền tạo tác vụ mới (cần anh duyệt). Anh mở một phiên thường và bảo em "tạo lịch 10/11 kiểm Hệ Marketing-Sale", em tạo trong 1 phút (prompt đã soạn sẵn trong PROGRESS 29/10).

---

## 7. Câu hỏi còn mở cho anh

1. **Persona** (mục 1) — anh chốt "Trợ lý Hubsell" hay ý khác?
2. **Tên OA**: "Hubsell" (đề xuất) hay tên khác qua được xác thực?
3. **Phương án phiếu kỹ thuật**: A (đề xuất), B hay C?
4. **Thư mục mã riêng**: `hubsell-sales/` được không, hay tên khác (`hubsell-oa/`, `hubsell-tro-ly-ban/`)?
5. **App TikTok để xin scope**: dùng app Hubsell Ads hiện có (nhanh, đã duyệt) hay tạo developer app mới (chậm hơn một vòng duyệt)? Em đề xuất app hiện có; "app riêng" anh chốt 12/10 em hiểu là **sản phẩm** riêng, không nhất thiết developer app riêng — anh xác nhận.
6. Mua gói OA Tăng trưởng ngay sau xác thực, hay để em thử gói Cơ bản trước (2.2)?

---

## 8. Chi phí dự kiến (đã có nguồn)

| Khoản | Số | Nguồn |
|---|---|---|
| Zalo OA gói Tăng trưởng | 2.500.000 đ/năm (gồm VAT) | zalo.solutions/oa/pricing 29/10 |
| Tin Tư vấn ngoài 48 giờ | 55 đ/tin, 500 tin/tháng có sẵn | như trên |
| ZBS Template Message (lát 2) | 200 đ/tin + 100 đ/nút từ nút 2 (chưa VAT) | zalo.solutions/zns/pricing |
| Nhóm Zalo nội bộ GMF-10 (nếu dùng) | 25.000 đ/tháng | zalo.solutions/oa/pricing |
| Supabase project riêng | 0 (Free) | — |
| Claude API (Haiku phân loại + Sonnet chat) | [CHƯA CÓ SỐ] — đo sau chạy bóng 1 tuần | — |
| TikTok Accounts API / Business Messaging | 0 | docs |

---

## Nguồn đã kiểm 29/10/2026

TikTok: [Business Messaging API](https://business-api.tiktok.com/portal/docs/business-messaging-api/v1.3) · [Access](https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3) · [Manage DMs](https://business-api.tiktok.com/portal/docs/manage-direct-messages-for-a-business-account/v1.3) · [Messaging limits](https://business-api.tiktok.com/portal/docs/messaging-limits-for-business-messaging-api/v1.3) · [Unlock conversations](https://business-api.tiktok.com/portal/docs/unlock-conversations/v1.3) · [Account entitlements](https://ads.tiktok.com/help/article/about-tiktok-account-entitlements)
Zalo: [Chính sách gửi tin](https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099) · [Gói mới 1/6/2026](https://oa.zalo.me/home/resources/news/chinh-thuc-quyen-loi-va-bieu-phi-cac-goi-dich-vu-zalo-oa-moi-tu-162026-_5100578039811031184) · [Bảng giá OA](https://zalo.solutions/oa/pricing) · [Quản lý hội thoại](https://oa.zalo.me/home/documents/guides/quan-ly-hoi-thoai_1287955702315829050) · [Hướng dẫn xác thực](https://oa.zalo.me/home/documents/guides/huong-dan-xac-thuc_70) · [Webhook tổng quan](https://developers.zalo.me/docs/official-account/webhook/tong-quan) · [User gửi tin](https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-nguoi-dung-gui-tin-nhan) · [OA gửi tin](https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-official-account-gui-tin-nhan-cho-nguoi-dung) · [Hạn mức](https://developers.zalo.me/docs/official-account/tin-nhan/quan-ly-tin-nhan/kiem-tra-han-muc-gui-tin-nhan) · [Điều kiện tin Tư vấn](https://developers.zalo.me/docs/official-account/tin-nhan/tin-tu-van/dieu-kien-gui-tin-tu-van) · [Duyệt mẫu ZNS](https://zalo.solutions/news/quy-dinh-chung-khi-kiem-duyet-mau-tin-zns/baujzpyvjjrz7776m) · [Giá ZBS](https://zalo.solutions/zns/pricing)
Luật: [Luật 91/2025/QH15 toàn văn](https://congluatviet.vn/van-ban/luat-bao-ve-du-lieu-ca-nhan-91-2025-qh15) · [Luật 134/2025/QH15 toàn văn](https://hethongphapluat.com/law-no-134-2025-qh15-dated-december-10-2025-on-artificial-intelligence.html) · [NĐ 142/2026 Điều 18](https://hethongphapluat.com/nghi-dinh-142-2026-nd-cp-huong-dan-luat-tri-tue-nhan-tao/dieu-18)
Meta: [pages_messaging](https://developers.facebook.com/docs/permissions/reference/pages_messaging)
