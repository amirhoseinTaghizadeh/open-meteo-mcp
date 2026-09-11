import { z } from 'zod';
import { geocode } from '../openmeteo/client.ts';
import { defineTool } from './define.ts';
import { formatPlace, placeSchema, toPlace } from './place.ts';

export const searchPlaces = defineTool({
  name: 'search_places',
  title: 'Search places',
  description:
    'Find places by name and return their coordinates and timezone. ' +
    'Use it to resolve a city or town before calling get_forecast. ' +
    'Returns an empty list (not an error) when nothing matches.',
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .min(2, 'Use at least 2 characters')
      .max(100)
      .describe(
        'Place name, e.g. "Lisbon" or "Paris, France". Two characters match exactly; three or more match by prefix.',
      ),
    count: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe('Maximum number of matches to return (1-10).'),
  }),
  outputSchema: z.object({
    query: z.string(),
    results: z.array(placeSchema),
  }),

  async execute({ query, count }) {
    const results = await geocode(query, count);
    return { query, results: results.map(toPlace) };
  },

  summarize({ query, results }) {
    if (results.length === 0) {
      return `No places matched "${query}". Try a longer or differently spelled name.`;
    }
    const lines = results.map(
      (place) =>
        `- ${formatPlace(place)} (${place.latitude}, ${place.longitude}), ${place.timezone}`,
    );
    return [`${results.length} place(s) matched "${query}":`, ...lines].join('\n');
  },
});
