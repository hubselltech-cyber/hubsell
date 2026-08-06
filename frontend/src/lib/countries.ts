// ============================================================
// DANH MỤC QUỐC GIA (ISO 3166-1 alpha-2 + tên tiếng Việt/Anh + cờ + mã điện thoại)
//
// value lưu DB là `code` (alpha-2) — dial code chỉ để hiển thị; ISO mới là nền
// cho i18n/tiền tệ/thuế sau này. Việt Nam đứng đầu (thị trường chính), phần
// còn lại xếp ABC theo tên tiếng Việt. Danh sách gọn ~80 nước phủ mọi thị
// trường TMĐT đáng kể — thiếu nước nào thêm dòng là xong.
// `nameEn` dùng cho dropdown mã vùng điện thoại (chuẩn UI quốc tế).
// ============================================================

export interface Country {
  /** ISO 3166-1 alpha-2 — giá trị lưu DB. */
  code: string;
  name: string;
  /** Tên tiếng Anh — hiển thị ở dropdown chọn mã vùng điện thoại. */
  nameEn: string;
  flag: string;
  dial: string;
}

export const COUNTRIES: Country[] = [
  { code: "VN", name: "Việt Nam", nameEn: "Vietnam", flag: "🇻🇳", dial: "+84" },
  { code: "AF", name: "Afghanistan", nameEn: "Afghanistan", flag: "🇦🇫", dial: "+93" },
  { code: "EG", name: "Ai Cập", nameEn: "Egypt", flag: "🇪🇬", dial: "+20" },
  { code: "IE", name: "Ai-len", nameEn: "Ireland", flag: "🇮🇪", dial: "+353" },
  { code: "IN", name: "Ấn Độ", nameEn: "India", flag: "🇮🇳", dial: "+91" },
  { code: "GB", name: "Anh", nameEn: "United Kingdom", flag: "🇬🇧", dial: "+44" },
  { code: "AR", name: "Argentina", nameEn: "Argentina", flag: "🇦🇷", dial: "+54" },
  { code: "AT", name: "Áo", nameEn: "Austria", flag: "🇦🇹", dial: "+43" },
  { code: "SA", name: "Ả Rập Xê Út", nameEn: "Saudi Arabia", flag: "🇸🇦", dial: "+966" },
  { code: "AE", name: "Các Tiểu VQ Ả Rập (UAE)", nameEn: "United Arab Emirates", flag: "🇦🇪", dial: "+971" },
  { code: "PL", name: "Ba Lan", nameEn: "Poland", flag: "🇵🇱", dial: "+48" },
  { code: "BD", name: "Bangladesh", nameEn: "Bangladesh", flag: "🇧🇩", dial: "+880" },
  { code: "BE", name: "Bỉ", nameEn: "Belgium", flag: "🇧🇪", dial: "+32" },
  { code: "BY", name: "Belarus", nameEn: "Belarus", flag: "🇧🇾", dial: "+375" },
  { code: "PT", name: "Bồ Đào Nha", nameEn: "Portugal", flag: "🇵🇹", dial: "+351" },
  { code: "BR", name: "Brazil", nameEn: "Brazil", flag: "🇧🇷", dial: "+55" },
  { code: "BN", name: "Brunei", nameEn: "Brunei", flag: "🇧🇳", dial: "+673" },
  { code: "BG", name: "Bulgaria", nameEn: "Bulgaria", flag: "🇧🇬", dial: "+359" },
  { code: "KH", name: "Campuchia", nameEn: "Cambodia", flag: "🇰🇭", dial: "+855" },
  { code: "CA", name: "Canada", nameEn: "Canada", flag: "🇨🇦", dial: "+1" },
  { code: "CL", name: "Chile", nameEn: "Chile", flag: "🇨🇱", dial: "+56" },
  { code: "CO", name: "Colombia", nameEn: "Colombia", flag: "🇨🇴", dial: "+57" },
  { code: "CZ", name: "Cộng hoà Séc", nameEn: "Czechia", flag: "🇨🇿", dial: "+420" },
  { code: "DK", name: "Đan Mạch", nameEn: "Denmark", flag: "🇩🇰", dial: "+45" },
  { code: "TW", name: "Đài Loan", nameEn: "Taiwan", flag: "🇹🇼", dial: "+886" },
  { code: "DE", name: "Đức", nameEn: "Germany", flag: "🇩🇪", dial: "+49" },
  { code: "NL", name: "Hà Lan", nameEn: "Netherlands", flag: "🇳🇱", dial: "+31" },
  { code: "KR", name: "Hàn Quốc", nameEn: "South Korea", flag: "🇰🇷", dial: "+82" },
  { code: "US", name: "Hoa Kỳ (Mỹ)", nameEn: "United States", flag: "🇺🇸", dial: "+1" },
  { code: "HK", name: "Hồng Kông", nameEn: "Hong Kong", flag: "🇭🇰", dial: "+852" },
  { code: "HU", name: "Hungary", nameEn: "Hungary", flag: "🇭🇺", dial: "+36" },
  { code: "GR", name: "Hy Lạp", nameEn: "Greece", flag: "🇬🇷", dial: "+30" },
  { code: "ID", name: "Indonesia", nameEn: "Indonesia", flag: "🇮🇩", dial: "+62" },
  { code: "IL", name: "Israel", nameEn: "Israel", flag: "🇮🇱", dial: "+972" },
  { code: "IT", name: "Ý (Italia)", nameEn: "Italy", flag: "🇮🇹", dial: "+39" },
  { code: "JP", name: "Nhật Bản", nameEn: "Japan", flag: "🇯🇵", dial: "+81" },
  { code: "KZ", name: "Kazakhstan", nameEn: "Kazakhstan", flag: "🇰🇿", dial: "+7" },
  { code: "KE", name: "Kenya", nameEn: "Kenya", flag: "🇰🇪", dial: "+254" },
  { code: "LA", name: "Lào", nameEn: "Laos", flag: "🇱🇦", dial: "+856" },
  { code: "MO", name: "Macao", nameEn: "Macao", flag: "🇲🇴", dial: "+853" },
  { code: "MY", name: "Malaysia", nameEn: "Malaysia", flag: "🇲🇾", dial: "+60" },
  { code: "MA", name: "Ma-rốc", nameEn: "Morocco", flag: "🇲🇦", dial: "+212" },
  { code: "MX", name: "Mexico", nameEn: "Mexico", flag: "🇲🇽", dial: "+52" },
  { code: "MM", name: "Myanmar", nameEn: "Myanmar", flag: "🇲🇲", dial: "+95" },
  { code: "NO", name: "Na Uy", nameEn: "Norway", flag: "🇳🇴", dial: "+47" },
  { code: "ZA", name: "Nam Phi", nameEn: "South Africa", flag: "🇿🇦", dial: "+27" },
  { code: "NZ", name: "New Zealand", nameEn: "New Zealand", flag: "🇳🇿", dial: "+64" },
  { code: "RU", name: "Nga", nameEn: "Russia", flag: "🇷🇺", dial: "+7" },
  { code: "NG", name: "Nigeria", nameEn: "Nigeria", flag: "🇳🇬", dial: "+234" },
  { code: "FR", name: "Pháp", nameEn: "France", flag: "🇫🇷", dial: "+33" },
  { code: "PH", name: "Philippines", nameEn: "Philippines", flag: "🇵🇭", dial: "+63" },
  { code: "FI", name: "Phần Lan", nameEn: "Finland", flag: "🇫🇮", dial: "+358" },
  { code: "PK", name: "Pakistan", nameEn: "Pakistan", flag: "🇵🇰", dial: "+92" },
  { code: "QA", name: "Qatar", nameEn: "Qatar", flag: "🇶🇦", dial: "+974" },
  { code: "RO", name: "Romania", nameEn: "Romania", flag: "🇷🇴", dial: "+40" },
  { code: "SG", name: "Singapore", nameEn: "Singapore", flag: "🇸🇬", dial: "+65" },
  { code: "ES", name: "Tây Ban Nha", nameEn: "Spain", flag: "🇪🇸", dial: "+34" },
  { code: "TH", name: "Thái Lan", nameEn: "Thailand", flag: "🇹🇭", dial: "+66" },
  { code: "TR", name: "Thổ Nhĩ Kỳ", nameEn: "Turkey", flag: "🇹🇷", dial: "+90" },
  { code: "SE", name: "Thuỵ Điển", nameEn: "Sweden", flag: "🇸🇪", dial: "+46" },
  { code: "CH", name: "Thuỵ Sĩ", nameEn: "Switzerland", flag: "🇨🇭", dial: "+41" },
  { code: "CN", name: "Trung Quốc", nameEn: "China", flag: "🇨🇳", dial: "+86" },
  { code: "AU", name: "Úc", nameEn: "Australia", flag: "🇦🇺", dial: "+61" },
  { code: "UA", name: "Ukraine", nameEn: "Ukraine", flag: "🇺🇦", dial: "+380" },
];

export function findCountry(code: string | undefined | null): Country {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}
