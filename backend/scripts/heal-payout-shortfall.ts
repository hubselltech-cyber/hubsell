// ============================================================
// CHỮA SỐ "SÀN TRẢ THIẾU" GHI OAN TRƯỚC BẢN DIFF THÀNH PHẦN (01/09/2026)
//
// Bối cảnh: trước 01/09, payoutShortfall = max(expectedPayout − actualPayout)
// so TỔNG — đơn có phí hoa hồng Tiếp thị liên kết (AMS, chỉ chốt lúc quyết
// toán) bị buộc tội oan (đơn thật 26082480K9AARJ: 7.491 = đúng phí AMS).
//
// Script tính lại THUẦN TỪ CỘT ĐÃ CÓ (không gọi sàn) cho đơn đã quyết toán
// còn treo shortfall mà CHƯA có bảng diff (expectedIncome null — tức tính
// theo luật cũ):   mới = max(expectedPayout − actualPayout − affiliateFee, 0)
// affiliateFee lúc này là số AMS THẬT sau quyết toán; ước tính cũ gần như
// chắc chắn không chứa AMS (chính là lý do báo oan) nên trừ trọn — thà tha
// nhầm một cáo buộc còn hơn giữ một cáo buộc oan. Đơn có hoàn tiền về 0 theo
// đúng luật loại trừ sẵn có. Idempotent: chạy lặp ra cùng số.
//
// Chạy: npx tsx scripts/heal-payout-shortfall.ts          (xem trước, KHÔNG ghi)
//       npx tsx scripts/heal-payout-shortfall.ts --apply  (ghi thật)
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const vnd = (x: number) => `${Math.round(x).toLocaleString("vi-VN")} đ`;

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      isSettled: true,
      payoutShortfall: { gt: 0 },
      expectedIncome: { equals: Prisma.AnyNull }, // đơn luật mới đã có diff — không đụng
    },
    select: {
      id: true,
      orderCode: true,
      expectedPayout: true,
      actualPayout: true,
      affiliateFee: true,
      refundedAmount: true,
      payoutShortfall: true,
      channel: { select: { shopName: true } },
    },
  });

  console.log(`Soi ${orders.length} đơn luật cũ còn treo "sàn trả thiếu"…`);
  let changed = 0;

  for (const o of orders) {
    const expected = o.expectedPayout === null ? null : Number(o.expectedPayout);
    const healed =
      expected === null || Number(o.refundedAmount) > 0
        ? 0
        : Math.max(expected - Number(o.actualPayout) - Number(o.affiliateFee), 0);
    if (healed === Number(o.payoutShortfall)) continue;

    changed++;
    console.log(
      `  ${o.orderCode} (${o.channel.shopName}): ${vnd(Number(o.payoutShortfall))}` +
        ` → ${vnd(healed)} (phí AMS ${vnd(Number(o.affiliateFee))})`
    );
    if (APPLY) {
      await prisma.order.update({
        where: { id: o.id },
        data: { payoutShortfall: healed },
      });
    }
  }

  console.log(
    changed === 0
      ? "Không có đơn nào cần chữa."
      : APPLY
        ? `Đã chữa ${changed} đơn.`
        : `${changed} đơn sẽ được chữa — chạy lại kèm --apply để ghi thật.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
