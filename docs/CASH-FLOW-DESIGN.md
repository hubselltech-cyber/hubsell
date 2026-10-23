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
4. **"Tổng doanh thu dự kiến" = Chưa thanh toán + Ví sàn** (từ 09/10/2026;
   trước đó = Đang giao + Chờ đối soát + Ví sàn) — tiền còn nằm NGOÀI ngân
   hàng, sẽ về tay chủ shop. Tiền đã về bank là quá khứ đã cầm chắc, không
   thuộc "dự kiến" nên không cộng.
5. **Cột "Về Ngân hàng" chỉ tính 30 ngày gần nhất** — lũy kế all-time phình mãi
   vô nghĩa; 30 ngày khớp thói quen đối chiếu sổ bank theo tháng của kế toán.
6. **Real-time:** mở bảng là frontend gọi `POST /cash-flow/refresh` chạy NGẦM
   (hiện số đã sync ngay, sàn trả về xong thì số tự thay); cron giờ trong
   `order-auto-sync.ts` là lưới đỡ. Lỗi từng gian gom vào `errors[]` hiển thị
   cảnh báo vàng — không nuốt im lặng.
7. **Vòng đời gian đã ngắt kết nối** (`Channel.disconnectedAt`, chốt 14/08):
   ngắt xong vẫn HIỂN THỊ 30 ngày kèm nhãn mờ "Đã ngắt" — cho tiền đang giao /
   chờ đối soát về nốt — rồi backend tự ẩn khỏi bảng; nối lại là hiện lại ngay
   (`disconnectedAt` về null). Gian đã ngắt KHÔNG được gọi API refresh (token
   chết chỉ sinh cảnh báo nhiễu); mọi điểm chuyển status ACTIVE/DISCONNECTED
   đều phải set/clear `disconnectedAt` (webhook có guard đổi trạng thái thật
   mới ghi để không reset đồng hồ 30 ngày).

## Cột "Chưa thanh toán" thay "Đang giao" + "Chờ đối soát" (09/10/2026, anh Trung chốt)

**Vì sao đổi:** hai cột cũ cộng từ ĐƠN trong app. Probe prod 09/10
(`backend/scripts/shopee-income-probe.ts`): ANO Official Store có 1.885 đơn đã
giao hơn 30 ngày vẫn `isSettled=false` → "chờ đối soát" 399,8tr trong khi Seller
Center báo chưa thanh toán 16,07tr; cột "đang giao" 19,15tr (ước tính net của 122
đơn SHIPPING) còn lớn hơn cả tổng chưa thanh toán của sàn — một phần đơn SHIPPING
trong app đã xong trên sàn. Sổ cái KHỚP bảng Order (không phải lỗi sổ); lỗi gốc là
đơn lịch sử không được đánh dấu quyết toán (việc riêng, chưa làm).

**Số sàn tự công bố, một call/gian, lưu `Channel.pendingIncome` + `pendingIncomeSyncedAt`:**

| Sàn | Nguồn | Ghi chú |
|---|---|---|
| Shopee | `GET /api/v2/payment/get_income_overview` → `response.total_income.pending_amount` (API mới 14/10/2025; shop VN = Local chỉ có Pending/Released, gửi `income_status=0` bị error_param). `released_amount` = ô "Đã thanh toán · Tổng cộng". | Prod 09/10: `total_income` nằm TRONG `response` (ví dụ docs đặt ngang hàng `error` — đọc cả hai, `lib/pending-income.ts`). Gian ít đơn: Σ `get_income_detail` (income_status=2, danh sách ở `response.list`, mỗi dòng `estimated_escrow_amount`) = đúng pending_amount. Phân trang detail >50 đơn chưa kiểm. |
| TikTok | `GET /finance/202507/orders/unsettled` → `sum_est_settlement_amount` (chuỗi), chỉ gửi `search_time_ge` = 01/01/2025, page_size 20. | Docs: "estimated amount, subject to change before settlement". Tổng có đúng cho CẢ tập hay chỉ trang đầu khi >20 giao dịch — CHƯA kiểm với gian thật, đối chiếu Seller Center khi lên prod. |
| Lazada | KHÔNG có API (Finance API chỉ 4 endpoint: GetPayoutStatus, QueryAccountTransactions, QueryLogisticsFeeDetail, QueryTransactionDetails — toàn số đã chốt/đã chi). | Lùi về Σ đang giao + chờ đối soát từ đơn, `pendingIncomeSource = ORDERS`, tooltip nói rõ. |
| Offline | null → "—". | |

**Luồng:** `POST /cash-flow/refresh` (mở bảng / nút Làm mới) gọi cùng lượt với
sync ví; cron giờ `order-auto-sync.ts` gọi sau sync rút ví (Shopee) / payout
(TikTok). Sàn không trả số → giữ số cũ. Shopee/TikTok chưa sync lần nào → null
("—"), KHÔNG lùi về số đơn (đang phồng). Payload GET vẫn trả `inTransit` /
`pendingSettle` để đối chiếu, bảng không hiển thị.

## Nguồn số từng sàn (cột Ví sàn + Về Ngân hàng)

| Sàn | Số dư Ví sàn | Về Ngân hàng |
|---|---|---|
| Shopee | `get_wallet_transaction_list`: KHÔNG có API số dư riêng — lấy `current_balance` của giao dịch MỚI NHẤT (= số dư ngay sau giao dịch đó), lưu `Channel.walletBalance` + `walletBalanceSyncedAt`. Chỉ shop local (VN OK). | Cùng API, lọc `transaction_type` chứa `WITHDRAWAL` → `WalletWithdrawal` (SYNC). |
| Lazada | KHÔNG có ví giữ tiền — sàn chi thẳng về bank theo kỳ sao kê. "Ví sàn" = Σ kỳ sao kê đã chốt nhưng CHƯA chi: `/finance/payout/status/get` bản ghi `paid=0` → `WalletWithdrawal` status PENDING source SYNC. Vẫn là số THẬT từ API. | Bản ghi `paid=1` (status SUCCESS). |
| TikTok | KHÔNG có API số dư. `GET /finance/202309/withdrawals` ("Get Seller Financial Transactions") = sổ cái từng dòng {id, type, amount chuỗi, currency, status, create_time}; lưu thô vào `TiktokWalletTxn`, số dư = Σ theo luật dấu trong `tiktok/wallet.ts` (SETTLE/REWARD/REVERSE +, WITHDRAW/PAYMENT −, TRANSFER giữ dấu, POLICY_VIOLATION_DEDUCTION −, REFUND 0) → `Channel.walletBalance`. Cửa sổ: 90 ngày trước ngày ủy quyền (anh Trung chốt 23/10/2026: không ai để tiền trên sàn quá 90 ngày), nhịp giờ đọc lùi 2 ngày + dòng chưa chốt. | Dòng `WITHDRAW` (shop rút) + `PAYMENT` (sàn tự chuyển) → `WalletWithdrawal` SYNC; PROCESSED/SUCCESS = SUCCESS, FAILED/REVERSED/CLOSED/EXCEPTION = FAILED, còn lại PENDING. |
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

## TikTok — ĐÃ LÀM 23/10/2026 (sổ cái withdrawals thay nhánh payments 16/09)

- 16/09 em đi đường tắt: `/finance/202309/payments` (docs ghi "currently
  unavailable") + Ví = Σ đợt PROCESSING → ba gian thật hiện 0. 23/10 bỏ hẳn.
- Docs thật (đọc 23/10, workspace API Reference): `types` BẮT BUỘC, gửi
  "WITHDRAW,SETTLE,TRANSFER,REVERSE,PAYMENT,REFUND" (REWARD /
  POLICY_VIOLATION_DEDUCTION / UNKNOWN chỉ xuất hiện ở response); trang sau
  phải gửi lại đúng types + create_time_ge/lt; page_size 1–100; lỗi riêng
  22005007, 36009003.
- Luật dấu CHƯA kiểm với sàn thật: lượt có dòng mới ghi log
  `[TikTok] Ví "<gian>": SETTLE n dòng Σ · PAYMENT … → số dư …` để đối chiếu
  Seller Center; sai thì sửa `tiktokWalletDelta` (dòng thô đã lưu, không đọc
  lại sàn). Điểm ngờ nhất: REFUND (tạm 0) và PAYMENT có phải đợt sàn tự chuyển
  về bank của gian VN không.
- Nhãn cột 1 đổi "Chưa thanh toán" → "Tiền đang giao" + tooltip một câu (anh
  chốt 23/10, khách không hiểu chữ của Shopee); cột Về Ngân hàng GIỮ.
- **Lượt prod đầu 23/10 ~22:00 (11 gian + 3 gian anh):** hình dạng dòng đúng
  docs (keys amount, create_time, currency, id, status, type; amount chuỗi).
  Σ thô ra ÂM ở nhiều gian (Samca −128k, Tarot −109k, TOVO 11 −11,5tr,
  and.not.or −3,03tr, ANO Official −505k): lệnh rút trong cửa sổ rút cả tiền
  cộng TRƯỚC cửa sổ. Hai gian ra đúng 0 từng đồng (TOVO 21: SETTLE = WITHDRAW;
  69Minh Đương: SETTLE − WITHDRAW − PAYMENT = 0) → luật dấu SETTLE +,
  WITHDRAW/PAYMENT − là đúng và shop VN rút cạn ví. → **Số dư = Σ − min(0,
  prefix thấp nhất theo thời gian)**: coi ví cạn tại đáy cửa sổ, không âm
  (cùng thời điểm thì tiền vào tính trước). Log in cả "Σ thô" lẫn "số dư".
- **Đối chiếu số dư (anh chốt 23/10 ~22:20):** cách "ví cạn tại đáy" vẫn lệch
  phần lẻ khi shop rút CHẴN (and.not.or: app 432.290 / Seller Center 445.766,
  lẻ 13.476 còn lại sau lệnh rút 9.000.000). Sổ giao dịch không có số dư nên
  không có cách nào tự biết phần lẻ → nút **Đối chiếu** cạnh số dư gian TikTok
  (dialog: chép "Số tiền rút khả dụng" ở Seller Center → Tài chính → Số tiền
  rút). `POST /cash-flow/reconcile {channelId, platformBalance}` →
  `reconcileTiktokWallet`: `Channel.walletOpeningBalance` = số sàn − Σ thô,
  `walletReconciledAt`; từ đó số dư = Σ thô + số đầu sổ
  (`tiktokWalletBalanceWith`), khớp từng đồng kể cả khi rút sạch sau này (cách
  đoán đáy sẽ sai 13.476 ở ca đó — có test). Chưa đối chiếu: nút màu hổ phách
  + tooltip "có thể lệch phần lẻ"; đã đối chiếu: "Đối chiếu lại" xám + tooltip
  ngày. Migration 20261023223000.
- ⚠️ CHƯA RÕ: gian Siêu Thị 8686 có TRANSFER 229 dòng +839tr (SETTLE chỉ 356tr)
  → số dư 832tr chắc chắn sai. TRANSFER không thể là trợ cấp với số đó; nghi
  là chuyển ví ↔ tài khoản quảng cáo / giữa tiểu khoản. Log
  `[TikTok] Hình dạng dòng sổ cái ví "<gian>" loại TRANSFER: {...}` (mỗi loại
  một lần/tiến trình) để soi dòng thật rồi quyết luật dấu cho TRANSFER.

## Kế hoạch TikTok (bản 14/08/2026 — giữ làm sử)

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
