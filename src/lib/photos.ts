export function googleDriveToViewUrl(url?: string | null) {
  if (!url) return null;

  const idPatterns = [
    /drive\.google\.com\/file\/d\/([^/]+)/,
    /drive\.google\.com\/open\?id=([^&]+)/,
    /drive\.google\.com\/uc\?id=([^&]+)/,
    /[?&]id=([^&]+)/
  ];

  for (const pattern of idPatterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return `https://drive.google.com/uc?export=view&id=${match[1]}`;
    }
  }

  return url;
}

export function googleDriveFileId(url?: string | null) {
  if (!url) return null;

  const patterns = [
    /drive\.google\.com\/file\/d\/([^/]+)/,
    /drive\.google\.com\/open\?id=([^&]+)/,
    /drive\.google\.com\/uc\?[^#]*[?&]?id=([^&]+)/,
    /drive\.usercontent\.google\.com\/download\?[^#]*[?&]?id=([^&]+)/,
    /[?&]id=([^&]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }

  return null;
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
