import { prisma } from "./prisma";

/**
 * Tên đăng nhập (cả username CHỦ SHOP lẫn staffUsername NHÂN VIÊN dùng chung
 * một văn phạm): 3-30 ký tự [a-z0-9._], bắt đầu bằng chữ/số, LƯU LOWERCASE.
 *
 * Hai ký tự bị CẤM là chốt kiến trúc của Ô ĐĂNG NHẬP CHUNG:
 *  - "@" → chuỗi có @ chắc chắn là EMAIL
 *  - "/" → chuỗi có / chắc chắn là đăng nhập NHÂN VIÊN dạng "chủ/nhânviên"
 * Nhờ vậy ba nhánh tra cứu không bao giờ nhập nhằng.
 */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._]{2,29}$/;

/** Chuẩn hoá + kiểm username. Trả lỗi tiếng Việt hoặc value nếu hợp lệ. */
export function normalizeUsername(raw: unknown): { value?: string; error?: string } {
  if (raw == null || raw === "") return { value: undefined };
  if (typeof raw !== "string") return { error: "Tên đăng nhập không hợp lệ" };
  const value = raw.trim().toLowerCase();
  if (!USERNAME_REGEX.test(value)) {
    return {
      error:
        "Tên đăng nhập: 3-30 ký tự, chỉ gồm chữ thường/số/dấu chấm/gạch dưới, không chứa @ hay /",
    };
  }
  return { value };
}

/**
 * Sinh username CHỦ SHOP duy nhất từ local-part email (đăng ký Google, hoặc
 * fallback). Trùng thì gắn 4 số ngẫu nhiên, thử vài lượt.
 */
export async function generateUsername(email: string): Promise<string> {
  let base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._]/g, "");
  if (base.length < 3 || !/^[a-z0-9]/.test(base)) base = `user${base}`;
  base = base.slice(0, 24);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const clash = await prisma.user.findUnique({ where: { username: candidate } });
    if (!clash) return candidate;
  }
  return `${base}${Date.now() % 100000}`;
}

/**
 * Bảo đảm chủ shop có username — nền của định dạng đăng nhập nhân viên
 * "<username chủ>/<staffUsername>". User cũ chưa đặt thì tự sinh từ email và
 * LƯU LUÔN (gọi khi tạo nhân viên đầu tiên). Trả về username sau cùng.
 */
export async function ensureOwnerUsername(owner: {
  id: string;
  email: string | null;
  username: string | null;
}): Promise<string> {
  if (owner.username) return owner.username;
  const generated = await generateUsername(owner.email ?? `shop${owner.id.slice(-6)}@x`);
  await prisma.user.update({
    where: { id: owner.id },
    data: { username: generated },
  });
  return generated;
}
