// ============================================================
// SỔ CÁI VÍ TIKTOK — TEST HÀM THUẦN (không API, không DB), 23/10/2026
//
// Luật dấu của tiktokWalletDelta (docs Get Seller Financial Transactions):
//   SETTLE/REWARD/REVERSE +|a| · WITHDRAW/PAYMENT −|a| (CLOSED = 0) ·
//   TRANSFER giữ dấu · POLICY_VIOLATION_DEDUCTION −|a| · REFUND/UNKNOWN 0.
// Mốc đọc: lượt đầu = ủy quyền − 90 ngày; lượt sau = min(dòng mới nhất − 2 ngày,
// dòng chưa chốt cũ nhất), không lùi quá mốc lượt đầu.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  TIKTOK_WALLET_DAYS_BEFORE_AUTH,
  isTiktokBankTransfer,
  mapTiktokWithdrawalStatus,
  summarizeTiktokWalletRows,
  tiktokWalletBalance,
  tiktokWalletDelta,
  tiktokWalletRawSum,
  tiktokWalletReadFrom,
} from "../tiktok/wallet";
import { SETTLE_BACKFILL_FLOOR } from "../tiktok/service";

const row = (type: string, amount: number, status = "SUCCESS") => ({ type, status, amount });

describe("tiktokWalletDelta", () => {
  it("tiền vào ví: SETTLE / REWARD / REVERSE cộng trị tuyệt đối", () => {
    expect(tiktokWalletDelta(row("SETTLE", 1_000_000))).toBe(1_000_000);
    expect(tiktokWalletDelta(row("REWARD", 50_000))).toBe(50_000);
    expect(tiktokWalletDelta(row("REVERSE", -200_000, "PROCESSED"))).toBe(200_000);
  });

  it("tiền rời ví: WITHDRAW / PAYMENT trừ mọi trạng thái trừ CLOSED", () => {
    expect(tiktokWalletDelta(row("WITHDRAW", 300_000, "PROCESSING"))).toBe(-300_000);
    expect(tiktokWalletDelta(row("PAYMENT", 300_000, "PROCESSED"))).toBe(-300_000);
    // FAILED vẫn trừ: docs nói rút hỏng sinh dòng REVERSE riêng cộng lại.
    expect(tiktokWalletDelta(row("WITHDRAW", 300_000, "FAILED"))).toBe(-300_000);
    expect(tiktokWalletDelta(row("WITHDRAW", 300_000, "CLOSED"))).toBe(0);
  });

  it("TRANSFER giữ dấu sàn, khấu trừ vi phạm luôn âm, REFUND/UNKNOWN = 0", () => {
    expect(tiktokWalletDelta(row("TRANSFER", 80_000))).toBe(80_000);
    expect(tiktokWalletDelta(row("TRANSFER", -80_000))).toBe(-80_000);
    expect(tiktokWalletDelta(row("POLICY_VIOLATION_DEDUCTION", 10_000))).toBe(-10_000);
    expect(tiktokWalletDelta(row("REFUND", 10_000))).toBe(0);
    expect(tiktokWalletDelta(row("UNKNOWN", 10_000))).toBe(0);
  });

  it("không phân biệt hoa thường, số lỗi = 0", () => {
    expect(tiktokWalletDelta(row("settle", 5))).toBe(5);
    expect(tiktokWalletDelta({ type: "SETTLE", status: "SUCCESS", amount: Number.NaN })).toBe(0);
  });
});

describe("tiktokWalletBalance", () => {
  const at = (r: ReturnType<typeof row>, day: number) => ({ ...r, createTime: Date.UTC(2026, 9, day) });

  it("rút hỏng: WITHDRAW FAILED + REVERSE = về 0 (không đếm đôi)", () => {
    const rows = [at(row("SETTLE", 1_000_000), 1), at(row("WITHDRAW", 1_000_000, "FAILED"), 2), at(row("REVERSE", 1_000_000), 3)];
    expect(tiktokWalletBalance(rows)).toBe(1_000_000);
    expect(tiktokWalletRawSum(rows)).toBe(1_000_000);
  });

  it("gian VN sàn tự chuyển: Σ SETTLE − Σ PAYMENT + TRANSFER", () => {
    const rows = [
      at(row("SETTLE", 2_500_000.5), 1),
      at(row("SETTLE", 1_000_000), 2),
      at(row("PAYMENT", 3_000_000, "PROCESSED"), 3),
      at(row("TRANSFER", -20_000), 4),
      at(row("REFUND", 999_999), 5),
    ];
    expect(tiktokWalletBalance(rows)).toBe(480_000.5);
    expect(tiktokWalletBalance([])).toBe(0);
  });

  it("đầu cửa sổ còn tiền: lệnh rút vượt Σ SETTLE → coi ví cạn tại đáy, không âm (prod 23/10: Samca −128k)", () => {
    // Ngày 1 rút 9,45tr (gồm tiền cộng trước cửa sổ), sau đó cộng dần 9,21tr + trợ cấp 111k.
    const rows = [
      at(row("WITHDRAW", 9_452_854, "SUCCESS"), 1),
      at(row("SETTLE", 9_213_747), 10),
      at(row("TRANSFER", 111_200), 20),
    ];
    expect(tiktokWalletRawSum(rows)).toBe(-127_907);
    expect(tiktokWalletBalance(rows)).toBe(9_324_947);
  });

  it("rút cạn giữa cửa sổ: số dư = tiền cộng sau lần rút cạn", () => {
    const rows = [
      at(row("SETTLE", 500_000), 1),
      at(row("SETTLE", 700_000), 2),
      at(row("WITHDRAW", 1_200_000, "SUCCESS"), 3),
      at(row("SETTLE", 300_000), 4),
      at(row("WITHDRAW", 1_300_000, "SUCCESS"), 5), // rút nhiều hơn số có → đáy −1tr
      at(row("SETTLE", 250_000), 6),
    ];
    expect(tiktokWalletBalance(rows)).toBe(250_000);
  });

  it("cùng thời điểm: tiền vào tính trước tiền ra, không tạo đáy giả", () => {
    const rows = [at(row("WITHDRAW", 400_000, "SUCCESS"), 1), at(row("SETTLE", 400_000), 1)];
    expect(tiktokWalletBalance(rows)).toBe(0);
    // Thiếu createTime → coi như cùng lúc, vẫn vào trước ra.
    expect(tiktokWalletBalance([row("WITHDRAW", 400_000), row("SETTLE", 400_000)])).toBe(0);
  });
});

describe("mapTiktokWithdrawalStatus / isTiktokBankTransfer", () => {
  it("map trạng thái sàn → SUCCESS / PENDING / FAILED của WalletWithdrawal", () => {
    expect(mapTiktokWithdrawalStatus("PROCESSED")).toBe("SUCCESS");
    expect(mapTiktokWithdrawalStatus("success")).toBe("SUCCESS");
    expect(mapTiktokWithdrawalStatus("PROCESSING")).toBe("PENDING");
    expect(mapTiktokWithdrawalStatus("INIT")).toBe("PENDING");
    expect(mapTiktokWithdrawalStatus("FAILED")).toBe("FAILED");
    expect(mapTiktokWithdrawalStatus("REVERSED")).toBe("FAILED");
    expect(mapTiktokWithdrawalStatus("UNKNOWN")).toBe("PENDING");
  });

  it("chỉ WITHDRAW và PAYMENT là tiền về ngân hàng", () => {
    expect(isTiktokBankTransfer("WITHDRAW")).toBe(true);
    expect(isTiktokBankTransfer("PAYMENT")).toBe(true);
    expect(isTiktokBankTransfer("SETTLE")).toBe(false);
  });
});

describe("tiktokWalletReadFrom", () => {
  const DAY = 86_400;
  const auth = new Date("2026-10-01T00:00:00Z");
  const authSec = auth.getTime() / 1000;
  const created = new Date("2026-10-02T00:00:00Z");

  it("lượt đầu: ủy quyền − 90 ngày", () => {
    const from = tiktokWalletReadFrom({ authorizedAt: auth, createdAt: created, latestStoredAt: null, oldestOpenAt: null });
    expect(from).toBe(authSec - TIKTOK_WALLET_DAYS_BEFORE_AUTH * DAY);
  });

  it("không có ngày ủy quyền thì lấy ngày tạo gian; không sớm hơn SETTLE_BACKFILL_FLOOR", () => {
    const from = tiktokWalletReadFrom({ authorizedAt: null, createdAt: created, latestStoredAt: null, oldestOpenAt: null });
    expect(from).toBe(created.getTime() / 1000 - 90 * DAY);
    const old = tiktokWalletReadFrom({
      authorizedAt: new Date("2024-01-01T00:00:00Z"),
      createdAt: created,
      latestStoredAt: null,
      oldestOpenAt: null,
    });
    expect(old).toBe(SETTLE_BACKFILL_FLOOR);
  });

  it("lượt sau: dòng mới nhất − 2 ngày, kéo về dòng chưa chốt cũ hơn, không lùi quá mốc đầu", () => {
    const latest = new Date("2026-10-20T00:00:00Z");
    const base = tiktokWalletReadFrom({ authorizedAt: auth, createdAt: created, latestStoredAt: latest, oldestOpenAt: null });
    expect(base).toBe(latest.getTime() / 1000 - 2 * DAY);
    const open = new Date("2026-10-10T00:00:00Z");
    const withOpen = tiktokWalletReadFrom({ authorizedAt: auth, createdAt: created, latestStoredAt: latest, oldestOpenAt: open });
    expect(withOpen).toBe(open.getTime() / 1000);
    const tooOld = tiktokWalletReadFrom({
      authorizedAt: auth,
      createdAt: created,
      latestStoredAt: latest,
      oldestOpenAt: new Date("2025-01-05T00:00:00Z"),
    });
    expect(tooOld).toBe(authSec - 90 * DAY);
  });
});

describe("summarizeTiktokWalletRows", () => {
  it("gom theo loại, sắp theo tên, tổng giữ dấu", () => {
    const s = summarizeTiktokWalletRows([row("SETTLE", 100), row("PAYMENT", 60), row("SETTLE", 50), row("TRANSFER", -5)]);
    expect(s).toBe("PAYMENT 1 dòng 60 · SETTLE 2 dòng 150 · TRANSFER 1 dòng -5");
  });
});
