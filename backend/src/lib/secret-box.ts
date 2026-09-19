/**
 * HỘP BÍ MẬT — mã hóa các giá trị nhạy cảm TRƯỚC KHI ghi DB (19/09/2026).
 *
 * VÌ SAO: Hubsell giữ mật khẩu meInvoice của khách để đăng nhập MISA thay họ.
 * meInvoice ký hóa đơn bằng HSM phía MISA, nên ai có {MST + tài khoản + mật
 * khẩu} là phát hành được hóa đơn có chữ ký số hợp lệ dưới tên khách — không
 * xóa được. Mật khẩu này KHÔNG băm một chiều được (ta phải dùng lại nguyên văn)
 * nên chỉ còn cách mã hóa hai chiều với khóa nằm NGOÀI cơ sở dữ liệu.
 *
 * MÔ HÌNH ĐE DỌA — nói thẳng để không ai hiểu lầm về mức bảo vệ:
 *   CHẶN ĐƯỢC  : lộ riêng DB — bản sao lưu Supabase, lộ DATABASE_URL, lỗi truy vấn
 *                kéo được bảng, người có quyền vào Supabase mở bảng ra xem, log
 *                truy vấn của nhà cung cấp DB.
 *   KHÔNG CHẶN : kẻ chiếm được tiến trình máy chủ (có cả khóa lẫn DB). Chống lớp
 *                đó là việc của hạ tầng (quyền Render, 2FA, vá lỗ hổng), không
 *                phải của file này.
 *
 * THUẬT TOÁN: AES-256-GCM (mã hóa có xác thực — sửa 1 bit bản mã là giải mã báo
 * lỗi chứ không trả rác), IV 96 bit NGẪU NHIÊN cho mỗi lần mã hóa (GCM vỡ hoàn
 * toàn nếu lặp IV với cùng khóa — tuyệt đối không dùng IV cố định/bộ đếm tự chế),
 * thẻ xác thực 128 bit. Dùng `node:crypto` có sẵn, không thêm thư viện.
 *
 * AAD (dữ liệu xác thực kèm theo) = NGỮ CẢNH của ô dữ liệu, VD
 * "InvoiceConfig:<ownerId>:meinvoicePassword". Bản mã bị DÁN sang hàng/cột khác
 * sẽ không giải mã được. Không có lớp này, kẻ ghi được vào DB có thể chép {MST,
 * tài khoản, mật khẩu đã mã hóa} của nạn nhân sang hàng của chính mình rồi dùng
 * tài khoản Hubsell của mình phát hành hóa đơn dưới tên nạn nhân.
 *
 * ĐỊNH DẠNG LƯU: `enc:v1:<keyId>:<iv>:<tag>:<bản mã>` (base64url). keyId cho
 * phép XOAY KHÓA: env chứa nhiều khóa, khóa ĐẦU dùng để mã hóa, mọi khóa đều
 * giải mã được → đổi khóa không làm gãy dữ liệu cũ.
 *
 * ENV:
 *   SECRET_ENC_KEYS     = "k1:<base64 32 byte>[,k0:<base64 32 byte>]"
 *       Tạo khóa: node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"
 *   SECRET_ENC_REQUIRED = "1" → thiếu khóa là TỪ CHỐI ghi bí mật + báo lỗi lúc
 *       khởi động (bật SAU KHI đã đặt khóa trên production và kiểm xong).
 * Chưa đặt khóa (giai đoạn chuyển tiếp): ghi như cũ (chữ thường) + cảnh báo lúc
 * khởi động — để bản deploy mang code này không làm gãy việc lưu cấu hình trong
 * lúc chờ đặt khóa. MẤT KHÓA = mọi bí mật đã mã hóa thành rác, khách phải nhập
 * lại → khóa phải được cất thêm ở một nơi an toàn thứ hai.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

export type SecretBoxErrorCode = "BAD_KEY_CONFIG" | "KEY_REQUIRED" | "KEY_MISSING" | "DECRYPT_FAILED";

/** Lỗi của hộp bí mật — message KHÔNG BAO GIỜ chứa giá trị bí mật hay khóa. */
export class SecretBoxError extends Error {
  constructor(
    readonly code: SecretBoxErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SecretBoxError";
  }
}

interface KeyRing {
  /** Khóa dùng để MÃ HÓA (đứng đầu danh sách) — null khi chưa cấu hình. */
  active: { id: string; key: Buffer } | null;
  byId: Map<string, Buffer>;
}

let cachedRing: { raw: string; ring: KeyRing } | null = null;

/** Đọc + kiểm SECRET_ENC_KEYS. Cấu hình SAI thì ném lỗi (không âm thầm bỏ qua). */
function keyRing(): KeyRing {
  const raw = process.env.SECRET_ENC_KEYS?.trim() ?? "";
  if (cachedRing && cachedRing.raw === raw) return cachedRing.ring;

  const byId = new Map<string, Buffer>();
  let active: KeyRing["active"] = null;
  for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const sep = part.indexOf(":");
    const id = sep > 0 ? part.slice(0, sep) : "";
    const b64 = sep > 0 ? part.slice(sep + 1) : "";
    if (!KEY_ID_RE.test(id)) {
      throw new SecretBoxError("BAD_KEY_CONFIG", "SECRET_ENC_KEYS: mỗi khóa phải có dạng <mã khóa>:<base64> (mã khóa 1-16 ký tự chữ/số/-/_).");
    }
    const key = Buffer.from(b64, "base64");
    if (key.length !== KEY_BYTES) {
      throw new SecretBoxError("BAD_KEY_CONFIG", `SECRET_ENC_KEYS: khóa "${id}" phải là đúng ${KEY_BYTES} byte (base64).`);
    }
    if (byId.has(id)) {
      throw new SecretBoxError("BAD_KEY_CONFIG", `SECRET_ENC_KEYS: trùng mã khóa "${id}".`);
    }
    byId.set(id, key);
    active ??= { id, key };
  }
  const ring: KeyRing = { active, byId };
  cachedRing = { raw, ring };
  return ring;
}

function encryptionRequired(): boolean {
  const v = process.env.SECRET_ENC_REQUIRED?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Đã cấu hình khóa mã hóa chưa (để nơi gọi quyết định có chạy chuyển đổi không). */
export function secretBoxEnabled(): boolean {
  return keyRing().active !== null;
}

/** Giá trị đang ở dạng đã mã hóa? */
export function isEncryptedSecret(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

/**
 * Cần mã hóa (lại) không: chữ thường, hoặc đã mã hóa nhưng bằng khóa KHÔNG còn
 * là khóa đang dùng (sau khi xoay khóa). Chưa cấu hình khóa → luôn false.
 */
export function needsEncryption(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const { active } = keyRing();
  if (!active) return false;
  if (!isEncryptedSecret(stored)) return true;
  return stored.slice(PREFIX.length).split(":")[0] !== active.id;
}

/**
 * Mã hóa một giá trị cho ô dữ liệu có ngữ cảnh `aad`. null/rỗng trả nguyên.
 * Chưa cấu hình khóa: trả CHỮ THƯỜNG (chuyển tiếp) — trừ khi SECRET_ENC_REQUIRED.
 */
export function encryptSecret(plain: string | null | undefined, aad: string): string | null {
  if (plain === null || plain === undefined || plain === "") return plain ?? null;
  const { active } = keyRing();
  if (!active) {
    if (encryptionRequired()) {
      throw new SecretBoxError("KEY_REQUIRED", "Máy chủ chưa có khóa mã hóa (SECRET_ENC_KEYS) nên từ chối lưu thông tin bí mật.");
    }
    return plain;
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, active.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${active.id}:${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/**
 * Giải mã giá trị đọc từ DB. Chữ thường đời cũ (không có tiền tố) trả nguyên —
 * nhờ vậy deploy code này trước khi chuyển đổi dữ liệu không làm gãy gì.
 * Ném SecretBoxError khi: thiếu khóa tương ứng, bản mã bị sửa, hoặc bản mã bị
 * dán sang ngữ cảnh khác (aad lệch).
 */
export function decryptSecret(stored: string | null | undefined, aad: string): string | null {
  if (stored === null || stored === undefined || stored === "") return stored ?? null;
  if (!isEncryptedSecret(stored)) return stored;

  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 4) {
    throw new SecretBoxError("DECRYPT_FAILED", "Giá trị đã mã hóa sai định dạng.");
  }
  const [keyId, ivB64, tagB64, ctB64] = parts;
  const key = keyRing().byId.get(keyId);
  if (!key) {
    throw new SecretBoxError("KEY_MISSING", `Máy chủ không có khóa "${keyId}" để giải mã (kiểm tra SECRET_ENC_KEYS).`);
  }
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError("DECRYPT_FAILED", "Giá trị đã mã hóa sai định dạng.");
  }
  try {
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Cố ý KHÔNG chuyển tiếp lỗi gốc của OpenSSL và không phân biệt "sai khóa"
    // với "bản mã bị sửa / sai ngữ cảnh" — không cho kẻ dò thêm tín hiệu nào.
    throw new SecretBoxError("DECRYPT_FAILED", "Không giải mã được giá trị (bản mã bị sửa hoặc không thuộc ô dữ liệu này).");
  }
}

/**
 * Kiểm lúc khởi động — trả dòng trạng thái để log. Cấu hình khóa SAI, hoặc bắt
 * buộc mã hóa mà thiếu khóa → NÉM LỖI cho tiến trình dừng (Render giữ bản đang
 * chạy), thà không lên còn hơn lên mà ghi bí mật ra chữ thường.
 */
export function checkSecretBoxAtBoot(): string {
  const { active, byId } = keyRing(); // ném BAD_KEY_CONFIG nếu env sai
  if (active) {
    return `[SecretBox] BẬT — khóa đang dùng "${active.id}", tổng ${byId.size} khóa giải mã được.`;
  }
  if (encryptionRequired()) {
    throw new SecretBoxError("KEY_REQUIRED", "SECRET_ENC_REQUIRED=1 nhưng thiếu SECRET_ENC_KEYS.");
  }
  return "[SecretBox] ⚠️ CHƯA BẬT — thiếu SECRET_ENC_KEYS: bí mật NCC hóa đơn đang ghi DB dạng chữ thường. Xem docs/BAO-MAT-MA-HOA-BI-MAT.md.";
}

/** Chỉ cho test: bỏ cache vòng khóa sau khi đổi process.env. */
export function resetSecretBoxForTests(): void {
  cachedRing = null;
}
