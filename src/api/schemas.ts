/**
 * Shared request/response pieces.
 *
 * Every schema here is used twice: once to validate the real request, once to
 * render the field table in /dev-docs. `.describe()` text becomes the "Notes"
 * column, so it is worth writing for a frontend developer rather than for
 * yourself.
 */
import { z } from 'zod';

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Money and weight travel as strings so no value is ever rounded by JavaScript. */
export const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Send numbers as strings, e.g. "6500.00"');

export const money = decimal.describe('Rupees, as a string. Never a float.');
export const weight = decimal.describe('Grams, as a string.');

export const phone = z
  .string()
  .regex(/^[0-9+\-\s]{10,15}$/, 'Enter a valid 10–15 digit phone number');

export const gstin = z
  .string()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/, 'GSTIN format is invalid');

export const pan = z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN format is invalid');

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idParam = z.object({ id: uuid });

/** The envelope every error uses. Documented once, referenced everywhere. */
export const errorEnvelope = z.object({
  error: z.object({
    code: z.string().describe('Stable machine code. Switch on this, never on message.'),
    message: z.string().describe('Human-readable. May be reworded at any time.'),
    details: z.unknown().optional().describe('Shape depends on code — see the error table.'),
    requestId: z.string().optional().describe('Quote this when reporting a problem.'),
  }),
});

/** A standard list response. */
export const listOf = <T extends z.ZodType>(row: T) =>
  z.object({
    rows: z.array(row),
    total: z.number().int().optional(),
    limit: z.number().int().optional(),
    offset: z.number().int().optional(),
  });

export const ok = z.object({ ok: z.boolean() });

/** Rows come back with whatever columns the table has; documented per endpoint. */
export const record = z.record(z.string(), z.unknown());
