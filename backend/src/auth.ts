import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { prisma } from "./prisma";

// Khóa bí mật để ký token. Ở môi trường thật PHẢI đặt trong biến môi trường.
const JWT_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";
const TOKEN_EXPIRES_IN = "7d"; // token sống 7 ngày

// Request đã gắn thông tin người dùng sau khi xác thực
export interface AuthRequest extends Request {
  userId?: string; // id của chính người đang đăng nhập
  ownerId?: string; // id CHỦ SHOP — mọi dữ liệu đều thuộc về chủ shop.
  // Với Admin: ownerId = userId. Với Staff: ownerId = id của chủ shop.
  userRole?: Role;
  // Quản trị NỀN TẢNG Hubsell (cờ trên User, không thuộc enum Role) — chỉ dùng
  // để gác nhóm API /api/admin, không ảnh hưởng phân quyền dữ liệu shop.
  isPlatformAdmin?: boolean;
  // Phạm vi gian hàng: null = xem TẤT CẢ; mảng = chỉ các gian này (kể cả mảng rỗng).
  // ADMIN và WAREHOUSE luôn null; SALES luôn là mảng.
  allowedChannelIds?: string[] | null;
}

/**
 * Vai trò nào được xem số liệu tài chính (giá vốn, lợi nhuận, chi phí vận hành).
 * Chỉ chủ shop. SALES thấy doanh thu nhưng không thấy lãi; WAREHOUSE không thấy gì.
 */
export function canSeeFinancials(role?: Role): boolean {
  return role === Role.ADMIN;
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
      select: { id: true, role: true, ownerId: true, isPlatformAdmin: true },
    });
    if (!user) {
      res.status(401).json({ error: "Tài khoản không còn tồn tại" });
      return;
    }

    req.userId = user.id;
    req.ownerId = user.ownerId ?? user.id; // Nhân viên dùng chung dữ liệu của chủ shop
    req.userRole = user.role;
    req.isPlatformAdmin = user.isPlatformAdmin;

    // PHẠM VI GIAN HÀNG THEO VAI TRÒ:
    // - ADMIN     : toàn bộ gian hàng của shop
    // - WAREHOUSE : cũng toàn bộ — kho phải nhặt hàng cho đơn của mọi gian
    // - SALES     : đúng những gian được phân công. Chưa phân công gian nào thì
    //   chưa thấy đơn nào; mở sẵn toàn shop cho một tài khoản chưa cấu hình là
    //   mặc định nguy hiểm, thà để trống rồi báo chủ shop đi phân công.
    if (user.role === Role.SALES) {
      const perms = await prisma.staffChannel.findMany({
        where: { staffId: user.id },
        select: { channelId: true },
      });
      req.allowedChannelIds = perms.map((p) => p.channelId);
    } else {
      req.allowedChannelIds = null;
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
  if (req.userRole !== Role.ADMIN) {
    res.status(403).json({ error: "Bạn không có quyền truy cập" });
    return;
  }
  next();
}

// Middleware: chỉ cho phép QUẢN TRỊ NỀN TẢNG (cờ isPlatformAdmin) đi tiếp.
// Trả 403 y hệt các chặn quyền khác — không tiết lộ khu /admin tồn tại.
export function requirePlatformAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.isPlatformAdmin) {
    res.status(403).json({ error: "Bạn không có quyền truy cập" });
    return;
  }
  next();
}

/**
 * Middleware: chỉ cho phép các vai trò được liệt kê đi tiếp.
 * Dùng để chặn nguyên một nhóm API theo vai trò ngay từ tầng định tuyến, thay vì
 * rải câu lệnh kiểm tra vai trò trong từng controller rồi bỏ sót một chỗ.
 */
export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({ error: "Bạn không có quyền truy cập" });
      return;
    }
    next();
  };
}
