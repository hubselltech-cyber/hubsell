"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  KeyRound,
  Loader2,
  ShieldCheck,
  Store,
  Trash2,
  UserRound,
  UserPlus,
} from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  createStaff,
  deleteStaff,
  fetchChannels,
  fetchStaff,
  getStoredUser,
  getToken,
  resetStaffPassword,
  updateStaff,
  type Channel,
  type StaffMember,
} from "@/lib/api";
import {
  HQ_PERMISSION_PRESETS,
  HQ_PERMISSION_TREE,
  PERMISSION_PRESETS,
  PERMISSION_TREE,
  type PermissionNode,
} from "@/lib/permission-registry";
import { canManageShop, isPlatformWorkspace } from "@/lib/permissions";
import { toAsciiUsername } from "@/lib/username";
import { shopLabel } from "@/components/shared/channel-filter";
import { formatDateTime } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

// ============================================================
// CÂY PHÂN QUYỀN CHA-CON (3 trạng thái)
//
// State duy nhất là Set<khóa LÁ> — trạng thái nút CHA suy ra lúc render:
//   đủ lá  → checked  ·  một phần → indeterminate  ·  không lá nào → unchecked
// Tick cha = bật đủ lá con; bỏ tick cha = tắt đủ lá con (đúng đề bài).
// Cây ~25 lá nên render phẳng, không cần thư viện treeview.
// ============================================================

function leavesOf(node: PermissionNode): string[] {
  return node.children ? node.children.map((c) => c.key) : [node.key];
}

/**
 * Trang này phục vụ HAI loại chủ tài khoản với HAI cây quyền khác nhau:
 *  - Chủ shop thường     → cây nghiệp vụ bán hàng (PERMISSION_TREE) + gian hàng.
 *  - Chủ nền tảng Hubsell → cây điều hành (HQ_PERMISSION_TREE, lá hq.*), KHÔNG
 *    có khái niệm gian hàng — nhân viên của công ty Hubsell làm việc trên khu
 *    /admin chứ không bán hàng. Backend tự lọc lá theo đúng cây của chủ.
 */
function PermissionTree({
  tree,
  value,
  onChange,
}: {
  tree: PermissionNode[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  function toggleLeaf(key: string) {
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function toggleParent(node: PermissionNode) {
    const leaves = leavesOf(node);
    const allOn = leaves.every((k) => value.has(k));
    const next = new Set(value);
    for (const k of leaves) {
      if (allOn) next.delete(k);
      else next.add(k);
    }
    onChange(next);
  }

  return (
    <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
      {tree.map((node) => {
        const leaves = leavesOf(node);
        const onCount = leaves.filter((k) => value.has(k)).length;
        const allOn = onCount === leaves.length;
        const someOn = onCount > 0 && !allOn;
        return (
          <div key={node.key}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted/60">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={allOn}
                // indeterminate là THUỘC TÍNH DOM, không phải prop React —
                // phải set qua ref mỗi lần render.
                ref={(el) => {
                  if (el) el.indeterminate = someOn;
                }}
                onChange={() => toggleParent(node)}
              />
              {node.label}
              {node.children && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {onCount}/{leaves.length}
                </span>
              )}
            </label>
            {node.children && (
              <div className="ml-5 space-y-0.5 border-l pl-3">
                {node.children.map((leaf) => (
                  <label
                    key={leaf.key}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-sm hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={value.has(leaf.key)}
                      onChange={() => toggleLeaf(leaf.key)}
                    />
                    {leaf.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Hàng nút preset 1-click — đổ sẵn mảng quyền mẫu, sửa lẻ thoải mái sau đó. */
function PresetRow({
  presets,
  onPick,
}: {
  presets: typeof PERMISSION_PRESETS;
  onPick: (perms: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Chọn nhanh:</span>
      {presets.map((p) => (
        <button
          key={p.key}
          type="button"
          title={p.description}
          className="rounded-full border px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-primary hover:text-primary"
          onClick={() => onPick(p.permissions)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** Phạm vi gian hàng — nhân viên chỉ thấy dữ liệu của gian được tick. */
function ChannelScope({
  channels,
  value,
  onChange,
}: {
  channels: Channel[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  function toggle(id: string) {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }
  if (channels.length === 0) {
    return <p className={TEXT_SUB}>Shop chưa có gian hàng nào.</p>;
  }
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
      {channels.map((c) => (
        <label
          key={c.id}
          className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
        >
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={value.has(c.id)}
            onChange={() => toggle(c.id)}
          />
          <Store className="size-3.5 shrink-0 text-muted-foreground" />
          {shopLabel(c.channelName, c.shopName)}
        </label>
      ))}
    </div>
  );
}

// ---------- Dialog: Thêm nhân viên (không cần email) ----------

/**
 * Tiền tố "cha" của tài khoản nhân viên — ưu tiên username chủ shop; chưa đặt
 * username thì lấy ĐẦU EMAIL (trùng cách backend tự sinh lúc lưu, nên xem
 * trước và kết quả thật khớp nhau trừ khi tên bị trùng phải gắn thêm số).
 */
function ownerPrefixOf(
  ownerUsername: string | null,
  user: { username?: string | null; email: string | null } | null
): string {
  if (ownerUsername) return ownerUsername;
  if (user?.username) return user.username;
  if (user?.email) return toAsciiUsername(user.email.split("@")[0]);
  return "tenshop";
}

const staffSchema = z.object({
  fullName: z.string().trim().min(2, "Vui lòng nhập họ tên"),
  staffUsername: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9._]{2,29}$/,
      "3-30 ký tự, chỉ chữ thường/số/dấu chấm/gạch dưới"
    ),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
});
type StaffFormValues = z.infer<typeof staffSchema>;

function AddStaffDialog({
  hqMode,
  channels,
  ownerUsername,
  onAdded,
}: {
  /** Chủ nền tảng Hubsell — cây quyền HQ, không có mục gian hàng. */
  hqMode: boolean;
  channels: Channel[];
  ownerUsername: string | null;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Set<string>>(new Set());
  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffSchema),
    defaultValues: { fullName: "", staffUsername: "", password: "" },
  });

  // Tiền tố "chủ/" hiển thị trước ô nhập — ưu tiên username, thiếu thì lấy đầu
  // email (backend ensureOwnerUsername sinh cùng một gốc lúc lưu).
  const prefix = ownerPrefixOf(ownerUsername, getStoredUser());
  const typedUsername = form.watch("staffUsername");

  async function onSubmit(values: StaffFormValues) {
    setSubmitting(true);
    try {
      const created = await createStaff({
        ...values,
        permissions: Array.from(perms),
        channelIds: Array.from(scope),
      });
      toast.success(
        created.loginName
          ? `Đã tạo nhân viên — đăng nhập bằng "${created.loginName}"`
          : `Đã tạo nhân viên "${values.fullName}"`
      );
      form.reset();
      setPerms(new Set());
      setScope(new Set());
      setOpen(false);
      onAdded();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <UserPlus className="size-4" />
        Thêm nhân viên
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thêm nhân viên mới</DialogTitle>
          <DialogDescription>
            Không cần email — nhân viên đăng nhập bằng{" "}
            <b>
              {prefix}/<i>tênnhânviên</i>
            </b>{" "}
            với mật khẩu anh cấp. Tick tính năng nào, nhân viên dùng được tính
            năng đó.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Họ và tên</FormLabel>
                  <FormControl>
                    <Input placeholder="Nguyễn Văn A" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="staffUsername"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tên đăng nhập</FormLabel>
                  <FormControl>
                    <div className="flex items-center">
                      <span className="inline-flex h-9 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                        {prefix}/
                      </span>
                      <Input
                        className="rounded-l-none"
                        placeholder="vd: kho01, sale.mai"
                        autoComplete="off"
                        {...field}
                        // Ép quy ước NGAY KHI GÕ: "Anh Yêu Em" thành "anhyeuem"
                        // — người dùng thấy kết quả liền, không bị mắng sau.
                        onChange={(e) =>
                          field.onChange(toAsciiUsername(e.target.value))
                        }
                      />
                    </div>
                  </FormControl>
                  <p className={TEXT_SUB}>
                    Viết liền, không dấu. Nhân viên sẽ đăng nhập bằng:{" "}
                    <b className="font-mono">
                      {prefix}/{typedUsername || "…"}
                    </b>
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mật khẩu</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Ít nhất 6 ký tự" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-2">
              <Label>Phân quyền tính năng</Label>
              <PresetRow
                presets={hqMode ? HQ_PERMISSION_PRESETS : PERMISSION_PRESETS}
                onPick={(p) => setPerms(new Set(p))}
              />
              <PermissionTree
                tree={hqMode ? HQ_PERMISSION_TREE : PERMISSION_TREE}
                value={perms}
                onChange={setPerms}
              />
              {perms.size === 0 && (
                <p className="text-sm text-amber-600">
                  Chưa tick quyền nào — nhân viên đăng nhập được nhưng chưa dùng
                  được tính năng nào.
                </p>
              )}
            </div>

            {/* Khu điều hành không có gian hàng — nhân viên Hubsell làm việc
                trên dữ liệu toàn nền tảng, không bó theo gian nào. */}
            {!hqMode && (
              <div className="grid gap-2">
                <Label>Gian hàng phụ trách</Label>
                <ChannelScope channels={channels} value={scope} onChange={setScope} />
                {scope.size === 0 && channels.length > 0 && (
                  <p className="text-sm text-amber-600">
                    Chưa chọn gian nào — nhân viên sẽ chưa thấy đơn/dữ liệu nào
                    cho tới khi anh phân công.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Tạo tài khoản
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Dialog: Phân quyền (cây tính năng + phạm vi gian hàng) ----------

function PermissionDialog({
  hqMode,
  staff,
  channels,
  open,
  onOpenChange,
  onSaved,
}: {
  /** Chủ nền tảng Hubsell — cây quyền HQ, không có mục gian hàng. */
  hqMode: boolean;
  staff: StaffMember;
  channels: Channel[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPerms(new Set(staff.permissions));
    setScope(new Set(staff.allowedChannelIds));
  }, [open, staff]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await updateStaff(staff.id, {
        permissions: Array.from(perms),
        channelIds: Array.from(scope),
      });
      toast.success(`Đã cập nhật quyền cho ${staff.fullName}`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            Phân quyền — {staff.fullName}
          </DialogTitle>
          <DialogDescription>
            {hqMode
              ? "Tick khu vực nhân viên được làm việc trong Hệ thống Hubsell. Quyền mới có hiệu lực NGAY với phiên đang đăng nhập."
              : "Tick tính năng nhân viên được dùng và gian hàng họ phụ trách. Quyền mới có hiệu lực NGAY với phiên đang đăng nhập."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label>Tính năng</Label>
          <PresetRow
            presets={hqMode ? HQ_PERMISSION_PRESETS : PERMISSION_PRESETS}
            onPick={(p) => setPerms(new Set(p))}
          />
          <PermissionTree
            tree={hqMode ? HQ_PERMISSION_TREE : PERMISSION_TREE}
            value={perms}
            onChange={setPerms}
          />
        </div>

        {!hqMode && (
          <div className="grid gap-2">
            <Label>Gian hàng phụ trách</Label>
            <ChannelScope channels={channels} value={scope} onChange={setScope} />
          </div>
        )}

        <p
          className={cn(
            "text-xs",
            perms.size === 0 || (!hqMode && scope.size === 0)
              ? "text-amber-600"
              : "text-muted-foreground"
          )}
        >
          {perms.size === 0
            ? "→ Nhân viên này sẽ KHÔNG dùng được tính năng nào."
            : hqMode
              ? `→ Đang bật ${perms.size} khu vực trong Hệ thống Hubsell.`
              : scope.size === 0 && channels.length > 0
                ? "→ Có quyền tính năng nhưng CHƯA được gán gian nào — sẽ không thấy dữ liệu."
                : `→ Đang bật ${perms.size} quyền trên ${scope.size} gian hàng.`}
        </p>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Lưu phân quyền
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Dialog: Cấp lại mật khẩu ----------

function ResetPasswordDialog({
  staff,
  open,
  onOpenChange,
}: {
  staff: StaffMember;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setPassword("");
  }, [open]);

  async function handleSave() {
    if (password.length < 6) {
      toast.error("Mật khẩu mới phải có ít nhất 6 ký tự");
      return;
    }
    setSubmitting(true);
    try {
      await resetStaffPassword(staff.id, password);
      toast.success(`Đã cấp mật khẩu mới cho ${staff.fullName}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Cấp lại mật khẩu
          </DialogTitle>
          <DialogDescription>
            Đặt mật khẩu mới cho <b>{staff.fullName}</b>
            {staff.loginName ? (
              <>
                {" "}
                (đăng nhập <b>{staff.loginName}</b>)
              </>
            ) : null}
            . Nhớ gửi mật khẩu này cho nhân viên.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          placeholder="Mật khẩu mới (ít nhất 6 ký tự)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Lưu mật khẩu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Trang chính ----------

export default function StaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [ownerUsername, setOwnerUsername] = useState<string | null>(null);
  // Chủ nền tảng Hubsell? Đọc localStorage nên phải nằm trong effect (mount),
  // không đọc lúc render kẻo lệch với bản prerender.
  const [hqMode, setHqMode] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [permFor, setPermFor] = useState<StaffMember | null>(null);
  const [resetFor, setResetFor] = useState<StaffMember | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([fetchStaff(), fetchChannels()]);
      setStaff(s.staff);
      setOwnerUsername(s.ownerUsername);
      setChannels(c);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      toast.error("Không tải được danh sách nhân viên");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    const user = getStoredUser();
    if (!canManageShop(user)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    setHqMode(isPlatformWorkspace(user));
    load();
  }, [load, router]);

  async function handleDelete(s: StaffMember) {
    setDeletingId(s.id);
    try {
      await deleteStaff(s.id);
      toast.success(`Đã xoá nhân viên ${s.fullName}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xoá được");
    } finally {
      setDeletingId(null);
    }
  }

  const channelLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of channels) m.set(c.id, shopLabel(c.channelName, c.shopName));
    return m;
  }, [channels]);

  /** Tóm tắt quyền hiển thị trên thẻ: các NHÓM có ít nhất một lá được bật. */
  function permissionSummary(perms: string[]): string[] {
    return (hqMode ? HQ_PERMISSION_TREE : PERMISSION_TREE)
      .filter((n) =>
        (n.children ? n.children.map((c) => c.key) : [n.key]).some((k) =>
          perms.includes(k)
        )
      )
      .map((n) => n.label);
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            {hqMode
              ? "Tạo tài khoản nhân viên điều hành Hubsell (không cần email) và phân quyền từng khu vực trong Hệ thống."
              : "Tạo tài khoản nhân viên (không cần email) và phân quyền từng tính năng, từng gian hàng."}
          </p>
          <AddStaffDialog
            hqMode={hqMode}
            channels={channels}
            ownerUsername={ownerUsername}
            onAdded={load}
          />
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tải…
          </p>
        ) : staff.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <UserRound className="mx-auto mb-2 size-8" />
              Chưa có nhân viên nào. Bấm “Thêm nhân viên” để tạo tài khoản đầu tiên.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {staff.map((s) => {
              const groups = permissionSummary(s.permissions);
              return (
                <Card key={s.id}>
                  <CardContent className="flex flex-wrap items-center gap-4 p-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                      <UserRound className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        {s.fullName}
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 font-mono text-xs font-medium text-sky-700">
                          {s.loginName ?? s.email}
                        </span>
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        tạo {formatDateTime(s.createdAt)}
                        {/* Khu điều hành không có gian hàng — đừng hiện
                            "chưa gán gian nào" gây hiểu nhầm thiếu cấu hình. */}
                        {!hqMode && (
                          <>
                            {" · "}
                            {s.allowedChannelIds.length === 0
                              ? "chưa gán gian nào"
                              : s.allowedChannelIds
                                  .map((id) => channelLabelById.get(id))
                                  .filter(Boolean)
                                  .join(", ")}
                          </>
                        )}
                      </p>
                    </div>

                    {/* Các nhóm tính năng đang được bật */}
                    <div className="flex max-w-md flex-wrap items-center gap-1.5">
                      {groups.length === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          <ShieldCheck className="size-3" />
                          Chưa cấp quyền nào
                        </span>
                      ) : (
                        groups.map((g) => (
                          <span
                            key={g}
                            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
                          >
                            {g}
                          </span>
                        ))
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPermFor(s)}
                      >
                        <ShieldCheck className="size-4" />
                        Phân quyền
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        title="Cấp lại mật khẩu"
                        onClick={() => setResetFor(s)}
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-red-500"
                        disabled={deletingId === s.id}
                        onClick={() => handleDelete(s)}
                      >
                        {deletingId === s.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          {hqMode
            ? "Hubsell · Nhân viên điều hành nền tảng"
            : "Hubsell · Phân quyền nhân viên theo tính năng × gian hàng"}
        </p>
      </div>

      {permFor && (
        <PermissionDialog
          hqMode={hqMode}
          staff={permFor}
          channels={channels}
          open={true}
          onOpenChange={(o) => {
            if (!o) setPermFor(null);
          }}
          onSaved={load}
        />
      )}
      {resetFor && (
        <ResetPasswordDialog
          staff={resetFor}
          open={true}
          onOpenChange={(o) => {
            if (!o) setResetFor(null);
          }}
        />
      )}
    </AppShell>
  );
}
