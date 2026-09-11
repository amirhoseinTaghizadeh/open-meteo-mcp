import { z } from 'zod';
import { forecast, type ForecastResponse } from '../openmeteo/client.ts';
import { describeWeatherCode } from '../openmeteo/weather-codes.ts';
import { defineTool } from './define.ts';

export const temperatureUnitSchema = z
  .enum(['celsius', 'fahrenheit'])
  .default('celsius')
  .describe('Temperature unit.');

const dailyForecastSchema = z.object({
  date: z.string().describe('Local date, YYYY-MM-DD'),
  conditions: z.string(),
  weatherCode: z.number().optional().describe('WMO weather code'),
  temperatureMax: z.number().optional(),
  temperatureMin: z.number().optional(),
  precipitationSum: z.number().optional(),
  precipitationProbabilityMax: z.number().optional().describe('Percent'),
  sunrise: z.string(),
  sunset: z.string(),
});

const forecastOutputSchema = z.object({
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    elevation: z.number().optional(),
    timezone: z.string(),
  }),
  units: z.object({
    temperature: z.string(),
    windSpeed: z.string(),
    precipitation: z.string(),
  }),
  current: z.object({
    time: z.string().describe('Local time'),
    temperature: z.number(),
    apparentTemperature: z.number(),
    humidity: z.number().describe('Percent'),
    precipitation: z.number(),
    windSpeed: z.number(),
    windDirection: z.number().describe('Degrees'),
    isDay: z.boolean(),
    weatherCode: z.number(),
    conditions: z.string(),
  }),
  daily: z.array(dailyForecastSchema),
});

export type ForecastOutput = z.output<typeof forecastOutputSchema>;

// Open-Meteo returns daily data as columns; turn it into one row per day.
export function mapForecast(response: ForecastResponse): ForecastOutput {
  const { current, daily } = response;

  return {
    location: {
      latitude: response.latitude,
      longitude: response.longitude,
      elevation: response.elevation,
      timezone: response.timezone,
    },
    units: {
      temperature: response.current_units['temperature_2m'] ?? '',
      windSpeed: response.current_units['wind_speed_10m'] ?? '',
      precipitation: response.current_units['precipitation'] ?? '',
    },
    current: {
      time: current.time,
      temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      precipitation: current.precipitation,
      windSpeed: current.wind_speed_10m,
      windDirection: current.wind_direction_10m,
      isDay: current.is_day === 1,
      weatherCode: current.weather_code,
      conditions: describeWeatherCode(current.weather_code),
    },
    daily: daily.time.map((date, i) => {
      const weatherCode = daily.weather_code[i] ?? undefined;
      return {
        date,
        conditions: weatherCode === undefined ? 'Unknown' : describeWeatherCode(weatherCode),
        weatherCode,
        temperatureMax: daily.temperature_2m_max[i] ?? undefined,
        temperatureMin: daily.temperature_2m_min[i] ?? undefined,
        precipitationSum: daily.precipitation_sum[i] ?? undefined,
        precipitationProbabilityMax: daily.precipitation_probability_max[i] ?? undefined,
        sunrise: daily.sunrise[i] ?? '',
        sunset: daily.sunset[i] ?? '',
      };
    }),
  };
}

export const getForecast = defineTool({
  name: 'get_forecast',
  title: 'Get forecast',
  description:
    'Current weather conditions and a daily forecast for a coordinate. ' +
    'Use search_places first to turn a place name into latitude and longitude.',
  inputSchema: z.object({
    latitude: z.number().min(-90).max(90).describe('Latitude in decimal degrees (-90 to 90).'),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe('Longitude in decimal degrees (-180 to 180).'),
    days: z
      .number()
      .int()
      .min(1)
      .max(16)
      .default(3)
      .describe('Number of forecast days including today (1-16).'),
    units: temperatureUnitSchema,
  }),
  outputSchema: forecastOutputSchema,

  async execute(input) {
    return mapForecast(await forecast(input));
  },

  summarize({ location, units, current, daily }) {
    const t = units.temperature;
    const header =
      `Now at (${location.latitude}, ${location.longitude}) [${location.timezone}]: ` +
      `${current.temperature}${t} (feels like ${current.apparentTemperature}${t}), ${current.conditions}, ` +
      `humidity ${current.humidity}%, wind ${current.windSpeed} ${units.windSpeed}.`;
    const days = daily.map((day) => {
      const range =
        day.temperatureMin !== undefined && day.temperatureMax !== undefined
          ? `${day.temperatureMin} to ${day.temperatureMax}${t}`
          : 'temperature n/a';
      const rain =
        day.precipitationSum !== undefined
          ? `${day.precipitationSum} ${units.precipitation}` +
            (day.precipitationProbabilityMax !== undefined
              ? ` (${day.precipitationProbabilityMax}% chance)`
              : '')
          : 'precipitation n/a';
      return `- ${day.date}: ${day.conditions}, ${range}, ${rain}`;
    });
    return [header, ...days].join('\n');
  },
});
