import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_TTL_MS,
  FORECAST_URL,
  GEOCODING_URL,
  clearCache,
  forecast,
  geocode,
  unitsFor,
} from '../src/openmeteo/client.ts';
import { OpenMeteoError } from '../src/openmeteo/errors.ts';
import { describeWeatherCode } from '../src/openmeteo/weather-codes.ts';
import { forecastLisbon, geocodingLisbon, jsonResponse } from './fixtures.ts';

function stubFetch(handler: (url: URL) => Response | Promise<Response>) {
  const spy = vi.fn((input: string | URL) => handler(new URL(input)));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function calledUrl(spy: ReturnType<typeof stubFetch>, n = 0): URL {
  const input = spy.mock.calls[n]?.[0];
  if (input === undefined) throw new Error(`fetch was not called ${n + 1} time(s)`);
  return new URL(input);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearCache();
});

describe('geocode', () => {
  it('builds the query and maps results', async () => {
    const spy = stubFetch(() => jsonResponse(geocodingLisbon));

    const results = await geocode('Lisbon', 5);

    const url = calledUrl(spy);
    expect(url.origin + url.pathname).toBe(GEOCODING_URL);
    expect(url.searchParams.get('name')).toBe('Lisbon');
    expect(url.searchParams.get('count')).toBe('5');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: 'Lisbon', country_code: 'PT', latitude: 38.71667 });
  });

  it('returns an empty list when Open-Meteo omits `results`', async () => {
    stubFetch(() => jsonResponse({ generationtime_ms: 0.3 }));
    await expect(geocode('zzzzzz', 5)).resolves.toEqual([]);
  });
});

describe('forecast', () => {
  it('requests the exact variables the mapper depends on', async () => {
    const spy = stubFetch(() => jsonResponse(forecastLisbon));

    await forecast({ latitude: 38.7, longitude: -9.1, days: 3, units: 'fahrenheit' });

    const url = calledUrl(spy);
    expect(url.origin + url.pathname).toBe(FORECAST_URL);
    expect(url.searchParams.get('latitude')).toBe('38.7');
    expect(url.searchParams.get('forecast_days')).toBe('3');
    expect(url.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('current')).toContain('weather_code');
    expect(url.searchParams.get('daily')).toContain('precipitation_probability_max');
  });

  it('requests a matching unit set for fahrenheit, and none for celsius', async () => {
    const spy = stubFetch(() => jsonResponse(forecastLisbon));

    await forecast({ latitude: 1, longitude: 1, days: 1, units: 'fahrenheit' });
    await forecast({ latitude: 1, longitude: 1, days: 1, units: 'celsius' });

    const f = calledUrl(spy, 0).searchParams;
    const c = calledUrl(spy, 1).searchParams;
    expect(f.get('wind_speed_unit')).toBe('mph');
    expect(f.get('precipitation_unit')).toBe('inch');
    expect(c.has('wind_speed_unit')).toBe(false);
    expect(unitsFor('fahrenheit')).toEqual({
      temperature: '°F',
      windSpeed: 'mp/h',
      precipitation: 'inch',
    });
  });

  it('surfaces the upstream reason on HTTP 400', async () => {
    stubFetch(() =>
      jsonResponse({ error: true, reason: 'Latitude must be in range of -90 to 90°.' }, 400),
    );

    const error = await forecast({ latitude: 999, longitude: 0, days: 1, units: 'celsius' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(OpenMeteoError);
    expect(error).toMatchObject({ kind: 'http', status: 400 });
    expect((error as Error).message).toContain('Latitude must be in range');
  });

  it('maps a timeout to a readable error', async () => {
    stubFetch(() => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')));

    const error = await forecast({ latitude: 1, longitude: 1, days: 1, units: 'celsius' }).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({ kind: 'timeout' });
    expect((error as Error).message).toMatch(/did not respond within/);
  });

  it('rejects a response that does not match the expected shape', async () => {
    stubFetch(() => jsonResponse({ latitude: 1, longitude: 1 }));

    const error = await forecast({ latitude: 1, longitude: 1, days: 1, units: 'celsius' }).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({ kind: 'shape' });
  });
});

describe('describeWeatherCode', () => {
  it('labels known codes and never throws on unknown ones', () => {
    expect(describeWeatherCode(0)).toBe('Clear sky');
    expect(describeWeatherCode(95)).toBe('Thunderstorm');
    expect(describeWeatherCode(42)).toBe('Unknown conditions (code 42)');
  });
});

describe('cache', () => {
  it('serves an identical request from memory within the TTL and refetches after it', async () => {
    vi.useFakeTimers();
    const spy = stubFetch(() => jsonResponse(geocodingLisbon));

    await geocode('Lisbon', 5);
    await geocode('Lisbon', 5);
    await geocode('Lisbon', 3); // different URL, different entry
    expect(spy).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    await geocode('Lisbon', 5);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('never caches a failure', async () => {
    const spy = stubFetch(() => jsonResponse({ error: true, reason: 'nope' }, 500));

    await expect(geocode('Lisbon', 5)).rejects.toBeInstanceOf(OpenMeteoError);
    await expect(geocode('Lisbon', 5)).rejects.toBeInstanceOf(OpenMeteoError);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
