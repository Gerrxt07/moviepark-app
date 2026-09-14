import WeatherDetailPage from "../components/WeatherDetailPage";

export const metadata = {
  title: "Wetter & Prognose · Movie Park Fan Dashboard",
  description: "Ganztägiges Parkwetter und Vergleich historischer Prognosen mit den aufgezeichneten Wetterdaten.",
};

export default function WeatherPage() {
  return <WeatherDetailPage />;
}
