import { useEffect, useState } from "react";
import { Scrapbook } from "./Scrapbook";
import { Settings } from "./Settings";

// Toki's window (Phase 7): the scrapbook and the settings, one tab each. The tab is
// in the address (#settings), so a reload keeps your place.

const TABS = [
  { id: "scrapbook", label: "Scrapbook" },
  { id: "settings", label: "Settings" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const fromHash = (): Tab => (location.hash === "#settings" ? "settings" : "scrapbook");

export function App() {
  const [tab, setTab] = useState<Tab>(fromHash);
  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return (
    <>
      {/* The top bar: Toki, then its two places as pills. */}
      <header style={{ background: "var(--tk-teal)", borderBottom: "2.5px solid var(--tk-ink)" }}>
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-6 py-2.5">
          <img src="/app/favicon.png" alt="" width={34} height={34} style={{ borderRadius: 9, border: "2px solid var(--tk-ink)" }} />
          <span className="tk-display" style={{ fontSize: 24, fontWeight: 800, color: "var(--tk-paper)", lineHeight: 1, paddingTop: 3 }}>
            Toki
          </span>
          <nav className="ml-auto flex gap-2" aria-label="Sections">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={t.id === "scrapbook" ? "#" : `#${t.id}`}
                aria-current={tab === t.id ? "page" : undefined}
                className={`tk-pill${tab === t.id ? "" : " quiet"}`}
                style={{ fontSize: 15 }}
              >
                {t.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      {tab === "settings" ? (
        <main className="mx-auto max-w-[1500px] px-6 py-5">
          <Settings />
        </main>
      ) : (
        <Scrapbook />
      )}
    </>
  );
}
