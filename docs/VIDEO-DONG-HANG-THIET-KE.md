# Video đóng hàng — bản thiết kế (16/11/2026)

> **Trạng thái 16/11/2026: W1a–W4 + sổ giờ ĐÃ PUSH `b0040067` (anh: "Em cứ push lên trước") — xem mục 10, 11, 12.** W5 (xóa), thanh toán mua giờ, quay từ app / webcam chưa làm.
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

## 12. Đã push 16/11/2026 + việc kế

Anh 16/11 chiều: "Phần giờ quay này thì khách mua bao nhiêu thì hệ thống cộng vào tài khoản của khách bấy nhiêu, mình thu trước, mỗi lần
khách thanh toán mình cũng phải xuất hóa đơn mà. Nên cứ coi như là một giao dịch mua hàng thôi. Nên phần này mình để làm sau. Việc bây giờ
là phải test đã. Em cứ push lên trước. Mình còn phải làm cho phần camera nữa vì khách sẽ dùng camera hoặc webcam là chính."

- **Mua giờ quay = một giao dịch mua hàng trả trước** (thu trước → cộng đúng số giờ đã mua → xuất hóa đơn mỗi lần thanh toán). LÀM SAU.
  Câu G4 mục 11 coi như đã trả lời; G1–G3 (giá, cỡ gói, hạn dùng) vẫn mở.
- **Đã push `b0040067`.** Trước khi push: build production của web qua; test video 93 / 93; 6 test rớt đều thuộc sổ cái trên database
  local (khóa ngoại / chỉ mục trigram), không chạm mã video — chưa chạy lại trên cây sạch.
- **Để test được trên prod, anh cần đặt 4 biến trên Render (dịch vụ web):** `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`. Chưa đặt thì "Video đóng hàng" mờ với MỌI tài khoản, kể cả `admin@hubsell.vn`. Prod chưa có video nào và chưa
  có dòng giờ nào (cấp giờ: `backend/scripts/pack-video-grant-hours.ts`).
- **Còn nợ sau push:** nhìn trạng thái mờ trên prod ở một tài khoản khác; EXPLAIN chỉ đọc trên prod (khớp tem, đếm chip, đơn hoàn nối
  video); luật vòng đời bucket + cảnh báo ngân sách; ảnh hướng dẫn `dh-orders.png`.
- **VIỆC KẾ: quay bằng camera / webcam trên máy tính** — anh: "khách sẽ dùng camera hoặc webcam là chính". Đổi trọng tâm so với "điện
  thoại trước" (14/11). Nền đã có ở tài liệu khảo sát: mục 16.2 (quay trong trình duyệt), mục 19 (đối thủ giơ tem lên webcam), mục 31
  (camera trong nhà cần phần mềm cầu nối). Chưa thử thật.

## 13. Trang thử webcam `tools/thu-webcam/` — kết quả với webcam thật (16/11/2026, chưa commit)

Anh 16/11: "Lần này chúng ta cứ làm cho webcam trước"; "Phải có nút bắt đầu và dừng kết thúc như trên mobile chứ, nhạc nữa"; "ok em làm
đi". Trang thử nằm NGOÀI sản phẩm, chạy bằng mục `thu-webcam` trong `.claude/launch.json` → `http://127.0.0.1:4321/`, mở trong Chrome
thật của anh. Webcam: "Web Camera" (`CB07:1BCF`) anh mua trên mạng. Mọi con số dưới đây đo ở 1280×720, 30 khung/giây, đặt 800k.

| Cửa | Kết quả | Số đo |
|---|---|---|
| 1. Mở camera | ĐẠT | 1280×720, đo 29,8 khung/giây |
| 2. Quay ra MP4 — trình ghi sẵn của Chrome | chạy nhưng KHÔNG dùng | tệp phân mảnh (`ftyp moov moof mdat…`), không có số khung, khung khóa chỉ ở giây 0 và 3,5 |
| 2. Quay ra MP4 — tự mã hóa (WebCodecs + mediabunny 1.66.0) | ĐẠT, đường chính | `ftyp moov mdat`, H.264 High, 177 khung / 6 giây, 0 khung rớt, khung khóa đúng mỗi giây |
| 3. Ngày giờ trong hình | ĐẠT | chữ `16/11/2026 14:57:18` ở góc trái trên của tệp; vẽ 0,83 ms / khung |
| 4. Đọc mã tem lúc đang quay | ĐẠT MỘT NỬA | 18 lần đọc được / 579 lần thử trong ≈ 110 giây; **cả 18 lần đều là mã QR, KHÔNG lần nào đọc được mã vạch**; giải mã trung bình 53 ms, lâu nhất 120 ms, chạy trong worker, không lần nào bị dồn |
| 5. Tự cắt clip theo tem | ĐẠT | tem 1 → mở clip; tem 2 → cắt sang clip mới sau 14,6 ms; đưa lại tem 1 → báo "đã quay rồi", KHÔNG mở clip; bấm Dừng → lưu |

Hai clip tự cắt (tem Shopee SPX thật, mã `SPXVN…B` nằm trong QR): 49,29 giây · 5,13 MB · 1.472 khung và 40,58 giây · 3,84 MB · 1.213 khung
→ **≈ 5,7–6,2 MB / phút**, 29,9 khung/giây. ffprobe: `moov` đầu tệp, khung khóa cách nhau tối đa 1,01 giây, giải mã hết tệp không lỗi.
(ffmpeg có cảnh báo vài khung mang mốc thời gian sát nhau khi đổ ra bộ ghi rỗng — chưa soi kỹ.)

**Điều rút ra:**

1. **Đường quay chính trên web = WebCodecs + mediabunny**, không dùng trình ghi sẵn của Chrome. Bitrate thật 793–978 kbps khi đặt 800k.
2. **Ở 720p webcam này chỉ đọc được QR, không đọc được mã vạch** — giống hệt Note8 (máy đọc QR dễ hơn mã vạch ≈ 3 lần). Các lần đọc
   đến thành từng chùm lúc tem được đưa lại gần camera; giữa các chùm là hàng chục giây không đọc được gì. → cắt theo tem chỉ chắc khi
   người đóng hàng đưa tem lại gần camera, hoặc khi soi mã ở độ phân giải cao hơn độ phân giải quay (webcam lên tới 2688×1520). CHƯA
   thử tem nằm trên mặt bàn ở khoảng cách làm việc, chưa thử soi ở 1080p / 2K.
3. Cắt clip 14,6 ms (camera giả: 2,6–22,6 ms) — nhanh hơn Note8 (147–230 ms) vì bộ mã hóa chạy xuyên qua lần cắt.

**Sự cố thật lúc thử — webcam rớt kết nối USB (14:58:35):** luồng hình kết thúc, Windows báo đổi thiết bị 4 lần liền, hình đen mà trang
vẫn hiện "đang quay". Đã thêm vào trang thử và PHẢI có ở bản thật: tiếng báo động 3 hồi + dải đỏ "Mất camera – kiểm tra dây USB"; lưu
ngay clip đang quay tới lúc mất hình; camera có lại thì tự mở lại và quay về chờ tem (không tự quay tiếp clip quay tay). Mới thử bằng
giả lập (clip lưu 2,98 giây / 86 khung, mở lại sau 2,1 giây); chưa thử rút dây thật có chủ đích.

**Trang thử có:** thanh quay nhanh (nút Bắt đầu quay / Dừng + đồng hồ), âm "ting-ting" mở clip, hai nốt đi xuống khi clip kết thúc,
"boop-boop" tem đã quay rồi, báo động mất camera; camera giả để chạy không cần thiết bị; mọi kết quả đọc được ở `window.__thu`.
Thư viện ghim trong `tools/thu-webcam/package.json`: mediabunny 1.66.0 (MPL-2.0), barcode-detector 3.2.4 + zxing-wasm 3.1.7 (MIT).

**Chưa kiểm:** tem nằm trên bàn ở khoảng cách làm việc; soi mã ở 1080p / 2K trong khi quay 720p; quay dài 15–30 phút (bộ nhớ: mỗi clip
nằm trong RAM tới khi kết thúc); tab bị ẩn / thu nhỏ cửa sổ; hai webcam; rút dây thật; webcam khác; anh có nghe đủ các âm không.

**Bổ sung 16/11 ~15:10 — "Thỉnh thoảng nó hay lỗi mở camera" (anh):** tái hiện được 8 / 8 lần Chrome trả `NotReadableError`. Đo: sổ
Windows không ghi ứng dụng nào đang giữ camera; ffmpeg mở được 3 / 3; thuộc tính thiết bị cho thấy webcam được Windows nhận LẠI lúc
15:07:23 (đã rớt một lần 14:58:35) và nó cắm QUA BỘ CHIA USB (`067B:2586`). → gốc là webcam tự rớt rồi nối lại USB; sau mỗi lần nối lại
Chrome chưa đọc được camera trong vài chục giây. Trang thử thêm: mở camera thử lại 6 lần cách 1,5 giây, câu lỗi chỉ thẳng "kiểm tra dây
USB, cắm thẳng vào máy", nhật ký tự ghi ra tệp mỗi 10 giây. Chưa kiểm: cắm thẳng cổng sau máy có hết rớt không. Hệ quả cho chuẩn
webcam: thêm bài thử độ bền kết nối 30 phút, và hướng dẫn khách không cắm qua bộ chia.

**Anh chốt 16/11 ~15:12 sau lần thử hai: "Phải dơ thẳng vào cam mới nhận. Như vậy cũng OK rồi."** → cách dùng với webcam: người đóng
hàng GIƠ TEM thẳng vào camera để máy nhận; không coi việc đọc tem nằm trên bàn là điều kiện chặn. Lần thử hai: tem 1 → clip 15,19 giây;
tem 2 → cắt sau 25,4 ms; đưa lại tem 1 → "đã quay rồi"; 19 / 413 lần đọc, toàn QR. Tab bị ẩn 30 giây (chuyển cửa sổ): khung hình vẫn
về 29,9 khung/giây, bộ đọc mã vẫn chạy — chưa thử ẩn tab đúng lúc đang có clip.

**Điều kiện để đưa màn quay vào sản phẩm:** bucket R2 chưa có luật CORS nên trình duyệt chưa tải thẳng lên R2 được (app điện thoại
không cần CORS, trình duyệt thì cần).

**Luật CORS của bucket thử đã đặt 16/11 ~15:35** (anh: "Em đặt giúp"; đặt trong bảng điều khiển Cloudflare vì khóa thử không đủ quyền):
nguồn `app.hubsell.vn`, `app.hubsell.tech`, `localhost:3010`, `localhost:3000` · PUT / GET / HEAD · tiêu đề `content-type` · lộ `ETag`.
Đã thử yêu cầu dò trước: nguồn được phép trả 204, nguồn lạ trả 403. Nội dung luật: `backend/scripts/pack-video-r2-cors.ts`.
Bucket thật sau này phải đặt đúng luật này.

## 14. Màn quay bằng webcam TRONG SẢN PHẨM — đã chạy với webcam + tem thật trên local (16/11/2026, chưa commit)

Anh 16/11: giao diện trang thử "hơi khó dùng, xấu và hơi khó nhìn", các nút quan trọng (Bật camera, Bật tự cắt, trạng thái đang quay, số
video trong lượt) phải dễ nhìn → em gửi phác thảo → anh: "Được, dựng đi" + "giữ lại cả nhật ký nữa nhé. Khá cần".

**Đường dẫn** `/orders/videos/record`, vào từ nút "Quay video" trên trang Video đóng hàng; chỉ mở khi cổng `packVideo` mở.

**Bố cục (đúng phác thảo anh duyệt):** khung camera lớn bên trái, nhãn trạng thái to ở góc phải khung (Chưa bật camera · Sẵn sàng · giơ
tem · Đang quay mm:ss · Mất camera); dưới khung là ô "Đang quay cho tem". Cột phải: ô Camera (công tắc + tên camera), ô Tự cắt theo tem
(công tắc, mặc định bật), MỘT nút lớn đổi vai Bắt đầu quay ↔ Dừng, ô "Lượt quay này" (số video to + tổng thời gian + các clip gần nhất
và trạng thái tải), dòng giờ còn lại. Bên dưới: **ô Nhật ký** luôn hiện, dòng mới nhất trên cùng, nút "Chép nhật ký", giữ nhật ký hôm
nay trong trình duyệt khi tải lại trang.

**Cây tệp:** `frontend/src/lib/pack-video-recorder/` (thuần, không React: camera, lấy khung, in ngày giờ, mã hóa + cắt clip, đọc mã trong
Worker, máy trạng thái tem, âm báo, nhật ký, hàng chờ tải lên) · `frontend/src/components/orders/videos/record/` (hook + ba khối giao
diện) · `frontend/src/app/orders/videos/record/page.tsx` · `frontend/public/vendor/zxing/zxing_reader-3.1.7.wasm`. Thư viện ghim trong
`frontend/package.json`: mediabunny 1.66.0, barcode-detector 3.2.4, zxing-wasm 3.1.7; hai gói đầu chỉ nạp động ở màn quay.

**Tải lên:** clip xong vào hàng chờ (không khóa việc quay) → `POST /api/pack-videos` (mỗi clip một `clientId`, giữ nguyên khi thử lại) →
PUT thẳng lên R2 → `POST /:id/complete`. Thử lại 4 lần (nghỉ 2 / 5 / 15 giây — số tự chọn) rồi mới báo "lỗi – thử lại". Chốt tải theo
mảnh không gửi ETag: máy chủ tự liệt kê mảnh. Backend thêm `GET /api/pack-videos/match?code=` để hiện đơn khớp với tem lúc đang quay.

**Lần chạy thật 15:37–15:40** (webcam "Web Camera", tem Shopee SPX): bật camera → quay tay → giơ tem 1 (cắt clip quay tay 10 giây) →
giơ tem 2 (cắt, clip 37 giây) → Dừng (clip 51 giây). Cả ba clip tự tải lên sau 1,3–1,5 giây; sổ `STORED`; cỡ tệp trên R2 khớp sổ
(1,14 · 3,64 · 4,85 MB); tệp `ftyp moov`; không bị gắn cờ thời lượng.

**Chưa kiểm / phải làm trước khi push:** `next build` với trang mới; test cho đường `/match`; `/match` với mã tem có đơn thật; mất
camera thật + tự mở lại; tab ẩn đúng lúc đang quay; clip > 32 MB (tải theo mảnh từ trình duyệt, xin ký lại mảnh hết hạn); quay dài (mỗi
clip nằm trong RAM tới khi kết thúc); soi tay giao diện tối và màn 1280.

## 15. Đường quay video KHUI HÀNG HOÀN + ngày giờ trên khung xem trước (16/11/2026 tối, local, chưa commit)

Anh 16/11: "Chưa có đường quay video khui hàng, và phải làm sao để khi quay video khui hàng không bị trùng mã đơn hàng với video đóng
hàng" → em trình 6 điểm → "ok em làm đi". Rồi: "Cả video khui hàng và đóng hàng đang bị thiếu hiển thị thời gian ngày giờ rồi em".

**Gốc của "trùng mã":** kiện hoàn về dán đúng tem cũ → camera đọc ra cùng mã vận đơn với lúc đóng.

| Điểm | Làm thế nào |
|---|---|
| Hai chế độ quay | công tắc "Đóng hàng \| Khui hàng hoàn" ở đầu cột điều khiển; chế độ khui đổi màu nhấn sang TÍM (viền khung, nhãn trạng thái, nút lớn "Bắt đầu quay khui"); khóa công tắc khi đang có clip |
| Cùng mã, khác loại | clip gửi lên kèm `kind` (`PACK` / `UNBOX`); sổ có sẵn cột loại nên hai video cùng mã không đè nhau; hồ sơ đơn hiện cả hai |
| Sổ "tem đã quay rồi" | tách theo chế độ: đã quay đóng vẫn quay khui được; quay khui lần hai cùng tem mới báo |
| Rào chống chọn nhầm (cảnh báo, không khóa) | đang Đóng mà đơn đang hoàn → "Đơn này đang hoàn về. Chuyển sang quay khui hàng?" với "Chuyển sang khui" (đổi loại của chính clip đang quay) / "Vẫn là đóng hàng" (không hỏi lại cho tem đó trong lượt); đang Khui mà đơn chưa có hoàn → nhắc một dòng |
| Lối vào thứ hai | nút "Quay khui hàng" ở trang Đối soát đơn hoàn (đầu cụm bên phải, trước ô lọc thời gian; không đổi gì khác của trang) → `/orders/videos/record?mode=unbox` |
| Lời nhắc khi khui | "Quay đủ 6 mặt kiện trước khi mở." |
| Quay tay ở chế độ khui | mã `KHUITAY…`, vẫn lưu, hiện "Khui · chưa khớp đơn" |

Máy chủ: `GET /api/pack-videos/match?code=&kind=` trả thêm `hasReturn` (= `returnStatus ≠ NONE`, đúng định nghĩa tab Đơn hoàn),
`returnStatus`, `hasPackVideo`, `hasUnboxVideo` (chỉ tính video đã lên kho). Với `UNBOX` khớp cả mã vận đơn chiều hoàn.

**Ngày giờ:** tệp video VẪN có ngày giờ (cắt khung hình từ clip 15:38 ra soi: `16/11/2026 15:38:35` ở góc trái trên). Cái thiếu là khung
XEM TRƯỚC của màn quay — nó hiện hình thô của camera nên người quay không thấy ngày giờ. Đã thêm đồng hồ cùng chữ, cùng góc lên khung
xem trước (dùng chung hàm định dạng với bộ in vào tệp), hiện ngay khi camera bật, ở cả hai chế độ.

**Đã chạy thật trên local với webcam (20:07–20:11):** mở `?mode=unbox` ra đúng chế độ khui; quay tay khui 12 giây → sổ ghi `UNBOX`,
`STORED`, cỡ trên R2 khớp; đổi sang Đóng hàng, quay tay 4 giây → `PACK`; ô "Lượt quay này" ghi "2 video · trong đó 1 video khui";
công tắc khóa lúc đang quay; nút "Quay khui hàng" hiện đúng chỗ ở trang Đối soát đơn hoàn, trang không cuộn ngang; ngày giờ hiện trên
khung xem trước cách mép trái và mép trên 12 px. Hai clip thử đã xóa khỏi sổ và bucket. Test video backend 101 / 101; `tsc` hai phía
+ `eslint` sạch; `next build` qua (chạy trước khi thêm đồng hồ xem trước; sau đó chỉ chạy lại `tsc` + `eslint`).

**CHƯA thử:** dải hỏi "Đơn này đang hoàn về…" và nút "Chuyển sang khui" trên màn thật (cần giơ một tem của đơn đang hoàn; mới thử máy
trạng thái bằng script và `matchTem` với đơn `OFF-0007`); tem thật ở chế độ khui; giao diện tối của màu tím; màn 1280 sau khi cột phải
cao thêm một thẻ.

## 16. Giá vốn một giờ quay + khung giá bán (16/11/2026 — phân tích, anh CHƯA chốt giá)

Anh 16/11: "Nên bán giờ quay thế nào cho hợp lý em nhỉ. Anh cần lợi nhuận từ giờ quay. Ví dụ một video dài 1 phút thì mất bao nhiêu MB,
chiếm bao nhiêu hạ tầng từ đó nhân lên để bán giờ quay video cho hợp lý."

**Số đầu vào**

| Thứ | Số | Nguồn |
|---|---|---|
| Cỡ tệp | ≈ 6 MB / phút (đo 5,7–6,2) → ≈ 360 MB / giờ | ĐO 16/11 trên webcam (mục 13, 14); Note8 14/11 ra 6,1 MB / phút |
| Giá lưu R2 | 0,015 USD / GB / tháng; tải xuống 0 đ; xóa 0 đ | bảng giá Cloudflare (tài liệu khảo sát mục 16.1) |
| Giá ghi R2 | 4,5 USD / triệu lượt | như trên |
| Tỷ giá | 26.000 đ / USD | GIẢ ĐỊNH của em |
| Số ngày giữ trung bình | ≈ 25 ngày | ƯỚC ở mục 12.3 tài liệu khảo sát; chỉ đúng KHI luật xóa đã chạy |
| Một dòng sổ | 768 byte | ĐO 16/11 |

**Giá vốn hạ tầng**

| Đơn vị | Lưu 25 ngày | Ghi | Tổng |
|---|---|---|---|
| Một video 1 phút (6 MB) | ≈ 1,95 đ | ≈ 0,12 đ | **≈ 2,1 đ** |
| Một GIỜ quay (360 MB, 60 video 1 phút) | ≈ 117 đ | ≈ 7 đ | **≈ 125–150 đ** |
| Một giờ quay nếu bị GIỮ đủ trần 90 ngày | ≈ 421 đ | ≈ 7 đ | ≈ 430 đ |

Sổ video, băng thông API và lượt xem / tải về: không đáng kể (dưới 1 đ / giờ quay). R2 miễn phí 10 GB đầu mỗi tháng (≈ 28 giờ quay).

⚠️ **Phép tính trên chỉ đúng khi luật xóa (lát W5) đã chạy.** Hôm nay CHƯA có gì xóa video: mỗi giờ quay tốn ≈ 140 đ MỖI THÁNG cho tới
khi bị xóa → để một năm là ≈ 1.700 đ / giờ, vượt cả giá bán. Luật xóa là điều kiện của lợi nhuận, không phải việc làm cho gọn.

**Giá thị trường (đã khảo sát, quy về đ / giờ)**

| Ai | Cách bán | Quy ra |
|---|---|---|
| Ship Xanh | 22–25 đ / phút cloud; 18–21 đ / phút lưu máy | 1.320–1.500 đ / giờ; 1.080–1.260 đ / giờ |
| Dohana | 100.000 / 279.000 / 400.000 đ mỗi tháng cho 40 / 120 / 200 GB, tệp ≈ 15 MB / phút | ≈ 2.250 / 2.100 / 1.800 đ / giờ |
| Simple Replay | 300–400 đ / video | ≈ 18.000–24.000 đ / giờ nếu video 1 phút |

→ Giá vốn hạ tầng của mình ≈ 1/10 giá thị trường. Bán quanh giá thị trường thì biên gộp trên hạ tầng ≈ 90 %.

**Khung giá em ĐỀ XUẤT (số em tự đặt, bám dải Ship Xanh – Dohana; anh chưa chốt)**

| Gói | Giá | đ / giờ | Hợp với (mỗi đơn quay ≈ 1 phút) |
|---|---|---|---|
| 50 giờ | 99.000 | 1.980 | ≈ 100 đơn / ngày trong một tháng |
| 100 giờ | 179.000 | 1.790 | ≈ 200 đơn / ngày |
| 200 giờ | 329.000 | 1.645 | ≈ 400 đơn / ngày |
| 500 giờ | 749.000 | 1.498 | ≈ 1.000 đơn / ngày |
| 1.000 giờ | 1.290.000 | 1.290 | ≈ 2.000 đơn / ngày |

Quy ra mỗi đơn: 21–33 đ / đơn (video 1 phút). Shop 1.000 đơn / ngày: ≈ 749.000 đ / tháng, giá vốn hạ tầng ≈ 75.000 đ.

**Thứ ăn vào lợi nhuận nhiều hơn hạ tầng:** VAT 10 % (giá trên đã gồm hay chưa — chờ anh); phí cổng thanh toán; nếu bán trong app iPhone
thì Apple cắt 15–30 %; giờ dùng thử cho không; đơn có hoàn giữ lâu (tới 3,4 lần giá vốn); công hỗ trợ. Giờ mua có HẠN DÙNG thì phần
không dùng hết là lãi thêm và mình không ôm nghĩa vụ vô thời hạn — em đề nghị hạn 12 tháng kể từ ngày mua (anh chưa chốt).

**Chờ anh:** thang gói + giá; giá đã gồm VAT chưa; hạn dùng của giờ; có giờ dùng thử không (bao nhiêu).

**Bổ sung 16/11 tối — anh: "Mình không mất VAT, theo như em tính thì lãi gấp 10 lần?"** Không trừ VAT trong phép tính. Giá bán gấp
≈ 9–15 lần giá vốn HẠ TẦNG, tức lãi gộp trên hạ tầng ≈ 88–92 %; đây chưa phải lãi ròng (chưa trừ phí cổng thanh toán, thuế thu nhập
doanh nghiệp, công làm và hỗ trợ).

| Gói | Thu | Hạ tầng (giữ ≈ 25 ngày) | Hạ tầng nếu MỌI video giữ đủ 90 ngày | Lãi gộp |
|---|---|---|---|---|
| 100 giờ | 179.000 | ≈ 12.500–15.000 | ≈ 43.000 | ≈ 92 % (xấu nhất ≈ 76 %) |
| 500 giờ | 749.000 | ≈ 62.000–75.000 | ≈ 215.000 | ≈ 90 % (xấu nhất ≈ 71 %) |
| 1.000 giờ | 1.290.000 | ≈ 125.000–150.000 | ≈ 430.000 | ≈ 88 % (xấu nhất ≈ 67 %) |

Không có luật xóa thì mỗi giờ quay tốn ≈ 140 đ / tháng: sau ≈ 9–14 tháng lưu là tiền lưu bằng giá bán. Giờ dùng thử gần như không tốn
(≈ 150 đ / giờ). Tiền thật thu được phụ thuộc số shop mua giờ, không phụ thuộc biên.

**Anh chốt cách bán 16/11 tối:** "Mình không thu tiền theo tháng mà chỉ thu theo giờ, khách muốn quay bao nhiêu thì quay, bao giờ hết
thì hết… để khoảng 2-3 gói sẵn còn lại để cho khách nhập số giờ cần mua." → không thu theo tháng; giờ đã mua không hết hạn; màn mua có
2–3 gói sẵn + ô nhập số giờ. Khung 5 gói có bậc giá ở trên BỎ.

**Đề xuất của em cho đơn giá (anh chưa chốt): 1.500 đ / giờ, tính thẳng, không bậc.**

| Đơn giá | Mỗi phút | Mỗi đơn (video 1 phút) | So với thị trường | Lãi gộp hạ tầng |
|---|---|---|---|---|
| 1.200 đ / giờ | 20 đ | 20 đ | rẻ hơn Ship Xanh (22–25 đ / phút) | ≈ 88 % |
| **1.500 đ / giờ** | 25 đ | 25 đ | bằng mức cao của Ship Xanh, dưới Dohana | ≈ 90 % |
| 2.000 đ / giờ | 33 đ | 33 đ | ngang Dohana (≈ 1.800–2.250 đ / giờ) | ≈ 92 % |

Lý do chọn 1.500: tròn, dễ nhẩm; bằng đối thủ có cùng kiểu bán trả trước theo phút; một giá cho mọi số giờ nên ô nhập số giờ tính ra
tiền không có "bậc" gây khó hiểu (mua 499 giờ đắt hơn mua 500 giờ). Gói sẵn 50 / 200 / 500 giờ = 75.000 / 300.000 / 750.000 đ chỉ là
lối tắt, kèm dòng "≈ N video 1 phút" để khách đổi giờ ra số đơn. Mua tối thiểu 20 giờ = 30.000 đ (số tự chọn — mỗi lần mua kéo theo
một hóa đơn và phí cổng thanh toán).

**Hiển thị:** (1) hộp "Mua thêm giờ quay": số dư · 3 gói · ô "Số giờ khác" · dòng "n giờ × 1.500 đ" · nút "Thanh toán X đ" · hai dòng
luật hết giờ; (2) số giờ còn lại ở hàng tab và trên màn quay, đổi vàng / đỏ khi gần hết; (3) sổ giờ trong tab Thống kê: từng lần mua
(ngày, số giờ, số tiền, hóa đơn) và giờ đã dùng theo ngày.

**✅ ANH CHỐT 16/11 tối, sau khi khảo sát lại giá (tài liệu khảo sát mục 60): "1.500 đ một giờ".** Đơn giá giờ quay = 1.500 đ / giờ,
tính thẳng, không bậc; trả trước; không theo tháng; giờ không hết hạn; không trừ VAT. Ba gói sẵn 50 / 200 / 500 giờ và mức mua tối
thiểu 20 giờ vẫn là đề xuất của em. Chưa sửa mã: cấu hình gói và hộp mua trên web còn bản cũ; luồng thanh toán, cộng giờ, xuất hóa đơn
chưa làm.

## 17. Quay video trên app cho NHÂN VIÊN — phương án (18/11/2026, ĐỀ XUẤT, anh CHƯA duyệt, chưa code)

> Anh Trung (thử TestFlight 1.5.0 build 34): "Phần quay video này đang ở tab tổng quan, nhưng với nhân viên kho thì lại không được cung cấp
> quyền xem tổng quan nên cần em thiết kế phương án hợp lý".

**Hiện trạng (đã đọc mã):**
- App: ô "Quay video đóng gói" chỉ ở tab Tổng quan — chỉ CHỦ SHOP có. Nhân viên vào khu Kho; nút QR giữa chỉ hiện khi có quyền `orders`
  (`(warehouse)/_layout.tsx`), trong đó đã có 3 chế độ Xem đơn · Quét nhiều · Đóng gói. Nhân viên chỉ có quyền `warehouse.returns` thì
  không có nút QR, quét nhận hàng hoàn ở Kho → Đơn hoàn (`/scan-returns`).
- Máy chủ: `services/pack-video/access.ts` mở cổng khi email người ĐĂNG NHẬP nằm trong danh sách thí điểm VÀ là chủ tài khoản →
  **nhân viên của admin@hubsell.vn hiện bị chặn 403 FEATURE_LOCKED** (đúng chốt 16/11 "chỉ một tài khoản"), kể cả khi lối vào trên app có.

**Đề xuất:**
1. **Lối vào đóng hàng = chế độ thứ tư của nút QR giữa: Xem đơn · Quét nhiều · Đóng gói · Quay video.** Chủ shop và nhân viên cùng có
   nút QR, người gói hàng vốn đã mở tab này cả ca; app nhớ chế độ dùng lần trước nên mở lại là vào thẳng Quay video. Ô ở Tổng quan giữ làm lối
   tắt cho chủ shop. Tài khoản chưa mở tính năng: KHÔNG hiện chế độ này (app ẩn, giữ chốt 14/11).
2. **Lối vào khui hàng = nút "Quay khui hàng" ở Kho → Đơn hoàn** (mở màn quay ở chế độ khui, `?mode=unbox`) — cho người đối soát hàng hoàn
   không có nút QR; trong màn quay vẫn có công tắc Đóng hàng | Khui hàng hoàn.
3. **Quyền: KHÔNG thêm ô quyền mới** — ai có quyền Đơn hàng (`orders`, đang gói hàng) được quay video đóng hàng; ai có quyền Đối soát đơn
   hoàn (`warehouse.returns`) được quay khui hàng. Chủ shop không phải cài thêm gì. Xem / tải video trên web vẫn CHỈ chủ shop (như hiện tại).
4. **Máy chủ:** cổng tính theo CHỦ SHOP — email của chủ (tra theo `ownerId`) nằm trong danh sách thí điểm thì cả nhân viên của chủ đó
   được dùng. Các đường GHI (`POST /`, `/parts`, `/complete`, `/match`) cho nhân viên theo quyền ở mục 3 (khui = `warehouse.returns`, đóng
   = `orders`); các đường ĐỌC (danh sách, tải về, thống kê) giữ chủ shop. `features.packVideo` trả cho nhân viên theo cùng luật. Video ghi
   `recordedById` = nhân viên → cột "Người quay" + thống kê theo người quay chạy luôn (K4). Tra email chủ = một câu theo khóa chính mỗi
   lượt gọi (hoặc đệm 60 giây) — không tốn đáng kể.
5. **Về sau (không làm lượt này):** gộp quay vào chế độ Đóng gói — quét tem vừa chuyển "Đã đóng gói" vừa quay, một thao tác (đúng "khách
   cần một nút"); phải thay camera của màn Đóng gói sang thư viện mới nên để sau khi bản thử ổn.

**Đụng prod:** mục 4 là sửa máy chủ (push + deploy); mục 1–2 là app (bản TestFlight nhánh thử). Chờ anh duyệt.

### 17.1 Anh đổi lối vào (18/11): "Thêm quyền nhân viên vào nút QR thì rối quá… trong phần 'Đơn hàng' trên app mình thêm một tab là 'Quay video gói hàng'"

→ BỎ đề xuất "chế độ thứ tư ở nút QR". Lối vào = tab con **"Quay video gói hàng"** trong **Đơn hàng**, theo khuôn tab con sẵn có của Kho
(`SegmentedTabs` Tồn kho | Đơn hoàn trong `screens/KhoScreen.tsx`).

Vướng đã đọc mã: **chỉ CHỦ SHOP có tab Đơn hàng** (`(admin)/_layout.tsx`: Trang chủ · Đơn hàng · QR · Kho · Cấu hình). Khu nhân viên chỉ
có Kho · QR · Cấu hình (`(warehouse)/_layout.tsx`) — nhân viên không có "Đơn hàng" nào để đặt tab con. Hai cách cho nhân viên (CHỜ ANH CHỌN):
- **(A) Thêm tab dưới "Đơn hàng" cho nhân viên có quyền Đơn hàng** (Kho · Đơn hàng · QR · Cấu hình), bên trong cùng hai tab con như chủ shop:
  Danh sách đơn | Quay video gói hàng. Một chỗ cho mọi người, dễ chỉ việc ("vào Đơn hàng → Quay video"); nhân viên thấy thêm danh sách đơn
  — đúng phạm vi quyền Đơn hàng họ đã có trên web. Em nghiêng về cách này.
- **(B) Nhân viên: thêm tab con "Quay video gói hàng" vào Kho** (Tồn kho | Đơn hoàn | Quay video), chủ shop đặt ở Đơn hàng. Ít đụng hơn
  nhưng hai vai hai chỗ.
Phần còn lại của mục 17 giữ: nút "Quay khui hàng" ở Kho → Đơn hoàn; quyền theo `orders` / `warehouse.returns`, không thêm ô quyền; cổng máy
chủ tính theo chủ shop (nhân viên của chủ thí điểm được ghi video); xem / tải trên web vẫn chỉ chủ shop.

## 18. NHIỀU BÀN trên một máy + đường truyền khi hàng chục nghìn shop đóng hàng cùng lúc (18/11/2026 — ĐỀ XUẤT, anh CHƯA duyệt, chưa code)

> Anh Trung 18/11: "anh đang muốn đẩy sớm kế hoạch làm nhiều màn hình quay video đóng hàng như lúc trước mình đã khảo sát. Yêu cầu làm như
> một senior thực thụ, phòng trước các rủi ro về đường truyền, khi có hàng chục nghìn shop đóng hàng cùng lúc".

Nền không làm lại: khảo sát mục 53 (nguyên lý tải lên quy mô lớn), 57 (thử R2), 62 (các cách nhiều bàn + đo 2 camera / 1 tab), 63 (đối
thủ). Mức chắc: **[C]** đo / đọc mã / trang gốc · **[S]** suy ra hoặc số em tự chọn.

### 18.1 Kết luận trước

1. **Phía Cloudflare R2 không phải chỗ lo.** Trang giới hạn R2 (đọc lại 18/11, developers.cloudflare.com/r2/platform/limits) không có trần
   tốc độ đọc / ghi tệp theo bucket; trần duy nhất đụng tới mình là **ghi cùng MỘT tên tệp tối đa 1 lần / giây** (vượt → 429) [C]. Tên tệp
   của mình dựng từ `clientId` riêng mỗi clip, lần thử lại cách nhau ≥ 2 giây → không chạm.
2. **Chỗ vỡ thật nằm ở hai đầu: trình duyệt của shop và máy chủ Hubsell.** Mã đang chạy được viết cho MỘT bàn, MỘT tài khoản thí
   điểm. Nhân lên nhiều bàn, nhiều shop thì có 4 chỗ sẽ vỡ (mục 18.3). Phải sửa các chỗ đó TRƯỚC khi dựng màn lưới, vì màn lưới nhân rủi ro
   lên theo số bàn.
3. Thứ tự đề xuất: **M0 đo → M1 hàng chờ bền → M2 máy chủ nhẹ đi → M3 màn Nhiều bàn → M4 thử chịu tải**; M5 (tách tiến trình video,
   vé tải lên không ghi database) chỉ làm khi số của M4 đòi.

### 18.2 Bài toán bằng số

Giả định [S]: shop dùng video quay trung bình 200 video / ngày, 1 phút / video; 50 % video dồn vào 4 giờ cao điểm; lúc nhọn gấp đôi trung
bình giờ cao điểm. Cỡ tệp 5,7–6,2 MB / phút, bitrate thật tới 978 kbps khi đặt 800k [C, mục 13].

| | 1.000 shop | 10.000 shop | 30.000 shop |
|---|---|---|---|
| Video / ngày | 0,2 triệu | 2 triệu | 6 triệu |
| Video bắt đầu tải / giây lúc nhọn | ≈ 14 | ≈ 140 | ≈ 420 |
| Dữ liệu đổ vào R2 lúc nhọn | ≈ 0,7 Gbps | ≈ 6,7 Gbps | ≈ 20 Gbps |
| Lượt gọi máy chủ Hubsell lúc nhọn — **mã hiện tại** (≈ 5 lượt / video, xem dưới) | ≈ 70 / giây | ≈ 700 / giây | ≈ 2.100 / giây |
| Lượt ghi database lúc nhọn — mã hiện tại (2 lượt / video) | ≈ 28 / giây | ≈ 280 / giây | ≈ 840 / giây |
| Lượt gọi máy chủ — **sau M2** (≈ 2,2 lượt / video) | ≈ 30 / giây | ≈ 310 / giây | ≈ 920 / giây |
| Giao dịch ghi database — sau M2 (gộp 10 video / lượt) | ≈ 3 / giây | ≈ 28 / giây | ≈ 84 / giây |

**≈ 5 lượt / video của mã hiện tại [C, đọc mã]:** `/match` lúc giơ tem · `POST /` · `POST /:id/complete` · và mỗi clip lên xong, màn quay
làm mới CẢ nhóm truy vấn `["pack-videos"]` (`use-pack-recorder.ts:96`) → thêm danh sách + số giờ. Một tab 6 bàn = 6 lần làm mới mỗi vòng
clip — vô ích, vì người đóng hàng không nhìn danh sách.

**Phía một shop (một máy, N bàn):** đường lên cần ≈ N × 1 Mbps trong lúc mọi bàn cùng quay (6 bàn ≈ 6 Mbps) — cáp quang thường dư [S], 4G
phát Wi-Fi thì không chắc. RAM: mỗi clip nằm trọn trong RAM tới khi kết thúc (`fastStart: "in-memory"`, `clip-pipeline.ts:350`) rồi nằm
tiếp trong RAM tới khi lên kho → 6 bàn quay đơn 15 phút ≈ 550 MB chỉ riêng clip đang quay; mất mạng 1 giờ với 6 bàn ≈ **2,2 GB dồn trong
RAM** → tab sập → mất hết.

### 18.3 Bốn chỗ sẽ vỡ trong mã hiện tại [C, đọc mã 18/11]

| # | Chỗ | Vì sao vỡ khi nhiều bàn / nhiều shop |
|---|---|---|
| V1 | Clip chờ tải chỉ nằm trong RAM (`lib/pack-video-recorder/session.ts`, biến cấp module) | tải lại trang, Chrome sập, máy khởi động lại → mất mọi clip chưa lên. Một bàn thì mất vài clip; 6 bàn mất cả giờ đóng hàng. Trái chốt 18/11 "bắt buộc phải lưu trên hệ thống hết" |
| V2 | Thử 4 lần (nghỉ 2 / 5 / 15 giây) rồi BỎ, chờ người bấm "Thử lại" | máy nhiều bàn chạy không người nhìn; mạng chập 30 giây là clip nằm chết trong RAM tới cuối ca. Khoảng nghỉ lại CỐ ĐỊNH, không lệch ngẫu nhiên → sau một sự cố, mọi shop thử lại cùng nhịp (dồn sóng) |
| V3 | ≈ 5 lượt gọi máy chủ / video, 2 lượt ghi database / video | mục 18.2: 700–2.100 lượt / giây đổ vào máy chủ web đang chung với toàn bộ app (web Render từng hết bộ nhớ 21/10, 03/11); database từng cạn Disk IO 28/10 |
| V4 | `/match` tra `Order.trackingCode` không có chỉ mục (`services/pack-video/order-match.ts`; `Order` chỉ có chỉ mục bắt đầu bằng `channelId`) | mỗi lần giơ tem lọc qua đơn của mọi gian của shop; shop lớn × hàng trăm lượt / giây = đúng kiểu câu đã làm cạn Disk IO. Ghi chú trong mã đã dặn EXPLAIN trước khi mở cho khách |

### 18.4 Sổ rủi ro đường truyền (bổ sung mục 6)

| # | Rủi ro | Chặn bằng | Chứng minh bằng |
|---|---|---|---|
| N1 | Mất clip khi tab / máy sập (V1) | **Hàng chờ bền trên ổ đĩa của trình duyệt** (OPFS): clip ghi THẲNG xuống ổ trong lúc quay (RAM không phình theo độ dài clip), sổ hàng chờ ở IndexedDB, mở lại trang là tự tải tiếp; xin `navigator.storage.persist()` để trình duyệt không tự dọn. Lên kho xong là xóa tệp. **Đây không phải "lưu local"**: không có nút xem / giữ video trên máy, tệp chỉ là hàng đang chờ gửi | test: quay 3 clip, rút mạng, tải lại trang, cắm mạng → cả 3 lên kho, ổ trống |
| N2 | Bỏ cuộc sau 4 lần (V2) | thử lại KHÔNG giới hạn, chờ tăng dần tới trần 5 phút [S] + lệch ngẫu nhiên toàn phần; mất mạng (`offline`) thì đứng chờ, có mạng lại (`online`) thì chạy ngay; chỉ dừng hẳn với lỗi không thể thử lại (hết quyền, tệp hỏng) | test hàm thuần: dãy thời gian chờ; test tay: rút mạng 10 phút |
| N3 | Dồn sóng sau sự cố (mọi shop cùng thử lại) | lệch ngẫu nhiên ở N2; máy chủ trả 429 / 503 kèm `Retry-After` khi quá tải, trình duyệt tuân theo; mỗi tab chỉ 1 lượt PUT một lúc | M4: giả lập 10.000 tab cùng nối lại |
| N4 | Mạng tải lên của shop chậm hơn tốc độ quay | đo tốc độ tải thật trong tab; dải vàng "Mạng tải lên chậm hơn tốc độ quay — đang chờ N clip (≈ M phút)"; KHÔNG dừng quay (cảnh báo, không khóa) | test tay: giới hạn mạng trong DevTools |
| N5 | Ổ đĩa đầy vì hàng chờ dài | cảnh báo khi chỗ trống trình duyệt cho < 5 GB [S]; chỉ ngừng MỞ clip mới khi < 1 GB [S] (hết chỗ thì quay cũng không giữ được); clip đang quay luôn được quay nốt | test hàm thuần với `storage.estimate()` giả |
| N6 | Sự cố cáp biển quốc tế (Việt Nam từng có đợt cả 5 tuyến cùng lỗi — kiến thức chung, chưa tra lại [S]) | N1 + N2 gánh được nhiều giờ dồn; dải báo "đang chờ" cho shop biết video chưa mất | chấp nhận: không có đường vòng nào rẻ |
| N7 | Đường dẫn ký sẵn hết hạn khi hàng chờ dài | xin vé NGAY trước mỗi lượt PUT (mã hiện tại đã vậy), không xin sẵn hàng loạt | đã có |
| N8 | Ghi cùng tên tệp > 1 lần / giây → R2 429 | tên tệp theo `clientId`; khoảng thử lại ≥ 2 giây | đã có |
| N9 | Máy chủ bị gọi thừa (V3) | M2: bỏ làm mới danh sách sau mỗi clip (gộp, tối đa 1 lần / 30 giây [S], chỉ khi màn đang hiện); chốt tải theo LÔ (`complete-batch` tối đa 20 video [S], một câu `INSERT … ON CONFLICT DO NOTHING` / `UPDATE` gộp) | đếm lượt gọi / video trong M4 |
| N10 | `/match` quét bảng `Order` (V4) | EXPLAIN chỉ đọc trên prod với shop lớn nhất → nếu quét rộng thì đề xuất chỉ mục riêng phần (`trackingCode` không rỗng) và **chờ anh duyệt** (không tự thêm chỉ mục vào `Order`) | số EXPLAIN trước / sau |
| N11 | Một shop lỗi vòng lặp gọi máy chủ liên tục | hạn mức theo chủ shop trên các đường video (token bucket, số [S] chọn sau M4) → 429 | test |
| N12 | Lưu lượng video làm sập app chính | M5, chỉ khi M4 đòi: tách các đường video sang một tiến trình riêng cùng mã nguồn | M4 |
| N13 | Máy ngủ / khóa màn / Chrome tự đóng tab | Wake Lock giữ màn sáng khi đang có bàn bật; dải đỏ khi trang bị ẩn lúc đang quay; Chrome có tự bỏ tab đang dùng camera không — [S], thử ở M0 | M0 |
| N14 | Máy không đủ sức mã hóa N luồng (bộ mã hóa phần cứng có trần số phiên, hết thì Chrome lùi sang mã hóa bằng CPU) [S] | M0 đo; mỗi ô hiện "phần cứng / CPU"; quá tải thì báo "máy này nên tối đa N bàn" | M0 |
| N15 | Băng thông USB theo bộ điều khiển (mục 62.2 khảo sát) | M0 đo với webcam của anh; câu hướng dẫn cắm | M0 |
| N16 | Một bàn mất camera kéo các bàn khác | mỗi ô một đường quay + đọc tem + hàng chờ riêng; lỗi ô nào chỉ ô đó đỏ | test tay rút một webcam |
| N17 | Cùng tem giơ ở hai bàn / hai máy | sổ "tem đã quay rồi" dùng chung mọi ô trong tab; khác máy thì dựa `hasPackVideo` mà `/match` đã trả → báo "đã quay rồi ở chỗ khác" | test |

### 18.5 Các lát

| Lát | Có gì | Ai thấy | Database / prod |
|---|---|---|---|
| **M0 đo** (không mã sản phẩm) | trên trang thử `tools/thu-webcam/`: 3–4 webcam anh có sẵn cắm cùng máy — khung / giây từng camera, CPU, mã hóa phần cứng hay CPU, chạy 30 phút không rớt USB; ghi clip thẳng xuống ổ (OPFS) đo tốc độ + so hai cách đặt `moov` (mediabunny `fastStart: "reserve"` cần khai trước số khung tối đa → đo MB đệm thừa ở clip ngắn; hay để `moov` cuối tệp → trình phát trên web có tua được không); tắt mạng 30 phút rồi bật | không ai | không |
| **M1 hàng chờ bền** | N1, N2, N4, N5, N7 cho màn quay HIỆN TẠI (một bàn) — có ích ngay cả khi chưa có lưới | chỉ `admin@hubsell.vn` | không |
| **M2 máy chủ nhẹ đi** | N9, N10 (EXPLAIN + đề xuất), N11, 429 + `Retry-After` (N3) | không ai thấy khác | có thể một chỉ mục — chờ anh duyệt |
| **M3 màn Nhiều bàn** | phác thảo mục 62.6 khảo sát: công tắc 1 bàn \| Nhiều bàn, lưới ô, camera nhớ theo ô, "Bật tất cả", âm báo theo bàn bằng tệp thu sẵn, nhật ký chung lọc theo bàn, N13, N14, N16, N17 | chỉ `admin@hubsell.vn` | không |
| **M4 thử chịu tải** | kịch bản giả lập 1.000 → 10.000 shop gọi các đường video ở LOCAL (không gọi prod, không tải tệp thật lên R2): lượt / giây, độ trễ p95, kết nối database | không ai | không |
| M5 (khi M4 đòi) | tách tiến trình video; vé tải lên không ghi database (ghi một lần lúc chốt) | không ai thấy khác | đổi luồng ghi sổ |

Vì sao M1–M2 trước M3: lưới nhân rủi ro theo số bàn, còn M1–M2 làm màn một bàn đang chạy bền hơn ngay.

**Đụng nhau với lịch 20:00 18/11** (tác vụ mua giờ + luật xóa, cùng vùng `services/pack-video/`): M1 chỉ đụng web; M2 đụng backend →
bắt đầu sau khi tác vụ 20:00 xong để khỏi giẫm tệp.

### 18.6 Chờ anh

| # | Câu | Em đề nghị |
|---|---|---|
| N-a | Duyệt làm M0 (anh cắm 3–4 webcam có sẵn vào một máy) | có — chưa đo mà dựng lưới là đoán |
| N-b | Hàng chờ bền trên ổ đĩa (N1) — tệp tạm tự xóa khi đã lên kho, không có nút giữ / xem trên máy — có trái chốt "bỏ lưu local" không? | không trái: nó là cách để video CHẮC CHẮN lên hệ thống |
| N-c | Số bàn tối đa một máy hiện trong lưới | để M0 quyết; tạm 4 |

### 18.7 M0 — số đo lượt 1 (18/11 ~13:00, anh: "anh đang cắm được 2 webcam thôi. Em cứ test M0 đi")

Trang đo mới `tools/thu-webcam/nhieu-ban.html` (+ `nhieu-ban.js`, dùng lại khối của trang thử): mỗi camera = một bàn, in ngày giờ →
H.264 → ghi THẲNG xuống OPFS qua `StreamTarget` của mediabunny, cắt clip mỗi N giây, clip lẻ `moov` dành chỗ trước, clip chẵn `moov` cuối
tệp, đọc tem trong Worker 200 ms / lần; số đo tự ghi ra `m0_<giờ>.json` mỗi 10 giây. Máy anh: i5-10400F (không có GPU tích hợp) + GTX
1650 SUPER.

- **Hai webcam KHÔNG mở cùng lúc [C] — xem phép thử dứt điểm 13:20 ở dòng 13:05–13:20 dưới:** Chrome
  thấy Web Camera (cb07:1bcf), Logi C270 (046d:0825) và đầu thu HDMI có sẵn. Trước 13:09, mở con nào trước thì con sau báo
  `NotReadableError`, ở mọi cỡ kể cả 640×480; từng con một mình thì được. Cả hai cắm chung bộ chia `Generic USB Hub` 067B:2586.
- **2 bàn (Web Camera + đầu thu HDMI), 3 phút, clip 30 giây [C]:** cả hai đạt 29–30 khung / giây (thấp nhất 28,9), 5.379 / 5.399 khung
  vào = khung đã mã hóa, **0 khung bỏ**, hàng chờ bộ mã hóa lớn nhất 6, mã hóa trung bình 12–13 ms (lớn nhất ≈ 190 ms); đọc tem trung bình
  50 ms, 0 lượt bị bỏ; bộ mã hóa nhận `prefer-hardware`; bộ đếm Windows "GPU VideoEncode" 11–16 % (= mã hóa bằng NVENC của card), CPU
  toàn máy 11–29 %; JS heap ≈ 10 MB; Chrome tổng ≈ 1,6 GB RAM riêng (cả các tab khác của anh).
- **Ghi thẳng xuống ổ chạy [C]:** ghi theo khúc 1 MiB, trung bình 4–5 ms / lần; chốt tệp 8–22 ms; đọc lại / xóa xong ổ về 0 tệp.
- **⛔ `moov` dành chỗ trước (`fastStart: "reserve"`) KHÔNG dùng được [C]:** dành chỗ cho trần 60 phút độn **4.984.282 byte (≈ 4,75 MB) vào
  MỖI clip** bất kể clip dài bao lâu → clip 30 giây 3,4 MB thành 8,4 MB. **`moov` cuối tệp (`fastStart: false`) chỉ thêm ≈ 6 KB**, tua được
  trong Chrome (nạp thông tin 44 ms, tua giữa 92 ms, tua cuối 34 ms — trên máy, chưa qua mạng tới R2: thêm một lượt hỏi đoạn cuối tệp).
  → hàng chờ bền M1 dùng `moov` cuối tệp, ghi dần xuống ổ.
- **Bẫy [C]:** khai `frameRate` cho rãnh video của mediabunny làm mốc thời gian bị bắt về lưới 1/30 giây → hai khung trùng giờ. Mã sản phẩm
  không khai (đúng); trang đo đã bỏ. Sau khi bỏ: mốc tăng đều 598 / 598 gói.
- **Ổ trình duyệt [C]:** hạn mức Chrome cho trang = 10 GB; `navigator.storage.persist()` trả **false** (Chrome không hứa giữ, khi máy chật ổ
  có thể tự dọn) → N1 không được coi ổ trình duyệt là chắc chắn; trên app.hubsell.vn phải thử lại (Chrome cho `persist` theo mức dùng trang).
- Chưa đo: 2 WEBCAM thật cùng lúc trong MỘT tab; chạy 30 phút; Chrome có tự bỏ tab đang dùng camera không.
- **13:05–13:15 kiểm thêm [C]:** trước khi cắm lại, hạ cả hai xuống 640×480 · 15 khung / giây vẫn `NotReadableError`. Anh rút ra cắm lại
  13:09:35 (C270) và 13:10:51 (Web Camera), vẫn chung bộ chia 067B:2586. Anh: "anh thử trên chrome nick admin@hubsell.vn vẫn được mà" —
  sổ camera của Windows ghi Chrome giữ camera từ 13:11:29 (tab của anh, Web Camera), và lúc 13:12 trang đo của em **mở được C270
  1280×720@30 cùng lúc** → em đã vội rút kết luận "do chung bộ chia". **Phép thử dứt điểm 13:20 [C] cho thấy rút như vậy là SAI:** Chrome
  cho nhiều tab DÙNG CHUNG một camera, nên lượt 13:12 chỉ là dùng chung C270 với tab của anh. Thử lại có kiểm soát (anh đã tắt tab quay):
  tab 1 giữ Web Camera → tab 2 mở C270 = `NotReadableError`; tab 1 giữ C270 → tab 2 mở C270 = chạy (dùng chung), tab 2 mở Web Camera =
  `NotReadableError`; trong một tab, thứ tự nào cũng chỉ một con chạy. → **Hai webcam này trên bộ chia 067B:2586 KHÔNG chạy cùng lúc, kể
  cả khác tab, kể cả 640×480 · 15 khung / giây, kể cả ngoài Chrome (ffmpeg)**. Đầu thu HDMI cắm thẳng gốc thì chạy cùng Web Camera. Chưa
  chứng minh hết được là do bộ chia hay do cặp webcam này — chỉ chắc khi tách một con sang cổng sau thùng máy.
  Thử lại lần nữa theo lời anh ("camera đang tắt mà"), Windows xác nhận không ứng dụng nào giữ camera: Web Camera trước → C270 hỏng;
  C270 trước → Web Camera hỏng. Kết quả không đổi.
  **Anh xác nhận ~13:30: "Tất cả anh đều không cắm vào cây máy tính mà đều cắm vào ổ chia"** → bộ chia 067B:2586 là ổ chia USB rời của
  anh; cả hai webcam đi chung MỘT đường lên máy. Khớp với mọi số đo trên. Đây là cách cắm khách sẽ hay làm nhất (máy ít cổng, bàn đóng hàng
  xa máy) → hướng dẫn khách + câu báo lỗi của màn nhiều bàn phải nói thẳng "mỗi webcam cắm thẳng một cổng trên máy, không qua ổ chia".
  Còn phải đo: một webcam cắm thẳng máy + một qua ổ chia (cách cắm tối thiểu cho 2 bàn); ổ chia USB 3.0 có gánh được 2 webcam không [S].
  Bài học: (1) khi kiểm "có chạy cùng lúc không" phải tắt hết tab khác đang dùng camera, vì Chrome dùng chung thiết bị giữa các tab;
  (2) màn nhiều bàn gặp `NotReadableError` ở một ô khi ô khác đang chạy → câu báo "camera này không chạy chung được với camera khác trên
  cùng cổng — cắm sang cổng USB khác (nên là cổng phía sau máy)" + nút thử lại.

### 18.8 M0 — lượt bền 30 phút, 3 bàn một tab (18/11 13:20–13:51) [C]

Cách cắm: C270 cắm THẲNG máy (anh "Đã cắm thẳng"), Web Camera vẫn qua ổ chia, đầu thu HDMI cắm thẳng → cả 3 mở cùng lúc ngay (chứng minh
ngược cho 18.7: tách khỏi ổ chia là chạy). Cấu hình: 1280×720, đặt 30 khung / giây, 800 kbps, `prefer-hardware`, cắt clip mỗi 60 giây,
clip lẻ / chẵn hai kiểu `moov`, đọc tem 200 ms / lần mỗi bàn, ghi thẳng xuống OPFS rồi xóa sau khi "tải".

| | Web Camera (qua ổ chia) | Đầu thu HDMI (không tín hiệu) | Logi C270 (cắm thẳng) |
|---|---|---|---|
| Khung vào = đã mã hóa | 53.810 = 53.810 | 53.989 = 53.989 | 53.404 = 53.404 |
| Khung bỏ / lỗi bộ mã hóa | 0 / 0 | 0 / 0 | 0 / 0 |
| Khung / giây thấp nhất · trung bình | 28,6 · 29,9 | 28,5 · 30,0 | **14,0** · 29,7 |
| Mã hóa ms trung bình · lớn nhất | 16,8 · 382 | 18,4 · 257 | 16,8 · 216 |
| Đọc tem: số lần · ms trung bình · bị bỏ lượt | 8.349 · 44 · 0 | 8.363 · 45 · 0 | 8.335 · 41 · 0 |
| Clip xong / lỗi | 30 / 0 | 30 / 0 | 30 / 0 |
| MB / phút (`moov` cuối tệp) | 5,74–5,84 | 0,36 | 5,84–7,66 |
| Chốt tệp lớn nhất · lần ghi ổ lâu nhất | 65 ms · 41 ms | 51 ms · 38 ms | 83 ms · 47 ms |

Toàn máy (mẫu 15 giây, 124 mẫu): CPU trung bình 19,8 %, lớn nhất 38,4 % (gồm cả việc khác của anh); bộ mã hóa video của card (NVENC, GTX
1650 SUPER, driver 610.88) trung bình 16,4 %, lớn nhất 22,1 % cho 3 luồng → ≈ 5–7 % / luồng; RAM riêng của Chrome 1.925 MB đầu lượt →
1.762 MB cuối lượt (KHÔNG phình), 1.455 MB sau khi dừng; JS heap trang 12 MB; ổ trình duyệt về 0 tệp. **Không có sự kiện rớt camera / đổi
thiết bị nào trong 30 phút.** Tab bị ẩn / hiện 10 lần (anh chuyển cửa sổ) mà khung vẫn về đủ ≈ 99,6 % → đường lấy khung không đứng khi ẩn tab.

Rút ra:
- **Một máy tầm trung (i5-10400F + GTX 1650 SUPER) gánh 3 bàn còn dư nhiều**: card mới dùng ≈ 1/5 sức mã hóa, CPU < 40 %. Trần số bàn chưa
  chạm; trần số phiên mã hóa phần cứng của card GeForce theo driver [S, chưa tra lại] → bài kế: 4–6 luồng (nhân đôi luồng của một camera
  được, không cần thêm webcam).
- **Ghi thẳng xuống ổ trình duyệt đủ nhanh và RAM phẳng** → hướng hàng chờ bền M1 (`moov` cuối tệp, ghi dần) có số đo đỡ.
- **Đặt 800 kbps mà C270 ra tới 7,66 MB / phút (≈ 1 Mbps)** — bộ mã hóa phần cứng vượt bitrate với hình nhiều chi tiết; cỡ tệp tính tiền
  lưu phải dùng 6–7,7 MB / phút, không phải 6.
- **C270 tụt 14–15 khung / giây lúc đầu lượt** (trung bình vẫn 29,7) — tự hạ tốc độ khi thiếu sáng [S]; video vẫn đúng giờ, chỉ kém mượt
  → tiêu chí "webcam chuẩn" thêm: giữ 30 khung / giây dưới đèn bàn đóng hàng.
- Đọc tem 3 bàn cùng lúc không nghẽn (0 lượt bị bỏ). Lượt này không giơ tem nên chưa đo tem ↔ đúng bàn.

Chưa đo (M0 còn lại): 4–6 luồng; giơ tem ở nhiều bàn cùng lúc; Chrome có tự bỏ tab đang quay khi máy chật RAM không; `persist()` trên
app.hubsell.vn. Phần "tắt mạng 30 phút" chuyển sang M1 (chưa có hàng chờ bền thì chưa có gì để đo).

### 18.9 M0 — 4 và 6 luồng + ổ trình duyệt trên app.hubsell.vn (18/11 13:55–14:12) [C]

Máy chỉ có 3 nguồn hình nên bàn thứ 4–6 là bàn **nhân bản**: mở lại cùng thiết bị (Chrome dùng chung luồng camera), mỗi bàn vẫn có bộ in
ngày giờ + bộ mã hóa + bộ đọc tem + tệp riêng → tải mã hóa / đọc tem / ghi ổ là thật, chỉ phần USB không nhân lên (`addClones()` trong
`nhieu-ban.js`). Mỗi lượt 5 phút, cắt clip 60 giây.

| | 4 bàn | 6 bàn |
|---|---|---|
| Khung bỏ / lỗi bộ mã hóa / clip lỗi | 0 / 0 / 0 | 0 / 0 / 0 |
| Khung / giây thấp nhất | 25,9 (một lần giật cùng lúc cả 4 bàn khi em mở trang app.hubsell.vn ở tab khác) | 28,8 |
| Mã hóa ms trung bình · lớn nhất | 12–15 · 571 (cùng lần giật trên) | 13–18 · 114 |
| Đọc tem ms trung bình · bị bỏ lượt | 33–44 · 0 | 32–41 · 0 |
| Phiên mã hóa phần cứng đang chạy (`nvidia-smi`) | 4 | 6 |
| NVENC trung bình · lớn nhất | 21,6 % · 24,4 % | 27,0 % · 33,5 % |
| CPU toàn máy trung bình · lớn nhất | 20,8 % · 25,9 % | 25,7 % · 30,2 % |
| RAM riêng Chrome | — | 2.225 MB (cả các tab khác) |

→ **6 bàn trên máy i5-10400F + GTX 1650 SUPER chạy thoải mái** (card ≈ 1/3 sức, CPU ≈ 1/4); card GeForce với driver 610.88 cho ít nhất 6
phiên mã hóa phần cứng cùng lúc. Một trang khác nặng mở cùng lúc làm cả lưới giật ≈ 0,5 giây nhưng KHÔNG mất khung (hàng chờ bộ mã hóa
gánh). Trần thật chưa chạm — máy không có card rời (chỉ GPU tích hợp / mã hóa bằng CPU) mới là ca phải đo tiếp, vì nhiều máy văn phòng của
shop là loại đó [S]. Đề nghị N-c: lưới mặc định tối đa 6 bàn; ô thứ 7 trở đi chỉ mở khi máy báo mã hóa phần cứng (số tự chọn).

**Ổ trình duyệt trên app.hubsell.vn (Chrome của anh):** `persist()` **= true** (Chrome đồng ý giữ, khác trang thử 127.0.0.1 = false vì ít
dùng) → hàng chờ bền trên sản phẩm được Chrome giữ, không tự dọn khi chật ổ. Nhưng hạn mức Chrome báo **10 GB** trong khi **ổ C (nơi có hồ
sơ Chrome) chỉ còn 2,4 GB trống** → con số `storage.estimate()` KHÔNG phản ánh chỗ trống thật. 4 bàn ≈ 30 MB / phút → mất mạng ≈ 80 phút
là đầy ổ C của anh. → M1 (N5): không chặn theo `estimate()`; phải bắt lỗi ghi `QuotaExceededError` / lỗi ổ đầy ngay khi ghi khúc, báo đỏ
"ổ đĩa máy sắp đầy — video đang chờ gửi", và đo chỗ trống bằng lần ghi thật chứ không bằng con số báo.

**M0 xong**, trừ hai việc để sau: giơ tem ở nhiều bàn cùng lúc (cần người giơ tem; đọc tem từng bàn đã chứng minh 16/11 và không nghẽn ở
6 bàn), và máy không có card rời.
