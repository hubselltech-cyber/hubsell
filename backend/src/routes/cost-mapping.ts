// ============================================================
// TAB "MAPPING GIÁ VỐN" của trang Cấu hình Giá vốn — gắn vào routes/finance.ts
// dưới tiền tố /api/finance/cost-prices (quyền finance.cost-prices đã siết ở đó).
//
//   GET    /mapping/skus            mỗi MÃ SKU một dòng, gộp mọi gian + trạng thái đề xuất
//   POST   /mapping/fill-suggested  nút "Điền tất cả"
//   POST   /mapping/set-cost        nút "Áp dụng mọi gian" { codes[], costPrice }
//   GET    /rules                   bảng giá tự nhập + độ phủ
//   PUT    /rules                   thêm / sửa MỘT mã      { code, costPrice, label? }
//   DELETE /rules/:id
//   POST   /rules/import            nhập bảng giá từ Excel (cột: Mã | Giá vốn | Ghi chú)
//   POST   /rules/preview
//   POST   /rules/apply             { overwriteSkuIds? }
//
// Logic khớp mã + ghi giá nằm ở lib/cost-mapping.ts.
// ============================================================

import { Router, type Response } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import {
  applyRules,
  buildRulesPlan,
  countPlan,
  fillSuggested,
  listRulesWithCoverage,
  listSkuGroups,
  MappingInputError,
  normalizeSkuCode,
  setCostForCodes,
} from "../lib/cost-mapping";

const router = Router();

const MAX_RULE_ROWS = 5000;
/** Một lượt "Giá vốn chung" của cả mẫu — chặn payload khổng lồ. */
const MAX_CODES_PER_CALL = 500;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("Chỉ chấp nhận file Excel (.xlsx hoặc .xls)"));
  },
});

/** Số tiền từ body/Excel: chấp nhận 52000, "52000", "52.000", "52,000". */
function parseCost(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[.,\s₫đ]/gi, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readIdList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((x): x is string => typeof x === "string" && x !== "");
}

// ---------- Bảng giá tự nhập ----------

router.get("/rules", async (req: AuthRequest, res, next) => {
  try {
    res.json(await listRulesWithCoverage(req.ownerId!));
  } catch (err) {
    next(err);
  }
});

router.put("/rules", async (req: AuthRequest, res, next) => {
  try {
    const code = typeof req.body?.code === "string" ? normalizeSkuCode(req.body.code) : "";
    const cost = parseCost(req.body?.costPrice);
    const labelRaw = typeof req.body?.label === "string" ? req.body.label.trim() : "";
    if (!code) {
      res.status(400).json({ error: "Thiếu mã SKU hoặc mã mẫu" });
      return;
    }
    if (code.length > 100) {
      res.status(400).json({ error: "Mã quá dài (tối đa 100 ký tự)" });
      return;
    }
    if (cost === null) {
      res.status(400).json({ error: "Giá vốn phải là số lớn hơn 0" });
      return;
    }
    const label = labelRaw ? labelRaw.slice(0, 120) : null;

    const rule = await prisma.costPriceRule.upsert({
      where: { userId_code: { userId: req.ownerId!, code } },
      create: { userId: req.ownerId!, code, costPrice: cost, label },
      update: { costPrice: cost, label },
    });
    res.json({ id: rule.id, code: rule.code, costPrice: String(rule.costPrice), label: rule.label });
  } catch (err) {
    next(err);
  }
});

router.delete("/rules/:id", async (req: AuthRequest, res, next) => {
  try {
    const r = await prisma.costPriceRule.deleteMany({
      where: { id: req.params.id, userId: req.ownerId! },
    });
    if (r.count === 0) {
      res.status(404).json({ error: "Không tìm thấy mã này trong bảng giá" });
      return;
    }
    res.json({ deleted: r.count });
  } catch (err) {
    next(err);
  }
});

router.post("/rules/import", upload.single("file"), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Chưa chọn file Excel để tải lên" });
      return;
    }
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rows = sheetName
      ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
          defval: "",
        })
      : [];
    if (rows.length === 0) {
      res.status(400).json({ error: "File Excel không có dòng dữ liệu nào" });
      return;
    }
    if (rows.length > MAX_RULE_ROWS) {
      res.status(400).json({ error: `Tối đa ${MAX_RULE_ROWS} dòng mỗi file` });
      return;
    }

    const errors: { row: number; message: string }[] = [];
    // Dòng sau ghi đè dòng trước nếu trùng mã.
    const wanted = new Map<string, { cost: number; label: string | null }>();
    rows.forEach((row, idx) => {
      const excelRow = idx + 2; // +1 header, +1 đếm từ 1
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          const found = Object.keys(row).find(
            (rk) => rk.trim().toLowerCase() === k.toLowerCase()
          );
          if (found && String(row[found]).trim() !== "") return String(row[found]).trim();
        }
        return "";
      };
      const code = normalizeSkuCode(pick("Mã", "Mã SKU", "Mã mẫu", "MaSKU", "SKU", "code"));
      const rawCost = pick("Giá vốn", "GiaVon", "cost_price", "costPrice");
      const label = pick("Ghi chú", "Tên", "Tên sản phẩm", "label");
      if (!code) {
        errors.push({ row: excelRow, message: "Thiếu mã" });
        return;
      }
      const cost = parseCost(rawCost);
      if (cost === null) {
        // File xuất từ trang Giá vốn có sẵn các dòng giá 0 — bỏ qua im lặng thì
        // chủ shop tưởng đã nhập; báo theo dòng để biết dòng nào chưa có giá.
        errors.push({ row: excelRow, message: `Giá vốn không hợp lệ ("${rawCost}")` });
        return;
      }
      wanted.set(code, { cost, label: label ? label.slice(0, 120) : null });
    });

    if (wanted.size === 0) {
      res.status(400).json({ error: "Không có dòng nào hợp lệ trong file", errors });
      return;
    }

    // Thay trọn các mã có trong file bằng hai lệnh, không upsert từng dòng.
    const ownerId = req.ownerId!;
    const codes = [...wanted.keys()];
    await prisma.$transaction([
      prisma.costPriceRule.deleteMany({ where: { userId: ownerId, code: { in: codes } } }),
      prisma.costPriceRule.createMany({
        data: codes.map((code) => ({
          userId: ownerId,
          code,
          costPrice: wanted.get(code)!.cost,
          label: wanted.get(code)!.label,
        })),
      }),
    ]);

    res.json({ saved: codes.length, totalRows: rows.length, errors });
  } catch (err) {
    next(err);
  }
});

function sendMappingError(err: unknown, res: Response): boolean {
  if (err instanceof MappingInputError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

router.post("/rules/preview", async (req: AuthRequest, res, next) => {
  try {
    const plan = await buildRulesPlan(req.ownerId!);
    res.json({
      counts: countPlan(plan),
      // Dòng "same" không cần ai nhìn — chỉ trả những gì sẽ đổi hoặc cần quyết.
      rows: plan.rows.filter((r) => r.status !== "same"),
      unmatched: plan.unmatched,
    });
  } catch (err) {
    if (!sendMappingError(err, res)) next(err);
  }
});

router.post("/rules/apply", async (req: AuthRequest, res, next) => {
  try {
    res.json(await applyRules(req.ownerId!, readIdList(req.body?.overwriteSkuIds) ?? []));
  } catch (err) {
    if (!sendMappingError(err, res)) next(err);
  }
});

// ---------- Gộp theo mã SKU: đề xuất + đặt giá một lần cho mọi gian ----------

router.get("/mapping/skus", async (req: AuthRequest, res, next) => {
  try {
    res.json(await listSkuGroups(req.ownerId!));
  } catch (err) {
    next(err);
  }
});

router.post("/mapping/fill-suggested", async (req: AuthRequest, res, next) => {
  try {
    res.json(await fillSuggested(req.ownerId!));
  } catch (err) {
    next(err);
  }
});

router.post("/mapping/set-cost", async (req: AuthRequest, res, next) => {
  try {
    const codes = readIdList(req.body?.codes) ?? [];
    const cost = parseCost(req.body?.costPrice);
    if (codes.length === 0) {
      res.status(400).json({ error: "Thiếu mã SKU" });
      return;
    }
    if (codes.length > MAX_CODES_PER_CALL) {
      res.status(400).json({ error: `Tối đa ${MAX_CODES_PER_CALL} mã mỗi lần áp dụng` });
      return;
    }
    if (cost === null) {
      res.status(400).json({ error: "Giá vốn phải là số lớn hơn 0" });
      return;
    }
    res.json(await setCostForCodes(req.ownerId!, codes, cost));
  } catch (err) {
    if (!sendMappingError(err, res)) next(err);
  }
});

export default router;
