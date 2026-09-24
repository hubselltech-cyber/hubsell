# Mã hóa bí mật trong cơ sở dữ liệu — thiết kế & sổ tay vận hành

> Làm 19/09/2026. Code: `backend/src/lib/secret-box.ts` (lõi) +
> `backend/src/integrations/invoice/config-secrets.ts` (nối vào 2 bảng hóa đơn).
> Test: `backend/src/integrations/__tests__/secret-box.test.ts`.

## 1. Vì sao phải làm

Hubsell giữ **mật khẩu meInvoice của khách** để đăng nhập MISA thay họ. meInvoice ký
hóa đơn bằng HSM phía MISA, nên ai cầm được bộ {MST + tài khoản + mật khẩu} là phát
hành được hóa đơn có chữ ký số hợp lệ dưới tên khách — đã gửi Cơ quan Thuế thì không
xóa được. Mật khẩu này không băm một chiều được (ta phải dùng lại nguyên văn), nên chỉ
còn cách **mã hóa hai chiều với khóa nằm ngoài cơ sở dữ liệu**.

## 2. Bảo vệ được gì — và KHÔNG bảo vệ được gì

| Tình huống | Kết quả |
|---|---|
| Lộ bản sao lưu Supabase, lộ `DATABASE_URL`, lỗi truy vấn kéo được bảng | ✅ Kẻ lấy được chỉ thấy bản mã |
| Người có quyền vào Supabase (kể cả cộng tác viên sau này) mở bảng ra xem | ✅ Không đọc được mật khẩu |
| Kẻ ghi được vào DB chép bản mã của shop A sang hàng của shop mình | ✅ Không giải mã được (bản mã gắn với chủ shop + tên cột) |
| Kẻ sửa bản mã trong DB | ✅ Giải mã báo lỗi, không bao giờ trả rác |
| Kẻ chiếm được máy chủ Render (có cả khóa lẫn DB) | ❌ KHÔNG chặn được — lớp này là việc của 2FA Render / GitHub, vá lỗ hổng, quyền truy cập |
| Lộ mật khẩu trên đường truyền, trong log | Không liên quan — đã có HTTPS; code không log bí mật, API chỉ trả dạng che |

## 3. Thiết kế

- **AES-256-GCM** (mã hóa có xác thực), IV 96 bit **ngẫu nhiên mỗi lần**, thẻ xác thực
  128 bit, thư viện `node:crypto` có sẵn.
- **AAD = ngữ cảnh ô dữ liệu**: `InvoiceConfig:<ownerId>:<tên cột>` /
  `PlatformInvoiceConfig:<tên cột>` → chống chép bản mã sang hàng/cột/bảng khác.
- **Định dạng lưu**: `enc:v1:<mã khóa>:<iv>:<tag>:<bản mã>` (base64url). Có mã khóa để
  **xoay khóa** không gãy dữ liệu cũ.
- **Cột được mã hóa** — `InvoiceConfig`: `secretKey`, `apiKey`, `meinvoicePassword`,
  `esignSecretKey`, `esignPassword`, `posSecretKey`; `PlatformInvoiceConfig` (hóa đơn
  của chính Hubsell): `meinvoicePassword`, `esignSecretKey`, `esignPassword`.
- **Quy ước code duy nhất**: đọc để DÙNG bí mật → `decryptInvoiceConfig` /
  `hqStandardConfig`; GHI → `encryptInvoiceSecret` / `encryptPlatformInvoiceSecret`.
  Thêm cột bí mật mới = thêm vào mảng `*_SECRET_FIELDS`.
- **Khi lưu cấu hình không bao giờ giải mã**: khách để trống ô mật khẩu → giữ nguyên
  văn bản mã đang có (đã kiểm: không đổi một byte).
- **Trang cấu hình luôn mở được**: ô không giải mã được coi như "chưa đặt" + dòng đỏ
  "nhập lại mật khẩu" — đó là lối thoát duy nhất của khách khi khóa gặp sự cố.
- **Luồng phát hành** gặp bí mật không đọc được → lỗi tầm TÀI KHOẢN
  (`HUBSELL_SECRET_UNREADABLE`) → tự động phát hành **ngắt mạch**, không gọi MISA, không
  ghi sổ rác.
- **Che trên giao diện**: mật khẩu hiển thị `••••••••` cố định (trước 19/09 lộ 4 ký tự
  cuối — với mật khẩu người tự đặt đó là gợi ý đoán mạnh); khóa API vẫn hiện 4 ký tự cuối.
- **Chuyển đổi dữ liệu cũ tự động lúc khởi động** (`backfillInvoiceSecrets`): mã hóa ô
  còn chữ thường + mã hóa lại ô dùng khóa cũ. Mã hóa xong **giải mã thử khớp nguyên văn
  mới ghi**; ghi có điều kiện theo giá trị cũ (chạy song song/lặp lại vô hại); ô lỗi thì
  giữ nguyên, không ghi đè. Log chỉ in số đếm.

## 4. BẬT TRÊN PRODUCTION — làm đúng thứ tự

Code đã lên production nhưng **chưa có khóa thì chưa mã hóa** (chạy y như trước + một
dòng cảnh báo `[SecretBox] ⚠️ CHƯA BẬT` trong log Render). Để bật:

1. **Tạo khóa trên máy anh** (không dán khóa vào chat, email, Zalo):
   ```bash
   node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"
   ```
2. **CẤT KHÓA DỰ PHÒNG TRƯỚC** — dán cả chuỗi `k1:...` vào trình quản lý mật khẩu (hoặc
   in ra giấy cất két). Làm bước này TRƯỚC bước 3. Mất khóa = toàn bộ khách phải nhập
   lại mật khẩu meInvoice, và tự động phát hành của mọi shop ngừng cho tới lúc đó.
3. Render → service backend → **Environment** → thêm `SECRET_ENC_KEYS` = chuỗi vừa tạo →
   Save (Render tự deploy lại). Nếu sau này tách web / worker thành 2 service thì **cả
   hai phải cùng khóa**.
4. Mở log Render, phải thấy 2 dòng:
   - `[SecretBox] BẬT — khóa đang dùng "k1", tổng 1 khóa giải mã được.`
   - `[SecretBox] Chuyển đổi bí mật NCC hóa đơn: quét N ô, mã hóa N, lỗi 0`
5. Kiểm: vào Kết nối & Xuất hóa đơn → Cấu hình kết nối → bấm **Test** kết nối
   meInvoice → phải OK. (Tùy chọn: mở bảng `InvoiceConfig` trên Supabase, cột
   `meinvoicePassword` phải bắt đầu bằng `enc:v1:k1:`.)
6. Ổn định vài ngày → thêm env `SECRET_ENC_REQUIRED=1`: từ đó thiếu khóa là máy chủ từ
   chối khởi động thay vì lặng lẽ ghi chữ thường. ✅ **ĐÃ BẬT production 24/09/2026 11:11**
   (5 ngày sau khi đặt khóa; log deploy xác nhận `[SecretBox] BẬT — khóa đang dùng "k1"`).

Khóa sai định dạng (không đủ 32 byte, thiếu `mã:`) → bản deploy mới **không lên**,
Render giữ bản đang chạy; đọc log sẽ thấy `BAD_KEY_CONFIG`.

## 5. Xoay khóa (khi nghi lộ khóa, hoặc định kỳ)

1. Tạo khóa mới với **mã mới** (`k2:...`), cất dự phòng.
2. Đặt `SECRET_ENC_KEYS` = `k2:<mới>,k1:<cũ>` (khóa MỚI đứng đầu) → deploy.
3. Log phải báo `mã hóa N, lỗi 0` — mọi ô đã chuyển sang `k2`.
4. Chỉ khi đó mới gỡ `k1` khỏi env. Gỡ sớm → các ô còn `k1` báo `KEY_MISSING`.

Nếu nghi **lộ cả DB lẫn khóa**: xoay khóa không đủ — phải báo khách đổi mật khẩu meInvoice.

## 6. Sự cố & cách xử lý

| Dấu hiệu | Nguyên nhân | Xử lý |
|---|---|---|
| Khách thấy dòng đỏ "Hubsell không đọc được mật khẩu đã lưu" | Khóa trên Render bị đổi/xóa, hoặc bản mã bị sửa | Khôi phục đúng `SECRET_ENC_KEYS` từ bản dự phòng → tự hết. Không còn khóa → khách nhập lại mật khẩu rồi Lưu |
| Tự động phát hành tạm ngừng với lý do "không đọc được mật khẩu…" | Như trên | Như trên, rồi khách bấm **Chạy lại** |
| Log `Chuyển đổi … lỗi N` với N > 0 | Có ô mã hóa bằng khóa không còn trong env | Thêm lại khóa cũ vào cuối `SECRET_ENC_KEYS` |
| Deploy không lên, log `BAD_KEY_CONFIG` / `KEY_REQUIRED` | Khóa sai định dạng / thiếu khóa khi đã bật REQUIRED | Sửa env |

## 7. Đã kiểm chứng (19/09/2026)

- 18 test theo góc nhìn kẻ tấn công + sự cố vận hành (sửa bản mã, chép bản mã sang shop
  khác / cột khác / bảng khác, mất khóa, xoay khóa, khóa sai định dạng, thông báo lỗi
  không lộ bí mật).
- Diễn tập trên DB local với dữ liệu thật: 3 bí mật chữ thường → 3 bản mã; chạy lặp
  không đổi gì; giải mã ra đúng nguyên văn (so dấu vân tay sha256); xoay khóa `k1 → k2`
  chuyển đủ 3 ô.
- Gọi **MISA sandbox thật** qua đúng đường đi của sản phẩm (DB bản mã → giải mã → đăng
  nhập → tra trạng thái hóa đơn): OK trước và sau xoay khóa.
- Tầng API: GET không lộ bản mã lẫn mật khẩu; PUT để trống mật khẩu → bản mã giữ nguyên
  từng byte; PUT mật khẩu mới → bản mã mới; nút Test kết nối đăng nhập MISA OK.

## 8. Chưa làm (có chủ đích)

- **Token các sàn** (Shopee / Lazada / TikTok) vẫn lưu chữ thường. Rủi ro thấp hơn
  (token tự hết hạn, thu hồi được, không ký được chứng từ pháp lý) và đụng nhiều worker
  nóng hơn → làm đợt riêng, dùng lại chính `lib/secret-box.ts`.
- Quản lý khóa bằng dịch vụ chuyên dụng (KMS): chưa cần ở quy mô này; định dạng có mã
  khóa nên chuyển sau không phải mã hóa lại kiểu khác.
