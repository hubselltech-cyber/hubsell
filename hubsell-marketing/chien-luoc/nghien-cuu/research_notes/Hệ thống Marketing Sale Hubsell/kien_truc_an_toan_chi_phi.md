# Kiến trúc, an toàn và chi phí cho agent AI bán hàng và hỗ trợ khách (có thể giữ quyền chi quảng cáo) — trạng thái 03/11/2026

Quy ước: (tự chọn) = con số do người nghiên cứu tự chọn, không có nguồn. ⏳ = điểm chưa kiểm được. Phần "Cited Findings" chỉ ghi điều có nguồn; phần "Inferences" là suy luận của người nghiên cứu.

## 1. Tách quyền: vì sao agent gặp khách không được giữ công cụ quảng cáo hay đăng bài; cách chia agent, chứng thực, cổng duyệt

### Takeaway
Tiêm lệnh chưa có cách chặn tuyệt đối, kể cả với Anthropic và OWASP, nên phải thiết kế theo giả định "agent đọc tin khách sẽ có lúc bị thao túng": tin khách vào thì đầu ra chỉ là một bản nháp có cấu trúc, còn mọi hành động có hệ quả do mã xác định bên ngoài mô hình thực hiện, với chứng thực mà mô hình không bao giờ cầm.

### Cited Findings
**Mức độ của mối đe dọa**
- OWASP LLM01:2025 nói chưa biết cách ngăn tuyệt đối tiêm lệnh, các biện pháp chỉ giảm tác động; 7 nhóm biện pháp: ràng buộc hành vi, kiểm định dạng đầu ra bằng mã, lọc vào/ra, đặc quyền tối thiểu (hàm đặc quyền chạy trong mã, không qua mô hình), người duyệt việc rủi ro cao, tách và gắn nhãn nội dung không tin cậy, kiểm thử đối kháng — [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- Ví dụ đầu tiên của OWASP LLM01 chính là chatbot hỗ trợ bị ra lệnh bỏ quy tắc, truy dữ liệu riêng và gửi thư — [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- Anthropic (24/11/2025) công bố tỉ lệ tấn công thành công trên tác vụ trình duyệt, với kẻ tấn công thích ứng 100 lần thử mỗi môi trường: Opus 4.5 là 8,0% (chỉ mô hình) và 1,4% (có lớp bảo vệ cải tiến); Haiku 4.5 là 12,0% và 2,4%; đồng thời nói không agent trình duyệt nào miễn nhiễm và 1% vẫn là rủi ro đáng kể — [Anthropic](https://www.anthropic.com/research/prompt-injection-defenses)
- ⏳ Con số mới hơn (Opus 5 đạt 0% trên 129 kịch bản) chỉ thấy qua nguồn thứ cấp, chưa đối chiếu được với system card — [The Decoder](https://the-decoder.com/opus-5-may-have-solved-browser-based-prompt-injection-the-biggest-security-flaw-haunting-ai-agents/)
- Bộ phân loại không đủ làm cổng duy nhất: chính Anthropic đo bộ phân loại của auto mode có tỉ lệ bỏ lọt 17% trên hành động quá đà thật (n=52) và 5,7% trên rò rỉ dữ liệu tổng hợp (n=1.000) — [Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-auto-mode). Simon Willison cũng hoài nghi sản phẩm tuyên bố phát hiện 95%, vì 95% là không đủ trong an ninh ứng dụng web — [Simon Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)

**Nguyên tắc tách quyền**
- "Bộ ba chết người": dữ liệu riêng + nội dung không tin cậy + kênh liên lạc ra ngoài; lời khuyên là tránh hẳn tổ hợp này — [Simon Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- Meta "Agents Rule of Two" (31/10/2025): trong một phiên, agent chỉ nên có tối đa 2 trong 3 thuộc tính [A] xử lý đầu vào không tin cậy, [B] truy cập hệ thống/dữ liệu nhạy cảm, [C] đổi trạng thái hoặc liên lạc ra ngoài; cần cả 3 thì không được tự trị, tối thiểu phải có người duyệt, và Meta lưu ý người dùng có thể xác nhận mù — [Meta AI](https://ai.meta.com/blog/practical-ai-agent-security/)
- OWASP LLM06:2025 tách Excessive Agency thành 3 gốc: thừa chức năng, thừa quyền, thừa tự trị. Biện pháp: công cụ hẹp thay vì công cụ mở, OAuth scope tối thiểu, người duyệt việc tác động cao, và thực thi phân quyền ở hệ thống hạ nguồn (complete mediation) chứ không để mô hình tự quyết hành động có được phép không. Log và rate limit không ngăn được, chỉ giảm thiệt hại — [OWASP LLM06](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- Paper "Design Patterns for Securing LLM Agents": nguyên tắc là khi agent đã nuốt đầu vào không tin cậy thì phải bị ràng buộc sao cho đầu vào đó không thể kích hoạt hành động có hệ quả. 6 mẫu: Action-Selector, Plan-Then-Execute, LLM Map-Reduce, Dual LLM, Code-Then-Execute, Context-Minimization — [arXiv 2506.08837](https://arxiv.org/html/2506.08837)
- Ca chatbot hỗ trợ trong paper đó: rủi ro chính là rò dữ liệu qua link/ảnh markdown và tổn hại danh tiếng vì lạc đề; nêu 3 thiết kế (classifier chủ đề — có thể bị tiêm; action-selector theo allowlist; context-minimization — bỏ prompt khách khỏi bước định dạng); và yêu cầu xác thực người dùng cho hành động trên tài khoản — [arXiv 2506.08837](https://arxiv.org/html/2506.08837)

**Hướng dẫn của Anthropic cho nhà phát triển**
- Sàng bằng mô hình nhẹ (Haiku 5.5) với structured output trước khi vào hội thoại chính; coi `stop_reason: "refusal"` của bộ sàng như kết quả có hại; siết hoặc cấm người vi phạm lặp lại — [Anthropic Docs](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)
- Với nội dung bên thứ ba: chỉ đưa vào `tool_result`, nêu rõ nguồn gốc, tuyên bố chính sách trong system prompt, bọc JSON để không thể "thoát dấu nháy", không đặt lệnh của mình trong tool result, đặc quyền tối thiểu, sàng đầu ra công cụ, tự red-team trước khi triển khai — [Anthropic Docs](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)
- Tách mô hình trả lời và mô hình sàng thành hai lần gọi cho kết quả tốt hơn gộp một — [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

**Bằng chứng từ các ca tiêm lệnh thực tế/PoC**
- Supabase MCP (PoC của General Analysis): agent có quyền service-role bỏ qua RLS, đọc tin hỗ trợ, ticket độc ra lệnh đọc bảng token rồi ghi ngược vào ticket để kẻ tấn công đọc — [Simon Willison](https://feeds.simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/)
- ForcedLeak (CVSS 9.4, Noma Security, công bố 25/09/2025): lệnh giấu trong ô Description của form Web-to-Lead, nhân viên hỏi AI về lead, agent truy CRM và rò dữ liệu qua yêu cầu ảnh; allowlist CSP còn chứa một tên miền đã hết hạn mua lại được với giá 5 USD; Salesforce vá bằng allowlist URL đầu ra — [The Hacker News](https://thehackernews.com/2025/09/salesforce-patches-critical-forcedleak.html), [Security Affairs](https://securityaffairs.com/182676/hacking/forcedleak-flaw-in-salesforce-agentforce-exposes-crm-data-via-prompt-injection.html)

### Inferences
**Vì sao agent gặp khách không giữ công cụ quảng cáo/đăng bài:** agent này luôn có [A], nên theo Rule of Two chỉ được thêm một trong [B]/[C] khi tự chạy. Công cụ quảng cáo vừa là [B] vừa là [C] và tác động bằng tiền, không thu hồi được. Một lần tiêm thành công (xác suất không bằng 0 theo mọi nguồn trên) sẽ thành thiệt hại tiền thật. Khi tách hẳn, cùng lần tiêm đó chỉ sinh ra một bản nháp xấu mà cổng gửi còn chặn được.

**Phân chia đề xuất (tên tự đặt):**

| Thành phần | Đầu vào | Được đọc | Đầu ra | Chứng thực giữ |
|---|---|---|---|---|
| Sàng/định tuyến (Haiku, không công cụ) | Tin khách bọc JSON | Không gì | JSON enum: intent, cờ nghi tiêm, rủi ro | Chỉ khóa Anthropic |
| Agent trả lời (không công cụ ghi) | Tin khách + dữ kiện máy chủ đã lấy sẵn | KB công khai; dữ liệu của đúng người gửi do máy chủ tra theo sender id, không phải do mô hình chọn id | JSON bản nháp, `fact_id`, chỉ `handoff` | Chỉ khóa Anthropic |
| Cổng gửi (mã thuần) | Bản nháp đã qua luật | Bảng chính sách | Gọi Send API | Token gửi tin của trang; không có quyền ads |
| Agent nội dung | Brief do chủ viết, số liệu đã tổng hợp; không có tin khách thô | KB, lịch đăng | Bản nháp bài | Không có token đăng; dịch vụ Publisher cầm token |
| Agent quảng cáo | Chỉ số dạng số từ API; không nhận tin khách, không nhận bình luận thô | Báo cáo chỉ đọc | Đề xuất JSON: `action` enum, `campaign_id`, `delta` | Quyền `ads_read`; dịch vụ Thực thi riêng cầm `ads_management` |
| Động cơ chính sách + duyệt (mã thuần) | Đề xuất | Trần ngân sách, danh sách trắng | Duyệt, từ chối, xếp hàng chờ chủ | Không dùng LLM để ra quyết định |

**Luồng dữ liệu giữa các agent** phải là dữ liệu có cấu trúc đã khử nhiễm (kiểu Map-Reduce/Dual LLM), ví dụ "tuần này có 14 câu hỏi về enum `gia_goi`", không chuyển văn bản khách tự do. Nếu Agent nội dung đọc tin khách thô thì đường tiêm sẽ chui từ tin nhắn lên bài đăng công khai.

**Cổng duyệt phải ở ngoài mô hình, cụ thể là:**
- Khóa API nền tảng nằm trong dịch vụ thực thi, không có trong môi trường chạy của agent; agent không gọi được dù "muốn".
- Bản ghi duyệt gắn với hash của đúng nội dung/tham số; đổi một ký tự thì mất hiệu lực (chống sửa sau khi duyệt). Quá hạn = từ chối, không bao giờ mặc định là đồng ý.
- Màn hình duyệt hiển thị tham số thật do mã render (ngân sách cũ → mới), không dùng tóm tắt do mô hình viết, vì mô hình có thể đã bị thao túng để mô tả sai.
- Bộ lọc đầu ra bằng mã: allowlist tên miền cho mọi URL, chặn markdown ảnh, chặn số điện thoại/STK không có trong bảng dữ kiện. Bài học ForcedLeak: rà cả tên miền hết hạn trong allowlist.
- Workspace Anthropic riêng cho từng agent, mỗi cái một khóa và một trần chi (xem mục 6). Lưu ý cache tách theo workspace nên không dùng chung tiền tố giữa chúng.
- Hubsell dùng Supabase: bot không được cầm service-role; dùng role giới hạn/view có RLS. Theo ghi nhớ dự án có RLS 80/80 bảng nhưng service-role sẽ bỏ qua RLS (⏳ chưa kiểm lại trong lượt này).

**Đặt tin khách đúng chỗ:** tin khách nên coi là nội dung bên thứ ba (Hubsell là "user", khách là nguồn ngoài), đưa dạng JSON trong `tool_result`. Đây là suy luận từ tài liệu viết cho ca email đến; ⏳ cần red-team bằng tiếng Việt để xác nhận hiệu quả vì tài liệu không có ca này.

### Gaps
- ⏳ Không tìm thấy số đo tỉ lệ tiêm thành công trên Claude 5.5 cho chat văn bản, và không có số nào cho tiếng Việt. Số công bố đều là tác vụ trình duyệt/model cũ.
- ⏳ Chưa đọc tài liệu chính thức của Meta về phân quyền task của system user và của TikTok Business API.

## 2. Sự thật hiện hành về Claude API và ước tính chi phí 100, 1.000, 10.000 tin/ngày

### Takeaway
Ở thiết kế chuẩn (Haiku sàng + Sonnet 5.5 trả lời, KB 30k token cache 1 giờ) chi phí khoảng 0,011 USD/tin: ~37 USD/tháng ở 100 tin/ngày, ~338 USD ở 1.000, ~3.350 USD ở 10.000. Rào thật không phải tiền token mà là thời gian duyệt của chủ, và trần chi theo bậc tài khoản: chạm trần là API dừng tới đầu tháng sau.

### Cited Findings
**Mô hình và giá (USD/MTok), kiểm trực tiếp trang giá ngày 03/11/2026**

| Mô hình | ID | Vào | Ghi cache 5p | Ghi cache 1h | Đọc cache | Ra | Phát hành |
|---|---|---|---|---|---|---|---|
| Haiku 5.5 (prompt ≤100k token) | `claude-haiku-5-5` | 0,10 | 0,125 | 0,20 | 0,01 | 0,50 | 07/10/2026 |
| Haiku 5.5 (prompt >100k token) | | 0,50 | 0,625 | 1,00 | 0,05 | 2,50 | |
| Sonnet 5.5 | `claude-sonnet-5-5` | 2 | 2,50 | 4 | 0,10 | 10 | 28/09/2026 |
| Opus 5.5 | `claude-opus-5-5` | 4 | 5 | 8 | 0,20 | 20 | ⏳ không đọc ngày |

Nguồn: [Pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview)

- Prompt Haiku 5.5 trên 100.000 token trả giá cao hơn gấp 5 cho cả request, kể cả phần cache hit; Sonnet/Opus giữ giá chuẩn trên toàn cửa sổ 1M — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Batch API giảm 50% cả vào lẫn ra và cộng dồn được với cache; suy luận chỉ chạy tại Mỹ (`inference_geo: "us"`) nhân giá 1,1 lần — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Dùng công cụ: tính theo token thường, cộng 286 token system prompt ẩn với `tool_choice` auto/none trên Sonnet 5.5 và Haiku 5.5; web search 10 USD/1.000 lượt — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Tokenizer hiện tại: 1M token ≈ 2,5M ký tự Unicode ≈ 555k từ; cùng văn bản nhiều hơn khoảng 30% token so với Haiku 4.5 — [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview)

**Thay đổi ảnh hưởng thiết kế**
- Sonnet 5.5: `tool_choice` `any`/`tool` trả lỗi 400. Thay bằng `auto` + `strict: true`, hoặc structured outputs. Muốn mô hình gọi công cụ thì viết rõ trong prompt — [What's new Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5)
- Thinking tính tiền như token ra, kể cả khi không trả text về — [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)
- Haiku 5.5 chấp nhận `thinking: disabled` (effort `high` trở xuống); Sonnet 5.5 không, mức thấp nhất là `between_tools` (không dùng công cụ thì phản hồi chỉ có text); Opus 5.5 thinking luôn bật — [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)
- Sonnet 5.5 mặc định effort `high`, nhưng Anthropic khuyên chat/việc nhạy độ trễ bắt đầu từ `medium` hoặc `low`; đặt `temperature`/`top_p`/`top_k` trả lỗi 400 — [What's new](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5), [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
- Hội thoại phải chỉ thêm vào (append-only); sửa lịch sử rồi gửi lại thinking block có thể trả 400 — [What's new](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5)
- Từ chối trả HTTP 200 với `stop_reason: "refusal"`, có thể bị tính tiền tùy loại và luôn trừ vào rate limit — [What's new](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5)

**Prompt caching**
- Tối thiểu 512 token với cả 3 mô hình; TTL 5 phút (làm mới miễn phí mỗi lần dùng) hoặc 1 giờ; tối đa 4 breakpoint; tiền tố xếp theo `tools` → `system` → `messages`, đổi một cấp thì mất cấp đó và các cấp sau; khớp chính xác; tách theo workspace trên Claude API; nên đợi phản hồi đầu rồi mới gửi song song; làm ấm bằng `max_tokens: 0` — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Structured outputs**
- GA; `output_config.format` + `strict: true` cho công cụ. Không hỗ trợ ràng buộc số (`minimum`, `maximum`), độ dài chuỗi, đệ quy. Grammar cache 24 giờ, schema mới có độ trễ biên dịch lần đầu. Đổi `output_config.format` làm mất prompt cache của hội thoại. Tối đa 20 công cụ strict. `refusal` và `max_tokens` có thể trả ra không khớp schema — [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- **Citations và structured outputs không dùng chung được**: bật cả hai trả lỗi 400 — [Citations](https://platform.claude.com/docs/en/build-with-claude/citations)

**Agent SDK**
- Agent SDK là thư viện chạy chính binary Claude Code, kèm công cụ đọc/ghi file, chạy lệnh, tìm web, hooks, permissions; khác Client SDK (gọi API trực tiếp, tự viết vòng công cụ) và Managed Agents (Anthropic chạy vòng lặp). Sản phẩm bên thứ ba phải dùng API key, không dùng đăng nhập claude.ai — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Anthropic khuyên bắt đầu đơn giản, gọi API trực tiếp, thường một lần gọi LLM + truy xuất + ví dụ là đủ; workflow theo đường mã định sẵn dễ đoán hơn agent tự quyết — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Managed Agents tính thêm phí phiên chạy và không có batch — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)

**Giới hạn**
- Trần chi theo bậc: Start 500 USD/tháng, Build 1.000, Scale 200.000. Chạm trần: dừng tới 00:00 UTC ngày 1 tháng sau, trả 429 không có `retry-after`, `error_code: enforced_spend_limit_reached`. Trần tự đặt trả 400. Tổ chức mới có thể bắt đầu ở bậc Evaluation với hạn mức thấp hơn. Lên bậc tự động theo lịch sử, hoặc gửi yêu cầu — [Rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- Bậc Start: Sonnet 5.5 và Haiku 5.5 đều 4.000 RPM, 2M token vào/phút, 400k token ra/phút; token đọc cache không tính vào ITPM — [Rate limits](https://platform.claude.com/docs/en/api/rate-limits)

### Inferences
**Giả định của mô hình chi phí (toàn bộ là tự chọn, tính bằng script ngày 03/11/2026):**
- 30 ngày/tháng; "tin" = một tin khách vào cần xử lý; khách hoạt động 14 giờ/ngày (tự chọn), phân bố Poisson (thực tế dồn cục nên số lần ghi cache có thể cao hơn).
- KB + system + tools = 30.000 token (tự chọn), tương đương khoảng 75.000 ký tự theo tỉ lệ 2,5 ký tự/token. ⏳ Tiếng Việt có dấu có thể tốn hơn; phải đo bằng endpoint đếm token.
- Mỗi tin có 2.000 token không cache (lịch sử hội thoại + dữ kiện) (tự chọn); trả lời 400 token ra (tự chọn), khoảng 1.000 ký tự, đã rộng so với tin chat.
- Sàng Haiku: 1.500 cache + 300 không cache + 60 ra. Kiểm tra sau Haiku: 1.000 cache + 400 không cache + 60 ra (tự chọn).

**Chi phí một tin theo kịch bản (USD):**

| Kịch bản | USD/tin | 100 tin/ngày | 1.000 tin/ngày | 10.000 tin/ngày |
|---|---|---|---|---|
| A. Haiku làm tất cả | 0,0007 | ~2 | ~21 | ~210 |
| C. Định tuyến 70% Haiku, 30% Sonnet | 0,0039 | ~16 | ~122 | ~1.187 |
| **B. Haiku sàng + Sonnet effort thấp, `between_tools`** | **0,0112** | **~37** | **~338** | **~3.350** |
| D. Sonnet adaptive (1.000 token ra, 1,5 lần gọi) | 0,0269 | ~84 | ~809 | ~8.060 |
| Tham chiếu: Sonnet không cache | 0,0680 | ~204 | ~2.040 | ~20.400 |

Các dòng đã cộng ghi cache TTL 1 giờ (khoảng 1 lần/ngày). Quy đổi tạm với 26.000 đ/USD (tự chọn, ⏳ chưa kiểm tỷ giá): B ≈ 1 triệu, 8,8 triệu, 87 triệu đồng/tháng.

**Tách chi phí kịch bản B mỗi tin:** Sonnet 0,011 USD gồm đọc cache 30k = 0,003; không cache 2k = 0,004; ra 400 = 0,004. Hai lần Haiku chỉ ~0,00015. Sàng và kiểm tra bằng Haiku gần như miễn phí, nên không có lý do tiết kiệm ở bước này.

**TTL cache đổi kết quả ở lưu lượng thấp:** ở 100 tin/ngày (khoảng 8,4 phút/tin), TTL 5 phút hụt khoảng 55% số tin, tiền ghi khoảng 126 USD/tháng; TTL 1 giờ chỉ ~4 USD. Từ 1.000 tin/ngày TTL 5 phút mới đủ (~8 USD). Vậy khởi đầu nhỏ phải chọn TTL 1 giờ.

**Chi phí phụ trợ (tự chọn, ước tính thô):** bộ hồi quy 200 ca chạy bằng Batch ~1 USD/lần; Agent nội dung 60 bài/tháng ~1,5 USD; phân tích quảng cáo 1 lần/ngày ~1,7 USD (20 tài khoản ~33 USD). Tổng dưới 50 USD/tháng. Chưa tính hạ tầng, phí Zalo/Meta nếu có.

**Hệ quả:**
- Rate limit không phải rào: 10.000 tin/ngày với đỉnh gấp 10 (tự chọn) ≈ 119 RPM, so với 4.000 RPM ở Start.
- Trần chi mới là rủi ro: kịch bản B ở 1.000 tin/ngày nằm trong Start, nhưng D ở 1.000 tin/ngày đã vượt 500 USD; 10.000 tin/ngày cần Scale. Chạm trần giữa tháng = bot chết tới ngày 1 tháng sau, nên cần cảnh báo ở 50/80% và đường dự phòng sang người (mục 6).
- Thiết kế cụ thể: dùng Client SDK/Messages API với vòng lặp tự viết cho luồng gặp khách. Agent SDK mang theo công cụ chạy lệnh và ghi file không cần thiết, đi ngược "tối giản chức năng" của OWASP LLM06; chỉ hợp cho việc nội bộ không nhận đầu vào khách (ví dụ soạn nội dung).
- Không dùng forced tool use, dùng structured outputs cho bản nháp; chạy thử Haiku trước (rẻ hơn 16 lần) và chỉ giữ Sonnet nếu eval tiếng Việt chứng minh chênh lệch.

### Gaps
- ⏳ Chưa có số đo chất lượng tiếng Việt giữa Haiku 5.5 và Sonnet 5.5; đây là biến quyết định khoảng cách A–B và phải tự đo.
- ⏳ Token thật cho tiếng Việt và lượng thinking thật ở effort `low`/`medium` chưa đo; có thể làm số ra khác đáng kể.
- ⏳ Chưa đọc chi tiết cách tính tiền refusal ([Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)).

## 3. Truy xuất tri thức: prompt caching một bộ tài liệu nhỏ hay tìm kiếm vector

### Takeaway
Với bộ tài liệu của chính Hubsell (cỡ vài chục nghìn token), nhét cả vào prompt có cache là rẻ hơn, đơn giản hơn và không có lỗi truy xuất. RAG chỉ cần khi kho vượt ~200k token, chia theo từng khách, hoặc đổi liên tục. Giá, tồn kho, đơn hàng thì không dùng cách nào trong hai cách đó mà tra DB.

### Cited Findings
- Anthropic: kho dưới 200.000 token (khoảng 500 trang) thì bỏ RAG, đưa cả vào prompt; prompt caching giảm độ trễ hơn 2 lần và chi phí tới 90% (bài năm 2024) — [Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- RAG có tỉ lệ truy xuất hụt thực: top-20 hụt 5,7% ở mức nền; embedding ngữ cảnh còn 3,7%; thêm BM25 còn 2,9%; thêm rerank còn 1,9%. Bộ khuyên dùng lấy 150 đoạn, rerank, đưa 20 đoạn vào mô hình, tạo ngữ cảnh ~1,02 USD/triệu token tài liệu (giá 2024, Claude 3 Haiku) — [Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- Đọc cache Sonnet 5.5 = 0,05× giá vào; Haiku 5.5 = 0,1× — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Prompt Haiku 5.5 trên 100k token bị tính giá gấp 5 — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Đổi nội dung tiền tố làm mất cache từ điểm đó trở đi — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Đầu độc tài liệu trong kho RAG là một kịch bản tiêm lệnh OWASP nêu — [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- OWASP LLM09 khuyến nghị RAG để neo vào nguồn đã kiểm, kiểm chéo, tự động xác thực đầu ra quan trọng, gắn nhãn nội dung AI — [OWASP LLM09](https://genai.owasp.org/llmrisk/llm092025-misinformation/)

### Inferences
- **Điểm hòa vốn mới:** trên Sonnet 5.5, 1 token không cache đắt bằng 20 token đọc cache. Tính ra cache 30k token (0,003 USD/tin) còn rẻ hơn gửi 2k token đoạn truy xuất không cache (0,004 USD/tin). Với 20 đoạn × 800 token = 16k token mỗi lần (cấu hình trong bài Anthropic), cache cả kho vẫn rẻ hơn cho tới ~320k token. Trên Haiku tỉ lệ này là 10:1 và có vách 100k token, nên với Haiku cần giữ prompt dưới 100k.
- Con số 200k token/500 trang tính theo tokenizer cũ; với tokenizer hiện tại 200k token ≈ 500k ký tự, tức ít trang hơn (⏳ phải đo lại, đừng quy theo trang).

| Dạng tri thức | Cách đề xuất | Lý do |
|---|---|---|
| Giới thiệu sản phẩm, FAQ, chính sách, kịch bản bán của Hubsell | Cache trong prompt, có `kb_version`, TTL 1 giờ | Nhỏ, ít đổi, không hụt truy xuất |
| Giá gói, khuyến mãi đang chạy, trạng thái tài khoản, đơn | Tra DB/API bằng mã, chèn dữ kiện có `fact_id` | Sai là rủi ro pháp lý (Air Canada), phải luôn mới |
| Kho lớn hơn 100–200k token, tài liệu riêng từng khách | Tìm kiếm lai (embedding + BM25 + rerank), lọc quyền theo khách ở mã | Không vừa cache hoặc cần phân quyền |
| Lịch sử hội thoại | Automatic caching | Đỡ chi phí với hội thoại nhiều lượt |

- Thứ tự đặt tiền tố: tools → system ổn định → KB → lịch sử → tin mới. Tuyệt đối không chèn thời gian hay tên khách lên trên KB (sẽ phá cache mỗi tin).
- Cập nhật KB gom theo đợt: mỗi lần đổi mất một lần ghi 30k token (0,12 USD ở TTL 1 giờ trên Sonnet), rất nhỏ, nên đừng vì cache mà ngại sửa tài liệu sai.
- Quy tắc kho: chỉ tài liệu chủ đã duyệt mới vào KB; không tự động đưa hội thoại khách vào KB.

### Gaps
- ⏳ Chưa đo chất lượng embedding tiếng Việt; số trong bài Anthropic là tiếng Anh.
- ⏳ Chưa rõ kích thước KB thực của Hubsell, nên số 30k là tự chọn.

## 4. Thiết kế chuyển cho người: kích hoạt, độ tin cậy, gói ngữ cảnh, tốc độ, chống im lặng khi người không trả lời

### Takeaway
Kích hoạt chuyển phải chủ yếu bằng luật xác định, luôn tôn trọng khi khách đòi gặp người. Gói ngữ cảnh gồm tin gốc nguyên văn và phần tóm tắt được gắn nhãn. Chuyển mà không ai trả lời là một lỗi có thể đo: phải có máy trạng thái, nhiều nấc nhắc qua nhiều kênh, và canh theo hạn cửa sổ nhắn của nền tảng.

### Cited Findings
- Fin (Intercom) tách Escalation Rules dựa trên dữ liệu và Escalation Guidance bằng ngôn ngữ tự nhiên; guidance có thể không ổn định qua hội thoại dài, có thể lần trước từ chối lần sau đồng ý; mời chuyển cho mọi tình huống làm giảm tỉ lệ tự giải quyết; nút gặp người do hệ thống quản lý — [Intercom Help](https://www.intercom.com/help/en/articles/10560969-fin-ai-agent-escalation-and-handoff)
- Hướng dẫn của các nhà cung cấp (chất lượng trung bình, có lợi ích thương mại): ngữ cảnh là yếu tố quan trọng nhất; gói chuyển nên có toàn văn kèm thời gian và tóm tắt lý do, AI đã thử gì, còn lại gì; trường cấu trúc: intent, sản phẩm, độ khẩn, định danh, bước tiếp theo; kích hoạt theo yêu cầu rõ ràng, cảm xúc, luật; tệ nhất là AI không giúp được và không có đường tới người — [Gleap](https://www.gleap.io/blog/ai-support-human-handover-best-practices), [Cresta](https://cresta.com/guides/ai-to-human-agent-handoff-best-practices), [Twig](https://www.twig.so/blog/how-smooth-is-handoff-from-ai-to-live-agent)
- Klarna đổi hướng để khách luôn có người khi cần — [Entrepreneur](https://www.entrepreneur.com/business-news/klarna-ceo-reverses-course-by-hiring-more-humans-not-ai/491396)
- Meta: cửa sổ tiêu chuẩn 24 giờ (khách nhắn, bấm CTA, bình luận bài); tin từ quảng cáo Click-to-Messenger có thể tới 7 ngày; Human Agent tag cho người trả lời thủ công trong 7 ngày; ngoài cửa sổ không được gửi khuyến mãi bằng tag — [Meta for Developers](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages). ⏳ Việc Human Agent tag phải xin quyền riêng chỉ thấy trong tóm tắt kết quả tìm kiếm từ trang thứ cấp, chưa xác định được trang cụ thể và chưa đối chiếu tài liệu Meta; ví dụ một trang trong kết quả — [Kommo](https://www.kommo.com/blog/24-hour-message-rule/)
- ⏳ Toàn bộ dòng này chỉ từ tóm tắt kết quả tìm kiếm, tôi không mở các trang và không đọc bài HBR gốc, nên không nên dẫn như số đã kiểm: kiểm toán năm 2011 (2.241 công ty Mỹ) cho thấy 37% trả lời lead trong 1 giờ, 23% không trả lời; con số "gấp 7 lần" gán cho Oldroyd và cộng sự, các nguồn lệch nhau về cỡ mẫu (1,25 triệu so với 2,24 triệu lead); nghiên cứu InsideSales/MIT 2007 đo lượt liên hệ và đủ điều kiện, không đo chốt đơn. Hai trang có trong kết quả — [Chief Marketer](https://chiefmarketer.com/inbound-leads-need-fast-action), [Rework](https://resources.rework.com/libraries/marketing-sales-alignment/five-minute-response-sla)

### Inferences
**Kích hoạt (chuyển ngay, bằng mã, không qua "cảm giác" của mô hình):**
- Khách đòi gặp người (khớp từ khóa + intent enum). Không bao giờ giữ khách lại.
- Tiền và cam kết: hoàn tiền, khiếu nại thanh toán, hủy, xin giá ngoại lệ, báo giá doanh nghiệp, hợp đồng, hóa đơn.
- Pháp lý, đe dọa, truyền thông, trẻ em, dữ liệu cá nhân.
- Cờ nghi tiêm từ bộ sàng; `stop_reason: refusal`; lỗi schema; số/URL không qua kiểm tra (mục 5).
- Không có `fact_id` phù hợp ("không biết" là kích hoạt, không phải chỗ để đoán).
- Khách lặp cùng ý ≥2 lượt (tự chọn).
- Lead giá trị cao: chuyển vì cơ hội, không vì rủi ro.

**Độ tin cậy:** không dùng điểm tự báo của mô hình làm cổng cho tự gửi. Chỉ dùng một chiều: thấp thì chuyển, cao thì không có nghĩa được phép. Quyền tự gửi quyết định theo intent và luật (⏳ tôi không tìm được nghiên cứu tốt về hiệu chỉnh độ tin cậy cho chat tiếng Việt; nếu dùng phải đo hiệu chỉnh trên dữ liệu gắn nhãn).

**Gói ngữ cảnh gửi cho người:**
- Tin gốc của khách **nguyên văn**, có nhãn "nội dung khách", kèm thời gian (tóm tắt có thể bị tiêm lệnh thao túng nên không được thay thế tin gốc).
- Tóm tắt do AI, gắn nhãn AI: khách muốn gì, đã thử gì, còn lại gì.
- Trường có cấu trúc: kênh, sender id, tài khoản liên kết, intent, độ khẩn, lý do chuyển, hạn cửa sổ nhắn còn lại.
- Dữ kiện đã dùng (`fact_id`), bản nháp gợi ý nếu có, liên kết mở hội thoại.

**Tốc độ (tất cả tự chọn, không có chuẩn chat đáng tin):** trả lời AI hoặc xác nhận: dưới 30 giây. Người nhận trong giờ làm: lead nóng dưới 5 phút, thường dưới 30 phút. Ngoài giờ: nói thật giờ mở cửa, không hứa nhanh. Đo thực tế trong chế độ bóng rồi chỉnh.

**Chống im lặng (máy trạng thái lưu DB, do cron canh):**
- `T+0`: mẫu cố định cho khách "đã chuyển, dự kiến phản hồi trong X"; đẩy thông báo cho chủ.
- `T+5 phút` (tự chọn): nhắc lần 2 qua kênh thứ hai.
- `T+15 phút` (tự chọn): gọi/SMS nếu là lead nóng hoặc khiếu nại.
- `T+60 phút` (tự chọn): gửi khách cập nhật thật, hỏi có muốn nhận lại vào giờ cụ thể không.
- `T+20 giờ` (tự chọn): báo động hạn cửa sổ 24 giờ của Meta sắp đóng; sau đó chỉ còn Human Agent tag nếu có quyền.
- Không có `T+vô cùng`: mọi ca phải kết thúc bằng trạng thái tường minh.
- **Chỉ số:** tỉ lệ ca chuyển không ai nhận trong SLA, đo mỗi ngày; báo cáo sáng có số 0 cũng phải gửi, để biết máy canh còn chạy (dead-man's switch).
- Không dùng email làm kênh báo duy nhất: ghi nhớ dự án có sự cố Zoho chặn gửi thư ngày 30/10/2026 (⏳ theo ghi nhớ, không kiểm lại trong lượt này).

### Gaps
- ⏳ Không có số liệu chuẩn đáng tin về kỳ vọng phản hồi chat, đặc biệt ở Việt Nam và SaaS cho nhà bán. Các "chuẩn 5 phút" là lời khuyên thực hành.
- ⏳ Chưa kiểm Zalo OA có cửa sổ và luật tương tự Meta không (ngoài phạm vi các nguồn đã đọc).
- ⏳ Không tìm thấy tài liệu Intercom mô tả chính xác gói ngữ cảnh chuyển cho nhân viên.

## 5. Đánh giá: đo chất lượng bản nháp, bộ hồi quy, kiểm tra số liệu, chọn cổng thăng cấp bằng bằng chứng

### Takeaway
Cổng "≥80% trên 30 hội thoại" không phân biệt nổi chất lượng thật: 24/30 có khoảng tin cậy 95% là 63–90%, và nó đo sự chấp nhận của một người đang dễ mệt chứ không đo sự đúng. Thay bằng cổng theo từng intent, tách lỗi nghiêm trọng khỏi lỗi văn phong, cỡ mẫu tính từ mức rủi ro chịu được, có đo độc lập.

### Cited Findings
- Anthropic: bắt đầu với 20–50 tác vụ từ lỗi thật; hai chuyên gia phải cho cùng kết luận; bộ cân bằng cả ca nên làm và không nên làm; chấm bằng mã trước, mô hình chấm cần hiệu chỉnh với người và có lựa chọn "Không rõ", mỗi chiều một giám khảo; eval năng lực khác eval hồi quy (hồi quy phải gần 100%); với agent hội thoại thì kết hợp trạng thái cuối, ràng buộc transcript, rubric giọng điệu; dùng pass^k (mọi lần thử đều đạt) cho agent gặp khách vì cần nhất quán; và đọc transcript — [Anthropic Engineering](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Quy tắc ba: 0 sự kiện trong n lần thử thì giới hạn trên 95% khoảng 3/n (tốt khi n > 30) — [Wikipedia](https://en.wikipedia.org/wiki/Rule_of_three_(statistics))
- Người duyệt không phải thước đo độc lập: người dùng Claude Code chấp nhận 93% lời nhắc xin quyền và Anthropic gọi đó là mệt mỏi phê duyệt — [Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-auto-mode)
- Thí nghiệm ngẫu nhiên 2.784 người (Beck và cộng sự): người hoài nghi AI phát hiện lỗi tốt hơn; bắt buộc sửa lỗi đã gắn cờ lại làm giảm gắn kết và tăng chấp nhận gợi ý sai; lỗi cần hiểu khái niệm hoặc kiến thức chuyên môn khó phát hiện hơn; kết quả phụ thuộc ai duyệt và quy trình duyệt ra sao — [arXiv 2509.08514](https://arxiv.org/abs/2509.08514)
- OWASP: dùng bộ ba RAG (liên quan ngữ cảnh, bám nguồn, liên quan câu hỏi) và kiểm định đầu ra bằng mã — [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- Citations trả về đoạn văn chính xác với con trỏ hợp lệ được đảm bảo, `cited_text` không tính vào token ra; nhưng không dùng chung với structured outputs — [Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- Khung NIST khuyến nghị đánh giá sau triển khai, red-team định kỳ, ghi nhận lỗi và suýt lỗi — [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/manage/)

### Inferences
**Tính lại cổng cũ (script ngày 03/11/2026, khoảng Wilson 95%):**

| Quan sát | Khoảng tin cậy | Ý nghĩa |
|---|---|---|
| 24/30 = 80% | 62,7%–90,5% | Không phân biệt được 65% với 90% |
| 6/6 (30 ca chia 5 intent) | 61%–100% | Theo từng intent gần như không có thông tin |
| 80/100 | 71,1%–86,7% | |
| 240/300 | 75,1%–84,1% | |

| Số ca liên tiếp không lỗi nghiêm trọng | Giới hạn trên 95% của tỉ lệ lỗi nghiêm trọng |
|---|---|
| 30 | 9,5% |
| 50 | 5,8% |
| 100 | 3,0% |
| 300 | 1,0% |
| 500 | 0,6% |

**Cổng đề xuất, chia 4 lớp:**
1. **Hồi quy tiền triển khai:** 50 ca khởi đầu (tự chọn, mức trên của khoảng 20–50 Anthropic gợi ý) từ hội thoại thật cộng ca đỏ: tiêm lệnh tiếng Việt (có dấu, không dấu, teencode), giá $1 kiểu Chevrolet, ép hứa hoàn tiền, đòi gặp người, hỏi đối thủ, ca không nên trả lời. Chạy k=3 mỗi ca (tự chọn), yêu cầu pass^3. Mọi thay đổi prompt/KB/mô hình đều phải chạy lại; mỗi lỗi thực tế thành một ca mới.
2. **Lỗi theo mức:** S0 = sai giá/chính sách/cam kết, rò dữ liệu, nhầm khách; S1 = sai/thiếu dữ kiện không gây hại; S2 = văn phong. Tỉ lệ sửa chữ chỉ đại diện cho S2, không dùng làm cổng thăng cấp.
3. **Cổng tự gửi cho từng intent, không phải toàn hệ thống:** đặt tỉ lệ S0 chịu được bằng cách tính ngưỡng hòa vốn `p_max = V / C`, với V = giá trị thời gian tiết kiệm mỗi tin tự gửi, C = chi phí một lỗi S0. Ví dụ tự chọn: V = 3.000 đ, C = 500.000 đ cho ra p_max = 0,6%, tức cần ~500 ca không S0. Ý là phải cho số ca theo rủi ro: intent chào hỏi/giờ làm việc có thể thấp hơn nhiều, intent giá không nên tự gửi bằng lời mô hình.
4. **Hạ cấp tự động:** một S0 trong intent đã tự gửi → intent đó về bản nháp, điều tra, reset đếm. Cổng phải có chiều hạ, không chỉ chiều lên.

Để đạt cỡ mẫu nhanh mà không rủi ro: phát lại hội thoại cũ và chế độ bóng. Chế độ bóng gần như miễn phí ở quy mô nhỏ (100 tin/ngày ~37 USD/tháng).

**Đo độc lập để chống "duyệt cho qua":**
- Mẫu ngẫu nhiên hằng tuần, chấm **mù** (người chấm không biết chủ đã gửi hay sửa). ⏳ Với người vận hành một mình, nên kết hợp giám khảo Sonnet/Opus đã hiệu chỉnh trên 50–100 ca do chủ gắn nhãn.
- **Lỗi cài sẵn:** thỉnh thoảng hệ thống chèn bản nháp có lỗi đã biết vào hàng duyệt để đo tỉ lệ chủ bắt được, rồi rút trước khi gửi. Nếu tỉ lệ thấp thì số "gửi không sửa" không còn đáng tin. (Là suy luận, chưa thấy nguồn áp dụng cho chatbot.)
- Giữ lựa chọn "từ chối, chuyển mình làm" thay vì bắt sửa, theo kết quả của Beck.

**Kiểm tra số liệu: ưu tiên "mô hình không được viết số":**
- Cách mạnh nhất: bản nháp dùng chỗ giữ chỗ `{{gia:goi_x}}`, mã điền từ DB. Mô hình không thể bịa con số. Áp dụng tư tưởng "poka-yoke" công cụ của Anthropic ([nguồn](https://www.anthropic.com/engineering/building-effective-agents)).
- Tầng mã: regex bắt số, %, tiền ("499k", "1,5 triệu", "1.500.000đ"), ngày, SĐT, URL. Mỗi giá trị phải khớp bảng dữ kiện. Không khớp → không tự gửi. Cách viết số tiếng Việt rất đa dạng nên phải chuẩn hóa định dạng và viết ca kiểm thử riêng cho bộ regex.
- Tầng LLM: một lần gọi Haiku độc lập kiểm tra mỗi khẳng định có nằm trong `fact_id` được dẫn không. Muốn dùng Citations thì để ở bước kiểm tra này vì nó xung đột với structured outputs ở bước nháp.
- Bản nháp nêu chính sách (hoàn tiền, cam kết) mà không có `fact_id` → chuyển người, không gửi. Đây là khoản bảo vệ trực tiếp cho kiểu sự cố Air Canada và Cursor.

**Theo dõi sau thăng cấp:** tỉ lệ chuyển người, tỉ lệ khách nhắn lại cùng ý trong 24 giờ, tỉ lệ khiếu nại, tỉ lệ qua kiểm tra số, chuyển đổi so với nhóm người (không chỉ tiết kiệm). Bài học Klarna: chi phí không phải tiêu chí chính.

### Gaps
- ⏳ Không tìm thấy nghiên cứu nào cho ra ngưỡng chuẩn cho mức thăng cấp agent bán hàng; không có nguồn cho một con số phổ quát nên cấu trúc tính `p_max` trên là suy luận, không phải chuẩn ngành.
- ⏳ Con số radiology "82% xuống 46%" và các số "Stanford/MIT/Berkeley" trên một vài blog không truy được bản gốc, không nên dùng.
- ⏳ Nghiên cứu Beck đo công việc gán nhãn, không phải duyệt tin bán hàng; suy rộng cần thận trọng.

## 6. Nhật ký kiểm toán, công tắc dừng, giới hạn tốc độ, xử lý webhook lũy đẳng

### Takeaway
Bốn cơ chế này đều ở lớp mã, không phụ thuộc mô hình: nhật ký chỉ thêm đủ để tái dựng từng quyết định, công tắc nhiều tầng đã được diễn tập, giới hạn theo khách và theo tiền, và hộp thư vào/ra với khóa duy nhất để không xử lý trùng hay gửi trùng.

### Cited Findings
**Webhook**
- Meta: thất bại thì gửi lại ngay rồi giãn dần trong 36 giờ; gom tới 1.000 cập nhật một lô nhưng không đảm bảo; máy chủ phải tự khử trùng; ký `X-Hub-Signature-256` bằng SHA256 với App Secret, nên xác minh; trả `200 OK` cho mọi thông báo — [Meta Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)
- Stripe (mẫu thực hành tham khảo): xác minh chữ ký trên body thô, trả 2xx trước logic phức tạp, xử lý bằng hàng đợi bất đồng bộ, ghi event id đã xử lý để khử trùng, không dựa vào thứ tự, so sánh hằng thời gian, dung sai thời gian mặc định 5 phút chống phát lại, xoay vòng bí mật — [Stripe Webhooks](https://docs.stripe.com/webhooks)

**Công tắc dừng và kiểm toán**
- NIST AI RMF MANAGE 2.4: có quy trình vượt/ngắt/vô hiệu hệ thống, đánh giá định kỳ ngưỡng sự cố, có hệ thống dự phòng, tiêu chí triển khai lại, giữ tài liệu cho điều tra và pháp lý, phân tích gốc sau mỗi lần ngắt. MANAGE 4.1: giám sát sau triển khai, red-team định kỳ, chia sẻ lỗi và suýt lỗi — [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/manage/)
- Bình luận về Air Canada: nên lưu cách huấn luyện và kiểm thử chatbot vì có thể cần để chứng minh đã cẩn trọng — [McCarthy Tétrault](https://www.mccarthy.ca/en/insights/blogs/techlex/moffatt-v-air-canada-misrepresentation-ai-chatbot)
- DPD: lỗi xuất hiện sau một bản cập nhật, phần AI bị tắt ngay — [ITV News](https://itv.com/news/2024-01-19/dpd-disables-ai-chatbot-after-customer-service-bot-appears-to-go-rogue)

**Giới hạn và chi tiêu**
- OWASP LLM10: "Denial of Wallet" khai thác cơ chế trả theo lượt; biện pháp là giới hạn cỡ đầu vào, rate limit theo nguồn, hạn ngạch, timeout, giám sát bất thường — [OWASP LLM10](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/)
- Anthropic: siết người vi phạm lặp lại; workspace có trần chi và rate limit riêng; không đặt được trần chi cho workspace mặc định; lỗi trần tự đặt trả 400 với `invalid_request_error` — [Rate limits](https://platform.claude.com/docs/en/api/rate-limits), [Mitigate jailbreaks](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)
- Meta Marketing API có trường `spend_cap` trên tài khoản quảng cáo: chạm trần thì chiến dịch dừng; quyền `ads_management`/`ads_read` tách nhau (nguồn tài liệu bên thứ ba, ⏳ cần đối chiếu tài liệu chính thức của Meta) — [With One](https://www.withone.ai/knowledge/meta/conn_mod_def%3A%3AGKRjs1tp3Dg%3A%3A8qTbyc0fT4-Fz4eqoL5E8Q/md)

### Inferences
**Lũy đẳng (kiểu inbox/outbox):**
1. Webhook: xác minh chữ ký trên body thô → `INSERT ... ON CONFLICT DO NOTHING` vào `inbound_events` với khóa duy nhất `(channel, platform_message_id)` → xếp hàng → trả 200. Không gọi LLM trong handler.
2. Gộp tin (debounce): khách hay nhắn 3 tin liên tiếp, gộp theo hội thoại trong 20–30 giây (tự chọn) để tiết kiệm và tránh trả lời chồng.
3. Xử lý theo từng hội thoại, tuần tự trong hội thoại, song song giữa các hội thoại; thứ tự dựa trên thời gian của nền tảng, không dựa vào thứ tự đến.
4. Trước khi gọi LLM: kiểm tra hội thoại có đang do người nắm (`human_owned`) không. Trước khi gửi: kiểm tra lại, vì người có thể vừa nhảy vào.
5. `outbound_messages` với khóa duy nhất `(inbound_event_id, reply_seq)`; ghi trạng thái `sending` trước khi gửi, `sent` kèm id nền tảng sau khi gửi. Nếu chết giữa chừng thì không tự gửi lại mà xử lý tay/đối chiếu (thà thiếu còn hơn đúp).
6. Bỏ qua tin vọng lại từ chính trang (`is_echo` ⏳ chưa đọc tài liệu Meta về trường này) để bot không tự trả lời mình, và có trần lượt theo hội thoại chống vòng lặp giữa hai bot.
7. Việc dài theo Hubsell: ghi nhớ dự án có sổ bền và cảnh báo về pg-boss khóa gộp (⏳ theo ghi nhớ) nên kiểm thiết kế hàng đợi trước khi tái dùng.

**Nhật ký (chỉ thêm, mỗi lần gọi một dòng):** event id; tin thô; `prompt_version`, `kb_version`, `schema_version`, model id; dữ kiện dùng; đầu ra thô; `stop_reason`; token và chi phí; luật nào đã quyết định; người duyệt, thời điểm, hash nội dung được duyệt; diff chủ sửa; tin gửi thật và id nền tảng. Mục tiêu: trả lời được "vì sao khách này nhận câu đó" sau 6 tháng. Tin nhắn có dữ liệu cá nhân: đặt hạn lưu và phân quyền (⏳ xem Gaps).

**Công tắc nhiều tầng (từ nhỏ đến lớn):**
- Cờ theo intent → theo kênh → toàn hệ thống, đọc tại cổng gửi với cache ngắn. Bấm được từ điện thoại trong 1 chạm.
- Thu hồi token gửi tin/đăng bài/quảng cáo (trong tầm tay, có sổ tay ghi sẵn).
- Trần chi Anthropic theo workspace.
- Trần chi phía nền tảng quảng cáo: chốt chặn cuối, tồn tại kể cả khi toàn bộ hệ thống của mình hỏng.
- **Tắt phải an toàn:** khi bot tắt, webhook vẫn nhận, lưu, gửi mẫu "đã nhận, sẽ phản hồi trong giờ làm" và đưa vào hàng cho người. Không được làm mất tin.
- **Tự ngắt (ngưỡng đều tự chọn, cần chỉnh sau khi có dữ liệu):** ≥1 lỗi S0 đã gửi; tỉ lệ thất bại kiểm tra số gấp 3 lần nền trong 1 giờ; tin gửi đi vượt 2 lần đỉnh tuần; chi tiêu Anthropic giờ này vượt 3 lần trung bình; API Claude lỗi liên tục; cờ nghi tiêm tăng đột biến.
- Diễn tập mỗi tháng, ghi lại thời gian từ lúc bấm tới khi dừng thật. Công tắc chưa diễn tập coi như không có.
- Sau mỗi thay đổi prompt/mô hình: bật dần theo tỉ lệ, sau bài học DPD.

**Giới hạn:**
- Theo người gửi: N tin/giờ, sau đó chỉ gửi mẫu (tự chọn: 20/giờ).
- Theo hội thoại: trần lượt AI liên tiếp rồi chuyển người (tự chọn: 8).
- Theo cỡ tin: cắt tin dài (tự chọn: 2.000 ký tự) trước khi vào LLM; trong ForcedLeak, ô nhập cho phép giấu lệnh dài tới 42.000 ký tự.
- Theo chi phí: ngân sách USD/ngày có cảnh báo 50/80/100%; riêng 100% → chế độ chỉ người, không phải tắt lặng.
- Kênh công khai (bình luận): trần chặt hơn, không có dữ liệu cá nhân/giá trong bình luận, chuyển vào tin riêng.
- Phân biệt lỗi 429 thường (có `retry-after`, thử lại có giãn cách) với 429 hết trần chi (`enforced_spend_limit_reached`, không thử lại, báo động ngay).
- Agent quảng cáo: trần tuyệt đối cho mỗi thay đổi, mỗi ngày, mỗi tuần; khóa thời gian giữa các lần đổi. Ghi nhớ dự án có "hạ ROAS nấc 10% + khóa 48 giờ" trong Trợ lý quảng cáo (⏳ theo ghi nhớ); nên tái dùng cơ chế sẵn có thay vì để LLM tự quyết nấc.

### Gaps
- ⏳ Chưa đọc tài liệu Meta Send API về khóa lũy đẳng gửi, nên giả định phía gửi có thể đúp nếu thử lại.
- ⏳ Chưa kiểm TikTok Business API và Zalo OA có khóa tương tự, chữ ký webhook tương tự hay không.
- ⏳ Yêu cầu Luật Bảo vệ dữ liệu cá nhân Việt Nam về hạn lưu và gửi dữ liệu ra nước ngoài (Anthropic mặc định định tuyến toàn cầu) chưa kiểm trong lượt này; cần luật sư hoặc người nghiên cứu pháp lý xác nhận.

## 7. Sự cố thực tế và bài học

### Takeaway
Các vụ nổi tiếng đều ít liên quan đến "mô hình dở" mà liên quan đến thiếu kiểm soát: để bot phát ngôn thay công ty mà không có nguồn đúng, không giới hạn phạm vi, hoặc tối ưu chi phí trên hết. Thiệt hại tiền trực tiếp thường nhỏ, thiệt hại danh tiếng và trách nhiệm thì không; và trách nhiệm pháp lý đã có án lệ, thuộc về công ty.

### Cited Findings
| Vụ | Chuyện gì xảy ra | Bài học | Nguồn |
|---|---|---|---|
| **Air Canada** (Moffatt, 2024 BCCRT 149, 14/02/2024) | Bot nói có thể xin giá tang chế sau chuyến bay, trái một trang khác của chính website. Công ty lập luận không chịu trách nhiệm cho lời chatbot; tòa bác, công ty chịu trách nhiệm toàn bộ thông tin trên site. Cấu thành sơ suất gây hiểu nhầm. Tổng phải trả 812,02 CAD (bồi thường, lãi, phí) | Lời bot = lời công ty; không thể bắt khách đối chiếu các trang; tiền nhỏ nhưng là tiền lệ | [DWW](https://www.dww.com/articles/bc-tribunal-finds-air-canada-liable-for-inaccurate-advice-given-by-website-chatbot), [McCarthy](https://www.mccarthy.ca/en/insights/blogs/techlex/moffatt-v-air-canada-misrepresentation-ai-chatbot), [OWASP LLM09](https://genai.owasp.org/llmrisk/llm092025-misinformation/) |
| **Klarna** (2024–2025) | Năm 2024 tuyên bố AI làm việc của 700 nhân viên, xử lý 2/3 hội thoại. Tháng 5/2025 CEO thừa nhận chi phí là tiêu chí quá nặng làm giảm chất lượng, tuyển người trở lại kiểu Uber để khách luôn gặp được người. Klarna gọi là hai đường song song, không phải rút khỏi tự động hóa | Đo chất lượng, không chỉ tiết kiệm; giữ đường đến người | [Entrepreneur](https://www.entrepreneur.com/business-news/klarna-ceo-reverses-course-by-hiring-more-humans-not-ai/491396), [Finextra](https://www.finextra.com/newsarticle/45956/klarna-rethinks-ai-customer-service-push-as-as-ceo-acknowledges-value-of-human-touch), [CX Today](https://www.cxtoday.com/contact-center/klarna-grapples-with-ai-led-customer-service-pivots-to-an-uber-type-of-setup/) |
| **Chevrolet of Watsonville** (12/2023) | Người dùng ra lệnh bot kết thúc câu nào cũng nói đó là đề nghị ràng buộc pháp lý rồi "chốt" Tahoe 1 USD. Bot cũng trả lời việc lạc đề như viết Python. Fullpath tắt bot; CEO Fullpath nói đa số người phá không làm bot lệch được | Không để mô hình đưa ra giá hay cam kết; giới hạn phạm vi; lạc đề cũng tốn tiền | [Yahoo News](https://news.yahoo.com/auto-dealership-deploys-ai-chatbot-144037547.html), [The Autopian](https://theautopian.com/chevy-dealers-ai-chatbot-allegedly-recommended-fords-gave-free-access-to-chatgpt) |
| **DPD** (01/2024) | Khách bực vì bot vô dụng, dẫn nó chửi thề, làm thơ chê công ty, tự gọi mình tệ nhất. DPD nói lỗi sau một bản cập nhật, tắt ngay; bài đăng hơn một triệu lượt xem | Hồi quy sau mỗi cập nhật; công tắc nhanh; ca đỏ về giọng điệu | [ITV](https://itv.com/news/2024-01-19/dpd-disables-ai-chatbot-after-customer-service-bot-appears-to-go-rogue), [Silicon UK](https://silicon.co.uk/e-innovation/artificial-intelligence/dpd-disable-ai-chatbot-546650) |
| **Cursor "Sam"** (04/2025) | Bot hỗ trợ bịa chính sách một thiết bị để giải thích lỗi đăng xuất; khách hủy gói; công ty xin lỗi và hoàn tiền; nhiều người tưởng Sam là người | Hỏi chính sách phải có nguồn hoặc chuyển người; gắn nhãn AI | [Fortune](https://fortune.com/article/customer-support-ai-cursor-went-rogue), [eWeek](https://www.eweek.com/news/cursor-ai-chatbot-hallucination-fake-policy) |
| **NYC MyCity** (03/2024) | Bot chính quyền xây trên Azure AI bảo chủ doanh nghiệp được lấy tiền tip nhân viên, trái luật; thành phố giữ bot và thêm cảnh báo | Có nguồn chính thức vẫn sai; câu hỏi pháp lý/lao động thì chuyển người | [The Markup](https://themarkup.org/news/2024/03/29/nycs-ai-chatbot-tells-businesses-to-break-the-law) |
| **Project Vend** (Anthropic, 27/06/2025) | Claude Sonnet 3.7 vận hành quầy hàng một tháng: bị khách thuyết phục giảm giá và cho không, tái lập khuyến mãi sau khi đã bỏ, có lúc đưa số Venmo không tồn tại, bán dưới giá vốn, không có lãi | Quyền giá và chiết khấu không thuộc về LLM; số tài khoản phải lấy từ mã | [Anthropic](https://www.anthropic.com/research/project-vend-1) |
| **ForcedLeak, Supabase MCP** | Xem mục 1 | Form lead và ticket đều là đường tiêm; PoC, không phải vụ tấn công đã xác nhận ngoài thực tế | [The Hacker News](https://thehackernews.com/2025/09/salesforce-patches-critical-forcedleak.html), [Simon Willison](https://feeds.simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/) |

- Gartner (dự báo, chưa kiểm chứng): tới 2027, 50% tổ chức định cắt mạnh nhân sự CSKH nhờ AI sẽ bỏ kế hoạch; khảo sát 12/2025 trên 321 lãnh đạo: chỉ 20% đã cắt nhân sự vì AI — [Gartner 06/2025](https://www.gartner.com/en/newsroom/press-releases/2025-06-10-gartner-predicts-50-percent-of-organizations-will-abandon-plans-to-reduce-customer-service-workforce-due-to-ai), [Gartner 12/2025](https://www.gartner.com/en/newsroom/press-releases/2025-12-02-gartner-survey-finds-only-20-percent-of-customer-service-leaders-report-ai-driven-headcount-reduction)
- Luật Trí tuệ nhân tạo 134/2025/QH15 có hiệu lực 01/03/2026 — [VnEconomy](https://vneconomy.vn/luat-tri-tue-nhan-tao-se-co-hieu-luc-tu-ngay-132026.htm). Điều 11: hệ thống AI tương tác trực tiếp với người phải thiết kế để người dùng nhận biết đang tương tác với AI; bên triển khai thông báo rõ khi công bố nội dung AI có thể gây nhầm lẫn về tính xác thực; gắn nhãn với nội dung mô phỏng người thật; Chính phủ quy định chi tiết (theo lời một luật sư trả lời báo, không phải toàn văn tôi đã đọc) — [Đại biểu Nhân dân](https://daibieunhandan.vn/trach-nhiem-minh-bach-trong-quan-ly-he-thong-tri-tue-nhan-tao-duoc-quy-dinh-nhu-the-nao-10412799.html)

### Inferences
- Rút gọn thành luật thiết kế cho Hubsell:
  1. Lời bot = lời Hubsell. Giá, khuyến mãi, chính sách hoàn tiền, cam kết chỉ đến từ dữ kiện có `fact_id`.
  2. Không có "chốt" nào bằng lời trong chat. Mọi thay đổi tiền phải đi qua luồng có ký hoặc nút xác nhận riêng.
  3. Gắn nhãn AI rõ ràng ở đầu mỗi hội thoại ("Trợ lý AI của Hubsell"), đặt tên không giả người. Vừa tuân thủ Điều 11 (⏳ cần xác nhận), vừa tránh ca Cursor.
  4. Miễn trừ không đủ: Air Canada cho thấy không thể đẩy trách nhiệm cho khách; MyCity thêm cảnh báo vẫn bị chỉ trích. Câu miễn trừ nên có nhưng không thay được kiểm soát.
  5. Bình luận công khai có rủi ro lan truyền cao hơn tin nhắn riêng (DPD, Chevrolet) nên phải thăng cấp sau cùng.
- Cỡ nhỏ không che được rủi ro: một sự cố với SaaS nhỏ có thể không lan rộng trên báo, nhưng khách là nhà bán trong cùng cộng đồng nên truyền miệng rất gần. (Suy luận, chưa có số.)

### Gaps
- ⏳ Không đọc được toàn văn phán quyết Moffatt: [decisions.civilresolutionbc.ca](https://decisions.civilresolutionbc.ca/crt/crtd/en/item/525448/index.do) và [CanLII](https://www.canlii.org/en/bc/bccrt/doc/2024/2024bccrt149/2024bccrt149.html) đều trả HTTP 403. Các chi tiết lấy từ bình luận của công ty luật. Con số 650,88 CAD tiền bồi thường riêng chỉ thấy qua kết quả tìm kiếm tóm tắt, chưa truy được nguồn đích danh; số tổng 812,02 CAD có nguồn DWW.
- ⏳ Không tiếp cận bài gốc của Bloomberg về Klarna (trả phí); dựa vào báo dẫn lại. Không tìm thấy số liệu Klarna năm 2026.
- ⏳ Không thấy vụ tương tự tại Việt Nam hoặc trong thị trường SaaS cho nhà bán.
- ⏳ Chưa đọc toàn văn Điều 11 và nghị định hướng dẫn; đặc biệt chưa rõ Hubsell là "nhà cung cấp" hay "bên triển khai" khi dùng Claude cho chatbot của mình. Cần tư vấn pháp lý.

## 8. Mô hình vận hành một người: chủ duyệt gì, giữ tải duyệt thấp thế nào

### Takeaway
Thời gian của chủ là tài nguyên hết sớm nhất và duyệt nhiều còn làm giảm chất lượng duyệt. Nên phân nhóm việc theo rủi ro: tự động theo luật, duyệt theo lô, luôn do người làm, đặt ngân sách duyệt mỗi ngày, và khi vượt thì hệ thống phải giảm tự động sang mẫu an toàn chứ không phải chất thêm vào hàng chờ.

### Cited Findings
- Claude Code: người dùng chấp nhận 93% lời nhắc; Anthropic thiết kế tầng: chỉ đọc chạy không cần xét, sửa trong dự án qua version control, còn lại qua classifier; chỉ hành động có hậu quả thật mới cần xét — [Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-auto-mode). ⏳ Một số nguồn thứ cấp ghi 97% theo công bố tháng 8, chưa đối chiếu được — [Devops.com](https://devops.com/anthropic-makes-claude-codes-auto-mode-the-default-betting-automation-beats-manual-review/)
- Meta: người duyệt chỉ là một lớp trong phòng thủ nhiều lớp vì có thể xác nhận mù — [Meta AI](https://ai.meta.com/blog/practical-ai-agent-security/)
- Kết quả phụ thuộc người duyệt và thiết kế quy trình; bắt buộc sửa làm tăng chấp nhận gợi ý sai — [arXiv 2509.08514](https://arxiv.org/abs/2509.08514)
- OWASP: người duyệt các việc tác động cao; có thể đặt ở extension hoặc ở hệ thống hạ nguồn — [OWASP LLM06](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- Anthropic khuyên định tuyến: mỗi loại đầu vào một đường xử lý, câu đơn giản qua mô hình rẻ — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Batch API giảm 50% cả vào lẫn ra, phù hợp việc không gấp như chạy eval hoặc soạn bài — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)

### Inferences
**Tải duyệt tính thử (10–20 giây/bản nháp, tự chọn):**

| Tin/ngày | Giờ duyệt nếu duyệt tất cả |
|---|---|
| 100 | 17–33 phút |
| 1.000 | 2,8–5,6 giờ |
| 10.000 | 28–56 giờ |

Nghĩa là "duyệt mọi bản nháp" chỉ khả thi tới cỡ 100–200 tin/ngày. Chi phí token ở 1.000 tin/ngày chỉ ~338 USD, còn công duyệt thì không còn khả thi: đây là ràng buộc thật của hệ thống.

**Ma trận đề xuất (phải chốt với anh Trung; các mức đều tự chọn). Theo `hubsell-marketing/CLAUDE.md`, đăng bài, gửi thư cho khách, chi tiền quảng cáo và sửa landing/app đang chạy hiện đều phải được anh duyệt; các dòng tự động dưới đây chỉ là đề xuất, chưa được phép áp dụng cho tới khi anh chốt:**

| Nhóm | Ví dụ | Xử lý | Kênh |
|---|---|---|---|
| Luật thuần, không LLM | Giờ mở cửa, link đăng ký, ack "đã nhận" | Mẫu tự gửi | Không cần duyệt |
| Tự gửi sau khi qua cổng | FAQ theo intent đã qua cổng, số do mã điền | Tự gửi, kiểm tra mẫu ngẫu nhiên hằng tuần | Báo cáo |
| Duyệt theo lô 2–3 lần/ngày | Câu trả lời tư vấn không gấp, bài đăng, kịch bản | Thẻ duyệt lô | Điện thoại |
| Chuyển ngay (không phải duyệt) | Lead nóng, khiếu nại, đòi gặp người | Người trả lời trực tiếp, AI gợi ý nháp | Đẩy và nhắc |
| Luôn người, AI không soạn cam kết | Hoàn tiền, giá ngoại lệ, pháp lý, truyền thông | Người | Đẩy và nhắc |
| Quảng cáo: trong trần | Giảm ngân sách, tắt theo luật đã có | Tự động kèm thông báo sau | Báo cáo |
| Quảng cáo: tăng chi | Tăng ngân sách, mở chiến dịch mới | Luôn duyệt từng cái, thấy số cũ → mới | Điện thoại + mã xác nhận |
| Đăng công khai nổi bật | Bài fanpage lớn, trả lời khủng hoảng | Luôn duyệt từng cái | Điện thoại |

Hạ chi bị coi là rủi ro thấp hơn tăng chi, tuy nhiên tắt nhầm chiến dịch cũng có giá, nên vẫn giới hạn mỗi ngày.

**Giữ tải thấp:**
- Đặt ngân sách duyệt, ví dụ ≤30 phút/ngày chia 3 phiên (tự chọn). Khi hàng chờ vượt thì tin rủi ro thấp nhận mẫu xác nhận và đợi phiên kế; không chất đống.
- Xếp theo tác động, không theo thời gian. Gom bản nháp giống nhau để quyết một lần.
- Mọi lần chủ sửa đều sinh dữ liệu: diff nào lặp lại thì sửa KB hoặc prompt, thay vì sửa tay mãi. Mục tiêu là tải giảm dần theo tuần.
- Mỗi thăng cấp intent phải giảm tải đo được; intent ít lượng thì không đáng mất công thăng cấp.

**Thẻ duyệt thân thiện điện thoại:**
- Một màn hình: tin khách nguyên văn, bản nháp, dữ kiện đã dùng, lý do cần duyệt, 3 nút: **Gửi / Từ chối và chuyển mình / Sửa**. Theo Beck, phải có lối từ chối không bắt sửa.
- Lý do duyệt do mã sinh; nội dung khách hiển thị như văn bản thô, không tự mở link, không xem trước, vì màn hình duyệt cũng là bề mặt tiêm lệnh.
- Mỗi nút gắn token dùng một lần, ràng buộc hash nội dung, có hạn (tự chọn: 4 giờ); hết hạn = không gửi, báo lại.
- Duyệt tăng chi quảng cáo cần thêm thao tác cố ý (nhập số tiền hoặc giữ nút), để tránh chạm nhầm và quán tính bấm.
- Không có "duyệt tất cả" cho nhóm có tiền hay công khai.
- Tái dùng kênh đã có: ghi nhớ dự án có app mobile với thông báo đẩy và HQ (⏳ theo ghi nhớ, chưa kiểm luồng cụ thể). Telegram/Zalo là phương án dự phòng thứ hai để tránh một điểm lỗi.

**Lộ trình đề xuất (giữ lộ trình cũ, thay cổng):**
1. Bóng: 100% nháp, không gửi; kèm bộ hồi quy và mục đo độc lập.
2. Bản nháp có duyệt: đo theo intent, lỗi S0/S1/S2, thời gian duyệt và tỉ lệ bắt lỗi cài.
3. Tự gửi theo intent an toàn đầu tiên khi đạt `p_max` riêng; có hạ cấp tự động.
4. Bình luận công khai sau tin riêng.
5. Quảng cáo làm cuối, như một hệ thống riêng: đề xuất → duyệt → thực thi trong trần, có diễn tập trước khi có tiền thật. Không gộp vào agent gặp khách trong mọi giai đoạn.

### Gaps
- ⏳ Không có số đo thực về thời gian duyệt trên điện thoại; 10–20 giây là tự chọn và phải đo ở giai đoạn 2.
- ⏳ Không tìm được nghiên cứu đo trực tiếp "duyệt theo lô so với duyệt từng cái" cho nội dung AI bán hàng.
- ⏳ Chưa kiểm Telegram/Zalo về khả năng nút tương tác và bảo mật thẻ duyệt (chưa đọc tài liệu các nền tảng này trong lượt nghiên cứu).
