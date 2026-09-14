export const FORECAST_MODE_KEY="moviepark-forecast-mode";
export const FORECAST_MODE="experimental";

export function readForecastMode(){
  if(typeof window!=="undefined"&&window.localStorage.getItem(FORECAST_MODE_KEY)!==FORECAST_MODE)window.localStorage.setItem(FORECAST_MODE_KEY,FORECAST_MODE);
  return FORECAST_MODE;
}

export function writeForecastMode(){
  window.localStorage.setItem(FORECAST_MODE_KEY,FORECAST_MODE);
  window.dispatchEvent(new CustomEvent("moviepark:forecast-mode",{detail:FORECAST_MODE}));
  return FORECAST_MODE;
}
