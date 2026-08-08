import Anthropic from "@anthropic-ai/sdk";

/**
 * AI COPILOT THẬT — sinh gợi ý trả lời CSKH bằng Claude API.
 *
 * Kiến trúc đúng như spec ở frontend copilot-engine.ts: CONTEXT INJECTION,
 * không function-calling — khối ngữ cảnh sản phẩm (buildInjectedContext dựng
 * sẵn phía client) được nhét thẳng vào lượt user, 1 lượt gọi duy nhất.
 * Hợp đồng vào-ra giữ nguyên CopilotSuggestion {text, intent} nên UI không đổi.
 *
 * Cấu hình qua env:
 *   - ANTHROPIC_API_KEY : bắt buộc — thiếu thì route trả 503, frontend tự rơi
 *     về engine luật (chat không bao giờ sập vì AI).
 *   - COPILOT_MODEL     : mặc định claude-opus-5; đổi claude-haiku-4-5 nếu
 *     muốn rẻ/nhanh hơn cho khối lượng chat lớn.
 */

export type CopilotIntent = "SIZE_ADVICE" | "STOCK_CHECK" | "GENERAL";

export interface CopilotSuggestion {
  text: string;
  intent: CopilotIntent;
}

// System prompt TĨNH (không nội suy gì) — đặt cache_control để các lượt gọi
// liên tiếp đọc lại prefix từ cache thay vì trả phí đủ.
const SYSTEM_PROMPT = `Bạn là trợ lý CSKH của một shop bán hàng trên sàn thương mại điện tử Việt Nam (Shopee/Lazada/TikTok Shop). Nhiệm vụ: soạn MỘT câu trả lời gợi ý để nhân viên gửi cho khách đang chat.

Quy tắc bắt buộc:
- Chỉ dùng thông tin trong khối NGỮ CẢNH SẢN PHẨM được cung cấp. Tuyệt đối không bịa số tồn kho, giá, khuyến mãi, phí ship hay thời gian giao hàng không có trong ngữ cảnh.
- Số tồn trong ngữ cảnh đã được ghi theo nguồn tư vấn (tồn trên sàn hoặc kho vật lý) — cứ dùng đúng số đó.
- Khách hỏi điều không có dữ liệu để trả lời → soạn câu xã giao xác nhận shop đã nhận tin và sẽ kiểm tra phản hồi ngay.
- Văn phong chat sàn TMĐT Việt Nam: xưng "shop", gọi khách là "bạn", mở đầu bằng "Dạ", thân thiện, ngắn gọn 1–3 câu, tối đa 1 emoji.
- Khách hỏi size kèm chiều cao/cân nặng và ngữ cảnh có bảng size → tư vấn size cụ thể, intent = SIZE_ADVICE.
- Khách hỏi còn hàng/màu/phân loại và ngữ cảnh có số tồn → trả lời theo số tồn, intent = STOCK_CHECK.
- Còn lại → intent = GENERAL.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    text: {
      type: "string" as const,
      description: "Câu trả lời gợi ý gửi khách, tiếng Việt, 1-3 câu.",
    },
    intent: {
      type: "string" as const,
      enum: ["SIZE_ADVICE", "STOCK_CHECK", "GENERAL"],
      description: "Loại ý định đã xử lý — UI gắn badge nguồn dữ liệu theo trường này.",
    },
  },
  required: ["text", "intent"],
  additionalProperties: false,
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Khởi tạo lười — đọc ANTHROPIC_API_KEY từ env tại thời điểm gọi đầu tiên
  if (!client) client = new Anthropic();
  return client;
}

export function copilotConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function generateCopilotSuggestion(input: {
  /** Khối ngữ cảnh sản phẩm (buildInjectedContext) — null khi chưa nạp SP nào. */
  context: string | null;
  customerMessage: string;
  /** Nhãn sàn của hội thoại ("Shopee"/"Lazada"…) để AI xưng hô đúng kênh. */
  channelLabel: string | null;
}): Promise<CopilotSuggestion> {
  const model = process.env.COPILOT_MODEL || "claude-opus-5";
  const userContent = [
    "NGỮ CẢNH SẢN PHẨM (dữ liệu thật của shop):",
    input.context?.trim() || "(chưa nạp sản phẩm nào — chỉ trả lời xã giao, không nói về thông số hay tồn kho)",
    "",
    `Sàn đang chat: ${input.channelLabel ?? "không rõ"}`,
    `Tin nhắn mới nhất của khách: "${input.customerMessage.trim()}"`,
  ].join("\n");

  const response = await getClient().messages.create({
    model,
    max_tokens: 2048,
    output_config: {
      effort: "low", // gợi ý chat ngắn, ưu tiên tốc độ — không cần suy luận sâu
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  // Safety classifier từ chối (hiếm với nội dung CSKH) → để route trả lỗi,
  // frontend rơi về engine luật.
  if (response.stop_reason === "refusal") {
    throw new Error("AI từ chối xử lý nội dung này");
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { text?: unknown; intent?: unknown };
  const intent: CopilotIntent =
    parsed.intent === "SIZE_ADVICE" || parsed.intent === "STOCK_CHECK"
      ? parsed.intent
      : "GENERAL";
  if (typeof parsed.text !== "string" || !parsed.text.trim()) {
    throw new Error("AI trả về câu gợi ý rỗng");
  }
  return { text: parsed.text.trim(), intent };
}
