"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  FileSpreadsheet,
  Hammer,
  Image as ImageIcon,
  MapPinned,
  Pencil,
  RefreshCcw,
  Save,
  Search,
  Trash2,
  Undo2,
  Upload,
  XCircle
} from "lucide-react";
import { AdminSalesMap } from "@/components/admin/AdminSalesMap";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { LocationDTO, OfferRequestDTO, OfferRequestStatus, ReservationDTO, ReservationStatus } from "@/types/location";
import { calculateAvailability } from "@/lib/availability";
import {
  isOperationActive,
  operationExtraTasks,
  operationCost,
  latestOperationDelayChange,
  operationStatus,
  operationStatusLabel,
  operationUpdatedAt,
  stripOperationMeta,
  withOperationCost,
  type OperationExtraTask,
  type OperationKind,
  type OperationStatus
} from "@/lib/operation-status";
import type { AuthSession } from "@/lib/auth";
import { hasAnyPermission, hasPermission } from "@/lib/rbac";
import { allowedReservationTransitions } from "@/lib/reservation-workflow";
import { companyEntities, normalizeCompanyEntity } from "@/lib/company-entities";
import { DECORATION_LOOKAHEAD_DAYS, NEUTRALIZATION_LOOKAHEAD_DAYS, OPERATION_HISTORY_DAYS } from "@/lib/operation-schedule";
import { canCompleteOperationalReservation, canRescheduleOperationalReservation } from "@/lib/operational-proof";
import { calculateProrata } from "@/lib/prorata";
import {
  buildDecorationBillingReport,
  decorationBillingCsv,
  decorationBillingFileName,
  type DecorationBillingReport
} from "@/lib/decoration-billing";

type AdminPanel = "sales" | "future" | "decorations" | "neutralizations";
type ReservationListSort = "created" | "start";
type ReservationsWorkspace = "locations" | "operational";

type SellerUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type ClientOption = {
  id: string;
  companyName: string;
  accountOwnerUserId?: string | null;
};

type CampaignOption = {
  id: string;
  campaignName: string;
  clientId: string;
  status: string;
  companyEntity?: string | null;
  currency?: string | null;
  paymentTermType?: string | null;
  paymentTermDays?: number | null;
  billingRule?: string | null;
  billingFrequency?: string | null;
};

type OperationTableTask = {
  reservation: ReservationDTO;
  taskDate: string;
  operationStatus: OperationStatus;
  taskId?: string | null;
  taskType?: string | null;
  note?: string | null;
  cost?: number | null;
  currency?: string | null;
  finalizationDate?: string | null;
  dedupeKey?: string | null;
};

type OperationCompletionTarget = OperationTableTask & {
  type: OperationKind;
};

type OperationRescheduleInput = {
  newStartDate: string;
  reason: string;
  note?: string | null;
  confirmed: boolean;
};

type ReservationForm = {
  locationIds: string[];
  clientId: string;
  campaignId: string;
  status: ReservationStatus;
  clientName: string;
  clientCompany: string;
  contractCompany: string;
  clientEmail: string;
  clientPhone: string;
  campaignName: string;
  contractNumber: string;
  salesperson: string;
  sellerUserId: string;
  monthlyRentTotal: string;
  currency: string;
  paymentTermType: string;
  paymentTermDays: string;
  customPaymentTermNote: string;
  billingRule: string;
  billingDayOfMonth: string;
  customBillingDate: string;
  billingFrequency: string;
  invoiceGenerationMode: string;
  billingNotes: string;
  needsDecoration: boolean;
  decorationCost: string;
  decorationCurrency: string;
  periodStart: string;
  periodEnd: string;
  productionNotes: string;
  notes: string;
};

type ReservationEditForm = {
  clientId: string;
  campaignId: string;
  clientName: string;
  clientCompany: string;
  contractCompany: string;
  clientEmail: string;
  clientPhone: string;
  campaignName: string;
  contractNumber: string;
  salesperson: string;
  sellerUserId: string;
  amount: string;
  monthlyRentTotal: string;
  monthlyRentShare: string;
  currency: string;
  paymentTermType: string;
  paymentTermDays: string;
  customPaymentTermNote: string;
  billingRule: string;
  billingDayOfMonth: string;
  customBillingDate: string;
  billingFrequency: string;
  invoiceGenerationMode: string;
  billingNotes: string;
  periodStart: string;
  periodEnd: string;
  installationDate: string;
  decorationCost: string;
  decorationCurrency: string;
  neutralizationDate: string;
  productionNotes: string;
  notes: string;
  applyToGroup: boolean;
};

type ReservationConflictPreview = {
  key: string;
  conflicts: Array<{
    reservationId: string;
    locationId: string;
    locationCode: string | null;
    clientName: string | null;
    campaignName: string | null;
    status: string;
    periodStart: string;
    periodEnd: string;
  }>;
  warnings: Array<{
    locationId: string;
    locationCode: string | null;
    message: string;
  }>;
};

type ReservationCancellationDecision = {
  applyToGroup: boolean;
  reason: string;
};

const emptyForm: ReservationForm = {
  locationIds: [],
  clientId: "",
  campaignId: "",
  status: "RESERVED",
  clientName: "",
  clientCompany: "",
  contractCompany: "",
  clientEmail: "",
  clientPhone: "",
  campaignName: "",
  contractNumber: "",
  salesperson: "",
  sellerUserId: "",
  monthlyRentTotal: "",
  currency: "EUR",
  paymentTermType: "30_days",
  paymentTermDays: "30",
  customPaymentTermNote: "",
  billingRule: "month_start",
  billingDayOfMonth: "1",
  customBillingDate: "",
  billingFrequency: "monthly",
  invoiceGenerationMode: "manual",
  billingNotes: "",
  needsDecoration: false,
  decorationCost: "",
  decorationCurrency: "EUR",
  periodStart: "",
  periodEnd: "",
  productionNotes: "",
  notes: ""
};

const activeReservationStatuses: ReservationStatus[] = ["HOLD", "RESERVED", "BOOKED"];
const requestStatuses: OfferRequestStatus[] = ["NEW", "CONTACTED", "ARCHIVED"];

export function AdminReservationsPanel({
  locations,
  initialReservations,
  operationReservations,
  initialOfferRequests,
  onLocationsUpdated,
  session,
  workspace = "locations"
}: {
  locations: LocationDTO[];
  initialReservations: ReservationDTO[];
  operationReservations?: ReservationDTO[];
  initialOfferRequests: OfferRequestDTO[];
  onLocationsUpdated?: (locations: LocationDTO[]) => void;
  session: AuthSession;
  workspace?: ReservationsWorkspace;
}) {
  const searchParams = useSearchParams();
  const isOperationalWorkspace = workspace === "operational";
  const isFieldOperator = session.role === "FIELD_OPERATOR";
  const focusedReservationId = searchParams.get("reservationId");
  const requestedPanel = panelFromQuery(searchParams.get("panel"));
  const shouldFocusNewReservation = searchParams.get("newReservation") === "1";
  const initialForm = { ...emptyForm, salesperson: session.name, sellerUserId: session.id };
  const canManageAllReservations = hasPermission(session.role, "reservations.manage");
  const canAssignOtherSeller = ["SALES_DIRECTOR", "COO", "SUPER_ADMIN"].includes(session.role);
  const canApproveReservations = hasPermission(session.role, "proposals.approve") || session.role === "COO" || session.role === "SUPER_ADMIN";
  const canUpdateOperationStatus = hasPermission(session.role, "campaigns.operate");
  const canManageLeads = hasAnyPermission(session.role, ["leads.manage", "leads.manage.own"]);
  const canEditReservations = hasAnyPermission(session.role, ["reservations.manage", "reservations.manage.own"]);
  const shouldLoadReservationOptions = !isOperationalWorkspace && canEditReservations;
  const canCreateBookedReservation = canEditReservations || canApproveReservations;
  const canEditOperationTask = useCallback(
    (reservation: ReservationDTO) => canEditOperationalReservation(reservation, session),
    [session]
  );
  const canRescheduleOperationTask = useCallback(
    (reservation: ReservationDTO) => canRescheduleOperationalReservation(session, reservation),
    [session]
  );
  const [activePanel, setActivePanel] = useState<AdminPanel>(
    isOperationalWorkspace ? (isFieldOperator ? "decorations" : "future") : "sales"
  );
  const [reservations, setReservations] = useState(initialReservations);
  const [offerRequests, setOfferRequests] = useState(initialOfferRequests);
  const [form, setForm] = useState<ReservationForm>(initialForm);
  const [sellers, setSellers] = useState<SellerUser[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [editCampaigns, setEditCampaigns] = useState<CampaignOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [editClientSearch, setEditClientSearch] = useState("");
  const [assignOtherSeller, setAssignOtherSeller] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [reservationSearch, setReservationSearch] = useState("");
  const [reservationSort, setReservationSort] = useState<ReservationListSort>("created");
  const [salesLogMonth, setSalesLogMonth] = useState(currentMonthInputValue);
  const [showReservationLog, setShowReservationLog] = useState(false);
  const [decorationBillingMonth, setDecorationBillingMonth] = useState(currentMonthInputValue);
  const [requestStatusFilter, setRequestStatusFilter] = useState("");
  const [requestOwnerFilter, setRequestOwnerFilter] = useState("");
  const [requestOwnerName, setRequestOwnerName] = useState("");
  const [showOperationHistory, setShowOperationHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingReservation, setEditingReservation] = useState<ReservationDTO | null>(null);
  const [editForm, setEditForm] = useState<ReservationEditForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [archiveOfferRequestId, setArchiveOfferRequestId] = useState<string | null>(null);
  const [cancellationTarget, setCancellationTarget] = useState<ReservationDTO | null>(null);
  const [completionTarget, setCompletionTarget] = useState<OperationCompletionTarget | null>(null);
  const [completionFiles, setCompletionFiles] = useState<File[]>([]);
  const [completionNote, setCompletionNote] = useState("");
  const [completionSaving, setCompletionSaving] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<OperationCompletionTarget | null>(null);
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [proofTarget, setProofTarget] = useState<OperationCompletionTarget | null>(null);

  useEffect(() => {
    if (!shouldLoadReservationOptions) {
      setSellers([]);
      setClients([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/sellers", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch("/api/admin/clients", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
    ])
      .then(([sellerPayload, clientPayload]) => {
        if (cancelled) return;
        if (sellerPayload?.sellers) setSellers(sellerPayload.sellers);
        if (clientPayload?.clients) setClients(clientPayload.clients);
      })
      .catch(() => {
        if (!cancelled) {
          setSellers([]);
          setClients([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shouldLoadReservationOptions]);

  useEffect(() => {
    if (requestedPanel && panelAllowedInWorkspace(requestedPanel, workspace, isFieldOperator)) {
      setActivePanel(requestedPanel);
    }
  }, [isFieldOperator, requestedPanel, workspace]);

  useEffect(() => {
    if (!shouldFocusNewReservation || isOperationalWorkspace) return;
    setActivePanel("sales");
    setMessage("Completeaza formularul pentru o rezervare noua.");
  }, [isOperationalWorkspace, shouldFocusNewReservation]);

  useEffect(() => {
    if (!focusedReservationId || isOperationalWorkspace) return;
    const reservation = reservations.find((item) => item.id === focusedReservationId);
    setActivePanel("sales");
    setShowReservationLog(true);
    if (!reservation) {
      setReservationSearch(focusedReservationId);
      setMessage("Rezervarea cautata nu este vizibila in lista curenta.");
      return;
    }
    setReservationSearch(
      reservation.locationCode ||
      reservation.clientName ||
      reservation.campaignName ||
      reservation.contractNumber ||
      focusedReservationId
    );
    if (reservation.status === "BOOKED") {
      setSalesLogMonth(monthInputValueFromDate(reservation.bookedAt || reservation.createdAt || reservation.periodStart));
    }
    setMessage(`Rezervarea ${reservation.locationCode || reservation.id} este filtrata in lista.`);
  }, [focusedReservationId, isOperationalWorkspace, reservations]);

  useEffect(() => {
    if (!form.clientId) {
      setCampaigns([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/campaigns?clientId=${encodeURIComponent(form.clientId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled) setCampaigns(payload?.campaigns || []);
      })
      .catch(() => {
        if (!cancelled) setCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.clientId]);

  useEffect(() => {
    if (!editForm?.clientId) {
      setEditCampaigns([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/campaigns?clientId=${encodeURIComponent(editForm.clientId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled) setEditCampaigns(payload?.campaigns || []);
      })
      .catch(() => {
        if (!cancelled) setEditCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [editForm?.clientId]);

  const locationsById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);

  const sortedLocations = useMemo(
    () =>
      [...locations].sort((a, b) =>
        `${a.city || ""} ${a.code}`.localeCompare(`${b.city || ""} ${b.code}`, "ro", { sensitivity: "base" })
      ),
    [locations]
  );
  const locationChoices = useMemo(() => {
    const search = locationSearch.toLowerCase();
    return sortedLocations
      .filter((location) => {
        if (!search) return true;
        const haystack = [
          location.code,
          location.city,
          location.county,
          location.address,
          location.type,
          location.categoryName,
          location.availabilityLabel,
          location.availabilityDetail
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      })
      .slice(0, 80);
  }, [locationSearch, sortedLocations]);

  const selectedLocations = useMemo(
    () => form.locationIds.map((id) => locationsById.get(id)).filter(Boolean) as LocationDTO[],
    [form.locationIds, locationsById]
  );

  const clientChoices = useMemo(() => {
    const search = clientSearch.trim().toLowerCase();
    return clients
      .filter((client) => !search || client.companyName.toLowerCase().includes(search))
      .slice(0, 120);
  }, [clientSearch, clients]);

  const editClientChoices = useMemo(() => {
    const search = editClientSearch.trim().toLowerCase();
    const filtered = clients
      .filter((client) => !search || client.companyName.toLowerCase().includes(search))
      .slice(0, 120);
    const selected = clients.find((client) => client.id === editForm?.clientId);
    if (selected && !filtered.some((client) => client.id === selected.id)) {
      return [selected, ...filtered];
    }
    return filtered;
  }, [clients, editClientSearch, editForm?.clientId]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === form.clientId) || null,
    [clients, form.clientId]
  );

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === form.campaignId) || null,
    [campaigns, form.campaignId]
  );

  const selectedRentShare = useMemo(() => {
    const total = Number(form.monthlyRentTotal.replace(",", "."));
    if (!Number.isFinite(total) || !selectedLocations.length) return null;
    return total / selectedLocations.length;
  }, [form.monthlyRentTotal, selectedLocations.length]);

  const reservationFormDirty = useMemo(() => isReservationFormDirty(form, initialForm), [form, initialForm]);
  const reservationFormPeriodError = useMemo(() => reservationPeriodError(form.periodStart, form.periodEnd), [form.periodEnd, form.periodStart]);

  const locationStats = useMemo(
    () => ({
      total: locations.length,
      available: locations.filter((location) => location.publicStatus === "AVAILABLE" && !location.availabilityDetail).length,
      futureBooked: locations.filter((location) => location.publicStatus === "AVAILABLE" && Boolean(location.availabilityDetail)).length,
      holds: locations.filter((location) => location.publicStatus === "RESERVED").length,
      occupied: locations.filter((location) => location.publicStatus === "BOOKED").length
    }),
    [locations]
  );

  const monthlySales = useMemo(() => {
    const range = monthInputRange(salesLogMonth);
    const search = reservationSearch.toLowerCase();

    return reservations
      .filter((reservation) => {
        if (reservation.status !== "BOOKED" || !range || !reservation.bookedAt) return false;
        const bookedAt = new Date(reservation.bookedAt);
        if (bookedAt < range.from || bookedAt > range.to) return false;
        const location = locationsById.get(reservation.locationId);
        const haystack = [
          reservation.locationCode,
          reservation.clientName,
          reservation.clientCompany,
          reservation.contractCompany,
          reservation.campaignName,
          reservation.contractNumber,
          reservation.salesperson,
          location?.city,
          location?.county,
          location?.address,
          location?.type
        ]
          .join(" ")
          .toLowerCase();

        if (search && !haystack.includes(search)) return false;
        return true;
      })
      .sort((a, b) => {
        if (reservationSort === "start") {
          return new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime();
        }
        return reservationBookedAt(b) - reservationBookedAt(a);
      });
  }, [locationsById, reservationSearch, reservationSort, reservations, salesLogMonth]);

  const activeHolds = useMemo(
    () =>
      reservations
        .filter((reservation) => ["HOLD", "RESERVED"].includes(reservation.status))
        .filter((reservation) => !reservation.holdExpiresAt || new Date(reservation.holdExpiresAt) > new Date())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reservations]
  );

  const today = useMemo(() => startOfUtcDay(new Date()), []);

  const activeRentals = useMemo(() => {
    const search = reservationSearch.toLowerCase();
    return reservations
      .filter((reservation) => reservation.status === "BOOKED")
      .filter((reservation) => new Date(reservation.periodStart) <= today && new Date(reservation.periodEnd) >= today)
      .filter((reservation) => {
        const location = locationsById.get(reservation.locationId);
        const haystack = [
          reservation.locationCode,
          reservation.clientName,
          reservation.clientCompany,
          reservation.contractCompany,
          reservation.campaignName,
          reservation.contractNumber,
          reservation.salesperson,
          location?.city,
          location?.county,
          location?.address,
          location?.type
        ]
          .join(" ")
          .toLowerCase();
        return !search || haystack.includes(search);
      })
      .sort((a, b) => new Date(a.periodEnd).getTime() - new Date(b.periodEnd).getTime());
  }, [locationsById, reservationSearch, reservations, today]);

  const editingGroupCount = useMemo(() => {
    if (!editingReservation?.contractGroupId) return 1;
    return reservations.filter((reservation) => reservation.contractGroupId === editingReservation.contractGroupId).length;
  }, [editingReservation, reservations]);

  const editingGroupLocations = useMemo(() => {
    if (!editingReservation?.contractGroupId) return [];
    return reservations
      .filter((reservation) => reservation.contractGroupId === editingReservation.contractGroupId)
      .map((reservation) => reservation.locationCode || locationsById.get(reservation.locationId)?.code || reservation.locationId);
  }, [editingReservation, locationsById, reservations]);

  const editingGroupLocationIds = useMemo(() => {
    if (!editingReservation?.contractGroupId) return [];
    return reservations
      .filter((reservation) => reservation.contractGroupId === editingReservation.contractGroupId)
      .map((reservation) => reservation.locationId);
  }, [editingReservation, reservations]);

  const operationalReservations = isOperationalWorkspace ? reservations : operationReservations?.length ? operationReservations : reservations;

  const operationsWindowStart = useMemo(() => addDays(today, -OPERATION_HISTORY_DAYS), [today]);
  const decorationWindowEnd = useMemo(() => addDays(today, DECORATION_LOOKAHEAD_DAYS), [today]);
  const neutralizationWindowEnd = useMemo(() => addDays(today, NEUTRALIZATION_LOOKAHEAD_DAYS), [today]);

  const futureReservations = useMemo(
    () =>
      reservations
        .filter((reservation) => activeReservationStatuses.includes(reservation.status) && new Date(reservation.periodStart) >= today)
        .sort((a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime()),
    [reservations, today]
  );

  const allDecorationTasks = useMemo(
    () => operationalReservations.flatMap((reservation) => decorationOperationTasks(reservation)),
    [operationalReservations]
  );

  const decorationTasks = useMemo(
    () =>
      allDecorationTasks
        .filter(
          ({ reservation, taskDate, operationStatus: status }) =>
            activeReservationStatuses.includes(reservation.status) &&
            (showOperationHistory
              ? !isOperationActive(status)
              : isOperationActive(status) && new Date(taskDate) >= operationsWindowStart && new Date(taskDate) <= decorationWindowEnd)
        )
        .sort((a, b) => new Date(a.taskDate).getTime() - new Date(b.taskDate).getTime()),
    [allDecorationTasks, decorationWindowEnd, operationsWindowStart, showOperationHistory]
  );

  const decorationBillingReport = useMemo(
    () => buildDecorationBillingReport(allDecorationTasks, decorationBillingMonth),
    [allDecorationTasks, decorationBillingMonth]
  );

  const neutralizationTasks = useMemo(
    () =>
      operationalReservations
        .flatMap((reservation): OperationTableTask[] => {
          const baseStatus = operationStatus(reservation.productionNotes, "neutralization");
          return [
            {
              reservation,
              taskDate: reservation.neutralizationDate || reservation.periodEnd,
              operationStatus: baseStatus,
              taskType: "final",
              note: stripOperationMeta(reservation.productionNotes)
            },
            ...operationExtraTasks(reservation.productionNotes, "neutralization").map((task) => extraOperationTask(reservation, task))
          ];
        })
        .filter(
          ({ reservation, taskDate, operationStatus: status }) =>
            activeReservationStatuses.includes(reservation.status) &&
            (showOperationHistory
              ? !isOperationActive(status)
              : isOperationActive(status) && new Date(taskDate) >= operationsWindowStart && new Date(taskDate) <= neutralizationWindowEnd)
        )
        .sort((a, b) => new Date(a.taskDate).getTime() - new Date(b.taskDate).getTime()),
    [neutralizationWindowEnd, operationalReservations, operationsWindowStart, showOperationHistory]
  );

  const toggleLocation = useCallback((location: LocationDTO) => {
    setForm((current) => {
      const isSelected = current.locationIds.includes(location.id);
      return {
        ...current,
        locationIds: isSelected
          ? current.locationIds.filter((id) => id !== location.id)
          : [...current.locationIds, location.id]
      };
    });
  }, []);

  const clearSelectedLocations = useCallback(() => {
    setForm((current) => ({ ...current, locationIds: [] }));
  }, []);

  function resetReservationForm() {
    setForm(initialForm);
    setAssignOtherSeller(false);
    setResetConfirmOpen(false);
  }

  function requestReservationFormReset() {
    if (reservationFormDirty) {
      setResetConfirmOpen(true);
      return;
    }
    resetReservationForm();
  }

  async function createReservation() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const decorationCost = form.needsDecoration ? moneyInputValue(form.decorationCost) : null;
      if (form.status === "BOOKED" && form.needsDecoration && decorationCost == null) {
        throw new Error("Completeaza costul de montaj/decorare pentru taskul operational.");
      }
      const productionNotes = form.status === "BOOKED" && form.needsDecoration
        ? withOperationCost(form.productionNotes, "decoration", decorationCost, form.decorationCurrency)
        : form.productionNotes;
      const payloadBody = {
        ...form,
        clientId: form.status === "BOOKED" ? form.clientId : null,
        campaignId: form.status === "BOOKED" ? form.campaignId : null,
        clientName: form.status === "BOOKED" ? selectedClient?.companyName || "" : form.clientName,
        clientCompany: form.status === "BOOKED" ? selectedClient?.companyName || "" : form.clientCompany,
        campaignName: form.status === "BOOKED" ? selectedCampaign?.campaignName || "" : form.campaignName,
        installationDate: form.status === "BOOKED" && form.needsDecoration ? form.periodStart : null,
        neutralizationDate: form.status === "BOOKED" ? form.periodEnd : null,
        productionNotes,
        sellerUserId: assignOtherSeller ? form.sellerUserId : session.id,
        salesperson: assignOtherSeller
          ? sellers.find((seller) => seller.id === form.sellerUserId)?.name || form.salesperson
          : session.name,
        locationId: form.locationIds[0],
        amount: form.monthlyRentTotal,
        locationIds: form.locationIds,
        invoiceGenerationMode: "manual"
      };
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadBody)
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Rezervarea nu a putut fi salvata.");
      }

      const createdReservations = Array.isArray(payload.reservations)
        ? payload.reservations
        : payload.reservation
          ? [payload.reservation]
          : [];

      setReservations((current) => [...createdReservations, ...current]);
      resetReservationForm();
      setLocationSearch("");
      setMessage(
        createdReservations.length > 1
          ? `Contractul a fost salvat pe ${createdReservations.length} locatii. Chiria a fost impartita automat.`
          : "Rezervarea a fost salvata si disponibilitatea s-a recalculat."
      );
      await refreshLocations();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Rezervarea nu a putut fi salvata.");
    } finally {
      setSaving(false);
    }
  }

  function openReservationEditor(reservation: ReservationDTO) {
    setError(null);
    setMessage(null);
    setEditingReservation(reservation);
    setEditClientSearch("");
    const decorationCost = operationCost(reservation.productionNotes, "decoration");
    setEditForm({
      clientId: reservation.clientId || "",
      campaignId: reservation.campaignId || "",
      clientName: reservation.clientName || "",
      clientCompany: reservation.clientCompany || "",
      contractCompany: normalizeCompanyEntity(reservation.contractCompany) || "",
      clientEmail: reservation.clientEmail || "",
      clientPhone: reservation.clientPhone || "",
      campaignName: reservation.campaignName || "",
      contractNumber: reservation.contractNumber || "",
      salesperson: reservation.salesperson || "",
      sellerUserId: reservation.sellerUserId || reservation.ownerId || "",
      amount: numberInputValue(reservation.amount),
      monthlyRentTotal: numberInputValue(reservation.monthlyRentTotal),
      monthlyRentShare: numberInputValue(reservation.monthlyRentShare),
      currency: reservation.currency || "EUR",
      paymentTermType: reservation.paymentTermType || "30_days",
      paymentTermDays: numberInputValue(reservation.paymentTermDays ?? 30),
      customPaymentTermNote: reservation.customPaymentTermNote || "",
      billingRule: reservation.billingRule || "month_start",
      billingDayOfMonth: numberInputValue(reservation.billingDayOfMonth ?? 1),
      customBillingDate: dateInputValue(reservation.customBillingDate),
      billingFrequency: reservation.billingFrequency || "monthly",
      invoiceGenerationMode: reservation.invoiceGenerationMode || "manual",
      billingNotes: reservation.billingNotes || "",
      periodStart: dateInputValue(reservation.periodStart),
      periodEnd: dateInputValue(reservation.periodEnd),
      installationDate: dateInputValue(reservation.installationDate),
      decorationCost: numberInputValue(decorationCost.cost),
      decorationCurrency: decorationCost.currency || reservation.currency || "EUR",
      neutralizationDate: dateInputValue(reservation.neutralizationDate),
      productionNotes: reservation.productionNotes || "",
      notes: reservation.notes || "",
      applyToGroup: Boolean(reservation.contractGroupId)
    });
  }

  function closeReservationEditor() {
    if (editing) return;
    setEditingReservation(null);
    setEditForm(null);
  }

  async function saveEditedReservation() {
    if (!editingReservation || !editForm) return;

    setEditing(true);
    setError(null);
    setMessage(null);

    try {
      const groupReservations =
        editForm.applyToGroup && editingReservation.contractGroupId
          ? reservations.filter((reservation) => reservation.contractGroupId === editingReservation.contractGroupId)
          : [editingReservation];
      const groupShare = editForm.applyToGroup ? rentShareInputValue(editForm.monthlyRentTotal, groupReservations.length) : null;

      const updates: ReservationDTO[] = [];
      const buildBody = (reservation: ReservationDTO) => {
        return {
          clientName: editForm.clientName,
          clientId: editForm.clientId,
          campaignId: editForm.campaignId,
          clientCompany: editForm.clientCompany,
          clientEmail: editForm.clientEmail,
          clientPhone: editForm.clientPhone,
          campaignName: editForm.campaignName,
          contractCompany: editForm.contractCompany,
          contractNumber: editForm.contractNumber,
          sellerUserId: session.role === "SALES_AGENT" ? reservation.sellerUserId : editForm.sellerUserId,
          salesperson: session.role === "SALES_AGENT"
            ? reservation.salesperson
            : sellers.find((seller) => seller.id === editForm.sellerUserId)?.name || editForm.salesperson,
          amount: groupShare ?? editForm.amount,
          monthlyRentTotal: editForm.monthlyRentTotal,
          monthlyRentShare: groupShare ?? editForm.monthlyRentShare,
          currency: editForm.currency,
          paymentTermType: editForm.paymentTermType,
          paymentTermDays: editForm.paymentTermDays,
          customPaymentTermNote: editForm.customPaymentTermNote,
          billingRule: editForm.billingRule,
          billingDayOfMonth: editForm.billingDayOfMonth,
          customBillingDate: editForm.customBillingDate,
          billingFrequency: editForm.billingFrequency,
          invoiceGenerationMode: editForm.invoiceGenerationMode,
          billingNotes: editForm.billingNotes,
          periodStart: editForm.periodStart,
          periodEnd: editForm.periodEnd,
          installationDate: editForm.installationDate,
          neutralizationDate: editForm.neutralizationDate,
          productionNotes: withOperationCost(editForm.productionNotes, "decoration", moneyInputValue(editForm.decorationCost), editForm.decorationCurrency),
          notes: editForm.notes
        };
      };

      if (editForm.applyToGroup && editingReservation.contractGroupId) {
        const response = await fetch(`/api/reservations/${editingReservation.id}/group`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildBody(editingReservation))
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Contractul nu a putut fi actualizat.");
        }

        if (Array.isArray(payload.reservations)) updates.push(...payload.reservations);
        else if (payload.reservation) updates.push(payload.reservation);
      } else {
        for (const reservation of groupReservations) {
          const body = buildBody(reservation);

          const response = await fetch(`/api/reservations/${reservation.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          });
          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error || "Inchirierea nu a putut fi actualizata.");
          }

          if (payload.reservation) updates.push(payload.reservation);
        }
      }

      const updatesById = new Map(updates.map((reservation) => [reservation.id, reservation]));
      setReservations((current) => current.map((reservation) => updatesById.get(reservation.id) || reservation));
      setMessage(
        updates.length > 1
          ? `Contractul a fost actualizat pe ${updates.length} locatii.`
          : "Inchirierea a fost actualizata."
      );
      setEditingReservation(null);
      setEditForm(null);
      await refreshLocations();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Inchirierea nu a putut fi actualizata.");
    } finally {
      setEditing(false);
    }
  }

  async function updateReservationStatus(id: string, status: ReservationStatus) {
    setError(null);
    const reservation = reservations.find((item) => item.id === id);
    let applyToGroup = false;
    let cancellationReason: string | null = null;
    if (status === "CANCELLED") {
      if (!reservation) {
        setError("Inregistrarea nu mai este disponibila.");
        return;
      }
      setCancellationTarget(reservation);
      return;
    } else {
      applyToGroup = Boolean(reservation?.contractGroupId);
    }
    const response = await fetch(`/api/reservations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, applyToGroup, cancellationReason })
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || "Statusul nu a putut fi actualizat.");
      return;
    }

    const updatedReservations = Array.isArray(payload.reservations) ? payload.reservations : [payload.reservation];
    const updatesById = new Map<string, ReservationDTO>(
      updatedReservations
        .filter(Boolean)
        .map((reservation: ReservationDTO) => [reservation.id, reservation] as [string, ReservationDTO])
    );
    setReservations((current) => current.map((reservation) => updatesById.get(reservation.id) || reservation));
    await refreshLocations();
  }

  async function updateOperationStatus(id: string, kind: OperationKind, status: OperationStatus, taskId?: string | null) {
    setError(null);
    const response = await fetch(`/api/reservations/${id}/operations`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, status, taskId })
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || "Statusul operational nu a putut fi actualizat.");
      return;
    }

    setReservations((current) => current.map((reservation) => (reservation.id === id ? payload.reservation : reservation)));
    setMessage(status === "DONE" ? "Taskul a fost marcat ca finalizat." : "Statusul operational a fost actualizat.");
  }

  function openOperationCompletion(target: OperationCompletionTarget) {
    setCompletionTarget(target);
    setCompletionFiles([]);
    setCompletionNote("");
    setError(null);
  }

  function closeOperationCompletion() {
    if (completionSaving) return;
    setCompletionTarget(null);
    setCompletionFiles([]);
    setCompletionNote("");
  }

  function openOperationProofPhotos(target: OperationCompletionTarget) {
    setProofTarget(target);
    setError(null);
  }

  function openOperationReschedule(target: OperationCompletionTarget) {
    setRescheduleTarget(target);
    setError(null);
  }

  async function rescheduleOperation(input: OperationRescheduleInput) {
    if (!rescheduleTarget) return;
    setRescheduleSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/operational/tasks/reschedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reservationId: rescheduleTarget.reservation.id,
          kind: rescheduleTarget.type,
          taskId: rescheduleTarget.taskId || null,
          newStartDate: input.newStartDate,
          reason: input.reason,
          note: input.note || null,
          confirmed: input.confirmed
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Data operationala nu a putut fi modificata.");
        return;
      }
      setReservations((current) => current.map((reservation) => (reservation.id === rescheduleTarget.reservation.id ? payload.reservation : reservation)));
      setMessage(payload.financeReviewRequired
        ? "Data a fost modificata. Exista impact financiar: verifica manual facturile."
        : "Data a fost modificata si motivul a fost salvat.");
      setRescheduleTarget(null);
    } catch (rescheduleError) {
      setError(rescheduleError instanceof Error ? rescheduleError.message : "Data operationala nu a putut fi modificata.");
    } finally {
      setRescheduleSaving(false);
    }
  }

  async function completeOperationWithProof() {
    if (!completionTarget) return;
    const existingPhotos = proofPhotosForTask(completionTarget.reservation, completionTarget.type, completionTarget.taskId);
    if (isFieldOperator && !existingPhotos.length && !completionFiles.length) {
      setError("Incarca cel putin o poza dovada pentru finalizare.");
      return;
    }
    setCompletionSaving(true);
    setError(null);
    const body = new FormData();
    body.set("reservationId", completionTarget.reservation.id);
    body.set("kind", completionTarget.type);
    if (completionTarget.taskId) body.set("taskId", completionTarget.taskId);
    if (completionNote.trim()) body.set("completionNote", completionNote.trim());
    for (const file of completionFiles) body.append("files", file);

    try {
      const response = await fetch("/api/admin/operational/tasks/complete", {
        method: "POST",
        body
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error || "Lucrarea nu a putut fi finalizata.");
        return;
      }

      setReservations((current) => current.map((reservation) => (reservation.id === completionTarget.reservation.id ? payload.reservation : reservation)));
      setMessage(
        completionFiles.length
          ? `Lucrarea a fost finalizata cu ${completionFiles.length} poza/poze dovada.`
          : "Lucrarea a fost marcata ca finalizata."
      );
      setCompletionTarget(null);
      setCompletionFiles([]);
      setCompletionNote("");
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Lucrarea nu a putut fi finalizata.");
    } finally {
      setCompletionSaving(false);
    }
  }

  function deleteReservation(id: string) {
    const reservation = reservations.find((item) => item.id === id);
    if (!reservation) {
      setError("Inregistrarea nu mai este disponibila.");
      return;
    }
    setCancellationTarget(reservation);
  }

  async function confirmReservationCancellation(decision: ReservationCancellationDecision) {
    if (!cancellationTarget) return;
    const response = await fetch(`/api/reservations/${cancellationTarget.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED", applyToGroup: decision.applyToGroup, cancellationReason: decision.reason })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error || "Inchirierea nu a putut fi anulata.");
      return;
    }
    setCancellationTarget(null);
    const updatedReservations = Array.isArray(payload?.reservations) ? payload.reservations : [payload?.reservation].filter(Boolean);
    const updatesById = new Map<string, ReservationDTO>(
      updatedReservations
        .filter(Boolean)
        .map((reservation: ReservationDTO) => [reservation.id, reservation] as [string, ReservationDTO])
    );
    setReservations((current) => current.map((reservation) => updatesById.get(reservation.id) || reservation));
    setMessage(updatedReservations.length > 1 ? `Contractul a fost anulat pe ${updatedReservations.length} locatii.` : "Inchirierea a fost anulata.");
    await refreshLocations();
  }

  async function updateOfferRequest(id: string, status: OfferRequestStatus, salesperson?: string) {
    const response = await fetch(`/api/offer-requests/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, salesperson })
    });
    const payload = await response.json();
    if (response.ok) {
      setOfferRequests((current) => current.map((request) => (request.id === id ? payload.request : request)));
    }
  }

  async function softDeleteOfferRequest(id: string) {
    setArchiveOfferRequestId(id);
  }

  async function confirmSoftDeleteOfferRequest() {
    if (!archiveOfferRequestId) return;
    const id = archiveOfferRequestId;
    const response = await fetch(`/api/offer-requests/${id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.request) {
      setOfferRequests((current) => current.map((request) => (request.id === id ? payload.request : request)));
      setArchiveOfferRequestId(null);
    } else {
      setError(payload?.error || "Solicitarea nu a putut fi arhivata.");
    }
  }

  async function refreshLocations() {
    if (!onLocationsUpdated) return;
    const response = await fetch(`/api/locations?scope=admin&ts=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (Array.isArray(payload.locations)) onLocationsUpdated(payload.locations);
  }

  async function syncReservations() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    setSyncSummary(null);

    try {
      const response = await fetch("/api/admin/reservations/sync", {
        method: "POST",
        headers: { "content-type": "application/json" }
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Sincronizarea nu a putut fi rulata.");
      }

      if (Array.isArray(payload.reservations)) {
        setReservations(payload.reservations);
      }

      const summary = payload.summary;
      if (summary?.disabled) {
        setSyncSummary(summary.message || "Sincronizarea legacy este dezactivata.");
        setMessage("Sincronizarea legacy este oprita pentru noua logica manuala.");
      } else {
        setSyncSummary(
          `Scanate ${summary.scanned}, noi ${summary.created}, actualizate ${summary.updated}, sarite ${summary.skipped}, conflicte ${summary.conflicts || 0}, anulate ${summary.cancelledMissing}.`
        );
        setMessage("Rezervarile si inchirierile au fost sincronizate cu baza de date.");
      }
      await refreshLocations();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Sincronizarea nu a putut fi rulata.");
    } finally {
      setSyncing(false);
    }
  }

  const visibleOfferRequests = offerRequests.filter((request) => {
    if (requestStatusFilter && request.status !== requestStatusFilter) return false;
    if (requestOwnerFilter && !String(request.salesperson || "").toLowerCase().includes(requestOwnerFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="grid scroll-mt-28 gap-5" id="rezervari">
      <div className="focus-card rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">{isOperationalWorkspace ? "Workflow operational OOH" : "Ocupare locatii OOH"}</p>
            <h2 className="font-display text-3xl font-black uppercase text-white">
              {isOperationalWorkspace ? "Decorari, neutralizari si implementare" : "Rezervari si HOLD-uri"}
            </h2>
          </div>
          {canManageAllReservations ? <button className="focus-button secondary" type="button" onClick={syncReservations} disabled={syncing}>
            <RefreshCcw size={18} />
            {syncing ? "Sincronizeaza..." : "Sync inchirieri"}
          </button> : null}
        </div>

        {!isFieldOperator ? (
          <div className="mt-5 grid gap-3 md:grid-cols-5">
            <MiniStat label="Total locatii" value={locationStats.total.toString()} />
            <MiniStat label="Libere acum" value={locationStats.available.toString()} tone="green" />
            <MiniStat label="Libere temporar" value={locationStats.futureBooked.toString()} tone="yellow" />
            <MiniStat label="Hold activ" value={locationStats.holds.toString()} tone="yellow" />
            <MiniStat label="Ocupate" value={locationStats.occupied.toString()} tone="red" />
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {isOperationalWorkspace ? (
            <>
              {!isFieldOperator ? (
                <PanelButton active={activePanel === "future"} icon={<ClipboardList size={18} />} onClick={() => setActivePanel("future")}>
                  Inchirieri viitoare
                </PanelButton>
              ) : null}
              <PanelButton active={activePanel === "decorations"} icon={<Hammer size={18} />} onClick={() => setActivePanel("decorations")}>
                Decorari
              </PanelButton>
              <PanelButton active={activePanel === "neutralizations"} icon={<Undo2 size={18} />} onClick={() => setActivePanel("neutralizations")}>
                Neutralizari
              </PanelButton>
            </>
          ) : (
            <PanelButton active={activePanel === "sales"} icon={<Building2 size={18} />} onClick={() => setActivePanel("sales")}>
              Rezervari / HOLD
            </PanelButton>
          )}
        </div>

        {isOperationalWorkspace ? (
          <div className="mt-4">
            <QuickOperationsSummary
              future={futureReservations.length}
              decorations={decorationTasks.length}
              neutralizations={neutralizationTasks.length}
              showFuture={!isFieldOperator}
            />
          </div>
        ) : null}

        {message ? (
          <p className="mt-4 flex items-center gap-2 text-sm font-bold text-emerald-200">
            <CheckCircle2 size={16} />
            {message}
          </p>
        ) : null}
        {syncSummary ? <p className="mt-2 text-sm font-bold text-slate-300">{syncSummary}</p> : null}
        {error ? (
          <p className="mt-4 flex items-center gap-2 text-sm font-bold text-red-200">
            <XCircle size={16} />
            {error}
          </p>
        ) : null}
      </div>

      {activePanel === "sales" ? (
        <div className="grid gap-4">
          <div className="focus-card rounded-lg p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-focus-yellow">Vanzari si rezervari</p>
                <h2 className="font-display text-3xl font-black uppercase text-white">Ocupa una sau mai multe locatii</h2>
              </div>
              <span className="inline-flex items-center gap-2 rounded-lg border border-focus-line px-3 py-2 text-xs font-black uppercase text-slate-200">
                <CalendarDays size={16} />
                {reservations.filter((item) => activeReservationStatuses.includes(item.status)).length} active
              </span>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="grid gap-3">
                <label>
                  <span className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-200">
                    <Search size={16} /> Cauta dupa cod, oras, zona, adresa sau tip suport
                  </span>
                  <input
                    className="focus-input"
                    value={locationSearch}
                    onChange={(event) => setLocationSearch(event.target.value)}
                    placeholder="Ex: SZPP7, Otopeni, DN1, pasarela"
                  />
                </label>

                <div className="max-h-[380px] overflow-auto rounded-lg border border-focus-line bg-focus-ink/35">
                  {locationChoices.map((location) => {
                    const selected = form.locationIds.includes(location.id);
                    const periodAvailability =
                      form.periodStart && form.periodEnd ? calculateAvailability(location, form.periodStart, form.periodEnd) : null;
                    return (
                      <button
                        key={location.id}
                        type="button"
                        aria-pressed={selected}
                        className={`grid w-full gap-2 border-b border-focus-line px-3 py-3 text-left transition hover:bg-focus-yellow/10 ${
                          selected ? "bg-focus-yellow/15 ring-1 ring-inset ring-focus-yellow/70" : ""
                        }`}
                        onClick={() => toggleLocation(location)}
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex flex-wrap items-center gap-2">
                            <strong className="text-white">{location.code}</strong>
                            {selected ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-focus-yellow px-2 py-1 text-[10px] font-black uppercase text-focus-navy">
                                <CheckCircle2 size={12} />
                                Selectata
                              </span>
                            ) : null}
                          </span>
                          <span className="flex flex-wrap items-center gap-2">
                            {periodAvailability ? (
                              <PeriodStatusBadge status={periodAvailability.status} label={periodAvailability.label} />
                            ) : (
                              <StatusBadge
                                status={location.status}
                                publicStatus={location.publicStatus}
                                availability={location.availabilityText}
                                label={location.availabilityLabel}
                              />
                            )}
                          </span>
                        </span>
                        <span className="text-sm font-bold text-slate-300">
                          {[location.city, location.type, location.sqm ? `${location.sqm} sqm` : null].filter(Boolean).join(" | ")}
                        </span>
                        <span className="line-clamp-2 text-xs text-slate-400">{location.address || location.categoryName}</span>
                        {periodAvailability ? (
                          <span className="text-xs font-bold text-focus-yellow">
                            {periodAvailability.detail || occupiedPeriodsLabel(location)}
                          </span>
                        ) : location.availabilityDetail ? (
                          <span className="text-xs font-bold text-focus-yellow">{location.availabilityDetail}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3">
                <AdminSalesMap locations={locationChoices} selectedIds={form.locationIds} onSelect={toggleLocation} />
                <SelectedLocationsCard
                  selectedLocations={selectedLocations}
                  rentShare={selectedRentShare}
                  onRemove={toggleLocation}
                  onClear={clearSelectedLocations}
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <SelectField
                label="Status"
                value={form.status}
                onChange={(status) => setForm({
                  ...form,
                  status: status as ReservationStatus,
                  clientName: status === "BOOKED" ? "" : form.clientName,
                  clientCompany: status === "BOOKED" ? "" : form.clientCompany,
                  campaignName: status === "BOOKED" ? "" : form.campaignName
                })}
              >
                <option value="RESERVED">Hold intern - 5 zile</option>
                {canCreateBookedReservation ? <option value="BOOKED">Inchiriat / contract inchis</option> : null}
              </SelectField>
              <p className="rounded-lg border border-focus-line bg-focus-navy/35 px-3 py-2 text-xs font-bold text-slate-400 md:col-span-2">
                HOLD/RESERVED poate porni cu date de contact sau client estimat. BOOKED cere client si campanie reale din baza de date, ca facturarea si operatiunile sa fie legate corect.
              </p>
              <SellerAssignmentField
                canAssignOtherSeller={canAssignOtherSeller}
                checked={assignOtherSeller}
                onCheckedChange={(checked) => {
                  setAssignOtherSeller(checked);
                  setForm((current) => ({
                    ...current,
                    sellerUserId: checked ? current.sellerUserId : session.id,
                    salesperson: checked
                      ? sellers.find((seller) => seller.id === current.sellerUserId)?.name || current.salesperson
                      : session.name
                  }));
                }}
                sellerName={session.name}
                sellers={sellers}
                value={form.sellerUserId}
                onChange={(sellerUserId) => {
                  const seller = sellers.find((item) => item.id === sellerUserId);
                  setForm({ ...form, sellerUserId, salesperson: seller?.name || "" });
                }}
              />
              {form.status === "BOOKED" ? (
                <div className="grid gap-3 rounded-lg border border-focus-line bg-focus-navy/35 p-4 md:col-span-2">
                  <p className="text-xs font-black uppercase text-focus-yellow">Flux inchiriere: client real spre campanie reala</p>
                  <InputField label="Cauta client" value={clientSearch} onChange={setClientSearch} />
                  <SelectField
                    label="Client"
                    value={form.clientId}
                    onChange={(clientId) => setForm({ ...form, clientId, campaignId: "" })}
                  >
                    <option value="">Alege clientul din baza de date</option>
                    {clientChoices.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.companyName}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Campanie"
                    value={form.campaignId}
                    onChange={(campaignId) => {
                      const campaign = campaigns.find((item) => item.id === campaignId);
                      setForm({
                        ...form,
                        campaignId,
                        contractCompany: normalizeCompanyEntity(campaign?.companyEntity) || form.contractCompany,
                        currency: campaign?.currency || form.currency,
                        paymentTermType: campaign?.paymentTermType || form.paymentTermType,
                        paymentTermDays: campaign?.paymentTermDays != null ? String(campaign.paymentTermDays) : form.paymentTermDays,
                        billingRule: campaign?.billingRule || form.billingRule,
                        billingFrequency: campaign?.billingFrequency || form.billingFrequency
                      });
                    }}
                  >
                    <option value="">{form.clientId ? "Alege campania clientului" : "Alege mai intai clientul"}</option>
                    {campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.campaignName} - {campaign.status}
                      </option>
                    ))}
                  </SelectField>
                  <p className="text-xs font-bold text-slate-400">
                    Clientul si campania nu se scriu manual la inchiriere. Daca lipsesc, creeaza-le in taburile Clienti/Campanii.
                  </p>
                </div>
              ) : (
                <>
                  <InputField label="Client pentru hold" value={form.clientName} onChange={(clientName) => setForm({ ...form, clientName })} />
                  <InputField label="Companie / detalii hold" value={form.clientCompany} onChange={(clientCompany) => setForm({ ...form, clientCompany })} />
                  <InputField label="Campanie estimata" value={form.campaignName} onChange={(campaignName) => setForm({ ...form, campaignName })} />
                </>
              )}
              <SelectField label="Firma contract" value={form.contractCompany} onChange={(contractCompany) => setForm({ ...form, contractCompany })}>
                <option value="">Alege firma contractanta</option>
                {companyEntities.map((entity) => <option key={entity.value} value={entity.value}>{entity.label}</option>)}
              </SelectField>
              <InputField label="Numar contract / IO" value={form.contractNumber} onChange={(contractNumber) => setForm({ ...form, contractNumber })} />
              <InputField label={`Chirie lunara totala ${form.currency} + TVA`} value={form.monthlyRentTotal} onChange={(monthlyRentTotal) => setForm({ ...form, monthlyRentTotal })} />
              <SelectField label="Moneda contract" value={form.currency} onChange={(currency) => setForm({ ...form, currency })}>
                <option value="EUR">EUR</option>
                <option value="RON">RON</option>
              </SelectField>
              <InputField type="date" label="Start campanie" value={form.periodStart} onChange={(periodStart) => setForm({ ...form, periodStart })} />
              <InputField type="date" label="Final campanie" value={form.periodEnd} onChange={(periodEnd) => setForm({ ...form, periodEnd })} />
              {reservationFormPeriodError ? <p className="text-xs font-bold text-red-100 md:col-span-2">{reservationFormPeriodError}</p> : null}
              {form.status === "BOOKED" ? (
                <div className="grid gap-3 md:col-span-2">
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-focus-line bg-focus-navy/35 px-3 py-2 text-sm font-bold text-slate-200">
                    Necesita montaj
                    <input type="checkbox" checked={form.needsDecoration} onChange={(event) => setForm({ ...form, needsDecoration: event.target.checked })} />
                  </label>
                  {form.needsDecoration ? (
                    <div className="grid gap-3 rounded-lg border border-focus-line bg-focus-ink/35 p-3 md:grid-cols-[1fr_160px]">
                      <InputField label="Cost montaj / decorare" value={form.decorationCost} onChange={(decorationCost) => setForm({ ...form, decorationCost })} />
                      <SelectField label="Moneda" value={form.decorationCurrency} onChange={(decorationCurrency) => setForm({ ...form, decorationCurrency })}>
                        <option value="EUR">EUR</option>
                        <option value="RON">RON</option>
                      </SelectField>
                      <p className="text-xs font-bold text-slate-400 md:col-span-2">
                        Daca este bifat, apare ca task de montaj la data de start si intra in sumarul lunar de decorari.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <AdvancedSection title="Setari facturare / optional">
                <SelectField label="Termen plata" value={form.paymentTermType} onChange={(paymentTermType) => setForm({ ...form, paymentTermType, paymentTermDays: defaultPaymentTermDays(paymentTermType, form.paymentTermDays) })}>
                  <option value="advance">Plata in avans / 0 zile</option>
                  <option value="7_days">7 zile</option>
                  <option value="15_days">15 zile</option>
                  <option value="30_days">30 zile</option>
                  <option value="45_days">45 zile</option>
                  <option value="custom">Termen personalizat</option>
                </SelectField>
                <InputField label="Zile termen plata" value={form.paymentTermDays} onChange={(paymentTermDays) => setForm({ ...form, paymentTermDays, paymentTermType: "custom" })} />
                <SelectField label="Regula facturare" value={form.billingRule} onChange={(billingRule) => setForm({ ...form, billingRule, billingFrequency: defaultBillingFrequency(billingRule, form.billingFrequency) })}>
                  <option value="month_start">La inceputul lunii</option>
                  <option value="month_end">La finalul lunii</option>
                  <option value="campaign_start">La inceputul campaniei</option>
                  <option value="campaign_end">La finalul campaniei</option>
                  <option value="monthly_in_advance">Lunar in avans</option>
                  <option value="monthly_after_service">Lunar dupa prestare</option>
                  <option value="upfront_on_contract">Integral la semnarea contractului</option>
                  <option value="upfront_before_campaign_start">Integral inainte de campanie</option>
                  <option value="fixed_custom_date">Data fixa personalizata</option>
                  <option value="manual_per_contract">Manual / conform contract</option>
                </SelectField>
                <SelectField label="Frecventa facturare" value={form.billingFrequency} onChange={(billingFrequency) => setForm({ ...form, billingFrequency })}>
                  <option value="monthly">Lunar</option>
                  <option value="once">Integral o singura data</option>
                  <option value="custom">Personalizat</option>
                </SelectField>
                <InputField label="Zi facturare in luna" value={form.billingDayOfMonth} onChange={(billingDayOfMonth) => setForm({ ...form, billingDayOfMonth })} />
                <InputField type="date" label="Data facturare personalizata" value={form.customBillingDate} onChange={(customBillingDate) => setForm({ ...form, customBillingDate })} />
                <TextareaField label="Observatii facturare" value={form.billingNotes} onChange={(billingNotes) => setForm({ ...form, billingNotes })} />
              </AdvancedSection>
              {form.status !== "BOOKED" ? (
                <AdvancedSection title="Date contact hold / optional">
                  <InputField label="Email client" value={form.clientEmail} onChange={(clientEmail) => setForm({ ...form, clientEmail })} />
                  <InputField label="Telefon client" value={form.clientPhone} onChange={(clientPhone) => setForm({ ...form, clientPhone })} />
                </AdvancedSection>
              ) : null}
              <AdvancedSection title="Note operationale / optional">
                <TextareaField
                  label="Ce trebuie montat"
                  value={form.productionNotes}
                  onChange={(productionNotes) => setForm({ ...form, productionNotes })}
                />
                <TextareaField label="Observatii interne" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
              </AdvancedSection>
            </div>

            <ReservationSummary
              selectedLocations={selectedLocations}
              clientName={form.status === "BOOKED" ? selectedClient?.companyName || "" : form.clientName}
              periodStart={form.periodStart}
              periodEnd={form.periodEnd}
              monthlyRentTotal={form.monthlyRentTotal}
            />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="focus-button" type="button" onClick={createReservation} disabled={saving || Boolean(reservationFormPeriodError) || (form.status === "BOOKED" && (!form.clientId || !form.campaignId))}>
                <Save size={18} />
                {saving ? "Se salveaza..." : selectedLocations.length > 1 ? "Salveaza contract grupat" : "Salveaza rezervarea"}
              </button>
              <button className="focus-button secondary" type="button" onClick={requestReservationFormReset}>
                <RefreshCcw size={18} />
                Curata
              </button>
            </div>
          </div>

        </div>
      ) : null}

      {activePanel === "future" ? (
        <AdminTableShell
          kicker="Calendar comercial"
          title="Campanii care urmeaza sa inceapa"
          description="Lista include doar rezervarile si inchirierile active cu data de start in viitor, sortate cronologic dupa intrarea in campanie."
        >
          <ReservationsTable
            reservations={futureReservations}
            locationsById={locationsById}
            onDelete={deleteReservation}
            onEdit={openReservationEditor}
            onStatusChange={updateReservationStatus}
            role={session.role}
            canEdit={canEditReservations}
            canDelete={canEditReservations}
            highlightedReservationId={focusedReservationId}
          />
        </AdminTableShell>
      ) : null}

      {activePanel === "decorations" ? (
        <AdminTableShell
          kicker="Implementare"
          title="Decorari programate"
          description={canUpdateOperationStatus
            ? "Rolurile operationale pot actualiza statusul decorarilor."
            : "Lista comuna pentru toti utilizatorii. Statusul este disponibil doar rolurilor operationale."}
        >
          <OperationHistoryToggle checked={showOperationHistory} onChange={setShowOperationHistory} />
          <DecorationBillingSummary
            report={decorationBillingReport}
            locationsById={locationsById}
            month={decorationBillingMonth}
            onMonthChange={setDecorationBillingMonth}
            visible={!isFieldOperator}
          />
          <OperationsTable
            tasks={decorationTasks}
            locationsById={locationsById}
            type="decoration"
            today={today}
            onStatusChange={updateOperationStatus}
            onOpenCompletion={openOperationCompletion}
            onOpenReschedule={openOperationReschedule}
            onOpenProofPhotos={openOperationProofPhotos}
            canEditTask={canEditOperationTask}
            canRescheduleTask={canRescheduleOperationTask}
            canChangeStatusDirectly={canUpdateOperationStatus}
            showCost={!isFieldOperator}
          />
        </AdminTableShell>
      ) : null}

      {activePanel === "neutralizations" ? (
        <AdminTableShell
          kicker="Implementare"
          title="Neutralizari programate"
          description={canUpdateOperationStatus
            ? "Rolurile operationale pot actualiza statusul neutralizarilor."
            : "Lista comuna pentru toti utilizatorii. Statusul este disponibil doar rolurilor operationale."}
        >
          <OperationHistoryToggle checked={showOperationHistory} onChange={setShowOperationHistory} />
          <OperationsTable
            tasks={neutralizationTasks}
            locationsById={locationsById}
            type="neutralization"
            today={today}
            onStatusChange={updateOperationStatus}
            onOpenCompletion={openOperationCompletion}
            onOpenReschedule={openOperationReschedule}
            onOpenProofPhotos={openOperationProofPhotos}
            canEditTask={canEditOperationTask}
            canRescheduleTask={canRescheduleOperationTask}
            canChangeStatusDirectly={canUpdateOperationStatus}
            showCost={!isFieldOperator}
          />
        </AdminTableShell>
      ) : null}

      {!isOperationalWorkspace ? (
      <>
      <div className="focus-card rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Evidenta perioade</p>
            <h2 className="font-display text-3xl font-black uppercase text-white">Vanzari inchise in luna selectata</h2>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-300">
              Sunt afisate numai contractele inchise, ordonate dupa momentul vanzarii. Hold-urile active apar separat si nu
              sunt incluse in vanzari.
            </p>
          </div>
          <button className="focus-button secondary" type="button" onClick={() => setShowReservationLog((value) => !value)}>
            {showReservationLog ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            {showReservationLog ? "Ascunde lista" : `Deschide (${monthlySales.length} vanzari, ${activeHolds.length} hold-uri)`}
          </button>
        </div>

        {showReservationLog ? (
          <>
            <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_190px]">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" />
                <input
                  className="focus-input pl-10"
                  value={reservationSearch}
                  onChange={(event) => setReservationSearch(event.target.value)}
                  placeholder="Client, cod, oras"
                />
              </label>
              <input className="focus-input" type="month" value={salesLogMonth} onChange={(event) => setSalesLogMonth(event.target.value)} />
              <select className="focus-input" value={reservationSort} onChange={(event) => setReservationSort(event.target.value as ReservationListSort)}>
                <option value="created">Data vanzarii</option>
                <option value="start">Data start campanie</option>
              </select>
            </div>

            <div className="mt-5 rounded-lg border border-focus-line bg-focus-ink/35 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-focus-yellow">In lucru acum</p>
                  <h3 className="font-display text-2xl font-black uppercase text-white">Inchirieri active ({activeRentals.length})</h3>
                  <p className="mt-1 text-sm font-bold text-slate-300">
                    Contracte BOOKED aflate in perioada curenta. De aici corectezi rapid clientul, campania, perioada sau pretul fara sa cauti dupa luna vanzarii.
                  </p>
                </div>
              </div>
              <ReservationsTable
                reservations={activeRentals}
                locationsById={locationsById}
                onDelete={deleteReservation}
                onEdit={openReservationEditor}
                onStatusChange={updateReservationStatus}
                role={session.role}
                canEdit={canEditReservations}
                canDelete={canEditReservations}
                highlightedReservationId={focusedReservationId}
              />
            </div>

            <ReservationsTable
              reservations={monthlySales}
              locationsById={locationsById}
              onDelete={deleteReservation}
              onEdit={openReservationEditor}
              onStatusChange={updateReservationStatus}
              role={session.role}
              canEdit={canEditReservations}
              canDelete={canEditReservations}
              highlightedReservationId={focusedReservationId}
            />

            <div className="mt-6 border-t border-focus-line pt-5">
              <p className="text-xs font-black uppercase text-focus-yellow">Blocaje comerciale temporare</p>
              <h3 className="font-display text-2xl font-black uppercase text-white">Hold-uri active ({activeHolds.length})</h3>
              <p className="mt-2 text-sm font-bold text-slate-300">
                Nu sunt vanzari si nu intra in totaluri. Expira automat dupa 5 zile daca nu sunt transformate in contract inchis.
              </p>
              <ReservationsTable
                reservations={activeHolds}
                locationsById={locationsById}
                onDelete={deleteReservation}
                onEdit={openReservationEditor}
                onStatusChange={updateReservationStatus}
                role={session.role}
                canEdit={canEditReservations}
                canDelete={canEditReservations}
                highlightedReservationId={focusedReservationId}
              />
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-focus-line bg-focus-ink/35 px-4 py-3 text-sm font-bold text-slate-300">
            Lista este inchisa. Apasa pe butonul de mai sus pentru vanzarile lunii si hold-urile active.
          </div>
        )}
      </div>

      <div className="focus-card rounded-lg p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Cereri client</p>
            <h2 className="font-display text-3xl font-black uppercase text-white">Solicitari oferta</h2>
          </div>
          <div className="grid w-full gap-2 md:w-auto md:grid-cols-[180px_220px_220px]">
            <select className="focus-input" value={requestStatusFilter} onChange={(event) => setRequestStatusFilter(event.target.value)}>
              <option value="">Toate solicitarile</option>
              {requestStatuses.map((status) => (
                <option key={status} value={status}>
                  {requestStatusLabel(status)}
                </option>
              ))}
            </select>
            <input
              className="focus-input"
              value={requestOwnerFilter}
              onChange={(event) => setRequestOwnerFilter(event.target.value)}
              placeholder="Filtru responsabil"
            />
            <input
              className="focus-input"
              value={requestOwnerName}
              onChange={(event) => setRequestOwnerName(event.target.value)}
              placeholder="Nume vanzator"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {visibleOfferRequests.length ? (
            visibleOfferRequests.map((request) => (
              <article key={request.id} className="rounded-lg border border-focus-line bg-focus-ink/45 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-white">{request.clientName}</p>
                    <p className="text-sm font-bold text-slate-300">
                      {[request.company, request.email, request.phone].filter(Boolean).join(" | ") || "Fara date suplimentare"}
                    </p>
                    {request.salesperson ? <p className="mt-1 text-xs font-black uppercase text-focus-yellow">Responsabil: {request.salesperson}</p> : null}
                    <p className="mt-2 text-sm text-slate-300">{request.message || "Fara mesaj."}</p>
                    <p className="mt-2 text-xs font-black uppercase text-focus-yellow">{request.selectedCodes || "Fara coduri"}</p>
                  </div>
                  {canManageLeads ? <div className="grid min-w-52 gap-2">
                    <select
                      className="focus-input"
                      value={request.status}
                      onChange={(event) => updateOfferRequest(request.id, event.target.value as OfferRequestStatus, requestOwnerName)}
                    >
                      {requestStatuses.map((item) => (
                        <option key={item} value={item}>
                          {requestStatusLabel(item)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="focus-button"
                      type="button"
                      onClick={() => updateOfferRequest(request.id, "CONTACTED", requestOwnerName || request.salesperson || "Vanzator")}
                    >
                      Marcheaza in lucru
                    </button>
                    <button className="focus-button secondary" type="button" onClick={() => updateOfferRequest(request.id, "ARCHIVED", request.salesperson || requestOwnerName)}>
                      Arhiveaza
                    </button>
                    <button className="focus-button secondary" type="button" onClick={() => softDeleteOfferRequest(request.id)}>
                      Sterge soft
                    </button>
                  </div> : <span className="rounded border border-focus-line px-3 py-2 text-xs font-black text-slate-300">{requestStatusLabel(request.status)}</span>}
                </div>
              </article>
            ))
          ) : (
            <p className="rounded-lg border border-focus-line bg-focus-ink/45 p-4 text-sm font-bold text-slate-300">
              Nu exista solicitari primite inca.
            </p>
          )}
        </div>
      </div>
      </>
      ) : null}

      {editingReservation && editForm ? (
        <ReservationEditDialog
          reservation={editingReservation}
          form={editForm}
          groupCount={editingGroupCount}
          groupLocationLabels={editingGroupLocations}
          groupLocationIds={editingGroupLocationIds}
          saving={editing}
          canEditSalesperson={session.role !== "SALES_AGENT"}
          clients={editClientChoices}
          campaigns={editCampaigns}
          clientSearch={editClientSearch}
          onClientSearchChange={setEditClientSearch}
          sellers={sellers}
          onChange={setEditForm}
          onClose={closeReservationEditor}
          onSave={saveEditedReservation}
        />
      ) : null}
      {resetConfirmOpen ? (
        <ReservationResetConfirmDialog
          onCancel={() => setResetConfirmOpen(false)}
          onConfirm={resetReservationForm}
        />
      ) : null}
      {cancellationTarget ? (
        <ReservationCancellationConfirmDialog
          reservation={cancellationTarget}
          onCancel={() => setCancellationTarget(null)}
          onConfirm={confirmReservationCancellation}
        />
      ) : null}
      {archiveOfferRequestId ? (
        <OfferRequestArchiveConfirmDialog
          request={offerRequests.find((request) => request.id === archiveOfferRequestId) || null}
          onCancel={() => setArchiveOfferRequestId(null)}
          onConfirm={confirmSoftDeleteOfferRequest}
        />
      ) : null}
      {completionTarget ? (
        <OperationCompletionDialog
          target={completionTarget}
          files={completionFiles}
          note={completionNote}
          saving={completionSaving}
          onFilesChange={setCompletionFiles}
          onNoteChange={setCompletionNote}
          onClose={closeOperationCompletion}
          onComplete={completeOperationWithProof}
        />
      ) : null}
      {rescheduleTarget ? (
        <OperationRescheduleDialog
          target={rescheduleTarget}
          saving={rescheduleSaving}
          onClose={() => {
            if (!rescheduleSaving) setRescheduleTarget(null);
          }}
          onConfirm={rescheduleOperation}
        />
      ) : null}
      {proofTarget ? (
        <ProofPhotosDialog
          target={proofTarget}
          onClose={() => setProofTarget(null)}
        />
      ) : null}
    </section>
  );
}

function SelectedLocationsCard({
  selectedLocations,
  rentShare,
  onRemove,
  onClear
}: {
  selectedLocations: LocationDTO[];
  rentShare: number | null;
  onRemove: (location: LocationDTO) => void;
  onClear: () => void;
}) {
  if (!selectedLocations.length) {
    return (
      <div className="grid min-h-32 place-items-center rounded-lg border border-focus-line bg-focus-ink/45 p-4 text-center text-sm font-bold text-slate-300">
        <span>
          <MapPinned className="mx-auto mb-2 text-focus-yellow" />
          Alege una sau mai multe locatii din lista sau direct de pe harta.
        </span>
      </div>
    );
  }

  const previewLocation = selectedLocations[0];

  return (
    <div className="rounded-lg border border-focus-line bg-focus-ink/45 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Selectie contract</p>
          <h3 className="font-display text-2xl font-black uppercase text-white">{selectedLocations.length} locatii selectate</h3>
          <p className="mt-1 text-xs font-bold uppercase text-slate-400">
            Pasul urmator: completeaza clientul, perioada si chiria lunara, apoi salveaza contractul.
          </p>
        </div>
        <button className="focus-button secondary" type="button" onClick={onClear}>
          Curata
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {selectedLocations.map((location) => (
          <button
            key={location.id}
            className="rounded-md border border-focus-yellow/40 bg-focus-yellow/10 px-3 py-2 text-xs font-black uppercase text-white"
            type="button"
            onClick={() => onRemove(location)}
            title="Scoate locatia din selectie"
          >
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 size={13} />
              {location.code}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-md border border-focus-yellow/30 bg-focus-yellow/10 p-3 text-xs font-bold uppercase leading-5 text-slate-100">
        Selectia activa ramane evidentiata in lista si pe harta. Daca ai doua fete ale aceleiasi locatii, introdu chiria
        totala, iar aplicatia o imparte automat pe coduri.
      </div>
      {rentShare != null ? (
        <p className="mt-3 text-sm font-black uppercase text-focus-yellow">
          Chirie estimata per cod: {moneyLabel(rentShare)} EUR + TVA / luna
        </p>
      ) : (
        <p className="mt-3 text-sm font-bold text-slate-300">Adauga chiria lunara totala pentru a vedea impartirea pe coduri.</p>
      )}
      <p className="mt-2 text-sm text-slate-300">
        {[previewLocation.city, previewLocation.county, previewLocation.type, previewLocation.sqm ? `${previewLocation.sqm} sqm` : null]
          .filter(Boolean)
          .join(" | ")}
      </p>
      {previewLocation.mainPhotoUrl ? (
        <img src={previewLocation.mainPhotoUrl} alt={previewLocation.code} className="mt-3 h-32 w-full rounded-md bg-focus-ink object-contain" />
      ) : null}
    </div>
  );
}

function QuickOperationsSummary({
  future,
  decorations,
  neutralizations,
  showFuture = true
}: {
  future: number;
  decorations: number;
  neutralizations: number;
  showFuture?: boolean;
}) {
  return (
    <div className="focus-card rounded-lg p-5">
      <p className="text-xs font-black uppercase text-focus-yellow">Operatiuni</p>
      <h2 className="font-display text-3xl font-black uppercase text-white">De urmarit</h2>
      <div className="mt-4 grid gap-3">
        {showFuture ? <MiniStat label="Inchirieri viitoare" value={future.toString()} /> : null}
        <MiniStat label="Decorari" value={decorations.toString()} tone="yellow" />
        <MiniStat label="Neutralizari" value={neutralizations.toString()} tone="green" />
      </div>
    </div>
  );
}

function decorationOperationTasks(reservation: ReservationDTO): OperationTableTask[] {
  const baseStatus = operationStatus(reservation.productionNotes, "decoration");
  const baseCost = operationCost(reservation.productionNotes, "decoration");
  const taskDate = reservation.installationDate || reservation.periodStart;
  return [
    {
      reservation,
      taskDate,
      operationStatus: baseStatus,
      taskType: "initial",
      note: stripOperationMeta(reservation.productionNotes),
      cost: baseCost.cost,
      currency: baseCost.currency,
      finalizationDate: baseStatus === "DONE" ? operationUpdatedAt(reservation.productionNotes, "decoration") || taskDate : null,
      dedupeKey: `reservation:${reservation.id}:DECORATION:base`
    },
    ...operationExtraTasks(reservation.productionNotes, "decoration").map((task) => extraOperationTask(reservation, task))
  ];
}

function extraOperationTask(reservation: ReservationDTO, task: OperationExtraTask): OperationTableTask {
  return {
    reservation,
    taskDate: task.taskDate,
    operationStatus: task.status,
    taskId: task.id,
    taskType: task.taskType,
    note: task.note,
    cost: task.cost,
    currency: task.currency,
    finalizationDate: task.status === "DONE" ? task.completedAt || task.updatedAt || task.taskDate : null,
    dedupeKey: task.id ? `reservation:${reservation.id}:task:${task.id}` : undefined
  };
}

function canEditOperationalReservation(_reservation: ReservationDTO, session: AuthSession) {
  return canCompleteOperationalReservation(session, _reservation);
}

function AdminTableShell({
  kicker,
  title,
  description,
  children
}: {
  kicker: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="focus-card rounded-lg p-5">
      <div>
        <p className="text-xs font-black uppercase text-focus-yellow">{kicker}</p>
        <h2 className="font-display text-3xl font-black uppercase text-white">{title}</h2>
        <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-slate-300">{description}</p>
      </div>
      {children}
    </div>
  );
}

function OperationHistoryToggle({
  checked,
  onChange
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mt-4 flex w-fit items-center gap-3 rounded-lg border border-focus-line px-3 py-2 text-sm font-bold text-slate-200">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      Afiseaza istoric finalizate/arhivate
    </label>
  );
}

function ReservationResetConfirmDialog({
  onCancel,
  onConfirm
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="focus-card w-full max-w-lg rounded-lg p-5 shadow-2xl">
        <p className="text-xs font-black uppercase text-focus-yellow">Curata formularul</p>
        <h2 className="font-display mt-1 text-2xl font-black uppercase text-white">Ai modificari nesalvate</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-300">
          Daca stergi formularul acum, se pierd locatiile selectate, perioada, clientul si observatiile introduse.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-focus-line pt-4">
          <button className="focus-button secondary" type="button" onClick={onCancel}>
            Pastreaza formularul
          </button>
          <button className="focus-button" type="button" onClick={onConfirm}>
            Curata formularul
          </button>
        </div>
      </div>
    </div>
  );
}

function OperationCompletionDialog({
  target,
  files,
  note,
  saving,
  onFilesChange,
  onNoteChange,
  onClose,
  onComplete
}: {
  target: OperationCompletionTarget;
  files: File[];
  note: string;
  saving: boolean;
  onFilesChange: (files: File[]) => void;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onComplete: () => void;
}) {
  const title = target.type === "decoration" ? "Decorare finalizata" : "Neutralizare finalizata";
  const existingPhotos = proofPhotosForTask(target.reservation, target.type, target.taskId);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="focus-card max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Dovada operationala</p>
            <h2 className="font-display text-2xl font-black uppercase text-white">{title}</h2>
            <p className="mt-2 text-sm font-bold text-slate-300">
              {target.reservation.locationCode || "Locatie"} · {target.reservation.clientName} · {dateLabel(target.taskDate)}
            </p>
          </div>
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={saving}>
            Inchide
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-focus-line bg-focus-ink/40 p-4">
          <p className="text-sm font-bold text-slate-200">
            Incarca poze de pe teren si marcheaza lucrarea ca finalizata. Pozele sunt pastrate 30 de zile si sunt vizibile doar utilizatorilor autorizati.
          </p>
          {existingPhotos.length ? (
            <p className="mt-2 text-xs font-bold text-emerald-200">
              Exista deja {existingPhotos.length} poza/poze dovada pentru aceasta lucrare.
            </p>
          ) : null}
        </div>

        <label className="mt-4 block rounded-lg border border-dashed border-focus-line bg-focus-navy/35 p-4">
          <span className="flex items-center gap-2 text-sm font-black uppercase text-focus-yellow">
            <Upload className="h-4 w-4" />
            Poze dovada
          </span>
          <input
            className="mt-3 block w-full text-sm font-bold text-slate-300 file:mr-4 file:rounded-md file:border-0 file:bg-focus-yellow file:px-4 file:py-2 file:text-sm file:font-black file:text-focus-navy"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={saving}
            onChange={(event) => onFilesChange(Array.from(event.target.files || []))}
          />
          <span className="mt-2 block text-xs font-bold text-slate-400">JPG, PNG sau WebP, maximum 10 MB per poza.</span>
        </label>

        {files.length ? (
          <div className="mt-3 grid gap-2">
            {files.map((file) => (
              <div key={`${file.name}-${file.size}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-focus-line bg-focus-ink/35 px-3 py-2 text-sm font-bold text-slate-200">
                <span>{file.name}</span>
                <span className="text-xs text-slate-400">{formatBytes(file.size)}</span>
              </div>
            ))}
          </div>
        ) : null}

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-bold text-slate-200">Nota optionala</span>
          <textarea
            className="focus-input min-h-24"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Ex: montaj finalizat, vizual verificat, acces normal."
            disabled={saving}
          />
        </label>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={saving}>
            Renunta
          </button>
          <button className="focus-button" type="button" onClick={onComplete} disabled={saving}>
            <CheckCircle2 className="h-4 w-4" />
            {saving ? "Se salveaza..." : "Marcheaza finalizat"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function ReservationCancellationConfirmDialog({
  reservation,
  onCancel,
  onConfirm
}: {
  reservation: ReservationDTO;
  onCancel: () => void;
  onConfirm: (decision: ReservationCancellationDecision) => void;
}) {
  const [applyToGroup, setApplyToGroup] = useState(Boolean(reservation.contractGroupId));
  const [reason, setReason] = useState("");
  const trimmedReason = reason.trim();
  const label = `${reservation.locationCode || reservation.locationId} / ${reservation.clientName || "fara client"}`;
  const scopeLabel = applyToGroup ? "tot contractul grupat" : "locatia curenta";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="focus-card w-full max-w-xl rounded-lg p-5 shadow-2xl">
        <p className="text-xs font-black uppercase text-focus-yellow">Anulare cu istoric</p>
        <h2 className="font-display mt-1 text-2xl font-black uppercase text-white">Anuleaza inregistrarea</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-300">
          {label}. Inregistrarea ramane in istoric, iar locatia devine disponibila.
        </p>
        {reservation.contractGroupId ? (
          <div className="mt-4 grid gap-2 rounded-lg border border-focus-line bg-focus-navy/35 p-3">
            <p className="text-xs font-black uppercase text-slate-300">Alege scopul anularii</p>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <input type="radio" checked={!applyToGroup} onChange={() => setApplyToGroup(false)} />
              Doar locatia curenta
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <input type="radio" checked={applyToGroup} onChange={() => setApplyToGroup(true)} />
              Tot contractul grupat
            </label>
          </div>
        ) : null}
        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-bold text-slate-200">Motiv obligatoriu pentru anularea {scopeLabel}</span>
          <textarea
            className="focus-input min-h-24"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex: locatie inchiriata gresit, client retras, perioada introdusa gresit"
          />
        </label>
        {!trimmedReason ? <p className="mt-2 text-xs font-bold text-amber-200">Motivul este obligatoriu pentru istoric clar.</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-focus-line pt-4">
          <button className="focus-button secondary" type="button" onClick={onCancel}>
            Renunta
          </button>
          <button
            className="focus-button"
            type="button"
            disabled={!trimmedReason}
            onClick={() => onConfirm({ applyToGroup, reason: trimmedReason })}
          >
            Confirma anularea
          </button>
        </div>
      </div>
    </div>
  );
}

function OfferRequestArchiveConfirmDialog({
  request,
  onCancel,
  onConfirm
}: {
  request: OfferRequestDTO | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="focus-card w-full max-w-lg rounded-lg p-5 shadow-2xl">
        <p className="text-xs font-black uppercase text-focus-yellow">Arhivare solicitare</p>
        <h2 className="font-display mt-1 text-2xl font-black uppercase text-white">Sterge din lista activa</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-300">
          {request?.clientName || "Solicitarea selectata"} va fi arhivata si ramane disponibila pentru istoric.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-focus-line pt-4">
          <button className="focus-button secondary" type="button" onClick={onCancel}>
            Renunta
          </button>
          <button className="focus-button" type="button" onClick={onConfirm}>
            Arhiveaza solicitarea
          </button>
        </div>
      </div>
    </div>
  );
}

function ReservationSummary({
  selectedLocations,
  clientName,
  periodStart,
  periodEnd,
  monthlyRentTotal
}: {
  selectedLocations: LocationDTO[];
  clientName: string;
  periodStart: string;
  periodEnd: string;
  monthlyRentTotal: string;
}) {
  const total = Number(monthlyRentTotal.replace(",", "."));
  const share = Number.isFinite(total) && selectedLocations.length ? total / selectedLocations.length : null;

  return (
    <div className="mt-4 rounded-lg border border-focus-line bg-focus-ink/45 p-4">
      <p className="text-xs font-black uppercase text-focus-yellow">Rezumat inainte de confirmare</p>
      <div className="mt-3 grid gap-2 text-sm font-bold text-slate-200 md:grid-cols-4">
        <span>Locatii: {selectedLocations.length ? selectedLocations.map((location) => location.code).join(", ") : "Neselectate"}</span>
        <span>Client: {clientName || "Nespecificat"}</span>
        <span>
          Perioada: {periodStart || "N/A"} - {periodEnd || "N/A"}
        </span>
        <span>
          Pret: {Number.isFinite(total) ? `${moneyLabel(total)} EUR total` : "N/A"}
          {share != null ? ` / ${moneyLabel(share)} EUR per cod` : ""}
        </span>
      </div>
    </div>
  );
}

function ReservationEditDialog({
  reservation,
  form,
  groupCount,
  groupLocationLabels,
  groupLocationIds,
  saving,
  canEditSalesperson,
  clients,
  campaigns,
  clientSearch,
  onClientSearchChange,
  sellers,
  onChange,
  onClose,
  onSave
}: {
  reservation: ReservationDTO;
  form: ReservationEditForm;
  groupCount: number;
  groupLocationLabels: string[];
  groupLocationIds: string[];
  saving: boolean;
  canEditSalesperson: boolean;
  clients: ClientOption[];
  campaigns: CampaignOption[];
  clientSearch: string;
  onClientSearchChange: (value: string) => void;
  sellers: SellerUser[];
  onChange: React.Dispatch<React.SetStateAction<ReservationEditForm | null>>;
  onClose: () => void;
  onSave: () => void;
}) {
  const canApplyToGroup = Boolean(reservation.contractGroupId) && groupCount > 1;
  const calculatedShare = form.applyToGroup ? rentShareInputValue(form.monthlyRentTotal, groupCount) : null;
  const isBookedRental = reservation.status === "BOOKED";
  const financialPreview = editFinancialPreview(reservation, form, form.applyToGroup ? groupCount : 1);
  const [periodPreview, setPeriodPreview] = useState<ReservationConflictPreview | null>(null);
  const [periodPreviewLoading, setPeriodPreviewLoading] = useState(false);
  const [periodPreviewError, setPeriodPreviewError] = useState<string | null>(null);
  const periodError = reservationPeriodError(form.periodStart, form.periodEnd);
  const periodChanged = form.periodStart !== dateInputValue(reservation.periodStart) || form.periodEnd !== dateInputValue(reservation.periodEnd);
  const periodPreviewKey = `${reservation.id}|${form.applyToGroup ? "group" : "single"}|${form.periodStart}|${form.periodEnd}`;
  const currentPeriodPreview = periodPreview?.key === periodPreviewKey ? periodPreview : null;
  const mustPreviewPeriod = periodChanged;
  const saveDisabled =
    saving ||
    Boolean(periodError) ||
    (isBookedRental && (!form.clientId || !form.campaignId)) ||
    (mustPreviewPeriod && (!currentPeriodPreview || currentPeriodPreview.conflicts.length > 0));
  const updateField = (field: keyof ReservationEditForm, value: string | boolean) => {
    if (field === "periodStart" || field === "periodEnd" || field === "applyToGroup") {
      setPeriodPreview(null);
      setPeriodPreviewError(null);
    }
    onChange({
      ...form,
      [field]: value,
      ...(isBookedRental && field === "periodEnd" && typeof value === "string" ? { neutralizationDate: value } : {})
    });
  };

  async function runPeriodPreview() {
    setPeriodPreviewError(null);
    if (periodError) {
      setPeriodPreviewError(periodError);
      return;
    }
    setPeriodPreviewLoading(true);
    try {
      const response = await fetch("/api/admin/reservations/conflict-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reservationId: reservation.id,
          locationIds: form.applyToGroup && groupLocationIds.length ? groupLocationIds : [reservation.locationId],
          periodStart: form.periodStart,
          periodEnd: form.periodEnd
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Disponibilitatea nu a putut fi verificata.");
      setPeriodPreview({
        key: periodPreviewKey,
        conflicts: Array.isArray(payload?.conflicts) ? payload.conflicts : [],
        warnings: Array.isArray(payload?.warnings) ? payload.warnings : []
      });
    } catch (error) {
      setPeriodPreview(null);
      setPeriodPreviewError(error instanceof Error ? error.message : "Disponibilitatea nu a putut fi verificata.");
    } finally {
      setPeriodPreviewLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="focus-card max-h-[92vh] w-full max-w-5xl overflow-auto rounded-lg p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Corectare inchiriere</p>
            <h2 className="font-display text-3xl font-black uppercase text-white">
              {reservation.locationCode || "Locatie"} - {reservation.clientName}
            </h2>
            <p className="mt-1 text-sm font-bold text-slate-300">
              Statusul ramane {statusLabel(reservation.status)}. Schimbarea statusului se face separat din tabel.
            </p>
          </div>
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={saving}>
            Inchide
          </button>
        </div>

        {canApplyToGroup ? (
          <div className="mt-4 rounded-lg border border-focus-line bg-focus-ink/45 p-3">
            <p className="text-xs font-black uppercase text-focus-yellow">Scop corectie</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <button
                className={`rounded-lg border px-3 py-2 text-left text-sm font-black transition ${!form.applyToGroup ? "border-focus-yellow bg-focus-yellow/15 text-white" : "border-focus-line bg-focus-navy/40 text-slate-300"}`}
                type="button"
                onClick={() => updateField("applyToGroup", false)}
              >
                Doar locatia curenta
                <span className="mt-1 block text-xs font-bold text-slate-400">Corecteaza numai codul {reservation.locationCode || reservation.locationId}.</span>
              </button>
              <button
                className={`rounded-lg border px-3 py-2 text-left text-sm font-black transition ${form.applyToGroup ? "border-focus-yellow bg-focus-yellow/15 text-white" : "border-focus-line bg-focus-navy/40 text-slate-300"}`}
                type="button"
                onClick={() => updateField("applyToGroup", true)}
              >
                Tot contractul grupat
                <span className="mt-1 block text-xs font-bold text-slate-400">Aplica pe toate cele {groupCount} locatii din grup.</span>
              </button>
            </div>
            {form.applyToGroup ? (
              <div className="mt-3 rounded-md border border-amber-300/35 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100">
                Schimbarile comerciale, perioada si datele operationale se aplica intregului grup: {groupLocationLabels.slice(0, 12).join(", ")}
                {groupLocationLabels.length > 12 ? ` +${groupLocationLabels.length - 12} locatii` : ""}. Verifica atent intervalul si statusul inainte de salvare.
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-focus-line bg-focus-navy/35 px-3 py-2 text-xs font-bold text-slate-300">
                Restul locatiilor din acelasi grup raman neschimbate.
              </div>
            )}
          </div>
        ) : null}

        <ReservationBillingWarning reservation={reservation} />

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {isBookedRental ? (
            <div className="grid gap-3 rounded-lg border border-focus-line bg-focus-navy/35 p-4 md:col-span-2">
              <div>
                <p className="text-xs font-black uppercase text-focus-yellow">Corectare client / campanie</p>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  Foloseste asta cand o locatie a fost inchiriata pe clientul sau campania gresita. Salvarea actualizeaza legatura reala, iar datele comerciale vin din campania aleasa.
                </p>
              </div>
              <InputField label="Cauta client" value={clientSearch} onChange={onClientSearchChange} />
              <SelectField
                label="Client"
                value={form.clientId}
                onChange={(clientId) => {
                  const client = clients.find((item) => item.id === clientId);
                  onChange((current) => current ? {
                    ...current,
                    clientId,
                    campaignId: "",
                    clientName: client?.companyName || current.clientName,
                    clientCompany: client?.companyName || current.clientCompany
                  } : current);
                }}
              >
                <option value="">Alege clientul din baza de date</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.companyName}</option>
                ))}
              </SelectField>
              <SelectField
                label="Campanie"
                value={form.campaignId}
                onChange={(campaignId) => {
                  const campaign = campaigns.find((item) => item.id === campaignId);
                  onChange((current) => current ? {
                    ...current,
                    campaignId,
                    campaignName: campaign?.campaignName || current.campaignName,
                    contractCompany: normalizeCompanyEntity(campaign?.companyEntity) || current.contractCompany,
                    currency: campaign?.currency || current.currency,
                    paymentTermType: campaign?.paymentTermType || current.paymentTermType,
                    paymentTermDays: campaign?.paymentTermDays != null ? String(campaign.paymentTermDays) : current.paymentTermDays,
                    billingRule: campaign?.billingRule || current.billingRule,
                    billingFrequency: campaign?.billingFrequency || current.billingFrequency
                  } : current);
                }}
              >
                <option value="">{form.clientId ? "Alege campania clientului" : "Alege mai intai clientul"}</option>
                {form.campaignId && !campaigns.some((campaign) => campaign.id === form.campaignId) ? (
                  <option value={form.campaignId}>{form.campaignName || "Campania curenta"}</option>
                ) : null}
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.campaignName} - {campaign.status}
                  </option>
                ))}
              </SelectField>
            </div>
          ) : (
            <>
              <InputField label="Client hold" value={form.clientName} onChange={(value) => updateField("clientName", value)} />
              <InputField label="Detalii hold" value={form.clientCompany} onChange={(value) => updateField("clientCompany", value)} />
              <InputField label="Campanie estimata" value={form.campaignName} onChange={(value) => updateField("campaignName", value)} />
            </>
          )}
          {isBookedRental ? (
            <ReadOnlyField label="Firma contract" value={form.contractCompany || "Se preia din campanie"} />
          ) : (
            <SelectField label="Firma contract" value={form.contractCompany} onChange={(value) => updateField("contractCompany", value)}>
              <option value="">Alege firma contractanta</option>
              {companyEntities.map((entity) => <option key={entity.value} value={entity.value}>{entity.label}</option>)}
            </SelectField>
          )}
          <InputField label="Numar contract / IO" value={form.contractNumber} onChange={(value) => updateField("contractNumber", value)} />
          {canEditSalesperson ? (
            <SellerSelect
              label="Vanzator"
              sellers={sellers}
              value={form.sellerUserId}
              fallbackLabel={form.salesperson || "-"}
              onChange={(sellerUserId) => {
                const seller = sellers.find((item) => item.id === sellerUserId);
                onChange((current) => current ? { ...current, sellerUserId, salesperson: seller?.name || "" } : current);
              }}
            />
          ) : (
            <div className="grid gap-2">
              <span className="text-sm font-bold">Vanzator</span>
              <div className="focus-input bg-focus-navy/60">{form.salesperson || "-"}</div>
            </div>
          )}
          <InputField label={`Chirie lunara pe cod ${form.currency} + TVA`} value={form.amount} onChange={(value) => updateField("amount", value)} />
          <InputField label={`Chirie lunara totala grup ${form.currency} + TVA`} value={form.monthlyRentTotal} onChange={(value) => updateField("monthlyRentTotal", value)} />
          <SelectField label="Moneda contract" value={form.currency} onChange={(value) => updateField("currency", value)}>
            <option value="EUR">EUR</option>
            <option value="RON">RON</option>
          </SelectField>
          {calculatedShare == null ? (
            <InputField label="Chirie calculata per cod" value={form.monthlyRentShare} onChange={(value) => updateField("monthlyRentShare", value)} />
          ) : (
            <div className="grid gap-2">
              <span className="text-sm font-bold">Chirie calculata per cod</span>
              <div className="focus-input bg-focus-navy/60">{numberInputValue(calculatedShare)} {form.currency} + TVA / luna</div>
            </div>
          )}
          <InputField type="date" label="Start campanie" value={form.periodStart} onChange={(value) => updateField("periodStart", value)} />
          <InputField type="date" label="Final campanie" value={form.periodEnd} onChange={(value) => updateField("periodEnd", value)} />
          <div className="grid gap-2 rounded-lg border border-focus-line bg-focus-navy/35 p-3 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold text-slate-300">
                {mustPreviewPeriod
                  ? "Perioada a fost modificata. Verifica disponibilitatea inainte de salvare."
                  : "Perioada este neschimbata; verificarea nu este necesara."}
              </p>
              {mustPreviewPeriod ? (
                <button className="focus-button secondary" type="button" onClick={runPeriodPreview} disabled={periodPreviewLoading || Boolean(periodError)}>
                  {periodPreviewLoading ? "Se verifica..." : "Verifica disponibilitatea"}
                </button>
              ) : null}
            </div>
            {periodError ? <p className="text-xs font-bold text-red-100">{periodError}</p> : null}
            {periodPreviewError ? <p className="text-xs font-bold text-red-100">{periodPreviewError}</p> : null}
            {currentPeriodPreview ? <EditPeriodPreviewResult preview={currentPeriodPreview} /> : null}
          </div>
          <InputField type="date" label="Data montaj explicita" value={form.installationDate} onChange={(value) => updateField("installationDate", value)} />
          {!form.installationDate && form.periodStart ? (
            <p className="text-xs font-bold text-slate-400">Implicit: data de start {dateLabel(form.periodStart)}.</p>
          ) : null}
          <div className="grid gap-3 md:col-span-2 md:grid-cols-[1fr_160px]">
            <InputField label="Cost montaj / decorare" value={form.decorationCost} onChange={(value) => updateField("decorationCost", value)} />
            <SelectField label="Moneda" value={form.decorationCurrency} onChange={(value) => updateField("decorationCurrency", value)}>
              <option value="EUR">EUR</option>
              <option value="RON">RON</option>
            </SelectField>
            <p className="text-xs font-bold text-slate-400 md:col-span-2">
              Costul apare in lista de decorari si in sumarul lunar pentru facturare.
            </p>
          </div>
          <InputField type="date" label="Data neutralizare" value={form.neutralizationDate} onChange={(value) => updateField("neutralizationDate", value)} />
          <EditFinancialPreview preview={financialPreview} />
          <AdvancedSection title="Setari facturare / optional">
            <SelectField label="Termen plata" value={form.paymentTermType} onChange={(value) => onChange((current) => current ? { ...current, paymentTermType: value, paymentTermDays: defaultPaymentTermDays(value, current.paymentTermDays) } : current)}>
              <option value="advance">Plata in avans / 0 zile</option>
              <option value="7_days">7 zile</option>
              <option value="15_days">15 zile</option>
              <option value="30_days">30 zile</option>
              <option value="45_days">45 zile</option>
              <option value="custom">Termen personalizat</option>
            </SelectField>
            <InputField label="Zile termen plata" value={form.paymentTermDays} onChange={(value) => onChange((current) => current ? { ...current, paymentTermDays: value, paymentTermType: "custom" } : current)} />
            <SelectField label="Regula facturare" value={form.billingRule} onChange={(value) => onChange((current) => current ? { ...current, billingRule: value, billingFrequency: defaultBillingFrequency(value, current.billingFrequency) } : current)}>
              <option value="month_start">La inceputul lunii</option>
              <option value="month_end">La finalul lunii</option>
              <option value="campaign_start">La inceputul campaniei</option>
              <option value="campaign_end">La finalul campaniei</option>
              <option value="monthly_in_advance">Lunar in avans</option>
              <option value="monthly_after_service">Lunar dupa prestare</option>
              <option value="upfront_on_contract">Integral la semnarea contractului</option>
              <option value="upfront_before_campaign_start">Integral inainte de campanie</option>
              <option value="fixed_custom_date">Data fixa personalizata</option>
              <option value="manual_per_contract">Manual / conform contract</option>
            </SelectField>
            <SelectField label="Frecventa facturare" value={form.billingFrequency} onChange={(value) => updateField("billingFrequency", value)}>
              <option value="monthly">Lunar</option>
              <option value="once">Integral o singura data</option>
              <option value="custom">Personalizat</option>
            </SelectField>
            <InputField label="Zi facturare in luna" value={form.billingDayOfMonth} onChange={(value) => updateField("billingDayOfMonth", value)} />
            <InputField type="date" label="Data facturare personalizata" value={form.customBillingDate} onChange={(value) => updateField("customBillingDate", value)} />
            <TextareaField label="Observatii facturare" value={form.billingNotes} onChange={(value) => updateField("billingNotes", value)} />
          </AdvancedSection>
          <AdvancedSection title="Date contact / optional">
            <InputField label="Email client" value={form.clientEmail} onChange={(value) => updateField("clientEmail", value)} />
            <InputField label="Telefon client" value={form.clientPhone} onChange={(value) => updateField("clientPhone", value)} />
          </AdvancedSection>
          <AdvancedSection title="Note operationale / optional">
            <TextareaField label="Ce trebuie montat" value={form.productionNotes} onChange={(value) => updateField("productionNotes", value)} />
            <TextareaField label="Observatii interne" value={form.notes} onChange={(value) => updateField("notes", value)} />
          </AdvancedSection>
        </div>

        <ReservationCorrectionHistory reservation={reservation} />

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-focus-line pt-4">
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={saving}>
            Renunta
          </button>
          <button className="focus-button" type="button" onClick={onSave} disabled={saveDisabled}>
            <Save size={18} />
            {saving ? "Se salveaza..." : "Salveaza modificarile"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditPeriodPreviewResult({ preview }: { preview: ReservationConflictPreview }) {
  if (!preview.conflicts.length && !preview.warnings.length) {
    return <p className="rounded-md border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">Nu exista suprapuneri pentru perioada aleasa.</p>;
  }
  return (
    <div className="grid gap-2">
      {preview.conflicts.length ? (
        <div className="rounded-md border border-red-300/30 bg-red-500/10 px-3 py-2">
          <p className="text-xs font-black uppercase text-red-100">Suprapuneri active</p>
          {preview.conflicts.map((conflict) => (
            <p className="mt-1 text-xs font-bold text-red-50" key={`${conflict.reservationId}-${conflict.locationId}`}>
              {conflict.locationCode || conflict.locationId}: {conflict.clientName || "Client necunoscut"} / {conflict.campaignName || "Fara campanie"} ({dateLabel(conflict.periodStart)} - {dateLabel(conflict.periodEnd)})
            </p>
          ))}
        </div>
      ) : null}
      {preview.warnings.length ? (
        <div className="rounded-md border border-amber-300/40 bg-amber-400/10 px-3 py-2">
          <p className="text-xs font-black uppercase text-amber-100">Atentionari</p>
          {preview.warnings.map((warning) => (
            <p className="mt-1 text-xs font-bold text-amber-50" key={`${warning.locationId}-${warning.message}`}>
              {warning.locationCode || warning.locationId}: {warning.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReservationBillingWarning({ reservation }: { reservation: ReservationDTO }) {
  const summary = reservation.billingSummary;
  if (!summary?.billingItemCount) return null;
  return (
    <div className="mt-4 rounded-lg border border-amber-300/40 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
      <p className="font-black uppercase">Atentie financiar</p>
      <p className="mt-1">
        Aceasta inchiriere are {summary.billingItemCount} pozitie(i) de facturare
        {summary.receivableCount ? ` si ${summary.receivableCount} incasare(i) asociate` : ""}.
        Corectarea pretului sau perioadei poate cere ajustare in Financiar.
      </p>
      {summary.latestInvoiceDate ? (
        <p className="mt-1 text-xs">
          Ultima factura cunoscuta: {summary.latestInvoiceNumber || "fara numar"} / {dateLabel(summary.latestInvoiceDate)}
        </p>
      ) : null}
    </div>
  );
}

function EditFinancialPreview({ preview }: { preview: ReturnType<typeof editFinancialPreview> }) {
  if (!preview) return null;
  const deltaClass = preview.delta >= 0 ? "text-emerald-200" : "text-red-100";
  return (
    <div className="grid gap-3 rounded-lg border border-focus-line bg-focus-navy/35 p-3 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Impact comercial estimat</p>
          <p className="mt-1 text-xs font-bold text-slate-400">
            Calcul lunar pentru {preview.affectedCount} cod(uri). TVA si prorata finala se verifica separat la facturare.
          </p>
        </div>
        <span className={`rounded-full border border-focus-line px-3 py-1 text-xs font-black uppercase ${deltaClass}`}>
          {preview.delta >= 0 ? "+" : ""}{moneyLabel(preview.delta)} {preview.currency}
        </span>
      </div>
      <div className="grid gap-2 text-sm font-bold text-slate-200 md:grid-cols-3">
        <span>Inainte: {moneyLabel(preview.previousTotal)} {preview.currency} / luna</span>
        <span>Dupa: {moneyLabel(preview.nextTotal)} {preview.currency} / luna</span>
        <span className={deltaClass}>Diferenta: {preview.delta >= 0 ? "+" : ""}{moneyLabel(preview.delta)} {preview.currency}</span>
      </div>
    </div>
  );
}

function ReservationCorrectionHistory({ reservation }: { reservation: ReservationDTO }) {
  const logs = reservation.changeLogs || [];
  const segments = reservation.priceSegments || [];
  if (!logs.length && !segments.length) return null;
  return (
    <div className="mt-5 rounded-lg border border-focus-line bg-focus-ink/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Istoric corectii</p>
          <h3 className="font-display text-xl font-black uppercase text-white">Urme comerciale pastrate</h3>
        </div>
        <span className="rounded-full border border-focus-line px-3 py-1 text-xs font-black uppercase text-slate-300">
          {logs.length + segments.length} inregistrari
        </span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {logs.length ? (
          <div className="rounded-lg border border-focus-line bg-focus-navy/35 p-3">
            <p className="text-xs font-black uppercase text-slate-300">Corectii salvate</p>
            <div className="mt-2 grid gap-2">
              {logs.slice(0, 5).map((log) => (
                <div className="rounded-md border border-focus-line bg-focus-ink/45 px-3 py-2" key={log.id}>
                  <p className="text-xs font-black uppercase text-white">{rentalChangeActionLabel(log.action)} - {dateTimeLabel(log.createdAt)}</p>
                  <p className="mt-1 text-xs font-bold text-slate-300">{rentalChangeSummary(log)}</p>
                  {log.createdByName ? <p className="mt-1 text-xs text-slate-500">Utilizator: {log.createdByName}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {segments.length ? (
          <div className="rounded-lg border border-focus-line bg-focus-navy/35 p-3">
            <p className="text-xs font-black uppercase text-slate-300">Segmente pret</p>
            <div className="mt-2 grid gap-2">
              {segments.slice(-5).reverse().map((segment) => (
                <div className="rounded-md border border-focus-line bg-focus-ink/45 px-3 py-2" key={segment.id}>
                  <p className="text-xs font-black uppercase text-white">
                    {moneyLabel(segment.monthlyRent)} {segment.currency} / luna
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-300">
                    {dateLabel(segment.effectiveFrom)} - {segment.effectiveTo ? dateLabel(segment.effectiveTo) : "prezent"}
                  </p>
                  {segment.reason ? <p className="mt-1 text-xs text-slate-500">{segment.reason}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReservationsTable({
  reservations,
  locationsById,
  onDelete,
  onEdit,
  onStatusChange,
  role,
  canEdit,
  canDelete,
  highlightedReservationId
}: {
  reservations: ReservationDTO[];
  locationsById: Map<string, LocationDTO>;
  onDelete: (id: string) => void;
  onEdit: (reservation: ReservationDTO) => void;
  onStatusChange: (id: string, status: ReservationStatus) => void;
  role: AuthSession["role"];
  canEdit: boolean;
  canDelete: boolean;
  highlightedReservationId?: string | null;
}) {
  return (
    <div className="mt-4 overflow-auto">
      <table className="w-full min-w-[1320px] border-collapse text-sm">
        <thead className="bg-focus-navy text-left text-xs uppercase text-focus-yellow">
          <tr>
            <Th>Locatie</Th>
            <Th>Client / contract</Th>
            <Th>Campanie</Th>
            <Th>Perioada campanie</Th>
            <Th>Chirie</Th>
            <Th>Vanzator</Th>
            <Th>Inregistrare</Th>
            <Th>Status</Th>
            <Th>Actiuni</Th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((reservation) => {
            const location = locationsById.get(reservation.locationId);
            const canCancelReservation = canDelete && activeReservationStatuses.includes(reservation.status);
            return (
              <tr
                key={reservation.id}
                className={`border-t border-focus-line ${highlightedReservationId === reservation.id ? "bg-focus-yellow/10 outline outline-1 outline-focus-yellow/50" : ""}`}
              >
                <Td>
                  <strong className="text-white">{reservation.locationCode || location?.code || "N/A"}</strong>
                  <p className="text-xs text-slate-400">{location?.city || reservation.locationName || reservation.locationId}</p>
                  {reservation.contractGroupId ? <p className="text-xs font-bold text-focus-yellow">Grup {reservation.contractGroupId.slice(0, 8)}</p> : null}
                </Td>
                <Td>
                  <p className="font-bold text-white">{reservation.clientName}</p>
                  <p className="text-xs text-slate-400">{reservation.contractCompany || reservation.clientCompany || "-"}</p>
                  {reservation.contractNumber ? <p className="text-xs text-slate-400">Contract {reservation.contractNumber}</p> : null}
                </Td>
                <Td>{reservation.campaignName || "-"}</Td>
                <Td>
                  {dateLabel(reservation.periodStart)} - {dateLabel(reservation.periodEnd)}
                </Td>
                <Td>
                  <p>{reservation.amount ? `${moneyLabel(reservation.amount)} EUR + TVA / luna` : "-"}</p>
                  {reservation.monthlyRentTotal && reservation.contractGroupId ? (
                    <p className="text-xs text-slate-400">Total grup {moneyLabel(reservation.monthlyRentTotal)} EUR</p>
                  ) : null}
                </Td>
                <Td>{reservation.salesperson || "-"}</Td>
                <Td>
                  {reservation.status === "BOOKED" ? (
                    <>
                      <p className="font-bold text-white">Vandut la {dateTimeLabel(reservation.bookedAt || reservation.createdAt)}</p>
                      <p className="text-xs text-slate-400">Ordine dupa inchiderea contractului</p>
                    </>
                  ) : ["HOLD", "RESERVED"].includes(reservation.status) ? (
                    <>
                      <p className="font-bold text-focus-yellow">Hold creat {dateTimeLabel(reservation.createdAt)}</p>
                      <p className="text-xs text-slate-300">
                        Expira {reservation.holdExpiresAt ? dateTimeLabel(reservation.holdExpiresAt) : "automat dupa 5 zile"}
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-300">Actualizat {dateTimeLabel(reservation.updatedAt)}</p>
                  )}
                </Td>
                <Td>
                  <select
                    className="focus-input"
                    value={reservation.status}
                    onChange={(event) => onStatusChange(reservation.id, event.target.value as ReservationStatus)}
                  >
                    {[reservation.status, ...allowedReservationTransitions(reservation.status, role)]
                      .filter((value, index, values) => values.indexOf(value) === index)
                      .map((item) => (
                      <option key={item} value={item}>
                        {statusLabel(item)}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {canEdit ? (
                      <button className="focus-button secondary" type="button" onClick={() => onEdit(reservation)}>
                        <Pencil size={16} />
                        Editeaza
                      </button>
                    ) : null}
                    {canCancelReservation ? (
                      <button className="focus-button secondary" type="button" onClick={() => onDelete(reservation.id)}>
                        <Trash2 size={16} />
                        Anuleaza
                      </button>
                    ) : null}
                    {!canEdit && !canCancelReservation ? <span className="text-xs text-slate-500">Istoric protejat</span> : null}
                  </div>
                </Td>
              </tr>
            );
          })}
          {!reservations.length ? (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-sm font-bold text-slate-300">
                Nu exista inregistrari pentru selectia curenta.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function DecorationBillingSummary({
  report,
  locationsById,
  month,
  onMonthChange,
  visible = true
}: {
  report: DecorationBillingReport;
  locationsById: Map<string, LocationDTO>;
  month: string;
  onMonthChange: (value: string) => void;
  visible?: boolean;
}) {
  if (!visible) return null;

  const totalLabel = Object.entries(report.totals)
    .map(([currency, value]) => `${moneyLabel(value)} ${currency}`)
    .join(" / ") || "0";

  function exportCsv() {
    const csv = decorationBillingCsv(report);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = decorationBillingFileName(month);
    link.click();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="mb-4 rounded-lg border border-focus-line bg-focus-navy/35 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-focus-yellow">Facturare montaj</p>
          <h3 className="font-display text-xl font-black uppercase text-white">Decorari finalizate in luna</h3>
          <p className="mt-1 text-sm font-bold text-slate-300">
            Lista ajuta la verificarea costurilor de montaj inainte de facturare.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[180px_160px]">
          <InputField type="month" label="Luna" value={month} onChange={onMonthChange} />
          <ReadOnlyField label="Total cost" value={totalLabel} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold text-slate-300">
          {report.rows.length} montaj(e) finalizate in luna selectata. Doar statusul Finalizata intra in total.
        </p>
        <button className="focus-button secondary" type="button" onClick={exportCsv} disabled={!report.rows.length}>
          <FileSpreadsheet size={18} /> Export CSV
        </button>
      </div>
      {report.missingCostRows.length ? (
        <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-sm font-bold text-amber-100">
          {report.missingCostRows.length} montaj(e) finalizate nu au cost completat si trebuie verificate inainte de facturare.
        </div>
      ) : null}
      <div className="mt-3 overflow-auto">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead className="bg-focus-navy text-left text-xs uppercase text-focus-yellow">
            <tr>
              <Th>Data finalizare</Th>
              <Th>Locatie</Th>
              <Th>Client</Th>
              <Th>Campanie</Th>
              <Th>Referinta</Th>
              <Th>Status</Th>
              <Th>Cost</Th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
              const location = row.locationId ? locationsById.get(row.locationId) : null;
              return (
                <tr className="border-t border-focus-line" key={row.key}>
                  <Td>{dateLabel(row.finalizationDate)}</Td>
                  <Td>{row.location || location?.code || "N/A"}</Td>
                  <Td>{row.client}</Td>
                  <Td>{row.campaign}</Td>
                  <Td>{row.campaignReference}</Td>
                  <Td>{operationStatusLabel(row.status)}</Td>
                  <Td>
                    {row.cost != null ? `${moneyLabel(row.cost)} ${row.currency}` : <span className="text-amber-200">Fara cost</span>}
                  </Td>
                </tr>
              );
            })}
            {!report.rows.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm font-bold text-slate-400">
                  Nu exista decorari finalizate in luna selectata.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OperationsTable({
  tasks,
  locationsById,
  type,
  today,
  onStatusChange,
  onOpenCompletion,
  onOpenReschedule,
  onOpenProofPhotos,
  canEditTask,
  canRescheduleTask,
  canChangeStatusDirectly,
  showCost = true
}: {
  tasks: OperationTableTask[];
  locationsById: Map<string, LocationDTO>;
  type: "decoration" | "neutralization";
  today: Date;
  onStatusChange: (id: string, kind: OperationKind, status: OperationStatus, taskId?: string | null) => void;
  onOpenCompletion: (target: OperationCompletionTarget) => void;
  onOpenReschedule: (target: OperationCompletionTarget) => void;
  onOpenProofPhotos: (target: OperationCompletionTarget) => void;
  canEditTask: (reservation: ReservationDTO) => boolean;
  canRescheduleTask: (reservation: ReservationDTO) => boolean;
  canChangeStatusDirectly: boolean;
  showCost?: boolean;
}) {
  return (
    <div className="mt-4 overflow-auto">
      <table className="w-full min-w-[1080px] border-collapse text-sm">
        <thead className="bg-focus-navy text-left text-xs uppercase text-focus-yellow">
          <tr>
            <Th>Data</Th>
            <Th>Locatie</Th>
            <Th>Client</Th>
            <Th>Campanie</Th>
            <Th>Ce trebuie facut</Th>
            <Th>Responsabil</Th>
            <Th>Status</Th>
            <Th>Actiuni</Th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(({ reservation, taskDate, operationStatus: status, taskId, taskType, note, cost, currency, finalizationDate, dedupeKey }) => {
            const location = locationsById.get(reservation.locationId);
            const overdue = isOperationActive(status) && new Date(taskDate) < today;
            const canEdit = canEditTask(reservation);
            const canReschedule = canRescheduleTask(reservation);
            const proofPhotos = proofPhotosForTask(reservation, type, taskId);
            const latestDelay = latestOperationDelayChange(reservation.productionNotes, type, taskId);
            const target: OperationCompletionTarget = {
              reservation,
              taskDate,
              operationStatus: status,
              taskId,
              taskType,
              note,
              cost,
              currency,
              finalizationDate,
              dedupeKey,
              type
            };
            return (
              <tr key={`${type}-${reservation.id}-${taskId || "base"}`} className="border-t border-focus-line">
                <Td>
                  <p className={overdue ? "font-black text-red-100" : "font-black text-white"}>{dateLabel(taskDate)}</p>
                  {overdue ? <p className="text-xs font-bold uppercase text-red-200">Intarziat</p> : null}
                  {status === "DONE" && finalizationDate ? <p className="mt-1 text-xs font-bold text-emerald-200">Finalizat: {dateLabel(finalizationDate)}</p> : null}
                  {latestDelay ? <p className="mt-1 text-xs font-bold text-focus-yellow">Reprogramat: {dateLabel(latestDelay.newTaskDate || latestDelay.newStartDate)}</p> : null}
                </Td>
                <Td>
                  <strong className="text-white">{reservation.locationCode || location?.code || "N/A"}</strong>
                  <p className="text-xs text-slate-400">{[location?.city, location?.type].filter(Boolean).join(" | ") || reservation.locationName}</p>
                </Td>
                <Td>
                  <p className="font-bold text-white">{reservation.clientName}</p>
                  <p className="text-xs text-slate-400">{reservation.contractCompany || reservation.clientCompany || "-"}</p>
                </Td>
                <Td>{reservation.campaignName || "-"}</Td>
                <Td>
                  <p className="font-bold text-white">
                    {taskType === "redecoration" ? "Redecorare / schimbare vizual" : type === "decoration" ? "Decorare initiala" : "Neutralizare final contract"}
                  </p>
                  <p className="text-xs text-slate-300">
                    {note || (type === "decoration"
                      ? stripOperationMeta(reservation.productionNotes) || reservation.notes || "De montat conform campaniei."
                      : stripOperationMeta(reservation.productionNotes) || reservation.notes || "Neutralizare la final de contract.")}
                  </p>
                  {showCost && cost != null ? <p className="mt-1 text-xs font-black uppercase text-focus-yellow">Cost: {moneyLabel(cost)} {currency || ""}</p> : null}
                  <ProofPhotoSummary photos={proofPhotos} />
                  {latestDelay ? (
                    <div className="mt-2 rounded-lg border border-focus-yellow/30 bg-focus-yellow/10 px-3 py-2 text-xs font-bold text-yellow-50">
                      <p className="font-black uppercase text-focus-yellow">Motiv reprogramare</p>
                      <p className="mt-1">{latestDelay.reason}</p>
                      <p className="mt-1 text-slate-300">
                        {dateLabel(latestDelay.oldTaskDate || latestDelay.oldStartDate)} -&gt; {dateLabel(latestDelay.newTaskDate || latestDelay.newStartDate)}
                      </p>
                      {latestDelay.financeReviewRequired ? <p className="mt-1 text-amber-100">Necesita verificare financiara.</p> : null}
                    </div>
                  ) : null}
                </Td>
                <Td>{reservation.salesperson || "-"}</Td>
                <Td>
                  <OperationTaskStatusBadge status={status} overdue={overdue} />
                </Td>
                <Td>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      {proofPhotos.length ? (
                        <button className="focus-button secondary" type="button" onClick={() => onOpenProofPhotos(target)}>
                          <Eye className="h-4 w-4" />
                          Vezi poze
                        </button>
                      ) : null}
                      {overdue && canReschedule ? (
                        <button className="focus-button secondary" type="button" onClick={() => onOpenReschedule(target)}>
                          <CalendarDays className="h-4 w-4" />
                          Modifica data
                        </button>
                      ) : null}
                      {canChangeStatusDirectly && status !== "IN_PROGRESS" ? (
                        <button className="focus-button secondary" type="button" onClick={() => onStatusChange(reservation.id, type, "IN_PROGRESS", taskId)}>
                          In lucru
                        </button>
                      ) : null}
                      {status !== "DONE" ? (
                        <button
                          className="focus-button"
                          type="button"
                          onClick={() => onOpenCompletion(target)}
                        >
                          <Upload className="h-4 w-4" />
                          Finalizeaza + poze
                        </button>
                      ) : null}
                      {canChangeStatusDirectly && status !== "ARCHIVED" ? (
                        <button className="focus-button secondary" type="button" onClick={() => onStatusChange(reservation.id, type, "ARCHIVED", taskId)}>
                          Arhiveaza
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs font-bold text-slate-500">Doar vizualizare</span>
                  )}
                </Td>
              </tr>
            );
          })}
          {!tasks.length ? (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-sm font-bold text-slate-300">
                Nu exista taskuri programate in intervalul operational.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ProofPhotoSummary({ photos }: { photos: NonNullable<ReservationDTO["operationProofPhotos"]> }) {
  if (!photos.length) {
    return (
      <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-focus-line px-2 py-1 text-[11px] font-black uppercase text-slate-400">
        <ImageIcon className="h-3.5 w-3.5" />
        Fara poze dovada
      </p>
    );
  }
  const firstExpiry = photos.find((photo) => photo.expiresAt)?.expiresAt || null;
  return (
    <div className="mt-2 rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-3 py-2">
      <p className="inline-flex items-center gap-2 text-xs font-black uppercase text-emerald-100">
        <ImageIcon className="h-4 w-4" />
        {photos.length} poza/poze dovada
      </p>
      {firstExpiry ? <p className="mt-1 text-[11px] font-bold text-emerald-200">Valabile pana la {dateLabel(firstExpiry)}</p> : null}
      <div className="mt-1 flex flex-wrap gap-2">
        {photos.slice(0, 3).map((photo) => (
          <a key={photo.id} className="text-xs font-bold text-focus-yellow underline-offset-4 hover:underline" href={photo.downloadUrl} target="_blank" rel="noreferrer">
            {photo.fileName}
          </a>
        ))}
      </div>
    </div>
  );
}

function OperationTaskStatusBadge({ status, overdue }: { status: OperationStatus; overdue: boolean }) {
  const className =
    status === "DONE"
      ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100"
      : overdue
        ? "border-red-300/40 bg-red-500/10 text-red-100"
        : status === "IN_PROGRESS"
          ? "border-focus-yellow/40 bg-focus-yellow/10 text-focus-yellow"
          : "border-focus-line bg-focus-navy/45 text-slate-200";
  const label = overdue && status !== "DONE" ? "Intarziat" : operationStatusLabel(status);
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase ${className}`}>
      {label}
    </span>
  );
}

function ProofPhotosDialog({
  target,
  onClose
}: {
  target: OperationCompletionTarget;
  onClose: () => void;
}) {
  const photos = proofPhotosForTask(target.reservation, target.type, target.taskId);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="focus-card max-h-[92vh] w-full max-w-4xl overflow-auto rounded-lg p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Dovezi lucrare</p>
            <h2 className="font-display text-2xl font-black uppercase text-white">Poze dovada</h2>
            <p className="mt-2 text-sm font-bold text-slate-300">
              {target.reservation.locationCode || "Locatie"} · {target.reservation.clientName}. Pozele sunt disponibile 30 de zile.
            </p>
          </div>
          <button className="focus-button secondary" type="button" onClick={onClose}>
            Inchide
          </button>
        </div>

        {photos.length ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {photos.map((photo) => (
              <article key={photo.id} className="rounded-lg border border-focus-line bg-focus-navy/35 p-3">
                <img
                  alt={`Dovada ${photo.fileName}`}
                  className="aspect-[4/3] w-full rounded-md border border-focus-line object-cover"
                  src={`${photo.downloadUrl}?preview=1`}
                />
                <div className="mt-3 grid gap-1 text-xs font-bold text-slate-300">
                  <p className="font-black text-white">{photo.fileName}</p>
                  <p>Incarcata: {dateTimeLabel(photo.uploadedAt)}</p>
                  <p>De: {photo.uploadedByName || "utilizator operational"}</p>
                  <p>Expira: {photo.expiresAt ? dateLabel(photo.expiresAt) : "dupa 30 zile"}</p>
                </div>
                <a className="focus-button secondary mt-3 w-full justify-center" href={photo.downloadUrl}>
                  <Download className="h-4 w-4" />
                  Descarca
                </a>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-focus-line bg-focus-navy/35 p-4 text-sm font-bold text-slate-300">
            Nu exista poze dovada active pentru aceasta lucrare.
          </p>
        )}
      </div>
    </div>
  );
}

function OperationRescheduleDialog({
  target,
  saving,
  onClose,
  onConfirm
}: {
  target: OperationCompletionTarget;
  saving: boolean;
  onClose: () => void;
  onConfirm: (input: OperationRescheduleInput) => void;
}) {
  const [newStartDate, setNewStartDate] = useState(dateInputValue(target.taskDate));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const trimmedReason = reason.trim();
  const validationError = !newStartDate
    ? "Alege data noua."
    : !trimmedReason
      ? "Motivul intarzierii este obligatoriu."
      : target.type === "decoration" && newStartDate > dateInputValue(target.reservation.periodEnd)
        ? "Noua data nu poate fi dupa finalul campaniei."
        : !confirmed
          ? "Confirma impactul asupra perioadei si pro-rata."
          : null;
  const preview = operationDelayProrataPreview(target.reservation, newStartDate, target.type);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="focus-card max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Reprogramare operationala</p>
            <h2 className="font-display text-2xl font-black uppercase text-white">Modifica data de start</h2>
            <p className="mt-2 text-sm font-bold text-slate-300">
              {target.reservation.locationCode || "Locatie"} · {target.reservation.clientName}
            </p>
          </div>
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={saving}>
            Inchide
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label="Data curenta" value={dateLabel(target.taskDate)} />
          <InputField type="date" label="Data noua" value={newStartDate} onChange={setNewStartDate} />
        </div>

        {preview ? (
          <div className="mt-4 rounded-lg border border-focus-line bg-focus-navy/35 p-3 text-sm font-bold text-slate-200">
            <p className="text-xs font-black uppercase text-focus-yellow">Preview pro-rata</p>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <span>Perioada veche: {dateLabel(target.reservation.periodStart)} - {dateLabel(target.reservation.periodEnd)}</span>
              <span>Perioada noua: {dateLabel(newStartDate)} - {dateLabel(target.reservation.periodEnd)}</span>
              <span className={preview.delta >= 0 ? "text-emerald-200" : "text-red-100"}>
                Diferenta estimata: {preview.delta >= 0 ? "+" : ""}{moneyLabel(preview.delta)} {preview.currency}
              </span>
            </div>
          </div>
        ) : null}

        {target.reservation.billingSummary?.billingItemCount ? (
          <div className="mt-4 rounded-lg border border-amber-300/40 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
            Exista pozitii de facturare sau incasari asociate. SmartBill nu se modifica automat; Financiar trebuie sa verifice manual impactul.
          </div>
        ) : null}

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-bold text-slate-200">Motiv intarziere</span>
          <textarea
            className="focus-input min-h-24"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex: acces intarziat, material lipsa, vreme nefavorabila."
            disabled={saving}
          />
        </label>
        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-bold text-slate-200">Nota interna optionala</span>
          <textarea className="focus-input min-h-20" value={note} onChange={(event) => setNote(event.target.value)} disabled={saving} />
        </label>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-focus-line bg-focus-navy/35 p-3 text-sm font-bold text-slate-200">
          <input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={saving} />
          Confirm ca aceasta modificare afecteaza perioada campaniei si calculul pro-rata.
        </label>

        {validationError ? <p className="mt-3 text-sm font-bold text-red-100">{validationError}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button className="focus-button secondary" type="button" onClick={onClose} disabled={saving}>
            Renunta
          </button>
          <button
            className="focus-button"
            type="button"
            disabled={saving || Boolean(validationError)}
            onClick={() => onConfirm({ newStartDate, reason: trimmedReason, note: note.trim() || null, confirmed })}
          >
            {saving ? "Se salveaza..." : "Salveaza data"}
          </button>
        </div>
      </div>
    </div>
  );
}

function proofPhotosForTask(reservation: ReservationDTO, kind: OperationKind, taskId?: string | null) {
  return (reservation.operationProofPhotos || []).filter((photo) => photo.kind === kind && (photo.taskId || null) === (taskId || null));
}

function PanelButton({
  active,
  icon,
  onClick,
  children
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`focus-button ${active ? "" : "secondary"}`} type="button" onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function PeriodStatusBadge({ status, label }: { status: string; label: string }) {
  const className =
    status === "AVAILABLE"
      ? "border-emerald-300/70 bg-emerald-400/15 text-emerald-200"
      : status === "PARTIAL"
        ? "border-focus-yellow/70 bg-focus-yellow/15 text-focus-yellow"
        : "border-red-300/70 bg-red-500/15 text-red-100";

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black uppercase ${className}`}>
      {label}
    </span>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-bold text-slate-200">{label}</span>
      <select className="focus-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function AdvancedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="md:col-span-2 rounded-lg border border-focus-line bg-focus-navy/35 p-3">
      <summary className="cursor-pointer text-sm font-black uppercase text-focus-yellow">{title}</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">{children}</div>
    </details>
  );
}

function MiniStat({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "green" | "yellow" | "red";
}) {
  const toneClass = {
    neutral: "text-white",
    green: "text-emerald-200",
    yellow: "text-focus-yellow",
    red: "text-red-100"
  }[tone];

  return (
    <div className="rounded-lg border border-focus-line bg-focus-ink/45 p-3">
      <p className="text-xs font-black uppercase text-slate-400">{label}</p>
      <p className={`mt-1 font-display text-2xl font-black uppercase ${toneClass}`}>{value}</p>
    </div>
  );
}

function SellerAssignmentField({
  canAssignOtherSeller,
  checked,
  onCheckedChange,
  sellerName,
  sellers,
  value,
  onChange
}: {
  canAssignOtherSeller: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  sellerName: string;
  sellers: SellerUser[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 md:col-span-2">
      <div className="grid gap-2 md:grid-cols-2">
        <div className="grid gap-2">
          <span className="text-sm font-bold">Vanzator</span>
          <div className="focus-input bg-focus-navy/60">
            {checked ? value || "Alege vanzatorul" : sellerName}
          </div>
          <p className="text-xs font-bold text-slate-400">Se seteaza automat din contul autentificat.</p>
        </div>
        {canAssignOtherSeller ? (
          <label className="flex items-center justify-between gap-3 rounded-lg border border-focus-line bg-focus-navy/35 px-3 py-2 text-sm font-bold text-slate-200">
            Atribuie catre alt vanzator
            <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
          </label>
        ) : null}
      </div>
      {canAssignOtherSeller && checked ? (
        <SellerSelect label="Alege vanzatorul asignat" sellers={sellers} value={value} fallbackLabel="Alege vanzatorul" onChange={onChange} />
      ) : null}
    </div>
  );
}

function SellerSelect({
  label,
  sellers,
  value,
  fallbackLabel,
  onChange
}: {
  label: string;
  sellers: SellerUser[];
  value: string;
  fallbackLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-bold text-slate-200">{label}</span>
      <select className="focus-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{fallbackLabel}</option>
        {sellers.map((seller) => (
          <option key={seller.id} value={seller.id}>
            {seller.name} - {seller.role === "SALES_DIRECTOR" ? "Director vanzari" : "Agent vanzari"}
          </option>
        ))}
      </select>
    </label>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-bold text-slate-200">{label}</span>
      <input className="focus-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1 block text-sm font-bold text-slate-200">{label}</span>
      <div className="focus-input bg-focus-navy/60 text-slate-200">{value}</div>
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-bold text-slate-200">{label}</span>
      <textarea className="focus-input min-h-24" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-black">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="align-top px-4 py-3">{children}</td>;
}

function numberInputValue(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function moneyInputValue(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function editFinancialPreview(reservation: ReservationDTO, form: ReservationEditForm, affectedCount: number) {
  const currency = form.currency || reservation.currency || "EUR";
  const previousPerCode =
    reservation.amount ??
    reservation.monthlyRentShare ??
    (reservation.monthlyRentTotal != null && affectedCount > 0 ? reservation.monthlyRentTotal / affectedCount : null);
  const nextPerCode =
    (form.applyToGroup ? rentShareInputValue(form.monthlyRentTotal, affectedCount) : moneyInputValue(form.amount)) ??
    moneyInputValue(form.monthlyRentShare) ??
    moneyInputValue(form.monthlyRentTotal);
  if (previousPerCode == null || nextPerCode == null) return null;
  const previousTotal = Math.round(previousPerCode * affectedCount * 100) / 100;
  const nextTotal = Math.round(nextPerCode * affectedCount * 100) / 100;
  return {
    affectedCount,
    currency,
    previousTotal,
    nextTotal,
    delta: Math.round((nextTotal - previousTotal) * 100) / 100
  };
}

function operationDelayProrataPreview(reservation: ReservationDTO, newStartDate: string, kind: OperationKind) {
  if (kind !== "decoration" || !newStartDate) return null;
  const monthlyAmount = reservation.amount ?? reservation.monthlyRentShare ?? reservation.monthlyRentTotal;
  if (monthlyAmount == null || monthlyAmount <= 0) return null;
  const previous = calculateProrata(monthlyAmount, reservation.periodStart, reservation.periodEnd, reservation.periodStart, reservation.periodEnd);
  const next = calculateProrata(monthlyAmount, newStartDate, reservation.periodEnd, newStartDate, reservation.periodEnd);
  return {
    currency: reservation.currency || "EUR",
    previousAmount: previous.amount,
    nextAmount: next.amount,
    delta: Math.round((next.amount - previous.amount) * 100) / 100
  };
}

function rentalChangeActionLabel(action: string) {
  if (action === "price_or_period_update") return "Pret / perioada";
  if (action === "rental_correction") return "Corectie inchiriere";
  return action.replaceAll("_", " ");
}

function rentalChangeSummary(log: NonNullable<ReservationDTO["changeLogs"]>[number]) {
  const next = objectRecord(log.nextJson);
  const previous = objectRecord(log.previousJson);
  const pieces = [];
  const nextClient = stringRecordValue(next, "clientName");
  const previousClient = stringRecordValue(previous, "clientName");
  if (nextClient && nextClient !== previousClient) pieces.push(`Client: ${previousClient || "-"} -> ${nextClient}`);
  const nextCampaign = stringRecordValue(next, "campaignName");
  const previousCampaign = stringRecordValue(previous, "campaignName");
  if (nextCampaign && nextCampaign !== previousCampaign) pieces.push(`Campanie: ${previousCampaign || "-"} -> ${nextCampaign}`);
  const nextAmount = numberRecordValue(next, "monthlyRentShare") ?? numberRecordValue(next, "amount") ?? numberRecordValue(next, "monthlyRent");
  const previousAmount = numberRecordValue(previous, "monthlyRentShare") ?? numberRecordValue(previous, "amount") ?? numberRecordValue(previous, "monthlyRent");
  if (nextAmount != null && nextAmount !== previousAmount) pieces.push(`Pret: ${previousAmount != null ? moneyLabel(previousAmount) : "-"} -> ${moneyLabel(nextAmount)}`);
  const nextStart = stringRecordValue(next, "periodStart") || stringRecordValue(next, "effectiveFrom");
  const nextEnd = stringRecordValue(next, "periodEnd") || stringRecordValue(next, "effectiveTo");
  const previousStart = stringRecordValue(previous, "periodStart") || stringRecordValue(previous, "effectiveFrom");
  const previousEnd = stringRecordValue(previous, "periodEnd") || stringRecordValue(previous, "effectiveTo");
  if ((nextStart && nextStart !== previousStart) || (nextEnd && nextEnd !== previousEnd)) {
    pieces.push(`Perioada: ${previousStart ? dateLabel(previousStart) : "-"} - ${previousEnd ? dateLabel(previousEnd) : "-"} -> ${nextStart ? dateLabel(nextStart) : "-"} - ${nextEnd ? dateLabel(nextEnd) : "-"}`);
  }
  return pieces.length ? pieces.join(" | ") : log.note || "Corectie salvata.";
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function numberRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function defaultPaymentTermDays(type: string, current: string) {
  const map: Record<string, string> = {
    advance: "0",
    "7_days": "7",
    "15_days": "15",
    "30_days": "30",
    "45_days": "45"
  };
  return map[type] || current || "30";
}

function defaultBillingFrequency(rule: string, current: string) {
  if (["month_start", "month_end", "monthly_in_advance", "monthly_after_service"].includes(rule)) return "monthly";
  if (["campaign_start", "campaign_end", "upfront_on_contract", "upfront_before_campaign_start", "fixed_custom_date"].includes(rule)) return "once";
  return current || "monthly";
}

function isReservationFormDirty(form: ReservationForm, initialForm: ReservationForm) {
  return JSON.stringify(form) !== JSON.stringify(initialForm);
}

function reservationPeriodError(periodStart: string, periodEnd: string) {
  if (!periodStart || !periodEnd) return "Completeaza startul si finalul campaniei.";
  const start = Date.parse(`${periodStart}T00:00:00.000Z`);
  const end = Date.parse(`${periodEnd}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Perioada campaniei nu este valida.";
  if (end <= start) return "Data de final trebuie sa fie dupa data de start.";
  return null;
}

function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function rentShareInputValue(totalValue: string, count: number) {
  const total = Number(totalValue.replace(",", "."));
  if (!Number.isFinite(total) || total < 0 || count < 1) return null;
  return Math.round((total / count) * 100) / 100;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function moneyLabel(value: number) {
  return new Intl.NumberFormat("ro-RO", {
    maximumFractionDigits: 2
  }).format(value);
}

function statusLabel(status: ReservationStatus) {
  const labels: Record<ReservationStatus, string> = {
    HOLD: "Hold intern - 5 zile",
    RESERVED: "Hold intern - 5 zile",
    BOOKED: "Inchiriat / inchis",
    CANCELLED: "Anulat",
    EXPIRED: "Expirat"
  };
  return labels[status];
}

function requestStatusLabel(status: OfferRequestStatus) {
  const labels: Record<OfferRequestStatus, string> = {
    NEW: "Noua",
    CONTACTED: "In lucru",
    QUOTED: "Ofertat",
    WON: "Castigat",
    LOST: "Pierdut",
    ARCHIVED: "Arhivat"
  };
  return labels[status];
}

function reservationBookedAt(reservation: ReservationDTO) {
  return new Date(reservation.bookedAt || reservation.createdAt).getTime();
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Bucharest"
  }).format(new Date(value));
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function occupiedPeriodsLabel(location: LocationDTO) {
  const periods = location.reservations
    .filter((reservation) => activeReservationStatuses.includes(reservation.status))
    .slice(0, 3)
    .map((reservation) => `${dateLabel(reservation.periodStart)} - ${dateLabel(reservation.periodEnd)}`);
  return periods.length ? `Ocupat: ${periods.join("; ")}` : null;
}

function currentMonthInputValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function monthInputValueFromDate(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return currentMonthInputValue();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function panelFromQuery(value?: string | null): AdminPanel | null {
  if (value === "sales" || value === "future" || value === "decorations" || value === "neutralizations") return value;
  if (value === "operations") return "decorations";
  return null;
}

function panelAllowedInWorkspace(panel: AdminPanel, workspace: ReservationsWorkspace, fieldOperator = false) {
  if (workspace === "operational") {
    if (fieldOperator) return panel === "decorations" || panel === "neutralizations";
    return panel === "future" || panel === "decorations" || panel === "neutralizations";
  }
  return panel === "sales";
}

function monthInputRange(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  };
}
