import { useState } from 'react';
import api from '@/lib/api';
import type { ForecastRequest, ForecastResult, ForecastAccuracyReport } from '@/types/forecast';

export function useForecasting(projectId: number) {
  const [forecasts, setForecasts] = useState<ForecastResult[]>([]);
  const [accuracy, setAccuracy]   = useState<ForecastAccuracyReport | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function fetchForecasts() {
    setLoading(true);
    try {
      const { data } = await api.get<ForecastResult[]>(`/forecast/project/${projectId}`);
      setForecasts(data);
    } catch {
      setError('Failed to load forecasts.');
    } finally {
      setLoading(false);
    }
  }

  async function generateForecast(payload: ForecastRequest): Promise<ForecastResult> {
    const { data } = await api.post<ForecastResult>('/forecast/generate', payload);
    setForecasts(prev => [data, ...prev]);
    return data;
  }

  async function fetchAccuracy() {
    const { data } = await api.get<ForecastAccuracyReport>(`/forecast/accuracy/${projectId}`);
    setAccuracy(data);
  }

  return { forecasts, accuracy, loading, error, fetchForecasts, generateForecast, fetchAccuracy };
}
