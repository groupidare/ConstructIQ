namespace ConstructIQ.API.Services;

// No trained model to forecast with — AI forecasting is blocked rather than
// answered with an untrained fallback. ForecastController turns this into a
// 409 with code "ModelNotTrained", which the Material Plan's Run Forecast
// recognises and falls back to the non-AI historical-average estimate.
public class ModelNotTrainedException(string message) : InvalidOperationException(message);

// A training run is already in progress (one at a time) — a 409 with code
// "TrainingInProgress".
public class TrainingInProgressException(string message) : InvalidOperationException(message);
