/**
 * PERMISSION REGISTRY (bản phía giao diện) — cây phân quyền nhân viên.
 *
 * ⚠️ GIỮ ĐỒNG BỘ với nguồn sự thật phía máy chủ: backend/src/permission-registry.ts
 *    (hai package riêng nên không import chéo được — sửa key/lá bên đó thì sửa
 *    cả đây, lệch nhau là sidebar hiện mục mà API chặn hoặc ngược lại).
 *
 * Đây CHỈ là lớp trải nghiệm (ẩn menu, chặn vào trang); lớp chặn thật nằm ở
 * backend (requirePermission trên từng nhóm API). DB lưu KHÓA LÁ; trạng thái
 * nút cha (checked/indeterminate) suy từ các lá lúc render.
 */

export interface PermissionLeaf {
  key: string;
  label: string;
}

export interface PermissionNode {
  key: string;
  label: string;
  /** Không có children = chính nó là LÁ (mục nguyên khối như "orders", "koc"). */
  children?: PermissionLeaf[];
}

export const PERMISSION_TREE: PermissionNode[] = [
  { key: "dashboard", label: "Tổng quan" },
  { key: "orders", label: "Đơn hàng" },
  {
    key: "finance",
    label: "Quản lý Tài chính",
    children: [
      { key: "finance.analytics", label: "Báo cáo dòng tiền" },
      { key: "finance.realized-pnl", label: "Lãi/Lỗ Thực Hiện" },
      { key: "finance.expenses", label: "Thu chi vận hành" },
      { key: "finance.cost-prices", label: "Cấu hình Giá vốn" },
    ],
  },
  {
    key: "warehouse",
    label: "Quản lý Kho",
    children: [
      { key: "warehouse.products", label: "Kho vật lý" },
      { key: "warehouse.returns", label: "Đối soát đơn hoàn" },
      { key: "warehouse.shipping-alerts", label: "Đối soát phí ship" },
    ],
  },
  {
    key: "operations",
    label: "Trợ lý vận hành",
    children: [
      { key: "operations.chat", label: "Trợ lý Chat" },
      { key: "operations.reviews", label: "Phản hồi đánh giá" },
      { key: "operations.loss-orders", label: "Cảnh báo & P&L Sản phẩm" },
      { key: "operations.ai-rules", label: "Cấu hình kịch bản AI" },
    ],
  },
  {
    key: "ads",
    label: "Trợ lý quảng cáo",
    children: [
      { key: "ads.tiktok", label: "Quảng cáo TikTok" },
      { key: "ads.shopee", label: "Quảng cáo Shopee" },
      { key: "ads.lazada", label: "Quảng cáo Lazada" },
    ],
  },
  { key: "koc", label: "Mạng lưới KOC & Marketing" },
  { key: "invoicing", label: "Hóa đơn & Thuế" },
];

/** Mọi khóa LÁ hợp lệ — thứ duy nhất nằm trong User.permissions. */
export const ALL_LEAF_KEYS: readonly string[] = PERMISSION_TREE.flatMap((n) =>
  n.children ? n.children.map((c) => c.key) : [n.key]
);

const LEAF_SET = new Set(ALL_LEAF_KEYS);

/**
 * Nhân viên có quyền `key` không?
 *  - key là LÁ  → phải có đúng lá đó.
 *  - key là NHÓM → có BẤT KỲ lá nào của nhóm ("finance" khớp "finance.analytics").
 * ADMIN không đi qua hàm này — xem can() trong lib/permissions.ts.
 */
export function hasPermission(perms: readonly string[], key: string): boolean {
  if (LEAF_SET.has(key)) return perms.includes(key);
  const prefix = `${key}.`;
  return perms.some((p) => p === key || p.startsWith(prefix));
}

/** PRESET 1-click trên hộp thoại Phân quyền (khớp backend). */
export const PERMISSION_PRESETS: {
  key: string;
  label: string;
  description: string;
  permissions: string[];
}[] = [
  {
    key: "SALES",
    label: "Nhân viên vận hành",
    description: "Đơn hàng, kho, CSKH và Tổng quan — không thấy tài chính.",
    permissions: [
      "dashboard",
      "orders",
      "warehouse.products",
      "warehouse.returns",
      "operations.chat",
      "operations.reviews",
      "operations.ai-rules",
    ],
  },
  {
    key: "WAREHOUSE",
    label: "Nhân viên kho",
    description: "Đơn hàng và toàn bộ nghiệp vụ kho, kể cả đối soát phí ship.",
    permissions: [
      "orders",
      "warehouse.products",
      "warehouse.returns",
      "warehouse.shipping-alerts",
    ],
  },
  {
    key: "ACCOUNTANT",
    label: "Kế toán",
    description: "Toàn bộ Tài chính, Hóa đơn & Thuế và Tổng quan.",
    permissions: [
      "dashboard",
      "finance.analytics",
      "finance.realized-pnl",
      "finance.expenses",
      "finance.cost-prices",
      "invoicing",
    ],
  },
];

// ============================================================
// CÂY QUYỀN ĐIỀU HÀNH HUBSELL (khối HQ) — dành cho nhân viên của CHÍNH công ty
// Hubsell, do chủ nền tảng (cờ isPlatformAdmin) tạo. Họ làm việc trên khu
// /admin (dữ liệu toàn nền tảng), không đụng nghiệp vụ bán hàng của shop nào.
// ⚠️ GIỮ ĐỒNG BỘ với backend/src/platform-permission-registry.ts.
// Khóa luôn mang tiền tố "hq." nên không va chạm cây shop; hasPermission dùng
// chung được (lá khớp đúng chuỗi, nhóm "hq" khớp theo tiền tố).
// ============================================================

export const HQ_PERMISSION_TREE: PermissionNode[] = [
  { key: "hq.overview", label: "Tổng quan hệ thống" },
  { key: "hq.customers", label: "Khách hàng đăng ký" },
  { key: "hq.webhooks", label: "Nhật ký Webhook" },
];

/** PRESET 1-click cho nhân viên điều hành (khớp backend). */
export const HQ_PERMISSION_PRESETS: {
  key: string;
  label: string;
  description: string;
  permissions: string[];
}[] = [
  {
    key: "HQ_SALE",
    label: "Sale / CSKH khách hàng",
    description: "Danh sách chủ shop đăng ký — chăm sóc, tư vấn khách hàng mới.",
    permissions: ["hq.customers"],
  },
  {
    key: "HQ_TECH",
    label: "Kỹ thuật vận hành",
    description: "Tổng quan hệ thống và nhật ký webhook — theo dõi sức khỏe nền tảng.",
    permissions: ["hq.overview", "hq.webhooks"],
  },
  {
    key: "HQ_MANAGER",
    label: "Quản lý điều hành",
    description: "Toàn bộ khu Hệ thống Hubsell.",
    permissions: HQ_PERMISSION_TREE.flatMap((n) =>
      n.children ? n.children.map((c) => c.key) : [n.key]
    ),
  },
];

/**
 * Trang đích ưu tiên sau đăng nhập theo quyền — duyệt từ trên xuống, lấy trang
 * đầu tiên nhân viên vào được. Không có quyền nào → /guide (mở cho mọi người,
 * không gọi API dữ liệu nên không dội thêm lỗi 403).
 */
export const HOME_PRIORITY: { key: string; path: string }[] = [
  { key: "dashboard", path: "/" },
  { key: "orders", path: "/orders" },
  { key: "warehouse.products", path: "/products" },
  { key: "warehouse.returns", path: "/warehouse/returns" },
  { key: "warehouse.shipping-alerts", path: "/warehouse/shipping-alerts" },
  { key: "operations.chat", path: "/operations-assistant/chat" },
  { key: "operations.reviews", path: "/operations-assistant/reviews" },
  { key: "operations.loss-orders", path: "/operations-assistant/loss-orders" },
  { key: "operations.ai-rules", path: "/operations-assistant/ai-rules" },
  { key: "finance.analytics", path: "/finance/analytics" },
  { key: "finance.realized-pnl", path: "/finance/realized-pnl" },
  { key: "finance.expenses", path: "/finance/expenses" },
  { key: "finance.cost-prices", path: "/finance/cost-prices" },
  { key: "ads.tiktok", path: "/ads/tiktok" },
  { key: "ads.shopee", path: "/ads/shopee" },
  { key: "ads.lazada", path: "/ads/lazada" },
  { key: "koc", path: "/koc-marketing/overview" },
  { key: "invoicing", path: "/invoicing/connect" },
];
