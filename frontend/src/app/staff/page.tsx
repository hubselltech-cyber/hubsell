"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Loader2,
  ShieldCheck,
  Store,
  Trash2,
  UserRound,
  UserPlus,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
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
  ASSIGNABLE_ROLES,
  createStaff,
  deleteStaff,
  fetchChannels,
  fetchStaff,
  getStoredUser,
  getToken,
  ROLE_META,
  setStaffChannels,
  updateStaffRole,
  type Channel,
  type Role,
  type StaffMember,
} from "@/lib/api";
import { canManageShop } from "@/lib/permissions";
import { CHANNEL_META } from "@/lib/channel-meta";
import { shopLabel } from "@/components/channel-filter";
import { formatDateTime } from "@/lib/format";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

// ---------- Dialog: Thêm nhân viên ----------

const staffSchema = z.object({
  fullName: z.string().trim().min(2, "Vui lòng nhập họ tên"),
  email: z.string().trim().email("Email không hợp lệ"),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
});
type StaffFormValues = z.infer<typeof staffSchema>;

function AddStaffDialog({
  channels,
  onAdded,
}: {
  channels: Channel[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [role, setRole] = useState<Role>("SALES");
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffSchema),
    defaultValues: { fullName: "", email: "", password: "" },
  });

  function toggleChannel(id: string) {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(values: StaffFormValues) {
    setSubmitting(true);
    try {
      await createStaff({
        ...values,
        role,
        channelIds: role === "SALES" ? Array.from(selectedChannels) : [],
      });
      toast.success(
        `Đã tạo tài khoản ${ROLE_META[role].label.toLowerCase()} "${values.fullName}"`
      );
      form.reset();
      setRole("SALES");
      setSelectedChannels(new Set());
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm nhân viên mới</DialogTitle>
          <DialogDescription>
            Tài khoản nhân viên dùng chung dữ liệu của shop. Vai trò quyết định
            họ vào được mục nào và thấy bao nhiêu gian hàng.
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email đăng nhập</FormLabel>
                  <FormControl>
                    <Input placeholder="nhanvien@email.com" {...field} />
                  </FormControl>
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
                    <Input type="password" placeholder="Ít nhất 6 ký tự" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* VAI TRÒ — quyết định vào được mục nào */}
            <div className="grid gap-2">
              <Label htmlFor="staff-role">Vai trò</Label>
              <NativeSelect
                id="staff-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_META[r].label}
                  </option>
                ))}
              </NativeSelect>
              <p className={TEXT_SUB}>{ROLE_META[role].description}</p>
            </div>

            {/* Gian hàng phụ trách — chỉ SALES mới cần */}
            {role === "SALES" && (
              <div className="grid gap-2">
                <Label>Gian hàng phụ trách</Label>
                {channels.length === 0 ? (
                  <p className={TEXT_SUB}>Shop chưa có gian hàng nào.</p>
                ) : (
                  <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border p-2">
                    {channels.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={selectedChannels.has(c.id)}
                          onChange={() => toggleChannel(c.id)}
                        />
                        <Store className="size-3.5 shrink-0 text-muted-foreground" />
                        {shopLabel(c.channelName, c.shopName)}
                      </label>
                    ))}
                  </div>
                )}
                {selectedChannels.size === 0 && (
                  <p className="text-sm text-amber-600">
                    Chưa chọn gian nào — tài khoản này sẽ chưa thấy đơn hàng nào
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

// ---------- Dialog: Phân quyền gian hàng ----------

function PermissionDialog({
  staff,
  channels,
  open,
  onOpenChange,
  onSaved,
}: {
  staff: StaffMember;
  channels: Channel[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setSelected(new Set(staff.allowedChannelIds));
  }, [open, staff]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSubmitting(true);
    try {
      await setStaffChannels(staff.id, Array.from(selected));
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            Phân quyền gian hàng
          </DialogTitle>
          <DialogDescription>
            Chọn các gian hàng mà <b>{staff.fullName}</b> được phép xem và xử lý
            đơn. Không chọn gian nào thì tài khoản này chưa thấy đơn hàng nào.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {channels.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Shop chưa có kênh nào.
            </p>
          ) : (
            channels.map((c) => {
              const meta = CHANNEL_META[c.channelName];
              const checked = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2.5 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={checked}
                    onChange={() => toggle(c.id)}
                  />
                  <Store className="size-4 shrink-0 text-muted-foreground" />
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium">
                    {c.shopName}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {c._count?.orders ?? 0} đơn
                  </span>
                </label>
              );
            })
          )}
        </div>

        <p
          className={cn(
            "text-xs",
            selected.size === 0 ? "text-amber-600" : "text-muted-foreground"
          )}
        >
          {selected.size === 0
            ? "→ Nhân viên này sẽ KHÔNG thấy đơn hàng nào."
            : `→ Nhân viên chỉ xem được ${selected.size} gian hàng đã chọn.`}
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

// ---------- Trang chính ----------

export default function StaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [permFor, setPermFor] = useState<StaffMember | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([fetchStaff(), fetchChannels()]);
      setStaff(s);
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
    if (!canManageShop(getStoredUser()?.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
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

  function channelLabel(id: string): string | null {
    const c = channels.find((x) => x.id === id);
    return c ? shopLabel(c.channelName, c.shopName) : null;
  }

  async function handleRoleChange(s: StaffMember, role: Role) {
    try {
      await updateStaffRole(s.id, role);
      toast.success(
        `${s.fullName} giờ là ${ROLE_META[role].label.toLowerCase()}`
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không đổi được vai trò");
    }
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
            Tạo tài khoản nhân viên và phân quyền gian hàng họ được xử lý.
          </p>
          <AddStaffDialog channels={channels} onAdded={load} />
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
            {staff.map((s) => (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap items-center gap-4 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                    <UserRound className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {s.fullName}
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                          ROLE_META[s.role].className
                        )}
                      >
                        {ROLE_META[s.role].label}
                      </span>
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {s.email} · tạo {formatDateTime(s.createdAt)}
                    </p>
                  </div>

                  {/* Phạm vi gian hàng — kho vốn thấy hết nên không liệt kê */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.role === "WAREHOUSE" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        <ShieldCheck className="size-3" />
                        Tất cả gian hàng
                      </span>
                    ) : s.allowedChannelIds.length === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        <ShieldCheck className="size-3" />
                        Chưa phân công gian nào
                      </span>
                    ) : (
                      s.allowedChannelIds.map((id) => {
                        const label = channelLabel(id);
                        return label ? (
                          <span
                            key={id}
                            className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700"
                          >
                            {label}
                          </span>
                        ) : null;
                      })
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <NativeSelect
                      className="w-44"
                      aria-label={`Vai trò của ${s.fullName}`}
                      value={s.role}
                      onChange={(e) =>
                        handleRoleChange(s, e.target.value as Role)
                      }
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_META[r].label}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={s.role !== "SALES"}
                      title={
                        s.role === "SALES"
                          ? undefined
                          : "Nhân viên kho vốn xử lý đơn của mọi gian hàng"
                      }
                      onClick={() => setPermFor(s)}
                    >
                      <ShieldCheck className="size-4" />
                      Phân quyền
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-rose-600"
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
            ))}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Phân quyền nhân viên theo gian hàng (Multi-store)
        </p>
      </div>

      {permFor && (
        <PermissionDialog
          staff={permFor}
          channels={channels}
          open={true}
          onOpenChange={(o) => {
            if (!o) setPermFor(null);
          }}
          onSaved={load}
        />
      )}
    </AppShell>
  );
}
