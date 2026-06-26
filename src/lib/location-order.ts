export type OrderedLocationLike = {
  code: string;
  nr?: string | null;
  city?: string | null;
  county?: string | null;
  address?: string | null;
  reportingGroupName?: string | null;
  displayOrder?: number | null;
  locationGroupOrder?: number | null;
  faceOrder?: number | null;
  directionOrder?: number | null;
};

export function sortOperationalLocations<T extends OrderedLocationLike>(left: T, right: T) {
  return (
    compareNumber(left.displayOrder, right.displayOrder) ||
    compareNumber(left.locationGroupOrder, right.locationGroupOrder) ||
    compareText(left.reportingGroupName, right.reportingGroupName) ||
    compareText(left.city, right.city) ||
    compareText(left.county, right.county) ||
    compareText(left.address, right.address) ||
    compareFace(left, right) ||
    compareText(left.code, right.code)
  );
}

export function operationalLocationRank(location: OrderedLocationLike) {
  return {
    displayOrder: location.displayOrder ?? numberOrNull(location.nr) ?? 999999,
    groupOrder: location.locationGroupOrder ?? 999999,
    groupName: normalize(location.reportingGroupName || location.address || location.code),
    faceOrder: location.faceOrder ?? inferredFaceOrder(location.code),
    directionOrder: location.directionOrder ?? 999999,
    code: normalize(location.code)
  };
}

function compareFace(left: OrderedLocationLike, right: OrderedLocationLike) {
  const a = operationalLocationRank(left);
  const b = operationalLocationRank(right);
  return a.faceOrder - b.faceOrder || a.directionOrder - b.directionOrder;
}

function compareNumber(left?: number | null, right?: number | null) {
  const a = left ?? 999999;
  const b = right ?? 999999;
  return a - b;
}

function compareText(left?: string | null, right?: string | null) {
  return normalize(left).localeCompare(normalize(right), "ro", { sensitivity: "base" });
}

function normalize(value?: string | null) {
  return String(value || "").trim();
}

function numberOrNull(value?: string | null) {
  if (!value) return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function inferredFaceOrder(code: string) {
  if (/A$/i.test(code)) return 1;
  if (/B$/i.test(code)) return 2;
  return 99;
}
