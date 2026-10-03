// ============================================================
// HỎI TRẠNG THÁI CƠ QUAN THUẾ QUA ADAPTER — bước 5, lát 12 (03/10/2026). Phần KHÔNG cần
// database: luật giờ hỏi kế tiếp, kế hoạch áp kết quả, công tắc, và adapter MISA hỏi
// theo lô (hàm gọi MISA được thay bằng hàm giả theo đúng hành vi sandbox 03/10:
// khai lệch loại ký hiệu thì trả 0 dòng, mã không tồn tại bị bỏ qua im lặng).
// ============================================================
import "./load-env";
import { InvoiceLogStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }));

vi.mock("../invoice/misa-einvoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-einvoice")>();
  return { ...actual, getInvoiceStatuses: statusMock };
});

import { DEFAULT_INVOICE_CQT_MODE, invoiceCqtMode } from "../../lib/queue-config";
import {
  CQT_FIRST_CHECK_MS,
  CQT_RECHECK_OLD_MS,
  CQT_RECHECK_PENDING_MS,
  cqtNextOnWrite,
  nextCqtCheckAt,
  planFollow,
  statusSyncSource,
  type FollowLog,
} from "../invoice/cqt-follow";
import { seriesHasTaxCode } from "../invoice/cqt-status";
import { InvoiceProviderError } from "../invoice/invoice-errors";
import { MisaInvoiceProvider, type MisaProviderConfig } from "../invoice/misa-provider";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-03T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const baseLog = (over: Partial<FollowLog> = {}): FollowLog => ({
  id: "log1",
  ownerId: "owner1",
  orderId: "order1",
  orderCode: "DH-001",
  provider: "MISA",
  status: InvoiceLogStatus.ISSUED,
  cqtStatus: null,
  invoiceNo: "00000001",
  transactionId: "TX1",
  invoiceSeries: "1C26TAA",
  adjustmentForLogId: null,
  createdAt: ago(2 * HOUR),
  ...over,
});

describe("Giờ hỏi khi dòng vừa có mã tra cứu", () => {
  it("đang chờ / đã phát hành + có mã → 1 giờ sau mốc lập", () => {
    expect(cqtNextOnWrite(InvoiceLogStatus.ISSUED, "TX", NOW)?.getTime()).toBe(NOW.getTime() + CQT_FIRST_CHECK_MS);
    expect(cqtNextOnWrite(InvoiceLogStatus.PENDING, "TX", NOW)?.getTime()).toBe(NOW.getTime() + HOUR);
  });
  it("không có mã, hoặc dòng hỏng / đã hủy → không hỏi", () => {
    expect(cqtNextOnWrite(InvoiceLogStatus.ISSUED, null, NOW)).toBeNull();
    expect(cqtNextOnWrite(InvoiceLogStatus.PENDING, undefined, NOW)).toBeNull();
    expect(cqtNextOnWrite(InvoiceLogStatus.FAILED, "TX", NOW)).toBeNull();
    expect(cqtNextOnWrite(InvoiceLogStatus.CANCELLED, "TX", NOW)).toBeNull();
  });
});

describe("Giờ hỏi kế tiếp sau một lượt hỏi", () => {
  const next = (status: InvoiceLogStatus, cqtStatus: string | null, age: number) =>
    nextCqtCheckAt({ status, cqtStatus, createdAt: ago(age) }, NOW);
  const inMs = (d: Date | null) => (d ? d.getTime() - NOW.getTime() : null);

  it("chưa có kết luận, dưới 30 ngày → 12 giờ", () => {
    for (const cqt of [null, "WAITING", "SEND_ERROR", "REJECTED"]) {
      expect(inMs(next(InvoiceLogStatus.ISSUED, cqt, 3 * DAY))).toBe(CQT_RECHECK_PENDING_MS);
    }
    expect(inMs(next(InvoiceLogStatus.PENDING, null, HOUR))).toBe(12 * HOUR);
  });
  it("chưa có kết luận, quá 30 ngày → 24 giờ, không điểm dừng", () => {
    expect(inMs(next(InvoiceLogStatus.ISSUED, "WAITING", 31 * DAY))).toBe(CQT_RECHECK_OLD_MS);
    expect(inMs(next(InvoiceLogStatus.ISSUED, "REJECTED", 400 * DAY))).toBe(24 * HOUR);
    expect(inMs(next(InvoiceLogStatus.PENDING, null, 90 * DAY))).toBe(24 * HOUR);
  });
  it("đã tiếp nhận: mỗi ngày trong 7 ngày đầu, sau đó thôi", () => {
    expect(inMs(next(InvoiceLogStatus.ISSUED, "ACCEPTED", 2 * DAY))).toBe(24 * HOUR);
    expect(next(InvoiceLogStatus.ISSUED, "ACCEPTED", 7 * DAY + 1)).toBeNull();
  });
  it("tờ còn ĐANG CHỜ phát hành thì chưa coi là có kết luận dù cơ quan thuế đã tiếp nhận", () => {
    expect(inMs(next(InvoiceLogStatus.PENDING, "ACCEPTED", 10 * DAY))).toBe(12 * HOUR);
  });
  it("dòng hỏng / đã hủy → thôi", () => {
    expect(next(InvoiceLogStatus.FAILED, null, HOUR)).toBeNull();
    expect(next(InvoiceLogStatus.CANCELLED, "ACCEPTED", HOUR)).toBeNull();
  });
});

describe("Kế hoạch áp kết quả của nhà cung cấp", () => {
  const item = (over = {}) => ({ transactionId: "TX1", issued: true, deleted: false, invoiceNo: "00000001", taxStatus: null, ...over });

  it("nhà cung cấp không trả dòng → không suy diễn, chỉ hẹn hỏi lại", () => {
    const p = planFollow(baseLog({ cqtStatus: "WAITING" }), undefined, NOW);
    expect(p).toMatchObject({ changed: false, status: InvoiceLogStatus.ISSUED, cqtStatus: "WAITING", cancelled: false });
    expect(p.next?.getTime()).toBe(NOW.getTime() + 12 * HOUR);
  });
  it("tờ đã xóa bên nhà cung cấp → đã hủy, thôi hỏi", () => {
    const p = planFollow(baseLog(), item({ deleted: true }), NOW);
    expect(p).toMatchObject({ changed: true, cancelled: true, status: InvoiceLogStatus.CANCELLED, next: null });
  });
  it("đang chờ mà nhà cung cấp đã phát hành → đã phát hành, nhận số hóa đơn nếu dòng chưa có", () => {
    const p = planFollow(baseLog({ status: InvoiceLogStatus.PENDING, invoiceNo: null }), item({ invoiceNo: "00000077" }), NOW);
    expect(p).toMatchObject({ changed: true, issuedFixed: true, status: InvoiceLogStatus.ISSUED, invoiceNo: "00000077" });
  });
  it("số hóa đơn dòng đã có thì không bị ghi đè", () => {
    expect(planFollow(baseLog(), item({ invoiceNo: "99999999" }), NOW).invoiceNo).toBe("00000001");
  });
  it("trạng thái cơ quan thuế null → giữ giá trị cũ, không tính là đổi", () => {
    const p = planFollow(baseLog({ cqtStatus: "WAITING" }), item(), NOW);
    expect(p).toMatchObject({ changed: false, cqtStatus: "WAITING" });
  });
  it("bị từ chối: báo MỚI đúng một lần", () => {
    expect(planFollow(baseLog({ cqtStatus: "WAITING" }), item({ taxStatus: "REJECTED" }), NOW)).toMatchObject({
      changed: true,
      newlyRejected: true,
    });
    expect(planFollow(baseLog({ cqtStatus: "REJECTED" }), item({ taxStatus: "REJECTED" }), NOW)).toMatchObject({
      changed: false,
      newlyRejected: false,
    });
  });
  it("được tiếp nhận sau 7 ngày → ghi rồi thôi hỏi", () => {
    const p = planFollow(baseLog({ createdAt: ago(8 * DAY) }), item({ taxStatus: "ACCEPTED" }), NOW);
    expect(p).toMatchObject({ changed: true, cqtStatus: "ACCEPTED", next: null });
  });
});

describe("Công tắc và nhãn nguồn", () => {
  it("INVOICE_CQT_MODE: nhận follow / legacy, giá trị lạ rơi về mặc định", () => {
    expect(invoiceCqtMode({ INVOICE_CQT_MODE: "follow" })).toBe("follow");
    expect(invoiceCqtMode({ INVOICE_CQT_MODE: " LEGACY " })).toBe("legacy");
    expect(invoiceCqtMode({ INVOICE_CQT_MODE: "abc" })).toBe(DEFAULT_INVOICE_CQT_MODE);
    expect(invoiceCqtMode({})).toBe(DEFAULT_INVOICE_CQT_MODE);
  });
  it("nguồn ghi lịch sử của MISA giữ đúng giá trị vòng cũ đã ghi", () => {
    expect(statusSyncSource("MISA")).toBe("MISA_STATUS_SYNC");
  });
  it("ký hiệu có mã: nhận cả dạng 7 ký tự lẫn dạng 6 ký tự MISA trả", () => {
    expect(seriesHasTaxCode("1C26TAA")).toBe(true);
    expect(seriesHasTaxCode("C26TAA")).toBe(true);
    expect(seriesHasTaxCode("1K26TYY")).toBe(false);
    expect(seriesHasTaxCode("K26TYY")).toBe(false);
    expect(seriesHasTaxCode(null)).toBe(false);
  });
});

describe("Adapter MISA hỏi trạng thái theo lô", () => {
  const CFG: MisaProviderConfig = {
    taxCode: "0101243150-732",
    companyName: "Shop test",
    companyAddress: "HN",
    clientId: null,
    secretKey: null,
    meinvoiceUsername: "u",
    meinvoicePassword: "p",
    invoicePattern: "1",
    invoiceSeries: "1K26TYY",
    defaultUnitName: "Cái",
    signMethod: "ESIGN_CLOUD",
    esignClientId: null,
    esignSecretKey: null,
    esignUsername: null,
    esignPassword: null,
    certSerial: null,
    defaultInvoiceType: "STANDARD",
  };
  /** "Sổ" MISA giả: mã tra cứu → loại ký hiệu thật + trạng thái. Khai lệch loại thì không trả dòng. */
  const book = new Map<string, { withCode: boolean; sendTaxStatus: number | null; publishStatus?: number; isDeleted?: boolean }>();
  const calls: { ids: string[]; withCode: boolean }[] = [];

  beforeEach(() => {
    book.clear();
    calls.length = 0;
    statusMock.mockReset();
    statusMock.mockImplementation(async (ids: string[], _cfg: unknown, _by: string, withCode: boolean) => {
      calls.push({ ids, withCode });
      return ids
        .filter((id) => book.get(id)?.withCode === withCode)
        .map((id) => ({
          transactionId: id,
          publishStatus: book.get(id)!.publishStatus ?? 1,
          sendTaxStatus: book.get(id)!.sendTaxStatus,
          isDeleted: book.get(id)!.isDeleted ?? false,
          invoiceNo: "00000050",
          raw: {},
        }));
    });
  });

  it("tách lô theo ký hiệu của TỪNG tờ; bảng mã đọc theo loại ký hiệu", async () => {
    book.set("C1", { withCode: true, sendTaxStatus: 2 });
    book.set("K1", { withCode: false, sendTaxStatus: 1 });
    book.set("K2", { withCode: false, sendTaxStatus: 2 });
    const res = await new MisaInvoiceProvider(CFG).checkStatuses([
      { transactionId: "C1", invoiceSeries: "1C26TAA" },
      { transactionId: "K1", invoiceSeries: "1K26TYY" },
      { transactionId: "K2", invoiceSeries: null }, // thiếu ký hiệu → theo ký hiệu đang cấu hình (không mã)
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toEqual([
      { ids: ["C1"], withCode: true },
      { ids: ["K1", "K2"], withCode: false },
    ]);
    expect(res.found.get("C1")).toMatchObject({ issued: true, deleted: false, taxStatus: "ACCEPTED" });
    expect(res.found.get("K1")?.taxStatus).toBe("WAITING"); // không mã: 1 = đã gửi
    expect(res.found.get("K2")?.taxStatus).toBe("ACCEPTED");
  });

  it("tờ không có dòng trả về được hỏi lại MỘT lần với loại ngược lại", async () => {
    book.set("X1", { withCode: true, sendTaxStatus: 3 }); // Hubsell tưởng là không mã
    const res = await new MisaInvoiceProvider(CFG).checkStatuses([{ transactionId: "X1", invoiceSeries: "1K26TYY" }]);
    expect(calls).toEqual([
      { ids: ["X1"], withCode: false },
      { ids: ["X1"], withCode: true },
    ]);
    expect(res.ok && res.found.get("X1")?.taxStatus).toBe("REJECTED"); // đọc theo bảng CÓ MÃ
  });

  it("mã không tồn tại: hỏi đủ hai loại rồi thôi, lô không hỏng, không có dòng", async () => {
    book.set("K1", { withCode: false, sendTaxStatus: 2 });
    const res = await new MisaInvoiceProvider(CFG).checkStatuses([
      { transactionId: "K1", invoiceSeries: "1K26TYY" },
      { transactionId: "MA-LA", invoiceSeries: "1K26TYY" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([...res.found.keys()]).toEqual(["K1"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ ids: ["MA-LA"], withCode: true });
  });

  it("tờ đã xóa / chưa phát hành xong được báo đúng; mã lặp chỉ gửi một lần", async () => {
    book.set("K1", { withCode: false, sendTaxStatus: 0, publishStatus: 0 });
    book.set("K2", { withCode: false, sendTaxStatus: null, isDeleted: true });
    const res = await new MisaInvoiceProvider(CFG).checkStatuses([
      { transactionId: "K1", invoiceSeries: "1K26TYY" },
      { transactionId: "K1", invoiceSeries: "1K26TYY" },
      { transactionId: "K2", invoiceSeries: "1K26TYY" },
    ]);
    expect(calls[0].ids).toEqual(["K1", "K2"]);
    expect(res.ok && res.found.get("K1")).toMatchObject({ issued: false, taxStatus: "WAITING" });
    expect(res.ok && res.found.get("K2")).toMatchObject({ deleted: true, taxStatus: null });
  });

  it("MISA lỗi → ok:false, không ném; lỗi mạng là sự cố tạm", async () => {
    statusMock.mockRejectedValueOnce(new InvoiceProviderError("meInvoice không phản hồi", { network: true }));
    const res = await new MisaInvoiceProvider(CFG).checkStatuses([{ transactionId: "K1", invoiceSeries: "1K26TYY" }]);
    expect(res).toMatchObject({ ok: false, accountProblem: false });
    statusMock.mockRejectedValueOnce(new Error("lỗi lạ"));
    const res2 = await new MisaInvoiceProvider(CFG).checkStatuses([{ transactionId: "K1", invoiceSeries: "1K26TYY" }]);
    expect(res2).toMatchObject({ ok: false, message: "lỗi lạ", accountProblem: false });
  });
});
