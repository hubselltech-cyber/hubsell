/**
 * PERMISSION REGISTRY — NGUỒN SỰ THẬT DUY NHẤT của cây phân quyền nhân viên.
 *
 * ⚠️ GIỮ ĐỒNG BỘ với bản sao phía giao diện: frontend/src/lib/permission-registry.ts
 *    (hai package riêng nên không import chéo được — sửa key/lá ở đây thì sửa cả
 *    bên kia, lệch nhau là sidebar hiện mục mà API chặn hoặc ngược lại).
 *
 * Quy ước:
 *  - DB (User.permissions) CHỈ LƯU KHÓA LÁ (vd "finance.analytics", "orders").
 *    Trạng thái nút CHA (checked/indeterminate) suy từ các lá lúc render —
 *    lưu cả cha sẽ sinh hai nguồn sự thật rồi lệch trạng thái.
 *  - Khóa nhóm đặt phẳng theo tiền tố: "finance" là cha của "finance.*".
 *    hasPermission(perms, "finance") = có BẤT KỲ lá finance nào — dùng để gác
 *    cả nhóm API ở tầng mount (app.ts).
 *  - ADMIN (chủ shop) toàn quyền, KHÔNG đi qua registry. Các khu vĩnh viễn
 *    chỉ-chủ-shop (Kênh bán, Liên kết SP, Nhân viên, Cấu hình, Affiliate Hubsell)
 *    cố tình KHÔNG có trong cây — không cho chủ shop tự bắn vào chân.
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
      { key: "finance.fee-audit", label: "Kiểm toán phí sàn" },
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

/** Mọi khóa LÁ hợp lệ — thứ duy nhất được phép nằm trong User.permissions. */
export const ALL_LEAF_KEYS: readonly string[] = PERMISSION_TREE.flatMap((n) =>
  n.children ? n.children.map((c) => c.key) : [n.key]
);

const LEAF_SET = new Set(ALL_LEAF_KEYS);

/**
 * Lọc payload quyền từ client về danh sách lá hợp lệ, bỏ trùng, giữ thứ tự cây.
 * Khóa lạ bị BỎ TRONG IM LẶNG (không 400) — client cũ/lệch phiên bản gửi khóa
 * đã gỡ thì thà mất khóa đó còn hơn chặn cả thao tác phân quyền.
 */
export function sanitizePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((k): k is string => typeof k === "string"));
  return ALL_LEAF_KEYS.filter((k) => wanted.has(k));
}

/**
 * Nhân viên có quyền `key` không?
 *  - key là LÁ  → phải có đúng lá đó.
 *  - key là NHÓM → có BẤT KỲ lá nào của nhóm ("finance" khớp "finance.analytics").
 * ADMIN không gọi hàm này — chủ shop toàn quyền, chặn/mở ở middleware.
 */
export function hasPermission(perms: readonly string[], key: string): boolean {
  if (LEAF_SET.has(key)) return perms.includes(key);
  const prefix = `${key}.`;
  return perms.some((p) => p === key || p.startsWith(prefix));
}

/**
 * PRESET 1-CLICK trên hộp thoại Phân quyền — đổ sẵn mảng quyền mẫu cho chủ shop
 * đỡ tick ~25 ô. Chỉ là phím tắt phía UI: DB vẫn lưu mảng lá, sửa lẻ thoải mái.
 * SALES/WAREHOUSE khớp đúng phạm vi hai vai trò cũ (nhân viên cũ được seed y hệt).
 */
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
      "finance.fee-audit",
      "finance.expenses",
      "finance.cost-prices",
      "invoicing",
    ],
  },
];
