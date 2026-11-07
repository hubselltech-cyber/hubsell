# HQ — Cộng tác viên đặc biệt (mức hoa hồng riêng + thời hạn)

> 07/11/2026. Anh Trung hỏi "có phương án nào trên trang HQ để anh tạo tài khoản cộng tác viên và setup % hoa hồng và thời hạn cho họ không", rồi chốt: **"Thực ra đây đã được coi là cộng tác viên rồi, mình chỉ thêm tab cho cộng tác viên đặc biệt để nâng hoặc hạ mức hoa hồng và thời gian thôi. Sau mình còn trả họ tiền cho dễ."**

## 1. Luật

- **Mọi tài khoản Hubsell vốn đã là cộng tác viên**: có mã `HUBSELL<số>`, link `hubsell.tech/register?ref=`, nhận **10% vĩnh viễn** trên mọi lượt thanh toán của người mình giới thiệu, tiền vào Ví Hubsell, rút ≥100.000₫ do HQ duyệt tay (tab Kế toán → Ví & lệnh rút). Phần này **không đổi**.
- **Cộng tác viên đặc biệt** = một tài khoản đã đăng ký được HQ đặt **mức % riêng** (0–100, làm tròn 2 chữ số) trong **một khoảng thời gian** `[startsAt, endsAt)`; `endsAt` null = không thời hạn.
- % được đọc **tại thời điểm khách thanh toán**: còn trong khoảng → % riêng (kể cả khi HQ hạ dưới 10%); chưa tới ngày / đã hết hạn / không có dòng / đã gỡ → 10%.
- **Hoa hồng đã cộng vào ví không tính lại** khi đổi % hay gỡ (sổ cái ví append-only). Bút toán ghi rõ % đã áp: "Hoa hồng 20% từ thanh toán …".
- Không tạo tài khoản từ HQ (mật khẩu phải do họ tự đặt); CTV đăng ký như khách thường rồi HQ chọn.

## 2. Mã

| Lớp | Chỗ |
|---|---|
| DB | bảng `referral_partners` (1-1 `User.userId` unique, `commissionPercent Decimal(5,2)`, `startsAt`, `endsAt?`, `note?`, `createdById/updatedById`) — migration `20261107150000_referral_partners`, RLS bật |
| Service | `backend/src/services/referral-wallet.ts`: `DEFAULT_COMMISSION_PERCENT = 10`, `isPartnerRateActive()`, `resolveCommissionPercent()` (hàm thuần), `getPartnerRate()`; `creditReferralCommission()` dùng % hiệu lực của **người giới thiệu** |
| API HQ (lá `hq.marketing`) | `GET /api/admin/marketing/partners` (danh sách + số liệu), `GET …/partners/search?q=` (chủ shop đã đăng ký: email/tên/username/mã, ≤8), `PUT …/partners/:userId` (upsert, validate % và ngày), `DELETE …/partners/:userId` — mỗi lần lưu/gỡ ghi `PlatformAuditLog` action `referral-partner.create/update/delete` kèm before/after |
| API khách | `GET /api/referral/summary` trả thêm `commissionPercent`, `defaultCommissionPercent`, `partnerRate {percent, endsAt} \| null` |
| FE HQ | `/admin/marketing` chuyển sang `PageHeaderBand + PageTabs`: tab **Tổng quan** (cũ) + tab **Cộng tác viên đặc biệt** (`components/admin/referral-partners-tab.tsx`: bảng 7 cột, hộp thoại thêm/sửa có ô tìm tài khoản, %, ngày bắt đầu, hết hạn hoặc công tắc "Không thời hạn", ghi chú, dòng ví dụ 1.000.000₫ → nhận bao nhiêu; hộp xác nhận gỡ) |
| FE khách | `/affiliate` hiện đúng % hiệu lực thay vì "10%" ghi cứng; CTV đặc biệt thấy "hoa hồng 20% đến dd/mm/yyyy · Mức riêng dành cho bạn (mặc định 10%)" |
| Test | `services/__tests__/referral-partner-rate.test.ts` 8 ca thuần (mặc định, trong khoảng, hạ dưới 10%, chưa tới ngày, mốc nửa mở, không hạn, % hỏng, làm tròn tiền) |

## 3. Đã kiểm local 07/11

- Thêm CTV `ctv-demo` 20% (07/11/2026 → 07/11/2027) qua giao diện; gọi `creditReferralCommission` cho khách được giới thiệu trả 1.000.000₫ → bút toán **200.000₫**, ghi chú "Hoa hồng 20% …", số dư ví 200.000₫, bảng HQ hiện đúng.
- Đặt tạm 15% cho tài khoản admin local → trang Affiliate hiện "hoa hồng 15% đến 31/3/2027", bước 3 "nhận ngay 15%"; đã gỡ dòng tạm.
- Bảng đo JS: 1440 vừa, 1280 vừa khít sau khi bỏ cột Mã (gộp vào dòng email), gộp Số dư ví vào ô Hoa hồng tích lũy, ô đệm ngang 12px. Soi sáng + tối.
- tsc BE + FE sạch, eslint sạch. DB dev áp bảng bằng `prisma db execute` + `migrate resolve` (migrate deploy kẹt migration cũ 20260830 như mọi khi).

## 4. Chưa làm / để sau

- **Khấu trừ thuế TNCN 10% khi duyệt rút ≥2.000.000₫/lần** cho cá nhân: màn duyệt lệnh rút chưa có cột thuế. Nên làm trước khi CTV lớn rút thật.
- Chưa có thư báo cho CTV khi HQ đặt / sắp hết hạn mức riêng.
- Lịch sử đổi % chỉ xem được ở Nhật ký thao tác (chủ nền tảng), chưa hiện trong tab.
