import { NextRequest, NextResponse } from "next/server";
import { sendDailyNotificationEmails, syncCrmNotifications, syncFinancialNotifications } from "@/lib/notifications";
import { emitStructuredLog, observeRoute, safeErrorCode } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  return observeRoute(request, {
    route: "/api/cron/sync-financial-notifications",
    operation: "cron.notification_sync"
  }, async () => {
    const startedAt = performance.now();
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      emitStructuredLog("error", "cron_failed", { status: 503, errorCode: "CRON_SECRET_MISSING" });
      return NextResponse.json({ error: "Configuratia jobului nu este disponibila." }, { status: 503 });
    }
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      emitStructuredLog("warn", "cron_auth_failed", { status: 401, errorCode: "CRON_UNAUTHORIZED" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const [financialCreated, crmCreated] = await Promise.all([
        syncFinancialNotifications(),
        syncCrmNotifications()
      ]);
      const emailDigest = await sendDailyNotificationEmails();
      emitStructuredLog(emailDigest.failed ? "warn" : "info", "cron_completed", {
        durationMs: Math.round(performance.now() - startedAt),
        status: emailDigest.failed ? "partial" : "success",
        errorCode: emailDigest.failed ? "NOTIFICATION_EMAIL_PARTIAL_FAILURE" : undefined,
        metrics: {
          createdCount: financialCreated + crmCreated,
          sentCount: emailDigest.sent,
          failedCount: emailDigest.failed
        }
      });
      return NextResponse.json({ ok: true, financialCreated, crmCreated, emailDigest });
    } catch (error) {
      emitStructuredLog("error", "cron_failed", {
        durationMs: Math.round(performance.now() - startedAt),
        status: 500,
        errorCode: safeErrorCode(error, "NOTIFICATION_SYNC_FAILED")
      });
      return NextResponse.json({ error: "Sincronizarea notificarilor a esuat." }, { status: 500 });
    }
  });
}
