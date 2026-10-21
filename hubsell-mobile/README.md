# Hubsell Mobile (Expo)

App điện thoại của Hubsell — một bản dựng cho cả iOS và Android (Expo Router,
NativeWind). Gọi cùng backend với app web (`EXPO_PUBLIC_API_URL` trong `.env`).
Luồng phát hành, hồ sơ store và thư trả Apple: `../docs/store/`.

## Chạy local

```bash
npm install
npx expo start
```

Chạy trên web để chụp ảnh/thử nhanh (kèm proxy HTTPS tới backend local):

```bash
npm run web
```

## Cấu trúc

```
src/
├── app/          # màn hình theo file-based routing (Expo Router)
├── screens/      # màn hình lớn tách khỏi route
├── components/   # thành phần dùng chung
├── api/ auth/    # gọi API + phiên đăng nhập (Google / Apple / email)
├── plan/         # trần gói, mua gói trong app (IAP)
└── theme/ lib/ types/
scripts/
├── asc-release.mjs · asc-cancel-rename.mjs   # App Store Connect qua API (khóa EXPO_ASC_*)
├── play-status.mjs · play-release-notes.mjs  # Google Play qua API (service account)
└── dev-proxy.js                              # proxy backend local cho bản web
```

## Dựng & nộp store

- `eas.json` giữ 3 profile; `.easignore` ở GỐC repo (EAS đóng gói từ gốc kho git).
- Khóa nộp store (`google-play-service-account.json`, `asc-api-key*.p8`) nằm cạnh
  `app.json` nhưng đã gitignore — không bao giờ commit.
- Bản dựng tải về để kéo tay lên Play Console: `build-artifacts/` (gitignore).

Chi tiết từng lần nộp, lý do Apple từ chối và cách trả lời: `../docs/store/DUA-APP-LEN-CH-PLAY-APP-STORE.md`.
