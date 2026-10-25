# Phản biện yêu cầu "Hệ Multi-Agent Marketing & Sales" — 25/10/2026

Trạng thái: **bản phản biện, chưa code**. Anh Trung gửi yêu cầu 3 phần (schema Supabase · Marketing Agent cào MXH · Sales Agent Zalo "Nam"), đề nghị em phản biện, bổ sung, nghiên cứu trước khi làm. Tệp này là ý kiến của em; anh chốt xong mới dựng.

Nguồn đã đọc lại: định vị 15/10 (`../../docs/marketing/DINH-VI-LAI-HUBSELL-QUANG-CAO.md`), chẩn đoán 17/10 (`CHAN-DOAN-BAN-DAU-2026-10-17.md`), ca thực tế ANO 25/10 (`../so-lieu/KET-QUA-2026-10-25-TRO-LY-QUANG-CAO.md`), khảo sát bình luận TikTok 12/10 (`../../docs/TIKTOK-BINH-LUAN-VIDEO-KHAO-SAT.md`), luật thư mục này (`../CLAUDE.md`), thư nhắc nối gian 25/10 (62 khách đăng ký chưa nối gian).

---

## 0. Kết luận ngắn

Em **đồng ý làm hệ này, tách thư mục riêng, 2 agent nối tiếp, Claude API, JSON nhiều câu ngắn**. Em **không đồng ý 3 điểm nền** và nếu giữ nguyên thì hệ xây xong không chạy được hợp lệ:

| # | Yêu cầu của anh | Vấn đề | Em đề xuất thay |
|---|---|---|---|
| 1 | Cào bình luận/inbox từ Facebook, TikTok, YouTube của **người khác** | Không có API hợp lệ; cào = vi phạm điều khoản 3 nền tảng, khóa tài khoản, dữ liệu rác | Chỉ "lắng nghe" trên **kênh Hubsell sở hữu** (video TikTok của anh, Page FB, kênh YouTube, inbox) qua webhook chính thức + khách tự đến từ landing |
| 2 | Trích SĐT/Zalo từ bình luận rồi **nhắn chủ động** | Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 (hiệu lực 01/01/2026) + Nghị định chống tin rác 91/2020; Zalo OA **không cho** nhắn người chưa tương tác | Kéo người ta **tự inbox** (trả lời công khai "em gửi số cho anh/chị qua inbox nhé") = có đồng ý; Zalo chỉ qua OA, trong cửa sổ 48 giờ sau khi khách nhắn |
| 3 | Đóng vai người thật "Nam", **tuyệt đối không nói là AI** | Khách Hubsell là dân bán hàng online, nhận ra bot rất nhanh; lộ ra là mất niềm tin — mà Hubsell bán **niềm tin vào số liệu** | "Trợ lý Hubsell", xưng em, nói giọng seller, dùng từ lóng, **không phủ nhận khi bị hỏi**, chuyển anh khi khách muốn chốt |

Ngoài 3 điểm trên, em thấy **đích đặt sai chỗ**: Hubsell hiện không thiếu người vào, mà **rụng ở bước nối gian và trả tiền** (62 khách đăng ký từ tháng 9–10 chưa nối gian; video 69 giây kéo khách đông từ 17/10). Sales Agent nên đứng ở đúng chỗ rụng ấy trước, nơi dữ liệu đã hợp pháp (khách tự đăng ký, có email) và từng hội thoại ra tiền ngay.

---

## 1. Phản biện từng phần

### 1.1 Nguồn lead: "cào MXH" là chân yếu nhất

**Thực tế API (em kiểm 12/10 cho TikTok, biết sẵn cho FB/YouTube):**

| Nền tảng | Đọc được gì hợp lệ | Không đọc được |
|---|---|---|
| Facebook | Bình luận + inbox trên **Page của mình** (Graph API webhook `feed`, `messages`; cần App Review quyền `pages_read_engagement`, `pages_messaging`) | Bình luận trong **nhóm nhà bán** (nơi khách than vãn thật), bài của page khác |
| TikTok | Bình luận video **tài khoản đã ủy quyền** qua Accounts API (`/business/comment/list/`, webhook COMMENT ≤5 phút) — đúng khảo sát 12/10, anh đã chốt "tách app riêng sau" → **chính là dự án này** | Bình luận video người khác |
| YouTube | `commentThreads.list` cho video **công khai bất kỳ** (quota 10.000 đơn vị/ngày), nhưng không có SĐT ai ở đó, và trả lời chỉ trên kênh mình | Inbox |

Nơi khách than "cắn phí, lỗ ảo, thuế 1,5 %" nhiều nhất là **nhóm Facebook kín của nhà bán**. Chỗ đó không có API; cào bằng tài khoản cá nhân + trình duyệt tự động là vi phạm điều khoản Meta, tài khoản anh (đang là mặt tiền video) có thể bị khóa, và dữ liệu kéo về đầy nhiễu (người than không phải người mua).

**Hệ quả thiết kế:** "Social Listening" phải viết lại thành **"Lắng nghe trên kênh sở hữu"**. Dữ liệu không cần cào, nền tảng **đẩy webhook về**. Đầu vào thực tế của Marketing Agent:
1. Bình luận dưới video TikTok của anh (đang là kênh ra khách thật).
2. Bình luận + inbox Page Facebook Hubsell.
3. Bình luận video YouTube Hubsell.
4. Form landing (máy tính ROAS hòa vốn, đăng ký dùng thử) — đã có sự kiện `roas_tool_view / roas_tool_login_click`.
5. Thư trả lời từ 62 thư nhắc nối gian (support@) — đang chảy về từ 25/10.

### 1.2 Pháp lý: trích SĐT công khai rồi nhắn = rủi ro thật, không phải lý thuyết

- **Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15** hiệu lực **01/01/2026**; Nghị định xử phạt 330/2026/NĐ-CP hiệu lực 19/08/2026 (mức phạt theo nguồn em tra: tới 10 lần khoản thu từ vi phạm với mua bán dữ liệu; 5 % doanh thu với chuyển dữ liệu xuyên biên giới). Một người để SĐT dưới bình luận video của **người bán khác** là đồng ý cho người đó, không phải cho Hubsell. Chi tiết điều khoản tiếp thị trực tiếp em **chưa đọc nguyên văn luật** — cần tra 91/2025/QH15 trước khi làm bất kỳ luồng chủ động nào.
- **Nghị định 91/2020/NĐ-CP** (chống tin nhắn rác): tin nhắn quảng cáo cần người nhận đồng ý trước, có cách từ chối.
- Hubsell vừa gắn logo Bộ Công Thương (21/10), đang nộp nhãn hiệu (4-2026-54845), hồ sơ ISV Shopee có cam kết PII, TikTok App Store đang chờ duyệt. Một đơn khiếu nại spam là đủ gây hại cho tất cả những cái đó.

### 1.3 Zalo: không có đường hợp lệ để bot nhắn người lạ

Em tra lại 25/10 (nguồn thứ cấp: tài liệu SDK, trang trợ giúp eSMS/Infobip — **chưa đối chiếu developers.zalo.me**, cần anh hoặc em kiểm lại khi làm):

| Kênh Zalo | Cho phép | Không cho |
|---|---|---|
| **OA — tin tư vấn** | Trả lời **trong 48 giờ** sau khi khách nhắn OA / bấm nút / gọi | Nhắn người chưa tương tác |
| **ZNS** (theo SĐT) | Mẫu duyệt trước, nội dung **giao dịch/chăm sóc** (xác nhận, nhắc hạn) | Nội dung quảng cáo, khuyến mãi, chào mời |
| **Zalo cá nhân + thư viện unofficial** (zca-js…) | — | Vi phạm điều khoản, tài liệu chính các thư viện ấy ghi "có thể bị khóa tài khoản" |

→ "Zalo Closer" **chủ động** không thể làm hợp lệ. "Zalo Closer" **trả lời** thì làm được và đáng làm: khách nhắn OA (từ nút trên landing, từ QR cuối video, từ reply bình luận "inbox em") → agent trả lời trong 48 giờ. ZNS dùng được cho **khách đã đăng ký và cho SĐT**: "tài khoản đã tạo, chưa nối gian" — đúng mẫu chăm sóc, không phải quảng cáo.

### 1.4 Persona "Nam" giả người thật

Em phản đối vì ba lý do, theo thứ tự nặng dần:
1. **Khách phát hiện chắc chắn.** Dân bán hàng online chat với bot sàn mỗi ngày; hỏi một câu lệch kịch bản ("shop anh 3 gian Shopee, 1 TikTok, phí hoàn 2 %, em tính thử") là lộ. Lộ rồi, mọi con số agent nói trước đó mất giá.
2. **Mâu thuẫn với lời hứa thương hiệu.** Luật nội dung của thư mục này: *không bịa số, lời khách, chứng thực*. Bịa người còn nặng hơn bịa số.
3. **Pháp lý về minh bạch AI.** Em nhớ Việt Nam đã thông qua luật về trí tuệ nhân tạo cuối 2025 có yêu cầu cho người dùng biết họ đang tương tác với AI, nhưng **em không chắc điều khoản và hiệu lực** — cần kiểm trước khi chốt persona.

**Đề xuất thay:** tên "Trợ lý Hubsell" (hoặc một tên riêng kiểu "Hubbie" nếu anh muốn thân), xưng *em*, giọng seller thật, dùng đúng từ lóng (đơn ảo, cắn phí, đối soát escrow, hòa vốn ROAS), **không tự giới thiệu là AI mỗi câu nhưng không phủ nhận khi bị hỏi**, và có luật chuyển người: khách hỏi giá sâu / muốn gọi / nổi nóng → "em nối anh Trung, 15 phút nữa anh ấy nhắn lại". Thực tế khách còn thích hơn: trả lời 24/7 tức thì, và biết có người thật đứng sau.

### 1.5 Đích đặt sai chỗ: thiếu người mua, không thiếu người vào

Số đang có (không bịa):
- Video 69 giây "Trợ lý TikTok Ads" kéo khách vào đông từ 17/10 (anh xác nhận 24/10; chưa có số Analytics).
- 62 chủ shop đăng ký tháng 9–10 **chưa nối gian** (thư nhắc 25/10 đã gửi, 0 lỗi).
- Khách đăng ký bằng email, không có SĐT → không gọi được (anh nêu 09/10).

Nghĩa là **phễu đang rụng ở bước nối gian → dùng thử → trả tiền**, không rụng ở bước biết đến. Marketing Agent cào thêm 500 lead lạ chỉ làm đầy đầu phễu đang đã đầy. Sales Agent đặt **sau đăng ký** thì mỗi hội thoại là một khách đã có ý, dữ liệu hợp pháp (họ tự đưa), và đo được ngay (nối gian trong 24 giờ hay không).

### 1.6 Định vị lệch trong đề bài

Anh viết "Phần mềm bóc tách Lãi/Lỗ ròng TMĐT đa sàn". Từ 15/10 anh đã chốt **Hubsell = Trợ lý quảng cáo đa sàn**, lãi lỗ là nền. Video ra khách cũng là video Trợ lý TikTok Ads. Kịch bản bán của agent phải bám định vị này (nỗi đau: đốt tiền GMV Max, ROI sàn gợi ý không trừ giá vốn) chứ không quay về "bóc tách phí". Nếu anh cố ý đổi lại định vị cho kênh Sales, nói rõ để em ghi; không thì em coi đề bài viết nhanh.

### 1.7 Kỹ thuật nhỏ hơn

| Điểm | Ý anh | Phản biện |
|---|---|---|
| Phân loại ý định bằng **từ khóa** ("cắn phí, lỗ ảo, thuế 1,5 %") | Đúng nỗi đau (1,5 % = 1 % VAT + 0,5 % TNCN sàn khấu trừ hộ kinh doanh từ 01/07/2025) | Từ khóa cứng sẽ bắt sót ("tháng này âm mà không hiểu sao") và bắt nhầm (người đang **bán** khóa học về phí). Để Claude phân loại theo **nhãn + mức tin cậy + lý do**, từ khóa chỉ là ví dụ few-shot; dưới ngưỡng tin cậy thì đưa anh duyệt |
| JSON `{"messages": [...]}` | Đồng ý hoàn toàn — Zalo/Messenger đọc 3 tin ngắn tốt hơn 1 đoạn | Thêm `intent`, `handoff` (bool + lý do), `facts_used` (câu nào lấy từ tài liệu nào) để kiểm được; ép schema bằng **tool_use / structured output**, không dựa vào "hãy trả JSON" trong prompt |
| `knowledge_base` pgvector | Hợp lý về lâu dài | Tài liệu thuế/phí/giá vốn của Hubsell hiện **vài chục trang** (`docs/` sẵn: định nghĩa tài chính, tờ khai theo ngày giao, bảng phí sàn). Dưới ~100 tài liệu, nhét thẳng vào prompt + prompt caching **rẻ hơn và đúng hơn** vector search. pgvector để sau khi kho tài liệu lớn. Riêng tư vấn thuế: agent **chỉ trích tài liệu có nguồn** + câu "anh/chị đối chiếu kế toán", không tự suy luận |
| Render Worker riêng | Thêm ~7 USD/tháng, một tiến trình nữa phải nuôi | Lượng tin ban đầu nhỏ (vài chục/ngày). Webhook nhận ở Next.js route → ghi hàng đợi Supabase → xử lý bằng Supabase Edge Function hoặc cron; chỉ lên Render Worker khi có việc chạy quá 60 giây hoặc >1.000 tin/ngày. Nhưng nếu anh muốn giữ thói quen Render cho dễ xem log, em không phản đối mạnh |
| Bảng mới trong Supabase | Cùng project prod? | **Không đụng project Supabase prod**: 80/80 bảng đang bật RLS, Prisma schema chính không nên nhiễm bảng marketing. Tạo **project Supabase riêng** (gói Free đủ) cho hệ này; cần biết "lead đã thành khách trả tiền chưa" thì gọi **một API nội bộ HQ** (đọc theo email), không join DB |

---

## 2. Thiết kế em đề xuất (để anh chốt, chưa làm)

```
                 Kênh sở hữu                            Hệ Marketing-Sale (thư mục riêng, Supabase riêng)
┌──────────────────────────────┐    webhook    ┌───────────────┐   ┌──────────────────┐   ┌───────────────────┐
│ TikTok (Accounts API)        │ ───────────▶  │ inbound_events│──▶│ MARKETING AGENT  │──▶│ leads             │
│ Facebook Page (Graph API)    │               │ (thô, idempot)│   │ phân loại ý định │   │ + gợi ý reply công │
│ YouTube (Data API)           │               └───────────────┘   │ Haiku, nhãn+tin  │   │   khai "inbox em" │
│ Landing (form, ROAS tool)    │                                   └──────────────────┘   └─────────┬─────────┘
│ Zalo OA (khách nhắn trước)   │                                                                    │ khách tự inbox
└──────────────────────────────┘                                                                    ▼
                                             ┌──────────────────┐   ┌────────────────┐   ┌───────────────────┐
     HQ /admin/marketing  ◀──────────────────│ conversations +  │◀──│ SALES AGENT    │◀──│ Hộp thư hợp nhất  │
     (hộp thư, nháp AI, nút Gửi, Chuyển anh) │ messages         │   │ Sonnet, JSON   │   │ Messenger · OA ·  │
                                             └──────────────────┘   │ messages[]     │   │ Telegram · email  │
                                                                    └────────────────┘   └───────────────────┘
```

**Lát 0 — Nháp, anh bấm gửi (2 tuần đầu).** Mọi tin agent soạn hiện trong HQ, anh đọc và bấm Gửi/Sửa/Bỏ. Đúng luật `CLAUDE.md` thư mục này ("gửi thư cho khách: anh duyệt mới làm"), và là bộ dữ liệu huấn luyện giọng tốt nhất: 50–100 hội thoại anh sửa = system prompt bản 2 viết từ sửa thật, không từ tưởng tượng.

**Lát 1 — Tự gửi theo ý định an toàn.** Hỏi giá, hỏi nối gian, hỏi "có hỗ trợ sàn X không" → tự trả lời; mọi thứ khác vẫn nháp. Chuyển anh khi: khách hỏi thuế cụ thể cho ca của họ, đòi giảm giá, chửi, hoặc độ tin cậy phân loại thấp.

**Lát 2 — Chăm khách đã đăng ký.** Nối với bảng người dùng qua API HQ: đăng ký 24 giờ chưa nối gian → ZNS (nếu có SĐT) / email (đã có); nối gian rồi im 3 ngày → tin "em xem gian anh thấy ROAS hòa vốn X, anh có muốn bật diễn tập không". Đây là chỗ sinh tiền nhanh nhất.

**Lát 3 — Lắng nghe mở rộng.** Chỉ khi 3 lát trên chạy ổn: thêm kênh (YouTube, nhóm Zalo công khai của Hubsell), và cân nhắc xin quyền Accounts API TikTok cho **4 tài khoản tiếp thị** anh nêu 12/10.

**Mô hình:** phân loại ý định dùng Haiku 5.5 (rẻ, nhanh); hội thoại bán dùng Sonnet 5.5; prompt caching cho khối tài liệu. Mọi câu agent nói về số (phí sàn, thuế) phải truy ra tài liệu nguồn; không có nguồn thì trả "em hỏi lại anh Trung".

**Đo:** mỗi lead có `source`, `first_intent`, `handoff_reason`; mỗi hội thoại có kết cục (nối gian / trả tiền / im / từ chối). Sau 30 ngày: tỷ lệ inbox → đăng ký, đăng ký → nối gian, so với nhóm không được chăm (62 khách tháng 9–10 là đối chứng tự nhiên).

---

## 3. Ba điều cần anh chốt trước khi em dựng

1. **Nguồn lead:** kênh sở hữu + khách tự đến (webhook), **bỏ cào** bình luận người khác và bỏ trích SĐT từ chỗ công khai. Đồng ý?
2. **Zalo:** chỉ OA trả lời trong 48 giờ + ZNS chăm khách đã đăng ký; **không** dùng Zalo cá nhân tự động. Đồng ý?
3. **Persona:** "Trợ lý Hubsell" không phủ nhận là AI, có nút chuyển anh; **không** đóng vai "Nam". Đồng ý?

Nếu anh chốt ngược bất kỳ điều nào, em sẽ làm theo và ghi lại lý lẽ hai bên ở đây; riêng điều 1 và 2 em xin giữ bảo lưu bằng chữ vì rủi ro là của công ty anh, không phải của mã.

Việc em làm được ngay sau khi anh chốt: (a) đọc nguyên văn Luật 91/2025/QH15 phần tiếp thị trực tiếp + điều khoản minh bạch AI; (b) kiểm developers.zalo.me luật 48 giờ và danh mục ZNS hiện hành; (c) dựng khung thư mục `hubsell-sales/` (hoặc tên anh chọn) + schema lát 0.

Nguồn đã tra 25/10 (thứ cấp, cần đối chiếu gốc): [eSMS — Zalo OA FAQ](https://helpcenter.esms.vn/cau-hoi-thuong-gap/zalo-oa) · [Infobip — Zalo](https://infobip.com/docs/zalo) · [Luật 91/2025/QH15 hiệu lực](https://luatvietnam.vn/dan-su/luat-bao-ve-du-lieu-ca-nhan-2025-co-hieu-luc-khi-nao-568-103652-article.html) · [Nghị định hướng dẫn 91/2025](https://luatvietnam.vn/dan-su/nghi-dinh-huong-dan-luat-bao-ve-du-lieu-ca-nhan-2025-la-nghi-dinh-nao-568-103658-article.html) · [Mức phạt mua bán dữ liệu](https://lsvn.vn/mua-ban-du-lieu-ca-nhan-trai-phep-co-the-bi-phat-toi-10-lan-doanh-thu-a160473.html) · [Cảnh báo khóa tài khoản khi dùng Zalo cá nhân tự động](https://docs.openclaw.ai/it/channels/zalouser.md).

---

## 4. Bổ sung sau khi anh nêu vấn đề thật (25/10 tối)

Anh nói lại 3 việc đang kẹt: (1) marketing chỉ quay được video TikTok, không có thời gian đăng bài nhóm; (2) khách bình luận / nhắn TikTok → anh tự trả lời, tự xin Zalo, tự add Zalo, không làm mãi được; (3) chat bán qua Zalo khá cơ bản, phần kỹ thuật anh tự làm, phần nói chuyện muốn AI làm thay.

→ Mục 1–2 ở trên vẫn đúng về luật, nhưng **đích đổi**: hệ này không phải để tìm lead mới, mà để **gỡ anh ra khỏi hai nút cổ chai**. Xếp theo mức gỡ được:

### 4.1 Nút cổ chai nặng nhất: trả lời TikTok → xin Zalo → add Zalo (việc 2)

Vấn đề gốc là anh đang kéo khách về **Zalo cá nhân**, kênh không có API hợp lệ, nên mọi bước phải tay. Đảo chiều: kéo khách về **kênh có API** mà vẫn là Zalo.

| Bước hiện tại (tay) | Bước đề xuất (máy) | Đường hợp lệ |
|---|---|---|
| Anh đọc bình luận video | Webhook COMMENT đẩy về ≤5 phút, AI phân loại hỏi giá / hỏi cách dùng / rác | TikTok Accounts API (khảo sát 12/10) — cần nộp form Accounts API Access + scope Business Comment; anh đã chốt "tách app riêng" → đây là app đó |
| Anh gõ trả lời | AI soạn, lát 0 anh duyệt, lát 1 tự trả lời các ý định an toàn; câu trả lời luôn kèm "anh/chị nhắn Zalo OA Hubsell (link ở bio) em gửi hướng dẫn" | `/business/comment/reply/create/` |
| Anh xin số Zalo, add bạn | **Bỏ hẳn bước này.** Khách tự bấm link/QR → nhắn OA → cửa sổ 48 giờ mở; khách nhắn lại là mở lại | Zalo OA (OA xác thực doanh nghiệp bằng pháp nhân CÔNG TY TNHH CÔNG NGHỆ HUBSELL, MST 0111626360) |
| Anh chat bán | Sales Agent trả lời trong OA, chuyển anh khi dính kỹ thuật (nối gian lỗi, số ROAS của gian họ) | OA webhook + API tin tư vấn |
| Inbox TikTok (tin nhắn riêng) | **Chưa thấy API hợp lệ cho DM tài khoản TikTok thường** — em cần kiểm. Nếu không có: AI soạn sẵn 1 câu mẫu, anh dán, mục tiêu đưa khách sang OA | ⏳ kiểm |

Rủi ro thật của đảo chiều: khách TikTok quen inbox TikTok, bắt họ sang OA là thêm một bước → rụng một phần. Giảm bằng: link OA ngay bio + ghim bình luận đầu mỗi video + câu trả lời bình luận có lợi ích cụ thể ("em gửi bảng ROAS hòa vốn cho gian anh"). Đo tỷ lệ bình luận → nhắn OA sau 2 tuần; dưới 20 % (ngưỡng tự chọn) thì xem lại.

### 4.2 Việc 3: chat bán cơ bản → AI làm, kỹ thuật anh làm

Đúng như em đề xuất mục 2, nhưng vì anh xác nhận chat **cơ bản**, lát 0 (nháp anh duyệt) rút còn **1 tuần hoặc 30 hội thoại**, đủ để lấy giọng thật của anh làm mẫu. Luật chuyển anh: nối gian lỗi, hỏi số của gian họ, hỏi thuế cho ca riêng, đòi giảm giá, nổi nóng. Persona vẫn "Trợ lý Hubsell" không giả người (mục 1.4), anh chưa phản hồi điểm này — em coi là chưa chốt.

### 4.3 Việc 1: marketing — chỗ máy gỡ được ít nhất, nói thật

- **Đăng bài vào nhóm Facebook nhà bán: không có cách tự động hợp lệ.** Nhóm không có API đăng bài cho bên thứ ba; tool tự đăng = khóa tài khoản anh. Máy chỉ làm được tới "soạn sẵn bài từ video anh vừa quay (bóc lời → bài số liệu thật), anh dán 2 phút/ngày" hoặc giao cộng tác viên/đối tác người dạy bán hàng đăng (anh đã chốt 17/10 đối tác ăn referral 10 %).
- **Cái máy làm được thật:** từ **một video anh quay** → tự đăng lên Page Facebook Hubsell (Graph API `pages_manage_posts`, hợp lệ), YouTube Shorts (Data API upload, hợp lệ), bài chữ cho Page + Zalo OA broadcast; đồng thời **đọc bình luận video** để đề xuất chủ đề video tuần sau (mỏ chủ đề thật, không bịa). Anh vẫn chỉ quay video; phủ kênh và chọn đề tài là máy.
- Kịch bản video: chỉ viết Ý theo luật 24/10, anh tự nói.

### 4.4 Thứ tự làm (đề xuất)

1. **Tuần 1:** nộp hồ sơ TikTok Accounts API (em soạn, anh nộp — bản nháp 12/10 đã có); tạo + xác thực Zalo OA; kiểm 4 giả thuyết: TikTok có DM API không, phí/hạn mức tin tư vấn OA 48 giờ, webhook OA, quyền Page Facebook. Chưa code (luật 12/10: không phơi tính năng chưa chạy; luật "giả thuyết + kiểm trước khi code").
2. **Tuần 2–3:** Sales Agent trên Zalo OA, lát 0 nháp anh duyệt trong HQ; link OA lên bio + ghim bình luận.
3. **Khi TikTok duyệt scope:** nối bình luận video → phân loại → trả lời kéo về OA.
4. **Sau:** phủ kênh từ 1 video (Page FB, YouTube), đề xuất chủ đề từ bình luận.

Việc đăng bài nhóm vẫn là của người: anh dán 2 phút/ngày từ bài máy soạn, hoặc đối tác.

### 4.5 Luồng thật anh mô tả (25/10 tối) và cách ánh xạ sang OA

Anh: trên TikTok anh nhắn tin cho khách, để số Zalo cuối tin cho khách add; hoặc xin số khách rồi anh add. Một số khách dùng luôn qua TikTok không cần Zalo; **đa số thích hỗ trợ qua Zalo, TikTok chỉ là nơi tiếp nhận**.

→ Khách không đòi "Zalo của anh Trung", khách đòi "Zalo". Giữ Zalo, đổi đầu nhận:

| Luồng anh đang làm tay | Luồng OA | Khách thấy gì khác |
|---|---|---|
| A. Anh nhắn TikTok, để số Zalo, khách add bạn, anh chấp nhận | Anh dán **một tin mẫu cố định** có link/QR OA (TikTok DM chưa có API, bước này vẫn tay nhưng chỉ còn copy-dán) → khách bấm → chat ngay | **Ít bước hơn**: không gửi lời mời kết bạn, không chờ chấp nhận |
| B. Khách cho số, anh add | OA không add được ai. Hai cách: (1) đổi câu xin số thành "anh/chị bấm link này nhắn em" (đa số); (2) với người chỉ để số: ZNS mẫu chăm sóc "Hubsell đã nhận yêu cầu hỗ trợ, bấm để chat" có nút mở OA — **⏳ cần kiểm Zalo có duyệt mẫu dạng này** | Thêm 1 chạm với nhóm (2) |
| C. Khách dùng luôn qua TikTok | Không cần làm gì; trong app đã có Yêu cầu hỗ trợ (LIVE 27/09) | Không đổi |

Hai điều phải giữ để không mất cái đang ăn khách:
- **Vẫn một người thật ở cuối sợi dây.** OA cho nhiều quản trị viên trả lời trong **cùng một hội thoại**: AI trả lời phần cơ bản, dính kỹ thuật thì chuyển, anh mở app OA Admin trả lời tiếp ngay trong luồng đó, khách không phải đổi chỗ. Đây là lý do chọn OA chứ không phải chatbot web riêng.
- **OA phải mang mặt anh**: tên kiểu "Hubsell · anh Trung", ảnh anh, lời chào nhắc "anh Trung đọc hết, phần kỹ thuật anh trả lời trực tiếp". Khách đến từ video anh nói, họ muốn thấy đúng người đó.

Rào thật của OA so với Zalo cá nhân: ngoài 48 giờ sau tin cuối của khách, OA **không nhắn lại được** (trừ ZNS mẫu); Zalo cá nhân anh nhắn lúc nào cũng được. Vậy với khách im lặng quá 48 giờ mà đang dùng thử, đường nhắc là ZNS chăm sóc hoặc email (đã có worker nhắc hạn gói / nối gian), không phải tin tự do.
