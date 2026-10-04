import { contract } from '../../generation/generated/typescript/contract.js';
import { SdkError } from './errors.js';

interface Schema {
  $ref?: string;
  type?: string;
  nullable?: boolean;
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
}
interface Operation {
  operationId: string;
  parameters?: { name: string; required?: boolean; schema: Schema }[];
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}
const schemas = contract.schemas as unknown as Record<string, Schema>;
export const operations = Object.values(contract.paths).flatMap((p) =>
  Object.values(p),
) as unknown as Operation[];

function invalid(path: string): never {
  throw new SdkError('validation', path + ' is invalid');
}
export function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function validDateTime(value: string): boolean {
  const match =
    /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.exec(
      value,
    );
  if (!match || match[0] !== value) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Date.parse normalizes impossible dates instead of rejecting them.
  return day <= days[month - 1]! && Number.isFinite(Date.parse(value));
}

// Only the schema features present in the pinned transport contract are evaluated.
function validate(schema: Schema, value: unknown, path: string): void {
  if (schema.$ref) return validate(schemas[schema.$ref.split('/').at(-1)!]!, value, path);
  if (value === null) {
    if (schema.nullable) return;
    invalid(path);
  }
  if (schema.enum && !schema.enum.includes(value)) invalid(path);
  if (schema.oneOf) {
    let matches = 0;
    for (const branch of schema.oneOf) {
      try {
        validate(branch, value, path);
        matches++;
      } catch (error) {
        if (!(error instanceof SdkError)) throw error;
      }
    }
    if (matches !== 1) invalid(path);
  }
  switch (schema.type) {
    case 'object': {
      if (!object(value)) invalid(path);
      for (const required of schema.required ?? [])
        if (value[required] === undefined) invalid(path + '.' + required);
      for (const [key, child] of Object.entries(value)) {
        const field = schema.properties?.[key];
        if (field) {
          if (child !== undefined) validate(field, child, path + '.' + key);
        } else if (schema.additionalProperties === false) invalid(path);
        else if (object(schema.additionalProperties))
          validate(schema.additionalProperties as Schema, child, path);
      }
      break;
    }
    case 'array':
      if (
        !Array.isArray(value) ||
        (schema.maxItems !== undefined && value.length > schema.maxItems)
      )
        invalid(path);
      for (const item of value) if (schema.items) validate(schema.items, item, path + '[]');
      break;
    case 'string':
      if (typeof value !== 'string') invalid(path);
      if (schema.minLength !== undefined || schema.maxLength !== undefined) {
        let length = 0;
        // OpenAPI length limits count code points, not UTF-16 code units.
        for (let index = 0; index < value.length;) {
          index += value.codePointAt(index)! > 0xffff ? 2 : 1;
          length++;
          if (schema.maxLength !== undefined && length > schema.maxLength) invalid(path);
        }
        if (schema.minLength !== undefined && length < schema.minLength) invalid(path);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) invalid(path);
      if (schema.format === 'date-time' && !validDateTime(value)) invalid(path);
      break;
    case 'integer':
    case 'number':
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (schema.type === 'integer' && !Number.isInteger(value))
      )
        invalid(path);
      if (
        schema.minimum !== undefined &&
        (schema.exclusiveMinimum ? value <= schema.minimum : value < schema.minimum)
      )
        invalid(path);
      if (
        schema.maximum !== undefined &&
        (schema.exclusiveMaximum ? value >= schema.maximum : value > schema.maximum)
      )
        invalid(path);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') invalid(path);
      break;
  }
}
export function validateModel(name: string, value: unknown): void {
  validate(schemas[name]!, value, 'input');
}
export function validateParameters(operation: string, value: Record<string, unknown>): void {
  const parameters = operations.find((op) => op.operationId === operation)!.parameters ?? [];
  const allowed = new Set(parameters.map((parameter) => parameter.name));
  // The generated request object includes the body alongside path/query parameters.
  if (operation === 'createBundleGrant') allowed.add('createGrantRequest');
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid('input');
  for (const p of parameters) {
    const field = value[p.name];
    if (field !== undefined) validate(p.schema, field, 'input.' + p.name);
    else if (p.required) invalid('input.' + p.name);
  }
}
export function validateResponse(operation: string, value: unknown): void {
  const schema = operations.find((op) => op.operationId === operation)!.responses['200']!.content![
    'application/json'
  ]!.schema;
  try {
    validate(schema, value, 'response');
  } catch {
    throw new SdkError('protocol', 'The server returned an incompatible response');
  }
}
