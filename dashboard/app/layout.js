import "./styles.css";
import "./design-system.css";
import "./new-ui.css";
import "./park-day.css";
import "./recommendation-history.css";
import "leaflet/dist/leaflet.css";
import "./motion.css";
import "./legal.css";
import "./map-privacy.css";
import "./data-info.css";
import "./content-ux.css";
import "./source-ux.css";
import "./inline-source.css";
import "./localization.css";
import "./layout-overhaul.css";
import AppUpdateWatcher from "./components/AppUpdateWatcher";
import LocaleRuntime from "./components/LocaleRuntime";

export const metadata = {
  title: "Movie Park Germany · Park Guide",
  description: "Dein kompakter Live-Begleiter für Movie Park Germany",
  manifest: "/manifest.webmanifest",
  applicationName: "Movie Park Fan Park Guide",
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }], apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Park Guide" },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#102a22" },
  ],
};

export default function RootLayout({ children }) {
  const localeBoot = `(function(){try{var l=localStorage.getItem('moviepark-locale')==='en'?'en':'de';document.documentElement.lang=l;document.documentElement.dataset.locale=l}catch(e){}})()`;
  return <html lang="de" data-locale="de" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:localeBoot}} /></head><body><LocaleRuntime /><AppUpdateWatcher />{children}</body></html>;
}
