"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { LogOut, Search } from "lucide-react";

import { NavIcon } from "@/components/shell/nav-icon";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
// Chỉ import KIỂU từ app-shell (app-shell import ngược component này — import
// type được xoá lúc biên dịch nên không tạo vòng phụ thuộc runtime).
import type { NavItem } from "@/components/shell/app-shell";

/**
 * ══ COMMAND PALETTE (Ctrl+K / ⌘K) ══
 *
 * Hộp tìm nhanh chuẩn SaaS hiện đại: gõ vài chữ là nhảy thẳng tới trang bất kỳ
 * thay vì lần theo sidebar 10+ nhóm menu. Danh sách trang nhận từ AppShell và
 * ĐÃ QUA LỌC QUYỀN — nhân viên chỉ tìm thấy đúng những trang sidebar cho thấy,
 * không bao giờ lộ trang ngoài quyền.
 */

interface PaletteEntry {
  href: string;
  label: string;
  /** Tên nhóm sidebar chứa trang (hiện mờ bên phải để định vị) */
  group?: string;
  icon: NavItem["icon"];
}

/**
 * Chuẩn hoá tiếng Việt để tìm KHÔNG CẦN GÕ DẤU: "bao cao dong tien" phải khớp
 * "Báo cáo dòng tiền". NFD tách dấu ra khỏi chữ cái rồi lược bỏ; riêng đ/Đ
 * không phải dấu tổ hợp nên thay tay.
 */
function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Mọi từ trong ô tìm đều phải xuất hiện (không cần liền kề, không cần dấu). */
function vnFilter(value: string, search: string): number {
  const haystack = stripDiacritics(value);
  const tokens = stripDiacritics(search).split(/\s+/).filter(Boolean);
  return tokens.every((t) => haystack.includes(t)) ? 1 : 0;
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cây menu sidebar ĐÃ lọc theo quyền của người đang đăng nhập */
  items: NavItem[];
  onLogout: () => void;
}) {
  const router = useRouter();

  // Phím tắt toàn cục — Ctrl+K (Windows) / ⌘K (Mac) bật tắt palette
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  // Trải phẳng cây menu: mục lẻ giữ nguyên, nhóm thì mỗi trang con một dòng
  // kèm tên nhóm; icon trang con thừa hưởng icon nhóm (menu con không có icon).
  const entries = React.useMemo<PaletteEntry[]>(() => {
    const out: PaletteEntry[] = [];
    for (const item of items) {
      if (item.href) {
        out.push({ href: item.href, label: item.label, icon: item.icon });
      } else if (item.children) {
        for (const child of item.children) {
          out.push({
            href: child.href,
            label: child.label,
            group: item.label,
            icon: item.icon,
          });
        }
      }
    }
    return out;
  }, [items]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Neo cao hơn tâm màn hình (kiểu Raycast/Linear) — top cố định để danh
        // sách kết quả dài ngắn không làm hộp nhảy dọc; translate-y-0 gỡ phép
        // căn giữa dọc của Dialog gốc.
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Tìm nhanh trang chức năng</DialogTitle>
        <Command filter={vnFilter} loop>
          <div className="flex items-center gap-2.5 border-b px-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              placeholder="Tìm trang chức năng… (gõ không dấu cũng được)"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Esc
            </kbd>
          </div>
          <Command.List className="max-h-[min(20rem,50vh)] overflow-y-auto p-2">
            <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
              Không tìm thấy trang phù hợp.
            </Command.Empty>
            {entries.map((e) => (
              <Command.Item
                key={e.href}
                // value phải chứa cả tên nhóm để "tai chinh dong tien" vẫn khớp
                value={`${e.group ?? ""} ${e.label}`}
                onSelect={() => go(e.href)}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
              >
                <NavIcon name={e.icon} />
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                {e.group && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {e.group}
                  </span>
                )}
              </Command.Item>
            ))}
            <Command.Group
              heading="Thao tác"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <Command.Item
                value="Đăng xuất logout"
                onSelect={() => {
                  onOpenChange(false);
                  onLogout();
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
              >
                <LogOut aria-hidden className="w-5 shrink-0" size={20} strokeWidth={1.75} />
                <span>Đăng xuất</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
