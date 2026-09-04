// Lời cảnh báo lệch tồn cho seller — nhận diện nguyên nhân + câu hành động.
import { describe, expect, it } from "vitest";
import {
  classifyStockPushFailure,
  describeChannelFailure,
  describeStockPushFailure,
} from "../sync-alert-text";

describe("classifyStockPushFailure", () => {
  it("nhận diện các lỗi Shopee/Lazada hay gặp", () => {
    expect(
      classifyStockPushFailure(
        "Shopee update_stock lỗi: product.error_busi — The merchant/shop has multi warehouse, please input location id."
      )
    ).toBe("multi-warehouse");
    expect(classifyStockPushFailure("error_rate_limit — Too many requests")).toBe("rate-limit");
    expect(classifyStockPushFailure("Không lấy được access_token: invalid_access_token")).toBe("auth");
    expect(classifyStockPushFailure("stock lower than promotion reserved stock")).toBe("promotion");
    expect(classifyStockPushFailure("error_item_not_found")).toBe("not-found");
    expect(classifyStockPushFailure("something weird")).toBe("unknown");
  });
});

describe("describeStockPushFailure", () => {
  it("dòng 1 là tiếng người có việc cần làm, dòng 2 giữ lỗi thô", () => {
    const raw = "product.error_busi — The merchant/shop has multi warehouse, please input location id.";
    const msg = describeStockPushFailure({
      raw,
      shopName: "DarkMan Store",
      channelSku: "TD001-DEN-L",
      expected: 496,
    });
    const [line1, line2] = msg.split("\n");
    expect(line1).toContain("nhiều kho");
    expect(line1).toContain("TD001-DEN-L");
    expect(line1).toContain("496");
    expect(line1).not.toContain("error_busi");
    expect(line2).toBe(raw);
  });

  it("lỗi cấp gian nói rõ vào Kênh bán kết nối lại khi mất token", () => {
    const msg = describeChannelFailure("ANO", "Không lấy được access_token: expired");
    expect(msg.split("\n")[0]).toContain("kết nối lại gian");
  });
});
