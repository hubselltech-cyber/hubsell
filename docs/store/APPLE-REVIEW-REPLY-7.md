# Lần 7 — Apple 5.1.1(i) + 5.1.2(i): "share personal data with a third-party AI service" (15/10/2026)

Bối cảnh: submission `6b88b07c…` (build 1.0 (10) + 20 IAP). Apple xem 15/10 trên iPhone 17 Pro
Max, trả lời 15/10 13:25 (giờ VN), sau hơn 3 giờ In Review (6 lần trước chỉ ~14 phút).
**KHÔNG còn 2.1(b) IAP, KHÔNG còn 3.1.1** → bước thanh toán đã qua. 20 IAP vẫn "Ready for Review".
Lời Apple:

> The app appears to share the user's personal data with a third-party AI service but the app
> does not clearly explain what data is sent, identify who the data is sent to, and ask the
> user's permission before sharing the data. […]
> If the app does not send user data to a third-party AI service or does not include a
> third-party AI service, reply to this rejection to confirm and add this information to the
> App Review Information section of App Store Connect.

## Gốc (đã rà mã 15/10, không phỏng đoán)

Thứ người duyệt nhìn thấy: màn **Trợ lý Hubsell** (orb nổi ở Trang chủ → modal chat) có
**huy hiệu "AI"** cạnh tên (`hubsell-mobile/src/app/assistant.tsx` dòng 193) + nút micro
"Hỏi bằng giọng nói". Họ suy ra app gửi câu hỏi/giọng nói cho một dịch vụ AI bên ngoài.

Sự thật trong mã:

| Thành phần | Thực tế |
|---|---|
| `POST /api/assistant/ask` (`backend/src/routes/assistant.ts`) | **Tầng luật thuần**: chấm điểm từ khóa không dấu → template + số thật từ Prisma. Không import SDK AI nào, không gọi HTTP ra ngoài. Câu "tại sao/so sánh" trả lời thẳng "chưa hỗ trợ". |
| Giọng nói (`expo-speech-recognition`) | Dùng **Speech framework của iOS** (nhận dạng của máy, chuỗi xin quyền đã ghi rõ "nhận dạng giọng nói của máy"). App chỉ nhận chuỗi chữ, không ghi âm, không gửi âm thanh đi đâu. |
| Bản dựng mobile (`hubsell-mobile/package.json`) | Không có SDK OpenAI/Anthropic/Google AI/ML nào. |
| Nơi DUY NHẤT backend gọi Anthropic | (1) `integrations/ai/copilot.ts` — gợi ý trả lời CSKH, chỉ ở web, **đã ẩn từ 12/10** (4 cờ), mobile không có đường gọi; (2) `invoice/input-invoice-reader.ts` — đọc hóa đơn đầu vào của **chính công ty Hubsell** ở HQ, không đụng dữ liệu khách. |
| Chính sách bảo mật `/privacy` mục 5 | Liệt kê đủ bên xử lý phụ, và nói rõ: "Nếu tương lai Hubsell bật tính năng trợ lý sử dụng mô hình ngôn ngữ của nhà cung cấp bên ngoài, chúng tôi cập nhật mục này và thông báo trước khi bật." → đúng sự thật hiện nay. |
| Thiếu | `/privacy` chưa có đoạn nào về **ứng dụng di động** (camera, ảnh, micro, Face ID) — LISTING.md mục 9 đã soạn từ 01/10, chờ anh duyệt. Apple chưa bắt, nhưng 5.1.1(i) đòi "identify what data the app collects" → bổ sung luôn cho chắc. |

Kết luận: **app không gửi dữ liệu người dùng cho dịch vụ AI bên thứ ba**. Apple đã mở sẵn
đường: trả lời xác nhận + ghi vào App Review Information → Resubmit **không cần build mới**.

## Phương án

**A: giữ build 1.0 (10), trả lời + ghi chú + Resubmit.** Đúng lối Apple chỉ. Rủi ro:
người duyệt vẫn nhìn huy hiệu "AI" và không tin → nếu bị trả lần 8 cùng lý do thì sang B.

**B (ANH CHỐT 15/10 ~14h: "bỏ luôn chữ AI đi rồi giải thích với họ"): build 1.0 (11) bỏ hẳn huy hiệu "AI"** ở header màn Trợ lý (`assistant.tsx`) + trả lời như A. Thêm
~40 phút (EAS build + submit + Apple xử lý) và review lại từ đầu bản dựng mới.

Em đề xuất A trước vì (1) Apple nói rõ "reply to confirm" là đủ, (2) mỗi lần đổi build là
đổi thứ người duyệt đã xem qua, (3) huy hiệu "AI" trùng nhận diện với web.

## Thư trả lời (Reply to App Review) — tiếng Anh, đã sẵn

```
Hello,

Thank you for the review. We confirm that the app does NOT send any user data to a
third-party AI service and does NOT include any third-party AI service or SDK.

What the reviewer likely saw is the "Hubsell Assistant" screen (chat bubble on the Home tab),
which in build 1.0 (10) carried a small "AI" label next to its name. That label was only a
product nickname; to avoid any confusion we have removed it in build 1.0 (11). This assistant is built and hosted entirely by us:

- Questions typed or spoken by the user are sent only to our own backend
  (api.hubsell.vn, operated by Hubsell Technology Co., Ltd.), where a rule-based engine
  matches keywords and returns the user's own sales figures from our database. No large
  language model or external AI provider is involved; the app binary contains no AI/ML SDK.
- The voice button uses the iOS Speech framework (on-device speech recognition provided by
  Apple, declared via NSSpeechRecognitionUsageDescription and NSMicrophoneUsageDescription).
  The app receives only the recognized text; audio is never recorded, stored, or sent to
  any third party.

Our privacy policy (https://hubsell.vn/privacy, section 5) lists every sub-processor we use
and explicitly states that no external language-model provider is in use today, and that
users will be notified before any such feature is ever enabled. We have also added a
"Mobile app" paragraph describing the camera, photo library, microphone/speech recognition
and Face ID permissions the app requests.

We have added this confirmation to the App Review Information notes as requested, and
submitted build 1.0 (11) with the "AI" label removed.

Thank you for your help.
Hubsell team
```

## Đoạn thêm vào App Review Information → Notes (ghi thêm vào CUỐI ghi chú hiện có)

```
--- Third-party AI (added Oct 15, 2026 after 5.1.1(i)/5.1.2(i) feedback) ---
The app does NOT use or send data to any third-party AI service. The "Hubsell Assistant"
(chat screen; the former "AI" label was removed in build 1.0 (11)) is our own rule-based query engine running on our backend
(api.hubsell.vn): it matches keywords and returns the user's own sales numbers from our
database. No LLM / external AI provider, no AI SDK in the binary. Voice input uses Apple's
iOS Speech framework (on-device recognition); only the recognized text is sent to our
backend, audio is never stored or shared. Privacy policy: https://hubsell.vn/privacy
(section 5 lists all sub-processors; "Mobile app" paragraph in section 3).
```

## Thứ tự làm (ai làm gì) — theo B

0. **Claude**: bỏ huy hiệu "AI" (`hubsell-mobile/src/app/assistant.tsx`), tsc, `eas build -p ios --profile production` → build 1.0 (11) → `eas submit --latest`; trên ASC đổi build của bản 1.0 sang (11).

1. **Claude**: sửa `/privacy` landing — thêm đoạn "Ứng dụng di động" vào cuối mục 3 (câu chữ
   LISTING.md mục 9, bỏ dòng thư viện ảnh/tin nhắn vì CSKH chat đã ẩn 12/10 — vẫn giữ vì
   app.json vẫn xin quyền ảnh; xem bản cuối trong file). Đổi `updatedAt` → 15/10/2026.
   **Anh push** landing (Vercel ~2 phút) TRƯỚC khi gửi thư, vì thư dẫn link.
2. **Claude** (qua Chrome, sau khi anh gật): dán đoạn Notes ở trên vào App Review Information
   → Save; gửi thư Reply ở trên lên thread `6b88b07c…`.
3. **Anh bấm**: "Resubmit to App Review" (nút trên trang submission; bộ lọc của Claude chặn
   nút nộp). KHÔNG đổi build, KHÔNG chạy SQL reviewer@ (vẫn để hết hạn như lần 7).
4. Theo dõi: In Review lần này sẽ nhanh vì chỉ xem lại 1 điểm. Nếu trả lần 8 cùng 5.1.1 →
   làm B (bỏ huy hiệu "AI", build 11).
