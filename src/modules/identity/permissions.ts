/**
 * Permission strings are dotted paths: `module.submodule.action`.
 * A role holding `trade.*` covers everything under trade; `*` covers everything.
 */
export const ACTIONS = ['view', 'create', 'update', 'delete', 'post', 'cancel', 'approve'] as const;
export type Action = (typeof ACTIONS)[number];

export function hasPermission(held: Set<string>, needed: string): boolean {
  if (held.has('*') || held.has(needed)) return true;

  const parts = needed.split('.');
  for (let i = parts.length; i > 0; i--) {
    if (held.has(`${parts.slice(0, i - 1).concat('*').join('.')}`)) return true;
  }
  return false;
}
