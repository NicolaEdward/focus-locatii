import Link from "next/link";
import { MapPin } from "lucide-react";
import { FocusLogo } from "@/components/brand/FocusLogo";
import { ContactInlineLinks } from "@/components/public/ContactButtons";
import { GENERAL_CONTACT_MESSAGE } from "@/lib/contact";

export function PublicHeader() {
  const subject = "Cerere portofoliu Focus Media";

  return (
    <header className="no-print sticky top-0 z-40 border-b border-focus-line bg-focus-navy/88 backdrop-blur">
      <div className="focus-container flex min-h-20 items-center justify-between gap-4">
        <FocusLogo />
        <nav className="hidden items-center gap-2 md:flex">
          <Link className="focus-button secondary" href="/locatii">
            <MapPin size={18} />
            Locatii
          </Link>
          <ContactInlineLinks message={GENERAL_CONTACT_MESSAGE} subject={subject} compact />
        </nav>
      </div>
    </header>
  );
}
