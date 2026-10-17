# hubsell-marketing

Nơi làm marketing của Hubsell — tách riêng như `hubsell-landing/`, `hubsell-mobile/`, không lẫn vào mã
backend/frontend. Luật cho Claude: [CLAUDE.md](CLAUDE.md).

```
hubsell-marketing/
├── CLAUDE.md                 # Luật làm việc + đặt tệp
├── .agents/
│   └── product-marketing.md  # Bối cảnh sản phẩm — mọi skill đọc trước
├── .claude/skills/           # 50 skill marketing (coreyhaines31/marketingskills, MIT, bản 15/10/2026,
│                             #   đã bỏ thư mục evals; chỉ tệp chữ, không script)
├── so-lieu/                  # SQL chỉ đọc lấy số thật + kết quả
├── chien-luoc/               # Chẩn đoán, kế hoạch marketing
├── kenh/                     # Nội dung theo kênh (tạo khi bắt đầu kênh)
└── khach-hang/               # Phỏng vấn, lời khách nguyên văn (tạo khi có)
```

## Dùng thế nào
Mở phiên Claude Code ngay trong thư mục này (hoặc làm việc với tệp trong đây) để skill tự nạp. Skill hay dùng:

| Muốn | Gọi |
|---|---|
| Cập nhật bối cảnh sản phẩm | `/product-marketing` |
| Kế hoạch 90 ngày + 12 tháng | `/marketing-plan hubsell` |
| Hội đồng chuyên gia phản biện | `/marketing-council` |
| Phỏng vấn / tổng hợp lời khách | `/customer-research` |
| Ý tưởng kênh | `/marketing-ideas` |
| Công cụ miễn phí kéo khách | `/free-tools` |
| Chương trình giới thiệu / đối tác | `/referrals`, `/co-marketing` |
| Bài mạng xã hội, kịch bản video | `/social`, `/video`, `/ad-creative` |
| Kho ứng dụng | `/aso` |
| Giảm khách bỏ | `/churn-prevention`, `/onboarding` |

## Cập nhật bộ skill
Tải lại repo về thư mục tạm, đọc thay đổi (VERSIONS.md), chép đè `skills/` vào `.claude/skills/`, bỏ `evals/`.
Nguồn: https://github.com/coreyhaines31/marketingskills
