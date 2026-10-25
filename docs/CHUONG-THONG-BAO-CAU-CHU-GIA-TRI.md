# Chuông thông báo — câu chữ phải cho thấy GIÁ TRỊ (25/10/2026)

> Anh Trung 25/10/2026: Hubsell được đánh giá cao nhưng tự động hóa làm khách "không có việc gì để vào".
> Báo cáo tuần qua email để sau. Việc trước mắt: **chuông trên web + mobile phải chất lượng hơn** —
> "đã loại một video" thì phải nói Trợ lý đã loại, đã ngăn mất bao nhiêu tiền.
> Chữ chuông do backend sinh (`notify()`), web và app chỉ hiển thị → sửa một chỗ, hai đầu đổi theo.

## 1. Công thức một câu chuông

```
[Ai] đã [làm gì] — [chặn / giữ / phát hiện được gì, bằng SỐ THẬT] — [anh cần làm gì | không cần làm gì]
```

- **Chủ ngữ là Trợ lý / Hubsell**, động từ hoàn thành ("đã loại", "đã nhận", "đã tự xuất", "phát hiện", "đối soát"). Sự kiện sàn ("Shopee báo hoàn") chỉ là bối cảnh, không phải tiêu đề.
- **Số tiền thật, không ước đoán**: chi cửa sổ của đúng nhóm video bị loại, tổng phí ship bị trừ thêm, tiền đang treo… Không bịa "tiết kiệm được X" khi không đo được (xem mục 4).
- **Kết bằng việc của chủ shop**: "chờ bạn chuẩn bị hàng", "gọi khách để cứu đơn", hoặc **"Không cần làm gì"** — câu này quan trọng nhất với khách bận: nó nói máy đã lo xong.
- **Tiêu đề ≤ 70 ký tự** (`push.ts` `TITLE_MAX`) vì tin đẩy cắt ở đó; tên chiến dịch / tên gian xuống thân tin. Tiền trong tiêu đề dùng dạng gọn `vndCompact` ("1,2 tr"), thân tin dùng `vndText` ("1.240.000₫").
- Thân tin ≤ 180 ký tự phần đầu phải đủ nghĩa (`BODY_MAX`).

## 2. Bảng trước → sau (đã sửa, commit cùng ngày)

| Chuông (`type`) | Trước | Sau | Tệp |
|---|---|---|---|
| TikTok Ads — Trợ lý đã loại (`tiktok-ads-auto`) | `{chiến dịch}: Trợ lý đã loại 3 video` | `Trợ lý đã loại 3 video — chặn 1,2 tr/7 ngày đang chảy mà chỉ ra 1 đơn` · thân: tên chiến dịch + tóm tắt + *Không cần làm gì thêm — … bấm Khôi phục* | `tiktok-ads/auto-rules.ts` `excludedNotice`, dùng ở `auto-run.ts` |
| Diễn tập sẽ loại | `Diễn tập {chiến dịch}: sẽ loại 3 video` | `Diễn tập: Trợ lý sẽ loại 3 video đang đốt 1,2 tr/7 ngày (thêm 1 so với lượt trước)` · thân: *Chưa gọi TikTok. Bật chế độ thật thì từ lượt mai Trợ lý tự chặn khoản này.* | `plannedNotice` |
| Không loại video nào | `{chiến dịch}: Trợ lý hôm nay không loại video nào` | `Trợ lý đã rà 42 video "{chiến dịch}": chưa video nào tới mức loại` · *Không cần làm gì — mai Trợ lý chấm lại.* | `nothingNotice` |
| Bỏ lượt vì số liệu hỏng | `{chiến dịch}: Trợ lý bỏ lượt chấm hôm nay` | `Trợ lý tạm không loại video hôm nay — số liệu TikTok chưa đủ tin` · *Thà chờ một ngày còn hơn loại nhầm video đang ra đơn.* | `skippedNotice` |
| TikTok từ chối lệnh | `{chiến dịch}: TikTok từ chối lệnh loại 3 video` | `TikTok từ chối lệnh loại 3 video — 1,2 tr/7 ngày vẫn đang chảy` · *Trợ lý sẽ thử lại ở lượt chấm mai; cần gấp thì loại tay…* | `refusedNotice` |
| Shopee/Lazada — Trợ lý tạm dừng (`ops-alert:ads-auto-paused`) | `Trợ lý đã tạm dừng chiến dịch "X" — gian "Y"` | `Trợ lý đã tạm dừng chiến dịch "X" đang lỗ — gian "Y"` · thân thêm *Tiền quảng cáo của chiến dịch này ngừng chảy từ lúc đó.* | `services/ops-alerts.ts` |
| Trợ lý bật lại (`ads-auto-resumed`) | `… — ROAS đã đạt — gian "Y"` | `Trợ lý đã bật lại chiến dịch "X" khi ROAS vượt hòa vốn — gian "Y"` · *Không cần làm gì — Trợ lý tiếp tục canh, lỗ lại là dừng lại.* | `ops-alerts.ts` |
| Tổng kết ads 20h (`ads-daily-summary`) | `🤖 Trợ lý quảng cáo hôm nay: dừng 1, bật lại 1` | `🤖 Trợ lý quảng cáo hôm nay đã dừng 1 chiến dịch lỗ, bật lại 1 khi ROAS đạt` | `shopee/ads-scorecard.ts` `formatDailyDigest` |
| Đơn mới gom đợt (`order_new`) | `Có 3 đơn hàng mới cần xử lý` | `Hubsell đã nhận 3 đơn mới · 1,2 tr — chờ bạn chuẩn bị hàng` (đợt cộng dồn: `Thêm 2 đơn mới · 1 tr — …`) | `services/new-order-notify.ts` `titleOf(count, amount)` |
| Giao không thành công Shopee (`delivery-fail`) | `Đơn X giao 2 lần không thành công` | đã tự nhắn: `Hubsell đã nhắn khách đơn X sau 2 lần giao hụt — nên gọi thêm`; chưa nhắn: `Đơn X giao 2 lần không thành công — gọi khách để cứu đơn` · thân nêu *mất phí ship 2 chiều* | `shopee/delivery-fail.ts` |
| Giao không thành công TikTok / Lazada | `Đơn X giao 2 lần không thành công` / `Đơn X bị Lazada báo giao không thành công` | `… — gọi khách để cứu đơn` (TikTok chưa có nhắn tự động, `chatStatus` chỉ NONE/SKIPPED) | `tiktok/delivery-fail.ts`, `lazada/delivery-fail.ts` |
| Hoàn hàng 3 sàn (`return`) | `Shopee báo hoàn đơn X` | `Đơn X đang hoàn về — Hubsell đã chuyển sang Chờ nhận hàng hoàn` · thân: *Đơn này đã được tách khỏi doanh thu cho tới khi nhận lại hàng; kho chỉ cần quét mã…* | `*/returns-sync.ts` |
| Hết hàng (`ops-alert:stockout`) | `SKU X đang cháy hàng trên gian "Y"` | `X hết hàng nhưng khách vẫn đang mua — đang mất đơn trên gian "Y"` · thân: *Chỉ cần nhập kho — Hubsell tự đẩy tồn lên sàn mở bán lại.* | `ops-alerts.ts` |
| Đơn lỗ (`loss-orders`) | `5 đơn giao gần đây bị LỖ — tổng 1.200.000₫` | `Hubsell soi sao kê: 5 đơn giao gần đây bị LỖ — tổng …` | `ops-alerts.ts` |
| Phí ship trừ thêm (`shipping-fee-diff`) | `3 đơn bị sàn trừ THÊM phí ship — tổng … chờ khiếu nại` | `Hubsell phát hiện 3 đơn bị sàn trừ THÊM phí ship — … có thể đòi lại` | `ops-alerts.ts` |
| Sàn trả thiếu / chưa trả (`fee-audit-*`) | `N đơn nghi sàn trả thiếu…` / `N đơn giao xong đã lâu mà sàn CHƯA trả tiền…` | `Hubsell đối soát: N đơn nghi sàn trả thiếu… — chênh …` / `Hubsell đối soát: N đơn giao xong đã lâu mà sàn CHƯA trả — … đang treo` | `ops-alerts.ts` |
| Hóa đơn tự phát hành (`INVOICE_AUTO_ISSUE`) | `Tự động phát hành 12 hóa đơn điện tử` | `Hubsell đã tự xuất 12 hóa đơn điện tử — không cần làm gì thêm` (có lỗi: `… — 2 đơn cần bạn xem`) | `workers/invoice-auto-issue.ts` |
| Nhận hóa đơn vừa ký (`INVOICE_DRAFT_SIGNED`) | `Đã nhận 5 hóa đơn bạn vừa ký trên MISA` | `Hubsell đã nhận 5 hóa đơn bạn vừa ký trên MISA — PDF đã sẵn` · *Hubsell tự ghép số hóa đơn vào đơn hàng* | `workers/invoice-cqt-follow.ts` |

Hàm thuần `excludedNotice / plannedNotice / nothingNotice / skippedNotice / refusedNotice` có test trong
`backend/src/integrations/__tests__/tiktok-ads-auto-rules.test.ts` (khối "câu chuông lượt chấm", kiểm cả trần 70 ký tự).
`vndCompact` chuyển về `lib/ads-format.ts` (trước là `compactVnd` riêng trong `new-order-notify.ts`, nay chỉ là bí danh).

## 3. Cố ý KHÔNG đổi

- **Khách xin hủy / đơn đã chuẩn bị bị hủy** (`cancel_request`, `order_cancelled`): chữ anh chốt 23/10 tối, giữ nguyên.
- **Hỏa tốc** (`order_express`): đã đúng công thức (việc + vì sao gấp).
- **Gói / thanh toán / trần đơn / ngủ đông** (`plan_*`, `subscription`): thông báo tiền của khách, giữ giọng trung tính.
- **Mất kết nối gian, đồng bộ dừng, Lazada hết kỳ, hạn thuế**: đã nói rõ hậu quả + việc cần làm.
- **Báo cáo tuần** (`weekly-report`): anh để sau (sẽ bổ sung thư email + khối "Hubsell đã làm gì" + "việc chờ anh quyết" — xem memory `hubsell-khach-it-vao-app-vi-tu-dong-hoa`).

## 4. Chỗ muốn nói giá trị mà CHƯA có số — làm sau nếu anh muốn

| Việc máy đang làm im lặng | Vì sao chưa nói được bằng số | Cần gì |
|---|---|---|
| Trả lời đánh giá tự động (1 lần/ngày) | Không có chuông nào cả; `ReviewAutoReply` chỉ giữ 30 ngày | Chuông ngày: "Hubsell đã trả lời N đánh giá hôm nay — không cần làm gì" |
| Đẩy tồn kho lên sàn | `InventorySyncLog` SUCCESS bị xóa sau 7 ngày, không có chuông | Chuông tuần hoặc gom vào báo cáo tuần |
| Chấp nhận / từ chối yêu cầu hủy | `decideCancelRequest` chỉ ghi log, không lưu quyết định | Thêm cột quyết định + chuông xác nhận "đã trả lời sàn, đơn giữ được X₫" |
| "Tiền tiết kiệm" của Trợ lý ads | Chỉ có chi cửa sổ lúc ra lệnh (trong `reasons`), không có cột tiền tiết kiệm | Cột `savedEstimate` trên `AdsActionLog` hoặc tính lại từ chi sau khi dừng |

## 5. Kiểm sau deploy

- Log worker: chuông TikTok Ads mới có dạng `Trợ lý đã loại N video — chặn …`; chuông đơn mới `Hubsell đã nhận N đơn mới · …`.
- App mobile 1.4.0 / web: mở chuông, soi dòng dài nhất ở màn 320 px (tiêu đề ≤ 70 ký tự nên không tràn).
- Dedupe `notify()` theo (type, title) 24 giờ: tiêu đề giờ mang số → hai lượt khác số không gộp nhau (đúng ý: mỗi lượt là một việc đã làm).
