// ============================================================
// TỰ ĐỘNG XUẤT HĐĐT + GỬI EMAIL HÓA ĐƠN KHI KHÁCH MUA GÓI HUBSELL (06/10/2026)
//
// Anh Trung chốt: đầu tư MISA eSign ký nền → khách thanh toán (payOS báo tiền
// về, hoặc kế toán ghi nhận chuyển khoản ở /admin/plans) là hóa đơn phát hành
// luôn và bản PDF bay vào hộp thư khách, không ai phải bấm. Tab Sổ quỹ HQ chỉ
// còn vai GIÁM SÁT: thấy lỗi thì bấm "Thử lại", thấy khách đổi email thì
// "Gửi lại".
//
// MỘT bút toán THU (PlatformLedgerEntry, packagePaymentId != null) đi qua ba
// bước, bước nào xong rồi thì bỏ qua — gọi lại bao nhiêu lần cũng an toàn:
//   1. PHÁT HÀNH: chưa có einvoiceTransactionId → publishStandardInvoice với
//      RefID "HQLEDGER-<id>" (MISA chống trùng theo RefID: gọi đôi là báo
//      InvoiceDuplicated chứ không ra hai tờ).
//   2. LẤY SỐ: có TransactionID mà chưa có số (meInvoice cấp trễ) →
//      getInvoiceStatuses để điền số. Webhook MISA chỉ khớp InvoiceLog của
//      tenant, không chạm bút toán HQ, nên phải tự hỏi.
//   3. GỬI EMAIL: có số, bật autoEmailEnabled, chưa gửi → tải PDF đã ký từ
//      meInvoice, gửi thư billing@ kèm PDF. PDF không tải được thì lượt sau
//      thử lại; từ lượt thứ PDF_FALLBACK_AFTER trở đi gửi thư KHÔNG kèm PDF
//      (có mã tra cứu) — khách không bị chờ vô hạn vì một lỗi tải file.
//
// AI GỌI:
//   · kickHqAutoInvoice(packagePaymentId) — ngay sau khi recordPackagePayment
//     commit (subscription-service.ts), fire-and-forget: khách nhận hóa đơn
//     trong vài giây sau khi trả tiền.
//   · workers/hq-invoice-auto.ts — lưới an toàn mỗi 30': nhặt bút toán lỡ
//     (web restart giữa chừng, MISA lỗi tạm, chờ cấp số, mail lỗi).
//   · routes/admin.ts — nút "Thử lại" / "Gửi lại email" trên Sổ quỹ HQ.
//
// AN TOÀN (hóa đơn có mã CQT không xóa được):
//   · MISA_ALLOW_PUBLISH tắt → bước 1 KHÔNG chạy (bước 2–3 vẫn chạy được vì
//     không sinh chứng từ).
//   · Chỉ bút toán phát sinh TỪ LÚC BẬT công tắc (autoIssueEnabledAt) — khoản
//     cũ có thể đã lập tay trên meInvoice.
//   · Khóa 10 phút theo bút toán (einvoiceAutoLockedAt): web + worker cùng
//     chạm một bút toán thì chỉ một bên làm.
//   · Trần MAX_AUTO_ATTEMPTS lượt máy; chạm trần thì báo HQ một thư và dừng,
//     HQ xử lý tay.
// ============================================================

import { LedgerDirection, LedgerInvoiceStatus, type Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { mailHq } from "../../services/hq-mail";
import {
  escapeHtml,
  sendInvoiceIssuedMail,
  vnDateLabel,
} from "../../services/customer-mails";
import { CYCLE_LABEL } from "../../services/subscription-service";
import { buildHqInvoiceInput, hqStandardConfig, type HqVatMode } from "./issue-hq";
import {
  downloadInvoiceFiles,
  getInvoiceStatuses,
  publishStandardInvoice,
  standardConfigMissing,
  TAX_CODE_RE,
  type StandardInvoiceConfig,
} from "./misa-einvoice";
import { isPublishAllowed } from "./misa-safety";

/** Trần lượt máy tự xử lý một bút toán — quá là dừng, báo HQ làm tay. */
export const MAX_AUTO_ATTEMPTS = 5;
/** Từ lượt này trở đi, PDF không tải được thì gửi thư không kèm PDF (có mã tra cứu). */
export const PDF_FALLBACK_AFTER = 3;
/** Khóa xử lý theo bút toán hết hạn sau chừng này (lượt treo vì crash không khóa mãi). */
export const LOCK_TTL_MS = 10 * 60 * 1000;

const FRONTEND_URL = (process.env.APP_FRONTEND_URL ?? "http://localhost:3000").replace(/\/+$/, "");

// ---------------- Cấu hình meInvoice công ty (singleton) ----------------

/** Bản ghi cấu hình duy nhất (tạo rỗng nếu chưa có) — dùng chung với routes/admin.ts. */
export async function getPlatformInvoiceConfigRow() {
  const row = await prisma.platformInvoiceConfig.findFirst();
  return row ?? prisma.platformInvoiceConfig.create({ data: {} });
}

export type PlatformInvoiceConfigRow = Awaited<ReturnType<typeof getPlatformInvoiceConfigRow>>;

/**
 * Bút toán này có thuộc diện máy tự xử lý không: công tắc bật + phát sinh từ
 * lúc bật + là khoản thu phí gói. Hàm thuần để test.
 */
export function isAutoInvoiceEligible(
  cfg: Pick<PlatformInvoiceConfigRow, "autoIssueEnabled" | "autoIssueEnabledAt">,
  entry: { direction: LedgerDirection; packagePaymentId: string | null; occurredAt: Date }
): boolean {
  if (!cfg.autoIssueEnabled) return false;
  if (entry.direction !== LedgerDirection.IN || !entry.packagePaymentId) return false;
  if (cfg.autoIssueEnabledAt && entry.occurredAt.getTime() < cfg.autoIssueEnabledAt.getTime()) {
    return false;
  }
  return true;
}

// ---------------- Người mua trên hóa đơn ----------------

export interface HqBuyer {
  name: string;
  taxCode: string | null;
  address: string | null;
  email: string | null;
  /** Lấy từ đâu — hiện trong lỗi/log để HQ biết sửa chỗ nào. */
  source: "billing-profile" | "invoice-config" | "account";
}

export interface HqBuyerSources {
  fullName: string;
  email: string | null;
  billingName: string | null;
  billingTaxCode: string | null;
  billingAddress: string | null;
  billingEmail: string | null;
  /** Pháp nhân shop khai ở module hóa đơn của chính họ (InvoiceConfig cấp shop). */
  invoiceConfig: { companyName: string | null; taxCode: string | null; companyAddress: string | null } | null;
}

/**
 * Ghép thông tin người mua theo thứ tự ưu tiên — hàm thuần để test:
 *   1. Hồ sơ xuất hóa đơn khách tự khai (/settings/plan) — có tên hoặc MST là dùng.
 *   2. Pháp nhân shop khai ở module hóa đơn của họ (đủ tên + MST).
 *   3. Tên tài khoản + email đăng nhập (khách lẻ, không MST).
 * Email nhận hóa đơn: billingEmail > email đăng nhập.
 */
export function composeHqBuyer(u: HqBuyerSources): HqBuyer {
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const email = clean(u.billingEmail) ?? clean(u.email);
  if (clean(u.billingName) || clean(u.billingTaxCode)) {
    return {
      name: clean(u.billingName) ?? u.fullName,
      taxCode: clean(u.billingTaxCode),
      address: clean(u.billingAddress),
      email,
      source: "billing-profile",
    };
  }
  const ic = u.invoiceConfig;
  if (ic && clean(ic.companyName) && clean(ic.taxCode)) {
    return {
      name: clean(ic.companyName)!,
      taxCode: clean(ic.taxCode),
      address: clean(ic.companyAddress),
      email,
      source: "invoice-config",
    };
  }
  return { name: u.fullName, taxCode: null, address: null, email, source: "account" };
}

async function resolveHqBuyer(userId: string): Promise<HqBuyer | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      fullName: true,
      email: true,
      billingName: true,
      billingTaxCode: true,
      billingAddress: true,
      billingEmail: true,
      invoiceConfigs: {
        where: { channelId: null },
        select: { companyName: true, taxCode: true, companyAddress: true },
        take: 1,
      },
    },
  });
  if (!u) return null;
  return composeHqBuyer({ ...u, invoiceConfig: u.invoiceConfigs[0] ?? null });
}

/** Người mua có MST thì tên + địa chỉ phải đủ — hóa đơn theo đơn vị thiếu địa chỉ là CQT từ chối. */
export function buyerProblem(b: HqBuyer): string | null {
  if (b.taxCode && !TAX_CODE_RE.test(b.taxCode)) {
    return `MST người mua "${b.taxCode}" không hợp lệ (10/12/13 số) — sửa ở hồ sơ xuất hóa đơn của khách.`;
  }
  if (b.taxCode && !b.address) {
    return "Khách khai MST nhưng thiếu địa chỉ đơn vị — hóa đơn theo đơn vị bắt buộc có địa chỉ. Nhắc khách bổ sung ở Cấu hình → Gói dịch vụ, hoặc xuất tay với địa chỉ đúng.";
  }
  return null;
}

/** Dòng hóa đơn từ khoản thanh toán gói — hàm thuần để test. */
export function hqItemNameFor(p: {
  planName: string;
  cycle: keyof typeof CYCLE_LABEL;
  periodStart: Date;
  periodEnd: Date;
}): string {
  return `Phí dịch vụ phần mềm Hubsell — gói ${p.planName}, ${CYCLE_LABEL[p.cycle]} (${vnDateLabel(p.periodStart)} – ${vnDateLabel(p.periodEnd)})`;
}

// ---------------- Lõi xử lý một bút toán ----------------

export type HqAutoTrigger = "auto" | "worker" | "manual";

export interface ProcessHqInvoiceOptions {
  trigger: HqAutoTrigger;
  /** Gửi lại email dù đã gửi rồi (nút "Gửi lại" HQ). */
  resendEmail?: boolean;
  /** Địa chỉ nhận ghi đè (HQ sửa tay) — lưu lại vào invoiceEmailTo. */
  emailTo?: string | null;
  /** Bỏ qua kiểm tra "đủ điều kiện tự xuất" (HQ bấm tay trên bút toán cũ). */
  ignoreEligibility?: boolean;
}

export type HqAutoStep =
  | "locked" // bút toán đang được lượt khác xử lý
  | "not-eligible" // công tắc tắt / bút toán cũ hơn mốc bật / không phải thu phí gói
  | "nothing" // mọi bước đã xong từ trước
  | "issued" // vừa phát hành (có số) — chưa tới bước email hoặc email tắt
  | "number-pending" // meInvoice nhận lệnh nhưng chưa cấp số
  | "emailed" // đã gửi email (có thể vừa phát hành luôn)
  | "failed";

export interface HqAutoResult {
  entryId: string;
  step: HqAutoStep;
  invoiceNo: string | null;
  transactionId: string | null;
  emailedTo: string | null;
  error: string | null;
}

const ENTRY_SELECT = {
  id: true,
  direction: true,
  amount: true,
  note: true,
  customerId: true,
  packagePaymentId: true,
  invoiceStatus: true,
  invoiceNo: true,
  einvoiceTransactionId: true,
  einvoiceAutoAttempts: true,
  einvoiceAutoLockedAt: true,
  invoiceBuyerName: true,
  invoiceBuyerTaxCode: true,
  invoiceEmailTo: true,
  invoiceEmailSentAt: true,
  occurredAt: true,
  packagePayment: {
    select: { planName: true, cycle: true, periodStart: true, periodEnd: true },
  },
  customer: { select: { fullName: true, email: true } },
} satisfies Prisma.PlatformLedgerEntrySelect;

type EntryRow = Prisma.PlatformLedgerEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

function trimError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 600 ? `${msg.slice(0, 597)}…` : msg;
}

/**
 * Chạy ba bước (phát hành → lấy số → email) cho một bút toán. Idempotent: bước
 * xong rồi bỏ qua. Mọi lỗi được GHI vào bút toán (einvoiceAutoError) thay vì
 * ném ra — người gọi fire-and-forget không cần try/catch.
 */
export async function processHqLedgerInvoice(
  entryId: string,
  opts: ProcessHqInvoiceOptions
): Promise<HqAutoResult> {
  const now = new Date();
  const result = (step: HqAutoStep, e: Partial<HqAutoResult> = {}): HqAutoResult => ({
    entryId,
    step,
    invoiceNo: null,
    transactionId: null,
    emailedTo: null,
    error: null,
    ...e,
  });

  const cfgRow = await getPlatformInvoiceConfigRow();
  const entry0 = await prisma.platformLedgerEntry.findUnique({
    where: { id: entryId },
    select: ENTRY_SELECT,
  });
  if (!entry0) return result("failed", { error: "Không tìm thấy bút toán" });
  if (entry0.direction !== LedgerDirection.IN) {
    return result("failed", { error: "Chỉ xuất hóa đơn cho khoản THU" });
  }
  if (!opts.ignoreEligibility && !isAutoInvoiceEligible(cfgRow, entry0)) {
    return result("not-eligible", {
      invoiceNo: entry0.invoiceNo,
      transactionId: entry0.einvoiceTransactionId,
    });
  }

  // Khóa theo bút toán: chỉ lượt giành được khóa mới chạy (web + worker song song).
  const lockFrom = new Date(now.getTime() - LOCK_TTL_MS);
  const locked = await prisma.platformLedgerEntry.updateMany({
    where: {
      id: entryId,
      OR: [{ einvoiceAutoLockedAt: null }, { einvoiceAutoLockedAt: { lt: lockFrom } }],
    },
    data: { einvoiceAutoLockedAt: now },
  });
  if (locked.count !== 1) return result("locked");

  let entry: EntryRow = entry0;
  let step: HqAutoStep = "nothing";
  let emailedTo: string | null = null;
  let error: string | null = null;

  try {
    const cfg = hqStandardConfig(cfgRow);
    const buyerFromAccount = entry.customerId ? await resolveHqBuyer(entry.customerId) : null;

    // ---- Bước 1: phát hành ----
    if (!entry.einvoiceTransactionId && entry.invoiceStatus !== LedgerInvoiceStatus.ISSUED) {
      if (!isPublishAllowed()) {
        throw new Error(
          "Chốt an toàn server MISA_ALLOW_PUBLISH đang tắt — chưa phát hành được (bật env trên Render)."
        );
      }
      const missing = standardConfigMissing(cfg);
      if (missing.length > 0) {
        throw new Error(`Chưa cấu hình meInvoice của Hubsell — thiếu: ${missing.join(", ")}`);
      }
      if (!buyerFromAccount) {
        throw new Error("Bút toán không gắn khách hàng — không biết xuất hóa đơn cho ai, xuất tay.");
      }
      const problem = buyerProblem(buyerFromAccount);
      if (problem) throw new Error(problem);

      const itemName = entry.packagePayment
        ? hqItemNameFor(entry.packagePayment)
        : (entry.note ?? "Phí dịch vụ phần mềm Hubsell");
      const input = buildHqInvoiceInput({
        refId: `HQLEDGER-${entry.id}`,
        buyerName: buyerFromAccount.name,
        buyerTaxCode: buyerFromAccount.taxCode ?? undefined,
        buyerAddress: buyerFromAccount.address ?? undefined,
        buyerEmail: buyerFromAccount.email ?? undefined,
        itemName,
        amount: Number(entry.amount),
        vatMode: cfgRow.vatMode as HqVatMode,
      });
      const published = await publishStandardInvoice(input, cfg);
      const issued = Boolean(published.invoiceNo);
      entry = await prisma.platformLedgerEntry.update({
        where: { id: entry.id },
        data: {
          einvoiceTransactionId: published.transactionId,
          invoiceBuyerName: buyerFromAccount.name,
          invoiceBuyerTaxCode: buyerFromAccount.taxCode,
          invoiceEmailTo: entry.invoiceEmailTo ?? buyerFromAccount.email,
          ...(issued
            ? { invoiceStatus: LedgerInvoiceStatus.ISSUED, invoiceNo: published.invoiceNo }
            : {}),
        },
        select: ENTRY_SELECT,
      });
      step = issued ? "issued" : "number-pending";
    }

    // ---- Bước 2: lấy số (meInvoice cấp trễ) ----
    if (entry.einvoiceTransactionId && !entry.invoiceNo) {
      const [status] = await getInvoiceStatuses([entry.einvoiceTransactionId], cfg);
      if (status?.isDeleted) {
        throw new Error(
          `Hóa đơn (mã tra cứu ${entry.einvoiceTransactionId}) đã bị xóa/hủy trên meInvoice — kiểm tra rồi xuất lại tay.`
        );
      }
      if (status?.invoiceNo) {
        entry = await prisma.platformLedgerEntry.update({
          where: { id: entry.id },
          data: { invoiceStatus: LedgerInvoiceStatus.ISSUED, invoiceNo: status.invoiceNo },
          select: ENTRY_SELECT,
        });
        step = "issued";
      } else {
        step = "number-pending";
      }
    }

    // ---- Bước 3: email PDF cho khách ----
    const wantEmail = opts.resendEmail || (cfgRow.autoEmailEnabled && !entry.invoiceEmailSentAt);
    if (entry.invoiceNo && entry.einvoiceTransactionId && wantEmail) {
      const to =
        (opts.emailTo && opts.emailTo.trim()) ||
        entry.invoiceEmailTo ||
        buyerFromAccount?.email ||
        entry.customer?.email ||
        null;
      if (!to) {
        // Không có địa chỉ thì không phải lỗi hệ thống — ghi rõ để HQ điền tay.
        await prisma.platformLedgerEntry.update({
          where: { id: entry.id },
          data: { invoiceEmailError: "Khách không có email nhận hóa đơn — HQ điền địa chỉ rồi bấm Gửi." },
        });
      } else {
        await sendInvoiceEmail(entry, cfgRow, cfg, to, buyerFromAccount, opts);
        emailedTo = to;
        step = "emailed";
      }
    }
  } catch (err) {
    error = trimError(err);
    step = "failed";
  }

  const attempts = entry.einvoiceAutoAttempts + 1;
  await prisma.platformLedgerEntry.update({
    where: { id: entry.id },
    data: {
      einvoiceAutoAttempts: attempts,
      einvoiceAutoTriedAt: now,
      einvoiceAutoLockedAt: null,
      einvoiceAutoError: error,
    },
  });

  // Chạm trần lượt máy mà vẫn lỗi → MỘT thư báo HQ, worker không nhặt nữa.
  if (error && attempts === MAX_AUTO_ATTEMPTS && opts.trigger !== "manual") {
    void mailHq({
      subject: `[Hubsell] ⚠️ Hóa đơn bán gói tự xuất THẤT BẠI ${attempts} lượt — cần làm tay`,
      html: `<p>Khoản thu <b>${Number(entry.amount).toLocaleString("vi-VN")}₫</b> của khách ${escapeHtml(
        entry.customer?.fullName ?? entry.customerId ?? "?"
      )} (${escapeHtml(entry.customer?.email ?? "—")}) máy đã thử ${attempts} lượt không xong.</p><p>Lỗi gần nhất: ${escapeHtml(
        error
      )}</p><p><a href="${FRONTEND_URL}/admin/finance">Mở Sổ quỹ HQ</a> → bấm Thử lại sau khi sửa, hoặc xuất tay.</p>`,
    });
  }

  return result(step, {
    invoiceNo: entry.invoiceNo,
    transactionId: entry.einvoiceTransactionId,
    emailedTo,
    error,
  });
}

async function sendInvoiceEmail(
  entry: EntryRow,
  cfgRow: PlatformInvoiceConfigRow,
  cfg: StandardInvoiceConfig,
  to: string,
  buyer: HqBuyer | null,
  opts: ProcessHqInvoiceOptions
): Promise<void> {
  // Tải PDF đã ký — lỗi thì ném để lượt sau thử lại, trừ khi đã quá số lượt
  // (hoặc HQ đang bấm gửi tay): gửi thư không kèm PDF (có mã tra cứu) còn hơn
  // để khách chờ vô hạn.
  let pdfBase64: string | null = null;
  let pdfError: string | null = null;
  try {
    const [file] = await downloadInvoiceFiles([entry.einvoiceTransactionId!], "Pdf", cfg);
    if (file?.data && !file.errorCode) pdfBase64 = file.data;
    else pdfError = `meInvoice không trả được PDF (${file?.errorCode ?? "không có dữ liệu"})`;
  } catch (err) {
    pdfError = trimError(err);
  }
  if (!pdfBase64 && !opts.resendEmail && entry.einvoiceAutoAttempts + 1 < PDF_FALLBACK_AFTER) {
    throw new Error(`${pdfError} — lượt sau thử tải lại rồi mới gửi thư.`);
  }

  const itemName = entry.packagePayment
    ? hqItemNameFor(entry.packagePayment)
    : (entry.note ?? "Phí dịch vụ phần mềm Hubsell");
  const ok = await sendInvoiceIssuedMail(
    to,
    {
      fullName: entry.customer?.fullName ?? entry.invoiceBuyerName ?? buyer?.name ?? "Quý khách",
      buyerName: entry.invoiceBuyerName ?? buyer?.name ?? entry.customer?.fullName ?? "Khách hàng",
      buyerTaxCode: entry.invoiceBuyerTaxCode ?? buyer?.taxCode ?? null,
      invoiceNo: entry.invoiceNo!,
      invoiceSeries: cfgRow.invoiceSeries,
      lookupCode: entry.einvoiceTransactionId,
      itemName,
      amount: Number(entry.amount),
      issuedAt: entry.occurredAt,
      hasPdf: Boolean(pdfBase64),
    },
    pdfBase64
      ? [
          {
            filename: `hoa-don-${entry.invoiceNo}.pdf`,
            content: pdfBase64,
            encoding: "base64",
            contentType: "application/pdf",
          },
        ]
      : undefined
  );
  if (!ok) {
    throw new Error("Gửi email thất bại (SMTP chưa cấu hình hoặc máy chủ thư từ chối) — xem log server.");
  }
  await prisma.platformLedgerEntry.update({
    where: { id: entry.id },
    data: {
      invoiceEmailTo: to,
      invoiceEmailSentAt: new Date(),
      invoiceEmailError: pdfBase64 ? null : `Đã gửi KHÔNG kèm PDF: ${pdfError}`,
    },
  });
}

// ---------------- Điểm móc sau khi ghi nhận thanh toán ----------------

/**
 * Gọi NGAY sau khi recordPackagePayment commit — fire-and-forget. Tìm bút toán
 * THU sinh từ khoản thanh toán rồi chạy xử lý; không đủ điều kiện (công tắc
 * tắt, trả bằng Ví không có bút toán…) thì lặng lẽ bỏ qua, worker cũng không
 * nhặt vì cùng luật isAutoInvoiceEligible.
 */
export function kickHqAutoInvoice(packagePaymentId: string): void {
  void (async () => {
    const entry = await prisma.platformLedgerEntry.findUnique({
      where: { packagePaymentId },
      select: { id: true },
    });
    if (!entry) return;
    const r = await processHqLedgerInvoice(entry.id, { trigger: "auto" });
    if (r.step === "failed") {
      console.error(`[HQ invoice] Tự xuất bút toán ${entry.id} lỗi: ${r.error}`);
    } else if (r.step !== "not-eligible" && r.step !== "locked") {
      console.log(`[HQ invoice] Bút toán ${entry.id}: ${r.step}${r.invoiceNo ? ` · số ${r.invoiceNo}` : ""}`);
    }
  })().catch((err) =>
    console.error("[HQ invoice] kick lỗi:", (err as Error).message)
  );
}
