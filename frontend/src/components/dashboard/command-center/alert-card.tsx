"use client";

import { Check, Lock, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  canAct,
  SEVERITY_META,
  TAG_META,
  type OpsAlert,
  type OpsRole,
} from "./types";
import { formatRelative } from "./mock-service";

export function AlertCard({
  alert,
  role,
  resolved,
  chatCount,
  onAction,
  onToggleResolved,
  onDiscuss,
}: {
  alert: OpsAlert;
  role: OpsRole;
  resolved: boolean;
  chatCount: number;
  onAction: () => void;
  onToggleResolved: () => void;
  onDiscuss: () => void;
}) {
  // Đúng vai trò quản lý tag này (hoặc ADMIN) mới được xử lý; còn lại chỉ xem.
  const actor = canAct(role, alert.tag);
  const sev = SEVERITY_META[alert.severity];

  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200/80 bg-card p-4 shadow-sm transition-colors",
        resolved && "opacity-60"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Chấm mức độ nghiêm trọng */}
        <span
          className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", sev.dot)}
          title={`Mức độ: ${sev.label}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                TAG_META[alert.tag].className
              )}
            >
              {TAG_META[alert.tag].label}
            </span>
            <span className="text-[11px] text-slate-400">
              {formatRelative(alert.createdAt)}
            </span>
            {resolved && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
                <Check className="size-3" /> Đã xử lý
              </span>
            )}
          </div>

          <p
            className={cn(
              "mt-1.5 text-sm font-semibold text-slate-900",
              resolved && "line-through decoration-slate-300"
            )}
          >
            {alert.title}
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-slate-500">
            {alert.summary}
          </p>

          {/* Hàng thao tác */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {actor ? (
              <Button
                size="sm"
                variant="outline"
                disabled={resolved}
                onClick={onAction}
              >
                {alert.actionLabel}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400">
                <Lock className="size-3.5" /> Chỉ xem
              </span>
            )}

            <Button size="sm" variant="ghost" onClick={onDiscuss}>
              <MessageSquare className="size-4" />
              Thảo luận
              {chatCount > 0 && (
                <span className="ml-0.5 rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-500">
                  {chatCount}
                </span>
              )}
            </Button>

            {/* Tick "Đã xử lý" — chỉ vai trò quản lý mới đổi được trạng thái */}
            <label
              className={cn(
                "ml-auto flex items-center gap-1.5 text-xs",
                actor
                  ? "cursor-pointer text-slate-600"
                  : "cursor-not-allowed text-slate-300"
              )}
              title={actor ? undefined : "Chỉ vai trò quản lý tag này mới đổi được trạng thái"}
            >
              <input
                type="checkbox"
                className="size-4 accent-emerald-500"
                checked={resolved}
                disabled={!actor}
                onChange={onToggleResolved}
              />
              Đã xử lý
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
