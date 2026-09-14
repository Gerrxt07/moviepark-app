"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ATTRACTION_COORDINATES } from "../data/attractionCoordinates";
import { storedFavoriteIds } from "../lib/pushPreferences";

const CHECKIN_KEY="moviepark-check-in";

function activeCheckIn(){
  try{const value=JSON.parse(localStorage.getItem(CHECKIN_KEY));return Boolean(value?.until&&new Date(value.until).getTime()>Date.now())}catch{return false}
}

function distanceMeters(position,target){
  const radius=6371000,toRadians=value=>value*Math.PI/180;
  const deltaLatitude=toRadians(target.lat-position.latitude),deltaLongitude=toRadians(target.lon-position.longitude);
  const a=Math.sin(deltaLatitude/2)**2+Math.cos(toRadians(position.latitude))*Math.cos(toRadians(target.lat))*Math.sin(deltaLongitude/2)**2;
  return 2*radius*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

export default function ParkSuggestion(){
  const[checkedIn,setCheckedIn]=useState(false),[weather,setWeather]=useState(null),[rides,setRides]=useState([]),[favorites,setFavorites]=useState([]),[position,setPosition]=useState(null),[locationState,setLocationState]=useState("idle");

  useEffect(()=>{const sync=()=>{setCheckedIn(activeCheckIn());setFavorites(storedFavoriteIds())};sync();window.addEventListener("moviepark:checkin",sync);window.addEventListener("moviepark:favorites",sync);window.addEventListener("focus",sync);return()=>{window.removeEventListener("moviepark:checkin",sync);window.removeEventListener("moviepark:favorites",sync);window.removeEventListener("focus",sync)}},[]);

  useEffect(()=>{if(!checkedIn){setRides([]);setWeather(null);return}let active=true;const load=()=>Promise.all([fetch("/api/weather",{cache:"no-store"}).then(response=>response.ok?response.json():null),fetch("/api/attractions",{cache:"no-store"}).then(response=>response.ok?response.json():null)]).then(([nextWeather,nextRides])=>{if(!active)return;setWeather(nextWeather);setRides(nextRides?.attractions||[]);setFavorites(storedFavoriteIds())}).catch(()=>{});load();const timer=window.setInterval(load,60000);return()=>{active=false;window.clearInterval(timer)}},[checkedIn]);

  useEffect(()=>{if(!checkedIn){setPosition(null);setLocationState("idle");return}if(!window.isSecureContext){setLocationState("insecure");return}if(!navigator.geolocation){setLocationState("unavailable");return}setLocationState("requesting");const watch=navigator.geolocation.watchPosition(result=>{setPosition({latitude:result.coords.latitude,longitude:result.coords.longitude,accuracy:Math.round(result.coords.accuracy)});setLocationState("active")},error=>{setPosition(null);setLocationState(error.code===1?"denied":"unavailable")},{enableHighAccuracy:true,maximumAge:15000,timeout:15000});return()=>navigator.geolocation.clearWatch(watch)},[checkedIn]);

  const suggestion=useMemo(()=>{
    if(!checkedIn)return null;
    const current=weather?.current,rainy=Number(current?.precipitation||0)>0||Number(current?.weatherCode||0)>=51,hot=Number(current?.temperature||0)>=29,windy=Number(current?.windSpeed||0)>=30;
    const candidates=rides.filter(ride=>ride.status==="open"&&ride.sourceFresh&&ride.measurementValid&&ride.waitMinutes!=null).map(ride=>{
      const point=ATTRACTION_COORDINATES[ride.id],distance=position&&point?Math.round(distanceMeters(position,point)):null,favorite=favorites.includes(ride.id);
      let score=Number(ride.waitMinutes)+(distance!=null?Math.min(32,distance/75*4):0)+(favorite?-24:8);
      if(rainy&&!ride.indoor)score+=18;if(hot&&!ride.water)score+=5;if(windy&&ride.weatherSensitive)score+=16;
      return{ride,distance,favorite,score,rainy,hot,windy};
    }).sort((a,b)=>a.score-b.score||a.ride.waitMinutes-b.ride.waitMinutes);
    const best=candidates[0];if(!best)return null;
    const reasons=[];if(best.favorite)reasons.push("Einer deiner Favoriten");if(best.distance!=null&&best.distance<=250)reasons.push(`nur etwa ${best.distance} m entfernt`);if(best.rainy&&best.ride.indoor)reasons.push("eine gute Indoor-Wahl");else if(best.hot&&best.ride.water)reasons.push("passend zur Hitze");else if(best.ride.waitMinutes<=15)reasons.push("aktuell kurze Wartezeit");
    return{...best,reason:reasons.length?reasons.join(" · "):"Aktuell die sinnvollste Kombination aus Wartezeit und deinen Vorlieben"};
  },[checkedIn,weather,rides,favorites,position]);

  if(!checkedIn||!suggestion)return null;
  return <section className="park-suggestion personalized-park-suggestion"><div className="park-suggestion-heading"><div><p className="eyebrow">Dein persönlicher Park-Tipp</p><h2>{suggestion.ride.name}</h2></div>{suggestion.favorite?<span>★ Favorit</span>:null}</div><p>{suggestion.reason}. Aktuell {suggestion.ride.waitMinutes} Minuten Wartezeit.</p><small>{locationState==="active"?`GPS berücksichtigt · Genauigkeit ± ${position.accuracy} m`:locationState==="requesting"?"Standort wird noch bestimmt …":"Standort nicht verfügbar · Empfehlung nach Favoriten, Wetter und Wartezeit"}</small><Link href={`/attractions/${suggestion.ride.id}`}>Attraktion ansehen →</Link></section>;
}
