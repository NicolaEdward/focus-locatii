export async function downloadMediaPlanExcel(locationIds: string[]) {
  if (!locationIds.length) return false;

  const response = await fetch("/api/shortlist/excel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: locationIds })
  });

  if (!response.ok) {
    throw new Error("Exportul Excel nu a putut fi generat.");
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `focus-media-plan-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);

  return true;
}
