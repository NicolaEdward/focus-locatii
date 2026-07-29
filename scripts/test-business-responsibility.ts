import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  operationalBusinessOwner,
  operationalBusinessOwnerAssignedWhere,
  operationalBusinessOwnerWhere
} from "../src/lib/operational-responsibility";
import {
  receivableOwnerUserIds,
  receivableOwnershipWhere,
  receivableResponsibleUser
} from "../src/lib/receivables-ownership";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

assert.deepEqual(receivableResponsibleUser({
  clientId: "client-1",
  client: {
    accountOwnerUserId: "seller-client",
    accountOwner: { id: "seller-client", name: "Seller Client" }
  }
}), { id: "seller-client", name: "Seller Client" });
assert.deepEqual(receivableOwnerUserIds({
  clientId: "client-1",
  client: { accountOwnerUserId: "seller-client" }
}), ["seller-client"]);
assert.equal(receivableResponsibleUser({ clientId: null, client: null }), null);
assert.deepEqual(receivableOwnershipWhere("seller-client"), {
  client: { is: { accountOwnerUserId: "seller-client" } }
});

assert.deepEqual(operationalBusinessOwner({
  reservation: {
    client: {
      accountOwnerUserId: "seller-client",
      accountOwner: { id: "seller-client", name: "Seller Client" }
    },
    campaign: {
      client: {
        accountOwnerUserId: "seller-campaign",
        accountOwner: { id: "seller-campaign", name: "Seller Campaign" }
      }
    }
  },
  campaign: {
    client: {
      accountOwnerUserId: "seller-task-campaign",
      accountOwner: { id: "seller-task-campaign", name: "Seller Task Campaign" }
    }
  }
}), { id: "seller-task-campaign", name: "Seller Task Campaign" });
assert.deepEqual(operationalBusinessOwner({
  reservation: {
    client: null,
    campaign: {
      client: {
        accountOwnerUserId: "seller-campaign",
        accountOwner: { id: "seller-campaign", name: "Seller Campaign" }
      }
    }
  }
}), { id: "seller-campaign", name: "Seller Campaign" });
assert.equal(operationalBusinessOwner({ reservation: { client: null, campaign: null }, campaign: null }), null);
assert.deepEqual(operationalBusinessOwnerWhere("seller-client"), {
  OR: [
    {
      campaign: {
        is: { client: { is: { accountOwnerUserId: "seller-client" } } }
      }
    },
    {
      campaignId: null,
      reservation: {
        is: {
          campaign: {
            is: { client: { is: { accountOwnerUserId: "seller-client" } } }
          }
        }
      }
    },
    {
      campaignId: null,
      reservation: {
        is: {
          campaignId: null,
          client: { is: { accountOwnerUserId: "seller-client" } }
        }
      }
    }
  ]
});
assert(operationalBusinessOwnerAssignedWhere().OR?.length === 3);

const notifications = read("src/lib/notifications.ts");
const salesDashboard = read("src/lib/dashboard/sales-dashboard.ts");
const receivablesWorkspace = read("src/lib/receivables-workspace-service.ts");
const documentAccess = read("src/lib/client-document-access.ts");
const operationalAssignment = read("src/lib/operational-assignment.ts");
const assignmentUi = read("src/components/admin/OperationalAssignmentBoard.tsx");
const fieldInbox = read("src/components/admin/FieldWorkInbox.tsx");
const completionRoute = read("src/app/api/admin/operational/tasks/complete/route.ts");
const executivePeople = read("src/lib/dashboard/executive/refinement.ts");

assert(notifications.includes("receivableResponsibleUserId(row)"), "financial reminders must use the client seller");
assert(salesDashboard.includes("receivableOwnershipWhere(ownerId)"), "sales invoice scope must use the canonical client seller");
assert(receivablesWorkspace.includes("responsibleUser: row.client?.accountOwner"), "invoice registry must expose the live client seller");
assert(!documentAccess.includes("financialReceivable.accountOwnerUserId"), "invoice documents must not trust the receivable owner snapshot");
assert(operationalAssignment.includes("businessOwner: businessOwner"), "operational DTO must separate business owner from field executor");
assert(operationalAssignment.includes("operationalBusinessOwner(task)?.id === session.id"), "seller task access must use the campaign client owner");
assert(assignmentUi.includes("Responsabil client") && assignmentUi.includes("Executor:"), "operations UI must name both responsibilities");
assert(fieldInbox.includes("Executat de:"), "field history must expose the execution actor");
assert(completionRoute.includes("completedByUserId: session.id"), "completion must preserve the actual executor identity");
assert(completionRoute.includes("relationalTask?.assignedToUserId === session.id"), "a Field Operator cannot complete another executor's task");
assert(completionRoute.includes("hasPlannedFieldExecutor"), "a planned field task can only be completed by its executor");
assert(completionRoute.includes("recipientUserIds: [businessOwner?.id, relationalTask?.assignedToUserId]"), "completion notifications must use seller and executor");
assert(executivePeople.includes("operationalBusinessOwner(task)"), "People Overview must attribute task responsibility to the client seller");

console.log(JSON.stringify({
  ok: true,
  checks: 21,
  policy: {
    invoices: "client.accountOwnerUserId",
    operationalResponsibility: "task campaign client, then reservation campaign client, then legacy reservation client",
    fieldExecution: "OperationTask.assignedToUserId + proof/audit completion actor"
  }
}, null, 2));
