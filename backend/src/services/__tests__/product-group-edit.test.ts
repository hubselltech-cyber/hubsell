// Luật của hộp "Sửa sản phẩm" ở Tổng kho (18/11/2026) — phần thuần, không chạm DB.
import { describe, expect, it } from "vitest";
import { GROUP_ADD_MAX, planGroupEdit, ProductGroupEditError, type GroupCurrentRow } from "../product-group-edit";

const row = (id: string, skuCode: string, variantName: string | null, over: Partial<GroupCurrentRow> = {}): GroupCurrentRow => ({
  id,
  skuCode,
  productName: "Áo thun",
  variantName,
  groupKey: variantName ? "áo thun" : null,
  sellingPrice: 100_000,
  costPrice: 40_000,
  ...over,
});
const GROUP = [row("a", "AO-DEN-M", "Đen, M"), row("b", "AO-DEN-L", "Đen, L")];
const plan = (current: GroupCurrentRow[], body: unknown, allowCost = true) => planGroupEdit(current, body, { allowCost });
const fail = (current: GroupCurrentRow[], body: unknown) => {
  try {
    plan(current, body);
  } catch (err) {
    if (err instanceof ProductGroupEditError) return err;
    throw err;
  }
  throw new Error("đáng lẽ phải báo lỗi");
};

describe("planGroupEdit — không đổi gì", () => {
  it("gửi lại đúng dữ liệu đang có → không có việc ghi nào", () => {
    const p = plan(GROUP, {
      productName: "Áo thun",
      variants: GROUP.map((r) => ({ id: r.id, skuCode: r.skuCode, variantName: r.variantName, sellingPrice: r.sellingPrice })),
    });
    expect(p).toMatchObject({ renameAll: false, updates: [], added: [], newSkuCodes: [], groupKey: "áo thun" });
  });

  it("mã cũ ngoài tập ký tự (kéo từ sàn) gửi lại nguyên văn thì không bị kiểm", () => {
    const legacy = [row("a", "VAY01 (ĐEN, M)", "Đen, M"), row("b", "VAY01 (ĐEN, L)", "Đen, L")];
    const p = plan(legacy, { productName: "Áo thun", variants: [{ id: "a", skuCode: "vay01 (đen, m)" }] });
    expect(p.updates).toEqual([]);
  });
});

describe("planGroupEdit — đổi tên", () => {
  it("đổi tên áp cho cả mẫu và tính lại khóa gom", () => {
    const p = plan(GROUP, { productName: "  Áo thun   cổ tròn " });
    expect(p).toMatchObject({ productName: "Áo thun   cổ tròn", groupKey: "áo thun cổ tròn", renameAll: true, updates: [] });
  });

  it("thiếu tên → báo lỗi", () => {
    expect(fail(GROUP, { productName: "  " }).message).toBe("Nhập tên sản phẩm.");
  });

  it("các dòng lệch hoa thường tên nhau được đưa về một tên dù khách không gõ gì", () => {
    const mixed = [row("a", "AO-1", "Đen"), row("b", "AO-2", "Trắng", { productName: "áo THUN" })];
    expect(plan(mixed, { productName: "Áo thun" }).renameAll).toBe(true);
  });
});

describe("planGroupEdit — sửa từng dòng", () => {
  it("chỉ ghi dòng có đổi, chỉ trường có đổi; mã SKU về chữ hoa", () => {
    const p = plan(GROUP, {
      productName: "Áo thun",
      variants: [
        { id: "a", skuCode: "ao-den-m2", variantName: "Đen, M", sellingPrice: "120000" },
        { id: "b", skuCode: "AO-DEN-L", variantName: "Đen,XL", sellingPrice: 100000 },
      ],
    });
    expect(p.updates).toEqual([
      { id: "a", skuCode: "AO-DEN-M2", sellingPrice: 120_000 },
      { id: "b", variantName: "Đen, XL" },
    ]);
    expect(p.newSkuCodes).toEqual(["AO-DEN-M2"]);
    expect(p.renameAll).toBe(false);
  });

  it("mã mới sai ký tự / để trống / quá dài → báo lỗi", () => {
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", skuCode: "ÁO ĐEN" }] }).message).toContain("không hợp lệ");
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", skuCode: " " }] }).message).toContain("chưa có mã SKU");
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", skuCode: "A".repeat(51) }] }).message).toContain("không hợp lệ");
  });

  it("mã ngắn dưới 6 ký tự vẫn nhận (đặt giống mã trên gian để Tự khớp)", () => {
    expect(plan(GROUP, { productName: "Áo thun", variants: [{ id: "a", skuCode: "A1" }] }).newSkuCodes).toEqual(["A1"]);
  });

  it("đổi mã trùng mã của phân loại khác trong mẫu → chặn; đổi chéo hai mã thì cho", () => {
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", skuCode: "AO-DEN-L" }] }).message).toContain("bị trùng giữa các phân loại");
    const swap = plan(GROUP, { productName: "Áo thun", variants: [{ id: "a", skuCode: "AO-DEN-L" }, { id: "b", skuCode: "AO-DEN-M" }] });
    expect(swap.updates).toHaveLength(2);
  });

  it("đổi phân loại trùng phân loại khác (không phân biệt hoa thường) → chặn", () => {
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", variantName: "đen, l" }] }).message).toContain('Phân loại "đen, l" bị trùng');
  });

  it("phân loại trùng sẵn từ trước không chặn việc sửa dòng khác", () => {
    const dup = [row("a", "AO-1", "Đen"), row("b", "AO-2", "Đen"), row("c", "AO-3", "Trắng")];
    expect(plan(dup, { productName: "Áo thun", variants: [{ id: "c", sellingPrice: 90_000 }] }).updates).toEqual([{ id: "c", sellingPrice: 90_000 }]);
  });

  it("xóa trắng phân loại ở mẫu từ 2 dòng → chặn (dòng sẽ rơi khỏi mẫu)", () => {
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", variantName: "" }] }).message).toContain("phân loại nào cũng phải có tên");
  });

  it("giá âm / không phải số → chặn", () => {
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", sellingPrice: -1 }] }).message).toContain("Giá bán");
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", sellingPrice: "abc" }] }).message).toContain("Giá bán");
  });

  it("id lạ (mẫu đã đổi ở nơi khác) → 409", () => {
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "zzz", sellingPrice: 1 }] }).status).toBe(409);
  });
});

describe("planGroupEdit — giá vốn của SKU đang có (19/11/2026)", () => {
  it("chỉ dòng có đổi giá mới vào kế hoạch; giá vốn đi đường riêng, không lẫn vào updates", () => {
    const p = plan(GROUP, {
      productName: "Áo thun",
      variants: [
        { id: "a", costPrice: 55_000 },
        { id: "b", costPrice: 40_000 }, // gửi lại đúng giá đang có = không đổi
      ],
    });
    expect(p.costs).toEqual([{ productId: "a", cost: 55_000 }]);
    expect(p.updates).toEqual([]);
  });

  it("xóa giá vốn về 0 là một lần đổi hợp lệ", () => {
    expect(plan(GROUP, { productName: "Áo thun", variants: [{ id: "a", costPrice: 0 }] }).costs).toEqual([{ productId: "a", cost: 0 }]);
  });

  it("đổi giá vốn cùng lúc với giá bán: mỗi thứ về đúng chỗ", () => {
    const p = plan(GROUP, { productName: "Áo thun", variants: [{ id: "a", sellingPrice: 120_000, costPrice: "61000" }] });
    expect(p.updates).toEqual([{ id: "a", sellingPrice: 120_000 }]);
    expect(p.costs).toEqual([{ productId: "a", cost: 61_000 }]);
  });

  it("người không thấy tài chính gửi giá vốn → 403, kể cả khi gửi đúng giá cũ", () => {
    for (const costPrice of [55_000, 40_000]) {
      let caught: unknown = null;
      try {
        plan(GROUP, { productName: "Áo thun", variants: [{ id: "a", costPrice }] }, false);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ProductGroupEditError);
      expect((caught as ProductGroupEditError).status).toBe(403);
    }
  });

  it("giá vốn âm / không phải số → chặn", () => {
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", costPrice: -1 }] }).message).toContain("Giá vốn của AO-DEN-M");
    expect(fail(GROUP, { productName: "Áo thun", variants: [{ id: "a", costPrice: "abc" }] }).message).toContain("Giá vốn");
  });
});

describe("planGroupEdit — sản phẩm đơn", () => {
  const single = [row("a", "COC-SU", null, { productName: "Cốc sứ" })];

  it("sản phẩm đơn không phân loại giữ khóa gom NULL", () => {
    expect(plan(single, { productName: "Cốc sứ trắng" })).toMatchObject({ groupKey: null, renameAll: true });
  });

  it("thêm phân loại mà dòng gốc chưa có tên phân loại → chặn, nêu đúng SKU", () => {
    const e = fail(single, { productName: "Cốc sứ", added: [{ skuCode: "COC-SU-XANH", variantName: "Xanh", sellingPrice: 50_000 }] });
    expect(e.message).toContain("SKU COC-SU đang để trống");
  });

  it("đặt phân loại cho dòng gốc + thêm phân loại → thành mẫu cha–con", () => {
    const p = plan(single, {
      productName: "Cốc sứ",
      variants: [{ id: "a", variantName: "Trắng" }],
      added: [{ skuCode: "coc-su-xanh", variantName: "Xanh", sellingPrice: 50_000, costPrice: 20_000, stock: 12 }],
    });
    expect(p.groupKey).toBe("cốc sứ");
    expect(p.renameAll).toBe(true);
    expect(p.updates).toEqual([{ id: "a", variantName: "Trắng" }]);
    expect(p.added).toEqual([{ skuCode: "COC-SU-XANH", variantName: "Xanh", sellingPrice: 50_000, costPrice: 20_000, stock: 12 }]);
    expect(p.newSkuCodes).toEqual(["COC-SU-XANH"]);
  });
});

describe("planGroupEdit — thêm phân loại", () => {
  const add = (over: Record<string, unknown> = {}) => ({ skuCode: "AO-TRANG-M", variantName: "Trắng, M", sellingPrice: 100_000, ...over });

  it("thêm vào mẫu đang có: mặc định tồn 0, giá vốn 0", () => {
    const p = plan(GROUP, { productName: "Áo thun", added: [add()] });
    expect(p.added).toEqual([{ skuCode: "AO-TRANG-M", variantName: "Trắng, M", sellingPrice: 100_000, costPrice: 0, stock: 0 }]);
    expect(p.renameAll).toBe(false);
  });

  it("người không thấy tài chính gửi giá vốn → bị bỏ về 0", () => {
    expect(plan(GROUP, { productName: "Áo thun", added: [add({ costPrice: 55_000 })] }, false).added[0].costPrice).toBe(0);
  });

  it("thiếu tên phân loại / trùng phân loại đang có / trùng mã đang có → chặn", () => {
    expect(fail(GROUP, { productName: "Áo thun", added: [add({ variantName: "" })] }).message).toContain("phân loại nào cũng phải có tên");
    expect(fail(GROUP, { productName: "Áo thun", added: [add({ variantName: "Đen, M" })] }).message).toContain("bị trùng trong sản phẩm này");
    expect(fail(GROUP, { productName: "Áo thun", added: [add({ skuCode: "ao-den-m" })] }).message).toContain("bị trùng giữa các phân loại");
  });

  it("hai phân loại mới trùng mã nhau → chặn", () => {
    expect(fail(GROUP, { productName: "Áo thun", added: [add(), add({ variantName: "Trắng, L" })] }).message).toContain("bị trùng giữa các phân loại");
  });

  it("tồn ban đầu lẻ / âm → chặn", () => {
    expect(fail(GROUP, { productName: "Áo thun", added: [add({ stock: 1.5 })] }).message).toContain("Tồn ban đầu");
    expect(fail(GROUP, { productName: "Áo thun", added: [add({ stock: -3 })] }).message).toContain("Tồn ban đầu");
  });

  it(`quá ${GROUP_ADD_MAX} phân loại một lần lưu → chặn`, () => {
    const many = Array.from({ length: GROUP_ADD_MAX + 1 }, (_, i) => add({ skuCode: `AO-NEW-${i}`, variantName: `Màu ${i}` }));
    expect(fail(GROUP, { productName: "Áo thun", added: many }).message).toContain("tối đa");
  });

  it("phân loại mới lấy mã mà một dòng cũ vừa nhả ra → cho", () => {
    const p = plan(GROUP, { productName: "Áo thun", variants: [{ id: "a", skuCode: "AO-DEN-M-CU" }], added: [add({ skuCode: "AO-DEN-M" })] });
    expect(p.newSkuCodes).toEqual(["AO-DEN-M-CU", "AO-DEN-M"]);
  });
});
