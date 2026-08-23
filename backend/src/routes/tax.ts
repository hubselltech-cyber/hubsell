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
import { getInvoiceProvider } from "../integrations/invoice";
import type { InvoiceLine } from "../integrations/invoice";
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

// POST /api/tax/invoices — PHÁT HÀNH hóa đơn điện tử cho một đơn hàng.
// Body: { orderCode } (mã đơn trong tầm nhìn gian hàng của người gọi).
//
// Luồng: tìm đơn → dựng dòng hàng theo quy ước thuế của Hubsell (đơn giá bán
// coi là CHƯA thuế, % lấy từ Product.vatRate, tên in hóa đơn ưu tiên
// Product.taxName) → ghi InvoiceLog PENDING → gọi adapter NCC → cập nhật log
// + audit InvoiceStatusHistory (source HUBSELL) + Order.einvoiceStatus.
// Adapter không ném lỗi nghiệp vụ (trả FAILED + errorMessage) nên mọi kết quả
// đều được ghi sổ — kể cả khi NCC từ chối.
router.post("/invoices", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const orderCode = String(req.body?.orderCode ?? "").trim();
    if (!orderCode) {
      res.status(400).json({ error: "Thiếu mã đơn hàng (orderCode)" });
      return;
    }

    const order = await prisma.order.findFirst({
      where: { orderCode, channel: channelScope(req) },
      include: {
        items: {
          include: {
            product: { select: { skuCode: true, taxName: true, vatRate: true } },
          },
        },
      },
    });
    if (!order) {
      res.status(404).json({ error: `Không tìm thấy đơn ${orderCode} trong phạm vi của bạn` });
      return;
    }
    if (order.shippingStatus === ShippingStatus.CANCELLED) {
      res.status(400).json({ error: "Đơn đã hủy — không phát hành hóa đơn" });
      return;
    }
    if (order.items.length === 0) {
      res.status(400).json({ error: "Đơn không có dòng hàng nào để lên hóa đơn" });
      return;
    }

    // Chống phát hành trùng: đơn đã có hóa đơn đang chờ/đã phát hành thì dừng
    // (RefID phía MISA cũng chặn trùng, nhưng chặn sớm cho thông điệp rõ hơn).
    const existing = await prisma.invoiceLog.findFirst({
      where: {
        ownerId,
        orderCode,
        status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] },
      },
      select: { id: true, status: true, invoiceNo: true },
    });
    if (existing) {
      res.status(409).json({
        error:
          existing.status === InvoiceLogStatus.ISSUED
            ? `Đơn này đã có hóa đơn số ${existing.invoiceNo ?? "?"} — muốn phát hành lại phải hủy/thay thế trước.`
            : "Đơn này đang có yêu cầu phát hành chờ xử lý.",
      });
      return;
    }

    const provider = await getInvoiceProvider(ownerId, order.channelId);
    if (!provider) {
      res.status(400).json({
        error:
          "Chưa cấu hình nhà cung cấp hóa đơn (hoặc NCC chưa được hỗ trợ) — vào Kết nối & Xuất hóa đơn trước.",
      });
      return;
    }

    // MST sandbox của MISA chỉ dành cho tài khoản thí điểm — khách thường cấu
    // hình nhầm sẽ xuất hóa đơn dưới pháp nhân MISA(SANDBOX), chặn tại đây.
    const shopCfg = await prisma.invoiceConfig.findFirst({
      where: { ownerId, channelId: null },
      select: { taxCode: true },
    });
    if (
      shopCfg?.taxCode === MISA_SANDBOX_TAX_CODE &&
      !isTaxPilotUser(req.userEmail)
    ) {
      res.status(400).json({
        error:
          "MST đang cấu hình là MST sandbox của MISA (chỉ dùng để thử nghiệm nội bộ) — vui lòng nhập MST của chính shop.",
      });
      return;
    }

    // Dòng hàng theo quy ước InvoiceLine: unitPrice CHƯA thuế GTGT.
    const lines: InvoiceLine[] = order.items.map((it) => ({
      name: it.product?.taxName?.trim() || it.productName,
      sku: it.product?.skuCode ?? it.channelSku,
      quantity: it.quantity,
      unitPrice: Number(it.price),
      vatRate: it.product?.vatRate ?? 0,
    }));
    const vatTotal = lines.reduce(
      (s, l) => s + Math.round((l.unitPrice * l.quantity * l.vatRate) / 100),
      0
    );
    const totalAmount =
      lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) + vatTotal;

    const log = await prisma.invoiceLog.create({
      data: {
        ownerId,
        orderId: order.id,
        orderCode,
        provider: provider.name,
        status: InvoiceLogStatus.PENDING,
        totalAmount,
        vatAmount: vatTotal,
      },
    });

    const result = await provider.createInvoice({
      orderCode,
      buyerName: order.customerName,
      lines,
      totalAmount,
    });

    const issued = result.status === InvoiceLogStatus.ISSUED;
    const [updated] = await prisma.$transaction([
      prisma.invoiceLog.update({
        where: { id: log.id },
        data: {
          status: result.status,
          invoiceNo: result.invoiceNo ?? null,
          transactionId: result.transactionId ?? null,
          vatAmount: result.vatAmount ?? vatTotal,
          errorMessage: result.errorMessage ?? null,
          issuedAt: issued ? new Date() : null,
        },
      }),
      prisma.invoiceStatusHistory.create({
        data: {
          invoiceLogId: log.id,
          orderCode,
          fromStatus: InvoiceLogStatus.PENDING,
          toStatus: result.status,
          source: "HUBSELL",
          note: issued
            ? `Phát hành qua ${provider.name}: số ${result.invoiceNo ?? "?"}, mã tra cứu ${result.transactionId ?? "?"}`
            : result.errorMessage ?? null,
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { einvoiceStatus: result.status },
      }),
    ]);

    res.status(issued ? 201 : 502).json({
      log: {
        ...updated,
        totalAmount: Number(updated.totalAmount),
        vatAmount: Number(updated.vatAmount),
        platformTaxWithheld: Number(updated.platformTaxWithheld),
      },
      error: issued ? undefined : (result.errorMessage ?? "NCC từ chối phát hành"),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
