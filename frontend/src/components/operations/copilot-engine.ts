import type {
  MockProductInfo,
  ProductVariant,
  StockSource,
} from "@/components/operations/mock-data";

/**
 * COPILOT ENGINE — SINH GỢI Ý TRẢ LỜI TỪ DỮ LIỆU SẢN PHẨM (PREVIEW)
 *
 * Mô phỏng phía client luồng sẽ chạy thật ở backend:
 *
 *   1. Hội thoại có productSku → buildInjectedContext() dựng KHỐI NGỮ CẢNH
 *      (size chart, chất liệu, tồn kho) — khi làm thật, khối này được nhét
 *      thẳng vào system prompt của LLM (Context Injection, KHÔNG function
 *      calling: 1 lượt gọi duy nhất, ngữ cảnh sản phẩm chỉ ~200 token).
 *   2. buildAiSuggestion() đóng vai LLM: đọc câu khách hỏi + ngữ cảnh và trả
 *      câu gợi ý. Bản mock dùng luật (regex bắt chiều cao/cân nặng/màu/size)
 *      nhưng HỢP ĐỒNG vào-ra giữ nguyên khi thay bằng gọi LLM thật — UI
 *      không phải sửa gì.
 *
 * Trả kèm `intent` để UI gắn badge "trả lời từ dữ liệu kho thật" — nhân viên
 * biết câu nào AI dựa số liệu, câu nào chỉ là xã giao.
 *
 * NGUỒN TỒN KHO (stockSource): mọi con số tồn engine nói với khách đều đọc
 * qua qtyOf() theo nguồn seller cấu hình (xem MOCK_STOCK_SOURCE_PREFERENCE).
 * Mặc định CHANNEL — tồn đang treo trên sàn — vì shop không đồng bộ kho mà
 * AI đọc kho vật lý sẽ báo "hết hàng" trong khi trên sàn khách vẫn mua được.
 */

export interface CopilotSuggestion {
  text: string;
  intent: "SIZE_ADVICE" | "STOCK_CHECK" | "GENERAL";
}

/** Câu hỏi mẫu để demo nhanh trên UI — bấm là giả lập khách nhắn. */
export const SAMPLE_QUESTIONS = [
  "Sản phẩm này size L cao 1m70 mặc vừa không?",
  "Shop ơi mã này còn hàng màu đen không?",
  "Mình cao 1m60 nặng 52kg thì mặc size gì?",
];

// ─── Khối ngữ cảnh nạp cho AI ────────────────────────────────────────────────

/** Số tồn của một biến thể theo nguồn seller đã chọn. */
function qtyOf(v: ProductVariant, source: StockSource): number {
  return source === "CHANNEL" ? v.channelStock : v.stockQuantity;
}

/**
 * Dựng đúng khối văn bản sẽ tiêm vào prompt LLM. Xuất ra UI (mục "Ngữ cảnh
 * AI đã nạp") để nhân viên và dev thấy AI đang "biết" những gì — đây cũng là
 * spec cho hàm buildPromptContext ở backend sau này. Số tồn ghi theo nguồn
 * đã chọn, chỗ nào lệch thì chú thêm số của nguồn kia để AI (và người đọc)
 * biết mà cẩn trọng.
 */
export function buildInjectedContext(
  product: MockProductInfo,
  source: StockSource
): string {
  const lines = [
    `SKU: ${product.sku} — ${product.name}`,
    `Chất liệu: ${product.material}`,
    `Bảo quản: ${product.care}`,
  ];
  if (product.sizeChart.length > 0) {
    lines.push(
      "Bảng size: " +
        product.sizeChart
          .map(
            (r) =>
              `${r.size} (cao ${r.heightCm[0]}–${r.heightCm[1]}cm, nặng ${r.weightKg[0]}–${r.weightKg[1]}kg)`
          )
          .join("; ")
    );
  }
  const sourceLabel =
    source === "CHANNEL" ? "tồn trên sàn" : "tồn kho vật lý";
  lines.push(
    `Tồn kho (nguồn tư vấn: ${sourceLabel}): ` +
      product.variants
        .map((v) => {
          const main = qtyOf(v, source);
          const other = qtyOf(v, source === "CHANNEL" ? "PHYSICAL" : "CHANNEL");
          const diff =
            main !== other
              ? ` (${source === "CHANNEL" ? "kho vật lý" : "trên sàn"}: ${other})`
              : "";
          return `${v.color}/${v.size}: ${main}${diff}`;
        })
        .join(", ")
  );
  return lines.join("\n");
}

// ─── Bắt tín hiệu trong câu khách hỏi ────────────────────────────────────────

/** "1m70" / "1m7" / "cao 170" / "170cm" → 170. Không bắt số trần (dễ nhầm mã đơn). */
function parseHeightCm(text: string): number | null {
  const t = text.toLowerCase();
  const m = t.match(/(\d)\s*m\s*(\d{1,2})/);
  if (m) {
    const tail = m[2].length === 1 ? Number(m[2]) * 10 : Number(m[2]);
    return Number(m[1]) * 100 + tail;
  }
  const cm = t.match(/(?:cao\s*(1[3-9]\d)\b|(1[3-9]\d)\s*cm)/);
  if (cm) return Number(cm[1] ?? cm[2]);
  return null;
}

/** "52kg" / "52 ký" → 52. */
function parseWeightKg(text: string): number | null {
  const m = text.toLowerCase().match(/(\d{2,3})\s*(?:kg|kí|ký|cân)/);
  return m ? Number(m[1]) : null;
}

/** Size khách nhắc tới ("size L…") — chỉ nhận size có trong bảng của SP. */
function parseAskedSize(text: string, product: MockProductInfo): string | null {
  const m = text.toLowerCase().match(/size\s*([a-z]{1,3}|\d{2,3})/i);
  if (!m) return null;
  const asked = m[1].toUpperCase();
  return product.sizeChart.some((r) => r.size === asked) ? asked : null;
}

/**
 * Màu khách nhắc tới, đối chiếu danh sách màu thật của SP. Câu nhắc NHIỀU màu
 * ("đổi từ màu hồng sang màu xanh") thì lấy màu đứng SAU CÙNG — tiếng Việt
 * màu khách muốn chốt luôn nằm cuối câu, lấy màu đầu là trả lời sai màu đích.
 */
function parseColor(text: string, product: MockProductInfo): string | null {
  const t = text.toLowerCase();
  const colors = [...new Set(product.variants.map((v) => v.color))];
  let found: string | null = null;
  let lastPos = -1;
  for (const c of colors) {
    const pos = t.lastIndexOf(c.toLowerCase());
    if (pos > lastPos) {
      lastPos = pos;
      found = c;
    }
  }
  return found;
}

// ─── Trợ giúp diễn đạt ───────────────────────────────────────────────────────

/** "Đen còn size M (18), L (22)" — chỉ liệt kê biến thể còn hàng theo nguồn. */
function describeStock(variants: ProductVariant[], source: StockSource): string {
  return variants
    .filter((v) => qtyOf(v, source) > 0)
    .map((v) => `${v.size} (${qtyOf(v, source)} cái)`)
    .join(", ");
}

/** Chấm điểm 1 dòng size với số đo khách — càng khớp càng thấp. */
function scoreRow(
  row: { heightCm: [number, number]; weightKg: [number, number] },
  h: number | null,
  w: number | null
): number {
  let score = 0;
  if (h !== null) {
    if (h < row.heightCm[0]) score += row.heightCm[0] - h;
    else if (h > row.heightCm[1]) score += h - row.heightCm[1];
  }
  if (w !== null) {
    if (w < row.weightKg[0]) score += row.weightKg[0] - w;
    else if (w > row.weightKg[1]) score += w - row.weightKg[1];
  }
  return score;
}

// ─── Hàm chính ───────────────────────────────────────────────────────────────

export function buildAiSuggestion(
  product: MockProductInfo | undefined,
  customerText: string,
  fallback: string,
  stockSource: StockSource
): CopilotSuggestion {
  if (!product) return { text: fallback, intent: "GENERAL" };

  const height = parseHeightCm(customerText);
  const weight = parseWeightKg(customerText);
  const askedSize = parseAskedSize(customerText, product);
  const color = parseColor(customerText, product);
  const lower = customerText.toLowerCase();
  const asksStock = /còn|hết|tồn/.test(lower);

  // ── Ý ĐỊNH 1: tư vấn size (có số đo + SP có bảng size) ──
  if ((height !== null || weight !== null) && product.sizeChart.length > 0) {
    // Khách chạm biên 2 size (khớp cả hai) → lấy size LỚN hơn: dòng sau trong
    // bảng. Số đo chạm trần size nhỏ mà tư vấn size nhỏ là dễ bị chê chật.
    let best = product.sizeChart[0];
    for (const row of product.sizeChart) {
      if (scoreRow(row, height, weight) <= scoreRow(best, height, weight))
        best = row;
    }
    const measure = [
      height !== null ? `chiều cao ${height}cm` : null,
      weight !== null ? `cân nặng ${weight}kg` : null,
    ]
      .filter(Boolean)
      .join(" và ");

    let sizeNote = "";
    if (askedSize && askedSize !== best.size) {
      const order = product.sizeChart.map((r) => r.size);
      const tighter = order.indexOf(askedSize) < order.indexOf(best.size);
      sizeNote = ` Size ${askedSize} bạn hỏi sẽ hơi ${tighter ? "ôm" : "rộng"} so với dáng người, shop khuyên chọn size ${best.size} nha.`;
    } else if (askedSize) {
      sizeNote = ` Size ${askedSize} bạn hỏi là chuẩn luôn ạ.`;
    }

    // Đọc tồn thật của size được tư vấn — tư vấn xong mà hết hàng là dở
    const inStock = product.variants.filter(
      (v) => v.size === best.size && qtyOf(v, stockSource) > 0
    );
    const stockNote =
      inStock.length > 0
        ? ` Size ${best.size} hiện còn ${inStock
            .map((v) => `màu ${v.color} (${qtyOf(v, stockSource)} cái)`)
            .join(", ")} — bạn chốt sớm kẻo hết nha!`
        : ` Size ${best.size} hiện tạm hết hàng, shop sẽ báo ngay khi hàng về ạ.`;

    return {
      text: `Dạ với ${measure}, bạn mặc size ${best.size} của ${product.name} là chuẩn form nhất ạ.${sizeNote} Chất liệu ${product.material} nên mặc rất thoải mái.${stockNote}`,
      intent: "SIZE_ADVICE",
    };
  }

  // ── Ý ĐỊNH 2: hỏi tồn kho / màu sắc ──
  if (asksStock || color) {
    const scope = color
      ? product.variants.filter((v) => v.color === color)
      : product.variants;
    const available = describeStock(scope, stockSource);
    const label = color ? `màu ${color}` : "sản phẩm";

    if (!available) {
      // Hết sạch phạm vi hỏi → gợi màu khác còn hàng thay vì chỉ nói "hết"
      const other = describeStock(
        product.variants.filter((v) => !color || v.color !== color),
        stockSource
      );
      return {
        text: `Dạ ${label} của ${product.name} hiện tạm hết hàng, dự kiến 3–5 ngày nữa về kho ạ.${other ? ` Trong lúc chờ, bên shop còn sẵn: ${other} — bạn tham khảo nha!` : ""} Bạn để lại lời nhắn, có hàng shop báo bạn ngay ạ!`,
        intent: "STOCK_CHECK",
      };
    }

    // Khách đang xin đổi thuộc tính đơn (cv-03) → xác nhận đổi kèm số tồn
    const swapNote = /đổi/.test(lower)
      ? "Đơn của bạn chưa bàn giao cho vận chuyển nên shop đổi được ạ. "
      : "";
    // SP chỉ 1 biến thể còn hàng (vd bình sữa 1 dung tích) thì không có
    // "size" gì để khách chốt — câu liệt kê size nghe rất máy móc
    const inStock = scope.filter((v) => qtyOf(v, stockSource) > 0);
    const stockLine =
      inStock.length === 1
        ? `hiện còn ${qtyOf(inStock[0], stockSource)} sản phẩm. Shop giữ hàng cho bạn liền nha!`
        : `hiện còn size ${available}. Bạn chốt size nào shop giữ hàng liền cho bạn nha!`;
    return {
      text: `Dạ còn ạ! ${swapNote}${product.name} ${label} ${stockLine}`,
      intent: "STOCK_CHECK",
    };
  }

  // ── Không bắt được ý định nào → dùng câu dự phòng (LLM thuần hội thoại) ──
  return { text: fallback, intent: "GENERAL" };
}
