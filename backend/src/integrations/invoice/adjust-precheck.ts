/**
 * HAI BƯỚC KIỂM TRƯỚC KHI LẬP HÓA ĐƠN ĐIỀU CHỈNH (hóa đơn bước 5, lát 3 — 02/10/2026,
 * docs/HANG-DOI-BEN.md mục 4.6).
 *
 * Vì sao có tệp này:
 *   1. Nhà cung cấp có thể KHÔNG kiểm hóa đơn gốc (MISA: thử sandbox 02/10 lập luôn
 *      tờ điều chỉnh trỏ vào số hóa đơn không tồn tại) → Hubsell phải tự kiểm hóa
 *      đơn gốc còn hiệu lực. Không xác nhận được thì CHẶN, kèm lý do và việc nên
 *      làm cho chủ shop (anh Trung chốt 02/10: "chặn hẳn kèm lý do và đề xuất cho
 *      seller") — bỏ qua ở đây là lập một chứng từ thuế trỏ vào hóa đơn không còn.
 *   2. Trước 02/10 mỗi lượt điều chỉnh dùng một mã tham chiếu MỚI kể cả khi lượt
 *      trước hỏng. Lượt trước đứt mạng SAU khi nhà cung cấp đã lập xong thì lượt
 *      sau lập thêm một tờ nữa: giảm doanh thu hai lần. Nay: tra lại mọi mã của
 *      các lượt hỏng trước; thấy tờ đã lập thì NỐI LẠI, không lập thêm; lượt mới
 *      dùng LẠI mã của lượt hỏng gần nhất để chốt chặn trùng của nhà cung cấp còn
 *      tác dụng.
 *
 * Tệp này không đụng database: nhận adapter + dữ liệu, trả quyết định. Nơi ghi sổ
 * là adjust-order.ts.
 */

import { InvoiceLogStatus } from "@prisma/client";

import { getProviderEntry } from "./provider-registry";
import type { InvoiceProvider, ReferenceLookup } from "./types";

/** Một lý do KHÔNG lập hóa đơn điều chỉnh, viết cho chủ shop đọc. */
export interface AdjustBlock {
  /** Mã phân loại — giao diện dựa vào tiền tố HUBSELL_ADJUST_ để hiện hộp giải thích. */
  code: string;
  /** Chuyện gì đang xảy ra. */
  reason: string;
  /** Việc chủ shop nên làm tiếp. */
  suggestion: string;
  /** TRANSIENT = thử lại sau là được; ORDER = phải xử lý riêng hóa đơn này. */
  scope: "ORDER" | "TRANSIENT";
  httpStatus: number;
}

/** Tên nhà cung cấp để nói với chủ shop ("MISA meInvoice"). */
function providerLabel(provider: InvoiceProvider): string {
  return getProviderEntry(provider.name)?.label ?? provider.name;
}

/** Adapter này tra ngược theo mã tham chiếu được không. */
function canLookup(provider: InvoiceProvider): provider is InvoiceProvider & {
  findByReference: (reference: string) => Promise<ReferenceLookup>;
} {
  return provider.capabilities.findByReference.supported && typeof provider.findByReference === "function";
}

const CONFIG_PAGE = "Kết nối & Xuất hóa đơn → Cấu hình kết nối";

/**
 * Lý do chặn khi KHÔNG TRA ĐƯỢC bên nhà cung cấp. Hai trường hợp khác hẳn nhau về
 * việc nên làm: hỏng ở tài khoản của shop (thử lại không tự hết → sửa kết nối),
 * và sự cố tạm (thử lại sau).
 */
function lookupFailedBlock(
  code: string,
  label: string,
  failed: Extract<ReferenceLookup, { state: "LOOKUP_FAILED" }>,
  what: string,
  consequence: string
): AdjustBlock {
  if (failed.accountProblem) {
    return {
      code,
      scope: "ORDER",
      httpStatus: 409,
      reason: `${what} vì kết nối tới ${label} của shop đang có vấn đề, ${consequence}. ${label} báo: ${failed.message}`,
      suggestion: `Sửa kết nối tại ${CONFIG_PAGE}, bấm Kiểm tra kết nối cho tới khi thành công, rồi thử lại. Chưa có hóa đơn điều chỉnh nào được lập.`,
    };
  }
  return {
    code,
    scope: "TRANSIENT",
    httpStatus: 502,
    reason: `${what} (${label} không trả lời hoặc đang lỗi), ${consequence}.`,
    suggestion: "Thử lại sau ít phút. Chưa có hóa đơn điều chỉnh nào được lập.",
  };
}

/** So hai số hóa đơn, bỏ qua số 0 đứng đầu ("00000131" = "131"). */
export function sameInvoiceNo(a: string, b: string): boolean {
  const norm = (v: string) => v.trim().replace(/^0+(?=\d)/, "");
  return norm(a) === norm(b);
}

export interface OriginalInvoiceRef {
  invoiceNo: string;
  orderCode: string;
  /** Mã tham chiếu đã gửi lúc phát hành; dòng đời cũ chưa có thì dùng mã đơn. */
  providerRef: string | null;
}

/**
 * Hóa đơn gốc còn hiệu lực bên nhà cung cấp không? Trả null khi ĐÃ XÁC NHẬN (hoặc
 * nhà cung cấp tự kiểm / không có cách tra — khi đó giữ hành vi cũ); trả lý do
 * chặn khi không xác nhận được.
 */
export async function verifyOriginalAtProvider(
  provider: InvoiceProvider,
  original: OriginalInvoiceRef
): Promise<AdjustBlock | null> {
  if (provider.capabilities.validatesAdjustmentOriginal) return null;
  if (!canLookup(provider)) return null;

  const label = providerLabel(provider);
  const ref = original.providerRef ?? original.orderCode;
  const found = await provider.findByReference(ref);

  if (found.state === "LOOKUP_FAILED") {
    return lookupFailedBlock(
      "HUBSELL_ADJUST_ORIGINAL_UNCHECKED",
      label,
      found,
      `Hubsell chưa kiểm được hóa đơn gốc số ${original.invoiceNo} trên ${label}`,
      "nên chưa lập hóa đơn điều chỉnh"
    );
  }
  if (found.state === "NOT_FOUND") {
    return {
      code: "HUBSELL_ADJUST_ORIGINAL_NOT_FOUND",
      scope: "ORDER",
      httpStatus: 409,
      reason: `Hubsell không tìm thấy hóa đơn gốc số ${original.invoiceNo} trên ${label} (tra theo mã ${ref}), nên không lập hóa đơn điều chỉnh để tránh trỏ vào một hóa đơn không tồn tại.`,
      suggestion: `Mở ${label} kiểm tra hóa đơn số ${original.invoiceNo} còn không, và tài khoản / mã số thuế đang cấu hình ở Hubsell có đúng là nơi đã lập hóa đơn này không. Nếu hóa đơn vẫn còn, lập hóa đơn điều chỉnh trực tiếp trên ${label} rồi báo Hubsell kèm mã đơn ${original.orderCode}.`,
    };
  }
  if (found.deleted) {
    return {
      code: "HUBSELL_ADJUST_ORIGINAL_DELETED",
      scope: "ORDER",
      httpStatus: 409,
      reason: `Hóa đơn gốc số ${original.invoiceNo} đã bị xóa bỏ hoặc hủy trên ${label}, nên Hubsell không lập hóa đơn điều chỉnh cho nó.`,
      suggestion: `Mở ${label} xem lại hóa đơn số ${original.invoiceNo}. Nếu hóa đơn bị xóa nhầm, liên hệ ${label} để được hướng dẫn. Hubsell sẽ tự cập nhật trạng thái hóa đơn này ở lượt đồng bộ kế tiếp.`,
    };
  }
  if (!found.issued) {
    return {
      code: "HUBSELL_ADJUST_ORIGINAL_NOT_ISSUED",
      scope: "TRANSIENT",
      httpStatus: 409,
      reason: `${label} báo hóa đơn gốc số ${original.invoiceNo} chưa phát hành xong, nên chưa lập hóa đơn điều chỉnh được.`,
      suggestion: `Mở ${label} kiểm tra hóa đơn số ${original.invoiceNo} đã phát hành chưa, rồi thử lại.`,
    };
  }
  if (found.invoiceNo && !sameInvoiceNo(found.invoiceNo, original.invoiceNo)) {
    return {
      code: "HUBSELL_ADJUST_ORIGINAL_MISMATCH",
      scope: "ORDER",
      httpStatus: 409,
      reason: `Số hóa đơn gốc không khớp: Hubsell đang ghi số ${original.invoiceNo}, còn ${label} trả số ${found.invoiceNo} cho cùng mã ${ref}. Hubsell không lập hóa đơn điều chỉnh khi chưa chắc đang trỏ đúng tờ.`,
      suggestion: `Lập hóa đơn điều chỉnh trực tiếp trên ${label} cho đúng tờ, rồi báo Hubsell kèm mã đơn ${original.orderCode} để kiểm tra.`,
    };
  }
  return null;
}

/** Một lượt điều chỉnh trước đó của cùng hóa đơn gốc (đang chờ / đã phát hành thì đã bị chặn từ trước). */
export interface PriorAdjustmentAttempt {
  id: string;
  status: InvoiceLogStatus;
  providerRef: string | null;
}

export type AdjustmentReferencePlan =
  /** Lập lượt mới với mã tham chiếu này. */
  | { kind: "USE"; refId: string }
  /** Một lượt trước thực ra ĐÃ LẬP XONG bên nhà cung cấp: nối lại, không lập thêm. */
  | { kind: "RECOVER"; logId: string; refId: string; invoiceNo: string; transactionId: string }
  | { kind: "BLOCK"; block: AdjustBlock };

/** Số thứ tự trong mã tham chiếu điều chỉnh "<mã đơn>-DC<n>"; không đúng dạng → 0. */
function adjustmentNumber(ref: string | null): number {
  const m = /-DC(\d+)$/.exec(ref ?? "");
  return m ? Number(m[1]) : 0;
}

/**
 * Chọn mã tham chiếu cho lượt điều chỉnh mới của một hóa đơn gốc.
 *
 * `prior`: mọi lượt điều chỉnh trước của hóa đơn gốc này, CŨ TRƯỚC.
 *
 * Nhà cung cấp tra ngược được:
 *   · mọi mã của các lượt HỎNG trước đều được tra. Thấy tờ đã lập và còn hiệu lực →
 *     RECOVER. Không tra được → BLOCK (chưa chắc thì không lập).
 *   · lượt gần nhất HỎNG, mã của nó không có tờ nào, và nhà cung cấp nhận lại mã
 *     của lượt bị từ chối → dùng LẠI mã đó.
 *   · còn lại (chưa có lượt nào, hoặc tờ gần nhất đã lập thật rồi bị xóa) → mã mới,
 *     số kế tiếp.
 * Nhà cung cấp KHÔNG tra ngược được: giữ cách cũ (mỗi lượt một mã mới) cho tới khi
 * nhật ký ghi được lượt nào "chắc chắn không lập" (lát 5–6).
 */
export async function planAdjustmentReference(
  provider: InvoiceProvider,
  orderCode: string,
  prior: PriorAdjustmentAttempt[]
): Promise<AdjustmentReferencePlan> {
  const nextNumber = Math.max(prior.length, ...prior.map((p) => adjustmentNumber(p.providerRef))) + 1;
  const freshRef = `${orderCode}-DC${nextNumber}`;
  if (prior.length === 0 || !canLookup(provider)) return { kind: "USE", refId: freshRef };

  const label = providerLabel(provider);
  // Tra từng mã KHÁC NHAU của các lượt hỏng; nhớ kết quả để quyết định dùng lại.
  const lookedUp = new Map<string, ReferenceLookup>();
  for (const attempt of prior) {
    if (attempt.status !== InvoiceLogStatus.FAILED || !attempt.providerRef) continue;
    if (lookedUp.has(attempt.providerRef)) continue;
    const found = await provider.findByReference(attempt.providerRef);
    lookedUp.set(attempt.providerRef, found);

    if (found.state === "LOOKUP_FAILED") {
      return {
        kind: "BLOCK",
        block: lookupFailedBlock(
          "HUBSELL_ADJUST_PRIOR_UNCHECKED",
          label,
          found,
          `Lượt điều chỉnh trước của hóa đơn này chưa rõ kết quả, và Hubsell chưa tra lại được trên ${label}`,
          "nên chưa lập lượt mới để tránh lập hai hóa đơn điều chỉnh"
        ),
      };
    }
    if (found.state !== "FOUND" || found.deleted) continue;
    if (!found.issued) {
      return {
        kind: "BLOCK",
        block: {
          code: "HUBSELL_ADJUST_PRIOR_IN_PROGRESS",
          scope: "TRANSIENT",
          httpStatus: 409,
          reason: `${label} đang giữ một hóa đơn điều chỉnh chưa phát hành xong cho hóa đơn này (mã ${attempt.providerRef}). Hubsell không lập thêm lượt mới.`,
          suggestion: `Mở ${label} kiểm tra hóa đơn điều chỉnh đó, rồi thử lại.`,
        },
      };
    }
    if (!found.invoiceNo || !found.transactionId) {
      return {
        kind: "BLOCK",
        block: {
          code: "HUBSELL_ADJUST_PRIOR_UNREADABLE",
          scope: "ORDER",
          httpStatus: 409,
          reason: `${label} đã có một hóa đơn điều chỉnh cho hóa đơn này (mã ${attempt.providerRef}) nhưng Hubsell không đọc được số hóa đơn của nó, nên không lập thêm lượt mới.`,
          suggestion: `Mở ${label} tìm hóa đơn điều chỉnh theo mã ${attempt.providerRef} và báo Hubsell kèm mã đơn ${orderCode}.`,
        },
      };
    }
    // Lượt MỚI NHẤT mang mã này là lượt đã gửi lệnh sau cùng.
    const owner = [...prior].reverse().find((p) => p.providerRef === attempt.providerRef && p.status === InvoiceLogStatus.FAILED)!;
    return {
      kind: "RECOVER",
      logId: owner.id,
      refId: attempt.providerRef,
      invoiceNo: found.invoiceNo,
      transactionId: found.transactionId,
    };
  }

  const latest = prior[prior.length - 1];
  const latestLookup = latest.providerRef ? lookedUp.get(latest.providerRef) : undefined;
  const reusable =
    provider.capabilities.referenceReusableAfterReject &&
    latest.status === InvoiceLogStatus.FAILED &&
    latest.providerRef !== null &&
    latestLookup?.state === "NOT_FOUND";
  return { kind: "USE", refId: reusable ? latest.providerRef! : freshRef };
}
