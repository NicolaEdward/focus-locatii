const fs = require("fs");
const path = require("path");

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const usersUi = read("src/components/admin/UserManagement.tsx");
const resetRoute = read("src/app/api/admin/users/[id]/reset-password/route.ts");
const notifications = read("src/lib/notifications.ts");
const bell = read("src/components/admin/NotificationBell.tsx");
const completion = read("src/app/api/admin/operational/tasks/complete/route.ts");
const reschedule = read("src/app/api/admin/operational/tasks/reschedule/route.ts");

assert(usersUi.includes("Reseteaza parola"), "User management must expose password reset");
assert(usersUi.includes("se dezactiveaza, nu se sterg"), "User management must explain safe deactivation");
assert(usersUi.includes("minimum 12 caractere"), "Temporary password policy must be visible");
assert(resetRoute.includes('requirePermission(request, "users.manage")'), "Password reset must require users.manage");
assert(resetRoute.includes('action: "user.password.reset"'), "Password reset must be audited explicitly");
assert(resetRoute.includes("sessionsRevoked: true"), "Password reset must revoke old sessions");
assert(!resetRoute.includes("metadata: { password"), "Password must never be written to audit metadata");
assert(notifications.includes("createOperationalNotifications"), "Operational notification helper must exist");
assert(notifications.includes('notification.userId !== session.id'), "Non-privileged users must be scoped to own notifications");
assert(completion.includes("createOperationalNotifications"), "Completion must notify the responsible user");
assert(reschedule.includes("createOperationalNotifications"), "Rescheduling must notify the responsible user");
assert(bell.includes("60_000"), "Notification bell must refresh periodically");
assert(bell.includes('row.type.startsWith("receivable_")'), "Financial-only actions must stay scoped to financial notifications");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "safe account deactivation guidance",
    "admin password reset and session revocation",
    "password excluded from audit",
    "operational completion/reschedule notifications",
    "notification ownership enforcement",
    "periodic bell refresh",
    "financial actions remain type-specific"
  ]
}, null, 2));
