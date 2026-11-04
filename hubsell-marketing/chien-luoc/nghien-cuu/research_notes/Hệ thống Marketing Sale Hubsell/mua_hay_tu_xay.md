# Tầng hội thoại của Hệ Marketing-Sale Hubsell: mua hay tự xây (tính đến 03/11/2026)

**Ngày kiểm mọi nguồn web: 03/11/2026**, trừ khi ghi khác. ⏳ = chưa kiểm được hoặc chưa chắc. Giá lấy từ trang công khai, đọc không đăng nhập, không gửi biểu mẫu. Phần lớn trang đọc qua công cụ tóm tắt tự động, nên trước khi trả tiền vẫn phải nhìn lại trang gốc. Những trang không đọc được: zendesk.com (lỗi kết nối), manychat.com/pricing (403), harafunnel.com (522), smax.ai (chỉ hiện tiêu đề), trang giá subiz.com.vn/pricing và bizfly.vn/chat (404). Thân bài docs.pancake.biz không đọc được (trang dựng bằng JS).

**Giả định dùng trong ghi chú (tự chọn, chỉnh lại khi có số thật):**
- Chỉ quản lý kênh của chính Hubsell: 1 Page, 1 OA, 1–2 tài khoản TikTok.
- Người trực là anh Trung; 2 chỗ ngồi là đủ.
- Lượng hội thoại thật: [CHƯA CÓ SỐ]. Bảng tính dùng 2 kịch bản tự chọn: 300 và 1.500 hội thoại/tháng.
- Tỷ giá tự chọn 26.000 đ/USD, chưa kiểm.

---

## 1. Nên chọn phương án nào, và bảng so sánh ra sao?

### Takeaway
Khuyến nghị **lai có điều kiện**: mua hộp thư người trực và tầng nối kênh (ứng viên số 1 là Pancake, phải qua 6 phép thử ở dưới), tự xây bộ não và sổ hội thoại. Chưa nên tự host Chatwoot vì 2 trong 4 kênh cần nhất (Zalo OA, bình luận Page) nó không có sẵn. Không nên mua nhóm quốc tế lớn (respond.io, Intercom, Zendesk, Manychat) vì không hãng nào trong số này liệt kê Zalo OA là kênh gốc; Zendesk chỉ có app bên thứ ba. Chative và SaleSmartly có Zalo OA nhưng chưa soi giá và độ sâu. Chênh lệch tiền mặt giữa các phương án chỉ vài triệu đồng/tháng, nên cái quyết định là công sức của một người và các cổng duyệt của sàn, không phải giá.

### Cited Findings

**Bảng 1. Công cụ Việt Nam**

| Công cụ | Giá công khai | Messenger / bình luận Page | Zalo OA | TikTok | AI, dùng Claude được không | API / webhook | Chuyển người | Xuất dữ liệu, nơi lưu |
|---|---|---|---|---|---|---|---|---|
| **Pancake** | Trang giá hiện 0 đ do chưa chọn gói ([pancake.vn/pricing](https://pancake.vn/pricing)). Bên thứ ba 19/09/2026: Cá nhân ~249.000 đ (1 page, 1 NV), Starter ~799.000 đ (3, 3), Pro ~1.499.000 đ (6, 6)/tháng ([Viettopreview](https://viettopreview.vn/tai-phan-mem-pancake-2.html)). ⏳ giá chính thức | Có cả hai; bình luận và livestream hiện như hội thoại, kèm trả lời công khai và riêng (bên thứ ba: [AnythingMCP](https://anythingmcp.com/guides/connect-pancake-to-claude)) | Có ([docs Pancake](https://docs.pancake.biz/pancake/st-f1/st-p6)) | DM qua TikTok Business Messaging ([docs](https://docs.pancake.biz/pancake/st-f1/st-p6/st-s4/st-ss1?lang=vi)). Chính sách riêng tư nói nhận webhook bình luận mới ([privacy](https://pancake.vn/privacy)). ⏳ trả lời bình luận TikTok. Trang giá lại ghi "Sắp ra mắt" cho Messenger, TikTok, WhatsApp ở một mục ⏳ | "Trợ lý AI" cho sales/CSKH ([docs](https://docs.pancake.biz/pancake/st-f7/st-p11?lang=vi)). Không thấy tùy chọn đổi mô hình ⏳. Claude cắm được từ ngoài qua webhook + API | Có: webhook `messaging` gồm cả inbox và bình luận; mỗi page bật webhook tốn thêm 1 slot ([webhook.yaml](https://developer.pancake.biz/openapi/webhook.yaml)). API gửi tin v2 ([docs](https://docs.pancake.biz/pancake/st-f12/st-p1?lang=en)). 5 yêu cầu/giây/page (bên thứ ba) | Gán nhân viên qua API (bên thứ ba). Tự dừng bot: ⏳ | Có quyền nhận bản sao máy đọc được, yêu cầu qua support@. Giữ 2 năm sau khi hết gói. Không nêu quốc gia, có thể chuyển ra nước ngoài ([privacy](https://pancake.vn/privacy)) |
| **Botcake** (cùng nhà Pancake) | Starter 0 đ, 500.000 tin tự động/tháng; Pro từ $30; Premium liên hệ ([pricing](https://botcake.io/pricing)) | Có, trả lời bình luận tính vào tin tự động ([pricing](https://botcake.io/pricing)) | Có trang "Tích hợp ZaloOA" ([docs](https://docs.pancake.biz/botcake/st-f2/st-p3?lang=vi)), trang giá không nhắc Zalo ⏳ | Chỉ thấy DM, trang không nhắc bình luận ([TikTok](https://botcake.io/integrations/tiktok)) | Nối tài khoản **OpenAI** của mình, trả tiền token ([pricing](https://botcake.io/pricing)). Không thấy Claude ⏳ | Có API, webhook, sandbox ([pricing](https://botcake.io/pricing)) | ⏳ | ⏳ |
| **Subiz** | Cơ bản 3.994.000 đ/năm; Nâng cao 7.834.000 đ/năm; Doanh nghiệp liên hệ ([subiz.com.vn](https://subiz.com.vn/)) | Fanpage có; bình luận trang không nói riêng ⏳ | Có từ gói Cơ bản ([subiz.com.vn](https://subiz.com.vn/)) | 1 TikTok (Cơ bản), 20 (Nâng cao). ⏳ DM hay bình luận | Chatbot AI từ Nâng cao. Claude ⏳ | Bên thứ ba: API ở gói Doanh nghiệp ([kết quả xpay, không mở lại được](https://www.xpay.sh/agent-ready-index/subiz/)) ⏳ | ⏳ | ⏳ |
| **Fchat** | Starter 0; Livechat 99.000; Chatbot 299.000; Business 999.000 đ/tháng ([price](https://fchat.vn/price)) | Có, kèm tự trả lời và nhắn khách bình luận ([fchat.vn](https://fchat.vn/)) | Có trong danh sách kênh | Không nhắc | Trợ lý AI theo credit, mua thêm 10.000 credit 500.000 đ. Claude ⏳ | API & CRM chỉ gói Business ([price](https://fchat.vn/price)); có mục "Kết nối MCP" | ⏳ | ⏳ |
| **Markee Chat** | Cơ bản 529.000/tháng (399.000 nếu trả năm); Tăng trưởng 1.069.000 (799.000); dùng thử 14 ngày ([chat.markee.vn](https://chat.markee.vn/)) | Có cả hai | Có | "Gian hàng & Tin nhắn", không nêu bình luận ⏳ | AI học dữ liệu riêng, chuyển người khi cần; không thấy chọn mô hình | API cho gói doanh nghiệp; có trang api-docs ⏳ | Có | ⏳ |
| **BotClarify** | Chat thường 30.000 đ/kênh/tháng; AI 500.000 đ/tháng, không giới hạn kênh ([botclarify.com](https://botclarify.com/)) | Có cả hai | Có; phí gói OA có API do Zalo thu riêng | Không | Không nêu mô hình | Không nhắc API | Có: bot dừng, đánh dấu "Cần người hỗ trợ", tự nhường khi NV trả lời | **Ngắt kênh là xóa hội thoại kênh đó** ([botclarify.com](https://botclarify.com/)) |
| **Bizfly** | Không có giá riêng cho Bizfly Chat. BizShop 99.000–1.210.000 đ/tháng ([báo giá](https://bizfly.vn/giai-phap/bao-gia-bizshop.html)); BizChatAI không công bố giá ([trang](https://bizfly.vn/giai-phap/chat-bot-ai.html)) | Có tin và bình luận ([App Store](https://apps.apple.com/us/app/id1566526140)) | Có Zalo, ⏳ OA | Không nhắc | ⏳ | ⏳ | ⏳ | ⏳ |
| **Smax** | Không đọc được giá ⏳ | Messenger, tự động bình luận ([trang Smax](https://launch-smax.dorik.io/)) | Không thấy nhắc ⏳ | Không nhắc | AI Agent; Capterra/SourceForge liệt kê OpenAI ⏳ | Có đồng bộ dữ liệu; chi tiết ⏳ | ⏳ | ⏳ |
| **Harafunnel** | Không tìm được giá. Trang chủ lỗi 522 lúc kiểm. Nguồn tìm được đều cũ và chỉ nói Messenger ([Viettimes](https://viettimes.vn/chatbot-harafunnel-cua-haravan-dat-15000-nguoi-dung-tai-viet-nam-post74444.html)) ⏳ còn bán không | | | | | | | |
| **Abitmes, VPage, Sapo** | Có nhắc tới, chưa soi. Abitmes nhắm Facebook, TikTok Shop, Shopee, Zalo OA ([abitmes.vn](https://abitmes.vn/)); Sapo Chatbot AI thêm Zalo OA ([Sapo](https://www.sapo.vn/cap-nhat-tinh-nang/tich-hop-instagram-zalo-zalo-oa-vao-chatbot-ai)) ⏳ | | | | | | | |

**Bảng 2. Công cụ quốc tế**

| Công cụ | Giá công khai | Bình luận Page + trả lời riêng | Zalo OA | TikTok | AI, Claude | API / webhook | Xuất dữ liệu, nơi lưu |
|---|---|---|---|---|---|---|---|
| **Chatwoot Cloud** | Hacker $0 (live chat, 2 người); Startups $19; Business $39; Enterprise $99/người/tháng. Captain thêm $20/1.000 credit ([pricing](https://www.chatwoot.com/pricing)) | Không có sẵn, xem mục 3 | Không | Tài liệu DM cho bản tự host ([docs](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/tiktok)) ⏳ Cloud | Captain, hoặc tác tử riêng qua Agent Bot | Có | Giữ 1/2/3 năm theo gói; lưu tại Mỹ ([privacy](https://www.chatwoot.com/privacy-policy)) |
| **Chatwoot tự host** | CE $0; Premium Support $19; Enterprise $99/người/tháng ([self-hosted](https://www.chatwoot.com/pricing/self-hosted-plans/)) | Như trên | Không | Như trên | CE không có Captain; tác tử riêng được | Có | Dữ liệu của mình |
| **respond.io** | Starter $79, Growth $159, Advanced $279/tháng trả năm; trả tháng $99/199/349 ([pricing](https://respond.io/pricing)) | Có: 1 trả lời riêng mỗi bình luận, trong 7 ngày ([help](https://respond.io/help/facebook-messenger/private-replies)) | **Không có trong danh sách**; có Custom Channel qua API ([integrations](https://respond.io/integrations)) | Business Messaging (Beta) | AI Agents từ Growth. Claude ⏳. Trang vừa tính credit vừa nói không phí thêm, mâu thuẫn ⏳ | API từ Growth; webhook vào/ra ở Advanced | Xuất được, mỗi lần 1 năm; cấu hình AI và workflow không xuất hàng loạt (bên thứ ba: [Converge](https://converge-static.pages.dev/migrate/respond-io/data-export)) |
| **Intercom + Fin** | $19/$85/$132/người/tháng; **Fin $0,99/kết quả**, chạy được trên helpdesk khác, có mức cam kết tối thiểu ([pricing](https://www.intercom.com/pricing)) | ⏳ trang không nhắc | Không nhắc | Không nhắc | Fin, không đổi mô hình ⏳ | Có | Xuất S3 không kèm toàn văn hội thoại; xuất lại không nhập được workspace mới ([help](https://www.intercom.com/help/en/articles/7029721-export-conversations-data-to-amazon-s3)) |
| **Zendesk** | Trang chính thức không mở được. Bên thứ ba: ~$1,50–2,00/resolution; Copilot $50/người; ghế $19–115 ([eesel](https://eesel.ai/blog/zendesk-ai-pricing/), [coworker](https://coworker.ai/blog/zendesk-ai-pricing)); nguồn mâu thuẫn ⏳ | ⏳ | Có app bên thứ ba của **Quesera** ([Marketplace](https://www.zendesk.co.uk/apps/support/1022071/zalo-integration/)), giá ⏳ | ⏳ | ⏳ | Có | ⏳ |
| **Manychat** | Trang giá 403. Bên thứ ba mâu thuẫn: Pro từ $15/500 liên hệ hoặc $29/2.500; AI ~$29 hoặc đã gồm ([Featurebase](https://www.featurebase.app/blog/manychat-pricing), [Chatarmin](https://chatarmin.com/en/blog/manychat-pricing)) ⏳ | Có người dùng làm theo từ khóa ([issue #9724](https://github.com/chatwoot/chatwoot/issues/9724)) ⏳ tài liệu hãng | Không thấy | Cần Advanced Access/VBA; bình luận → DM rất hạn chế, nguồn mâu thuẫn ([Manychat](https://manychat.com/blog/tiktok-automation-guide/)) | AI riêng ⏳ | ⏳ | Không thấy xuất hội thoại chính thức, mới là yêu cầu của người dùng ([community](https://community.manychat.com/ideas/export-conversations-5068)) |
| **Có Zalo OA khác** | Chative nối OA, mỗi kênh 1 OA ([docs](https://chative.io/docs/zalo-oa)); SaleSmartly nói nối qua API chính thức ([blog hãng](https://www.salesmartly.com/en/blog/docs/zalo-for-business-guide-vietnam-2026)); giá ⏳ | | | | | | |

**Bảng 3. Tiền mặt ước tính/tháng** (tính từ các giá trên; 1 Page + 1 OA + 1 TikTok; LLM ở 300 hội thoại/tháng)

| Phương án | Cộng dồn | Tổng |
|---|---|---|
| Tự xây mỏng, không hạ tầng mới | OA 208.000 + LLM ~470.000 | **~680.000 đ** + công (chưa có số) |
| Lai: Pancake Pro + bộ não | ~1.499.000 + 208.000 + 470.000 | **~2,2 tr đ** ⏳ giá Pancake là của bên thứ ba |
| Mua hẳn: Markee Cơ bản trả năm | 399.000 + 208.000 ⏳ | **~610.000 đ**, không phải AI của mình |
| Mua hẳn: Subiz Nâng cao | 653.000 + 208.000 ⏳ | **~860.000 đ**, không phải AI của mình |
| Chatwoot tự host trên Render | web 2 GB $25 + worker 2 GB $25 + Postgres 1 GB $19 + Key Value $10 = $79 + 208.000 + 470.000 | **~2,7 tr đ** + xây cầu Zalo, bình luận |
| respond.io Advanced trả năm | $279 + 208.000 ⏳ | **~7,5 tr đ**, vẫn phải xây cầu Zalo |

Nguồn: giá OA Tăng trưởng 2.500.000 đ/năm ([bảng giá Zalo](https://zalo.solutions/oa/pricing), kiểm 29/10 trong [HE-MARKETING-SALE-TUAN-1](../../../HE-MARKETING-SALE-TUAN-1-2026-10-29.md)); Render ([pricing.md](https://render.com/pricing.md)); Claude Sonnet 5.5 $2/$10, Haiku 5.5 $0,10/$0,50 mỗi triệu token ([claude.com/pricing](https://claude.com/pricing)).

Cách tính LLM (giả định tự chọn): 6 lượt, mỗi lượt 4.000 token vào và 200 token ra, dùng Sonnet, chưa tính cache → ~$0,06/hội thoại. 300 hội thoại ≈ $18; 1.500 hội thoại ≈ $90. So sánh: nếu Fin xử lý hết 300 hội thoại thì tốn $297.

⏳ Công cụ mua có buộc OA gói Tăng trưởng không thì chưa rõ. BotClarify nói phí gói OA có API tính riêng ([botclarify.com](https://botclarify.com/)), nên bảng tính gộp.

### Inferences
**Thử thách kế hoạch tự xây cũ:**
- Phần đúng và nên giữ: bộ não, chạy bóng, cổng 80 %, đồng ý riêng, tách thư mục. Kế hoạch tuần 1 thật ra chưa phải xây cả hộp thư: chỉ có webhook OA, và anh trả lời trong OA Manager, duyệt nháp ở HQ.
- Phần không đứng vững: mở nó thành "một hộp thư cho 4 kênh". Khi đó phải tự giữ token, phiên bản API, tệp đính kèm, thời gian thực, thông báo và **giao diện trên điện thoại** cho một người đang gánh cả prod.
- TikTok DM là cổng khó nhất. Tự làm phải qua Data Security & Privacy Review, duyệt tay, không theo dõi được tiến độ (mục 2.1 tệp tuần 1). Mua công cụ đã có app được duyệt có thể tránh cổng này, nhưng ⏳ cần thử thật.

**Vì sao lai thắng lúc này:**
- Chênh ~1,5 tr đ/tháng rẻ hơn công giữ các đầu nối.
- Giữ được thứ không mua được: Claude, tra tài khoản, đo nháp, luật AI.
- Sổ hội thoại của mình chép mọi sự kiện webhook từ ngày đầu, nên rời nhà cung cấp chỉ mất nhãn và cấu hình.
- Viết tầng kênh thành bộ chuyển đổi (adapter) để sau này thay Pancake bằng nối thẳng Meta/Zalo hoặc Chatwoot mà bộ não không đổi.
- Gói OA Tăng trưởng cho ủy quyền 3 app ([bảng giá Zalo](https://zalo.solutions/oa/pricing)), nên ⏳ có thể vừa nối Pancake vừa giữ webhook app riêng.

**6 phép thử trong 14 ngày dùng thử (anh tự đăng ký, em không đăng nhập):**
1. Webhook `messaging` có đủ tin Messenger, bình luận Page, tin OA, DM TikTok không, và trễ bao lâu?
2. API có gửi được trên OA và TikTok không? Trả lời bình luận công khai và riêng qua API có được không?
3. Sự kiện có phân biệt được máy gửi với người gửi không? Đây là điều kiện để đo nháp với câu anh gửi. Nối thẳng OA thì có `admin_id`; qua Pancake ⏳.
4. Giá thật cho 3 kênh kèm slot webhook; OA và TikTok có tính là "page" không?
5. Xin xuất toàn bộ hội thoại, xem có toàn văn và mất bao lâu.
6. Bình luận TikTok tự nhiên có vào được không; OA gói nào thì nối được?

**Nếu trượt phép 1–3:** thử Markee hoặc Subiz theo đúng bộ này. Vẫn trượt thì về tự xây mỏng (OA + Messenger + bình luận Page), người trực dùng app gốc từng kênh.

**Điều làm đổi khuyến nghị:**
- Lượng thật dưới khoảng 10 hội thoại/ngày (ngưỡng tự chọn): hoãn mua, chạy bóng OA như lịch cũ.
- Có thêm nhân viên hoặc yêu cầu dữ liệu ở lại trong nhà: xem lại Chatwoot tự host.
- Pancake không gửi được tin qua API: bỏ lai với Pancake.

**Rủi ro riêng của Pancake (suy luận):** Pancake POS gần mảng quản lý bán hàng của Hubsell, nên danh sách khách tiềm năng của Hubsell nằm trong hệ của một bên có thể là đối thủ liền kề. Anh cần tự cân nhắc.

### Gaps
- Giá chính thức của Pancake, Smax, Harafunnel, Bizfly Chat, Zendesk, Manychat chưa xác nhận.
- Công xây và giữ tự làm chưa có số; Hubsell chưa có lịch sử cho việc này nên không ước lượng.
- Lượng hội thoại thật chưa có.

---

## 2. Công cụ nào được trả lời bình luận Page và tự động nhắn riêng theo luật Meta?

### Takeaway
Được, và luật khá rõ: mỗi bình luận chỉ 1 tin riêng trong 7 ngày. respond.io, Pancake, Botcake, Fchat có tính năng này theo tài liệu hoặc trang hãng. Chatwoot không có trong bản chính. TikTok thì không cho nhắn riêng từ bình luận.

### Cited Findings
- Trả lời riêng: gửi trong 7 ngày kể từ khi tạo bài hoặc bình luận; chỉ 1 tin; muốn nói tiếp thì người đó phải trả lời trước; cần `pages_messaging`; dùng `POST /PAGE-ID/messages` với `comment_id` hoặc `post_id` — [Meta](https://developers.facebook.com/docs/messenger-platform/discovery/private-replies/).
- Trả lời công khai: `pages_manage_engagement` để tạo, sửa, xóa bình luận, phụ thuộc `pages_read_user_content` và `pages_show_list`. App Review áp cho app truy cập dữ liệu không thuộc mình; Advanced Access cần Business Verification — [Meta](https://developers.facebook.com/docs/permissions/reference/pages_manage_engagement). ⏳ Page của chính mình có đi được bằng Standard Access không phải thử; tệp tuần 1 cũng đang ghi điểm này là chưa chắc.
- Cửa sổ: thường 24 giờ; Human Agent cho người trả lời trong 7 ngày; bot không phản hồi trong 30 giây có thể bị hạn chế gửi. Nơi luật yêu cầu, chat tự động phải báo là tự động lúc đầu, sau khoảng lặng dài và khi chuyển từ người sang máy — [Meta](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview/). Khớp Luật 134/2025 Điều 11 mà [tệp tuần 1](../../../HE-MARKETING-SALE-TUAN-1-2026-10-29.md) đã trích.
- respond.io: tự gửi tin riêng cho người bình luận; người đó chỉ thành liên hệ khi họ trả lời — [help](https://respond.io/help/facebook-messenger/private-replies), [blog](https://respond.io/blog/facebook-comment-auto-reply). Riêng Instagram phải là ứng dụng chính — [help](https://respond.io/help/instagram/instagram-auto-private-replies).
- Pancake: bình luận vào hộp thư, có công cụ trả lời công khai và riêng (bên thứ ba: [AnythingMCP](https://anythingmcp.com/guides/connect-pancake-to-claude)). Botcake: tin tự động gồm trả lời bình luận — [pricing](https://botcake.io/pricing). Fchat: "tự động trả lời bình luận, nhắn tin cho khách bình luận" — [fchat.vn](https://fchat.vn/). BotClarify, Markee: có gom bình luận, ⏳ tự nhắn riêng.
- TikTok: nền tảng không cho DM dựa trên bình luận, chỉ trả lời công khai — [Chatfuel](https://chatfuel.com/docs/tiktok/tiktok-comment-autoreply.md). Manychat có nguồn mâu thuẫn, bản mới nhất nói không có comment-to-DM cho TikTok — [Manychat](https://manychat.com/blog/tiktok-automation-guide/).

### Inferences
- Đường đi hợp lệ: bình luận TikTok → trả lời công khai kéo sang OA, đúng như kế hoạch 25/10. Bình luận Page → 1 tin riêng, khách trả lời thì mở cửa sổ.
- Trả lời riêng tự xây chỉ là 2 endpoint. Phần khó là chống trùng và trần tần suất, không phải API.

### Gaps
- Intercom và Zendesk có bình luận Page không: chưa kiểm được.
- Luật Meta về chống spam bình luận tự động ở mức chi tiết chưa đọc hết. Phần nội dung cuối của trang `pages_manage_engagement` chưa đọc.

---

## 3. Chatwoot làm được hộp thư người trực trong khi tác tử của mình trả lời không?

### Takeaway
Về cơ chế thì khớp đúng: Agent Bot và chuyển trạng thái pending/open. Về kênh thì thiếu đúng chỗ Hubsell cần: không có Zalo OA, không có bình luận Page, TikTok chỉ DM và vẫn phải tự xin duyệt. Dùng nó nghĩa là vừa phải xây cầu cho 2 kênh, vừa phải giữ thêm một hệ Rails.

### Cited Findings
- **Agent Bot:** gửi `widget_triggered`, `message_created`, `message_updated` tới URL của bot; bot trả lời qua API tạo tin. Hội thoại mới ở "pending" để bot xử lý; bot đặt "open" để chuyển người; nhân viên đặt lại "pending" để trả về bot — [Chatwoot](https://www.chatwoot.com/docs/product/others/agent-bots).
- **Kênh:** live chat, email, Facebook, Instagram, Twitter, WhatsApp, Telegram, Line, SMS — [GitHub](https://github.com/chatwoot/chatwoot). Client API dùng `inbox_identifier` của hộp API để dựng trải nghiệm riêng — [API](https://developers.chatwoot.com/api-reference/introduction). Đây là lối cắm Zalo.
- **Zalo:** thảo luận #8457 mở từ 12/11/2021, vẫn chưa đóng — [GitHub](https://www.github.com/orgs/chatwoot/discussions/categories/feature-requests). Không tìm được cầu nối cộng đồng đáng tin; trang [restack](https://store-restack.vercel.app/docs/chatwoot-knowledge-chatwoot-zalo-integration) không rõ nguồn gốc nên không dùng.
- **Bình luận Facebook:** mở từ 2022. Người duy trì viết 01/12/2023 "we won't be prioritizing this soon"; 12/02/2024 nói đang tập trung vào hỗ trợ và tin nhắn trực tiếp, gợi ý dùng công cụ khác — [#8455](https://github.com/orgs/chatwoot/discussions/8455), [#5196](https://github.com/chatwoot/chatwoot/issues/5196). Có commit 4b2c1bd của tác giả PrimeDevs định tuyến trả lời bình luận sang Graph, được người dùng dẫn 03/06/2026 — [commit](https://github.com/chatwoot/chatwoot/commit/4b2c1bd). ⏳ Chưa xác nhận đã vào bản chính; có thể chỉ từ fork.
- **TikTok:** Business Messaging, không nhắc bình luận; cần quyền API được duyệt và tài khoản Business; cửa sổ 48 giờ; chỉ chữ hoặc 1 ảnh; access token ~24 giờ, refresh ~30 ngày, hết thì phải ủy quyền lại — [docs](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/tiktok).
- **Giấy phép:** MIT, trừ thư mục `enterprise/` có giấy phép riêng — [LICENSE](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/LICENSE). ~38,8 nghìn sao — [GitHub](https://github.com/chatwoot/chatwoot). CE không có Captain; SSO/SAML và SLA chỉ ở Enterprise — [self-hosted](https://www.chatwoot.com/pricing/self-hosted-plans/).
- **Hạ tầng:** khuyến nghị tối thiểu 4 nhân, 4 GB RAM cho tới 10.000 hội thoại/ngày, thêm swap ≥ 1 GB; Postgres 5–10 GB; Redis ≥ 7; Sidekiq có thể tốn trên 1 GB, nên tách máy — [docs](https://developers.chatwoot.com/self-hosted/deployment/requirements). Trên Render khoảng $79/tháng theo cách tính ở Bảng 3 — [Render](https://render.com/pricing.md).
- **Nhịp phát hành:** 10 bản từ 16/06 tới 24/10, mới nhất v4.19.1 — [Releases](https://github.com/chatwoot/chatwoot/releases) (trang không ghi năm, suy là 2026).
- Trong các ghi chú phát hành đọc được không thấy nhắc TikTok, bình luận, Zalo — [Releases](https://github.com/chatwoot/chatwoot/releases).

### Inferences
- Gánh duy trì: nâng cấp theo nhịp khoảng mỗi tháng, thêm 4 dịch vụ phải canh, trong khi prod Hubsell đang có việc Render và Disk IO cần theo dõi. Với một người trực thì không đáng.
- App Meta, TikTok khi tự host là của mình, nên không tránh được cổng duyệt như khi mua công cụ có sẵn.
- Khi nào nên quay lại: có 2+ nhân viên trực, cần dữ liệu ở trong nhà, và Hubsell đã có sẵn cầu Zalo/bình luận từ phương án lai để cắm vào hộp API.

### Gaps
- Công xây cầu Zalo và bình luận qua hộp API chưa ước lượng được từ nguồn.
- Agent Bot có giới hạn theo gói Cloud không, app mobile có đủ cho một người trực không: ⏳ chưa đọc.
- Trang danh sách kênh chính thức trả 502 lúc kiểm, nên danh sách kênh lấy từ README.
- Giá VPS 4 GB thay cho Render chưa kiểm.

---

## 4. Rời nhà cung cấp thì mất gì?

### Takeaway
Mất thật là cấu hình luồng, dữ liệu huấn luyện AI, nhãn, và đôi khi cả toàn văn hội thoại. Cách chống rẻ nhất là tự ghi mọi sự kiện vào sổ của mình ngay từ đầu, không trông vào nút xuất của hãng.

### Cited Findings
- **Pancake:** có quyền nhận bản sao máy đọc được, yêu cầu qua email; giữ 2 năm sau khi gói kết thúc; dữ liệu đã xóa không khôi phục — [privacy](https://pancake.vn/privacy). ⏳ Bản sao có toàn văn hội thoại không.
- **BotClarify:** ngắt kênh xóa hội thoại kênh đó; xóa tài liệu xóa cả dữ liệu tìm kiếm — [botclarify.com](https://botclarify.com/).
- **respond.io:** xuất được liên hệ, hội thoại, tin nhắn theo khoảng 1 năm; workflow, cấu hình AI Agent, mẫu broadcast không xuất hàng loạt — [Converge, bên thứ ba và là đối thủ](https://converge-static.pages.dev/migrate/respond-io/data-export).
- **Intercom:** xuất giao diện khoảng 200–300 hội thoại mỗi lần; toàn văn phải qua UI hoặc API; dữ liệu xuất không nhập lại workspace mới được — [help](https://intercom.com/help/en/articles/2046229-export-your-conversation-data), [community](https://community.intercom.com/messages-series-11/can-i-export-conversation-history-from-intercom-1327).
- **Manychat:** không thấy xuất hội thoại chính thức, có người dùng phải đẩy Google Sheets bằng automation — [community](https://community.manychat.com/ideas/export-conversations-5068).
- **Chatwoot Cloud:** giữ 30 ngày / 1 / 2 / 3 năm tùy gói — [pricing](https://www.chatwoot.com/pricing); chính sách không tả công cụ tự xuất — [privacy](https://www.chatwoot.com/privacy-policy). Tự host thì dữ liệu nằm trong Postgres của mình.
- **Subiz (Zalo cá nhân):** chỉ đồng bộ từ lúc nối, không lấy lịch sử cũ — [Subiz](https://subiz.com.vn/en/zalo-personal). Suy ra khi đổi hãng có thể gặp kiểu mất tương tự ⏳.
- **Kênh gốc:** Meta có `GET /{page-id}/conversations` với `pages_messaging` và các quyền kèm — [Meta](https://developers.facebook.com/docs/graph-api/reference/page/conversations/); trang không nói độ sâu lịch sử ⏳.

### Inferences
- Tài sản đáng tiền nhất là cặp "nháp ↔ câu anh gửi ↔ kết cục". Nếu nằm trong AI của hãng thì không mang đi được; nằm trong sổ của mình thì đổi kênh, đổi hãng đều giữ nguyên.
- Khóa thực tế của phương án lai thấp: chỉ mất nhãn, phân công, câu mẫu. Ngược lại mua luôn AI của hãng thì khóa cao nhất: tri thức, luồng và lịch sử cùng nằm một chỗ.
- Sổ này chứa dữ liệu cá nhân, nên vẫn phải theo Luật 91/2025: đồng ý riêng khi dùng làm mẫu huấn luyện, thời hạn giữ, ẩn danh (đã phân tích ở tệp tuần 1).

### Gaps
- Chưa có cam kết nơi lưu rõ ràng từ các hãng Việt Nam: Pancake không nêu quốc gia; còn lại ⏳.
- Nghĩa vụ chuyển dữ liệu ra nước ngoài theo Luật 91/2025 khi dùng Pancake, Chatwoot Cloud (Mỹ) chưa kiểm trong lượt này.
- Độ sâu lịch sử lấy lại được qua API Meta và Zalo khi rời hãng chưa kiểm.

---

## 5. Dù mua hộp thư, phần nào vẫn phải tự xây?

### Takeaway
Tất cả phần làm nên giá trị riêng của Hubsell: tra tài khoản, đọc số thật của nhà bán, kiểm soát quảng cáo, đo nháp, tuân thủ luật. Không công cụ đã xem nào cho thấy làm sẵn được các việc này; AI của họ chủ yếu trả lời từ tài liệu tải lên.

### Cited Findings
- AI của hãng chủ yếu dựa vào tri thức nạp sẵn: BotClarify chỉ trả lời theo tài liệu tải lên — [botclarify.com](https://botclarify.com/); Markee giới hạn số mục dữ liệu AI theo gói — [chat.markee.vn](https://chat.markee.vn/); Fchat có "kho kiến thức" — [fchat.vn/price](https://fchat.vn/price). Botcake bán lối nối OpenAI — [pricing](https://botcake.io/pricing).
- OA không trả SĐT khách, chỉ `user_id` OA, trừ khi khách bấm chia sẻ; `User.phone` của Hubsell là E.164 nullable — [tệp tuần 1](../../../HE-MARKETING-SALE-TUAN-1-2026-10-29.md).
- OA không có API chỉ định quản trị viên, nên báo người kỹ thuật phải đi đường riêng (email, chấm đỏ HQ) — [tệp tuần 1](../../../HE-MARKETING-SALE-TUAN-1-2026-10-29.md).
- Luật 134/2025 Điều 11 yêu cầu người dùng nhận biết đang tương tác với AI; Luật 91/2025 Điều 9 yêu cầu đồng ý riêng cho từng mục đích — [tệp tuần 1](../../../HE-MARKETING-SALE-TUAN-1-2026-10-29.md) (đó là nguồn thứ cấp, ⏳ đối chiếu Công báo).
- Pancake có MCP và API để tác tử đọc, viết hội thoại — [Pancake MCP](https://docs.pancake.biz/pancake/st-f12/st-p3?lang=vi), [webhook.yaml](https://developer.pancake.biz/openapi/webhook.yaml).

### Inferences
Danh sách phải tự xây:
1. **Sổ hội thoại:** chép mọi sự kiện, có khóa chống trùng, nằm ở Supabase của mình.
2. **Bộ não:** Claude, phân loại, nhân vật 4 lớp, tự biết lúc nào nhường người.
3. **Xác minh danh tính:** chứng minh người đang chat là chủ tài khoản trước khi đọc số gian. Đây là điểm an toàn lớn nhất, vì lộ doanh thu gian này cho người khác là sự cố nặng.
4. **Công cụ chỉ đọc qua API Hubsell:** gói, trạng thái nối gian, gợi ý từ số thật; theo từng tài khoản, ghi nhật ký.
5. **Kiểm soát quảng cáo:** để ngoài lát đầu. Chỉ cân nhắc sau khi xác minh danh tính chạy ổn, vẫn giữ chế độ diễn tập và xác nhận tay như trợ lý quảng cáo hiện có của Hubsell.
6. **Đo chạy bóng và cổng lát 1:** nháp so với câu gửi, kết cục theo khách.
7. **Cầu nối HQ/CRM:** trạng thái khách, phiếu hỗ trợ.
8. **Đồng ý và báo AI:** nút Đồng ý/Không, lưu bằng chứng, câu chào có báo là trợ lý.
9. **Bộ chuyển đổi kênh:** để bộ não không phụ thuộc Pancake.

Phần **không** nên tự xây lúc này: giao diện hộp thư nhiều người, app điện thoại, phân công, đầu nối TikTok DM.

### Gaps
- Công làm từng mục chưa ước lượng; cần chia lát khi anh chốt.
- Pancake cho thêm ghi chú nội bộ qua API được không (để hiện nháp ngay trong hộp thư) mới có nguồn bên thứ ba ⏳; nếu không thì duyệt nháp ở HQ.
