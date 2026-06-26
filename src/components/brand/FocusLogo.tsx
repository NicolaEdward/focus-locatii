import Link from "next/link";

export function FocusLogo({ href = "/locatii" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center" aria-label="Focus Media">
      <span className="block overflow-hidden rounded-md bg-white p-1 shadow-focus">
        <img src="/brand/focus-logo.jpg" alt="Focus Media" className="h-12 w-auto object-contain" />
      </span>
    </Link>
  );
}
