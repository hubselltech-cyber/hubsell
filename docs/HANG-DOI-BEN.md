# Giai đoạn 2: hàng đợi việc bền và webhook 3 sàn

Ngày lập: 01/10/2026. Người lập: Claude (Lead Dev). Trạng thái: **thiết kế anh Trung duyệt 01/10 tối; bước nền và webhook ba sàn (bước 0–3) chạy trên prod từ 01/10; bước 4 (đẩy tồn) chạy trên prod từ 02/10 (mục 4.5); bước 5 (hóa đơn): thiết kế lại ở mục 4.6, anh Trung duyệt 02/10, làm theo 14 lát nhỏ, lát 1–4 trên prod từ 02/10; bước 6 (dọn): kiểm kê ở mục 4.7, chưa tới ngày làm; việc ghi sổ làm sau ở mục 7.** Thuộc chương trình `docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md`, mục 6.2.

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
8. **Hàng đợi "gộp theo khóa" có hai điểm yếu khi việc chạy lâu** (đo tối 01/10, sau khi bước 1–3 đã lên prod): việc chờ của một khóa đang chạy chặn cả hàng đợi tới khi việc đang chạy xong; và khóa bị phần giám sát chụp đúng lúc đang chạy thì việc mới của khóa đó bị bỏ qua tới khoảng 2 phút. Đo tải 02/10 cho thấy với việc ngắn (webhook) ảnh hưởng nhỏ; với việc chạy lâu (đẩy tồn, hóa đơn) thì không dùng được. Số đo ở cuối mục 4.5.

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

> Ghi chú 01/10 tối: khi làm bước 4, gạch đầu dòng thứ ba dưới đây đổi cách thực hiện (việc đẩy không chạy bên trong việc của pg-boss). Xem mục 4.5.

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

### 4.4. Bước 3 (webhook Shopee) — đã làm 01/10/2026, đưa lên hai lần

| Lần | Bản | Nội dung |
|---|---|---|
| Một | `0e9c86d` | Worker biết xử lý việc Shopee (đơn, ủy quyền, cảnh báo khi hỏng hẳn). Web MẶC ĐỊNH vẫn đi hàng đợi cũ |
| Hai | bản kế | Đổi mặc định ở web sang hàng đợi bền, sau khi đã thấy worker bản `0e9c86d` chạy trên prod |

| Việc | Tệp |
|---|---|
| Route Shopee: sự kiện đơn (code 3, 4) → `recordOrderEvent`; sự kiện ủy quyền (code 1, 2) → `recordAuthEvent` | `backend/src/routes/webhooks.ts` |
| Mã vận đơn của push code 4 đi kèm việc; bị gộp vào việc đang chờ thì ghi đè vào việc đó, chung giao dịch | `backend/src/services/webhook-inbox.ts` |
| `handleShopeeOrderJob` làm đúng các bước của hàng đợi cũ: kéo đơn, ghi đơn + kho, xếp việc đẩy tồn, kéo phí tạm tính (best-effort) | `backend/src/integrations/shopee/webhook-queue.ts` |
| Hàng đợi cũ không còn tự chạy ở tiến trình web | cùng tệp |
| HQ: trang nhật ký + số đếm webhook Shopee nối hai nguồn như TikTok | `backend/src/routes/admin.ts` |

Khác với trước:

- Hàng đợi cũ của Shopee chạy MỘT luồng; nay sự kiện đơn của Shopee chạy song song trong `evt.order` (chung với TikTok và Lazada, 4 việc cùng lúc mỗi worker).
- Web không còn tự xử lý webhook Shopee.
- Việc đối soát tồn sau khi đẩy (`STOCK_VERIFY`) CHƯA chuyển: vẫn nằm trong bảng `shopee_webhook_logs` và do worker cũ xử lý. Em dời sang bước 4 (đẩy tồn), vì nó thuộc luồng đẩy tồn chứ không phải webhook.

Đường lui: `SHOPEE_WEBHOOK_MODE=legacy`. Hàng đợi bền chưa sẵn sàng thì route tự về bảng cũ.

Đã kiểm: `shopee-webhook-inbox.test.ts` (5 tình huống: đường lui, đơn trừ kho đúng + gửi trùng, ủy quyền shop chưa nối, sàn lỗi → hỏng hẳn + cảnh báo, mã vận đơn bị gộp vẫn tới handler mà không phải hỏi sàn).

### 4.5. Bước 4 (đẩy tồn) — đã làm, đưa lên hai lần (01/10 và 02/10/2026)

| Lần | Bản | Nội dung |
|---|---|---|
| Một | `e44c58f`, lên prod 01/10 23:57 | Worker biết xử lý tín hiệu `stock.channel` và việc `stock.verify`; mọi nơi ghi đơn / sửa kho đã lập "phiếu đẩy tồn" trong giao dịch của mình. Mặc định VẪN là đường cũ (`legacy`): chưa ai gửi tín hiệu, vòng quét cũ vẫn chạy |
| Hai | `5ec2982`, lên prod 02/10 08:50 | Đổi mặc định sang `queue`. Anh Trung gật 02/10, kèm nhận hai con số tự chọn (4 gian cùng lúc, hạn thuê 300 giây) làm mặc định; đẩy lên ban ngày, lúc có đơn về đều |

Lần một đã thấy chạy thật trên prod: 00:05:53 ngày 02/10 một đơn Shopee giữ 1 sản phẩm, 00:05:54 tồn 69 → 68 đẩy thành công (dòng chờ đẩy ghi bằng câu lệnh cả lô mới); lượt đối soát 00:08 xếp 99 dòng, vòng quét cũ xử lý hết. Worker ghi log đã nhận `stock.channel` (2 vòng × lô 2) và `stock.verify` (1 vòng × lô 1).

Lần hai trên prod, sáng 02/10:

| Giờ | Việc thấy được |
|---|---|
| 08:50:59 | Worker bản mới ghi "[Stock-queue] BẬT — đẩy tồn theo gian: tối đa 4 gian cùng lúc, lưới quét mỗi 5 giây"; không còn dòng bật vòng quét cũ |
| 08:54:14 | Đơn Shopee `261002HKCTP621` trừ 1 sản phẩm → cùng giây đó tồn SKU `LT122` đẩy lên gian Shopee thành công (352) |
| 08:55:49 | Gian TikTok của cùng SKU hỏng sau 3 lượt (lỗi 105005, app chưa có quyền sửa sản phẩm) — đúng nhịp thử lại 30 rồi 60 giây do lưới quét gọi |
| 08:57:16 | Đối soát Shopee qua `stock.verify`: sàn = Hubsell = 352, đúng 3 phút sau lượt đẩy |
| 08:59 | Đọc database: `stock_push_jobs` 0 dòng; `stock.channel` 2 việc xong, `stock.verify` 1 việc xong; không việc nào hỏng, chờ thử lại hay nằm trong `stock.dead` |

**Khác với mục 3.4 ở một điểm chính: việc đẩy KHÔNG chạy bên trong việc của pg-boss.** Lý do là một hạn chế của thư viện, đo được tối 01/10 (xem "Hai điều đo được về hàng đợi gộp theo khóa" bên dưới). Ba điều mục 3.4 hứa vẫn giữ nguyên: dòng chờ đẩy ghi chung giao dịch đơn, các gian đẩy song song, một gian không bao giờ có hai worker cùng đẩy. Không đổi database.

| Việc | Tệp |
|---|---|
| Cửa xếp việc: ghi dòng `stock_push_jobs` cả lô bằng một câu lệnh (một tham số JSON), gửi tín hiệu `stock.channel` cho từng gian; cặp `stageStockPush` (trong giao dịch) + `finishStockPush` (sau commit) | `backend/src/integrations/inventory-push.ts` |
| Bộ chạy theo gian, lưới quét, dừng êm; hàm xử lý tín hiệu | `backend/src/workers/stock-queue.ts` |
| Nhận một lô của một gian có khóa theo gian (`claimChannelBatch`); phần đẩy các dòng đã nhận dùng chung cho đường cũ và mới (`processClaimedJobs`), thêm dừng giữa lô và trả dòng dở về hàng chờ | `backend/src/integrations/stock-push-worker.ts` |
| Đối soát tồn Shopee sau khi đẩy sang `stock.verify` | `backend/src/integrations/shopee/inventory-sync.ts` |
| Ghi dòng chờ đẩy chung giao dịch đơn của ba sàn | `integrations/shopee/service.ts`, `tiktok/service.ts`, `lazada/webhook.ts`, `lazada/service.ts` |
| Ghi dòng chờ đẩy chung giao dịch sửa kho bằng tay: nhập / xuất, sửa tồn trên bảng, phiếu nhiều mã, kiểm kê, chuyển vị trí, cất hàng, sửa số tại vị trí, nhập Excel, hủy đơn, nhận hàng hoàn | `routes/inventory.ts`, `stock-locations.ts`, `products.ts`, `orders.ts` |
| Khởi động theo chế độ; worker nhận lệnh dừng thì dừng êm bộ chạy | `backend/src/index.ts`, `workers/index.ts` |

**Đường mới chạy thế nào**

```
Giao dịch ghi đơn / sửa kho:  đổi tồn + ghi dòng stock_push_jobs + gửi tín hiệu stock.channel(gian)   ← cùng commit
Worker nhận tín hiệu:         ghi tên gian vào hàng chờ trong tiến trình, trả về ngay (vài mili-giây)
Bộ chạy, mỗi lượt một gian:   khóa gian ở database → gian đang có người đẩy thì nhường
                              → nhận một lô 30 dòng tới hạn → đẩy từng dòng (giãn 0,4 giây)
                              → gian còn dòng thì quay lại cuối hàng
Lưới quét mỗi 5 giây:         gian nào có dòng tới hạn (kể cả dòng tới giờ thử lại, dòng kẹt) → gọi bộ chạy
Đẩy Shopee xong:              xếp / dời việc stock.verify của SKU đó, hẹn 3 phút
```

- **Bảng `stock_push_jobs` là nguồn sự thật.** Dòng đã ghi thì lượt đẩy chắc chắn diễn ra, vì lưới quét đọc thẳng bảng. Tín hiệu qua pg-boss chỉ để worker chạy NGAY (khoảng nửa giây) thay vì chờ lưới quét. pg-boss trục trặc thì đẩy tồn vẫn chạy, chậm nhất bằng đường cũ (5 giây).
- **Các gian chạy song song**, mặc định 4 gian cùng lúc mỗi worker. Mỗi lượt chỉ một lô rồi quay lại cuối hàng, nên gian bật lần đầu vài nghìn SKU không chiếm chỗ của gian khác.
- **Một gian không bao giờ có hai tiến trình cùng đẩy.** Việc nhận lô nằm trong một giao dịch ngắn có khóa theo gian, và chỉ nhận khi gian không còn dòng nào ở trạng thái "đang đẩy". Chính các dòng đang đẩy làm vé giữ gian, không cần cột hay bảng mới.
- **Lỗi của từng dòng** (sàn từ chối, quá nhịp) xử lý như đường cũ: dòng tự đếm lượt và hẹn giờ thử lại (3 lượt, 30 rồi 60 giây), hết lượt thì cảnh báo. Lưới quét gọi lại gian khi dòng tới giờ.
- **Deploy:** worker nhận lệnh dừng thì đẩy xong dòng đang dở, trả các dòng chưa đụng tới về hàng chờ rồi mới thoát. Worker bản mới lên, lưới quét nhặt tiếp.

**Ba điều thêm vào khi viết mã**

| Điều | Vì sao |
|---|---|
| Phần ghi trong giao dịch nằm trong savepoint | Ghi dòng chờ đẩy lỗi thì lùi về savepoint, giao dịch đơn vẫn commit, phiếu được ghi lại sau commit. Gửi tín hiệu lỗi thì dòng vẫn giữ. Việc đẩy tồn trục trặc không được chặn việc ghi đơn |
| Tín hiệu trong giao dịch bị gộp vào tín hiệu đang chờ thì gửi lại một tín hiệu sau commit | Tín hiệu đang chờ có thể được xử lý xong trước khi giao dịch kịp commit, lúc đó bộ chạy chưa thấy dòng mới. Không gửi lại thì dòng đó chờ tới lượt lưới quét (5 giây) |
| Ghi cả lô dòng bằng một câu lệnh, một tham số JSON | Trước là mỗi SKU × gian một câu ghi nối tiếp nhau (bật một gian 5.000 SKU là 5.000 câu ngay trong request). Một tham số JSON là theo bài học 30/09 về câu lệnh hàng nghìn tham số |

**Các con số**

| Tham số | Giá trị | Căn cứ |
|---|---|---|
| Số gian đẩy cùng lúc mỗi worker | 4 (`QUEUE_STOCK_CHANNEL_CONCURRENCY`) | **Em tự chọn**, lấy bằng số của `evt.order`; anh Trung nhận làm mặc định 02/10. Trước bước 4 là 1 |
| Nhịp lưới quét | 5 giây (`STOCK_SWEEP_SECONDS`) | Bằng nhịp vòng quét của đường cũ |
| Hạn thuê gian (dòng "đang đẩy" quá lâu thì coi là mồ côi) | 300 giây | **Em tự chọn**; anh Trung nhận làm mặc định 02/10. Một lô 30 dòng bình thường xong trong 1–2 phút; lệnh gọi sàn chưa có thời hạn chờ nên phải chừa. Đường cũ dùng 15 phút |
| Lô 30 dòng, giãn 0,4 giây, 3 lượt thử, 30 rồi 60 giây | giữ nguyên | Số của đường cũ |
| Đối soát Shopee: hẹn 3 phút, 3 lượt, 1 việc một lúc | giữ nguyên | Số của đường cũ. Giữ 1 việc một lúc vì mỗi việc là một lệnh đọc tồn Shopee, chưa có giãn nhịp theo shop |

**Đường lui:** đặt `STOCK_PUSH_MODE=legacy` ở CẢ web lẫn worker. Đặt lệch một bên vẫn không mất dòng: web ghi dòng theo kiểu nào thì worker (vòng quét cũ hay lưới quét mới) cũng đọc cùng một bảng.

**Lúc chuyển bản (lần hai):** worker bản lần một còn sống vài phút chạy vòng quét cũ, worker bản mới chạy bộ chạy theo gian. Bên nào nhận dòng cũng đánh dấu "đang đẩy" trước, và bộ chạy mới nhường gian đang có dòng "đang đẩy", nên không đẩy chồng. Việc đối soát đang nằm ở bảng `shopee_webhook_logs` do worker cũ của bảng đó xử lý nốt.

**Đã kiểm:** `stock-queue.test.ts`, 15 tình huống trên database dev (múi giờ phiên là Asia/Bangkok, khác prod): đẩy trọn đường; rollback mất cả dòng lẫn tín hiệu, commit có cả hai; lỗi SQL trong savepoint mà giao dịch gốc vẫn commit (cả hai savepoint); sàn từ chối đủ 3 lượt ra cảnh báo; biến động mới giữa lúc dòng chờ thử lại vẫn đẩy ngay; lưới quét nhặt dòng sót và dòng kẹt; gian đang có tiến trình khác đẩy thì nhường; bốn lượt cùng lúc xin nhận lô của một gian thì đúng một lượt được; gian đang chờ sàn trả lời không chặn gian khác; dừng êm trả dòng chưa đụng tới về hàng chờ; đơn Lazada về thì tín hiệu được gửi qua chính giao dịch đơn; tắt hẳn pg-boss vẫn đẩy được nhờ lưới quét; đối soát Shopee gộp một việc, lệch thì đẩy lại, hết lượt thì cảnh báo; đường lui. Test đường cũ (`stock-push.test.ts`, `inventory-reconcile.test.ts`) giữ nguyên và vẫn đạt.

**Chưa làm / chưa kiểm ở bước này**

- Gian thật: trên prod mới thấy đường mới chạy với Shopee (đẩy + đối soát) và TikTok (chỉ nhánh hỏng do thiếu quyền). Chưa thấy lượt đẩy nào lên gian Lazada. Test tự động thì giả lập lệnh gọi sàn của cả ba sàn (database dev có token thật nên cố ý không chạm sàn).
- Chưa thử với hai tiến trình worker thật chạy cùng lúc; phần "không đẩy chồng" mới kiểm trong một tiến trình (nhiều lượt cùng lúc + dòng "đang đẩy" giả lập).
- Hai chỗ còn ghi dòng SAU commit vì không có giao dịch bao quanh: đổi tồn an toàn / ngưỡng cảnh báo của một SKU (`routes/products.ts`), và các nút đẩy cả gian / cả shop (bật gian, Sync toàn bộ, đổi tồn an toàn mặc định). Đối soát 6 giờ cũng ghi ngoài giao dịch (nó không đổi tồn).
- Nút "Cập nhật tồn" trên thẻ cảnh báo vẫn đẩy thẳng lên Shopee trong request (`syncShopeeStockForProducts`), không qua hàng đợi. Giữ nguyên.
- Bật gian vài nghìn SKU: lượt đối soát Shopee sau đó vẫn là từng lệnh đọc một, không giãn nhịp theo shop (như đường cũ).
- Tiến trình worker chết đột ngột (không phải deploy) giữa một lô: gian đó chờ tối đa 5 phút (hạn thuê) mới được đẩy tiếp. Đường cũ: dòng kẹt 15 phút, các dòng khác vẫn chạy.
- Enqueue mới đặt lại một dòng đang ở giữa lô về "chờ" (hành vi có từ trước). Nếu mọi dòng còn lại của lô đều bị đặt lại, một tiến trình khác có thể nhận gian trong lúc tiến trình đầu chưa xong lô. Hậu quả chỉ là hai bên cùng gọi sàn cho một gian trong vài giây; số đẩy lên vẫn là số mới nhất.
- Lưới quét mỗi 5 giây đọc mọi dòng tới hạn để lấy danh sách gian. Hàng đợi dồn vài trăm nghìn dòng thì câu này nặng dần (vòng quét cũ cũng vậy). Cần chỉ mục riêng khi tới quy mô đó; chưa làm vì bước này không đổi database.

**Hai điều đo được về hàng đợi "gộp theo khóa" của pg-boss 12.35.1 (tối 01/10, database dev)**

| Bài đo | Kết quả |
|---|---|
| Khóa A có việc đang chạy 5 giây và một việc chờ cùng khóa; gửi việc cho khóa B lúc 1,3 giây | Việc của B chỉ bắt đầu lúc 5,5 giây, tức sau khi việc đang chạy của A xong. Không có lỗi nào được ghi ra |
| Khóa A có việc chạy 135 giây (qua hai lượt chụp số liệu của phần giám sát); việc đó xong lúc 136 giây; gửi việc mới cho A lúc 137 giây | Việc mới chỉ bắt đầu lúc 240 giây, chậm 103 giây |

Nguyên nhân đọc từ mã thư viện: câu lấy việc không tự kiểm "khóa này đang có việc chạy"; nó dựa vào một danh sách khóa đang chạy do phần giám sát chụp mỗi 60 giây, mỗi worker đọc lại danh sách mỗi 60 giây. Hai hệ quả:

1. Việc chờ của một khóa đang chạy, khi đứng đầu hàng, làm câu lấy việc đụng chỉ mục duy nhất; thư viện coi đó là "lượt lấy rỗng". Cả hàng đợi đứng lại tới khi việc đang chạy xong.
2. Khóa bị chụp đúng lúc đang chạy thì việc mới của khóa đó bị bỏ qua tới lượt làm mới danh sách kế tiếp, kể cả khi việc cũ đã xong.

Với đẩy tồn (một lượt kéo dài hàng chục giây) hệ quả 1 đi ngược mục tiêu "gian chậm không chặn gian khác", nên bước 4 đổi cách làm như trên: hàm xử lý của `stock.channel` chỉ dài vài mili-giây.

**Ảnh hưởng tới `evt.order` đang chạy trên prod (bước 1–3)**

Cùng loại hàng đợi nên cùng hai hệ quả, nhưng việc `evt.order` chỉ dài khoảng nửa giây nên mức độ khác hẳn đẩy tồn. Không mất sự kiện, không sai dữ liệu, chỉ trễ.

Số trên prod sau một đêm (đọc `webhook_events` lúc 09:00 ngày 02/10, từ 21:18 ngày 01/10):

| Sàn | Sự kiện xong | Hỏng / còn chờ | Trễ giữa | Trễ lớn nhất |
|---|---|---|---|---|
| Shopee | 175 | 0 | 0,5 giây | 1 giây |
| TikTok | 520 | 0 | 0,5 giây | 4 giây (một loạt khoảng 10 sự kiện cùng lúc) |
| Lazada | 0 | — | — | — |

Hai dòng TikTok trễ trên 30 giây chính là hai dòng sửa tay tối 01/10 (mục 4.3), không tính. Chưa dòng nào dính hệ quả 2.

Đo tải trên database dev ngày 02/10 (một tiến trình worker, hàm xử lý giả mất 0,5 giây như một lượt kéo đơn):

| Bài đo | Không có đơn trùng | 30% đơn có hai sự kiện sát nhau |
|---|---|---|
| 4 việc cùng lúc, khoảng 6 việc/giây (75% sức xử lý) | trễ p95 495 ms, lớn nhất 543 ms | p95 605 ms, lớn nhất 937 ms |
| 16 việc cùng lúc, khoảng 24 việc/giây | p95 484 ms, lớn nhất 526 ms | p95 606 ms, lớn nhất 805 ms |
| 16 việc cùng lúc, sàn trả lời chậm 3 giây mỗi lượt | p95 2,4 giây, lớn nhất 2,5 giây | p95 3,0 giây, lớn nhất 3,7 giây |

| Bài đo hệ quả 2 | Kết quả |
|---|---|
| 1.685 đơn, 9 đơn/giây, mỗi đơn có sự kiện thứ hai sau 10–150 giây (ngẫu nhiên), gửi liên tục 200 giây | 4 sự kiện thứ hai trễ trên 5 giây (khoảng 0,24%), trong đó 3 cái trên 30 giây, lớn nhất 58 giây; p99 vẫn 0,5 giây |

Đọc số:

- Hệ quả 1 (chặn cả hàng) dài tối đa bằng MỘT lượt gọi sàn, nên bình thường chỉ thêm vài phần mười giây. Ca xấu là lệnh gọi sàn treo: sàn treo bao lâu thì cả hàng đứng bấy lâu, tới khi danh sách khóa đang chạy được làm mới (tối đa khoảng 2 phút). Thuốc là thời hạn chờ gọi sàn (mục 3.6, chờ số đo).
- Hệ quả 2 chỉ đụng sự kiện THỨ HAI trở đi của một đơn; sự kiện đầu của đơn mới không bao giờ dính. Tỷ lệ gần như không đổi theo lưu lượng: thêm lưu lượng thì thêm luồng xử lý, số khóa bị chụp mỗi phút tăng cùng nhịp (suy từ cơ chế, mới đo ở một mức tải). Với TikTok, kho trừ ở sự kiện "đã thanh toán" (thường là sự kiện thứ hai), nên đơn dính thì tồn lên các sàn khác trễ khoảng một phút.
- Bài đo mới chạy một worker với hàm xử lý giả; chưa thử nhiều worker cùng lúc.

**Anh Trung chốt 02/10:** chưa làm lại phần webhook. Bật thời hạn chờ gọi sàn theo lịch; bước hóa đơn không dùng loại hàng đợi này cho việc chạy lâu; đo lại trên prod khi có vài nghìn sự kiện. Các việc này ghi ở mục 7.

### 4.6. Bước 5 (hóa đơn) — khảo sát 02/10/2026 và thiết kế lại phần hàng đợi

**Trạng thái: anh Trung duyệt 02/10 ("trước mắt làm như em đề xuất", tách nhỏ nhất có thể, giữ cổng chờ cho nhà cung cấp khác). Làm theo 14 lát ở mục F; lát 1, 2, 3, 4 đã trên prod ngày 02/10 (`5d7c560`); lát 5 trên prod từ 02/10 23:22 (`c73fe59`, mục K); lát 6 tách thành 6a và 6b (anh Trung duyệt 02/10 đêm): 6a trên prod từ 03/10 00:09 (`ca31b33`, mục L); 6b trên prod từ 03/10 00:26 (`6d90bfa`, mục M); 6c (bổ sung theo trả lời ticket MISA 02/10, mục N) trên prod từ 03/10 08:41 (`6ae0653`); lát 7 trên prod từ 03/10 09:33 (`a4bfecb`, mục O); lát 8 trên prod từ 03/10 10:19 (`4e9ab1b`, mục P); việc kế là lát 9.** Phần hợp đồng adapter, sổ đăng ký nhà cung cấp, cổng Hubtax, nhịp phát hành ở mục 3.8 giữ nguyên; mục này thay phần "ba hàng đợi" của 3.8 và bổ sung những điều tìm thêm khi đọc mã.

**Đã kiểm và chưa kiểm**

- Đã đọc mã hôm nay: `workers/invoice-auto-issue.ts`, `invoice-status-sync.ts`, `integrations/invoice/` (`issue-order`, `adjust-order`, `misa-provider`, `misa-einvoice`, `misa-webhook-queue`, `misa-webhook-service`, `auto-issue-policy`, `cqt-status`, `types`, `index`), `routes/tax.ts`, ba tệp `returns-sync.ts`, `components/settings/invoice-issue-card.tsx`.
- Database prod: lúc khảo sát (trưa 02/10) chưa đọc được vì công cụ chặn em mở Render Shell; chiều 02/10 đã đọc qua Supabase SQL Editor, kết quả ở cuối mục C (0 shop có cấu hình hóa đơn, bảng nhật ký hóa đơn 2 dòng thử cũ). Bảng `misa_webhook_logs` chưa đếm lại, vẫn là số 01/10 (0 dòng).
- `MISA_ALLOW_PUBLISH` trên prod: theo ghi chép 24/08 đã đặt `1`; hôm nay chưa kiểm lại.
- Hành vi của MISA (mã tham chiếu, tra ngược theo mã đơn): lúc khảo sát dựa vào kết quả thử sandbox các ngày 24/08 và 19/09; chiều 02/10 đã thử lại và thử thêm, kết quả ở mục I.

**A. Điều tìm thêm khi đọc mã (ngoài bảng hiện trạng ở mục 3.8)**

| # | Điều | Chỗ trong mã | Hậu quả | Xử lý ở bước 5 |
|---|---|---|---|---|
| 1 | Lệnh gọi MISA không đặt thời hạn chờ, và vòng tự phát hành dùng MỘT cờ `running` cho mọi shop | `misa-einvoice.ts` (3 chỗ `fetch`), `misa-auth.ts`, `invoice-auto-issue.ts` | Một lệnh treo là tự phát hành của MỌI shop đứng lại tới khi lệnh đó hỏng. Vòng hỏi trạng thái cũng vậy | Mỗi shop một làn riêng; lệnh gọi nhà cung cấp đi qua một cửa có đo thời gian và có thời hạn chờ |
| 2 | Hóa đơn điều chỉnh lấy mã tham chiếu MỚI cho mỗi lượt, kể cả khi lượt trước hỏng (`-DC1`, `-DC2`...) | `adjust-order.ts`, chỗ đếm `priorAttempts` | Lượt đầu đứt mạng sau khi MISA đã lập xong thì lượt hai lập thêm một tờ điều chỉnh nữa cho cùng hóa đơn gốc: giảm doanh thu hai lần. Hóa đơn gốc không dính vì mã tham chiếu luôn là mã đơn, MISA chặn trùng và `recoverDuplicate` nối lại | Lưu mã tham chiếu đã gửi vào dòng nhật ký. Lượt hỏng hoặc chưa rõ kết quả dùng LẠI đúng mã đó; chỉ sang mã mới khi tờ trước đã lập thật (đã phát hành hoặc đã bị xóa bên nhà cung cấp). Đã thử sandbox 02/10: MISA nhận lại mã của lượt bị từ chối (mục I) |
| 3 | Tự điều chỉnh chỉ được gọi ĐÚNG MỘT LẦN, lúc trạng thái hoàn của sàn chuyển vào nhóm "đã chốt" | ba tệp `returns-sync.ts` của Shopee, TikTok, Lazada | Lúc đó sàn chưa báo số tiền hoàn, MISA lỗi, hoặc worker đang deploy thì không bao giờ được thử lại. Còn một lưới: nhãn "Cần điều chỉnh" ở trang Lịch sử | Ghi một dòng yêu cầu ngay trong lượt cập nhật đơn; làn của shop thử lại tới khi có kết luận |
| 4 | Dòng nhật ký kẹt ở "đang chờ" làm đơn biến mất khỏi Hàng chờ xuất hóa đơn | `routes/tax.ts`, điều kiện của `/invoice-queue` | Chủ shop không còn thấy đơn đó ở đâu để xuất lại | Làn của shop tra lại dòng chưa rõ kết quả (mục B) |
| 5 | Chống điều chỉnh trùng cũng là "kiểm rồi mới ghi" | `adjust-order.ts`, chỗ tìm `existing` | Hai luồng cùng lúc đều lọt | Thêm ràng buộc thứ hai: một hóa đơn gốc chỉ có một tờ điều chỉnh đang chờ hoặc đã phát hành |
| 6 | Cờ `running` chỉ đúng trong một tiến trình | hai worker hóa đơn | Lúc deploy (bản cũ và mới cùng sống) hoặc khi có hai worker, một shop bị hai tiến trình cùng phát hành; MISA cấp số liên tục nên một bên bị từ chối | Khóa theo shop ở database (hạn thuê) |
| 7 | Bỏ cửa sổ 30 ngày của vòng hỏi trạng thái (đã chốt ở mục 3.8) thì câu chọn "tờ nào cần hỏi" phải đọc cả lịch sử hóa đơn của shop | `invoice-status-sync.ts` | Shop lớn: mỗi lượt quét lại mọi tờ đã có kết luận | Thêm cột "giờ hỏi kế tiếp" (trống = đã có kết luận) và chỉ mục chỉ chứa tờ còn phải hỏi |
| 8 | Câu tìm đơn đủ điều kiện tự xuất sắp theo ngày tạo đơn rồi lọc "chưa có hóa đơn" | `invoice-auto-issue.ts` | Shop lớn: mỗi lượt đi lại qua mọi đơn đã giao kể từ ngày bật. Lượt chạy dày hơn (1 phút khi còn tồn) thì nặng hơn | Bước 5 đổi sang sắp theo ngày giao, đi theo chỉ mục `(channelId, deliveredAt)` có sẵn. Mốc "đã xét tới ngày nào" cho từng shop: ghi sổ làm sau, chưa làm |
| 9 | Đơn lỗi vĩnh viễn (ví dụ mã số thuế người mua sai) được tự thử lại mỗi ngày, không có điểm dừng, mỗi ngày thêm một dòng lỗi | `invoice-auto-issue.ts`, cửa sổ 24 giờ | Rác tăng dần theo ngày | KHÔNG đổi ở bước 5. Ghi sổ, cần anh chốt số lượt |
| 10 | Đường webhook MISA tìm đơn theo mã đơn mà không kèm chủ shop, và chưa từng nhận sự kiện thật (meInvoice không có webhook) | `misa-webhook-service.ts` | Chưa gây hại vì không có lưu lượng | Khi chuyển sang đường nhận chung thì tìm theo mã giao dịch trước, mã đơn phải kèm chủ shop |

Điểm 1 cần nói rõ mức độ: "không đặt thời hạn chờ" không phải là treo vô hạn. Em đo trên máy local ngày 02/10 (Node 24.16; Render chạy 24.21): máy chủ nhận kết nối rồi im lặng thì `fetch` tự hỏng sau 303 giây (lỗi `HeadersTimeoutError`, mức mặc định 300 giây của thư viện). Vậy một lệnh MISA treo làm tự phát hành của mọi shop đứng khoảng 5 phút cho mỗi lệnh treo, không phải mãi mãi. Chưa đo trường hợp máy chủ trả lời nhỏ giọt từng chút.

**B. Phần hàng đợi: theo khuôn đẩy tồn, không chạy việc dài trong pg-boss**

```
Bấm tay (một đơn, hàng loạt, điều chỉnh)   →  MỘT giao dịch: ghi dòng invoice_requests + gửi tín hiệu invoice.issue(shop)  →  trả lời ngay
Sàn chốt hoàn (returns-sync, shop bật tự điều chỉnh)  →  ghi dòng invoice_requests chung lượt cập nhật đơn
Worker nhận tín hiệu                        →  ghi tên shop vào hàng chờ trong tiến trình, trả về ngay (vài mili-giây)
Lưới quét                                   →  shop có yêu cầu tới hạn (mỗi 5 giây); shop bật tự phát hành (mỗi 15 phút); shop có tờ tới giờ hỏi trạng thái (mỗi 12 giờ)
Làn của một shop, mỗi lượt:                 →  thuê làn ở database (shop đang có tiến trình khác giữ thì nhường)
                                               1. tra lại các tờ "chưa rõ kết quả" của shop
                                               2. yêu cầu bấm tay và điều chỉnh, cũ trước
                                               3. đơn đủ điều kiện tự phát hành
                                               từng tờ một, nghỉ 1 giây, tối đa 20 tờ; còn tồn thì 1 phút sau chạy lượt kế
```

- **Nguồn sự thật là bảng**, như đẩy tồn: yêu cầu bấm tay và điều chỉnh nằm ở `invoice_requests`; đơn tự phát hành thì chính trạng thái đơn là nguồn (không ghi dòng yêu cầu, tránh mỗi hóa đơn thêm một dòng nữa). pg-boss chỉ chở tín hiệu để worker chạy ngay sau khi chủ shop bấm; pg-boss trục trặc thì lưới quét vẫn nhặt, chậm nhất 5 giây.
- **Một shop không bao giờ có hai tiến trình cùng phát hành.** Bảng nhỏ `invoice_lanes` giữ "ai đang thuê làn của shop này, tới mấy giờ". Thuê bằng một câu lệnh có điều kiện; tiến trình đang chạy gia hạn theo nhịp; tiến trình chết thì hết hạn là tiến trình khác nhận. Trước MỖI tờ, tiến trình kiểm lại làn còn là của mình; mất làn thì dừng ngay, không gọi nhà cung cấp.
- **Chống trùng nằm ở database**: dòng nhật ký "đang chờ" chính là vé của đơn đó (hai chỉ mục duy nhất ở mục C). Luồng thứ hai ghi vào bị database từ chối, trả "đơn này đang có yêu cầu phát hành".
- **Tờ "chưa rõ kết quả"** (đứt mạng, quá thời hạn chờ, máy chủ nhà cung cấp lỗi 5xx, tiến trình chết giữa lúc gọi): giữ ở "đang chờ" kèm mã tham chiếu đã gửi, KHÔNG đánh hỏng ngay. Lượt kế của shop tra ngược theo mã tham chiếu (`findByReference`; MISA đã có sẵn cách tra theo mã đơn): thấy tờ đã lập thì nối số hóa đơn vào; không thấy thì đánh hỏng loại "tạm thời" để được thử lại. Nhà cung cấp không tra ngược được (khai trong bảng khả năng) thì đánh hỏng kèm lời nhắn kiểm bên nhà cung cấp trước khi xuất lại.
- **Mọi lệnh bấm tay đi qua làn**, kể cả xuất một đơn và điều chỉnh một tờ, không có đường gọi nhà cung cấp ngay trong request. Lý do: xuất tay chen ngang lúc làn đang chạy là hai luồng cùng xin số trên một ký hiệu. Tín hiệu tới worker khoảng nửa giây nên xuất một đơn vẫn có kết quả sau vài giây.
- **Hỏi trạng thái** chạy trong cùng làn (không chồng với phát hành của shop đó), gọi qua adapter, mỗi lượt 200 tờ, còn tồn thì chạy tiếp. Áp kết quả bằng một hàm dùng chung với đường webhook.
- **Webhook nhà cung cấp** (`invoice.event`): việc chỉ ghi database, dài vài mili-giây, nên để trong pg-boss được. Đi qua `webhook_events` như webhook sàn; việc hỏng hết lượt rơi về `evt.dead` có sẵn (không thêm hàng đợi lỗi mới). Hiện không nhà cung cấp nào có webhook, nên phần này chỉ kiểm được bằng test.
- **Số hàng đợi pg-boss thêm mới: 2** (`invoice.issue` làm tín hiệu, `invoice.event`). Không có `invoice.status`: lưới quét và làn đã đủ.

**C. Đổi database (bản nháp lúc trình; khi làm tách thành các migration nhỏ theo lát)**

Trạng thái: phần `providerRef` + hai chỉ mục duy nhất (đoạn 1 và 2 dưới đây, trừ cột `cqtNextCheckAt` và chỉ mục của nó) ĐÃ ÁP lên prod 02/10 trong migration `20261002150000_invoice_provider_ref` (lát 2). Phần còn lại chưa áp: `cqtNextCheckAt` (lát 12), `invoice_requests` + hàng đợi tín hiệu (lát 9), `invoice_lanes` (lát 8), hàng đợi `invoice.event` (lát 13).

```sql
-- 1. Nhật ký hóa đơn: mã tham chiếu đã gửi nhà cung cấp + giờ hỏi trạng thái kế tiếp
ALTER TABLE "InvoiceLog" ADD COLUMN "providerRef" TEXT, ADD COLUMN "cqtNextCheckAt" TIMESTAMP(3);

UPDATE "InvoiceLog" SET "providerRef" = "orderCode" WHERE "adjustmentForLogId" IS NULL;
UPDATE "InvoiceLog" l SET "providerRef" = l."orderCode" || '-DC' || r.rn
FROM (SELECT id, row_number() OVER (PARTITION BY "adjustmentForLogId" ORDER BY "createdAt", id) AS rn
      FROM "InvoiceLog" WHERE "adjustmentForLogId" IS NOT NULL) r
WHERE r.id = l.id;

UPDATE "InvoiceLog" SET "cqtNextCheckAt" = CURRENT_TIMESTAMP
WHERE "transactionId" IS NOT NULL AND "status" IN ('PENDING', 'ISSUED')
  AND NOT ("cqtStatus" = 'ACCEPTED' AND "createdAt" < CURRENT_TIMESTAMP - INTERVAL '7 days');

-- 2. Chống trùng ở database
CREATE UNIQUE INDEX "InvoiceLog_open_original_key" ON "InvoiceLog" ("ownerId", "orderCode")
  WHERE "adjustmentForLogId" IS NULL AND "status" IN ('PENDING', 'ISSUED');
CREATE UNIQUE INDEX "InvoiceLog_open_adjustment_key" ON "InvoiceLog" ("adjustmentForLogId")
  WHERE "adjustmentForLogId" IS NOT NULL AND "status" IN ('PENDING', 'ISSUED');
CREATE INDEX "InvoiceLog_cqt_due_idx" ON "InvoiceLog" ("ownerId", "cqtNextCheckAt")
  WHERE "cqtNextCheckAt" IS NOT NULL;

-- 3. Yêu cầu bấm tay / điều chỉnh tự động
CREATE TABLE "invoice_requests" (
  "id"            TEXT PRIMARY KEY,
  "ownerId"       TEXT NOT NULL,
  "kind"          TEXT NOT NULL,                 -- ISSUE | ADJUST
  "source"        TEXT NOT NULL,                 -- MANUAL | AUTO_RETURN
  "targetKey"     TEXT NOT NULL,                 -- ISSUE: mã đơn; ADJUST: mã dòng nhật ký của hóa đơn gốc
  "params"        JSONB,                         -- phạm vi + lý do điều chỉnh
  "batchId"       TEXT,                          -- một lần bấm = một lô, để hiện tiến độ
  "requestedById" TEXT,
  "status"        TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | RUNNING | DONE | FAILED
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resultLogId"   TEXT,
  "errorCode"     TEXT,
  "error"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"    TIMESTAMP(3)
);
CREATE UNIQUE INDEX "invoice_requests_open_key" ON "invoice_requests" ("ownerId", "kind", "targetKey")
  WHERE "status" IN ('PENDING', 'RUNNING');
CREATE INDEX "invoice_requests_due_idx" ON "invoice_requests" ("ownerId", "nextRetryAt") WHERE "status" = 'PENDING';
CREATE INDEX "invoice_requests_batch_idx" ON "invoice_requests" ("ownerId", "batchId");
ALTER TABLE "invoice_requests" ENABLE ROW LEVEL SECURITY;

-- 4. Làn theo shop (ai đang giữ, tới mấy giờ)
CREATE TABLE "invoice_lanes" (
  "ownerId"    TEXT PRIMARY KEY,
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "invoice_lanes" ENABLE ROW LEVEL SECURITY;

-- 5. Hai hàng đợi pg-boss (dùng bảng chung, không sinh bảng mới)
SELECT pgboss.create_queue('invoice.issue', '{"policy":"stately","retryLimit":2,"retryDelay":30,"retryBackoff":true,"expireInSeconds":300}'::jsonb);
SELECT pgboss.create_queue('invoice.event', '{"policy":"standard","retryLimit":2,"retryDelay":30,"retryBackoff":true,"expireInSeconds":300,"deadLetter":"evt.dead"}'::jsonb);
```

Ghi chú về bản nháp:

- Hai bảng mới cố ý KHÔNG có khóa ngoại sang bảng người dùng hay bảng đơn, để migration không phải lấy khóa trên bảng đang được ghi liên tục (bài học 30/09). Dọn dòng mồ côi do tác vụ dọn nhật ký lo.
- Migration chỉ đụng một bảng có sẵn là `InvoiceLog`, bảng này chỉ worker hóa đơn ghi.
- Hai chỉ mục duy nhất sẽ làm migration HỎNG nếu prod đang có dòng vi phạm, mà migration hỏng trên Render là mọi lượt deploy sau đứng lại tới khi gỡ tay. Nên bắt buộc chạy câu đọc dưới đây trước, ra 0 ở hai dòng đầu mới được đẩy.

Câu đọc cần chạy trên prod (chỉ đọc):

```sql
SELECT 'hoa_don_goc_trung' AS viec, count(*) FROM (SELECT 1 FROM "InvoiceLog" WHERE "adjustmentForLogId" IS NULL AND "status" IN ('PENDING','ISSUED') GROUP BY "ownerId", "orderCode" HAVING count(*) > 1) t
UNION ALL SELECT 'dieu_chinh_trung', count(*) FROM (SELECT 1 FROM "InvoiceLog" WHERE "adjustmentForLogId" IS NOT NULL AND "status" IN ('PENDING','ISSUED') GROUP BY "adjustmentForLogId" HAVING count(*) > 1) t
UNION ALL SELECT 'dang_cho_khong_ma_giao_dich', count(*) FROM "InvoiceLog" WHERE "status" = 'PENDING' AND "transactionId" IS NULL
UNION ALL SELECT 'tong_dong_nhat_ky', count(*) FROM "InvoiceLog"
UNION ALL SELECT 'shop_co_cau_hinh', count(*) FROM "InvoiceConfig" WHERE "channelId" IS NULL
UNION ALL SELECT 'shop_bat_tu_phat_hanh', count(*) FROM "InvoiceConfig" WHERE "channelId" IS NULL AND "autoIssueEnabled";
```

Kết quả chạy câu đọc trên prod ngày 02/10/2026 khoảng 14:50 (anh Trung bảo chạy; chạy ở Supabase SQL Editor, chỉ đọc):

| Việc đếm | Kết quả |
|---|---|
| Hóa đơn gốc trùng | 0 |
| Điều chỉnh trùng | 0 |
| Dòng "đang chờ" không có mã giao dịch | 0 |
| Tổng dòng nhật ký hóa đơn | 2 |
| Shop có cấu hình hóa đơn | 0 |
| Shop bật tự phát hành | 0 |

Hai dòng nhật ký đều tạo ngày 28/07/2026 (thời còn thử bằng webhook giả lập, trước khi nối API thật 23/08): một dòng ISSUED, một dòng FAILED vì lệch thuế; cả hai là hóa đơn gốc của MISA, có mã tra cứu, chưa từng được hỏi trạng thái. Migration lát 2 sẽ gán cho hai dòng này mã tham chiếu = mã đơn; không ảnh hưởng gì khác.

Database dev (892 dòng nhật ký) cũng 0 dòng trùng; migration lát 2 áp lên dev ngày 02/10 chạy sạch, 892/892 dòng được gán mã tham chiếu.

Một hệ quả của hai chỉ mục duy nhất cần biết: đường webhook MISA (chưa từng có sự kiện thật) có thể đẩy một dòng HỎNG về "đã phát hành" hoặc tạo dòng mới cho đơn đã có hóa đơn; nay database từ chối, sự kiện đó sẽ báo lỗi và nằm ở nhật ký webhook cho người xem, thay vì âm thầm tạo hai hóa đơn "đã phát hành" cho một đơn.

**D. Các con số**

| Tham số | Giá trị | Căn cứ |
|---|---|---|
| Nghỉ giữa hai tờ, cỡ lô, nghỉ giữa hai lượt, số shop cùng lúc mỗi worker | 1 giây, 20 tờ, 1 phút, 2 shop | Đã chốt 01/10 (mục 3.8). **Nghỉ 1 giây từ 03/10 có căn cứ của MISA** (trả lời ticket 02/10: "mỗi request nên cách nhau 1-3s", lấy mức thấp nhất; khai ở bảng khả năng `publishGapMs`, lát 6c mục N). Ba số sau vẫn là em tự chọn |
| Hạn mức gọi API của MISA | Chưa có số | MISA (ticket 02/10): hạn mức "hiện đang tắt, sẽ bật lại sớm", tài liệu sẽ ghi số theo từng API. Lát 6c coi HTTP 429 là lỗi tạm và in `[NccHTTP] QUA TAI` để thấy số thật khi MISA bật |
| Thời hạn chờ một lệnh gọi nhà cung cấp hóa đơn | 60 giây (`INVOICE_HTTP_TIMEOUT_MS`), tính cho cả lượt trao đổi: gửi, chờ tiêu đề, đọc thân | **Em tự chọn.** Chưa có số đo nào về MISA trên prod (chưa shop nào phát hành); sandbox phát hành mất 0,35–0,6 giây. Cửa gọi ghi thời gian từng lệnh ở dòng `[NccHTTP]`; có số thật thì chỉnh |
| Hạn thuê làn | 120 giây, gia hạn mỗi 30 giây | **Em tự chọn.** Ý nghĩa: worker chết đột ngột thì shop đó chờ tối đa 2 phút |
| Tuổi tối thiểu của tờ "chưa rõ kết quả" trước khi tra lại | 5 phút | **Em tự chọn**, lớn hơn tổng thời gian dài nhất của một lượt gọi (gọi, thử lại một lần, tra ngược) |
| Yêu cầu bấm tay gặp lỗi tạm thời | 3 lượt, cách 1 phút | Số lượt lấy bằng các hàng đợi khác; lỗi cấp tài khoản thì đánh hỏng cả lô ngay với cùng lý do, không đốt từng tờ |
| Điều chỉnh tự động khi sàn chưa báo số tiền hoàn | thử lại mỗi 60 phút, tối đa 7 ngày | **Em tự chọn.** Hiện nay là không thử lại lần nào. Hết 7 ngày thì đánh hỏng, nhãn "Cần điều chỉnh" vẫn còn cho chủ shop làm tay |
| Hỏi trạng thái tờ chưa có kết luận quá 30 ngày | 24 giờ một lần, không có điểm dừng | **Em tự chọn.** Thay cho "bỏ hẳn sau 30 ngày". Tờ dưới 30 ngày giữ nhịp như hiện nay |
| Giữ dòng `invoice_requests` | xong 7 ngày, còn lại 30 ngày | Bằng chính sách dọn nhật ký kỹ thuật |

Giới hạn đã biết: 2 shop cùng lúc mỗi worker, mỗi lượt khoảng 20 tờ trong 40–60 giây, tức một worker phục vụ cỡ 2–3 lượt shop mỗi phút. Vài trăm shop cùng có tồn thì phải tăng số này hoặc thêm worker, mà tăng tới đâu tùy hạn mức gọi API của nhà cung cấp (chưa có bằng văn bản).

**E. Giao diện (đổi nhỏ, làm cùng lát 3)**

- Nút "Xuất hóa đơn" (một đơn, hàng loạt) và nút "Điều chỉnh": bấm xong hiện tiến độ ngay tại chỗ ("Đang xuất 3/20"), xong thì ra đúng thông báo kết quả như hiện nay. Rời trang thì việc vẫn chạy; quay lại vẫn thấy tiến độ. Vẫn một nút, không thêm bước.
- Bỏ trần 50 đơn mỗi lần gọi (giao diện đang tự chia lô 50 và gọi nối tiếp).
- Giao diện lên Vercel riêng với backend, nên backend báo cờ "đường mới đã bật" trong `/invoice-queue`; giao diện bản mới đọc cờ đó để chọn gọi đường nào. Đẩy giao diện lúc nào cũng được.
- HQ Sức khỏe thêm dấu hiệu "Hóa đơn": số yêu cầu chờ, yêu cầu chờ lâu nhất, số shop đang ngắt mạch.

**F. Thứ tự làm và đưa lên — chia nhỏ nhất có thể (anh Trung 02/10: "không cần nhanh, cần chuẩn nhất cho seller")**

Luật của mọi lát: một lát chỉ làm MỘT việc; có test riêng; commit riêng; đẩy riêng; xem prod rồi mới sang lát kế. Lát nào đổi database thì trình tệp migration trước và mỗi migration chỉ mang đúng thứ lát đó cần. Thứ tự xếp sao cho không lát nào làm rủi ro TĂNG lên trong lúc chờ lát sau (ví dụ: sửa luật mã tham chiếu của điều chỉnh phải lên TRƯỚC khi đặt thời hạn chờ, vì thời hạn chờ ngắn hơn làm ca "chưa rõ kết quả" xảy ra nhiều hơn).

| Lát | Nội dung | Đổi database | Đổi hành vi | Trạng thái |
|---|---|---|---|---|
| 1 | Hợp đồng chung cho mọi nhà cung cấp: bảng khả năng, tra ngược theo mã tham chiếu, sổ đăng ký nhà cung cấp (giữ chỗ Hubtax), công tắc phát hành riêng từng bên | Không | Không | ✅ Trên prod từ 02/10 14:28 (`84455f2`): worker và web lên bình thường, hàng đợi sẵn sàng, không dòng lỗi |
| 2 | Lưu mã tham chiếu đã gửi; database từ chối hóa đơn gốc trùng và điều chỉnh trùng | Có (1 cột, 2 chỉ mục duy nhất): `prisma/migrations/20261002150000_invoice_provider_ref` | Chỉ ở ca hai luồng cùng lúc: luồng ghi sau nhận "đang có yêu cầu phát hành" TRƯỚC khi gọi nhà cung cấp | ✅ Trên prod từ 02/10 14:59 (`6d03c9d`, anh Trung duyệt migration: "đẩy lát 2 đi, làm cẩn thận"). Trước khi đẩy: chạy nguyên tệp migration một khối trên dev trong giao dịch rồi hoàn tác (28 ms, 892 dòng), đếm lại prod (0 trùng, không migration dở). Sau khi đẩy, đọc prod: migration xong 14:59:54, có cột `providerRef`, đủ hai chỉ mục, hai dòng cũ đã mang mã tham chiếu = mã đơn, 0 migration hỏng; web báo "No pending migrations", worker và web chạy bình thường |
| 3 | Hai bước kiểm trước khi lập điều chỉnh (`integrations/invoice/adjust-precheck.ts`). (a) Hóa đơn gốc còn hiệu lực bên nhà cung cấp: đã xóa / không thấy / lệch số / chưa phát hành xong thì CHẶN HẲN, kèm lý do và việc nên làm cho chủ shop (anh Trung chốt 02/10); không tra được thì dừng, báo thử lại. (b) Tra lại mọi mã tham chiếu của các lượt hỏng trước: thấy tờ đã lập thì NỐI LẠI số hóa đơn vào đúng dòng của lượt đó, không lập thêm; lượt mới dùng LẠI mã của lượt hỏng gần nhất, chỉ sang số mới khi tờ trước đã lập thật. Giao diện: trang Lịch sử hiện hộp "Chưa lập hóa đơn điều chỉnh" với Lý do + Việc nên làm, ở lại tới khi bấm | Không | Hết ca điều chỉnh hai lần; thêm ca chặn. Nhà cung cấp không tra ngược được thì giữ cách cũ tới lát 5–6 | ✅ Trên prod từ 02/10 15:30 (`5d7c560`): worker 15:30, web 15:31 (không còn migration chờ, hàng đợi sẵn sàng, không lỗi mới), giao diện trên app.hubsell.tech đã có hộp chặn. Prod chưa shop nào dùng hóa đơn nên chưa có lượt điều chỉnh thật nào đi qua. Đã kiểm trước khi đẩy: test `invoice-adjust-precheck.test.ts` 21 ca (adapter giả + database dev); gọi thật sandbox MISA (chỉ tra, không lập): hóa đơn gốc đúng số cho qua, lệch số / không thấy bị chặn, lượt trước đã lập được nhận ra để nối lại; hộp chặn soi trên trình duyệt local ở 320 / 375 / 667×375 / 768 / 1366 / 1920 và giao diện tối. Không tra được vì tài khoản nhà cung cấp của shop sai thì hộp chỉ chỗ sửa kết nối, không bảo "thử lại sau" |
| 4 | Cửa gọi nhà cung cấp: chỉ ĐO thời gian từng lệnh (`integrations/invoice/provider-http.ts`; bốn lệnh MISA của luồng hóa đơn đầu ra: lấy token, phát hành, hỏi trạng thái / tải tệp, lấy ký hiệu). Mỗi 15 phút in dòng `[NccHTTP] MISA <loại lệnh> ...` | Không | Không | ✅ Trên prod từ 02/10 14:38 (`6d8bc4d`): worker và web lên bình thường. Prod chưa shop nào dùng hóa đơn nên chưa có dòng `[NccHTTP]` nào; dòng đầu tiên sẽ có khi có shop phát hành. Làm trước lát 2 và 3 vì không phụ thuộc và không đổi hành vi. Chưa đi qua cửa: eSign, máy tính tiền, hóa đơn đầu vào (không nằm trong luồng phát hành hiện nay) |
| 5 | Adapter báo rõ "chưa rõ kết quả" (`InvoiceResult.outcomeUnknown`); nhà cung cấp trả lời thành công mà không kèm số lẫn mã tra cứu thì không còn ghi là đã phát hành. Chi tiết ở mục K | Không | Chỉ ở ca lỗi: dòng nhật ký vẫn ghi "hỏng" nhưng câu báo nói rõ là chưa rõ đã lập hay chưa và bảo làm lại thao tác; ca "thành công không có số" từ "đã phát hành" thành "hỏng, chưa rõ" | ✅ Trên prod từ 02/10 23:22 (`c73fe59`): web đổi bản 23:22:21, không migration; 23:26 các gian vẫn đồng bộ bình thường sau khi worker lên lại. Prod chưa shop nào phát hành nên chưa có lượt thật. Test `invoice-outcome-unknown.test.ts` 31 ca + 1 ca database trong `invoice-duplicate-guard.test.ts`; đã thử sandbox MISA (mục K) |
| 6a | Thời hạn chờ cho mọi lệnh đi qua cửa gọi nhà cung cấp (`INVOICE_HTTP_TIMEOUT_MS`, mặc định 60 giây, `0` = tắt). Quá hạn ở lệnh phát hành = chưa rõ kết quả; quá hạn ở bước lấy token = chưa gửi. Chi tiết ở mục L | Không | Lệnh treo bị cắt sau 60 giây thay vì khoảng 300 giây | ✅ Trên prod từ 03/10 00:09 (`ca31b33`): web đổi bản 00:09:39, không migration, 00:11 các gian vẫn đồng bộ, 0 gian lỗi liên tiếp. Tách khỏi 6b và làm TRƯỚC vì 6b cần biết một lệnh đang chạy kéo dài tối đa bao lâu |
| 6b | Tờ chưa rõ kết quả giữ "đang chờ"; vòng quét trong worker tra lại theo bảng khả năng (thấy tờ → nối số; đã xóa → đã hủy; không thấy → hỏng, đơn quay lại hàng chờ; không tra được → giữ, thử lại sau). Dọn luôn dòng "đang chờ" mồ côi do tiến trình chết | Có: MỘT chỉ mục riêng phần trên `InvoiceLog` cho dòng "đang chờ" chưa có mã tra cứu (bảng lát cũ ghi "không"; khi đọc mã thấy không chỉ mục nào tìm được các dòng này mà không quét qua mọi dòng đã phát hành) | Chỉ ở ca lỗi | ✅ Trên prod từ 03/10 00:26 (`6d90bfa`; anh Trung duyệt migration `20261003001000_invoice_unknown_pending_idx` 03/10 rạng sáng). Đã kiểm prod sau khi đẩy: migration xong, có chỉ mục, các gian vẫn đồng bộ, nhãn mới lên Vercel; CHƯA đọc được dòng log `Invoice-recheck` của worker (công cụ chặn em đọc log Render). Anh duyệt 02/10 đêm: thêm chỉ mục (SQL trình riêng), tra ra "không có tờ nào" thì KHÔNG tự gửi lại từ vòng quét (để lát 8). Chi tiết ở mục M |
| 6c | Bổ sung theo trả lời ticket MISA 02/10 (mục N): bảng khả năng thêm `publishGapMs` (MISA = 1 giây), worker tự phát hành và nút phát hành hàng loạt nghỉ đủ khoảng đó giữa hai tờ; HTTP 429 = lỗi TẠM (không ngắt mạch, không "chưa rõ"), cửa gọi in `[NccHTTP] QUA TAI`; ghi nguồn MISA vào từng dòng bảng khả năng | Không | Có, nhỏ: mỗi lượt tự phát hành 20 tờ dài thêm 19 giây; nút hàng loạt 50 tờ dài thêm 49 giây (lát 9 sẽ đưa nút này về chạy nền) | ✅ Trên prod từ 03/10 08:41 (`6ae0653`, anh Trung đẩy). Đã kiểm 08:43 qua `/health` + Supabase SQL: web đổi bản 08:41; worker đổi bản (ảnh chụp sức khỏe 08:41 ghi `6ae0653`, RAM 196 MB, 0 vé trễ); không migration mới (migration cuối vẫn `20261003001000_invoice_unknown_pending_idx`, 2 dòng rolled back là vết cũ 06/08 và 30/09); 33/37 gian đồng bộ trong 15 phút, lần cuối 08:43, gian lỗi liên tiếp duy nhất là Shopee 321947895 KYC đã biết; InvoiceLog 2 dòng, 0 tờ chưa rõ. Chưa có shop nào phát hành nên khoảng nghỉ và 429 chưa chạy thật |
| 7 | Đơn lỗi vì dữ liệu của chính nó: máy dừng tự thử sau 3 lượt, đơn ở lại Hàng chờ với nhãn "Máy đã ngừng thử" cho chủ shop xuất tay. Chi tiết ở mục O | Có (2 cột NULL trên `InvoiceLog`: `errorScope`, `orderErrorCount`; migration `20261003120000_invoice_order_error_count`). Bảng cũ ghi "không": khi đọc mã thấy tầm lỗi không được lưu ở đâu nên không đếm được | Chỉ ở đường tự phát hành: đơn 3 lượt lỗi riêng đơn không được chọn nữa. Bấm tay không đổi | ✅ Trên prod từ 03/10 09:33 (`a4bfecb`, anh Trung duyệt phương án + migration rồi tự đẩy). Đã kiểm prod 09:35 qua `/health` + Supabase SQL: migration `20261003120000` xong 09:32:58 không rollback, 0 migration dở, hai cột `errorScope` (text) + `orderErrorCount` (integer) đều NULL được; web đổi bản 09:33:24; ảnh chụp sức khỏe của worker 09:34:31 mang `a4bfecb` (RAM 210 MB); 30/37 gian đồng bộ trong 15 phút, lần cuối 09:33:42, gian lỗi liên tiếp duy nhất vẫn là Shopee 321947895 KYC đã biết; InvoiceLog 2 dòng. Chưa shop nào phát hành nên chưa có lượt thật |
| 8 | Làn theo shop cho TỰ PHÁT HÀNH (thay vòng chung một cờ), công tắc `INVOICE_MODE`. Chi tiết ở mục P | Có (bảng `invoice_lanes`, migration `20261003140000_invoice_lanes`) | Có: các shop chạy song song; lỗi tạm hết chặn đơn 24 giờ; bật công tắc / Chạy lại chạy trong 30 giây | ✅ LẦN MỘT trên prod từ 03/10 10:09 (`359f1cf`, anh Trung duyệt migration + tự đẩy; mặc định `legacy`, prod không đổi hành vi). Đã kiểm prod 10:12 qua `/health` + Supabase SQL: migration `20261003140000_invoice_lanes` xong 10:09:09 không rollback, 0 migration dở; bảng `invoice_lanes` có, RLS bật, 2 chỉ mục (pkey + nextRunAt), 0 dòng; web đổi bản 10:09:47; ảnh chụp sức khỏe worker 10:10:42 mang `359f1cf` (RAM 217 MB); 33/37 gian đồng bộ, lần cuối 10:11:19, gian lỗi duy nhất vẫn Shopee 321947895 KYC. ✅ LẦN HAI trên prod từ 03/10 10:19 (`4e9ab1b`, mặc định `lanes`). Đã kiểm 10:21: web đổi bản 10:18:59; ảnh chụp sức khỏe worker 10:19:51 mang `4e9ab1b` (RAM 193 MB); `invoice_lanes` 0 dòng (đúng, prod chưa shop nào bật tự phát hành); 0 migration dở; 30/37 gian đồng bộ, lần cuối 10:20:22, gian lỗi duy nhất vẫn Shopee 321947895 KYC. Ảnh log Render của worker `hubsell-worker-sg` anh Trung chụp 03/10 ~10:35: `10:09:09 AM [j6gc2] Applying migration 20261003140000_invoice_lanes` (lần một) và `10:18:21 AM [snpwl] [Invoice-lanes] BẬT — tự phát hành theo làn từng shop: tối đa 2 shop cùng lúc, lưới quét mỗi 30 giây, hết đơn nghỉ 15 phút, còn tồn 1 phút, hạn thuê 300 giây` (lần hai) — đúng số. LÁT 8 ĐÓNG |
| 9 | Xuất HÀNG LOẠT qua làn + giao diện tiến độ | Có (bảng `invoice_requests`, hàng đợi tín hiệu) | Có | Đưa lên hai lần |
| 10 | Xuất MỘT đơn và điều chỉnh tay qua làn | Không | Có | |
| 11 | Điều chỉnh tự động thành yêu cầu bền, có thử lại | Không | Có | |
| 12 | Hỏi trạng thái qua adapter, theo tới khi có kết luận | Có (cột `cqtNextCheckAt`) | Có | |
| 13 | Webhook nhà cung cấp qua đường nhận chung; địa chỉ giữ chỗ cho Hubtax | Có (1 hàng đợi) | Không có lưu lượng thật | |
| 14 | Dấu hiệu "Hóa đơn" trên HQ Sức khỏe | Không | Không | |

Bản nháp SQL ở mục C vì thế tách thành bốn migration nhỏ (lát 2, 8, 9, 12), mỗi cái trình riêng.

**G. Kiểm bằng gì, và điều không kiểm được**

- Test tự động trên database dev theo khuôn `stock-queue.test.ts`: hai lượt cùng xin làn của một shop chỉ một lượt được; hai luồng cùng phát hành một đơn chỉ một dòng "đang chờ"; rollback mất cả dòng yêu cầu lẫn tín hiệu; nhà cung cấp treo quá thời hạn → tờ giữ "đang chờ" → lượt sau tra ngược nối lại; tiến trình "chết" giữa lô (hạn thuê hết) → tiến trình khác làm tiếp, không tờ nào lập hai lần; lỗi cấp tài khoản ngắt mạch như cũ; tắt hẳn pg-boss vẫn chạy nhờ lưới quét; đường lui `legacy`.
- Chạy thật với MST thử của MISA trên máy local: xuất một đơn, hàng loạt, điều chỉnh, và ca cố ý cắt mạng giữa lúc gọi.
- Không kiểm được: shop thật (prod chưa shop nào dùng hóa đơn); webhook nhà cung cấp (chưa bên nào có); hai tiến trình worker thật chạy cùng lúc; hạn mức gọi API của MISA.

**H. Việc đã chốt và còn chờ**

Anh Trung 02/10: "Trước mắt làm như em đề xuất", kèm hai yêu cầu: tách phần hóa đơn nhỏ nhất có thể (cần chuẩn, không cần nhanh), và luôn giữ cổng chờ cho nhà cung cấp khác vì Hubsell không chỉ làm việc với MISA. Em hiểu là đã chốt: thiết kế mục B; xuất một đơn và điều chỉnh tay cũng đi qua làn; các số tự chọn ở mục D làm mặc định; đơn lỗi vĩnh viễn dừng tự thử sau 3 lượt.

Còn chờ: câu đọc trên prod ở mục C (trước lát 2); mỗi tệp migration em trình riêng trước khi đẩy.

**I. Kết quả thử trên sandbox MISA ngày 02/10/2026** (`backend/scripts/misa-refid-probe.ts`; đã lập 7 hóa đơn sandbox số 00000131–00000137, ký hiệu 1K26TYY)

| Câu hỏi | Kết quả |
|---|---|
| Tra theo mã tham chiếu chưa từng gửi | Trả danh sách rỗng, không báo lỗi |
| Một mã tham chiếu bị từ chối rồi gửi lại hợp lệ | Được nhận. Hóa đơn bán: thử hai kiểu từ chối, ký hiệu không tồn tại (`InvoiceTemplateNotExist`) và thuế suất sai (`Invalid_[InvoiceDetail.VATRateName]`). Hóa đơn điều chỉnh: thử thêm chiều 02/10 với thuế suất sai rồi gửi lại đúng mã, được nhận (tờ sandbox 00000137, điều chỉnh cho 00000134) |
| Gửi lại mã tham chiếu của tờ đã lập | Bị từ chối `DuplicateInvoiceRefID`, cả hóa đơn bán lẫn điều chỉnh |
| Hai lệnh CÙNG LÚC cùng một mã tham chiếu | Đúng một tờ được lập, lệnh kia `DuplicateInvoiceRefID` (thử một lần) |
| Tra ngược ngay sau khi lập | Hóa đơn bán: thấy ngay (3/3 lượt). **Hóa đơn điều chỉnh: lượt tra ngay sau khi lập trả RỖNG (2/2 lượt), 140 ms sau thì thấy** |
| Điều chỉnh trỏ vào số hóa đơn gốc không tồn tại (`99999999`) | **MISA KHÔNG từ chối, lập luôn** (tờ 00000133). Em tưởng sẽ bị từ chối nên tờ này là ngoài ý muốn; nó nằm lại sandbox |
| Thời gian một lệnh trên sandbox | Phát hành 350–580 ms; tra ngược khoảng 35 ms; lệnh bị từ chối 20–60 ms |

Ba hệ quả cho thiết kế:

1. Kết quả tra ngược "không thấy" ngay sau khi gửi KHÔNG phải là kết luận. Lõi chỉ tin "không thấy" sau một khoảng chờ (mỗi nhà cung cấp tự khai, MISA khai 60 giây; lõi dùng mức lớn hơn giữa số đó và 5 phút). Và "không thấy" chỉ dẫn tới gửi lại ĐÚNG mã cũ, không bao giờ dẫn tới đổi sang mã mới, để chốt chặn trùng của nhà cung cấp vẫn còn tác dụng.
2. Nhà cung cấp không kiểm hóa đơn gốc thì Hubsell phải tự kiểm trước khi lập điều chỉnh (lát 3).
3. Thời hạn chờ 60 giây gấp khoảng 100 lần thời gian một lệnh trên sandbox. Số thật trên prod chưa có.

Chưa thử được trên sandbox: mã tham chiếu của tờ đã bị XÓA bên MISA có dùng lại được không (sandbox không xóa được qua API). **Đã hỏi MISA, trả lời 02/10 15:34 (mục N): hóa đơn đã phát hành KHÔNG xóa được, sai thì phải xử lý sai sót** — ca "chủ shop xóa tờ đã phát hành rồi xuất lại từ Hubsell" không tồn tại trên production, luật mã tham chiếu = mã đơn giữ nguyên.

Thân câu trả lời thật của lệnh phát hành (sandbox 02/10 tối, HTTP 200): `Success: true`, `PublishInvoiceResult` là một CHUỖI JSON lồng, mỗi phần tử có `RefID` (nhắc lại mã tham chiếu Hubsell gửi), `TransactionID` (mã tra cứu MISA cấp), `InvNo`, `InvSeries`, `InvDate`, `ErrorCode` rỗng. Vì `RefID` luôn được nhắc lại, mã đọc phần tử này không được coi `RefID` là mã tra cứu.

**J. Cổng chờ cho nhà cung cấp khác: lõi đọc bảng khả năng, không giả định ai cũng giống MISA**

Mỗi adapter khai một bảng khả năng (`ProviderCapabilities` trong `integrations/invoice/types.ts`), mỗi dòng phải ghi nguồn: tài liệu của nhà cung cấp, hoặc kết quả chạy bộ bài thử ở mục I trên sandbox của chính họ. Chưa kiểm được thì khai mức an toàn.

| Khả năng | MISA (nguồn) | Lõi dùng để làm gì |
|---|---|---|
| Phải phát hành lần lượt trong một shop | Có (tài liệu; MISA xác nhận trong trả lời ticket 02/10: tuần tự theo ký hiệu, đồng thời là "sai quy tắc") | Làn theo shop chạy từng tờ hay song song |
| Nghỉ tối thiểu giữa hai lệnh phát hành (`publishGapMs`) | 1 giây (MISA 02/10: "mỗi request nên cách nhau 1-3s") | Worker và nút hàng loạt chờ bao lâu trước tờ kế |
| Chặn trùng theo mã tham chiếu | Có (thử 02/10; MISA 02/10: "RefID là Key để check trùng", nhưng chỉ nói "gần như" nên Hubsell vẫn giữ chỉ mục duy nhất) | Có được gửi lại khi chưa rõ kết quả không |
| Mã của lượt bị từ chối dùng lại được | Có (thử 02/10, hóa đơn bán) | Lượt sau dùng lại mã hay phải mã mới |
| Tra ngược theo mã tham chiếu, và sau bao lâu thì chắc chắn thấy | Có, khai 60 giây (thử 02/10) | Giải tờ "chưa rõ kết quả" |
| Cỡ lô hỏi trạng thái | 50 | Vòng hỏi trạng thái |
| Có webhook | Không (tài liệu) | Có mở đường nhận sự kiện không |
| Hủy qua API | Không (chưa kiểm endpoint `/cancel`; MISA 02/10 không trả lời câu này, chỉ nói tờ đã phát hành không xóa được) | |
| Tự kiểm hóa đơn gốc khi điều chỉnh | Không (thử 02/10; MISA 02/10 xác nhận cả production: "thông tin của hóa đơn gốc sẽ không validate") | Hubsell có phải tự kiểm trước không |

Cách lõi xử lý một lượt "chưa rõ kết quả" theo hai khả năng chính:

| Chặn trùng theo mã | Tra ngược được | Lõi làm gì |
|---|---|---|
| Có | Có | Giữ "đang chờ", hết khoảng chờ thì tra ngược: thấy → nối số hóa đơn; không thấy → cho gửi lại đúng mã cũ |
| Có | Không | Hết khoảng chờ thì gửi lại đúng mã cũ; nhà cung cấp báo trùng nghĩa là tờ đã lập mà Hubsell không lấy được số → đánh dấu để chủ shop đối chiếu |
| Không | Có | Tra ngược sau khoảng chờ; không thấy → cho gửi lại |
| Không | Không | KHÔNG tự gửi lại. Đánh dấu cần chủ shop kiểm bên nhà cung cấp rồi xác nhận |

Sổ đăng ký (`integrations/invoice/provider-registry.ts`) là nơi duy nhất khai nhà cung cấp, với bốn trạng thái: đang chạy (MISA), lưu được nhưng chưa có adapter (Tùy biến), sắp ra mắt (EasyInvoice, M-Invoice, Mắt Bão, Viettel, VNPT, BKAV), giữ chỗ (Hubtax). Mỗi bên một công tắc phát hành riêng `<MÃ>_ALLOW_PUBLISH`; MISA giữ nguyên biến đang đặt trên prod.

Quy trình mở một nhà cung cấp mới: viết adapter → chạy bộ bài thử trên sandbox của họ để điền bảng khả năng → đổi trạng thái trong sổ đăng ký → bỏ cờ "sắp ra mắt" ở giao diện → đặt công tắc phát hành. Lõi, hàng đợi, worker không sửa. Khi làm tới adapter thứ hai, em chuyển bộ bài thử sang gọi qua hợp đồng adapter để dùng chung.

**K. Lát 5: adapter báo rõ "chưa rõ kết quả" (viết 02/10/2026 tối)**

Hợp đồng: `InvoiceResult.outcomeUnknown = true` (đi kèm `status = FAILED`) nghĩa là lệnh phát hành ĐÃ gửi sang nhà cung cấp mà không có câu trả lời rõ, tờ hóa đơn có thể đã tồn tại bên họ. Nơi gọi không được coi là "chắc chắn chưa lập". Adapter nào cũng phải tự phân biệt hai chặng: trước khi gửi lệnh (lỗi là "chưa lập") và sau khi gửi (lỗi không có kết luận là "chưa rõ").

Adapter MISA gắn cờ ở các ca sau (`invoice-errors.ts` hàm `isPublishOutcomeUnknown`, `misa-provider.ts`):

| Ca | Trước lát 5 | Từ lát 5 |
|---|---|---|
| Đứt mạng ngay lúc gửi lệnh phát hành | Hỏng, lỗi tạm | Hỏng + chưa rõ |
| HTTP 5xx hoặc 408 | Hỏng, lỗi tạm (408: lỗi riêng đơn) | Hỏng + chưa rõ |
| Đứt giữa lúc đọc câu trả lời | Hỏng, xếp nhầm là lỗi riêng đơn | Hỏng + chưa rõ, lỗi tạm |
| Trả lời thành công mà không có số hóa đơn lẫn mã tra cứu (kể cả khi chỉ nhắc lại `RefID`) | **Đã phát hành**, số để trống | Hỏng + chưa rõ |
| Mã `Exception`, `CreateInvoiceDataError` (tài liệu MISA: không rõ nguyên nhân) | Hỏng, lỗi tạm | Hỏng + chưa rõ. Anh Trung chốt 02/10: coi là chưa rõ. MISA trả lời câu 3 ngày 02/10 (mục N) không nói gì về hai mã này, chỉ xác nhận RefID chặn trùng → GIỮ "chưa rõ": gửi lại đúng mã cũ luôn an toàn |
| Báo trùng mã mà tra ngược chưa ra số (không tra được, chưa thấy, tờ chưa phát hành xong) | Hỏng | Hỏng + chưa rõ, giữ câu báo lỗi trùng |

Không gắn cờ: lỗi ở bước lấy token (lệnh chưa gửi), thiếu cấu hình, công tắc phát hành tắt, MISA từ chối có mã rõ (HTTP 4xx, sai ký hiệu, sai thuế suất...), tờ trùng đã bị xóa bên MISA. Có một trong hai (số hóa đơn hoặc mã tra cứu) vẫn ghi đã phát hành như trước.

Lõi ở lát này: `issue-order` và `adjust-order` vẫn ghi dòng nhật ký "hỏng" và chuyển cờ ra cho người gọi (`IssueOrderResult.outcomeUnknown`). Không đổi database, không đổi giao diện. Câu báo cho chủ shop: chưa rõ hóa đơn đã lập hay chưa, đừng lập tay trên meInvoice, làm lại thao tác thì Hubsell tự nhận lại đúng tờ đã lập. Câu này đúng với MISA vì MISA chặn trùng theo mã tham chiếu; adapter khác phải viết câu theo bảng khả năng của mình.

Vì sao rủi ro không tăng trong lúc chờ lát 6: dòng "hỏng" nhả chỉ mục duy nhất, lượt làm lại gửi đúng mã cũ, MISA báo trùng, `recoverDuplicate` nối lại số. Giới hạn còn lại: tự phát hành chỉ thử lại đơn hỏng tối đa một lần mỗi 24 giờ, nên tờ chưa rõ được nối lại vào hôm sau hoặc khi chủ shop bấm tay; lát 6 rút xuống 5 phút.

Thử sandbox MISA 02/10 tối (`backend/scripts/misa-outcome-unknown-probe.ts`, lập 2 tờ sandbox 00000138 và 00000139): lệnh phát hành gửi thật, MISA lập xong, câu trả lời bị vứt theo hai kiểu (ném lỗi mạng; trả tiêu đề rồi đứt lúc đọc thân). Cả hai kiểu: adapter trả hỏng + chưa rõ; tra ngược thấy tờ đã lập; gọi lại với đúng mã cũ ra "đã phát hành" đúng số của tờ đó; MISA chỉ có một tờ cho mỗi mã.

Chưa kiểm: MISA trả HTTP 5xx thật hay mã `Exception` thật (chỉ giả lập trong test); hóa đơn điều chỉnh ở ca chưa rõ trên sandbox (đường nối lại của điều chỉnh đã thử ở lát 3). Không đụng: đường xuất hóa đơn của chính Hubsell trên HQ (`routes/admin.ts` gọi thẳng `publishStandardInvoice`, có cách xử lý riêng khi chưa có số), ghi sổ mục 7.

**L. Lát 6a: thời hạn chờ lệnh gọi nhà cung cấp (viết 02/10/2026 đêm)**

`integrations/invoice/provider-http.ts`: mỗi lệnh qua `providerFetch` mang một tín hiệu hết giờ (`AbortSignal.timeout`), gắn vào cả lượt trao đổi nên quá hạn lúc đang đọc thân cũng bị cắt. Quá hạn thì ném `ProviderTimeoutError` ("quá thời hạn chờ 60 giây") và in dòng `[NccHTTP] QUA HAN <nhà cung cấp> <loại lệnh> <ms>`; dòng log không có địa chỉ, token hay thân lệnh. Thân câu trả lời đọc qua `readProviderBody`. Đường lui: `INVOICE_HTTP_TIMEOUT_MS=0` tắt thời hạn, không cần đưa bản mới lên.

| Lệnh bị quá hạn | Kết quả |
|---|---|
| Phát hành (chờ tiêu đề hoặc đang đọc thân) | Hỏng + chưa rõ kết quả, lỗi tạm; câu báo ghi "không trả lời trong thời hạn chờ" |
| Lấy token | Hỏng, lỗi tạm, KHÔNG gắn cờ chưa rõ (lệnh phát hành chưa gửi). Sửa kèm: lỗi lúc đọc thân của bước token trước đây lọt ra dạng lỗi thường và bị xếp là lỗi riêng đơn |
| Tra ngược theo mã tham chiếu / hỏi trạng thái | "Không tra được" (sự cố tạm), không bao giờ thành "không thấy" |
| Lấy danh sách ký hiệu, tải tệp | Báo lỗi như lỗi mạng |

Phạm vi: bốn loại lệnh MISA đang đi qua cửa (token, phát hành, hỏi trạng thái / tải tệp, lấy ký hiệu), ở cả web lẫn worker. Chưa đi qua cửa nên chưa có thời hạn: eSign, máy tính tiền, hóa đơn đầu vào.

Thời gian tệ nhất của một lượt phát hành sau lát này: lấy token 60 giây + phát hành 60 giây + nghỉ 2 giây + phát hành lại 60 giây (khi bị từ chối vì lệch số) + tra ngược 60 giây (khi báo trùng) = 242 giây. Mốc 5 phút của 6b (tuổi tối thiểu của dòng "đang chờ" trước khi tra lại) nằm trên con số này.

Kiểm: test `invoice-provider-timeout.test.ts` 11 ca chạy với MỘT MÁY CHỦ HTTP THẬT trên máy (nhận lệnh rồi im lặng; trả tiêu đề rồi ngừng giữa thân), không giả `fetch`. Sandbox MISA 02/10 đêm (`scripts/misa-outcome-unknown-probe.ts timeout 150`, lập 1 tờ sandbox 00000140): đặt thời hạn 150 ms, ngắn hơn thời gian MISA xử lý; lệnh bị cắt sau 165 ms, adapter báo chưa rõ. **Tra ngược 3 giây sau: MISA ĐÃ LẬP tờ đó dù Hubsell đã cắt lệnh.** Làm lại với đúng mã cũ thì nối đúng số, MISA chỉ có một tờ. Đây là bằng chứng thật cho quy tắc "quá hạn là chưa rõ, không phải chưa lập".

Chưa kiểm: MISA thật im lặng tới 60 giây (không tạo được trên sandbox); thời hạn 60 giây so với thời gian phát hành thật trên prod (chưa có số đo).

**M. Lát 6b: tờ chưa rõ kết quả giữ "đang chờ" rồi tự tra lại (viết 03/10/2026 rạng sáng)**

Hai chỗ đổi:

1. `issue-order.ts` và `adjust-order.ts`: adapter báo chưa rõ kết quả VÀ nhà cung cấp tra ngược được (bảng khả năng) thì dòng nhật ký GIỮ "đang chờ" kèm lời nhắn, không ghi "hỏng". Dòng đang chờ vẫn là vé của đơn (chỉ mục duy nhất của lát 2) nên bấm lại bị chặn trước khi gọi nhà cung cấp, với câu "đang kiểm lại, vài phút nữa xem kết quả". Người gọi vẫn nhận lỗi (HTTP 502, mã `HUBSELL_OUTCOME_UNKNOWN`). Nhà cung cấp không tra ngược được thì ghi "hỏng" như lát 5.
2. Vòng quét `workers/invoice-unknown-recheck.ts` (chỉ chạy ở vai worker, mỗi 60 giây; `INVOICE_UNKNOWN_RECHECK_SECONDS=0` tắt): tìm dòng "đang chờ" chưa có mã tra cứu đã quá 5 phút, tra ngược theo mã tham chiếu đã gửi, ghi kết luận. Luật nằm ở `integrations/invoice/unknown-outcome.ts`, chỉ đọc bảng khả năng, không biết gì về MISA.

| Kết quả tra | Dòng nhật ký | Đơn (chỉ với hóa đơn gốc) |
|---|---|---|
| Thấy tờ đã phát hành | Đã phát hành, nối số + mã tra cứu, ngày phát hành = lúc gửi lượt đó | Đã phát hành |
| Tờ đã bị xóa bên nhà cung cấp | Đã hủy | Đã hủy |
| Không có tờ nào | Hỏng, lời nhắn nói đơn đã quay lại hàng chờ; báo chuông một lần | Hỏng (quay lại Hàng chờ xuất) |
| Có tờ nhưng chưa phát hành xong | Giữ đang chờ; có mã tra cứu thì ghi mã, vòng hỏi trạng thái theo tiếp | Đang chờ |
| Không tra được (mạng, sai tài khoản, shop đã gỡ cấu hình) | Giữ đang chờ, ghi lý do, 15 phút sau thử lại | Đang chờ |
| Nhà cung cấp không tra ngược được (dòng mồ côi) | Hỏng, lời nhắn bảo tự kiểm bên nhà cung cấp trước khi làm lại; báo chuông | Hỏng |

Dòng "đang chờ" mồ côi do tiến trình chết giữa lúc gọi (trước đây kẹt vĩnh viễn, làm đơn biến khỏi Hàng chờ xuất — điểm A.4) đi cùng đường này.

Quy mô và an toàn:

- Một câu đọc cho mọi shop, đi theo chỉ mục riêng phần `InvoiceLog_unknown_pending_idx` (migration `20261003001000_invoice_unknown_pending_idx`), mỗi lượt tối đa 50 dòng, 4 shop cùng lúc, trong một shop thì lần lượt. Shop nào hỏi không được thì bỏ phần còn lại của shop đó trong lượt và hoãn 15 phút.
- Mốc "đã hỏi lúc nào" dùng lại cột `cqtCheckedAt` có sẵn (không thêm cột). Khi nối được số thì đặt lại về trống để vòng hỏi trạng thái cơ quan thuế xét tờ đó ngay lượt kế.
- Mọi lượt ghi có điều kiện "dòng còn đang chờ và chưa có mã tra cứu": hai worker (hoặc bản cũ và bản mới lúc đưa lên) cùng xử lý một dòng thì chỉ một bên ghi được. Không dùng khóa trong bộ nhớ.
- Vòng quét chỉ ĐỌC phía nhà cung cấp, không bao giờ gửi lệnh phát hành. Tra ra "không có tờ nào" thì chỉ trả đơn về hàng chờ (anh Trung chốt 02/10); tự phát hành nhặt lại theo luật cũ (một lần mỗi 24 giờ) cho tới lát 8.
- Hai số tự chọn mới: nhịp quét 60 giây, hỏi lại sau 15 phút. Mốc 5 phút đã chốt ở mục D.

Giao diện: trang Lịch sử, dòng "đang chờ" đang được kiểm lại hiện nhãn "Đang kiểm lại" thay cho "Chờ phát hành"; lý do nằm ở chú thích khi rê chuột (có sẵn). Chưa soi trên trình duyệt (chỉ đổi chữ trong một nhãn có sẵn, cùng độ dài).

Kiểm: test `invoice-unknown-recheck-db.test.ts` 12 ca trên database dev với nhà cung cấp giả có "sổ" riêng (lệnh tới nơi, tờ đã lập, mất câu trả lời); cả bộ 1.178 test qua. Sandbox MISA 03/10 (`scripts/misa-unknown-recheck-probe.ts`, lập 1 tờ 00000141) với adapter MISA thật và database dev: lệnh phát hành bị cắt vì quá hạn 150 ms, dòng "đang chờ" được tra lại và NỐI đúng số + mã tra cứu của tờ MISA đã lập; dòng mang mã chưa từng gửi ra "không có tờ nào" và về "hỏng"; tra lại lần hai trên dòng đã có kết luận thì bỏ qua.

Câu đọc của vòng quét trên database dev sau khi áp migration (03/10 00:23, 892 dòng nhật ký, 0 dòng đang chờ chưa có mã tra cứu): `Index Scan using "InvoiceLog_unknown_pending_idx"`, đọc 1 khối, 0,02 ms; kế hoạch giữ nguyên ở lượt chạy thứ 7 (sau khi Postgres hết giai đoạn lập kế hoạch riêng từng lượt). Prod trước khi đưa lên: bảng nhật ký 2 dòng, 0 dòng đang chờ chưa có mã tra cứu, không migration dở.

Chưa kiểm: vòng quét chạy theo nhịp thật trong worker (mới gọi trực tiếp từng lượt); hai tiến trình worker thật; nhãn mới trên trình duyệt.

**N. Trả lời ticket MISA 02/10 và lát 6c: bổ sung vào lát 5–6 (đọc trả lời 03/10/2026 sáng)**

Ticket gửi 02/10 ~14:35 (6 câu, `docs/MISA-TICKET-MA-THAM-CHIEU-HOA-DON-DA-XOA.md`), MISA trả lời 02/10 15:34; nguyên văn và bảng đối chiếu từng câu nằm ở tệp đó. Tóm lại điều MISA nói và điều đổi trong mã:

| MISA nói | Khớp thiết kế lát 1–6 không | Đổi gì ở lát 6c |
|---|---|---|
| Hóa đơn đã phát hành không xóa được; sai thì xử lý sai sót | Khớp: ca "xóa rồi xuất lại" không có trên prod, luật mã tham chiếu = mã đơn đúng | Không đổi mã; ghi nguồn |
| Phát hành xong không cần tra trạng thái ngay | Khớp: `createInvoice` đọc số từ câu trả lời, chỉ tra ngược khi báo trùng / chưa rõ | Không đổi |
| Tuần tự theo ký hiệu, mỗi lệnh cách 1–3 giây; RefID là khóa chống trùng, "gần như" không trùng | Khớp một nửa: worker đã tuần tự, nhưng nhịp nghỉ 1 giây chốt 01/10 CHƯA có trong mã (worker và nút hàng loạt gọi liền tờ này sang tờ kế); MISA không cam kết tuyệt đối nên chỉ mục duy nhất lát 2 vẫn cần | Bảng khả năng thêm `publishGapMs` (`types.ts`, MISA = 1000); `issue-order` / `adjust-order` trả `pauseBeforeNextMs` khi lệnh đã tới nhà cung cấp; worker `invoice-auto-issue.ts` và route `POST /api/tax/invoices/bulk` chờ đủ khoảng đó trước tờ kế (tờ cuối không chờ, bị chặn trước khi gọi nhà cung cấp thì không chờ) |
| Production không kiểm hóa đơn gốc khi điều chỉnh | Khớp: lát 3 tự kiểm | Không đổi; ghi nguồn |
| Lý tưởng 20–30 tờ một lệnh, tối đa 50 | KHÔNG khớp cách làm hiện nay (một tờ một lệnh). Không sai, chỉ chậm: một ký hiệu cỡ 20–40 tờ một phút | Chưa đổi — cần hợp đồng adapter nhận lô, thuộc lát 8–9. Ghi sổ việc mục 7 |
| Hạn mức gọi API đang TẮT, sẽ bật lại, chưa có số | Mã chưa có xử lý HTTP 429: hiện rơi vào "lỗi riêng đơn", 3 đơn liên tiếp là NGẮT MẠCH shop và bảo chủ shop sửa (sai: chủ shop không sửa được gì) | `invoice-errors.ts`: HTTP 429 → lỗi TẠM (`STOP_RUN`: dừng lượt của shop, lượt sau thử lại), không gắn cờ chưa rõ (MISA từ chối trước khi xử lý); `provider-http.ts` in `[NccHTTP] QUA TAI <NCC> <lệnh> HTTP 429 Retry-After=...` |

Điều còn là số tự chọn sau trả lời này: thời hạn chờ 60 giây, `settleSeconds` 60 giây, tuổi 5 phút trước khi tra lại, 2 shop cùng lúc. MISA không cho con số nào trong bốn thứ đó.

Ảnh hưởng thời gian của khoảng nghỉ: lượt tự phát hành 20 tờ dài thêm 19 giây (nhịp 15 phút, không đáng kể); nút phát hành hàng loạt 50 tờ dài thêm 49 giây ngay trong một request HTTP (từ ~25–30 giây lên ~75–80 giây). Em để nguyên vì MISA yêu cầu và lát 9 sẽ đưa nút này về chạy nền có tiến độ; nếu anh thấy 80 giây một request là quá dài thì hạ trần 50 đơn của nút xuống 20 (một dòng trong `routes/tax.ts`) tới khi có lát 9.

Kiểm: `npx tsc --noEmit` sạch; `vitest run invoice misa` 14 tệp 185 test qua (thêm 3 ca: bảng khả năng khóa `publishGapMs`, HTTP 429 là lỗi tạm và giữ mã riêng của MISA nếu có, 429 không phải chưa rõ; ca database `issueInvoiceForOrder` trả `pauseBeforeNextMs = 1000` khi lệnh đã tới nhà cung cấp). Chưa kiểm: MISA thật trả 429 (hạn mức đang tắt, không tạo được); khoảng nghỉ trên prod (chưa shop nào phát hành).

### 4.7. Bước 6 (dọn) — kiểm kê 02/10/2026

**Trạng thái: mới kiểm kê. Chưa việc nào của bước 6 tới ngày làm.** Ba mốc đang giữ: đường lui webhook giữ khoảng một tuần kể từ 01/10; đường lui đẩy tồn tới khoảng 09/10; thời hạn chờ gọi sàn trình số ngày 04–06/10. Đường lui của bước 5 thì chỉ gỡ được một tuần sau lần đưa lên thứ hai của bước 5.

Vì vậy bước 6 tách ba đợt:

| Đợt | Nội dung | Sớm nhất |
|---|---|---|
| 6a | Bật thời hạn chờ gọi sàn; tính lại hạn giữ việc (5 phút) và hạn thuê gian (300 giây) theo số đó | 04–06/10, khi đủ 3–5 ngày số đo |
| 6b | Gỡ đường cũ của webhook ba sàn và đẩy tồn; xóa hai bảng `shopee_webhook_logs`, `tiktok_webhook_logs` | 09/10 |
| 6c | Gỡ hai vòng hóa đơn cũ, hàng đợi webhook MISA cũ, công tắc `INVOICE_MODE`; xóa bảng `misa_webhook_logs` | Một tuần sau lần hai của bước 5 |

**Số đo thời gian gọi sàn tới trưa 02/10 (đọc log Render, chưa đủ ngày để chốt số)**

| Tiến trình | Khoảng đọc được | Sàn | Số lệnh | p99 cao nhất trong các nhịp 15 phút | Lệnh lâu nhất |
|---|---|---|---|---|---|
| worker | 02/10, 07:27–13:11 | Shopee | 34.111 | 2,6 giây | 9,3 giây |
| worker | như trên | TikTok | 6.826 | 2,1 giây | 4,4 giây |
| worker | như trên | TikTok Ads | 8 | 0,6 giây | 0,6 giây |
| web | 01/10 20:52 – 02/10 12:41 (30 dòng trang log hiện) | Shopee | 698 | 1,6 giây | 3,6 giây |
| web | như trên | TikTok | 209 | 2,2 giây | 2,2 giây |
| web | như trên | TikTok Ads | 15 | 0,4 giây | 0,4 giây |

- Không dòng nào báo lỗi mạng hay quá hạn (`loi=0`, `qua_han=0` ở mọi dòng đọc được).
- Tìm chữ `CHAM` (lệnh trên 10 giây) trong 7 ngày ở cả worker lẫn web: không có dòng nào. Số đo mới có từ 01/10 20:36, và em chưa chắc ô tìm của Render tìm đủ.
- **Lazada: không có dòng `[SanHTTP] LAZADA` nào trong 24 giờ ở worker** (tìm chữ LAZADA chỉ ra các dòng khởi động). Tức worker không gọi Lazada lần nào đi qua cửa đo. Hệ quả cho bước 6: không có căn cứ đặt thời hạn chờ riêng cho Lazada; em chưa tìm nguyên nhân (thuộc việc kiểm Lazada đã hoãn ở mục 7).
- Trang log chỉ hiện một đoạn (50 dòng với worker), nên bảng trên là một lát cắt, không phải toàn bộ.

Một số đo thêm ở máy local ngày 02/10 (Node 24.16): lệnh `fetch` không đặt thời hạn, gặp máy chủ nhận kết nối rồi im lặng, tự hỏng sau 303 giây. Tức hiện nay một lệnh gọi sàn treo kéo dài khoảng 5 phút chứ không vô hạn, và con số đó trùng đúng hạn giữ việc 5 phút của `evt.order` và hạn thuê gian 300 giây của đẩy tồn: lệnh treo và hạn giữ hết cùng lúc. Đặt thời hạn chờ ngắn hơn hẳn 300 giây là gỡ được chỗ trùng này. Dòng "sàn treo là luồng việc treo theo" ở mục 2 nên hiểu theo số này.

Điều phải làm trước khi bật thời hạn chờ:

- Biến `PLATFORM_HTTP_TIMEOUT_MS` là MỘT số cho mọi sàn và mọi API. Số đó phải lớn hơn API chậm hợp lệ nhất, nên cần danh sách lệnh chậm theo tên API (log `CHAM` in tên đường dẫn; hiện chưa có dòng nào).
- Lệnh bị cắt vì quá hạn thì nơi gọi thấy như lỗi mạng và có thể gọi lại. Phải rà các lệnh gọi lại lần hai là có hại (sắp xếp vận chuyển, đổi ngân sách quảng cáo) trước khi bật.
- Hai chỗ tải tệp vận đơn (`services/fulfillment/tiktok.ts`, `lazada.ts`) chưa đi qua cửa đo.

**Kiểm kê phần phải gỡ ở đợt 6b và 6c (dò mã hôm nay)**

| Nhóm | Chỗ | Ghi chú |
|---|---|---|
| Hàng đợi cũ Shopee | `integrations/shopee/webhook-queue.ts`: `enqueueShopeeWebhook`, vòng `drain`, `startShopeeWebhookWorker`, nhánh đối soát tồn | Giữ lại `handleShopeeOrderJob`, `handleShopeeAuthJob`, `alertShopeeJobFailed` (đường mới đang dùng) |
| Hàng đợi cũ TikTok | `integrations/tiktok/webhook-queue.ts`: phần ghi và quét bảng cũ | Giữ ba hàm lõi dùng chung |
| Hàng đợi cũ MISA | `integrations/invoice/misa-webhook-queue.ts`, `scripts/simulate-misa-webhook.ts` | Sau lát 4 của bước 5 |
| Route webhook | `routes/webhooks.ts`: ba hàm chọn chế độ và ba nhánh đường cũ | Xem điểm cần chốt 1 bên dưới |
| Khởi động worker | `workers/index.ts`: ba lệnh khởi động hàng đợi cũ, nhánh `legacy` của đẩy tồn | |
| Đẩy tồn đường cũ | `integrations/stock-push-worker.ts` (vòng quét, `processChannelJobs`), `inventory-push.ts` (các nhánh `legacy`), `shopee/inventory-sync.ts` (đối soát ghi vào bảng webhook Shopee), `lib/queue-config.ts` (`stockPushMode`) | |
| Hóa đơn đường cũ | `workers/invoice-auto-issue.ts`, `invoice-status-sync.ts` (phần vòng lặp), route `/invoices/bulk` kiểu cũ, `maybeAutoAdjustOnPlatformReturn` | Đợt 6c |
| Dọn nhật ký | `workers/log-cleanup.ts`: ba khối dọn bảng cũ | |
| HQ | `services/platform-health.ts` (đếm việc chờ và webhook mỗi ngày từ bảng cũ), `routes/admin.ts` (số đếm và ba trang nhật ký đang nối hai nguồn) | Chuyển hẳn sang `webhook_events` |
| Prisma | Ba model `ShopeeWebhookLog`, `TiktokWebhookLog`, `MisaWebhookLog` | Kiểu `WebhookJobStatus` giữ lại, `WebhookEvent` đang dùng |
| Biến môi trường | `LAZADA_WEBHOOK_MODE`, `TIKTOK_WEBHOOK_MODE`, `SHOPEE_WEBHOOK_MODE`, `STOCK_PUSH_MODE`, sau đó `INVOICE_MODE` | Kiểm trên Render cả web lẫn worker không đặt biến nào trước khi gỡ |
| Test | `tiktok-webhook-queue.test.ts`, `misa-webhook-queue.test.ts`, `stock-push.test.ts`, ca đường lui trong ba tệp `*-webhook-inbox.test.ts` / `lazada-webhook-queue.test.ts` / `stock-queue.test.ts`, `log-cleanup.test.ts`, `inventory-reconcile.test.ts`, `inventory-idempotency.test.ts`, `queue-config.test.ts` | Ca nào kiểm lõi dùng chung thì chuyển sang đường mới, không xóa |
| Tài liệu | `.env.example`, `prisma/supabase-schema.sql` | |

**Cách đưa đợt 6b lên: hai lần, như các bước trước.** Lần một chỉ gỡ mã (bảng còn nguyên). Lần hai mới chạy migration xóa bảng. Lý do: lúc deploy bản cũ còn sống vài phút và worker bản cũ quét bảng cũ mỗi vài giây; xóa bảng ngay trong lượt deploy đó là bản cũ báo lỗi liên tục, và lệnh xóa bảng phải chờ khóa.

Điều kiện trước khi xóa bảng (đọc trên prod ngay trước lúc làm):

```sql
SELECT 'shopee' AS bang, "status"::text, count(*), max("createdAt") FROM "shopee_webhook_logs" GROUP BY 2
UNION ALL SELECT 'tiktok', "status"::text, count(*), max("createdAt") FROM "tiktok_webhook_logs" GROUP BY 2
UNION ALL SELECT 'misa', "status"::text, count(*), max("createdAt") FROM "misa_webhook_logs" GROUP BY 2;
```

Phải thấy: không dòng nào đang chờ hay đang xử lý; dòng mới nhất của Shopee không sau 02/10 08:50 (lúc đối soát tồn rời bảng này), của TikTok không sau 01/10 21:17.

**Việc cần anh Trung chốt cho bước 6**

1. Khi hàng đợi bền chưa sẵn sàng, route webhook hiện tự lùi về đường cũ. Gỡ đường cũ rồi thì trả lỗi 5xx cho sàn (sàn tự gửi lại; đường quét định kỳ vẫn là lưới). Em chưa đọc lại tài liệu Shopee và TikTok về số lần và nhịp gửi lại; sẽ đọc trước khi làm 6b.
2. Xóa bảng cũ là mất các dòng nhật ký HỎNG trước ngày chuyển (dòng xong đã tự dọn sau 7 ngày, dòng hỏng giữ 30 ngày). Trang nhật ký HQ khi đó chỉ còn sự kiện từ 01/10. Nếu anh muốn giữ đủ 30 ngày thì lùi lần xóa bảng tới sau 31/10.
3. Số thời hạn chờ gọi sàn: em trình ngày 04–06/10 theo lịch đã hẹn, không chốt bằng số của một buổi sáng.

**O. Lát 7: đơn lỗi vì dữ liệu của chính nó dừng tự thử sau 3 lượt (viết 03/10/2026 sáng)**

Anh Trung duyệt phương án 03/10 ("Ok làm vậy đi em") với bốn điểm: chỉ đếm lỗi riêng đơn; thêm hai cột vào `InvoiceLog`; lỗi do bấm tay đếm chung; không thêm nút thử lại riêng.

*Hiện trạng trước lát 7 (đọc mã).* Worker tự phát hành chọn đơn bằng một điều kiện duy nhất về lỗi: không có dòng nhật ký nào mới hơn 24 giờ. Đơn bị nhà cung cấp từ chối vì dữ liệu của chính nó (mã số thuế người mua sai dạng, tên thuế suất lạ, XML quá dài) vì thế được thử lại mỗi ngày một lần không có điểm dừng, mỗi ngày thêm một dòng FAILED và một chuông "n đơn lỗi". Tầm lỗi (ACCOUNT / ORDER / TRANSIENT, `invoice-errors.ts`) chỉ sống trong RAM của lượt chạy; `InvoiceLog` không lưu tầm lẫn mã lỗi, nên không hỏi được database "đơn này đã bị từ chối vì dữ liệu mấy lần". Hàng chờ xuất không cho chủ shop biết đơn nào đã hỏng, mấy lần, vì sao.

*Định nghĩa một lượt lỗi.* Chỉ lỗi tầm ORDER tính một lượt. Lỗi ACCOUNT đã có ngắt mạch cả shop; lỗi TRANSIENT là của nhà cung cấp hay đường mạng, không đếm — đếm thì một đơn tốt gặp ba ngày MISA trục trặc sẽ bị máy bỏ rơi. Lỗi do bấm tay cũng đếm vì sự thật "đơn này bị từ chối vì dữ liệu n lần" không phụ thuộc ai bấm; mọi lần đếm nằm ở một chỗ là `issueInvoiceForOrder`.

*Lưu ở đâu.* Hai cột NULL, không chỉ mục, không chép lại dữ liệu cũ, trên `InvoiceLog` (migration `20261003120000_invoice_order_error_count`, lấy khóa ACCESS EXCLUSIVE có thử lại theo khuôn `order_ledger`; prod lúc viết có 2 dòng):

| Cột | Nghĩa |
|---|---|
| `errorScope` | tầm lỗi của dòng FAILED — sự thật gốc, để tính lại cột dưới khi cần |
| `orderErrorCount` | số lượt lỗi riêng đơn của hóa đơn gốc tính TỚI dòng này; lỗi tầm khác chép lại số cũ nên dòng FAILED mới nhất luôn mang số hiện hành |

Khi ghi FAILED, lõi đọc số lớn nhất của các dòng FAILED trước của cùng đơn (chỉ mục `orderId`, vài dòng) rồi cộng 1 nếu tầm ORDER. Dòng giữ "đang chờ" (chưa rõ kết quả) không đếm. Hai kết luận "hỏng" của vòng quét tờ chưa rõ (`unknown-outcome.ts`) ghi tầm TRANSIENT, không số lượt. Cách lưu trên `Order` đã cân nhắc và bỏ: bảng nóng, migration đụng nó từng kẹt khóa, còn `InvoiceLog` chính là sổ của việc phát hành.

*Câu chọn đơn của worker* tách thành `findAutoIssueCandidates` / `autoIssueCandidateWhere` (`workers/invoice-auto-issue.ts`) để test và để lát 8 dùng lại; thêm đúng một nhánh vào `invoiceLogs.none`: dòng FAILED có `orderErrorCount ≥ mức dừng`. Prisma vẫn sinh một NOT EXISTS theo `orderId` như trước, không lấy dư rồi lọc trong RAM.

*Luật* ở `auto-issue-policy.ts`: `maxAutoIssueAttempts()` (env `INVOICE_AUTO_ISSUE_MAX_ATTEMPTS`, mặc định 3, `0` = tắt = đường lui không cần đưa lên lại), `autoRetryExhausted(count)`, `nextOrderErrorCount(previous, scope)`. `IssueOrderResult` thêm `orderErrorCount` và `autoRetryJustStopped` (chỉ true ở đúng lượt chạm mức, để chuông reo một lần).

*Giao diện.* Hàng chờ xuất: mỗi dòng đơn máy đã ngừng thử có nhãn "Máy đã ngừng thử 3/3" cạnh mã đơn (kiểu nhãn "Quá hạn"); trỏ chuột hoặc bấm mở ô nhỏ: lần lỗi cuối lúc nào, nhà cung cấp báo gì, kết luận "sửa dữ liệu rồi tick đơn bấm Xuất hóa đơn, hoặc lập trên nhà cung cấp". Thêm chip lọc có số đếm "Máy đã ngừng thử (n)" cạnh các tab, chỉ hiện khi n > 0 hoặc đang xem nó (`?stopped=yes`; route trả `stoppedTotal`, `autoRetryMaxAttempts`, mỗi dòng `autoStopped`). Không thêm khối nào phía trên bảng, không thêm nút thử lại: nút Xuất hóa đơn sẵn có chính là lượt thử lại. Trang Lịch sử: dòng FAILED ghi "Lỗi · lượt 2/3" và "· máy ngừng thử" khi tới mức.

*Chuông.* Một chuông mỗi lượt chạy, gom các đơn vừa chạm mức ở lượt đó (`INVOICE_AUTO_ISSUE_STOPPED`, link `/invoicing/connect?queue=stopped` mở sẵn chip). Chuông "n đơn lỗi" cũ tự im sau ba ngày vì đơn hỏng không còn được chọn.

*Các con số.*

| Tham số | Giá trị | Căn cứ |
|---|---|---|
| Số lượt rồi dừng | 3 | Anh Trung chốt 02/10; bằng số lượt của mọi hàng đợi khác |
| Cửa sổ giữa hai lượt | 24 giờ, giữ nguyên | Em tự chọn 23/08; một đơn hỏng được thử ba ngày khác nhau rồi dừng |
| Đường lui | `INVOICE_AUTO_ISSUE_MAX_ATTEMPTS=0` | Quay về hành vi trước lát 7 |

*Đã kiểm.* `invoice-hardening.test.ts` thêm 2 ca thuần (30/30). `invoice-auto-issue-stop.test.ts` 7 ca trên database dev với nhà cung cấp giả: ORDER đếm 1 → 2 → 3 → 4 và cờ dừng chỉ ở lượt 3; TRANSIENT / ACCOUNT ghi tầm không cộng; mã số thuế người mua sai dạng (chặn trước khi gọi NCC) cũng đếm; đơn 2 lượt (quá 24 giờ) vẫn được chọn, 3 lượt thì không, mức 0 thì lại được chọn; 3 lỗi tạm không làm máy dừng; bấm tay trên đơn đã dừng vẫn gọi NCC và thành công thì rời hàng chờ; dòng FAILED của vòng quét không chặn, không đổi số. Cả bộ 1188 / 1188 qua (03/10 09:24), tsc backend + frontend sạch. Giao diện soi local (dữ liệu demo 4 đơn, đã dọn): chip "Máy đã ngừng thử 2" mở sẵn từ `?queue=stopped`, nhãn 3/3 cạnh mã đơn, ô lý do mở bằng bấm ở 1366 và 375 (bảng cuộn ngang trong hộp, ô rộng 320 px không tràn), nền tối nhãn đổi màu đúng; Lịch sử ghi "Lỗi · lượt 1/3" và "Lỗi · lượt 3/3 · máy ngừng thử". Không cần sandbox MISA: lát này không đổi cách gọi nhà cung cấp. Prod chưa shop nào phát hành nên sau khi đẩy chỉ kiểm được migration + hai cột + worker báo nhịp + các gian đồng bộ.

*Kết quả kiểm prod sau khi đẩy (03/10 09:35).* Xem dòng 7 của bảng F: migration xong, hai cột có, web + worker đều mang `a4bfecb`, các gian đồng bộ bình thường.

*Không đổi ở lát này, ghi sổ (mục 7).* Lỗi TRANSIENT vẫn làm đơn nghỉ 24 giờ, lát 8 rút xuống thử lại sau 1 phút. Luật "cùng mã lạ lặp 3 đơn liên tiếp thì ngắt mạch" giữ nguyên; lát 7 làm nó hết lặp sau ba ngày. Hóa đơn điều chỉnh thuộc lát 11.

**P. Lát 8: làn tự phát hành theo shop (viết 03/10/2026)**

Anh Trung duyệt kế hoạch 03/10 với bốn điểm: hạn thuê 300 giây thay vì 120; lưới quét 30 giây và chuỗi lùi 1 / 5 / 15 phút khi lỗi tạm; lỗi tạm và lỗi tài khoản không còn chặn đơn 24 giờ; lát 8 không thêm hàng đợi pg-boss (tín hiệu để lát 9).

*Vấn đề trước lát 8.* Một vòng đi tuần tự qua mọi shop, 15 phút một lượt, cờ `running` trong RAM: shop có nhà cung cấp chậm làm mọi shop sau chờ (một lượt 20 tờ dài nhất khoảng 40 phút); cờ chỉ đúng trong một tiến trình nên lúc deploy hai worker cùng sống có thể cùng phát hành một shop (chỉ mục duy nhất của lát 2 chặn trùng, bên thua ăn 409); lỗi tạm làm đơn nghỉ 24 giờ như lỗi riêng đơn; bật công tắc hay bấm Chạy lại chờ tới 15 phút.

*Cách chạy mới* (`workers/invoice-lanes.ts`, bật bằng `INVOICE_MODE=lanes`):

```
Lưới quét mỗi 30 giây:   tạo làn cho shop bật công tắc mà chưa có → shop tới giờ, chưa ai thuê, đang bật, không ngắt mạch
                          → nhận tối đa 2 shop cùng lúc mỗi worker
Làn của một shop:         thuê (UPDATE có điều kiện, hạn 300 giây) → runAutoIssueForShop (20 tờ, tuần tự, nghỉ 1 giây)
                          → trước mỗi tờ: tiến trình đang tắt? quá 30 giây thì gia hạn, mất làn thì dừng
                          → hẹn lượt kế: còn tồn 1 phút · hết 15 phút · lỗi tạm lùi 1 → 5 → 15 phút · dừng giữa chừng: ngay
                          → trả làn (chỉ khi làn còn là của mình)
Bật công tắc / Chạy lại:  route đặt nextRunAt về ngay → lượt đầu trong một nhịp quét
Worker nhận SIGTERM:      thôi nhận shop mới, lượt đang chạy dừng sau tờ đang dở, hẹn lại ngay, trả làn
```

- **Bảng `invoice_lanes`**: `ownerId` khóa chính (FK User, xóa theo), `leasedBy`, `leasedUntil`, `nextRunAt` (chỉ mục), `lastRunAt`, `transientStreak`, `updatedAt`; bật RLS. Thuê, gia hạn, trả làn đều là `updateMany` có điều kiện, không khóa RAM, không giữ giao dịch dài. Tiến trình chết thì hết hạn là tiến trình khác nhận; tờ đang dở nếu đã lập thì lượt sau nối lại qua chỉ mục duy nhất + tra ngược như lát 3 / 6.
- **Phần "một shop một lượt" dùng chung hai đường**: `runAutoIssueForShop` ở `workers/invoice-auto-issue.ts` (chọn 20 đơn, phát hành tuần tự, ngắt mạch, chuông, kết cục IDLE / DONE / BACKLOG / TRANSIENT / PAUSED). Vòng cũ gọi với `transientBlocks: true` nên hành vi `legacy` không đổi.
- **Lỗi tạm hết chặn 24 giờ ở đường làn**: `autoIssueCandidateWhere` với `transientBlocks: false` chỉ coi dòng FAILED tầm ORDER (và dòng đời cũ không ghi tầm) là chặn 24 giờ; dòng TRANSIENT / ACCOUNT không chặn. Mã lỗi "tạm" mà dai dẳng không làm shop quay vòng mỗi phút nhờ nấc lùi của làn.
- **Không thêm hàng đợi pg-boss**: tự phát hành không do người bấm, lưới quét 30 giây là đủ; tín hiệu `invoice.issue` để lát 9.

*Các con số* (đều là mặc định tự chọn trừ chỗ ghi nguồn): 2 shop cùng lúc mỗi worker (`INVOICE_LANE_CONCURRENCY`, anh chốt 01/10); lưới quét 30 giây (`INVOICE_LANE_SWEEP_SECONDS`, phải mịn hơn mốc 1 phút); còn tồn 1 phút / hết 15 phút (`INVOICE_AUTO_ISSUE_MINUTES`, chốt 01/10 mục 3.8); hạn thuê 300 giây gia hạn mỗi 30 giây (một tờ tệ nhất khoảng 242 giây theo lát 6, gia hạn chỉ làm được giữa hai tờ nên 120 giây là bị cướp làn giữa lúc gọi; bằng hạn thuê gian của đẩy tồn); lùi 1 / 5 / 15 phút khi lỗi tạm (ba nấc theo tinh thần "3 lượt" của mục D).

*Đưa lên hai lần.* Lần một: migration + mã, `INVOICE_MODE` mặc định `legacy`; kiểm bảng có trên prod, worker lên bình thường. Lần hai: đổi mặc định sang `lanes`, xem log `[Invoice-lanes] BẬT`. Đường lui: `INVOICE_MODE=legacy` ở worker, không cần đưa lên lại. Rủi ro lúc chuyển bản lần hai: worker cũ chạy vòng cũ vài phút cạnh worker mới chạy làn, hai bên có thể cùng phát hành một shop trong khoảng đó như mọi lần deploy trước nay; chỉ mục duy nhất bảo đảm không hai hóa đơn cho một đơn. Prod chưa shop nào bật tự phát hành nên rủi ro này hiện bằng không.

*Đã kiểm (03/10 ~10:00).* `invoice-lanes.test.ts` 10 ca trên database dev với nhà cung cấp giả: lịch lượt kế (1 phút / 15 phút / lùi 1-5-15 và trần / dừng giữa chừng hẹn ngay); hai tiến trình cùng xin một shop chỉ một bên được, hết hạn thuê thì bên khác nhận, gia hạn và trả làn của người khác không ăn, chưa tới giờ không thuê được; 2 đơn → DONE hẹn 15 phút; 21 đơn → BACKLOG hẹn 1 phút rồi lượt sau DONE; lỗi tạm → chuỗi 1 rồi 2 (hẹn 1 rồi 5 phút), đơn đó không bị chặn 24 giờ ở đường làn nhưng vẫn bị chặn ở đường cũ, thành công thì chuỗi về 0; lỗi tài khoản → ngắt mạch, lưới quét không nhận, Chạy lại thì nhận và các đơn từng hỏng vì tài khoản được thử ngay; đơn tới mức dừng của lát 7 không được chọn; lưới quét tự tạo làn cho shop bật công tắc và tôn trọng trần số shop cùng lúc; dừng êm giữa lượt để lại tờ chưa đụng tới, không dòng PENDING mồ côi, làn hẹn ngay và worker sau nhặt tiếp. Cả bộ 1198 / 1198 (một lần chạy đầu có 1 ca lệch thời gian, đã nới mốc thời gian của ca dừng êm và chạy lại 4 lần sạch), tsc sạch. Lưu ý khi test trên database dev: lưới quét phải giới hạn `onlyOwnerIds` vì dev có shop thật bật tự phát hành (demo@hubsell.tech, đang ngắt mạch). Không có giao diện mới. Không cần sandbox MISA.

*Kết quả kiểm prod lần một (03/10 10:12).* Xem dòng 8 của bảng F. Lần hai chỉ đổi một dòng mặc định ở `lib/queue-config.ts`; sau khi lên, dấu hiệu cần thấy: log worker `[Invoice-lanes] BẬT — tự phát hành theo làn từng shop: tối đa 2 shop cùng lúc, lưới quét mỗi 30 giây...` (em không đọc được log Render, nhờ anh dán), ảnh chụp sức khỏe worker mang commit mới, bảng `invoice_lanes` vẫn 0 dòng vì prod chưa shop nào bật tự phát hành.

*Không đổi ở lát này.* Bấm tay một đơn / hàng loạt / điều chỉnh (lát 9–11), vòng quét tờ chưa rõ và hỏi trạng thái cơ quan thuế (lát 12), HQ Sức khỏe (lát 14).

## 5. Rủi ro và điều em không cam kết

- **pg-boss do một người duy trì**, ra bản rất dày (35 bản nhỏ của dòng 12). Ghim đúng bản, lên bản là một việc có chủ đích kèm migration riêng. Mã nghiệp vụ đứng sau `lib/queue`.
- **Lên bản pg-boss có thể đổi schema của nó.** Vì chạy `migrate: false`, mỗi lần lên bản phải xuất SQL chuyển đổi và đưa vào migration.
- **Bảng việc bị ghi và xóa liên tục**, phụ thuộc autovacuum. pg-boss có cảnh báo khi vacuum không theo kịp; em đưa cảnh báo đó lên HQ.
- **Ở 1 triệu đơn/ngày**, `webhook_events` cần chia bảng theo ngày và xóa theo mảnh. Việc này đã nằm trong giai đoạn 4.
- **Hàng đợi "gộp theo khóa" của pg-boss không hợp với việc chạy lâu** (số đo ở cuối mục 4.5). Đẩy tồn đã tránh; webhook chịu được vì việc ngắn; hóa đơn phải thiết kế theo khuôn đẩy tồn. Lên bản pg-boss thì đo lại hai bài ở mục 4.5 trước khi tin.
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

---

## 7. Sổ việc làm sau

Ghi ngày 02/10/2026. Việc nào xong thì gạch ở đây và ghi kết quả vào mục tương ứng.

| Việc | Khi nào làm | Lúc đó làm gì |
|---|---|---|
| Kiểm webhook Lazada và đẩy tồn Lazada bằng số liệu thật | **Khi có khách ủy quyền gian Lazada có đơn thật** (anh Trung chốt 02/10). Hiện `webhook_events` nguồn LAZADA là 0 dòng kể từ bước 1 | Đếm sự kiện Lazada trong `webhook_events`. Gian có đơn mới mà không có sự kiện thì kiểm cấu hình đẩy sự kiện của app ISV 142085 trên Lazada Open Platform. Theo một đơn đi trọn đường: nhận → ghi đơn → trừ kho → tồn lên các gian khác. Xem một lượt đẩy tồn lên chính gian Lazada |
| Đo lại độ trễ `evt.order` trên prod | Khi `webhook_events` có vài nghìn sự kiện | Lấy trễ lớn nhất và số dòng trễ trên 30 giây (bỏ hai dòng sửa tay 01/10). Tỷ lệ cao hơn hẳn số đo ở mục 4.5 thì trình phương án sửa |
| Thời hạn chờ lệnh gọi sàn | 04–06/10, sau khi có 3–5 ngày số đo `[SanHTTP]` | Trình con số kèm phân bố thật, rồi bật `PLATFORM_HTTP_TIMEOUT_MS` |
| Bước 5 (hóa đơn) | Anh Trung duyệt 02/10; làm theo 14 lát ở mục 4.6 F, mỗi lát commit và đẩy riêng | Lát 2 chờ câu đọc trên prod (mục 4.6 C) và trình migration |
| ~~Mã tham chiếu của hóa đơn đã bị XÓA bên MISA có dùng lại được không~~ | ✅ MISA trả lời 02/10 15:34, đọc 03/10 (mục 4.6 N) | Tờ đã phát hành không xóa được → ca này không có trên prod. Phần còn lại của trả lời đã thành lát 6c |
| Gom 20–30 tờ một lệnh phát hành (MISA 02/10: "lý tưởng", tối đa 50) | Lát 8–9 của bước 5 (làn theo shop, hàng loạt chạy nền) | Hợp đồng adapter thêm `createInvoices(lô)` tùy bảng khả năng; một tờ một lệnh vẫn đúng, chỉ chậm (20–40 tờ/phút/ký hiệu). Trình anh số đo thật trước khi làm |
| Hạn mức gọi API của MISA | Khi MISA bật lại (ticket 02/10: "sẽ bật lại sớm", tài liệu sẽ ghi số theo từng API) | Dòng `[NccHTTP] QUA TAI` xuất hiện là lúc có số thật; đọc tài liệu MISA, điền vào mục D, cân lại 2 shop cùng lúc |
| Bước 6 (dọn) | Ba đợt, mốc ở mục 4.7: 6a thời hạn chờ 04–06/10; 6b webhook và đẩy tồn từ 09/10; 6c hóa đơn sau bước 5 một tuần | Danh sách tệp phải gỡ, câu đọc điều kiện và 3 điểm cần chốt ở mục 4.7 |
| Hóa đơn của chính Hubsell trên HQ: chưa có xử lý "chưa rõ kết quả" | Khi Hubsell bắt đầu xuất hóa đơn cho khách qua HQ | `routes/admin.ts` gọi thẳng `publishStandardInvoice`, không qua adapter: đứt mạng sau khi gửi thì báo lỗi, bấm lại sẽ gặp lỗi trùng mã mà không tự nối số (mục 4.6 K). Cho đi qua adapter hoặc thêm bước tra ngược |
| Tự phát hành: mốc "đã xét tới ngày nào" cho từng shop | Khi có shop phát hành hàng nghìn hóa đơn mỗi ngày | Hiện mỗi lượt đi lại qua mọi đơn đã giao kể từ ngày bật (mục 4.6, bảng A điểm 8) |
| Tự phát hành: đơn lỗi vĩnh viễn được thử lại mỗi ngày không dừng | ✅ Lát 7 của bước 5 (mục 4.6 O, 03/10) | Dừng tự thử sau 3 lượt lỗi riêng đơn, để chủ shop xuất tay |
| Tự phát hành: lỗi TẠM (NCC bận, 429, đứt mạng) vẫn làm đơn nghỉ 24 giờ như lỗi riêng đơn | Lát 8 (làn theo shop: thử lại sau 1 phút, 3 lượt) | Lát 7 chỉ không ĐẾM lỗi tạm; cửa sổ 24 giờ của đường cũ giữ nguyên |
| Trang Hàng chờ xuất hóa đơn đếm ba lần trên mọi đơn đã giao của shop | Khi đụng lại trang đó | Ba câu đếm kèm điều kiện "chưa có hóa đơn" nặng dần theo số đơn (thấy khi đọc `routes/tax.ts` 02/10, chưa đo) |
| Thử hai tiến trình worker chạy cùng lúc | Trước khi thêm worker thứ hai trên prod | Kiểm "một gian không hai tiến trình cùng đẩy" và độ trễ `evt.order` với hai worker thật |
| Chỉ mục cho lưới quét đẩy tồn | Khi `stock_push_jobs` thường xuyên dồn hàng chục nghìn dòng | Thêm chỉ mục để lấy danh sách gian có dòng tới hạn mà không đọc mọi dòng (đổi database, trình SQL trước) |
| Rút nhịp 60 giây của pg-boss (`monitorIntervalSeconds`, `queueCacheIntervalSeconds`) | Chỉ khi số đo prod cho thấy hệ quả 2 đáng kể | Đo chi phí của phần giám sát trên database trước; chưa đo |
| Gian TikTok bật đồng bộ tồn nhưng app chưa có quyền sửa sản phẩm | Khi TikTok duyệt quyền, hoặc anh Trung chốt tắt đồng bộ gian đó | Hiện mỗi lượt đẩy lên gian này hỏng sau 3 lượt và ra cảnh báo; đối soát 6 giờ xếp lại 99 SKU mỗi lượt (thấy trên prod 02/10) |
| Hai chỗ còn ghi dòng chờ đẩy sau commit | Khi đụng lại các route đó | Đổi tồn an toàn / ngưỡng của một SKU, các nút đẩy cả gian / cả shop (mục 4.5, "Chưa làm") |
