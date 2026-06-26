import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { EscapeToLocations } from "@/components/public/EscapeToLocations";
import { LocationPresentation } from "@/components/public/LocationPresentation";
import { getPublicLocation } from "@/lib/locations";

type Props = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LocationDetailPage({ params }: Props) {
  const { id } = await params;
  const location = await getPublicLocation(id);
  if (!location) notFound();

  return (
    <>
      <EscapeToLocations />
      <PublicHeader />
      <main className="focus-shell py-6">
        <div className="focus-container grid gap-4">
          <Link className="focus-button secondary no-print w-fit" href="/locatii">
            <ArrowLeft size={18} />
            Inapoi la harta
          </Link>
          <LocationPresentation location={location} />
        </div>
      </main>
    </>
  );
}
