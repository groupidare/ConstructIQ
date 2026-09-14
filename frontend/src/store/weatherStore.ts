import { create } from "zustand";
import {
  FALLBACK_LOCATION,
  getCurrentCoordinates,
  reverseGeocodeCity,
  fetchOpenMeteoSnapshot,
  getWeatherLabel,
  assessConstructionRisk,
} from "@/lib/weather";
import type { ConstructionRiskAssessment, DailyForecastDay, WeatherSnapshot, WeatherStatus } from "@/types/weather";
import { useAlertStore } from "@/store/alertStore";

const STALE_MS = 15 * 60 * 1000; // re-check every 15 min at most

interface WeatherState {
  status: WeatherStatus;
  snapshot: WeatherSnapshot | null;
  daily: DailyForecastDay[];
  risk: ConstructionRiskAssessment | null;
  usingFallbackLocation: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  fetchWeather: (force?: boolean) => Promise<void>;
}

export const useWeatherStore = create<WeatherState>((set, get) => ({
  status: "idle",
  snapshot: null,
  daily: [],
  risk: null,
  usingFallbackLocation: false,
  error: null,
  lastFetchedAt: null,

  async fetchWeather(force = false) {
    const { status, lastFetchedAt } = get();
    if (!force && lastFetchedAt && Date.now() - lastFetchedAt < STALE_MS) return;
    if (status === "locating" || status === "loading") return;

    set({ status: "locating", error: null });

    let latitude = FALLBACK_LOCATION.latitude;
    let longitude = FALLBACK_LOCATION.longitude;
    let usingFallback = false;

    try {
      const coords = await getCurrentCoordinates();
      latitude = coords.latitude;
      longitude = coords.longitude;
    } catch {
      usingFallback = true;
    }

    set({ status: "loading", usingFallbackLocation: usingFallback });

    try {
      const [weatherData, locationName] = await Promise.all([
        fetchOpenMeteoSnapshot(latitude, longitude),
        usingFallback
          ? Promise.resolve(FALLBACK_LOCATION.name)
          : reverseGeocodeCity(latitude, longitude).catch(() => FALLBACK_LOCATION.name),
      ]);

      const current = weatherData.current;
      const codeInfo = getWeatherLabel(current.weather_code);

      const snapshot: WeatherSnapshot = {
        tempC: Math.round(current.temperature_2m),
        conditionCode: current.weather_code,
        conditionLabel: codeInfo.label,
        emoji: codeInfo.emoji,
        isDay: current.is_day === 1,
        windKph: Math.round(current.wind_speed_10m),
        humidityPct: Math.round(current.relative_humidity_2m),
        precipitationMm: current.precipitation,
        locationName,
        latitude,
        longitude,
        updatedAt: new Date().toISOString(),
      };

      const daily: DailyForecastDay[] = weatherData.daily.time.map((dateStr, i) => {
        const info = getWeatherLabel(weatherData.daily.weather_code[i]);
        return {
          date: dateStr,
          label: new Date(dateStr).toLocaleDateString("en-US", { weekday: "short" }),
          emoji: info.emoji,
          maxTempC: Math.round(weatherData.daily.temperature_2m_max[i]),
          minTempC: Math.round(weatherData.daily.temperature_2m_min[i]),
          precipitationMm: weatherData.daily.precipitation_sum[i],
          conditionCode: weatherData.daily.weather_code[i],
        };
      });

      const risk = assessConstructionRisk({
        weatherCode: snapshot.conditionCode,
        precipitationMm: snapshot.precipitationMm,
        windKph: snapshot.windKph,
      });

      set({ status: "ready", snapshot, daily, risk, lastFetchedAt: Date.now(), error: null });

      // System-wide alert (R4): weather disruptions should be visible from any page, not just Procurement.
      if (risk.level === "high" || risk.level === "extreme") {
        const today = new Date().toISOString().slice(0, 10);
        useAlertStore.getState().addAlert({
          kind: "weather",
          title: risk.level === "extreme" ? "Severe Weather Alert" : "Weather Delay Risk",
          body: `${snapshot.conditionLabel} in ${snapshot.locationName} (${snapshot.tempC}°C). ${risk.advisory}`,
          dedupeKey: `weather-${today}-${risk.level}`,
        });
      }
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : "Failed to load weather" });
    }
  },
}));
