import type { NextRequest } from "next/server";
import { requireAnyPermission } from "@/lib/auth";

// Inbox access is personal. Field operators need their assignment notices,
// without receiving the broader admin/dashboard permission.
export function requireNotificationAccess(request: NextRequest) {
  return requireAnyPermission(request, [
    "dashboard.admin.view", "dashboard.executive.view", "dashboard.sales.view",
    "dashboard.agent.view", "dashboard.finance.view", "dashboard.operations.view"
  ]);
}
