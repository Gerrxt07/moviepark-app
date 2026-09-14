"use client";

import Link from "next/link";
import { useState } from "react";
import MoreMenu from "../components/MoreMenu";
import { AppHeader, AppNav } from "../components/AppChrome";
import { PARK_SERVICES, SERVICES_SOURCE, SERVICES_UPDATED_AT } from "../data/services";
import { localeCode, readLocale } from "../lib/locale";
import { translateText } from "../i18n/catalog";

export default function ServicesPage() {
  const [query,setQuery]=useState("");
  const needle=query.trim().toLocaleLowerCase(localeCode());
  const services=PARK_SERVICES.filter(service=>{const original=`${service.name} ${service.category} ${service.location} ${service.description}`;const localized=[service.name,service.category,service.location,service.description].map(value=>translateText(value,readLocale())).join(" ");return !needle||`${original} ${localized}`.toLocaleLowerCase(localeCode()).includes(needle)});
  return <div className="app-shell services-app">
    <AppHeader backHref="/" title="Services" />
    <main className="services-main">
      <section className="services-hero"><p className="eyebrow">Schnell gefunden</p><h1>Hilfe & Services</h1><p>Wichtige Anlaufstellen für deinen Parktag kompakt an einem Ort.</p></section>
      <label className="attractions-search services-search"><span>⌕</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Service suchen …" /></label>
      <div className="services-grid">{services.map((service)=><article key={service.id}><small>{service.category}</small><h2>{service.name}</h2><strong>{service.location}</strong><p>{service.description}</p></article>)}</div>
      <p className="programme-note">Quelle: {SERVICES_SOURCE} · geprüft am {SERVICES_UPDATED_AT}. Hinweise und Beschilderung im Park haben Vorrang.</p>
    </main>
    <AppNav active="more" />
  </div>;
}
