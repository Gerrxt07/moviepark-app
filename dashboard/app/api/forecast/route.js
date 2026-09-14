import { DatabaseSync } from "node:sqlite";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const DB="/opt/moviepark/app/data/moviepark.sqlite";
const label=minute=>`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
const RETIRED_RIDE_IDS=[11010];
const inRange=(value,ranges)=>ranges.some(([start,end])=>value>=start&&value<=end);
const easterSunday=year=>{const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;return new Date(Date.UTC(year,month-1,day))};
const addDays=(date,days)=>new Date(date.getTime()+days*86400000).toISOString().slice(0,10);
const calendarFlags=value=>{const year=Number(value.slice(0,4)),easter=easterSunday(year),fixed=new Set([`${year}-01-01`,`${year}-05-01`,`${year}-10-03`,`${year}-11-01`,`${year}-12-25`,`${year}-12-26`]),moving=new Set([-2,1,39,50,60].map(offset=>addDays(easter,offset)));const nrw={2026:[["2026-03-30","2026-04-11"],["2026-07-20","2026-09-01"],["2026-10-17","2026-10-31"],["2026-12-23","2027-01-06"]],2027:[["2027-03-22","2027-04-03"],["2027-07-19","2027-08-31"],["2027-10-23","2027-11-06"],["2027-12-24","2028-01-08"]]};const nl={2026:[["2026-02-14","2026-03-01"],["2026-04-25","2026-05-10"],["2026-07-04","2026-08-30"],["2026-10-10","2026-10-25"],["2026-12-19","2027-01-03"]],2027:[["2027-02-13","2027-02-28"],["2027-04-24","2027-05-09"],["2027-07-10","2027-09-05"],["2027-10-16","2027-10-31"],["2027-12-25","2028-01-09"]]};return{isWeekend:[0,6].includes(new Date(`${value}T12:00:00Z`).getUTCDay()),isPublicHolidayNrw:fixed.has(value)||moving.has(value),isSchoolHolidayNrw:inRange(value,nrw[year]||[]),isSchoolHolidayNl:inRange(value,nl[year]||[])}};
const eventType=value=>{const name=(value||"").toLowerCase();return name.includes("summer")?"Summer Nights":name.includes("halloween")?"Halloween":name.includes("christmas")||name.includes("weihnacht")?"Hollywood Christmas":name?"Sonderveranstaltung":"Kein Sonder-Event"};

export async function GET(request){
  const db=new DatabaseSync(DB,{readOnly:true});
  try{
    const url=new URL(request.url);
    const count=Math.max(1,Math.min(7,Number(url.searchParams.get("days")||7)));
    const date=url.searchParams.get("date");
    const requestedMode="experimental";
    const baseline=db.prepare("SELECT * FROM forecast_runs WHERE promoted=1 AND status='ready' ORDER BY generated_at DESC LIMIT 1").get();
    if(!baseline)return Response.json({error:"Noch keine geprüfte Prognose verfügbar."},{status:503});
    const experimental=db.prepare("SELECT * FROM forecast_runs WHERE promoted=0 AND status='ready' AND method='catboost-multiquantile-experimental' AND horizon_start=? ORDER BY generated_at DESC LIMIT 1").get(baseline.horizon_start);
    if(!experimental)return Response.json({error:"Die Hybrid-Prognose ist derzeit nicht verfügbar. Es wird nicht unbemerkt auf die Standardprognose zurückgeschaltet."},{status:503});
    const run=experimental;
    const activeMode="experimental";
    const quality=JSON.parse(run.quality_json);
    const rawDays=db.prepare("SELECT * FROM park_forecast_days WHERE run_id=? ORDER BY operating_date LIMIT ?").all(run.run_id,count);
    const days=rawDays.map(day=>{const weather=day.weather_json?JSON.parse(day.weather_json):null,flags=calendarFlags(day.operating_date),duration=day.opens_minute!=null&&day.closes_minute!=null?day.closes_minute-day.opens_minute:null;return{date:day.operating_date,isOpen:Boolean(day.is_open),opensAt:day.opens_minute==null?null:label(day.opens_minute),closesAt:day.closes_minute==null?null:label(day.closes_minute),crowd:{p10:day.crowd_p10,p50:day.crowd_p50,p90:day.crowd_p90},confidence:day.confidence,weather,event:day.event_name,source:day.source,inputs:{openingDurationMinutes:duration,eventType:eventType(day.event_name),...flags,weatherIssuedAt:weather?.updatedAt||null,weatherHours:Array.isArray(weather?.hourly)?weather.hourly.length:0}}});
    const ranked=days.filter(day=>day.isOpen&&day.crowd.p50!=null).sort((a,b)=>a.crowd.p50-b.crowd.p50);
    ranked.forEach((day,index)=>{day.decision={rank:index+1,openDayCount:ranked.length,differenceToQuietest:Math.round((day.crowd.p50-ranked[0].crowd.p50)*10)/10,reason:index===0?"Niedrigster erwarteter Andrang unter den geöffneten Tagen":"Nach erwartetem Andrang im Wochenvergleich eingeordnet"}});
    let rides;
    if(date){
      const selected=rawDays.find(day=>day.operating_date===date);
      const nowParts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
      const value=type=>nowParts.find(part=>part.type===type)?.value;
      const today=`${value("year")}-${value("month")}-${value("day")}`;
      const nowMinute=Number(value("hour"))*60+Number(value("minute"));
      const lower=Math.max((selected?.opens_minute??600)+60,date===today?nowMinute+30:0),upper=(selected?.closes_minute??1080)-30;
      rides=db.prepare(`SELECT r.ride_id AS id,r.name,ROUND(AVG(fp.p50),1) AS averageWait,MIN(fp.p50) AS bestWait,COUNT(*) AS points,
        CASE WHEN ?='experimental' THEN 'low' WHEN ?<14 THEN 'low' WHEN ?<28 AND SUM(fp.confidence='medium')>0 THEN 'medium' WHEN SUM(fp.confidence='high')>0 THEN 'high' WHEN SUM(fp.confidence='medium')>0 THEN 'medium' ELSE 'low' END AS confidence,
        ROUND(100.0*AVG(fp.open_probability)) AS operatingReliability,
        (SELECT ROUND(AVG(ABS(rr.actual_wait-rr.predicted_wait)),1) FROM ride_recommendation_snapshots rr WHERE rr.ride_id=r.ride_id AND rr.actual_wait IS NOT NULL) AS measuredMae,
        (SELECT COUNT(*) FROM ride_recommendation_snapshots rr WHERE rr.ride_id=r.ride_id AND rr.actual_wait IS NOT NULL) AS measuredComparisons
        FROM forecast_points fp JOIN rides r ON r.ride_id=fp.ride_id
        WHERE fp.run_id=? AND fp.operating_date=? AND r.ride_id NOT IN (${RETIRED_RIDE_IDS.map(()=>"?").join(",")}) AND EXISTS(SELECT 1 FROM ride_observations ro WHERE ro.ride_id=r.ride_id AND ro.status='open' AND ro.source_fresh=1)
        GROUP BY fp.ride_id,r.name ORDER BY averageWait,r.name`).all(activeMode,quality.trainingDays??0,quality.trainingDays??0,run.run_id,date,...RETIRED_RIDE_IDS).map(ride=>{
          const best=db.prepare("SELECT minute_of_day,p50,p10,p90,open_probability,support_days,support_samples FROM forecast_points WHERE run_id=? AND operating_date=? AND ride_id=? AND minute_of_day>=? AND minute_of_day<=? ORDER BY p50,minute_of_day LIMIT 1").get(run.run_id,date,ride.id,lower,upper);
          return{...ride,averageWait:Math.round(Number(ride.averageWait)),bestWait:best?Math.round(Number(best.p50)):null,best:best?{time:label(best.minute_of_day),p50:Math.round(Number(best.p50)),p10:Math.round(Number(best.p10)),p90:Math.round(Number(best.p90)),openProbability:best.open_probability,supportDays:best.support_days,supportSamples:best.support_samples}:null};
        });
    }
    const accuracy=db.prepare(`SELECT COUNT(*) AS resolved,SUM(actual_wait IS NOT NULL) AS measured,SUM(actual_status='closed') AS closed,ROUND(AVG(CASE WHEN actual_wait IS NOT NULL THEN ABS(actual_wait-predicted_wait) END),1) AS mae,ROUND(100.0*AVG(CASE WHEN actual_wait IS NOT NULL THEN actual_wait BETWEEN lower_wait AND upper_wait END),1) AS intervalCoverage FROM ride_recommendation_snapshots WHERE resolved_at IS NOT NULL`).get();
    const model=db.prepare("SELECT model_version AS modelVersion,status,training_days AS trainingDays,metrics_json AS metricsJson,created_at AS checkedAt FROM model_registry ORDER BY datetime(created_at) DESC LIMIT 1").get();
    return Response.json({generatedAt:run.generated_at,dataAsOf:run.data_as_of,modelVersion:run.model_version,method:run.method,mode:activeMode,requestedMode,experimentalAvailable:Boolean(experimental),baselineModelVersion:baseline.model_version,quality,accuracy,modelReadiness:model?{...model,metrics:JSON.parse(model.metricsJson),metricsJson:undefined}:null,sourceHealth:JSON.parse(run.source_health_json),days,rides,
      pipeline:{
        waits:{origin:"Queue-Times",storage:"Lokale SQLite-Datenbank",tables:["snapshots","ride_observations","ride_training_rows"]},
        forecast:{kind:activeMode==="experimental"?"test":run.method==="catboost-multiquantile"?"promoted-model":"baseline",label:activeMode==="experimental"?"CatBoost-Testmodell":run.method==="catboost-multiquantile"?"Freigegebenes CatBoost-Modell":"Standard-Baseline aus historischen Vergleichswerten",method:run.method,version:run.model_version},
        weather:{origin:"Open-Meteo",storage:"Lokale Wetter-Snapshots und aktueller API-Abruf"},
        calendar:{origin:"Offizieller Movie-Park-Kalender",storage:"Lokale Tabelle park_calendar"}
      },
      attribution:{queueTimes:{label:"Wartezeiten: Queue-Times",url:"https://queue-times.com/"},openMeteo:{label:"Wetter: Open-Meteo",url:"https://open-meteo.com/"}}},{headers:{"Cache-Control":"no-store, max-age=0"}});
  }catch(error){return Response.json({error:"Prognosedaten sind gerade nicht verfügbar.",detail:error.message},{status:503});}
  finally{db.close();}
}
