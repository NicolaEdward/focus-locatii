import { NextRequest, NextResponse } from "next/server";

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,120}$/;

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!DRIVE_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid photo id" }, { status: 400 });
  }

  const response = await fetch(`https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`, {
    redirect: "follow"
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Photo unavailable" }, { status: 502 });
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Drive file is not an image" }, { status: 502 });
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "Imaginea depaseste limita acceptata." }, { status: 413 });
  }

  const body = await response.arrayBuffer();

  return new NextResponse(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800"
    }
  });
}
