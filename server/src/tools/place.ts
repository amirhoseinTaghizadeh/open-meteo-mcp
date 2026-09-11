import { z } from 'zod';
import type { GeocodingResult } from '../openmeteo/client.ts';

export const placeSchema = z.object({
  id: z.number(),
  name: z.string(),
  country: z.string().optional(),
  countryCode: z.string().optional(),
  admin1: z.string().optional().describe('First-level administrative area, e.g. state or region'),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  population: z.number().optional(),
});

export type Place = z.output<typeof placeSchema>;

export function toPlace(result: GeocodingResult): Place {
  return {
    id: result.id,
    name: result.name,
    country: result.country,
    countryCode: result.country_code,
    admin1: result.admin1,
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone,
    population: result.population,
  };
}

// "Lisbon, Lisbon, Portugal", skipping parts we don't have
export function formatPlace(place: Pick<Place, 'name' | 'admin1' | 'country'>): string {
  return [place.name, place.admin1, place.country].filter(Boolean).join(', ');
}
