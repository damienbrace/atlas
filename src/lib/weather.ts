import "server-only";

// Forecast from Open-Meteo (free, no key). Only the place's coordinates leave your PC.
// Set WEATHER_PLACE, WEATHER_LAT and WEATHER_LON in .env.local to change the location.

const PLACE = process.env.WEATHER_PLACE || "Bunbury";
const LAT = process.env.WEATHER_LAT || "-33.327";
const LON = process.env.WEATHER_LON || "115.641";
const CACHE_MS = 30 * 60_000;
// Thresholds that change a bricklaying day.
const RAIN_CHANCE = 50;
const HOT_C = 35;

export interface DayForecast {
  date: string;
  high: number;
  low: number;
  rainChance: number;
  label: string;
}

export interface Weather {
  place: string;
  now: { temp: number; label: string };
  today: DayForecast;
  /** First hour from now with a good chance of rain, e.g. "2 PM". */
  rainFrom: string | null;
  hot: boolean;
  /** One line for the chip: "18° · Showers after 2 PM". */
  headline: string;
  next: DayForecast[];
}

function label(code: number) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  return "Storms";
}

const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

interface OpenMeteo {
  current: { temperature_2m: number; weather_code: number };
  hourly: { time: string[]; precipitation_probability: number[] };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
}

let cached: { at: number; weather: Weather } | null = null;

export async function getWeather(): Promise<Weather | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.weather;
  const params = new URLSearchParams({
    latitude: LAT,
    longitude: LON,
    current: "temperature_2m,weather_code",
    hourly: "precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "4",
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return cached?.weather ?? null;
    const data = (await res.json()) as OpenMeteo;

    const days: DayForecast[] = data.daily.time.map((date, i) => ({
      date,
      high: Math.round(data.daily.temperature_2m_max[i]),
      low: Math.round(data.daily.temperature_2m_min[i]),
      rainChance: data.daily.precipitation_probability_max[i] ?? 0,
      label: label(data.daily.weather_code[i]),
    }));
    const today = days[0];
    // Hourly times are local to the place ("2026-10-02T14:00"); look from the current hour to 8 PM.
    const nowHour = new Date().getHours();
    const rainIndex = data.hourly.time.findIndex((t, i) => {
      const hour = Number(t.slice(11, 13));
      return t.startsWith(today.date) && hour >= nowHour && hour <= 20 && data.hourly.precipitation_probability[i] >= RAIN_CHANCE;
    });
    const rainFrom = rainIndex >= 0 ? hourLabel(Number(data.hourly.time[rainIndex].slice(11, 13))) : null;
    const hot = today.high >= HOT_C;
    const temp = Math.round(data.current.temperature_2m);
    const headline = [
      `${temp}°`,
      rainFrom ? (rainFrom === hourLabel(nowHour) ? "Rain likely now" : `Showers after ${rainFrom}`) : hot ? `Hot, ${today.high}°` : label(data.current.weather_code),
    ].join(" · ");

    const weather: Weather = { place: PLACE, now: { temp, label: label(data.current.weather_code) }, today, rainFrom, hot, headline, next: days.slice(1) };
    cached = { at: Date.now(), weather };
    return weather;
  } catch {
    return cached?.weather ?? null;
  }
}
