import { Prisma } from '@prisma/client';

   
                                                                              
                                                                                
                                                                                  
   
export function toSkillApiJson<T>(value: T): T {
  return normalizeApiValue(value, new WeakMap<object, unknown>()) as T;
}

   
                                                                         
                                                                  
                                                  
   
export function toSkillPrismaJson(value: unknown): Prisma.InputJsonValue {
  return normalizePrismaValue(value, new WeakMap<object, unknown>()) as Prisma.InputJsonValue;
}

function normalizeApiValue(
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === 'bigint') return value.toString(10);
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;

  const cached = seen.get(value);
  if (cached !== undefined) return cached;

  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const item of value) output.push(normalizeApiValue(item, seen));
    return output;
  }

  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, item] of Object.entries(value)) {
    output[key] = normalizeApiValue(item, seen);
  }
  return output;
}

function normalizePrismaValue(
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === 'bigint') return value.toString(10);
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (typeof value !== 'object') return value;

  const cached = seen.get(value);
  if (cached !== undefined) return cached;

  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const item of value) output.push(normalizePrismaValue(item, seen));
    return output;
  }

  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, item] of Object.entries(value)) {
    output[key] = normalizePrismaValue(item, seen);
  }
  return output;
}
