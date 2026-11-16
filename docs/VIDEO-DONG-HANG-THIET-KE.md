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
