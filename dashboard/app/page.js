import Image from "next/image";
import Link from "next/link";
import WeatherDashboard from "./components/WeatherDashboard";
import WelcomeHero from "./components/WelcomeHero";
import MoreMenu from "./components/MoreMenu";
import { AppHeader, AppNav } from "./components/AppChrome";
import ParkClosedNotice from "./components/ParkClosedNotice";
import UpcomingShowCards from "./components/UpcomingShowCards";
import ParkCheckIn from "./components/ParkCheckIn";
import ParkSuggestion from "./components/ParkSuggestion";
import VisitPreflight from "./components/VisitPreflight";
import movieParkLogo from "./assets/movie-park-logo.png";

function PinIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/></svg>;
}

function NavIcon({ type }) {
  if (type === "shows") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM8 3v3m8-3v3M8 18v3m8-3v3M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  if (type === "map") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  if (type === "rides") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6 18V9l3-3 3 4 3-6 3 5v9M8 14h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (type === "more") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3v-9.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}

export default function Dashboard() {
  return <div className="app-shell home-app">
    <ParkClosedNotice />
    <AppHeader home />

    <main id="top" className="home-main">
      <WelcomeHero />

      <ParkCheckIn />
      <VisitPreflight />

      <UpcomingShowCards />
      <ParkSuggestion />

      <WeatherDashboard />

      <section className="coming-next" aria-label="Weitere Park-Funktionen">
        <div className="section-heading"><div><p className="eyebrow">Neu im Park Guide</p><h2>Dein Tag auf einen Blick</h2></div></div>
        <div className="feature-placeholders">
          <Link href="/park-day"><span className="placeholder-icon"><NavIcon type="rides" /></span><div><strong>Was jetzt?</strong><small>Die beste nächste Aktion aus deinen Live-Daten</small></div><span className="soon">Öffnen →</span></Link>
          <Link href="/map"><span className="placeholder-icon"><NavIcon type="map" /></span><div><strong>Parkplan</strong><small>Bereiche, Rides und Wartezeiten</small></div><span className="soon">Öffnen →</span></Link>
        </div>
      </section>
    </main>

    <footer className="site-footer">
      <div className="footer-location"><PinIcon /><span>Movie Park Germany · Bottrop, Germany</span></div>
      <a className="official-link" href="https://www.movieparkgermany.de/" target="_blank" rel="noopener noreferrer">Offizielle Movie Park Website <span aria-hidden="true">↗</span></a>
      <Link className="official-link" href="/legal">Impressum & Datenschutz <span aria-hidden="true">→</span></Link>
      <p>© 2026 Movie Park Fan Dashboard · Unabhängiges Fanprojekt, nicht offiziell mit Movie Park Germany verbunden.</p>
    </footer>

    <AppNav active="home" />
  </div>;
}
