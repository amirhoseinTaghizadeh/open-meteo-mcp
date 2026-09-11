import { z } from 'zod';
import { forecast, geocode, unitsFor, type TemperatureUnit } from '../openmeteo/client.ts';
import { OpenMeteoError } from '../openmeteo/errors.ts';
import { defineTool, ToolError } from './define.ts';
import { temperatureUnitSchema } from './get-forecast.ts';
import { formatPlace } from './place.ts';

const okResultSchema = z.object({
  place: z.string().describe('The name as given in the request'),
  status: z.literal('ok'),
  resolved: z.object({
    name: z.string(),
    country: z.string().optional(),
    latitude: z.number(),
    longitude: z.number(),
  }),
  averageHigh: z.number().optional(),
  averageLow: z.number().optional(),
  totalPrecipitation: z.number().optional(),
});

const problemResultSchema = z.object({
  place: z.string(),
  status: z.enum(['not_found', 'failed']),
  reason: z.string(),
});

const resultSchema = z.discriminatedUnion('status', [okResultSchema, problemResultSchema]);

type OkResult = z.output<typeof okResultSchema>;
type Result = z.output<typeof resultSchema>;

const placesSchema = z
  .array(z.string().trim().min(2).max(100))
  .min(2)
  .max(5)
  .refine((places) => new Set(places.map((p) => p.toLowerCase())).size === places.length, {
    message: 'Places must be unique',
  })
  .describe('Two to five place names to compare, e.g. ["Lisbon", "Porto", "Madrid"].');

export const compareLocations = defineTool({
  name: 'compare_locations',
  title: 'Compare locations',
  description:
    'Compare the upcoming weather of two to five places side by side and say which is warmest and driest. ' +
    'Places are looked up concurrently; a place that cannot be resolved is reported in its row without failing the others.',
  inputSchema: z.object({
    places: placesSchema,
    days: z
      .number()
      .int()
      .min(1)
      .max(7)
      .default(3)
      .describe('Number of days to average over, including today (1-7).'),
    units: temperatureUnitSchema,
  }),
  outputSchema: z.object({
    days: z.number(),
    units: z.enum(['celsius', 'fahrenheit']),
    precipitationUnit: z.string().describe('Unit of totalPrecipitation'),
    results: z.array(resultSchema),
    warmest: z
      .string()
      .optional()
      .describe('Place with the highest average daily high; on a tie, the first in request order'),
    driest: z
      .string()
      .optional()
      .describe('Place with the lowest total precipitation; on a tie, the first in request order'),
  }),

  async execute({ places, days, units }) {
    const settled = await Promise.allSettled(
      places.map((place) => comparePlace(place, days, units)),
    );

    const results: Result[] = settled.map((outcome, i) => {
      if (outcome.status === 'fulfilled') return outcome.value;
      // upstream failures go in the row, anything else is a bug
      if (!(outcome.reason instanceof OpenMeteoError)) throw outcome.reason;
      return { place: places[i] ?? '', status: 'failed', reason: outcome.reason.message };
    });

    const ok = results.filter((r): r is OkResult => r.status === 'ok');
    if (ok.length === 0) {
      const reasons = results.map((r) => `${r.place}: ${r.status === 'ok' ? '' : r.reason}`);
      throw new ToolError(`Could not get weather for any of the places. ${reasons.join('; ')}`);
    }

    return {
      days,
      units,
      precipitationUnit: unitsFor(units).precipitation,
      results,
      warmest: best(ok, (r) => r.averageHigh, Math.max)[0]?.place,
      driest: best(ok, (r) => r.totalPrecipitation, Math.min)[0]?.place,
    };
  },

  summarize({ days, units, precipitationUnit, results }) {
    const unit = unitsFor(units).temperature;
    const lines = results.map((r) => {
      if (r.status !== 'ok') return `- ${r.place}: ${r.status.replace('_', ' ')} (${r.reason})`;
      const high = r.averageHigh === undefined ? 'n/a' : `${r.averageHigh}${unit}`;
      const low = r.averageLow === undefined ? 'n/a' : `${r.averageLow}${unit}`;
      const rain =
        r.totalPrecipitation === undefined ? 'n/a' : `${r.totalPrecipitation} ${precipitationUnit}`;
      return `- ${r.place} (${formatPlace(r.resolved)}): avg high ${high}, avg low ${low}, total precipitation ${rain}`;
    });
    // say when it's a tie instead of pretending the first place won
    const ok = results.filter((r): r is OkResult => r.status === 'ok');
    const verdict = [
      describeBest(
        'Warmest',
        best(ok, (r) => r.averageHigh, Math.max),
      ),
      describeBest(
        'Driest',
        best(ok, (r) => r.totalPrecipitation, Math.min),
      ),
    ]
      .filter(Boolean)
      .join(' ');
    return [`Next ${days} day(s):`, ...lines, verdict].filter(Boolean).join('\n');
  },
});

async function comparePlace(place: string, days: number, units: TemperatureUnit): Promise<Result> {
  const [match] = await geocode(place, 1);
  if (!match) {
    return { place, status: 'not_found', reason: `No place matched "${place}"` };
  }

  const { daily } = await forecast({
    latitude: match.latitude,
    longitude: match.longitude,
    days,
    units,
  });

  return {
    place,
    status: 'ok',
    resolved: {
      name: match.name,
      country: match.country,
      latitude: match.latitude,
      longitude: match.longitude,
    },
    averageHigh: mean(daily.temperature_2m_max),
    averageLow: mean(daily.temperature_2m_min),
    totalPrecipitation: sum(daily.precipitation_sum),
  };
}

// nulls are "unknown", not zero
function known(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

function mean(values: (number | null)[]): number | undefined {
  const nums = known(values);
  return nums.length === 0 ? undefined : round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function sum(values: (number | null)[]): number | undefined {
  const nums = known(values);
  return nums.length === 0 ? undefined : round(nums.reduce((a, b) => a + b, 0));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// everything sharing the best value, in request order (first = winner, rest = ties)
function best<T>(
  items: T[],
  metric: (item: T) => number | undefined,
  choose: (a: number, b: number) => number,
): T[] {
  const scored = items.flatMap((item) => {
    const value = metric(item);
    return value === undefined ? [] : [{ item, value }];
  });
  if (scored.length === 0) return [];
  const target = scored.map((s) => s.value).reduce((a, b) => choose(a, b));
  return scored.filter((s) => s.value === target).map((s) => s.item);
}

function describeBest(label: string, winners: OkResult[]): string {
  const [first, ...ties] = winners;
  if (first === undefined) return '';
  const tie = ties.length === 0 ? '' : ` (tied with ${ties.map((r) => r.place).join(', ')})`;
  return `${label}: ${first.place}${tie}.`;
}
