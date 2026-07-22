/**
 * OPERATIONS COMMAND CENTER — kiểu dữ liệu & phân quyền (RBAC)
 *
 * ⚠️ Vai trò ở ĐÂY là vai trò VẬN HÀNH riêng của Command Center
 * (ADMIN | KHO | KE_TOAN | MARKETING), KHÁC hoàn toàn với vai trò đăng nhập
 * thật của hệ thống (ADMIN | SALES | WAREHOUSE trong @/lib/api). Đây là tính
 * năng demo dùng dữ liệu giả lập, có bộ chuyển vai trò riêng để thử nghiệm.
 */

/** Vai trò vận hành — chỉ dùng nội bộ Command Center. */
export type OpsRole = "ADMIN" | "KHO" | "KE_TOAN" | "MARKETING";

/** Nhóm cảnh báo. */
export type AlertTag = "inventory" | "finance" | "channel" | "ads";

/** Mức độ nghiêm trọng. */
export type Severity = "high" | "medium" | "low";

/** Một phân loại (SKU) cháy hàng — một dòng trong bảng nhập tồn của pop-up. */
export interface RestockVariant {
  sku: string;
  /** Tên phân loại, VD "Size M". */
  variantName: string;
  /** Tồn hiện tại trên sàn (thường 0 khi cháy hàng). */
  channelStock: number;
  /** Tồn kho THỰC còn trong hệ thống — để nhân viên biết đường phân phối. */
  warehouseStock: number;
  /** Số lượng gợi ý bơm lên sàn. */
  suggestQty: number;
}

/**
 * Tham số cho pop-up xử lý nhanh, phân nhánh theo LOẠI hành động (không theo tag,
 * vì một tag có thể có nhiều loại — VD inventory vừa có "nhập kho" vừa có "đối
 * soát lệch tồn"). `kind` là trường phân biệt để <ActionModal> chọn đúng form.
 */
export type ActionParams =
  | {
      kind: "restock";
      /** Tên sản phẩm cha (gom các phân loại cháy hàng cùng sàn về một cảnh báo). */
      product: string;
      /** Sàn đang cháy hàng. */
      channel: string;
      /** Danh sách các phân loại (SKU) đang cháy hàng của sản phẩm này trên sàn. */
      variants: RestockVariant[];
    }
  | {
      kind: "stock-mismatch";
      sku: string;
      channel: string;
      hubsellStock: number;
      channelStock: number;
    }
  | {
      kind: "edit-price";
      sku: string;
      cost: number;
      /** Giá bán gốc (niêm yết) hiện tại. */
      price: number;
      /** Giá khuyến mãi hiện tại — giá khách THỰC TẾ trả, dùng để tính biên. */
      promoPrice: number;
      // Chi phí sàn KHÔNG lưu ở đây nữa — được ước tính động từ đơn hàng thành
      // công gần nhất của chính SKU này (xem estimateChannelCost trong mock-service).
    }
  | {
      kind: "edit-shipping";
      sku: string;
      weightKg: number;
      lengthCm: number;
      widthCm: number;
      heightCm: number;
    }
  | {
      kind: "customer-refusal";
      customer: string;
      phone: string;
      refusedOrders: number;
    }
  | {
      kind: "roas";
      campaign: string;
      roas: number;
      dailyBudget: number;
    }
  | { kind: "confirm"; description: string };

export interface OpsAlert {
  id: string;
  tag: AlertTag;
  severity: Severity;
  title: string;
  summary: string;
  /** Nhãn nút xử lý nhanh, VD "+ Nhập kho", "Duyệt chi phí". */
  actionLabel: string;
  /** Tham số form pop-up xử lý nhanh của cảnh báo này. */
  action: ActionParams;
  /** ISO timestamp lúc phát sinh cảnh báo. */
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  tag: AlertTag;
  message: string;
  at: string; // ISO
}

/** Nội dung một tin nhắn — text, bảng dán từ Excel, hoặc ảnh đính kèm nhẹ. */
export type ChatBody =
  | { kind: "text"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "image"; dataUrl: string; name: string };

export interface ChatMessage {
  id: string;
  alertId: string;
  author: string;
  role: OpsRole;
  body: ChatBody;
  at: string; // ISO
}

// ───────────────────────── NHÃN & MÀU ─────────────────────────

export const TAG_META: Record<
  AlertTag,
  { label: string; className: string }
> = {
  inventory: { label: "KHO", className: "bg-sky-50 text-sky-700 border-sky-200" },
  finance: {
    label: "TÀI CHÍNH",
    className: "bg-violet-50 text-violet-700 border-violet-200",
  },
  channel: {
    label: "SÀN",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  ads: { label: "ADS", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

export const SEVERITY_META: Record<
  Severity,
  { label: string; dot: string; icon: string }
> = {
  high: { label: "Cao", dot: "bg-rose-500", icon: "🔴" },
  medium: { label: "Trung bình", dot: "bg-amber-500", icon: "🟡" },
  low: { label: "Thấp", dot: "bg-sky-500", icon: "🔵" },
};

export const ROLE_META: Record<OpsRole, { label: string }> = {
  ADMIN: { label: "Quản trị (toàn quyền)" },
  KHO: { label: "Nhân viên Kho" },
  KE_TOAN: { label: "Kế toán" },
  MARKETING: { label: "Marketing" },
};

export const OPS_ROLES: OpsRole[] = ["ADMIN", "KHO", "KE_TOAN", "MARKETING"];

// ───────────────────────── PHÂN QUYỀN ─────────────────────────

/** Tag nào mỗi vai trò được XEM. "all" = mọi tag (chỉ ADMIN). */
const ROLE_VIEW: Record<OpsRole, AlertTag[] | "all"> = {
  ADMIN: "all",
  KHO: ["inventory", "channel"],
  KE_TOAN: ["finance", "inventory"],
  MARKETING: ["ads", "channel"],
};

/**
 * Vai trò nào được THAO TÁC (bấm nút xử lý, tick "Đã xử lý") trên mỗi tag.
 * ADMIN luôn có quyền nên không liệt kê ở đây.
 *
 * Lưu ý cặp inventory: KE_TOAN được XEM cảnh báo tồn kho (để đối chiếu số) nhưng
 * KHÔNG có trong danh sách thao tác → với họ nút xử lý ở chế độ chỉ-đọc. Đây
 * chính là điểm RBAC cần minh hoạ: xem được ≠ sửa được.
 */
const TAG_ACTORS: Record<AlertTag, OpsRole[]> = {
  inventory: ["KHO"],
  finance: ["KE_TOAN"],
  channel: ["KHO", "MARKETING"],
  ads: ["MARKETING"],
};

/** Vai trò này có được xem cảnh báo thuộc tag này không. */
export function canView(role: OpsRole, tag: AlertTag): boolean {
  const scope = ROLE_VIEW[role];
  return scope === "all" || scope.includes(tag);
}

/** Vai trò này có được thao tác xử lý cảnh báo thuộc tag này không. */
export function canAct(role: OpsRole, tag: AlertTag): boolean {
  return role === "ADMIN" || TAG_ACTORS[tag].includes(role);
}

/** Danh sách tag mà vai trò được xem (đã bung "all" thành đủ 4 tag). */
export function visibleTags(role: OpsRole): AlertTag[] {
  return (Object.keys(TAG_META) as AlertTag[]).filter((t) => canView(role, t));
}
