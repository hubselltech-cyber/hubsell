import { describe, expect, it } from "vitest";
import { pathToRoot } from "../tree";

describe("pathToRoot", () => {
  const nodes = [
    { id: "1", parent: null, name: "Thời trang" },
    { id: "2", parent: "1", name: "Áo" },
    { id: "3", parent: "2", name: "Áo thun" },
    { id: "9", parent: "9", name: "vòng" },
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = (n: (typeof nodes)[number]) => n.parent;

  it("đường dẫn gốc → lá theo tên; nút gốc một phần tử; id lạ rỗng", () => {
    expect(pathToRoot(byId, "3", parentOf, (n) => n.name)).toEqual(["Thời trang", "Áo", "Áo thun"]);
    expect(pathToRoot(byId, "1", parentOf, (n) => n.id)).toEqual(["1"]);
    expect(pathToRoot(byId, "x", parentOf, (n) => n.id)).toEqual([]);
  });
  it("dữ liệu vòng (cha = chính nó) dừng ở trần 10 cấp, không treo", () => {
    expect(pathToRoot(byId, "9", parentOf, (n) => n.id)).toHaveLength(10);
  });
});
