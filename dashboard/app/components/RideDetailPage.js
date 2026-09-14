"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { rideDescription } from "../data/rideDescriptions";
import { AppHeader, AppNav } from "./AppChrome";
import ForecastModeNotice from "./ForecastModeNotice";
import { localeCode } from "../lib/locale";
import { readForecastMode } from "../lib/forecastMode";
import area51 from "../assets/attraktionen/area51.jpeg";
import bandit from "../assets/attraktionen/bandit.jpg";
import excalibur from "../assets/attraktionen/excalibur.jpg";
import ghost from "../assets/attraktionen/ghostchaser.jpg";
import iron from "../assets/attraktionen/ironclaw.jpg";
import nyc from "../assets/attraktionen/nyctransformer.jpg";
import startrek from "../assets/attraktionen/startrek.jpg";
import vanhelsing from "../assets/attraktionen/vanhelsing.jpg";
import studio from "../assets/attraktionen/studiotour.jpg";
import highfall from "../assets/attraktionen/highfall.jpg";
import forbidden from "../assets/attraktionen/journytotheforbiddenchamber.jpg";
import airglider from "../assets/attraktionen/airglider.jpg";
import mission from "../assets/attraktionen/missiontomars.jpg";
import fairy from "../assets/attraktionen/fairyspin.jpg";
import atomic from "../assets/attraktionen/atomicflyer.jpg";
import splash from "../assets/attraktionen/splashbattle.jpg";
import splat from "../assets/attraktionen/splatosphere.jpg";
import dora from "../assets/attraktionen/dora.jpg";
import crazy from "../assets/attraktionen/crazysurfer.jpg";
import paw from "../assets/attraktionen/pawpatroladventure.jpg";
import carousel from "../assets/attraktionen/piersidecarousel.jpg";
import rescue from "../assets/attraktionen/rescue112.jpg";
import wheel from "../assets/attraktionen/santamonicawheel.jpg";
import seaswing from "../assets/attraktionen/seaswing.jpg";
import sidekick from "../assets/attraktionen/sidekick.jpg";
import zuma from "../assets/attraktionen/zumazoomers.jpg";
import skye from "../assets/attraktionen/skyhighflyer.jpg";
import stormy from "../assets/attraktionen/stormycruise.jpg";
import license from "../assets/attraktionen/licensetodrive.jpg";
import timeriders from "../assets/attraktionen/timeriders.jpg";

const IMAGES={10981:area51,10987:bandit,10985:excalibur,10997:ghost,10982:iron,10999:nyc,10984:startrek,11000:vanhelsing,10993:studio,10989:highfall,16233:forbidden,10996:airglider,11002:mission,10992:fairy,11001:atomic,10983:splash,11005:splat,10995:dora,11007:crazy,10994:paw,10988:carousel,11006:rescue,10998:wheel,11008:seaswing,11004:sidekick,10990:zuma,10991:skye,11011:stormy,11010:license,11009:timeriders};
const formatDate=(date,full=false)=>new Intl.DateTimeFormat(localeCode(),{weekday:full?"long":"short",day:"2-digit",month:"2-digit"}).format(new Date(`${date}T12:00:00Z`));
const parkMinute=timestamp=>{
  const parts=new Intl.DateTimeFormat(localeCode(),{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(timestamp));
  const get=type=>Number(parts.find(part=>part.type===type)?.value||0);
  return get("hour")*60+get("minute");
};
const validHistory=history=>history.filter(point=>point.measurementValid&&point.waitMinutes!=null).map(point=>({minute:parkMinute(point.observedAt),value:Number(point.waitMinutes)}));

function WaitChart({ history=[], prediction=[], closures=[], showNow=false }) {
  const measured=validHistory(history);
  const values=[...measured.map(point=>point.value),...prediction.flatMap(point=>[point.lower,point.upper,point.predicted])].filter(Number.isFinite);
  const max=Math.max(30,Math.ceil(Math.max(...values,0)/10)*10);
  const allMinutes=[...measured.map(point=>point.minute),...prediction.map(point=>point.minute),...closures.flatMap(item=>[item.startMinute,item.endMinute])];
  const start=Math.max(0,Math.floor((Math.min(...allMinutes,600)-30)/60)*60),end=Math.min(1440,Math.ceil((Math.max(...allMinutes,1080)+30)/60)*60);
  const left=64,right=880,top=24,bottom=300;
  const x=minute=>left+(minute-start)/(end-start)*(right-left);
  const y=value=>bottom-(value/max)*(bottom-top);
  const line=points=>points.map((point,index)=>`${index?"L":"M"}${x(point.minute).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const segments=[]; let segment=[];
  for(const point of measured){if(segment.length&&point.minute-segment.at(-1).minute>15){segments.push(segment);segment=[]}segment.push(point)}
  if(segment.length)segments.push(segment);
  const range=prediction.length?`${line(prediction.map(point=>({minute:point.minute,value:point.upper})))} ${[...prediction].reverse().map(point=>`L${x(point.minute).toFixed(1)},${y(point.lower).toFixed(1)}`).join(" ")} Z`:"";
  const nowMinute=parkMinute(new Date().toISOString());
  const yTicks=Array.from({length:max/10+1},(_,index)=>index*10);
  const xTicks=Array.from({length:Math.floor((end-start)/60)+1},(_,index)=>start+index*60);
  return <div className="ride-chart-scroll"><svg className="ride-wait-chart" viewBox="0 0 920 350" role="img" aria-label="Gemessene Wartezeiten, Prognose und typischer Bereich">
    <text className="axis-title" x="12" y="15">Minuten</text>
    {yTicks.map(value=><g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left-12} y={y(value)+4} textAnchor="end">{value}</text></g>)}
    {xTicks.map(minute=><g key={minute}><line className="vertical-grid" x1={x(minute)} x2={x(minute)} y1={top} y2={bottom}/><text x={x(minute)} y="326" textAnchor="middle">{String(Math.floor(minute/60)).padStart(2,"0")}:{String(minute%60).padStart(2,"0")}</text></g>)}
    {closures.map((item,index)=><g className="closure-band" key={`${item.startMinute}-${index}`}><rect x={x(Math.max(start,item.startMinute))} y={top} width={Math.max(2,x(Math.min(end,item.endMinute))-x(Math.max(start,item.startMinute)))} height={bottom-top}/><text x={x(Math.max(start,item.startMinute))+6} y={top+16}>Geschlossen</text></g>)}
    {range?<path className="prediction-band" d={range}/>:null}
    {prediction.length?<path className="prediction-line" d={line(prediction.map(point=>({minute:point.minute,value:point.predicted})))}/>:null}
    {segments.map((points,index)=><path className="history-line" d={line(points)} key={index}/>) }
    {measured.map((point,index)=><circle className="history-dot" key={`${point.minute}-${index}`} cx={x(point.minute)} cy={y(point.value)} r="4"/>)}
    {showNow&&nowMinute>=start&&nowMinute<=end?<g className="chart-now"><line x1={x(nowMinute)} x2={x(nowMinute)} y1={top} y2={bottom}/><text x={x(nowMinute)} y="18" textAnchor="middle">Jetzt</text></g>:null}
  </svg></div>;
}

function ComparisonGrid({ history=[], prediction=[], futureOnly=false }) {
  const measured=validHistory(history);
  const nowMinute=parkMinute(new Date().toISOString());
  const rowMinutes=new Set(prediction.map(point=>point.minute));
  measured.forEach(point=>rowMinutes.add(Math.max(570,Math.min(1080,Math.round(point.minute/30)*30))));
  const rows=[...rowMinutes].sort((a,b)=>a-b).filter(minute=>!futureOnly||minute>=nowMinute-30).map(minute=>{
    const expected=prediction.find(point=>point.minute===minute);
    const nearby=measured.filter(item=>Math.abs(item.minute-minute)<=16);
    const actual=nearby.length?Math.round(nearby.reduce((sum,item)=>sum+item.value,0)/nearby.length):null;
    return {minute,time:`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`,predicted:expected?.predicted??null,lower:expected?.lower??null,upper:expected?.upper??null,actual};
  });
  if(!rows.length)return <p className="ride-empty">Für diesen Zeitraum liegen noch keine ausreichenden Daten vor.</p>;
  return <div className="wait-comparison">
    <div className="wait-comparison-head"><span>Uhrzeit</span><span>Vorher geschätzt</span><span>Später gemessen</span></div>
    {rows.map(point=><article key={point.time} className={point.actual!=null?"has-actual":"is-future"}>
      <time>{point.time}</time>
      <div>{point.predicted!=null?<><strong>{point.predicted} Min.</strong><small>möglich: {point.lower}–{point.upper}</small></>:<><strong>–</strong><small>keine frühere Schätzung</small></>}</div>
      <div>{point.actual!=null?<><strong>{point.actual} Min.</strong><small className={point.predicted==null?"":point.actual>point.predicted?"is-higher":"is-lower"}>{point.predicted==null?"gemessener Wert":point.actual===point.predicted?"genau getroffen":`${Math.abs(point.actual-point.predicted)} Min. ${point.actual>point.predicted?"höher":"niedriger"}`}</small></>:<><strong>–</strong><small>für diese Uhrzeit noch kein Messwert</small></>}</div>
    </article>)}
  </div>;
}

export default function RideDetailPage({ rideId }) {
  const [data,setData]=useState(null); const [error,setError]=useState("");
  const [tab,setTab]=useState(""); const [pastDate,setPastDate]=useState("");
  useEffect(()=>{const mode=readForecastMode();fetch(`/api/attractions/${rideId}/insights?mode=${mode}`,{cache:"no-store"}).then(async r=>{const p=await r.json();if(!r.ok)throw new Error(p.error);setData(p)}).catch(e=>setError(e.message));},[rideId]);
  useEffect(()=>{if(data?.pastDays?.length&&!pastDate)setPastDate(data.pastDays[0].date)},[data,pastDate]);
  useEffect(()=>{if(data&&!tab)setTab(data.park?.isOpenNow?"today":data.park?.todayFinished&&data.pastDays?.some(day=>day.date===data.predictions?.today?.date)?"past":"next")},[data,tab]);
  const selectedPast=useMemo(()=>data?.pastDays?.find(day=>day.date===pastDate)||data?.pastDays?.[0],[data,pastDate]);
  const view=useMemo(()=>{
    if(tab==="next")return {history:[],closures:[],prediction:data?.predictions?.nextOpen?.points||[],recommendations:data?.predictions?.nextOpen?.recommendations||[]};
    if(tab==="past")return {history:selectedPast?.points||[],closures:selectedPast?.closureIntervals||[],prediction:selectedPast?.prediction||[],recommendations:selectedPast?.recommendations||[]};
    return {history:data?.history||[],closures:data?.closureIntervals||[],prediction:data?.predictions?.today?.points||[],recommendations:data?.predictions?.today?.recommendations||[]};
  },[data,tab,selectedPast]);
  if(error)return <main className="ride-detail-loading">{error}<Link href="/attractions">← Zurück</Link></main>;
  if(!data)return <main className="ride-detail-loading">Attraktionsdetails werden geladen …</main>;
  const {ride,current}=data; const image=IMAGES[ride.id];
  const bestWindows=view.recommendations||[];
  const nextBest=data.predictions?.nextOpen?.recommendations?.[0]||null;
  const recentValues=validHistory(selectedPast?.points||[]).map(point=>point.value);
  const recentTypical=recentValues.length?Math.round(recentValues.reduce((sum,value)=>sum+value,0)/recentValues.length):null;
  const storedRecommendations=data.recommendationHistory||[],todayDate=data.predictions?.today?.date,currentParkMinute=parkMinute(new Date().toISOString());
  const comparisonDate=data.park?.isOpenNow?todayDate:data.predictions?.nextOpen?.date;
  const completedRecommendations=storedRecommendations.filter(item=>item.resolvedAt).sort((a,b)=>b.date.localeCompare(a.date)||b.targetMinute-a.targetMinute).slice(0,3);
  const pendingRecommendations=storedRecommendations.filter(item=>!item.resolvedAt&&item.date===comparisonDate&&(!data.park?.isOpenNow||item.targetMinute>=currentParkMinute)).sort((a,b)=>a.targetMinute-b.targetMinute).slice(0,5);
  const dateTitle=tab==="comparison"?"Vorhersage und Messwert":tab==="today"?"Heute":tab==="past"&&selectedPast?formatDate(selectedPast.date,true):data.park?.nextOpenDate?formatDate(data.park.nextOpenDate,true):"Nächster Besuch";
  const currentStatus=!data.park?.isOpenNow?{value:"Park geschlossen",copy:"Aktuell gibt es keine Live-Wartezeit."}:!current?.sourceFresh?{value:"Status nicht aktuell",copy:"Der letzte Datenstand ist zu alt für eine sichere Live-Aussage."}:current?.status==="closed"?{value:"Vorübergehend geschlossen",copy:"Die Attraktion ist momentan außer Betrieb. Wir melden Favoriten bei der Wiederöffnung."}:current?.status==="open"&&current?.measurementValid&&current?.waitMinutes!=null?{value:`${current.waitMinutes} Min.`,copy:"Aktuelle Wartezeit vor Ort"}:{value:"Status unbekannt",copy:"Momentan liegt keine verlässliche Wartezeit vor."};
  return <div className="ride-detail-app">
    <AppHeader backHref="/attractions" title="Ride-Details" />
    <main className="ride-detail-main">
      <section className="ride-detail-hero">{image?<Image src={image} alt="" fill priority sizes="100vw"/>:null}<div className="ride-detail-shade"/><div><p className="eyebrow">{ride.category?.replaceAll("_"," ")}</p><h1>{ride.name}</h1><p>{rideDescription(ride)}</p></div></section>
      <section className="ride-current"><div><small>Aktueller Status</small><strong>{currentStatus.value}</strong><p>{currentStatus.copy}</p></div><div><small>Datenstand</small><strong>{current?.sourceFresh?"Live-Daten":"Letzter Stand"}</strong><p>{current?.observedAt?new Intl.DateTimeFormat(localeCode(),{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Berlin"}).format(new Date(current.observedAt)):"Kein Zeitstempel verfügbar"}</p></div><div><small>Nächste günstige Zeit</small><strong>{data.park?.nextOpenDate?formatDate(data.park.nextOpenDate,true):"Noch offen"}</strong><p>{nextBest?`${nextBest.time} Uhr · etwa ${nextBest.predicted} Min.`:"Noch keine zukünftige Empfehlung."}</p></div></section>
      <section className={`ride-reliability-strip ${ride.operatingReliability<65?"is-risk":""}`}><div><small>Betriebsquote der letzten Tage</small><strong>{ride.operatingReliability??"—"}%</strong></div><p>{data.lifecycle!=="active"?"Noch kein bestätigter Betrieb in den vorhandenen Daten.":ride.operatingReliability<65?"Diese Attraktion hatte zuletzt häufigere Unterbrechungen. Prüfe vor dem Weg dorthin den Live-Status.":"Die Attraktion war in den letzten Datentagen überwiegend in Betrieb."}</p></section>
      {data.sources?<details className="ride-source-summary"><summary><span><strong>Woher kommen diese Angaben?</strong><small>Live-Wert, Verlauf und Prognose getrennt ansehen</small></span><b>+</b></summary><div><article><span>LIVE</span><strong>Queue-Times → lokale Datenbank</strong><p>Status und Wartezeit aus {data.sources.live.tables.join(", ")}.</p></article><article><span>VERLAUF</span><strong>Gespeicherte Queue-Times-Messungen</strong><p>Frühere Snapshots und daraus erzeugte Trainingszeilen.</p></article><article><span>BERECHNET</span><strong>{data.sources.forecast.label}</strong><p>{data.sources.forecast.version?`Version ${data.sources.forecast.version} · `:""}{data.sources.forecast.storage}</p></article><article><span>KALENDER</span><strong>{data.sources.calendar.origin}</strong><p>{data.sources.calendar.storage}</p></article><Link href="/data-info#quellen">Datenweg vollständig erklären →</Link></div></details>:null}
      {!data.park?.isOpenNow?<section className="ride-closed-guidance"><div><p className="eyebrow">Für deinen nächsten Besuch</p><h2>{data.park?.nextOpenDate?`${formatDate(data.park.nextOpenDate,true)} · ${data.park.nextOpensAt}–${data.park.nextClosesAt} Uhr`:"Nächster Öffnungstag noch offen"}</h2><p>{nextBest?`Voraussichtlich ist ${nextBest.time} Uhr ein guter Zeitpunkt mit etwa ${nextBest.predicted} Minuten Wartezeit.`:"Sobald genügend Daten vorliegen, erscheint hier die beste erwartete Zeit."}</p></div><div><small>Letzter typischer Tageswert</small><strong>{recentTypical!=null?`${recentTypical} Min.`:"Keine Vergleichsdaten"}</strong></div></section>:null}
      <ForecastModeNotice mode={data.forecastMode} fallback={data.forecastFallback} compact/>
      <section className="ride-insights"><header><div><p className="eyebrow">Einfach planen</p><h2>{dateTitle}</h2><p>{tab==="comparison"?"Gespeicherte Empfehlungen werden nach ihrem Zeitpunkt mit der wirklichen Messung verglichen.":"Wähle eine Ansicht. Die Grafik zeigt nur die Informationen, die für diese Auswahl wichtig sind."}</p></div></header>
        <div className={`ride-tabs${data.park?.isOpenNow?" has-four":""}`} role="tablist">{data.park?.isOpenNow?<button className={tab==="today"?"active":""} onClick={()=>setTab("today")}>Heute</button>:null}<button className={tab==="next"?"active":""} onClick={()=>setTab("next")}>Nächster Besuch</button><button className={tab==="past"?"active":""} onClick={()=>setTab("past")}>Frühere Tage</button><button className={tab==="comparison"?"active":""} onClick={()=>setTab("comparison")}>Vorhersage prüfen</button></div>
        {tab==="past"&&data.pastDays?.length?<div className="past-day-picker">{data.pastDays.map(day=><button key={day.date} className={selectedPast?.date===day.date?"active":""} onClick={()=>setPastDate(day.date)}>{formatDate(day.date)}</button>)}</div>:null}
        {tab==="comparison"?<div className="ride-recommendation-history is-subview"><header><div><p className="eyebrow">Vorhersagen im Rückblick</p><h2>Geschätzt und später gemessen</h2><p>Die App speichert empfohlene Uhrzeiten. Nachdem eine Uhrzeit vorbei ist, wird der nächstgelegene gemessene Wert ergänzt. So siehst du, wie gut die Empfehlung wirklich war.</p></div></header>
          {pendingRecommendations.length?<div className="recommendation-history-group"><div><h3>Kommende Empfehlungen · {formatDate(comparisonDate,true)}</h3><span>bis zu 5</span></div><div className="recommendation-history-list">{pendingRecommendations.map((item,index)=><article className="is-pending" key={item.snapshotId}><div><time>{index===0?<b className="recommendation-next-badge">Als Nächstes</b>:null}{formatDate(item.date)} · {item.time} Uhr</time><small>berechnet am {new Intl.DateTimeFormat(localeCode(),{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Berlin"}).format(new Date(item.calculatedAt))}</small></div><span><small>Geschätzt</small><strong>{item.predicted} Min.</strong><em>möglich: {item.lower}–{item.upper} Min.</em></span><span><small>Messwert</small><strong>Noch offen</strong><em>folgt nach dieser Uhrzeit</em></span></article>)}</div></div>:null}
          {completedRecommendations.length?<div className="recommendation-history-group"><div><h3>Zuletzt überprüft</h3><span>letzte 3</span></div><div className="recommendation-history-list">{completedRecommendations.map(item=><article className="is-complete" key={item.snapshotId}><div><time>{formatDate(item.date)} · {item.time} Uhr</time><small>{item.actualTime?`gemessen um ${item.actualTime} Uhr`:"kein passender Messwert vorhanden"}</small></div><span><small>Geschätzt</small><strong>{item.predicted} Min.</strong><em>möglich: {item.lower}–{item.upper} Min.</em></span><span><small>Gemessen</small><strong>{item.actual!=null?`${item.actual} Min.`:item.actualStatus==="closed"?"Attraktion geschlossen":"Nicht verfügbar"}</strong><em className={item.difference==null?"":item.difference>0?"is-higher":"is-lower"}>{item.difference==null?"kein direkter Vergleich möglich":item.difference===0?"genau getroffen":`${Math.abs(item.difference)} Min. ${item.difference>0?"höher":"niedriger"}`}</em></span></article>)}</div></div>:null}
          {!pendingRecommendations.length?<p className="ride-empty">{data.park?.isOpenNow?"Heute gibt es keine weitere gespeicherte günstige Zeit.":"Für den nächsten Öffnungstag ist noch keine günstige Zeit gespeichert."}</p>:null}
        </div>:<>
        <div className="chart-explainer">
          {view.history.length?<div className="is-history"><i/><span><strong>Tatsächlich gemessen</strong><small>Wartezeiten, die vor Ort erfasst wurden</small></span></div>:null}
          {view.prediction.length?<div className="is-prediction"><i/><span><strong>Geschätzte Wartezeit</strong><small>Standardprognose für den Tagesverlauf</small></span></div>:null}
          {view.prediction.length?<div className="is-range"><i/><span><strong>Mögliche Schwankung</strong><small>Wartezeiten können innerhalb dieses Bereichs liegen</small></span></div>:null}
          {view.closures.length?<div className="is-closure"><i/><span><strong>Vorübergehend geschlossen</strong><small>In diesem Zeitraum war die Attraktion außer Betrieb</small></span></div>:null}
        </div>
        {view.history.length||view.prediction.length?<WaitChart history={view.history} prediction={view.prediction} closures={view.closures} showNow={tab==="today"}/>:<p className="ride-empty">Für diese Ansicht liegen noch keine ausreichenden Daten vor.</p>}
        <div className="ride-window-section"><div><p className="eyebrow">Voraussichtlich kurze Wartezeit</p><h3>{bestWindows.length?"Drei passende Uhrzeiten":"Noch keine passende Uhrzeit"}</h3></div>{bestWindows.length?<div className="ride-window-grid">{bestWindows.map(point=><article key={point.time}><time>{point.time} Uhr</time><strong>geschätzt {point.predicted} Min.</strong><small>möglich: {point.lower}–{point.upper} Min.</small></article>)}</div>:<p>Für diese Ansicht liegen noch nicht genug passende Vergleichswerte vor.</p>}</div>
        </>}
      </section>
      {tab!=="comparison"?<details className="ride-data-details"><summary><span><strong>Alle Zeiten und Vergleichswerte</strong><small>Vollständige Tabelle für diese Ansicht</small></span><b>+</b></summary><div><ComparisonGrid history={view.history} prediction={view.prediction}/></div></details>:null}
      <details className="ride-data-details"><summary><span><strong>Wie verlässlich sind diese Angaben?</strong><small>{data.readiness.status==="experimental"?"Erst wenige Vergleichstage":"Aus früheren Parktagen abgeleitet"}</small></span><b>+</b></summary><div><p>{data.readiness.message}</p><p>Grundlage sind {data.readiness.distinctDays} geöffnete Parktage. {data.accuracy?.comparisons?`Bei ${data.accuracy.comparisons} abgeschlossenen Vergleichen lag die Schätzung im Mittel ${data.accuracy.mae} Minuten daneben. ${data.accuracy.intervalCoverage}% der Messwerte lagen innerhalb der vorher angegebenen Spanne.`:"Es gibt noch nicht genug abgeschlossene Vergleiche, um eine mittlere Abweichung zu nennen."}</p><p>Alle Prognosen sind Orientierung und keine Garantie. <Link href="/data-info#sicherheit">Begriffe einfach erklärt →</Link></p></div></details>
    </main><AppNav active="rides" />
  </div>;
}
