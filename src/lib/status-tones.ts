import type { Tone } from "@/components/ui";
import type { PurchaseOrderStatus, SaleStatus } from "@/server/db/schema";

export const PO_TONES: Record<PurchaseOrderStatus, Tone> = {
  draft: "neutral",
  ordered: "primary",
  partially_received: "warning",
  received: "success",
  closed: "neutral",
  cancelled: "danger",
};

export const SALE_TONES: Record<SaleStatus, Tone> = {
  confirmed: "success",
  partially_returned: "warning",
  returned: "neutral",
  cancelled: "danger",
};
