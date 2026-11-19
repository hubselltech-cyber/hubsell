# Video đóng hàng — bản thiết kế (16/11/2026)

> **Trạng thái 16/11/2026: W1a–W4 + sổ giờ ĐÃ PUSH `b0040067` (anh: "Em cứ push lên trước") — xem mục 10, 11, 12.**
> **18/11/2026 tối (mục 19, LOCAL, chưa commit):** hộp mua giờ giá 1.500 đ + chặn hết giờ + luật tự xóa CHẠY BÓNG + bảng gộp giờ theo
> ngày + dọn video khi xóa tài khoản (sau cờ). Nối cổng thanh toán + hóa đơn cho khoản mua giờ CHỜ anh (19.8).
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

### 17.2 Khảo sát lại 18/11 21:00 (lịch anh hẹn) — CHỈ KHẢO SÁT, chưa code, chưa đụng prod

**[C]** = đã mở mã đọc tận dòng · **[S]** = suy ra, chưa chạy thử. Không dựng app, không gọi máy chủ nào trong lượt này.

#### a) Cách A so với cách B

| | **(A) Nhân viên có thêm tab "Đơn hàng"** | **(B) Tab con "Quay video" nằm trong Kho của nhân viên** |
|---|---|---|
| Tệp đụng (app) | `(admin)/orders.tsx` (915 dòng) dời ruột sang `screens/OrdersScreen.tsx`, tệp cũ còn 3 dòng gọi lại; thêm `(warehouse)/orders.tsx`; `(warehouse)/_layout.tsx` thêm tab; tab con mới + màn quay | `screens/KhoScreen.tsx` thêm ô thứ ba; chủ shop vẫn phải sửa `(admin)/orders.tsx` để có tab con → hai nơi |
| Nhân viên thấy thêm gì | danh sách đơn: mã đơn, tên khách, tên gian, món hàng, **tổng tiền đơn**, "Chưa thanh toán / Đã hoàn tiền"; bấm vào đơn ra hộp chi tiết có **phí sàn + tiền sàn trả về** | không thêm gì |
| Có lộ lãi / lỗ, giá vốn không | **Không.** `OrderDto` của app không có trường giá vốn / lợi nhuận [C `types/api.ts:112–144`]; khối thanh toán máy chủ ghi rõ "cố ý KHÔNG có giá vốn / lợi nhuận — màn quét ai cầm máy cũng xem được" [C `routes/orders.ts:1656–1667`] | — |
| So với hiện tại | Nhân viên quyền `orders` **đã xem được đúng các số đó** qua nút QR giữa (cùng `OrderDetailPanel`, cùng `lookup?detail=1`) [C]; trên web họ mở cả trang Đơn hàng, `orders/page.tsx` không có nhánh nào theo vai [C]. → (A) không mở thêm số tiền nào, chỉ thêm **dạng danh sách** | — |
| Nút bấm mới rơi vào tay nhân viên | "Trả lời sàn" khi khách xin hủy (`CancelRequestBar`), "Thống kê" bốc hàng, "Đóng gói". Máy chủ gác cả ba bằng quyền `orders`, không đòi chủ shop [C `app.ts:235–236`, `orders.ts:508, 581`] → nhân viên đã làm được trên web, chỉ là chưa có trên app | không |
| Gian bị giới hạn | `/api/orders` đi qua `requireChannel` → nhân viên chỉ thấy đơn gian được giao [C `app.ts:236`] | — |

**Rủi ro cho khách đang dùng 1.4.3:**
- Bản 1.4.3 trên máy khách **không đổi gì**: phần quay cần thư viện camera gốc mới nên chỉ có ở bản dựng 1.5.0, không vá từ xa vào 1.4.3 được. Bản 1.4.3 cũng không đọc `features.packVideo` [C: tìm cả `hubsell-mobile/src` không có chữ này] → sửa máy chủ theo mục (d) không ảnh hưởng app cũ.
- Rủi ro thật nằm ở **bản 1.5.0 khi lên kho**: (A) thêm tab cho nhân viên của MỌI khách có quyền `orders`, không riêng tài khoản thí điểm → chạm chốt 14/11 "chưa có lệnh mở thì tài khoản khác không thấy gì". Em đề nghị: trong giai đoạn thí điểm, tab "Đơn hàng" của nhân viên **chỉ hiện khi chủ của họ đã được mở video** — nhân viên của khách khác giữ nguyên Kho · QR · Cấu hình.
- ⚠️ Vướng bố cục em mới thấy: `AppTabBar` chia đều các ô (`flex-1`) [C] → nút QR chỉ nằm chính giữa khi số tab LẺ. Nhân viên có 4 tab thì QR lệch. Hai lối: chấp nhận "Đơn hàng · Kho · [QR] · Cấu hình" (QR lệch phải), hoặc xếp "Kho · Đơn hàng · [QR] · Cấu hình" — cả hai đều lệch; muốn giữa thì phải 3 hoặc 5 tab. Cần anh nhìn rồi chọn (câu C3).
- Dời 915 dòng sang tệp khác là việc cơ học nhưng đụng màn chủ shop dùng hằng ngày → phải soi lại màn Đơn hàng của chủ shop (lọc, thông báo đẩy mở đúng đơn, quay về từ Quét đóng gói). Thông báo đẩy dẫn tới `/(admin)/orders` không ảnh hưởng nhân viên vì nhân viên không nhận thông báo (`/api/notifications` chỉ chủ shop [C `app.ts:341`]).

**Em vẫn nghiêng (A)**, vì: một đường chỉ việc cho cả hai vai ("Đơn hàng → Quay video gói hàng"), khớp với web (Video đóng hàng nằm dưới Đơn hàng), không lộ thêm số nào. (B) rẻ hơn nhưng hướng dẫn / video hướng dẫn phải nói hai kiểu, và "quay video gói hàng" nằm trong Kho là sai chỗ so với điều anh đã nói.

#### b) Nhân viên chỉ có quyền `warehouse.returns` quay KHUI ở đâu

Người này không có nút QR, không có tab Đơn hàng (kể cả theo cách A), chỉ thấy Kho → Đơn hoàn (`WarehouseHubPage`, nút quét nhận hàng hoàn dẫn tới `/scan-returns`) [C `KhoScreen.tsx:27–53`, `WarehouseHubPage.tsx:242`].
→ Đặt nút **"Quay khui hàng"** ngay cạnh nút quét nhận hàng hoàn ở Kho → Đơn hoàn, mở màn quay ở chế độ khui (`?mode=unbox` — màn thử đã nhận tham số này [C `video-test.tsx:144–146`]). Với người không có quyền `orders`, công tắc "Đóng hàng | Khui hàng hoàn" trong màn quay **ẩn đi, khóa ở Khui** (máy chủ cũng từ chối video đóng của họ, mục d). Chủ shop và nhân viên có cả hai quyền thấy cả hai lối.

#### c) Đối thủ đặt màn quay cho nhân viên ở đâu (chỉ từ tài liệu khảo sát, không mở web lại)

- Tài liệu **không có** dòng nào tả cây menu theo vai nhân viên của bất kỳ bên nào — các lượt khảo sát chỉ đọc trang công khai, không đăng nhập.
- Điều có ghi: "Quay video" là **mục riêng cấp một**, không lồng trong danh sách đơn — Cam Check (Tổng quan · Quay Video · Danh sách Video…), Ship Xanh (menu "Quay video đóng gói" riêng) [mục 58.2]. EPack: bề mặt chính là danh sách đơn, **thống kê chỉ chủ shop** [mục 58.2]. ASCAM: nhân viên quét QR định danh để nhận bàn [mục 63]. Simple Replay "số thiết bị nhân viên không giới hạn"; Cam Check bán theo số hồ sơ nhân viên 5 / 10 / không giới hạn [mục 63].
- Rút ra [S]: bên nào cũng coi người quay là nhân viên có danh tính riêng, phần xem / thống kê giữ cho chủ — trùng hướng mục (d). Không bên nào cho thấy "quay" nằm trong nút quét chung → khớp với việc anh bỏ chế độ ở nút QR.

#### d) Máy chủ: sửa tối thiểu để nhân viên của chủ thí điểm GHI được video — **không cần migration**

Hiện trạng [C]: `require-pack-video.ts:13–14` đưa email của **người đăng nhập** vào cổng → nhân viên trượt ngay điều 1 (email không trong danh sách), rồi trượt điều 2 (`ownerId` có giá trị). Cả nhóm `/api/pack-videos` gác bằng một cổng, không tách ghi / đọc. `requireAuth` không nạp email của chủ [C `auth.ts:67–101`].

Sửa (4 tệp + test, không đụng sổ):
1. `services/pack-video/access.ts` — cổng tính theo **email CHỦ SHOP**, trả ba khả năng thay cho một: `view` (chỉ chủ) · `recordPack` (chủ, hoặc nhân viên có `orders`) · `recordUnbox` (chủ, hoặc nhân viên có `warehouse.returns`).
2. `middleware/require-pack-video.ts` — nhân viên thì tra email chủ (một câu theo khóa chính, chỉ trên nhóm đường này), gắn ba khả năng vào `req`.
3. `routes/pack-videos.ts` — **đường ghi** `POST /` · `POST /:id/parts` · `POST /:id/complete` · `GET /match` kiểm theo loại video (đóng / khui); **mọi đường còn lại** (danh sách, tải về, thống kê, đơn hoàn, số giờ + sổ giờ có tiền, mua giờ) giữ chỉ chủ shop. `/:id/parts` và `/:id/complete` thêm điều kiện nhân viên chỉ chạm video **do chính mình quay** (hiện chỉ so `ownerId` [C `upload.ts:291, 333`]).
4. `routes/auth.ts` — thêm trường MỚI `features.packVideoRecord = { pack, unbox }`; **giữ nguyên nghĩa** `features.packVideo` (nhân viên vẫn "locked") → web vẫn để mục "Video đóng hàng" mờ với nhân viên, app / web cũ không đổi hành vi [C web chỉ nhận "open" | "locked", `frontend/src/lib/api.ts:270`].
- Sổ đã có sẵn `recordedById` = người đăng nhập [C `upload.ts:244`] → cột "Người quay" và thống kê theo người quay tự chạy khi nhân viên quay. Giờ quay trừ vào số dư của chủ (theo `ownerId`) [C].
- Điểm phải quyết: `/match` đã ẩn đơn của gian nhân viên không được giao [C `library.ts:483`], nhưng bước tải lên khớp đơn chỉ theo chủ shop [C `upload.ts:229`] → nhân viên bị giới hạn gian quay kiện của gian khác thì video **vẫn gắn vào đơn**, chỉ là màn quay không hiện tên gian / món. Em đề nghị giữ vậy (video là bằng chứng của chủ, người đó đang cầm kiện thật) — câu C5.
- ⚠️ Thứ tự: `routes/pack-videos.ts` đang có thay đổi CHƯA commit của mục 19 (mua giờ / hết giờ) → lát máy chủ này phải làm SAU khi mục 19 được commit, không thì hai việc dính vào nhau.
- App iPhone bản thử chưa biết mã `OUT_OF_HOURS` (nợ mục 19) → nhân viên quay lúc hết giờ phải thấy "Hết giờ quay — báo chủ shop", không thấy số giờ / giá.

#### e) Đề xuất cuối: cách (A), có rào thí điểm

**Phác màn (chữ):**
```
Tab dưới (chủ shop):   Trang chủ · Đơn hàng · [QR] · Kho · Cấu hình      (không đổi)
Tab dưới (nhân viên có `orders`, chủ đã mở video):  Đơn hàng · Kho · [QR] · Cấu hình
Tab dưới (nhân viên khác):                           như hiện tại

ĐƠN HÀNG
[ Danh sách đơn | Quay video gói hàng ]        ← thanh chọn chỉ hiện khi tài khoản được quay
— tab con "Quay video gói hàng" —
   ┌ Nút lớn xanh:  ▶ Bắt đầu quay ┐            ← mở màn quay toàn màn hình (không nhét camera vào tab)
   Hôm nay: 37 video · 1 giờ 12 phút
   Đang chờ tải lên: 2 video  (mất mạng thì hiện ở đây, tự lên lại)
   Chủ shop thêm một dòng: Còn 46 giờ quay      ← nhân viên KHÔNG thấy số giờ
   Hết giờ:  "Hết giờ quay — báo chủ shop mua thêm"  (chủ shop: nút Mua thêm giờ)

KHO → Đơn hoàn:  [ Quét nhận hàng hoàn ]  [ Quay khui hàng ]   ← nút thứ hai theo quyền `warehouse.returns`
```
Tab con là **trang mở đầu + hàng chờ tải lên**, không phải camera: đã bỏ lưu local thì người quay phải có chỗ thấy video nào chưa lên hệ thống.

**Các lát (mỗi lát giao riêng, chưa lát nào được duyệt):**
| Lát | Việc | Ở đâu | Ghi chú |
|---|---|---|---|
| N1 | Máy chủ: ba khả năng + tách đường ghi / đọc + `features.packVideoRecord` + bảng test chéo (chủ thí điểm / không thí điểm × 4 kiểu quyền × từng đường) | backend, không migration | sau khi mục 19 commit; cần push + deploy |
| N2 | App, chủ shop: dời màn Đơn hàng sang `screens/`, thêm tab con + trang mở đầu + hàng chờ | nhánh thử, TestFlight | anh thử bằng admin@hubsell.vn trước, đúng ý anh |
| N3 | App, nhân viên: tab "Đơn hàng" ở khu nhân viên (rào theo chủ đã mở video) | nhánh thử | cần N1 trên prod |
| N4 | App: nút "Quay khui hàng" ở Kho → Đơn hoàn + khóa công tắc theo quyền | nhánh thử | cần N1 |
| N5 | Thử thật bằng 4 nhân viên của admin@hubsell.vn (chỉ `orders` · chỉ `warehouse.returns` · cả hai · bị giới hạn gian) + 1 nhân viên của tài khoản KHÔNG thí điểm | TestFlight | anh cần tạo sẵn các tài khoản nhân viên này |

**Anh cần chốt:**
- **C1.** Chọn (A) hay (B). Em đề nghị (A).
- **C2.** Giai đoạn thí điểm: tab "Đơn hàng" của nhân viên chỉ hiện cho nhân viên của chủ đã mở video (em đề nghị có). Khi mở rộng rãi thì mọi nhân viên quyền `orders` có danh sách đơn trên app — anh đồng ý không?
- **C3.** Nhân viên 4 tab thì nút QR lệch khỏi giữa — chấp nhận, hay anh muốn cách xếp khác?
- **C4.** Ô "Quay video đóng gói" ở Tổng quan: bỏ khi đã có tab con (em đề nghị bỏ, một lối cho dễ) hay giữ làm lối tắt?
- **C5.** Nhân viên bị giới hạn gian quay kiện của gian khác: vẫn gắn video vào đơn (em đề nghị) hay từ chối?
- **C6.** Nhân viên có thấy số giờ còn lại không (em đề nghị không, chỉ báo khi hết)?
- **C7.** Nhân viên quay bằng WEBCAM trên web: mở cùng lúc theo luật này hay để sau? (N1 chỉ mở cổng máy chủ; menu web vẫn mờ với nhân viên cho tới khi anh bảo.)

**Chưa kiểm:** chưa chạy thử dòng nào (lượt này chỉ đọc mã); chưa nhìn thanh 4 tab trên máy thật; `GET /api/channels` cho nhân viên em chỉ thấy có nhánh theo vai, chưa đọc ruột; phần "nhân viên làm được Trả lời sàn trên web" suy từ cổng máy chủ, chưa bấm thử bằng tài khoản nhân viên.

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

### 18.10 Khảo sát lại theo mô hình lớn (18/11/2026 ~21:30, lịch anh đặt: "Tối cần khảo sát lại cho phù hợp với mô hình lớn nữa")

Mốc quy mô anh đã chốt: 50.000 khách, > 1 triệu đơn / ngày, "hàng chục nghìn shop đóng hàng cùng lúc". Cách làm: tra lại TRANG GỐC cho
từng giả định [S] của mục 18, đọc lại mã, rồi mới kết luận. **[C]** = đọc được ở trang gốc / đọc mã / đo · **[S]** = suy ra, nguồn thứ
cấp (báo dẫn lại), hoặc số em tự chọn. Hạ tầng đang chạy (đọc từ sổ tay dự án): Supabase Pro cỡ **Small**, Render web **Starter 512 MB**,
worker 1c-2g, R2 đứng tên cá nhân.

#### A. Điều của mục 18 ĐỨNG VỮNG

| # | Điều | Căn cứ |
|---|---|---|
| A1 | R2 không có trần lượt ghi / giây theo bucket hay tài khoản; trần duy nhất đụng mình là ghi cùng MỘT tên tệp 1 lần / giây (429) | [C] developers.cloudflare.com/r2/platform/limits. Riêng câu "20 Gbps đổ vào một bucket chắc chắn được" thì KHÔNG có trang nào bảo đảm → [S], phải hỏi Cloudflare trước khi tới mốc đó |
| A2 | Video đi thẳng trình duyệt → R2, máy chủ mình không chạm byte nào | [C] R2 nhận ghi ở điểm biên "close to the user" rồi mới chuyển về vùng lưu (developers.cloudflare.com/r2/how-r2-works); Cloudflare có điểm biên ở Hà Nội, TP.HCM, Đà Nẵng (cloudflare.com/network). Lượt gửi từ Việt Nam có chắc vào điểm biên Việt Nam không: [S] |
| A3 | Chỗ vỡ ở hai đầu (trình duyệt + máy chủ mình), không ở R2 | xem B1, B2 — số tra được còn nặng hơn em ước lúc chiều |
| A4 | Thứ tự M1 → M2 trước M3 | giữ; lý do mạnh thêm (B1) |
| A5 | `moov` cuối tệp, ghi dần xuống ổ | [C] đo lại ở M1 (mục 21): tệp trên R2 là `ftyp mdat … moov`, trình phát đọc thẳng R2 nạp thông tin ≈ 1 giây, tua giữa / cuối 0,25–0,35 giây |
| A6 | Một máy tầm trung gánh 6 bàn | [C] bảng Nvidia nay ghi **12 phiên mã hóa cùng lúc** cho card GeForce (developer.nvidia.com/video-encode-decode-support-matrix), không phải 8; driver cũ 3–5–8 phiên là [S, nguồn thứ cấp]. Intel Quick Sync **không có trần số phiên** [C, intel.com bài 000088556] |
| A7 | Đường lên của shop đủ cho N bàn | [S] i-Speed (VNNIC, báo dẫn lại): cáp quang cố định tải LÊN trung bình ≈ 172–201 Mbps, di động ≈ 28 Mbps — đo tới máy chủ TRONG NƯỚC. 6 bàn cần ≈ 6 Mbps → dư kể cả phát 4G, trừ lúc chặng quốc tế nghẽn (B5) |

#### B. Điều PHẢI SỬA

| # | Mục 18 viết | Thật ra | Sửa thế nào |
|---|---|---|---|
| B1 | Bảng 18.2 coi database gánh được tới 84 giao dịch ghi / giây sau M2 | [C] Supabase **Small: 1.000 IOPS nền, 22 MB / giây, 90 kết nối thẳng / 400 qua bộ gom** (supabase.com/docs/guides/platform/compute-and-disk); vượt nền là đốt quỹ IO — đúng kiểu sự cố 28/10. Ước của em [S]: phần video chỉ nên dùng bền **≈ 100–150 giao dịch ghi nhỏ / giây** vì database còn gánh cả app chính. → mã hiện tại (2 lượt ghi / video) **đã chạm trần ở ≈ 3.500–5.000 shop cùng lúc**; chưa gộp lô thì mốc 10.000 shop (280 lượt / giây) KHÔNG chạy được | **M2 (gộp lô) là ĐIỀU KIỆN để mở cho nhiều khách, không còn là "tối ưu".** Sau gộp lô, cỡ Small đỡ được tới ≈ 30.000 shop về số lượt ghi (84 / giây ≈ quá nửa trần ước) — sát, phải đo ở M4 |
| B2 | "Máy chủ web chịu 310–920 lượt gọi / giây sau M2" (ngầm định) | [C] Render không công bố trần lượt gọi / kết nối nào cho web service; máy đang dùng là Starter 512 MB từng hết bộ nhớ 21/10 + 03/11. [C] băng thông RA tính tiền: gói hiện tại 5 GB / tháng, vượt 0,15 USD / GB (render.com/docs/outbound-bandwidth). Ước [S]: 2 triệu video / ngày × ≈ 5 KB trả lời ≈ 10 GB / ngày ≈ 45 USD / tháng — tiền nhỏ nhưng phải biết | Không ai nói trước được máy 512 MB chịu bao nhiêu → **M4 (thử chịu tải local) là nơi ra con số**, không đoán. Em KHÔNG đề nghị nâng máy / nâng gói lúc này (chưa tìm gốc bằng số đo thì chưa nói chuyện nâng) |
| B3 | N1 "clip ghi THẲNG xuống ổ" (một tệp dài, như trang đo M0) | [C] trình duyệt chỉ chốt tệp khi ĐÓNG luồng ghi (`createWritable`: "changes won't be reflected … until the stream has been closed" — fs.spec.whatwg.org, MDN). Tab sập giữa chừng = mất hết phần đã ghi; một lần ghi hỏng làm hỏng cả luồng. Cách của M0 đo được tốc độ nhưng KHÔNG bền | M1 đã đổi: **mỗi lần ghi ≈ 1 MiB thành một tệp mảnh riêng, đóng ngay** (mục 21). Mảnh nào xong là nằm chắc trên ổ |
| B4 | N5 "cảnh báo khi chỗ trống trình duyệt cho < 5 GB, ngừng mở clip khi < 1 GB" (theo `storage.estimate()`) | [S, thông báo của nhóm Chromium trên blink-dev] từ Chrome 133 `estimate().quota` = đã dùng + 10 GiB, cố ý để chống dò dấu vết → KHÔNG BAO GIỜ đo được chỗ trống (khớp số đo 18.9: báo 10 GB khi ổ còn 2,4 GB). Hạn mức thật = 60 % TỔNG dung lượng ổ, không tính theo chỗ trống [C, web.dev/articles/storage-for-the-web] | M1: bỏ hai ngưỡng đó. Chặn mở clip mới CHỈ khi một lần ghi thật hỏng; cảnh báo sớm bằng một lần ghi thử 64 MB (số tự chọn ≈ 10 phút quay của một bàn) |
| B5 | N6 cáp biển "kiến thức chung, chưa tra lại" | [S, báo dẫn Cục Viễn thông] 02/2023 cả 5 tuyến cùng lỗi; **25/08/2026 4 / 8 tuyến lỗi cùng lúc, "có thể ảnh hưởng tới 30 % lưu lượng"**; sửa tính bằng tuần tới tháng. [C] đường dẫn ký sẵn của R2 KHÔNG chạy trên tên miền riêng (developers.cloudflare.com/r2/api/s3/presigned-urls) → nhà mạng lỗi đường tới `r2.cloudflarestorage.com` thì mình không có đường vòng | Đây là ca "thường niên", không phải ca hiếm → hàng chờ bền + thử lại không giới hạn (M1) là thứ gánh chính. Thêm một việc rẻ: R2 có tính năng **Local Uploads** [C, developers.cloudflare.com/r2/buckets/local-uploads, miễn phí]: ghi gần người gửi rồi tự chép về vùng lưu → câu K-3 |
| B6 | 18.2 "≈ 5 lượt gọi máy chủ / video" | [C, đọc lại mã] làm mới nhóm `["pack-videos"]` chỉ gọi lại truy vấn ĐANG hiện; trên màn quay chỉ có số giờ → thật ra **≈ 4 lượt / video** (match · tạo · chốt · số giờ) | Số trong bảng 18.2 hạ ≈ 20 %; kết luận không đổi. M1 đã gộp lượt thứ tư còn tối đa 1 lần / 30 giây → **≈ 3 lượt / video** từ M1 |
| B7 | N14 "bộ mã hóa phần cứng có trần số phiên, hết thì Chrome lùi sang CPU" | Trần GeForce nay 12 (A6). Ca phải lo là **máy văn phòng không có card rời**: Chrome có đường mã hóa phần cứng Intel / AMD qua Media Foundation [S, chỉ thấy trong mã Chromium]; không có thì lùi sang OpenH264 bằng CPU, không trần độ phân giải [C, mã Chromium 129]. Sức thật của GPU tích hợp / CPU: CHƯA AI ĐO | Trước khi M3 chốt số bàn tối đa phải đo trên một máy không card rời (câu K-5). Mã sản phẩm đang để bộ mã hóa `no-preference` — M3 nên hiện "phần cứng / CPU" từng ô như 18.4 đã ghi |
| B8 | 18.9 "`persist()` = true → Chrome giữ" | [C, MDN] vẫn mất khi người dùng "Xóa dữ liệu duyệt web"; chế độ ẩn danh chỉ ≈ 5 % ổ hoặc ≈ 300 MB. Trên `localhost:3010` (trình duyệt thử) `persist()` = false | M1: ghi nhật ký khi trình duyệt chưa hứa giữ; tệp chờ gửi mất khỏi ổ thì báo rõ, không gửi tệp cụt |

#### C. Thứ mục 18 CHƯA THẤY (em tìm ra khi dựng M1)

1. **Hàng chờ nằm theo TRÌNH DUYỆT chứ không theo tài khoản.** Hai tài khoản dùng chung một máy (ca kho thuê nhân viên rất thường) → clip của
   shop A có thể bị gửi bằng phiên của shop B. M1 đã chặn: mỗi clip ghi kèm tài khoản đã quay, chỉ gửi khi đúng tài khoản đó đăng nhập.
2. **Hai tab cùng mở màn quay** → cùng một clip gửi hai lần. Máy chủ đã chống trùng bằng `clientId`, nhưng phí băng thông và đua nhau xóa
   tệp. M1 đã chặn bằng khóa giữa các tab (Web Locks).
3. **Clip ĐANG QUAY lúc trang sập thì không cứu được**: `moov` viết ở cuối, chưa có `moov` thì tệp không phát được. Đơn đóng 15 phút mà
   Chrome sập ở phút 14 = mất cả 14 phút. Đây là lỗ còn lại của M1 → câu K-2.
4. **Clip chờ quá 25 giờ mà shop đã hết giờ quay** → máy chủ từ chối (luật 19: chỉ nhận clip bắt đầu lúc còn giờ trong cửa sổ 25 giờ). Mất
   mạng dài + hết giờ = clip nằm "lỗi" tới khi mua giờ. M1 giữ tệp, có nút Thử lại; luật cửa sổ là của máy chủ (M2 xem lại).
5. **Hàng chờ chỉ tự gửi tiếp khi mở màn QUAY.** Chrome sập, mở lại Hubsell mà vào trang khác thì clip nằm im. Đủ cho thí điểm một tài
   khoản; trước khi mở cho khách phải đưa lượt "gửi tiếp" lên khung chung của app → câu K-6.
6. **Máy chủ chưa nói được "chờ N giây"**: lớp gọi API của web không đưa tiêu đề `Retry-After` ra ngoài. M1 đã viết sẵn chỗ nhận; M2 làm
   phần máy chủ + lớp gọi.

#### D. Thông báo sự kiện của R2 (bỏ bước "chốt tải" khỏi máy chủ mình) — có nên không?

Cách chạy [C]: tệp vừa lên → R2 bắn sự kiện `object-create` (có `key`, `size`, `eTag`) vào Cloudflare Queues → một Worker gom tới 100 sự
kiện / lượt rồi gọi máy chủ mình MỘT lần. Trần 5.000 sự kiện / giây / hàng (mình cần 420). Giao **ít nhất một lần** (có thể trùng), không
cam kết độ trễ. Giá: phải có gói Workers Paid 5 USD / tháng + 0,40 USD / triệu thao tác, mỗi sự kiện 3 thao tác → ước [S] **≈ 77 USD /
tháng ở 2 triệu video / ngày, ≈ 221 USD ở 6 triệu** (developers.cloudflare.com/queues/platform/pricing).

Được: máy chủ mình nhận 1 lượt / 100 video thay vì 1 lượt / video; video lên kho rồi mà trình duyệt tắt trước khi báo vẫn được ghi sổ.
Mất: thêm một khối mã chạy ở nơi thứ tư (Worker), thêm một dịch vụ trả tiền trên tài khoản Cloudflare CÁ NHÂN (thuế nhà thầu: Cloudflare
chưa đăng ký thuế Việt Nam — giữ nguyên cách mua cá nhân), và video hiện "đã lưu" trễ theo nhịp gom.

**Chính kiến của em: CHƯA làm.** Gộp lô ở trình duyệt (M2) đã cắt được 10–20 lần số lượt chốt mà không thêm dịch vụ nào; M1 đã lo ca
"tắt trước khi báo" (mở lại là gửi tiếp, máy chủ chống trùng). Để dành làm **lưới an toàn ở M5**: chỉ dùng để dò các dòng kẹt `PENDING`,
không thay đường chính. Nếu M4 cho thấy máy chủ web là chỗ nghẽn thì mới đưa lên làm đường chính.

#### E. Các lát — đổi gì

| Lát | Trước | Nay |
|---|---|---|
| M1 hàng chờ bền | đề xuất | **đã dựng trên local 18/11** (mục 21); thêm ba thứ ngoài đề xuất: gắn tài khoản, khóa giữa các tab, ghi theo mảnh |
| M1b cứu clip đang quay dở (MỚI, chờ anh K-2) | chưa có | ghi kèm "sổ khung hình" (cỡ + mốc giờ từng khung) mỗi vài giây; mở lại trang thì dựng lại `moov` từ các mảnh đã nằm trên ổ. Ước 1–2 ngày. Không có nó thì lỗ C3 còn nguyên |
| M2 máy chủ nhẹ đi | "tối ưu" | **điều kiện để mở cho khách thứ hai** (B1). Thêm vào phạm vi: lộ `Retry-After` ra lớp gọi của web; xem lại cửa sổ 25 giờ (C4); đưa lượt "gửi tiếp" lên khung chung (C5) |
| M0b đo máy không card rời (MỚI, chờ anh K-5) | "để sau" | phải xong TRƯỚC khi M3 chốt số bàn tối đa (B7) |
| M3 màn Nhiều bàn | sau M2 | giữ thứ tự. Hàng chờ của M1 đã theo từng clip nên nhiều bàn dùng chung được, không phải viết lại |
| M4 thử chịu tải | 1.000 → 10.000 shop | thêm hai mốc phải ra số: (1) máy web 512 MB chịu bao nhiêu lượt / giây, (2) database Small chịu bao nhiêu giao dịch ghi / giây khi app chính vẫn chạy. Hai số này quyết khi nào mới phải nói chuyện hạ tầng |
| M5 | tách tiến trình video | thêm lựa chọn: thông báo sự kiện R2 làm lưới an toàn (mục D) |

**Điều anh có thể không thích, em nói thẳng:** với hạ tầng hôm nay, thiết kế sau M2 đủ cho **vài nghìn shop quay cùng lúc**; mốc "hàng chục
nghìn cùng lúc" thì không cỡ database / máy web nào ở bậc hiện tại gánh nổi dù mã có gọn tới đâu — tới đó nâng hạ tầng là việc đúng,
không phải lỗi mã. Việc của mình bây giờ là (a) làm cho mỗi video tốn ít lượt gọi nhất (M1 + M2), (b) có số đo M4 để biết CHÍNH XÁC mốc
nào phải nâng, thay vì đoán. Em không đề nghị nâng gì lúc này.

#### F. Chờ anh quyết

| # | Câu | Em đề nghị |
|---|---|---|
| K-1 (= N-b cũ) | Hàng chờ bền trên ổ (tệp tạm tự xóa khi lên kho, không nút xem / giữ) có trái chốt "bỏ lưu local" không? M1 ĐÃ làm theo cách này | không trái — nó là cách để video chắc chắn lên hệ thống. Anh xác nhận giúp |
| K-2 | Làm M1b (cứu clip đang quay dở khi trang sập)? | có, trước M3 — nhiều bàn thì một lần sập mất nhiều clip dở hơn |
| K-3 | Bật **Local Uploads** cho bucket R2 (miễn phí, bật trong bảng điều khiển Cloudflare)? | có cho bucket THẬT lúc anh tạo; bucket thử thì bật luôn để đo trước / sau. Em không tự bật khi anh chưa bảo |
| K-4 | Thông báo sự kiện R2 (≈ 77–221 USD / tháng + gói Workers) | chưa; để M5 làm lưới an toàn |
| K-5 | Anh có máy nào KHÔNG có card rời (laptop văn phòng) để đo 2–4 bàn? | cần trước M3 |
| K-6 | Đưa lượt "gửi tiếp video đang chờ" lên khung chung của app (mở Hubsell ở trang nào cũng gửi tiếp) | có, làm cùng M2 |
| K-7 | Clip gửi mãi không được vì lỗi không thử lại được (hết giờ quay, phiên hết hạn) — giữ trên ổ vô hạn hay cho nút "Bỏ video này"? | giữ + nút Thử lại (đang vậy). Nút "Bỏ" là xóa bằng chứng → chỉ thêm khi anh bảo |

Ghi chú nguồn: trang tài liệu Supabase có một đoạn chữ nhắn riêng cho công cụ AI (bảo gửi phản hồi về Supabase) — bỏ qua, không làm theo.

## 19. Mua giờ quay + hết giờ thì dừng + luật tự xóa CHẠY BÓNG (18/11/2026 20:00, lịch anh đặt 16/11 — ĐÃ PUSH 18/11 ~21:25 chung commit với mục 20)

> Anh 16/11: "Cả 2 việc này em đặt lịch làm 20:00 ngày 18/11 nhé." Việc 1 = luồng mua giờ quay; việc 2 = luật tự xóa video theo
> trạng thái đơn (lát W5). Phiên tự động, không ai bấm duyệt: hai server local bị từ chối khởi động → CHƯA soi màn (mục 19.10).

### 19.1 Điều đã chốt mà mục này bám

1.500 đ / giờ tính thẳng, không bậc · trả trước, không theo tháng, giờ không hết hạn, không trừ VAT · khách mua bao nhiêu cộng bấy
nhiêu, mỗi lần thu là một giao dịch mua hàng có hóa đơn · màn mua = 3 gói sẵn 50 / 200 / 500 giờ (chỉ lối tắt) + ô nhập số giờ, tối
thiểu 20 giờ · hết giờ thì dừng, video quay dở quay nốt, số dư được âm, ⛔ không nhắc quay thừa / không phí vượt · giờ tính khi video
đã lên kho (STORED; DELETED vẫn tính) · xóa theo trạng thái đơn L1–L7, ⛔ không "N ngày từ ngày quay", ⛔ đối soát không phải mốc
xóa · chỉ `admin@hubsell.vn` · ⛔ không đụng thanh toán trong app iPhone.

### 19.2 Đường tiền đi — THIẾT KẾ (phần nối cổng CHƯA làm, chờ anh 19.8)

Dùng lại ĐÚNG luồng payOS của gói dịch vụ / phí vượt (`services/gateway-checkout.ts` → `openGatewayOrder` → webhook
`/api/webhooks/payos` + poll tự chữa lành → `settleGatewayOrder`), không dựng luồng mới:

```
 Web hộp "Mua thêm giờ quay" ── POST /api/pack-videos/hours/checkout { hours }   (KHÔNG gửi tiền)
        │  máy chủ: quoteHours(hours) → số tiền = giờ × 1.500; chụp số giờ + đơn giá vào đơn cổng
        ▼
 GatewayPaymentOrder (PENDING, hết hạn 60') ── payOS tạo QR, nội dung CK "HS PAC<n> <8 số cuối mã đơn>"
        │  khách quét QR
        ▼
 payOS webhook / poll 3 giây ──▶ settleGatewayOrder: nhánh "mua giờ" — MỘT giao dịch database:
        · PackagePayment kind PACK_HOURS (chứng từ, externalRef = "payos:<mã GD>" duy nhất)
        · PlatformLedgerEntry THU, invoiceStatus PENDING (sổ quỹ HQ)
        · pack_hour_grants PURCHASE (paymentRef = cùng "payos:<mã GD>", amountVnd)   ← grantPurchasedHoursTx (ĐÃ CÓ)
        · đơn cổng → PAID
   sau giao dịch: kickHqAutoInvoice (hóa đơn MISA → thư billing@ kèm PDF, như gói)
```

**Lúc nào cộng giờ:** chỉ khi tiền ĐÃ VỀ và đúng số. Tạo QR không cộng gì; khách quét mà không chuyển thì đơn hết hạn, không có dòng
giờ nào. Giờ hiện ngay ở hàng tab nhờ poll (không đợi webhook).

**Hóa đơn:** đi chung bước tự xuất của gói (bút toán THU có `packagePaymentId` → `hq-auto-invoice.ts`). Cần một tên dòng hóa đơn
mới cho khoản mua giờ (`hqItemNameFor` kind PACK_HOURS) + thuế suất — đây là chỗ anh phải quyết (19.8 H1).

### 19.3 Đã làm (local)

| Phần | Tệp | Ghi chú |
|---|---|---|
| Cấu hình một nguồn | `backend/src/config/pack-video.ts` | `PACK_VIDEO_HOUR_PRICE_VND` 1.500 · `PRESETS` 50/200/500 · `MIN` 20 · `MAX` 10.000 (tự chọn: chặn gõ nhầm, = 15 tr) · `SALES_OPEN` vẫn **false** · `OVERRUN_LOOKBACK` · 2 công tắc xóa (env, mặc định tắt) · cỡ lô 500 × 20 lô (tự chọn) |
| Tính tiền thuần | `backend/src/lib/pack-video-hour-pricing.ts` | `quoteHours` (chỉ số giờ nguyên, máy chủ tự tính) · `amountMatchesHours` (kiểm lúc tiền về) |
| Migration 1 | `prisma/migrations/20261118200000_pack_hour_grants_purchase_ref` | CHỈ ADD trên `pack_hour_grants`: `paymentRef` + `amountVnd`, chỉ mục DUY NHẤT một phần trên `paymentRef`, CHECK "PURCHASE phải có mã khoản tiền + tiền > 0 + giây > 0" |
| Cộng giờ chống trùng | `services/pack-video/hours.ts` `grantPurchasedHoursTx` | `INSERT … ON CONFLICT (paymentRef) DO NOTHING` — lượt thua không ném lỗi nên không làm hỏng giao dịch của cổng; mã khoản của chủ shop khác → lỗi; tiền lệch giờ → lỗi, không cộng. Script cấp giờ tay nay CHỈ ghi GRANT / ADJUST (PURCHASE chỉ do luồng thanh toán ghi) |
| Hết giờ thì dừng | `hours.ts` `canOpenNewVideo` + `upload.ts` `beginUpload` | video MỚI khi số dư ≤ 0 → **402 `OUT_OF_HOURS`**; NGOẠI LỆ "quay nốt": clip BẮT ĐẦU lúc còn giờ (số dư lúc bắt đầu = số dư nay + giờ đã trừ từ lúc đó − giờ đã cộng từ lúc đó) vẫn lên được, kể cả nhiều bàn cùng quay; gọi lại cùng `clientId` không bao giờ bị chặn; giờ bắt đầu lùi quá 25 giờ (60 phút + 24 giờ, tự chọn) không được tính là "quay dở" |
| `/api/pack-videos/hours` | `hours.ts` `getHoursOverview` | thêm `pricing { priceVnd, minHours, maxHours, presets }` + `ledger` (50 dòng sổ giờ mới nhất); bỏ `packages` cũ (giá trống) |
| Web — hộp mua | `components/orders/videos/hours-balance.tsx` | đúng phác thảo: số dư · 3 gói (giá + "≈ N video 1 phút") · ô "Số giờ khác" · dòng "n giờ × 1.500 ₫" · nút "Thanh toán X ₫" (khóa, dòng "Chưa mở thanh toán giờ quay — sắp có") · hai dòng luật hết giờ. Nút mua tách thành `BuyHoursButton` dùng lại ở màn quay |
| Web — sổ giờ | `components/orders/videos/hour-ledger.tsx` (mới) → tab Thống kê | ngày · loại (Mua giờ / Hubsell cấp / Điều chỉnh) · số giờ ± · số tiền · hóa đơn ("Chưa xuất" với dòng mua — chưa nối hóa đơn) |
| Web — màn quay | `record/control-panel.tsx`, `record/use-pack-recorder.ts`, `lib/pack-video-recorder/recorder.ts`, `session.ts` | hết giờ: hộp đỏ "Hết giờ quay" + nút mua ngay dưới nút lớn, nút Bắt đầu khóa (đang quay thì nút Dừng vẫn bấm được); bộ quay hỏi `canOpenClip` trước khi mở clip mới — tem kế lúc hết giờ thì LƯU clip đang quay, không mở clip mới, kêu "boop" + nhật ký; tải lên bị 402 thì báo "Đã hết giờ quay — mua thêm giờ rồi bấm Thử lại" (không tự thử lại). Dòng số giờ trên cột điều khiển dời lên ngay dưới nút lớn |

### 19.4 Luật tự xóa — CHẠY BÓNG (đã làm, local)

- **Luật thuần** `backend/src/lib/pack-video-retention.ts` — `decideRetention(video, order, now)` trả `DELETE_AFTER` (ngày + luật) /
  `HOLD` (lý do) / `WAIT`. Số ngày một chỗ (`RETENTION_DAYS`): L1 chưa khớp đơn = quay + 3 · L2 hủy ngang = lúc thấy hủy + 1 · L3 kiện
  quay đầu về kho nguyên vẹn = ngày nhận + 7 · L4 đã giao không hoàn = giao + 20 (**mọi gian Lazada + 35** — sổ không có cờ LazMall nên
  lấy mốc dài) · L5 ca hoàn đóng = max(ngày kho nhận, hôm nay) + 10 · L6 trần = quay + 90. "Lúc thấy hủy / thấy ca đóng" = hôm nay vì
  sổ không ghi giờ hủy / giờ khiếu nại xong → luôn ≥ mốc thật, chỉ giữ LÂU hơn. L7 (tắt tính năng / hết giờ) không đổi gì.
- **Mọi dấu hiệu hoàn chặn xóa** (9 dấu hiệu, mỗi cái một test): `returnStatus ≠ NONE`, `returnRequestedAt`, `returnedAt`,
  `returnDeliveredAt`, `refundedAmount > 0`, `platformRefundAmount > 0`, `platformReturnStatus`, `returnSolution`, và chính video là
  video KHUI. Video khui chưa khớp đơn → GIỮ (không áp L1). Đơn hủy mà kiện đã rời kho, chưa có dấu hiệu hoàn → GIỮ chờ kiện về.
  Có `orderId` mà không đọc được đơn → CHỜ, không xóa.
- **Phần áp lên sổ** `services/pack-video/retention.ts`: pha GÁN HẠN đọc 500 video STORED chưa có hạn theo khóa chính (con trỏ ở
  `maintenance_jobs` key `pack-retention-assign`, hết sổ quay về đầu), đọc đơn theo KHÓA CHÍNH, ghi bằng HAI câu `UPDATE … FROM unnest`
  mỗi lô; hạn ghi MỘT lần (điều kiện `deleteAfter IS NULL`). Pha TỚI HẠN đọc qua chỉ mục một phần `pack_videos_delete_after_idx`, ĐỌC
  LẠI đơn: mới có dấu hiệu hoàn → gỡ hạn, ghi lý do giữ. Chạy bóng (mặc định): không gọi R2, không đổi trạng thái — dòng STORED có
  `deleteAfter` đã qua CHÍNH LÀ bản ghi "sẽ xóa" để đối chiếu; xóa thật (`PACK_VIDEO_DELETE_ENABLED=1`) xóa tệp NGOÀI giao dịch rồi
  mới đánh dấu DELETED, lỗi thì để nguyên.
- **Worker** `backend/src/workers/pack-video-janitor.ts`, gắn vào `workers/index.ts`: mỗi 6 giờ (tự chọn), lượt đầu 10 phút sau khi bật:
  gộp giờ theo ngày → gán hạn → tới hạn. Chỉ có cờ `started` / `running` ở cấp tệp (test `no-module-state` xanh). Tắt cả worker:
  `PACK_VIDEO_JANITOR_OFF=1`. Nhật ký: `[pack-video-janitor] CHẠY BÓNG — tới hạn N: SẼ xóa … · chặn vì có hoàn … · bỏ qua …`.
  ⚠️ Chạy bóng thì dòng tới hạn không biến mất nên mỗi lượt đọc lại cả tập "sẽ xóa" (trần 10.000 dòng / lượt) — ổn cho một tài khoản
  thí điểm một tuần, không để chạy bóng lâu ở quy mô lớn.
- **Web**: cột **"Giữ tới"** (ngày + "Còn N ngày" / vàng "Sắp tự xóa · N ngày" / "Đã tới hạn"; "Đang giữ" + lý do khi trỏ chuột)
  chỉ vẽ khi trang có ít nhất một video đã có hạn hoặc đang giữ; chip **"Sắp tự xóa"** (hạn trong 3 ngày tới — tự chọn) tự ẩn khi bằng
  0. API danh sách trả thêm `deleteAfter`, `holdReason`; `/summary` thêm `expiring`.
- **Xóa tài khoản** `services/pack-video/owner-purge.ts`, gọi từ `account-deletion.ts` sau giao dịch (chỉ chủ shop): SAU CỜ
  `PACK_VIDEO_ACCOUNT_PURGE=1`; mặc định chỉ ghi nhật ký "SẼ xóa N video". Bật cờ: hủy lượt tải dở, xóa tệp, đánh dấu DELETED
  (`deleteRule = ACCOUNT`) — giờ đã quay vẫn giữ trong sổ.

### 19.5 Sổ rủi ro (bổ sung mục 6) — chặn bằng gì, chứng minh bằng gì

| # | Rủi ro | Chặn bằng | Chứng minh |
|---|---|---|---|
| P1 | Khách bấm thanh toán hai lần → hai QR | dùng lại `openGatewayOrder`: đơn PENDING y hệt thì trả lại, đơn khác thì hủy ở payOS | luồng gói đang chạy prod (chưa nối cho giờ) |
| P2 | Webhook đến hai lần / poll đua webhook | `paymentRef` DUY NHẤT + `ON CONFLICT DO NOTHING`; chứng từ có `externalRef` duy nhất | `hours-db` "cùng một khoản … chỉ cộng giờ MỘT lần" (hai lượt song song + lượt ba) |
| P3 | Webhook đến trễ / lạc | poll 3 giây của web hỏi thẳng payOS (sẵn có) | luồng gói |
| P4 | Cộng giờ cho nhầm chủ shop | mã khoản đã dùng cho tài khoản khác → lỗi | `hours-db` "mã khoản tiền của A không cộng được giờ cho B" |
| P5 | Số tiền không khớp số giờ | `amountMatchesHours` trước khi ghi; database CHECK PURCHASE phải có tiền > 0; cổng: tiền thiếu → MISMATCH, mail HQ (sẵn có) | `pack-video-hour-pricing` 16 test; `hours-db` "lệch tiền / dưới tối thiểu → không cộng", "CHECK chặn PURCHASE thiếu mã" |
| P6 | Đổi giá giữa lúc tạo QR và lúc tiền về | **khi nối cổng:** kiểm theo đơn giá CHỤP trên đơn cổng, không theo cấu hình hiện hành | việc của lát nối cổng |
| P7 | Hoàn tiền giờ quay | chưa có luồng; sổ chỉ chèn → hoàn = dòng ADJUST âm + hóa đơn điều chỉnh | chờ anh (H4) |
| P8 | Trình duyệt gửi số tiền giả | máy chủ không đọc tiền từ trình duyệt; web chỉ hiện phép tính theo số máy chủ trả | mã `quoteHours` |
| P9 | Hết giờ nhưng clip đang quay dở bị chặn tải lên | so số dư LÚC BẮT ĐẦU clip | `hours-db` "clip bắt đầu lúc còn giờ … vẫn được tải lên"; `upload-db` "video đã báo xong (cùng clientId) vẫn tải lên được" |
| P10 | Khai lùi giờ bắt đầu để lách hết giờ | cửa sổ 25 giờ; mỗi clip ≤ 60 phút | `hours-db` "giờ bắt đầu lùi quá xa … không được coi là đang quay dở" |
| X1 | Xóa nhầm video của đơn có hoàn | 9 dấu hiệu chặn; ĐỌC LẠI đơn lúc tới hạn; chạy bóng trước | `pack-video-retention` 38 test; `retention-db` "khách xin hoàn sau khi đã gán hạn → gỡ hạn" |
| X2 | Chạy bóng mà lỡ xóa | nhánh bóng không lấy kho R2; test đếm lệnh gọi | `retention-db` "CHẠY BÓNG … không gọi lệnh xóa nào, video vẫn STORED" |
| X3 | Hạn bị ghi đè lặp (tải ghi database) | UPDATE có điều kiện `deleteAfter IS NULL`, cả lô một câu | `retention-db` "hạn ghi MỘT lần" |
| X4 | "Giờ đã quay" tụt khi bỏ mảnh tháng | bảng gộp `pack_usage_daily` + mốc; gộp lại 35 ngày, ngày không còn dòng thì không bị ghi 0 | `retention-db` "giờ đã quay KHÔNG tụt khi dòng sổ video … biến mất" |
| X5 | Video chưa khớp đơn vì Shopee cấp mã vận đơn MUỘN bị L1 xóa sau 3 ngày | ⚠️ **CHƯA chặn**: chưa có bước khớp lại tem trước L1 (câu khớp đi qua `Order.trackingCode` chưa chỉ mục — chờ M2) | chạy bóng nên chưa mất gì; điều kiện trước khi bật xóa thật (19.9 X-b) |
| X6 | Gian LazMall bị xóa sớm | sổ không có cờ LazMall → mọi gian Lazada dùng 35 ngày | test "Lazada: … mốc dài 35 ngày" |
| X7 | Xóa tệp lỗi giữa chừng | tệp xóa NGOÀI giao dịch, lỗi thì dòng để STORED, lượt sau thử lại | mã + test bật xóa thật |
| X8 | Video của khách đã xóa tài khoản còn trên kho | `owner-purge.ts` sau cờ | `retention-db` "xóa tài khoản: SAU CỜ chỉ đếm; bật cờ thì xóa" |
| X9 | Test làm bẩn mốc gộp của cả database | test lưu mốc trước, trả lại sau | — |

### 19.6 Bảng gộp giờ theo ngày (`pack_usage_daily`)

Migration `20261118201000_pack_usage_daily` (chỉ CREATE, RLS): một dòng / (chủ shop, ngày quay): số video, giây, byte. Mã
`services/pack-video/usage-daily.ts`: đã quay = Σ bảng gộp (ngày ≤ MỐC) + Σ `pack_videos` STORED + DELETED (ngày > MỐC); MỐC ở
`maintenance_jobs` key `pack-usage-daily`; chỉ gộp ngày cũ hơn 7 ngày; mỗi lượt gộp lại 35 ngày trước mốc (số tự chọn); không bao giờ
lùi mốc; gộp + dời mốc trong MỘT giao dịch. ⚠️ Việc bỏ mảnh tháng (chưa làm) PHẢI kiểm MỐC ≥ ngày cuối của mảnh định bỏ. Video tải
lên muộn vào ngày đã gộp sẽ thiếu trong "đã quay" tới lượt gộp kế (≤ 6 giờ) — chấp nhận (sai về phía có lợi cho khách, nhỏ).

### 19.7 Cây tệp mới / đổi

```
backend/prisma/migrations/20261118200000_pack_hour_grants_purchase_ref/migration.sql   # ADD trên pack_hour_grants
backend/prisma/migrations/20261118201000_pack_usage_daily/migration.sql               # CREATE pack_usage_daily
backend/src/lib/pack-video-hour-pricing.ts        (+ __tests__)   # thuần: tính tiền giờ quay
backend/src/lib/pack-video-retention.ts           (+ __tests__)   # thuần: luật L1–L6
backend/src/services/pack-video/usage-daily.ts                    # gộp giờ theo ngày + đọc "đã quay"
backend/src/services/pack-video/retention.ts                      # áp luật lên sổ (gán hạn · tới hạn)
backend/src/services/pack-video/owner-purge.ts                    # dọn video khi xóa tài khoản (sau cờ)
backend/src/services/pack-video/__tests__/retention-db.test.ts
backend/src/workers/pack-video-janitor.ts                         # nhịp 6 giờ, chỉ cờ chống chạy chồng
frontend/src/components/orders/videos/hour-ledger.tsx             # sổ giờ ở tab Thống kê
```

### 19.8 CHỜ ANH — mua giờ (em DỪNG phần nối cổng ở đây)

| # | Câu | Vì sao phải anh quyết | Em đề nghị |
|---|---|---|---|
| H1 | Hóa đơn khoản mua giờ: TÊN DÒNG + THUẾ SUẤT. Gói đang xuất "Phần mềm Hubsell - …" không chịu thuế (KCT) | khoản này là thời lượng LƯU video trên máy chủ — có cùng diện "phần mềm" với gói không em không tự kết luận được (thuế làm cẩn thận) | anh hỏi kế toán; em dựng sẵn hai cách, anh chọn một: (a) "Gói phần mềm Hubsell - mua thêm N giờ quay video đóng hàng" cùng thuế suất với gói; (b) dòng dịch vụ riêng theo thuế suất kế toán chỉ |
| H2 | Cho em thêm cột vào HAI chỗ của luồng thanh toán đang có: `gateway_payment_orders` thêm `packHours`; loại chứng từ `PackagePaymentKind` thêm `PACK_HOURS` | lịch dặn migration chỉ ADD trên `pack_hour_grants` | đồng ý — cả hai là ADD (cột rỗng được + thêm giá trị loại), không khóa bảng lớn, giống cách phí vượt đã làm 11/11 |
| H3 | Hoa hồng giới thiệu 10 % có cộng cho khoản mua giờ không | phí vượt đang cộng; giờ quay là sản phẩm khác | có, cho đồng nhất (chỉ cần anh gật) |
| H4 | Hoàn tiền giờ quay: có hoàn không, hoàn phần giờ chưa dùng hay không hoàn | chính sách bán hàng | không hoàn tự động; ca đặc biệt HQ ghi dòng ADJUST âm + hóa đơn điều chỉnh |

Khi anh trả lời H1 + H2: lát nối cổng ≈ `POST /hours/checkout` + nhánh `settleGatewayOrder` + `hqItemNameFor` + bật `SALES_OPEN` +
test DB "tiền về → cộng giờ + chứng từ + sổ quỹ + hóa đơn" + thử bằng cổng giả lập `backend-http-payos` trên local.

### 19.9 CHỜ ANH — luật xóa

| # | Câu | Em đề nghị |
|---|---|---|
| X-a | Ca hoàn ĐANG MỞ quá 90 ngày: giữ tiếp (lịch dặn "mọi dấu hiệu hoàn đều CHẶN xóa") hay trần 90 vẫn áp (mục 54.4 tài liệu khảo sát, Shopee DPP)? Mã hiện GIỮ | giữ khi ca mở (bằng chứng đang dùng), nhưng worker báo số ca quá 90 ngày để anh xem |
| X-b | L1 (video chưa khớp đơn, xóa sau 3 ngày): trước khi bật xóa thật phải khớp lại tem (Shopee cấp mã vận đơn muộn) — cần chỉ mục `Order.trackingCode` của M2 | bật xóa thật cho L2–L6 trước, L1 sau M2 |
| X-c | Bật xóa thật sau bao lâu chạy bóng | một tuần như kế hoạch, đối chiếu "sẽ xóa" với đơn thật rồi anh duyệt |

### 19.10 Đã kiểm / chưa kiểm

- ✅ Backend `tsc` sạch. Test phần video (12 tệp) **202 / 202** xanh: luật xóa 38, tính tiền 16, sổ giờ 16, luật trên sổ thật 7, tải
  lên (thêm ca hết giờ), cô lập, HTTP, `no-module-state`. Cả bộ backend: 2.735 đậu / **6 rớt đều ở 4 tệp sổ cái** (`ads-rows-ledger`,
  `channel-delete`, `order-ledger`, `realized-pnl-ledger`) — đúng 6 lỗi có sẵn ghi từ 16/11, không chạm mã video.
- ✅ Frontend `tsc` + `eslint` (phần video) sạch; `next build` qua.
- ✅ Hai migration đã áp lên database LOCAL bằng `prisma db execute`; `prisma generate` chạy lại.
- ❌ **CHƯA soi màn**: phiên chạy tự động, hai server local (`backend-http`, `frontend-http`) bị từ chối khởi động — em không thử lại.
  Hộp mua, sổ giờ, cột "Giữ tới", hộp "Hết giờ quay" CHƯA nhìn ở sáng / tối, 1280 / 1440. Bảng video 1280 vốn đã cuộn ngang ≈ 176 px;
  cột "Giữ tới" chỉ hiện khi có số nhưng sẽ làm rộng thêm — phải đo trước khi push.
- ❌ Worker chưa chạy một lượt thật trên local (chỉ chạy qua test với phạm vi một chủ shop). Database local đang KHÔNG có mốc gộp.

### 19.11 Trước khi push (theo thứ tự)

1. Soi màn local (19.10) + gửi anh ảnh theo trình tự: hộp mua → màn quay hết giờ → tab Thống kê sổ giờ → cột Giữ tới.
2. ⚠️ **Cấp giờ cho `admin@hubsell.vn` trên PROD TRƯỚC khi deploy** — prod hiện 0 giờ; bản này chặn mở video mới khi hết giờ nên
   iPhone (build 34/35) + webcam của anh sẽ bị 402 ngay. Lệnh: `npx tsx scripts/pack-video-grant-hours.ts --email=admin@hubsell.vn
   --hours=<anh chọn> --note="cấp thử"` (cần biến kết nối prod — anh chạy hoặc bảo em).
3. App iPhone (nhánh thử) chưa biết mã `OUT_OF_HOURS` — sẽ hiện lỗi chung; sửa ở lần dựng sau.
4. Hai migration tự áp khi Render deploy; worker chạy bóng tự bật ở dịch vụ worker (env xóa thật mặc định tắt).

---

## 20. Nối payOS cho khoản mua giờ + ô "Số giờ muốn mua" (18/11/2026 ~21:00 — ĐÃ PUSH 18/11 ~21:25, anh: "Đổi luôn và push phần này lên nhé")

> Anh 18/11: "Làm phần mua giờ, nhưng anh đang muốn thêm cả việc nhập số lượng giờ quay video muốn mua nữa từ đó tính ra
> tiền. Khách thanh toán em định đặt code trên PayOS là gì?" → làm đúng thiết kế đường tiền ở mục 19.2.

### 20.1 Hộp mua

Một nguồn số: ô **"Số giờ muốn mua"** (số nguyên, 20–10.000 giờ). Ba gói sẵn 50 / 200 / 500 chỉ là lối tắt điền số vào ô.
Tiền = số giờ × 1.500 đ, đổi theo ngay khi gõ. Web chỉ gửi SỐ GIỜ; máy chủ tự tính tiền (`quoteHours`).

### 20.2 Mã trên payOS

| Thứ | Giá trị | Ghi chú |
|---|---|---|
| Nội dung chuyển khoản | `HS PAC<số giờ> <8 số cuối mã đơn>` — vd `HS PAC200 45678901` | `HS` = tiền tố sản phẩm (env), `PAC` = `PACK_VIDEO_HOUR_TRANSFER_CODE`. Dài nhất `HS PAC10000 12345678` = 20 ký tự ≤ trần 25 |
| Khi trần chỉ 9 ký tự | `HS PAC200` nếu vừa, không vừa thì `HS PAC` | không để bị cắt thành số giờ SAI (`PAC1000` → `PAC100`) |
| Mã đơn payOS (`orderCode`) | số 16 chữ số tự sinh | cùng hàm với mua gói / phí vượt |
| Tên mặt hàng gửi payOS | "Mua N giờ quay video đóng hàng" | |

Cùng họ với hai mã đang có: gói `HS <MÃ GÓI> …`, phí vượt `HS VUOTmmyy …`.

**Anh chốt 18/11 ~21:10:** "Em để code thanh toán là HS PAC... Đi. Sau anh đặt tên là HubPac (Packing)" → mã là `PAC` (bản đầu em đặt `GIO`). Tên sản phẩm **HubPac** anh sẽ đặt sau; giao diện và tên dòng hóa đơn CHƯA đổi chữ.

### 20.3 Đường tiền (đã làm)

`POST /api/pack-videos/hours/checkout { hours }` (chỉ chủ shop) → `createPackHoursCheckout` → `openGatewayOrder` (đơn cổng mang
`packHours`) → khách quét → webhook / poll → `settleGatewayOrder` nhánh `packHours` → `recordHoursPayment` — MỘT giao dịch:
dòng `PURCHASE` trong `pack_hour_grants` + chứng từ `PackagePayment` kind `PACK_HOURS` + bút toán THU `invoiceStatus PENDING` +
đơn cổng PAID. Sau giao dịch: `kickHqAutoInvoice`. Không gia hạn thuê bao.

- Chống cộng đôi: hai chỉ mục duy nhất trên cùng mã khoản tiền (`package_payments.externalRef`, `pack_hour_grants.paymentRef`).
- Tiền thiếu, tiền thừa, hoặc đơn giá đổi giữa lúc lấy mã và lúc trả → đơn `MISMATCH` + thư HQ; không cộng giờ, không chứng từ.
- Trạng thái / hủy mã dùng chung `/api/subscription/checkout/:orderCode`. Một khách chỉ có một mã sống (lấy mã mới hủy mã cũ,
  kể cả mã mua gói đang chờ — luật sẵn có của `openGatewayOrder`).
- payOS chuyển khách về `/orders/videos?checkout=<mã đơn>`; trang tự mở lại hộp kết quả.

### 20.4 Schema — chỉ ADD (migration `20261118210000_pack_hours_checkout`)

`PackagePaymentKind` thêm `PACK_HOURS` · `gateway_payment_orders.packHours` · `package_payments.packHours`. Đây là câu H2 của
mục 19.8, thêm một cột so với đề nghị cũ (`package_payments.packHours`, để tên dòng hóa đơn đọc số giờ mà không mượn cột
`committedOrders`).

### 20.5 Hóa đơn + công tắc

- Tên dòng: "Gói phần mềm Hubsell - mua thêm N giờ quay video đóng hàng" (`hqItemNameFor` kind `PACK_HOURS`), đi chung đường
  tự xuất của gói. Căn cứ: anh 16/11 "Mình không mất VAT". Mức chắc: theo lời anh, CHƯA phải ý kiến kế toán / cơ quan thuế.
- Mở bán: env `PACK_VIDEO_HOUR_SALES_OPEN=1` + có khóa payOS. Mặc định tắt → nút báo "Chưa mở thanh toán", máy chủ từ chối tạo mã.
  Local: cấu hình `backend-http-payos` trong `.claude/launch.json` đã bật sẵn.

### 20.6 Chờ anh

| # | Câu | Mã đang làm gì |
|---|---|---|
| H3 | Hoa hồng giới thiệu 10 % có cộng cho khoản mua giờ không | KHÔNG cộng |
| H4 | Hoàn tiền giờ quay | chưa có đường hoàn; ca đặc biệt HQ ghi dòng ADJUST âm bằng script |

### 20.7 Đã kiểm / chưa kiểm

- ✅ `pack-hours-checkout.test.ts` 6 / 6 (tính tiền theo số giờ nhập, dùng lại mã, đổi số giờ hủy mã cũ, tiền về cộng đúng giờ +
  chứng từ + sổ quỹ, bắn lặp không cộng đôi, thiếu / thừa → MISMATCH, công tắc tắt, trần ký tự). Nhóm video + cổng + hóa đơn +
  gói: 256 / 256. `tsc` hai phía + `eslint` các tệp web đã sửa: sạch.
- ✅ Soi local (giao diện sáng): hộp mua mở đúng, gõ 350 → "350 giờ × 1.500 ₫ = 525.000 ₫".
- ❌ CHƯA nhìn bước QR → tiền về → số dư đổi trên trình duyệt: backend local cổng 4010 thuộc phiên chat khác, không có payOS giả
  lập. Cần dừng nó rồi chạy `backend-http-payos`, mở `http://localhost:4099/mock/pay/<mã đơn>` để giả tiền về.
- ❌ Chưa soi giao diện tối, chưa đo 1280 / 1700. Chưa chạy cả bộ backend. Chưa có test HTTP cho đường `/hours/checkout`.

### 20.8 Trước khi push (thêm vào 19.11)

5. Đặt `PACK_VIDEO_HOUR_SALES_OPEN=1` trên Render (dịch vụ web) khi anh muốn mở bán; migration tự áp lúc deploy.
6. Thử một khoản thật số nhỏ (20 giờ = 30.000 đ) rồi xem tờ hóa đơn đầu tiên trước khi mở cho khách thứ hai.

### 20.9 Sau khi push (18/11 ~21:25, commit `b63ed8e6`)

- ✅ KHOẢN THẬT ĐẦU TIÊN 18/11 21:31 (anh: "Mua xong. bị trừ luôn 10 phút trước đó quay vượt"): anh mua 20 giờ = 30.000 đ qua payOS trên prod; HQ Gói dịch vụ có chứng từ "Mua 20 giờ quay video · Cổng thanh toán · +30.000₫ · Hệ thống (payOS)"; HQ Kế toán có bút toán THU "Thu tiền mua 20 giờ quay video đóng hàng", hóa đơn đã đẩy tờ nháp lên meInvoice, đang "Chờ anh ký"; số dư = 20 giờ − ≈10 phút đã quay thử từ trước (đúng luật "vượt gói khấu trừ vào lần thanh toán tiếp theo"). Em KHÔNG tự nhìn được số dư phía khách (Chrome lúc kiểm đang đăng nhập nick HQ) — số dư là theo lời anh. CHƯA xem tờ hóa đơn đã ký, chưa xem log webhook.

- ✅ 18/11 ~21:35 anh chọn "Bật mở bán" → em đặt `PACK_VIDEO_HOUR_SALES_OPEN=1` trên Render dịch vụ web `hubsell-backend-sg` (qua trang Environment, Render tự deploy lại, log "No pending migrations to apply" + "Your service is live"); prod: nút "Thanh toán 300.000 ₫" đã bấm được, hết dòng "Chưa mở thanh toán". ⏳ anh tự mua thử 20 giờ = 30.000 đ (em KHÔNG bấm trả tiền thay) → sau đó kiểm: giờ cộng, sổ giờ, chứng từ HQ, tờ hóa đơn đầu tiên. Tắt bán: xóa biến đó trên Render.

- Prod: đã kiểm prod ~21:25: Render `/health` = `b63ed8e6`, `POST /hours/checkout` chưa đăng nhập trả 401, web `app.hubsell.vn/orders/videos` (nick admin) hiện "Vượt gói 9 phút" + hộp mua mới, nút Thanh toán báo "Chưa mở thanh toán" (env chưa bật); CHƯA xem log worker dọn, CHƯA thử trả tiền thật.

- Chữ anh sửa: "Phần thời gian vượt gói sẽ khấu trừ vào lần thanh toán tiếp theo."; "Quay lố" → "Vượt gói" (hàng tab, ô số dư hộp mua, màn quay).
- Bản đẩy gồm CẢ mục 19 (hết giờ thì dừng + luật xóa chạy bóng) vì các tệp đan nhau. Trước push: cả bộ backend 2.742 đậu / 6 rớt (6 lỗi sổ cái có sẵn), `next build` qua, worker dọn chạy một lượt bóng trên local.
- ⚠️ Prod sau deploy: `admin@hubsell.vn` 0 giờ → không mở được video mới tới khi cấp giờ (bước 2 mục 19.11 CHƯA làm — chờ anh cho số giờ) hoặc bật `PACK_VIDEO_HOUR_SALES_OPEN=1` rồi mua.

## 21. Lát M1 "hàng chờ bền" — ĐÃ DỰNG TRÊN LOCAL 18/11/2026 ~21:30–22:00 (chỉ web; CHƯA commit, CHƯA push; lịch anh đặt: "M1 để tối làm")

Phạm vi đúng mục 18.4 / 18.5: N1, N2, N4, N5, N7 + bỏ làm mới sau mỗi clip. Không sửa backend, không migration, không đụng prod.
⚠️ **Câu K-1 (N-b cũ) anh CHƯA trả lời** — lát này đang làm theo đề nghị của em: tệp trên ổ chỉ là hàng đang chờ gửi, lên kho là xóa,
không có nút xem / giữ / tải video từ máy. Anh xác nhận rồi mới commit.

### 21.1 Có gì

| Rủi ro | Đã làm | Tệp |
|---|---|---|
| N1 mất clip khi tải lại trang / Chrome sập | clip ghi xuống ổ riêng của trang (OPFS) NGAY trong lúc quay, `moov` cuối tệp (`fastStart: false` + `StreamTarget`, khúc 1 MiB); **mỗi khúc một tệp mảnh, đóng ngay** (18.10 B3); sổ hàng chờ ở IndexedDB; mở lại màn quay là tự gửi tiếp; xin `navigator.storage.persist()`; lên kho xong xóa sổ rồi xóa tệp | `lib/pack-video-recorder/clip-store.ts` (lõi), `clip-store-opfs.ts` (trình duyệt), `byte-overlay.ts` (ghép mảnh), `clip-pipeline.ts` |
| N2 bỏ cuộc sau 4 lần | thử lại KHÔNG giới hạn; trần chờ 4 → 8 → … → 300 giây, lệch ngẫu nhiên toàn phần trong [2 giây, trần]; mất mạng thì đứng chờ không đốt lượt; có mạng lại / bấm "Thử ngay" là chạy ngay; clip hỏng xuống cuối hàng; chỉ dừng hẳn với lỗi biết chắc vô ích (chưa mở tính năng, hết giờ quay, phiên hết hạn, tệp hỏng) — tệp VẪN giữ, có nút Thử lại | `upload-backoff.ts`, `upload-queue.ts`, `upload-transport.ts` |
| N4 mạng chậm hơn tốc độ quay | đo tốc độ tải thật bằng chính số byte kho đã nhận (cửa sổ 20 giây), so với tốc độ quay; dải vàng "Mạng tải lên chậm hơn tốc độ quay — đang chờ N video (≈ M phút)"; KHÔNG dừng quay | `upload-speed.ts`, `components/orders/videos/record/queue-notice.tsx` |
| N5 ổ đầy | KHÔNG tin `storage.estimate()`. Một mảnh ghi hỏng → mảnh đó + phần còn lại của clip nằm trong bộ nhớ (clip đang quay QUAY NỐT), báo động + dải đỏ, chỉ khóa MỞ clip mới; clip lên kho → đo lại ổ → tự mở khóa. Cảnh báo sớm: ghi thử 64 MB lúc mở hàng chờ và tối đa 5 phút một lần khi có clip xong | `clip-store.ts` (`PieceSink`), `session.ts` (`checkDisk`, `diskBlocker`) |
| N7 vé hết hạn | vé xin ngay trước mỗi lượt gửi (giữ nguyên) | `upload-transport.ts` |
| N9 (phần web) | làm mới số liệu máy chủ gộp tối đa 1 lần / 30 giây thay vì sau mỗi video | `use-pack-recorder.ts`, `upload-speed.ts` (`createThrottle`) |
| ngoài đề xuất (18.10 C1, C2) | clip gắn tài khoản đã quay — không gửi nhầm sang tài khoản khác dùng chung máy; khóa giữa các tab (Web Locks) — hai tab không gửi trùng, không dọn nhầm clip đang quay | `clip-store.ts`, `clip-store-opfs.ts`, `session.ts` |

Một dải báo duy nhất trên màn quay, ca nặng nhất thắng: ổ đầy (đỏ) > mất mạng > chưa gửi được, đang tự thử lại (có nút "Thử ngay") > mạng
chậm > ổ sắp đầy. Không có nút gạt — dải tự mất khi tình trạng hết. Ô Nhật ký giữ nguyên, thêm các dòng: mất mạng / có mạng lại / còn N
video từ lượt trước / thử lại sau N giây / ổ đầy / ổ có chỗ lại. Dòng clip trong "Lượt quay này" có nhãn "lượt trước" và chữ "chờ thử lại".

Số TỰ CHỌN (chưa có số đo, ghi rõ trong mã): trần chờ 5 phút · nền 4 giây · sàn 2 giây (sàn có căn cứ: R2 1 ghi / giây / tên tệp) · ghi
thử 64 MB · 5 phút / lần ghi thử · gợi ý "sắp đầy" khi trình duyệt báo < 1 GB · báo "mạng chậm" từ 2 video chờ · báo "chưa gửi được" từ
2 lần hỏng liên tiếp · làm mới 30 giây · cửa sổ đo tốc độ 20 giây.

### 21.2 Cây tệp (đúng luật: `lib/` thuần, không nhập ngược từ `components/`)

```
frontend/src/lib/pack-video-recorder/
  upload-backoff.ts      MỚI  thuần — dãy thời gian chờ
  upload-queue.ts        MỚI  thuần — máy trạng thái hàng chờ (đồng hồ / mạng truyền vào)
  upload-speed.ts        MỚI  thuần — đo tốc độ, câu báo, gộp làm mới
  byte-overlay.ts        MỚI  thuần — ghép tệp từ các lần ghi
  clip-store.ts          MỚI  thuần — kho mảnh + sổ, ổ đĩa / sổ truyền vào
  clip-store-opfs.ts     MỚI  trình duyệt — OPFS, IndexedDB, Web Locks, ghi thử
  upload-transport.ts    MỚI  đường gửi (xin vé → PUT → chốt) + phân loại lỗi — tách khỏi session.ts
  session.ts             SỬA  dùng các khối trên; thêm tình trạng hàng chờ, mở lại hàng chờ
  clip-pipeline.ts       SỬA  ghi xuống kho mảnh, `moov` cuối tệp
  recorder.ts, types.ts  SỬA  `clipBlocker` (lý do không mở clip) thay `canOpenClip`; kiểu tệp theo mảnh
  __tests__/upload-queue.test.ts, clip-store.test.ts   MỚI
frontend/src/components/orders/videos/record/
  queue-notice.tsx       MỚI  dải báo
  record-screen.tsx, control-panel.tsx, use-pack-recorder.ts   SỬA
```

Frontend chưa có bộ chạy test → test viết bằng `node:test` có sẵn của Node, chạy bằng bộ nạp TypeScript của backend (không thêm gói nào):
`cd frontend` rồi `node --import ../backend/node_modules/tsx/dist/loader.mjs --test "src/lib/pack-video-recorder/__tests__/*.test.ts"`.

### 21.3 Đã kiểm (số thật)

- Test hàm thuần **23 / 23**: dãy thời gian chờ; hỏng 12 lần liên tiếp vẫn thử (4 → 8 → … → 300 giây); clip hỏng không chặn clip sau;
  mất mạng không đốt lượt; có mạng lại bỏ khoảng nghỉ; ổ đầy giữa clip (ổ giả) tệp vẫn đúng từng byte; sổ theo tài khoản; tệp cụt / mất;
  thứ tự dải báo; gộp làm mới. `tsc` + `eslint` sạch, `next build` qua.
- Chạy thật trên local (`localhost:3010` + backend 4010 đang chạy sẵn, tài khoản `admin@hubsell.vn`, R2 bucket thử) trong trình duyệt
  của Claude, **camera GIẢ** (luồng hình vẽ 1280×720 30 khung / giây thay cho webcam — trình duyệt đó không có camera):
  1. quay 9 giây → lên kho → ổ 0 tệp;
  2. giả mất mạng (ép `navigator.onLine` + sự kiện `offline`) → quay 2 clip (7 + 10 giây) → trên ổ 2 thư mục × 3 mảnh (1,45 MB + 2,06 MB),
     sổ 2 dòng → **tải lại trang thật** → nhật ký "Còn 2 video quay từ lượt trước… đang gửi tiếp" → cả 2 lên kho → ổ 0 thư mục, sổ 0 dòng;
  3. chặn mọi lượt PUT tới R2 → dải vàng "Chưa gửi được… tự thử lại sau N giây" + nút Thử ngay, khoảng chờ thật 6 · 3 · 10 giây (lệch
     ngẫu nhiên), 4 lượt PUT bị chặn; tải lại trang → 2 clip lên kho;
  4. giả ổ đầy (ép lệnh mở tệp ghi ném `QuotaExceededError`) GIỮA clip → clip quay nốt 20 giây, dải đỏ, nút Bắt đầu quay khóa, clip
     (1 mảnh trên ổ + phần còn lại trong bộ nhớ, 4,07 MB) vẫn lên kho đúng cỡ; bỏ giả lập + Thử ngay → "Ổ đĩa đã có chỗ lại", nút mở;
  5. **tua với `moov` cuối tệp, đọc thẳng R2 qua đường dẫn ký sẵn**: tệp là `ftyp mdat…`, yêu cầu khoảng byte trả 206; clip 20 giây nạp
     thông tin 951 ms, tua giữa 311 ms, tua cuối 284 ms; clip 6 giây 1.044 / 253 / 350 ms;
  6. không cuộn ngang ở 1280 / 1440 / 1700; dải báo đọc rõ ở giao diện tối.
- Để lại trên local: 8 clip thử "QUAYTAY2145xx–2148xx" (≈ 1,5 phút, ≈ 17 MB) trong sổ video local + bucket thử.

### 21.4 CHƯA kiểm — phải làm trước khi tin

1. **Webcam thật + tem thật** (lượt này camera giả; đường đọc tem / tự cắt không đổi mã nhưng chưa chạy lại).
2. **Mất mạng thật** (rút dây / tắt Wi-Fi): mới giả bằng cờ của trình duyệt và bằng chặn lượt PUT.
3. **Ổ đầy thật**: lỗi Chrome ném khi ổ vật lý đầy chưa ai ghi lại (18.10) — mã bắt MỌI lỗi ghi nên không phụ thuộc tên lỗi, nhưng chưa thấy tận mắt.
4. Chrome sập thật / tắt máy giữa lúc đang gửi; hai tab cùng mở màn quay; hai tài khoản chung một máy.
5. Clip dài (15 phút ≈ 92 MB, đi đường tải theo mảnh > 32 MB) và hàng chờ dài (vài trăm clip).
6. Giao diện tối: mới soi dải báo bằng cách ép lớp `dark`, chưa bấm nút đổi giao diện.
7. Màn quay trên điện thoại (app) không dùng mã này — hàng chờ của app là việc riêng.

### 21.5 Giới hạn còn lại (đã ghi ở 18.10 mục C)

Clip ĐANG quay lúc trang sập không cứu được (→ M1b, K-2) · hàng chờ chỉ tự gửi tiếp khi mở màn quay (→ K-6) · clip chờ quá 25 giờ mà hết
giờ quay thì máy chủ từ chối (→ M2) · chưa nghe `Retry-After` của máy chủ (→ M2).

### 21.6 Khi anh bảo commit

Chỉ gom tệp của M1: 10 tệp mới + 7 tệp sửa ở mục 21.2 + phần mục 18.10 / 21 của tệp này + mục PROGRESS của phiên. KHÔNG gom: các tệp
`docs/ADS-*`, `docs/DONG-TIEN-*`, `docs/QUAN-LY-KHO-*`, `hubsell-mobile/src/lib/scan-sounds.ts`, `hubsell-marketing/*` (của phiên khác).
Trước khi push: làm mục 21.4 điểm 1–2 với webcam của anh.

---

## 22. Camera CẬN CẢNH soi tem, ghép vào góc video toàn cảnh — KHẢO SÁT + ĐỀ XUẤT (19/11/2026, anh CHƯA duyệt, chưa code)

Anh Trung 19/11: "thêm một cổng quay video cận cảnh (mục đích quay tờ vận đơn nằm im 1 chỗ trên bàn) song song với quá trình quay camera
toàn cảnh rồi ghép vào một video… vị trí ghép cận cảnh vào một góc nhỏ trong video toàn cảnh thì khách hàng được phép di chuyển cài đặt
1 lần cho phù hợp với góc quay của khách. Và phần cận cảnh này là tùy chọn thêm trên cài đặt chỉ áp dụng cho webcam." Anh vẽ ô đỏ ở
**góc phải dưới** khung hình, cỡ ≈ 17 % bề ngang × 29 % chiều cao (đo trên ảnh chụp), và khoanh ô Camera + khoảng trống dưới ô "Chọn
camera…" = chỗ đặt tùy chọn. Đây là P5 của tài liệu khảo sát mục 64.4 (trước xếp "để sau") — nay anh gọi làm.

Ký hiệu: **[C]** đã đo / đã đọc mã · **[tính]** em tính, chưa đo · **[S]** suy đoán.

**★★ ANH CHỐT 19/11 (sau khi đọc đề xuất):** "tùy chọn 2 camera cho người có nhu cầu, còn bình thường là mình vẫn sẽ dùng 1 camera. Cam cận
cảnh thì không có chức năng ngắt video, chỉ ngắt khi nó nhận được tín hiệu ngắt từ cam toàn cảnh."
→ (1) Mặc định MỘT camera, mọi thứ như hiện nay; cận cảnh là tùy chọn TẮT sẵn. (2) Camera cận CHỈ là nguồn hình cho ô ghép: **không đọc
tem, không mở / cắt / dừng clip**. Đọc tem + tự cắt vẫn CHỈ ở camera toàn cảnh, luật và câu hướng dẫn "Giơ tem vào camera" giữ nguyên.
⛔ Đề xuất "bật cận cảnh thì đọc tem bằng camera cận" của em BỎ — đừng đề xuất lại. Các đoạn dưới đã sửa theo.

### 22.1 Kết luận trước

- **Làm được, không đụng máy chủ, không migration, không đổi cách tính giờ.** Vẫn MỘT tệp video, MỘT bộ mã hóa, một lượt tải lên.
- **Ghép ngay lúc quay**, ở đúng chỗ đang in ngày giờ + mã vận đơn (`stamp-canvas.ts`): mỗi khung hình toàn cảnh vẽ thêm khung mới nhất
  của camera cận vào một ô. Không ghép sau khi quay (sàn đòi video liền, không chỉnh sửa; ghép sau = máy chủ phải mã hóa lại).
- **Điểm phải đo trước khi code: ô nhỏ ở 720p có đọc được chữ trên tem không** (mục 22.3) — em tính là KHÔNG nếu soi cả tờ tem.

### 22.2 Căn cứ đã có [C]

- Chrome mở 2 camera thật cùng lúc trong MỘT tab, mỗi cái 1280×720 · 30 khung / giây (khảo sát 62.5, 17/11).
- Hai webcam cắm chung MỘT ổ chia USB rời → chỉ một con chạy, ở mọi cỡ hình (mục 18.7, 18/11) → camera cận phải cắm cổng khác trên máy.
- Máy anh (i5-10400F + GTX 1650 SUPER) chạy 6 đường quay riêng cùng lúc còn dư (18.9). Đề xuất này nhẹ hơn nhiều: chỉ thêm MỘT lần vẽ
  hình mỗi khung, không thêm bộ mã hóa.
- Đường quay hiện tại [đọc mã 19/11]: `frame-pump.ts` đọc khung camera → `StampCanvas.draw()` vẽ khung + ngày giờ + dòng mã →
  `VideoEncoder` → mediabunny. Bộ đọc tem (`scanner.ts`) nhận khung GỐC qua `FrameTap`. Camera đã chọn nhớ ở `localStorage` của máy
  (`use-pack-recorder.ts`).

### 22.3 Bài toán điểm ảnh — chỗ dễ làm xong mà vô dụng [tính]

Tem A6 100 × 150 mm; chữ dòng mã vận đơn cao ≈ 3–4 mm (ước, chưa đo tem thật); đọc chắc cần chữ cao ≥ 12 điểm ảnh ≈ 4 điểm ảnh / mm
(khảo sát 64.2). Bề ngang tem mà ô soi được ở mức đọc chắc:

| Khổ video | Ô rộng | Điểm ảnh ngang của ô | Soi rõ được bề ngang |
|---|---|---|---|
| 720p (đang dùng) | 17 % (ô anh vẽ) | ≈ 215 | ≈ 54 mm |
| 720p | 30 % | 384 | ≈ 96 mm |
| 1080p | 17 % | ≈ 326 | ≈ 82 mm |
| 1080p | 25 % | 480 | ≈ 120 mm |

→ Ô cỡ anh vẽ ở 720p: nếu camera cận soi CẢ tờ tem thì chữ mã vận đơn chỉ ≈ 6–9 điểm ảnh — thấy có tem, thấy mã vạch, KHÔNG đọc chắc
dòng chữ nhỏ (khớp số đo thật 64.6: tem chiếm 30 % khung 768×1024 đã không đọc được dòng mã). Ba cách kéo lên, dùng kết hợp được:
1. **Chỉ soi VÙNG MÃ** của tem (mã vạch + dòng mã vận đơn, ≈ 6–9 cm), không soi cả tờ → ô nhỏ vẫn đủ. Cần nút **phóng to** trong ô vì
   webcam rẻ lấy nét cố định, không đặt sát tem được [S].
2. Cho khách kéo to ô (tới ≈ 35–40 % bề ngang).
3. Nâng video lên 1080p khi bật cận cảnh → tệp nặng ≈ 2 lần → giá vốn một giờ quay tăng tương ứng (mục 16) — anh quyết, sau khi có số đo.

Thêm: bitrate 800k có giữ nét chữ nhỏ đứng yên trong ô không — CHƯA biết [S: vùng đứng yên nén rất tốt, nhưng khung khóa mỗi giây ở
800k có thể làm nhòe]. Dòng "Mã vận đơn: …" in chữ to vẫn giữ nguyên, ô cận cảnh là để thấy TEM THẬT.

### 22.4 Thiết kế đề xuất

**Ghép hình**
- Camera cận mở ở khổ gốc lớn nhất nó có (ưu tiên 1920×1080) để phóng to còn nét; khung mới nhất được giữ lại, camera toàn cảnh dẫn
  nhịp (lệch tối đa một khung ≈ 33 ms). Đọc khung bằng đúng đường của camera chính (không phụ thuộc tab ẩn).
- Vị trí + cỡ + mức phóng to là MỘT hàm thuần `pip-layout.ts` dùng chung cho tệp quay và khung xem trước → hai chỗ không lệch (bài học
  18/11: thêm gì vào tệp phải hiện y hệt ở màn xem trực tiếp cùng lượt).
- Ô có viền trắng mảnh; không cho đè lên góc trái trên (ngày giờ + dòng mã).

**Cài đặt (một lần, nhớ theo MÁY)**
- Trong ô Camera, dưới ô chọn camera: hàng "Camera cận cảnh (soi tem)" + công tắc, mặc định TẮT. Bật thì hiện ô chọn camera thứ hai
  (không cho chọn trùng camera chính) + nút "Chỉnh vị trí".
- "Chỉnh vị trí": kéo ô trên khung xem trước, kéo góc để đổi cỡ, thanh phóng to 1×–3×; mặc định góc phải dưới như anh vẽ. Bấm Xong là nhớ.
- Lưu ở `localStorage` của máy (cùng chỗ nhớ camera): vị trí tùy góc đặt camera của TỪNG bàn, và mã thiết bị camera vốn chỉ có nghĩa
  trên đúng trình duyệt đó → không lưu máy chủ.
- Khóa chỉnh khi đang quay (đổi bố cục giữa clip dễ bị coi là chỉnh sửa).

**Luồng đóng hàng khi bật cận cảnh**
- **KHÔNG đổi gì** (anh chốt 19/11): giơ tem vào camera TOÀN CẢNH là quay, tem khác là cắt; nút Bắt đầu / Dừng như cũ. Bộ đọc tem
  (`scanner.ts`) và máy tự cắt (`tem-cutter.ts`) không đụng tới. Camera cận không được nối vào bộ đọc tem.
- Người đóng hàng giơ tem cho camera toàn cảnh xong thì đặt tờ tem xuống chỗ camera cận soi; ô ghép cứ thế hiện hình camera cận suốt
  clip. Clip mở / cắt lúc nào thì ô ghép theo đúng lúc đó, vì nó nằm trong cùng khung hình.
- Lỗ "tem nằm yên sau khi bấm Dừng thì kêu 'đã quay rồi' mỗi 3 giây" em nêu lúc đầu KHÔNG còn: camera cận không đọc tem.

**Sự cố**
- Mất camera cận giữa clip: KHÔNG dừng quay; ô trong video hiện chữ "Mất camera cận cảnh" (video trung thực), báo động, cắm lại tự nối;
  đọc tem + tự cắt không bị ảnh hưởng (vốn ở camera toàn cảnh). Mất camera toàn cảnh: như hiện nay (lưu clip tới lúc mất).
- Không mở được camera thứ hai khi camera chính đang chạy (`NotReadableError`): câu báo "Camera cận cảnh không chạy chung cổng với camera
  chính — cắm sang cổng USB khác trên máy" + nút thử lại. Camera chính vẫn quay bình thường.

**Không làm:** ghép sau khi quay · quay hai tệp riêng · app điện thoại (anh: chỉ webcam) · lưu cài đặt trên máy chủ · ảnh tem lưu ngoài
video (anh đã bỏ 18/11).

### 22.5 Các lát

| Lát | Việc | Xong khi |
|---|---|---|
| **C0 — đo** (trang thử `tools/thu-webcam`, không đụng sản phẩm) | 2 webcam thật cắm 2 cổng riêng + tem GIẤY nằm dưới camera cận; ghép ô; quay ở 720p / 1080p × ô 17 / 25 / 35 % × 800k / 1,5 Mbps; cắt khung từ TỆP đo chữ mã vận đơn cao bao nhiêu điểm ảnh; khoảng lấy nét gần nhất của webcam; khung rớt; tab ẩn; đọc tem ở camera toàn cảnh có chậm đi khi mở thêm camera thứ hai không | có bảng số → chốt cỡ ô mặc định, mức phóng to, có cần 1080p không |
| **C1 — lõi** | `pip-layout.ts` (thuần + test) · nguồn camera thứ hai · `StampCanvas` vẽ ô · `PackRecorder` vòng đời 2 camera + rào mất camera cận (KHÔNG đụng `scanner.ts` / `tem-cutter.ts`) | test + quay được bằng camera giả |
| **C2 — màn hình** | hàng cài đặt trong ô Camera · chế độ Chỉnh vị trí · ô hiện đúng trên khung xem trước · câu chữ mới · soi 1280–1700, sáng / tối | anh thử local với webcam thật |
| **C3** | anh duyệt → push | — |

C1 sửa đúng các tệp lát M1 đang để dở chưa commit (`clip-pipeline.ts`, `recorder.ts`, `session.ts`) → **M1 phải commit trước**, hoặc
C1 dựng chồng lên M1 và đi cùng một lượt.

### 22.6 Chờ anh

- **D-1** Duyệt C0 + chuẩn bị: 2 webcam cắm THẲNG hai cổng trên máy (không qua ổ chia), một tay đỡ cho camera cận, vài tờ tem giấy.
- ~~**D-2**~~ ĐÃ CHỐT 19/11: đọc tem + cắt clip CHỈ ở camera toàn cảnh; camera cận không có chức năng ngắt video.
- **D-3** Ô cận cảnh soi vùng mã (đọc được chữ, em khuyên) hay cả tờ tem (thấy trọn tem, chữ nhỏ mờ) — chốt sau số đo C0; kèm việc
  có nâng 1080p không.

### 22.7 Chưa kiểm

Toàn bộ mục 22.3 là số tính · chưa mở 720p + 1080p cùng lúc trên hai webcam (mới đo 2 × 720p) · chưa biết webcam của anh lấy nét gần
nhất bao nhiêu · sàn có coi ô ghép là "chỉnh sửa" không: không có câu nào của sàn nói; Dohana, ghihinh, EPack đang ghép công khai
(khảo sát 64.3, 64.5) · màn Nhiều bàn (M3, chưa dựng) sau này mỗi bàn = camera chính + camera cận tùy chọn → số webcam trên một máy
tăng gấp đôi, băng thông USB phải đo lại.

### 22.8 ĐÃ DỰNG TRÊN LOCAL 19/11/2026 ~14:00 (anh: "Ok em khảo sát rồi thì làm luôn đi") — chỉ web, CHƯA commit, CHƯA push

Lát C1 + C2 làm một lượt, dựng chồng lên lát M1 đang để dở. Lát đo C0 (webcam thật + tem giấy) CHƯA chạy → các nút cỡ ô / phóng to
trong sản phẩm chính là công cụ để anh đo. Không sửa backend, không migration, không đụng prod.

**Có gì**

| Phần | Tệp | Việc |
|---|---|---|
| Bố cục ô (thuần + 8 test) | `lib/pack-video-recorder/pip-layout.ts`, `__tests__/pip-layout.test.ts` MỚI | vị trí / cỡ / phóng to theo TỶ LỆ khung video; kéo, đổi cỡ, vùng lấy từ camera cận (lấy phần giữa, đúng tỷ lệ ô, không méo); phần khung xem trước mà hình thật chiếm |
| Nguồn camera cận | `closeup-source.ts` MỚI; `camera.ts`, `frame-pump.ts` sửa | mở camera thứ hai (thử 1920×1080 → 1280×720 → 640×480), giữ khung mới nhất; câu lỗi riêng. ⛔ không nối bộ đọc tem |
| Ghép vào tệp | `stamp-canvas.ts`, `clip-pipeline.ts` sửa | vẽ ô + viền trắng TRƯỚC ngày giờ và dòng mã (chữ luôn nằm trên, không bao giờ bị ô che) |
| Vòng đời | `recorder.ts` sửa | `closeup` + `pip` trong trạng thái; mở SAU và RIÊNG với camera chính; mất camera cận → báo động, ô xám "Mất camera cận cảnh" trong video, quay tiếp, cắm lại tự nối; đang quay thì từ chối bật / tắt / đổi camera cận / đổi vị trí |
| Màn hình | `closeup-overlay.tsx` MỚI; `camera-stage.tsx`, `control-panel.tsx`, `record-screen.tsx`, `use-pack-recorder.ts` sửa | hàng "Camera cận cảnh · Tùy chọn" trong ô Camera (mặc định tắt); chọn webcam thứ hai; "Chỉnh vị trí": kéo ô, kéo 4 góc, thanh Phóng to 1×–4×, Về mặc định, Xong; ô hiện y hệt trên khung xem trước; nhớ ở `localStorage` khóa `hubsell.packVideo.closeup` |

`scanner.ts` và `tem-cutter.ts` KHÔNG đổi một dòng (đúng điều anh chốt: camera cận không ngắt video).

**Khác đề xuất 22.4 (em tự quyết lúc làm):** ô có bề ngang và bề cao TỰ DO (anh vẽ ô gần vuông, tem lại là khổ dọc) · không cấm kéo ô
lên góc trái trên — thay bằng vẽ chữ đè lên ô · phóng to quanh TÂM hình, chưa có dời vùng soi (khách xê tờ tem / camera) · camera cận
chưa bật được ngay từ đầu thì video như quay một camera, không vẽ ô trống; chỉ vẽ ô báo khi đang có mà mất giữa chừng.

**Số TỰ CHỌN (chưa có số đo, ghi rõ trong mã):** ô mặc định 20 % × 32 % ở góc phải dưới · giới hạn ô 12–50 % ngang, 15–60 % cao ·
phóng to tối đa 4× · thứ tự khổ hình thử mở.

**Đã kiểm 19/11 (trình duyệt của Claude, HAI CAMERA GIẢ 1280×720 + 1920×1080 — trình duyệt đó bị chặn camera thật):**
- Test thuần 38 / 38 (8 test mới của ô ghép); `tsc` + `eslint` sạch; không có lớp `dark:` nào.
- Bật camera chính → bật tùy chọn → chọn camera thứ hai: ô hiện góc phải dưới trên khung xem trước.
- Soi ĐÚNG khung hình đưa vào bộ mã hóa (chặn `VideoEncoder.encode`, vẽ ra soi): có ô + viền trắng + ngày giờ; đổi cỡ ô + phóng to 2×
  thì khung mã hóa trùng khung xem trước (ô xem trước x 0,633 · w 0,366 so với số đã nhớ 0,633 · 0,367).
- Mất camera cận GIỮA clip: clip quay tiếp (đồng hồ chạy), ô xám có chữ trong khung mã hóa, dải báo đỏ; camera có lại → ô có hình lại;
  bấm Dừng → MỘT clip 35 giây "đã lưu", lên kho local.
- Đang quay: công tắc cận cảnh và nút Chỉnh vị trí đều khóa.
- Kéo ô và kéo góc bằng chuột thật; thanh phóng to bằng phím; số nhớ vào `localStorage`. Tải lại trang → bật camera chính là camera
  cận tự bật theo, ô về đúng chỗ đã chỉnh.
- Camera cận không mở được (giả `NotReadableError`): hiện câu "…không chạy chung cổng với camera chính — cắm sang một cổng USB khác…",
  camera chính vẫn "Sẵn sàng". Mất ≈ 9 giây mới ra câu báo (thử 3 khổ hình × 2 lượt).
- Không cuộn ngang ở 1280 / 1700; giao diện tối đọc rõ (ép lớp `dark`).

**CHƯA kiểm — phải làm trước khi tin:**
1. **Webcam thật**: hai webcam thật cùng lúc (mới đo 2 × 720p ngày 17/11, chưa đo 720p + 1080p), tem GIẤY thật → chữ mã vận đơn trong
   ô đọc được ở cỡ ô / mức phóng to nào (mục 22.3 vẫn là số tính).
2. Rút dây camera cận thật giữa clip; hai webcam chung ổ chia (câu báo); webcam 4:3.
3. Mở TỆP đã lên kho xem lại (lượt này soi khung ở cửa bộ mã hóa, chưa tải tệp về mở).
4. Tốc độ khung khi có thêm camera 1080p trên máy không có card rời; quay dài; tab ẩn.
5. Có tem thật: dòng "Mã vận đơn / Mã đơn hàng" cùng ô cận cảnh (lượt này chỉ quay tay nên không có dòng mã).

**Anh hỏi 19/11: "Cái toàn cảnh có lấy toàn bộ được camera không? Hay phải ép về một cái khung?"** → [đọc mã] camera toàn cảnh được
lấy TRỌN: khổ video = đúng khổ hình camera trả về (`recorder.ts` lấy `width × height` từ camera, `StampCanvas` vẽ nguyên khung), không
cắt, không ép tỷ lệ; camera 4:3 thì tệp là 4:3. Hai điều kèm theo: (1) mình XIN camera chế độ 1280×720 — webcam có cảm biến 4:3 khi chạy
chế độ 16:9 thì chính webcam tự bỏ bớt mép trên dưới, đó là chế độ của camera, không phải mình cắt; (2) ô cận cảnh ĐÈ lên một góc của
cảnh toàn cảnh (phần dưới ô không thấy) → vì vậy cho dời / đổi cỡ. Chỉ camera CẬN mới bị lấy theo khung của ô.

**Dữ liệu thử để lại local:** 2 clip quay tay "QUAYTAY1404…" / "QUAYTAY1406…" trong sổ video local + bucket thử.

**Khi anh bảo commit:** tệp chỉ của lát này — 4 tệp mới (`pip-layout.ts`, `closeup-source.ts`, `closeup-overlay.tsx`,
`pip-layout.test.ts`) + `camera.ts`, `frame-pump.ts`, `stamp-canvas.ts`, `camera-stage.tsx`. Các tệp LẪN với M1: `clip-pipeline.ts`,
`recorder.ts`, `use-pack-recorder.ts`, `control-panel.tsx`, `record-screen.tsx` → gọn nhất là commit M1 và lát này cùng một lượt.

### 22.9 Anh hỏi 19/11: "Dùng 2 camera thì dung lượng lưu sẽ nhiều hơn? Và gói bây giờ khả năng là lỗ" — trả lời bằng số đã có (chưa đo thêm)

- **Dung lượng KHÔNG gấp đôi**: bản đã dựng vẫn ra MỘT tệp, cùng khổ hình, cùng bitrate đặt 800k. Cỡ tệp đi theo bitrate, không theo số
  camera → vẫn quanh 6–7,7 MB / phút (dải đã đo 16–18/11 với một camera; con số cao là lúc hình nhiều chi tiết, bộ mã hóa vượt bitrate).
  Ô cận cảnh thêm chi tiết nên có thể nằm phía cao của dải — CHƯA đo với webcam thật. Cái mất là độ nét chia cho nhiều chi tiết hơn.
- **Chỉ tăng ≈ 2 lần nếu sau này nâng 1080p / bitrate** để chữ trên tem đọc được (câu D-3, chờ số đo).
- **Gói 1.500 đ / giờ không lỗ trên hạ tầng** (số mục 16): giá vốn ≈ 125–150 đ / giờ khi giữ ≈ 25 ngày, ≈ 430 đ nếu giữ đủ trần 90 ngày.
  Kể cả tệp nặng gấp đôi: ≈ 250–300 đ, xấu nhất ≈ 860 đ / giờ — vẫn dưới 1.500 đ (lãi gộp hạ tầng từ ≈ 90 % xuống ≈ 80 %, xấu nhất ≈ 43 %).
- **Chỗ lỗ thật nếu có là luật xóa, không phải camera thứ hai**: luật tự xóa đang CHẠY BÓNG (mục 19.4, theo ghi chú 18/11 — hôm nay chưa
  xem lại prod), chưa xóa thật → mỗi giờ quay tốn ≈ 140 đ MỖI THÁNG cho tới khi bị xóa; ≈ 9–14 tháng là tiền lưu bằng giá bán.
- Việc kèm theo khi anh thử webcam thật: so MB / phút của clip hai camera với clip một camera (cùng máy, cùng cảnh).

### 22.10 COMMIT + PUSH 19/11/2026 chiều (anh: "Commit và push trước để anh test thêm")

Một commit gồm cả lát M1 (mục 21) và camera cận cảnh (mục 22.8) vì 5 tệp lẫn nhau. Chỉ mã web; không backend, không migration. Tính năng
vẫn chỉ mở cho `admin@hubsell.vn` → khách khác không chạm tới. Trước khi commit: test 38 / 38, `tsc` + `eslint` sạch, `next build` qua.
⚠️ M1 lên prod khi mục 21.4 điểm 1–2 (webcam thật + rút mạng thật) CHƯA làm và câu K-1 chưa có trả lời — anh thử thẳng trên prod; mọi
dòng "CHƯA commit / CHƯA push" ở mục 21 và 22.8 là trạng thái TRƯỚC lượt này.

**Sau khi push:** commit `fbf46c98`, đẩy ~14:28. 14:31:52 gói mã công khai của `app.hubsell.vn/orders/videos/record` đã chứa chuỗi của bản
mới (`hubsell.packVideo.closeup`, tệp `/_next/static/chunks/2nzs_klyxf049.js`) — soi tệp tĩnh, không đăng nhập. CHƯA nhìn màn hình trên
prod (em không đăng nhập prod), chưa xem Render. Hai máy chủ local (3010 / 4010) em đã dừng.

---

## 23. Việc còn lại của phần camera — anh nêu 19/11/2026 (DANH SÁCH, chưa làm, chưa xếp thứ tự)

Anh: "Mình còn nhiều việc cho phần camera này lắm. Phần cho nhân viên, hàng đợi, Nhiều camera trên 1 máy (phần này chắc chỉ dùng được 1
camera vì cổng chia hiện không dùng được, hoặc phải test dùng nhiều cổng chia, mỗi cổng chia 1 cam toàn cảnh 1 cam cận cảnh), rồi HQ để
biết R2 mình full hay không còn kịp gia hạn nữa."

| # | Việc | Đang ở đâu | Chờ gì |
|---|---|---|---|
| 1 | **Quay cho nhân viên** (app + web) | thiết kế xong mục 17.2 (lát N1–N5), chưa code | anh chốt C1–C7 |
| 2 | **Hàng đợi** (hàng chờ bền M1) | M1 lên prod 19/11 (22.10); **M1b cứu clip dở + K-6 gửi tiếp ở mọi trang đã dựng LOCAL 19/11 (mục 24)** | anh bảo push; anh thử webcam thật + rút mạng thật (24.5); trả lời K-1, K-3; lát kế M2 (máy chủ gộp lô) |
| 3 | **Nhiều camera trên một máy** (màn Nhiều bàn, M3) | đo M0 xong (18.7–18.9), chưa dựng | xem ghi chú dưới |
| 4 | **HQ theo dõi R2** | chưa có gì | xem ghi chú dưới |

**Ghi chú việc 3 — ổ chia USB [C = đã đo 18/11, S = suy đoán]:** hai webcam chung MỘT ổ chia rời của anh (067B:2586) thì chỉ một con
chạy, ở mọi cỡ hình, cả ngoài Chrome [C]; cắm thẳng máy thì 3 nguồn hình chạy cùng lúc 30 phút không rớt [C]. → Cách "mỗi ổ chia một cam
toàn cảnh + một cam cận cảnh" chính là ca ĐÃ hỏng (hai cam chung một ổ chia), trừ khi ổ chia khác loại. Băng thông USB tính theo bộ điều
khiển trên máy, không theo số cổng [S]. Các cách phải ĐO trước khi dựng màn Nhiều bàn: (a) mỗi webcam một cổng trên thùng máy (đã chạy
với 3 nguồn); (b) ổ chia USB 3.0 có nguồn riêng [S, chưa thử]; (c) thêm card USB gắn trong máy để có thêm bộ điều khiển [S, chưa thử];
(d) camera cận mở khổ nhỏ hơn để nhường băng thông [S]. Mỗi bàn có cận cảnh = 2 webcam → một máy 3 bàn cần 6 đường hình.

**Ghi chú việc 4 — R2 không "đầy":** R2 không có trần dung lượng; dùng bao nhiêu tính tiền bấy nhiêu, trừ vào thẻ của tài khoản
Cloudflare (10 GB đầu mỗi tháng miễn phí). Thứ phải canh không phải "còn chỗ không" mà là: (1) đang lưu bao nhiêu GB → tháng này tốn
bao nhiêu tiền, so với tiền bán giờ; (2) thẻ thanh toán Cloudflare còn trừ được không (thẻ hỏng thì Cloudflare khóa dịch vụ — em chưa đọc
điều khoản khóa sau bao lâu); (3) luật tự xóa có đang xóa thật không (đang chạy bóng). Đề xuất sơ bộ, chưa thiết kế: một thẻ ở HQ Sức
khỏe gồm GB đang lưu + số tệp + ước tiền tháng + GB tăng mỗi ngày + GB luật xóa "lẽ ra đã xóa"; nguồn số = sổ video của mình
(`pack_usage_daily`, không gọi thêm Cloudflare), đối chiếu định kỳ với số Cloudflare báo.

---

## 24. M1 làm dứt điểm: CỨU CLIP ĐANG QUAY DỞ (M1b) + GỬI TIẾP Ở MỌI TRANG (K-6) — 19/11/2026 ~15:00, dựng local → COMMIT + PUSH cùng ngày (anh: "Commit và push"; xem 24.7)

Anh Trung 19/11 (sau khi M1 lên prod): "anh nghĩ mình làm dứt điểm M1 đi". Hai lỗ còn lại của M1 ghi ở 18.10 mục C3 + C5 (câu K-2, K-6)
được làm ở lượt này; câu K-7 (nút "Bỏ video này") GIỮ như cũ — không thêm. Chỉ mã web, không backend, không migration.

### 24.1 M1b — cứu clip đang quay lúc trang sập / bị đóng / máy mất điện

Trước: tệp MP4 viết `moov` ở cuối → clip đang quay dở chỉ là dãy mảnh không phát được, mở lại trang là bị dọn ("không cứu được").

Nay, trong lúc quay, cạnh các mảnh video (`000001`…) trong thư mục clip có thêm SỔ CỨU CLIP:
- `rec-head` — ghi NGAY khi clip mở: tài khoản, mã tem, loại video, giờ bắt đầu, khổ hình, cấu hình giải mã, 32 byte đầu của khung đầu;
- `rec-000001`… — sau MỖI mảnh video đã nằm chắc trên ổ: mảnh đó (tên, vị trí, cỡ) + cỡ / mốc giờ / khung khóa của các khung vừa quay,
  kèm loại video lúc đó (bắt được cả ca đổi sang KHUI giữa clip). ≈ 2,7 KB cho mỗi 1 MiB video [C, đo 19/11].

Mở lại Hubsell: thư mục clip không có dòng sổ hàng chờ mà CÓ `rec-head` của đúng tài khoản đang đăng nhập → đọc các khung nằm trọn trong
phần đã ghi → ghép thành tệp MP4 MỚI hoàn chỉnh (cùng thư viện, cùng cách ghép) → ghi sổ hàng chờ → gửi như clip thường → dọn thư mục
dở. Nhật ký: "Cứu được video … đang quay dở lúc trang bị đóng lần trước (m:ss, thiếu vài giây cuối) — đang gửi".

Ba rào chống sai:
- **Không tin cách thư viện xếp byte**: chỗ bắt đầu dữ liệu khung hình được TÌM bằng 32 byte đầu của khung đầu (không đoán cỡ phần đầu
  tệp); TỪNG khung được soát cấu trúc H.264 (các khối nối nhau vừa khít cỡ khung) trước khi dùng — lệch là dừng ở khung liền trước.
- **Không gửi trùng**: clip quay XONG và đã có dòng sổ hàng chờ thì `rec-head` bị gỡ ngay → thư mục còn sót sau khi gửi (rác) không bao
  giờ bị "cứu" lại. Clip được cứu lấy `clientId` = tên thư mục gốc → lỡ sập lần nữa giữa lúc cứu, cứu lại vẫn ra đúng một video.
- **Không đụng clip của người khác / tab khác**: `rec-head` của tài khoản khác → để nguyên (nhật ký báo "đăng nhập lại tài khoản đó để
  cứu"); tab đang quay giữ khóa trên thư mục của nó → tab khác không cứu / dọn nhầm.

Sổ cứu là phần THÊM: ghi sổ hỏng (ổ sắp đầy) thì chỉ thôi ghi sổ, không ảnh hưởng việc quay, không báo "ổ đầy".

**Mất gì khi sập:** phần đang nằm trong bộ nhớ = tối đa một khúc 1 MiB cuối clip (≈ 8–10 giây ở cảnh thật 800 kbps [tính]; lượt thử
bằng hình nhiễu bitrate cao mất ≈ 4 giây [C]). Clip mới quay chưa đủ 1 MiB (vài giây đầu) thì chưa có gì trên ổ → không cứu được, có
dòng nhật ký nói rõ. Không hạ cỡ khúc xuống để bớt mất: 1 MiB là số đã đo ở M0 / M1.

### 24.2 K-6 — vào trang nào cũng gửi tiếp

`components/orders/videos/pack-video-queue-resume.tsx` đặt ở khung chung (`app-shell.tsx`): tài khoản ĐÃ mở tính năng Video đóng hàng,
3 giây sau khi vào BẤT KỲ trang nào thì mở lại hàng chờ (gửi tiếp clip chưa lên kho + cứu clip dở). Không vẽ gì; mã hàng chờ nạp ĐỘNG
nên không nằm trong gói mã chung; tài khoản chưa mở tính năng thì không nạp gì (thẻ trả về rỗng). ⚠️ Đây là thay đổi ở khung chung của
MỌI khách (chỉ thêm một thẻ rỗng) — nêu rõ trước khi push.

### 24.3 Cây tệp

```
frontend/src/lib/pack-video-recorder/
  clip-recovery.ts            MỚI  thuần: đọc / ghi sổ cứu, tìm chỗ bắt đầu, soát khung, kế hoạch cứu, trình đọc mảnh + hàm ghép lại
  __tests__/clip-recovery.test.ts  MỚI  14 test
  clip-store.ts               SỬA  PieceSink ghi sổ cứu; gỡ rec-head khi clip có dòng sổ; đọc / liệt kê tệp thư mục clip
  clip-store-opfs.ts          SỬA  liệt kê / xóa tệp; dọn thư mục mồ côi nay hỏi "cứu được không" bên trong khóa
  session.ts                  SỬA  rescueOrphan (cứu rồi đưa vào hàng gửi), không còn chặn hàng gửi trong lúc cứu
  clip-pipeline.ts, types.ts, config.ts  SỬA  báo từng khung cho sổ cứu; WRITE_CHUNK_BYTES về config
frontend/src/components/orders/videos/pack-video-queue-resume.tsx  MỚI
frontend/src/components/shell/app-shell.tsx                        SỬA  +2 dòng
```

### 24.4 Đã kiểm (19/11, local 3010 + backend 4010, trình duyệt của Claude, CAMERA GIẢ hình nhiễu 1280×720)

- Test thuần **52 / 52** (14 test mới); `tsc` + `eslint` sạch; `next build` qua.
- Đang quay 32 giây → trên ổ: 8 mảnh 1 MiB + 8 bản ghi sổ ≈ 2,6–2,8 KB + `rec-head` 430 byte.
- **Sập giữa clip rồi mở lại màn quay** (tải lại trang ở giây ≈ 41): 1 giây sau nhật ký "Cứu được video quay tay… (0:37…)", 4 giây sau
  "Tải lên xong"; ổ về 0 thư mục. Mở video trên danh sách: 36,7 giây, 1280×720, tua giữa / tua cuối / phát đều chạy, có ngày giờ trong hình.
- **Sập giữa clip rồi mở TRANG KHÁC** (`/settings/general`, không mở màn quay): 18 giây sau ổ 0 thư mục, sổ hàng chờ 0 dòng, video có
  trong danh sách (`QUAYTAY144850`).
- **Hai tab**: tab 1 đang quay, mở tab 2 ở trang khác → tab 2 thấy khóa của tab 1 và KHÔNG đụng thư mục đang ghi (17 tệp còn nguyên);
  bấm Dừng ở tab 1 → đúng MỘT clip 0:32, lên kho.

### 24.5 CHƯA kiểm — cần máy / thiết bị thật (em không làm được từ đây)

1. Webcam thật + tem thật trên bản có sổ cứu (đường quay chỉ thêm việc ghi sổ, chưa chạy với webcam).
2. Chrome SẬP thật / tắt máy đột ngột (lượt này giả bằng tải lại trang — về mặt tệp trên ổ là như nhau, chưa thấy tận mắt).
3. Rút mạng thật; ổ đầy thật; clip 15 phút (≈ 92 MB, cứu lại phải ghép ≈ 27.000 khung — chưa đo mất bao lâu); hàng chờ vài trăm clip.
4. Hai TÀI KHOẢN chung một máy (mã có rào, chưa chạy thật).

### 24.6 M1 còn lại gì sau lượt này

- Việc của anh: thử mục 24.5 điểm 1–3 trên prod sau khi push; trả lời K-1 (hàng chờ trên ổ có trái "bỏ lưu local" không — em vẫn cho là
  không); K-3 bật Local Uploads trong bảng điều khiển Cloudflare.
- Không thuộc M1: gộp lô phía máy chủ + `Retry-After` + cửa sổ 25 giờ = lát M2 (điều kiện mở cho khách thứ hai).

### 24.7 Commit + push 19/11/2026 (anh: "Commit và push")

Một commit: M1b + K-6 (12 tệp, chỉ mã web + tài liệu). Trước khi commit: test 52 / 52, `tsc` + `eslint` sạch, `next build` qua. Lên prod
khi mục 24.5 CHƯA kiểm — anh thử thẳng trên prod. Thẻ `PackVideoQueueResume` nằm ở khung chung của mọi khách (rỗng, không nạp gì khi
tài khoản chưa mở tính năng).

**Sau khi push:** commit `7ec8657d` (kèm `f99f1d51` tài liệu của lần trước). 14:57:24 gói mã công khai của
`app.hubsell.vn/orders/videos/record` đã chứa chuỗi của bản mới (`rec-head`, tệp `/_next/static/chunks/35ew8ip3u0mja.js`) — soi tệp
tĩnh, không đăng nhập. CHƯA nhìn màn hình trên prod, chưa xem Render. Máy chủ local đã dừng.

### 24.8 Anh hỏi về ổ đĩa đầy (19/11 chiều) — ANH CHỐT: KHÔNG làm thêm gì

Anh hỏi "ổ đĩa đầy thì khách phải tự dọn dẹp à?" rồi "cần phải biết khách hàng vào đâu để xóa bộ nhớ đệm này". Em trả lời [đọc mã + thử
19/11]: chỉ video CHƯA tải lên mới nằm trên máy khách; tải lên xong là tệp tự xóa, rác còn sót tự dọn lần mở sau; video đã tải lên chỉ
nằm trên R2. Chỗ xóa tay trong Chrome: biểu tượng bên trái thanh địa chỉ → Cài đặt trang web → Xóa dữ liệu (xóa cả phiên đăng nhập và
cài đặt camera; em chưa mở Chrome soi lại từng chữ).

Em đề xuất thêm dòng "Đang giữ trên máy này: N video chờ gửi · X MB" + nút "Gửi lại" / "Xóa khỏi máy" (= câu K-7).
**Anh 19/11: "Vậy được rồi. Không cần."** → ⛔ KHÔNG làm dòng dung lượng / nút xóa video chờ gửi; đừng đề xuất lại trừ khi có khách kẹt
thật. Đề xuất "ổ đầy mà mạng thông thì vẫn cho quay (giữ trong bộ nhớ), chỉ khóa khi vừa đầy ổ vừa mất mạng" anh CHƯA trả lời — để
nguyên mã hiện tại (khóa mở clip mới khi một lần ghi thật hỏng).

**Dừng ở đây 19/11 chiều (anh: "Làm tới đây thôi tối làm tiếp").** Prod = `7ec8657d`. Việc chờ: anh thử 4 ca thật trên prod (rút mạng
10 phút, tắt hẳn Chrome giữa clip, clip 15 phút, một buổi đóng hàng vài chục đơn) + thử camera cận cảnh với webcam thật và tem giấy.
