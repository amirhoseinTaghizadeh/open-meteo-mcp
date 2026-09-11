import { describe, expect, it } from 'vitest';
import { buildArguments, initialValues, type InputSchema } from './form-args.ts';

const schema: InputSchema = {
  properties: {
    query: { type: 'string' },
    count: { type: 'integer', default: 5 },
    units: { type: 'string', enum: ['celsius', 'fahrenheit'], default: 'celsius' },
    places: { type: 'array', items: { type: 'string' } },
    verbose: { type: 'boolean', default: false },
  },
  required: ['query'],
};

describe('initialValues', () => {
  it('pre-fills defaults as text and leaves the rest empty', () => {
    expect(initialValues(schema)).toEqual({
      query: '',
      count: '5',
      units: 'celsius',
      places: '',
      verbose: false,
    });
  });
});

describe('buildArguments', () => {
  it('omits untouched fields so server-side defaults apply', () => {
    const values = { ...initialValues(schema), query: 'Lisbon', count: '', units: '' };
    expect(buildArguments(schema, values)).toEqual({ query: 'Lisbon', verbose: false });
  });

  it('never sends "" or NaN for an empty number, and a checkbox is always a boolean', () => {
    expect(buildArguments(schema, { query: '', count: '   ' })).toEqual({ verbose: false });
  });

  it('converts numbers and splits arrays one item per line, keeping commas inside items', () => {
    const values = { query: 'x', count: '3', places: ' Paris, France \n\nParis, Texas\n' };
    expect(buildArguments(schema, values)).toEqual({
      query: 'x',
      count: 3,
      places: ['Paris, France', 'Paris, Texas'],
      verbose: false,
    });
  });
});
