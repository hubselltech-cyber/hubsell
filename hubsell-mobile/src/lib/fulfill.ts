// ============================================================
// LUẬT THUẦN của luồng Xử lý đơn trên app (19/11/2026) — không đụng React Native để chạy
// được bằng node:test (xem fulfill.test.ts). Giao diện: components/ProcessSheet,
// ArrangeSheet, PrintSheet. Thiết kế: docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md.
// ============================================================

/** Bản tối thiểu của các kiểu ở api/fulfill.ts (tránh kéo client mạng vào test). */
export interface ChoiceLike {
  method: "PICKUP" | "DROPOFF";
  addressId?: string;
  pickupTimeId?: string;
  branchId?: string;
}

export interface OptionGroupLike {
  channelId: string;
  orderCount: number;
  mode: "PLATFORM" | "INTERNAL" | "UNSUPPORTED" | "ERROR";
  methods: ("PICKUP" | "DROPOFF")[];
  pickupAddresses: { id: string; isDefault: boolean; timeSlots: { id: string }[] }[];
  dropoffBranches: { id: string }[];
  defaults: { method: "PICKUP" | "DROPOFF"; addressId?: string; branchId?: string } | null;
}

export interface QueueGroupLike {
  channelId: string;
  count: number;
  carriers: { key: string; count: number; orderIds: string[] }[];
}

/**
 * Lựa chọn ban đầu của một gian: lần trước chọn gì thì điền lại, không thì theo mặc định
 * của sàn (địa chỉ sàn đánh dấu mặc định, khung giờ sớm nhất). Cùng luật với web
 * (arrange-shipment-dialog.tsx initialChoice) để hai nơi bấm ra cùng kết quả.
 */
export function initialChoice(g: OptionGroupLike): ChoiceLike {
  const method =
    g.defaults?.method && g.methods.includes(g.defaults.method) ? g.defaults.method : (g.methods[0] ?? "PICKUP");
  const addr =
    g.pickupAddresses.find((a) => a.id === g.defaults?.addressId) ??
    g.pickupAddresses.find((a) => a.isDefault) ??
    g.pickupAddresses[0];
  const branch = g.dropoffBranches.find((b) => b.id === g.defaults?.branchId) ?? g.dropoffBranches[0];
  return {
    method,
    addressId: addr?.id,
    pickupTimeId: addr?.timeSlots[0]?.id,
    branchId: branch?.id,
  };
}

/** Gian chạy được: sàn nhận lệnh thật, hoặc kênh offline (chỉ đổi trạng thái trong Hubsell). */
export function isRunnable(g: Pick<OptionGroupLike, "mode">): boolean {
  return g.mode === "PLATFORM" || g.mode === "INTERNAL";
}

/**
 * Gian lấy hàng tận nơi mà sàn chưa có địa chỉ lấy hàng → không gửi được, phải báo trước
 * khi bấm (web để sàn từ chối rồi mới biết).
 */
export function choiceProblem(g: OptionGroupLike, c: ChoiceLike | undefined): string | null {
  if (g.mode !== "PLATFORM" || g.methods.length === 0) return null;
  if (!c) return "Chưa chọn cách giao hàng";
  if (c.method === "PICKUP" && g.pickupAddresses.length === 0) {
    return "Gian chưa có địa chỉ lấy hàng trên sàn — thêm ở Seller Center, hoặc chọn tự mang ra bưu cục";
  }
  return null;
}

/** Khóa một dòng hãng trong cây in: gian + hãng. */
export const carrierKey = (channelId: string, key: string) => `${channelId}|${key}`;

/**
 * Id đơn sẽ làm, theo đúng thứ tự máy chủ trả (hỏa tốc trước, đơn cũ trước), bỏ các dòng
 * hãng / gian người dùng đã bỏ tích. `off` chứa khóa `carrierKey` hoặc channelId (bỏ cả gian).
 */
export function selectedOrderIds(groups: QueueGroupLike[], off: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const g of groups) {
    if (off.has(g.channelId)) continue;
    for (const c of g.carriers) {
      if (off.has(carrierKey(g.channelId, c.key))) continue;
      ids.push(...c.orderIds);
    }
  }
  return ids;
}

/** Trạng thái ô tích của một gian trong cây: tích hết / tích một phần / bỏ hết. */
export function groupCheck(g: QueueGroupLike, off: ReadonlySet<string>): "all" | "some" | "none" {
  if (off.has(g.channelId)) return "none";
  const offCount = g.carriers.filter((c) => off.has(carrierKey(g.channelId, c.key))).length;
  if (offCount === 0) return "all";
  return offCount === g.carriers.length ? "none" : "some";
}

/** Bấm ô tích của GIAN: đang tích (hết hoặc một phần) → bỏ cả gian; đang bỏ → tích lại hết. */
export function toggleGroup(g: QueueGroupLike, off: ReadonlySet<string>): Set<string> {
  const next = new Set(off);
  const state = groupCheck(g, off);
  for (const c of g.carriers) next.delete(carrierKey(g.channelId, c.key));
  if (state === "none") next.delete(g.channelId);
  else next.add(g.channelId);
  return next;
}

/** Bấm ô tích của một HÃNG trong gian. */
export function toggleCarrier(g: QueueGroupLike, key: string, off: ReadonlySet<string>): Set<string> {
  const next = new Set(off);
  // Gian đang bỏ cả cụm: chuyển thành "bỏ từng hãng" rồi bật lại đúng hãng vừa bấm.
  if (next.delete(g.channelId)) {
    for (const c of g.carriers) next.add(carrierKey(g.channelId, c.key));
  }
  const k = carrierKey(g.channelId, key);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  return next;
}

export interface ConfirmLike {
  confirmed: number;
  skipped: { orderCode: string; reason: string }[];
  failed: { orderCode: string; reason: string }[];
}

export interface ConfirmView {
  tone: "ok" | "partial" | "fail";
  title: string;
  /** Đơn sàn từ chối + lý do — người bán phải xử lý tay. */
  problems: { orderCode: string; reason: string }[];
  /** Các dòng phụ ("loại 2 đơn vì khách chưa thanh toán"…). */
  notes: string[];
}

/**
 * Câu báo sau một lượt chuẩn bị hàng. Đơn khách chưa thanh toán nói riêng (đó là câu chủ
 * shop cần nghe — "sót đơn" thường là đơn chưa thanh toán); đơn sàn từ chối liệt kê đủ
 * mã + lý do, không cắt còn 3 như toast của web vì trên app đây là màn kết quả.
 */
export function confirmView(r: ConfirmLike): ConfirmView {
  const unpaid = r.skipped.filter((s) => /chưa thanh toán/i.test(s.reason)).length;
  const running = r.skipped.filter((s) => /đang (được )?(chuẩn bị|xử lý|chạy)|lượt/i.test(s.reason)).length;
  const other = r.skipped.length - unpaid - running;
  const notes: string[] = [];
  if (unpaid > 0) notes.push(`${unpaid} đơn khách chưa thanh toán — sàn chưa cho chuẩn bị`);
  if (running > 0) notes.push(`${running} đơn đang nằm trong lượt chuẩn bị trước`);
  if (other > 0) notes.push(`${other} đơn đã rời Chờ xử lý (sàn nhận từ trước hoặc đã hủy)`);
  if (r.confirmed > 0 && r.failed.length === 0) {
    return { tone: "ok", title: `Sàn đã nhận ${r.confirmed} đơn`, problems: [], notes };
  }
  if (r.confirmed > 0) {
    return {
      tone: "partial",
      title: `Sàn đã nhận ${r.confirmed} đơn · từ chối ${r.failed.length} đơn`,
      problems: r.failed,
      notes,
    };
  }
  return {
    tone: "fail",
    title: r.failed.length > 0 ? `Sàn từ chối cả ${r.failed.length} đơn` : "Không chuẩn bị được đơn nào",
    problems: r.failed,
    notes,
  };
}

/** Bốn công đoạn của dây chuyền, lấy thẳng từ bảng đếm của màn Đơn hàng. */
export function pipelineCounts(counts: Record<string, number | undefined>) {
  return {
    arrange: counts.PENDING ?? 0,
    print: counts.PROCESSED_NOT_PRINTED ?? 0,
    pack: counts.PROCESSED_PRINTED ?? 0,
    packed: counts.PROCESSED_PACKED ?? 0,
  };
}

// ───────── TÍCH ĐƠN ngay trên danh sách (anh Trung 19/11/2026) ─────────

/** Việc kế tiếp của một đơn trong dây chuyền — chỉ đơn có việc mới có ô tích. */
export type WorkStage = "arrange" | "print" | "reprint";

/**
 * Đơn này đang ở bước nào của dây chuyền trên app:
 *   arrange = Chờ xử lý và khách ĐÃ thanh toán (đơn chưa thanh toán sàn chưa cho chuẩn bị → không tích được)
 *   print   = Đã xử lý, chưa in phiếu
 *   reprint = đã in phiếu, chưa quét đóng gói (in lại)
 *   null    = không còn việc trên app (đã đóng gói, đang giao, đã giao, hủy…)
 */
export function workStageOf(o: {
  shippingStatus: string;
  paymentStatus?: string | null;
  labelPrintedAt?: string | null;
  packingDoneAt?: string | null;
}): WorkStage | null {
  if (o.shippingStatus === "PENDING") return o.paymentStatus === "UNPAID" ? null : "arrange";
  if (o.shippingStatus !== "PROCESSED" || o.packingDoneAt) return null;
  return o.labelPrintedAt ? "reprint" : "print";
}

export interface SelectionCounts {
  arrange: number;
  print: number;
  reprint: number;
  total: number;
}

export function selectionCounts(selected: ReadonlyMap<string, WorkStage>): SelectionCounts {
  const out: SelectionCounts = { arrange: 0, print: 0, reprint: 0, total: selected.size };
  for (const stage of selected.values()) out[stage] += 1;
  return out;
}

/** Id các đơn đã tích thuộc một bước, giữ thứ tự tích. */
export function idsOfStage(selected: ReadonlyMap<string, WorkStage>, stage: WorkStage): string[] {
  const ids: string[] = [];
  for (const [id, s] of selected) if (s === stage) ids.push(id);
  return ids;
}

/**
 * "Chọn tất cả" phải lấy những nhóm đơn nào, theo bộ lọc trạng thái đang xem. Luật: MỌI đơn
 * có ô tích trong bộ lọc đang xem đều được tích — bấm "Chọn tất cả" mà còn thẻ có ô trống là
 * khó hiểu. Đơn đã in (reprint) được tích cũng không tự bị in lại: hộp Xử lý đơn chỉ in lại
 * khi người bán bấm đúng nút "In lại … phiếu đã chọn".
 */
export function selectAllStages(status: string, printed: string): ("ARRANGE" | "PRINT" | "REPRINT")[] {
  if (status === "") return ["ARRANGE", "PRINT", "REPRINT"];
  if (status === "PENDING") return ["ARRANGE"];
  if (status !== "PROCESSED") return [];
  if (printed === "no") return ["PRINT"];
  if (printed === "yes") return ["REPRINT"];
  if (printed === "packed") return [];
  return ["PRINT", "REPRINT"];
}
