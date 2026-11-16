# Trang thử quay video đóng hàng bằng webcam

Trang thử nội bộ, **không phải mã sản phẩm**. Mục đích: chứng minh từng bước rằng Chrome trên Windows quay được video đóng hàng từ webcam USB, trước khi viết tính năng thật. Trang chia thành năm "cửa", mỗi cửa một nút, một nhãn Đạt / Không đạt / Chưa chạy / Không hỗ trợ và các con số đo được.

Không có bước build, không framework: HTML + ES module thuần, máy chủ tĩnh viết bằng Node không phụ thuộc gì.

## Cách chạy

```powershell
cd "D:\Claude Code\Hubsell\tools\thu-webcam"
npm ci --cache "D:\HubsellVideo\.cache-thu\npm"
node server.mjs --port 4321 --out "D:\HubsellVideo\.cache-thu\webcam-out"
```

Mở `http://127.0.0.1:4321/` bằng Chrome thật (phải là `127.0.0.1` hoặc `localhost` thì Chrome mới cho dùng camera), bấm **Mở camera và đo** rồi cho phép dùng camera.

- `--port` mặc định 4321, `--out` mặc định `./out` (đã nằm trong `.gitignore`).
- Máy chủ chỉ nghe trên `127.0.0.1`, từ chối yêu cầu có `Host` / `Origin` lạ, không liệt kê thư mục, chặn đường dẫn thoát ra ngoài thư mục.
- `POST /save?name=<tên>` ghi nguyên thân yêu cầu vào `<out>/<tên>`; tên chỉ giữ `[A-Za-z0-9._-]` (ký tự khác đổi thành `_`), tối đa 600 MB; trả `{ ok, path, bytes, name }`.
- `GET /list` trả danh sách tệp trong `<out>` kèm dung lượng. `GET /out/<tên>` xem lại tệp đã lưu (có hỗ trợ Range để tua).

## Các ô cài đặt

| Ô | Ý nghĩa |
| --- | --- |
| Camera | "Tự chọn" ưu tiên thiết bị có tên chứa "Web Camera". Cuối danh sách có **Camera giả** (xem bên dưới). |
| Độ phân giải | 1280×720, 1920×1080, 2560×1440 |
| Khung hình/giây | 15 hoặc 30 |
| Bitrate video | mặc định 800 000 bps |
| Cách lấy khung hình | `MediaStreamTrackProcessor` (mặc định khi có) hoặc `requestVideoFrameCallback`. Ô này thêm ngoài đề bài để so hai cách lúc tab bị ẩn. |
| Số giây mỗi lần thử | thời lượng mỗi lần quay |
| In ngày giờ vào hình | bật / tắt để so chi phí |
| Thu tiếng | mặc định tắt |

## Năm cửa

### Cửa 1 – mở camera

`getUserMedia` với độ phân giải và tốc độ khung đã chọn, hiện hình xem trước, báo `track.getSettings()` (rộng, cao, tốc độ khung, deviceId, tên) và **tốc độ khung đo thật** trong N giây bằng `requestVideoFrameCallback`. Kèm bảng API: `'BarcodeDetector' in window`, `typeof VideoEncoder`, `MediaRecorder.isTypeSupported` cho năm kiểu tệp, và `VideoEncoder.isConfigSupported` H.264 cho ba độ phân giải (tự chọn / phần cứng / phần mềm).

Đạt khi: khung thật đúng độ phân giải yêu cầu và tốc độ đo được ≥ 90 % tốc độ yêu cầu.

### Cửa 2 – quay ra tệp, hai đường

- **Đường A – MediaRecorder.** Dùng kiểu đầu tiên trình duyệt nhận trong danh sách `video/mp4;codecs=avc1.42E01E`, `video/mp4;codecs=avc1.640028`, `video/mp4`, `video/webm;codecs=h264`, `video/webm;codecs=vp9`. Lùi về WebM thì ghi rõ. Lưu ý: MP4 do MediaRecorder của Chrome tạo là dạng **phân mảnh** (có `moof`), trang hiện cảnh báo này.
- **Đường B – WebCodecs.** `VideoEncoder` H.264 với bitrate đã chọn, `latencyMode: "realtime"`, một khung khóa mỗi giây, gói dạng AVCC (`avc: { format: "avc" }`). `mediabunny` ghép thành MP4 thường, tua được, `moov` nằm **đầu tệp** (`fastStart: "in-memory"`). Trang tự đọc lại thứ tự hộp cấp cao nhất của tệp (`ftyp moov mdat`) để xác nhận.

Mỗi đường báo: kiểu tệp, dung lượng, thời gian quay theo đồng hồ, số khung đã mã hóa, khung rớt (nếu biết), đường dẫn tệp đã lưu. MediaRecorder không cho biết số khung đã mã hóa nên ô đó ghi "không biết".

Đạt khi: tệp lưu được và khác rỗng; riêng đường B còn cần `moov` trước `mdat` và số khung mã hóa ≥ 80 % số khung lẽ ra phải có.

### Cửa 3 – ngày giờ trong hình

Cả hai đường quay đều lấy hình từ một canvas vẽ từng khung camera cộng ngày giờ `dd/MM/yyyy HH:mm:ss` ở **góc trên bên trái**: chữ trắng đơn cách trên hộp tối mờ, hộp cao 3,5 % chiều cao khung hình. Chỉ có ngày và giờ, không chữ nào khác.

Nút của cửa này quay hai lần liên tiếp (có và không có ngày giờ) rồi báo chi phí vẽ canvas trung bình mỗi khung, tách riêng phần chép hình camera và phần vẽ hộp + chữ. Sau khi quay, trang đọc lại vùng hộp trên canvas một lần để tự kiểm có chữ trắng trên nền tối.

**Tắt ngày giờ = không qua canvas**: MediaRecorder quay thẳng luồng camera, WebCodecs đưa thẳng khung camera vào bộ mã hóa. Nhờ vậy con số so sánh là chi phí thật của cả chặng canvas, không chỉ riêng mấy chữ.

Lưu ý khi đọc số: `drawImage` trên canvas tăng tốc bằng GPU chỉ đo được thời gian gửi lệnh, phần GPU làm thật không nằm trong con số này. Vì vậy trang còn so số khung và thời gian mã hóa giữa hai lần.

Đạt khi: tự kiểm vùng hộp đúng, vẽ trung bình ≤ một nửa khoảng cách giữa hai khung, và lần có ngày giờ giữ được ≥ 90 % số khung so với lần không có.

### Cửa 4 – đọc mã tem lúc đang quay

Trong lúc quay, cứ 200 ms lấy **khung gốc đủ độ phân giải** của camera (chưa có ngày giờ), thử đọc Code 128 và QR. Mỗi lần đọc được đều ghi nhật ký: giờ, loại mã, giá trị, số mili giây. Bộ đếm: số lần thử, số lần đọc được, thời gian trung bình và lớn nhất. Khung bao vẽ lên lớp phủ của ô xem trước, **không bao giờ** vẽ vào canvas quay.

- Có `BarcodeDetector` của trình duyệt và nó nhận cả `code_128` lẫn `qr_code` thì dùng. Chrome trên Windows thường không có, khi đó dùng ponyfill `barcode-detector` (zxing-wasm).
- **Việc đọc mã chạy trong Worker** (`modules/scan-worker.js`): luồng chính chỉ `createImageBitmap(khung)` rồi chuyển quyền sở hữu ảnh sang Worker, nên không làm giật đường quay. Worker không khởi động được thì tự lùi về luồng chính và ghi rõ trong kết quả. Muốn so chi phí, gọi `__thu.run.resetScanner({ forceMainThread: true })`.
- Tệp `.wasm` lấy từ `/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm` trên máy chủ thử (dùng `prepareZXingModule` với `locateFile`), không gọi ra mạng.
- Lần đọc trước chưa xong thì bỏ lượt, không xếp hàng (đếm ở "bỏ lượt").

Đạt khi: giữ được ≥ 70 % nhịp 200 ms, không lỗi, và đọc được ít nhất một mã (phải đưa tem ra trước camera).

### Cửa 5 – tự cắt clip theo tem

Máy trạng thái, chạy trên đường WebCodecs:

- **Nghỉ** → thấy một mã *trông giống mã vận đơn* ở 2 lần đọc liên tiếp → bắt đầu clip mang tên mã đó, kêu "ting-ting".
- **Đang quay A** → thấy mã hợp lệ B khác A ở 2 lần đọc liên tiếp → kết thúc và lưu clip A, quay ngay clip B.
- Thấy mã **đã có clip trong phiên này** → không mở clip mới, hiện "Tem này đã quay rồi", kêu "boop-boop".
- Nút **Dừng** kết thúc clip đang quay, về trạng thái nghỉ (vẫn tiếp tục đọc mã). Nút **Tắt tự cắt** dừng hẳn và chấm điểm cửa.

Mã trông giống mã vận đơn: sau khi cắt khoảng trắng dài 8–30 ký tự, chỉ gồm A–Z và 0–9, có ít nhất 6 chữ số, không phải đường link. Mọi mã khác bị bỏ qua.

Báo cáo: với mỗi lần cắt, số mili giây từ lúc quyết định tới khung đầu của clip mới; danh sách mọi clip (mã, số giây, dung lượng, đường dẫn).

Đạt khi: lưu được ít nhất 2 clip, có ít nhất 1 lần cắt, mọi lần cắt ≤ 200 ms, mọi clip có `moov` trước `mdat` và bắt đầu đúng khung khóa, không mã nào bị quay hai lần.

#### Cách cắt (quyết định thiết kế chính)

**Một bộ mã hóa chạy xuyên suốt, không dừng, không cấu hình lại khi cắt.** Xem `modules/wc-pipeline.js`.

1. Lúc quyết định cắt, trang chỉ ghi nhớ "clip mới đang chờ".
2. Khung camera kế tiếp được đưa vào bộ mã hóa với `keyFrame: true`; dấu thời gian của khung đó là ranh giới.
3. Khi gói H.264 mang dấu thời gian ranh giới đi ra khỏi bộ mã hóa (nó là khung khóa), các gói trước đó thuộc clip cũ, gói này trở đi thuộc clip mới. Clip cũ được ghép MP4 và lưu ở nền; clip mới mở một `Output` mediabunny mới, dấu thời gian dời về 0, gói đầu kèm lại `decoderConfig` (chứa avcC) mà bộ mã hóa đưa lúc đầu.

Hệ quả: không mất và không lặp khung nào giữa hai clip (khung cuối của clip A và khung đầu của clip B là hai khung camera liền nhau), độ trễ cắt chỉ là thời gian chờ khung camera kế tiếp (tối đa một khoảng khung, khoảng 33 ms ở 30 khung/giây). Trang báo thêm "quyết định → gói đầu ra khỏi bộ mã hóa" để thấy độ trễ mã hóa.

Lúc nghỉ giữa hai clip, bộ mã hóa vẫn mở nhưng không được đưa khung (không tốn CPU); clip kế tiếp bắt đầu bằng khung khóa ngay ở khung camera đầu tiên.

Nếu bộ mã hóa không trả khung khóa đúng chỗ cắt, trang ghi cảnh báo, chờ khung khóa kế tiếp rồi mới chuyển tệp, và đánh dấu clip đó.

#### Mấy điểm tự quyết ngoài đề bài

- **Tem có nhiều mã hợp lệ.** Nếu mã đang quay vẫn còn trong hình thì coi như chưa đổi kiện, dù có thấy thêm mã khác. Nếu không, chọn cố định một mã: ưu tiên Code 128, rồi mã dài hơn, rồi theo thứ tự chữ. Đây là phỏng đoán; mã nào trên tem của từng hãng mới là mã vận đơn cần đối chiếu tem thật.
- **Tem đã quay vẫn nằm trong hình** thì chỉ nhắc "Tem này đã quay rồi" mỗi 3 giây một lần cho cùng một mã, không kêu liên tục.
- **Clip hỏng** (không lưu được) không bị tính là "đã quay", tem đó được quay lại.
- "2 lần đọc liên tiếp" tính chặt: một lần đọc không ra mã hợp lệ nào xen giữa là đếm lại từ đầu.

## Tab bị ẩn

Trang ghi nhật ký mọi sự kiện `visibilitychange`. Lúc tab hiện lại, trang ghi trong lúc ẩn: ô xem trước nhận bao nhiêu khung, đường quay nhận bao nhiêu khung, bộ mã hóa ra bao nhiêu gói, thử đọc mã bao nhiêu lần, và kết luận khung hình còn về hay không. Kết quả nằm ở `__thu.state.visibility.events`; trong lúc đang ẩn xem `__thu.state.visibility.sinceHidden`.

Khi quay qua `MediaStreamTrackProcessor`, việc đọc mã đi theo nhịp khung hình chứ không theo đồng hồ, nên không bị Chrome bóp đồng hồ của tab ẩn.

## Điều khiển bằng JavaScript

Mọi thứ nằm ở `window.__thu`:

- `__thu.state` – trạng thái và kết quả từng cửa, JSON thuần (`JSON.stringify(__thu.state)` chạy được). `state.gates[1..5]` có `status` (`not-run` / `running` / `pass` / `fail` / `unsupported`), `reason`, `result`. Cửa 2 có thêm `a` và `b`.
- `__thu.log` – mảng nhật ký `{ t, ms, level, msg, data? }`.
- `__thu.run.*` – hàm nào cũng trả Promise ra đối tượng JSON thuần, không ném lỗi; lỗi nằm ở `{ ok: false, error }`. Chưa mở camera thì các hàm quay trả `{ ok: false, notRun: true }` và không đụng vào kết quả cửa nào.

| Hàm | Việc |
| --- | --- |
| `gate1(seconds, opts)` | cửa 1 trọn gói: kiểm API, mở camera, đo tốc độ khung |
| `openCamera(opts)`, `closeCamera()`, `listCameras()`, `checkSupport()` | `opts`: `{ deviceId, fake, width, height, frameRate, audio }` |
| `measureFps(seconds)` | đo lại tốc độ khung |
| `recordMediaRecorder(seconds, opts)` | cửa 2A |
| `recordWebCodecs(seconds, opts)` | cửa 2B |
| `compareOverlay(seconds, opts)` | cửa 3; `opts.path` = `'webcodecs'` (mặc định) hoặc `'mediarecorder'` |
| `recordWithScan(seconds, opts)` | cửa 4; `opts.path` như trên |
| `startAuto(opts)`, `finishClip()`, `stopAuto()` | cửa 5; `opts.confirmReads`, `opts.repeatNoticeMs` |
| `injectRead(code, { format, times })` | giả lập lần đọc mã cho máy trạng thái (không cần tem thật) |
| `resetScanner({ forceMainThread, forcePonyfill })` | khởi động lại bộ đọc mã theo cách khác |
| `fakeShowCode(code, format)` | camera giả: đưa mã ra trước ống kính; `code` rỗng = cất đi |
| `setOptions(opts)`, `getOptions()`, `listFiles()`, `playSound(kind)`, `looksLikeTracking(code)`, `snapshot()` | tiện ích |

`opts` của các hàm quay nhận thêm `{ overlay, bitrate, pump, scan, hardwareAcceleration, name }` để ghi đè ô cài đặt cho riêng lần đó.

## Camera giả

Chọn **Camera giả** trong ô Camera (hoặc `openCamera({ fake: true })`) để chạy cả năm cửa khi không có camera hay chưa cấp được quyền. Đó là một canvas tự vẽ phát qua `captureStream()`, có thể "đưa tem ra" bằng `fakeShowCode('SPXVN0123456789')` (mã vạch tạo bằng phần ghi mã của zxing-wasm, tệp `.wasm` cũng lấy tại chỗ).

Camera giả chỉ để kiểm đường đi của mã. **Không dùng nó để kết luận về camera thật**: tốc độ khung, độ nét mã vạch, hành vi lúc tab ẩn đều khác.

## Ngưỡng đạt / không đạt

Mọi ngưỡng (90 % tốc độ khung, 80 % số khung, nửa khoảng khung cho việc vẽ, 90 % số khung khi có ngày giờ, 70 % nhịp đọc mã, 200 ms cho một lần cắt, hàng chờ bộ mã hóa tối đa 10 khung, nhắc lại tem cũ mỗi 3 giây) là **mặc định tự chọn cho trang thử**, không lấy từ tài liệu nào. Sáu ngưỡng chấm điểm nằm trong `THRESHOLDS` ở đầu `app.js` và hiện ở `__thu.state.thresholds`; hàng chờ bộ mã hóa là `MAX_ENCODE_QUEUE` trong `modules/wc-pipeline.js`; nhịp nhắc tem cũ là `repeatNoticeMs` của `startAuto`. Con số thô luôn được báo kèm để tự đánh giá lại.

## Thư viện

Cài bằng npm vào chính thư mục này, ghim đúng phiên bản trong `package.json`, nạp từ `/node_modules/...`, không dùng CDN.

| Thư viện | Phiên bản | Giấy phép | Dùng để |
| --- | --- | --- | --- |
| [mediabunny](https://mediabunny.dev/) | 1.66.0 | MPL-2.0 | ghép gói H.264 thành MP4 có `moov` đầu tệp |
| [barcode-detector](https://github.com/Sec-ant/barcode-detector) | 3.2.4 | MIT | ponyfill `BarcodeDetector` |
| [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) | 3.1.7 | MIT (lõi zxing-cpp: Apache-2.0) | đi kèm barcode-detector (phần đọc); trang chỉ gọi trực tiếp phần ghi mã cho camera giả |

MPL-2.0 là copyleft theo từng tệp: dùng nguyên bản thư viện thì không ràng buộc mã của mình; chỉ khi sửa tệp của mediabunny mới phải công bố phần sửa đó. Cần xem lại với bên pháp lý trước khi đưa vào sản phẩm.

Tệp nạp lúc chạy:

- `/node_modules/mediabunny/dist/bundles/mediabunny.mjs`
- `/node_modules/barcode-detector/dist/es/ponyfill.js`
- `/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm`
- `/node_modules/zxing-wasm/dist/es/writer/index.js` và `/node_modules/zxing-wasm/dist/writer/zxing_writer.wasm` (chỉ khi dùng camera giả)

## Các tệp

| Tệp | Việc |
| --- | --- |
| `server.mjs` | máy chủ tĩnh + `/save` + `/list` |
| `index.html`, `style.css` | giao diện |
| `app.js` | trạng thái, năm cửa, `window.__thu` |
| `modules/core.js` | nhật ký, bộ đếm, lưu tệp, đọc hộp MP4 |
| `modules/composer.js` | canvas ghép hình + ngày giờ |
| `modules/pump.js` | lấy từng khung camera (hai cách) |
| `modules/mr-recorder.js` | đường A – MediaRecorder |
| `modules/wc-pipeline.js` | đường B – WebCodecs + mediabunny, cắt clip |
| `modules/scanner.js`, `scan-worker.js`, `scan-core.js` | đọc mã |
| `modules/auto-cut.js` | máy trạng thái cửa 5 |
| `modules/sound.js` | ting-ting, boop-boop bằng Web Audio |
| `modules/fake-camera.js` | camera giả |
| `modules/ui.js` | vẽ giao diện từ state |

## Giới hạn đã biết

- `fastStart: "in-memory"` giữ cả clip trong RAM tới lúc kết thúc. Ở 800 000 bps một clip 5 phút khoảng 30 MB nên không sao với trang thử; bản sản phẩm cần cân nhắc lại cho clip dài.
- Tệp được gửi về máy chủ thử bằng một lần `POST` sau khi clip kết thúc; đóng tab giữa chừng là mất clip đang quay.
- Bộ mã hóa bận quá 10 khung trong hàng chờ thì khung mới bị bỏ (đếm ở "khung rớt do bộ mã hóa bận").
- Tiếng báo cần trang đã được bấm ít nhất một lần; nếu chỉ điều khiển bằng JavaScript thì `soundPlayed` có thể là `false`.
- Chỉ thu tiếng ở đường MediaRecorder; đường WebCodecs của trang thử chỉ có hình.

## Bổ sung 16/11/2026 (sau lần thử với webcam thật)

- **Thanh quay nhanh** ở đầu trang: nút "Bắt đầu quay" / "Dừng" + đồng hồ. Quay tay không cần tem; đang quay mà giơ tem vào camera thì tự cắt sang clip của tem.
- **Âm báo:** "ting-ting" mở clip · hai nốt đi xuống khi clip kết thúc · "boop-boop" tem đã quay rồi · ba hồi gắt khi mất camera.
- **Mất camera giữa chừng** (đã gặp thật: webcam cắm qua bộ chia USB tự rớt rồi nối lại): dải đỏ + báo động, lưu ngay clip đang quay, camera có lại thì tự mở lại và quay về chờ tem.
- **Mở camera lỗi `NotReadableError` / `AbortError`:** tự thử lại 6 lần, cách nhau 1,5 giây.
- **Nhật ký bền:** mỗi 10 giây ghi cả nhật ký của phiên ra `nhat-ky_<giờ mở trang>.txt` trong thư mục `--out`, để tải lại trang không mất dấu vết lỗi.
- Cách chạy trong dự án: mục `thu-webcam` của `.claude/launch.json` (cổng 4321, lưu clip ở `D:/HubsellVideo/.cache-thu/webcam-out`).

Kết quả đo và điều rút ra: `docs/VIDEO-DONG-HANG-THIET-KE.md` mục 13. Màn quay thật của sản phẩm nằm ở `frontend/src/lib/pack-video-recorder/` — trang này giữ lại làm THƯỚC ĐO để chấm webcam khác.
