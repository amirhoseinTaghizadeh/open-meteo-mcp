// Real Open-Meteo payloads, trimmed to the fields we ask for.

export const geocodingLisbon = {
  results: [
    {
      id: 2267057,
      name: 'Lisbon',
      latitude: 38.71667,
      longitude: -9.13333,
      elevation: 45,
      feature_code: 'PPLC',
      country_code: 'PT',
      timezone: 'Europe/Lisbon',
      population: 517802,
      country: 'Portugal',
      admin1: 'Lisbon',
    },
    {
      id: 4999311,
      name: 'Lisbon',
      latitude: 41.5262,
      longitude: -83.3455,
      country_code: 'US',
      timezone: 'America/New_York',
      country: 'United States',
      admin1: 'Ohio',
    },
  ],
  generationtime_ms: 0.7,
};

export const forecastLisbon = {
  latitude: 38.75,
  longitude: -9.125,
  generationtime_ms: 0.2,
  utc_offset_seconds: 3600,
  timezone: 'Europe/Lisbon',
  timezone_abbreviation: 'GMT+1',
  elevation: 45,
  current_units: {
    time: 'iso8601',
    interval: 'seconds',
    temperature_2m: '°C',
    relative_humidity_2m: '%',
    apparent_temperature: '°C',
    is_day: '',
    precipitation: 'mm',
    weather_code: 'wmo code',
    wind_speed_10m: 'km/h',
    wind_direction_10m: '°',
  },
  current: {
    time: '2026-09-07T15:00',
    interval: 900,
    temperature_2m: 27.4,
    relative_humidity_2m: 48,
    apparent_temperature: 27.1,
    is_day: 1,
    precipitation: 0,
    weather_code: 1,
    wind_speed_10m: 18.4,
    wind_direction_10m: 320,
  },
  daily_units: {
    time: 'iso8601',
    weather_code: 'wmo code',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
    precipitation_sum: 'mm',
    precipitation_probability_max: '%',
    sunrise: 'iso8601',
    sunset: 'iso8601',
  },
  daily: {
    time: ['2026-09-07', '2026-09-08', '2026-09-09'],
    weather_code: [1, 2, 61],
    temperature_2m_max: [28.1, 26.3, 23.9],
    temperature_2m_min: [18.2, 17.9, 16.4],
    precipitation_sum: [0, 0, 4.2],
    precipitation_probability_max: [0, 10, null],
    sunrise: ['2026-09-07T07:12', '2026-09-08T07:13', '2026-09-09T07:14'],
    sunset: ['2026-09-07T20:01', '2026-09-08T19:59', '2026-09-09T19:58'],
  },
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
