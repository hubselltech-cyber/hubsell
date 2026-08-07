// Gán thử material/care/sizeChart cho SP kho đầu tiên (test product-context).
import { prisma } from "../src/prisma";

async function main() {
  const p = await prisma.product.findFirst();
  if (!p) {
    console.log("Không có Product nào trong kho local");
    return;
  }
  await prisma.product.update({
    where: { id: p.id },
    data: {
      material: "100% cotton 2 chiều, 250gsm",
      careInstructions: "Giặt máy nước lạnh, lộn trái khi giặt",
      sizeChart: [
        { size: "M", heightCm: [158, 168], weightKg: [52, 62] },
        { size: "L", heightCm: [166, 175], weightKg: [60, 70] },
      ],
    },
  });
  console.log("Đã gán thông số cho SKU:", p.skuCode, "-", p.productName);
}

main().finally(() => prisma.$disconnect());
