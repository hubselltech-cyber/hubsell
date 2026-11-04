# Giao quyền chạy quảng cáo cho AI agent, người chỉ duyệt ngân sách: Meta trước, TikTok sau (trạng thái 03/11/2026)

Quy ước đọc ghi chú này:
- **[Chính thức]**: em đã mở trực tiếp trang của Meta / TikTok. **[Thứ cấp]**: bài của bên thứ ba dẫn lại. **[Vendor]**: bên bán công cụ, có lợi ích thương mại. **[Trích tìm kiếm]**: chỉ thấy qua kết quả tìm kiếm, chưa đọc cả trang.
- ⏳ = chưa kiểm được ở nguồn gốc, hoặc đã cũ, phải kiểm lại trước khi dựa vào.
- **Giới hạn nguồn quan trọng:** các trang Meta Business Help Center (facebook.com/business/help/...) chỉ trả về tiêu đề khi em đọc bằng công cụ, nên mọi điều "Help Center nói" trong ghi chú này đều là dẫn lại qua nguồn thứ cấp và mang ⏳. Tài liệu lập trình viên (developers.facebook.com) thì đọc được trực tiếp.
- **Nguồn chưa mở cả trang:** các nguồn sau em chỉ thấy qua bản tóm tắt kết quả tìm kiếm, dù dòng trích dẫn có thể không gắn nhãn [Trích tìm kiếm]: Digital Position, Growwithsakib, AuditSocials, Rewarx, Cinerads, Admove, Adamigo, Madgicx, AdLibrary, bmdpat, Marketing Dive, Haus, WARC, SaveMyLeads, Evertry, PyPI / GitHub SDK, rtiktokads. Với SaveMyLeads và Evertry, bản tóm tắt không chỉ rõ ý nào của trang nào nên việc gán nguồn có thể lệch; phải mở trang kiểm trước khi trích lại.
- Mọi việc đều chỉ đọc: không đăng nhập, không gửi biểu mẫu, không đụng tài khoản nào.

## Quyền Meta Marketing API: permission, Standard / Advanced, App Review, Business Verification, System User, vai trò giới hạn

### Takeaway
App chỉ quản lý tài khoản quảng cáo của chính công ty không cần App Review cho `ads_read` / `ads_management`: Standard access là đủ. Nhưng hạn chế thật không nằm ở scope của token mà ở **task gán cho System User trên tài khoản quảng cáo**: `ADVERTISE + ANALYZE` không có quyền cấp tài khoản, còn `MANAGE` thì có toàn quyền kể cả lập hóa đơn.

### Cited Findings
- Standard access: app Business được tự động duyệt mọi permission và feature của loại app đó, truy cập không giới hạn số tài khoản quảng cáo, nhưng một số lệnh gọi có thể không dùng được. Advanced access phải qua App Review theo từng permission; muốn giữ cần ít nhất 500 lệnh Marketing API thành công trong 15 ngày và tỷ lệ lỗi dưới 15% trên 500 lệnh gần nhất — [Authorization, Chính thức](https://developers.facebook.com/docs/marketing-api/overview/authorization/)
- "Standard access" với `ads_read` và `ads_management` là đủ nếu chỉ quản lý tài khoản của mình; quản lý tài khoản người khác mới cần Advanced — [Authorization, Chính thức](https://developers.facebook.com/docs/marketing-api/overview/authorization/)
- Marketing API còn một trục riêng là Access Tier: **Limited Access** (mặc định, bị giới hạn tốc độ nặng theo từng tài khoản, ghi là dành cho phát triển chứ không dành cho "production apps running for live advertisers") và **Full Access** (giới hạn nhẹ, ngưỡng 500 lệnh, lên hạng qua App Review) — [Authorization, Chính thức](https://developers.facebook.com/docs/marketing-api/overview/authorization/)
- Số System User: Limited Access 1 system user + 1 admin system user; Full Access 10 system user + 1 admin system user — [Authorization, Chính thức](https://developers.facebook.com/docs/marketing-api/overview/authorization/)
- Business Verification: cần khi app truy cập dữ liệu nhạy cảm; trang không mô tả thêm — [Authorization, Chính thức](https://developers.facebook.com/docs/marketing-api/overview/authorization/)
- Ba bộ task trên tài khoản quảng cáo: `ANALYZE` chỉ xem báo cáo; `ADVERTISE + ANALYZE` xem, sửa, tạo quảng cáo bằng nguồn tiền đã gắn, nhưng "Không thể đặt bất kỳ nội dung nào ở cấp độ tài khoản quảng cáo, chẳng hạn như nguồn tiền"; `MANAGE + ADVERTISE + ANALYZE` quản lý mọi mặt gồm chiến dịch, báo cáo, lập hóa đơn và quyền. Trang không nhắc trực tiếp giới hạn chi tiêu, cũng không nhắc `DRAFT` — [Business Asset Management › Ad Accounts, Chính thức](https://developers.facebook.com/docs/marketing-api/business-asset-management/guides/ad-accounts/)
- Có hai loại system user (admin và thường); hành động gắn với người thật phải dùng user token, system user token không gắn được với hành động của một người thật nếu không dùng Facebook Login — [System Users, Chính thức](https://developers.facebook.com/docs/marketing-api/system-users/)
- Ads CLI của Meta yêu cầu system user token với các scope `business_management`, `ads_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `read_insights`; system user vai trò Admin hoặc Employee; chỉ chạy macOS / Linux; phải thêm system user vào từng tài khoản quảng cáo "with access to manage the account" — [Ads CLI Get started, Chính thức](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-cli/setup/get-started.md)
- Ads MCP server: scope tối thiểu `ads_mcp_management` cộng `ads_read` hoặc `ads_management`. Với token system user, "Only **Employee**-role system user access tokens are supported", token vai trò Admin không vào được MCP server — [Ads MCP Get started, Chính thức](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started.md)
- App Review cho `ads_mcp_management` là tùy chọn, chỉ cần khi quản lý dữ liệu thay cho doanh nghiệp khác (agency, đối tác) — [Blog Meta for Developers 16/07/2026, Chính thức](https://developers.facebook.com/blog/post/2026/07/16/meta-ads-mcp-server/)

### Inferences
- Đường ngắn nhất cho Hubsell: app của chính công ty, Standard access, một system user vai trò **Employee**, gán task `ADVERTISE + ANALYZE` trên đúng một tài khoản quảng cáo. Không xin Advanced, không cần App Review miễn là không quản lý tài khoản của khách.
- Scope `ads_management` trên token không phân biệt được "sửa quảng cáo" với "sửa giới hạn tài khoản"; ranh giới đó nằm ở task. Vì vậy cấu hình đúng là điều kiện an toàn, không phải tên scope.
- Điểm cần soi: tài liệu CLI ghi "access to manage the account". Nếu làm theo máy móc và cấp `MANAGE`, mọi rào ở mục dưới mất tác dụng. Chữ này cần được đọc là "quản lý chiến dịch", và phải thử thực tế xem CLI có chạy được với `ADVERTISE + ANALYZE` không.

### Gaps
- ⏳ Một app chạy thật chỉ trên tài khoản nhà có bắt buộc lên Full Access không: tài liệu nói Limited dành cho phát triển nhưng không nói rõ ca này. Phải xem App Dashboard.
- ⏳ `business_management` Standard hay Advanced cho ca tài khoản nhà: trang Authorization không nói. Cũng chưa rõ agent có thực sự cần scope này không ngoài yêu cầu của CLI.
- ⏳ Trang System Users bản em đọc không có thời hạn token, nên không kết luận được token hết hạn hay vĩnh viễn; xem hướng dẫn "Create System Users".
- ⏳ Không tìm thấy điều kiện Business Verification cụ thể cho ca chỉ dùng tài khoản nhà.

## Trần chi do NỀN TẢNG ép trên Meta: spend_cap, trần chiến dịch, ngân sách ngày / trọn đời, mức vượt, và token có đổi được trần không

### Takeaway
**Có, API đổi được `spend_cap`**, kể cả đặt lại số đã chi về 0 và xóa hẳn trần. Nên trần tài khoản chỉ là rào cứng nếu token của agent **không có quyền cấp tài khoản**. Mức vượt ngân sách ngày có mâu thuẫn trong tài liệu chính Meta (25 % so với 75 %), nên phải tính theo ca xấu nhất, và không có nguồn nào cam đoan trần tài khoản dừng khít tuyệt đối.

### Cited Findings
**Trần tài khoản (`spend_cap`)**
- "The maximum amount that can be spent by this Ad Account. When the amount is reached, all delivery stops"; giá trị `0` là không có trần — [Ad Account reference, Chính thức](https://developers.facebook.com/docs/marketing-api/reference/ad-account/)
- Đặt bằng POST tới `/act_{ad_account_id}`. `spend_cap_action=reset` đưa `amount_spent` về 0; `spend_cap_action=delete` xóa trần. "Setting a new spend cap only applies to spend AFTER the time at which you set it" — [Ad Account reference, Chính thức](https://developers.facebook.com/docs/marketing-api/reference/ad-account/)
- Mục `spend_cap` không nêu permission cụ thể, bảng lỗi chỉ có "Permissions error" (200) chung — [Ad Account reference, Chính thức](https://developers.facebook.com/docs/marketing-api/reference/ad-account/)
- **Mâu thuẫn đơn vị trong chính trang này:** khi đọc ghi đơn vị cơ bản ("cents" với USD), khi cập nhật ghi đơn vị chuẩn (23.50 với USD) — [Ad Account reference, Chính thức](https://developers.facebook.com/docs/marketing-api/reference/ad-account/)
- ⏳ Cần quyền admin tài khoản để đổi, đặt lại hay gỡ trần; đổi hoặc gỡ mất khoảng 15 phút mới áp dụng; là trần trọn đời chứ không tự về 0 mỗi tháng (một số tài khoản có tùy chọn tự đặt lại ngày 1); không đặt được thấp hơn số đã chi; **tài khoản trả trước (available funds) không đặt được trần, số dư chính là trần** — [AdAdvisor dẫn các trang Help 141820733085330, 203321833042958, 764293677236889, Thứ cấp/Vendor](https://adadvisor.ai/blog/meta-ads-account-spending-limit)
- Khi chạm trần, mọi chiến dịch ngừng chi nhưng vẫn hiện trạng thái đang phân phối — [Jon Loomer, Thứ cấp, cập nhật 01/03/2025](https://www.jonloomer.com/campaign-spending-limits-account-spending-limits-daily-spending-limits/)
- Ngoài ra Meta có thể tự áp **Daily Spending Limit** lên tài khoản mới hoặc tài khoản có vi phạm, số không công bố, phải suy từ đà chi; xác minh doanh nghiệp có thể giúp nâng nhanh hơn — [Jon Loomer, Thứ cấp](https://www.jonloomer.com/campaign-spending-limits-account-spending-limits-daily-spending-limits/)

**Trần chiến dịch**
- `spend_cap` chiến dịch: số nguyên theo đơn vị con, "with a minimum value of $100 USD (or approximate local equivalent)"; đặt `922337203685478` để gỡ trần — [Campaign reference, Chính thức](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/)
- Ngân sách đặt ở chiến dịch hoặc nhóm quảng cáo, không đặt cả hai — [Campaign reference, Chính thức](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/)

**Ngân sách ngày, trọn đời, và mức vượt**
- **Mâu thuẫn nguồn:** tài liệu lập trình viên ghi "On days with better opportunities, up to 25% more than your daily budget may be spent" (10 USD thành tối đa 12,50 USD) — [Budgets, Chính thức](https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets.md). Trong khi đó ⏳ Help Center "About daily budgets" được dẫn là "we may spend up to 75% over your daily budget", và trong một tuần không quá 7 lần ngân sách ngày — [Jon Loomer quote, Thứ cấp](https://pubcast.jonloomer.com/videos/meta-can-spend-up-to-75-over-your-daily-budget/); AdAdvisor xác nhận lại ở thời điểm 10/2026, tuần kết thúc nửa đêm thứ Bảy — [AdAdvisor, Thứ cấp/Vendor](https://adadvisor.ai/blog/meta-ads-account-spending-limit). Trang 25 % có thể là tài liệu chưa cập nhật; em không đọc được trang Help gốc nên chưa khẳng định.
- Thực tế vượt 75 % được một agency mô tả là rất hiếm, hay gặp hơn là 10–20 % — [Digital Position, Thứ cấp](https://digitalposition.com/resources/blog/ppc/why-youre-overspending-on-meta-ads/)
- Ngân sách trọn đời: "You won't be charged more than your lifetime budget for your ad set's results" trừ khi đổi thiết lập phân phối; từng ngày vẫn dao động mạnh — [Budgets, Chính thức](https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets.md)
- ⏳ Giới hạn 4 lần đổi ngân sách một nhóm quảng cáo mỗi giờ là giới hạn tốc độ, không phải trần tiền — [DTCskills dẫn trang rate limiting của Meta, Thứ cấp/Vendor](https://dtcskills.com/blog/meta-mcp-without-getting-banned)

**Rule của Ads MCP server (ra 16/07/2026)**
- ⏳ Admin toàn quyền portfolio đặt rule ở Business Suite › Settings › Integrations › Ads MCP server: theo từng hành động, từng tài khoản hoặc catalog, Allowed / Blocked; có thể chặn hẳn "Edit or set budget" hoặc chặn "Budgets set above this amount" (ví dụ 1.000 USD). Không có công tắc chung cho cả portfolio; không thấy tùy chọn nghĩa là doanh nghiệp chưa có tính năng — [DTCskills, cập nhật 01/11/2026, Thứ cấp/Vendor](https://dtcskills.com/blog/meta-mcp-without-getting-banned); [AdsUploader, cập nhật 30/09/2026, Vendor](https://adsuploader.com/blog/meta-ads-mcp)
- ⏳ Bulk API `edit_budget` có 3 kiểu kích hoạt: theo %, theo số tuyệt đối, theo mức tối đa, ở trạng thái "limited availability" (22/09/2026) — [DTCskills, Thứ cấp/Vendor](https://dtcskills.com/blog/meta-mcp-without-getting-banned)
- **Phạm vi:** rule "enforced by the MCP server", thiết lập CLI phải tự có giới hạn riêng; không nguồn nào xác nhận rule ràng buộc lệnh Marketing API gọi trực tiếp — [DTCskills](https://dtcskills.com/blog/meta-mcp-without-getting-banned); [Scalekit 08/10/2026, Vendor](https://www.scalekit.com/blog/meta-ads-mcp-vs-api) ("nothing stops a create call from setting status to ACTIVE" trên đường API). Em đọc blog chính thức 16/07 thì bài không nhắc rule, và tài liệu MCP được cho là chưa có trang về rule — [ContextBolt, cập nhật 31/10/2026, Thứ cấp](https://contextbolt.com/blog/meta-ads-mcp/)
- Thiết lập mặc định của tool ghi: "Write tools create entities in a paused state; your AI client asks for confirmation before activation"; `ads_activate_entity` "starts spending budget". Danh sách 31 tool không có tool nào cho giới hạn chi tiêu tài khoản — [MCP tools: ad creation and management, Chính thức](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-tools-ad-creation-and-management.md)

### Inferences
Bảng phân tầng dưới đây là suy luận của em từ các nguồn trên, xếp theo độ độc lập với agent:

| Tầng | Ai ép | Agent có tự gỡ được không | Độ tin |
|---|---|---|---|
| Số dư trả trước / hạn mức nguồn tiền | Nền tảng + ngân hàng | Không, tiền không có sẵn | Cao về nguyên lý, ⏳ cần kiểm phương thức ở VN |
| `spend_cap` tài khoản, token chỉ `ADVERTISE + ANALYZE` | Nền tảng | Không, nếu tài liệu task đúng với `spend_cap` (⏳ phải thử) | Cao |
| Rule MCP "Budgets set above" | Máy chủ MCP của Meta | Không qua MCP; chưa rõ qua API trực tiếp | Trung bình |
| Trần chiến dịch, ngân sách trọn đời | Nền tảng | **Có**, token `ADVERTISE` tự sửa được | Thấp với lỗi / agent bị thao túng |
| Trạng thái paused + AI client hỏi xác nhận | Máy khách AI | **Có**, chạy không giao diện là bỏ qua | Không tính là rào |
| Luật trong mã Hubsell | Mã của mình | Có, nếu mã lỗi hay agent bị thao túng | Lớp thứ yếu |

- **"Duyệt ngân sách" nên hiểu theo nghĩa đen:** anh Trung tự tay nạp tiền hoặc tự nâng `spend_cap` bằng tài khoản admin cá nhân. Thiệt hại tối đa do lỗi hay thao túng khi đó bằng phần còn lại của trần, không phụ thuộc mã Hubsell. Đây là kết luận chính của ghi chú.
- Trần chiến dịch tối thiểu tương đương 100 USD có thể lớn hơn ngân sách một đợt thử nhỏ, nên không dựa được vào nó khi thử nhỏ; dùng ngân sách trọn đời thay thế, nhưng đó vẫn là rào agent sửa được.
- Công thức ca xấu khi dùng ngân sách ngày D: một ngày có thể tới 1,75 × D, một tuần tới 7 × D. Vì trần tài khoản không biết D, nên quyết định bằng tổng số chịu mất được chứ không bằng D.
- Agent `ADVERTISE` vẫn đốt hết phần trần còn lại rất nhanh, nên trần chỉ chặn tổng tiền, không chặn tiêu sai. Nên cấp trần theo đợt ngắn, nhỏ thay vì một trần lớn dài hạn.

### Gaps
- ⏳ **Chưa có tài liệu nào của Meta nói thẳng rằng token `ADVERTISE` bị từ chối khi POST `spend_cap`.** Suy từ câu "không đặt được gì ở cấp tài khoản" + Help Center đòi admin. Cách chốt: anh tự thử một lần trên tài khoản rỗng, kỳ vọng lỗi 200.
- ⏳ Mức vượt trần tài khoản: không nguồn nào cho số hoặc cam đoan dừng khít; báo cáo chậm có thể gây vượt nhỏ nhưng em không có nguồn để nêu số.
- ⏳ Đơn vị `spend_cap` với VND (mâu thuẫn đọc / ghi ở trên) cần thử trước khi tin.
- ⏳ Rule MCP có áp lên Marketing API trực tiếp không, và mặc định là gì: chưa có tài liệu gốc. Không nguồn nào nói Việt Nam có hay không có tính năng này.
- ⏳ Tài khoản trả trước khi hết tiền có thể âm nhẹ không: không tìm thấy nguồn.

## Kiểm toán và công tắc dừng khẩn: activity log, automated rules, cách dừng tức thì

### Takeaway
Có nhật ký thay đổi đọc được qua API và MCP, có rule tự dừng nhưng trễ cỡ vài phút. Chưa thấy lệnh "dừng cả tài khoản" một phát trong tài liệu: dừng nhanh nhất là đưa từng chiến dịch về `PAUSED`, còn cắt quyền agent là thu hồi token hoặc gỡ system user.

### Cited Findings
- Edge `activities` của tài khoản: "The activities of this ad account", trang tham chiếu không nêu thêm chi tiết — [Ad Account reference, Chính thức](https://developers.facebook.com/docs/marketing-api/reference/ad-account/)
- MCP có tool nhật ký: "Retrieve activity log entries for an ad account, optionally scoped by object, time window, event category, or user", ứng với lịch sử chiến dịch ở Ads Manager; trang không nêu thời gian lưu — [MCP activity logs, Chính thức](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-tools-activity-logs.md)
- Đặt chiến dịch `PAUSED` thì "its active child objects will be paused and have an effective status `CAMPAIGN_PAUSED`" — [Campaign reference, Chính thức](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/)
- Trigger Based Rule: metadata đổi thì thường chấm trong vài giây; insights đổi thì trong vài phút, p99 khoảng 7,5 phút. Hành động: `PAUSE`, `PING_ENDPOINT`, `NOTIFICATION`. `spent` dùng được làm milestone với mức tối thiểu 1000 (cents). Rule này chỉ có qua API, không có trên Ads Manager — [Trigger-based rules, Chính thức](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-rules/guides/trigger-based-rules.md)
- `STATS_CHANGE` chỉ chạy khi điều kiện đổi từ sai sang đúng, không chạy lại khi điều kiện vẫn đúng — [Trigger-based rules, Chính thức](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-rules/guides/trigger-based-rules.md)
- Hướng dẫn "Create System Users" có phần thu hồi access token — [System Users, Chính thức](https://developers.facebook.com/docs/marketing-api/system-users/)

### Inferences
- Thứ tự dừng khẩn (em suy ra, chưa thử): (1) người bấm trên Ads Manager hoặc script dùng token **riêng, không phải token agent** đưa mọi chiến dịch về `PAUSED`; (2) gỡ system user khỏi tài khoản hoặc thu hồi token để agent không bật lại; (3) hạ `spend_cap` sát số đã chi làm lớp chốt, nhưng mất khoảng 15 phút (⏳).
- Rule `METADATA_UPDATE` + `PING_ENDPOINT` có thể báo về Hubsell mỗi khi có đối tượng bị sửa, làm kênh giám sát không qua agent. ⏳ Cần kiểm trường ngân sách có nằm trong danh sách trigger không.
- Rule dựa trên insights trễ tới cỡ 7,5 phút nên là lớp báo động, không thay trần. Với rule do token nào tạo, nếu chính agent xóa được thì rule cũng không độc lập; nên để tài khoản admin tạo và kiểm định kỳ.
- System user token khó quy cho người thật, nên nhật ký nên phân biệt theo tên system user riêng của agent và đối chiếu với sổ quyết định của Hubsell.

### Gaps
- ⏳ Thời gian lưu và trường chi tiết của activity log: tài liệu đã đọc không nêu. Log có ghi đổi ngân sách kèm số cũ / mới không cần kiểm thật.
- ⏳ Không tìm thấy endpoint dừng toàn bộ tài khoản một lệnh. Token `ADVERTISE` có xóa được rule của admin không: chưa rõ.

## Đo lường bắt buộc: Pixel, Conversions API, sự kiện tối thiểu, quy định chia sẻ dữ liệu, giai đoạn học và căn cứ tính ngân sách thử

### Takeaway
Pixel + Conversions API không cần App Review. Ngưỡng tài liệu vẫn là khoảng **50 sự kiện tối ưu trong 7 ngày kể từ lần sửa đáng kể gần nhất**. Hubsell hiện chưa có Pixel và UTM nên chưa có dữ liệu để tính chi phí mỗi chuyển đổi, do đó **chưa thể nêu số ngân sách thử có căn cứ**; chỉ có công thức.

### Cited Findings
- CAPI cần Pixel ID (dùng chung ID cho sự kiện trình duyệt và máy chủ), Meta Business Suite, access token lấy từ Events Manager (khuyến nghị) hoặc app + system user; cả hai cách đều không cần App Review hay xin permission; bấm Manage ở Events Manager sẽ tự tạo system user cho CAPI — [CAPI Get started, Chính thức](https://developers.facebook.com/documentation/ads-commerce/conversions-api/get-started.md)
- "Website events shared using the Conversions API require the client_user_agent, action_source, and event_source_url parameters"; `event_id` có trong tham số sự kiện. Băm bắt buộc: `em`, `ph`, `fn`, `ln`, `ge`, `db`, `ct`, `st`, `zp`, `country`; băm khuyến nghị: `external_id`; không băm: `client_ip_address`, `client_user_agent`, `fbc`, `fbp`... — [CAPI Parameters, Chính thức](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/)
- ⏳ Một nhóm quảng cáo thường cần khoảng 50 sự kiện tối ưu trong 7 ngày kể từ lần sửa đáng kể để ra khỏi học. Sửa đáng kể gồm đổi nhắm chọn, vị trí, sự kiện tối ưu, chiến lược giá thầu; thêm quảng cáo mới, tạm dừng trên 7 ngày, đổi lớn ngân sách hoặc giá thầu cũng tính — [PPC Land 23/09/2026 dẫn Help Centre, Thứ cấp](https://ppc.land/learning-phase/). Không tìm thấy thay đổi ngưỡng nào trong 2026.
- ⏳ Không đạt thì nhóm bị đánh dấu Learning Limited; tuyên bố "thời gian học kéo dài sau Andromeda" là của blog, chưa được Meta xác nhận — [Growwithsakib, Thứ cấp](https://growwithsakib.com/meta-ads-learning-phase/)
- Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 thông qua 26/06/2025, hiệu lực 01/01/2026: đồng ý phải tự nguyện, rõ ràng, theo từng mục đích, im lặng không phải đồng ý; chuyển dữ liệu xuyên biên giới có nghĩa vụ đánh giá tác động nộp A05 trong 60 ngày; phạt vi phạm chuyển xuyên biên giới tới 5 % doanh thu năm trước — [Allen & Gledhill](https://www.allenandgledhill.com/vn/publication/articles/31075/upcoming-changes-to-vietnam-s-personal-data-protection-regime); [Tilleke & Gibbins](https://tilleke.com/insights/vietnams-new-personal-data-protection-law-a-closer-look) (⏳ Trích tìm kiếm, bài từ 2025, chưa đọc văn bản gốc)

### Inferences
Công thức, không phải đề xuất số, căn cứ là ngưỡng 50 sự kiện của Meta:
- `Ngân sách một nhóm để đủ tín hiệu ≈ 50 × CPA dự kiến của sự kiện tối ưu, trong 7 ngày`. CPA dự kiến Hubsell chưa có; phải đo trước.
- Gói từ 99.000 đ/tháng khiến 50 đơn trả phí mỗi tuần khó là điểm khởi đầu, nên tối ưu về sự kiện trên phễu (đăng ký) có nhiều khả năng là bước đi thực tế, đổi lại phải theo dõi riêng tỷ lệ từ đăng ký lên trả phí để tránh đốt tiền vào đăng ký rẻ không chất lượng.
- Thứ tự cần có trước khi agent được tiêu tiền: Pixel, CAPI cho sự kiện đăng ký + mua gói cùng `event_id` để loại trùng, UTM ghi vào tài khoản khi đăng ký. Không có các phần này thì agent tối ưu theo số báo cáo của chính nền tảng.
- Agent hay sửa làm reset học liên tục, nên cần luật "không sửa đáng kể trong khoảng học" ở phía mã, ngay cả khi nền tảng không ép.
- Trang có 1 người theo dõi: không tìm thấy tài liệu cấm hay trần nào theo số follower; rào thực tế có thể là Daily Spending Limit Meta tự áp cho tài khoản mới (mục trên).

### Gaps
- ⏳ Tài liệu chính của Meta về "sự kiện tối thiểu" và "aggregated event" mới nhất chưa đọc được. Điều khoản Business Tools Terms chưa kiểm.
- ⏳ Hash email gửi qua CAPI có được coi là dữ liệu cá nhân theo luật 91/2025 không, và Nghị định hướng dẫn đã ban hành thế nào: chưa có nguồn. Cần luật sư xem trước khi gửi dữ liệu khách lên CAPI.
- ⏳ Ngân sách tối thiểu bằng VND của Meta: chưa có nguồn gốc.
- Không tìm được dữ liệu CPA đăng ký / trả phí cho SaaS bán hàng tại Việt Nam đủ tin cậy.

## AI tự động của Meta (Advantage+, tự động hoàn toàn 2026) và Ads MCP chính thức: có dùng được ở Việt Nam không

### Takeaway
Meta **đã có** kết nối chính thức cho agent: Ads MCP server và Ads CLI. Không tài liệu nào em đọc nêu giới hạn quốc gia, cũng không xác nhận Việt Nam có. Công cụ quảng cáo "tự động hoàn toàn từ một URL" vẫn chưa có căn cứ là đã phát hành rộng rãi.

### Cited Findings
- Máy chủ do Meta vận hành tại `https://mcp.facebook.com/ads`, "works with any MCP-compatible AI agent"; nhóm tool: báo cáo, tạo và quản lý quảng cáo, catalog, signal và dataset, trợ giúp, A/B test + lift study, activity log — [MCP overview, Chính thức](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-overview)
- Không bắt buộc sở hữu Meta app; hỗ trợ OAuth, user token, system user token; có hướng dẫn cho Claude Code, ChatGPT và gọi HTTP trực tiếp — [MCP Get started, Chính thức](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started.md)
- Blog 16/07/2026: cung cấp MCP server cho mọi nhà phát triển có app trên Meta, quyền vào công cụ tài khoản quảng cáo **triển khai dần**; nhà phát triển có thể hỏi đầu mối hỗ trợ xem được dùng tool nào — [Blog Meta for Developers, Chính thức](https://developers.facebook.com/blog/post/2026/07/16/meta-ads-mcp-server/)
- ⏳ Ra mắt open beta 29/04/2026; tới 30/09/2026 vẫn là open beta, chưa công bố GA; miễn phí trong beta; trang của Meta có tiêu đề "Quản lý quảng cáo bằng tác nhân AI" nhưng em không đọc được thân bài — [AdsUploader, Vendor](https://adsuploader.com/blog/meta-ads-mcp); [GoMarble, Vendor](https://www.gomarble.ai/ai-tools/meta-ads-ai-connectors/); [Help 1456422242197840](https://www.facebook.com/business/help/1456422242197840)
- ⏳ Meta nói kết nối qua máy chủ của họ "unlikely" khiến tài khoản bị khóa chỉ vì dùng nó; khóa thường do vi phạm tiêu chuẩn quảng cáo — [DTCskills dẫn Help, Thứ cấp/Vendor](https://dtcskills.com/blog/meta-mcp-without-getting-banned)
- Quảng cáo tự động hoàn toàn: mục tiêu cuối 2026 xuất phát từ tin WSJ 06/2025 — [Marketing Dive, Thứ cấp](https://www.marketingdive.com/news/meta-plans-to-enable-fully-ai-automated-ads-by-2026/749613/). Em không tìm được thông báo chính thức của Meta về việc đã phát hành hoặc danh sách nước.
- Advertising Week 06/10/2026: Meta bắt đầu thử trợ lý doanh nghiệp AI trong Ads Manager; lập kế hoạch, tạo, sửa (gồm đổi ngân sách) sẽ "pronto"; "Las vistas previas, aprobaciones y controles te permiten decidir qué delegar"; không xuất bản gì nếu chưa có phê duyệt rõ ràng; không nêu nước — [Meta Newsroom LATAM, Chính thức](https://about.fb.com/ltam/news/2026/10/advertising-week-new-york-2026-nuevas-capacidades-de-ia-para-guiar-campanas-y-llegar-a-los-clientes/)
- Thí nghiệm độc lập về hiệu quả: 640 thử nghiệm tăng trưởng thực, Advantage+ thắng thủ công 42 % số ca, iROAS thấp hơn 12 %, nhưng nhỉnh ở nhóm non-DTC; báo cáo 07/2025 và chưa tính cập nhật Andromeda. Đây là số của bên bán dịch vụ đo lường — [Haus, Vendor đo lường](https://www.haus.io/blog/the-meta-report-lessons-from-640-haus-incrementality-experiments); [WARC](https://www.warc.com/content/feed/metas-advantage-drives-strong-short-term-incrementality-but-weakens-in-the-longer-term/en-GB/10833)

### Inferences
- Lựa chọn thực tế cho Hubsell có 3 đường: (a) MCP cho agent, có rule của Meta nhưng là beta; (b) Marketing API trực tiếp, kiểm soát nhiều hơn, tự gánh rào; (c) CLI chỉ macOS / Linux, rule MCP được cho là không áp. Với mục tiêu "nền tảng ép chứ không phải mã mình", đường (a) có thêm một rào, nhưng trần tài khoản vẫn là rào gốc cho mọi đường.
- Ngay cả sản phẩm agent của chính Meta cũng giữ người duyệt khâu xuất bản, nên mô hình "không người duyệt từng quảng cáo" là mức tự động cao hơn những gì Meta công khai đang thử.
- Việt Nam: cách kiểm rẻ nhất là anh tự xem Business Suite có mục Ads MCP server không.

### Gaps
- ⏳ Không có nguồn nào khẳng định hoặc phủ định Việt Nam dùng được MCP, rule MCP hay trợ lý AI mới.
- ⏳ Số tool: tài liệu ghi 31 tool riêng nhóm quản lý, bên thứ ba ghi 29 tổng, nên đừng trích con số 29.

## Chính sách quảng cáo Meta ảnh hưởng tới Hubsell: tuyên bố phần mềm, tuyên bố thiếu căn cứ, nhãn AI, thuộc tính cá nhân

### Takeaway
Rủi ro lớn nhất cho một SaaS bán cho nhà bán hàng là **câu chữ ngụ ý đặc điểm của người xem** ("bạn đang lỗ...") và **hứa kết quả không có căn cứ**. Yêu cầu nhãn AI đang có các nguồn nói ngược nhau, chưa kiểm được ở trang gốc.

### Cited Findings
- Meta không cho quảng cáo khẳng định hoặc ngụ ý đặc điểm cá nhân của người xem vì có thể bị coi là xâm phạm, gây khó chịu hoặc thiếu chính xác; ví dụ gồm cách gọi "you" gắn với một đặc điểm — [Personal attributes, Trích tìm kiếm trang chính thức, ⏳ trang 404 khi em mở](https://transparency.meta.com/policies/ad-standards/objectionable-content/personal-attributes)
- ⏳ Việc thực thi được cho là siết năm 2026 bằng nhận diện theo ý định, kể cả ngụ ý gián tiếp; đây là báo cáo vendor, không phải công bố của Meta — [AuditSocials, Vendor](https://www.auditsocials.com/blog/meta-ad-misleading-claims-personal-attributes-prohibited-content-policy-2026)
- ⏳ Tuyên bố thiếu căn cứ về kết quả / số liệu là nhóm từ chối lớn, chủ yếu được nêu cho y tế, tài chính, thực phẩm chức năng — [AuditSocials, Vendor](https://www.auditsocials.com/blog/meta-ad-policy-updates-2026-guide)
- **Mâu thuẫn về nhãn AI:** một nguồn nói quảng cáo có nội dung AI phải có nhãn "AI-generated" — [Rewarx, Vendor](https://www.rewarx.com/blogs/meta-ai-disclosure-advertising-changes); nguồn khác nói Meta cho phép creative AI, quy định chủ yếu về nội dung tổng hợp / thao túng, có công tắc khai báo và nhãn "AI info" — [Cinerads, Vendor](https://www.cinerads.com/blog/ai-ugc-facebook-ad-policy). Em không đọc được bản gốc từ Meta.
- ⏳ Trang hạn chế quảng cáo của Meta liệt kê hoạt động bất thường là một lý do hạn chế tạm thời; lưu lượng API bất thường có thể bị cắt quota; tài khoản bị vô hiệu do vi phạm, sau 6 tháng không còn khôi phục được — [DTCskills dẫn Meta, Thứ cấp/Vendor](https://dtcskills.com/blog/meta-mcp-without-getting-banned)

### Inferences
- Câu kiểu "Bạn đang lỗ vì quảng cáo?" có thể chạm luật thuộc tính cá nhân nếu tình trạng tài chính thuộc danh sách (⏳ em nhớ là có, nhưng chưa đọc lại được). Nên đổi sang nói về sản phẩm hoặc nhóm chung ("Nhà bán có thể thấy..."), và cho agent một bộ kiểm câu chữ trước khi tạo creative.
- Mọi số kết quả trong quảng cáo (ví dụ giảm chi phí / đơn) nên lấy từ ca thật có lưu bằng chứng; agent không được tự sinh số.
- Vi phạm lặp lại do agent tạo creative là rủi ro đe dọa cả tài khoản, nghiêm trọng hơn vượt ngân sách, nên khâu duyệt creative cần tính riêng chứ không chỉ duyệt tiền.

### Gaps
- Không tìm thấy chính sách riêng về SaaS / phần mềm; ⏳ cần đọc trực tiếp Ad Standards mục "Unacceptable Business Practices" và misleading claims.
- ⏳ Luật Quảng cáo Việt Nam (bản sửa đổi) với quảng cáo so sánh, tuyên bố "số 1", nhãn AI: chưa nghiên cứu trong phạm vi này.

## TikTok Marketing API: trần ngân sách, quyền, giới hạn cấp tài khoản

### Takeaway
TikTok có trần cấp tài khoản rõ ràng hơn Meta: **Budget Manager** (ngày / tháng / một lần), chỉ Admin hoặc Finance Manager đặt được. Em chưa tìm thấy API tương ứng để biết token có đổi được không, và mô tả vai trò Operator lại có "manage finances" nên chưa khẳng định rào. App hiện tại của Hubsell đã có quyền Campaign nhưng phục vụ GMV Max, khác với quảng cáo thu hút đăng ký SaaS.

### Cited Findings
- Budget Manager đặt trần cho từng tài khoản theo tháng, ngày, một lần, hoặc Unlimited; chạm trần thì "the ads on that ad account will pause and stop consuming money"; số trần không tính ad credit; có lịch sử thay đổi xem và xuất được; "Only members with Admin, or Finance Manager with or without admin roles" — [TikTok Help: Budget Manager, Chính thức](https://ads.tiktok.com/help/article/how-to-use-budget-manager)
- Ngân sách ngày: "We can guarantee we won't spend more than 125% of your highest daily budget for that day"; ví dụ 50 USD/ngày hiện "no more than $350 per calendar week" — [TikTok Help: daily budget, Chính thức](https://ads.tiktok.com/help/article/how-to-set-up-a-daily-budget-in-tiktok-ads-manager)
- ⏳ Tối thiểu 50 USD cấp chiến dịch, 20 USD cấp nhóm; đổi được số nhưng không đổi được loại ngân sách khi đã chạy — [Budget FAQ](https://ads.tiktok.com/resources/help/article/budget-and-bidding-faq); [About budgets](https://ads.tiktok.com/resources/help/article/budget) (Trích tìm kiếm trang chính thức)
- Vai trò tài khoản trong Business Center: Admin "Manage ad account finances, settings, and permissions..."; Operator "Manage finances for ad accounts, create and edit ad campaigns..."; Analyst chỉ xem — [TikTok Help, Chính thức](https://ads.tiktok.com/help/article/request-access-to-ad-accounts-in-business-center). **Mâu thuẫn cần làm rõ:** Operator có "finances" trong khi Budget Manager chỉ cho Admin / Finance Manager.
- API: `/open_api/v1.3/campaign/update/` đổi được tên, ngân sách, loại ngân sách; có `/advertiser/update/` — [SDK TikTok trên PyPI](https://pypi.org/project/tiktok-business-api-sdk-official/1.0.0). `/advertiser/balance/get/` đọc số dư và ngân sách — [SDK BCApi, GitHub, tài liệu khoảng 2 năm tuổi ⏳](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/BCApi.md). Một gói bên thứ ba nhắc giới hạn số lần đổi ngân sách trong ngày — [rtiktokads, ⏳](https://cran.uni-muenster.de/web/packages/rtiktokads/refman/rtiktokads.html). Em không tìm thấy `/advertiser/budget/update/`; trang Permission scope chỉ trả tiêu đề khi em đọc — [Permission scope](https://business-api.tiktok.com/portal/docs/permission-scope/v1.3)

**Hiện trạng Hubsell (từ memory nội bộ, chưa kiểm lại hôm nay ⏳)** — `C:\Users\trung\.claude\projects\D--Claude-Code-Hubsell\memory\hubsell-tiktok-gmv-max-api.md`, `reference-tiktok-rate-limits.md`:
- App Marketing API `7686282112950747157`, trạng thái Approved, hạng Basic: 10 QPS / 600 QPM / 864.000 QPD; riêng `/gmv_max/report/get/` 8 / 240 / 80.000; quá hạn trả 40100. Không có trần số TKQC ủy quyền. Không phải hạn mức TikTok Shop trong `reference-tiktok-rate-limits.md`: đó là API khác, không dùng số đó cho Marketing API.
- Quyền Read campaigns + Create and update campaigns được duyệt 19/09/2026, GMV Max Session duyệt 24/09/2026. Token cấp trước khi duyệt phải ủy quyền lại.
- Lệnh sửa GMV Max từng bị 40002 do lệch Business Center (22/22 chiến dịch gian nhà, TikTok trả lời ticket #4455484). `/bc/get/` trả 40001 vì app chưa có scope BC. App chưa từng ghi ngân sách trên chiến dịch thật.
- TKQC đang nối là "TKQC CÁ NHÂN - NGUYỄN TRUNG HIẾU" gắn với gian and.not.or, không phải tài khoản marketing riêng của công ty. Memory ghi Claude Code chặn Claude tự bắn lệnh ghi lên TKQC thật.
- Quyết định 23/09 "không làm nút sửa / tạo chiến dịch" là cho **tài khoản của khách**, không tự động chi phối việc Hubsell chạy tài khoản nhà; nhưng nên hỏi lại anh chứ đừng ngầm hiểu.

### Inferences
- Nên tạo **TKQC riêng cho marketing Hubsell**, tách khỏi TKQC đang gắn gian bán hàng, để trần và quyền không dính tới GMV Max của gian.
- Mô hình tương tự Meta: anh đặt Budget Manager bằng tài khoản Admin; agent chỉ được quyền tạo / sửa chiến dịch, và token không thuộc Admin / Finance Manager. Do mô tả Operator có "finances", đây là điểm phải thử chứ không suy luận được.
- GMV Max gắn với TikTok Shop nên kinh nghiệm app GMV Max chuyển được về xác thực, giới hạn tốc độ, ghi sổ, không chuyển được về đo lường SaaS; muốn chạy web conversion thì cần TikTok Pixel / Events API, phần này chưa có và chưa nghiên cứu sâu.
- Thứ tự Meta trước, TikTok sau hợp lý vì tài liệu Meta có đủ trần cấp tài khoản qua API, còn TikTok còn thiếu xác nhận ở API.

### Gaps
- ⏳ Budget Manager có API đọc / ghi không, và token OAuth của Operator có đổi được không: chưa có nguồn. Đây là câu quan trọng nhất của phần TikTok; có thể hỏi TikTok qua ticket và lưu lại câu trả lời.
- ⏳ Độ vượt trần Budget Manager và độ trễ dừng: Help không nêu.
- Nhật ký thay đổi TikTok qua API và cách dừng tức thì (`/campaign/status/update/` trong memory): chưa kiểm tài liệu gốc.

## Việt Nam: thanh toán, thuế (VAT, thuế nhà thầu), hạn chế tài khoản

### Takeaway
Có thay đổi mới và quan trọng: **từ 12/10/2026, doanh nghiệp xác thực mã số thuế với Meta thì Meta không tính VAT, và doanh nghiệp tự kê khai thuế nhà thầu.** Em chỉ thấy qua bài tư vấn, chưa thấy nguyên văn thông báo Meta hay đọc văn bản gốc. Đây là thông tin dữ kiện, không phải tư vấn thuế; cần kế toán hoặc cơ quan thuế xác nhận.

### Cited Findings
- ⏳ Từ 12/10/2026, nhà quảng cáo Việt Nam có thể nhập mã số thuế, tên doanh nghiệp ở "Lập hóa đơn và thanh toán" kèm giấy đăng ký kinh doanh; tự nguyện; xác thực xong Meta không tính VAT; doanh nghiệp tự khai, nộp VAT nhà thầu 10 %; không tải giấy thì Meta vẫn tính VAT như cũ — [Kế toán Ultra, Thứ cấp](https://ketoanultra.com/tin-tuc/thue-nha-thau-facebook-tu-12-10-2026/); [NGV, Thứ cấp](https://ngv.vn/thue-nha-thau-quang-cao-facebook-12-10-2026/)
- ⏳ Căn cứ được nêu: Luật Quản lý thuế 108/2025/QH15, Thông tư 89/2026/TT-BTC (hiệu lực 01/07/2026, thay Thông tư 80/2021), Luật Thuế GTGT 48/2024/QH15, Nghị định 181/2025, Nghị định 320/2025 + Thông tư 20/2026 cho TNDN nhà thầu; Ultra nêu thêm Nghị định 252/2026 — [NGV](https://ngv.vn/thue-nha-thau-quang-cao-facebook-12-10-2026/); [Ultra](https://ketoanultra.com/tin-tuc/thue-nha-thau-facebook-tu-12-10-2026/). Em chưa đọc văn bản gốc; một lượt tìm kiếm riêng không ra Thông tư 89/2026.
- ⏳ Tỷ lệ: VAT 10 % áp dụng từ 01/07/2025 (trước đó 5 %); TNDN 5 %; khai mẫu 01/NTNN theo lần thanh toán hoặc theo tháng; VAT đã nộp được khấu trừ — [NGV](https://ngv.vn/thue-nha-thau-quang-cao-facebook-12-10-2026/). **Mâu thuẫn:** nhiều bài cũ / khác ghi 5 % GTGT + 5 % TNDN — [Varecom](https://varecom.vn/thue-nha-thau-quang-cao-tiktok-facebook-google/). **Chưa rõ:** Ultra nói thông báo của Meta không đề cập TNDN và khuyến nghị hỏi bằng văn bản cơ quan thuế.
- ⏳ TikTok Ads: receipt không phải hóa đơn GTGT hợp lệ (dẫn Công văn 3115/TCT-CS 19/07/2024); từ 01/07/2025 nền tảng đăng ký thuế tại VN tự khấu trừ (Nghị định 117/2025) nhưng trang không chắc chắn nhất quán; mua qua đại lý trong nước đăng ký kinh doanh thì có hóa đơn GTGT — [Varecom, Thứ cấp](https://varecom.vn/thue-nha-thau-quang-cao-tiktok-facebook-google/). Không thấy TikTok có cơ chế tương tự Meta 12/10/2026. Một kết quả tìm kiếm còn dẫn công văn của một cục thuế địa phương trả lời rằng doanh nghiệp không phải khấu trừ với phí trả cho TikTok, nhưng em không xác định được trang nào và chưa thấy công văn, nên không dùng được làm căn cứ.
- ⏳ Phương thức thanh toán Meta ở Việt Nam được nói gồm MoMo, VNPAY, có thể trả trước hoặc trả sau tùy phương thức — [SaveMyLeads, Thứ cấp](https://savemyleads.com/blog/other/how-to-pay-meta-ads); [Evertry, Vendor](https://evertry.co/blog/how-to-pay-for-facebook-ads-in-vietnam-when-your-card-doesnt-work/). Một số ngân hàng VN hạn chế giao dịch ngoại tệ, có thể làm thanh toán thất bại — [Evertry, Vendor](https://evertry.co/blog/how-to-pay-for-facebook-ads-in-vietnam-when-your-card-doesnt-work/)

### Inferences
- Trả trước, nếu dùng được ở Việt Nam, khớp đúng ý "tôi chỉ duyệt ngân sách": mỗi lần nạp là một lần duyệt, và là rào không phụ thuộc quyền token. Đánh đổi: tài khoản trả trước không dùng được `spend_cap` nên mất lớp trần riêng và có nguy cơ ngừng phân phối khi hết tiền.
- Nếu khai mã số thuế cho Meta thì phát sinh việc kê khai định kỳ theo lần thanh toán; nạp nhỏ nhiều lần có thể tăng khối lượng kê khai. Việc nên hỏi kế toán trước khi chọn. Tên hóa đơn nên đúng CÔNG TY TNHH CÔNG NGHỆ HUBSELL + MST, theo quy tắc nội bộ đã có.
- Agent nên ghi số tiền thuế ước tính riêng khỏi số ngân sách duyệt, vì chi phí thực của công ty có thể cao hơn số nền tảng báo.

### Gaps
- ⏳ Nguyên văn thông báo của Meta và các văn bản 108/2025, 89/2026, 252/2026: chưa kiểm. Không nên trích dẫn cho kế toán như đã xác minh.
- ⏳ Không tìm thấy nguồn đủ tin về hạn chế tài khoản riêng cho Việt Nam (ngoài Daily Spending Limit chung cho tài khoản mới). Không nói là không có, chỉ là không tìm thấy.

## Bằng chứng thực tế về agent quảng cáo tự chủ: sự cố, vượt chi, rào được khuyến nghị

### Takeaway
**Em không tìm thấy sự cố có tài liệu nào về agent tự chủ vượt chi qua Meta MCP.** Bằng chứng mạnh nhất lại là chiều ngược: chính hệ thống của Meta từng làm vượt trần năm 2023, nên rào nền tảng cũng không tuyệt đối. Phần lớn "kinh nghiệm" hiện có là từ vendor bán công cụ.

### Cited Findings
- Tháng 4/2023: lỗi hệ thống Meta; ước tính vượt chi tổng hàng chục triệu USD trên Facebook và Audience Network; một nhà quảng cáo có trần 50.000 USD/ngày bị chi 60.000 USD lúc 9 giờ sáng mà không có chuyển đổi; bài dẫn "failure of cost-capping controls"; không rõ có được hoàn tiền không — [AdExchanger, báo ngành](https://www.adexchanger.com/online-advertising/this-is-what-caused-metas-overspending-glitch). Bài khác ghi có chiến dịch vượt hơn gấp đôi trần ngày — [AdExchanger, Trích tìm kiếm](https://www.adexchanger.com/mobile/more-than-a-bug-major-system-error-causes-heavy-overspending-on-meta-platforms/)
- ⏳ Báo cáo tài khoản bị hạn chế khi dùng công cụ AI không chính thức đầu 2026: Jon Loomer gom tháng 3, Digiday đăng tháng 4; được mô tả là giai thoại, Meta không xác nhận liên hệ — [DTCskills, Thứ cấp/Vendor](https://dtcskills.com/blog/meta-mcp-without-getting-banned). Một lời kể Reddit tương tự, chưa kiểm chứng — [Adamigo, Vendor](https://www.adamigo.ai/blog/meta-ads-mcp-facebook-ads-automation-ai-guardrails-ad-account)
- [Vendor] Rủi ro được nêu: CPA tăng có thể chỉ là độ trễ dữ liệu, agent tăng ngân sách vào đó sẽ tiêu lớn trước khi ai kịp thấy — [Admove](https://www.admove.ai/blog/meta-ai-agents-for-ads). Câu "MCP không có budget cap" của Adamigo xem ra đã lỗi thời so với rule 16/07/2026 — [Adamigo](https://www.adamigo.ai/blog/meta-ads-mcp-facebook-ads-automation-ai-guardrails-ad-account)
- [Vendor] Rào được khuyến nghị: trần tổng chi, CPA theo kinh tế doanh nghiệp, kiểm chất lượng lead, duyệt thay đổi lớn, theo dõi 3 / 7 / 14 ngày, nhật ký thay đổi, luật lùi lại; tác giả ghi đây là thực hành vận hành, không phải cài đặt của Meta — [AIChatAssist](https://blog.aichatassist.com/meta-ai-budget-automation-guardrails/). Mỗi lần đổi ngân sách tối đa khoảng 20 % — [Madgicx](https://madgicx.com/answers/how-to-automate-facebook-ads); đổi trên 20 % khi đang học bị coi là sửa đáng kể — [AdLibrary](https://adlibrary.com/posts/meta-advertising-ai-agents). Con số 20 % là kinh nghiệm vendor, em không thấy tài liệu Meta xác nhận.
- Lưu ý nhiễu: câu chuyện "Meta 60T token" là chi phí token AI nội bộ, không phải tiền quảng cáo; đừng dùng làm bằng chứng — [bmdpat](https://bmdpat.com/blog/meta-60t-token-burn-ai-agent-budget-control-2026)

### Inferences
- Không có sự cố được ghi lại **không** có nghĩa là an toàn: sản phẩm mới ra từ 04/2026, và ít ai công khai lỗi của mình. Đó là thiếu bằng chứng theo cả hai chiều.
- Sự cố 2023 cho thấy cần giữ một khoản không nối vào nguồn tiền quảng cáo: trần nền tảng giảm rủi ro chứ không loại bỏ, và không chắc được hoàn tiền nếu nền tảng lỗi.
- Đề xuất rào theo thứ tự (suy luận của em, không có số ngân sách): (1) người giữ duy nhất quyền `MANAGE` + nguồn tiền; (2) agent chỉ `ADVERTISE + ANALYZE`; (3) trần theo đợt ngắn; (4) báo động từ nguồn độc lập với agent; (5) nhật ký quyết định đối chiếu với activity log; (6) kịch bản dừng khẩn dùng token khác, diễn tập trước khi agent được tiêu tiền thật; (7) duyệt creative riêng vì rủi ro chính sách có thể mất cả tài khoản. Diễn tập trước khi bật thật cũng khớp thực hành "Diễn tập → Tự loại thật" Hubsell đã dùng ở GMV Max.
- Prompt injection: agent đọc dữ liệu ngoài (bình luận, trang đối thủ, Ad Library) có thể bị thao túng. Không có nguồn cụ thể cho quảng cáo, nên chỉ coi là giả định thiết kế: mọi chỉ thị trong dữ liệu đọc được không được đổi hành vi tiền; đó là lý do rào phải nằm ngoài agent.

### Gaps
- Chưa tìm thấy nghiên cứu độc lập, có số liệu, về kết quả agent tự chủ chạy tiền thật. Không có bài học sau sự cố (postmortem) nào.
- Chưa kiểm được bài gốc của Jon Loomer và Digiday về các ca bị hạn chế tài khoản.
