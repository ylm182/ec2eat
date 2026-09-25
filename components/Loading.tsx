export function Loading({ label = "等一等…", announce = true }: { label?: string; announce?: boolean }) {
  return <div className="loading-overlay" role={announce ? "status" : undefined} aria-live={announce ? "polite" : undefined} aria-hidden={!announce || undefined}><div className="loading-orbit" aria-hidden="true"><span>✦</span></div><strong>{label}</strong></div>;
}
