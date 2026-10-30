"use client";

// ============================================================
// SAO CHÉP SẢN PHẨM — trang làm việc (docs/SAO-CHEP-SAN-PHAM.md mục 6, 9, 29)
//
// Tab "Sao chép" (new-copy-step.tsx): Bước 1 tick N sản phẩm nguồn (gian đã nối / kho
// Hubsell) hoặc "Tạo mới" soạn một sản phẩm từ đầu (manual-product-form.tsx) → Bước 2
// tick M gian đích → "Xem trước" tạo một ĐỢT → batch-view.tsx: mỗi sản phẩm một khối,
// mỗi gian một dòng; Sửa bài đăng (source-editor.tsx) / Bổ sung từng gian
// (target-editor.tsx) → "Đăng" → hàng đợi, trạng thái từng dòng tự cập nhật.
// Tab "Lịch sử" (batch-history.tsx): các đợt đã tạo, bấm mở lại.
// ============================================================

import { useState } from "react";

import { OperationsFrame } from "@/components/operations/operations-frame";
import { PageHeaderBand, PageTabs, type PageTabItem } from "@/components/ui/page-tabs";

import { BatchHistory } from "./batch-history";
import { BatchView } from "./batch-view";
import { NewCopyStep } from "./new-copy-step";

type Tab = "new" | "history";

const TABS: PageTabItem<Tab>[] = [
  { key: "new", label: "Sao chép" },
  { key: "history", label: "Lịch sử" },
];

export function CopyListingPage() {
  const [tab, setTab] = useState<Tab>("new");
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);

  return (
    <OperationsFrame>
      <PageHeaderBand>
        <PageTabs
          ariaLabel="Khu vực Sao chép sản phẩm"
          className="border-b-0"
          tabs={TABS}
          value={tab}
          onChange={(key) => {
            setTab(key);
            setOpenBatchId(null);
          }}
        />
      </PageHeaderBand>

      {openBatchId ? (
        <BatchView batchId={openBatchId} onBack={() => setOpenBatchId(null)} />
      ) : tab === "new" ? (
        <NewCopyStep onCreated={setOpenBatchId} />
      ) : (
        <BatchHistory onOpen={setOpenBatchId} />
      )}
    </OperationsFrame>
  );
}
