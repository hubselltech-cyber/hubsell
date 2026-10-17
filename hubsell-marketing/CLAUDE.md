# hubsell-marketing — luật làm việc cho Claude

Thư mục này là nơi làm **marketing** của Hubsell, tách khỏi mã (backend/, frontend/, hubsell-mobile/,
hubsell-landing/). Không sửa mã ứng dụng từ đây; việc cần đổi sản phẩm thì ghi đề xuất, làm ở phiên khác.

## Trước mọi việc
1. Đọc `.agents/product-marketing.md` — bối cảnh sản phẩm, khách, giọng, các quyết định đã chốt (mục Learnings).
2. Định vị gốc: `../docs/marketing/DINH-VI-LAI-HUBSELL-QUANG-CAO.md` (anh Trung chốt 15/10/2026). Không đề xuất
   lại điều đã chốt ngược trong đó.
3. Skill marketing ở `.claude/skills/` (bộ coreyhaines31/marketingskills, MIT). Skill viết cho SaaS Mỹ:
   khi áp vào Hubsell phải đổi kênh theo thị trường Việt (Facebook group, Zalo, TikTok, YouTube, kho app của
   sàn, người dạy bán hàng) thay vì mặc định LinkedIn, cold email, Product Hunt.

## Luật nội dung
- Viết tiếng Việt có dấu, giọng trong `.agents/product-marketing.md`.
- **Không bịa số, lời khách, chứng thực.** Số phải có nguồn (SQL trong `so-lieu/`, Vercel analytics, sàn);
  chưa có thì ghi `[CHƯA CÓ SỐ]`. Ngưỡng/mục tiêu tự chọn phải ghi rõ "tự chọn".
- Không hứa điều sàn chưa cho làm (xem bảng khả năng từng sàn trong tài liệu định vị, mục 4).
- Không dùng chữ "Đối tác chính thức".

## Đặt tệp
| Thứ | Đặt ở |
|---|---|
| Bối cảnh sản phẩm (skill đọc) | `.agents/product-marketing.md` — sửa thì tăng version + dòng Changelog |
| SQL lấy số, kết quả số | `so-lieu/` (SQL chỉ đọc; kết quả lưu `so-lieu/KET-QUA-<YYYY-MM-DD>.md`) |
| Chiến lược, kế hoạch | `chien-luoc/` — skill `marketing-plan` mặc định ghi vào `~/marketing-plans/`, ở repo này ghi vào `chien-luoc/` |
| Bài đăng, kịch bản, nội dung theo kênh | `kenh/<tên-kênh>/` (vd `kenh/facebook/`, `kenh/tiktok/`) |
| Phỏng vấn khách, lời khách nguyên văn | `khach-hang/` (không ghi SĐT, email) |

Tư liệu cũ (định vị, quy trình video, bài Facebook đầu) vẫn ở `../docs/marketing/` — chưa chuyển.

## Hành động cần anh duyệt
Đăng bài, gửi thư cho khách, chi tiền quảng cáo, sửa landing/app đang chạy: soạn sẵn, anh duyệt mới làm.
SQL chạy trên prod: chỉ SELECT, soạn sẵn cho anh dán vào Supabase.
