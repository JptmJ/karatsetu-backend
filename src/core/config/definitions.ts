/**
 * Every setting the application will ever read, declared in one place.
 *
 * A setting declared here gets, for free: a type, validation, a default, and a
 * row in the settings UI. Code never reads a raw string out of a table — it
 * calls `config.get('sales.rounding.invoice_total')` and gets a typed value.
 */
import { z } from 'zod';

/** Where a value may be overridden. Later levels win over earlier ones. */
export type ConfigScope = 'system' | 'tenant' | 'branch';

export interface ConfigDefinition<T = unknown> {
  key: string;
  /** Groups settings into screens: "units", "sales", "purchase", "gst"... */
  group: string;
  label: string;
  description: string;
  schema: z.ZodType<T>;
  default: T;
  /** The deepest level at which this may be overridden. */
  scope: ConfigScope;
  /** Changing this rewrites how past numbers are interpreted — warn loudly. */
  sensitive?: boolean;
}

const definitions = new Map<string, ConfigDefinition>();

export function defineConfig<T>(def: ConfigDefinition<T>): ConfigDefinition<T> {
  if (definitions.has(def.key)) throw new Error(`Config key "${def.key}" is defined twice`);
  definitions.set(def.key, def as ConfigDefinition);
  return def;
}

export const allConfigDefinitions = (): ConfigDefinition[] => [...definitions.values()];
export const getConfigDefinition = (key: string): ConfigDefinition | undefined => definitions.get(key);

/* ------------------------------------------------------------------ */
/* The starting set. Modules add their own as they are built.          */
/* ------------------------------------------------------------------ */

export const CONFIG = {
  /* --- units & measurement (Module 12.1) --- */
  weightUnit: defineConfig({
    key: 'units.weight.display',
    group: 'units',
    label: 'Weight unit shown on screen',
    description:
      'Weights are always stored in grams. This only changes what staff see and type.',
    schema: z.enum(['gram', 'tola', 'kilo', 'carat']),
    default: 'gram' as const,
    scope: 'tenant',
  }),
  tolaInGrams: defineConfig({
    key: 'units.weight.tola_in_grams',
    group: 'units',
    label: 'Grams per tola',
    description: 'The Indian standard is 11.6638 g. Some regions round it to 11.664.',
    schema: z.string(),
    default: '11.6638',
    scope: 'tenant',
  }),
  weightDecimals: defineConfig({
    key: 'units.weight.decimals',
    group: 'units',
    label: 'Decimal places for weight',
    description: 'How many decimals to show and round to on documents.',
    schema: z.number().int().min(0).max(6),
    default: 3,
    scope: 'tenant',
  }),
  purityFormat: defineConfig({
    key: 'units.purity.format',
    group: 'units',
    label: 'Purity display',
    description: 'Show purity as karat (22K) or as a percentage (91.60%).',
    schema: z.enum(['karat', 'percent', 'both']),
    default: 'karat' as const,
    scope: 'tenant',
  }),
  currencyDecimals: defineConfig({
    key: 'units.currency.decimals',
    group: 'units',
    label: 'Decimal places for money',
    description: 'Indian invoices normally use 2.',
    schema: z.number().int().min(0).max(4),
    default: 2,
    scope: 'tenant',
  }),

  /* --- pricing --- */
  makingChargeBasis: defineConfig({
    key: 'pricing.making_charge.basis',
    group: 'pricing',
    label: 'How making charges are calculated',
    description:
      'per_gram = rate x weight, percent = percentage of metal value, flat = a fixed amount per piece.',
    schema: z.enum(['per_gram', 'percent', 'flat']),
    default: 'per_gram' as const,
    scope: 'tenant',
  }),
  makingChargeOnGross: defineConfig({
    key: 'pricing.making_charge.on_gross_weight',
    group: 'pricing',
    label: 'Charge making on gross weight',
    description:
      'On means stones are included in the weight that making is charged on. Off means net metal weight only.',
    schema: z.boolean(),
    default: true,
    scope: 'tenant',
  }),
  wastageBasis: defineConfig({
    key: 'pricing.wastage.basis',
    group: 'pricing',
    label: 'How wastage is calculated',
    description: 'percent of metal weight, or a fixed number of grams per piece.',
    schema: z.enum(['percent', 'per_gram', 'none']),
    default: 'percent' as const,
    scope: 'tenant',
  }),
  rateRounding: defineConfig({
    key: 'pricing.rounding.line_total',
    group: 'pricing',
    label: 'Rounding on each line',
    description: 'Applied to every line before the invoice is totalled.',
    schema: z.enum(['none', 'nearest_1', 'nearest_10']),
    default: 'none' as const,
    scope: 'tenant',
  }),
  invoiceRounding: defineConfig({
    key: 'pricing.rounding.invoice_total',
    group: 'pricing',
    label: 'Rounding on the invoice total',
    description: 'The difference is posted to a "round off" account.',
    schema: z.enum(['none', 'nearest_1', 'nearest_10']),
    default: 'nearest_1' as const,
    scope: 'tenant',
  }),

  /* --- tax (Module 12.1) --- */
  gstEnabled: defineConfig({
    key: 'tax.gst.enabled',
    group: 'tax',
    label: 'GST applies',
    description: 'Turn off only for tenants outside India or below the threshold.',
    schema: z.boolean(),
    default: true,
    scope: 'tenant',
  }),
  gstOnMaking: defineConfig({
    key: 'tax.gst.making_charge_treatment',
    group: 'tax',
    label: 'GST on making charges',
    description:
      'composite = one 3% rate on the whole jewellery value; separate = 3% on metal and 5% on making.',
    schema: z.enum(['composite', 'separate']),
    default: 'composite' as const,
    scope: 'tenant',
    sensitive: true,
  }),
  gstMetalRate: defineConfig({
    key: 'tax.gst.metal_rate_percent',
    group: 'tax',
    label: 'GST rate on jewellery',
    description: 'Currently 3% in India.',
    schema: z.string(),
    default: '3',
    scope: 'tenant',
  }),
  gstMakingRate: defineConfig({
    key: 'tax.gst.making_rate_percent',
    group: 'tax',
    label: 'GST rate on making charges',
    description: 'Only used when making charges are taxed separately.',
    schema: z.string(),
    default: '5',
    scope: 'tenant',
  }),

  /* --- documents --- */
  allowBackdating: defineConfig({
    key: 'documents.allow_backdating',
    group: 'documents',
    label: 'Allow back-dated documents',
    description: 'Off means a document can never be dated before today.',
    schema: z.boolean(),
    default: false,
    scope: 'tenant',
  }),
  negativeStock: defineConfig({
    key: 'inventory.allow_negative_stock',
    group: 'inventory',
    label: 'Allow selling stock you do not have',
    description:
      'Off is strongly recommended. On is occasionally needed while opening balances are still being entered.',
    schema: z.boolean(),
    default: false,
    scope: 'branch',
  }),
  stockValuation: defineConfig({
    key: 'inventory.valuation_method',
    group: 'inventory',
    label: 'How stock is valued',
    description: 'Weighted average is the usual choice for metal; FIFO suits tagged pieces.',
    schema: z.enum(['weighted_average', 'fifo']),
    default: 'weighted_average' as const,
    scope: 'tenant',
    sensitive: true,
  }),
} as const;
