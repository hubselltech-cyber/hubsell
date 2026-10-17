# Product Marketing Context — Hubsell

**Document version:** v1
**Last updated:** 2026-10-17

> Tệp nền mà MỌI skill marketing trong `hubsell-marketing/.claude/skills/` đọc trước khi làm.
> Nguồn: `docs/marketing/DINH-VI-LAI-HUBSELL-QUANG-CAO.md` (định vị anh Trung chốt 15/10/2026),
> bảng giá landing, README repo. Chỗ ghi **[CHƯA CÓ SỐ]** = chờ kết quả
> `so-lieu/SQL-SO-THAT-KHACH-HANG.sql`; chỗ ghi **[GIẢ THUYẾT]** = em suy luận, chưa kiểm với khách.

## Product Overview
**One-liner:** Trợ lý quảng cáo đa sàn cho nhà bán Shopee, Lazada, TikTok Shop.
**Slogan chính:** "Ba sàn, một trợ lý quảng cáo." · **Hook:** "Biết lỗ trước khi ví cháy."
**What it does:** Đọc chi tiêu quảng cáo, đơn hàng, phí sàn, giá vốn và hàng hoàn của từng gian để chỉ ra
chiến dịch nào đang lỗ thật, rồi nhắc nâng ROAS mục tiêu, hạ ngân sách hoặc dừng chiến dịch trước khi ví
cháy. Đơn, kho, đối soát, dòng tiền, hóa đơn vẫn đủ và là nền dữ liệu để trợ lý tính đúng.
**Product category:** Khách tìm bằng: "phần mềm quản lý bán hàng đa sàn", "tối ưu quảng cáo Shopee",
"GMV Max", "tính lãi lỗ shop". Hubsell đứng ở kệ mới "trợ lý quảng cáo đa sàn" — kệ chưa có ai ở VN
cho chủ shop nhỏ (tìm kiếm tiếng Việt 15/10 không ra sản phẩm nào).
**Product type:** SaaS B2B nhỏ (chủ shop tự quyết, tự trả), web app.hubsell.vn + app iOS/Android.
**Business model:** Thuê bao tháng 6 bậc theo trần đơn/tháng, mọi bậc đủ 100 % tính năng (kể cả trợ lý
quảng cáo 3 sàn); dùng thử Scale 14 ngày không cần thẻ; không phí khởi tạo, không cam kết năm.

| Gói | Giá/tháng | Trần đơn/tháng | Gian | Nhân viên |
|---|---|---|---|---|
| Starter | 99.000 ₫ | 300 | 3 | 3 |
| Growth | 199.000 ₫ | 1.000 | 5 | 5 |
| Pro (Bán chạy nhất) | 399.000 ₫ | 3.000 | 10 | 10 |
| Business | 699.000 ₫ | 10.000 | 20 | 20 |
| Scale | 1.199.000 ₫ | 20.000 | 40 | 40 |
| Enterprise | Báo giá | thỏa thuận | thỏa thuận | ∞ |

## Target Audience
**Target companies:** Chủ shop Việt tự chạy quảng cáo trên ít nhất 2 trong 3 sàn, chi khoảng 10–200 triệu
₫/tháng cho ads, không thuê agency. Người dùng phụ: người chạy ads thuê cho vài shop.
**Decision-makers:** Chủ shop (vừa là người dùng, vừa là người trả tiền). Shop lớn hơn: chủ + nhân viên
chạy ads.
**Primary use case:** Biết chiến dịch nào lãi/lỗ thật và được canh 24/7.
**Jobs to be done:**
- "Cho tôi biết tiền quảng cáo hôm qua đi đâu, lãi hay lỗ thật."
- "Canh giùm tôi ban đêm, đừng để sàn tự tiêu cháy ví."
- "Nói tôi nên chạy sản phẩm nào, đặt ROAS bao nhiêu thì không lỗ."
**Use cases:**
- Sáng mở app: xem chiến dịch nào dưới hòa vốn hôm qua, bấm nâng ROAS hoặc dừng.
- TikTok GMV Max: tự loại video cắn tiền không ra đơn.
- Trước khi bật chiến dịch mới: xem ROAS hòa vốn của sản phẩm.

## Personas
B2C-like (một người quyết). Bỏ bảng persona B2B.

## Problems & Pain Points
**Core problem:** Sàn báo ROAS trên GMV, chưa trừ phí sàn, giá vốn, hoàn, hủy → shop tưởng lãi mà lỗ.
**Why alternatives fall short:**
- Công cụ của sàn (Shopee Ads, TikTok GMV Max, Lazada Sponsored): mỗi sàn một màn, tối ưu theo GMV vì sàn
  thu tiền quảng cáo, không biết giá vốn và hàng hoàn.
- Phần mềm quản lý bán hàng (Sapo, Nhanh, Haravan, Upos, Salework): không có lớp quảng cáo; lãi lỗ tính thô.
- Epsilo: cho thương hiệu và agency, giá từ ~99 USD/tháng, chỉ tối ưu ROAS, không có dữ liệu đơn thật.
- Agency / chạy thuê: đắt, ăn %, không minh bạch.
**What it costs them:** Tiền ads cháy ban đêm; cuối tháng không thấy tiền dù ROAS đẹp. [CHƯA CÓ SỐ trung
bình — lấy từ shop nhà làm bằng chứng]
**Emotional tension:** Sợ mở ví buổi sáng; mệt vì bật tắt tay 3 màn; nghi ngờ "mình có đang làm không công
cho sàn".

## Competitive Landscape
**Direct:** Epsilo — giá và cách bán không dành cho chủ shop Việt tự chạy; chỉ ROAS.
**Secondary:** Công cụ quảng cáo của chính sàn — miễn phí, sẵn có, nhưng mỗi sàn một màn và không biết lãi thật.
**Secondary:** Sapo / Nhanh / Haravan / Upos / Salework — khách đã quen, nhưng không có trợ lý quảng cáo.
**Indirect:** Excel tự tính + nhân viên canh ads; thuê agency chạy hộ.

## Differentiation
**Key differentiators:**
- Biết LÃI THẬT từng chiến dịch (25+ loại phí sàn, giá vốn theo gian, hoàn, hủy) — sàn không làm, Epsilo không có.
- Ba sàn một màn, tiếng Việt, trợ lý AI hỏi bằng số của chính shop.
- Có app di động trên App Store và Google Play.
**How we do it differently:** Bắt buộc nối gian + nhập giá vốn trước (không bán bản chỉ-quảng-cáo) — chính
dữ liệu vận hành đó làm trợ lý nói đúng.
**Why that's better:** Quyết định bật/tắt dựa trên tiền thật về túi, không dựa trên GMV.
**Why customers choose us:** [CHƯA CÓ — cần hỏi 5–10 khách đang trả tiền]

## Objections
| Objection | Response |
|-----------|----------|
| "Sàn có sẵn công cụ quảng cáo miễn phí rồi." | Sàn báo ROAS trên GMV; Hubsell trừ phí, giá vốn, hoàn để ra lãi thật — thứ sàn không có lý do để nói. |
| "Đang dùng Sapo/Nhanh rồi, ngại chuyển." | [GIẢ THUYẾT] Cần câu trả lời thật; cân nhắc định vị "dùng song song được" nếu kỹ thuật cho phép. |
| "Cho app quyền vào shop có an toàn không?" | Ủy quyền chính thức qua Shopee ISV (duyệt 15/09/2026), TikTok Shop (duyệt 12/10/2026), Lazada ISV; trang /an-toan. Không dùng chữ "Đối tác chính thức". |
| "TikTok có tự bật/tắt chiến dịch không?" | Chưa — TikTok chưa cấp quyền Campaign. Hiện: loại video cắn tiền + báo lãi/lỗ ước tính. Nói thật, không hứa. |
| "Phải nhập giá vốn mệt." | Nhập một lần, trợ lý dùng mãi; không có giá vốn thì không ai tính được lãi. |

**Anti-persona:** Thương hiệu lớn có agency (sân Epsilo); shop không chạy ads (dùng được nhưng không phải
người mình kể chuyện cho).

## Switching Dynamics
**Push:** ROAS đẹp mà không thấy tiền; ví cháy ban đêm; 3 màn bật tắt tay.
**Pull:** Một màn thấy chiến dịch lỗ thật + nút xử lý; app di động báo sáng.
**Habit:** Quen màn quảng cáo của sàn; quen phần mềm quản lý đang dùng; Excel.
**Anxiety:** Lộ dữ liệu shop; mất công nối gian + nhập giá vốn; app mới sợ chết giữa chừng.

## Customer Language
**How they describe the problem:** (do đội soạn, CHƯA phải nguyên văn khách — thay bằng câu thật khi có)
- "ROAS 4 mà cuối tháng không thấy tiền đâu."
- "Sáng mở ví thấy cháy 3 triệu từ 2 giờ đêm."
- "Ba sàn ba màn, bật tắt tay mỏi."
- "Không biết nên chạy sản phẩm nào."
**How they describe us:** [CHƯA CÓ]
**Words to use:** lãi thật, lỗ, ví cháy, hòa vốn, canh, trợ lý, gian, sàn, đơn, giá vốn.
**Words to avoid:** "Đối tác chính thức" (đã chốt); "AI" tràn lan; "tự động tối ưu 3 sàn" (TikTok chưa
cho); thuật ngữ tiếng Anh khi có từ Việt.
**Glossary:**
| Term | Meaning |
|------|---------|
| Gian | Một shop trên một sàn |
| ROAS hòa vốn | ROAS tối thiểu để chiến dịch không lỗ sau phí, giá vốn, hoàn |
| GMV Max | Chế độ quảng cáo tự đấu giá của TikTok/Shopee |
| Diễn tập | Trợ lý đề xuất, khách duyệt, chưa tự làm thật |

## Brand Voice
| Attribute | Means | Doesn't mean | Example line |
|-----------|-------|--------------|--------------|
| Thẳng, số thật | Nói con số và việc cần làm | Phóng đại, hứa hẹn | "Bạn đang có 3 chiến dịch dưới hòa vốn." |
| Tiếng Việt thường | Câu ngắn, từ chủ shop dùng | Thuật ngữ, tiếng Anh | "Biết lỗ trước khi ví cháy." |
| Trung thực về giới hạn | Nói rõ sàn nào làm được gì | Giấu điểm yếu | "Bật/tắt chiến dịch TikTok đang chờ TikTok cấp quyền." |

**Tone by context:**
- Support: gần, cụ thể, có bước làm.
- Launch: nói một điều mới, kèm ảnh thật trong app.
- Errors: nói lỗi gì, bấm gì để sửa.
- Sales: nỗi đau → nhẹ nhõm; app chỉ là bằng chứng vài giây (luật video đã chốt).
- Social: ngắn, một nỗi đau một bài.
**Terms we own:** "Trợ lý quảng cáo đa sàn", "lãi thật".
**Never use (and why):** "Đối tác chính thức" (pháp lý); "tự động 100 %" (chế độ mặc định là diễn tập).

## Proof Points
**Metrics:** [CHƯA CÓ SỐ] — số shop, số chiến dịch dưới hòa vốn đã phát hiện, tiền ads đã canh.
**Customers:** Shop nhà (ANO và các gian của anh Trung) — dùng làm bằng chứng con số thật.
**Testimonials:** [CHƯA CÓ]
**Value themes:**
| Theme | Proof |
|-------|-------|
| Lãi thật, không phải ROAS | Sổ cái đơn, hòa vốn SP 3 sàn, cột Lãi/lỗ ước tính TikTok |
| Canh 24/7 | Luật hạ nấc 10 % + khóa 48 giờ, sổ hành động, cảnh báo ví (Shopee/Lazada) |
| Ba sàn một màn | /ads/{shopee,lazada,tiktok}, app iOS + Android |
| Tin cậy | Shopee ISV, TikTok Shop duyệt app, Lazada ISV, nhãn hiệu đã nộp, công ty TNHH |

## Goals
**Business goal:** Có khách trả tiền đều, tăng trưởng được đo hàng tuần. [Mục tiêu số cụ thể: CHỜ ANH CHỐT]
**Conversion action:** Đăng ký → nối gian → nhập giá vốn → nối quảng cáo → thấy "N chiến dịch dưới hòa vốn" (aha) → trả tiền.
**Current metrics:** [CHƯA CÓ SỐ — chạy SQL khối 1–6]

## Paid Ads (optional)
Hubsell chưa có ngân sách quảng cáo trả tiền cho chính mình. [CHỜ ANH] Nếu chạy: ngân sách tháng, CAC chấp
nhận được (gợi ý tính từ giá gói × số tháng khách ở lại — cần số giữ chân trước).
**Agent may:** đọc, so sánh, soạn, đề xuất.
**Agent may not (without approval):** đăng bài, chi tiền, gửi thư cho khách, sửa landing live.

## Learnings
*Decisions and tested lessons. Newest first.*
| Date | Learning | Evidence | Applies to | Status |
|------|----------|----------|------------|--------|
| 2026-10-15 | Định vị = "Trợ lý quảng cáo đa sàn"; không gắn "lãi thật" vào tên/slogan, lãi thật là tính năng số 1 trong thân trang | Anh Trung chốt | Mọi kênh | active |
| 2026-10-15 | Không đặt thẻ "Quảng cáo hôm nay" lên Tổng quan | Anh Trung chốt sau xem số thật | App, onboarding | active |
| 2026-10-12 | Video bán cảm xúc: nỗi đau → nhẹ nhõm, app chỉ là bằng chứng vài giây | Anh duyệt video Đơn hàng v3 | Video, ads | active |
| 2026-09-17 | Không làm bản chỉ-quảng-cáo; khách phải nối gian + giá vốn | Anh Trung chốt | Sản phẩm, offer | active |

## Changelog
*Newest first.*
- v1 (2026-10-17) — Bản đầu, tự soạn từ tài liệu định vị 15/10, bảng giá landing, README; các mục số liệu và lời khách thật còn trống.
