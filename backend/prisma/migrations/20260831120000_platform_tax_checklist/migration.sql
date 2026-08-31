-- Checklist thủ tục thuế của chính công ty Hubsell (tab Lịch thuế /admin/finance).
CREATE TABLE "platform_tax_check_items" (
    "id" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneById" TEXT,
    "doneByName" TEXT NOT NULL,

    CONSTRAINT "platform_tax_check_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_tax_check_items_itemKey_key" ON "platform_tax_check_items"("itemKey");
