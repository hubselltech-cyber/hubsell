"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
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
  createStaff,
  deleteStaff,
  fetchChannels,
  fetchStaff,
  getStoredUser,
  getToken,
  setStaffChannels,
  type Channel,
  type StaffMember,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime } from "@/lib/format";

// ---------- Dialog: Thêm nhân viên ----------

const staffSchema = z.object({
  fullName: z.string().trim().min(2, "Vui lòng nhập họ tên"),
  email: z.string().trim().email("Email không hợp lệ"),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
});
type StaffFormValues = z.infer<typeof staffSchema>;

function AddStaffDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffSchema),
    defaultValues: { fullName: "", email: "", password: "" },
  });

  async function onSubmit(values: StaffFormValues) {
    setSubmitting(true);
    try {
      await createStaff(values);
      toast.success(`Đã tạo tài khoản nhân viên "${values.fullName}"`);
      form.reset();
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
            Tài khoản nhân viên dùng chung dữ liệu của shop. Mặc định xem tất cả
            kênh — bạn có thể giới hạn quyền theo từng gian hàng sau khi tạo.
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
            Chọn các kênh mà <b>{staff.fullName}</b> được phép xem & xử lý đơn.
            Không chọn kênh nào = cho phép xem <b>tất cả</b> kênh.
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
                  <Store className="size-4 text-muted-foreground" />
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {c._count?.orders ?? 0} đơn
                  </span>
                </label>
              );
            })
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {selected.size === 0
            ? "→ Nhân viên sẽ xem được TẤT CẢ kênh."
            : `→ Nhân viên chỉ xem được ${selected.size} kênh đã chọn.`}
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
    if (getStoredUser()?.role === "STAFF") {
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
    return c ? CHANNEL_META[c.channelName].label : null;
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
          <AddStaffDialog onAdded={load} />
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
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                    <UserRound className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.fullName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {s.email} · tạo {formatDateTime(s.createdAt)}
                    </p>
                  </div>

                  {/* Phạm vi kênh */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.allowedChannelIds.length === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        <ShieldCheck className="size-3" />
                        Tất cả kênh
                      </span>
                    ) : (
                      s.allowedChannelIds.map((id) => {
                        const label = channelLabel(id);
                        return label ? (
                          <span
                            key={id}
                            className="inline-flex items-center rounded-full border border-sky-200 bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-700"
                          >
                            {label}
                          </span>
                        ) : null;
                      })
                    )}
                  </div>

                  <div className="flex shrink-0 gap-2">
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
