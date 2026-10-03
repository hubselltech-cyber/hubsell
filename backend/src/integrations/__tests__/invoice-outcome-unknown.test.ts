import { InvoiceLogStatus } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// ADAPTER BÁO RÕ "CHƯA RÕ KẾT QUẢ" — hóa đơn bước 5, lát 5 (02/10/2026).
//
// Lệnh phát hành đã gửi sang nhà cung cấp mà không có câu trả lời rõ "đã lập" hay
// "từ chối" thì adapter phải nói đúng như vậy (InvoiceResult.outcomeUnknown), không
// nói "hỏng" trơn và càng không nói "đã phát hành":
//   1. Đứt mạng lúc gửi lệnh, đứt giữa lúc đọc câu trả lời, HTTP 5xx / 408.
//   2. Trả lời thành công mà không kèm số hóa đơn lẫn mã tra cứu.
//   3. Mã lỗi "không rõ nguyên nhân" của MISA (Exception, CreateInvoiceDataError).
//   4. Báo trùng mã mà tra ngược chưa ra số.
// Đối chứng (KHÔNG được gắn cờ): lỗi ở bước lấy token (lệnh chưa gửi), MISA từ chối
// có mã rõ, tờ trùng đã bị xóa bên MISA, và ca phát hành bình thường.
//
// Không gọi mạng: fetch toàn cục, hàm lấy token và hàm tra trạng thái là hàm giả;
// publishStandardInvoice chạy THẬT để kiểm đúng chỗ phân loại lỗi.
// ============================================================

const { tokenMock, statusMock } = vi.hoisted(() => ({
  tokenMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("../invoice/misa-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-auth")>();
  return { ...actual, getMisaAccessToken: tokenMock };
});

vi.mock("../invoice/misa-einvoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-einvoice")>();
  return { ...actual, getInvoiceStatuses: statusMock };
});

import { InvoiceProviderError, isPublishOutcomeUnknown } from "../invoice/invoice-errors";
import { MisaInvoiceProvider, type MisaProviderConfig } from "../invoice/misa-provider";
import type { CreateInvoiceInput } from "../invoice/types";

const CFG: MisaProviderConfig = {
  taxCode: "0101243150-732",
  companyName: "Shop test",
  companyAddress: "HN",
  clientId: null,
  secretKey: null,
  meinvoiceUsername: "u",
  meinvoicePassword: "p",
  invoicePattern: "1",
  invoiceSeries: "1C26TAA",
  defaultUnitName: "Cái",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
  defaultInvoiceType: "STANDARD",
};

const INPUT: CreateInvoiceInput = {
  orderCode: "DH-CHUA-RO-001",
  buyerName: "Bán cho người tiêu dùng",
  lines: [
    { name: "Áo", sku: "A1", quantity: 1, unitPrice: 10_000, vatRate: 10, amountWithoutVat: 10_000, vatAmount: 1_000 },
  ],
  totalAmount: 11_000,
};

const fetchMock = vi.fn();
const savedSwitch = process.env.MISA_ALLOW_PUBLISH;

/** Câu trả lời giả của MISA cho lệnh phát hành. */
const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const published = (item: Record<string, unknown>) => reply(200, { Success: true, publishInvoiceResult: [item] });
const statusItem = (over: Record<string, unknown> = {}) => ({
  transactionId: "TX1",
  publishStatus: 1,
  sendTaxStatus: null,
  isDeleted: false,
  invoiceNo: "00000131",
  raw: {},
  ...over,
});

const create = () => new MisaInvoiceProvider(CFG).createInvoice(INPUT);

function expectUnknown(r: Awaited<ReturnType<typeof create>>) {
  expect(r.status).toBe(InvoiceLogStatus.FAILED);
  expect(r.outcomeUnknown).toBe(true);
  expect(r.invoiceNo).toBeUndefined();
  expect(r.transactionId).toBeUndefined();
}

beforeAll(() => {
  process.env.MISA_ALLOW_PUBLISH = "1";
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  if (savedSwitch === undefined) delete process.env.MISA_ALLOW_PUBLISH;
  else process.env.MISA_ALLOW_PUBLISH = savedSwitch;
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchMock.mockReset();
  statusMock.mockReset();
  tokenMock.mockReset();
  tokenMock.mockResolvedValue("token-gia");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Lệnh đã gửi mà không có câu trả lời rõ → CHƯA RÕ KẾT QUẢ", () => {
  it("đứt mạng ngay lúc gửi lệnh phát hành", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const r = await create();
    expectUnknown(r);
    expect(r.errorScope).toBe("TRANSIENT");
    expect(r.errorCode).toBe("HUBSELL_OUTCOME_UNKNOWN");
    expect(r.errorMessage).toContain("Chưa rõ hóa đơn này đã lập hay chưa");
    expect(r.errorMessage).toContain("ĐỪNG lập tay");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([500, 502, 503, 504, 408])("máy chủ nhà cung cấp trả HTTP %i", async (status) => {
    fetchMock.mockResolvedValue(reply(status, "<html>Bad Gateway</html>"));
    const r = await create();
    expectUnknown(r);
    expect(r.errorMessage).toContain(`HTTP ${status}`);
  });

  it("đứt giữa lúc đọc câu trả lời (trước 02/10 bị xếp là lỗi của riêng đơn)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => Promise.reject(new Error("terminated")) });
    const r = await create();
    expectUnknown(r);
    expect(r.errorScope).toBe("TRANSIENT");
  });

  it.each([
    ["danh sách kết quả rỗng", { Success: true, publishInvoiceResult: [] }],
    ["không có khối kết quả", { Success: true }],
    ["thân không phải JSON", "OK"],
    ["phần tử kết quả không có số lẫn mã", { Success: true, publishInvoiceResult: [{ ErrorCode: null }] }],
    ["chỉ nhắc lại mã tham chiếu Hubsell gửi", { Success: true, publishInvoiceResult: [{ RefID: INPUT.orderCode }] }],
  ])("trả lời thành công nhưng %s → KHÔNG ghi đã phát hành", async (_label, body) => {
    fetchMock.mockResolvedValue(reply(200, body));
    const r = await create();
    expectUnknown(r);
    expect(r.errorMessage).toContain("không kèm số hóa đơn và mã tra cứu");
  });

  it.each(["Exception", "CreateInvoiceDataError"])("mã lỗi không rõ nguyên nhân của MISA: %s", async (code) => {
    fetchMock.mockResolvedValue(published({ ErrorCode: code }));
    expectUnknown(await create());
    fetchMock.mockResolvedValue(reply(200, { Success: false, ErrorCode: code }));
    expectUnknown(await create());
  });

  it("lượt đầu bị từ chối vì lệch số, lượt thử lại đứt mạng → chưa rõ theo lượt sau cùng", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(published({ ErrorCode: "InvoiceNumberNotCotinuous" }))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = create();
    await vi.advanceTimersByTimeAsync(2_100);
    expectUnknown(await pending);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("MISA báo trùng mã tham chiếu", () => {
  const duplicate = () => fetchMock.mockResolvedValue(published({ ErrorCode: "DuplicateInvoiceRefID" }));

  it("tra ngược thấy tờ đã lập → nối lại số, là ĐÃ PHÁT HÀNH (như trước)", async () => {
    duplicate();
    statusMock.mockResolvedValue([statusItem()]);
    const r = await create();
    expect(r).toMatchObject({ status: InvoiceLogStatus.ISSUED, invoiceNo: "00000131", transactionId: "TX1" });
    expect(r.outcomeUnknown).toBeUndefined();
  });

  it.each([
    ["không tra được", () => statusMock.mockRejectedValue(new Error("ECONNRESET"))],
    ["tra chưa thấy", () => statusMock.mockResolvedValue([])],
    ["tờ chưa phát hành xong", () => statusMock.mockResolvedValue([statusItem({ publishStatus: 0 })])],
    ["tờ thiếu số hóa đơn", () => statusMock.mockResolvedValue([statusItem({ invoiceNo: null })])],
  ])("%s → giữ thông điệp lỗi trùng, gắn cờ chưa rõ", async (_label, arrange) => {
    duplicate();
    arrange();
    const r = await create();
    expectUnknown(r);
    expect(r.errorCode).toBe("DuplicateInvoiceRefID");
    expect(r.errorMessage).toContain("ĐÃ CÓ hóa đơn cho mã đơn này");
  });

  it("tờ trùng đã bị xóa bên MISA → đã có kết luận, KHÔNG gắn cờ", async () => {
    duplicate();
    statusMock.mockResolvedValue([statusItem({ isDeleted: true })]);
    const r = await create();
    expect(r.status).toBe(InvoiceLogStatus.FAILED);
    expect(r.errorCode).toBe("DuplicateInvoiceRefID");
    expect(r.outcomeUnknown).toBeUndefined();
  });
});

describe("Đối chứng: đã có kết luận thì KHÔNG gắn cờ", () => {
  it("lỗi mạng ở bước lấy token: lệnh phát hành chưa hề được gửi", async () => {
    tokenMock.mockRejectedValue(new InvoiceProviderError("Không gọi được endpoint auth", { network: true }));
    const r = await create();
    expect(r.status).toBe(InvoiceLogStatus.FAILED);
    expect(r.errorScope).toBe("TRANSIENT");
    expect(r.outcomeUnknown).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP 400 kèm mã lỗi", reply(400, { Success: false, ErrorCode: "InvoiceTemplateNotExist" })],
    ["HTTP 401", reply(401, { Success: false, ErrorCode: "InvalidTokenCode" })],
    ["HTTP 429", reply(429, "Too Many Requests")],
    ["Success=false kèm mã lỗi", reply(200, { Success: false, ErrorCode: "InvoicePublishNotExist" })],
    ["mã lỗi của riêng hóa đơn", published({ ErrorCode: "Invalid_[InvoiceDetail.VATRateName]" })],
  ])("MISA từ chối rõ ràng: %s", async (_label, res) => {
    fetchMock.mockResolvedValue(res);
    const r = await create();
    expect(r.status).toBe(InvoiceLogStatus.FAILED);
    expect(r.outcomeUnknown).toBeUndefined();
    expect(r.errorCode).not.toBe("HUBSELL_OUTCOME_UNKNOWN");
  });

  it("phát hành bình thường: có số hóa đơn và mã tra cứu", async () => {
    fetchMock.mockResolvedValue(published({ ErrorCode: null, InvNo: "00000140", TransactionID: "TX-OK" }));
    const r = await create();
    expect(r).toMatchObject({ status: InvoiceLogStatus.ISSUED, invoiceNo: "00000140", transactionId: "TX-OK", vatAmount: 1_000 });
    expect(r.outcomeUnknown).toBeUndefined();
  });

  it.each([
    ["chỉ có mã tra cứu", { TransactionID: "TX-ONLY" }],
    ["chỉ có số hóa đơn", { InvNo: "00000141" }],
  ])("có một trong hai (%s) vẫn là đã phát hành, như trước", async (_label, item) => {
    fetchMock.mockResolvedValue(published(item));
    const r = await create();
    expect(r.status).toBe(InvoiceLogStatus.ISSUED);
    expect(r.outcomeUnknown).toBeUndefined();
  });
});

describe("isPublishOutcomeUnknown", () => {
  it("chỉ đúng khi lệnh phát hành đã gửi", () => {
    expect(isPublishOutcomeUnknown(new Error("thiếu cấu hình"))).toBe(false);
    expect(isPublishOutcomeUnknown(new InvoiceProviderError("x", { network: true }))).toBe(false);
    expect(isPublishOutcomeUnknown(new InvoiceProviderError("x", { httpStatus: 502 }))).toBe(false);
    expect(isPublishOutcomeUnknown(new InvoiceProviderError("x", { network: true, publishSent: true }))).toBe(true);
    expect(isPublishOutcomeUnknown(new InvoiceProviderError("x", { httpStatus: 502, publishSent: true }))).toBe(true);
    expect(isPublishOutcomeUnknown(new InvoiceProviderError("x", { httpStatus: 400, publishSent: true }))).toBe(false);
    // 429: NCC từ chối trước khi xử lý, chắc chắn chưa lập tờ nào.
    expect(isPublishOutcomeUnknown(new InvoiceProviderError("x", { httpStatus: 429, publishSent: true }))).toBe(false);
    expect(isPublishOutcomeUnknown(new InvoiceProviderError("x", { code: "Exception", publishSent: true }))).toBe(true);
    expect(isPublishOutcomeUnknown(new InvoiceProviderError("x", { code: "InvoiceDuplicated", publishSent: true }))).toBe(false);
  });
});
