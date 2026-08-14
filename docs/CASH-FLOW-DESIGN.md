# Phân bổ dòng tiền theo gian hàng — Nguyên lý thiết kế

> Chốt với chủ shop 14/08/2026. Đọc lại tài liệu này TRƯỚC KHI làm phần TikTok
> (mục cuối cùng có kế hoạch sẵn). Code chính: `backend/src/routes/finance.ts`
> (GET/POST `/api/finance/cash-flow*`), `backend/src/integrations/shopee/wallet.ts`,
> `frontend/src/components/finance/cash-flow-table.tsx`.

## Nguyên lý cốt lõi

1. **Mỗi cột trả lời "tiền đang ở đâu" — KHÔNG mô phỏng.** Cột nào không lấy
   được số THẬT từ sàn thì hiển thị "—", tuyệt đối không bịa số bằng công thức
   cộng trừ lũy kế (bài học: cột Ví sàn mô phỏng cũ báo ANO 167tr trong khi ví
   thật chỉ ~72tr — "Seller nhìn vào lại tưởng mình có nhiều tiền").
2. **Chỉ tính đơn ĐÃ BÀN GIAO vận chuyển** (`SHIPPING`) vào dòng tiền dự kiến.
   Đơn còn trong kho (PENDING/PROCESSED) tỷ lệ hủy cao → lạc quan ảo.
3. **Đơn đã quyết toán KHÔNG cộng theo từng đơn** — tiền của nó đã nằm trong số
   dư ví thật hoặc đã về bank; cộng thêm là đếm hai lần. Vì lý do này chi phí
   vận hành nguồn PLATFORM_WALLET/BANK_ACCOUNT cũng bỏ khỏi bảng (số dư thật
   tự phản ánh), chúng vẫn ở nguyên các trang P&L.
4. **"Tổng doanh thu dự kiến" = Đang giao + Chờ đối soát + Ví sàn** — tiền còn
   nằm NGOÀI ngân hàng, sẽ về tay chủ shop. Tiền đã về bank là quá khứ đã cầm
   chắc, không thuộc "dự kiến" nên không cộng.
5. **Cột "Về Ngân hàng" chỉ tính 30 ngày gần nhất** — lũy kế all-time phình mãi
   vô nghĩa; 30 ngày khớp thói quen đối chiếu sổ bank theo tháng của kế toán.
6. **Real-time:** mở bảng là frontend gọi `POST /cash-flow/refresh` chạy NGẦM
   (hiện số đã sync ngay, sàn trả về xong thì số tự thay); cron giờ trong
   `order-auto-sync.ts` là lưới đỡ. Lỗi từng gian gom vào `errors[]` hiển thị
   cảnh báo vàng — không nuốt im lặng.

## Nguồn số từng sàn (cột Ví sàn + Về Ngân hàng)

| Sàn | Số dư Ví sàn | Về Ngân hàng |
|---|---|---|
| Shopee | `get_wallet_transaction_list`: KHÔNG có API số dư riêng — lấy `current_balance` của giao dịch MỚI NHẤT (= số dư ngay sau giao dịch đó), lưu `Channel.walletBalance` + `walletBalanceSyncedAt`. Chỉ shop local (VN OK). | Cùng API, lọc `transaction_type` chứa `WITHDRAWAL` → `WalletWithdrawal` (SYNC). |
| Lazada | KHÔNG có ví giữ tiền — sàn chi thẳng về bank theo kỳ sao kê. "Ví sàn" = Σ kỳ sao kê đã chốt nhưng CHƯA chi: `/finance/payout/status/get` bản ghi `paid=0` → `WalletWithdrawal` status PENDING source SYNC. Vẫn là số THẬT từ API. | Bản ghi `paid=1` (status SUCCESS). |
| TikTok | null → "—" (chưa làm — xem kế hoạch dưới). | Chưa làm. |
| Offline | null → "—" (không có ví). | Nhập tay "Xác nhận đã rút ví" (MANUAL). |

## Bẫy API Shopee đã trả giá (đừng dẫm lại)

- `get_wallet_transaction_list` trần `page_size` = **40** (các API khác thường
  100). Truyền quá → lỗi tham số.
- Trần KHOẢNG THỜI GIAN không công bố trong docs: cửa sổ 15 ngày bị chê
  `wallet.time_invalid — time period too large`. Giải pháp trong `wallet.ts`:
  **cửa sổ tự thích ứng** — bắt đầu 7 ngày, bị chê thì chia đôi thử lại cùng
  mốc, tối thiểu 6h mới ném lỗi thật. Đừng thay bằng hằng số đoán mò.
- Cửa sổ quét không có giao dịch → GIỮ số dư cũ (ví chỉ đổi qua giao dịch),
  không ghi đè null.
- Shop "hủy liên kết" trên Hubsell nhưng token sàn còn hạn thì API vẫn trả
  data; `refresh_token_expired` mới là chết thật → chủ shop phải ủy quyền lại.

## Kế hoạch TikTok (làm khi có shop thật — hiện gian sandbox mock)

Khảo sát docs 14/08/2026 (partner.tiktokshop.com, Finance API, scope
`seller.finance.info`, data từ 07/2023):

- **`GET /finance/202309/withdrawals`** = SỔ CÁI VÍ của seller, 4 loại giao dịch:
  `SETTLE` (sàn cộng tiền vào ví) / `WITHDRAW` (rút về bank) / `TRANSFER`
  (trợ cấp/khấu trừ) / `REVERSE` (rút thất bại, hoàn lại ví). Không giới hạn SEA.
- TikTok KHÔNG có API số dư trực tiếp → **Số dư ví = Σ SETTLE − Σ WITHDRAW ±
  TRANSFER/REVERSE** quét từ đầu đời shop (ledger). Cân nhắc lưu mốc đã quét
  để cron chỉ cộng dồn phần mới.
- **Cột Về Ngân hàng = các bản ghi type `WITHDRAW`** → WalletWithdrawal như
  hai sàn kia. LƯU Ý: `GET /finance/202309/payments` **KHÔNG khả dụng SEA/VN**
  — đừng dùng, dùng withdrawals.
- Đối chiếu "chờ đối soát": `GET /finance/202507/unsettled-transactions`
  (phí ước tính chi tiết theo đơn) — bước sau, không bắt buộc.
- `GET /finance/202309/statements`: sao kê ngày, `payment_status`
  PAID/PROCESSING/FAILED — dùng kiểm chứng chéo ledger.
- Việc code khi có shop thật: (1) client Finance API + chữ ký, (2) sync ledger
  → `Channel.walletBalance` + WalletWithdrawal, (3) thêm nhánh TIKTOK vào
  `/cash-flow/refresh` và cron — frontend KHÔNG phải sửa (đã hiển thị theo
  `walletBalance` null/number sẵn).
