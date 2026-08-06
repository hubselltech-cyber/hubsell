// ============================================================
// DANH MỤC QUỐC GIA (ISO 3166-1 alpha-2 + tên tiếng Việt + cờ + mã điện thoại)
//
// value lưu DB là `code` (alpha-2) — dial code chỉ để hiển thị; ISO mới là nền
// cho i18n/tiền tệ/thuế sau này. Việt Nam đứng đầu (thị trường chính), phần
// còn lại xếp ABC theo tên tiếng Việt. Danh sách gọn ~80 nước phủ mọi thị
// trường TMĐT đáng kể — thiếu nước nào thêm dòng là xong.
// ============================================================

export interface Country {
  /** ISO 3166-1 alpha-2 — giá trị lưu DB. */
  code: string;
  name: string;
  flag: string;
  dial: string;
}

export const COUNTRIES: Country[] = [
  { code: "VN", name: "Việt Nam", flag: "🇻🇳", dial: "+84" },
  { code: "AF", name: "Afghanistan", flag: "🇦🇫", dial: "+93" },
  { code: "EG", name: "Ai Cập", flag: "🇪🇬", dial: "+20" },
  { code: "IE", name: "Ai-len", flag: "🇮🇪", dial: "+353" },
  { code: "IN", name: "Ấn Độ", flag: "🇮🇳", dial: "+91" },
  { code: "GB", name: "Anh", flag: "🇬🇧", dial: "+44" },
  { code: "AR", name: "Argentina", flag: "🇦🇷", dial: "+54" },
  { code: "AT", name: "Áo", flag: "🇦🇹", dial: "+43" },
  { code: "SA", name: "Ả Rập Xê Út", flag: "🇸🇦", dial: "+966" },
  { code: "AE", name: "Các Tiểu VQ Ả Rập (UAE)", flag: "🇦🇪", dial: "+971" },
  { code: "PL", name: "Ba Lan", flag: "🇵🇱", dial: "+48" },
  { code: "BD", name: "Bangladesh", flag: "🇧🇩", dial: "+880" },
  { code: "BE", name: "Bỉ", flag: "🇧🇪", dial: "+32" },
  { code: "BY", name: "Belarus", flag: "🇧🇾", dial: "+375" },
  { code: "PT", name: "Bồ Đào Nha", flag: "🇵🇹", dial: "+351" },
  { code: "BR", name: "Brazil", flag: "🇧🇷", dial: "+55" },
  { code: "BN", name: "Brunei", flag: "🇧🇳", dial: "+673" },
  { code: "BG", name: "Bulgaria", flag: "🇧🇬", dial: "+359" },
  { code: "KH", name: "Campuchia", flag: "🇰🇭", dial: "+855" },
  { code: "CA", name: "Canada", flag: "🇨🇦", dial: "+1" },
  { code: "CL", name: "Chile", flag: "🇨🇱", dial: "+56" },
  { code: "CO", name: "Colombia", flag: "🇨🇴", dial: "+57" },
  { code: "CZ", name: "Cộng hoà Séc", flag: "🇨🇿", dial: "+420" },
  { code: "DK", name: "Đan Mạch", flag: "🇩🇰", dial: "+45" },
  { code: "TW", name: "Đài Loan", flag: "🇹🇼", dial: "+886" },
  { code: "DE", name: "Đức", flag: "🇩🇪", dial: "+49" },
  { code: "NL", name: "Hà Lan", flag: "🇳🇱", dial: "+31" },
  { code: "KR", name: "Hàn Quốc", flag: "🇰🇷", dial: "+82" },
  { code: "US", name: "Hoa Kỳ (Mỹ)", flag: "🇺🇸", dial: "+1" },
  { code: "HK", name: "Hồng Kông", flag: "🇭🇰", dial: "+852" },
  { code: "HU", name: "Hungary", flag: "🇭🇺", dial: "+36" },
  { code: "GR", name: "Hy Lạp", flag: "🇬🇷", dial: "+30" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩", dial: "+62" },
  { code: "IL", name: "Israel", flag: "🇮🇱", dial: "+972" },
  { code: "IT", name: "Ý (Italia)", flag: "🇮🇹", dial: "+39" },
  { code: "JP", name: "Nhật Bản", flag: "🇯🇵", dial: "+81" },
  { code: "KZ", name: "Kazakhstan", flag: "🇰🇿", dial: "+7" },
  { code: "KE", name: "Kenya", flag: "🇰🇪", dial: "+254" },
  { code: "LA", name: "Lào", flag: "🇱🇦", dial: "+856" },
  { code: "MO", name: "Macao", flag: "🇲🇴", dial: "+853" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾", dial: "+60" },
  { code: "MA", name: "Ma-rốc", flag: "🇲🇦", dial: "+212" },
  { code: "MX", name: "Mexico", flag: "🇲🇽", dial: "+52" },
  { code: "MM", name: "Myanmar", flag: "🇲🇲", dial: "+95" },
  { code: "NO", name: "Na Uy", flag: "🇳🇴", dial: "+47" },
  { code: "ZA", name: "Nam Phi", flag: "🇿🇦", dial: "+27" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿", dial: "+64" },
  { code: "RU", name: "Nga", flag: "🇷🇺", dial: "+7" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬", dial: "+234" },
  { code: "FR", name: "Pháp", flag: "🇫🇷", dial: "+33" },
  { code: "PH", name: "Philippines", flag: "🇵🇭", dial: "+63" },
  { code: "FI", name: "Phần Lan", flag: "🇫🇮", dial: "+358" },
  { code: "PK", name: "Pakistan", flag: "🇵🇰", dial: "+92" },
  { code: "QA", name: "Qatar", flag: "🇶🇦", dial: "+974" },
  { code: "RO", name: "Romania", flag: "🇷🇴", dial: "+40" },
  { code: "SG", name: "Singapore", flag: "🇸🇬", dial: "+65" },
  { code: "ES", name: "Tây Ban Nha", flag: "🇪🇸", dial: "+34" },
  { code: "TH", name: "Thái Lan", flag: "🇹🇭", dial: "+66" },
  { code: "TR", name: "Thổ Nhĩ Kỳ", flag: "🇹🇷", dial: "+90" },
  { code: "SE", name: "Thuỵ Điển", flag: "🇸🇪", dial: "+46" },
  { code: "CH", name: "Thuỵ Sĩ", flag: "🇨🇭", dial: "+41" },
  { code: "CN", name: "Trung Quốc", flag: "🇨🇳", dial: "+86" },
  { code: "AU", name: "Úc", flag: "🇦🇺", dial: "+61" },
  { code: "UA", name: "Ukraine", flag: "🇺🇦", dial: "+380" },
];

export function findCountry(code: string | undefined | null): Country {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}
