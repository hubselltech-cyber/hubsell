# Video quảng cáo dọc — công cụ, giọng đọc, cách làm

Chốt 12/10/2026 sau video "Đơn hàng" (bản v3, 73 giây). Lần sau anh gọi làm video mới (tồn kho, tài chính…) thì đi theo trang này.

## Công cụ

| Việc | Dùng gì | Ghi chú |
|---|---|---|
| Dựng hình | **HyperFrames** (heygen-com/hyperframes, Apache-2.0) | Plugin Claude Code `hyperframes@hyperframes` (đã cài, phạm vi user). Video = HTML + GSAP, xuất MP4 bằng `npx hyperframes render`. Remotion là dự phòng nhưng công ty từ 4 người phải mua giấy phép. |
| Giọng đọc | **GenMax** (genmax.io, tài khoản của anh) | API `https://api.genmax.io`, header `xi-api-key`. Khóa nằm ở `C:\Users\trung\.genmax-key` (anh tự ghi, không đưa vào repo). |
| Phụ đề từng chữ | openai-whisper (đã cài) | Lấy mốc thời gian từng chữ của giọng đọc, chữ hiển thị lấy theo kịch bản. |
| Hiệu ứng âm thanh | ffmpeg tự tổng hợp (vút, bụp, tích tắc, trống, riser) | Không nhạc nền — anh tự chèn khi đăng. |

## Giọng đọc đã chốt

- ElevenLabs **eleven_v3**, giọng **Tung Dang** — voice_id `3VnrjnYrskPMDsapTr8X`.
- `voice_settings`: stability `0.5` (v3 chỉ nhận 0 / 0.5 / 1), similarity_boost `0.8`, speed `1.12` → khoảng 3,6 chữ/giây, đúng nhịp video GoSeller mẫu.
- Đã thử 12 giọng: giọng CapCut và MiniMax đọc sai tên sàn, nên loại.
- Chi phí: khoảng 1 credit/ký tự, cả video ~1.000–1.500 credit.

### Giọng cộng đồng GenMax (biết từ 16/10/2026)

- Trên app GenMax, mục "Xem giọng cộng đồng" là giọng clone MiniMax do người khác
  chia sẻ (vd **Ngọc Huyền - VBee**). API không ghi trong tài liệu nhưng app gọi
  `GET https://api.genmax.io/v1/community/voices?limit=100&offset=0&search=…`
  (header `xi-api-key`), mỗi giọng có `voice_id` dạng UUID + `provider: minimax`.
- Đọc bằng UUID đó như giọng clone của mình: `POST /v1/text-to-speech/{voice_id}`
  body `provider: "minimax"`, `model_id: "speech-02-hd"` (= "Speech 02 HD" trên app),
  `language_code: "Vietnamese"`, `voice_settings: { speed, pitch, vol }` → `GET /v1/history/{id}`
  tới `completed` → tải `result.audio_url`. ~1 credit/ký tự.
- Ngọc Huyền - VBee: `19725c22-f795-4fa1-bfc5-88c5a82f9440`, tốc độ 1.0 ≈ 17 ký tự/giây.
  Đọc đúng "Shopee", "Seller Center", "0 đơn" → "không đơn"; "Hubsell" nghe như
  "hấp-xeo". Số lẻ (0,95 · 1,1) nên viết bằng chữ ("không phẩy chín lăm").
- Đang dùng cho **tour Hướng dẫn sử dụng Trợ lý quảng cáo Shopee**
  (`frontend/scripts/generate-guide-voice.js`, mục `GENMAX`), các tour khác vẫn Hoài My (edge-tts).

## Phong cách anh đã chốt

- **Đánh tâm lý bán hàng, không phải vận hành**: mở bằng mong muốn kiếm thêm (thêm gian = thêm dòng tiền), rồi mới tới cái giá phải trả khi mở rộng, rồi Hubsell. Chốt bằng câu kiểu "Thêm gian, thêm đơn. Không thêm người."
- Mỗi video chỉ **một chủ đề** (đơn hàng riêng, kho riêng).
- Dài trên 1 phút cũng được.
- Luôn có **câu kéo bình luận** ở cuối.
- Khung 1080×1920, nền xanh đen `#07131a`, màu nhấn xanh thương hiệu `#19d38f`, đỏ `#ff5d4f` cho đoạn nỗi đau, font Be Vietnam Pro.
- Phụ đề hai tầng: câu trắng + câu nhấn màu, chữ sáng dần theo giọng.
- **Hiệu ứng âm thanh to** (anh sẽ chèn nhạc nền): trộn ở mức gain 6.4, và luôn xuất kèm file tiếng tách riêng (giọng / hiệu ứng / cả hai).
- Nội dung phải khớp nghiệp vụ thật: ví dụ in hỏa tốc thì gom cả ba sàn một lượt, còn đơn thường thì lọc theo sàn rồi in cho mọi gian của sàn đó.

## Các bước

1. Viết kịch bản, mỗi nhịp một câu.
2. Đọc từng nhịp qua GenMax, cắt khoảng lặng hai đầu.
3. Ghép thành một đường thời gian + lấy mốc từng chữ bằng Whisper.
4. Chỉnh giọng: lọc trầm, nâng 3 kHz, nén, chuẩn −14 LUFS.
5. Dựng HTML bằng một script sinh `index.html` từ mốc thời gian.
6. `npx hyperframes check` phải 0 lỗi, rồi `snapshot` soi khung hình.
7. Trộn giọng + hiệu ứng, `render -q delivery`, kiểm lại file MP4.

Bản làm việc (script gọi GenMax, ghép giọng, trộn tiếng, dự án HyperFrames từng bản) nằm ở `C:\Users\trung\Downloads\Hubsell-video-don-hang\` trên máy anh, không đưa vào repo.

## Bẫy đã gặp

- GSAP 3 không còn `className` → đổi lớp bằng `attr: { class }`.
- Đổi chữ theo mốc thời gian phải tính từ `tl.time()` trong `onUpdate` của timeline. Dùng tween riêng thì tween tạo sau ghi đè chữ ngay từ đầu.
- Con trỏ chuột minh họa phải tính vị trí bằng `offsetLeft/Top`, không dùng `getBoundingClientRect` (bị lệch bởi transform lúc dựng).
- Không đặt tên lớp CSS trùng nhau giữa phụ đề và cảnh (đã dính lỗi `.win`).
- Chạy Whisper trên Windows phải ép stdout UTF-8, không thì lỗi khi in tiếng Việt.
