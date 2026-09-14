export default function manifest() {
  return {
    id: "/",
    name: "Movie Park Germany · Fan Park Guide",
    short_name: "Park Guide",
    description: "Live-Wetter, Attraktionsstatus und Wartezeiten für deinen Parktag im Movie Park Germany.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "portrait-primary",
    background_color: "#f7f8f4",
    theme_color: "#102a22",
    lang: "de-DE",
    categories: ["travel", "entertainment", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Was jetzt?", short_name: "Parktag", url: "/park-day", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Parkplan", short_name: "Parkplan", url: "/map", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Attraktionen", short_name: "Attraktionen", url: "/attractions", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Shows & Parade", short_name: "Shows", url: "/shows", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Wetter & Prognose", short_name: "Wetter", url: "/weather", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
