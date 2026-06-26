export default function AdminLoading() {
  return (
    <main className="focus-shell grid min-h-[60vh] place-items-center p-6" aria-live="polite">
      <div className="text-center">
        <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-2 border-focus-line border-t-focus-yellow" />
        <p className="mt-4 text-sm font-bold text-slate-300">Se incarca datele operationale...</p>
      </div>
    </main>
  );
}
