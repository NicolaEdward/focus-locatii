import { PublicHeader } from "@/components/layout/PublicHeader";
import { LocationExplorer } from "@/components/public/LocationExplorer";
import { listCategories, listPublicLocations } from "@/lib/locations";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function LocationsPage() {
  const [locations, categories] = await Promise.all([listPublicLocations(), listCategories()]);

  return (
    <>
      <PublicHeader />
      <LocationExplorer locations={locations} categories={categories} />
    </>
  );
}
