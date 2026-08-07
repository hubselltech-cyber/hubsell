/**
 * TRỢ LÝ VẬN HÀNH — DỮ LIỆU MOCK DÙNG CHUNG (PREVIEW)
 *
 * Toàn bộ module /operations-assistant/* hiện là MOCKUP định hình giao diện,
 * chờ nối API đánh giá/tin nhắn của 3 sàn (Shopee, TikTok Shop, Lazada).
 * Gom mock về một file để 3 màn hình dùng chung một bộ kiểu dữ liệu — khi có
 * API thật, các interface ở đây chính là hợp đồng dữ liệu cho backend
 * (bảng ChannelReview / ChannelConversation dự kiến), chỉ thay nguồn fetch.
 */

export type OpsChannel = "SHOPEE" | "TIKTOK" | "LAZADA";

/** Nhãn + màu badge kênh — tông nhạt để không phá quy tắc tiết chế màu. */
export const CHANNEL_META: Record<
  OpsChannel,
  { label: string; badgeClass: string }
> = {
  SHOPEE: {
    label: "Shopee",
    badgeClass: "border-orange-200 bg-orange-50 text-orange-700",
  },
  TIKTOK: {
    label: "TikTok Shop",
    badgeClass: "border-slate-300 bg-slate-100 text-slate-700",
  },
  LAZADA: {
    label: "Lazada",
    badgeClass: "border-blue-200 bg-blue-50 text-blue-700",
  },
};

/**
 * Tra meta kênh AN TOÀN: dữ liệu thật có thể trả tên kênh ngoài dự kiến —
 * truy cập thẳng CHANNEL_META[x] khi x lạ sẽ undefined rồi vỡ ở .label.
 * Mọi chỗ render badge kênh phải đi qua hàm này thay vì index trực tiếp.
 */
export function channelMeta(channel: string): { label: string; badgeClass: string } {
  return (
    CHANNEL_META[channel as OpsChannel] ?? {
      label: channel || "Kênh khác",
      badgeClass: "border-slate-200 bg-slate-50 text-slate-600",
    }
  );
}

/** Gian hàng demo — trùng tên các shop thật đã kết nối cho đỡ giả. */
export const MOCK_SHOPS: { id: string; label: string; channel: OpsChannel }[] = [
  { id: "shopee-darkman", label: "Shopee — DarkMan Store", channel: "SHOPEE" },
  { id: "lazada-hibe", label: "Lazada — Hi.Bé Store", channel: "LAZADA" },
  { id: "lazada-darkman", label: "Lazada — DarkMan Store", channel: "LAZADA" },
  { id: "tiktok-darkman", label: "TikTok Shop — DarkMan", channel: "TIKTOK" },
];

/**
 * Nhãn phân loại lỗi do AI gắn sau khi phân tích nội dung đánh giá.
 * Khi làm thật đây là output của bước phân tích sentiment trong pipeline
 * webhook → analyze → suggest (xem chú thích đầu file).
 */
export type ReviewTag = "SHIPPING" | "DAMAGED" | "QUALITY" | "SATISFIED";

export const REVIEW_TAG_META: Record<
  ReviewTag,
  { label: string; badgeClass: string }
> = {
  SHIPPING: {
    label: "Vận chuyển",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
  },
  DAMAGED: {
    label: "Hàng vỡ/móp",
    badgeClass: "border-red-200 bg-red-50 text-red-600",
  },
  QUALITY: {
    label: "Chất lượng SP",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
  },
  SATISFIED: {
    label: "Hài lòng",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
};

export interface MockReview {
  id: string;
  customer: string;
  shopId: string;
  channel: OpsChannel;
  product: string;
  rating: 1 | 2 | 3 | 4 | 5;
  content: string;
  tag: ReviewTag;
  replied: boolean;
  /** Thời gian tương đối cho mockup — API thật sẽ trả ISO date. */
  createdAt: string;
  /** Câu trả lời do AI soạn sẵn — nhân viên sửa hoặc gửi thẳng. */
  aiSuggestion: string;
}

export const MOCK_REVIEWS: MockReview[] = [
  {
    id: "rv-01",
    customer: "Ngọc Trâm",
    shopId: "shopee-darkman",
    channel: "SHOPEE",
    product: "Áo thun oversize DarkMan Basic — Đen / L",
    rating: 1,
    content:
      "Giao hàng quá chậm, đặt 5 ngày mới tới trong khi shop hứa 2 ngày. Gọi shipper không nghe máy. Rất thất vọng!",
    tag: "SHIPPING",
    replied: false,
    createdAt: "25 phút trước",
    aiSuggestion:
      "Chào Ngọc Trâm, shop thành thật xin lỗi vì đơn hàng đến tay bạn chậm hơn dự kiến do sự cố từ đơn vị vận chuyển. Shop đã gửi phản ánh tới hãng vận chuyển và tặng bạn mã giảm 10% cho đơn sau như một lời xin lỗi. Mong bạn thông cảm và cho shop cơ hội phục vụ tốt hơn ạ!",
  },
  {
    id: "rv-02",
    customer: "Minh Đức",
    shopId: "lazada-hibe",
    channel: "LAZADA",
    product: "Bình sữa PPSU Hi.Bé 240ml",
    rating: 2,
    content:
      "Hộp bị móp một góc, thân bình có vết trầy. May là ruột bên trong không sao nhưng làm quà tặng thì hết đẹp.",
    tag: "DAMAGED",
    replied: false,
    createdAt: "1 giờ trước",
    aiSuggestion:
      "Chào Minh Đức, shop rất tiếc vì kiện hàng bị móp trong quá trình vận chuyển. Bạn vui lòng inbox kèm ảnh sản phẩm, shop sẽ hỗ trợ đổi hộp mới hoàn toàn miễn phí trong 24h. Cảm ơn bạn đã phản hồi để shop cải thiện khâu đóng gói ạ!",
  },
  {
    id: "rv-03",
    customer: "Thu Hằng",
    shopId: "shopee-darkman",
    channel: "SHOPEE",
    product: "Quần jogger nỉ DarkMan — Xám / M",
    rating: 5,
    content: "Vải dày dặn, form chuẩn, mặc lên tôn dáng lắm nha. Sẽ ủng hộ tiếp!",
    tag: "SATISFIED",
    replied: false,
    createdAt: "2 giờ trước",
    aiSuggestion:
      "Cảm ơn Thu Hằng đã tin tưởng và dành 5 sao cho shop! Rất vui khi sản phẩm vừa ý bạn. Hẹn gặp lại bạn ở những đơn hàng sau, shop luôn có ưu đãi riêng cho khách quen ạ 🧡",
  },
  {
    id: "rv-04",
    customer: "Quốc Bảo",
    shopId: "tiktok-darkman",
    channel: "TIKTOK",
    product: "Hoodie DarkMan Signature — Đen / XL",
    rating: 5,
    content: "Giao nhanh, đóng gói chắc chắn, áo y hình. 10 điểm!",
    tag: "SATISFIED",
    replied: false,
    createdAt: "3 giờ trước",
    aiSuggestion:
      "Cảm ơn Quốc Bảo đã ủng hộ shop! Đóng gói cẩn thận là ưu tiên hàng đầu của tụi mình. Chúc bạn mặc thật đẹp và hẹn gặp lại ạ!",
  },
  {
    id: "rv-05",
    customer: "Hải Yến",
    shopId: "lazada-hibe",
    channel: "LAZADA",
    product: "Set 5 khăn sữa sợi tre Hi.Bé",
    rating: 3,
    content:
      "Khăn mềm nhưng màu thực tế nhạt hơn hình nhiều, hơi hụt hẫng. Chất ổn trong tầm giá.",
    tag: "QUALITY",
    replied: false,
    createdAt: "5 giờ trước",
    aiSuggestion:
      "Chào Hải Yến, cảm ơn bạn đã góp ý. Shop xin lỗi vì màu sản phẩm chưa đúng kỳ vọng — ảnh chụp dưới ánh đèn studio nên có chênh lệch nhẹ. Shop ghi nhận để cập nhật lại ảnh mô tả sát thực tế hơn. Tặng bạn voucher 15k cho đơn tiếp theo ạ!",
  },
  {
    id: "rv-06",
    customer: "Vân Anh",
    shopId: "shopee-darkman",
    channel: "SHOPEE",
    product: "Áo sơ mi DarkMan Oxford — Trắng / M",
    rating: 5,
    content: "Shop tư vấn size nhiệt tình, áo đẹp hơn mong đợi.",
    tag: "SATISFIED",
    replied: true,
    createdAt: "Hôm qua",
    aiSuggestion:
      "Cảm ơn Vân Anh! Đội tư vấn của shop luôn sẵn sàng hỗ trợ bạn chọn size chuẩn nhất. Hẹn gặp lại bạn sớm ạ!",
  },
  {
    id: "rv-07",
    customer: "Tuấn Kiệt",
    shopId: "tiktok-darkman",
    channel: "TIKTOK",
    product: "Áo thun oversize DarkMan Basic — Trắng / M",
    rating: 1,
    content:
      "Đặt size M nhưng nhận được size S, kiểm tra kỹ lại khâu đóng đơn giùm. Mất công đổi trả.",
    tag: "QUALITY",
    replied: false,
    createdAt: "Hôm qua",
    aiSuggestion:
      "Chào Tuấn Kiệt, shop chân thành xin lỗi vì sơ suất đóng nhầm size. Shop đã tạo yêu cầu đổi hàng hỏa tốc, size M sẽ đến tay bạn trong 48h và bạn không mất phí ship. Shop sẽ chấn chỉnh ngay khâu kiểm đơn ạ!",
  },
  {
    id: "rv-08",
    customer: "Phương Linh",
    shopId: "lazada-darkman",
    channel: "LAZADA",
    product: "Quần short kaki DarkMan — Be / L",
    rating: 4,
    content: "Ổn trong tầm giá, đường may hơi thừa chỉ chút xíu.",
    tag: "SATISFIED",
    replied: true,
    createdAt: "2 ngày trước",
    aiSuggestion:
      "Cảm ơn Phương Linh đã đánh giá! Shop ghi nhận góp ý về đường may để kiểm hàng kỹ hơn. Mong được phục vụ bạn lần sau ạ!",
  },
  {
    id: "rv-09",
    customer: "Gia Hân",
    shopId: "shopee-darkman",
    channel: "SHOPEE",
    product: "Hoodie DarkMan Signature — Xám / M",
    rating: 5,
    content: "Mua lần 2 rồi, chất lượng ổn định. Recommend!",
    tag: "SATISFIED",
    replied: false,
    createdAt: "2 ngày trước",
    aiSuggestion:
      "Cảm ơn Gia Hân đã quay lại ủng hộ shop lần 2! Khách quen như bạn là động lực lớn nhất của tụi mình. Hẹn gặp lại ạ 🧡",
  },
  {
    id: "rv-10",
    customer: "Đăng Khoa",
    shopId: "tiktok-darkman",
    channel: "TIKTOK",
    product: "Quần jogger nỉ DarkMan — Đen / L",
    rating: 5,
    content: "Đóng gói kỹ, có thiệp cảm ơn dễ thương nữa.",
    tag: "SATISFIED",
    replied: false,
    createdAt: "3 ngày trước",
    aiSuggestion:
      "Cảm ơn Đăng Khoa! Tấm thiệp nhỏ là lời cảm ơn shop muốn gửi tới từng khách hàng. Chúc bạn một ngày tốt lành ạ!",
  },
  {
    id: "rv-11",
    customer: "Bảo Ngọc",
    shopId: "lazada-hibe",
    channel: "LAZADA",
    product: "Gặm nướu silicone Hi.Bé",
    rating: 5,
    content: "Hàng chính hãng, có tem đầy đủ, bé nhà mình thích lắm.",
    tag: "SATISFIED",
    replied: true,
    createdAt: "3 ngày trước",
    aiSuggestion:
      "Cảm ơn Bảo Ngọc! Hi.Bé cam kết 100% hàng chính hãng có tem kiểm định. Chúc bé và gia đình thật nhiều sức khỏe ạ!",
  },
  {
    id: "rv-12",
    customer: "Thành Trung",
    shopId: "shopee-darkman",
    channel: "SHOPEE",
    product: "Áo sơ mi DarkMan Oxford — Xanh / L",
    rating: 5,
    content: "Chuẩn form, giao trước hẹn 1 ngày. Quá ưng.",
    tag: "SATISFIED",
    replied: false,
    createdAt: "4 ngày trước",
    aiSuggestion:
      "Cảm ơn Thành Trung đã tin tưởng shop! Rất vui khi đơn hàng đến sớm hơn dự kiến. Hẹn gặp lại bạn ở bộ sưu tập mới sắp ra mắt ạ!",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SẢN PHẨM & TỒN KHO — NGỮ CẢNH CHO AI COPILOT
//
// Hợp đồng dữ liệu chuẩn bị cho DB thật: sizeChart/material/care dự kiến là
// cột JSON + text trên bảng Product (kho vật lý — KHÔNG phải ChannelProduct,
// vì thông số vật lý là thuộc tính của hàng trong kho, dùng chung mọi sàn);
// variants.stock đọc từ tồn kho vật lý hiện có. Đây chính là khối dữ liệu sẽ
// được NẠP THẲNG vào prompt AI (Context Injection) khi sinh gợi ý trả lời.
// ─────────────────────────────────────────────────────────────────────────────

/** Một dòng bảng quy đổi size: khoảng chiều cao/cân nặng phù hợp. */
export interface SizeRow {
  size: string;
  /** [min, max] chiều cao cm */
  heightCm: [number, number];
  /** [min, max] cân nặng kg */
  weightKg: [number, number];
}

/**
 * Một biến thể màu × size kèm HAI nguồn tồn:
 * - stockQuantity: Kho vật lý Hubsell (bảng inventory hiện có)
 * - channelStock: tồn ĐANG TREO TRÊN SÀN của gian hàng khách chat (đọc từ
 *   ChannelProduct / API sàn) — với shop KHÔNG bật đồng bộ kho, đây mới là
 *   số khách bấm mua được, hai số hoàn toàn có thể lệch nhau.
 */
export interface ProductVariant {
  color: string;
  size: string;
  stockQuantity: number;
  channelStock: number;
}

/** Nguồn tồn kho AI Copilot dùng để tư vấn khách. */
export type StockSource = "CHANNEL" | "PHYSICAL";

/**
 * Cấu hình của seller (sau này lưu theo user/shop trong DB, đặt cạnh các cờ
 * cấu hình chung): AI đọc nguồn tồn nào khi trả lời khách. Mặc định CHANNEL —
 * tư vấn theo số sàn để không bao giờ báo "hết hàng" trong khi trên sàn khách
 * vẫn bấm mua được; shop nào đồng bộ kho chuẩn thì chuyển PHYSICAL.
 */
export const MOCK_STOCK_SOURCE_PREFERENCE: StockSource = "CHANNEL";

export interface MockProductInfo {
  sku: string;
  name: string;
  /** Class gradient cho ô ảnh giữ chỗ (khi KHÔNG có ảnh thật từ sàn/kho). */
  imageClass: string;
  /** Ảnh thật từ sàn/kho — có URL thì widget render <img>, không thì icon. */
  imageUrl?: string | null;
  /** Link xem/đặt hàng trên sàn — nguồn cho nút "Gửi thẻ sản phẩm". */
  productUrl?: string | null;
  /** Giá niêm yết (VND) hiện trên thẻ sản phẩm gửi khách. */
  price?: number | null;
  material: string;
  /** Hướng dẫn bảo quản — AI hay cần khi khách hỏi cách giặt/vệ sinh. */
  care: string;
  sizeChart: SizeRow[];
  variants: ProductVariant[];
}

export const MOCK_PRODUCTS: Record<string, MockProductInfo> = {
  "DM-TS-OVS": {
    sku: "DM-TS-OVS",
    name: "Áo thun oversize DarkMan Basic",
    imageClass: "from-slate-700 to-slate-900",
    material: "100% cotton 2 chiều, định lượng 250gsm",
    care: "Giặt máy nước lạnh, lộn trái khi giặt, không sấy nhiệt cao",
    sizeChart: [
      { size: "S", heightCm: [150, 160], weightKg: [45, 55] },
      { size: "M", heightCm: [158, 168], weightKg: [52, 62] },
      { size: "L", heightCm: [166, 175], weightKg: [60, 70] },
      { size: "XL", heightCm: [172, 182], weightKg: [68, 80] },
    ],
    variants: [
      { color: "Đen", size: "S", stockQuantity: 24, channelStock: 24 },
      // Lệch tồn: sàn chưa trừ 8 đơn đang đóng
      { color: "Đen", size: "M", stockQuantity: 56, channelStock: 48 },
      { color: "Đen", size: "L", stockQuantity: 31, channelStock: 31 },
      // Ca kinh điển: kho vật lý HẾT nhưng sàn vẫn treo 2 cái khách mua được
      { color: "Đen", size: "XL", stockQuantity: 0, channelStock: 2 },
      { color: "Trắng", size: "S", stockQuantity: 12, channelStock: 12 },
      { color: "Trắng", size: "M", stockQuantity: 40, channelStock: 40 },
      { color: "Trắng", size: "L", stockQuantity: 4, channelStock: 4 },
      { color: "Trắng", size: "XL", stockQuantity: 9, channelStock: 8 },
    ],
  },
  "DM-HD-SIG": {
    sku: "DM-HD-SIG",
    name: "Hoodie DarkMan Signature",
    imageClass: "from-zinc-600 to-zinc-900",
    material: "Nỉ bông da cá 350gsm, lót bo gân co giãn",
    care: "Giặt tay hoặc máy chế độ nhẹ, phơi ngang tránh giãn form",
    sizeChart: [
      { size: "M", heightCm: [158, 168], weightKg: [52, 63] },
      { size: "L", heightCm: [165, 174], weightKg: [60, 72] },
      { size: "XL", heightCm: [171, 181], weightKg: [70, 84] },
    ],
    variants: [
      { color: "Đen", size: "M", stockQuantity: 18, channelStock: 18 },
      { color: "Đen", size: "L", stockQuantity: 22, channelStock: 20 },
      { color: "Đen", size: "XL", stockQuantity: 3, channelStock: 3 },
      { color: "Xám", size: "M", stockQuantity: 15, channelStock: 15 },
      { color: "Xám", size: "L", stockQuantity: 0, channelStock: 0 },
      { color: "Xám", size: "XL", stockQuantity: 7, channelStock: 7 },
    ],
  },
  "HB-BS-240": {
    sku: "HB-BS-240",
    name: "Bình sữa PPSU Hi.Bé 240ml",
    imageClass: "from-sky-400 to-blue-600",
    material: "Nhựa PPSU chịu nhiệt 180°C, núm silicone y tế",
    care: "Tiệt trùng nước sôi/máy UV, thay núm định kỳ 3 tháng",
    // Sản phẩm không mặc — bảng size trống, AI sẽ bỏ qua tư vấn size
    sizeChart: [],
    variants: [
      { color: "Hồng", size: "240ml", stockQuantity: 35, channelStock: 35 },
      { color: "Xanh", size: "240ml", stockQuantity: 42, channelStock: 40 },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TRỢ LÝ CHAT — HỘI THOẠI MOCK
// ─────────────────────────────────────────────────────────────────────────────

export interface MockMessage {
  id: string;
  from: "CUSTOMER" | "SHOP";
  text: string;
  time: string;
}

export interface MockConversation {
  id: string;
  customer: string;
  channel: OpsChannel;
  shop: string;
  lastMessage: string;
  time: string;
  unread: number;
  /** Mã đơn liên quan (nếu khách đang hỏi về một đơn cụ thể). */
  orderCode?: string;
  /**
   * SKU sản phẩm gắn với hội thoại (khách bấm chat từ trang sản phẩm hoặc
   * suy từ đơn hàng) — chìa khoá để nạp ngữ cảnh sản phẩm cho AI Copilot
   * và hiện widget "Sản phẩm đang chat". Không có thì AI chỉ dựa hội thoại.
   */
  productSku?: string;
  messages: MockMessage[];
  /**
   * Gợi ý trả lời DỰ PHÒNG khi copilot-engine không bắt được ý định nào
   * (câu hỏi không liên quan size/tồn kho) — mô phỏng câu LLM trả về.
   */
  aiSuggestion: string;
}

export const MOCK_CONVERSATIONS: MockConversation[] = [
  {
    id: "cv-01",
    customer: "Nguyễn Thu Hà",
    channel: "SHOPEE",
    shop: "DarkMan Store",
    lastMessage: "Mình cao 1m60 nặng 52kg thì mặc size gì hả shop?",
    time: "2 phút",
    unread: 2,
    productSku: "DM-TS-OVS",
    messages: [
      {
        id: "m1",
        from: "CUSTOMER",
        text: "Shop ơi, áo thun oversize Basic còn màu đen không?",
        time: "09:41",
      },
      {
        id: "m2",
        from: "SHOP",
        text: "Chào bạn, màu đen còn đủ size S–XL nha ạ!",
        time: "09:42",
      },
      {
        id: "m3",
        from: "CUSTOMER",
        text: "Mình cao 1m60 nặng 52kg thì mặc size gì hả shop?",
        time: "09:45",
      },
    ],
    aiSuggestion:
      "Dạ với chiều cao 1m60 và cân nặng 52kg, bạn mặc size M là chuẩn form oversize nhất ạ. Nếu thích rộng thoải mái hơn nữa bạn có thể lên size L. Shop gửi kèm bảng size chi tiết để bạn tham khảo nha!",
  },
  {
    id: "cv-02",
    customer: "Trần Văn Minh",
    channel: "TIKTOK",
    shop: "DarkMan",
    lastMessage: "Đơn của mình 3 ngày rồi chưa thấy giao tới?",
    time: "18 phút",
    unread: 1,
    orderCode: "TT2608A7K9",
    messages: [
      {
        id: "m1",
        from: "CUSTOMER",
        text: "Đơn của mình 3 ngày rồi chưa thấy giao tới?",
        time: "09:28",
      },
    ],
    aiSuggestion:
      "Chào bạn, shop đã kiểm tra đơn TT2608A7K9: kiện hàng đang ở kho phân loại khu vực và dự kiến giao trong hôm nay hoặc sáng mai ạ. Shop đã giục đơn vị vận chuyển ưu tiên giao sớm. Bạn để ý điện thoại giúp shop nha, có gì shop cập nhật ngay!",
  },
  {
    id: "cv-03",
    customer: "Lê Hoàng Anh",
    channel: "LAZADA",
    shop: "Hi.Bé Store",
    lastMessage: "Cho mình đổi từ màu hồng sang màu xanh được không?",
    time: "1 giờ",
    unread: 0,
    orderCode: "LZ0708HB31",
    productSku: "HB-BS-240",
    messages: [
      {
        id: "m1",
        from: "CUSTOMER",
        text: "Mình vừa đặt bình sữa màu hồng, đơn LZ0708HB31 ấy ạ.",
        time: "08:15",
      },
      {
        id: "m2",
        from: "CUSTOMER",
        text: "Cho mình đổi từ màu hồng sang màu xanh được không?",
        time: "08:16",
      },
      {
        id: "m3",
        from: "SHOP",
        text: "Chào bạn, shop kiểm tra đơn ngay nha!",
        time: "08:20",
      },
    ],
    aiSuggestion:
      "Dạ đơn LZ0708HB31 của bạn chưa bàn giao cho vận chuyển nên shop đổi sang màu xanh được ạ. Shop đã ghi chú đổi màu vào đơn, bạn yên tâm nha. Cảm ơn bạn đã báo sớm!",
  },
  {
    id: "cv-04",
    customer: "Phạm Quỳnh Nga",
    channel: "SHOPEE",
    shop: "DarkMan Store",
    lastMessage: "Cảm ơn shop nhiều nha, lần sau mình lại ủng hộ!",
    time: "3 giờ",
    unread: 0,
    messages: [
      {
        id: "m1",
        from: "CUSTOMER",
        text: "Nhận được hàng rồi shop ơi, áo đẹp lắm!",
        time: "07:02",
      },
      {
        id: "m2",
        from: "SHOP",
        text: "Dạ shop cảm ơn bạn đã ủng hộ ạ! Bạn nhớ giặt lộn trái để áo bền màu nha.",
        time: "07:05",
      },
      {
        id: "m3",
        from: "CUSTOMER",
        text: "Cảm ơn shop nhiều nha, lần sau mình lại ủng hộ!",
        time: "07:06",
      },
    ],
    aiSuggestion:
      "Dạ shop cảm ơn bạn nhiều lắm ạ! Nếu ưng sản phẩm, bạn để lại đánh giá 5 sao giúp shop nha — shop có gửi kèm mã giảm giá 10% cho đơn tiếp theo trong kiện hàng đó ạ 🧡",
  },
  {
    id: "cv-05",
    customer: "Đỗ Mạnh Hùng",
    channel: "TIKTOK",
    shop: "DarkMan",
    lastMessage: "Shop ơi mã này còn hàng màu đen không?",
    time: "5 giờ",
    unread: 1,
    productSku: "DM-HD-SIG",
    messages: [
      {
        id: "m1",
        from: "CUSTOMER",
        text: "Hoodie Signature bên mình đẹp quá.",
        time: "05:12",
      },
      {
        id: "m2",
        from: "CUSTOMER",
        text: "Shop ơi mã này còn hàng màu đen không?",
        time: "05:13",
      },
    ],
    aiSuggestion:
      "Dạ shop cảm ơn bạn đã quan tâm Hoodie Signature ạ! Bạn cho shop xin chiều cao cân nặng để shop tư vấn size chuẩn nhất nha.",
  },
];
