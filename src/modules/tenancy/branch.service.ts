/**
 * Creating a branch — one way, used by everyone.
 *
 * There used to be two. The console seeded a branch's stock locations; the
 * shop's own Masters screen did not, so a branch added from inside the business
 * had nowhere to put stock and the first sale at that branch would fail. They
 * also disagreed on field names and on which rules applied. Both now call this.
 *
 * What a branch needs to actually work:
 *   - its stock locations, which depend on what kind of branch it is
 *   - a code nothing else in the business is using
 *   - room under the business's branch limit
 *
 * Numbering needs nothing here: the business's series are shared across
 * branches, and only split per branch when the number format contains {BRANCH}.
 */
import type { Tx } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { BusinessRuleError, ConflictError } from '../../core/errors/app-error.js';

export type BranchKind = 'showroom' | 'factory' | 'warehouse' | 'office';

export interface BranchInput {
  code: string;
  name: string;
  kind?: BranchKind;
  gstin?: string | null;
  stateCode?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  is_head_office?: boolean;
}

/**
 * Where stock can sit at this branch. A factory counts metal on the production
 * floor; a showroom counts it at the counter and in the window.
 */
const LOCATIONS: Record<BranchKind, Array<{ code: string; name: string; kind: string; is_default: boolean }>> = {
  factory: [
    { code: 'VAULT', name: 'Vault', kind: 'vault', is_default: true },
    { code: 'FLOOR', name: 'Production Floor', kind: 'floor', is_default: false },
  ],
  showroom: [
    { code: 'COUNTER', name: 'Counter', kind: 'counter', is_default: true },
    { code: 'VAULT', name: 'Vault', kind: 'vault', is_default: false },
    { code: 'WINDOW', name: 'Display Window', kind: 'window', is_default: false },
  ],
  warehouse: [{ code: 'VAULT', name: 'Vault', kind: 'vault', is_default: true }],
  office: [{ code: 'VAULT', name: 'Vault', kind: 'vault', is_default: true }],
};

/** The first two digits of a GSTIN are the state. */
export const stateFromGstin = (gstin?: string | null): string | null =>
  gstin && gstin.length >= 2 ? gstin.slice(0, 2) : null;

/**
 * Refuses a branch the business has not paid for.
 *
 * Counts branches that still exist, including deactivated ones: a shop should
 * not be able to park a branch and claim the slot back. A tenant with no limit
 * set is unlimited, which is where every business starts.
 */
export async function assertBranchAllowance(tx: Tx): Promise<void> {
  const row = await tx.maybeOne<{ max_branches: number | null; used: number }>(
    `select t.max_branches,
            (select count(*)::int from branch b
              where b.tenant_id = t.id and b.deleted_at is null) as used
       from tenant t where t.id = $1`,
    [tx.context.tenantId],
  );
  if (!row || row.max_branches === null) return;

  if (row.used >= row.max_branches) {
    throw new BusinessRuleError(
      row.max_branches === 1
        ? 'This plan covers one branch. Contact Swarnay to add another.'
        : `This plan covers ${row.max_branches} branches and all ${row.used} are in use. Contact Swarnay to add another.`,
      'branch_limit_reached',
    );
  }
}

/** A branch with no locations cannot hold stock, so this always runs with one. */
export async function seedBranchLocations(tx: Tx, branchId: string, kind: BranchKind = 'showroom'): Promise<void> {
  for (const location of LOCATIONS[kind] ?? LOCATIONS.showroom) {
    await repo(tx, 'stock_location').insert({ branch_id: branchId, ...location, is_active: true });
  }
}

/** Refuses a code another branch in the business already holds. */
export async function assertBranchCodeFree(tx: Tx, code: string, exceptId?: string): Promise<void> {
  const clash = await tx.maybeOne<{ id: string }>(
    `select id from branch
      where lower(code) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2)`,
    [code, exceptId ?? null]);
  if (clash) throw new ConflictError(`A branch with code "${code}" already exists.`);
}

/**
 * Creates the branch and everything it needs to trade. Runs inside the caller's
 * tenant transaction, so it rolls back as one if anything downstream fails.
 *
 * The shop's own Masters screen goes through `defineCrud` rather than calling
 * this, but reaches the same three steps through its hooks — allowance and code
 * check before the insert, locations after it.
 */
export async function createBranchWithLocations(tx: Tx, input: BranchInput): Promise<{ id: string }> {
  await assertBranchAllowance(tx);
  await assertBranchCodeFree(tx, input.code);

  const kind: BranchKind = input.kind ?? 'showroom';

  const branch = await repo<{ id: string }>(tx, 'branch').insert({
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    kind,
    gstin: input.gstin ?? null,
    // Taken from the GSTIN when there is one, so the two can never disagree.
    state_code: stateFromGstin(input.gstin) ?? input.stateCode ?? null,
    address_line1: input.address_line1 ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    pincode: input.pincode ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    is_head_office: input.is_head_office ?? false,
    is_active: true,
  });

  await seedBranchLocations(tx, branch.id, kind);
  return branch;
}
