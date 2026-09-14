import Link from "next/link";

export default function ForecastModeNotice({ mode="baseline", fallback=false, compact=false }) {
  const testMode=mode==="experimental";
  return <section className={`forecast-mode-banner ${testMode?"is-experimental":"is-baseline"}${compact?" is-compact":""}`} aria-label="Verwendete Prognose">
    <span className="forecast-mode-dot"/>
    <div>
      <strong>{testMode?"Hybrid-Prognose aktiv":"Standardprognose aktiv"}</strong>
      <small>{testMode?"Die Hybrid-Prognose ist dauerhaft aktiv. Sie kombiniert CatBoost mit sicheren historischen Ersatzwerten und bleibt als Testmodell klar gekennzeichnet.":fallback?"Die Hybrid-Prognose ist derzeit nicht verfügbar.":"Alle Prognosewerte auf dieser Seite stammen aus der geprüften Standardprognose."}</small>
      <Link href="/data-info#prognosen">Modellauswahl erklärt</Link>
    </div>
    <b>{testMode?"TEST":"STANDARD"}</b>
  </section>;
}
