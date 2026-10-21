# Ngủ đông gian hàng khi gói hết hạn quá ân hạn

> 15/10/2026 — anh Trung chốt: *"gian hết gói rồi quá 7 ngày ân hạn thì ngừng luôn
> việc cập nhật đơn hàng, tốn hạ tầng mà chẳng được gì"*. Tài liệu này là nguồn
> sự thật của cơ chế; mã ở `backend/src/services/plan-hibernation.ts` và
> `backend/src/workers/plan-hibernate.ts`.

## 1. Vì sao đổi luật

Luật 22/08 (đầu `plan-enforcement.ts`): hết gói chỉ **khóa tầng giá trị gia tăng**
(tài chính, thuế, trợ lý, quảng cáo); đơn + tồn kho **không bao giờ ngắt đồng bộ**.

Thực tế: gói mặc định là **dùng thử 14 ngày**, nên phần lớn gian "hết hạn" là người
thử rồi bỏ. Với mỗi gian như vậy hệ thống vẫn trả: tầng nhanh quét đơn (giãn tới
60'), tầng giờ đối soát phí/payout, webhook ghi đơn + đẩy tồn, ghi sổ cái, đối soát
tồn 6h. Ở mốc thiết kế 50.000 khách, gian "ma" có thể nhiều hơn gian trả tiền.

## 2. Luật mới

| Tình huống | Tầng giá trị gia tăng | Đồng bộ đơn / tồn kho |
|---|---|---|
| Vượt trần đơn quá ân hạn (lý do `ORDERS`) | Khóa | **Vẫn đồng bộ** (luật 22/08 giữ) |
| Hết gói quá ân hạn `EXPIRED_GRACE_DAYS` = 7 ngày (lý do `EXPIRED`) | Khóa | **Ngủ đông** |

Ngủ đông = cột `Channel.hibernatedAt` khác NULL trên mọi gian sàn (Shopee, Lazada,
TikTok; gian OFFLINE không đụng) của chủ shop đó:

- Worker **quét đơn / đối soát / ads / xung ads** (`order-auto-sync`) bỏ qua gian.
- **Đối soát tồn 6h** (`stock-reconcile`), **đẩy tồn** (`stock-push-worker`: việc
  chờ bị xóa như gian đã ngắt), **đồng bộ hàng hóa** (`product-catalog-sync`) bỏ qua.
- **Webhook sàn**: route vẫn trả 200 (trả lỗi là Shopee tắt push của cả app), ghi
  `webhook_events` + xếp việc như thường; **bộ xử lý việc** gặp gian ngủ đông thì trả
  ghi chú `HIBERNATED_SKIP_NOTE` → việc xong, không ghi đơn, không thử lại. Lazada
  một seller nối nhiều tài khoản: chỉ bỏ gian ngủ, gian của tài khoản còn gói vẫn xử lý.
- **Nút Đồng bộ tay** (`/channels/:id/sync-orders`, `/sync-settlements`) trả 403
  `PLAN_LOCKED` / `EXPIRED` kèm câu mời gia hạn; tự chữa lành khi tra đơn (`orders.ts`)
  và quét đơn hoàn (`warehouse.ts`) bỏ gian ngủ.
- **Nhắc ủy quyền lại Lazada** bỏ gian ngủ (không làm phiền khách đã bỏ).
- **CHỈ worker làm mới token còn chạy**: refresh token Shopee sống 30 ngày, không
  xoay thì khách quay lại phải ủy quyền lại từng gian — mất điểm "gia hạn là xong".
- **HQ Sức khỏe**: gian ngủ đông không tính vào "gian trễ quét" (`platform-health`).
- **Không xóa gì** — cam kết "không xóa dữ liệu" trong hồ sơ Bộ Công Thương
  (`THONG-BAO-BO-CONG-THUONG.md` khoản 16) giữ nguyên.

### Vì sao đẩy `next*SyncAt` về năm 2100

Chỉ mục quét là `(status, nextFastSyncAt)` (và tương tự cho xung ads, hàng hóa).
Nếu chỉ thêm điều kiện `hibernatedAt IS NULL`, hàng nghìn gian ngủ đông có
`nextFastSyncAt` trong quá khứ vẫn nằm **đầu** vùng quét của chỉ mục và bị đọc rồi
lọc bỏ **mỗi tick 20 giây**. Đẩy mọi `next*At` về `HIBERNATE_FAR_FUTURE`
(01/01/2100) thì gian rơi hẳn ra ngoài vùng `<= now`; `hibernatedAt: null` trong
truy vấn chỉ là dây an toàn thứ hai. Không để NULL vì `nextFastSyncAt IS NULL` /
`nextAdsPulseAt IS NULL` nghĩa là "chưa chạy bao giờ → quét ngay".

> 22/10/2026: cùng worker và cùng mốc ân hạn, bước 2 chuyển hồ sơ chăm sóc CRM HQ sang
> "Đã rời bỏ"; thanh toán chuyển "Đang dùng ổn định" cùng giao dịch đánh thức gian —
> xem [HQ-CRM-TU-CHUYEN-TRANG-THAI.md](HQ-CRM-TU-CHUYEN-TRANG-THAI.md).

## 3. Đặt cờ: worker `plan-hibernate`

- Nhịp **6 giờ**, lượt đầu 5 phút sau khi bật — **số tự chọn** (ân hạn tính theo
  ngày, không cần dày). Tắt bằng env `PLAN_HIBERNATE_OFF=1` (đường lui: gian đã
  ngủ vẫn ngủ; muốn thức hết thì chạy SQL mục 6).
- Điều kiện (`hibernationCandidatesWhere`): `subscriptions.currentPeriodEnd < now − 7 ngày`
  (chỉ mục sẵn trên `currentPeriodEnd`), chủ không phải tài khoản điều hành nền
  tảng, và còn ít nhất một gian sàn `ACTIVE` chưa có cờ. Không lọc theo `status`
  thuê bao: `CANCELLED`/`EXPIRED` có kỳ hạn cũng ngủ — cùng cách suy `expired` của
  `getOwnerPlanState`. Khách cũ chưa được gán thuê bao không có dòng → không bao giờ
  bị ngủ nhầm.
- Đọc theo trang 200 bằng `id > cursor` trong WHERE (22/10/2026 sửa: trước dùng `cursor +
  skip 1` của Prisma, nhưng thuê bao của trang trước vừa đặt cờ hết "còn gian thức" → dòng
  cursor rơi khỏi lọc → `skip 1` bỏ sót một chủ mỗi trang, lượt sau mới nhặt); mỗi trang
  **một** `UPDATE ... WHERE userId IN (...)`
  đặt cờ + đẩy `next*At`; một chuông `plan_expiry` cho mỗi chủ (title cố định → `notify`
  tự khử trùng 24h). Idempotent: chạy lặp vô hại.
- Độ trễ tối đa giữa lúc khóa tầng giá trị gia tăng và lúc ngủ đông là một nhịp
  worker (≤ 6h) — màn khóa nói "đang tạm ngừng" trong khoảng đó là sớm vài giờ,
  chấp nhận.

## 4. Đánh thức: trong giao dịch thanh toán

`recordPackagePaymentTx` (payOS, Ví Hubsell, Apple IAP, HQ ghi tay — mọi đường ghi
kỳ hạn mới) gọi `wakeHibernatedChannelsTx(tx, ownerId, occurredAt)` **ngay sau
upsert thuê bao, cùng giao dịch**: xóa cờ, mọi `next*At = now`, `syncBackoffLevel = 0`.
Kỳ hạn mới và lệnh quét lại là một sự thật — không có khe "đã trả tiền mà vẫn
chưa đồng bộ". Nhịp 20s của worker nhặt gian trong vòng một tick.

**Mốc nước không đụng** (`ordersWatermarkAt`, lát 3.2 giai đoạn 3): lượt quét đầu
sau khi thức đọc từ mốc cũ − 30' tới now, tự chia cửa sổ 15 ngày (giới hạn Shopee),
trần `WATERMARK_FLOOR_DAYS` = **90 ngày** (`WAKE_CATCHUP_MAX_DAYS`, số tự chọn —
trùng trần nạp lịch sử gian mới). Ngủ lâu hơn 90 ngày thì phần cũ hơn coi như nối
mới; khách cần thì bấm Đồng bộ tay.

Hạn chế đã biết sau khi thức:
- Đối soát **phí thật** (escrow/settlement) chỉ vét `SETTLE_DAYS_BACK` = 7 ngày;
  đơn hoàn 2–7 ngày. Đơn trong lúc ngủ có đủ dòng đơn + phí ước tính, phí thật của
  phần cũ hơn 7 ngày không được đối chiếu lại (TikTok có cờ `settlementRebuildPending`
  dựng lại toàn bộ bản kê, chưa gắn tự động — làm khi có khách thật cần).
- Việc đẩy tồn bị xóa lúc ngủ: lượt đối soát tồn 6h cân lại khi thức.

## 5. Câu chữ với khách (đã đổi 15/10)

Chỉ đổi **nhánh hết hạn**; nhánh vượt trần đơn vẫn nói "đơn vẫn đồng bộ đầy đủ".

| Nơi | Câu mới |
|---|---|
| 403 `requirePlanUnlocked` lý do EXPIRED | gia hạn để … nối lại đồng bộ đơn hàng, tồn kho (đang tạm ngừng); dữ liệu đã có giữ nguyên |
| 403 nút Đồng bộ tay gian ngủ | `HIBERNATED_HTTP_MESSAGE` |
| Chuông hết hạn (trước / sau khóa) | sau ngày X … đồng bộ tạm ngừng / đang tạm ngừng — thanh toán là mở lại, đơn phát sinh được kéo bù |
| Chuông lúc đặt cờ | "Đồng bộ đơn hàng và tồn kho đã tạm ngừng — gói X hết hạn quá 7 ngày" |
| Web `plan-quota-guard` (dải + màn khóa), `/settings/plan` | tương tự, nhánh `expired` |
| Mobile `plan-ui.ts`, `PlanLockedCard` | trung tính theo luật store: "đang tạm ngừng; dữ liệu đã có giữ nguyên", **không** nhắc gia hạn |

Landing `/terms`, `/quy-che` không hứa gì về đồng bộ → không sửa. Mobile đổi chữ chỉ
có hiệu lực ở bản dựng sau (build 1.0 (11) đang chờ Apple duyệt vẫn mang câu cũ).

## 6. Vận hành

Đo trước/sau (Supabase chỉ đọc):

```sql
-- Gian của chủ hết gói quá 7 ngày, đã ngủ / còn thức
select c."channelName",
       count(*) filter (where c."hibernatedAt" is not null) as dang_ngu,
       count(*) filter (where c."hibernatedAt" is null)     as con_thuc
from "Channel" c
join subscriptions s on s."userId" = c."userId"
where c.status = 'ACTIVE' and c."refreshToken" is not null
  and c."channelName" in ('SHOPEE','LAZADA','TIKTOK')
  and s."currentPeriodEnd" < now() - interval '7 days'
group by 1;
```

Log cần thấy sau deploy: `[plan-hibernation] BẬT — mỗi 6h …`, rồi
`[plan-hibernation] Đặt ngủ đông N gian của M chủ shop …` ở lượt đầu (≈5' sau khởi
động); khi khách trả tiền: `[plan-hibernation] Chủ … gia hạn → đánh thức N gian`.

Đánh thức tay toàn bộ (đường lui khẩn, cùng dữ liệu `wakeChannelData`):

```sql
update "Channel" set "hibernatedAt" = null, "nextFastSyncAt" = now(), "nextHourlySyncAt" = now(),
  "nextAdsSyncAt" = now(), "nextAdsPulseAt" = now(), "syncBackoffLevel" = 0
where "hibernatedAt" is not null;
```

## 7. Chưa làm / việc sau

- Thẻ "Gian ngủ đông" trên HQ → Sức khỏe (đếm theo sàn) — hiện chỉ có log + SQL trên.
  ✅ 16/10/2026 một phần: dấu hiệu "Mốc nước quét đơn" in "· N ngủ đông (không tính)" và loại gian
  ngủ đông khỏi phép đếm trễ (sáng 16/10 lượt ngủ đông đầu tiên làm HQ báo vàng oan "RUXI 233'");
  thẻ riêng đếm theo sàn vẫn chưa làm.
- Dọn dữ liệu của khách bỏ hẳn sau N tháng: **không** thuộc lát này (anh đã đóng
  `hubsell-data-retention`, đừng tự mở lại).
- Test tích hợp trên database cho `hibernateExpiredOwners` / `wakeHibernatedChannelsTx`
  (hiện chỉ test hàm thuần, 11 ca `plan-hibernation.test.ts`).
