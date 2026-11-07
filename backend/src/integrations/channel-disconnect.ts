// ============================================================
// LÝ DO GIAN RỚT KẾT NỐI (07/11/2026, anh Trung: "tách lý do để anh phân loại, đỡ hỏi lại em").
//
// Trước: Channel chỉ có status + disconnectedAt, thẻ HQ "Gian rớt kết nối" đếm mọi gian rớt
// trong 24h như nhau → 07/11 vàng oan: 2 gian rớt cùng mili-giây vì KHÁCH XÓA TÀI KHOẢN
// (account-deletion hạ mọi gian của chủ shop một lượt) + 1 gian hết hạn ủy quyền (TORANO)
// = 3 ≥ ngưỡng, dù không token nào hỏng. Anh phải hỏi lại mới biết.
//
// Nay MỖI ĐƯỜNG HẠ GIAN ghi một mã vào Channel.disconnectReason — ghi tại nguồn, không suy
// đoán sau; nối lại thì xóa. Dòng cũ (trước 07/11) null → inferDisconnectReason suy từ cột
// khác theo đúng luật thẻ gian ở frontend/src/lib/channel-auth.ts. Ngưỡng "rớt dồn" của HQ
// chỉ đếm lý do PHÍA SÀN (hết hạn / sàn từ chối / chưa ghi); khách ngắt tay hay xóa tài
// khoản chỉ liệt kê. Không thêm mã mới nếu chưa có ca thật cần phân biệt.
// ============================================================

export const DISCONNECT_REASON = {
  /** Chủ shop tự xóa tài khoản trong app (services/account-deletion.ts) — mọi gian hạ một lượt. */
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  /** Chủ shop bấm Ngắt kết nối (POST /api/channels/:id/disconnect). */
  MANUAL: "MANUAL",
  /** Hết hạn ủy quyền phía sàn: refresh_token quá hạn (token-refresh, disconnectExpiredTiktokAuths) hoặc hết kỳ dịch vụ Lazada. */
  AUTH_EXPIRED: "AUTH_EXPIRED",
  /** Sàn từ chối làm mới token (luật mất ủy quyền chung, auth-loss.ts) hoặc báo thu hồi qua webhook (Shopee code 5, TikTok type 6). */
  AUTH_REVOKED: "AUTH_REVOKED",
} as const;
export type DisconnectReason = (typeof DISCONNECT_REASON)[keyof typeof DISCONNECT_REASON];

/** Dòng cũ không suy được lý do — tính như phía sàn để không giấu ca thật. */
export const DISCONNECT_UNKNOWN = "UNKNOWN";
export type DisconnectBucket = DisconnectReason | typeof DISCONNECT_UNKNOWN;

export const DISCONNECT_LABEL: Record<DisconnectBucket, string> = {
  AUTH_REVOKED: "sàn từ chối / thu hồi",
  AUTH_EXPIRED: "hết hạn ủy quyền",
  UNKNOWN: "chưa ghi lý do",
  MANUAL: "khách ngắt tay",
  ACCOUNT_DELETED: "khách xóa tài khoản",
};

/** Lý do PHÍA SÀN — chỉ nhóm này tính vào ngưỡng "rớt dồn" (`disconnectedDelta24h`). */
export const PLATFORM_SIDE_REASONS: ReadonlySet<DisconnectBucket> = new Set<DisconnectBucket>(["AUTH_REVOKED", "AUTH_EXPIRED", "UNKNOWN"]);

/** Thứ tự hiện trên HQ: việc nền tảng trước, việc của khách sau. */
const DISPLAY_ORDER: DisconnectBucket[] = ["AUTH_REVOKED", "AUTH_EXPIRED", "UNKNOWN", "MANUAL", "ACCOUNT_DELETED"];

/** Dữ liệu một gian đã ngắt đủ để suy lý do khi cột disconnectReason còn trống. */
export interface DisconnectedRow {
  shopName: string;
  channelName: string;
  disconnectReason: string | null;
  disconnectedAt: Date | null;
  authLostReason: string | null;
  lastSyncError: string | null;
  refreshTokenExpireAt: Date | null;
  authExpireAt: Date | null;
  /** User.deletedAt của chủ shop — khách đã xóa tài khoản. */
  ownerDeletedAt: Date | null;
}

/**
 * Lý do gian ngắt. Cột ghi tại nguồn thắng; dòng cũ suy theo thứ tự: chủ shop đã xóa tài
 * khoản → sàn từ chối (authLostReason) → Shopee báo shop_access_expired → hạn ủy quyền đến
 * trước lúc ngắt (cùng luật tiktokAuthExpired ở frontend) → không rõ.
 */
export function inferDisconnectReason(c: DisconnectedRow, now: number = Date.now()): DisconnectBucket {
  if (c.disconnectReason && c.disconnectReason in DISCONNECT_LABEL) return c.disconnectReason as DisconnectBucket;
  if (c.ownerDeletedAt) return "ACCOUNT_DELETED";
  if (c.authLostReason) return "AUTH_REVOKED";
  if (/shop_access_expired/i.test(c.lastSyncError ?? "")) return "AUTH_EXPIRED";
  const cut = c.disconnectedAt?.getTime() ?? now;
  const end = c.refreshTokenExpireAt?.getTime() ?? c.authExpireAt?.getTime();
  if (end != null && end <= cut) return "AUTH_EXPIRED";
  return DISCONNECT_UNKNOWN;
}

export interface DisconnectGroup {
  reason: DisconnectBucket;
  label: string;
  count: number;
  /** Tối đa `maxNames` tên "gian · SÀN" để HQ đọc là biết, không phải tra SQL. */
  names: string[];
  platformSide: boolean;
}

export interface DisconnectSummary {
  total: number;
  /** Số gian rớt vì lý do phía sàn — đại lượng so với ngưỡng. */
  platformSide: number;
  groups: DisconnectGroup[];
}

export function summarizeDisconnects(rows: DisconnectedRow[], maxNames = 3, now: number = Date.now()): DisconnectSummary {
  const by = new Map<DisconnectBucket, DisconnectGroup>();
  for (const r of rows) {
    const reason = inferDisconnectReason(r, now);
    const g = by.get(reason) ?? {
      reason,
      label: DISCONNECT_LABEL[reason],
      count: 0,
      names: [],
      platformSide: PLATFORM_SIDE_REASONS.has(reason),
    };
    g.count += 1;
    if (g.names.length < maxNames) g.names.push(`${r.shopName} · ${r.channelName}`);
    by.set(reason, g);
  }
  const groups = DISPLAY_ORDER.filter((k) => by.has(k)).map((k) => by.get(k)!);
  return {
    total: rows.length,
    platformSide: groups.filter((g) => g.platformSide).reduce((s, g) => s + g.count, 0),
    groups,
  };
}

/** Chữ cho thẻ HQ: "1 hết hạn ủy quyền (TORANO · TIKTOK) · 2 khách xóa tài khoản (A · TIKTOK, B · TIKTOK)". */
export function describeDisconnects(s: DisconnectSummary): string {
  return s.groups
    .map((g) => {
      const more = g.count > g.names.length ? ", …" : "";
      return `${g.count} ${g.label}${g.names.length ? ` (${g.names.join(", ")}${more})` : ""}`;
    })
    .join(" · ");
}
