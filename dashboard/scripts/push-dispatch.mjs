import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import webpush from "web-push";

const runtime="/opt/moviepark/dashboard/.runtime";
const pushDb=new DatabaseSync(`${runtime}/push-subscriptions.sqlite`);
const ridesDb=new DatabaseSync("/opt/moviepark/app/data/moviepark.sqlite",{readOnly:true});
try{pushDb.exec("ALTER TABLE push_subscriptions ADD COLUMN preferences_json TEXT")}catch{}
pushDb.exec("CREATE TABLE IF NOT EXISTS notification_deliveries(endpoint TEXT,event_key TEXT,delivered_at TEXT,PRIMARY KEY(endpoint,event_key))");
const keys=JSON.parse(readFileSync(`${runtime}/push-config.json`,"utf8"));
webpush.setVapidDetails(process.env.VAPID_SUBJECT||"https://moviepark.becloudly.eu",keys.publicKey,keys.privateKey);
const now=new Date();
const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin"}).format(now);
const timeParts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
const part=t=>Number(timeParts.find(p=>p.type===t)?.value||0);
const minute=part("hour")*60+part("minute");
const shows=[["operation-red-carpet","Operation Red Carpet",[720,900]],["parade-of-celebration","Parade of Celebration",[990]]];
const snapshots=ridesDb.prepare("SELECT snapshot_id,observed_at FROM snapshots ORDER BY unixepoch(observed_at) DESC LIMIT 2").all();
const current=snapshots[0]?ridesDb.prepare("SELECT ride_id,status,wait_minutes,measurement_valid,source_fresh FROM ride_observations WHERE snapshot_id=?").all(snapshots[0].snapshot_id):[];
const previous=new Map(snapshots[1]?ridesDb.prepare("SELECT ride_id,status,wait_minutes,measurement_valid,source_fresh FROM ride_observations WHERE snapshot_id=?").all(snapshots[1].snapshot_id).map(r=>[r.ride_id,r]):[]);
const names=new Map(ridesDb.prepare("SELECT ride_id,name FROM rides").all().map(r=>[r.ride_id,r.name]));
const weather=snapshots.slice(0,2).map(s=>ridesDb.prepare("SELECT condition,weather_code,temperature_c,precipitation_mm,wind_speed_kmh FROM weather_observations WHERE snapshot_id=?").get(s.snapshot_id));
const park=ridesDb.prepare("SELECT is_open,opens_minute,closes_minute FROM park_calendar WHERE operating_date=?").get(day);
const parkOpen=Boolean(park?.is_open&&minute>=park.opens_minute&&minute<park.closes_minute);
const subscriptions=pushDb.prepare("SELECT endpoint,subscription_json,preferences_json FROM push_subscriptions WHERE checked_in_until>?").all(now.toISOString());
for(const row of subscriptions){
  const events=[];
  let preferences={};try{preferences=JSON.parse(row.preferences_json||"{}")||{}}catch{}
  const favorites=new Set(Array.isArray(preferences.favorites)?preferences.favorites.map(Number):[]);
  const threshold=[5,10,15,20,30].includes(Number(preferences.threshold))?Number(preferences.threshold):15;
  for(const ride of current){
    const old=previous.get(ride.ride_id);
    if(!parkOpen||!favorites.has(Number(ride.ride_id))||!ride.source_fresh||!old?.source_fresh)continue;
    const transitionKey=`${snapshots[0]?.observed_at||now.toISOString()}:${ride.ride_id}`;
    if(preferences.reopenAlerts&&old.status==="open"&&ride.status==="closed")events.push([`ride-closed:${transitionKey}`,`${names.get(ride.ride_id)} ist vorübergehend geschlossen`]);
    if(preferences.reopenAlerts&&old.status==="closed"&&ride.status==="open")events.push([`ride-reopened:${transitionKey}`,`${names.get(ride.ride_id)} ist wieder geöffnet${ride.wait_minutes!=null?` · ${ride.wait_minutes} Minuten`:""}`]);
    if(!preferences.favoriteAlerts||ride.status!=="open"||old.status!=="open"||!ride.measurement_valid||!old.measurement_valid||ride.wait_minutes==null||old.wait_minutes==null)continue;
    const change=ride.wait_minutes-old.wait_minutes;
    if(Math.abs(change)>=threshold)events.push([`wait-change:${transitionKey}`,`${names.get(ride.ride_id)}: Wartezeit ${change>0?"gestiegen":"gesunken"} auf ${ride.wait_minutes} Minuten`]);
  }
  if(preferences.showReminders!==false)for(const [id,title,times] of shows)for(const start of times)if(start-minute>=29&&start-minute<=30)events.push([`show:${day}:${id}:${start}`,`${title} beginnt in 30 Minuten`]);
  if(weather[0]&&weather[1]&&(weather[0].weather_code!==weather[1].weather_code||Math.abs((weather[0].temperature_c??0)-(weather[1].temperature_c??0))>=4||Boolean(weather[0].precipitation_mm)!==Boolean(weather[1].precipitation_mm)))events.push([`weather:${day}:${Math.floor(minute/30)}`,`Wetteränderung: ${weather[0].condition}, ${Math.round(weather[0].temperature_c)} °C`]);
  for(const [key,body] of events){
    if(pushDb.prepare("SELECT 1 FROM notification_deliveries WHERE endpoint=? AND event_key=?").get(row.endpoint,key))continue;
    try{await webpush.sendNotification(JSON.parse(row.subscription_json),JSON.stringify({title:"Movie Park Hinweis",body,url:"/",tag:key}));pushDb.prepare("INSERT INTO notification_deliveries VALUES(?,?,?)").run(row.endpoint,key,now.toISOString())}
    catch(error){if(error.statusCode===404||error.statusCode===410)pushDb.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(row.endpoint)}
  }
}
pushDb.prepare("DELETE FROM notification_deliveries WHERE delivered_at<?").run(new Date(now.getTime()-2*86400000).toISOString());
ridesDb.close();pushDb.close();
