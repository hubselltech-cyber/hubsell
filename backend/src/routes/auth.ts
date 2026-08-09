import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../prisma";
import { requireAuth, signToken, type AuthRequest } from "../auth";
import { formatE164 } from "../phone";
import { isMailerConfigured, resetPasswordEmailHtml, sendMail } from "../mailer";
import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  isGoogleConfigured,
  signGoogleState,
  verifyGoogleState,
} from "../google-oauth";
import {
  decodeOauthStateOrigin as decodeShopeeStateOrigin,
  handleShopeeCallback,
  verifyOauthState,
} from "../integrations/shopee/service";
import {
  decodeOauthStateOrigin as decodeLazadaStateOrigin,
  handleLazadaCallback,
  verifyOauthState as verifyLazadaOauthState,
} from "../integrations/lazada/service";
import { findReferrerByCode } from "../referral-wallet";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Username: 3-30 ký tự [a-z0-9._], bắt đầu bằng chữ/số, LƯU LOWERCASE.
// CẤM "@" là chốt kiến trúc: ô đăng nhập chung phân biệt được ngay
// "có @ → tra email, không @ → tra username" — không bao giờ nhập nhằng.
const USERNAME_REGEX = /^[a-z0-9][a-z0-9._]{2,29}$/;
// ISO 3166-1 alpha-2 (VN, US, TH...). Chỉ kiểm dạng — danh mục đầy đủ ở FE.
const COUNTRY_REGEX = /^[A-Z]{2}$/;

/** Chuẩn hoá + kiểm username. Trả lỗi tiếng Việt hoặc null nếu hợp lệ. */
function normalizeUsername(raw: unknown): { value?: string; error?: string } {
  if (raw == null || raw === "") return { value: undefined };
  if (typeof raw !== "string") return { error: "Tên đăng nhập không hợp lệ" };
  const value = raw.trim().toLowerCase();
  if (!USERNAME_REGEX.test(value)) {
    return {
      error:
        "Tên đăng nhập: 3-30 ký tự, chỉ gồm chữ thường/số/dấu chấm/gạch dưới, không chứa @",
    };
  }
  return { value };
}

/**
 * Sinh username duy nhất từ local-part email (cho đăng ký qua Google, hoặc
 * fallback). Trùng thì gắn 4 số ngẫu nhiên, thử vài lượt.
 */
async function generateUsername(email: string): Promise<string> {
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

/** Bộ trường public của User trả về FE — dùng chung mọi route auth. */
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  fullName: true,
  country: true,
  phone: true,
  role: true,
  // Cờ quản trị nền tảng — FE dựa vào đây để hiện mục "Hệ thống" trên sidebar.
  isPlatformAdmin: true,
} as const;

// Nơi FE hiển thị kết quả sau khi Shopee redirect về (callback là route BE).
// FE dev chạy HTTP thường — mặc định https từng làm Chrome báo ERR_SSL_PROTOCOL_ERROR.
const FRONTEND_BASE_URL = process.env.APP_FRONTEND_URL ?? "http://localhost:3000";

// POST /api/auth/register — Đăng ký tài khoản mới.
// Body: { email, password, fullName, username?, country?, phoneNumber? }
// Email vẫn BẮT BUỘC (nhận thông báo/thanh toán/reset pass); username là tên
// đăng nhập thay thế — bỏ trống thì tự sinh từ email. phoneNumber là số TRONG
// NƯỚC ("0912345678"/"912345678") — server ghép mã vùng theo country thành
// E.164 rồi mới lưu (xem src/phone.ts); nhận cả alias `countryCode`.
router.post("/register", async (req, res, next) => {
  try {
    const {
      email,
      password,
      fullName,
      username,
      country,
      countryCode,
      phoneNumber,
      referralCode,
    } = req.body ?? {};

    // Kiểm tra dữ liệu đầu vào
    if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: "Email không hợp lệ" });
      return;
    }
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Mật khẩu phải có ít nhất 6 ký tự" });
      return;
    }
    if (typeof fullName !== "string" || fullName.trim().length < 2) {
      res.status(400).json({ error: "Vui lòng nhập họ tên" });
      return;
    }
    const uname = normalizeUsername(username);
    if (uname.error) {
      res.status(400).json({ error: uname.error });
      return;
    }
    const rawCountry = typeof countryCode === "string" ? countryCode : country;
    const normalizedCountry =
      typeof rawCountry === "string" && COUNTRY_REGEX.test(rawCountry.trim().toUpperCase())
        ? rawCountry.trim().toUpperCase()
        : "VN";

    // SĐT không bắt buộc ở tầng API (client cũ/Google flow không có), nhưng
    // ĐÃ GỬI thì phải hợp lệ — lưu dạng E.164 để dùng cho OTP SMS sau này.
    let phoneE164: string | null = null;
    if (phoneNumber != null && phoneNumber !== "") {
      const parsed = formatE164(normalizedCountry, phoneNumber);
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      phoneE164 = parsed.value!;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      res.status(409).json({ error: "Email này đã được đăng ký" });
      return;
    }
    if (uname.value) {
      const usernameTaken = await prisma.user.findUnique({
        where: { username: uname.value },
      });
      if (usernameTaken) {
        res.status(409).json({ error: "Tên đăng nhập này đã có người dùng" });
        return;
      }
    }

    // Mã hoá mật khẩu bằng bcrypt (10 vòng salt)
    const passwordHash = await bcrypt.hash(password, 10);

    // Affiliate Tiếp Thị: đăng ký qua link ?ref= thì ghi nhận người giới thiệu.
    // Mã sai/không tồn tại thì BỎ QUA trong im lặng — không được chặn đăng ký.
    const referrer = await findReferrerByCode(referralCode);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        username: uname.value ?? (await generateUsername(normalizedEmail)),
        passwordHash,
        fullName: fullName.trim(),
        country: normalizedCountry,
        phone: phoneE164,
        role: "ADMIN",
        referredById: referrer?.id ?? null,
      },
      select: PUBLIC_USER_SELECT,
    });

    res.status(201).json({ token: signToken(user.id), user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login — Đăng nhập bằng TÊN ĐĂNG NHẬP hoặc EMAIL.
// Body: { identifier, password } — nhận cả { email } cũ để tương thích ngược.
// Phân biệt: chuỗi CÓ "@" là email, KHÔNG có là username (username cấm @).
router.post("/login", async (req, res, next) => {
  try {
    const { identifier, email, password } = req.body ?? {};
    const rawId = typeof identifier === "string" ? identifier : email;
    if (typeof rawId !== "string" || !rawId.trim() || typeof password !== "string") {
      res.status(400).json({ error: "Thiếu tên đăng nhập/email hoặc mật khẩu" });
      return;
    }

    const id = rawId.trim().toLowerCase();
    const user = id.includes("@")
      ? await prisma.user.findUnique({ where: { email: id } })
      : await prisma.user.findUnique({ where: { username: id } });

    // So sánh mật khẩu với hash đã lưu.
    // Dùng cùng một thông báo lỗi để không lộ tài khoản nào tồn tại.
    const valid = user && (await bcrypt.compare(password, user.passwordHash));
    if (!valid) {
      res.status(401).json({ error: "Tài khoản hoặc mật khẩu không đúng" });
      return;
    }

    res.json({
      token: signToken(user.id),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        country: user.country,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — Lấy thông tin người đang đăng nhập.
// Kèm hasChannels: shop đã kết nối gian hàng nào chưa (cho Onboarding overlay).
router.get("/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [user, channelCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId! },
        select: { ...PUBLIC_USER_SELECT, createdAt: true },
      }),
      prisma.channel.count({ where: { userId: req.ownerId! } }),
    ]);
    if (!user) {
      res.status(401).json({ error: "Tài khoản không tồn tại" });
      return;
    }
    res.json({ user, hasChannels: channelCount > 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/change-password — người dùng TỰ đổi mật khẩu của CHÍNH MÌNH
// (dùng req.userId, không phải ownerId — nhân viên cũng đổi được mật khẩu riêng).
// Bắt buộc xác nhận mật khẩu hiện tại để chống chiếm phiên đổi trộm mật khẩu.
router.post("/change-password", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      res.status(400).json({ error: "Thiếu mật khẩu hiện tại hoặc mật khẩu mới" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "Mật khẩu mới phải có ít nhất 8 ký tự" });
      return;
    }
    if (newPassword === currentPassword) {
      res.status(400).json({ error: "Mật khẩu mới phải khác mật khẩu hiện tại" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    const valid = user && (await bcrypt.compare(currentPassword, user.passwordHash));
    if (!valid) {
      res.status(401).json({ error: "Mật khẩu hiện tại không đúng" });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// QUÊN MẬT KHẨU — reset bằng TOKEN LINK gửi qua email (không OTP: 1 click là
// tới màn đặt lại, không cần UI nhập mã + chống brute-force mã 6 số).
// DB chỉ lưu SHA-256 của token (lộ DB không lộ link), hạn 30 phút, dùng 1 lần.
// ============================================================

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

// POST /api/auth/forgot-password — Body: { email }
// LUÔN trả 200 với thông điệp chung (không lộ email nào có tài khoản); chỉ trả
// 503 khi server chưa cấu hình SMTP (lỗi vận hành, cần lộ rõ).
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: "Email không hợp lệ" });
      return;
    }
    if (!isMailerConfigured()) {
      res.status(503).json({
        error:
          "Máy chủ chưa cấu hình gửi email (SMTP_HOST/SMTP_USER/SMTP_PASS). Liên hệ quản trị viên.",
      });
      return;
    }

    const generic = {
      message:
        "Nếu email tồn tại trong hệ thống, link đặt lại mật khẩu đã được gửi. Kiểm tra cả hộp thư Spam.",
    };
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      res.json(generic);
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${FRONTEND_BASE_URL}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: "Hubsell — Đặt lại mật khẩu",
      html: resetPasswordEmailHtml(user.fullName, resetUrl),
    });
    res.json(generic);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password — Body: { token, newPassword }
router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, newPassword } = req.body ?? {};
    if (typeof token !== "string" || !token.trim()) {
      res.status(400).json({ error: "Thiếu token đặt lại mật khẩu" });
      return;
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      res.status(400).json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự" });
      return;
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
    const user = await prisma.user.findFirst({
      where: { resetTokenHash: tokenHash, resetTokenExpiresAt: { gt: new Date() } },
    });
    if (!user) {
      res.status(400).json({
        error: "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu lại.",
      });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        resetTokenHash: null, // dùng một lần — vô hiệu ngay
        resetTokenExpiresAt: null,
      },
    });
    res.json({ ok: true, message: "Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới." });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// ĐĂNG NHẬP GOOGLE (OAuth 2.0 code flow) — xem ghi chú kiến trúc google-oauth.ts
// ============================================================

// GET /api/auth/google — chuyển hướng sang trang chọn tài khoản Google.
router.get("/google", (_req, res) => {
  if (!isGoogleConfigured()) {
    res.status(503).json({
      error:
        "Đăng nhập Google chưa được bật (thiếu GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET).",
    });
    return;
  }
  res.redirect(buildGoogleAuthorizeUrl(signGoogleState()));
});

// GET /api/auth/google/callback — Google redirect về kèm ?code=&state=.
// Upsert user theo googleId → email; user MỚI: tự sinh username, mật khẩu là
// bcrypt của 32 byte ngẫu nhiên (không đăng nhập được bằng password — muốn đặt
// mật khẩu thì đi luồng Quên mật khẩu). Xong phát JWT, redirect FE kèm token.
router.get("/google/callback", async (req, res) => {
  const fail = (msg: string) =>
    res.redirect(
      `${FRONTEND_BASE_URL}/login?${new URLSearchParams({ social: "error", msg }).toString()}`
    );
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !verifyGoogleState(state)) {
      fail("Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn");
      return;
    }

    const profile = await exchangeGoogleCode(code);
    if (!profile.emailVerified) {
      fail("Email Google chưa được xác minh — không thể dùng để đăng nhập");
      return;
    }

    let user = await prisma.user.findUnique({ where: { googleId: profile.sub } });
    if (!user) {
      // Email đã có tài khoản (đăng ký thường trước đó) → LIÊN KẾT googleId,
      // lần sau bấm Google là vào thẳng.
      const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: { googleId: profile.sub },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email: profile.email,
            username: await generateUsername(profile.email),
            googleId: profile.sub,
            fullName: profile.name,
            passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
            role: "ADMIN",
          },
        });
      }
    }

    res.redirect(
      `${FRONTEND_BASE_URL}/login?${new URLSearchParams({
        social: "ok",
        token: signToken(user.id),
      }).toString()}`
    );
  } catch (err) {
    console.error("[google/callback] Lỗi xử lý callback:", err);
    fail((err as Error).message);
  }
});

// ============================================================
// GET /api/auth/shopee/callback — SHOPEE REDIRECT VỀ ĐÂY SAU KHI UỶ QUYỀN
//
// Endpoint CÔNG KHAI: Shopee mở bằng trình duyệt kèm ?code=&shop_id=&state=.
// Danh tính chủ shop nằm trong `state` (JWT đã ký lúc sinh URL), không dùng JWT
// đăng nhập. Xử lý xong thì redirect trình duyệt về trang Kênh bán của FE.
// ============================================================
router.get("/shopee/callback", async (req, res) => {
  const done = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    res.redirect(`${FRONTEND_BASE_URL}/channels?${qs}`);
  };

  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const shopId = typeof req.query.shop_id === "string" ? req.query.shop_id : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!code || !shopId) {
      done({ shopee: "error", msg: "Thiếu code hoặc shop_id từ Shopee" });
      return;
    }

    // TRẠM TRUNG CHUYỂN CHO DEV LOCAL (cùng cơ chế Lazada): redirect đăng ký
    // trên Console là domain Render, nhưng luồng có thể khởi phát từ app chạy
    // localhost — state khi đó ký bằng secret local nên Render không verify
    // được. Nếu state khai origin localhost (và khác FE của môi trường này)
    // thì bật nguyên `code`+`shop_id` về đó cho backend local đổi token;
    // ownerId lấy từ JWT đăng nhập ở local, không cần tin state. Origin đã
    // lọc chặt chỉ nhận localhost — không mở redirect bừa.
    const devOrigin = state ? decodeShopeeStateOrigin(state) : null;
    if (devOrigin && devOrigin !== FRONTEND_BASE_URL) {
      res.redirect(
        `${devOrigin}/channels?${new URLSearchParams({
          shopee: "code",
          code,
          shop_id: shopId,
        }).toString()}`
      );
      return;
    }

    const st = state ? verifyOauthState(state) : null;
    if (!st) {
      done({ shopee: "error", msg: "Phiên uỷ quyền hết hạn hoặc không hợp lệ" });
      return;
    }

    // targetChannelId (luồng Kết nối lại) → callback đối chiếu shop_id với gian
    // đích, tránh ghi token nhầm gian khi trình duyệt đăng nhập sai tài khoản.
    const saved = await handleShopeeCallback(st.ownerId, code, shopId, st.targetChannelId);
    done({ shopee: "connected", shop: saved.shopName });
  } catch (err) {
    // Ghi log server-side để truy vết — redirect về FE chỉ mang được message ngắn.
    console.error("[shopee/callback] Lỗi xử lý callback:", err);
    done({ shopee: "error", msg: (err as Error).message });
  }
});

// ============================================================
// GET /api/auth/lazada/callback — LAZADA REDIRECT VỀ ĐÂY SAU KHI UỶ QUYỀN
//
// Endpoint CÔNG KHAI: Lazada mở bằng trình duyệt kèm ?code=&state=. Danh tính
// chủ shop nằm trong `state` (JWT đã ký lúc sinh URL). Callback đăng ký trên
// App Console là URL backend RENDER (Lazada bắt https) — luồng này chỉ chạy
// end-to-end trên bản deploy; test local dùng đường "dán code" ở routes/channels.
// ============================================================
router.get("/lazada/callback", async (req, res) => {
  const done = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    res.redirect(`${FRONTEND_BASE_URL}/channels?${qs}`);
  };

  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!code) {
      done({ lazada: "error", msg: "Thiếu code từ Lazada" });
      return;
    }

    // TRẠM TRUNG CHUYỂN CHO DEV LOCAL: callback đăng ký trên App Console là URL
    // Render, nhưng luồng có thể khởi phát từ app chạy localhost — state khi đó
    // ký bằng secret local nên Render không verify được. Nếu state khai origin
    // localhost (và khác FE của môi trường này) thì bật nguyên `code` về đó cho
    // backend local đổi token; ownerId lấy từ JWT đăng nhập ở local, không cần
    // tin state. Origin đã lọc chặt chỉ nhận localhost — không mở redirect bừa.
    const devOrigin = state ? decodeLazadaStateOrigin(state) : null;
    if (devOrigin && devOrigin !== FRONTEND_BASE_URL) {
      res.redirect(
        `${devOrigin}/channels?${new URLSearchParams({ lazada: "code", code }).toString()}`
      );
      return;
    }

    const st = state ? verifyLazadaOauthState(state) : null;
    if (!st) {
      done({ lazada: "error", msg: "Phiên uỷ quyền hết hạn hoặc không hợp lệ" });
      return;
    }

    // targetChannelId (luồng Kết nối lại) → callback đối chiếu seller_id với
    // gian đích, tránh ghi token nhầm gian khi đăng nhập sai tài khoản Lazada.
    const saved = await handleLazadaCallback(st.ownerId, code, st.targetChannelId);
    done({ lazada: "connected", shop: saved.shopName });
  } catch (err) {
    // Ghi log server-side để truy vết — redirect về FE chỉ mang được message ngắn.
    console.error("[lazada/callback] Lỗi xử lý callback:", err);
    done({ lazada: "error", msg: (err as Error).message });
  }
});

export default router;
