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
import { ensureDefaultSubscription } from "../subscription-service";
import { generateUsername, normalizeUsername } from "../username";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// ISO 3166-1 alpha-2 (VN, US, TH...). Chỉ kiểm dạng — danh mục đầy đủ ở FE.
const COUNTRY_REGEX = /^[A-Z]{2}$/;

// ============================================================
// RATE-LIMIT ĐĂNG NHẬP (in-memory, đủ cho 1 instance Render).
// Cú pháp "chủ/nhânviên" làm lộ cấu trúc 2 lớp của tài khoản → chặn brute-force
// theo (IP + identifier): quá MAX lần sai trong WINDOW thì 429. Đăng nhập đúng
// là xoá bộ đếm ngay. Map tự dọn phần tử hết hạn khi phình to.
// ============================================================
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
const loginFails = new Map<string, { count: number; resetAt: number }>();

function loginFailKey(req: { ip?: string }, identifier: string): string {
  return `${req.ip ?? "?"}|${identifier}`;
}

function isLoginBlocked(key: string): boolean {
  const entry = loginFails.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginFails.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILS;
}

function recordLoginFail(key: string) {
  // Dọn rác khi map phình — tránh giữ vô hạn bộ nhớ vì bị quét identifier.
  if (loginFails.size > 10_000) {
    const now = Date.now();
    for (const [k, v] of loginFails) if (now > v.resetAt) loginFails.delete(k);
  }
  const entry = loginFails.get(key);
  if (entry && Date.now() <= entry.resetAt) {
    entry.count += 1;
  } else {
    loginFails.set(key, { count: 1, resetAt: Date.now() + LOGIN_FAIL_WINDOW_MS });
  }
}

/** Bộ trường public của User trả về FE — dùng chung mọi route auth. */
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  // Tên đăng nhập nhân viên (null với chủ shop) — FE hiển thị "chủ/nhânviên".
  staffUsername: true,
  fullName: true,
  country: true,
  phone: true,
  // Ảnh đại diện data URL base64 (~vài chục KB) — header FE hiển thị thay icon.
  avatar: true,
  role: true,
  // Cây quyền của nhân viên — FE dựa vào đây để ẩn/hiện menu (lớp chặn thật
  // vẫn là requirePermission ở backend).
  permissions: true,
  // Cờ quản trị nền tảng — FE dựa vào đây để hiện mục "Hệ thống" trên sidebar.
  isPlatformAdmin: true,
  // ownerId chỉ để tính platformWorkspace (xem isPlatformWorkspace) — FE không dùng.
  ownerId: true,
} as const;

/**
 * User có thuộc KHÔNG GIAN ĐIỀU HÀNH HUBSELL không? (chủ nền tảng, hoặc nhân
 * viên do chủ nền tảng tạo). FE dựa vào cờ này để vẽ sidebar Điều hành thay
 * cho sidebar shop — chỉ là lớp trải nghiệm; lớp chặn thật vẫn là
 * requirePlatformPermission ở /api/admin.
 */
async function isPlatformWorkspace(user: {
  isPlatformAdmin: boolean;
  ownerId: string | null;
}): Promise<boolean> {
  if (user.isPlatformAdmin) return true;
  if (!user.ownerId) return false;
  const owner = await prisma.user.findUnique({
    where: { id: user.ownerId },
    select: { isPlatformAdmin: true },
  });
  return owner?.isPlatformAdmin === true;
}

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

    // Gán gói mặc định (Beta 0đ) — fire-and-forget, không chặn luồng đăng ký.
    void ensureDefaultSubscription(user.id);

    // Tài khoản vừa đăng ký luôn là chủ shop thường — không thuộc khu điều hành.
    res.status(201).json({
      token: signToken(user.id),
      user: { ...user, platformWorkspace: false },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/check-username?username=... — CÔNG KHAI, cho form đăng ký báo
// "tên này đã có người sử dụng" NGAY KHI GÕ thay vì đợi submit dính 409.
// Chỉ trả một bit available — không lộ thêm thông tin gì về tài khoản; kẻ dò
// tên hàng loạt cũng chỉ biết điều mà nút Đăng ký sẽ nói ra ngay sau đó.
router.get("/check-username", async (req, res, next) => {
  try {
    const uname = normalizeUsername(req.query.username);
    if (uname.error || !uname.value) {
      // Tên chưa hợp lệ về văn phạm → coi như "không dùng được", FE tự hiển
      // thị thông điệp định dạng của nó, không cần phân biệt lý do ở đây.
      res.json({ available: false });
      return;
    }
    const clash = await prisma.user.findUnique({
      where: { username: uname.value },
      select: { id: true },
    });
    res.json({ available: !clash });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login — Đăng nhập bằng TÊN ĐĂNG NHẬP, EMAIL, hoặc TÀI KHOẢN
// NHÂN VIÊN dạng "chủ/nhânviên" (vd "darkman/kho01").
// Body: { identifier, password } — nhận cả { email } cũ để tương thích ngược.
// Ba nhánh KHÔNG BAO GIỜ nhập nhằng vì username cấm cả "@" lẫn "/":
//   có "@" → email · có "/" → nhân viên "chủ/nhânviên" · còn lại → username chủ shop
router.post("/login", async (req, res, next) => {
  try {
    const { identifier, email, password } = req.body ?? {};
    const rawId = typeof identifier === "string" ? identifier : email;
    if (typeof rawId !== "string" || !rawId.trim() || typeof password !== "string") {
      res.status(400).json({ error: "Thiếu tên đăng nhập/email hoặc mật khẩu" });
      return;
    }

    const id = rawId.trim().toLowerCase();

    const failKey = loginFailKey(req, id);
    if (isLoginBlocked(failKey)) {
      res.status(429).json({
        error: "Sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.",
      });
      return;
    }

    let user = null;
    if (id.includes("@")) {
      user = await prisma.user.findUnique({ where: { email: id } });
    } else if (id.includes("/")) {
      // Nhân viên "chủ/nhânviên": tách tại dấu "/" ĐẦU TIÊN. Tên hợp lệ không
      // chứa "/" nên chuỗi có ≥2 dấu "/" chắc chắn sai — cứ tra rồi ra null.
      const slash = id.indexOf("/");
      const ownerUsername = id.slice(0, slash);
      const staffUsername = id.slice(slash + 1);
      if (ownerUsername && staffUsername && !staffUsername.includes("/")) {
        const owner = await prisma.user.findUnique({
          where: { username: ownerUsername },
          select: { id: true },
        });
        if (owner) {
          user = await prisma.user.findUnique({
            where: {
              ownerId_staffUsername: { ownerId: owner.id, staffUsername },
            },
          });
        }
      }
    } else {
      user = await prisma.user.findUnique({ where: { username: id } });
    }

    // So sánh mật khẩu với hash đã lưu.
    // Dùng cùng MỘT thông báo lỗi cho mọi trường hợp (sai chủ shop, sai nhân
    // viên, sai mật khẩu) để không lộ tài khoản/shop nào tồn tại.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      recordLoginFail(failKey);
      res.status(401).json({ error: "Tài khoản hoặc mật khẩu không đúng" });
      return;
    }
    loginFails.delete(failKey);

    res.json({
      token: signToken(user.id),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        staffUsername: user.staffUsername,
        fullName: user.fullName,
        country: user.country,
        phone: user.phone,
        role: user.role,
        permissions: user.permissions,
        isPlatformAdmin: user.isPlatformAdmin,
        // FE cần cờ này NGAY LÚC LOGIN để redirect đúng trang chủ của khu
        // điều hành (homePathFor) — không đợi được tới lượt fetch /me.
        platformWorkspace: await isPlatformWorkspace(user),
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
    res.json({
      user: { ...user, platformWorkspace: await isPlatformWorkspace(user) },
      hasChannels: channelCount > 0,
    });
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

// PUT /api/auth/me/avatar — đặt/gỡ ảnh đại diện của CHÍNH MÌNH (req.userId —
// nhân viên cũng có avatar riêng). Body: { avatar: string | null }; string là
// data URL base64 FE đã thu nhỏ ~256px, null = gỡ ảnh về icon mặc định.
router.put("/me/avatar", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { avatar } = req.body ?? {};
    if (avatar !== null && typeof avatar !== "string") {
      res.status(400).json({ error: "Thiếu dữ liệu ảnh đại diện" });
      return;
    }
    if (typeof avatar === "string") {
      // Chỉ nhận đúng data URL ảnh — chặn nhét chuỗi lạ (script, URL ngoài…)
      // vào cột rồi render ngược ra <img> của người khác xem.
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) {
        res.status(400).json({ error: "Ảnh đại diện không đúng định dạng" });
        return;
      }
      // FE đã nén ~256px (vài chục KB); trần 90KB chuỗi để vừa giới hạn body
      // JSON 100kb của express.json và giữ DB không phình vì ảnh gốc ai đó
      // gọi API tay.
      if (avatar.length > 90_000) {
        res.status(400).json({ error: "Ảnh quá lớn — vui lòng chọn ảnh nhỏ hơn" });
        return;
      }
    }

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { avatar },
      select: PUBLIC_USER_SELECT,
    });
    // Kèm platformWorkspace như /me — FE setStoredUser nguyên object này,
    // thiếu cờ là sidebar Điều hành "nhảy" về sidebar shop sau khi đổi avatar.
    res.json({
      user: { ...user, platformWorkspace: await isPlatformWorkspace(user) },
    });
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
    // user?.email: email giờ nullable (nhân viên "chủ/nhânviên" không có email
    // — họ nhờ chủ shop reset hộ, không đi luồng này).
    if (!user?.email) {
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
        // Chủ shop mới qua Google cũng nhận gói mặc định (Beta 0đ).
        void ensureDefaultSubscription(user.id);
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

    // Luồng uỷ quyền mới: đăng nhập bằng MAIN ACCOUNT sẽ trả main_account_id
    // thay cho shop_id — chưa hỗ trợ (cần đổi token cấp account rồi tách từng
    // shop). Hướng khách đăng nhập bằng tài khoản shop.
    if (!shopId && typeof req.query.main_account_id === "string" && req.query.main_account_id) {
      done({
        shopee: "error",
        msg: "Vui lòng đăng nhập bằng tài khoản shop (không dùng tài khoản chính/main account) rồi uỷ quyền lại",
      });
      return;
    }

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
