/* The ingredients of a template's edit as small chips (cuts, speed ramps, motion blur, camera moves, music…).
   A chip for something the reference did not have is shown faded, so nothing is assumed. */
export function FxChips({ items, max }: { items?: { label: string; on: boolean }[]; max?: number }) {
  if (!items?.length) return null;
  const shown = max ? items.slice(0, max) : items;
  return <ul className="fx-chips" aria-label="What this template does">{shown.map((item) => <li key={item.label} className={item.on ? "fx-chip" : "fx-chip off"}>{item.label}</li>)}</ul>;
}
