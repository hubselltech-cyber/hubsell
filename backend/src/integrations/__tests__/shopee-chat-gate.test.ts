// ============================================================
// TEST CỔNG CHẶN CHAT SHOPEE (chat-gate.ts) — logic thuần, KHÔNG DB, KHÔNG mạng.
//
// Bất biến: (1) dính error_api_permission MỘT lần → các call sau trong TTL
// không chạm sàn; (2) lỗi khác không khóa cổng; (3) hết TTL tự mở lại;
// (4) lỗi khi cổng khóa vẫn mang chữ error_api_permission để FE/Cứu đơn nhận
// diện cùng nhánh với lỗi thật.
// ============================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SHOPEE_CHAT_DENIED_TTL_MS,
  ShopeeChatDeniedError,
  isShopeeChatPermissionError,
  resetShopeeChatGate,
  shopeeChatDeniedUntil,
  withShopeeChatGate,
} from "../shopee/chat-gate";

const PERM_ERR = new Error(
  "Shopee send_message lỗi: error_api_permission — This app type has no permission to this API."
);

afterEach(() => {
  resetShopeeChatGate();
  vi.useRealTimers();
});

describe("shopee chat gate", () => {
  it("nhận diện đúng lỗi thiếu quyền, không nhận nhầm lỗi khác", () => {
    expect(isShopeeChatPermissionError(PERM_ERR)).toBe(true);
    expect(isShopeeChatPermissionError(new Error("error_param — to_id invalid"))).toBe(false);
    expect(isShopeeChatPermissionError("HTTP 429 — vượt trần gọi API")).toBe(false);
  });

  it("dính error_api_permission một lần → call sau không chạm sàn trong TTL", async () => {
    const fn = vi.fn().mockRejectedValueOnce(PERM_ERR).mockResolvedValue("ok");
    await expect(withShopeeChatGate(fn)).rejects.toBe(PERM_ERR);
    expect(shopeeChatDeniedUntil()).not.toBeNull();

    await expect(withShopeeChatGate(fn)).rejects.toBeInstanceOf(ShopeeChatDeniedError);
    await expect(withShopeeChatGate(fn)).rejects.toThrow(/error_api_permission/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("lỗi khác (khách chặn, tham số sai) không khóa cổng", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Shopee send_message lỗi: error_param"));
    await expect(withShopeeChatGate(fn)).rejects.toThrow(/error_param/);
    await expect(withShopeeChatGate(fn)).rejects.toThrow(/error_param/);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(shopeeChatDeniedUntil()).toBeNull();
  });

  it("hết TTL tự thử lại — sàn cấp quyền là tự thông, không cần deploy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T13:00:00Z"));
    const fn = vi.fn().mockRejectedValueOnce(PERM_ERR).mockResolvedValue("ok");
    await expect(withShopeeChatGate(fn)).rejects.toBe(PERM_ERR);
    await expect(withShopeeChatGate(fn)).rejects.toBeInstanceOf(ShopeeChatDeniedError);

    vi.setSystemTime(new Date(Date.now() + SHOPEE_CHAT_DENIED_TTL_MS + 1000));
    await expect(withShopeeChatGate(fn)).resolves.toBe("ok");
    expect(shopeeChatDeniedUntil()).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
