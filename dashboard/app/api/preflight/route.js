import { DatabaseSync } from "node:sqlite";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const DB="/opt/moviepark/app/data/moviepark.sqlite";

export async function GET(){
  try{
    const db=new DatabaseSync(DB,{readOnly:true});
    try{
      const latest=db.prepare("SELECT observed_at AS observedAt,http_status AS httpStatus,payload_fresh AS payloadFresh,ride_count AS rideCount FROM snapshots ORDER BY unixepoch(observed_at) DESC LIMIT 1").get();
      const forecast=db.prepare("SELECT generated_at AS generatedAt,model_version AS modelVersion,quality_json AS qualityJson FROM forecast_runs WHERE promoted=1 AND status='ready' ORDER BY generated_at DESC LIMIT 1").get();
      const sources=db.prepare("SELECT component,status,message,checked_at AS checkedAt FROM data_health ORDER BY component").all();
      const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),part=type=>parts.find(item=>item.type===type)?.value;
      const today=`${part("year")}-${part("month")}-${part("day")}`,nowMinute=Number(part("hour"))*60+Number(part("minute"));
      const calendar=db.prepare("SELECT operating_date AS date,is_open AS isOpen,opens_minute AS opensMinute,closes_minute AS closesMinute,event_name AS eventName,stale FROM park_calendar WHERE is_open=1 AND (operating_date>? OR (operating_date=? AND closes_minute>?)) ORDER BY operating_date LIMIT 1").get(today,today,nowMinute);
      const now=Date.now(),snapshotAge=latest?.observedAt?Math.round((now-new Date(latest.observedAt).getTime())/60000):null,collectionExpected=Boolean(calendar?.date===today&&nowMinute>=calendar.opensMinute-30&&nowMinute<=calendar.closesMinute+30),snapshotFreshEnough=snapshotAge!=null&&(!collectionExpected||snapshotAge<=12);
      const serverReady=Boolean(latest&&forecast&&latest.payloadFresh&&latest.httpStatus===200&&sources.every(item=>item.status==="ok"));
      return Response.json({serverReady,snapshot:{...latest,ageMinutes:snapshotAge,freshEnough:snapshotFreshEnough,collectionExpected},forecast:forecast?{...forecast,quality:JSON.parse(forecast.qualityJson),qualityJson:undefined}:null,sources,calendar},{headers:{"Cache-Control":"no-store, max-age=0"}});
    }finally{db.close()}
  }catch(error){return Response.json({serverReady:false,error:"Systemstatus konnte nicht geprüft werden.",detail:error.message},{status:503,headers:{"Cache-Control":"no-store"}})}
}
