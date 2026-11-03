import { describe, expect, it } from "vitest";
import {
  isTransientPlatformError,
  SKIP_MAX_CONSECUTIVE,
  SkipBudget,
  TRANSIENT_MAX_ATTEMPTS,
  withTransientRetry,
} from "../transient-retry";

const slow = () => new Error("SHOPEE không trả lời trong 30 giây (/api/v2/product/get_model_list)");
const noSleep = async () => {};

describe("withTransientRetry", () => {
  it("phân biệt sàn chậm với sàn từ chối", () => {
    expect(isTransientPlatformError(slow())).toBe(true);
    expect(isTransientPlatformError(new Error("fetch failed"))).toBe(true);
    // Nguyên văn log worker 17:06 03/11/2026.
    expect(
      isTransientPlatformError(new Error("Shopee get_model_list lỗi: product.error_internal — system busy,please try again leater"))
    ).toBe(true);
    expect(isTransientPlatformError(new Error("Shopee lỗi: error_auth"))).toBe(false);
    expect(isTransientPlatformError(new Error("product.error_busi"))).toBe(false);
  });

  it("chậm một lần rồi được: trả kết quả, gọi đúng 2 lần", async () => {
    let calls = 0;
    const r = await withTransientRetry(
      async () => {
        calls++;
        if (calls === 1) throw slow();
        return "ok";
      },
      "x",
      noSleep
    );
    expect(r).toBe("ok");
    expect(calls).toBe(2);
  });

  it("chậm mãi: dừng ở trần số lần rồi ném lỗi", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(
        async () => {
          calls++;
          throw slow();
        },
        "x",
        noSleep
      )
    ).rejects.toThrow("không trả lời");
    expect(calls).toBe(TRANSIENT_MAX_ATTEMPTS);
  });

  it("lỗi không tạm thời: không thử lại", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(
        async () => {
          calls++;
          throw new Error("error_auth");
        },
        "x",
        noSleep
      )
    ).rejects.toThrow("error_auth");
    expect(calls).toBe(1);
  });
});

describe("SkipBudget", () => {
  it("hỏng lẻ tẻ thì đi tiếp và đếm đủ; thành công xóa chuỗi", () => {
    const b = new SkipBudget();
    for (let i = 0; i < 25; i++) {
      b.skip(slow());
      b.ok();
    }
    expect(b.skipped).toBe(25);
  });

  it("hỏng liên tiếp tới trần: ném lỗi để lượt sau thử lại", () => {
    const b = new SkipBudget();
    for (let i = 0; i < SKIP_MAX_CONSECUTIVE - 1; i++) b.skip(slow());
    expect(() => b.skip(slow())).toThrow("không trả lời");
  });

  it("lỗi không tạm thời: ném ngay, không bỏ qua", () => {
    expect(() => new SkipBudget().skip(new Error("error_auth"))).toThrow("error_auth");
  });
});
