/**
 * Nhận biết trình duyệt NHÚNG trong app mạng xã hội (TikTok, Facebook, Messenger,
 * Instagram, Zalo, Line) qua user agent.
 *
 * Vì sao (12/11/2026): Google chặn đăng nhập OAuth trong webview nhúng từ
 * 30/09/2021 (lỗi 403 disallowed_useragent). Quảng cáo TikTok 09–10/11 có 423
 * lượt bấm về /login mà 0 đăng ký — người bấm nút Google bị chặn cứng. Trong
 * webview thì ẩn nút Google, chỉ còn đường đăng ký bằng email.
 *
 * Trả về tên app để câu nhắc nói đúng chỗ khách đang đứng; null = trình duyệt thường.
 */
const IN_APP_PATTERNS: Array<[RegExp, string]> = [
  // TikTok: "musical_ly" (bản quốc tế), "trill" (bản cũ), "BytedanceWebview".
  [/musical_ly|trill_|BytedanceWebview|\bTikTok\b/i, "TikTok"],
  [/\bMessenger\b|FB_IAB\/MESSENGER/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/Zalo/i, "Zalo"],
  [/\bLine\//i, "Line"],
];

export function detectInAppBrowser(userAgent: string): string | null {
  for (const [re, name] of IN_APP_PATTERNS) {
    if (re.test(userAgent)) return name;
  }
  return null;
}
