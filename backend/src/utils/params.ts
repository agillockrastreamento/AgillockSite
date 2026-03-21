import { Request } from 'express';

// req.params em Express v5 é string | string[], mas na prática route params são sempre strings
export function param(req: Request, key: string): string {
  const val = req.params[key];
  return Array.isArray(val) ? val[0] : (val ?? '');
}

// req.query pode ser qualquer coisa — extrai o primeiro valor como string
export function query(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (Array.isArray(val)) return val.length > 0 ? String(val[0]) : undefined;
  if (typeof val === 'object') return undefined;
  return String(val);
}
