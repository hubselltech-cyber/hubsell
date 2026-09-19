import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptInvoiceConfig,
  decryptInvoiceConfigLenient,
  decryptPlatformInvoiceConfig,
  encryptInvoiceSecret,
  encryptPlatformInvoiceSecret,
} from "../invoice/config-secrets";
import {
  checkSecretBoxAtBoot,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  needsEncryption,
  resetSecretBoxForTests,
  SecretBoxError,
} from "../../lib/secret-box";

// ============================================================
// MÃ HÓA BÍ MẬT TRONG DB (19/09/2026). Bộ test viết theo góc nhìn KẺ TẤN CÔNG
// đã có quyền đọc/ghi DB nhưng KHÔNG có khóa máy chủ, cộng các sự cố vận hành
// (mất khóa, xoay khóa, cấu hình sai). Mỗi test khóa một cam kết của
// lib/secret-box.ts — đổi thuật toán/định dạng mà test đỏ thì phải hiểu vì sao.
// ============================================================

const K1 = `k1:${randomBytes(32).toString("base64")}`;
const K0 = `k0:${randomBytes(32).toString("base64")}`;
const PASSWORD = "Mật-khẩu meInvoice#2026 của shop";
const AAD = "InvoiceConfig:owner-A:meinvoicePassword";

const saved = { keys: process.env.SECRET_ENC_KEYS, required: process.env.SECRET_ENC_REQUIRED };
function setEnv(keys: string | undefined, required?: string) {
  if (keys === undefined) delete process.env.SECRET_ENC_KEYS;
  else process.env.SECRET_ENC_KEYS = keys;
  if (required === undefined) delete process.env.SECRET_ENC_REQUIRED;
  else process.env.SECRET_ENC_REQUIRED = required;
  resetSecretBoxForTests();
}
beforeEach(() => setEnv(K1));
afterEach(() => setEnv(saved.keys, saved.required));

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SecretBoxError);
    expect((err as SecretBoxError).code).toBe(code);
    return err as SecretBoxError;
  }
  throw new Error(`mong đợi SecretBoxError ${code} nhưng không ném lỗi`);
}

/** Đổi 1 ký tự ở đoạn thứ `part` (0 keyId · 1 iv · 2 tag · 3 bản mã) của chuỗi đã mã hóa. */
function tamper(stored: string, part: number): string {
  const head = "enc:v1:";
  const parts = stored.slice(head.length).split(":");
  const p = parts[part];
  parts[part] = (p[0] === "A" ? "B" : "A") + p.slice(1);
  return head + parts.join(":");
}

describe("Mã hóa / giải mã cơ bản", () => {
  it("khứ hồi đúng nguyên văn, kể cả tiếng Việt có dấu và ký tự đặc biệt", () => {
    const stored = encryptSecret(PASSWORD, AAD)!;
    expect(decryptSecret(stored, AAD)).toBe(PASSWORD);
  });

  it("thứ nằm trong DB KHÔNG chứa mật khẩu, đúng định dạng enc:v1:<khóa>:<iv>:<tag>:<bản mã>", () => {
    const stored = encryptSecret("hunter2-abcdef", AAD)!;
    expect(stored).not.toContain("hunter2");
    expect(stored).toMatch(/^enc:v1:k1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/);
    expect(isEncryptedSecret(stored)).toBe(true);
  });

  it("IV ngẫu nhiên: mã hóa cùng một mật khẩu 2 lần ra 2 bản mã KHÁC nhau (không lộ việc hai shop trùng mật khẩu)", () => {
    const a = encryptSecret(PASSWORD, AAD);
    const b = encryptSecret(PASSWORD, AAD);
    expect(a).not.toBe(b);
  });

  it("null / rỗng trả nguyên, không sinh bản mã cho ô trống", () => {
    expect(encryptSecret(null, AAD)).toBeNull();
    expect(encryptSecret("", AAD)).toBe("");
    expect(decryptSecret(null, AAD)).toBeNull();
  });

  it("dữ liệu chữ thường đời cũ đọc ra nguyên văn (deploy trước, chuyển đổi sau — không gãy shop đang nối)", () => {
    expect(decryptSecret("mat-khau-doi-cu", AAD)).toBe("mat-khau-doi-cu");
    expect(needsEncryption("mat-khau-doi-cu")).toBe(true);
    expect(needsEncryption(encryptSecret("x", AAD))).toBe(false);
  });
});

describe("Kẻ tấn công có quyền GHI vào DB", () => {
  it("sửa 1 ký tự ở bản mã / thẻ xác thực / IV → giải mã báo lỗi, không bao giờ trả rác", () => {
    const stored = encryptSecret(PASSWORD, AAD)!;
    for (const part of [1, 2, 3]) {
      expectCode(() => decryptSecret(tamper(stored, part), AAD), "DECRYPT_FAILED");
    }
  });

  it("CHÉP bản mã của shop nạn nhân sang hàng của shop mình → không giải mã được (AAD gắn theo chủ shop)", () => {
    const victim = encryptInvoiceSecret("owner-VICTIM", "meinvoicePassword", PASSWORD)!;
    // Kẻ tấn công dán nguyên bản mã vào hàng InvoiceConfig của chính họ:
    expectCode(
      () => decryptInvoiceConfig({ ownerId: "owner-ATTACKER", meinvoicePassword: victim }),
      "DECRYPT_FAILED"
    );
    // Hàng của nạn nhân vẫn đọc bình thường:
    expect(
      decryptInvoiceConfig({ ownerId: "owner-VICTIM", meinvoicePassword: victim }).meinvoicePassword
    ).toBe(PASSWORD);
  });

  it("chép bản mã sang CỘT khác của cùng shop, hoặc từ bảng shop sang bảng HQ → cũng không giải mã được", () => {
    const pw = encryptInvoiceSecret("owner-A", "meinvoicePassword", PASSWORD)!;
    expectCode(() => decryptInvoiceConfig({ ownerId: "owner-A", esignPassword: pw }), "DECRYPT_FAILED");
    expectCode(() => decryptPlatformInvoiceConfig({ meinvoicePassword: pw }), "DECRYPT_FAILED");
  });

  it("chuỗi giả định dạng (thiếu đoạn, IV sai độ dài) → lỗi có kiểm soát", () => {
    expectCode(() => decryptSecret("enc:v1:k1:abc", AAD), "DECRYPT_FAILED");
    expectCode(() => decryptSecret("enc:v1:k1:AAAA:AAAA:AAAA", AAD), "DECRYPT_FAILED");
  });

  it("thông báo lỗi KHÔNG BAO GIỜ chứa mật khẩu hay khóa", () => {
    const stored = encryptSecret(PASSWORD, AAD)!;
    const err = expectCode(() => decryptSecret(tamper(stored, 3), AAD), "DECRYPT_FAILED");
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).not.toContain(K1.slice(3));
  });
});

describe("Sự cố vận hành với khóa", () => {
  it("chưa đặt khóa (giai đoạn chuyển tiếp): ghi chữ thường như cũ, khởi động chỉ cảnh báo", () => {
    setEnv(undefined);
    expect(encryptSecret(PASSWORD, AAD)).toBe(PASSWORD);
    expect(needsEncryption(PASSWORD)).toBe(false);
    expect(checkSecretBoxAtBoot()).toContain("CHƯA BẬT");
  });

  it("SECRET_ENC_REQUIRED=1 mà thiếu khóa: TỪ CHỐI ghi bí mật + không cho khởi động", () => {
    setEnv(undefined, "1");
    expectCode(() => encryptSecret(PASSWORD, AAD), "KEY_REQUIRED");
    expectCode(() => checkSecretBoxAtBoot(), "KEY_REQUIRED");
  });

  it("mất khóa: bản mã cũ báo KEY_MISSING (không trả rác, không trả chuỗi mã hóa làm mật khẩu)", () => {
    const stored = encryptSecret(PASSWORD, AAD)!;
    setEnv(undefined);
    expectCode(() => decryptSecret(stored, AAD), "KEY_MISSING");
    setEnv(K0); // có khóa nhưng là khóa KHÁC mã
    expectCode(() => decryptSecret(stored, AAD), "KEY_MISSING");
  });

  it("khóa sai độ dài / sai định dạng / trùng mã → BAD_KEY_CONFIG ngay lúc khởi động", () => {
    setEnv(`k1:${randomBytes(16).toString("base64")}`);
    expectCode(() => checkSecretBoxAtBoot(), "BAD_KEY_CONFIG");
    setEnv("khong-co-dau-hai-cham");
    expectCode(() => checkSecretBoxAtBoot(), "BAD_KEY_CONFIG");
    setEnv(`${K1},${K1}`);
    expectCode(() => checkSecretBoxAtBoot(), "BAD_KEY_CONFIG");
  });

  it("XOAY KHÓA: thêm khóa mới lên đầu → bản mã khóa cũ vẫn đọc được, được đánh dấu cần mã hóa lại, mã hóa mới dùng khóa mới", () => {
    setEnv(K0);
    const old = encryptSecret(PASSWORD, AAD)!;
    expect(old.startsWith("enc:v1:k0:")).toBe(true);

    setEnv(`${K1},${K0}`);
    expect(decryptSecret(old, AAD)).toBe(PASSWORD);
    expect(needsEncryption(old)).toBe(true);
    const fresh = encryptSecret(decryptSecret(old, AAD), AAD)!;
    expect(fresh.startsWith("enc:v1:k1:")).toBe(true);
    expect(needsEncryption(fresh)).toBe(false);

    // Gỡ khóa cũ SAU KHI đã chuyển hết: bản mới vẫn đọc được, bản cũ thì không.
    setEnv(K1);
    expect(decryptSecret(fresh, AAD)).toBe(PASSWORD);
    expectCode(() => decryptSecret(old, AAD), "KEY_MISSING");
  });
});

describe("Hàng cấu hình hóa đơn", () => {
  it("decryptInvoiceConfig giải mã đủ các cột bí mật có mặt, giữ nguyên cột thường", () => {
    const row = {
      ownerId: "owner-A",
      taxCode: "0101243150",
      meinvoicePassword: encryptInvoiceSecret("owner-A", "meinvoicePassword", "pw-1"),
      apiKey: encryptInvoiceSecret("owner-A", "apiKey", "key-2"),
      esignPassword: null,
      secretKey: "chu-thuong-doi-cu",
    };
    const out = decryptInvoiceConfig(row);
    expect(out).toMatchObject({
      taxCode: "0101243150",
      meinvoicePassword: "pw-1",
      apiKey: "key-2",
      esignPassword: null,
      secretKey: "chu-thuong-doi-cu",
    });
    expect(row.meinvoicePassword).toMatch(/^enc:v1:/); // không sửa hàng gốc
  });

  it("bản KHOAN DUNG cho trang cấu hình: ô hỏng coi như chưa đặt + báo tên ô, không ném lỗi", () => {
    const good = encryptInvoiceSecret("owner-A", "apiKey", "key-2");
    const bad = tamper(encryptInvoiceSecret("owner-A", "meinvoicePassword", "pw-1")!, 3);
    const { row, unreadable } = decryptInvoiceConfigLenient({
      ownerId: "owner-A",
      apiKey: good,
      meinvoicePassword: bad,
    });
    expect(row.apiKey).toBe("key-2");
    expect(row.meinvoicePassword).toBeNull();
    expect(unreadable).toEqual(["meinvoicePassword"]);
  });

  it("bảng HQ: khứ hồi đúng", () => {
    const stored = encryptPlatformInvoiceSecret("meinvoicePassword", "pw-hq");
    expect(decryptPlatformInvoiceConfig({ meinvoicePassword: stored }).meinvoicePassword).toBe("pw-hq");
  });
});
