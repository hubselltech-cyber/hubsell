/**
 * SEED BỔ SUNG CHO ẢNH "6 CHỐT CHẶN" TRÊN LANDING — chạy SAU seed-landing-demo.ts
 * (script đó xóa & dựng lại shop "Sunny Closet"; script này chỉ bồi thêm dữ liệu
 * cho đúng user demo để 6 màn hình sau có số đẹp, không rỗng):
 *
 *   01 Lãi/Lỗ từng đơn   → thuế bổ sung, ~12 đơn bán lỗ (lọc "Lợi nhuận âm")
 *   02 Đối soát hàng hoàn → 32 kiện đủ 7 trạng thái, có kiện quá 14 ngày
 *   03 Phí vận chuyển     → 35 đơn lệch phí ship + 3 trạng thái khiếu nại
 *   04 Trợ lý quảng cáo   → ChannelProduct có externalId + 7 campaign + 7 ngày hiệu suất
 *   05 Cứu đơn giao thất bại → 34 DeliveryFailNotice + config bật auto-chat
 *   06 Hóa đơn điện tử    → InvoiceConfig qua gate + InvoiceLog đã phát hành + đơn "Cần HĐ"
 *
 * Quy tắc ánh xạ lấy từ báo cáo rà route 13/09 (docs/LANDING-KE-CHUYEN.md).
 * CHỈ CHẠY DB LOCAL. Idempotent theo nghĩa: chạy lại seed-landing-demo trước.
 *
 *   npx tsx scripts/seed-landing-demo.ts && npx tsx scripts/seed-landing-tour.ts
 */
import { PrismaClient, ReturnStatus, ShippingStatus } from "@prisma/client";

const prisma = new PrismaClient();
const DAY = 86_400_000;
const H = 3_600_000;
const DEMO_EMAIL = "demo@hubsell.tech";

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260913);
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const round500 = (n: number) => Math.round(n / 500) * 500;

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(dbUrl)) {
    throw new Error("TỪ CHỐI CHẠY: DATABASE_URL không phải localhost.");
  }
  const owner = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!owner) throw new Error("Chưa có user demo — chạy seed-landing-demo.ts trước.");
  const channels = await prisma.channel.findMany({ where: { userId: owner.id } });
  const shopee = channels.find((c) => c.channelName === "SHOPEE");
  const lazada = channels.find((c) => c.channelName === "LAZADA");
  if (!shopee || !lazada) throw new Error("Thiếu kênh Shopee/Lazada của user demo.");
  const now = Date.now();

  // ---------- 1) Thuế bổ sung 2% (thẻ "Thuế bổ sung" trang Lãi/Lỗ) ----------
  await prisma.shopTaxSetting.upsert({
    where: { ownerId: owner.id },
    create: { ownerId: owner.id, customTaxRate: 0.02, calculationBase: "PROFIT", filterPeriod: "MONTH" },
    update: { customTaxRate: 0.02 },
  });

  // ---------- 2) deliveredAt cho mọi đơn DELIVERED (hóa đơn quá hạn 48h, rổ chờ quyết toán) ----------
  const delivered = await prisma.order.findMany({
    where: { channelId: { in: [shopee.id, lazada.id] }, shippingStatus: ShippingStatus.DELIVERED },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });
  for (const o of delivered) {
    const at = Math.min(o.createdAt.getTime() + between(1.2, 2.6) * DAY, now - 2 * H);
    await prisma.order.update({ where: { id: o.id }, data: { deliveredAt: new Date(at) } });
  }

  const settledShopee = delivered.filter((o) => o.channelId === shopee.id && o.isSettled);
  const settledLazada = delivered.filter((o) => o.channelId === lazada.id && o.isSettled);
  const used = new Set<string>(); // mỗi đơn chỉ đóng một vai
  const take = (pool: typeof delivered, n: number) => {
    const out: typeof delivered = [];
    for (const o of pool) {
      if (out.length >= n) break;
      if (used.has(o.id)) continue;
      used.add(o.id);
      out.push(o);
    }
    return out;
  };

  // ---------- 3) ~12 đơn BÁN LỖ: giá vốn lúc bán cao (nhập lô đắt) + voucher shop sâu ----------
  // profit = payout − cost; đẩy cost lên ~92% giá bán và voucher 8% → âm vài chục nghìn/đơn
  const lossOrders = take(settledShopee.filter((o) => o.createdAt.getTime() > now - 12 * DAY), 12);
  for (const o of lossOrders) {
    for (const it of o.items) {
      await prisma.orderItem.update({
        where: { id: it.id },
        data: { costPriceAtSale: round500(Number(it.price) * between(0.88, 0.96)) },
      });
    }
  }
  // 2 SKU "gánh lỗ" ở cấp mã hàng (trang Cảnh báo & P&L sản phẩm → "Cần xử lý ngay"):
  // nhập lô sau giá vốn cao, bán giá cũ → biên âm trên MỌI đơn đã giao của SKU
  for (const sku of ["AO-THUN-M", "TUI-TOTE-01"]) {
    await prisma.orderItem.updateMany({
      where: { channelSku: sku, order: { channelId: { in: [shopee.id, lazada.id] }, shippingStatus: ShippingStatus.DELIVERED } },
      data: { costPriceAtSale: sku === "AO-THUN-M" ? 92_000 : 84_500 },
    });
  }

  // ---------- 4) 35 đơn LỆCH PHÍ SHIP (cân nặng tính vống) ----------
  const shipOrders = take(settledShopee, 25).concat(take(settledLazada, 10));
  const disputeStatuses = ["CHO_KHIEU_NAI", "CHO_KHIEU_NAI", "CHO_KHIEU_NAI", "DANG_KHIEU_NAI", "DA_DOI_SOAT"] as const;
  for (const o of shipOrders) {
    const quoted = round500(between(16_500, 25_000));
    const diff = round500(between(4_000, 18_500));
    await prisma.order.update({
      where: { id: o.id },
      data: {
        shippingFeeQuoted: quoted,
        shippingFeeActual: quoted + diff,
        shippingFeeDiff: diff,
        shippingDisputeStatus: pick(disputeStatuses),
      },
    });
  }

  // ---------- 5) 32 KIỆN HOÀN đủ trạng thái (trang Đối soát hàng hoàn) ----------
  type RetSpec = { status: ReturnStatus; n: number; agoDays: [number, number]; received?: boolean; restocked?: boolean; note?: string; comp?: number };
  const RET: RetSpec[] = [
    { status: ReturnStatus.AWAITING, n: 9, agoDays: [2, 5] },
    { status: ReturnStatus.AWAITING, n: 4, agoDays: [9, 12] },
    { status: ReturnStatus.AWAITING, n: 3, agoDays: [16, 22] },
    { status: ReturnStatus.RECEIVED, n: 5, agoDays: [3, 8], received: true },
    { status: ReturnStatus.RECEIVED_INTACT, n: 6, agoDays: [6, 15], received: true, restocked: true },
    { status: ReturnStatus.DAMAGED, n: 3, agoDays: [5, 12], received: true, note: "Kiện rách góc, thiếu 1 sản phẩm" },
    { status: ReturnStatus.CLAIM_SETTLED, n: 2, agoDays: [10, 15], received: true, note: "Sàn đền bù theo khiếu nại", comp: 180_000 },
  ];
  const retPool = delivered.filter((o) => !used.has(o.id));
  for (const spec of RET) {
    const rows = take(retPool, spec.n);
    for (const o of rows) {
      const isShopee = o.channelId === shopee.id;
      const requestedAt = new Date(now - between(spec.agoDays[0], spec.agoDays[1]) * DAY);
      const returnedAt = spec.received ? new Date(requestedAt.getTime() + between(2, 4) * DAY) : null;
      await prisma.order.update({
        where: { id: o.id },
        data: {
          returnStatus: spec.status,
          returnRequestedAt: requestedAt,
          returnedAt,
          returnNote: spec.note ?? null,
          compensationAmount: spec.comp ?? 0,
          returnTrackingCode: `${isShopee ? "SPXVN0R" : "LEXVN0R"}${Math.floor(between(4_100_000, 4_199_999))}`,
          stockRestoredAt: spec.restocked && returnedAt ? new Date(returnedAt.getTime() + 2 * H) : null,
          returnSolution: "RETURN_REFUND",
          platformRefundAmount: o.totalAmount,
        },
      });
    }
  }

  // ---------- 6) TRỢ LÝ QUẢNG CÁO: ChannelProduct có externalId + campaign + hiệu suất ----------
  const products = await prisma.product.findMany({ where: { userId: owner.id } });
  const extId = new Map<string, string>();
  let itemSeq = 900_101;
  for (const p of products) {
    const id = String(itemSeq++);
    extId.set(p.skuCode, id);
    await prisma.channelProduct.upsert({
      where: { channelId_channelSku: { channelId: shopee.id, channelSku: p.skuCode } },
      create: {
        channelId: shopee.id,
        channelSku: p.skuCode,
        productName: p.productName,
        price: p.sellingPrice,
        externalId: id,
        itemSku: p.skuCode,
        status: "ACTIVE",
        productId: p.id,
      },
      update: { externalId: id, itemSku: p.skuCode, productId: p.id },
    });
  }
  await prisma.channel.update({
    where: { id: shopee.id },
    data: {
      lastAdsSyncAt: new Date(now - 6 * 60_000),
      adsWalletBalance: 2_450_000,
      adsWalletSyncedAt: new Date(now - 6 * 60_000),
      nextAdsPulseAt: new Date(now + H),
    },
  });
  await prisma.adsCampaign.deleteMany({ where: { channelId: shopee.id } });
  const CAMPAIGNS = [
    { id: "SC-101", name: "Quần jean ống rộng — từ khóa chủ lực", sku: "QUAN-JEAN-32", adType: "manual", status: "ongoing", placement: "search", bidding: "manual", budget: 500_000, spend: 310_000, roas: 5.8 },
    { id: "SC-102", name: "Set đồ bộ thu đông — quảng cáo tự động", sku: "SET-DO-BO-L", adType: "auto", status: "ongoing", placement: "all", bidding: "auto", budget: 0, spend: 240_000, roas: 4.1, target: 3.5 },
    { id: "SC-103", name: "Váy hoa nhí — khám phá", sku: "VAY-HOA-S", adType: "manual", status: "ongoing", placement: "discovery", bidding: "manual", budget: 250_000, spend: 190_000, roas: 2.7 },
    { id: "SC-104", name: "Áo sơ mi lụa — từ khóa mở rộng", sku: "AO-SOMI-XL", adType: "manual", status: "ongoing", placement: "search", bidding: "manual", budget: 300_000, spend: 210_000, roas: 2.4 },
    { id: "SC-105", name: "Áo thun cotton — đẩy tồn", sku: "AO-THUN-M", adType: "manual", status: "ongoing", placement: "search", bidding: "manual", budget: 200_000, spend: 175_000, roas: 1.6 },
    { id: "SC-106", name: "Giày sneaker basic — mới chạy", sku: "GIAY-SNK-38", adType: "manual", status: "ongoing", placement: "search", bidding: "manual", budget: 80_000, spend: 9_000, roas: 3.2 },
    { id: "SC-107", name: "Túi tote canvas — đã tạm dừng", sku: "TUI-TOTE-01", adType: "manual", status: "paused", placement: "all", bidding: "auto", budget: 120_000, spend: 0, roas: 0 },
  ];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const c of CAMPAIGNS) {
    const price = Number(products.find((p) => p.skuCode === c.sku)?.sellingPrice ?? 200_000);
    const row = await prisma.adsCampaign.create({
      data: {
        channelId: shopee.id,
        campaignId: c.id,
        adType: c.adType,
        name: c.name,
        status: c.status,
        placement: c.placement,
        biddingMethod: c.bidding,
        budget: c.budget,
        roasTarget: c.target ?? null,
        startTime: new Date(today.getTime() - 25 * DAY),
        endTime: null,
        itemIds: extId.get(c.sku) ?? "",
      },
    });
    for (let i = 6; i >= 0; i--) {
      if (c.spend <= 0) continue;
      const date = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - i));
      const wave = 1 + 0.22 * Math.sin((6 - i) * 1.3);
      const spend = Math.round((c.spend * wave) / 1000) * 1000;
      const broadGmv = Math.round((spend * c.roas * (1 + 0.08 * Math.cos(i))) / 1000) * 1000;
      const directGmv = Math.round(broadGmv * 0.74);
      const clicks = Math.round(spend / 1_350);
      await prisma.adsCampaignDailyPerf.create({
        data: {
          adsCampaignId: row.id,
          date,
          impression: clicks * 42,
          clicks,
          expense: spend,
          broadOrder: Math.max(Math.round(broadGmv / price), 0),
          broadGmv,
          directOrder: Math.max(Math.round(directGmv / price), 0),
          directGmv,
        },
      });
    }
  }

  // ---------- 7) CỨU ĐƠN GIAO THẤT BẠI: 34 notice + config ----------
  await prisma.deliveryFailConfig.upsert({
    where: { ownerId: owner.id },
    create: {
      ownerId: owner.id,
      alertEnabled: true,
      autoChatEnabled: true,
      chatTemplate:
        "Bạn ơi, bên vận chuyển báo giao 2 lần không thành công cho đơn {ma_don}. Bạn vui lòng để ý điện thoại giúp shop nhé, hoặc liên hệ CSKH của sàn để khiếu nại nếu shipper cố tình không giao hàng ạ!",
    },
    update: { autoChatEnabled: true, alertEnabled: true },
  });
  await prisma.deliveryFailNotice.deleteMany({ where: { ownerId: owner.id } });
  const msgFor = (o: { orderCode: string }) =>
    `Bạn ơi, bên vận chuyển báo giao 2 lần không thành công cho đơn ${o.orderCode}. Bạn vui lòng để ý điện thoại giúp shop nhé!`;
  const allOrders = await prisma.order.findMany({
    where: { channelId: { in: [shopee.id, lazada.id] } },
    orderBy: { createdAt: "desc" },
  });
  const savedPool = allOrders.filter((o) => o.shippingStatus === "DELIVERED" && o.returnStatus === "NONE" && !used.has(o.id));
  const lostCancelled = allOrders.filter((o) => o.shippingStatus === "CANCELLED" && !used.has(o.id));
  const lostReturned = allOrders.filter((o) => o.returnStatus !== "NONE");
  const pendingPool = allOrders.filter((o) => o.shippingStatus === "SHIPPING" && !used.has(o.id));
  type NoticeSpec = { pool: typeof allOrders; n: number; outcome: "SAVED" | "LOST" | "PENDING"; chat: "SENT" | "NONE" | "FAILED" | "SKIPPED"; err?: string };
  const NOTICES: NoticeSpec[] = [
    { pool: savedPool, n: 13, outcome: "SAVED", chat: "SENT" },
    { pool: savedPool, n: 8, outcome: "SAVED", chat: "NONE" },
    { pool: lostCancelled, n: 5, outcome: "LOST", chat: "SENT" },
    { pool: lostReturned, n: 2, outcome: "LOST", chat: "FAILED", err: "Khách đã chặn cửa hàng — sàn từ chối gửi tin" },
    { pool: lostCancelled, n: 2, outcome: "LOST", chat: "SKIPPED" },
    { pool: pendingPool, n: 4, outcome: "PENDING", chat: "SENT" },
  ];
  for (const spec of NOTICES) {
    const rows = take(spec.pool, spec.n);
    for (const o of rows) {
      const detectedAt = new Date(now - between(0.2, 14) * DAY);
      await prisma.deliveryFailNotice.create({
        data: {
          ownerId: owner.id,
          orderId: o.id,
          failCount: rnd() < 0.7 ? 2 : 3,
          detectedAt,
          outcome: spec.outcome,
          outcomeAt: spec.outcome === "PENDING" ? null : new Date(detectedAt.getTime() + between(0.5, 2) * DAY),
          outcomeNote: spec.outcome === "SAVED" ? "LOGISTICS_DELIVERY_DONE" : spec.outcome === "LOST" ? "LOGISTICS_RETURNING" : null,
          chatStatus: spec.chat,
          chatError: spec.err ?? null,
          sentMessage: spec.chat === "SENT" ? msgFor(o) : null,
          sentAt: spec.chat === "SENT" ? new Date(detectedAt.getTime() + 60_000) : null,
        },
      });
    }
  }

  // ---------- 8) HÓA ĐƠN ĐIỆN TỬ: config qua gate + log đã phát hành + đơn "Cần HĐ" ----------
  const cfg = await prisma.invoiceConfig.findFirst({ where: { ownerId: owner.id, channelId: null } });
  const cfgData = {
    taxCode: "0316123456",
    companyName: "HỘ KINH DOANH SUNNY CLOSET",
    companyAddress: "12 Nguyễn Huệ, Phường Bến Nghé, TP. Hồ Chí Minh",
    provider: "MISA",
    invoicePattern: "1",
    invoiceSeries: "C26TSC",
    meinvoiceUsername: "sunnycloset",
    meinvoicePassword: "demo-only",
    signMethod: "ESIGN_CLOUD",
    defaultInvoiceType: "STANDARD" as const,
    defaultVatRate: 8,
    autoIssueEnabled: true,
    autoAdjustEnabled: true,
  };
  if (cfg) await prisma.invoiceConfig.update({ where: { id: cfg.id }, data: cfgData });
  else await prisma.invoiceConfig.create({ data: { ownerId: owner.id, channelId: null, ...cfgData } });

  await prisma.invoiceLog.deleteMany({ where: { ownerId: owner.id } });
  // Đơn "Khách cần HĐ" (ghim đầu hàng chờ): 6 đơn DELIVERED đã đối soát, chưa xuất
  const needInvoice = take(delivered.filter((o) => o.isSettled), 6);
  const companies = [
    ["CÔNG TY TNHH THỜI TRANG MINH ANH", "0312456789"],
    ["CÔNG TY CP THƯƠNG MẠI HẢI YẾN", "0109876543"],
    ["CÔNG TY TNHH GIA HÂN STORE", "0315551234"],
  ];
  for (const [i, o] of needInvoice.entries()) {
    const isCompany = i % 2 === 0;
    const co = companies[i % companies.length];
    await prisma.order.update({
      where: { id: o.id },
      data: {
        invoiceRequestType: isCompany ? "COMPANY" : "PERSONAL",
        buyerInvoiceInfo: isCompany
          ? { companyName: co[0], companyTaxId: co[1], address: "Hà Nội", email: "ketoan@example.com" }
          : { name: o.customerName, nationalId: `0790${Math.floor(between(10_000_000, 99_999_999))}`, address: "TP. Hồ Chí Minh" },
        buyerInvoiceFetchedAt: new Date(now - 3 * H),
      },
    });
  }
  // Mọi đơn DELIVERED đã đối soát còn lại → đã phát hành (auto-issue BẬT), trừ vài đơn lỗi/hủy
  const issuedPool = delivered.filter((o) => o.isSettled && !needInvoice.some((n) => n.id === o.id));
  let invNo = 101;
  let idx = 0;
  for (const o of issuedPool) {
    idx++;
    const total = Number(o.totalAmount);
    const vat = Math.round((total * 8) / 108);
    const status = idx % 97 === 0 ? "FAILED" : idx % 131 === 0 ? "CANCELLED" : "ISSUED";
    const issuedAt = o.deliveredAt ? new Date(Math.min(o.deliveredAt.getTime() + 2 * H, now - 30 * 60_000)) : new Date(now - H);
    await prisma.invoiceLog.create({
      data: {
        ownerId: owner.id,
        orderId: o.id,
        orderCode: o.orderCode,
        provider: "MISA",
        invoiceNo: status === "FAILED" ? null : String(invNo++).padStart(8, "0"),
        invoiceSeries: "C26TSC",
        transactionId: `SC-${o.orderCode}`,
        status,
        totalAmount: total,
        vatAmount: status === "FAILED" ? 0 : vat,
        platformTaxWithheld: o.taxWithheld,
        issuedAt: status === "FAILED" ? null : issuedAt,
        cqtStatus: status === "ISSUED" ? "ACCEPTED" : null,
        cqtCheckedAt: status === "ISSUED" ? issuedAt : null,
        buyerName: o.customerName,
        errorMessage: status === "FAILED" ? "Thông tin người mua thiếu địa chỉ — NCC từ chối phát hành" : null,
        lines: o.items.map((it) => ({ name: it.productName, sku: it.channelSku, qty: it.quantity, price: Number(it.price) })),
      },
    });
    if (status !== "FAILED") {
      await prisma.order.update({ where: { id: o.id }, data: { einvoiceStatus: status } });
    }
  }

  console.log(
    `✅ Seed tour xong: lỗ ${lossOrders.length} đơn · lệch ship ${shipOrders.length} · hoàn ${RET.reduce((s, r) => s + r.n, 0)} · campaign ${CAMPAIGNS.length} · notice ${NOTICES.reduce((s, r) => s + r.n, 0)} · hóa đơn ${issuedPool.length} log (cần HĐ: ${needInvoice.length})`
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
