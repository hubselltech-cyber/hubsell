import { api } from "./client";
import type { MyPlanResponse } from "../types/api";

/** Gói + kỳ hạn của CHỦ SHOP (nhân viên gọi cũng nhận trạng thái của chủ). */
export function fetchMyPlan() {
  return api<MyPlanResponse>("/api/subscription/me");
}
