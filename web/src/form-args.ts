// Form state <-> tool arguments. No React in here so it's easy to test.
// Empty fields are left out of the arguments so the server defaults apply.

export interface PropertySchema {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: { type?: string };
}

export interface InputSchema {
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

export type FieldValue = string | boolean;
export type FieldValues = Record<string, FieldValue>;

export const ARRAY_SEPARATOR = '\n';

export function initialValues(schema: InputSchema): FieldValues {
  const values: FieldValues = {};
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (property.type === 'boolean') values[name] = property.default === true;
    else if (Array.isArray(property.default)) values[name] = property.default.join(ARRAY_SEPARATOR);
    else values[name] = text(property.default);
  }
  return values;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function toArgument(property: PropertySchema, value: FieldValue): unknown {
  if (property.type === 'boolean') return value === true;
  const text = String(value).trim();
  if (text === '') return undefined;
  if (property.type === 'number' || property.type === 'integer') return Number(text);
  if (property.type === 'array') {
    return text
      .split(ARRAY_SEPARATOR)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return text;
}

export function buildArguments(schema: InputSchema, values: FieldValues): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const argument = toArgument(property, values[name] ?? '');
    if (argument !== undefined) args[name] = argument;
  }
  return args;
}
