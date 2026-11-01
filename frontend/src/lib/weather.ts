import type { ConstructionRiskAssessment, ConstructionRiskLevel } from "@/types/weather";

// ── Location ──────────────────────────────────────────────────────────────
// Used only if the browser denies/lacks geolocation, so the header never
// shows blank weather. Kept as Manila since that's this system's home market.
export const FALLBACK_LOCATION = {
  latitude: 14.5995,
  longitude: 120.9842,
  name: "Manila, Philippines",
};

export function getCurrentCoordinates(timeoutMs = 8000): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("Geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

// Free, keyless, made for client-side reverse geocoding (no CORS/API-key setup needed).
export async function reverseGeocodeCity(latitude: number, longitude: number): Promise<string> {
  const res = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
  );
  if (!res.ok) throw new Error("Reverse geocode failed");
  const data = await res.json();
  const city = data.city || data.locality || data.principalSubdivision;
  const country = data.countryName;
  if (city && country) return `${city}, ${country}`;
  return city || country || "Current location";
}

// ── Weather (Open-Meteo — free, keyless) ────────────────────────────────────
interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    is_day: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
  };
}

export async function fetchOpenMeteoSnapshot(latitude: number, longitude: number): Promise<OpenMeteoResponse> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum");
  url.searchParams.set("forecast_days", "5");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Weather request failed");
  return res.json() as Promise<OpenMeteoResponse>;
}

// ── WMO weather codes → human label + emoji ─────────────────────────────────
export const WMO_WEATHER: Record<number, { label: string; emoji: string }> = {
  0: { label: "Clear sky", emoji: "☀️" },
  1: { label: "Mainly clear", emoji: "🌤️" },
  2: { label: "Partly cloudy", emoji: "⛅" },
  3: { label: "Overcast", emoji: "☁️" },
  45: { label: "Fog", emoji: "🌫️" },
  48: { label: "Freezing fog", emoji: "🌫️" },
  51: { label: "Light drizzle", emoji: "🌦️" },
  53: { label: "Drizzle", emoji: "🌦️" },
  55: { label: "Dense drizzle", emoji: "🌦️" },
  56: { label: "Light freezing drizzle", emoji: "🌧️" },
  57: { label: "Dense freezing drizzle", emoji: "🌧️" },
  61: { label: "Light rain", emoji: "🌧️" },
  63: { label: "Rain", emoji: "🌧️" },
  65: { label: "Heavy rain", emoji: "🌧️" },
  66: { label: "Light freezing rain", emoji: "🌧️" },
  67: { label: "Heavy freezing rain", emoji: "🌧️" },
  71: { label: "Light snow", emoji: "🌨️" },
  73: { label: "Snow", emoji: "🌨️" },
  75: { label: "Heavy snow", emoji: "❄️" },
  77: { label: "Snow grains", emoji: "🌨️" },
  80: { label: "Light rain showers", emoji: "🌦️" },
  81: { label: "Rain showers", emoji: "🌧️" },
  82: { label: "Violent rain showers", emoji: "⛈️" },
  85: { label: "Light snow showers", emoji: "🌨️" },
  86: { label: "Heavy snow showers", emoji: "🌨️" },
  95: { label: "Thunderstorm", emoji: "⛈️" },
  96: { label: "Thunderstorm, hail", emoji: "⛈️" },
  99: { label: "Severe thunderstorm, hail", emoji: "⛈️" },
};

export function getWeatherLabel(code: number): { label: string; emoji: string } {
  return WMO_WEATHER[code] ?? { label: "Unknown", emoji: "🌡️" };
}

// ── Construction risk assessment (backs Problem-Requirements R4) ───────────
export function assessConstructionRisk(params: {
  weatherCode: number;
  precipitationMm: number;
  windKph: number;
}): ConstructionRiskAssessment {
  const { weatherCode, precipitationMm, windKph } = params;
  const isStorm = [95, 96, 99].includes(weatherCode);
  const isHeavyRain = [65, 67, 75, 82, 86].includes(weatherCode);
  const isModerateRain = [61, 63, 66, 73, 80, 81, 85, 55, 57].includes(weatherCode);
  const isLightRain = [51, 53, 56, 71, 77].includes(weatherCode);

  if (isStorm || windKph >= 60 || precipitationMm >= 15) {
    return {
      level: "extreme",
      headline: "Severe weather — halt outdoor work & deliveries",
      advisory:
        "Thunderstorms or high winds detected. Postpone concrete pours, crane operations, and material deliveries. Recommend pushing reorder points and expected delivery dates back 2-3 days.",
    };
  }
  if (isHeavyRain || windKph >= 40 || precipitationMm >= 7.5) {
    return {
      level: "high",
      headline: "High delay risk for deliveries & pours",
      advisory:
        "Heavy rain or strong winds may delay truck deliveries and make fresh concrete work unsafe. Recommend a 1-2 day buffer on active purchase orders and reorder points.",
    };
  }
  if (isModerateRain || isLightRain || windKph >= 25) {
    return {
      level: "moderate",
      headline: "Moderate weather risk",
      advisory:
        "Light-to-moderate rain or wind expected. Monitor supplier ETAs closely and consider a 1-day buffer for weather-sensitive materials.",
    };
  }
  return {
    level: "low",
    headline: "No significant weather delays expected",
    advisory: "Conditions are favorable for deliveries and outdoor work, including concrete pouring.",
  };
}

// ── Shared risk color tokens (light UI: header chip, procurement banner) ───
export const RISK_VISUALS: Record<
  ConstructionRiskLevel,
  { bg: string; border: string; badgeBg: string; badgeColor: string; dot: string }
> = {
  low:      { bg: "#fffbeb", border: "#fde68a", badgeBg: "#dcfce7", badgeColor: "#15803d", dot: "#22c55e" },
  moderate: { bg: "#fffbeb", border: "#fde68a", badgeBg: "#fef3c7", badgeColor: "#b45309", dot: "#f59e0b" },
  high:     { bg: "#fff7ed", border: "#fdba74", badgeBg: "#ffedd5", badgeColor: "#c2410c", dot: "#f97316" },
  extreme:  { bg: "#fef2f2", border: "#fca5a5", badgeBg: "#fee2e2", badgeColor: "#b91c1c", dot: "#ef4444" },
};

// ── Shared risk color tokens (dark cards, e.g. System Overview) ─────────────
export const RISK_VISUALS_DARK: Record<ConstructionRiskLevel, { bg: string; border: string; text: string }> = {
  low:      { bg: "rgba(34,197,94,0.14)",  border: "rgba(34,197,94,0.28)",  text: "#4ade80" },
  moderate: { bg: "rgba(234,179,8,0.14)",  border: "rgba(234,179,8,0.28)",  text: "#facc15" },
  high:     { bg: "rgba(249,115,22,0.14)", border: "rgba(249,115,22,0.28)", text: "#fb923c" },
  extreme:  { bg: "rgba(239,68,68,0.14)",  border: "rgba(239,68,68,0.28)", text: "#f87171" },
};
