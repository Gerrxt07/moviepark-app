export const dynamic = "force-dynamic";
import { DatabaseSync } from "node:sqlite";

const PARK_TIME_ZONE = "Europe/Berlin";
const DB_PATH = "/opt/moviepark/app/data/moviepark.sqlite";

export async function POST() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PARK_TIME_ZONE,
    year:"numeric",month:"2-digit",day:"2-digit",hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const currentMinute = value("hour") * 60 + value("minute"),today=`${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}-${parts.find(p=>p.type==='day')?.value}`;
  let calendar=null;try{const db=new DatabaseSync(DB_PATH,{readOnly:true});calendar=db.prepare("SELECT is_open,opens_minute,closes_minute,event_name FROM park_calendar WHERE operating_date=?").get(today);db.close();}catch{}
  const closingMinute=Number(calendar?.closes_minute??1080),openingMinute=Number(calendar?.opens_minute??600);
  if (calendar&&!calendar.is_open||currentMinute<openingMinute||currentMinute>=closingMinute) {
    return Response.json({ error: "Der Park ist für heute bereits geschlossen." }, { status: 409 });
  }
  const until = new Date(now.getTime() + (closingMinute - currentMinute) * 60_000);
  return Response.json(
    { since: now.toISOString(), until: until.toISOString(),closingMinute,eventName:calendar?.event_name||null },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
