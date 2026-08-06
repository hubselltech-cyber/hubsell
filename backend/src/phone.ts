// ============================================================
// CHUẨN HOÁ SỐ ĐIỆN THOẠI VỀ E.164 — nguồn duy nhất cho mọi chỗ lưu/gửi SĐT.
//
// FE gửi 2 trường rời: countryCode (ISO alpha-2, vd "VN") + phoneNumber số
// trong nước (vd "0912345678" hoặc "912345678"). Backend ghép thành E.164
// "+84912345678" TRƯỚC KHI lưu DB — để sau này gửi OTP SMS/WhatsApp (Twilio,
// Zalo ZNS...) dùng thẳng, không phải đoán mã vùng từng user.
//
// Quy tắc: bỏ mọi ký tự không phải số → bỏ trunk prefix "0" đầu (chuẩn của
// VN/EU khi quay quốc tế) → prepend dial code. E.164 tối đa 15 chữ số kể cả
// mã vùng, tối thiểu lấy 6 số nội địa (nước nhỏ nhất vẫn ≥ 5-6 số).
// ============================================================

/** Dial code theo ISO alpha-2 — GIỮ ĐỒNG BỘ với frontend/src/lib/countries.ts. */
const DIAL_CODES: Record<string, string> = {
  VN: "84", AF: "93", EG: "20", IE: "353", IN: "91", GB: "44", AR: "54",
  AT: "43", SA: "966", AE: "971", PL: "48", BD: "880", BE: "32", BY: "375",
  PT: "351", BR: "55", BN: "673", BG: "359", KH: "855", CA: "1", CL: "56",
  CO: "57", CZ: "420", DK: "45", TW: "886", DE: "49", NL: "31", KR: "82",
  US: "1", HK: "852", HU: "36", GR: "30", ID: "62", IL: "972", IT: "39",
  JP: "81", KZ: "7", KE: "254", LA: "856", MO: "853", MY: "60", MA: "212",
  MX: "52", MM: "95", NO: "47", ZA: "27", NZ: "64", RU: "7", NG: "234",
  FR: "33", PH: "63", FI: "358", PK: "92", QA: "974", RO: "40", SG: "65",
  ES: "34", TH: "66", TR: "90", SE: "46", CH: "41", CN: "86", AU: "61",
  UA: "380",
};

/**
 * Ghép countryCode + số trong nước thành E.164. Trả `{ value }` khi hợp lệ,
 * `{ error }` tiếng Việt khi không — cùng convention với normalizeUsername.
 *
 * formatE164("VN", "0912345678")  → { value: "+84912345678" }
 * formatE164("VN", "912 345 678") → { value: "+84912345678" }
 * formatE164("US", "(415) 555-2671") → { value: "+14155552671" }
 */
export function formatE164(
  countryCode: unknown,
  phoneNumber: unknown
): { value?: string; error?: string } {
  if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    return { error: "Vui lòng nhập số điện thoại" };
  }
  const dial =
    typeof countryCode === "string"
      ? DIAL_CODES[countryCode.trim().toUpperCase()]
      : undefined;
  if (!dial) return { error: "Mã quốc gia không hợp lệ" };

  // Người dùng có thể dán cả "+84 912..." — nếu đã có dial code ở đầu thì
  // không ghép trùng lần nữa.
  const digits = phoneNumber.replace(/\D/g, "");
  const startedWithPlus = phoneNumber.trim().startsWith("+");
  const national = startedWithPlus && digits.startsWith(dial)
    ? digits.slice(dial.length)
    : digits.replace(/^0+/, ""); // bỏ trunk prefix "0"

  if (national.length < 6 || dial.length + national.length > 15) {
    return { error: "Số điện thoại không hợp lệ" };
  }
  return { value: `+${dial}${national}` };
}
