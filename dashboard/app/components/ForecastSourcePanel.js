import Link from "next/link";

export default function ForecastSourcePanel({pipeline,compact=false}){
  if(!pipeline)return null;
  return <section className={`data-source-panel${compact?" is-compact":""}`} aria-label="Herkunft der angezeigten Daten">
    <header><div><p className="eyebrow">Datenherkunft</p><h2>{compact?"Woher kommen diese Werte?":"Jeder Wert mit klarer Quelle"}</h2></div><Link href="/data-info#quellen">Alle Quellen</Link></header>
    <div>
      <article><span>LIVE</span><strong>Wartezeiten & Status</strong><p>{pipeline.waits.origin} → {pipeline.waits.storage}</p></article>
      <article className={pipeline.forecast.kind==="test"?"is-test":""}><span>{pipeline.forecast.kind==="test"?"TEST":"BERECHNET"}</span><strong>{pipeline.forecast.label}</strong><p>{pipeline.forecast.method} · Version {pipeline.forecast.version}</p></article>
      <article><span>WETTER</span><strong>{pipeline.weather.origin}</strong><p>{pipeline.weather.storage}</p></article>
      <article><span>KALENDER</span><strong>{pipeline.calendar.origin}</strong><p>{pipeline.calendar.storage}</p></article>
    </div>
  </section>;
}
