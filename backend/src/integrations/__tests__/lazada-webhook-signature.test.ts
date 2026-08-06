// ============================================================
// KIỂM CHỮ KÝ WEBHOOK LAZADA (LPM) — thuần crypto, không đụng DB.
//
// Công thức theo tài liệu "Getting started with Lazada Push Mechanism":
//   Authorization = HEX( HMAC-SHA256(app_secret, app_key + raw_body) )
// Tự ký một payload mẫu bằng đúng công thức rồi đối chiếu hàm verify —
// đảm bảo mọi chỉnh sửa sau này không lệch khỏi công thức Lazada.
// ============================================================

import crypto from "crypto";
import { describe, expect, it } from "vitest";
import type { LazadaConfig } from "../lazada/config";
import { verifyLazadaWebhookSignature } from "../lazada/webhook";

const cfg: LazadaConfig = {
  appKey: "123456",
  appSecret: "test_secret_khong_dung_that",
  redirectUri: "https://example.com/callback",
};

/** Ký đúng công thức LPM để giả lập server Lazada. */
function signAsLazada(rawBody: string, c: LazadaConfig = cfg): string {
  return crypto
    .createHmac("sha256", c.appSecret)
    .update(c.appKey + rawBody)
    .digest("hex");
}

const SAMPLE_BODY = JSON.stringify({
  seller_id: "1234567",
  message_type: 0,
  data: {
    order_status: "unpaid",
    status_update_time: 1603698638,
    trade_order_id: "260422900198363",
    trade_order_line_id: "260422900298363",
  },
  timestamp: 1603766859530,
  site: "lazada_vn",
});

describe("verifyLazadaWebhookSignature — công thức HMAC(app_key + raw_body)", () => {
  it("nhận chữ ký đúng (cả khi header viết HOA hex)", () => {
    const sig = signAsLazada(SAMPLE_BODY);
    expect(verifyLazadaWebhookSignature(SAMPLE_BODY, sig, cfg)).toBe(true);
    expect(verifyLazadaWebhookSignature(Buffer.from(SAMPLE_BODY), sig, cfg)).toBe(true);
    // Header hex viết hoa vẫn phải qua — verify hạ về lowercase trước khi so.
    expect(verifyLazadaWebhookSignature(SAMPLE_BODY, sig.toUpperCase(), cfg)).toBe(true);
  });

  it("chặn body bị sửa dù chỉ 1 ký tự", () => {
    const sig = signAsLazada(SAMPLE_BODY);
    const tampered = SAMPLE_BODY.replace("unpaid", "paid");
    expect(verifyLazadaWebhookSignature(tampered, sig, cfg)).toBe(false);
  });

  it("chặn chữ ký ký bằng secret khác / thiếu header", () => {
    const wrongKey = signAsLazada(SAMPLE_BODY, { ...cfg, appSecret: "secret_khac" });
    expect(verifyLazadaWebhookSignature(SAMPLE_BODY, wrongKey, cfg)).toBe(false);
    expect(verifyLazadaWebhookSignature(SAMPLE_BODY, undefined, cfg)).toBe(false);
    expect(verifyLazadaWebhookSignature(SAMPLE_BODY, "", cfg)).toBe(false);
  });

  it("chặn chữ ký thiếu app_key trong chuỗi ký (ký nhầm body trần)", () => {
    const noKey = crypto
      .createHmac("sha256", cfg.appSecret)
      .update(SAMPLE_BODY)
      .digest("hex");
    expect(verifyLazadaWebhookSignature(SAMPLE_BODY, noKey, cfg)).toBe(false);
  });
});
