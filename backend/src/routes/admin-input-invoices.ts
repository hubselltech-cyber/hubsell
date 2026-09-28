// ============================================================
// HÓA ĐƠN ĐẦU VÀO của CHÍNH công ty Hubsell — router con cùng cửa /api/admin
// (như admin-plans). Lá quyền `hq.finance`. Anh Trung 28/09/2026.
//
// Luồng: kế toán THẢ TỆP (PDF/XML/ảnh, nhiều tệp) → lưu vĩnh viễn bucket
// hq-documents → máy đọc (XML chuẩn TCTN / Claude) → dòng hóa đơn + phiếu chi
// tự sinh trong sổ quỹ (nhãn "Máy đọc · chưa duyệt") → cuối quý chọn khoảng
// ngày, XUẤT zip (tệp gốc + bảng kê CSV tách GTGT trong nước / nhà thầu nước
// ngoài) và TÍCH "đã khai kỳ X" → lần xuất sau mặc định loại + cảnh báo.
// Mỗi tờ khai NGUYÊN SỐ một lần, không chia tháng.
// ============================================================

import { Router } from "express";
import multer from "multer";
import archiver from "archiver";
import { randomUUID } from "crypto";
import { LedgerDirection, LedgerInvoiceStatus, LedgerSource, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requirePlatformPermission, type AuthRequest } from "../middleware/auth";
import { writeAuditLog } from "../services/platform-audit";
import {
  HQ_DOCUMENT_SIZE_LIMIT,
  hqDocuments,
  isStorageConfigured,
} from "../lib/supabase-storage";
import {
  EXPENSE_KEYS,
  fetchReferenceRate,
  invoiceAiConfigured,
  looksLikeXml,
  parseVnEInvoiceXml,
  readInvoiceWithAi,
  type ExtractedInvoice,
} from "../integrations/invoice/input-invoice-reader";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HQ_DOCUMENT_SIZE_LIMIT, files: 30 },
});

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  xml: "application/xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const PAYMENT_METHODS = ["BANK", "CASH"] as const;
const PERIOD_RE = /^\d{4}-(Q[1-4]|(0[1-9]|1[0-2]))$/; // "2026-Q3" | "2026-09"
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const INVOICE_SELECT = {
  id: true,
  invoiceNo: true,
  invoiceSerial: true,
  invoiceDate: true,
  sellerName: true,
  sellerTaxCode: true,
  isForeign: true,
  description: true,
  subtotal: true,
  vatRate: true,
  vatAmount: true,
  total: true,
  currency: true,
  amountOriginal: true,
  fxRate: true,
  paymentMethod: true,
  expenseCategory: true,
  source: true,
  reviewStatus: true,
  readerNote: true,
  declaredPeriod: true,
  declaredAt: true,
  declaredByName: true,
  ledgerEntryId: true,
  createdByName: true,
  createdAt: true,
  files: {
    select: { id: true, fileName: true, mimeType: true, size: true, kind: true, createdAt: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.PlatformInputInvoiceSelect;

type InvoiceRow = Prisma.PlatformInputInvoiceGetPayload<{ select: typeof INVOICE_SELECT }>;

const dec = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

function serialize(r: InvoiceRow) {
  return {
    ...r,
    invoiceDate: r.invoiceDate ? r.invoiceDate.toISOString().slice(0, 10) : null,
    subtotal: Number(r.subtotal),
    vatAmount: Number(r.vatAmount),
    total: Number(r.total),
    amountOriginal: dec(r.amountOriginal),
    fxRate: dec(r.fxRate),
  };
}

/** "yyyy-mm-dd" → Date UTC 00:00 (cột DATE lưu đúng ngày, không lệch múi giờ). */
function dateKeyToDb(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function kindOf(mime: string): "XML" | "PDF" | "IMAGE" {
  if (mime === "application/pdf") return "PDF";
  if (mime.endsWith("xml")) return "XML";
  return "IMAGE";
}

/** Tên tệp an toàn cho kho + zip (bỏ ký tự lạ, giữ đuôi). */
function safeName(name: string): string {
  const cleaned = name.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned.slice(-120) || "tep";
}

async function actorName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return u?.fullName ?? "(không rõ)";
}

// ---------- Đọc một tệp → số liệu ----------

async function extractFrom(
  buf: Buffer,
  mime: string,
  fileName: string
): Promise<{ data: ExtractedInvoice | null; source: "XML" | "AI" | "NONE"; error?: string }> {
  if (kindOf(mime) === "XML" || (mime === "application/octet-stream" && looksLikeXml(buf))) {
    const parsed = parseVnEInvoiceXml(buf.toString("utf8"));
    if (parsed) return { data: parsed, source: "XML" };
    // XML không theo chuẩn TCTN → nhờ AI đọc như văn bản
  }
  if (!invoiceAiConfigured()) {
    return {
      data: null,
      source: "NONE",
      error: "Chưa đặt ANTHROPIC_API_KEY_HQ — tệp đã lưu, số liệu chờ nhập tay",
    };
  }
  try {
    const data = await readInvoiceWithAi(buf, mime, fileName);
    return { data, source: "AI" };
  } catch (err) {
    return {
      data: null,
      source: "NONE",
      error: `AI đọc lỗi: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Quy đổi VND cho hóa đơn ngoại tệ: giữ số gốc + tỷ giá tham khảo. */
async function toVnd(d: ExtractedInvoice): Promise<{
  subtotal: number;
  vatAmount: number;
  total: number;
  currency: string | null;
  amountOriginal: number | null;
  fxRate: number | null;
  note: string | null;
}> {
  if (d.currency === "VND") {
    return {
      subtotal: d.subtotal,
      vatAmount: d.vatAmount,
      total: d.total,
      currency: null,
      amountOriginal: null,
      fxRate: null,
      note: null,
    };
  }
  const rate = await fetchReferenceRate(d.currency);
  if (!rate) {
    return {
      subtotal: 0,
      vatAmount: 0,
      total: 0,
      currency: d.currency,
      amountOriginal: d.total,
      fxRate: null,
      note: `Không lấy được tỷ giá ${d.currency} — nhập số VND theo sao kê ngân hàng.`,
    };
  }
  const r = (v: number) => Math.round(v * rate);
  return {
    subtotal: r(d.subtotal),
    vatAmount: r(d.vatAmount),
    total: r(d.total),
    currency: d.currency,
    amountOriginal: d.total,
    fxRate: rate,
    note: `Quy đổi theo tỷ giá tham khảo 1 ${d.currency} = ${rate.toLocaleString("vi-VN")} ₫ — sửa theo số ngân hàng trừ thật trên sao kê.`,
  };
}

/** Phiếu chi trong sổ quỹ khớp với dòng hóa đơn (tạo mới hoặc đồng bộ lại). */
async function syncLedger(
  invoiceId: string,
  actor: { id: string; name: string }
): Promise<void> {
  const inv = await prisma.platformInputInvoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return;
  const amount = Math.floor(Number(inv.total));
  const note =
    inv.description ??
    [inv.invoiceNo ? `HĐ ${inv.invoiceNo}` : "Hóa đơn đầu vào", inv.sellerName]
      .filter(Boolean)
      .join(" – ");
  const common = {
    amount,
    note,
    vendorName: inv.sellerName,
    vendorTaxCode: inv.sellerTaxCode,
    inputInvoiceNo: inv.invoiceNo,
    paymentMethod: inv.paymentMethod ?? "BANK",
    expenseCategory: inv.expenseCategory ?? "OTHER_EXPENSE",
    occurredAt: inv.invoiceDate ?? inv.createdAt,
  };
  if (inv.ledgerEntryId) {
    // Số tiền 0 (chưa đọc được) → giữ phiếu cũ, không ghi 0 vào sổ
    if (amount <= 0) return;
    await prisma.platformLedgerEntry.update({ where: { id: inv.ledgerEntryId }, data: common });
    return;
  }
  if (amount <= 0) return;
  const entry = await prisma.platformLedgerEntry.create({
    data: {
      direction: LedgerDirection.OUT,
      source: LedgerSource.OTHER,
      invoiceStatus: LedgerInvoiceStatus.NONE,
      createdById: actor.id,
      createdByName: actor.name,
      ...common,
    },
    select: { id: true },
  });
  await prisma.platformInputInvoice.update({
    where: { id: invoiceId },
    data: { ledgerEntryId: entry.id },
  });
}

// ---------- GET /finance/input-invoices?from&to&declared=all|no|yes ----------
router.get(
  "/finance/input-invoices",
  requirePlatformPermission("hq.finance"),
  async (req, res, next) => {
    try {
      const from = typeof req.query.from === "string" && DATE_KEY_RE.test(req.query.from) ? req.query.from : null;
      const to = typeof req.query.to === "string" && DATE_KEY_RE.test(req.query.to) ? req.query.to : null;
      const declared = req.query.declared === "yes" ? "yes" : req.query.declared === "no" ? "no" : "all";
      const where: Prisma.PlatformInputInvoiceWhereInput = {};
      if (from || to) {
        // Tờ chưa đọc được ngày (invoiceDate null) vẫn hiện khi lọc — kẻo kế toán bỏ sót
        where.OR = [
          { invoiceDate: null },
          {
            invoiceDate: {
              ...(from ? { gte: dateKeyToDb(from) } : {}),
              ...(to ? { lte: dateKeyToDb(to) } : {}),
            },
          },
        ];
      }
      if (declared === "yes") where.declaredPeriod = { not: null };
      if (declared === "no") where.declaredPeriod = null;
      const rows = await prisma.platformInputInvoice.findMany({
        where,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        select: INVOICE_SELECT,
        take: 2000,
      });
      const items = rows.map(serialize);
      const totals = {
        count: items.length,
        total: items.reduce((s, r) => s + r.total, 0),
        vat: items.filter((r) => !r.isForeign).reduce((s, r) => s + r.vatAmount, 0),
        pending: items.filter((r) => r.reviewStatus === "PENDING").length,
        undeclared: items.filter((r) => !r.declaredPeriod).length,
        foreign: items.filter((r) => r.isForeign).length,
      };
      res.json({
        items,
        totals,
        storageReady: isStorageConfigured(),
        aiReady: invoiceAiConfigured(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- POST /finance/input-invoices/upload (multipart files[]) ----------
// Mỗi tệp xử lý độc lập: lỗi một tệp không làm hỏng tệp khác; kết quả trả
// từng dòng để UI báo "đã lên / gộp vào tờ có sẵn / lỗi".
router.post(
  "/finance/input-invoices/upload",
  requirePlatformPermission("hq.finance"),
  upload.array("files", 30),
  async (req: AuthRequest, res, next) => {
    try {
      if (!isStorageConfigured()) {
        res.status(503).json({ error: "Kho tệp (Supabase Storage) chưa cấu hình trên máy chủ" });
        return;
      }
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: "Chưa chọn tệp nào" });
        return;
      }
      const actor = { id: req.userId!, name: await actorName(req.userId!) };
      const results: {
        fileName: string;
        status: "created" | "merged" | "error";
        invoiceId?: string;
        message?: string;
      }[] = [];

      for (const f of files) {
        const fileName = safeName(f.originalname);
        const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
        const mime = MIME_BY_EXT[ext] ?? (looksLikeXml(f.buffer) ? "application/xml" : f.mimetype);
        if (!MIME_BY_EXT[ext] && !mime.startsWith("image/") && mime !== "application/pdf" && !mime.endsWith("xml")) {
          results.push({ fileName, status: "error", message: "Chỉ nhận PDF, XML hoặc ảnh JPG/PNG/WebP" });
          continue;
        }
        try {
          const { data, source, error } = await extractFrom(f.buffer, mime, fileName);
          // Gộp trùng: cùng MST + số HĐ (+ ký hiệu nếu có) → thêm tệp vào dòng cũ;
          // XML đè số liệu của AI (XML là bản pháp lý, chính xác hơn).
          let existing: { id: string; source: string } | null = null;
          if (data?.sellerTaxCode && data.invoiceNo) {
            existing = await prisma.platformInputInvoice.findFirst({
              where: {
                sellerTaxCode: data.sellerTaxCode,
                invoiceNo: data.invoiceNo,
                ...(data.invoiceSerial ? { invoiceSerial: data.invoiceSerial } : {}),
              },
              select: { id: true, source: true },
            });
          }
          const storagePath = `${new Date().getFullYear()}/${randomUUID()}-${fileName}`;
          await hqDocuments.upload(storagePath, f.buffer, mime);
          const fileData = {
            storagePath,
            fileName,
            mimeType: mime,
            size: f.size,
            kind: kindOf(mime),
            extracted: data ? JSON.stringify(data) : null,
          };
          if (existing) {
            const overwrite = source === "XML" && existing.source !== "XML" && data;
            await prisma.platformInputInvoice.update({
              where: { id: existing.id },
              data: {
                files: { create: fileData },
                ...(overwrite
                  ? {
                      subtotal: data.subtotal,
                      vatRate: data.vatRate,
                      vatAmount: data.vatAmount,
                      total: data.total,
                      invoiceDate: data.invoiceDate ? dateKeyToDb(data.invoiceDate) : undefined,
                      sellerName: data.sellerName ?? undefined,
                      source: "XML",
                      readerNote: "Số liệu lấy lại từ XML (đè bản AI đọc trước đó).",
                    }
                  : {}),
              },
            });
            if (overwrite) await syncLedger(existing.id, actor);
            results.push({ fileName, status: "merged", invoiceId: existing.id });
            continue;
          }
          const vnd = data
            ? await toVnd(data)
            : { subtotal: 0, vatAmount: 0, total: 0, currency: null, amountOriginal: null, fxRate: null, note: null };
          const noteParts = [error, data?.note, vnd.note].filter(Boolean);
          const created = await prisma.platformInputInvoice.create({
            data: {
              invoiceNo: data?.invoiceNo ?? null,
              invoiceSerial: data?.invoiceSerial ?? null,
              invoiceDate: data?.invoiceDate ? dateKeyToDb(data.invoiceDate) : null,
              sellerName: data?.sellerName ?? null,
              sellerTaxCode: data?.sellerTaxCode ?? null,
              isForeign: data?.isForeign ?? false,
              description: data?.description ?? null,
              subtotal: vnd.subtotal,
              vatRate: data?.vatRate ?? null,
              vatAmount: vnd.vatAmount,
              total: vnd.total,
              currency: vnd.currency,
              amountOriginal: vnd.amountOriginal,
              fxRate: vnd.fxRate,
              paymentMethod: data?.paymentMethod ?? null,
              expenseCategory:
                data?.expenseCategory ?? (data?.isForeign ? "SOFTWARE" : null),
              source: source === "NONE" ? "MANUAL" : source,
              reviewStatus: "PENDING",
              readerNote: noteParts.length ? noteParts.join(" ") : null,
              createdById: actor.id,
              createdByName: actor.name,
              files: { create: fileData },
            },
            select: { id: true },
          });
          await syncLedger(created.id, actor);
          results.push({
            fileName,
            status: "created",
            invoiceId: created.id,
            message: error ?? undefined,
          });
        } catch (err) {
          results.push({
            fileName,
            status: "error",
            message: err instanceof Error ? err.message : "Lỗi không rõ",
          });
        }
      }

      await writeAuditLog(req, {
        action: "input-invoice.upload",
        detail: {
          files: results.map((r) => ({ f: r.fileName, s: r.status, id: r.invoiceId ?? null })),
        },
      });
      res.status(201).json({ results });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- PATCH /finance/input-invoices/:id — sửa số / duyệt / tích khai ----------
// Body (mọi trường tùy chọn): invoiceNo, invoiceSerial, invoiceDate (yyyy-mm-dd),
// sellerName, sellerTaxCode, isForeign, description, subtotal, vatRate, vatAmount,
// total, paymentMethod, expenseCategory, approve: true,
// declaredPeriod: "2026-Q3" | null (null = bỏ tích, ghi audit).
router.patch(
  "/finance/input-invoices/:id",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const current = await prisma.platformInputInvoice.findUnique({
        where: { id: req.params.id },
        select: { id: true, declaredPeriod: true, invoiceNo: true, sellerName: true },
      });
      if (!current) {
        res.status(404).json({ error: "Không tìm thấy hóa đơn" });
        return;
      }
      const b = req.body ?? {};
      const data: Prisma.PlatformInputInvoiceUpdateInput = {};
      const str = (k: string) => {
        if (b[k] === undefined) return;
        const v = typeof b[k] === "string" ? b[k].trim() : "";
        (data as Record<string, unknown>)[k] = v || null;
      };
      for (const k of ["invoiceNo", "invoiceSerial", "sellerName", "sellerTaxCode", "description", "vatRate"]) str(k);
      if (b.invoiceDate !== undefined) {
        if (b.invoiceDate === null || b.invoiceDate === "") data.invoiceDate = null;
        else if (typeof b.invoiceDate === "string" && DATE_KEY_RE.test(b.invoiceDate)) {
          data.invoiceDate = dateKeyToDb(b.invoiceDate);
        } else {
          res.status(400).json({ error: "Ngày hóa đơn không hợp lệ" });
          return;
        }
      }
      if (b.isForeign !== undefined) data.isForeign = Boolean(b.isForeign);
      for (const k of ["subtotal", "vatAmount", "total"] as const) {
        if (b[k] === undefined) continue;
        const v = Number(b[k]);
        if (!Number.isFinite(v) || v < 0) {
          res.status(400).json({ error: "Số tiền không hợp lệ" });
          return;
        }
        data[k] = Math.round(v);
      }
      if (b.paymentMethod !== undefined) {
        if (b.paymentMethod !== null && !(PAYMENT_METHODS as readonly string[]).includes(b.paymentMethod)) {
          res.status(400).json({ error: "Hình thức thanh toán không hợp lệ (BANK/CASH)" });
          return;
        }
        data.paymentMethod = b.paymentMethod;
      }
      if (b.expenseCategory !== undefined) {
        if (b.expenseCategory !== null && !(EXPENSE_KEYS as readonly string[]).includes(b.expenseCategory)) {
          res.status(400).json({ error: "Khoản mục chi không hợp lệ" });
          return;
        }
        data.expenseCategory = b.expenseCategory;
      }
      if (b.approve === true) data.reviewStatus = "APPROVED";
      const name = await actorName(req.userId!);
      let declareAction: "declare" | "undeclare" | null = null;
      if (b.declaredPeriod !== undefined) {
        if (b.declaredPeriod === null) {
          data.declaredPeriod = null;
          data.declaredAt = null;
          data.declaredByName = null;
          declareAction = current.declaredPeriod ? "undeclare" : null;
        } else if (typeof b.declaredPeriod === "string" && PERIOD_RE.test(b.declaredPeriod)) {
          data.declaredPeriod = b.declaredPeriod;
          data.declaredAt = new Date();
          data.declaredByName = name;
          declareAction = "declare";
        } else {
          res.status(400).json({ error: "Kỳ khai không hợp lệ (VD 2026-Q3 hoặc 2026-09)" });
          return;
        }
      }
      await prisma.platformInputInvoice.update({ where: { id: current.id }, data });
      await syncLedger(current.id, { id: req.userId!, name });
      // Đọc lại SAU đồng bộ để trả ledgerEntryId vừa gắn (phiếu chi tạo lần đầu khi duyệt số).
      const updated = await prisma.platformInputInvoice.findUniqueOrThrow({
        where: { id: current.id },
        select: INVOICE_SELECT,
      });
      await writeAuditLog(req, {
        action: declareAction ? `input-invoice.${declareAction}` : "input-invoice.update",
        targetLabel: [current.invoiceNo, current.sellerName].filter(Boolean).join(" · ") || current.id,
        detail: { ...(b as Record<string, unknown>) } as Prisma.InputJsonValue,
      });
      res.json({ invoice: serialize(updated) });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- POST /finance/input-invoices/declare {ids[], period|null} ----------
// Tích/bỏ tích hàng loạt sau khi xuất bộ chứng từ.
router.post(
  "/finance/input-invoices/declare",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const ids: string[] = Array.isArray(req.body?.ids)
        ? req.body.ids.filter((x: unknown) => typeof x === "string")
        : [];
      const period = req.body?.period;
      if (ids.length === 0) {
        res.status(400).json({ error: "Chưa chọn hóa đơn nào" });
        return;
      }
      if (period !== null && !(typeof period === "string" && PERIOD_RE.test(period))) {
        res.status(400).json({ error: "Kỳ khai không hợp lệ (VD 2026-Q3 hoặc 2026-09)" });
        return;
      }
      const name = await actorName(req.userId!);
      const r = await prisma.platformInputInvoice.updateMany({
        where: { id: { in: ids } },
        data:
          period === null
            ? { declaredPeriod: null, declaredAt: null, declaredByName: null }
            : { declaredPeriod: period, declaredAt: new Date(), declaredByName: name },
      });
      await writeAuditLog(req, {
        action: period === null ? "input-invoice.undeclare" : "input-invoice.declare",
        detail: { ids, period, count: r.count },
      });
      res.json({ count: r.count });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- GET /finance/input-invoices/:id/files/:fileId/url ----------
router.get(
  "/finance/input-invoices/:id/files/:fileId/url",
  requirePlatformPermission("hq.finance"),
  async (req, res, next) => {
    try {
      const file = await prisma.platformInputInvoiceFile.findFirst({
        where: { id: req.params.fileId, invoiceId: req.params.id },
        select: { storagePath: true },
      });
      if (!file) {
        res.status(404).json({ error: "Không tìm thấy tệp" });
        return;
      }
      const [url] = await hqDocuments.signedUrls([file.storagePath], 600);
      if (!url) {
        res.status(404).json({ error: "Tệp không còn trong kho" });
        return;
      }
      res.json({ url });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- DELETE /finance/input-invoices/:id — xóa tờ + tệp + phiếu chi ----------
// Tờ ĐÃ KHAI THUẾ không xóa được (bỏ tích trước — có audit).
router.delete(
  "/finance/input-invoices/:id",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const inv = await prisma.platformInputInvoice.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          invoiceNo: true,
          sellerName: true,
          declaredPeriod: true,
          ledgerEntryId: true,
          files: { select: { storagePath: true } },
        },
      });
      if (!inv) {
        res.status(404).json({ error: "Không tìm thấy hóa đơn" });
        return;
      }
      if (inv.declaredPeriod) {
        res.status(400).json({
          error: `Hóa đơn đã khai thuế kỳ ${inv.declaredPeriod} — bỏ tích "Đã khai" trước khi xóa`,
        });
        return;
      }
      await prisma.$transaction(async (tx) => {
        await tx.platformInputInvoice.delete({ where: { id: inv.id } });
        if (inv.ledgerEntryId) {
          await tx.platformLedgerEntry.deleteMany({ where: { id: inv.ledgerEntryId } });
        }
      });
      await hqDocuments.remove(inv.files.map((f) => f.storagePath)).catch(() => undefined);
      await writeAuditLog(req, {
        action: "input-invoice.delete",
        targetLabel: [inv.invoiceNo, inv.sellerName].filter(Boolean).join(" · ") || inv.id,
        detail: { files: inv.files.length, ledgerEntryId: inv.ledgerEntryId },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- POST /finance/input-invoices/export {ids[], label} → zip ----------
// Zip = tệp gốc (đặt tên ngày_NCC_số) + bang-ke-gtgt.csv (trong nước) +
// bang-ke-nha-thau.csv (nước ngoài) + danh-sach.csv (toàn bộ). UTF-8 BOM để
// Excel VN mở đúng dấu. Tích "đã khai" là bước riêng (POST /declare) sau khi
// FE nhận xong tệp — không trộn side-effect vào stream.
router.post(
  "/finance/input-invoices/export",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const ids: string[] = Array.isArray(req.body?.ids)
        ? req.body.ids.filter((x: unknown) => typeof x === "string")
        : [];
      if (ids.length === 0) {
        res.status(400).json({ error: "Chưa chọn hóa đơn nào để xuất" });
        return;
      }
      const label =
        typeof req.body?.label === "string" && /^[\w-]{1,40}$/.test(req.body.label)
          ? req.body.label
          : "chung-tu";
      const rows = await prisma.platformInputInvoice.findMany({
        where: { id: { in: ids } },
        orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
        select: { ...INVOICE_SELECT, files: { select: { storagePath: true, fileName: true } } },
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="hubsell-hoa-don-dau-vao-${label}.zip"`);
      const zip = archiver("zip", { zlib: { level: 6 } });
      zip.on("error", (err) => next(err));
      zip.pipe(res);

      const csvCell = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = [
        "Ngày HĐ",
        "Ký hiệu",
        "Số HĐ",
        "Nhà cung cấp",
        "MST",
        "Nội dung",
        "Giá chưa thuế (VND)",
        "Thuế suất",
        "Tiền thuế (VND)",
        "Tổng (VND)",
        "Ngoại tệ",
        "Số gốc",
        "Tỷ giá",
        "Thanh toán",
        "Khoản mục",
        "Nguồn đọc",
        "Đã duyệt",
        "Kỳ đã khai",
        "Tệp",
      ];
      const toLine = (r: (typeof rows)[number]) =>
        [
          r.invoiceDate ? r.invoiceDate.toISOString().slice(0, 10) : "",
          r.invoiceSerial,
          r.invoiceNo,
          r.sellerName,
          r.sellerTaxCode,
          r.description,
          Number(r.subtotal),
          r.vatRate,
          Number(r.vatAmount),
          Number(r.total),
          r.currency,
          r.amountOriginal === null ? "" : Number(r.amountOriginal),
          r.fxRate === null ? "" : Number(r.fxRate),
          r.paymentMethod,
          r.expenseCategory,
          r.source,
          r.reviewStatus === "APPROVED" ? "x" : "",
          r.declaredPeriod,
          r.files.map((f) => f.fileName).join(" | "),
        ]
          .map(csvCell)
          .join(",");
      const csv = (list: typeof rows) =>
        "﻿" + [header.join(","), ...list.map(toLine)].join("\r\n") + "\r\n";

      zip.append(csv(rows), { name: "danh-sach.csv" });
      zip.append(csv(rows.filter((r) => !r.isForeign)), { name: "bang-ke-gtgt-trong-nuoc.csv" });
      zip.append(csv(rows.filter((r) => r.isForeign)), { name: "bang-ke-nha-thau-nuoc-ngoai.csv" });

      for (const r of rows) {
        const prefix = [
          r.invoiceDate ? r.invoiceDate.toISOString().slice(0, 10) : "khong-ngay",
          safeName(r.sellerName ?? "ncc").replace(/\s+/g, "-").slice(0, 30),
          r.invoiceNo ?? r.id.slice(-6),
        ].join("_");
        for (const f of r.files) {
          try {
            const buf = await hqDocuments.download(f.storagePath);
            zip.append(buf, { name: `tep/${prefix}_${f.fileName}` });
          } catch {
            zip.append(`Không tải được ${f.fileName}`, { name: `tep/${prefix}_${f.fileName}.LOI.txt` });
          }
        }
      }
      await zip.finalize();
      await writeAuditLog(req, {
        action: "input-invoice.export",
        detail: { ids, count: rows.length, label },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
