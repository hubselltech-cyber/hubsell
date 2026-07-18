import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";

// Khóa bí mật để ký token. Ở môi trường thật PHẢI đặt trong biến môi trường.
const JWT_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";
const TOKEN_EXPIRES_IN = "7d"; // token sống 7 ngày

// Request đã gắn thông tin người dùng sau khi xác thực
export interface AuthRequest extends Request {
  userId?: string; // id của chính người đang đăng nhập
  ownerId?: string; // id CHỦ SHOP — mọi dữ liệu đều thuộc về chủ shop.
  // Với Admin: ownerId = userId. Với Staff: ownerId = id của chủ shop.
  userRole?: string; // ADMIN | STAFF
  // Phạm vi kênh của nhân viên: null = xem tất cả kênh; mảng = chỉ các kênh này.
  // Admin luôn = null (toàn quyền).
  allowedChannelIds?: string[] | null;
}

// Tạo token đăng nhập cho một user
export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

// Middleware: chặn mọi request chưa đăng nhập + nạp vai trò và phạm vi dữ liệu
export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Bạn chưa đăng nhập" });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as jwt.JwtPayload;
    if (!payload.sub) throw new Error("Token thiếu thông tin user");

    const user = await prisma.user.findUnique({
      where: { id: String(payload.sub) },
      select: { id: true, role: true, ownerId: true },
    });
    if (!user) {
      res.status(401).json({ error: "Tài khoản không còn tồn tại" });
      return;
    }

    req.userId = user.id;
    req.ownerId = user.ownerId ?? user.id; // Staff dùng chung dữ liệu của chủ shop
    req.userRole = user.role;

    // Nạp phạm vi kênh cho nhân viên (multi-store permission)
    if (user.role === "STAFF") {
      const perms = await prisma.staffChannel.findMany({
        where: { staffId: user.id },
        select: { channelId: true },
      });
      // Không gán kênh nào = xem tất cả (null); có gán = chỉ các kênh đó
      req.allowedChannelIds = perms.length > 0 ? perms.map((p) => p.channelId) : null;
    } else {
      req.allowedChannelIds = null; // Admin: toàn quyền
    }

    next();
  } catch {
    res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });
  }
}

// Middleware: bắt buộc shop đã kết nối ít nhất 1 gian hàng (Onboarding guard).
// Nếu chưa có kênh nào → chặn API dữ liệu và yêu cầu kết nối trước.
export async function requireChannel(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const count = await prisma.channel.count({ where: { userId: req.ownerId! } });
  if (count === 0) {
    res.status(409).json({
      error:
        "Bạn cần kết nối ít nhất một gian hàng trước khi sử dụng tính năng này.",
      code: "NO_CHANNEL",
    });
    return;
  }
  next();
}

// Middleware: chỉ cho phép ADMIN (chủ shop) đi tiếp
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (req.userRole !== "ADMIN") {
    res.status(403).json({ error: "Bạn không có quyền truy cập" });
    return;
  }
  next();
}
