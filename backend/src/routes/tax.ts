import { Router } from "express";
import {
  InvoiceLogStatus,
  ShippingStatus,
  TaxCalculationBase,
  TaxFilterPeriod,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { channelScope } from "../lib/channel-filter";
import { parseDateRange } from "../lib/date-range";
import {
  decideScopeFromPlatformReturn,
  issueAdjustmentForOrder,
  PLATFORM_RETURN_DONE_STATUSES,
  type AdjustmentScope,
} from "../integrations/invoice/adjust-order";
import { issueInvoiceForOrder } from "../integrations/invoice/issue-order";
import {
  downloadInvoiceFiles,
  type StandardInvoiceConfig,
} from "../integrations/invoice/misa-einvoice";
import { isTaxPilotUser, MISA_SANDBOX_TAX_CODE } from "../services/tax-pilot";
// NGUỒN SỐ GỐC dùng chung (SSOT) — doanh thu/khấu trừ/giá vốn của đơn đều
// bóc qua computePnlRow, không tự cộng totalAmount − phí riêng nữa.
import { computePnlRow, fetchPnlOrders } from "./finance";
import {
  additionalTaxOn,
  getShopTaxConfig,
  PLATFORM_TAX_RATE,
  platformTaxOn,
} from "../config/tax-config";

/**
 * MODULE HÓA ĐƠN & THUẾ — cấu hình "Thuế bổ sung" + báo cáo đối soát thuế.
 *
 *   GET /settings — cấu hình thuế của shop (mặc định khi chưa lưu lần nào).
 *   PUT /settings — lưu % thuế bổ sung, cơ sở tính (lợi nhuận/doanh thu), kỳ áp dụng.
 *   GET /report   — tổng hợp thuế sàn trích hộ + thuế bổ sung ước tính theo
 *                   khoảng ngày, kèm nhật ký hóa đơn điện tử (InvoiceLog).
 *
 * % thuế đi qua API ở dạng PHẦN TRĂM (1.5 = 1.5%) cho khớp ô nhập của UI;
 * trong DB lưu phân số (0.015) như Channel.feeRate — chuyển đổi tại đây.
 * Thuế sàn 1.5% là hằng số luật (PLATFORM_TAX_RATE) — chỉ trả về để hiển thị,
 * không có API sửa.
 */

const router = Router();

/**
 * ĐƠN QUÁ HẠN LẬP HÓA ĐƠN (03/09): NĐ 254/2026 — hóa đơn bán hàng qua sàn lập
 * chậm nhất NGÀY LÀM VIỆC TIẾP THEO sau khi giao thành công. Lấy 48h cho
 * rộng (cuối tuần/ngày lễ không xét), đơn giao xong quá mốc này mà chưa có
 * hóa đơn thì cắm cờ đỏ ở hàng chờ + đếm vào thẻ "Sót/Quá hạn" của báo cáo.
 */
export const INVOICE_OVERDUE_MS = 48 * 60 * 60 * 1000;

/**
 * Cửa sổ lọc nhật ký theo KỲ KÊ KHAI = ngày LẬP hóa đơn (issuedAt); bản ghi
 * chưa lập (PENDING/FAILED không có issuedAt) rơi về ngày tạo. Trước 03/09
 * lọc theo createdAt — tờ điều chỉnh lập tháng sau bị tính vào tháng trước.
 */
function logPeriodWhere(range: ReturnType<typeof parseDateRange>) {
  if (!range) return {};
  return { OR: [{ issuedAt: range }, { issuedAt: null, createdAt: range }] };
}

/** Chỉ hóa đơn ĐÃ lập trong kỳ (cho aggregate ISSUED). */
function issuedInRange(range: ReturnType<typeof parseDateRange>) {
  return range ? { issuedAt: range } : {};
}

/** Loại tờ bị CQT TỪ CHỐI khỏi mọi tổng — chưa hợp lệ tới khi gửi lại. */
const NOT_CQT_REJECTED = {
  OR: [{ cqtStatus: null }, { cqtStatus: { not: "REJECTED" } }],
};

const CALCULATION_BASES = Object.values(TaxCalculationBase);
const FILTER_PERIODS = Object.values(TaxFilterPeriod);

function serializeSettings(s: {
  customTaxRate: number;
  calculationBase: TaxCalculationBase;
  filterPeriod: TaxFilterPeriod;
}) {
  return {
    customTaxPercent: s.customTaxRate * 100,
    calculationBase: s.calculationBase,
    filterPeriod: s.filterPeriod,
    platformTaxPercent: PLATFORM_TAX_RATE * 100,
  };
}

// GET /api/tax/settings — cấu hình thuế hiện tại của shop.
router.get("/settings", async (req: AuthRequest, res, next) => {
  try {
    const cfg = await getShopTaxConfig(req.ownerId!);
    res.json({ settings: serializeSettings(cfg) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/tax/settings — lưu cấu hình.
// Body: { customTaxPercent, calculationBase, filterPeriod }
router.put("/settings", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const { customTaxPercent, calculationBase, filterPeriod } = req.body ?? {};

    if (!CALCULATION_BASES.includes(calculationBase)) {
      res.status(400).json({ error: "Cơ sở tính thuế không hợp lệ" });
      return;
    }
    if (!FILTER_PERIODS.includes(filterPeriod)) {
      res.status(400).json({ error: "Kỳ áp dụng không hợp lệ" });
      return;
    }
    const percent = Number(customTaxPercent);
    // Decimal(5,4) chứa tối đa 0.9999 → chặn 0–99.99%.
    if (!Number.isFinite(percent) || percent < 0 || percent > 99.99) {
      res
        .status(400)
        .json({ error: "% thuế bổ sung phải là số từ 0 đến 99.99" });
      return;
    }
    // Làm tròn 2 chữ số phần trăm (= 4 chữ số phân số) khớp Decimal(5,4).
    const customTaxRate = Math.round(percent * 100) / 10000;

    const saved = await prisma.shopTaxSetting.upsert({
      where: { ownerId },
      create: { ownerId, customTaxRate, calculationBase, filterPeriod },
      update: { customTaxRate, calculationBase, filterPeriod },
    });

    res.json({
      settings: serializeSettings({
        customTaxRate: Number(saved.customTaxRate),
        calculationBase: saved.calculationBase,
        filterPeriod: saved.filterPeriod,
      }),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/tax/report?from&to — báo cáo đối soát thuế của kỳ đang lọc.
router.get("/report", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const range = parseDateRange(req.query);
    const scope = channelScope(req);

    const [cfg, pnlOrders, logs] = await Promise.all([
      getShopTaxConfig(ownerId),
      // Đơn trong kỳ — cùng tập đơn SSOT với mọi báo cáo tài chính (đơn hủy
      // lọc ở vòng dưới; cùng trần an toàn 2000 đơn của fetchPnlOrders).
      fetchPnlOrders(scope, range),
      prisma.invoiceLog.findMany({
        where: { ownerId, ...logPeriodWhere(range) },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          orderCode: true,
          provider: true,
          invoiceNo: true,
          invoiceSeries: true,
          transactionId: true, // mã tra cứu — nuôi nút Tải PDF + link tra cứu công khai
          status: true,
          cqtStatus: true, // trạng thái phía CQT do worker invoice-status-sync kéo
          cqtCheckedAt: true,
          buyerName: true,
          buyerTaxCode: true,
          totalAmount: true,
          vatAmount: true,
          platformTaxWithheld: true,
          errorMessage: true,
          issuedAt: true,
          createdAt: true,
          adjustmentForLogId: true, // ≠ null = hóa đơn ĐIỀU CHỈNH (tiền âm)
          // Dữ liệu hoàn SÀN BÁO của đơn gốc — nuôi badge "Cần điều chỉnh" +
          // lựa chọn "Theo dữ liệu sàn" trong hộp điều chỉnh.
          order: {
            select: {
              platformReturnStatus: true,
              platformRefundAmount: true,
              items: { select: { returnedQuantity: true } },
            },
          },
        },
      }),
    ]);

    // ---- Thống kê HÓA ĐƠN của kỳ (24/08 khuya — anh Trung yêu cầu thẻ tổng
    // hợp xoay quanh hóa đơn thay vì toàn thuế sàn): tính bằng aggregate trên
    // TOÀN KỲ, không cộng từ 200 dòng đang hiển thị kẻo lệch khi kỳ dài.
    // Hóa đơn điều chỉnh mang TIỀN ÂM nên tổng gộp 2 nhóm = giá trị RÒNG.
    // 03/09: kỳ = NGÀY LẬP (issuedAt), tờ CQT từ chối KHÔNG vào tổng.
    const [
      issuedAgg,
      adjustedAgg,
      failedCount,
      cqtRejectedCount,
      cqtWaitingCount,
      cqtUncheckedCount,
      cancelledCount,
    ] = await Promise.all([
      prisma.invoiceLog.aggregate({
        where: {
          ownerId,
          status: InvoiceLogStatus.ISSUED,
          adjustmentForLogId: null,
          AND: [issuedInRange(range), NOT_CQT_REJECTED],
        },
        _count: true,
        _sum: { totalAmount: true, vatAmount: true },
      }),
      prisma.invoiceLog.aggregate({
        where: {
          ownerId,
          status: InvoiceLogStatus.ISSUED,
          adjustmentForLogId: { not: null },
          AND: [issuedInRange(range), NOT_CQT_REJECTED],
        },
        _count: true,
        _sum: { totalAmount: true, vatAmount: true },
      }),
      prisma.invoiceLog.count({
        where: { ownerId, createdAt: range, status: InvoiceLogStatus.FAILED },
      }),
      prisma.invoiceLog.count({
        where: {
          ownerId,
          status: InvoiceLogStatus.ISSUED,
          cqtStatus: "REJECTED",
          ...issuedInRange(range),
        },
      }),
      prisma.invoiceLog.count({
        where: {
          ownerId,
          status: InvoiceLogStatus.ISSUED,
          cqtStatus: { in: ["WAITING", "SEND_ERROR"] },
          ...issuedInRange(range),
        },
      }),
      prisma.invoiceLog.count({
        where: {
          ownerId,
          status: InvoiceLogStatus.ISSUED,
          cqtStatus: null,
          ...issuedInRange(range),
        },
      }),
      prisma.invoiceLog.count({
        where: { ownerId, status: InvoiceLogStatus.CANCELLED, ...logPeriodWhere(range) },
      }),
    ]);

    // ---- ĐỐI CHIẾU SÓT (03/09 — kế toán trưởng hỏi "kỳ này bao nhiêu đơn
    // giao xong, bao nhiêu tờ, sót bao nhiêu"): đếm trên ĐƠN theo ngày giao
    // (deliveredAt), cùng phạm vi gian của người xem. Đơn cũ chưa có
    // deliveredAt (trước khi cột này được ghi) không vào phép đếm — nói rõ
    // trên UI là "theo ngày giao".
    const overdueCutoff = new Date(Date.now() - INVOICE_OVERDUE_MS);
    const deliveredWhere = {
      channel: scope,
      shippingStatus: ShippingStatus.DELIVERED,
      items: { some: {} },
      deliveredAt: range ?? { not: null },
    };
    const noInvoice = {
      invoiceLogs: {
        none: { status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] } },
      },
    };
    const [deliveredCount, missingCount, overdueCount] = await Promise.all([
      prisma.order.count({ where: deliveredWhere }),
      prisma.order.count({ where: { ...deliveredWhere, ...noInvoice } }),
      prisma.order.count({
        where: {
          ...deliveredWhere,
          ...noInvoice,
          AND: [{ deliveredAt: { lt: overdueCutoff } }],
        },
      }),
    ]);
    const coverage = {
      /** Đơn giao thành công trong kỳ (theo ngày giao). */
      deliveredCount,
      /** Trong đó đã có hóa đơn (đang chờ NCC hoặc đã phát hành). */
      invoicedCount: deliveredCount - missingCount,
      /** Chưa có hóa đơn — còn nằm ở hàng chờ. */
      missingCount,
      /** Chưa có hóa đơn VÀ đã giao quá 48h — vi phạm mốc "ngày làm việc tiếp theo". */
      overdueCount,
      overdueHours: INVOICE_OVERDUE_MS / 3_600_000,
    };
    // Đếm "CẦN ĐIỀU CHỈNH" toàn kỳ: hóa đơn bán ISSUED mà đơn gốc đã được sàn
    // chốt hoàn nhưng chưa có hóa đơn điều chỉnh nào (PENDING/ISSUED).
    const needCandidates = await prisma.invoiceLog.findMany({
      where: {
        ownerId,
        ...issuedInRange(range),
        status: InvoiceLogStatus.ISSUED,
        adjustmentForLogId: null,
        order: {
          platformReturnStatus: { in: [...PLATFORM_RETURN_DONE_STATUSES] },
        },
      },
      select: { id: true },
    });
    const alreadyAdjusted = new Set(
      needCandidates.length > 0
        ? (
            await prisma.invoiceLog.findMany({
              where: {
                adjustmentForLogId: { in: needCandidates.map((c) => c.id) },
                status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] },
              },
              select: { adjustmentForLogId: true },
            })
          ).map((a) => a.adjustmentForLogId!)
        : []
    );

    const invoiceSummary = {
      issuedCount: issuedAgg._count,
      adjustmentCount: adjustedAgg._count,
      failedCount,
      /** Số hóa đơn sàn đã chốt hoàn mà seller CHƯA điều chỉnh — phải xử lý. */
      needsAdjustmentCount: needCandidates.filter((c) => !alreadyAdjusted.has(c.id)).length,
      /** Tổng giá trị hóa đơn RÒNG của kỳ (hóa đơn bán − phần đã điều chỉnh). */
      invoicedAmount:
        Number(issuedAgg._sum.totalAmount ?? 0) + Number(adjustedAgg._sum.totalAmount ?? 0),
      /** Thuế GTGT đầu ra RÒNG của kỳ. */
      invoicedVat:
        Number(issuedAgg._sum.vatAmount ?? 0) + Number(adjustedAgg._sum.vatAmount ?? 0),
      /** Phần giá trị đã điều chỉnh giảm (số DƯƠNG để hiển thị). */
      adjustedAmount: Math.abs(Number(adjustedAgg._sum.totalAmount ?? 0)),
      /** Tờ đã ký nhưng CQT TỪ CHỐI — không hợp lệ, đã loại khỏi tổng trên. */
      cqtRejectedCount,
      /** Tờ đang chờ CQT cấp mã / gửi CQT lỗi (worker sẽ kiểm lại). */
      cqtWaitingCount,
      /** Tờ ISSUED chưa được worker kiểm lần nào. */
      cqtUncheckedCount,
      /** Tờ đã hủy/xóa (trên NCC hoặc qua webhook) trong kỳ. */
      cancelledCount,
    };

    // Hóa đơn gốc nào TRONG TRANG này đã có điều chỉnh đang chờ/đã phát hành —
    // FE dựa vào để ẩn nút "Điều chỉnh giảm" (điều chỉnh có thể nằm ngoài kỳ
    // đang xem nên phải hỏi DB, không suy từ 200 dòng đang trả).
    const adjustedIds = new Set(
      (
        await prisma.invoiceLog.findMany({
          where: {
            adjustmentForLogId: { in: logs.map((l) => l.id) },
            status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] },
          },
          select: { adjustmentForLogId: true },
        })
      ).map((a) => a.adjustmentForLogId!)
    );

    // ---- Thuế sàn TMĐT trích hộ ----
    // Đơn ĐÃ quyết toán: dùng số THỰC sàn đã khấu trừ (platformTax của dòng).
    // Đơn CHƯA quyết toán: ước tính % luật trên doanh thu thực tế (sau
    // voucher) — riêng trang thuế được ước vì bản chất là DỰ PHÒNG nghĩa vụ.
    const rows = pnlOrders
      .map(computePnlRow)
      .filter((r) => r.shippingStatus !== ShippingStatus.CANCELLED);

    let grossRevenue = 0;
    let profit = 0; // lợi nhuận ước tính của kỳ — cơ sở thuế bổ sung cho DN
    let platformTaxActual = 0;
    let estimateBase = 0; // doanh thu của phần đơn chưa quyết toán
    let settledCount = 0;

    for (const r of rows) {
      grossRevenue += r.revenueGross;
      // Lợi nhuận cùng công thức chốt: Doanh thu thực tế − giá vốn.
      profit += r.profitAfterTax;
      if (r.isSettled) {
        platformTaxActual += r.platformTax;
        settledCount += 1;
      } else {
        estimateBase += r.platformRevenue; // doanh thu thực tế (sau voucher)
      }
    }
    const platformTaxEstimated = platformTaxOn(estimateBase);
    const additionalTax = additionalTaxOn({ grossRevenue, profit }, cfg);

    res.json({
      settings: serializeSettings(cfg),
      invoiceSummary,
      coverage,
      summary: {
        orderCount: rows.length,
        settledCount,
        grossRevenue,
        platformTaxActual, // sàn ĐÃ trích (số quyết toán thật)
        platformTaxEstimated, // ước tính cho phần đơn chưa quyết toán
        platformTaxTotal: platformTaxActual + platformTaxEstimated,
        additionalTax, // thuế bổ sung ước tính theo cấu hình
        // Cơ sở tính thuế bổ sung để UI chú thích đúng ("trên doanh thu/lợi nhuận")
        additionalTaxBase:
          cfg.calculationBase === TaxCalculationBase.REVENUE
            ? grossRevenue
            : Math.max(0, profit),
      },
      logs: logs
        .map((l) => {
          const { order, ...rest } = l;
          const platformStatus = order?.platformReturnStatus ?? null;
          const returnDone =
            platformStatus !== null && PLATFORM_RETURN_DONE_STATUSES.has(platformStatus);
          const hasAdjustment = adjustedIds.has(l.id);
          return {
            ...rest,
            totalAmount: Number(l.totalAmount),
            vatAmount: Number(l.vatAmount),
            platformTaxWithheld: Number(l.platformTaxWithheld),
            hasAdjustment,
            // Sàn đã chốt hoàn mà hóa đơn bán chưa có điều chỉnh → seller phải xử lý.
            needsAdjustment:
              l.status === InvoiceLogStatus.ISSUED &&
              !l.adjustmentForLogId &&
              returnDone &&
              !hasAdjustment,
            returnInfo: returnDone
              ? {
                  platformStatus,
                  refundAmount: Number(order?.platformRefundAmount ?? 0),
                  returnedItems: (order?.items ?? []).reduce(
                    (s, it) => s + (it.returnedQuantity ?? 0),
                    0
                  ),
                }
              : null,
          };
        })
        // GHIM "cần điều chỉnh" lên đầu (anh Trung 25/08: nghìn hóa đơn/ngày
        // phải lòi ngay vài tờ cần xử lý), còn lại giữ mới-nhất-trước.
        .sort((a, b) => Number(b.needsAdjustment) - Number(a.needsAdjustment)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Chặn khách thường phát hành khi cấu hình đang trỏ MST sandbox của MISA —
 * xuất nhầm là hóa đơn mang pháp nhân MISA(SANDBOX). Trả message lỗi hoặc
 * null nếu được phép. Dùng chung cho route đơn lẻ + hàng loạt.
 */
async function sandboxTaxCodeBlocked(req: AuthRequest): Promise<string | null> {
  const shopCfg = await prisma.invoiceConfig.findFirst({
    where: { ownerId: req.ownerId!, channelId: null },
    select: { taxCode: true },
  });
  if (shopCfg?.taxCode === MISA_SANDBOX_TAX_CODE && !isTaxPilotUser(req.userEmail)) {
    return "MST đang cấu hình là MST sandbox của MISA (chỉ dùng để thử nghiệm nội bộ) — vui lòng nhập MST của chính shop.";
  }
  return null;
}

// POST /api/tax/invoices — PHÁT HÀNH hóa đơn cho MỘT đơn (lõi ở issue-order.ts).
router.post("/invoices", async (req: AuthRequest, res, next) => {
  try {
    const orderCode = String(req.body?.orderCode ?? "").trim();
    if (!orderCode) {
      res.status(400).json({ error: "Thiếu mã đơn hàng (orderCode)" });
      return;
    }
    const blocked = await sandboxTaxCodeBlocked(req);
    if (blocked) {
      res.status(400).json({ error: blocked });
      return;
    }
    const r = await issueInvoiceForOrder(req.ownerId!, channelScope(req), orderCode);
    res.status(r.httpStatus).json({ log: r.log, error: r.error });
  } catch (err) {
    next(err);
  }
});

// POST /api/tax/invoices/bulk — phát hành HÀNG LOẠT từ hàng chờ.
// Body: { orderCodes: string[] } (tối đa 50/lần). Xử lý TUẦN TỰ từng đơn theo
// yêu cầu của MISA (số hóa đơn cấp liên tục theo ký hiệu — bắn song song là
// dính InvoiceNumberNotCotinuous), đơn lỗi không chặn đơn sau.
router.post("/invoices/bulk", async (req: AuthRequest, res, next) => {
  try {
    const raw = req.body?.orderCodes;
    const orderCodes: string[] = Array.isArray(raw)
      ? [...new Set(raw.map((c) => String(c).trim()).filter((c) => c !== ""))]
      : [];
    if (orderCodes.length === 0) {
      res.status(400).json({ error: "Thiếu danh sách mã đơn (orderCodes)" });
      return;
    }
    if (orderCodes.length > 50) {
      res.status(400).json({ error: "Tối đa 50 đơn mỗi lần phát hành hàng loạt" });
      return;
    }
    const blocked = await sandboxTaxCodeBlocked(req);
    if (blocked) {
      res.status(400).json({ error: blocked });
      return;
    }

    const scope = channelScope(req);
    const results: Array<{
      orderCode: string;
      ok: boolean;
      invoiceNo?: string | null;
      error?: string;
    }> = [];
    for (const orderCode of orderCodes) {
      const r = await issueInvoiceForOrder(req.ownerId!, scope, orderCode);
      results.push({
        orderCode,
        ok: r.ok,
        invoiceNo: r.log?.invoiceNo ?? null,
        error: r.error,
      });
    }
    const issued = results.filter((r) => r.ok).length;
    res.json({ issued, failed: results.length - issued, results });
  } catch (err) {
    next(err);
  }
});

// GET /api/tax/invoice-queue — HÀNG CHỜ XUẤT HÓA ĐƠN (học BigSeller): đơn ĐÃ
// GIAO THÀNH CÔNG, chưa hủy, chưa có hóa đơn PENDING/ISSUED — tự nạp, seller
// chỉ việc tick và bấm. Kèm cờ cấu hình tự động xuất để UI vẽ công tắc.
//
// Query ?settled=yes|no lọc theo trạng thái đối soát (UI tab lọc); total và
// settledTotal luôn đếm trên TOÀN hàng chờ để số trên tab không nhảy theo tab
// đang chọn. Cờ `configured` cho UI nhắc sang tab Cấu hình khi chưa đủ điều
// kiện phát hành (24/08 — hàng chờ chỉ dựa TRẠNG THÁI ĐƠN, đã bỏ cảnh báo
// liên kết SKU kho theo chốt của anh Trung).
//
// PHÂN TRANG (24/08 chiều — anh Trung yêu cầu): ?page (từ 1) + ?pageSize
// (20 | 50 | 100, mặc định 20). Sắp xếp ghim "khách cần hóa đơn" là ORDER BY
// toàn cục nên đơn ghim luôn dồn về các trang đầu, không phụ thuộc trang.
const QUEUE_PAGE_SIZES = new Set([20, 50, 100]);
router.get("/invoice-queue", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const scope = channelScope(req);
    const where = {
      channel: scope,
      shippingStatus: ShippingStatus.DELIVERED,
      items: { some: {} },
      invoiceLogs: {
        none: { status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] } },
      },
    };
    const settledParam =
      req.query.settled === "yes" ? true : req.query.settled === "no" ? false : undefined;
    const pageSizeRaw = Number(req.query.pageSize);
    const pageSize = QUEUE_PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 20;
    const pageRaw = Number(req.query.page);
    const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
    const overdueCutoff = new Date(Date.now() - INVOICE_OVERDUE_MS);
    const [total, settledTotal, overdueTotal, orders, cfg] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({ where: { ...where, isSettled: true } }),
      // Đã giao quá 48h mà chưa có hóa đơn — vi phạm mốc lập hóa đơn (03/09).
      prisma.order.count({ where: { ...where, deliveredAt: { lt: overdueCutoff } } }),
      prisma.order.findMany({
        where: settledParam === undefined ? where : { ...where, isSettled: settledParam },
        // Đơn KHÁCH YÊU CẦU HÓA ĐƠN nổi lên đầu (khách đang chờ, hạn "ngày làm
        // việc tiếp theo"), trong nhóm thì đơn mới trước.
        orderBy: [
          { invoiceRequestType: { sort: "asc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          orderCode: true,
          customerName: true,
          totalAmount: true,
          createdAt: true,
          deliveredAt: true,
          isSettled: true,
          invoiceRequestType: true,
          buyerInvoiceInfo: true,
          channel: { select: { channelName: true, shopName: true } },
        },
      }),
      prisma.invoiceConfig.findFirst({
        where: { ownerId, channelId: null },
        select: {
          autoIssueEnabled: true,
          autoAdjustEnabled: true,
          invoiceSeries: true,
          meinvoiceUsername: true,
        },
      }),
    ]);
    res.json({
      autoIssueEnabled: cfg?.autoIssueEnabled ?? false,
      autoAdjustEnabled: cfg?.autoAdjustEnabled ?? false,
      // Đủ điều kiện phát hành tối thiểu: đã chọn ký hiệu + có tài khoản meInvoice.
      configured: Boolean(cfg?.invoiceSeries && cfg?.meinvoiceUsername),
      total,
      settledTotal,
      overdueTotal,
      overdueHours: INVOICE_OVERDUE_MS / 3_600_000,
      page,
      pageSize,
      rows: orders.map((o) => {
        // Gợi ý ngắn cho tooltip badge "Khách cần hóa đơn" — tên cty/khách +
        // MST, KHÔNG gửi nguyên JSON info (email/địa chỉ không cần trên list).
        const info = (o.buyerInvoiceInfo ?? {}) as {
          name?: string;
          taxId?: string;
          nationalId?: string;
          companyName?: string;
          companyTaxId?: string;
        };
        const hintName = info.companyName ?? info.name;
        const hintTax = info.companyTaxId ?? info.taxId ?? info.nationalId;
        return {
          orderCode: o.orderCode,
          customerName: o.customerName,
          totalAmount: Number(o.totalAmount),
          orderedAt: o.createdAt,
          deliveredAt: o.deliveredAt,
          // Giao xong quá 48h chưa có hóa đơn → badge đỏ "Quá hạn".
          overdue: o.deliveredAt !== null && o.deliveredAt < overdueCutoff,
          isSettled: o.isSettled,
          channelName: o.channel.channelName,
          shopName: o.channel.shopName,
          invoiceRequest: o.invoiceRequestType
            ? {
                type: o.invoiceRequestType,
                hint: [hintName, hintTax ? `MST/ĐDCN ${hintTax}` : null]
                  .filter(Boolean)
                  .join(" · ") || null,
              }
            : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/tax/auto-issue — bật/tắt TỰ ĐỘNG PHÁT HÀNH. Endpoint riêng thay vì
// đi qua PUT /invoice-config (route đó ghi đè TOÀN BỘ form — gọi thiếu trường
// là mất dữ liệu). Body: { enabled: boolean }.
router.put("/auto-issue", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const enabled = req.body?.enabled === true;
    const existing = await prisma.invoiceConfig.findFirst({
      where: { ownerId, channelId: null },
      select: { id: true },
    });
    if (!existing) {
      res.status(400).json({
        error: "Chưa có cấu hình hóa đơn — lưu trang Kết nối & Xuất hóa đơn trước.",
      });
      return;
    }
    await prisma.invoiceConfig.update({
      where: { id: existing.id },
      data: { autoIssueEnabled: enabled },
    });
    res.json({ autoIssueEnabled: enabled });
  } catch (err) {
    next(err);
  }
});

// PUT /api/tax/auto-adjust — công tắc TỰ ĐỘNG LẬP HÓA ĐƠN ĐIỀU CHỈNH khi đơn
// hoàn nhập kho (endpoint riêng như auto-issue — PUT /invoice-config ghi đè
// toàn form, không dùng cho partial update).
router.put("/auto-adjust", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const enabled = req.body?.enabled === true;
    const existing = await prisma.invoiceConfig.findFirst({
      where: { ownerId, channelId: null },
      select: { id: true },
    });
    if (!existing) {
      res.status(400).json({
        error: "Chưa có cấu hình hóa đơn — lưu trang Kết nối & Xuất hóa đơn trước.",
      });
      return;
    }
    await prisma.invoiceConfig.update({
      where: { id: existing.id },
      data: { autoAdjustEnabled: enabled },
    });
    res.json({ autoAdjustEnabled: enabled });
  } catch (err) {
    next(err);
  }
});

// POST /api/tax/invoices/:id/adjust — LẬP HÓA ĐƠN ĐIỀU CHỈNH GIẢM cho một hóa
// đơn ĐÃ PHÁT HÀNH (:id = InvoiceLog gốc), khách trả hàng hoàn tiền (TT 91/2026
// Đ.10 k.5c) — lõi ở adjust-order.ts. Body.mode:
//   · "PLATFORM" — phạm vi THEO DỮ LIỆU SÀN (dòng trả/số tiền hoàn — một phần
//     chính xác); sàn chưa báo gì thì 400 để seller chọn toàn bộ có chủ đích.
//   · "FULL" (mặc định) — giảm toàn bộ.
router.post("/invoices/:id/adjust", async (req: AuthRequest, res, next) => {
  try {
    const blocked = await sandboxTaxCodeBlocked(req);
    if (blocked) {
      res.status(400).json({ error: blocked });
      return;
    }
    const reason =
      String(req.body?.reason ?? "").trim() || "Khách trả hàng hoàn tiền";
    const mode = req.body?.mode === "PLATFORM" ? "PLATFORM" : "FULL";

    let scope: AdjustmentScope = { kind: "FULL" };
    let finalReason = reason;
    if (mode === "PLATFORM") {
      const original = await prisma.invoiceLog.findFirst({
        where: { id: req.params.id, ownerId: req.ownerId! },
        select: { orderId: true, totalAmount: true },
      });
      if (!original?.orderId) {
        res.status(400).json({ error: "Hóa đơn không còn gắn đơn gốc — chỉ điều chỉnh được toàn bộ." });
        return;
      }
      const decided = await decideScopeFromPlatformReturn(
        original.orderId,
        Number(original.totalAmount)
      );
      if (!decided) {
        res.status(400).json({
          error:
            "Sàn chưa báo dữ liệu hoàn cho đơn này (chưa có dòng hàng trả/số tiền hoàn) — chọn Giảm toàn bộ nếu chắc chắn.",
        });
        return;
      }
      scope = decided.scope;
      finalReason = decided.reason;
    }

    const r = await issueAdjustmentForOrder(
      req.ownerId!,
      channelScope(req),
      req.params.id,
      finalReason,
      scope
    );
    res.status(r.httpStatus).json({ log: r.log, error: r.error });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tax/invoices/register?from&to — BẢNG KÊ HÓA ĐƠN BÁN RA của kỳ
 * (03/09): mọi tờ ĐÃ LẬP (ISSUED + CANCELLED có số) theo NGÀY LẬP, không
 * giới hạn 200 dòng như /report (trần 5000 — nói rõ `truncated` nếu chạm).
 * Kế toán dùng để đối chiếu với dữ liệu trên cổng hoadondientu.gdt.gov.vn
 * trước khi nộp tờ khai; FE dựng Excel từ JSON này (lib/excel.ts).
 * Mỗi dòng tự đủ: ký hiệu, số, ngày lập, người mua + MST (snapshot lúc lập),
 * tiền chưa thuế / thuế / tổng, thuế suất, loại (bán / điều chỉnh cho số…),
 * trạng thái NCC + CQT, mã tra cứu.
 */
const REGISTER_MAX_ROWS = 5000;
router.get("/invoices/register", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const range = parseDateRange(req.query);
    const logs = await prisma.invoiceLog.findMany({
      where: {
        ownerId,
        status: { in: [InvoiceLogStatus.ISSUED, InvoiceLogStatus.CANCELLED] },
        invoiceNo: { not: null },
        ...issuedInRange(range),
      },
      orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }],
      take: REGISTER_MAX_ROWS,
      select: {
        id: true,
        issuedAt: true,
        createdAt: true,
        invoiceSeries: true,
        invoiceNo: true,
        transactionId: true,
        adjustmentForLogId: true,
        orderCode: true,
        buyerName: true,
        buyerTaxCode: true,
        totalAmount: true,
        vatAmount: true,
        lines: true,
        status: true,
        cqtStatus: true,
        order: {
          select: { channel: { select: { channelName: true, shopName: true } } },
        },
      },
    });

    // Số hóa đơn GỐC cho các tờ điều chỉnh (có thể nằm ngoài kỳ → hỏi DB).
    const origIds = logs.map((l) => l.adjustmentForLogId).filter((x): x is string => !!x);
    const origMap = new Map(
      origIds.length > 0
        ? (
            await prisma.invoiceLog.findMany({
              where: { id: { in: origIds } },
              select: { id: true, invoiceNo: true, invoiceSeries: true },
            })
          ).map((o) => [o.id, o])
        : []
    );

    const rows = logs.map((l) => {
      const lines = Array.isArray(l.lines) ? (l.lines as Array<{ vatRate?: unknown }>) : [];
      const rates = [...new Set(lines.map((x) => Number(x.vatRate)).filter((n) => Number.isFinite(n)))]
        .sort((a, b) => a - b);
      const orig = l.adjustmentForLogId ? origMap.get(l.adjustmentForLogId) : undefined;
      const total = Number(l.totalAmount);
      const vat = Number(l.vatAmount);
      return {
        id: l.id,
        issuedAt: l.issuedAt ?? l.createdAt,
        invoiceSeries: l.invoiceSeries,
        invoiceNo: l.invoiceNo,
        transactionId: l.transactionId,
        kind: l.adjustmentForLogId ? "ADJUSTMENT" : "SALE",
        adjustsInvoiceNo: orig?.invoiceNo ?? null,
        adjustsInvoiceSeries: orig?.invoiceSeries ?? null,
        orderCode: l.orderCode,
        channelName: l.order?.channel.channelName ?? null,
        shopName: l.order?.channel.shopName ?? null,
        buyerName: l.buyerName,
        buyerTaxCode: l.buyerTaxCode,
        amountWithoutVat: total - vat,
        vatAmount: vat,
        totalAmount: total,
        /** Các thuế suất xuất hiện trên tờ (VD [0] hoặc [8, 10]); rỗng với log đời trước snapshot. */
        vatRates: rates,
        status: l.status,
        cqtStatus: l.cqtStatus,
      };
    });
    res.json({ rows, truncated: logs.length >= REGISTER_MAX_ROWS });
  } catch (err) {
    next(err);
  }
});

// GET /api/tax/invoices/:id/pdf — tải BẢN THỂ HIỆN PDF (đã ký) của một hóa đơn
// ĐÃ PHÁT HÀNH trong nhật ký. Trả {fileName, base64} để FE tự tạo blob tải về
// (giữ apiFetch JSON thuần, không phải stream). PDF lấy TƯƠI từ meInvoice mỗi
// lần bấm — không cache file phía Hubsell.
router.get("/invoices/:id/pdf", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const log = await prisma.invoiceLog.findFirst({
      where: { id: req.params.id, ownerId },
      select: { invoiceNo: true, transactionId: true, status: true, provider: true },
    });
    if (!log) {
      res.status(404).json({ error: "Không tìm thấy hóa đơn trong nhật ký" });
      return;
    }
    if (log.provider !== "MISA") {
      res.status(400).json({ error: `NCC ${log.provider} chưa hỗ trợ tải PDF qua Hubsell.` });
      return;
    }
    if (log.status !== InvoiceLogStatus.ISSUED || !log.transactionId) {
      res.status(400).json({ error: "Hóa đơn chưa phát hành thành công — không có file để tải." });
      return;
    }

    const cfg = await prisma.invoiceConfig.findFirst({
      where: { ownerId, channelId: null },
    });
    const [file] = await downloadInvoiceFiles(
      [log.transactionId],
      "Pdf",
      (cfg ?? undefined) as unknown as StandardInvoiceConfig | undefined
    );
    if (!file?.data || file.errorCode) {
      res.status(502).json({
        error: `meInvoice không trả được file (${file?.errorCode ?? "không có dữ liệu"}) — thử lại sau.`,
      });
      return;
    }
    res.json({
      fileName: `hoa-don-${log.invoiceNo ?? log.transactionId}.pdf`,
      base64: file.data,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
