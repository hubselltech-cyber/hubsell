# Giá Enterprise theo đơn — 65đ/đơn có hợp lý không? (22/10/2026)

> Anh Trung hỏi 22/10/2026: "anh đang định để gói Enterprise là 65đ 1 đơn thì có hợp lý không? mình có lãi
> không? so với đối thủ thì sao?" — kèm quyết định **chỉ công bố 65đ/đơn, khách vẫn phải liên hệ để Hubsell
> tạo gói**. Tệp này là căn cứ số; thang gói tự mua xem memory `hubsell-goi-thue-bao`, khảo sát đối thủ gốc
> (19/09) xem memory `hubsell-khao-sat-gia-tren-10k-don`.

## 1. Kết luận ngắn

- **Có lãi.** Ở 65đ/đơn, phần chi phí biến đổi theo đơn (hạ tầng + hoa hồng giới thiệu + hỗ trợ riêng) nằm
  trong khoảng **24–60đ/đơn** tùy quy mô → lãi gộp **5–44đ/đơn** (8–60 %). Mỏng nhất ở khách 20–30k đơn mà
  đòi hỗ trợ nhiều; khỏe từ 50k đơn trở lên.
- **So với đối thủ:** 65đ **ngang/nhỉnh** nhóm đa sàn trực tiếp ở vùng 20–30k đơn (BigSeller 60–70đ, Ginee
  56–58đ), nhưng **đắt gấp 1,5–2,2 lần từ 50k đơn** (Ginee 42đ, BigSeller 29–53đ) và gấp 3–6 lần nhóm POS
  giá phẳng (Sapo). Vì Enterprise bán bằng tư vấn, 65đ nên là **giá niêm yết cho vùng 20–50k**; deal lớn
  hơn thương lượng xuống theo giá sàn HQ đã có (60 → 45đ từ 50k → 33đ từ 100k đơn).
- **Nhất quán nội bộ:** 65đ > Scale 60đ/đơn (kỳ tháng) nên không có bậc tự mua nào rẻ hơn Enterprise ở cùng
  quy mô — khách không bị "mua Scale ×2 cho rẻ". Lưu ý khách Scale **kỳ năm** đang trả 50đ/đơn, lên
  Enterprise 65đ là tăng 30 % — khi chốt deal nên giữ nhịp chiết khấu kỳ dài (12 tháng tính 10 tháng).

## 2. Lãi/lỗ trên mỗi đơn

Doanh thu ở 65đ/đơn: 30k đơn → 1,95 tr/tháng · 50k → 3,25 tr · 100k → 6,5 tr.

| Khoản (đ/đơn) | Căn cứ | Mức |
|---|---|---|
| Hạ tầng chung | `config/capacity-plan.ts` + số prod 22/10 (39 USD/tháng, ~3.019 đơn/ngày ≈ 90k đơn/tháng, tỷ giá ~26.000) | hiện **≈ 11đ**; M3 (300k đơn/tháng, 134 USD) ≈ 12đ; M4 (900k, 903 USD) ≈ 26đ (≈ 21đ nếu Supabase Pro + compute lớn thay Team); M5 (3 tr, 1.303 USD) ≈ 11đ |
| Hoa hồng giới thiệu 10 % vĩnh viễn | chương trình Referral | **6,5đ** (chỉ khi có người giới thiệu) |
| Hỗ trợ triển khai riêng | ước 2–4 giờ/tháng/khách × ~200k/giờ = 0,4–0,8 tr/tháng (số ước của em, chưa đo) | 30k đơn: 13–27đ · 50k: 8–16đ · 100k: 4–8đ |
| AI trợ lý hỏi đáp | chưa đo — gate riêng theo gói | — |
| Thuế | dịch vụ phần mềm không chịu GTGT (TT 219/2013); TNDN tính trên lãi | — |

Lãi gộp/đơn = 65 − (11…26) − 6,5 − (4…27) ≈ **5 → 44đ**.
- Xấu nhất: 30k đơn, hệ ở M4, có giới thiệu, hỗ trợ 27đ → ≈ 5đ/đơn (~8 %).
- Điển hình: 50k đơn, hệ ở M3, có giới thiệu → 65 − 12 − 6,5 − 12 ≈ 34đ/đơn (~53 %).
- Dung lượng DB: ~3–5 KB/đơn kể cả dòng hàng → 100k đơn ≈ 0,5 GB/tháng, Supabase Pro tính thêm
  0,125 USD/GB ≈ 0,03đ/đơn — không đáng kể.

## 3. So với đối thủ (đ/đơn khi dùng kịch trần, quy đổi về tháng)

| Quy mô đơn/tháng | BigSeller | Ginee (trả năm) | Sapo (POS bán kèm) | **Hubsell 65đ** |
|---|---|---|---|---|
| 20.000 | ≈ 70 (Basic 700k/10k + gói thêm) | ≈ 58 (1,155 tr) | ≈ 22 (Omni 449k) | 65 |
| 30.000 | ≈ 60 (Pro 1,79 tr — trả nửa năm 10,74 tr) | ≈ 56 (1,67 tr) | ≈ 15 (Advanced 600k/40k) | 65 |
| 50.000 | ≈ 53 (phải mua Business 90k: 31,56 tr/năm) | ≈ 42 (2,08 tr) | ≈ 20 (Growth 999k, không giới hạn đơn) | 65 |
| 90–100.000 | ≈ 29 (Business) | ≈ 33 (ước) | ≈ 10 | 65 |
| 300.000 | ≈ 22 (Business Plus 79,2 tr/năm) | — | — | 65 |

Nguồn: BigSeller/Ginee theo khảo sát 19/09/2026 (bài blog BigSeller 2026 đọc hôm nay chỉ xác nhận hạn mức
Free 1.500 / Basic 10k / Pro 30k / Business 90k / Business Plus 300k, giá nằm trong ảnh); **Sapo đọc lại
hôm nay 22/10** trên sapo.vn/bang-gia: Start Up 170k/10k đơn · Pro 249k/10k · Omni 449k/20k · Advanced
600k/40k · **Growth 999k không giới hạn đơn** (trước ghi 40k) · Enterprise liên hệ; phí khởi tạo 1–3 tr;
trang không ghi kỳ tối thiểu (khuyến mãi nói "ký 2 năm"). Điểm bán của Hubsell so nhóm này: **trả theo
tháng, không cam kết năm, không phí khởi tạo** — tiền phải trả một lần để bắt đầu của đối thủ là 5–31 tr.

## 4. Quyết định anh Trung 22/10 + cách cấu hình

- **Công bố 65đ/đơn**, khách **vẫn phải đăng ký tư vấn** → HQ tạo gói riêng (trần + giá theo thỏa thuận,
  gói ngừng bán cho từng deal) rồi Ghi nhận thanh toán số thỏa thuận — luồng chốt deal 22/08 không đổi.
- Giá là DATA: cột mới `service_plans.pricePerOrder` (migration `20261022120000`), ô **"Giá công bố ₫/đơn
  (gói bán bằng tư vấn)"** trong hộp Sửa gói ở HQ `/admin/plans`; thẻ gói HQ hiện "Công bố 65đ/đơn · bán
  bằng tư vấn" (vàng nếu dưới giá sàn). `/api/subscription/me` trả `enterprisePlan.pricePerOrder` →
  `/settings/plan` hiện "65 ₫ / đơn hàng" + nút Đăng ký tư vấn; null = "Liên hệ".
- Landing `pricing.tsx` in tĩnh `perOrder: 65` (đổi ở HQ thì sửa tay như các giá khác).
- **Sau deploy:** vào HQ prod → Sửa Enterprise → điền 65 (DB prod chưa có số; trước đó app hiện "Liên hệ").

## 5. Việc còn treo

- Giá sàn HQ cho deal trên 50k/100k đơn (45/33đ) chỉ cảnh báo, chưa ràng buộc — giữ.
- Chưa đo chi phí AI trợ lý/đơn và giờ hỗ trợ thật cho khách lớn → khi có deal Enterprise đầu tiên, ghi
  số giờ hỗ trợ tháng đầu để thay số ước ở mục 2.
