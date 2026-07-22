async function main() {
  throw new Error("Importul legacy de rezervari a fost retras. Foloseste exclusiv serviciul canonic de rezervari.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export {};
