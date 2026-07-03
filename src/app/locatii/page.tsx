import { PublicHeader } from "@/components/layout/PublicHeader";
import { LocationExplorer } from "@/components/public/LocationExplorer";
import { listCachedCategories, listCachedPublicLocations } from "@/lib/locations";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function LocationsPage() {
  const [locations, categories] = await Promise.all([listCachedPublicLocations(), listCachedCategories()]);

  return (
    <>
      <PublicHeader />
      <LocationExplorer locations={locations} categories={categories} />
    </>
  );
}
