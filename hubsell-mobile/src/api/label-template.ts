import { api, apiBinary } from "./client";
import type { LabelTemplate, LabelTemplateSettings, TemplatePlatform } from "../lib/label-template";

/**
 * TÙY CHỈNH PHIẾU IN (19/11/2026) — /api/orders/label-template. Mẫu lưu theo chủ shop +
 * sàn và áp ở máy chủ lúc dựng tệp in, nên in từ web hay từ app đều ra cùng một phiếu.
 */
export function fetchLabelTemplates() {
  return api<LabelTemplateSettings>("/api/orders/label-template");
}

export function saveLabelTemplate(platform: TemplatePlatform, template: LabelTemplate) {
  return api<{ platform: TemplatePlatform; template: LabelTemplate }>("/api/orders/label-template", {
    method: "PUT",
    body: { platform, template },
  });
}

/** Tệp PDF của một phiếu MẪU đã chèn theo mẫu đang chỉnh (máy chủ tự dựng, không gọi sàn). */
export async function fetchLabelPreview(platform: TemplatePlatform, template: LabelTemplate, lines = 6) {
  const res = await apiBinary("/api/orders/label-template/preview", {
    method: "POST",
    body: { platform, template, lines },
  });
  return res.bytes;
}
