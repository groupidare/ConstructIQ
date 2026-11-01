export type ConstructionRiskLevel = "low" | "moderate" | "high" | "extreme";

export type WeatherStatus = "idle" | "locating" | "loading" | "ready" | "error";

export interface WeatherSnapshot {
  tempC: number;
  conditionCode: number;
  conditionLabel: string;
  emoji: string;
  isDay: boolean;
  windKph: number;
  humidityPct: number;
  precipitationMm: number;
  locationName: string;
  latitude: number;
  longitude: number;
  updatedAt: string;
}

export interface DailyForecastDay {
  date: string;
  label: string;
  emoji: string;
  maxTempC: number;
  minTempC: number;
  precipitationMm: number;
  conditionCode: number;
}

export interface ConstructionRiskAssessment {
  level: ConstructionRiskLevel;
  headline: string;
  advisory: string;
}
