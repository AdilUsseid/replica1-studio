import { useEffect, useState } from "react";
import { Channels } from "./pages/Channels";
import { Dashboard } from "./pages/Dashboard";
import { Jobs } from "./pages/Jobs";

interface NavItem { id: string; label: string; milestone?: string }
const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "channels", label: "Canais" },
  { id: "jobs", label: "Produções e jobs" },
  { id: "ideas", label: "Fila de ideias", milestone: "B" },
  { id: "research", label: "Pesquisa e fontes", milestone: "B" },
  { id: "scripts", label: "Roteiros", milestone: "B" },
  { id: "scenes", label: "Editor de cenas", milestone: "C" },
  { id: "assets", label: "Assets", milestone: "C" },
  { id: "voice", label: "Legendas e narração", milestone: "C" },
  { id: "shorts", label: "Shorts", milestone: "D" },
  { id: "thumbs", label: "Thumbnails", milestone: "D" },
  { id: "review", label: "Revisão e aprovação", milestone: "E" },
  { id: "schedule", label: "Agenda", milestone: "F" },
  { id: "integrations", label: "Integrações", milestone: "E" },
];
const ready = (id: string) => NAV.some((n) => n.id === id && !n.milestone);
const fromHash = () => { const h = location.hash.replace("#/", ""); return ready(h) ? h : "dashboard"; };

export function App() {
  const [route, setRoute] = useState(fromHash);
  useEffect(() => {
    const on = () => setRoute(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (r: string) => { location.hash = `#/${r}`; };
  return (
    <div className="shell">
      <nav className="side" aria-label="Principal">
        <div className="brand"><span className="logo" aria-hidden>▶</span> Replica Studio</div>
        <ul>
          {NAV.map((n) => (
            <li key={n.id}>
              {n.milestone ? (
                <span className="nav disabled" aria-disabled="true" title={`Disponível no Marco ${n.milestone}`}>{n.label}<em>Marco {n.milestone}</em></span>
              ) : (
                <a className={`nav ${route === n.id ? "active" : ""}`} href={`#/${n.id}`} aria-current={route === n.id ? "page" : undefined}>{n.label}</a>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <main>
        {route === "dashboard" && <Dashboard go={go} />}
        {route === "channels" && <Channels />}
        {route === "jobs" && <Jobs />}
      </main>
    </div>
  );
}
