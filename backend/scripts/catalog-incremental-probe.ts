// ============================================================
// PROBE CHỈ ĐỌC: lượt kéo danh mục TĂNG DẦN có thấy đủ thứ lượt TOÀN BỘ thấy không?
// (lát 3.9 GĐ3, 05/11/2026 — docs/DONG-BO-GIAI-DOAN-3.md mục 7)
//
//   npx tsx scripts/catalog-incremental-probe.ts "<shopName>" [số giờ lùi, mặc định 24] [SHOPEE|TIKTOK|LAZADA]
//   vd: npx tsx scripts/catalog-incremental-probe.ts "ANO Official Store" 24
//
// Làm gì: gọi adapter của gian hai lần — toàn bộ, rồi tăng dần từ (bây giờ − N giờ) — và in:
//   · số dòng, số lệnh gọi sàn, thời gian của từng lượt;
//   · sàn có trả thời điểm cập nhật không, lượt tăng dần có dòng nào cũ hơn mốc không (sàn bỏ qua bộ lọc?);
//   · dòng lượt tăng dần trả về có giống hệt dòng đó ở lượt toàn bộ không;
//   · dòng lượt toàn bộ thấy KHÁC bảng ChannelProduct mà lượt tăng dần KHÔNG trả về = thứ lượt tăng dần
//     sẽ sót (đếm theo tồn / giá / trạng thái / khác / dòng mới). Chỉ có nghĩa khi gian vừa được kéo
//     trong N giờ đó (in kèm lastProductSyncAt để anh tự đối chiếu).
// KHÔNG ghi bảng nghiệp vụ, KHÔNG gọi lệnh ghi sàn (chỉ làm mới token nếu hết hạn, như mọi probe khác).
// Chạy trên Render shell worker (token gian chỉ có ở DB prod).
// ============================================================

import "dotenv/config";
import { ChannelName, ChannelProductStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { diffChannelProductRow } from "../src/marketplace/product-sync";
import { getProductAdapter } from "../src/marketplace/registry";
import type { FetchedProducts, NormalizedChannelProduct } from "../src/marketplace/types";

const iso = (sec: number) => new Date(sec * 1000).toISOString();
const keyOf = (p: NormalizedChannelProduct) => p.externalId ?? `sku:${p.channelSku}`;

async function timed(label: string, fn: () => Promise<FetchedProducts>) {
  const t = Date.now();
  const r = await fn();
  const times = r.products.map((p) => p.sourceUpdatedAt).filter((x): x is number => typeof x === "number");
  console.log(
    `\n[${label}] ${r.products.length} dòng SKU, ${r.apiCalls ?? "?"} lệnh gọi sàn, ${((Date.now() - t) / 1000).toFixed(1)} giây, ` +
      `đủ: ${r.complete ? "có" : "KHÔNG"}, cờ incremental: ${r.incremental ? "có" : "không"}; ` +
      `thời điểm cập nhật sàn trả: ${times.length}/${r.products.length} dòng` +
      (times.length ? ` (${iso(Math.min(...times))} → ${iso(Math.max(...times))})` : "")
  );
  return r;
}

async function main() {
  const [shopName, hoursArg, platformArg] = process.argv.slice(2);
  if (!shopName) throw new Error('cách dùng: "<shopName>" [số giờ lùi] [SHOPEE|TIKTOK|LAZADA]');
  const hours = Number(hoursArg) > 0 ? Number(hoursArg) : 24;
  const channel = await prisma.channel.findFirst({
    where: {
      shopName,
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(platformArg ? { channelName: platformArg.toUpperCase() as ChannelName } : {}),
    },
  });
  if (!channel) throw new Error(`không thấy gian đang hoạt động "${shopName}"`);
  const adapter = getProductAdapter(channel);
  const since = new Date(Date.now() - hours * 3600_000);
  const sinceSec = Math.floor(since.getTime() / 1000);
  console.log(
    `Gian "${channel.shopName}" (${channel.channelName}, adapter ${adapter.name}, đọc tăng dần: ${adapter.supportsIncremental ? "có" : "KHÔNG"}) — ` +
      `kéo xong gần nhất ${channel.lastProductSyncAt?.toISOString() ?? "chưa"}, mốc ${channel.productSyncWatermark?.toISOString() ?? "chưa có"}; cửa sổ thử từ ${since.toISOString()} (${hours} giờ)`
  );

  const full = await timed("TOÀN BỘ", () => adapter.fetchProducts(channel, { details: false }));
  const inc = await timed(`TĂNG DẦN từ ${since.toISOString()}`, () => adapter.fetchProducts(channel, { details: false, since }));

  const fullBy = new Map(full.products.map((p) => [keyOf(p), p]));
  const incKeys = new Set(inc.products.map(keyOf));
  const outside = inc.products.filter((p) => typeof p.sourceUpdatedAt === "number" && p.sourceUpdatedAt < sinceSec).length;
  let differ = 0;
  let notInFull = 0;
  for (const p of inc.products) {
    const f = fullBy.get(keyOf(p));
    if (!f) notInFull++;
    else if (f.channelStock !== p.channelStock || f.price !== p.price || f.status !== p.status || f.productName !== p.productName) differ++;
  }
  console.log(
    `\nSo hai lượt: ${outside} dòng tăng dần có thời điểm cập nhật CŨ hơn mốc (TikTok/Lazada mà > 0 = sàn không tôn trọng bộ lọc; Shopee > 0 là bình thường: sản phẩm mới / lệch trạng thái); ` +
      `${differ} dòng khác số giữa hai lượt (sàn đổi trong lúc đo); ${notInFull} dòng tăng dần không có trong lượt toàn bộ`
  );

  // Dòng lượt toàn bộ thấy khác DB mà lượt tăng dần không trả về.
  const rows = await prisma.channelProduct.findMany({
    where: { channelId: channel.id },
    select: {
      channelSku: true, externalId: true, variantName: true, status: true, productName: true, price: true,
      imageUrl: true, itemSku: true, channelStock: true, channelStockLocationId: true,
    },
  });
  const dbBy = new Map(rows.map((r) => [r.externalId ?? `sku:${r.channelSku}`, { ...r, price: Number(r.price) }]));
  const missed = { created: 0, stock: 0, price: 0, status: 0, other: 0 };
  let changedInFull = 0;
  let missedRows = 0;
  const samples: string[] = [];
  for (const p of full.products) {
    const row = dbBy.get(keyOf(p));
    const patch = row
      ? diffChannelProductRow(row, {
          productName: p.productName,
          price: p.price,
          externalId: p.externalId,
          imageUrl: p.imageUrl,
          variantName: p.variantName,
          itemSku: p.itemSku,
          channelStock: p.channelStock,
          channelStockLocationId: p.channelStockLocationId,
          status: p.status === "ACTIVE" ? ChannelProductStatus.ACTIVE : ChannelProductStatus.DELISTED,
        })
      : "created";
    if (!patch) continue;
    changedInFull++;
    if (incKeys.has(keyOf(p))) continue;
    missedRows++;
    if (patch === "created") missed.created++;
    else {
      const { channelStock, channelStockLocationId, price, status, ...rest } = patch;
      if (channelStock !== undefined || channelStockLocationId !== undefined) missed.stock++;
      if (price !== undefined) missed.price++;
      if (status !== undefined) missed.status++;
      if (Object.keys(rest).length > 0) missed.other++;
    }
    if (samples.length < 10) {
      samples.push(
        `  ${keyOf(p)} — ${patch === "created" ? "chưa có trong DB" : Object.keys(patch).join(", ")}; sàn cập nhật ${typeof p.sourceUpdatedAt === "number" ? iso(p.sourceUpdatedAt) : "không rõ"}`
      );
    }
  }
  const goneFromFull = rows.filter((r) => r.status === "ACTIVE" && !fullBy.has(r.externalId ?? `sku:${r.channelSku}`)).length;
  console.log(
    `\nSo với bảng ChannelProduct (${rows.length} dòng): lượt toàn bộ thấy ${changedInFull} dòng khác DB; trong đó lượt tăng dần KHÔNG trả về ${missedRows} dòng ` +
      `(mới ${missed.created}, tồn ${missed.stock}, giá ${missed.price}, trạng thái ${missed.status}, khác ${missed.other}). ` +
      `Dòng DB đang ACTIVE mà sàn không còn trả: ${goneFromFull} (chỉ lượt toàn bộ mới gỡ).`
  );
  if (samples.length) console.log(`Mẫu dòng lượt tăng dần sót:\n${samples.join("\n")}`);
  console.log(
    `\nĐọc kết quả: nếu gian vừa kéo trong ${hours} giờ mà "tồn" sót nhiều → sàn KHÔNG đổi thời điểm cập nhật khi bán hàng làm đổi tồn; ` +
      `giữ chạy bóng cho sàn đó hoặc rút ngắn nhịp kéo toàn bộ (PRODUCT_FULL_SYNC_DAYS).`
  );
}

main()
  .catch((e) => {
    console.error("❌", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
