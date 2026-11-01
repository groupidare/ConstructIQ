import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import type { ModelStatus, TrainingDataReport, TrainingJob } from '@/types/forecast';

// How often the model status is re-read while a training run is in progress
// (training runs in the background on the ML service — see ForecastService.
// StartTrainingAsync — so the page polls for the outcome).
const POLL_MS = 4000;

// Model status (trained or not, training metadata, the latest training run)
// for everyone, plus — for Admins — the training-data eligibility report and
// starting a retrain. `onRunFinished` fires once when a run this page saw
// running reaches succeeded/failed (e.g. to reload the chart, whose AI
// Predicted line comes from the new model's evaluations).
export function useModelTraining({ isAdmin, onRunFinished }: {
  isAdmin: boolean;
  onRunFinished?: (job: TrainingJob) => void;
}) {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [report, setReport] = useState<TrainingDataReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const lastStatus = useRef<string | null>(null);
  const onFinished = useRef(onRunFinished);
  onFinished.current = onRunFinished;

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get<ModelStatus>('/forecast/model-status');
      const previous = lastStatus.current;
      lastStatus.current = data.training.status;
      setStatus(data);
      if (previous === 'running' && data.training.status !== 'running') onFinished.current?.(data.training);
    } catch {
      setStatus({
        serviceReachable: false,
        model: { trained: false, message: 'Couldn’t load the model status.', manifest: null },
        training: { jobId: null, status: 'idle', startedAt: null, finishedAt: null, error: null },
      });
    }
  }, []);

  const fetchReport = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await api.get<TrainingDataReport>('/forecast/training-data');
      setReport(data);
      setReportError(null);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setReportError(message || 'Couldn’t load the training-data report.');
    }
  }, [isAdmin]);

  useEffect(() => { fetchStatus(); fetchReport(); }, [fetchStatus, fetchReport]);

  const running = status?.training.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(timer);
  }, [running, fetchStatus]);

  // Refresh the eligibility report once a run finishes (the data didn't
  // change, but it's cheap and keeps both panels from the same moment).
  useEffect(() => { if (!running && lastStatus.current !== null) fetchReport(); }, [running, fetchReport]);

  async function startTraining(): Promise<void> {
    setStarting(true);
    try {
      const { data } = await api.post<TrainingJob>('/forecast/train');
      lastStatus.current = data.status;
      setStatus(prev => prev ? { ...prev, training: data } : prev);
    } finally {
      setStarting(false);
    }
  }

  return { status, report, reportError, starting, running, startTraining, refreshStatus: fetchStatus };
}
