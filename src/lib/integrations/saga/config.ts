import { companyEntities } from "@/lib/company-entities";

export type SagaIntegrationStatus = ReturnType<typeof getSagaIntegrationStatus>;

export function getSagaIntegrationStatus() {
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
  const mode = process.env.SAGA_SHADOW_MODE === "fixture" ? "fixture" : "disabled";
  const canRunShadow = environment !== "production" && mode === "fixture";
  return {
    environment,
    mode,
    canRunShadow,
    connectorStatus: canRunShadow ? "FIXTURE_READY" : "DISABLED",
    product: process.env.SAGA_PRODUCT || "SAGA Web - produsul companiei necesita confirmare",
    officialContract: "Import XML documentat; API read pentru registrul complet de creante neconfirmat",
    writeBack: "DISABLED_UNCONFIRMED_CONTRACT",
    lastSuccessfulShadowSync: null,
    lastFailedShadowSync: null,
    legalEntities: companyEntities.map((entity) => ({
      code: entity.code,
      name: entity.label,
      configured: canRunShadow,
      source: canRunShadow ? "fixture" : "none"
    }))
  };
}

export function assertSagaShadowRunAllowed() {
  const status = getSagaIntegrationStatus();
  if (!status.canRunShadow) throw new Error("SAGA_SHADOW_DISABLED");
  return status;
}
