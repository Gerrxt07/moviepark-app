export const PARK_ZONES = [
  { id:"entrance",name:"Hollywood Street Set",short:"Hollywood",x:46,y:84,color:"#e9d8b4" },
  { id:"new-york",name:"Streets of New York",short:"New York",x:28,y:64,color:"#cfddea" },
  { id:"federation",name:"Federation Plaza",short:"Federation",x:22,y:43,color:"#d7d2eb" },
  { id:"old-west",name:"The Old West",short:"Old West",x:28,y:20,color:"#e8c9a6" },
  { id:"studio",name:"Hollywood Studio Set",short:"Studio Set",x:55,y:22,color:"#d7dfcc" },
  { id:"santa-monica",name:"Santa Monica Pier",short:"Santa Monica",x:76,y:43,color:"#bfe1e5" },
  { id:"nickland",name:"Nickelodeon LAND",short:"Nickland",x:70,y:68,color:"#f1d1aa" },
];

const ZONE_RIDES = {
  federation:[10984],
  "old-west":[10987,10982,10989,11004],
  studio:[10985,10993,16233],
  "new-york":[11000,10999,10997,11009],
  "santa-monica":[10998,10988,11006,11011],
  nickland:[10996,11002,10992,11001,10983,11005,10995,11007,10994,10990,10991,11008,11010],
  entrance:[10981],
};

export const RIDE_ZONE = Object.fromEntries(Object.entries(ZONE_RIDES).flatMap(([zone,ids])=>ids.map(id=>[id,zone])));

export const RIDE_POSITIONS = Object.fromEntries(Object.entries(ZONE_RIDES).flatMap(([zone,ids])=>{
  const base=PARK_ZONES.find(item=>item.id===zone);
  return ids.map((id,index)=>[id,{zone,x:base.x+((index%3)-1)*5,y:base.y+(Math.floor(index/3)-1)*5}]);
}));

export const ZONE_NEIGHBORS = {
  entrance:["new-york","nickland"],"new-york":["entrance","federation","old-west"],
  federation:["new-york","old-west"],"old-west":["federation","new-york","studio"],
  studio:["old-west","santa-monica"],"santa-monica":["studio","nickland"],nickland:["santa-monica","entrance"],
};

export function zoneForRide(id){return RIDE_ZONE[Number(id)]||"entrance"}
export function zoneName(id){return PARK_ZONES.find(zone=>zone.id===id)?.name||"Park"}
export function zoneDistance(from,to){
  if(!from||from===to)return 0;const seen=new Set([from]);let frontier=[from],distance=0;
  while(frontier.length){distance++;const next=[];for(const item of frontier)for(const neighbor of ZONE_NEIGHBORS[item]||[])if(!seen.has(neighbor)){if(neighbor===to)return distance;seen.add(neighbor);next.push(neighbor)}frontier=next}return 3;
}

// A lightweight walking graph for on-device route guidance. Coordinates are
// orientation waypoints, not turn-by-turn accessibility instructions.
export const PARK_WAYPOINTS={
  entrance:{lat:51.62175,lon:6.97270},hollywood:{lat:51.62172,lon:6.97405},newYork:{lat:51.62170,lon:6.97555},
  federation:{lat:51.62220,lon:6.97410},oldWest:{lat:51.62345,lon:6.97425},bandit:{lat:51.62410,lon:6.97385},
  studio:{lat:51.62040,lon:6.97470},studioSouth:{lat:51.61925,lon:6.97505},nickCentral:{lat:51.61975,lon:6.97535},
  nickSouth:{lat:51.61905,lon:6.97580},pier:{lat:51.62305,lon:6.97455},pierEast:{lat:51.62350,lon:6.97375},
};
export const PARK_PATHS=[
  ["entrance","hollywood"],["hollywood","newYork"],["hollywood","federation"],["newYork","studio"],
  ["federation","oldWest"],["oldWest","bandit"],["oldWest","pier"],["pier","pierEast"],["pier","studio"],
  ["studio","studioSouth"],["studio","nickCentral"],["studioSouth","nickSouth"],["nickSouth","nickCentral"],["nickCentral","newYork"],
];
export const PARK_POIS=[
  {id:"entrance",type:"entrance",name:"Parkeingang",lat:51.62173,lon:6.97258},
  {id:"first-aid",type:"first-aid",name:"Erste Hilfe · Orientierung",lat:51.62178,lon:6.97342},
  {id:"toilet-hollywood",type:"toilet",name:"WC · Hollywood",lat:51.62161,lon:6.97418},
  {id:"toilet-west",type:"toilet",name:"WC · Old West",lat:51.62327,lon:6.97418},
  {id:"toilet-nick",type:"toilet",name:"WC · Nickland",lat:51.61967,lon:6.97518},
  {id:"food-hollywood",type:"food",name:"Gastronomie · Hollywood",lat:51.62188,lon:6.97448},
  {id:"food-west",type:"food",name:"Gastronomie · Old West",lat:51.62320,lon:6.97452},
  {id:"food-nick",type:"food",name:"Gastronomie · Nickland",lat:51.61983,lon:6.97555},
  {id:"lockers",type:"locker",name:"Schließfächer · Eingang",lat:51.62169,lon:6.97283},
];

const geoDistance=(a,b)=>{const rad=value=>value*Math.PI/180,r=6371000,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);const value=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return 2*r*Math.atan2(Math.sqrt(value),Math.sqrt(1-value))};
const nearestWaypoint=point=>Object.entries(PARK_WAYPOINTS).sort((a,b)=>geoDistance(point,a[1])-geoDistance(point,b[1]))[0]?.[0];
export function walkingRoute(from,to){
  if(!from||!to)return null;const start=nearestWaypoint(from),finish=nearestWaypoint(to),adj={};
  for(const[id]of Object.entries(PARK_WAYPOINTS))adj[id]=[];
  for(const[a,b]of PARK_PATHS){const weight=geoDistance(PARK_WAYPOINTS[a],PARK_WAYPOINTS[b]);adj[a].push([b,weight]);adj[b].push([a,weight])}
  const distances={[start]:0},previous={},pending=new Set(Object.keys(adj));
  while(pending.size){const current=[...pending].sort((a,b)=>(distances[a]??Infinity)-(distances[b]??Infinity))[0];pending.delete(current);if(current===finish||distances[current]==null)break;for(const[next,weight]of adj[current])if((distances[current]+weight)<(distances[next]??Infinity)){distances[next]=distances[current]+weight;previous[next]=current}}
  const ids=[];for(let current=finish;current;current=previous[current]){ids.unshift(current);if(current===start)break}
  const points=[from,...ids.map(id=>PARK_WAYPOINTS[id]),to],meters=Math.round(points.slice(1).reduce((sum,point,index)=>sum+geoDistance(points[index],point),0));
  return{points,meters,minutes:Math.max(1,Math.ceil(meters/75)),approximate:true};
}
