import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from '../src/tools/define.ts';
import { compareLocations } from '../src/tools/compare-locations.ts';
import { getForecast, mapForecast } from '../src/tools/get-forecast.ts';
import { searchPlaces } from '../src/tools/search-places.ts';
import { clearCache } from '../src/openmeteo/client.ts';
import { forecastLisbon, geocodingLisbon, jsonResponse } from './fixtures.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  clearCache();
});

describe('input schemas carry the validation rules', () => {
  it('search_places trims, requires 2+ characters and defaults count to 5', () => {
    expect(searchPlaces.inputSchema.safeParse({ query: ' a ' }).success).toBe(false);
    expect(searchPlaces.inputSchema.parse({ query: '  Lisbon ' })).toEqual({
      query: 'Lisbon',
      count: 5,
    });
  });

  it('get_forecast bounds coordinates and days, and applies defaults', () => {
    expect(getForecast.inputSchema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false);
    expect(getForecast.inputSchema.safeParse({ latitude: 0, longitude: 0, days: 0 }).success).toBe(
      false,
    );
    expect(getForecast.inputSchema.parse({ latitude: 38.7, longitude: -9.1 })).toEqual({
      latitude: 38.7,
      longitude: -9.1,
      days: 3,
      units: 'celsius',
    });
  });

  it('compare_locations needs 2-5 unique places (case-insensitive)', () => {
    expect(compareLocations.inputSchema.safeParse({ places: ['Lisbon'] }).success).toBe(false);
    expect(compareLocations.inputSchema.safeParse({ places: ['Lisbon', 'lisbon'] }).success).toBe(
      false,
    );
    expect(compareLocations.inputSchema.safeParse({ places: ['Lisbon', 'Porto'] }).success).toBe(
      true,
    );
  });
});

describe('mapForecast', () => {
  it('transposes daily columns into rows, labels codes, and satisfies the output schema', () => {
    const output = mapForecast(forecastLisbon);

    expect(output.current).toMatchObject({
      temperature: 27.4,
      conditions: 'Mainly clear',
      isDay: true,
    });
    expect(output.units).toEqual({ temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' });
    expect(output.daily).toHaveLength(3);
    expect(output.daily[2]).toMatchObject({
      date: '2026-09-09',
      conditions: 'Slight rain',
      temperatureMax: 23.9,
      precipitationSum: 4.2,
    });
    // null from upstream -> absent, not zero
    expect(output.daily[2]?.precipitationProbabilityMax).toBeUndefined();

    expect(() => getForecast.outputSchema.parse(output)).not.toThrow();
  });
});

describe('compare_locations', () => {
  /** Route stubbed fetch calls by endpoint and place name. */
  function stubOpenMeteo() {
    vi.stubGlobal('fetch', (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname.startsWith('geocoding')) {
        const name = url.searchParams.get('name');
        if (name === 'Nowhere') return jsonResponse({ generationtime_ms: 0.1 });
        if (name === 'Boom') return jsonResponse({ error: true, reason: 'upstream exploded' }, 500);
        return jsonResponse(geocodingLisbon);
      }
      return jsonResponse(forecastLisbon);
    });
  }

  it('reports each place in-band and still ranks the ones that worked', async () => {
    stubOpenMeteo();

    const output = await compareLocations.execute({
      places: ['Lisbon', 'Nowhere', 'Boom'],
      days: 3,
      units: 'celsius',
    });

    expect(output.results).toEqual([
      expect.objectContaining({
        place: 'Lisbon',
        status: 'ok',
        averageHigh: 26.1,
        averageLow: 17.5,
        totalPrecipitation: 4.2,
      }),
      { place: 'Nowhere', status: 'not_found', reason: 'No place matched "Nowhere"' },
      expect.objectContaining({ place: 'Boom', status: 'failed' }),
    ]);
    expect(output.warmest).toBe('Lisbon');
    expect(output.driest).toBe('Lisbon');
    expect(() => compareLocations.outputSchema.parse(output)).not.toThrow();
  });

  it('names ties instead of presenting the first place as a winner', async () => {
    stubOpenMeteo(); // both places get the same fixture

    const output = await compareLocations.execute({
      places: ['Lisbon', 'Porto'],
      days: 3,
      units: 'fahrenheit',
    });

    expect(output).toMatchObject({
      warmest: 'Lisbon',
      driest: 'Lisbon',
      precipitationUnit: 'inch',
    });
    const text = compareLocations.summarize(output);
    expect(text).toContain('Warmest: Lisbon (tied with Porto).');
    expect(text).toContain('Driest: Lisbon (tied with Porto).');
    expect(text).toContain('°F');
    expect(text).toContain('4.2 inch');
  });

  it('is an error only when no place could be answered', async () => {
    stubOpenMeteo();

    await expect(
      compareLocations.execute({ places: ['Nowhere', 'Boom'], days: 3, units: 'celsius' }),
    ).rejects.toBeInstanceOf(ToolError);
  });
});
