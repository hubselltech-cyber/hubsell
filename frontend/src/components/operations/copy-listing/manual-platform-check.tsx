"use client";

// ============================================================
// Cột phải của form Tạo mới: mục lục neo (5 khối) + thẻ "Đạt chuẩn sàn" sống (POST /check,
// 3 sàn, mã → nhãn qua missingLabel với trần từng sàn) + dòng blocker.
// ============================================================

import { AlertCircle, Check } from "lucide-react";

import type { ChannelName } from "@/lib/api";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { ChannelChip } from "./primitives";
import { missingLabel, type MissingContext } from "./shared";

const PLATFORMS: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA"];

export function ManualPlatformCheck({
  sections,
  activeSection,
  hasTitle,
  checkReason,
  byPlatform,
  ctxOf,
  blocker,
}: {
  sections: readonly { id: string; label: string }[];
  activeSection: string;
  hasTitle: boolean;
  checkReason: string | null;
  byPlatform: Record<ChannelName, string[]> | null;
  ctxOf: (p: ChannelName) => MissingContext;
  blocker: string | null;
}) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
      <nav aria-label="Mục lục biểu mẫu" className="rounded-lg border border-slate-200 p-1.5">
        {sections.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
              activeSection === s.id ? "bg-muted font-medium text-slate-900" : "text-slate-500 hover:bg-muted/60 hover:text-slate-900"
            )}
          >
            <span className="tabular-nums">{i + 1}.</span> {s.label}
          </button>
        ))}
      </nav>

      <div className="rounded-lg border border-slate-200 p-3">
        <div className={cn(TEXT_TABLE_HEAD, "mb-2")}>Đạt chuẩn sàn</div>
        {!hasTitle ? (
          <p className={TEXT_SUB}>Nhập tên sản phẩm để bắt đầu kiểm.</p>
        ) : checkReason ? (
          <p className={cn(TEXT_SUB, "text-amber-700")}>{checkReason}</p>
        ) : !byPlatform ? (
          <p className={TEXT_SUB}>Đang kiểm…</p>
        ) : (
          <ul className="space-y-2">
            {PLATFORMS.map((p) => {
              const codes = byPlatform[p] ?? [];
              const ok = codes.length === 0;
              return (
                <li key={p} className="flex gap-2">
                  {ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" />}
                  <div className="min-w-0">
                    <ChannelChip channelName={p} />
                    {ok ? (
                      <span className={cn(TEXT_SUB, "ml-1.5")}>đạt</span>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {codes.map((c) => (
                          <li key={c} className="text-[12px] leading-snug text-slate-700">
                            {missingLabel(c, undefined, ctxOf(p))}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className={cn(TEXT_SUB, "mt-2")}>Danh mục, thuộc tính, thương hiệu, vận chuyển chọn ở bước sau theo từng gian.</p>
      </div>

      {blocker && (
        <p className={cn(TEXT_SUB, "flex items-start gap-1.5 text-amber-700")}>
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {blocker}
        </p>
      )}
    </aside>
  );
}
