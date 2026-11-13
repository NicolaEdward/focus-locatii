export function googleDriveToViewUrl(url?: string | null) {
  if (!url) return null;
  const id = googleDriveFileId(url);
  return id ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}` : url;
}

export function googleDriveFileId(url?: string | null) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["drive.google.com", "drive.usercontent.google.com"].includes(parsed.hostname)) return null;
    const id = parsed.pathname.match(/^\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get("id");
    return id && /^[A-Za-z0-9_-]{10,120}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function displayPhotoUrl(url?: string | null) {
  if (!url) return null;

  const id = googleDriveFileId(url);
  if (id) return `/api/photos/google-drive/${encodeURIComponent(id)}`;

  return url;
}

export function samplePhotoForCode(code: string) {
  return "/samples/location-placeholder.svg";
}
