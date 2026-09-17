import { useState } from 'react';
import api from '@/lib/api';
import type { TrainModelsResult } from '@/types/forecast';

export function useModelTraining() {
  const [training, setTraining] = useState(false);

  async function trainModels(): Promise<TrainModelsResult> {
    setTraining(true);
    try {
      const { data } = await api.post<TrainModelsResult>('/forecast/train');
      return data;
    } finally {
      setTraining(false);
    }
  }

  return { training, trainModels };
}
