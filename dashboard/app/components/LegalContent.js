import Link from "next/link";

export default function LegalContent() {
  return <div className="legal-content">
    <header>
      <p className="eyebrow">Rechtliches · Stand 09.08.2026</p>
      <h1>Impressum & Datenschutz</h1>
      <p>Transparenz darüber, wer dieses private Fanprojekt betreibt, welche Daten verarbeitet werden und welche Rechte du hast.</p>
    </header>
    <nav aria-label="Rechtliche Abschnitte">
      <a href="#impressum">Impressum</a><a href="#datenschutz">Datenschutz</a><a href="#speicher">App-Speicher</a><a href="#dienste">Dienste</a><a href="#rechte">Deine Rechte</a>
    </nav>

    <section id="impressum">
      <p className="eyebrow">Anbieterinformation</p><h2>Impressum</h2>
      <address><strong>Gerrit Aaron Schlinkmann</strong><br/>Dortmund, Nordrhein-Westfalen, Deutschland<br/><a href="mailto:gerrxt07@proton.me">gerrxt07@proton.me</a></address>
      <p>Dieses Angebot wird privat, ohne Firma und ohne wirtschaftliche Verbindung zum Park betrieben. Es gibt keinen gesetzlichen Vertreter, keinen Registereintrag und keine Umsatzsteuer-ID.</p>
      <div className="legal-warning"><strong>Hinweis zur Anschrift</strong><p>Eine Wohnanschrift und Telefonnummer werden aus Schutz vor Doxxing nicht veröffentlicht. Nach derzeitiger Einordnung ist dieses unentgeltliche private Fanprojekt kein geschäftsmäßiger, in der Regel gegen Entgelt angebotener digitaler Dienst im Sinne von § 5 DDG. Sollte sich die Finanzierung oder rechtliche Einordnung ändern, muss vor dem Weiterbetrieb eine ladungsfähige Anschrift ergänzt werden. Eine E-Mail für unmittelbare elektronische Kontaktaufnahme ist angegeben.</p></div>
      <p>Das Projekt ist inoffiziell und unabhängig. Es besteht keine wirtschaftliche, organisatorische, redaktionelle oder sonstige Verbindung zur Movie Park Germany GmbH, zu verbundenen Unternehmen oder zu Esri. Es liegt keine Beauftragung, Partnerschaft oder Freigabe durch diese Stellen vor.</p>
    </section>

    <section id="datenschutz">
      <p className="eyebrow">Informationen nach Art. 13 DSGVO</p><h2>Datenschutzerklärung</h2>
      <h3>1. Verantwortlicher</h3><p>Verantwortlicher ist Gerrit Aaron Schlinkmann, Dortmund, Deutschland. Datenschutzkontakt: <a href="mailto:gerrxt07@proton.me">gerrxt07@proton.me</a>. Ein Datenschutzbeauftragter ist nicht bestellt.</p>
      <h3>2. Hosting, Cloudflare und Serverprotokolle</h3><p>Beim Abruf werden technisch notwendige Verbindungsdaten verarbeitet, insbesondere IP-Adresse, Zeitpunkt, angeforderte URL, Referrer, Browserangaben und HTTP-Status. Zweck sind sichere Auslieferung, Fehleranalyse und Missbrauchsschutz; Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.</p>
      <p>Der eigene Webserver führt Nginx-Zugriffsprotokolle. Sie werden täglich rotiert und nach 14 Rotationen gelöscht; ältere Dateien werden komprimiert. Für Bildabrufe ist das Zugriffsprotokoll deaktiviert. Fehlerprotokolle unterliegen derselben Rotation.</p>
      <p>Die Domain nutzt Cloudflare im kostenlosen Tarif als Reverse Proxy, CDN und Sicherheitsdienst. Cloudflare verarbeitet dabei insbesondere IP-Adresse, Routing-, Geräte-, Sicherheits- und Anfragedaten. Es besteht kein individuell ausgehandelter Vertrag; maßgeblich sind die Cloudflare Self-Serve-Bedingungen einschließlich des dort einbezogenen Data Processing Addendum. Der kostenlose Tarif stellt dem Betreiber keine vollständigen HTTP-Rohlogs per Logpull bereit. Cloudflare veröffentlicht für sämtliche beim Proxy technisch verarbeiteten Endnutzer- und Sicherheitsdaten keine einheitliche, pauschale Löschfrist; die Speicherung richtet sich nach Dienst, Zweck und gesetzlichen Pflichten.</p>
      <h3>3. Keine Nutzerkonten und kein Werbetracking</h3><p>Die App verwendet keine Nutzerkonten, keine personalisierte Werbung und nach aktuellem technischen Stand keine Analyse- oder Marketingtracker. Deshalb wird kein pauschaler Tracking-Cookie-Banner angezeigt.</p>
    </section>

    <section id="speicher">
      <p className="eyebrow">Browser, PWA und optionale Funktionen</p><h2>Speicherung auf deinem Gerät</h2>
      <dl><div><dt>Favoriten und Einstellungen</dt><dd>Ride-IDs, Filter, Prognosemodus und UI-Zustände werden lokal gespeichert, damit ausdrücklich gewählte Funktionen erhalten bleiben.</dd></div><div><dt>Check-in</dt><dd>Start- und Endzeit des freiwilligen Park-Check-ins werden lokal bis zum Parkschluss gespeichert.</dd></div><div><dt>PWA und Offline-Cache</dt><dd>Service Worker und Cache Storage speichern App-Dateien für Installation, Updates und eingeschränkte Offline-Nutzung.</dd></div><div><dt>GPS und Sensoren</dt><dd>Standort, Kompass und Gyroskop werden erst nach Gerätefreigabe genutzt. Positions- und Sensordaten werden nicht an den App-Server gesendet oder dort gespeichert.</dd></div></dl>
      <p>Du kannst lokale Daten über die Browser-/App-Einstellungen löschen. Optionale Geräteberechtigungen können jederzeit im Betriebssystem widerrufen werden.</p>
      <h3>Favoriten-Synchronisierung</h3><p>Nur nach deiner Aktivierung werden Ride-IDs, ein gehashter Zugangsschlüssel sowie Erstellungs- und Änderungszeit serverseitig gespeichert. Einmalcodes verfallen nach 15 Minuten. Das Backup läuft derzeit ohne automatische Ablaufzeit und kann in der App endgültig gelöscht werden. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>
      <h3>Push-Benachrichtigungen</h3><p>Nur nach ausdrücklicher Gerätefreigabe werden Push-Endpunkt, kryptografische Subscription-Daten, gekürzter User-Agent, Check-in-Ende und gewählte Benachrichtigungspräferenzen gespeichert. Die Übermittlung erfolgt außerdem über den Push-Dienst des Betriebssystem- oder Browseranbieters. Beim Deaktivieren löscht die App die Subscription serverseitig; ungültige Endpunkte werden automatisch entfernt.</p>
    </section>

    <section id="dienste">
      <p className="eyebrow">Quellen und Empfänger</p><h2>Externe Dienste</h2>
      <dl><div><dt>Cloudflare</dt><dd>Cloudflare, Inc., USA, liefert und schützt die Website als Auftragsverarbeiter. Für erforderliche Drittlandübermittlungen sieht das Cloudflare DPA EU-Standardvertragsklauseln und ergänzende Schutzmaßnahmen vor.</dd></div><div><dt>Esri Satellitenkarte</dt><dd>Erst nach deiner ausdrücklichen Freigabe lädt die Karte Bildkacheln direkt von Esri. Dabei werden mindestens IP-Adresse, Zeitpunkt und Kachelanfrage übertragen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. a DSGVO. Die Freigabe wird lokal gespeichert und kann durch Löschen der Website-Daten widerrufen werden.</dd></div><div><dt>Open-Meteo</dt><dd>Der Server ruft Wetterdaten für die feste Parkposition ab. Dein GPS-Standort wird nicht übermittelt.</dd></div><div><dt>Queue-Times</dt><dd>Der Server bezieht Attraktions- und Wartezeitdaten für Movie Park Germany. Nutzerbezogene App-Daten werden nicht übermittelt.</dd></div><div><dt>Web-Push-Dienste</dt><dd>Bei aktivierten Mitteilungen verarbeitet der Push-Dienst deines Browsers oder Betriebssystems die technische Zustellung. Anbieter und Garantien richten sich nach deinem Endgerät und Browser.</dd></div></dl>
      <p>Cloudflare und einzelne Push- oder Kartendienste können Daten außerhalb des EWR verarbeiten. Die Cloudflare-Übermittlung stützt sich nach den Standardbedingungen auf das DPA einschließlich EU-Standardvertragsklauseln. Die Esri-Karte bleibt bis zu deiner Einwilligung gesperrt.</p>
    </section>

    <section id="rechte">
      <p className="eyebrow">Auskunft, Löschung, Widerruf</p><h2>Deine Rechte</h2>
      <p>Du hast – soweit die Voraussetzungen vorliegen – Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Erteilte Einwilligungen können mit Wirkung für die Zukunft widerrufen werden. Richte Anfragen an <a href="mailto:gerrxt07@proton.me">gerrxt07@proton.me</a>.</p>
      <p>Du kannst dich bei einer Datenschutzaufsichtsbehörde beschweren, insbesondere bei der <a href="https://www.ldi.nrw.de/kontakt/ihre-beschwerde" target="_blank" rel="noreferrer">Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen</a>.</p>
      <p>Da Favoriten-Backups pseudonym und ohne Konto geführt werden, ist für die Zuordnung der private Sync-Schlüssel erforderlich. Ohne diesen Schlüssel kann ein bestimmtes Backup technisch nicht identifiziert werden.</p>
    </section>

    <section>
      <p className="eyebrow">Haftung, Quellen und Kennzeichen</p><h2>Nutzungshinweise</h2>
      <p>Wartezeiten, Öffnungszeiten, Showzeiten, Wetter, Routen und Prognosen sind unverbindliche Orientierung. Maßgeblich sind aktuelle Hinweise, Sicherheitsanweisungen und Beschilderungen des Parks. Für kurzfristige Änderungen, Ausfälle oder daraus entstehende Planungsentscheidungen wird im gesetzlich zulässigen Umfang keine Gewähr übernommen.</p>
      <p>„Movie Park Germany“, Logos, Attraktionsnamen und Bildmaterial können geschützte Kennzeichen oder Werke ihrer jeweiligen Rechteinhaber sein. Das Projekt besitzt nach Angabe des Betreibers keine Lizenz oder Freigabe von Movie Park Germany. Die Nennung dient der inhaltlichen Zuordnung des Fanprojekts; daraus folgt kein Nutzungsrecht an Logos oder Fotos. Nicht selbst erstelltes Material muss vor öffentlicher Nutzung jeweils auf eine ausreichende Lizenz geprüft und andernfalls ersetzt oder entfernt werden.</p>
    </section>
    <footer><Link href="/">Zurück zur App</Link><span>Diese Seite ersetzt keine individuelle Rechtsberatung.</span></footer>
  </div>;
}
