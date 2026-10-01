# Giai đoạn 2: hàng đợi việc bền và webhook 3 sàn

Ngày lập: 01/10/2026. Người lập: Claude (Lead Dev). Trạng thái: **thiết kế anh Trung duyệt 01/10 tối; đã soạn migration bước nền (chưa đẩy, chờ anh duyệt SQL); chưa viết mã nghiệp vụ** (ngoài tệp thử `backend/scripts/pgboss-pooler-probe.mjs`). Thuộc chương trình `docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md`, mục 6.2.

---

## 1. Kết quả thử pg-boss với bộ gộp kết nối Supabase

Thư viện: pg-boss 12.35.1 (bản mới nhất ngày 01/10/2026). Bài thử gồm 19 bài, chạy trong một schema riêng `pgboss_probe`, xong tự xóa.

| Nơi chạy | Kết quả |
|---|---|
| Postgres 17 local | 19/19 đạt |
| Supabase prod, cổng 5432 (chế độ phiên, đang dùng) — chạy từ Render Shell của worker | 18/18 bài chạy được đều đạt, 1 bài bỏ qua |
| Supabase prod, cổng 6543 (chế độ giao dịch) — cùng chỗ | 18/18 đạt về chức năng, 1 bài bỏ qua; riêng LISTEN/NOTIFY không dùng được |

Sau hai lượt: schema thử đã xóa (`schemaLeft: 0`), thư mục tạm trên Render đã dọn, bộ nhớ worker 175 → 230 MB / 512 MB trong lúc chạy.

### 1.1. Số đo trên Supabase (Render Singapore → Supabase Singapore)

| Bài | Cổng 5432 (phiên) | Cổng 6543 (giao dịch) |
|---|---|---|
| Cài schema bằng SQL xuất ra, rồi chạy với `migrate: false` | Đạt, không lệch schema | Đạt |
| Tạo hàng đợi không sinh bảng mới lúc chạy | Đạt | Đạt |
| Gửi → bắt đầu xử lý, nhịp hỏi 0,5 giây | giữa 359 ms, p95 509 ms | giữa 358 ms, p95 507 ms |
| Lỗi → thử lại có giãn cách → hàng đợi lỗi | Đạt (3 lượt) | Đạt |
| Việc bị bỏ dở được trả lại theo hạn giữ; người giữ cũ báo xong muộn không ghi đè | Đạt | Đạt |
| Gộp việc theo khóa (1 chờ + 1 đang chạy mỗi khóa), sửa được việc đang chờ | Đạt | Đạt |
| Đúng thứ tự theo khóa, 2 instance, 1.000 việc | 0 chồng, 0 sai thứ tự, 1.992 việc/giây | 0 / 0, 2.000 việc/giây |
| Tải 1.000 việc, 2 instance | ghi 9.434/giây, xử lý 4.016/giây, 0 việc trùng | ghi 13.889/giây, xử lý 5.000/giây, 0 trùng |
| Xếp việc + báo xong chung giao dịch Prisma (rollback mất cả hai, commit có cả hai) | Đạt | Đạt (Prisma cần `pgbouncer=true`) |
| Gửi việc trong giao dịch Prisma (30 lượt) | giữa 10 ms, p95 10 ms | giữa 10 ms, p95 45 ms |
| Tiến trình web: pool 1 kết nối, nghỉ 12 giây thì trả hết kết nối | 0 kết nối giữ | 0 |
| LISTEN/NOTIFY đánh thức ngay | **Chạy được**, giữa 9 ms | **Không chạy** (chỉ còn nhịp hỏi) |
| Nghỉ 75 giây / 40 giây rồi gửi tiếp | Đạt, 0 lỗi kết nối | Đạt, 0 lỗi |
| Dừng êm | 21 ms | 21 ms |

### 1.2. Điều phát hiện được, ảnh hưởng tới thiết kế

1. **"Trần theo nhóm" (`groupConcurrency`) không chặt.** Đặt trần 1 việc/nhóm mà vẫn có 30–36 lần trên 60 việc hai việc cùng nhóm chạy chồng, kể cả khi chỉ có 2 worker. Nguyên nhân đọc từ mã: câu lấy việc kiểm "nhóm đang có việc chạy không" mà không khóa, hai worker hỏi cùng lúc đều thấy trống. → Không dùng tính năng này làm rào đúng sai. Hai chính sách khác thì chặt (0 lần chồng): gộp theo khóa (`stately`) và thứ tự theo khóa (`key_strict_fifo`).
2. **Sức xử lý phụ thuộc cách lấy việc.** Mỗi worker lấy 1 việc mỗi nhịp hỏi thì chỉ được 16 việc/giây; lấy theo lô 10 và chạy liền khi lô đầy thì 2.000 việc/giây. Phải cấu hình theo lô.
3. **pg-boss không chạy hẳn trên kết nối của Prisma được** (hỏng ngay ở `start()` vì Prisma không đọc được kiểu `regclass`), và instance chưa `start()` thì không gửi được. → Mỗi tiến trình cần một pool riêng nhỏ cho pg-boss; riêng việc **gửi** thì đi qua giao dịch Prisma được.
4. **Bộ gộp Supabase che tên ứng dụng** (`application_name` không hiện trong `pg_stat_activity`). Bài "cắt kết nối giữa chừng" vì thế không nhận diện được kết nối của chính mình nên tự bỏ qua trên Supabase (local đạt: cắt 4 kết nối, 5/5 việc vẫn chạy).
5. **pg-boss là gói ESM**, backend là CommonJS. Node trên Render là v24.21.0 nên `require()` được; đã biên dịch thử với đúng `tsconfig` của backend (TypeScript 5.9.3), kiểu đầy đủ.
6. **pg-boss không giữ câu lệnh chuẩn bị sẵn** trên kết nối (0 câu) — không lặp lại kiểu sự cố bộ nhớ database 30/09. Phía Prisma chỉ giữ 2 câu cho việc gửi.
7. **Tạo hàng đợi được ngay trong SQL** (`SELECT pgboss.create_queue(...)`), kể cả hàng đợi có bảng riêng. → Toàn bộ thay đổi database nằm trong một tệp migration trình trước, lúc chạy không có lệnh tạo bảng nào. Điều kiện: không bật `persistQueueStats` (bật thì thư viện tự tạo mỗi ngày một mảnh bảng thống kê).

### 1.3. Chưa kiểm

- Cắt kết nối giữa chừng **trên Supabase** (mới đạt ở local).
- Hành vi khi bộ gộp hết chỗ (`EMAXCONNSESSION`) — cố ý không thử trên prod.
- Chạy nhiều giờ liền, và chạy xuyên qua một lần deploy thật.
- Handler thật (gọi API sàn). Bài thử dùng handler rỗng hoặc ngủ 5–40 ms.
- Nghỉ lâu hơn 75 giây.

**Kết luận:** pg-boss chạy được với bộ gộp Supabase ở cả hai chế độ. Không phải đổi cách làm hàng đợi.

---

## 2. Hiện trạng (đọc mã 01/10)

| Thành phần | Cách làm hiện tại | Vấn đề |
|---|---|---|
| Webhook Lazada | Trả 200 rồi `setImmediate` xử lý trong RAM của web | Deploy hoặc sập giữa chừng là mất sự kiện (A4) |
| Webhook Shopee | Bảng `shopee_webhook_logs`, 1 luồng, cờ `draining` trong RAM | 1 việc một lúc; **web cũng tự xử lý** (`enqueueShopeeWebhook` gọi `drain()` không xét vai tiến trình) |
| Webhook TikTok | Bảng `tiktok_webhook_logs`, 3 làn, khóa đơn bằng `Set` trong RAM | Khóa theo đơn chỉ đúng trong một tiến trình |
| Webhook MISA | Bảng `misa_webhook_logs`, cùng khuôn | Không có lưu lượng thật: meInvoice không có webhook, prod 0 dòng (đếm 01/10). Phần hóa đơn xem mục 3.8 |
| Đẩy tồn | Bảng `stock_push_jobs` (khóa gian + SKU), 1 luồng, đi tuần tự từng gian | 1 gian chậm kéo cả hàng; xếp việc **sau** khi giao dịch đơn đã commit, có khe mất việc |
| Đối soát tồn Shopee | Nhét chung vào `shopee_webhook_logs` bằng mã sự kiện riêng | Hai loại việc chung một bảng |
| Khởi động worker | Trả mọi việc `PROCESSING` về `PENDING` | Khi có 2 worker (hoặc lúc deploy, bản cũ và mới cùng sống) thì kéo cả việc bản kia đang làm |
| Lệnh gọi sàn | Gần 20 chỗ `fetch` trong 4 client (Shopee, Lazada, TikTok, TikTok Ads), không chỗ nào có thời hạn chờ | Sàn treo là luồng việc treo theo |

Bốn bảng trên không chỉ là hàng đợi. `stock_push_jobs` được trang Sản phẩm và trang Kho đọc để hiện "đang đồng bộ" theo SKU, đếm việc chờ theo chủ shop, xóa việc khi chủ shop tắt đồng bộ một gian. Ba bảng webhook có trang nhật ký trên HQ và là nguồn của chỉ số "việc chờ lâu nhất" trên HQ Sức khỏe.

---

## 3. Thiết kế

### 3.1. Nguyên tắc: bảng nghiệp vụ giữ trạng thái, pg-boss điều phối

Em đã cân hai cách và chọn cách thứ hai.

- **Cách 1, bỏ bảng cũ, mọi thứ nằm trong pg-boss.** Gọn hơn, ít ghi hơn. Nhưng bảng việc của pg-boss là hộp kín (dữ liệu nằm trong một cột JSON), các trang đang hỏi "SKU này của gian này có đang chờ đẩy không", "chủ shop này còn bao nhiêu việc" sẽ phải đọc thẳng cấu trúc nội bộ của thư viện. Lên bản thư viện là có thể vỡ.
- **Cách 2, giữ bảng nghiệp vụ, pg-boss chỉ làm điều phối.** Bảng sự kiện (hộp thư đến) và bảng đẩy tồn (hộp thư đi) vẫn là nơi giữ trạng thái mà giao diện và HQ đọc. pg-boss giữ một việc nhỏ kiểu "đơn X của gian Y có sự kiện mới", "gian Z có tồn chờ đẩy", và lo phần khó: ai nhận, hạn giữ, thử lại, giãn cách, hàng đợi lỗi, không chạy chồng một khóa trên nhiều máy. Ghi bảng nghiệp vụ và xếp việc nằm **chung một giao dịch** (đã thử: 10 ms).

Lý do vẫn cần pg-boss dù giữ bảng: giai đoạn 3 chuyển tiếp các việc không có bảng nào (đồng bộ theo lịch từng gian, làm mới token, đối soát tồn, xuất hóa đơn, báo cáo tuần). Tự viết khung nhận việc, hạn giữ, thử lại, lịch chạy một-bản-duy-nhất cho ngần ấy thứ là viết lại pg-boss với lỗi của riêng mình. Hiện đã có 4 bản chép của cùng một khuôn hàng đợi, mỗi bản lệch một chút.

Mã nghiệp vụ không gọi pg-boss trực tiếp mà qua một module `lib/queue`, để sau này đổi thư viện thì sửa một chỗ.

### 3.2. Các hàng đợi của giai đoạn 2

| Hàng đợi | Khóa | Chính sách | Việc | Bảng trạng thái đi kèm |
|---|---|---|---|---|
| `evt.order` | sàn + mã shop + mã đơn | gộp theo khóa (1 chờ + 1 chạy) | Kéo lại một đơn từ sàn rồi ghi, trừ/hoàn kho | `webhook_events` (mới, chung 3 sàn) |
| `evt.auth` | không | thường | Sự kiện ủy quyền / thu hồi ủy quyền | `webhook_events` |
| `stock.channel` | mã gian | gộp theo khóa | Đẩy hết tồn đang chờ của một gian | `stock_push_jobs` (giữ nguyên) |
| `stock.verify` | không, có hẹn giờ | thường | Đọc lại tồn Shopee sau khi đẩy | không cần |
| `invoice.issue` | mã chủ shop | gộp theo khóa | Phát hành lần lượt mọi tờ đang chờ của một shop (tự động, bấm tay hàng loạt, điều chỉnh) | `invoice_requests` (mới) + `InvoiceLog` |
| `invoice.status` | mã chủ shop | gộp theo khóa | Hỏi trạng thái nhà cung cấp / cơ quan thuế theo lô, gỡ tờ kẹt | `InvoiceLog` |
| `invoice.event` | nhà cung cấp + mã giao dịch | gộp theo khóa | Sự kiện nhà cung cấp đẩy về (bên nào có webhook) | `webhook_events` |
| `*.dead` | | thường | Việc hỏng sau khi hết lượt thử, chờ người xem | |

Ba hàng đợi hóa đơn dựng chung cho mọi nhà cung cấp, không riêng MISA. Chi tiết ở mục 3.8.

`evt.order` có bảng riêng trong pg-boss (đây là hàng đợi đông nhất, tách ra để không làm chậm hàng đợi khác). Các hàng đợi còn lại dùng bảng chung.

**Vì sao `evt.order` gộp theo khóa mà không xử lý lần lượt từng sự kiện.** Cả ba sàn, handler đều không tin trạng thái trong sự kiện mà kéo lại đơn mới nhất từ sàn. Nên cái cần bảo đảm là: (a) không hai tiến trình cùng xử lý một đơn, (b) sau sự kiện cuối cùng luôn có ít nhất một lượt kéo. Chính sách gộp cho đúng hai điều đó, và bỏ được các lượt kéo thừa: thử local 2.000 sự kiện dồn dập của 50 đơn chỉ cần 824 lượt chạy, 0 lần chồng. Mỗi lượt kéo là một lệnh gọi sàn, mà hạn mức gọi sàn là giới hạn không tự nâng được.

Em không chọn "đúng thứ tự theo khóa" vì theo mô tả của thư viện, một việc hỏng hẳn sẽ **chặn mọi việc sau của cùng khóa** tới khi có người gỡ. Một đơn lỗi vĩnh viễn (gian bị thu hồi ủy quyền chẳng hạn) sẽ treo. Điểm này em mới đọc mô tả, chưa thử.

Một chi tiết phải giữ: sự kiện mã vận đơn của Shopee mang sẵn mã vận đơn. Khi sự kiện đó bị gộp vào việc đang chờ, mã vận đơn được ghi đè vào việc đang chờ (tính năng sửa việc đang chờ, đã thử).

### 3.3. Đường nhận webhook chung cho 3 sàn

```
Sàn gọi → kiểm chữ ký → MỘT giao dịch: ghi webhook_events + xếp việc evt.order → trả 200
Worker: nhận việc → kéo đơn từ sàn → ghi đơn + kho + đánh dấu "tồn chờ đẩy" + xếp việc stock.channel (chung giao dịch)
        → đánh dấu các dòng webhook_events của đơn đó là xong
Hết lượt thử → việc sang evt.dead → ghi cảnh báo cho chủ shop (như hiện nay) + đánh dấu dòng sự kiện là hỏng
```

- `webhook_events`: một bảng cho cả ba sàn (cột sàn, loại sự kiện, mã shop, mã đơn, mã băm thân, thân, trạng thái, lỗi cuối, giờ nhận, giờ xong). Chống gửi trùng bằng khóa duy nhất trên mã băm thân như ba bảng hiện nay. Mỗi sự kiện vẫn có một dòng, kể cả khi việc bị gộp, nên nhật ký trên HQ không mất gì.
- Web chỉ ghi và xếp việc, không xử lý. Hết cảnh web tự xử lý webhook Shopee.
- Không còn bước "trả việc mồ côi lúc khởi động". Việc bị bỏ dở quay lại theo hạn giữ.
- Lazada: thêm một lần ghi database trước khi trả 200. Hạn của Lazada là 500 ms; số đo ghi trong giao dịch là 10 ms (p95 10–45 ms). Database lỗi thì trả 500, Lazada tự gửi lại mỗi 30 phút tối đa 12 lần, tốt hơn là mất.

### 3.4. Đẩy tồn

- `stock_push_jobs` giữ nguyên vai trò và khóa (gian + SKU), nên các trang đang đọc bảng này không phải sửa.
- Dòng "tồn chờ đẩy" được ghi **trong chính giao dịch ghi đơn / sửa kho**, cùng lúc xếp một việc `stock.channel` cho gian đó. Đơn đã ghi thì việc đẩy tồn chắc chắn tồn tại.
- Một việc `stock.channel` = đẩy hết các dòng đang chờ của một gian: lấy token một lần, giãn nhịp giữa các lệnh như hiện nay. Nhiều gian chạy song song; một gian không bao giờ có hai worker cùng đẩy, kể cả khi thêm máy. Nhờ vậy cũng hết chuyện dòng kẹt ở trạng thái "đang chạy": việc của gian bị bỏ dở thì việc kế tiếp của gian đó làm tiếp.
- Đối soát tồn Shopee sau khi đẩy chuyển sang `stock.verify` (việc hẹn giờ), không còn nhét trong bảng webhook Shopee.

### 3.5. Kết nối database

Trần chế độ phiên của bộ gộp đang là 30. Hiện dùng: web 5 + worker 3.

| Tiến trình | Thêm | Ghi chú |
|---|---|---|
| Worker | 2 kết nối cho pg-boss, chế độ phiên | Lấy việc, báo xong, giám sát |
| Web | 0–1, tự trả khi nghỉ | Việc gửi đi qua kết nối sẵn có của Prisma |

Lúc bình thường 10–11/30. Lúc deploy (bản cũ và mới cùng sống, cộng migrate) khoảng 22–24/30.

- **Chưa bật LISTEN/NOTIFY.** Nó tốn thêm 1 kết nối giữ thường trực cho mỗi worker để đổi lấy khoảng 350 ms. Nhịp hỏi 0,5 giây đã cho độ trễ giữa 0,36 giây, trong khi hôm nay việc đẩy tồn từ web sang worker chờ tới 5 giây.
- Chuỗi kết nối của pg-boss đặt bằng biến riêng (`QUEUE_DATABASE_URL`, mặc định bằng `DATABASE_URL`). Khi số worker tăng tới mức chật trần 30 thì trỏ biến này sang cổng 6543 (đã thử chạy được), không sửa mã.

### 3.6. Các con số

| Tham số | Đề xuất | Căn cứ |
|---|---|---|
| Số lượt thử | 3 lượt, giãn 30–60 giây rồi 60–120 giây | Số lượt giữ nguyên. Giãn cách hiện là đúng 30 rồi 60 giây; thư viện cộng thêm một khoảng lệch ngẫu nhiên để các việc hỏng cùng lúc không thử lại cùng lúc |
| Hạn giữ một việc | 5 phút | **Em tự chọn.** Hiện đẩy tồn dùng 15 phút (cũng tự chọn). Sẽ tính lại sau khi có thời hạn gọi sàn |
| Số việc chạy cùng lúc mỗi worker, `evt.order` | 4 | **Em tự chọn**, đặt bằng biến môi trường. Hiện Shopee 1, TikTok 3; worker có 3 kết nối database |
| Nhịp hỏi | 0,5 giây (`evt.order`, `stock.channel`), 2 giây (còn lại) | 0,5 giây là mức thấp nhất thư viện cho; đã đo độ trễ ở mức này |
| Giữ việc đã xong | 7 ngày | Bằng chính sách dọn nhật ký kỹ thuật hiện có |
| Thời hạn chờ lệnh gọi sàn | **Chưa đề xuất số** | Chưa có số đo. Bước 0 chỉ ghi lại thời gian từng lệnh gọi; sau 3–5 ngày em trình số kèm phân bố thật |

### 3.7. Quan sát

HQ Sức khỏe thêm cho từng hàng đợi: số việc chờ, tuổi việc chờ lâu nhất, số việc trong hàng đợi lỗi. Các chỉ số đang đọc ba bảng webhook cũ chuyển sang `webhook_events` ở bước dọn.

### 3.8. Hóa đơn: hàng đợi chung và cổng chờ cho nhà cung cấp khác

Anh Trung chốt 01/10: hóa đơn sau này khách dùng nhiều, làm luôn trong giai đoạn 2, kèm chỗ cắm sẵn cho các nhà cung cấp khác. (Trước đó em đề xuất để sang giai đoạn 3 vì prod chưa shop nào có cấu hình hóa đơn và bảng `misa_webhook_logs` có 0 dòng.)

**Hiện trạng phần hóa đơn (đọc mã 01/10)**

| Thành phần | Cách làm hiện tại | Vấn đề |
|---|---|---|
| Tự phát hành | Một vòng đi tuần tự qua mọi shop, 15 phút một lượt, 20 tờ mỗi shop mỗi lượt, cờ `running` trong RAM | Tối đa 1.920 tờ/shop/ngày; shop sau chờ shop trước; lọc cứng `provider: "MISA"` |
| Hỏi trạng thái | Cùng kiểu vòng, 12 giờ một lượt, 200 tờ mỗi shop mỗi lượt, chỉ nhìn 30 ngày | Tối đa 400 tờ/shop/ngày; gọi thẳng hàm của MISA, không qua adapter |
| Phát hành hàng loạt bấm tay | Chạy tuần tự ngay trong request, tối đa 50 đơn | Request treo theo nhà cung cấp; deploy giữa chừng là dở dang |
| Hóa đơn điều chỉnh tự động | `void (async ...)` trong RAM | Deploy giữa chừng là mất |
| Chống phát hành trùng | Kiểm "đã có tờ chưa" rồi mới ghi, không có ràng buộc ở database | Hai luồng cùng lúc đều lọt. MISA tự chặn theo mã đơn, nhà cung cấp khác chưa chắc có |
| Sập giữa lúc gọi nhà cung cấp | Dòng nhật ký nằm mãi ở "đang chờ", không có mã giao dịch | Worker hỏi trạng thái bỏ qua dòng không có mã giao dịch nên dòng kẹt vĩnh viễn, đơn đó không phát hành lại được |
| Công tắc an toàn | `MISA_ALLOW_PUBLISH` dùng chung cho mọi thứ | Không tắt/bật riêng từng nhà cung cấp được |

Hóa đơn đã gửi cơ quan thuế thì không xóa được, nên hai dòng "chống trùng" và "sập giữa chừng" là lỗi tính đúng, không phải chuyện sức tải.

**Ba hàng đợi**

- `invoice.issue`, một việc cho mỗi shop. Trong một shop, mọi tờ phát hành lần lượt (MISA cấp số liên tục theo ký hiệu, bắn song song là bị từ chối); các shop chạy song song với nhau. Việc của một shop gom ba nguồn: đơn đủ điều kiện tự phát hành, yêu cầu bấm tay hàng loạt, hóa đơn điều chỉnh. Luật ngắt mạch khi lỗi cấp tài khoản giữ nguyên.
- `invoice.status`, một việc cho mỗi shop. Hỏi trạng thái theo lô qua adapter. Kiêm việc gỡ tờ kẹt "đang chờ" không có mã giao dịch bằng cách tra ngược theo mã đơn.
- `invoice.event`, cho nhà cung cấp có webhook. Sự kiện đi qua cùng đường nhận với webhook sàn (ghi `webhook_events` + xếp việc chung giao dịch), và áp trạng thái bằng **cùng một hàm** với đường hỏi trạng thái. Hiện có hai bản cài riêng cho hai đường.

Việc cho từng shop được xếp bởi một nhịp trong worker (15 phút với phát hành, 12 giờ với hỏi trạng thái, như hiện nay). Nhịp chỉ xếp việc; nhiều worker cùng xếp thì tự gộp theo khóa shop.

**Bảng mới `invoice_requests`**: mỗi yêu cầu phát hành bấm tay hoặc điều chỉnh tự động là một dòng (shop, loại, mã đơn, người yêu cầu, trạng thái, kết quả). Ghi dòng và xếp việc chung một giao dịch. Nút phát hành hàng loạt trả lời ngay và hiện tiến độ theo bảng này.

**Ràng buộc mới ở database**: một đơn chỉ có một hóa đơn gốc đang chờ hoặc đã phát hành (chỉ mục duy nhất có điều kiện trên `InvoiceLog`). Trước khi tạo em kiểm dữ liệu hiện có xem có dòng nào vi phạm.

**Cổng chờ cho nhà cung cấp khác**

| Cổng | Nội dung |
|---|---|
| Hợp đồng adapter | Thêm vào `InvoiceProvider`: bảng khai khả năng (phát hành phải tuần tự hay song song được, có hỏi trạng thái theo lô không và cỡ lô, có webhook không, hủy qua API được không, tra ngược theo mã đơn được không); `checkStatuses` theo lô trả kết quả đã chuẩn hóa; `findByReference`; `readiness` (cấu hình đã đủ để phát hành chưa); `webhook.verify` + `webhook.parse` |
| Sổ đăng ký nhà cung cấp | Một chỗ khai mỗi nhà cung cấp: adapter, khả năng, công tắc cho phép phát hành riêng từng bên (thay `MISA_ALLOW_PUBLISH` dùng chung) |
| Đường webhook chung | `/api/webhooks/invoice/<nhà cung cấp>`. Địa chỉ MISA hiện có giữ lại, trỏ vào cùng chỗ |
| Worker không còn chữ "MISA" | Tự phát hành, hỏi trạng thái, điều chỉnh chỉ gọi qua adapter và đọc bảng khả năng |

Sau bước này, thêm một nhà cung cấp là: viết một tệp adapter, thêm một dòng vào sổ đăng ký, gỡ tên khỏi danh sách "sắp ra mắt". Hàng đợi và worker không phải sửa.

**Cổng riêng cho Hubtax** (anh Trung chốt 01/10: "biết đâu sau này mình cũng làm mảng hóa đơn thì sẵn nối vào"). Giữ sẵn mã nhà cung cấp `HUBTAX` ở mọi chỗ một nhà cung cấp phải có mặt:

- một dòng trong sổ đăng ký nhà cung cấp ở backend, trạng thái "giữ chỗ" (chưa có adapter, công tắc phát hành tắt);
- tên trong danh sách chặn lưu cấu hình (`COMING_SOON_PROVIDERS`), để không ai chọn được khi chưa có gì phía sau;
- địa chỉ webhook `/api/webhooks/invoice/hubtax` (trả 503 "chưa mở" cho tới khi có adapter);
- giá trị `HUBTAX` hợp lệ ở cột nguồn của `webhook_events` và cột nhà cung cấp của `InvoiceLog`.

Nguyên tắc em đặt cho cổng này: Hubtax nối vào Hubsell qua **đúng hợp đồng adapter như một nhà cung cấp bên ngoài**, không đi cửa sau vào database của Hubsell. Nhờ vậy sau này Hubtax là một sản phẩm tách riêng, bán cho cả khách không dùng Hubsell, cũng không phải sửa phía Hubsell.

Mặc định em **chưa hiện Hubtax trong danh sách nhà cung cấp ở giao diện khách** (kể cả dạng "Sắp ra mắt"), vì đó là công bố một sản phẩm chưa có. Anh muốn hiện thì chỉ là thêm một mục vào `frontend/src/lib/invoice-vendors.ts`.

Em **không** thêm trước cột cấu hình riêng cho từng nhà cung cấp. Chưa có tài liệu API của EasyInvoice hay bên nào khác, thêm cột bây giờ là đoán. Bảng cấu hình đã có 5 ô dùng chung (mã định danh, khóa bí mật, khóa API, địa chỉ tùy biến, mã đại lý); bên nào cần hơn thì thêm lúc viết adapter của bên đó.

**Nhịp phát hành: từ từ, theo hàng đợi** (anh Trung chốt 01/10: "tạo từ từ thôi, phong cách hàng đợi, không ồ ạt gây ra lỗi").

- Trong một shop: từng tờ một, xong tờ này mới tới tờ kế, nghỉ 1 giây giữa hai tờ.
- Mỗi lượt của một shop tối đa 20 tờ. Còn tồn thì nghỉ 1 phút rồi mới chạy lượt kế.
- Cả hệ thống: mỗi worker chỉ phát hành cho 2 shop cùng lúc. Lý do: khóa ứng dụng với nhà cung cấp là khóa chung của Hubsell, nhiều shop bắn cùng lúc là dồn vào một hạn mức.
- Nhà cung cấp báo bận hoặc lỗi mạng: dừng lượt của shop đó, lượt sau thử lại (không bắn lặp). Lỗi cấp tài khoản: ngắt mạch như hiện nay, chờ chủ shop sửa.
- Bấm tay hàng loạt cũng đi qua đúng làn này, không có đường tắt bắn song song.

Ba số 1 giây, 1 phút, 2 shop **em tự chọn**, đặt bằng biến môi trường. Em chưa có hạn mức gọi API của MISA hay bên nào khác bằng văn bản; có thì chỉnh theo.

**Ba con số của phần hóa đơn**

| Tham số | Hiện tại | Đề xuất | Căn cứ |
|---|---|---|---|
| Tự phát hành mỗi lượt | 20 tờ/shop, lượt kế sau 15 phút | Giữ lô 20; còn tồn thì lượt kế sau 1 phút; nghỉ 1 giây giữa hai tờ | Trần 20 là để một cấu hình sai không xả hàng trăm tờ; giữ nguyên ý đó ở cỡ lô. Kết quả: từ 1.920 lên cỡ 15.000–20.000 tờ/shop/ngày, tùy nhà cung cấp trả lời nhanh hay chậm |
| Hỏi trạng thái mỗi lượt | 200 tờ/shop, lượt kế sau 12 giờ | Giữ lô 200; còn tồn thì chạy tiếp ngay | Lệnh hỏi trạng thái chỉ đọc, không sinh chứng từ |
| Cửa sổ theo dõi | 30 ngày rồi bỏ | Theo tới khi có kết luận | Đã ghi ở mục 6.6 bản kiến trúc gốc |

Phần hóa đơn chưa thử được với tài khoản thật của khách vì chưa shop nào dùng. Em kiểm bằng MST thử của MISA trên máy local.

---

## 4. Thứ tự chuyển

Mỗi bước có công tắc bằng biến môi trường để quay về đường cũ, giữ khoảng một tuần rồi gỡ. Đường quét định kỳ (auto-sync) vẫn chạy suốt, là lưới an toàn.

| Bước | Nội dung | Đổi database | Đổi hành vi | Ước lượng |
|---|---|---|---|---|
| 0. Nền | Thêm pg-boss (ghim đúng bản 12.35.1); migration: schema `pgboss`, các hàng đợi, bảng `webhook_events`, bật RLS; module `lib/queue` (khởi động theo vai, dừng êm khi deploy); số hàng đợi trên HQ; bọc lệnh gọi sàn để **đo** thời gian | Có, em trình SQL trước khi đẩy | Không | 2–3 ngày |
| 1. Webhook Lazada | Ghi sự kiện + xếp việc rồi mới trả 200; worker xử lý | Không | Có: hết mất sự kiện khi deploy | 1–2 ngày |
| 2. Webhook TikTok | Sự kiện mới đi đường mới; worker cũ vét bảng cũ tới khi rỗng | Không | Khóa theo đơn đúng trên nhiều máy | 1–2 ngày |
| 3. Webhook Shopee | Như TikTok; đối soát tồn sang `stock.verify`; web thôi tự xử lý | Không | 1 luồng → song song; gộp sự kiện theo đơn | 2–3 ngày |
| 4. Đẩy tồn | Ghi "tồn chờ đẩy" trong giao dịch đơn; `stock.channel` theo gian | Không (bảng giữ nguyên) | Các gian đẩy song song | 3–4 ngày |
| 5. Hóa đơn | Hợp đồng adapter + sổ đăng ký nhà cung cấp; `invoice.issue`, `invoice.status`, `invoice.event`; bảng `invoice_requests`; ràng buộc một đơn một hóa đơn gốc; phát hành hàng loạt chạy nền có tiến độ | Có, trình SQL | Có: các shop phát hành song song, hết trần 1.920 tờ/ngày, hết mất việc điều chỉnh khi deploy | 4–5 ngày |
| 6. Dọn | Bật thời hạn chờ gọi sàn theo số đo; gỡ 3 bảng webhook cũ (Shopee, TikTok, MISA), mã cũ, công tắc; HQ đọc bảng mới | Có (xóa bảng cũ), trình SQL | Có: lệnh gọi sàn có thời hạn chờ | 1–2 ngày |

**Vì sao Lazada trước.** Đây là chỗ duy nhất đang thật sự mất dữ liệu. Nó không có hàng đợi cũ nên không phải vét gì. Và chỉ có 4 gian Lazada, nếu đường mới có lỗi thì phạm vi nhỏ nhất. Shopee đông nhất nên đi sau, khi đường mới đã chạy thật qua hai sàn.

**Cách biết một bước đã ổn trước khi sang bước sau:** số sự kiện nhận bằng số sự kiện xong (đếm trên `webhook_events`); hàng đợi lỗi bằng 0 hoặc mọi việc trong đó có lý do rõ; tuổi việc chờ lâu nhất dưới 1 phút; có ít nhất một lần deploy giữa giờ mà không sự kiện nào kẹt.

---

### 4.1. Bước 0 (nền) — đã làm 01/10/2026

| Việc | Tệp |
|---|---|
| Thêm `pg-boss` ghim đúng bản 12.35.1 | `backend/package.json` |
| Migration một giao dịch: schema `pgboss`, 6 hàng đợi, RLS, bảng `webhook_events` | `backend/prisma/migrations/20261001200000_queue_foundation` |
| Module hàng đợi: khởi động theo vai, gửi việc qua Prisma (chung giao dịch khi truyền `tx`), nhận việc theo lô, dừng êm, số đếm | `backend/src/lib/queue.ts`, `queue-config.ts` |
| Gắn vào lúc khởi động (mọi vai); worker nhận SIGTERM thì chờ việc đang chạy tối đa 20 giây rồi mới thoát | `backend/src/index.ts` |
| HQ Sức khỏe: dấu hiệu "Hàng đợi bền" (việc chờ, đang chạy, hàng đợi lỗi, hộp thư đến) | `backend/src/services/platform-health.ts` |
| Mọi lệnh gọi sàn trong 4 client đi qua một cửa có đo thời gian; in dòng `[SanHTTP]` mỗi 15 phút; thời hạn chờ có sẵn công tắc `PLATFORM_HTTP_TIMEOUT_MS` nhưng CHƯA bật | `backend/src/lib/platform-http.ts`, 16 chỗ gọi trong `integrations/{shopee,lazada,tiktok,tiktok-ads}/client.ts` |
| Tự kiểm module trên database tạm (tạo, áp migration qua Prisma, chạy module thật, xóa) | `backend/scripts/queue-selfcheck.ts` |

Bước này chưa có đường nào gửi hay nhận việc. Thay đổi nhìn thấy được trên prod: worker mở thêm 2 kết nối database, web thêm 0–1; HQ Sức khỏe có thêm một dòng; log có dòng `[Queue] Sẵn sàng` và `[SanHTTP]`.

Hàng đợi hỏng không làm sập ứng dụng: `startQueue` không ném, chỉ ghi `[Queue] KHÔNG khởi động được: <lý do>` và HQ Sức khỏe hiện vàng.

Hai chỗ tải tệp vận đơn (`services/fulfillment/tiktok.ts`, `lazada.ts`) chưa đi qua cửa đo: đó là tải tệp PDF, không phải gọi API, em để lại xét ở bước dọn.

### 4.2. Bước 1 (webhook Lazada) — đã làm 01/10/2026

| Việc | Tệp |
|---|---|
| Hộp thư đến: ghi `webhook_events` + xếp việc `evt.order` trong một giao dịch; ba hàm đánh dấu dòng (xong / lỗi lượt này / hỏng hẳn) | `backend/src/services/webhook-inbox.ts` |
| Worker `evt.order` (gọi handler theo sàn, đánh dấu dòng) và `evt.dead` (dòng → FAILED + cảnh báo chủ shop) | `backend/src/workers/event-queue.ts` |
| Handler Lazada + cảnh báo khi hỏng hẳn (trước đây Lazada hỏng chỉ ghi log) | `backend/src/integrations/lazada/webhook.ts` |
| Route Lazada: ghi hàng đợi rồi mới trả 200 | `backend/src/routes/webhooks.ts` |
| Đăng ký worker sau khi hàng đợi sẵn sàng | `backend/src/index.ts` |
| Dọn `webhook_events` cùng chính sách các bảng webhook cũ (xong 7 ngày, còn lại 30 ngày) | `backend/src/workers/log-cleanup.ts` |

Hành vi của route Lazada:

| Tình huống | Trả cho Lazada | Xử lý |
|---|---|---|
| Hàng đợi sẵn sàng, ghi được | 200 | Worker xử lý; deploy giữa chừng không mất |
| Sàn gửi lại y nguyên | 200 | Bỏ qua (khóa duy nhất nguồn + mã băm thân) |
| Hàng đợi sẵn sàng nhưng ghi lỗi (database sự cố) | 500 | Lazada tự gửi lại mỗi 30 phút, tối đa 12 lần |
| Hàng đợi chưa sẵn sàng, hoặc `LAZADA_WEBHOOK_MODE=inline` | 200 | Đường cũ: xử lý trong RAM của web |

Đã kiểm: test tích hợp `lazada-webhook-queue.test.ts` (6 tình huống, chạy route + hàng đợi + worker + trừ kho thật trên database dev, chỉ giả lập lệnh gọi sàn); tự kiểm `scripts/queue-selfcheck.ts` đi trọn đường hỏng đủ 3 lượt → hàng đợi lỗi → dòng FAILED (rút giãn cách xuống 1 giây trên database tạm).

Một điều học được khi tự kiểm: một tiến trình đăng ký HAI hàm xử lý cho cùng một hàng đợi thì việc rơi vào hàm nào cũng được. Mỗi hàng đợi chỉ đăng ký một lần, ở `workers/event-queue.ts`.

Dấu vết trên prod: worker hỏi việc mỗi 0,5 giây trên `evt.order` (2 vòng) và mỗi 2 giây trên `evt.dead` (2 vòng), tức khoảng 5 câu hỏi nhỏ mỗi giây kể cả khi không có việc.

### 4.3. Bước 2 (webhook TikTok) — đã làm 01/10/2026

Anh Trung chốt đi tiếp TikTok mà không chờ sự kiện Lazada thật đầu tiên.

| Việc | Tệp |
|---|---|
| Route TikTok: sự kiện đơn → `recordOrderEvent` (hàng đợi `evt.order`), sự kiện ủy quyền → `recordAuthEvent` (hàng đợi `evt.auth`) | `backend/src/routes/webhooks.ts` |
| Hộp thư đến thêm sự kiện ủy quyền: mỗi sự kiện một dòng + một việc trỏ đúng dòng | `backend/src/services/webhook-inbox.ts` |
| Tách phần lõi xử lý TikTok thành hàm dùng chung cho hàng đợi cũ và mới (`handleTiktokOrderJob`, `handleTiktokAuthJob`, `alertTiktokJobFailed`) | `backend/src/integrations/tiktok/webhook-queue.ts` |
| Worker: thêm TikTok vào bảng handler; thêm worker `evt.auth`; `evt.dead` xử lý cả việc đơn lẫn việc ủy quyền | `backend/src/workers/event-queue.ts` |
| HQ: trang nhật ký webhook TikTok nối hai nguồn (sự kiện mới ở `webhook_events`, lịch sử ở bảng cũ); số đếm theo trạng thái và số webhook/ngày cộng cả hai | `backend/src/routes/admin.ts`, `backend/src/services/platform-health.ts` |

Khác với trước:

- Khóa "không xử lý chồng một đơn" trước là một `Set` trong RAM của từng tiến trình; nay là khóa của hàng đợi, đúng trên nhiều tiến trình và lúc deploy.
- Nhiều sự kiện dồn dập của một đơn (đổi trạng thái, kiện hàng, hoàn...) gộp thành một lượt kéo đơn.
- Không còn bước "trả việc đang làm về hàng chờ lúc khởi động" với sự kiện mới.

Đường lui: `TIKTOK_WEBHOOK_MODE=legacy` (về bảng `tiktok_webhook_logs`). Hàng đợi bền chưa sẵn sàng thì route cũng tự về bảng cũ. Worker cũ của bảng `tiktok_webhook_logs` vẫn chạy tới bước dọn để vét các dòng cũ và các dòng đi đường lui.

Lúc chuyển có thể có một đơn vừa có việc ở bảng cũ vừa có việc ở hàng đợi mới, hai nơi xử lý cùng lúc. Trường hợp đó một bên gặp lỗi trùng đơn và tự thử lại; chỉ xảy ra trong vài phút quanh lúc deploy.

Đã kiểm: `tiktok-webhook-inbox.test.ts` (5 tình huống trên đường mới), `tiktok-webhook-queue.test.ts` giữ nguyên và vẫn đạt (kiểm đường cũ).

**Sự việc lúc chuyển bản (01/10/2026, 21:18) và hai chỗ sửa**

Sự kiện TikTok thật đầu tiên đi đường mới rơi đúng vào mấy phút web bản mới và worker bản cũ cùng sống. Đơn `586356987698710236` có hai sự kiện cách nhau 2 giây:

1. Sự kiện 1 tạo việc A. Worker bản CŨ nhận, chưa có hàm xử lý TikTok nên báo lỗi; A chờ thử lại.
2. Sự kiện 2 tạo việc B (A đang chờ thử lại nên chỗ "chờ" trống). Worker bản cũ lại nhận, lại lỗi. Hàng đợi gộp theo khóa chỉ có MỘT chỗ chờ thử lại cho mỗi đơn, A đang giữ, nên B bị chuyển thẳng sang hàng đợi lỗi dù mới hỏng một lượt.
3. Hàng đợi lỗi đánh dấu cả hai dòng sự kiện là hỏng.
4. 32 giây sau A thử lại, lần này worker bản MỚI nhận và xử lý xong. Đơn được ghi đúng. Nhưng hai dòng đã bị đánh dấu hỏng nên không được chuyển về "xong".

Hậu quả: dữ liệu đơn đúng; hai dòng nhật ký mang trạng thái hỏng sai; không có cảnh báo nào gửi tới chủ shop (bản cũ chưa có hàm cảnh báo TikTok). Các sự kiện sau đó chạy bình thường (10 dòng xong, trễ 0,3–0,7 giây).

Hai lỗ hổng, đều là của thiết kế, không phải riêng lần deploy này:

| Lỗ hổng | Sửa |
|---|---|
| Việc bị chuyển sang hàng đợi lỗi trong khi một việc KHÁC của cùng đơn vẫn còn lượt thử. Không cần deploy cũng xảy ra: sàn lỗi vài chục giây mà một đơn có hai sự kiện liền nhau là đủ, và khi đó chủ shop nhận cảnh báo "hỏng sau 3 lần" oan | Hàng đợi lỗi hỏi "đơn này còn việc nào đang chờ / thử lại / chạy không" (`hasLiveJob`). Còn thì chưa kết luận. Việc còn sống xong sẽ đánh dấu các dòng; nó cũng hết lượt thì chính nó sang hàng đợi lỗi và lúc đó mới báo |
| Worker bản cũ nhận việc của một sàn nó chưa biết | Không tính là lỗi: xếp lại chính việc đó, hẹn 30 giây sau, cho worker bản mới nhận |

**Quy tắc cho các bước sau (Shopee, đẩy tồn, hóa đơn):** đưa lên theo hai lần. Lần một chỉ có worker biết xử lý loại việc mới, web vẫn đi đường cũ (công tắc mặc định TẮT). Thấy worker bản mới chạy rồi mới bật công tắc ở web. Bước TikTok em đẩy cả hai trong một lần, đó là nguyên nhân trực tiếp của sự việc trên.

## 5. Rủi ro và điều em không cam kết

- **pg-boss do một người duy trì**, ra bản rất dày (35 bản nhỏ của dòng 12). Ghim đúng bản, lên bản là một việc có chủ đích kèm migration riêng. Mã nghiệp vụ đứng sau `lib/queue`.
- **Lên bản pg-boss có thể đổi schema của nó.** Vì chạy `migrate: false`, mỗi lần lên bản phải xuất SQL chuyển đổi và đưa vào migration.
- **Bảng việc bị ghi và xóa liên tục**, phụ thuộc autovacuum. pg-boss có cảnh báo khi vacuum không theo kịp; em đưa cảnh báo đó lên HQ.
- **Ở 1 triệu đơn/ngày**, `webhook_events` cần chia bảng theo ngày và xóa theo mảnh. Việc này đã nằm trong giai đoạn 4.
- **Bộ giới hạn tốc độ gọi sàn vẫn nằm trong RAM từng tiến trình** (cầu dao thì đã ở database). Việc "mỗi gian một worker" của `stock.channel` che được phần đẩy tồn, phần còn lại thuộc giai đoạn 3.

---

## 6. Việc cần anh Trung chốt

**01/10 tối:** anh Trung trả lời "Đúng rồi" cho bản trình 7 điểm, kèm hai ý: phát hành hóa đơn đi từ từ theo hàng đợi (mục 3.8, "Nhịp phát hành") và thêm cổng chờ cho Hubtax (mục 3.8). Em hiểu là cả 7 điểm dưới đây đã được duyệt. SQL của bước nền (`backend/prisma/migrations/20261001200000_queue_foundation`) trình riêng, chưa đẩy.

1. Duyệt dùng pg-boss 12.35.1 theo mô hình "bảng nghiệp vụ giữ trạng thái, pg-boss điều phối".
2. Duyệt gộp sự kiện theo đơn (mỗi sự kiện vẫn có một dòng nhật ký; số lượt kéo đơn từ sàn giảm).
3. Duyệt một bảng `webhook_events` chung cho ba sàn và cho webhook nhà cung cấp hóa đơn, thay ba bảng webhook Shopee, TikTok, MISA.
4. Duyệt thứ tự: nền → Lazada → TikTok → Shopee → đẩy tồn → hóa đơn → dọn.
5. Hai con số em tự chọn ở mục 3.6 (hạn giữ 5 phút, 4 việc cùng lúc): anh nhận làm mặc định hay muốn số khác.
6. Ba con số của phần hóa đơn ở mục 3.8 (lượt kế sau 1 phút khi còn tồn; hỏi trạng thái chạy tiếp khi còn tồn; theo tới khi có kết luận thay vì 30 ngày).
7. Nút phát hành hàng loạt đổi sang chạy nền có tiến độ (bấm xong không chờ kết quả ngay trên nút nữa).
