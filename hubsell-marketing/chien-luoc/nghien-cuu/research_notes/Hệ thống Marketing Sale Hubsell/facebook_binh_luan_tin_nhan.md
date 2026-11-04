# Tự động trả lời bình luận Page, Messenger và chuyển người thật trên Page Facebook của Hubsell (trạng thái 03/11/2026)

Cách đọc: gần như toàn bộ quy tắc được diễn đạt lại bằng tiếng Việt thay vì trích nguyên văn; tên API, mã lỗi, tên cài đặt giữ nguyên. Tài liệu Meta đang chuyển từ `/docs/...` sang `/documentation/business-messaging/...`, một số đường dẫn cũ trả 404 hoặc trang rỗng. ⏳ = cũ hoặc chưa kiểm được từ nguồn gốc. Chưa đăng nhập, chưa thử API, nên mọi điều về hành vi thực tế đều chưa được kiểm trên Page 61594385712213.

## 1. Webhook và trường nào đưa bình luận, tin nhắn tới? Luật gửi, gửi lại, hạn phản hồi

### Takeaway
Bình luận đến qua `feed` (đối tượng `page`), tin nhắn đến qua `messages`, tin do Page gửi đến qua `message_echoes`. Với Messenger phải trả 200 trong tối đa 5 giây, nên cần nhận trước rồi xử lý AI ở hàng đợi; lỗi liên tục 1 giờ thì bị hủy đăng ký.

### Cited Findings
- Bình luận: trường `feed`, trong `value` có `item` (gồm `comment`), `verb` (`add`, `edit`, `remove`, `hide`...), `comment_id`, `parent_id`, `post_id`, `from` (`id`, `name`), `message`, `created_time`, `is_hidden`, `permalink_url` — [Page webhook reference](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/)
- Không có webhook cho bài quảng cáo (Ad Post), nhưng vẫn có webhook cho bình luận trên bài quảng cáo. Trường `mention` là trường riêng, một số `comment_id`/`post_id` có thể không trả về do quyền riêng tư — [Page webhook reference](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/)
- Đăng ký Page: `POST /{page-id}/subscribed_apps` với `subscribed_fields`, dùng Page access token. Chỉ có thông báo khi Page đã cài app và không tắt nền tảng **Apps** trong cài đặt ứng dụng — [Webhooks for Pages](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-pages)
- Trường Messenger: `messages`, `message_echoes`, `messaging_handovers`, `standby`, `messaging_postbacks`, `messaging_referrals`, `messaging_optins`, `message_deliveries`, `message_reads`, `message_reactions`, `message_edits`, `messaging_policy_enforcement`, `response_feedback`... — [Messenger Webhooks](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks)
- Hạn phản hồi Messenger: 200 OK HTTPS trong tối đa 5 giây — [Messenger Webhooks](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks); mâu thuẫn: trang App Review của Messenger ghi 20 giây — [Messenger App Review](https://developers.facebook.com/documentation/business-messaging/messenger-platform/app-review.md)
- Gửi lại Messenger: thử lại ngay vài lần (phải tự khử trùng lặp); sau 15 phút vẫn lỗi có cảnh báo vào tài khoản developer; lỗi liên tục 1 giờ có cảnh báo **Webhooks Disabled** và app bị hủy đăng ký khỏi Page, sửa xong phải đăng ký lại. Tin có thể đến sai thứ tự sau sự cố, sắp theo `timestamp` — [Messenger Webhooks](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks)
- Luật chung của Webhooks (áp cho `feed`; tài liệu nói rõ Messenger có timing riêng): gộp lô tối đa 1000 cập nhật nhưng không bảo đảm gộp; thử lại ngay rồi thưa dần trong 36 giờ, quá 36 giờ thì bỏ; không truy vấn lại được lịch sử thông báo; trường `time` là lúc gửi chứ không phải lúc phát sinh — [Webhooks Getting Started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
- Bảo mật: chữ ký `X-Hub-Signature-256` (SHA256 với App Secret); TLS hợp lệ, không chấp nhận chứng chỉ tự ký; xác minh bằng GET `hub.challenge` — [Webhooks Getting Started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
- Trong một payload Messenger, `entry` có thể chứa nhiều đối tượng, mỗi đối tượng có mảng `messaging` — [Messenger Webhooks](https://developers.facebook.com/docs/messenger-platform/webhooks)

### Inferences
- Thiết kế an toàn: endpoint chỉ kiểm chữ ký, ghi hàng đợi bền, trả 200 ngay; lấy mốc 5 giây vì là con số chặt hơn. Khử trùng lặp bằng `mid` (tin) và `comment_id` + `verb` (bình luận).
- Phải bỏ qua sự kiện có `from.id` = Page id trong `feed`, và `is_echo` trong `messages`, nếu không bot sẽ tự trả lời chính mình.
- Bình luận trên bài chạy quảng cáo vẫn vào luồng này, nên bot sẽ thấy cả bình luận từ chiến dịch trả tiền.

### Gaps
- Không thấy tài liệu nói rõ `feed` có bị hủy đăng ký sau 1 giờ lỗi như Messenger hay không; luật 36 giờ là luật chung.

## 2. Cần quyền nào? Standard Access có đủ cho app chỉ phục vụ Page của chính công ty không? Khi nào cần App Review, Business Verification, Live?

### Takeaway
**Tài liệu Meta tự mâu thuẫn ở đúng câu hỏi quan trọng nhất.** Trang tổng quan Messenger nói App Review không cần cho Page của chính mình, còn trang Webhooks và Private Replies nói Standard Access chỉ thấy người có vai trò trên app. Phải thử thực tế bằng một tài khoản không có vai trò trước khi quyết; nếu không nhận được thì phải đi Advanced Access.

### Cited Findings
- **Phe "không cần review":** về App Review, trang tổng quan Messenger ghi: "Not required if you only send and receive messages for your own Facebook Page." Cùng trang định nghĩa Standard Access là giới hạn dữ liệu ở người có vai trò trên app **hoặc Page** — [Messenger Overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview)
- **Phe "cần review":** Standard Access chỉ nhận thông báo từ người có vai trò trên app (admin, developer, tester); muốn nhận từ khách không có vai trò thì cần Advanced Access, kèm App Review; phải publish app — [Messenger Webhooks](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks)
- Private Replies cũng ghi app Standard Access chỉ truy cập được dữ liệu của người có vai trò trên app — [Private Replies](https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies.md)
- Trang Access Levels không đề cập tài sản hay Page do chính doanh nghiệp sở hữu; chỉ phân biệt theo vai trò người dùng. Business, Consumer, Gaming app được tự duyệt Standard Access — [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/)
- App Review không cần nếu chỉ người có vai trò trên app dùng app; app loại Business không có chế độ Development/Live mà dùng cấp truy cập — [App Review Introduction](https://developers.facebook.com/docs/app-review/introduction)
- Trang App Review của Messenger nói phải nộp duyệt trước khi app được công khai, Page gắn với app phải đã publish, nên đăng ký `messaging_policy_enforcement` — [Messenger App Review](https://developers.facebook.com/documentation/business-messaging/messenger-platform/app-review.md)
- Business Verification: bắt buộc cho app cần Advanced Access; app chỉ dùng bởi người có vai trò thì không cần — [Business Verification](https://developers.facebook.com/docs/development/release/business-verification). Tổng quan Messenger ghi cần khi app được dùng bởi người không có vai trò — [Messenger Overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview)
- Advanced Access còn kéo theo Data Use Checkup hằng năm. App Consumer phải ở Live mới xin được Advanced từ người không vai trò — [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/)
- Bộ quyền Messenger chuẩn: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`, `business_management` — [Messenger Overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview)
- `pages_messaging` (phụ thuộc `pages_manage_metadata`, `pages_show_list`): quản lý và truy cập hội thoại Page. `pages_manage_engagement` (phụ thuộc `pages_read_user_content`, `pages_show_list`): tạo, sửa, xóa bình luận. `pages_read_engagement`: đọc nội dung Page, tên người theo dõi, PSID. `pages_read_user_content`: đọc bài, bình luận, đánh giá của người dùng trên Page và xóa bình luận. `pages_manage_metadata`: đăng ký webhook Page. Mỗi quyền có mục nộp duyệt kèm video screencast — [Permissions Reference](https://developers.facebook.com/docs/permissions/reference)
- **`pages_read_user_engagement` không xuất hiện trong Permissions Reference**; tên đúng gần nhất là `pages_read_user_content` và `pages_read_engagement` — [Permissions Reference](https://developers.facebook.com/docs/permissions/reference)
- Tác vụ trên Page: đăng ký `feed` cần người có task `CREATE_CONTENT`, `MANAGE` hoặc `MODERATE`; trường nhắn tin cần `MESSAGING` — [Webhooks for Pages](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-pages). Trả lời bình luận cần `MODERATE` — [Comments reference](https://developers.facebook.com/docs/graph-api/reference/object/comments/)
- ⏳ Lời kể trên diễn đàn developer, không phải tài liệu Meta: ở chế độ dev, sự kiện từ tài khoản không vai trò không đến; có người báo `from` rỗng với người bình luận không vai trò ngay cả khi đã được duyệt quyền nâng cao; có ca có Advanced + Live vẫn không nhận, được khuyên cấp lại token và đăng ký lại — [Thread 938472964633442](https://developers.secure.facebook.com/community/threads/938472964633442), [Thread 698083212540459](https://developers.secure.facebook.com/community/threads/698083212540459), [Thread 1149386096112713](https://developers.secure.facebook.com/community/threads/1149386096112713)

### Inferences
- Câu "own Page" có vẻ là cách viết mới hơn và cụ thể hơn, nhưng đây chỉ là suy đoán của người ghi; không có ngày cập nhật để xác định bên nào mới hơn.
- Bài kiểm rẻ nhất (khoảng 1 giờ, không tốn phí): tạo app Business, gắn Page, đăng ký `messages` + `feed`, rồi dùng tài khoản Facebook KHÔNG có vai trò trên cả app lẫn Page để nhắn tin và bình luận. Ghi lại: có webhook không, `from` có đầy đủ không, trả lời được không, private reply có chạy không. Thử cả tài khoản có vai trò trên Page nhưng không có vai trò trên app, vì tổng quan ghi "app hoặc Page".
- Ngay cả khi Standard chạy được cho Messenger, tổng quan chỉ nói về "send and receive messages". Nó không bao phủ rõ ràng bình luận, nên nhánh bình luận có thể vẫn cần Advanced cho `pages_read_user_content` và `pages_manage_engagement`.
- Nếu phải review: cần công ty đã xác minh, video screencast cho từng quyền, bot phải đáp ứng tiêu chí thử của review (phản hồi trung bình dưới 1 phút, có lối thoát khi gặp đầu vào lạ).

### Gaps
- Không có câu nào của Meta xác nhận trực tiếp `feed` từ người không vai trò chạy được dưới Standard Access cho Page nhà.
- Chưa kiểm app Meta hiện có của Hubsell hay trạng thái xác minh doanh nghiệp của công ty. ID 61594385712213 chưa được kiểm có đúng là Page ID trong Graph API hay không.
- Thời gian duyệt App Review hiện tại: không có nguồn gốc.

## 3. Cửa sổ nhắn tin: 24 giờ, message tag, HUMAN_AGENT, thông báo một lần / định kỳ, tình trạng ở Việt Nam

### Takeaway
Bot chỉ chủ động được trong 24 giờ kể từ tin của khách (có thể tới 7 ngày nếu khách đến từ quảng cáo Click-to-Messenger, theo tài liệu). `HUMAN_AGENT` chỉ dành cho người trả lời thủ công. Recurring Notifications đã chết ở Việt Nam; Marketing Messages chỉ dành cho tech provider.

### Cited Findings
- Cửa sổ chuẩn 24 giờ với đa số hành động; sau tin đầu từ quảng cáo Click-to-Messenger hoặc Click-to-Direct có thể tới 7 ngày. Trong cửa sổ được phép có nội dung khuyến mại — [Messaging policy](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview), [Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages.md). Changelog ghi mốc này ngày 28/09/2026 — [Changelog](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/changelog)
- Ba loại gửi: Response và Updates phải trong cửa sổ, được quảng cáo; Tagged Message ngoài cửa sổ, phải có tag đúng mục đích và không được quảng cáo — [Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages.md)
- **Từ 27/04/2026, `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE` trả lỗi 100** — [Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages.md). Chính sách còn nêu Human Agent và `NON_PROMOTIONAL_SUBSCRIPTION` (tin tức, chỉ Page đăng ký NPI) — [Messaging policy](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview)
- `HUMAN_AGENT`: cho đại diện doanh nghiệp trả lời **thủ công** trong khoảng 7 ngày riêng, dùng cho luồng leo thang — [Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages.md). Tính năng này cần App Review và xác minh doanh nghiệp trước khi truy cập dữ liệu thật; mục đích ví dụ: ngoài giờ cuối tuần, vấn đề xử lý quá 24 giờ — [Human Agent feature](https://developers.facebook.com/docs/features-reference/human-agent)
- Dùng tag sai mục đích có thể bị hạn chế khả năng gửi của Page — [Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages.md)
- One-Time Notification: khách đồng ý thì Page có token gửi đúng một tin, dùng một lần, hết hạn trong 1 năm; không có cho Instagram — [Messaging policy](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview). Send Messages vẫn liệt kê nó là lối gửi ngoài cửa sổ — [Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages.md). ⏳ Trang chi tiết đường dẫn cũ trả 404, đường dẫn mới không đọc được nội dung, nên chưa kiểm hạn chế vùng.
- Recurring Notifications: ngừng từ 10/02/2026 trên toàn cầu, **trừ** AU, EU, JP, KR, UK; gọi API sẽ lỗi — [Marketing Messages FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq.md), [Recurring Notifications](https://developers.facebook.com/docs/messenger-platform/send-messages/recurring-notifications)
- Marketing Message API for Messenger: **chỉ dành cho tech provider** có app đã qua App Review; danh sách vùng doanh nghiệp được phục vụ **có Vietnam (VN)**; người nhận ở mọi vùng trừ EU, Nhật, Hàn, Úc, Anh — [Marketing Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger.md)
- Sponsored Messages (trả tiền) gửi được cho người từng nhắn Page, sau khi cửa sổ hết — [Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages.md)

### Inferences
- Bot AI không được gắn `HUMAN_AGENT`. Lịch trình đúng: bot trả lời trong 24 giờ; người thật mới dùng tag 7 ngày.
- App chạy không review sẽ không có tính năng `human_agent`. Để lối này mở cần đi review.
- Với lead đã im: trong 24 giờ có thể nhắc một lần kèm ưu đãi; sau đó chỉ còn Sponsored Messages hoặc OTN nếu xin được từ trước. Không có cách nhắc miễn phí không giới hạn, nên phải xin SĐT hoặc Zalo trong cửa sổ.

### Gaps
- Người gõ trực tiếp từ Business Suite Inbox sau 24 giờ có bị giới hạn theo cùng cửa sổ 7 ngày không: tài liệu đọc được không nêu.
- Marketing Messages có thể mua qua Ads Manager cho doanh nghiệp không phải tech provider không: FAQ có câu hỏi này nhưng chưa đọc được phần trả lời.
- Danh sách tag đầy đủ hiện hành: trang Send API reference không đọc được nội dung (⏳).

## 4. Private reply cho bình luận: endpoint, giới hạn, khung thời gian, số lần mỗi bình luận

### Takeaway
`POST /PAGE-ID/messages` với `recipient.comment_id`, một tin cho người bình luận, trong 7 ngày. Chỉ khi họ đáp thì cửa sổ 24 giờ mới mở cho bot nhắn tiếp.

### Cited Findings
- Endpoint: `POST https://graph.facebook.com/v26.0/PAGE-ID/messages`, `recipient` nhận `comment_id` hoặc `post_id` — [Private Replies](https://developers.facebook.com/docs/messenger-platform/discovery/private-replies)
- Giới hạn: chỉ một tin cho người đã bình luận; trong 7 ngày kể từ khi tạo bài hoặc bình luận; chỉ khi người đó trả lời mới nói tiếp được trong cửa sổ 24 giờ; không gửi private reply cho Page khác — [Private Replies](https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies.md)
- Cần Page access token của người có task `MESSAGING`, quyền `pages_messaging`, và ID bình luận lấy từ webhook `feed` (được khuyên để tránh giới hạn tốc độ) hoặc `/page/feed` — [Private Replies](https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies.md)
- Tin nhận được kèm liên kết tới bài hoặc bình luận gốc — [Private Replies](https://developers.facebook.com/docs/messenger-platform/discovery/private-replies)
- Đối tượng `Comment` có `can_reply_privately` và `private_reply_conversation` — [Comment reference](https://developers.facebook.com/docs/graph-api/reference/comment/)
- Trả lời công khai: `POST /{comment-id}/comments` với `message` hoặc ảnh; Page token của người có `MODERATE`, quyền `pages_manage_engagement`; khả năng trả lời phụ thuộc `can_comment` — [Comments reference](https://developers.facebook.com/docs/graph-api/reference/object/comments/)
- Ẩn bình luận: `POST /{comment_id}` với `is_hidden`; xóa: `DELETE /{comment_id}` — [Comment reference](https://developers.facebook.com/docs/graph-api/reference/comment/)

### Inferences
- Mẫu chuẩn: gọi `can_reply_privately`, gửi private reply có câu hỏi cụ thể để khách trả lời (mở cửa sổ), đồng thời trả lời công khai ngắn. Không có ép khách tương tác để nhận nội dung (xem mục 7).
- Câu chữ "một tin" được hiểu là một lần cho mỗi bình luận; một người bình luận nhiều lần có nhận nhiều lần không thì tài liệu không nói rõ. Nên khử theo người để giữ an toàn.

### Gaps
- Không có con số giới hạn riêng cho private reply trên Facebook (xem mục 7). Khung 7 ngày tính theo `created_time` của bình luận hay bài với bài cũ: tài liệu nêu "bài hoặc bình luận", chưa thử.

## 5. Handover / Conversation Routing: chuyển người thật, lấy lại quyền, echo từ Business Suite

### Takeaway
Handover Protocol đã bị khai tử trên Messenger, thay bằng Conversation Routing nhưng API vẫn gần như tương thích. Bot chuyển cho người bằng `pass_thread_control` tới app id Page Inbox; người gõ thì có `message_echoes`, và app biết tin đến từ Inbox qua `app_id`.

### Cited Findings
- Meta không còn hỗ trợ Handover Protocol cho Messenger; đã chuyển sang Conversation Routing, phần lớn tương thích ngược. Instagram ngừng ngày 23/10/2025 — [Conversation Routing](https://developers.facebook.com/docs/messenger-platform/conversation-routing), [Changelog](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/changelog)
- Không cấu hình gì (default behavior) dùng được khi chỉ có một app kết nối, nhưng phải tự phối hợp với Page Inbox để không trả lời trùng — [Conversation Routing](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversation-routing.md)
- Default app là app trả lời khi không có app khác đang giữ; Business Suite Inbox có thể là app kết nối hoặc default app. Nếu chuyển tin sang thư mục Main hoặc trả lời trong hội thoại Inbox chưa giữ, **Inbox tự giành quyền** — [Conversation Routing](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversation-routing.md)
- Chuyển tới Inbox: `target_app_id` = `263902037430900` (Page Inbox), `1217981644879628` (Instagram Inbox) — [Conversation Routing](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversation-routing.md)
- API: `/PAGE-ID/pass_thread_control`; `take_thread_control` khi thread idle hoặc app là Primary Receiver; `request_thread_control` chỉ cho default app; `release_thread_control` đưa về idle; `extend_thread_control` tới 7 ngày (mặc định 24 giờ); `GET /PAGE-ID/thread_owner` xem chủ — [Conversation Routing](https://developers.facebook.com/docs/messenger-platform/conversation-routing)
- Thread idle: 24 giờ không có tin khách hoặc chủ đã nhả. Chỉ default app được nhắn thread idle, và phải còn trong cửa sổ — [Conversation Routing](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversation-routing.md)
- Cấu hình ở Page Settings > Page Setup > Advanced Messaging > Connected apps hoặc Meta Business Suite > Settings > Conversation routing — [Conversation Routing](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversation-routing.md)
- `standby`: thông báo khi hội thoại không do app giữ; `messaging_handovers`: thông báo đổi quyền — [Messenger Webhooks](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks). Trang Routing lúc viết `messaging_handover` lúc viết `messaging_handovers`; bảng trường webhook dùng `messaging_handovers`.
- `message_echoes` kích hoạt khi Page gửi tin; có `is_echo`, `app_id`, `metadata` (chỉ có khi đã đặt lúc gửi), `sender.id` = Page, `recipient.id` = PSID. Từ Graph v12.0, `app_id` là ID Page inbox khi gửi qua Page inbox — [message_echoes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/message-echoes.md)
- **Mâu thuẫn số:** trang echoes ghi `26390203743090` (14 chữ số), trang Routing ghi `263902037430900` (15 chữ số) — [message_echoes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/message-echoes.md), [Conversation Routing](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversation-routing.md)
- Conversations API có `is_owner` khi bật Routing (13/10/2025) — [Changelog](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/changelog)
- Personas API cho phép hiện tên và ảnh riêng cho nhân viên hoặc bot trong hội thoại — [Personas](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/personas.md)

### Inferences
- Luồng đề xuất: bot là default app. Khi cần người: `pass_thread_control` sang `263902037430900`, gửi cảnh báo nội bộ (Telegram hoặc email) kèm tóm tắt. Trong lúc Inbox giữ, bot nhận `standby` và chỉ ghi nhận, không trả lời. Khi xong: thread thành idle sau 24 giờ, hoặc nút trong công cụ nội bộ gọi `take_thread_control`.
- Chốt chặn đôi: dù định tuyến lỗi, cứ thấy echo có `app_id` khác app của mình (so bằng cả hai số trên, hoặc đơn giản "khác app của mình") thì tắt bot cho PSID đó trong X giờ. Nhờ vậy nhân viên chỉ cần gõ trực tiếp là bot im, không cần bấm gì.
- Echo chứa câu trả lời của người thật, về kỹ thuật có thể dùng để gợi ý kiến thức cho bot; về chính sách xem mục 6.

### Gaps
- Tài liệu chỉ nói "Facebook Page inbox", chưa khẳng định tin gửi từ Business Suite (web, app mobile) có echo và cùng `app_id`. Phải thử thực tế.
- ⏳ Trong trí nhớ cũ, đánh dấu "Done" trong Inbox trả quyền về Primary Receiver; trang đọc được không xác nhận nên không được dựa vào.
- Không thấy định nghĩa "Primary/Secondary Receiver" trong tài liệu Routing hiện hành; chỉ còn nhắc "Primary Receiver" ở `take_thread_control`.

## 6. Chính sách về chatbot AI: công bố tự động, có phải cho gặp người, thay đổi 2025–2026, WhatsApp có áp lên Messenger không

### Takeaway
Không tìm thấy lệnh cấm chatbot AI đa năng nào trên Messenger; điều 4.7 chỉ nằm trong điều khoản WhatsApp Business Platform. Messenger yêu cầu công bố tự động khi luật đòi và khuyến nghị công bố trong mọi trường hợp; không có điều bắt buộc phải có người thật, nhưng có luật phản hồi 30 giây cho bot loại "automated".

### Cited Findings
- Công bố: khi luật hiện hành yêu cầu, trải nghiệm chat tự động phải cho biết người dùng đang nói với dịch vụ tự động: đầu hội thoại, sau khoảng lặng dài, và khi chuyển từ người sang máy. Khuyến nghị làm cả khi luật không đòi. Lưu ý đặc biệt California, Đức — [Messaging policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy.md)
- Ba loại bot: automated, manual reply, hybrid. Luật phản hồi chỉ áp cho loại automated; đổi loại ở Page Settings > Advanced Messaging — [Messaging policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy.md)
- Bot automated phải phản hồi mọi đầu vào (trừ nút Get Started) trong 30 giây; không sửa trong 7 ngày có thể bị hạn chế gửi — [Messaging policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy.md)
- Chính sách không đặt thời hạn chuyển người và không bắt buộc phải có người thật — [Messaging policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy.md)
- Vi phạm được báo qua email về Page Support Inbox; trả lời email để tới đội Policy, phản hồi trong khoảng 3 ngày làm việc — [Messaging policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy.md)
- Platform Terms (cập nhật 03/02/2026) không nhắc AI hay mô hình theo tên. Liên quan: không xử lý Platform Data cho mục đích ngoài phần tài liệu cho phép (3.a.viii); nhà cung cấp dịch vụ chỉ được dùng dữ liệu cho bạn, theo chỉ dẫn của bạn, không cho mục đích riêng (5.a.i.1), và bạn chịu trách nhiệm về họ (5.a.ii); xóa dữ liệu khi không còn cần hoặc người dùng yêu cầu (3.d.i) — [Platform Terms](https://developers.facebook.com/terms/)
- Điều 4.7 (AI Providers), WhatsApp: cấm nhà cung cấp AI dùng WhatsApp Business Platform khi AI là chức năng chính thay vì phụ trợ, có ngoại lệ theo quốc gia. Bản sửa gần nhất 23/09/2026. Điều khoản không áp cho Messenger, từ này chỉ xuất hiện ở chân trang — [Meta Terms for WhatsApp Business Platform](https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform)
- Một blog của nhà cung cấp cũng nói chính sách chỉ áp WhatsApp và cảnh báo Meta có thể mở rộng sau (nguồn thứ cấp, suy đoán) — [respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban)
- Luật Trí tuệ nhân tạo 134/2025/QH15 có hiệu lực 01/03/2026; Nghị định 142/2026 hiệu lực 01/05/2026, có mục về dán nhãn nội dung do AI tạo — [AP Law Japan](https://www.aplawjapan.com/publications/20260528)

### Inferences
- Bot của Hubsell là bot tư vấn cho doanh nghiệp, không phải trợ lý AI đa năng đem bán, nên cả khi có điều tương tự 4.7 thì khả năng cao vẫn được xem là phụ trợ. Bot nên chỉ giới hạn trong chủ đề Hubsell, từ chối hỏi linh tinh.
- Rủi ro chính sách về sau: Meta đang bán Business Agent trên chính Messenger (mục 8), nên chính sách có thể đổi; đây là suy đoán, hiện không có văn bản nào về việc này.
- Đặt loại **hybrid** ở Advanced Messaging để không chịu luật 30 giây cứng, vẫn phản hồi nhanh.
- Nên công bố bằng câu đầu hội thoại kiểu "Em là trợ lý AI của Hubsell, cần người thật cứ nhắn 'gặp người'", vì chính sách khuyến nghị và luật Việt Nam có thể yêu cầu.
- Dùng echo hoặc hội thoại khách để huấn luyện: Platform Terms không cấm rõ cũng không cho rõ; an toàn hơn là dùng làm cơ sở tri thức nội bộ, không huấn luyện mô hình; nhà cung cấp LLM phải đóng vai service provider không dùng dữ liệu cho mục đích riêng.

### Gaps
- **Luật AI Việt Nam có bắt buộc chatbot báo "đang nói với AI" không, điều nào, ai chịu: chưa kiểm được** từ văn bản gốc; cần đọc Luật 134/2025/QH15 và NĐ 142/2026. Nghĩa vụ dữ liệu cá nhân (Luật BVDLCN) chưa nghiên cứu ở đây.
- Không tìm thấy văn bản gốc nào của Meta nêu "không có điều cấm trên Messenger"; đây là kết luận từ việc đọc các trang chính sách không thấy điều cấm.

## 7. Giới hạn tốc độ và rủi ro spam, tự động hóa với Page

### Takeaway
Giới hạn kỹ thuật dư xa so với quy mô của một Page mới. Rủi ro thật nằm ở Page ít người tương tác (hạn mức tính theo người tương tác) và ở việc trả lời lặp lại hàng loạt.

### Cited Findings
- Messenger API theo Page: số call 24 giờ = 200 × số Engaged Users (người doanh nghiệp nhắn được), cửa sổ cuộn; Conversations API 2 call/giây; Send API 300 call/giây với text, link, reaction, sticker; 10 call/giây với audio, video; gửi nhiều vào một thread cũng có thể bị giới hạn — [Rate limiting](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting.md)
- Trên 40 tin/giây hoặc lưu lượng cao kéo dài: tin mới không hiện trong Page Inbox, Page không gửi được tới khi giảm tải; gọi danh sách hội thoại lỗi — [Rate limiting](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting.md)
- Private Replies: 750 call/giờ, nhưng trang ghi rõ cho bình luận bài và reels Instagram; không có số riêng cho Facebook — [Rate limiting](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting.md). Bản tiếng Việt của trang Graph API từng ghi 750/giây, trong khi tiếng Anh là 750/giờ — [Graph rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- Pages BUC: 4800 × Engaged Users trong 24 giờ cho call bằng Page hoặc system user token — [Graph rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- Trang Graph cũ ghi Send API Instagram 100 call/giây, trang mới ghi 300; lấy trang Messenger mới — [Graph rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/), [Rate limiting](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting.md)
- Mã lỗi: 613 quá giới hạn; 10 lỗi quyền (kèm subcode `2018300` khi Business AI giữ hội thoại); 100 tham số sai; 190 token hết hạn; 551 và 1545041 người nhận không sẵn sàng — [Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages.md), [Conversation Routing](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversation-routing.md)
- Community Standards về spam: cấm tương tác thủ công hay tự động với tần suất rất cao; tần suất thấp vẫn có thể bị hạn chế khi có dấu hiệu không xác thực; đăng nội dung lặp lại là dấu hiệu spam; cấm yêu cầu người dùng phải tương tác mới được xem nội dung hứa hẹn; cấm link nội dung khác lời hứa — [Spam policy](https://transparency.meta.com/policies/community-standards/spam/)

### Inferences
- Ví dụ minh họa: 50 engaged users cho khoảng 10.000 call Messenger và 240.000 call Pages mỗi 24 giờ, dư cho một Page mới. Cần xử lý 613 bằng lùi thời gian và lấy số 750/giờ làm trần an toàn cho private reply.
- Mẫu "bình luận 'quan tâm' để nhận link" khớp với điều cấm ép tương tác; không nên đặt mồi này trong nội dung bài đăng.
- Trả lời công khai phải khác nhau theo ngữ cảnh, có độ trễ tự nhiên, chỉ trả lời bình luận có ý định thật, bỏ qua bình luận spam, tối đa số lượt nhất định theo giờ. Ngưỡng cụ thể sẽ là số tự chọn vì Meta không công bố.

### Gaps
- Meta không công bố ngưỡng cụ thể cho hành vi "spam" khi Page trả lời bình luận; không có số nào được kiểm chứng.

## 8. Business AI / Business Agent của Meta trên Messenger: có ở Việt Nam không, làm được gì

### Takeaway
Có ở Việt Nam dạng tiếng Việt từ tháng 4/2026 (báo chí ghi là beta, đối tác nói có whitelist), nhưng không có nguồn Meta xác nhận khách tự bật được hôm nay. Nó và bot riêng loại trừ nhau theo từng hội thoại, và điều khoản cho phép Meta dùng dữ liệu đầu vào cho mô hình của họ.

### Cited Findings
- Tháng 4/2026 Meta ra mắt Business AI trên Messenger tại Hà Nội; học từ website và lịch sử tin nhắn; thử sớm với HADAKI tăng 20% chuyển đổi và gấp đôi năng lực xử lý (số do Meta/báo chí nêu) — [VOV World](https://vovworld.vn/news/meta-unveils-ai-business-suite-in-vietnam-to-drive-social-commerce-2426183.vov5)
- Vietnam News 10/04/2026 ghi là beta, tiếng Việt, Meta thử nghiệm tại Việt Nam — [Vietnam News](https://vietnamnews.vn/Sci-Tech/1779103/viet-nam-becomes-test-bed-for-ai-driven-commerce-tools.html)
- Đối tác AdsPlus (18/04/2026): trả lời 24/7, câu hỏi lặp lại; học dữ liệu trong Business Suite; có thể chuyển cho nhân viên; triển khai sớm theo whitelist qua webinar. Nguồn đối tác, có động cơ bán — [AdsPlus](https://old.adsplus.vn/blog/adsplus-dong-hanh-cung-meta-ra-mat-cong-cu-business-ai-tren-messenger-dau-tien-tai-viet-nam)
- 03/06/2026: Meta mở rộng Business Agent cho doanh nghiệp mọi cỡ toàn cầu, trên WhatsApp, Messenger, thêm Instagram; trả lời câu hỏi, gợi ý sản phẩm, đặt lịch, sàng lọc lead, chốt đơn; doanh nghiệp quyết định khi nào người vào; miễn phí thiết lập trên Instagram tạm thời, gói trả phí sẽ có. Không nêu tên Việt Nam — [About Meta](https://about.fb.com/news/2026/06/meta-business-agent/)
- Tài liệu developer của Business Agent Platform chỉ mô tả WhatsApp và có endpoint Eligibility, không liệt kê nước — [Business Agent overview](https://developers.facebook.com/documentation/meta-business-agent/overview)
- Điều khoản (16/07/2026): Lãnh thổ = Hoa Kỳ và các nước Meta chỉ định; không được xuyên tạc đầu ra AI là do người tạo; không nên dựa vào cho tư vấn chuyên môn; Meta có thể dùng dữ liệu đầu vào để cung cấp và cải thiện dịch vụ, mô hình AI, có giấy phép vĩnh viễn; khi chuyển quyền cho doanh nghiệp thì Agent tắt trong hội thoại nhưng có thể vẫn theo dõi nội dung chia sẻ. Không nêu Việt Nam — [Business Agent Terms](https://www.facebook.com/legal/3774714022740775)
- Khi Business AI giữ hội thoại: app của mình nhận qua `standby`, không được trả lời; chờ `messaging_handovers` có `pass_thread_control`. Cài đặt **Take control of conversations with your Business AI** mặc định tắt; khi tắt, gửi tin không tag sẽ lỗi 10/2018300 — [Conversation Routing](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversation-routing.md). Changelog ghi cài đặt này ngày 18/10/2026 — [Changelog](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/changelog)

### Inferences
- Nếu Business AI được bật trên Page, bot Hubsell sẽ im và báo lỗi 2018300; đây là điểm phải kiểm trước khi chạy.
- Business AI chỉ biết website và tin cũ, không gọi được hệ thống Hubsell với chiều sâu tùy biến của bot riêng (không có tài liệu Messenger cho khả năng kết nối API). Dùng thử làm mốc so sánh chi phí thấp là hợp lý nếu Page có sẵn tính năng này.

### Gaps
- Tình trạng hiện tại ở Việt Nam (đã mở đại trà hay còn whitelist), giá tại Việt Nam, và "Business AI" với "Business Agent" có đúng là một sản phẩm trên Messenger không: chưa kiểm được. Cách kiểm trực tiếp: anh xem trong Business Suite của Page có mục này không.
- Một trang giới thiệu Business Agent toàn cầu của Memeburn trả 403; trang one-sheet Meta trả 404.

## 9. Instagram có thêm giá trị không?

### Takeaway
Về kỹ thuật tái dùng được gần hết, nhưng không có dữ liệu cho thấy nên ưu tiên; làm sau khi Facebook chạy ổn.

### Cited Findings
- Instagram Messaging dùng chung nền tảng Messenger, cần tài khoản Professional và thêm `instagram_basic`, `instagram_manage_messages` — [Messenger Overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview). Private reply 750 call/giờ cho bài và reels — [Rate limiting](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting.md). Conversation Routing có Inbox riêng `1217981644879628` — [Conversation Routing](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversation-routing.md). One-Time Notification không có cho Instagram — [Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages.md)

### Inferences
- Nhà bán Shopee/TikTok Việt Nam tìm giải pháp chủ yếu qua Facebook, TikTok và Zalo là giả định chưa kiểm; nếu đúng thì Instagram chỉ là kênh phụ cho lát sau, chi phí thêm thấp vì dùng chung mã.

### Gaps
- Không có số liệu về tệp khách Hubsell trên Instagram.
