# Video đóng hàng — bản thiết kế (16/11/2026)

> **Trạng thái 16/11/2026: W1a–W4 ĐÃ CODE TRÊN LOCAL, chưa commit, chưa push — xem mục 10.** W5 (xóa) và phần app chưa làm.
> Khảo sát nằm ở [VIDEO-DONG-HANG-TU-KHIEU-NAI-KHAO-SAT.md](VIDEO-DONG-HANG-TU-KHIEU-NAI-KHAO-SAT.md) (mục 57 thử tải R2, mục 58 trang
> web). Tệp này chỉ chứa THIẾT KẾ: kiến trúc, cây tệp, sổ rủi ro, thứ tự lát. Điều gì là số em tự chọn đều ghi rõ.

## 1. Điều anh đã chốt (thiết kế phải bám)

| # | Điều chốt | Ngày |
|---|---|---|
| C1 | Video lưu ở Cloudflare R2; máy chủ Hubsell không chạm byte video | 13–15/11 |
| C2 | Sổ video ở database CHÍNH, bảng riêng | 16/11 |
| C3 | Trên sidebar: nhóm "Đơn hàng" có hai mục con **"Xử lý đơn hàng"** và **"Video đóng hàng"** | 16/11 |
| C4 | "Video đóng hàng" chỉ MỞ cho một tài khoản `admin@hubsell.vn`; mọi người khác **thấy mờ** | 16/11 |
| C5 | Bán theo GIỜ quay, hết giờ thì dừng; tính năng miễn phí, chỉ bán giờ | 14/11 |
| C6 | Xóa theo trạng thái đơn tới qua hạn khiếu nại, không cố định N ngày | 14/11 |
| C7 | Video có ngày giờ trong hình, góc trái trên; không tự cắt ngắn, không chỉnh sửa | 14/11 |
| C8 | Yêu cầu chất lượng: phòng rủi ro trước, mã sạch, cây thư mục đúng luật | 16/11 |

## 2. Kiến trúc

```
 App điện thoại ──(1) báo "đã quay xong": mã tem, giây, cỡ tệp──▶ Backend chính
        │                                                          │  kiểm cổng · khớp tem ra đơn · ghi sổ (PENDING)
        │◀──────────(2) đường dẫn ký sẵn, ký cả cỡ + kiểu tệp──────┘
        │
        └──(3) tải thẳng tệp (một lần / theo mảnh 8 MiB)──▶ Cloudflare R2 (bucket riêng tư)
        │
        └──(4) báo "tải xong"──▶ Backend: hỏi R2 cỡ thật ──▶ sổ = STORED

 Web /orders/videos ──▶ Backend: đọc sổ + đọc Order theo khóa chính ──▶ danh sách
        └── bấm Xem / Tải về ──▶ Backend ký đường dẫn GET hạn ngắn ──▶ trình duyệt đọc thẳng R2
```

Ba nguyên tắc cứng:

1. **Byte video không bao giờ đi qua máy chủ Hubsell** (web Render từng hết bộ nhớ 21/10 và 03/11).
2. **Mọi quyết định "ai được làm gì" nằm ở máy chủ.** Web và app chỉ hiển thị theo câu trả lời của máy chủ.
3. **Sổ video không dính vào bảng `Order`:** không khóa ngoại, không trigger, không thêm cột. Ghi sổ video không kích tính lại sổ cái.

## 3. Cổng mở tính năng — một nguồn duy nhất

| Lớp | Việc | Tệp |
|---|---|---|
| Cấu hình | danh sách email thí điểm = `admin@hubsell.vn` (cùng kiểu `tax-pilot.ts` đang có) | `backend/src/config/pack-video.ts` |
| Quyết định | `packVideoAccess(user)` trả `open` hoặc `locked`. `open` chỉ khi: đúng email thí điểm VÀ là chủ tài khoản (không phải nhân viên) VÀ R2 đã cấu hình. Thiếu bất kỳ điều gì → `locked` (hỏng thì ĐÓNG) | `backend/src/services/pack-video/access.ts` |
| Chặn | middleware gắn lên TOÀN BỘ `/api/pack-videos/*`; `locked` → 403 mã `FEATURE_LOCKED` | `backend/src/middleware/require-pack-video.ts` |
| Báo cho giao diện | `/api/auth/login` và `/api/auth/me` trả thêm `features.packVideo` | `backend/src/routes/auth.ts` |
| Sidebar | mục con có khóa `feature: "packVideo"`; `locked` → vẽ MỜ + ổ khóa bằng đúng kiểu `locked` đã có (`app-shell.tsx:680`) | `frontend/src/components/shell/app-shell.tsx` |
| Trang | ai gõ thẳng `/orders/videos` khi `locked` → trang tự hiện thẻ "chưa mở" (kiểu trang KOC TikTok đang làm), không gọi API | `frontend/src/app/orders/videos/page.tsx` |

Bảng `pack_settings` (đề xuất ở mục 58.11 tài liệu khảo sát) em **lùi lại** tới lát mở cho khách: một tài khoản thí điểm thì hằng số cấu
hình là đủ, kiểm được bằng mắt, đổi phải qua deploy. Hàm `packVideoAccess` giữ nguyên chữ ký, sau này chỉ đổi ruột.

**Hệ quả phải biết:** theo C3 + C4, ngay khi lát sidebar lên prod thì MỌI khách thấy "Đơn hàng" thành nhóm có hai mục con, trong đó
"Video đóng hàng" mờ. Đây là thay đổi nhìn thấy được với toàn bộ khách, không chỉ tài khoản thí điểm.

## 4. Cây tệp (theo luật đặt tệp ở README)

```
backend/
├── prisma/migrations/<ngày giờ>_pack_videos/migration.sql   # bảng chia mảnh + hàm tạo mảnh + RLS
├── scripts/pack-video-seed-clips.ts                         # nạp clip thử từ máy tính (chỉ local / thí điểm)
└── src/
    ├── config/pack-video.ts               # email thí điểm, trần cỡ tệp, cỡ mảnh, hạn ký, biên kiểm chéo
    ├── lib/                               # THUẦN, không gọi DB, không gọi mạng
    │   ├── r2-sign.ts                     #   dựng yêu cầu ký sẵn PUT / GET / từng mảnh
    │   ├── pack-video-key.ts              #   dựng + đọc ngược đường dẫn tệp trên R2
    │   ├── pack-video-rules.ts            #   chuyển trạng thái hợp lệ, kiểm chéo giây ↔ cỡ tệp
    │   └── __tests__/                     #   r2-sign.test.ts · pack-video-key.test.ts · pack-video-rules.test.ts
    ├── integrations/r2/
    │   ├── client.ts                      # gọi R2: hỏi cỡ, xóa, mở / chốt / hủy tải theo mảnh, liệt kê mảnh
    │   └── __tests__/
    ├── services/pack-video/
    │   ├── access.ts                      # cổng (mục 3)
    │   ├── order-match.ts                 # khớp tem ra đơn — CHỈ ĐỌC `Order`
    │   ├── upload.ts                      # bắt đầu · xác nhận · hủy một video
    │   ├── library.ts                     # danh sách · tìm · hồ sơ một đơn · cấp đường dẫn xem / tải
    │   └── __tests__/                     # access.test.ts · upload-db.test.ts · library-db.test.ts · isolation-db.test.ts
    ├── middleware/require-pack-video.ts
    ├── routes/pack-videos.ts              # /api/pack-videos/* — mỏng: đọc tham số, gọi service, trả kết quả
    └── workers/pack-video-janitor.ts      # LÁT SAU: dọn dòng treo, hủy mảnh treo, gộp số ngày, xóa theo luật

frontend/src/
├── app/orders/videos/page.tsx                    # mỏng: chỉ ghép component
├── app/orders/videos/order/[orderId]/page.tsx    # hồ sơ video của một đơn
├── components/orders/videos/
│   ├── videos-page.tsx          # giữ state, tab
│   ├── video-search-box.tsx     # ô tìm / quét mã
│   ├── video-filters.tsx        # chip + lọc ngày, gian
│   ├── video-table.tsx
│   ├── video-player.tsx
│   └── order-video-dossier.tsx  # hồ sơ một đơn
├── components/shared/feature-locked-card.tsx     # thẻ "chưa mở" dùng chung
├── lib/features.ts              # đọc `user.features`
├── lib/pack-video.ts            # hàm thuần: định dạng thời lượng, nhãn trạng thái
└── lib/api.ts                   # thêm nhóm hàm `packVideos*` (đúng nơi các nhóm API khác đang nằm)

docs/VIDEO-DONG-HANG-THIET-KE.md                  # tệp này
```

Không có tệp nào nằm cạnh `page.tsx`; `lib/` không nhập ngược từ `components/`; worker không giữ trạng thái ở biến cấp tệp (test
`no-module-state` đang chặn). Thư viện ký: `aws4fetch` (một gói nhỏ, không kéo gói khác, đã dùng để thử ở mục 57) thay vì bộ AWS SDK
nặng — bộ nhớ tiến trình web là thứ đã từng thiếu.

## 5. Hợp đồng API bản đầu

| Đường | Ai gọi | Việc | Điểm phòng ngừa |
|---|---|---|---|
| `POST /api/pack-videos` | app, script nạp thử | báo đã quay xong → tạo dòng `PENDING`, trả đường dẫn tải | nhận `clientId` do app sinh; gọi lại cùng `clientId` trả lại đúng dòng cũ (không sinh dòng trùng khi mạng chập chờn) |
| `POST /api/pack-videos/:id/parts` | app | xin ký lại / ký thêm mảnh | chỉ khi dòng còn `PENDING` |
| `POST /api/pack-videos/:id/complete` | app | chốt: máy chủ hỏi R2 cỡ thật rồi mới ghi `STORED` | gọi lại nhiều lần vẫn một kết quả; cỡ lệch với lúc báo → từ chối, xóa tệp |
| `GET /api/pack-videos` | web | danh sách theo trang (con trỏ `recordedAt` + `id`), lọc ngày / gian / chip | không `OFFSET` lớn; không `ORDER BY id LIMIT` trên `Order` (bẫy đã ghi) |
| `GET /api/pack-videos/summary` | web | số trên chip | một câu gộp trên chỉ mục `ownerId` |
| `GET /api/pack-videos/by-order/:orderId` | web | mọi video của một đơn | đơn phải thuộc chủ shop đang đăng nhập |
| `GET /api/pack-videos/:id/url` | web | đường dẫn xem hoặc tải về | hạn 5 phút (số em tự chọn); tên tệp tải về = mã vận đơn |

## 6. Sổ rủi ro

Em không hứa "hết mọi rủi ro". Dưới đây là mọi rủi ro em nhìn thấy, cách chặn, và cách CHỨNG MINH đã chặn. Cuối mục là phần còn lại
phải chấp nhận.

### 6.1 Bảo mật và dữ liệu riêng tư

| # | Rủi ro | Chặn bằng | Chứng minh bằng |
|---|---|---|---|
| S1 | Shop này xem được video shop khác | mọi truy vấn lấy `ownerId` từ phiên đăng nhập, không bao giờ từ tham số; đường dẫn tệp do máy chủ tự dựng, bắt đầu bằng `ownerId` | test DB: tài khoản B hỏi video của A ở cả 4 đường `GET` + 2 đường `POST` → 404 |
| S2 | Tính năng lọt ra cho tài khoản chưa mở | middleware trên cả nhóm route; mặc định đóng | test: tài khoản thường, nhân viên của tài khoản thí điểm, tài khoản thí điểm khi thiếu cấu hình R2 → cả ba 403 |
| S3 | Đường dẫn ký sẵn bị chuyển cho người khác | GET hạn 5 phút; PUT ký cả cỡ + kiểu tệp; không ghi đường dẫn vào log | test đơn vị cho `r2-sign`; đã thử thật ở mục 57.2 |
| S4 | Lộ khóa R2 | khóa chỉ ở biến môi trường máy chủ; khóa thật anh tự tạo, quyền đúng một bucket; không xuống web / app; khóa thử tự hết hạn 14/12/2026 | rà mã trước khi commit: không chuỗi khóa nào trong kho |
| S5 | Tải tệp rác / tệp không phải video | chỉ ký `video/mp4`; trần cỡ tệp ở cấu hình; bucket riêng tư; web chỉ phát bằng thẻ video | test: cỡ vượt trần → 400 |
| S6 | Tên + địa chỉ người mua nằm trong hình | bucket riêng tư; trần giữ 90 ngày (Shopee DPP); **khi khách xóa tài khoản phải dọn cả tiền tố video của họ** (`account-deletion.ts` hiện chưa biết tới video) | việc phải làm TRƯỚC khi mở cho khách thứ hai; ghi thành điều kiện ở mục 8 |
| S7 | Nhân viên bị giới hạn gian thấy video gian khác | bản thí điểm: nhân viên không vào được (S2). Khi mở: lọc theo `StaffChannel` như trang Đơn hàng | để ở lát mở cho khách |

### 6.2 Đúng sai của dữ liệu

| # | Rủi ro | Chặn bằng | Chứng minh bằng |
|---|---|---|---|
| D1 | App gửi lặp → hai dòng cho một video | khóa duy nhất `(ownerId, clientId)` | test DB gọi hai lần |
| D2 | Quay xong nhưng không bao giờ tải lên | dòng nằm `PENDING`, web hiện ở chip "Chưa tải lên xong"; việc dọn (lát sau) đánh dấu `LOST` sau N ngày | N chưa chọn — chờ số thật từ lần thử trên điện thoại |
| D3 | Tệp có trên R2 nhưng sổ không biết (bước chốt hỏng) | bước chốt gọi lại được; lưới an toàn 95 ngày trên bucket; việc dọn đối chiếu theo thư mục ngày | lát sau |
| D4 | Lượt tải theo mảnh bỏ dở nằm lại, tốn chỗ | hủy lượt khi hủy video; luật vòng đời của bucket tự hủy lượt dở | đặt luật trên bucket thật trước khi dùng |
| D5 | Khớp nhầm tem sang đơn khác | chỉ khớp ĐÚNG TUYỆT ĐỐI mã, trong phạm vi chủ shop; ra hơn một đơn → không khớp, để "Chưa khớp đơn"; không khớp gần đúng | test DB |
| D6 | Đồng hồ điện thoại sai | ngày chia mảnh lấy theo giờ MÁY CHỦ lúc tạo dòng; giờ app báo lưu riêng | test |
| D7 | Thời lượng app báo sai / bị sửa (đây là số tính tiền) | kiểm chéo với cỡ tệp thật (≈ 0,4 MB + 6,1 MB mỗi phút, mục 39); lệch quá biên → gắn cờ | biên chưa chọn; bản thí điểm chỉ GẮN CỜ, chưa trừ giờ |
| D8 | Xóa nhầm video của đơn có hoàn | lát đầu KHÔNG xóa gì ngoài lưới 95 ngày; luật xóa làm ở lát riêng, chạy bóng một tuần | — |
| D9 | Bỏ nhầm mảnh tháng còn video sống | chỉ bỏ khi đếm trong mảnh không còn dòng `STORED` / `PENDING` | lát sau |

### 6.3 Hạ tầng và chi phí

| # | Rủi ro | Chặn bằng | Chứng minh bằng |
|---|---|---|---|
| I1 | Thêm tải ghi cho database chính | mỗi dòng 4 lượt ghi cả đời, không trigger | nạp thử 10.000 dòng trên local, đo cỡ bảng + chỉ mục, báo số thật thay con số ước 0,7 KB |
| I2 | Khớp tem chậm vì `Order.trackingCode` không có chỉ mục | EXPLAIN đường Quét đóng gói đang chạy trên prod (chỉ đọc) trước khi dùng lại | có số rồi mới bàn có thêm chỉ mục hay không |
| I3 | Danh sách đơn hoàn nối video chậm | EXPLAIN trên shop 3.206 đơn chờ về | lát tab Đơn hoàn |
| I4 | Web hết bộ nhớ | không byte video qua máy chủ; không dùng AWS SDK | — |
| I5 | Giữ kết nối database trong lúc chờ R2 (hồ kết nối chỉ 5) | gọi R2 NGOÀI giao dịch database | rà mã |
| I6 | R2 chậm hoặc sập | quay không phụ thuộc mạng (app xếp hàng); web báo lỗi rõ + nút thử lại | thử tay: rút mạng |
| I7 | Hóa đơn R2 tăng bất ngờ | cảnh báo ngân sách trên Cloudflare (CHƯA đặt); trần cỡ tệp; lưới 95 ngày | anh đặt cảnh báo (tài khoản của anh) |

### 6.4 Triển khai

| # | Rủi ro | Chặn bằng | Chứng minh bằng |
|---|---|---|---|
| R1 | Sidebar đổi với MỌI khách: mất thói quen bấm "Đơn hàng" là thấy đơn | bấm tên nhóm vừa xòe vừa vào `/orders` (chờ anh đồng ý — mục 9) | soi local mọi cỡ màn 1280–1700 + giao diện tối + ngăn kéo điện thoại; kiểm hộp tìm nhanh Ctrl+K và các bước hướng dẫn (`components/tour`) có trỏ vào mục "Đơn hàng" không |
| R2 | Migration khóa bảng lớn trên prod | chỉ `CREATE` bảng mới, không `ALTER` bảng có sẵn | đọc lại migration; áp local trước |
| R3 | Cần tắt gấp | xóa email khỏi cấu hình → mọi đường 403, mục con mờ với cả anh; bảng để nguyên, không mất dữ liệu | test |
| R4 | Đẩy nhầm mã thử lên prod | rào `pre-push` đang có | — |
| R5 | Dựng xong mới thấy xấu / rối | gửi anh ảnh local theo đúng trình tự khách gặp TRƯỚC khi commit | — |

### 6.5 Còn lại phải chấp nhận

- Điện thoại hỏng / mất trước khi tải lên thì mất video đó.
- R2 không cam kết vị trí máy chủ ở nước cụ thể (mục 16.1) → trước khi mở cho khách phải sửa Chính sách bảo mật.
- Số thật về tải lên từ điện thoại (Wi-Fi kho, 4G, app xuống nền) CHƯA có; thiết kế hàng chờ trên app còn là giấy.

## 7. Thứ tự làm (mỗi bước nhỏ giao được riêng)

| Bước | Có gì | Ai thấy thay đổi | Database |
|---|---|---|---|
| **W1a** | cổng + nhóm sidebar ("Xử lý đơn hàng" / "Video đóng hàng" mờ) + trang "chưa mở" | MỌI khách (sidebar) | không |
| **W1b** | migration `pack_videos` + ký R2 + ba đường tải lên + test + script nạp clip thử | không ai | thêm bảng mới |
| **W1c** | trang danh sách + ô tìm + hồ sơ một đơn (xem, tải về) | chỉ tài khoản thí điểm | không |
| W2 | nút "Xem video" ở dòng Đơn hàng và dòng Đối soát đơn hoàn | chỉ tài khoản thí điểm | không |
| W3 | tab Đơn hoàn | chỉ tài khoản thí điểm | không |
| W4 | tab Thống kê + bảng gộp theo ngày | chỉ tài khoản thí điểm | thêm bảng mới |
| W5 | luật xóa (chạy bóng trước) + cột "Giữ tới" | chỉ tài khoản thí điểm | không |
| W6 | video khui hàng | chỉ tài khoản thí điểm | không |

W1a tách riêng vì nó là bước duy nhất đụng tới mọi khách; làm trước, anh xem kỹ, rồi các bước sau không ai ngoài anh thấy.

**Xong một bước nghĩa là:** test tự động của bước đó xanh; `tsc` + `eslint` sạch; soi local sáng + tối ở dữ liệu rộng nhất; anh xem
ảnh; ghi PROGRESS + tài liệu; anh bảo commit mới commit.

## 8. Điều kiện trước khi mở cho khách thứ hai (chưa thuộc đợt này)

1. Dọn video khi khách xóa tài khoản (S6).
2. Lọc theo gian cho nhân viên (S7) + quyết quyền xem video.
3. Sửa Chính sách bảo mật (video có dữ liệu người mua, lưu ở nhà cung cấp nước ngoài).
4. Luật xóa đã chạy bóng đủ một tuần (D8).
5. Kiểm chéo thời lượng có biên đã chọn bằng số thật (D7) — vì lúc đó bắt đầu trừ giờ.
6. Chuyển cổng từ hằng số sang bảng cài đặt theo chủ shop.

## 9. Chờ anh

| # | Câu | Em đề nghị |
|---|---|---|
| T1 | Bấm tên nhóm "Đơn hàng": chỉ xòe, hay vừa xòe vừa vào "Xử lý đơn hàng"? | vừa xòe vừa vào |
| T2 | Nhân viên của tài khoản `admin@hubsell.vn` có được mở không? | không — đúng chữ "một mình tài khoản" |
| T3 | Ô "Quay video đóng gói" trên app với tài khoản khác: ẩn hẳn (anh chốt 14/11) hay mờ như web? | giữ ẩn trên app |
| T4 | Giờ quay tính vào lúc nào: lúc quay xong hay lúc tải lên xong? | lúc tải lên xong (video mất thì không tính) |
| — | Bốn câu cũ về trang: tab khui riêng hay gộp · một dòng là video hay đơn · thống kê theo người quay · quyền xem | mục 58.6 tài liệu khảo sát |

## 10. Đã làm trên LOCAL 16/11/2026 (chưa commit, chưa push)

Anh 16/11: "Làm hết một lượt đi em" → làm W1a + W1b + W1c + W2 + W3 + W4 và phần HIỂN THỊ của W6. Bốn câu T1–T4 lấy theo đề nghị ở mục 9
(anh chưa trả lời từng câu). Anh xác nhận thêm: trên prod `admin@hubsell.vn` là tài khoản **shop thường**.

**Đã có và đã chạy thật trên local:**

| Phần | Trạng thái |
|---|---|
| Cổng một nguồn (`config/pack-video.ts` → `services/pack-video/access.ts` → middleware → `features.packVideo` ở mọi chỗ `auth.ts` trả user) | chạy; tài khoản khác gọi API nhận 403 `FEATURE_LOCKED` |
| Sidebar: "Đơn hàng" thành nhóm → "Xử lý đơn hàng" + "Video đóng hàng"; bấm TÊN nhóm vào `/orders`, mũi tên là nút xòe / cụp riêng; Ctrl+K bỏ qua mục khóa | đã nhìn ở tài khoản thí điểm (mở); trạng thái MỜ ở tài khoản khác CHƯA nhìn bằng mắt |
| Bảng `pack_videos` chia mảnh tháng, RLS, không khóa ngoại / trigger; tạo mảnh nối vào worker sổ cái | áp local bằng `prisma db execute` (vì `migrate deploy` local kẹt ở một migration hỏng từ 17/09) |
| Ký R2 (`aws4fetch`), tải một lần + theo mảnh, chốt bằng `HeadObject` | chạy với bucket thử; clip 52 MB đi 7 mảnh |
| 10 đường `/api/pack-videos` | chạy |
| Trang `/orders/videos`: tab Video đóng hàng · Đơn hoàn · Thống kê; hộp xem nhanh; trang hồ sơ một đơn | chạy với 6 video thật + 1 dòng chờ tải; video phát thẳng từ R2 (720×1280, có ngày giờ trong hình) |
| Dấu "Có video" ở dòng trang Đơn hàng + biểu tượng ở dòng Đối soát đơn hoàn | trang Đơn hàng đã nhìn; trang Đối soát CHƯA nhìn |

**Kiểm đã chạy:** backend `tsc` sạch, 84 / 84 test video đậu (cô lập hai chủ shop ở mọi đường, ba ca bị khóa, gửi lặp `clientId`, tem ra hơn
một đơn, chốt khi cỡ lệch), `no-module-state` xanh; frontend `tsc` + `eslint` sạch. Cả bộ backend: 2.599 đậu / 6 rớt ở bốn tệp sổ cái —
nhánh backend cho là có sẵn do database local thiếu migration cũ, CHƯA chứng minh trên cây sạch. Backend không có cấu hình eslint.

**Số đo:** dòng sổ video = **768 byte** (heap 410 + chỉ mục 358), đo trên 10.000 dòng nạp thử — sát con số ước 0,7 KB. Bảng video hết tràn
ngang từ 1440 px; ở 1280 px còn dư 50 px trong hộp. Giao diện tối: không phần tử nào tương phản dưới 3:1 ở tab Thống kê.

**Sửa sau khi soi màn:** bảng video ban đầu rộng 1.357 px (tràn 254 px ở 1440) → gộp người quay xuống dưới cột Quay lúc, nút thao tác chỉ
còn biểu tượng dưới 1536 px, nhãn tình trạng tệp chuyển sang cột Đơn; trục biểu đồ in "0.045giờ" → đổi sang giờ + phút.

**Lệch so với hợp đồng mục 5 (đã chấp nhận, ghi để khỏi ngạc nhiên):** thêm cột `uploadId`; ràng buộc duy nhất là `(ownerId, clientId,
recordedDate)` làm luôn việc tra lại; `GET /returns` phân trang bằng vị trí; `returnType` = `FAILED_DELIVERY` / `BUYER_RETURN`; video đã
`STORED` thì `POST /` trả `upload: null`; giờ quay ở tương lai thì lấy giờ máy chủ; chưa có đường "hủy video"; sắp xếp tại tiêu đề cột chỉ
xếp trong trang đang xem; tab Đơn hoàn chưa có lọc ngày / gian / ô tìm; chưa lọc theo người quay.

**Đổi trên máy local của anh (không nằm trong mã):** `admin@hubsell.vn` trên database local đã tắt cờ điều hành (`isPlatformAdmin` true →
false) cho giống prod — muốn vào khu điều hành local dùng `hq@local.test`; `backend/.env` có thêm 4 dòng `R2_*` của khóa thử; bucket thử
đang giữ 6 tệp ≈ 95 MB.

**PHẢI xong trước khi push (theo thứ tự):**

1. Nhìn bằng mắt trạng thái MỜ ở một tài khoản shop khác + ngăn kéo sidebar bản điện thoại (thay đổi này mọi khách thấy).
2. EXPLAIN chỉ đọc trên prod: câu khớp tem ra đơn (local là Seq Scan cả bảng `Order` vì không có chỉ mục `trackingCode`), câu đếm chip,
   câu danh sách đơn hoàn nối video.
3. Chạy lại 6 test rớt trên cây sạch để chắc là có sẵn.
4. Anh tạo khóa R2 THẬT + bucket thật và đặt 4 biến `R2_*` trên Render — thiếu thì lên prod tính năng khóa với cả tài khoản thí điểm.
5. Đặt luật vòng đời trên bucket (tự hủy lượt tải dở, lưới 95 ngày) + cảnh báo ngân sách Cloudflare.
6. Ảnh `dh-orders.png` của bài hướng dẫn còn sidebar cũ — hỏi anh có chụp lại không.

**Chưa làm (đúng kế hoạch):** luật xóa video W5; quay / tải lên từ app; bảng gộp theo ngày; dọn video khi khách xóa tài khoản; 6 điều kiện
mục 8.

## 11. Số giờ còn lại + nút "Mua thêm giờ quay" + cột Người quay (16/11/2026, local, chưa commit)

Anh 16/11 (xem màn local): "Thêm cột người quay để seller dễ thống kê. Và thiếu thống kê số giờ còn lại (ví dụ khách mua 1000 giờ, đã
quay 400 thì còn lại 600). Và cả nút mua thêm giờ quay nữa."

**Cột Người quay.** Tách lại thành cột riêng trong bảng video (tên · tên máy ở dòng phụ). Hôm trước em gộp vào cột Quay lúc để bảng vừa
màn — ⛔ đừng gộp lại. Bù chỗ: nhãn tệp "Chưa tải lên xong" rút thành "Chờ tải lên". Đo: 1440 px không tràn; 1280 px dư 153 px trong hộp.

**Sổ giờ.** Bảng mới `pack_hour_grants` (migration `20261116100000_pack_hour_grants`): mỗi dòng một lần cộng / điều chỉnh giờ cho một
chủ shop, loại `PURCHASE` / `GRANT` / `ADJUST`, chỉ CHÈN; không khóa ngoại, không trigger, có RLS.

| Số | Cách tính | Ghi chú |
|---|---|---|
| Đã mua | Σ `seconds` của `pack_hour_grants` | sửa sai bằng một dòng `ADJUST` ngược dấu |
| Đã quay | Σ thời lượng video `STORED` + `DELETED` | video bị xóa vì hết hạn giữ vẫn là giờ đã dùng; `PENDING` và `LOST` không tính (đúng T4: tính lúc tải lên xong) |
| Còn lại | đã mua − đã quay | ĐƯỢC ÂM — "quay dở thì quay nốt, phần lố trừ lần mua sau" (anh chốt 14/11) |

Mã: `backend/src/services/pack-video/hours.ts`, `GET /api/pack-videos/hours` (số giờ là của CHỦ SHOP, không theo gian), script cấp giờ
`backend/scripts/pack-video-grant-hours.ts`. Test `hours-db.test.ts` có đúng ví dụ của anh (1.000 − 400 = 600). Cả phần video: 93 / 93 đậu.

**Trên web** (`frontend/src/components/orders/videos/hours-balance.tsx`): mép phải hàng tab, hiện ở MỌI tab: "Còn 999 giờ 43 phút /
1.000 giờ" + thanh đã dùng + nút **Mua thêm giờ quay**. Màu theo đúng mốc thanh hạn mức trang Gói dịch vụ (vàng từ 80 % đã dùng, đỏ từ
100 %). Tab Thống kê thêm hàng ô số từ trước tới nay: Giờ còn lại · Giờ đã mua · Giờ đã quay; ô theo kỳ đổi tên thành "Giờ quay trong kỳ".

**Nút Mua thêm giờ quay — CHƯA có bước thanh toán.** Hộp mở ra hiện số dư + hai gói 100 giờ / 200 giờ (cỡ gói anh nêu 14/11) với chữ
"Giá chưa công bố" và dòng "Giờ quay chưa mở bán". Gói + giá + cờ mở bán nằm ở máy chủ (`config/pack-video.ts`:
`PACK_VIDEO_HOUR_PACKAGES`, `PACK_VIDEO_HOUR_SALES_OPEN = false`) — không số nào là giá giả. Để bán thật còn thiếu quyết định của anh:

| # | Câu | Ghi chú |
|---|---|---|
| G1 | Giá từng gói giờ | mốc đã có: chỗ chứa ≈ 2,3 đ / phút / 30 ngày; Ship Xanh thu 22–25 đ / phút cloud (mục 50 tài liệu khảo sát) |
| G2 | Cỡ gói: chỉ 100 và 200 giờ, hay thêm gói lớn (ví dụ của anh hôm nay là 1.000 giờ) | — |
| G3 | Giờ mua có hạn dùng không (mất cuối tháng / cộng dồn / mua đứt) | anh nói "gia hạn ở tháng sau" 14/11 nhưng chưa xác nhận |
| G4 | Thu qua đâu: payOS như gói dịch vụ (tự cộng giờ khi tiền về) hay gửi yêu cầu để HQ cộng tay | iOS vướng thanh toán trong app → bán trên web trước |

**CHƯA làm (cố ý):** chặn mở video mới khi hết giờ — bản thí điểm chưa bán giờ nên chưa chặn; khi mở bán thì chặn ở `beginUpload` bằng
`getHoursBalance()`. ⚠️ "Đã quay" đang cộng trực tiếp từ `pack_videos`: trước khi làm việc bỏ mảnh tháng cũ PHẢI có bảng gộp theo ngày,
không thì bỏ mảnh là số giờ đã quay tụt.

**Local:** đã nạp 1.000 giờ thử cho `admin@hubsell.vn` (dòng `GRANT`, ghi chú "nap thu local") để soi màn theo ví dụ của anh. Prod chưa
có dòng nào → lên prod sẽ hiện "Chưa mua giờ quay" cho tới khi cấp giờ bằng script hoặc mở bán.
