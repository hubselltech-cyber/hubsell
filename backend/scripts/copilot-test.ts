// Test nhanh AI Copilot: npx tsx scripts/copilot-test.ts
// Gọi thẳng generateCopilotSuggestion (không qua HTTP/auth) với ngữ cảnh mẫu
// mô phỏng đúng khối buildInjectedContext frontend gửi lên.
import "dotenv/config";
import { copilotConfigured, generateCopilotSuggestion } from "../src/integrations/ai/copilot";

async function main() {
  if (!copilotConfigured()) {
    console.error("❌ Chưa có ANTHROPIC_API_KEY trong env");
    process.exit(1);
  }
  const context = [
    "SKU: TC025 — Túi Đeo Chéo Nam ANO [KT: 22*14*7 cm] da lì mịn cao cấp",
    "Chất liệu: Da PU lì mịn cao cấp",
    "Giá niêm yết: 239.000đ",
    "Thuộc tính trên sàn: Xuất xứ: Việt Nam; Kiểu khóa: Khóa kéo",
    "Tồn kho (nguồn tư vấn: tồn trên sàn): Đen Xám/—: 968, TC077 ĐEN/—: 67",
  ].join("\n");

  const t0 = Date.now();
  const result = await generateCopilotSuggestion({
    context,
    customerMessage: "Shop ơi túi này còn màu đen không? Da có bền không?",
    channelLabel: "Shopee",
  });
  console.log(`✅ OK sau ${Date.now() - t0}ms`);
  console.log("intent:", result.intent);
  console.log("text  :", result.text);
}

main().catch((err) => {
  console.error("❌ Lỗi:", err instanceof Error ? err.message : err);
  process.exit(1);
});
