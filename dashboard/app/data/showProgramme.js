export const PARK_TIME_ZONE = "Europe/Berlin";

export const SHOW_PROGRAMME = [
  {
    id: "operation-red-carpet",
    type: "Stuntshow",
    title: "Operation Red Carpet",
    shortTitle: "Stuntshow",
    location: "Studio 6",
    duration: 25,
    times: ["12:00", "15:00"],
    tone: "action",
    description: "Filmreife Auto- und Motorradstunts, Action und eine turbulente Award-Verleihung.",
  },
  {
    id: "parade-of-celebration",
    type: "Parade",
    title: "Movie Park’s Parade of Celebration",
    shortTitle: "Jubiläumsparade",
    location: "Hollywood Boulevard",
    duration: 20,
    times: ["16:30"],
    tone: "parade",
    description: "Hollywood-Glamour, neue Paradefloats, Walking Characters, Choreografien und Live-Vocals.",
  },
];

export function parkDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

export function parkMinutes(date = new Date()) {
  const { hour, minute } = parkDateParts(date);
  return Number(hour) * 60 + Number(minute);
}

export function timeMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function occurrenceAt(time, date = new Date()) {
  const { year, month, day } = parkDateParts(date);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute);
  const parkHourAtGuess = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: PARK_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(utcGuess)));
  const offsetHours = parkHourAtGuess - hour;
  return new Date(utcGuess - offsetHours * 60 * 60 * 1000);
}

export function todaysOccurrences(date = new Date()) {
  return SHOW_PROGRAMME.flatMap((show) =>
    show.times.map((time) => ({ ...show, time, startsAt: occurrenceAt(time, date) })),
  ).sort((a, b) => a.startsAt - b.startsAt);
}
