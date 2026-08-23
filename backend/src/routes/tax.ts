import { Router } from "express";
import {
  InvoiceLogStatus,
  ShippingStatus,
  TaxCalculationBase,
  TaxFilterPeriod,
} from "@prisma/client";

import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { channelScope } from "../channel-filter";
import { parseDateRange } from "../date-range";
import { issueInvoiceForOrder } from "../integrations/invoice/issue-order";
import {
  downloadInvoiceFiles,
  type StandardInvoiceConfig,
} from "../integrations/invoice/misa-einvoice";
import { isTaxPilotUser, MISA_SANDBOX_TAX_CODE } from "../tax-pilot";
// NGUỒN SỐ GỐC dùng chung (SSOT) — doanh thu/khấu trừ/giá vốn của đơn đều
// bóc qua computePnlRow, không tự cộng totalAmount − phí riêng nữa.
import { computePnlRow, fetchPnlOrders } from "./finance";
import {
  additionalTaxOn,
  getShopTaxConfig,
  PLATFORM_TAX_RATE,
  platformTaxOn,
} from "../tax-config";

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

    const [cfg, pnlOrders, logs] = await Promise.all([
      getShopTaxConfig(ownerId),
      // Đơn trong kỳ — cùng tập đơn SSOT với mọi báo cáo tài chính (đơn hủy
      // lọc ở vòng dưới; cùng trần an toàn 2000 đơn của fetchPnlOrders).
      fetchPnlOrders(channelScope(req), range),
      prisma.invoiceLog.findMany({
        where: { ownerId, createdAt: range },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          orderCode: true,
          provider: true,
          invoiceNo: true,
          transactionId: true, // mã tra cứu — nuôi nút Tải PDF + link tra cứu công khai
          status: true,
          totalAmount: true,
          vatAmount: true,
          platformTaxWithheld: true,
          errorMessage: true,
          issuedAt: true,
          createdAt: true,
        },
      }),
    ]);

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
      logs: logs.map((l) => ({
        ...l,
        totalAmount: Number(l.totalAmount),
        vatAmount: Number(l.vatAmount),
        platformTaxWithheld: Number(l.platformTaxWithheld),
      })),
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
    const [total, orders, cfg] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          orderCode: true,
          customerName: true,
          totalAmount: true,
          createdAt: true,
          isSettled: true,
          channel: { select: { channelName: true, shopName: true } },
          // Cảnh báo dòng hàng CHƯA LIÊN KẾT sản phẩm kho (thuế suất sẽ áp 0%).
          items: { select: { productId: true } },
        },
      }),
      prisma.invoiceConfig.findFirst({
        where: { ownerId, channelId: null },
        select: { autoIssueEnabled: true },
      }),
    ]);
    res.json({
      autoIssueEnabled: cfg?.autoIssueEnabled ?? false,
      total,
      rows: orders.map((o) => ({
        orderCode: o.orderCode,
        customerName: o.customerName,
        totalAmount: Number(o.totalAmount),
        orderedAt: o.createdAt,
        isSettled: o.isSettled,
        channelName: o.channel.channelName,
        shopName: o.channel.shopName,
        unlinkedItems: o.items.filter((i) => i.productId === null).length,
      })),
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
