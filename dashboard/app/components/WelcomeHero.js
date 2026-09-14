"use client";

import { useEffect, useMemo, useState } from "react";
import { localeCode, readLocale } from "../lib/locale";

const PARK_TIME_ZONE = "Europe/Berlin";

function getParkHour(date) {
  const parts = new Intl.DateTimeFormat(localeCode(), {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: PARK_TIME_ZONE,
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

function buildLegacyMessages(hour, weather, park) {
  if (park?.state === "closed") {
    if (park.detail === "Öffnet um 10 Uhr") {
      return [
        ["Noch läuft der Vorspann.", "Die Studiotore sind noch geschlossen und öffnen heute um 10 Uhr."],
        ["Der Park macht sich bereit.", "Ab 10 Uhr heißt es wieder: Bühne frei für deinen Movie Park Tag."],
        ["Vorfreude auf Hollywood.", "Plane jetzt ganz entspannt deinen Start, bevor die Tore um 10 Uhr öffnen."],
        ["Bis gleich im Movie Park.", "Noch ist der Park geschlossen – um 10 Uhr beginnt das Abenteuer."],
      ];
    }
    return [
      ["Für heute ist Drehschluss.", "Der Movie Park ist geschlossen. Die aktuellen Wetterdaten bleiben für dich live."],
      ["Die Studiotore sind geschlossen.", "Zeit für Vorfreude und die Planung deines nächsten Parktags."],
      ["Hollywood macht eine Pause.", "Auch nach Parkschluss findest du hier weiterhin das aktuelle Wetter."],
      ["Der nächste Parktag kommt.", "Die Attraktionsdaten pausieren, bis die Tore wieder geöffnet sind."],
    ];
  }

  const temperature = weather?.temperature ?? null;
  const code = weather?.weatherCode ?? null;
  const rain = weather?.precipitation > 0 || (code >= 51 && code <= 99);
  const hot = temperature !== null && temperature >= 28;
  const pools = [];

  if (rain) {
    pools.push([
      ["Regen? Nur ein Spezialeffekt.", "Indoor-Attraktionen, Shows und Snacks warten schon auf dich."],
      ["Hollywood kann jedes Wetter.", "Schnapp dir eine kurze Regenpause und plane dein nächstes Abenteuer."],
      ["Heute mit Extra-Atmosphäre.", "Ein bisschen Regen macht den Parktag noch lange nicht zum Abspann."],
      ["Wolken über Hollywood.", "Die perfekte Kulisse für Shows, Studios und eine spontane Indoor-Runde."],
      ["Action kennt keine Regenpause.", "Plane clever und nutze trockene Momente für dein nächstes Outdoor-Abenteuer."],
      ["Heute dreht der Himmel mit.", "Regenjacke an, Stimmung hoch – dein Parktag läuft weiter."],
      ["Ein Parktag mit Plot Twist.", "Zwischen den Schauern wartet garantiert die nächste starke Szene."],
      ["Auch Filmstars werden mal nass.", "Mach das Beste daraus und entdecke den Park von seiner atmosphärischen Seite."],
    ]);
  }

  if (hot) {
    pools.push([
      ["Blockbuster-Wetter im Park.", "Denk an Wasser, kleine Pausen und eine Abkühlung zwischendurch."],
      ["Sonne an. Action an.", "Heute wird ein heißer Drehtag – such dir zwischendurch ein schattiges Set."],
      ["Ein Tag wie fürs Kino gemacht.", "Coaster, Shows und Sommerfeeling stehen auf dem Programm."],
      ["Hollywood-Hitze inklusive.", "Starte entspannt, trink genug und gönn dir zwischendurch Schatten."],
      ["Heute wird es filmreif heiß.", "Wasserattraktionen und kühle Studios sind jetzt deine besten Co-Stars."],
      ["Sonne, Stars und schnelle Rides.", "Ein Sommertag voller Action wartet auf dich."],
      ["Der Park läuft auf Sommermodus.", "Plane kleine Pausen ein und genieße jede Szene deines Tages."],
      ["Heißer Tag, coole Abenteuer.", "Zwischen Coaster und Show findest du immer eine gute Abkühlung."],
    ]);
  }

  if (hour < 11) {
    pools.push([
      ["Guten Morgen, Filmstar.", "Der Parktag beginnt – Zeit für die erste große Szene."],
      ["Bühne frei für dein Abenteuer.", "Früher Start, kurze Wege und ganz viel Hollywood liegen vor dir."],
      ["Der Park gehört den Frühstartern.", "Such dir deinen ersten Coaster aus und starte direkt durch."],
      ["Klappe auf für einen neuen Parktag.", "Noch liegt der ganze Tag voller Möglichkeiten vor dir."],
      ["Früh da, mehr erleben.", "Nutze den ruhigen Start und sammle deine ersten Highlights."],
      ["Hollywood wacht gerade auf.", "Sei dabei, wenn aus einem guten Morgen ein großartiger Parktag wird."],
      ["Deine erste Szene beginnt jetzt.", "Welches Abenteuer bekommt heute den Auftakt?"],
      ["Morgenlicht über dem Movie Park.", "Perfekte Zeit für Vorfreude, Pläne und die erste Runde."],
    ]);
  } else if (hour < 17) {
    pools.push([
      ["Mitten im eigenen Blockbuster.", "Dein Parktag läuft – und die besten Szenen kommen noch."],
      ["Nächster Halt: Abenteuer.", "Check das Wetter und mach dich bereit für die nächste Attraktion."],
      ["Heute spielst du die Hauptrolle.", "Hollywood in Germany wartet direkt hinter der nächsten Kurve."],
      ["Der Parktag ist in voller Fahrt.", "Zeit für neue Lieblingsmomente und die nächste große Runde."],
      ["Action liegt in der Luft.", "Entdecke, was dein persönlicher Blockbuster heute noch bereithält."],
      ["Noch längst nicht alles gesehen.", "Hinter jeder Ecke wartet eine neue Szene deines Parktags."],
      ["Dein Abenteuer, dein Drehbuch.", "Mach aus den nächsten Stunden genau den Parktag, den du willst."],
      ["Hollywood ruft zur nächsten Runde.", "Coaster, Shows oder Snacks – du entscheidest, wie es weitergeht."],
    ]);
  } else {
    pools.push([
    ["Der Abspann kann noch warten.", "Nutze die letzten Stunden für deine persönlichen Highlights."],
    ["Golden Hour im Movie Park.", "Perfektes Licht, starke Erinnerungen und noch Zeit für eine letzte Runde."],
    ["Ein Finale mit Filmreife.", "Welche Attraktion bekommt heute deine letzte Szene?"],
      ["Noch Zeit für einen letzten Take.", "Such dir dein Highlight aus und genieße die Stimmung im Park."],
      ["Die Lichter gehen noch nicht aus.", "Ein paar besondere Parkmomente passen immer noch in diesen Tag."],
      ["Abendstimmung auf dem Studiogelände.", "Jetzt fühlt sich jede letzte Runde ein bisschen besonderer an."],
      ["Das große Finale wartet.", "Mach den Abschluss deines Parktags zu einer Szene, die bleibt."],
      ["Ein letzter Blick hinter die Kulissen.", "Genieße die ruhigeren Wege und deine liebsten Attraktionen zum Abschluss."],
    ]);
  }

  if (park?.state === "closed" && hour < 10) {
    pools.push([
      ["Die Tore öffnen um 10 Uhr.", "Noch ist der Park geschlossen – dein Hollywood-Abenteuer startet am Morgen."],
      ["Der Park macht sich bereit.", "Ab 10 Uhr heißt es wieder: Bühne frei für deinen Movie Park Tag."],
      ["Noch läuft der Vorspann.", "Um 10 Uhr beginnt dein Tag voller Shows, Coaster und Filmabenteuer."],
      ["Hollywood schläft noch kurz.", "Plane schon jetzt deine erste Attraktion für den Start um 10 Uhr."],
      ["Vorfreude gehört zum Erlebnis.", "Der Movie Park öffnet morgens um 10 Uhr seine Tore."],
      ["Dein Parktag steht in den Startlöchern.", "Ab 10 Uhr wartet die erste große Szene auf dich."],
      ["Noch geschlossen, bald filmreif.", "Nutze die Zeit und plane deinen perfekten Start um 10 Uhr."],
      ["Der Countdown bis zur Öffnung läuft.", "Pünktlich um 10 Uhr beginnt das Abenteuer im Park."],
    ]);
  }

  if (park?.state === "closed" && hour >= 18) {
    pools.push([
      ["Der heutige Abspann läuft.", "Der Park ist geschlossen und öffnet morgen wieder um 10 Uhr."],
      ["Hollywood sagt für heute gute Nacht.", "Ab 10 Uhr beginnt der nächste Movie Park Tag."],
      ["Die Tore sind für heute geschlossen.", "Morgen um 10 Uhr startet ein neues Abenteuer."],
      ["Das Set macht Feierabend.", "Zeit für Erinnerungen – und Vorfreude auf die Öffnung um 10 Uhr."],
      ["Was für ein Parktag.", "Der Movie Park ist geschlossen und bereitet sich auf morgen vor."],
      ["Die letzte Szene ist im Kasten.", "Morgen ab 10 Uhr heißt es wieder: Action!"],
      ["Der Park ruht für die Nacht.", "Plane schon jetzt deine erste Attraktion für morgen um 10 Uhr."],
      ["Bis zum nächsten Blockbuster.", "Die Tore öffnen am Morgen wieder um 10 Uhr."],
    ]);
  }

  if (park?.state === "open" && hour >= 17) {
    pools.push([
      ["Langsam nähert sich das Finale.", "Nutze die Zeit bis zum regulären Parkende um 18 Uhr für dein Highlight."],
      ["Noch eine Runde vor dem Abspann.", "Der Parktag geht Richtung Finale – jetzt zählt jeder Lieblingsmoment."],
      ["Die letzte Parkstunde läuft.", "Welche Attraktion soll deinen heutigen Blockbuster abschließen?"],
      ["Finale in Hollywood.", "Plane jetzt deine letzte große Szene, bevor der Parktag endet."],
      ["Noch ist Zeit für Action.", "Mach dich auf den Weg zu deinem persönlichen Abschluss-Highlight."],
      ["Der Abend rückt näher.", "Genieße die besondere Stimmung und sichere dir eine letzte Runde."],
      ["Ein starker Schluss bleibt in Erinnerung.", "Wähle jetzt den perfekten Abschluss für deinen Movie Park Tag."],
      ["Der Abspann wartet schon.", "Bis zum Parkende bleibt noch Zeit für einen filmreifen Moment."],
    ]);
  }

  return pools.flat();
}

function buildMessages(hour, weather, park) {
  const english = readLocale() === "en";
  if (park?.state === "closed") {
    if (park.detail === "Öffnet um 10 Uhr") return english ? [
      ["Your park day starts at 10.", "The studio gates are still closed. Use the time to choose your first ride."],
      ["The park is getting ready.", "From 10:00, your day of rides, shows and movie adventures begins."],
      ["A little planning before the action.", "Check weather, favourites and the map before the gates open at 10:00."],
    ] : [
      ["Dein Parktag beginnt um 10 Uhr.", "Die Studiotore sind noch geschlossen. Nutze die Zeit und wähle deine erste Attraktion."],
      ["Der Park macht sich bereit.", "Ab 10 Uhr beginnt dein Tag mit Attraktionen, Shows und Filmabenteuern."],
      ["Noch kurz planen, dann geht es los.", "Prüfe Wetter, Favoriten und Parkplan vor der Öffnung um 10 Uhr."],
    ];
    return english ? [
      ["The park is closed right now.", "Live ride data pauses, while weather and planning tools remain available."],
      ["Plan the next great park day.", "Compare dates, weather and expected waits before your next visit."],
      ["Today's final scene is over.", "Your favourites and planning tools are ready whenever you are."],
    ] : [
      ["Der Park ist gerade geschlossen.", "Live-Daten der Attraktionen pausieren, Wetter und Planung bleiben verfügbar."],
      ["Plane deinen nächsten guten Parktag.", "Vergleiche Termine, Wetter und erwartete Wartezeiten vor deinem Besuch."],
      ["Die letzte Szene für heute ist vorbei.", "Favoriten und Planungshilfen stehen weiter für dich bereit."],
    ];
  }

  const temperature = weather?.temperature ?? null;
  const code = weather?.weatherCode ?? null;
  const rain = weather?.precipitation > 0 || (code >= 51 && code <= 99);
  const hot = temperature !== null && temperature >= 28;
  if (rain) return english ? [
    ["Rain changes the plan, not the fun.", "Use shows and indoor rides, then catch an outdoor ride between showers."],
    ["A park day with a weather twist.", "Keep the rain outlook close and choose your next stop flexibly."],
    ["Action continues under cloudy skies.", "A rain jacket and a smart route can keep your day moving."],
  ] : [
    ["Regen verändert den Plan, nicht den Spaß.", "Nutze Shows und Indoor-Attraktionen und erwische draußen die trockenen Phasen."],
    ["Ein Parktag mit Wetter-Wendung.", "Behalte den Regenverlauf im Blick und wähle deinen nächsten Stopp flexibel."],
    ["Action geht auch unter Wolken weiter.", "Mit Regenjacke und einer klugen Route bleibt dein Parktag in Bewegung."],
  ];
  if (hot) return english ? [
    ["A hot day full of action.", "Drink regularly, seek shade and make time for cooler attractions."],
    ["Summer mode is on.", "Mix fast rides with breaks, water and a little shade."],
    ["Big rides, smart breaks.", "Plan your day around the heat and keep an eye on the hourly weather."],
  ] : [
    ["Ein heißer Tag voller Action.", "Trinke regelmäßig, nutze Schatten und plane kühlere Attraktionen ein."],
    ["Der Park läuft im Sommermodus.", "Wechsle schnelle Rides mit Pausen, Wasser und etwas Schatten ab."],
    ["Große Runden, kluge Pausen.", "Plane deinen Tag rund um die Hitze und behalte das Stundenwetter im Blick."],
  ];
  if (hour < 11) return english ? [
    ["Start early. Experience more.", "The whole park day is ahead of you—choose your first highlight."],
    ["Your first scene starts now.", "Favourites and current wait times help you make a strong start."],
    ["Good morning from Movie Park.", "Quiet paths and fresh live data make early planning easier."],
  ] : [
    ["Früh starten. Mehr erleben.", "Der ganze Parktag liegt vor dir – wähle jetzt dein erstes Highlight."],
    ["Deine erste Szene beginnt jetzt.", "Favoriten und aktuelle Wartezeiten helfen dir bei einem starken Start."],
    ["Guten Morgen aus dem Movie Park.", "Ruhige Wege und frische Live-Daten machen die frühe Planung leichter."],
  ];
  if (hour < 17) return english ? [
    ["Your park day is in full swing.", "Check what is open, what is nearby and where waits are shorter."],
    ["Ready for the next highlight?", "Live waits, weather and favourites point you towards a good next stop."],
    ["There is plenty more to discover.", "Use the map and live view to shape the next part of your day."],
  ] : [
    ["Dein Parktag ist in voller Fahrt.", "Prüfe, was geöffnet ist, was in der Nähe liegt und wo du kürzer wartest."],
    ["Bereit für das nächste Highlight?", "Live-Wartezeiten, Wetter und Favoriten zeigen dir einen guten nächsten Stopp."],
    ["Es gibt noch viel zu entdecken.", "Nutze Parkplan und Live-Übersicht für den nächsten Abschnitt deines Tages."],
  ];
  return english ? [
    ["Make the finale count.", "There is still time for a favourite ride or one last show."],
    ["The evening gives every ride a new mood.", "Check closing time and choose the highlight that should end your day."],
    ["One more great park moment.", "Use the remaining time for the experience that matters most to you."],
  ] : [
    ["Mach das Finale besonders.", "Für einen Lieblingsride oder eine letzte Show bleibt noch Zeit."],
    ["Am Abend fühlt sich jede Runde anders an.", "Prüfe die Schließzeit und wähle das Highlight für deinen Abschluss."],
    ["Noch ein richtig guter Parkmoment.", "Nutze die verbleibende Zeit für das Erlebnis, das dir am wichtigsten ist."],
  ];
}

export default function WelcomeHero() {
  const [now, setNow] = useState(null);
  const [weather, setWeather] = useState(null);
  const [park, setPark] = useState(null);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();
    const clock = window.setInterval(updateClock, 1000);
    const rotate = window.setInterval(() => setMessageIndex((index) => index + 1), 18_000);

    const loadWeather = async () => {
      try {
        const response = await fetch("/api/weather", { cache: "no-store" });
        if (response.ok) {
          const payload = await response.json();
          setWeather(payload.current);
          setPark(payload.park);
        }
      } catch {
        // The time-based welcome remains available when weather is temporarily offline.
      }
    };
    loadWeather();
    const weatherTimer = window.setInterval(loadWeather, 5 * 60 * 1000);
    window.addEventListener("moviepark:refresh", loadWeather);

    return () => {
      window.clearInterval(clock);
      window.clearInterval(rotate);
      window.clearInterval(weatherTimer);
      window.removeEventListener("moviepark:refresh", loadWeather);
    };
  }, []);

  const messages = useMemo(() => buildMessages(now ? getParkHour(now) : 12, weather, park), [now, weather, park]);
  const message = messages[messageIndex % messages.length];
  const time = now ? new Intl.DateTimeFormat(localeCode(), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PARK_TIME_ZONE,
  }).format(now) : "--:--";
  const date = now ? new Intl.DateTimeFormat(localeCode(), {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: PARK_TIME_ZONE,
  }).format(now) : "Parkzeit wird geladen";

  return <section className={`welcome-hero${park?.state === "closed" ? " is-closed" : ""}`} aria-labelledby="welcome-title">
    <div className="hero-glow" aria-hidden="true" />
    <div className="hero-copy">
      <div className={"hero-kicker is-" + (park?.state ?? "unknown")}><span />{park?.label ?? "Parkstatus wird geladen"}{park?.state === "closed" && park.detail ? <small>{park.detail}</small> : null}</div>
      <div className="rotating-message" key={`${messageIndex}-${message[0]}`}>
        <h1 id="welcome-title">{message[0]}</h1>
        <p>{message[1]}</p>
      </div>
    </div>
    <div className="park-clock" aria-label={`Parkzeit ${time}, ${date}`}>
      <span className="clock-label">Parkzeit</span>
      <strong>{time}</strong>
      <span className="clock-date">{date}</span>
    </div>
  </section>;
}
