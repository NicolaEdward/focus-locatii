"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ExternalLink, Link2, Printer, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LocationPresentation } from "@/components/public/LocationPresentation";
import type { LocationDTO } from "@/types/location";

export function LocationPresentationOverlay({
  location,
  isShortlisted,
  onClose,
  onShortlist
}: {
  location: LocationDTO;
  isShortlisted: boolean;
  onClose: () => void;
  onShortlist: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const directUrl = `/locatii/${location.id}`;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isEscapeKey(event)) return;
      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const urls = [location.mainPhotoUrl, ...location.images.map((image) => image.url)].filter(Boolean).slice(0, 4);
    urls.forEach((url) => {
      const image = new window.Image();
      image.decoding = "async";
      image.src = url as string;
    });
  }, [location]);

  async function copyDirectLink() {
    const url = `${window.location.origin}${directUrl}`;
    if (window.navigator.clipboard) {
      await window.navigator.clipboard.writeText(url);
    } else {
      const input = document.createElement("textarea");
      input.value = url;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <motion.div
      className="fixed inset-0 z-[60] overflow-auto bg-focus-ink/96 p-3 backdrop-blur md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Prezentare locatie"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="mx-auto grid max-w-[1680px] gap-4">
        <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-focus-line bg-focus-navy/96 p-3 shadow-focus backdrop-blur">
          <div>
            <p className="text-xs font-black uppercase text-focus-yellow">Prezentare locatie</p>
            <h2 className="font-display text-2xl font-black uppercase leading-none text-white">
              {location.code} {location.city ? `- ${location.city}` : ""}
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="focus-button secondary !min-h-0 px-3 py-2" type="button" onClick={onShortlist}>
              <Star size={18} />
              {isShortlisted ? "In media plan" : "Adauga in media plan"}
            </button>
            <button className="focus-button secondary !min-h-0 px-3 py-2" type="button" onClick={copyDirectLink}>
              <Link2 size={18} />
              {copied ? "Copiat" : "Copiaza link"}
            </button>
            <button className="focus-button secondary !min-h-0 px-3 py-2" type="button" onClick={() => window.print()}>
              <Printer size={18} />
              PDF
            </button>
            <Link className="focus-button secondary !min-h-0 px-3 py-2" href={directUrl} prefetch>
              <ExternalLink size={18} />
              Link direct
            </Link>
            <button className="focus-button !min-h-0 px-3 py-2" type="button" onClick={onClose} aria-label="Inchide prezentarea">
              <X size={18} />
              Inchide
            </button>
          </div>
        </div>

        <LocationPresentation location={location} onShortlist={onShortlist} isShortlisted={isShortlisted} />
      </div>
    </motion.div>
  );
}

function isEscapeKey(event: KeyboardEvent) {
  return event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
}
