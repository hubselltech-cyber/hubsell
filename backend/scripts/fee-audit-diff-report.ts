// ============================================================
// SỔ THEO DÕI HIỆU CHỈNH "SÀN TRẢ THIẾU" (01/09/2026, READ-ONLY)
//
// Giai đoạn hiệu chỉnh 2–4 tuần sau khi đổi luật diff từng thành phần: dump
// mọi đơn đã quyết toán CÓ bảng diff (kể cả đơn được tha) để đối chiếu tay
// với màn quyết toán Seller Center — cáo buộc phải khớp thực tế N ca liên
// tiếp mới coi engine là đáng tin, seller khiếu nại sai một lần là mất hết.
//
// Chạy: npx tsx scripts/fee-audit-diff-report.ts [--days 30]
//   (đọc DATABASE_URL của backend/.env — muốn soi production thì chạy nơi
//    có URL production; script CHỈ ĐỌC, không ghi gì.)
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import type { ShortfallDetailItem } from "../src/integrations/shopee/settlements";

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > -1 ? Number(process.argv[daysArg + 1]) || 30 : 30;

const vnd = (x: number) => `${Math.round(x).toLocaleString("vi-VN")} đ`;

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      isSettled: true,
      payoutShortfallDetail: { not: Prisma.AnyNull },
      settledAt: { gte: new Date(Date.now() - DAYS * 86_400_000) },
    },
    orderBy: [{ payoutShortfall: "desc" }, { settledAt: "desc" }],
    select: {
      orderCode: true,
      settledAt: true,
      expectedPayout: true,
      actualPayout: true,
      payoutShortfall: true,
      payoutAuditStatus: true,
      payoutShortfallDetail: true,
      channel: { select: { shopName: true } },
    },
  });

  const accusedOrders = orders.filter((o) => Number(o.payoutShortfall) > 0);
  const excusedOnly = orders.length - accusedOrders.length;

  console.log(
    `SỔ HIỆU CHỈNH KIỂM TOÁN — đơn settle ${DAYS} ngày qua có bảng diff: ${orders.length}` +
      ` (bị cáo buộc: ${accusedOrders.length} · được tha toàn phần: ${excusedOnly})\n`
  );

  const totalsByComponent = new Map<
    string,
    { label: string; count: number; lost: number; accused: boolean }
  >();

  for (const o of orders) {
    const detail = o.payoutShortfallDetail as unknown as ShortfallDetailItem[];
    const flag = Number(o.payoutShortfall) > 0 ? "⚠️ CÁO BUỘC" : "✓ tha";
    console.log(
      `${flag}  ${o.orderCode} (${o.channel.shopName}) — settle ${o.settledAt?.toISOString().slice(0, 10)}` +
        ` · ước tính ${vnd(Number(o.expectedPayout ?? 0))} → thực ${vnd(Number(o.actualPayout))}` +
        ` · trả thiếu ${vnd(Number(o.payoutShortfall))} · trạng thái ${o.payoutAuditStatus}`
    );
    for (const d of detail) {
      console.log(
        `     ${d.accused ? "→ TÍNH " : "  bỏ qua"} ${d.label}: ` +
          (d.expected !== 0 || d.actual !== 0
            ? `${vnd(d.expected)} → ${vnd(d.actual)} `
            : "") +
          `(${d.lost > 0 ? "+" : ""}${vnd(d.lost)})`
      );
      const agg = totalsByComponent.get(d.key) ?? {
        label: d.label,
        count: 0,
        lost: 0,
        accused: d.accused,
      };
      agg.count++;
      agg.lost += d.lost;
      agg.accused ||= d.accused;
      totalsByComponent.set(d.key, agg);
    }
  }

  if (totalsByComponent.size > 0) {
    console.log("\nTẦN SUẤT THEO THÀNH PHẦN (soi mẫu hình báo oan tiềm ẩn):");
    for (const [key, a] of [...totalsByComponent.entries()].sort(
      (x, y) => y[1].lost - x[1].lost
    )) {
      console.log(
        `  ${a.accused ? "⚠️" : "· "} ${a.label} [${key}]: ${a.count} đơn · tổng ${vnd(a.lost)}`
      );
    }
    console.log(
      '\nCách đọc: mở từng đơn "⚠️ CÁO BUỘC" trên Seller Center, khớp chênh từng' +
        "\nloại phí. Khớp → cáo buộc đúng; không khớp → chép lại số hai bên để bồi" +
        "\nluật (thành phần hay sai sẽ nổi ở bảng tần suất trên)."
    );
  } else {
    console.log("Chưa có đơn nào có bảng diff — chờ nhịp settle sau deploy 01/09.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
