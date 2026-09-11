// Builds a form from a tool's JSON schema. Flat schemas only.
import { useState, type FormEvent } from 'react';
import {
  buildArguments,
  initialValues,
  type FieldValue,
  type InputSchema,
  type PropertySchema,
} from './form-args.ts';

export type { InputSchema, PropertySchema } from './form-args.ts';

interface Props {
  schema: InputSchema;
  busy: boolean;
  onSubmit: (args: Record<string, unknown>) => void;
}

export function ToolForm({ schema, busy, onSubmit }: Props) {
  const [values, setValues] = useState(() => initialValues(schema));
  const properties = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(buildArguments(schema, values));
  }

  function set(name: string, value: FieldValue) {
    setValues((previous) => ({ ...previous, [name]: value }));
  }

  return (
    <form onSubmit={handleSubmit}>
      {properties.map(([name, property]) => (
        <label key={name}>
          <code>
            {name}
            {required.has(name) ? ' *' : ''}
          </code>
          {property.description && <span>{property.description}</span>}
          <Field
            name={name}
            property={property}
            required={required.has(name)}
            value={values[name] ?? ''}
            onChange={set}
          />
        </label>
      ))}
      <button type="submit" disabled={busy}>
        {busy ? 'Calling…' : 'Call tool'}
      </button>
    </form>
  );
}

interface FieldProps {
  name: string;
  property: PropertySchema;
  required: boolean;
  value: FieldValue;
  onChange: (name: string, value: FieldValue) => void;
}

function Field({ name, property, required, value, onChange }: FieldProps) {
  if (property.enum) {
    return (
      <select value={String(value)} onChange={(e) => onChange(name, e.target.value)}>
        {property.enum.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (property.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(name, e.target.checked)}
      />
    );
  }
  if (property.type === 'number' || property.type === 'integer') {
    return (
      <input
        type="number"
        required={required}
        value={String(value)}
        min={property.minimum}
        max={property.maximum}
        step={property.type === 'integer' ? 1 : 'any'}
        onChange={(e) => onChange(name, e.target.value)}
      />
    );
  }
  if (property.type === 'array') {
    return (
      <textarea
        required={required}
        rows={3}
        value={String(value)}
        placeholder={'One per line, e.g.\nParis, France\nParis, Texas'}
        onChange={(e) => onChange(name, e.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      required={required}
      value={String(value)}
      onChange={(e) => onChange(name, e.target.value)}
    />
  );
}
