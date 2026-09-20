import { Injectable } from '@nestjs/common';
import { ToolError } from '../toolstypes';

type Schema = Record<string, unknown>;

type Issue = { path: string; message: string };

@Injectable()
export class ToolSchemaValidatorService {
  validate(schema: object | undefined, value: unknown, label: 'input' | 'output'): void {
    if (!schema) return;
    const issues: Issue[] = [];
    this.visit(schema as Schema, value, '$', issues, 0);
    if (issues.length > 0) {
      throw new ToolError(
        label === 'input' ? 'INVALID_ARGUMENTS' : 'INVALID_TOOL_OUTPUT',
        `${label} schema validation failed`,
        { issues: issues.slice(0, 20) },
      );
    }
  }

  private visit(schema: Schema, value: unknown, path: string, issues: Issue[], depth: number): void {
    if (depth > 32) {
      issues.push({ path, message: 'schema nesting exceeds the supported depth' });
      return;
    }
    if (Array.isArray(schema.allOf)) {
      for (const item of schema.allOf) this.visit(item as Schema, value, path, issues, depth + 1);
    }
    if (Array.isArray(schema.anyOf)) {
      if (!schema.anyOf.some((item) => this.matches(item as Schema, value, depth + 1))) {
        issues.push({ path, message: 'does not match any allowed schema' });
      }
      return;
    }
    if (Array.isArray(schema.oneOf)) {
      const matches = schema.oneOf.filter((item) => this.matches(item as Schema, value, depth + 1)).length;
      if (matches !== 1) issues.push({ path, message: 'must match exactly one allowed schema' });
      return;
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
      issues.push({ path, message: 'must be one of the allowed values' });
      return;
    }
    if ('const' in schema && !Object.is(schema.const, value)) {
      issues.push({ path, message: 'must equal the required constant' });
      return;
    }

    const types = Array.isArray(schema.type) ? schema.type.map(String) : schema.type ? [String(schema.type)] : [];
    if (types.length > 0 && !types.some((type) => this.isType(type, value))) {
      issues.push({ path, message: `must be ${types.join(' or ')}` });
      return;
    }

    if (typeof value === 'string') {
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) issues.push({ path, message: `must contain at least ${schema.minLength} characters` });
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) issues.push({ path, message: `must contain no more than ${schema.maxLength} characters` });
      if (typeof schema.pattern === 'string') {
        try {
          if (!new RegExp(schema.pattern).test(value)) issues.push({ path, message: 'does not match the required pattern' });
        } catch {
          issues.push({ path, message: 'tool schema contains an invalid pattern' });
        }
      }
    }

    if (typeof value === 'number') {
      if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push({ path, message: `must be at least ${schema.minimum}` });
      if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push({ path, message: `must be no more than ${schema.maximum}` });
    }

    if (Array.isArray(value)) {
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) issues.push({ path, message: `must contain at least ${schema.minItems} items` });
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) issues.push({ path, message: `must contain no more than ${schema.maxItems} items` });
      if (schema.items && typeof schema.items === 'object') {
        value.forEach((item, index) => this.visit(schema.items as Schema, item, `${path}[${index}]`, issues, depth + 1));
      }
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties as Record<string, Schema> : {};
      const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
      for (const key of required) {
        if (!(key in record)) issues.push({ path: `${path}.${key}`, message: 'is required' });
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in properties)) issues.push({ path: `${path}.${key}`, message: 'is not an allowed property' });
        }
      }
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in record) this.visit(childSchema, record[key], `${path}.${key}`, issues, depth + 1);
      }
    }
  }

  private matches(schema: Schema, value: unknown, depth: number): boolean {
    const issues: Issue[] = [];
    this.visit(schema, value, '$', issues, depth);
    return issues.length === 0;
  }

  private isType(type: string, value: unknown): boolean {
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === type;
  }
}
