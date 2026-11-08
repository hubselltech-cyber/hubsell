# Đối tác người dạy bán hàng — danh sách + tin mời (07/11/2026)

> **⚠️ Anh phản hồi 07/11 (sau bản đầu):** "Đa số là những người bán tool, anh từng thử với Lê Duy Hiệp rồi, không
> ăn thua." → Danh sách mục 3 **chưa dùng được nguyên trạng**. Người dạy quảng cáo đa số kiếm tiền bằng chính tool /
> dịch vụ chạy ads của họ, giới thiệu Hubsell là tự cạnh tranh với mình. Tiêu chí mới ở mục 8. Chưa rõ vì sao ca Lê
> Duy Hiệp không thành: anh kể "họ chỉ nói là xem xét kiểu xã giao thôi" → không nhận, không từ chối = lời mời không có
> gì đủ nặng với họ (hoa hồng nhỏ, lại đụng hàng của họ).

> Anh Trung 07/11: "Thôi cứ tìm những người dạy về bán hàng để hợp tác bán phần mềm trước đã em."
> Đây là việc số 2 trong `PHUONG-AN-PHU-NHANH-2026-11-06.md`. Luật hoa hồng đã chốt 17/10: **10 % trọn đời**
> trên mọi lượt khách trả tiền, không tăng % tháng đầu (`.agents/product-marketing.md`, mục Learnings).

## 0. Cách em tìm, độ tin của số

- Quét YouTube bằng 15 từ khóa (bán hàng TikTok Shop / Shopee / Lazada, quảng cáo Shopee, GMV Max, vận hành
  shop…), lọc kênh Việt có trên 2.000 người đăng ký, rồi đọc mô tả kênh và ngày đăng video gần nhất.
- Quét TikTok bằng 12 từ khóa + tra tên đã thấy trong Thư viện quảng cáo Meta (báo cáo fanpage 06/11: OneTik,
  TUKI…). Đọc tiểu sử từng tài khoản.
- **Số người theo dõi đọc ngày 07/11/2026**, từ trang công khai. **Chưa kiểm** số học viên thật, chất lượng khóa
  học, uy tín. Số điện thoại và email lấy từ mô tả công khai của chính kênh đó.
- Tìm Google bằng công cụ tìm kiếm cho kết quả thị trường Việt rất mỏng nên không dựa vào. Chưa quét Facebook
  group và Zalo (cần đăng nhập, để lượt sau nếu cần).

## 1. Kiểm luồng tiền trước khi mời (đã kiểm trong mã)

Hoa hồng chạy thật với tiền thật: cổng thanh toán (`services/gateway-checkout.ts`) và mua trong app
(`services/apple-iap.ts`) đều đi qua `recordPackagePayment()`, hàm này gọi `creditReferralCommission()` cho mọi
lượt trả lớn hơn 0 đ. Đối tác có trang **Kiếm Tiền Cùng Hubsell** (`/affiliate`) xem mã `HUBSELL<số>`, link
giới thiệu, ví, lệnh rút (anh duyệt tay). Mã sai khi đăng ký thì bỏ qua im lặng, không chặn khách.
→ Kênh này **đo được nguồn khách ngay** (cột `referredById`), không phải chờ ô "Biết Hubsell từ đâu?".

**Chưa kiểm trên prod:** chưa có lượt rút tiền thật nào; màn duyệt rút ở /admin có hay chưa thì em chưa mở lại.

## 2. Phản biện trước khi gửi

1. **Đừng gửi cả 30 cùng lúc.** Anh làm một mình, mỗi đối tác nhận lời sẽ cần một cuộc gọi, một buổi hướng dẫn,
   trả lời học viên. Gửi **nhóm A (12 tên) tuần này**, đếm số trả lời sau 7 ngày, rồi mới gửi nhóm B.
2. **10 % là ít với người lớn.** Học viên trả gói Pro 399.000 đ thì đối tác được 39.900 đ/tháng. Người có 500 nghìn
   người theo dõi không đổi lịch vì số này. Họ nhận vì **học viên được lợi** (công cụ cho bài giảng "lãi thật",
   khác bài giảng của người khác) và vì **có nội dung chung** (một buổi live soi lãi thật chiến dịch). Tin mời
   viết theo hướng đó; tiền hoa hồng là phần phụ, nhấn "trọn đời". Em **không** đề xuất đổi mức 10 % (anh đã chốt).
3. **Nhóm vừa và nhỏ trả lời nhiều hơn.** Kênh 3–25 nghìn người theo dõi, dạy đúng quảng cáo Shopee / GMV Max,
   học viên đang chi tiền ads → đúng chân dung khách của Hubsell. Một đối tác nhỏ chạy thật đáng hơn mười tên lớn
   đã xem rồi im. Tên lớn để sau khi có 1–2 ca đối tác nhỏ chạy ra khách trả tiền (có số để kể).
4. **Người chạy ads thuê / agency cũng là đối tác.** Họ quản lý nhiều gian cho nhiều chủ shop. Hubsell giúp họ báo
   lãi thật cho khách của họ → họ tự dùng, rồi tự giới thiệu. Đã có trong chân dung phụ ("người chạy ads thuê").
5. **Ba tên có thể là đối thủ, phải xem trước khi mời** (mục 4): Trương Hải Đăng (có video "Tool Auto Tối Ưu Ads
   GMV MAX Tự Động"), GMV MAX VỚI HẠ (giới thiệu tool phân tích GMV Max riêng), Sapo/MISA (bán phần mềm). Mời người
   đang bán tool giống mình là tự đưa bài cho họ học.
6. **Thuế:** trả hoa hồng cho cá nhân không có hợp đồng lao động, mỗi lần từ 2 triệu đ trở lên thường phải khấu trừ
   10 % thuế thu nhập cá nhân `[cần kế toán xác nhận]`. Hiện số nhỏ, chưa phải lo; ghi lại để khi có đối tác lớn.

## 3. Danh sách

Độ hợp: **Cao** = dạy quảng cáo Shopee/TikTok, GMV Max, vận hành sàn (học viên đang chi ads). **Vừa** = dạy bán
hàng sàn chung. **Thấp** = dạy làm video / livestream (học viên chưa tới bước ads).
"Video gần nhất" đọc 07/11/2026.

### Nhóm A — gửi tuần này (12)

| # | Tên | Ở đâu (người theo dõi) | Dạy gì | Video gần nhất | Độ hợp | Liên hệ công khai |
|---|---|---|---|---|---|---|
| A1 | Đàm Văn Tuấn | YouTube @damvantuanvn (23,1 N) | Quảng cáo TikTok, GMV Max PRO | 1 tháng | Cao | SĐT/Zalo 0982 777 853 · Tuantodaho@gmail.com · damvantuan.com |
| A2 | Lê Duy Hiệp | YouTube @leduyhiep.marketing (21,4 N) | TikTok Ads, Facebook Ads, AI chạy quảng cáo | 1 ngày | Cao | Chưa thấy trong mô tả → nhắn qua kênh/Facebook |
| A3 | Nguyễn Trung Kiên — TUKI GROUP | YouTube @nguyentrungkien3469 (18,1 N) · TikTok @kienchopbi "Kiên S ở TUKI GROUP" (268,9 N) | Bán hàng Shopee; TUKI còn có agency vận hành TMĐT và Tuki Uni (TikTok 41,5 N) | 1 tháng | Cao | SĐT 0868 388 862 (mô tả YouTube) · atplink.com/kienshopee |
| A4 | Ông Hoàng GMV Max | TikTok @onghoang_gmvmax (6,1 N) | Kiến thức, kinh nghiệm quảng cáo GMV Max (COMME ASIA) | — | Cao | Nhắn TikTok |
| A5 | Phạm Quốc — Shopee | YouTube @phamquoc2001 (3 N) | Nâng ROAS quảng cáo Shopee; nhận chạy QC Shopee thuê | 13 ngày | Cao (người chạy ads thuê) | Zalo 0823 364 430 |
| A6 | Lập Nghiệp Shopee — Nguyễn Thành Tài | YouTube @lapnghiepshopee (3,5 N) | Vận hành, quản lý gian Shopee (~5 năm) | 1 ngày | Cao | Nhắn qua kênh |
| A7 | Vận hành sàn MDECOM | YouTube @vanhanhsanmdecom (≈400) | Vận hành sàn, B2C | 3 ngày | Cao (nhỏ nhưng đúng nghề) | Nhắn qua kênh |
| A8 | Hiếu Suro | YouTube @hieusuro (17,3 N) | Khóa "Bí quyết Quảng cáo Shopee", "X2–X5 doanh số" (bán trên KTcity) | 11 tháng | Cao, nhưng kênh ít ra video | Nhắn qua kênh / KTcity |
| A9 | Marketing Thực Chiến | YouTube @digitalmarketing-c6w (39,1 N) | TikTok Shop, mời KOC | 5 ngày | Vừa–Cao | Chưa thấy → nhắn qua kênh |
| A10 | Dragon Apex | YouTube @dragonapex-marketing (5,5 N) | Kinh doanh nhiều sản phẩm, marketing bán hàng | 13 ngày | Vừa | 038 282 9669 · dragonapex.contact@gmail.com |
| A11 | OneTik Academy / OneTik Agency | TikTok @onetikacademy1 (1,9 N), @onetikagency (1,1 N) | Học viện TMĐT, coaching 1:1; có chạy quảng cáo Meta (thấy trong Thư viện QC 06/11) | — | Cao | Nhắn TikTok |
| A12 | NUU EDU — Đào Tạo Bán Hàng Online | YouTube @NuuEduVN (4 N) | Thao tác gian, trưng bày sản phẩm | 3 tháng | Vừa | Nhắn qua kênh |

### Nhóm B — gửi sau khi nhóm A có ca chạy (11)

| # | Tên | Ở đâu (người theo dõi) | Dạy gì | Độ hợp | Liên hệ công khai |
|---|---|---|---|---|---|
| B1 | Nguyễn Thế Hoàng — Uptrend Agency | TikTok @thehoangwork (587,3 N) | Tự giới thiệu "Đối tác Hạng Kim Cương TikTok For Business", vận hành trọn gói TikTok/Shopee cho nhãn hàng, xưởng | Cao (agency lớn) | Zalo 0969 377 445 · uptrendagency.vn — tài khoản TikTok của anh **đang follow** người này |
| B2 | Big Man Marketing — Phan Đức Nho | YouTube @bigmanmarketing (160 N) | Marketing kinh doanh; các khóa Shopee công nghiệp, quảng cáo Shopee | Vừa | metub.net · Facebook trong mô tả |
| B3 | Học Viện Marketing Online (hvmo) | YouTube @HocVienMarketingOnlineAI (151 N) | AI + marketing online | Vừa | 0878 779 111 · hocvienmarketingonlinee@gmail.com · hocvienmarketingonline.com |
| B4 | Duy Muối | YouTube @duymuoi8320 (82,8 N) | Làm nội dung TikTok | Thấp–Vừa | 097 696 6969 · mbs.makeviral.pro |
| B5 | Tuki Uni | TikTok @tukiunisv (41,5 N) | TMĐT cho sinh viên (học viên thành người vận hành shop thuê) | Vừa | beacons.ai/tukiuni — gộp chung khi nói chuyện với A3 |
| B6 | Viện Thương mại điện tử | TikTok @vienthuongmaidientu (22,2 N) | "Viện quản lý và phát triển TMĐT" | Vừa | pinkday.vn |
| B7 | TOPMAX — Học viện TMĐT | YouTube @topmax-hocvienthuongmaidientu (2,3 N) | Đào tạo TMĐT | Vừa | Nhắn qua kênh |
| B8 | Trung tâm Kế toán Lê Ánh | ketoanleanh.edu.vn | Khóa **kế toán sàn TMĐT** (Shopee, TikTok Shop, Lazada) | Cao về thông điệp: học viên là người tính lãi cho shop | Qua website |
| B9 | VAReCOM | Thấy trong Thư viện QC Meta 06/11 (từ khóa "đa sàn") | Kế toán TMĐT | Cao về thông điệp | Tra trang chính thức trước khi nhắn |
| B10 | Học Livestream Cùng MiTa | TikTok @mitaminhtan (120,1 N) | Livestream bán hàng | Thấp | Nhắn TikTok |
| B11 | Dạy Làm Video Marketing | TikTok @daylamvideomarketing (182 N) | Quay, dựng video bán hàng | Thấp | Nhắn TikTok |

Kế toán TMĐT (B8, B9) đáng thử sớm hơn thứ tự trong bảng: "lãi thật sau phí sàn, giá vốn, hoàn" đúng là thứ họ dạy,
và học viên của họ ngồi ngay cạnh chủ shop. Em để ở nhóm B chỉ vì cần soạn tin mời riêng (mẫu 4 bên dưới).

### Nhóm C — không mời (hoặc xem trước) (6)

| Tên | Lý do |
|---|---|
| Trương Hải Đăng / Hadaplus (TikTok @truonghaidang_official 1 Tr; YouTube @truonghaidangofficial 74,8 N, haidang.academy) | Có video 2 ngày trước "Tool Auto Tối Ưu Ads GMV MAX Tự Động TikTok Shop" → có thể đang bán tool cùng loại. **Anh xem video đó trước**; nếu chỉ là giới thiệu tool người khác thì đưa lên nhóm B. Chưa chắc hai tài khoản là cùng một người (cùng tên, cùng mảng). |
| GMV MAX VỚI HẠ (TikTok @marketingwithha 7,9 N) | Tiểu sử dẫn sang "Tool phân tích camp GMV Max" của @Thợ Kéo ROI GMV → đối thủ nhỏ, theo dõi. |
| Kênh chính thức của sàn: Học Viện TikTok Shop (YouTube 16 N), Shopee Uni (89 N), Học viện Lazada (17,2 N), SellwithTikTokShop VN | Không nhận hoa hồng; đường vào là Cửa hàng ứng dụng (TikTok đã công khai 06/11). |
| Sapo, MISA eShop | Bán phần mềm cạnh tranh. |
| Trần Anh Tuấn (TikTok 616 N) | Dạy quản trị doanh nghiệp chung, không phải sàn. |
| Kiều Linh Xshop, các tài khoản "Shopee"/"GMV Max" vài trăm người theo dõi | Là shop bán hàng hoặc tài khoản rỗng, không dạy. |

## 4. Đề nghị gửi đối tác (không đổi sản phẩm)

Những thứ có sẵn, không phải sửa mã:
- **Hoa hồng 10 % trọn đời** trên mọi lần khách thanh toán, gia hạn; tiền vào ví, rút về ngân hàng.
- **Tài khoản Hubsell cho chính đối tác** (anh cấp gói qua trang quản trị gói) để họ soi gian của họ, quay bài giảng.
- **Học viên dùng thử 14 ngày gói Scale**, không cần thẻ (mặc định của mọi khách).
- **Một buổi live chung "soi lãi thật chiến dịch"** trên kênh đối tác: anh mở gian thật (của đối tác hoặc một khách
  đồng ý), chỉ chiến dịch nào ROAS đẹp mà lỗ sau phí, giá vốn, hoàn. Đây là thứ đối tác được: một bài giảng mới.

Những thứ **cần anh quyết** nếu muốn mạnh hơn (đều đụng sản phẩm, em chưa làm):
- Dùng thử dài hơn cho khách đăng ký qua mã đối tác (vd 30 ngày, tự chọn) — hiện số ngày dùng thử là một cấu hình chung.
- Ưu đãi riêng cho học viên (giảm tháng đầu) — sẽ đụng luật "không tăng % tháng đầu" nếu làm phía hoa hồng; làm phía
  giá thì khác, anh quyết.

Không dùng chữ "Đối tác chính thức" (luật thư mục). Không hứa con số doanh thu cho đối tác.

## 5. Tin mời (anh gửi, sửa giọng cho hợp)

Viết ngắn để gửi Zalo / tin nhắn TikTok / YouTube. Thay `[tên]`, `[một video cụ thể của họ]` trước khi gửi —
**tin có nhắc đúng một video của họ được trả lời nhiều hơn tin rải**. Số dưới đây là số thật 06/11.

### Mẫu 1 — người dạy quảng cáo Shopee / TikTok / GMV Max (A1, A2, A4, A8, A11)

> Chào anh/chị [tên], em là Trung, làm phần mềm Hubsell. Em xem video [một video cụ thể của họ] của anh/chị, đoạn
> nói về ROAS rất đúng chỗ nhiều shop đang hiểu sai.
>
> Hubsell là trợ lý quảng cáo cho Shopee, TikTok Shop, Lazada: lấy chi tiêu quảng cáo, đơn, phí sàn, giá vốn, hàng
> hoàn của từng gian để chỉ ra chiến dịch nào **lỗ thật** dù ROAS trên sàn nhìn vẫn đẹp. Hiện có 255 chủ shop đăng
> ký, app đã lên Cửa hàng ứng dụng TikTok Shop.
>
> Em muốn mời anh/chị dùng thử miễn phí trên gian của mình, nếu thấy hợp thì giới thiệu cho học viên. Mỗi học viên
> trả tiền, anh/chị nhận **10 % trọn đời** mỗi lần họ gia hạn. Nếu anh/chị muốn, em làm cùng một buổi live soi lãi
> thật vài chiến dịch, làm thành bài giảng cho học viên.
>
> Anh/chị cho em xin 15 phút gọi Zalo được không ạ?

### Mẫu 2 — người dạy bán hàng / vận hành sàn (A3, A6, A7, A9, A10, A12, B2, B5–B7)

> Chào anh/chị [tên], em là Trung, làm phần mềm Hubsell. Em theo dõi kênh anh/chị về [chủ đề họ dạy].
>
> Học viên mới vận hành sàn hay mắc chung một chỗ: thấy doanh thu tăng, ROAS đẹp, nhưng cuối tháng trừ phí sàn,
> giá vốn, hàng hoàn thì lỗ. Hubsell tự tính lãi thật từng đơn, từng chiến dịch cho Shopee, TikTok Shop, Lazada,
> kèm quản lý đơn, tồn kho đa sàn. Học viên dùng thử 14 ngày không cần thẻ.
>
> Em mời anh/chị dùng miễn phí, nếu hợp thì giới thiệu cho học viên. Mỗi người trả tiền, anh/chị nhận **10 % trọn
> đời** trên mọi lần gia hạn. Anh/chị cho em 15 phút gọi Zalo để em mở thử trên gian của anh/chị nhé?

### Mẫu 3 — người chạy ads thuê / agency (A5, B1)

> Chào anh [tên], em là Trung bên Hubsell. Em thấy bên anh nhận chạy quảng cáo [Shopee/TikTok] cho shop.
>
> Hubsell nối được nhiều gian của nhiều khách vào một chỗ, ra lãi thật từng chiến dịch sau phí sàn, giá vốn, hoàn —
> để anh báo cáo cho khách bằng lãi chứ không chỉ ROAS, và thấy sớm chiến dịch nào đang lỗ. Trợ lý còn canh 24/7,
> báo khi chiến dịch rơi dưới hòa vốn.
>
> Em mời anh dùng miễn phí cho vài gian khách đang chạy. Khách nào anh giới thiệu dùng tiếp và trả tiền, anh nhận
> **10 % trọn đời**. Anh cho em 15 phút gọi Zalo được không?

### Mẫu 4 — người dạy kế toán TMĐT (B8, B9)

> Chào anh/chị, em là Trung, làm phần mềm Hubsell. Bên mình dạy kế toán sàn TMĐT, nên em nghĩ mình đang nói cùng một
> chuyện: lãi thật của shop sau phí sàn, giá vốn, hoàn, hủy.
>
> Hubsell tự kéo đơn, 25+ loại phí sàn, chi tiêu quảng cáo của Shopee, TikTok Shop, Lazada và tính lãi từng đơn, từng
> chiến dịch. Em mời bên mình dùng miễn phí làm công cụ minh họa trong lớp; học viên hoặc chủ shop của học viên dùng
> và trả tiền thì bên mình nhận **10 % trọn đời**. Mình cho em xin 15 phút gọi để em mở thử được không ạ?

## 6. Đo và nhịp

- **Mỗi đối tác một tài khoản Hubsell → một mã `HUBSELL<số>`.** Khách đăng ký qua link có `?ref=` được ghi
  `referredById` → đếm được khách, khách trả tiền, hoa hồng theo từng đối tác.
- **Bảng theo dõi** (anh hoặc em cập nhật): tên · ngày gửi · kênh gửi · trả lời (có/không) · đã gọi · đã dùng thử
  · mã · số khách qua mã · số khách trả tiền.
- **Mục tiêu (tự chọn):** sau 7 ngày ≥ 3/12 trả lời; sau 30 ngày 3 đối tác có ≥ 1 khách qua mã. Không đạt thì đổi
  tin mời hoặc đổi nhóm trước khi gửi nhóm B.
- **SQL đếm khách qua giới thiệu** đã có ở `so-lieu/SQL-SO-THAT-KHACH-HANG.sql` (khối giới thiệu).

## 7. Việc của anh

1. Duyệt danh sách nhóm A (bỏ ai, thêm ai anh biết).
2. Xem video "Tool Auto Tối Ưu Ads GMV MAX" của Trương Hải Đăng → quyết nhóm B hay C.
3. Gửi 12 tin nhóm A (em không gửi thay: tin nhắn ra ngoài phải là anh).
4. Quyết có cho dùng thử dài hơn qua mã đối tác không (mục 4).

## 8. Tiêu chí mới sau phản hồi 07/11

Đối tác hợp là người **có nhiều chủ shop đang chạy ads** nhưng **không bán tool hay dịch vụ chạy ads**, và thu nhập của
họ tăng khi shop của khách sống lâu. Loại khỏi danh sách: ai đang bán tool, bán dịch vụ chạy ads thuê, hoặc kiếm tiền
chính từ khóa học quảng cáo (A1, A2, A4, A5, A8, A11, B1, nhóm C cũ).

Các nhóm hợp tiêu chí (chưa quét, cần anh chọn hướng):
- **Kế toán / thuế TMĐT** (Lê Ánh, VAReCOM…): bán dịch vụ sổ sách cho shop, Hubsell cho họ số lãi thật từng đơn.
  Phải kiểm họ có phần mềm riêng chưa.
- **Bên cung ứng có tập chủ shop:** xưởng / nguồn hàng sỉ, kho fulfillment, đơn vị đóng gói. Họ không bán phần mềm,
  khách sống lâu thì họ bán được hàng lâu.
- ~~**Người dùng Hubsell sẵn có**~~ — anh gạt 07/11: "khách đang dùng thì họ tự giới thiệu thôi chứ bảo họ tự nhiên
  đi giới thiệu lại hơi khó".
