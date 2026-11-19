import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildFakeLabelPdf, FAKE_TIKTOK_TABLE_TOP } from "../fulfillment/fake-label-pdf";
import {
  DEFAULT_LABEL_TEMPLATE,
  layoutTable,
  locateGoodsZone,
  overlayLabels,
  parseLabelTemplate,
  readFirstPage,
  readLabelTemplates,
  rowText,
  toOverlayRows,
  type OverlayItem,
} from "../label-overlay";
import { autoDetectEnabled, closeLabelReader, planOverlay } from "../label-overlay";
import { groupLines, manualZone, zoneFromLines } from "../label-overlay/locate";
import { mergePdfParts } from "../fulfillment/merge-pdf";

// Luồng phụ đọc PDF tự tắt khi rảnh; tắt hẳn khi xong tệp test cho gọn.
afterAll(() => closeLabelReader());

const A6 = { width: 297.64, height: 419.53 };

function items(n: number): OverlayItem[] {
  return Array.from({ length: n }, (_, i) => ({
    productName: `Sản phẩm thử số ${i + 1} - Loại ${i % 2 ? "to" : "nhỏ"}`,
    variantName: `Loại ${i % 2 ? "to" : "nhỏ"}`,
    channelSku: `SKU-${String(i + 1).padStart(2, "0")}`,
    quantity: (i % 3) + 1,
  }));
}

async function label(platform: "TIKTOK" | "SHOPEE", list: OverlayItem[]) {
  const pdf = await buildFakeLabelPdf({
    platform,
    shopName: "Gian thử",
    orderCode: "580000000000000001",
    trackingCode: "860000000001",
    carrierName: platform === "TIKTOK" ? "J&T Express" : "SPX Express",
    items: list.map((i) => ({
      name: i.productName,
      variant: i.variantName ?? null,
      sku: i.channelSku ?? "",
      quantity: i.quantity,
    })),
  });
  return Buffer.from(pdf);
}

async function textOfPage1(pdf: Uint8Array): Promise<string> {
  const page = await readFirstPage(pdf);
  return (page?.lines ?? []).map((l) => l.text).join("\n");
}

describe("parseLabelTemplate", () => {
  it("dữ liệu rác → mẫu mặc định, đang TẮT", () => {
    expect(parseLabelTemplate(null)).toEqual(DEFAULT_LABEL_TEMPLATE);
    expect(parseLabelTemplate("x").enabled).toBe(false);
  });

  it("tắt hết ba cột thì tự bật lại SKU — không bao giờ ra bảng trống", () => {
    const t = parseLabelTemplate({ enabled: true, showSku: false, showVariant: false, showName: false });
    expect(t.showSku).toBe(true);
  });

  it("dòng nhắn: bỏ ký tự điều khiển, gộp khoảng trắng, cắt 80 ký tự", () => {
    const t = parseLabelTemplate({ note: `  Gọi shop\n\t0965   xxx  ${"a".repeat(200)}` });
    expect(t.note.startsWith("Gọi shop 0965 xxx a")).toBe(true);
    expect([...t.note]).toHaveLength(80);
  });

  it("vùng tự đặt bị kẹp trong 20–70 mm; không phải số thì bỏ", () => {
    expect(parseLabelTemplate({ manualZoneMm: 5 }).manualZoneMm).toBe(20);
    expect(parseLabelTemplate({ manualZoneMm: 300 }).manualZoneMm).toBe(70);
    expect(parseLabelTemplate({ manualZoneMm: "45" }).manualZoneMm).toBeNull();
  });

  it("readLabelTemplates chỉ trả sàn đã có luật dò vùng", () => {
    const all = readLabelTemplates({ TIKTOK: { enabled: true }, SHOPEE: { enabled: true } });
    expect(all.TIKTOK?.enabled).toBe(true);
    expect(all.SHOPEE).toBeUndefined();
  });
});

describe("rowText / toOverlayRows", () => {
  it("mã máy của sàn (dãy 19 số) không in ra — lùi về phân loại", () => {
    const [row] = toOverlayRows([
      { productName: "Áo - Đen", variantName: "Đen", channelSku: "1729384756102938475", quantity: 1 },
    ]);
    expect(row.sku).toBeNull();
    expect(rowText(row, { showSku: true, showVariant: false, showName: false })).toEqual([{ text: "Đen", bold: true }]);
  });

  it("hàng nhạy cảm: tắt tên + phân loại thì chỉ còn SKU", () => {
    const [row] = toOverlayRows([
      { productName: "Tên nhạy cảm - Đỏ", variantName: "Đỏ", channelSku: "NC-01", quantity: 2 },
    ]);
    expect(rowText(row, { showSku: true, showVariant: false, showName: false })).toEqual([
      { text: "NC-01", bold: true },
    ]);
  });
});

describe("layoutTable", () => {
  it("ít dòng: một cột, chữ to nhất", () => {
    expect(layoutTable(4, 110)).toMatchObject({ columns: 1, size: 9, fit: 4 });
  });

  it("nhiều dòng: thu chữ rồi mới chia hai cột", () => {
    expect(layoutTable(12, 110).columns).toBe(1);
    expect(layoutTable(12, 110).size).toBeLessThan(9);
    expect(layoutTable(20, 110)).toMatchObject({ columns: 2, fit: 20 });
  });

  it("quá nhiều: cắt bớt và chừa đúng một ô cho câu 'còn N dòng'", () => {
    const l = layoutTable(80, 110);
    const perCol = Math.floor(110 / l.rowHeight);
    expect(l.fit).toBe(perCol * 2 - 1);
  });

  it("vùng không đủ cao cho dòng nào: không in dòng nào, không số âm", () => {
    expect(layoutTable(5, 3).fit).toBe(0);
  });
});

describe("dò vùng bảng sản phẩm", () => {
  it("gom mẩu chữ rời thành dòng rồi mới so tiêu đề", () => {
    const lines = groupLines([
      { str: "mặt hàng", x: 180, y: 122.4, height: 7 },
      { str: "Tổng", x: 130, y: 122, height: 7 },
      { str: "6", x: 160, y: 122, height: 7 },
    ]);
    expect(lines[0].text).toBe("Tổng 6 mặt hàng");
    const zone = zoneFromLines("TIKTOK", lines, A6);
    expect(zone?.via).toBe("anchor");
    expect(zone!.top).toBeGreaterThan(122);
  });

  it("không có tiêu đề bảng → null (không che mò)", () => {
    expect(zoneFromLines("TIKTOK", groupLines([{ str: "Order ID: 1", x: 10, y: 200, height: 6 }]), A6)).toBeNull();
  });

  it("tiêu đề nằm quá nửa trên của tem → coi là dò nhầm, không chèn", () => {
    expect(
      zoneFromLines("TIKTOK", groupLines([{ str: "Tổng 2 mặt hàng", x: 10, y: 300, height: 7 }]), A6)
    ).toBeNull();
  });

  it("Shopee / Lazada chưa có luật → null", () => {
    expect(
      zoneFromLines("SHOPEE", groupLines([{ str: "Tổng 2 mặt hàng", x: 10, y: 100, height: 7 }]), A6)
    ).toBeNull();
  });

  it("vùng tự đặt không bao giờ cao quá 55 % tem", () => {
    expect(manualZone(70, A6).top).toBeLessThanOrEqual(A6.height * 0.55);
    expect(manualZone(30, A6).via).toBe("manual");
  });

  it("đọc được vị trí bảng trên tem TikTok mẫu", async () => {
    const { zone, shape } = await locateGoodsZone("TIKTOK", await label("TIKTOK", items(6)));
    expect(shape).toMatchObject({ pageCount: 2 });
    expect(zone).not.toBeNull();
    // Mép trên vùng chèn phải phủ hết ô tiêu đề (mép trên bảng mẫu), lệch vài pt.
    expect(zone!.top).toBeGreaterThanOrEqual(FAKE_TIKTOK_TABLE_TOP);
    expect(zone!.top).toBeLessThan(FAKE_TIKTOK_TABLE_TOP + 8);
  });
});

describe("overlayLabels", () => {
  const enabled = parseLabelTemplate({ enabled: true, note: "Gọi shop trước khi hoàn" });

  it("mẫu tắt → trả đúng tệp gốc, không đếm gì", async () => {
    const pdf = await label("TIKTOK", items(3));
    const r = await overlayLabels({
      platform: "TIKTOK",
      template: parseLabelTemplate({ enabled: false }),
      pdfs: new Map([["o1", pdf]]),
      itemsByOrder: new Map([["o1", items(3)]]),
    });
    expect(r.applied + r.missed).toBe(0);
    expect(r.pdfs.get("o1")).toBe(pdf);
  });

  it("đơn 6 món in sang 2 tờ → còn MỘT tờ, có bảng gọn + dòng nhắn, phần vận chuyển còn nguyên", async () => {
    const list = items(6);
    const pdf = await label("TIKTOK", list);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
    const r = await overlayLabels({
      platform: "TIKTOK",
      template: enabled,
      pdfs: new Map([["o1", pdf]]),
      itemsByOrder: new Map([["o1", list]]),
    });
    expect(r).toMatchObject({ applied: 1, missed: 0 });
    const out = r.pdfs.get("o1")!;
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
    const text = await textOfPage1(out);
    expect(text).toContain("Gọi shop trước khi hoàn");
    expect(text).toContain(`Tổng ${list.reduce((s, i) => s + i.quantity, 0)} sản phẩm · 6 dòng`);
    expect(text).toContain("SKU-06");
    expect(text).toContain("860000000001"); // mã vận đơn của sàn không bị đụng
  });

  it("onePage tắt → giữ nguyên các trang sau", async () => {
    const list = items(6);
    const r = await overlayLabels({
      platform: "TIKTOK",
      template: { ...enabled, onePage: false },
      pdfs: new Map([["o1", await label("TIKTOK", list)]]),
      itemsByOrder: new Map([["o1", list]]),
    });
    expect((await PDFDocument.load(r.pdfs.get("o1")!)).getPageCount()).toBe(2);
  });

  it("tem không có tiêu đề bảng + không đặt vùng → để nguyên, đếm missed", async () => {
    const list = items(2);
    // Tem Shopee mẫu không có dòng "Tổng N mặt hàng" — ép chạy luật TikTok trên nó.
    const other = await label("SHOPEE", list);
    const r = await overlayLabels({
      platform: "TIKTOK",
      template: enabled,
      pdfs: new Map([["o1", other]]),
      itemsByOrder: new Map([["o1", list]]),
    });
    expect(r).toMatchObject({ applied: 0, missed: 1 });
    expect(r.pdfs.get("o1")).toBe(other);
  });

  it("không dò được nhưng người bán tự đặt vùng → chèn theo vùng đó", async () => {
    const list = items(2);
    const other = await label("SHOPEE", list);
    const r = await overlayLabels({
      platform: "TIKTOK",
      template: { ...enabled, manualZoneMm: 40 },
      pdfs: new Map([["o1", other]]),
      itemsByOrder: new Map([["o1", list]]),
    });
    expect(r).toMatchObject({ applied: 1, missed: 0 });
    expect(await textOfPage1(r.pdfs.get("o1")!)).toContain("SKU-02");
  });

  it("tệp hỏng không làm hỏng lượt in — trả lại đúng tệp đó", async () => {
    const broken = Buffer.from("%PDF-1.4 không phải pdf");
    const r = await overlayLabels({
      platform: "TIKTOK",
      template: { ...enabled, manualZoneMm: 40 },
      pdfs: new Map([["o1", broken]]),
      itemsByOrder: new Map([["o1", items(1)]]),
    });
    expect(r).toMatchObject({ applied: 0, missed: 1 });
    expect(r.pdfs.get("o1")).toBe(broken);
  });

  it("sàn chưa hỗ trợ (Shopee) dù bật mẫu cũng không đụng tệp", async () => {
    const pdf = await label("TIKTOK", items(2));
    const r = await overlayLabels({
      platform: "SHOPEE",
      template: enabled,
      pdfs: new Map([["o1", pdf]]),
      itemsByOrder: new Map([["o1", items(2)]]),
    });
    expect(r.applied + r.missed).toBe(0);
    expect(r.pdfs.get("o1")).toBe(pdf);
  });
});

describe("vẽ lúc ghép tệp + công tắc tự dò", () => {
  const saved = process.env.LABEL_OVERLAY_AUTODETECT;
  afterEach(() => {
    if (saved === undefined) delete process.env.LABEL_OVERLAY_AUTODETECT;
    else process.env.LABEL_OVERLAY_AUTODETECT = saved;
  });

  async function batch(n: number) {
    const list = items(6);
    const pdfs = new Map<string, Buffer>();
    const itemsByOrder = new Map<string, OverlayItem[]>();
    for (let i = 0; i < n; i++) {
      pdfs.set(`o${i}`, await label("TIKTOK", list));
      itemsByOrder.set(`o${i}`, list);
    }
    return { pdfs, itemsByOrder };
  }

  it("mặc định ngoài production là CÓ tự dò; =0 thì tắt, =1 thì bật", () => {
    delete process.env.LABEL_OVERLAY_AUTODETECT;
    expect(autoDetectEnabled()).toBe(true);
    process.env.LABEL_OVERLAY_AUTODETECT = "0";
    expect(autoDetectEnabled()).toBe(false);
    process.env.LABEL_OVERLAY_AUTODETECT = "1";
    expect(autoDetectEnabled()).toBe(true);
  });

  it("3 vận đơn 2 trang bật mẫu → tệp ghép 3 trang, vẽ đủ 3 bảng, tệp gốc không bị sửa", async () => {
    const { pdfs, itemsByOrder } = await batch(3);
    const before = [...pdfs.values()].map((b) => b.length);
    const template = parseLabelTemplate({ enabled: true, note: "Gọi shop trước khi hoàn" });
    const plans = await planOverlay({ platform: "TIKTOK", template, pdfs, itemsByOrder });
    expect(plans.size).toBe(3);
    const merged = await mergePdfParts([...pdfs].map(([id, pdf]) => ({ label: pdf, overlay: plans.get(id) })));
    expect(merged).toMatchObject({ pages: 3, broken: 0, overlay: { applied: 3, missed: 0 } });
    expect([...pdfs.values()].map((b) => b.length)).toEqual(before);
    expect(await textOfPage1(merged.pdf)).toContain("Gọi shop trước khi hoàn");
  });

  it("vận đơn không có kế hoạch chèn (sàn khác / mẫu tắt) ghép nguyên trạng, không tính vào số chèn", async () => {
    const { pdfs } = await batch(1);
    const merged = await mergePdfParts([{ label: pdfs.get("o0") }]);
    expect(merged).toMatchObject({ pages: 2, overlay: { applied: 0, missed: 0 } });
  });

  it("TẮT tự dò + chưa đặt vùng → không chèn, GIỮ ĐỦ trang của sàn, đếm missed", async () => {
    process.env.LABEL_OVERLAY_AUTODETECT = "0";
    const { pdfs, itemsByOrder } = await batch(2);
    const template = parseLabelTemplate({ enabled: true });
    const plans = await planOverlay({ platform: "TIKTOK", template, pdfs, itemsByOrder });
    expect([...plans.values()].every((pl) => pl.zone === null)).toBe(true);
    const merged = await mergePdfParts([...pdfs].map(([id, pdf]) => ({ label: pdf, overlay: plans.get(id) })));
    expect(merged).toMatchObject({ pages: 4, overlay: { applied: 0, missed: 2 } });
  });

  it("TẮT tự dò + đã đặt vùng 46 mm → chèn theo số đã lưu, mỗi đơn một tờ", async () => {
    process.env.LABEL_OVERLAY_AUTODETECT = "0";
    const { pdfs, itemsByOrder } = await batch(2);
    const template = parseLabelTemplate({ enabled: true, manualZoneMm: 46 });
    const plans = await planOverlay({ platform: "TIKTOK", template, pdfs, itemsByOrder });
    const merged = await mergePdfParts([...pdfs].map(([id, pdf]) => ({ label: pdf, overlay: plans.get(id) })));
    expect(merged).toMatchObject({ pages: 2, overlay: { applied: 2, missed: 0 } });
    expect(await textOfPage1(merged.pdf)).toContain("SKU-06");
  });

  it("tệp vận đơn hỏng trong lượt ghép: tính là tệp hỏng + không chèn, các tệp khác vẫn ra", async () => {
    const { pdfs, itemsByOrder } = await batch(1);
    const template = parseLabelTemplate({ enabled: true, manualZoneMm: 46 });
    const plans = await planOverlay({ platform: "TIKTOK", template, pdfs, itemsByOrder });
    const plan = plans.get("o0")!;
    const merged = await mergePdfParts([
      { label: Buffer.from("%PDF-1.4 hỏng"), overlay: plan },
      { label: pdfs.get("o0"), overlay: plan },
    ]);
    expect(merged).toMatchObject({ pages: 1, broken: 1, overlay: { applied: 1, missed: 1 } });
  });
});
