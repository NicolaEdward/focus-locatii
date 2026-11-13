// Runs in the browser via CDP. These targeted checks complement names/labels;
// they deliberately do not claim full WCAG coverage or inspect image contrast.
function renderedUiAudit() {
  const critical = [];
  const warnings = [];
  const contrastFailures = [];
  const contrastTargets = [];
  const overflowFailures = [];
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  };
  const parse = (value) => {
    const numbers = value.match(/[\d.]+/g)?.map(Number);
    if (!numbers || numbers.length < 3) return null;
    return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
  };
  const blend = (foreground, background) => foreground.slice(0, 3).map((value, i) => value * foreground[3] + background[i] * (1 - foreground[3]));
  const luminance = (color) => color.map((value) => { const n = value / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  function background(element) {
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    let color = [255, 255, 255];
    let unknownGradient = false;
    for (const node of ancestors) {
      const style = getComputedStyle(node);
      const next = parse(style.backgroundColor);
      if (next) {
        color = blend(next, color);
        if (next[3] === 1) unknownGradient = false;
      }
      if (style.backgroundImage !== "none" && !node.classList.contains("theme-dark-panel")) unknownGradient = true;
    }
    return unknownGradient ? null : color;
  }
  const selector = '[data-ui-contrast], [data-crm-metric-value], .theme-dark-panel h1, .theme-dark-panel p, .text-status-success, .text-status-danger, .text-status-warning, .text-status-info, .text-red-100, .text-red-200, .text-emerald-100, .text-emerald-200, .text-amber-100, .text-amber-200, .text-focus-yellow';
  let contrastChecked = 0;
  let contrastSkipped = 0;
  for (const element of document.querySelectorAll(selector)) {
    if (!(element instanceof HTMLElement) || !visible(element) || element.closest(':disabled,[aria-disabled="true"]')) continue;
    if (!Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
    const style = getComputedStyle(element);
    const bg = background(element);
    const fg = parse(style.color);
    if (!bg || !fg || Number(style.opacity) < 1) { contrastSkipped++; continue; }
    const color = blend(fg, bg);
    const values = [luminance(color), luminance(bg)].sort((a, b) => b - a);
    const ratio = (values[0] + 0.05) / (values[1] + 0.05);
    const size = parseFloat(style.fontSize);
    const threshold = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
    contrastChecked++;
    contrastTargets.push({ text: element.textContent.trim().slice(0, 80), ratio: +ratio.toFixed(2), threshold });
    if (ratio + 0.01 < threshold) contrastFailures.push({ text: element.textContent.trim().slice(0, 80), ratio: +ratio.toFixed(2), threshold, color: style.color, background: bg.map(Math.round) });
  }
  const structural = document.querySelectorAll('main, #rezervari-workspace, #rezervari-workspace > .focus-card, [data-ui-structural]');
  for (const element of structural) {
    if (!(element instanceof HTMLElement) || !visible(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.right > innerWidth + 2 || rect.left < -2 || rect.width > innerWidth + 2) overflowFailures.push({ tag: element.tagName, id: element.id, width: +rect.width.toFixed(1), left: +rect.left.toFixed(1), right: +rect.right.toFixed(1) });
  }
  if (contrastFailures.length) critical.push(`${contrastFailures.length} texte semantice nu ating contrastul măsurabil cerut.`);
  if (overflowFailures.length) critical.push(`${overflowFailures.length} containere structurale ies din viewport.`);
  if (contrastSkipped) warnings.push(`${contrastSkipped} texte nu au contrast calculat automat (gradient/transparență); revizuire vizuală necesară.`);
  return { critical, warnings, contrastChecked, contrastSkipped, contrastTargets: contrastTargets.slice(0, 24), contrastFailures: contrastFailures.slice(0, 12), overflowFailures, coverage: { targetedTextContrast: true, structuralReflow: true, fullWcagCertification: false } };
}

module.exports = { renderedUiAudit };
