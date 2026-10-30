// Tên thuộc tính sàn (tiếng Anh) → tiếng Việt cho ô nhập (docs/SAO-CHEP-SAN-PHAM.md mục 14).
import { describe, expect, it } from "vitest";
import { viAttributeName } from "../attribute-names-vi";

describe("viAttributeName", () => {
  it("tên Anh phổ biến → Việt; đã có dấu → giữ; lạ → giữ", () => {
    expect(viAttributeName("Region of Origin")).toBe("Xuất xứ");
    expect(viAttributeName("pack type")).toBe("Kiểu đóng gói");
    expect(viAttributeName("Manufacturer/trader name")).toBe("Tên nhà sản xuất / đơn vị kinh doanh");
    expect(viAttributeName("Sleeve Length")).toBe("Độ dài tay áo");
    expect(viAttributeName("Chất liệu")).toBe("Chất liệu");
    expect(viAttributeName("Material (Outer)")).toBe("Chất liệu (Material (Outer))");
    expect(viAttributeName("Zorblax Factor")).toBe("Zorblax Factor");
  });
});
