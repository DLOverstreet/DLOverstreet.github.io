// Mock Translator: rewrites a tile into a brief fitted to the contributor's tools, level,
// style and language. The checklist always mirrors the tile's criteria one to one.
import { fileExt } from '../../lib/util.js';

const L = {
  en: { purpose: 'You are delivering', done: 'It is done when every checklist item below is true.', open: 'Open', save: 'Save your files with the exact names in the deliverable format.', read: 'Read the spec and any upstream files once, end to end.', check: 'Check each item on the checklist against your files before you submit.', why: 'Why:', pit1: 'Renaming columns or files from what the spec asks for.', pit2: 'Submitting before every checklist item is true.', pit3: 'Pasting personal data into an AI tool; use the redacted inputs only.' },
  es: { purpose: 'Vas a entregar', done: 'Está terminado cuando cada punto de la lista de verificación se cumple.', open: 'Abre', save: 'Guarda tus archivos con los nombres exactos del formato de entrega.', read: 'Lee la especificación y los archivos de entrada una vez, de principio a fin.', check: 'Revisa cada punto de la lista con tus archivos antes de enviar.', why: 'Por qué:', pit1: 'Cambiar los nombres de columnas o archivos que pide la especificación.', pit2: 'Enviar antes de cumplir todos los puntos de la lista.', pit3: 'Pegar datos personales en una herramienta de IA; usa solo los datos redactados.' },
  fr: { purpose: 'Vous livrez', done: 'C’est terminé quand chaque point de la liste est vrai.', open: 'Ouvrez', save: 'Enregistrez vos fichiers avec les noms exacts du format de livraison.', read: 'Lisez la spécification et les fichiers d’entrée une fois, du début à la fin.', check: 'Vérifiez chaque point de la liste avant d’envoyer.', why: 'Pourquoi :', pit1: 'Renommer les colonnes ou les fichiers demandés.', pit2: 'Envoyer avant que chaque point soit vrai.', pit3: 'Coller des données personnelles dans un outil d’IA ; utilisez les données masquées.' },
};

function setupFor(tile, tools, lang) {
  const t = L[lang] || L.en;
  const exts = new Set((tile.acceptanceCriteria || []).map((c) => c.rule || '').join(' ').match(/\b(csv|py|svg|json|md|html)\b/g) || []);
  const out = [];
  const has = (x) => tools.includes(x);
  if (exts.has('py') || tile.skillTags.includes('python')) {
    out.push(has('vscode') ? `${t.open} VS Code and create a folder for this tile, then run: python -m venv .venv && pip install pandas requests` : `Install Python 3 from python.org, then run: pip install pandas requests`);
  }
  if (exts.has('csv') && !exts.has('py')) out.push(has('excel') ? `${t.open} Excel (or Google Sheets) and use File → Save As → CSV UTF-8.` : 'Use any spreadsheet app and export as CSV (UTF-8).');
  if (exts.has('svg')) out.push(has('figma') ? `${t.open} Figma; export the frame as SVG with “Outline text” off.` : 'Use Figma, Inkscape or code (Vega-Lite, D3) and export SVG.');
  if (exts.has('md')) out.push('Write Markdown in any plain-text editor (VS Code, Typora, or a notes app that exports .md).');
  if (exts.has('html')) out.push('Use a code editor and preview the page in a browser at phone width.');
  if (!out.length) out.push('No special tools are needed beyond a text editor and a browser.');
  return out;
}

function sentences(spec) {
  return spec.replace(/^Context:[^\n]*\n\n?/, '').split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => s.length > 8);
}

export function mockTranslator(input) {
  const { tile, contributor } = input;
  const lang = ['es', 'fr'].includes(input.language) ? input.language : 'en';
  const t = L[lang];
  const style = contributor.briefStyle || 'STEP_BY_STEP';
  const tools = contributor.tools || [];
  const specSteps = sentences(tile.spec);
  let steps = [t.read, ...specSteps, t.save, t.check];
  if (style === 'CONCISE') steps = [...specSteps.slice(0, 4), t.check];
  if (style === 'TEACH_ME') {
    steps = steps.map((s, i) => (i === 0 || i === steps.length - 1 ? s : `${s} ${t.why} ${whyFor(s)}`));
  }
  if ((input.upstreamFiles || []).length) steps.splice(1, 0, `Download the input files: ${input.upstreamFiles.slice(0, 6).join(', ')}.`);
  return {
    purpose: `${t.purpose} ${tile.deliverableFormat} for “${tile.title}”. ${t.done}`,
    setup: setupFor(tile, tools, lang),
    steps,
    checklist: tile.acceptanceCriteria.map((c) => ({ criterionId: c.id, text: c.text })),
    pitfalls: [t.pit1, t.pit2, ...(tile.sensitiveInputs?.length ? [t.pit3] : []),
      ...tile.acceptanceCriteria.filter((c) => c.check === 'AUTO' && c.rule).slice(0, 2).map((c) => `Automatic check ${c.id}: ${c.rule}`)],
  };
}

function whyFor(step) {
  if (/csv|column/i.test(step)) return 'downstream tiles read these exact columns, so a renamed column breaks their work.';
  if (/word|write|memo|note/i.test(step)) return 'the reviewer checks length and plain language against the criteria.';
  if (/svg|chart|map/i.test(step)) return 'SVG stays sharp at any size and can be checked automatically.';
  if (/script|python|rerun/i.test(step)) return 'someone else must be able to rerun your work next month.';
  return 'it maps to one of the acceptance criteria.';
}

export { fileExt };
