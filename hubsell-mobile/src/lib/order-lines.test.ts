/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { goodsRowText, groupOrderLines, lineText, lineTotals, looksLikeMachineSku } from "./order-lines";

/** Chạy (không cần RN): từ backend/  npx tsx --test ../hubsell-mobile/src/lib/order-lines.test.ts */

const NAME = "Đồ Bộ tole cổ Y Ren Viền TAY DÀI QUẦN DÀI";

test("máy chủ đã tách: dùng đúng ba trường, không tự cắt tên", () => {
  assert.deepEqual(
    lineText({
      productName: `${NAME} - REN DÀI 17, Size M(40-57kg)`,
      channelSku: "1733668291614771234",
      baseName: NAME,
      variantName: "REN DÀI 17, Size M(40-57kg)",
      sellerSku: null,
    }),
    { baseName: NAME, variantName: "REN DÀI 17, Size M(40-57kg)", sellerSku: null }
  );
});

test("máy chủ cũ chưa trả trường mới: giữ nguyên tên, chỉ ẩn mã máy của sàn", () => {
  assert.deepEqual(lineText({ productName: "Váy - Đen, M", channelSku: "1733668291614771234" }), {
    baseName: "Váy - Đen, M",
    variantName: null,
    sellerSku: null,
  });
  assert.equal(lineText({ productName: "Váy", channelSku: "SPE-12-34" }).sellerSku, null);
  assert.equal(lineText({ productName: "Váy", channelSku: "VAY01" }).sellerSku, "VAY01");
  assert.equal(lineText({ productName: "Váy", channelSku: null }).sellerSku, null);
});

test("mã vạch 13–14 số của người bán không bị coi là mã máy", () => {
  assert.equal(looksLikeMachineSku("8936012345678"), false);
  assert.equal(looksLikeMachineSku("18936012345675"), false);
  assert.equal(looksLikeMachineSku("1733668291614771234"), true);
  assert.equal(looksLikeMachineSku("2503826712_VNAMZ-12194012345"), true);
});

const line = (id: string, baseName: string, variantName: string | null, quantity: number) => ({
  id,
  productName: variantName ? `${baseName} - ${variantName}` : baseName,
  channelSku: null,
  baseName,
  variantName,
  sellerSku: null,
  quantity,
});

test("đơn 20 dòng: phân loại cùng sản phẩm gom dưới một tên, giữ thứ tự sàn trả", () => {
  const items = [
    ...Array.from({ length: 12 }, (_, i) => line(`a${i}`, "Đồ bộ tole", `Màu ${i + 1}, M`, i === 3 ? 3 : 1)),
    line("b", "Kẹp tóc", null, 2),
    ...Array.from({ length: 7 }, (_, i) => line(`c${i}`, "Áo thun", `Trắng, ${i}`, 1)),
  ];
  const groups = groupOrderLines(items);
  assert.deepEqual(
    groups.map((g) => [g.baseName, g.lines.length, g.qty]),
    [
      ["Đồ bộ tole", 12, 14],
      ["Kẹp tóc", 1, 2],
      ["Áo thun", 7, 7],
    ]
  );
  assert.deepEqual(lineTotals(items), { lines: 20, qty: 23 });
  // Khóa nhóm duy nhất — React không cảnh báo trùng key.
  assert.equal(new Set(groups.map((g) => g.key)).size, groups.length);
});

test("phân loại của một sản phẩm nằm rải rác vẫn về một nhóm; sản phẩm đơn trùng tên KHÔNG gom", () => {
  const groups = groupOrderLines([
    line("1", "Váy", "Đen, M", 1),
    line("2", "Quà tặng", null, 1),
    line("3", "Váy", "Đỏ, M", 2),
    line("4", "Quà tặng", null, 1),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.baseName, g.lines.map((l) => l.id).join(",")]),
    [
      ["Váy", "1,3"],
      ["Quà tặng", "2"],
      ["Quà tặng", "4"],
    ]
  );
});

test("đơn rỗng / số lượng lỗi không vỡ", () => {
  assert.deepEqual(groupOrderLines([]), []);
  assert.deepEqual(lineTotals([]), { lines: 0, qty: 0 });
  assert.equal(groupOrderLines([{ ...line("x", "A", "B", 1), quantity: Number.NaN }])[0].qty, 0);
});

test("phiếu nhặt theo SKU: có mã người bán thì mã to; không có thì TÊN PHÂN LOẠI to, không in id sàn", () => {
  assert.deepEqual(
    goodsRowText({ name: "Váy - Đen, M", sku: "VAY-DEN-M", baseName: "Váy", variantName: "Đen, M", sellerSku: "VAY-DEN-M" }, true),
    { title: "VAY-DEN-M", variant: "Đen, M", sub: "Váy" }
  );
  assert.deepEqual(
    goodsRowText(
      { name: `${NAME} - REN DÀI 17, Size M`, sku: "1733668291614771234", baseName: NAME, variantName: "REN DÀI 17, Size M", sellerSku: null },
      true
    ),
    { title: "REN DÀI 17, Size M", variant: null, sub: NAME }
  );
  // Không mã, không phân loại (sản phẩm đơn) → tên là tiêu đề.
  assert.deepEqual(goodsRowText({ name: "Kẹp tóc", sku: "SPE-9", baseName: "Kẹp tóc", variantName: null, sellerSku: null }, true), {
    title: "Kẹp tóc",
    variant: null,
    sub: "Không có mã SKU",
  });
  // Máy chủ cũ: dãy id không còn làm tiêu đề.
  assert.deepEqual(goodsRowText({ name: "Váy - Đen, M", sku: "1733668291614771234" }, true), {
    title: "Váy - Đen, M",
    variant: null,
    sub: "Không có mã SKU",
  });
});

test("phiếu nhặt theo sản phẩm: phân loại có dòng riêng; nhiều mã in 'N SKU', một mã in mã người bán", () => {
  assert.deepEqual(goodsRowText({ name: "Váy", sku: null, skuCount: 3 }, false), { title: "Váy", variant: null, sub: "3 SKU" });
  assert.deepEqual(goodsRowText({ name: "Váy", sku: "VAY01", skuCount: 1, baseName: "Váy", variantName: null, sellerSku: "VAY01" }, false), {
    title: "Váy",
    variant: null,
    sub: "VAY01",
  });
  assert.deepEqual(goodsRowText({ name: "Váy", sku: "1733668291614771234", skuCount: 1 }, false), {
    title: "Váy",
    variant: null,
    sub: "",
  });
  // Tên dài cắt 2 dòng không còn nuốt mất phân loại.
  assert.deepEqual(
    goodsRowText(
      { name: `${NAME} - REN DÀI 17, Size M`, sku: "1733668291614771234", skuCount: 1, baseName: NAME, variantName: "REN DÀI 17, Size M", sellerSku: null },
      false
    ),
    { title: NAME, variant: "REN DÀI 17, Size M", sub: "" }
  );
});
