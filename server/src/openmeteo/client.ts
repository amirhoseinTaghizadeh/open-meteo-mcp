// Small client for the two Open-Meteo endpoints we use. Validates the JSON
// with zod and turns every failure into an OpenMeteoError with a readable message.
import { z } from 'zod';
import { OpenMeteoError } from './errors.ts';

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

export const REQUEST_TIMEOUT_MS = 5_000;

// forecasts only change hourly upstream, so a minute of caching is safe
export const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

export type TemperatureUnit = 'celsius' | 'fahrenheit';

// fahrenheit also means mph and inches, so we don't mix unit systems
export function unitsFor(units: TemperatureUnit) {
  return units === 'fahrenheit'
    ? { temperature: '°F', windSpeed: 'mp/h', precipitation: 'inch' }
    : { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' };
}

// response shapes; optional = may be missing, nullable = may be unknown

const geocodingResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().optional(),
  country_code: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string(),
  population: z.number().optional(),
});

const geocodingResponseSchema = z.object({
  results: z.array(geocodingResultSchema).optional(),
});

const forecastResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().optional(),
  timezone: z.string(),
  current_units: z.record(z.string(), z.string()),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    relative_humidity_2m: z.number(),
    apparent_temperature: z.number(),
    is_day: z.number(),
    precipitation: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number(),
    wind_direction_10m: z.number(),
  }),
  daily_units: z.record(z.string(), z.string()),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number().nullable()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()),
    sunrise: z.array(z.string()),
    sunset: z.array(z.string()),
  }),
});

const errorResponseSchema = z.object({ error: z.literal(true), reason: z.string() });

export type GeocodingResult = z.infer<typeof geocodingResultSchema>;
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;

export async function geocode(query: string, count: number): Promise<GeocodingResult[]> {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set('name', query);
  url.searchParams.set('count', String(count));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const body = await getJson(url, geocodingResponseSchema);
  return body.results ?? [];
}

export interface ForecastParams {
  latitude: number;
  longitude: number;
  days: number;
  units: TemperatureUnit;
}

const CURRENT_VARIABLES = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'is_day',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
];

const DAILY_VARIABLES = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'sunrise',
  'sunset',
];

export async function forecast(params: ForecastParams): Promise<ForecastResponse> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', String(params.latitude));
  url.searchParams.set('longitude', String(params.longitude));
  url.searchParams.set('current', CURRENT_VARIABLES.join(','));
  url.searchParams.set('daily', DAILY_VARIABLES.join(','));
  url.searchParams.set('forecast_days', String(params.days));
  url.searchParams.set('temperature_unit', params.units);
  if (params.units === 'fahrenheit') {
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('precipitation_unit', 'inch');
  }
  url.searchParams.set('timezone', 'auto');

  return getJson(url, forecastResponseSchema);
}

// successful responses by URL; failures are never cached
const cache = new Map<string, { expires: number; value: unknown }>();

export function clearCache(): void {
  cache.clear();
}

async function getJson<T>(url: URL, schema: z.ZodType<T>): Promise<T> {
  const key = url.href;
  const hit = cache.get(key);
  if (hit !== undefined && hit.expires > Date.now()) return hit.value as T;

  const value = await fetchJson(url, schema);

  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Map keeps insertion order, so the first key is the oldest
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

async function fetchJson<T>(url: URL, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw new OpenMeteoError(
        'timeout',
        `Open-Meteo did not respond within ${REQUEST_TIMEOUT_MS / 1000}s. Try again.`,
      );
    }
    throw new OpenMeteoError('network', `Could not reach Open-Meteo: ${describe(error)}`);
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const known = errorResponseSchema.safeParse(body);
    const message = known.success
      ? `Open-Meteo rejected the request: ${known.data.reason}`
      : `Open-Meteo returned HTTP ${response.status}.`;
    throw new OpenMeteoError('http', message, response.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new OpenMeteoError('shape', 'Open-Meteo returned a response in an unexpected format.');
  }
  return parsed.data;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
