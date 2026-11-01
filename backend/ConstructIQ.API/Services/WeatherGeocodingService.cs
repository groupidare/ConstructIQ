using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace ConstructIQ.API.Services;

public interface IWeatherGeocodingService
{
    Task<(decimal Latitude, decimal Longitude)?> GeocodeAsync(string location, CancellationToken ct = default);
}

// Converts a Project's free-text Location into coordinates so the weather
// watcher has something to check — Open-Meteo's forward-geocoding endpoint is
// free/keyless, the same provider already trusted client-side for weather
// itself (frontend/src/lib/weather.ts). Best-effort only: a failure here must
// never block saving a project, it just leaves that project outside weather
// coverage until the next successful geocode.
public class WeatherGeocodingService(IHttpClientFactory httpFactory, ILogger<WeatherGeocodingService> logger) : IWeatherGeocodingService
{
    public async Task<(decimal Latitude, decimal Longitude)?> GeocodeAsync(string location, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(location)) return null;
        try
        {
            var client = httpFactory.CreateClient("OpenMeteoGeocoding");
            var url = $"v1/search?name={Uri.EscapeDataString(location.Trim())}&count=1&language=en&format=json";
            var result = await client.GetFromJsonAsync<GeocodeResponse>(url, ct);
            var first = result?.Results?.FirstOrDefault();
            return first is null ? null : ((decimal)first.Latitude, (decimal)first.Longitude);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Geocoding failed for project location {Location}", location);
            return null;
        }
    }

    private class GeocodeResponse { [JsonPropertyName("results")] public GeocodeResult[]? Results { get; set; } }
    private class GeocodeResult
    {
        [JsonPropertyName("latitude")]  public double Latitude  { get; set; }
        [JsonPropertyName("longitude")] public double Longitude { get; set; }
    }
}
