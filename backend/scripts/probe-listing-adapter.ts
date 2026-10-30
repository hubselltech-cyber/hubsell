// ============================================================
// DÒ THỬ CHỈ ĐỌC adapter đăng sản phẩm trên MỘT gian (docs/SAO-CHEP-SAN-PHAM.md mục 10, 29).
// Chẩn đoán khi khách báo "gian X không ra danh mục / thương hiệu / kênh vận chuyển":
// chạy 5 bước đọc của adapter (fetchListing 1 SP, recommendCategory, getCategoryTree,
// getCategoryRequirements, searchBrands, getLogistics) — KHÔNG tạo/sửa gì trên sàn
// (chỉ làm mới token nếu hết hạn, như mọi probe khác).
//
//   cd backend
//   npx tsx scripts/probe-listing-adapter.ts <channelId> [tên thương hiệu để tìm]
//
// Trước 31/10/2026 là route GET /api/sao-chep-san-pham-probe (quản trị nền tảng gọi
// tay trong console) — chuyển thành script vì không có màn hình nào gọi.
// ============================================================

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { channelHasRealApi, getListingAdapter } from "../src/marketplace/listing/registry";
import type { NormalizedListing } from "../src/marketplace/listing/types";
import { channelItemKey } from "../src/services/listing-copy/source";

type Step = { step: string; ok: boolean; ms: number; sample?: unknown; error?: string };

async function run(step: string, fn: () => Promise<unknown>): Promise<Step> {
  const t0 = Date.now();
  try {
    const sample = await fn();
    return { step, ok: true, ms: Date.now() - t0, sample };
  } catch (err) {
    return { step, ok: false, ms: Date.now() - t0, error: String((err as Error)?.message ?? err).slice(0, 500) };
  }
}

async function main(): Promise<void> {
  const [channelId, brandQuery = ""] = process.argv.slice(2);
  if (!channelId) throw new Error("Thiếu channelId: npx tsx scripts/probe-listing-adapter.ts <channelId> [thương hiệu]");
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new Error(`Không thấy gian ${channelId}`);
  const adapter = getListingAdapter(channel);
  console.log(`Gian ${channel.shopName} (${channel.channelName}) — API thật: ${channelHasRealApi(channel)} — adapter: ${adapter.name}`);

  const first = await prisma.channelProduct.findFirst({
    where: { channelId: channel.id, status: "ACTIVE", externalId: { not: null } },
    orderBy: { lastSyncedAt: "desc" },
    select: { id: true, externalId: true, productName: true, channelSku: true },
  });
  const steps: Step[] = [];
  const listing = await run("fetchListing (chi tiết 1 sản phẩm)", async () => {
    if (!first) throw new Error("Gian chưa có sản phẩm sàn nào để đọc.");
    const l = await adapter.fetchListing(channel, channelItemKey(first));
    return l
      ? { title: l.title, images: l.images.length, descriptionImages: l.descriptionImages.length, variants: l.variants.length, options: l.options, categoryId: l.categoryId, categoryPath: l.categoryPath, weightGrams: l.weightGrams, brandName: l.brandName, descriptionLen: l.description.length }
      : null;
  });
  steps.push(listing);
  const title = (listing.sample as { title?: string } | null)?.title || first?.productName || "Áo thun cotton nam";
  const blank: NormalizedListing = {
    title,
    description: "",
    images: [],
    descriptionImages: [],
    categoryId: null,
    categoryPath: null,
    brandName: null,
    weightGrams: null,
    dimensionsCm: null,
    options: [],
    variants: [],
    attributes: [],
  };
  const rec = await run("recommendCategory (gợi ý danh mục)", () => adapter.recommendCategory(channel, blank));
  steps.push(rec);
  const catId = (rec.sample as { id?: string }[] | undefined)?.[0]?.id ?? null;
  steps.push(
    await run("getCategoryTree (số nút, 5 lá đầu)", async () => {
      const all = await adapter.getCategoryTree(channel);
      return { total: all.length, leaves: all.filter((n) => n.leaf).length, sample: all.filter((n) => n.leaf).slice(0, 5) };
    })
  );
  if (catId) {
    steps.push(await run(`getCategoryRequirements (${catId})`, () => adapter.getCategoryRequirements(channel, catId)));
    steps.push(await run(`searchBrands (${catId}, "${brandQuery}", 5 đầu)`, async () => (await adapter.searchBrands(channel, catId, brandQuery)).slice(0, 5)));
  }
  steps.push(await run("getLogistics (kênh vận chuyển)", () => adapter.getLogistics(channel)));

  console.log(JSON.stringify({ sourceItem: first, steps }, null, 2));
  console.log("Chỉ đọc — không tạo/sửa gì trên sàn. Bước createListing phải thử bằng 1 sản phẩm thật trên gian test rồi xóa.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
