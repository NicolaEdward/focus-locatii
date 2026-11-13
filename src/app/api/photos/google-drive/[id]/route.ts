import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { googleDriveFileId } from "@/lib/photos";
import { getAuthSessionFromRequest } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { PassiveImageError, passiveImageType, PHOTO_TIMEOUT_MS, readLimitedPhoto } from "@/lib/passive-image";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { rateLimitIdentity } from "@/lib/request-security";

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,120}$/;
const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie" };

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!DRIVE_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Identificator foto invalid." }, { status: 400, headers: privateHeaders });
  }
  try {
    const rate = await consumeRateLimit({ scope: "photo.proxy", identifier: rateLimitIdentity(request), limit: 300, windowSeconds: 60 });
    if (!rate.allowed) return NextResponse.json({ error: "Prea multe cereri de imagini." }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(rate.retryAfter) } });
    const candidates = await prisma.location.findMany({
      where: { OR: [{ mainPhotoUrl: { contains: id } }, { photoOriginalUrl: { contains: id } }, { images: { some: { url: { contains: id } } } }] },
      select: { showInPublic: true, lifecycleStatus: true, mainPhotoUrl: true, photoOriginalUrl: true, images: { select: { url: true, alt: true } } }
    });
    const published = candidates.some((location) => location.showInPublic && location.lifecycleStatus === "ACTIVE" && (
      [location.mainPhotoUrl, location.photoOriginalUrl].some((url) => googleDriveFileId(url) === id)
      // Production sketches are deliberately part of the published commercial
      // record too; their image formats receive the same passive-content checks.
      || location.images.some((image) => googleDriveFileId(image.url) === id)
    ));
    if (!published) {
      const session = await getAuthSessionFromRequest(request);
      const linked = candidates.some((location) => [location.mainPhotoUrl, location.photoOriginalUrl, ...location.images.map((image) => image.url)].some((url) => googleDriveFileId(url) === id));
      if (!linked || !session || !hasPermission(session.role, "inventory.view")) {
        return NextResponse.json({ error: "Imaginea nu este publicată." }, { status: 404, headers: privateHeaders });
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);
    try {
      const response = await fetch(`https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`, { redirect: "follow", signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new PassiveImageError("Imagine indisponibilă.", 502);
      const declaredType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(declaredType)) {
        await response.body?.cancel();
        throw new PassiveImageError("Formatul imaginii nu este permis.", 415);
      }
      const body = await readLimitedPhoto(response);
      const type = passiveImageType(body);
      if (!type || type.mime !== declaredType) throw new PassiveImageError("Conținutul imaginii nu corespunde formatului declarat.", 415);
      return new NextResponse(Buffer.from(body), { headers: {
        ...privateHeaders,
        "Content-Type": type.mime,
        "Content-Disposition": `inline; filename="photo.${type.extension}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox"
      } });
    } finally { clearTimeout(timeout); }
  } catch (error) {
    const status = error instanceof PassiveImageError ? error.status : error instanceof Error && error.name === "AbortError" ? 504 : 503;
    return NextResponse.json({ error: error instanceof PassiveImageError ? error.message : "Serviciul de imagini este temporar indisponibil." }, { status, headers: privateHeaders });
  }
}
