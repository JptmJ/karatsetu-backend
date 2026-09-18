/**
 * Every error code the API can return, in one list.
 *
 * The frontend switches on `error.code`, never on the message — messages are
 * written for humans and will be reworded; codes are a contract.
 */
export interface ErrorSpec {
  code: string;
  status: number;
  meaning: string;
  /** What the frontend should actually do about it. */
  frontendAction: string;
}

export const ERROR_CATALOG: ErrorSpec[] = [
  { code: 'validation_error', status: 400, meaning: 'One or more fields failed validation.',
    frontendAction: 'Read `error.details[]` — each entry has `field` and `message`. Show them inline on the form.' },
  { code: 'unauthorized', status: 401, meaning: 'No token, or the token has expired.',
    frontendAction: 'Try the refresh endpoint once; if that also fails, send the user to sign in.' },
  { code: 'forbidden', status: 403, meaning: 'Signed in, but lacks the permission for this action.',
    frontendAction: 'Hide or disable the control. The message names the permission required.' },
  { code: 'module_locked', status: 403, meaning: 'The tenant does not hold a valid licence for this module.',
    frontendAction: 'Show the upgrade/renew prompt. `error.details.licence` gives the current state.' },
  { code: 'not_found', status: 404, meaning: 'The record does not exist, or belongs to another tenant.',
    frontendAction: 'Show an empty state. Do not retry.' },
  { code: 'duplicate', status: 409, meaning: 'A unique constraint was violated — usually a repeated code or number.',
    frontendAction: 'Point at the field the user most likely repeated (code, phone, invoice number).' },
  { code: 'in_use', status: 409, meaning: 'The record is referenced elsewhere and cannot be removed.',
    frontendAction: 'Offer deactivation instead of deletion.' },
  { code: 'conflict', status: 409, meaning: 'The record changed since it was loaded.',
    frontendAction: 'Reload the record and ask the user to re-apply their change.' },
  { code: 'busy', status: 409, meaning: 'Two operations collided in the database.',
    frontendAction: 'Retry once automatically. Only surface it if the retry also fails.' },
  { code: 'check_failed', status: 422, meaning: 'A database rule rejected the values.',
    frontendAction: 'Treat as a validation error; the message names the rule.' },
  { code: 'business_rule', status: 422, meaning: 'Understood, but refused by a business rule.',
    frontendAction: 'Show the message as-is. It is written for the person at the counter.' },
  { code: 'insufficient_stock', status: 422, meaning: 'Not enough stock at that location.',
    frontendAction: '`error.details` carries `available` and `requested`. Show both.' },
  { code: 'rate_missing', status: 422, meaning: 'No metal rate is set for that purity today.',
    frontendAction: 'Send the user to the Rate Hub. Block billing until a rate exists.' },
  { code: 'numbering_series_missing', status: 422, meaning: 'No document numbering series is configured.',
    frontendAction: 'Send an admin to Settings → Numbering.' },
  { code: 'already_posted', status: 422, meaning: 'The document is already posted and is now read-only.',
    frontendAction: 'Reload. Offer cancel-and-reissue rather than edit.' },
  { code: 'backdating_not_allowed', status: 422, meaning: 'Back-dated documents are switched off for this tenant.',
    frontendAction: 'Reset the date picker to today and explain why.' },
  { code: 'invalid_stage_move', status: 422, meaning: 'That stage does not exist in this order type’s pipeline.',
    frontendAction: 'Refresh the pipeline from `GET /api/orders/pipelines`.' },
  { code: 'internal_error', status: 500, meaning: 'An unhandled failure. Already logged with the request id.',
    frontendAction: 'Show a generic failure message and surface `error.requestId` for support.' },
];
