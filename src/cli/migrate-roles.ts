/**
 * `npm run migrate:roles` — one-off move to the new role model.
 *
 * Before: a user's role came from `user_role` → `role`, several were possible,
 * and a tenant could have any number of owners and managers.
 *
 * After: one `role_code` on `app_user`, four fixed roles, and a branch has
 * exactly one admin.
 *
 * Order matters. The unique index cannot be created while duplicate admins
 * exist, so this backfills and resolves collisions first, then hands over to
 * the schema sync to add the constraint.
 *
 * Safe to run twice — every step checks before acting.
 */
import '../bootstrap.js';
import { closePool, checkConnection, pool } from '../core/db/pool.js';
import { asPlatform } from '../core/db/client.js';
import { syncSchema } from '../core/db/schema/sync.js';
import { logger } from '../core/util/logger.js';

/** Old role code → new one. `owner` and `manager` both become the branch admin. */
const ROLE_MAP: Record<string, string> = {
  owner: 'admin',
  manager: 'admin',
  admin: 'admin',
  sales: 'sales',
  accountant: 'accountant',
  storekeeper: 'storekeeper',
  support: 'sales',
};

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  await checkConnection();

  // Adds app_user.role_code (nullable-safe: it has a default) but NOT yet the
  // unique index, because duplicates still exist at this point.
  console.log('\n1. Adding the new column…');
  await syncSchema(pool, 'safe');

  await asPlatform(async (tx) => {
    const hasOldTables = await tx.maybeOne<{ n: string }>(
      `select count(*)::text n from information_schema.tables
        where table_schema = current_schema() and table_name = 'user_role'`);

    if (Number(hasOldTables?.n ?? 0) === 0) {
      console.log('2. user_role is already gone — nothing to migrate.');
      return;
    }

    /*
     * 2. Work out every user's final role before writing a single row.
     *
     * The unique index already exists by this point, so a plain backfill would
     * insert a violating state and fail halfway. Demotions have to be decided
     * up front and each user written once, with the value they keep.
     */
    console.log('2. Working out the new roles…');

    const users = await tx.query<{
      id: string; tenant_id: string; tenant_code: string; email: string; full_name: string;
      default_branch_id: string | null; branch_code: string | null;
      old_role: string | null; is_active: boolean; created_at: string;
    }>(
      `select u.id, u.tenant_id, t.code as tenant_code, u.email, u.full_name,
              u.default_branch_id, b.code as branch_code, u.is_active, u.created_at,
              (select r.code from user_role ur join role r on r.id = ur.role_id
                where ur.user_id = u.id order by r.code limit 1) as old_role
         from app_user u
         join tenant t on t.id = u.tenant_id
         left join branch b on b.id = u.default_branch_id
        where u.deleted_at is null
        order by u.created_at`);

    const target = new Map<string, string>();
    for (const u of users) target.set(u.id, ROLE_MAP[u.old_role ?? ''] ?? 'sales');

    /*
     * 3. One admin per branch. `tenant_id + branch` is the slot; a null branch
     * is the all-branches slot and counts as one. The earliest-created admin
     * keeps it — that is the account the shop has actually been using. The rest
     * become Sales rather than being deleted, so their logins keep working.
     */
    console.log('3. Resolving branches with more than one admin…');
    const slots = new Map<string, typeof users[number]>();
    let demoted = 0;

    for (const u of users) {
      if (target.get(u.id) !== 'admin' || !u.is_active) continue;
      const slot = `${u.tenant_id}::${u.default_branch_id ?? 'ALL'}`;
      const holder = slots.get(slot);

      if (!holder) {
        slots.set(slot, u);
        continue;
      }
      target.set(u.id, 'sales');
      demoted++;
      const where = u.branch_code ?? 'ALL BRANCHES';
      console.log(`   ${u.tenant_code}/${where}: ${u.full_name} <${u.email}> → sales`);
      console.log(`      (${holder.full_name} <${holder.email}> keeps the slot)`);
    }
    if (demoted === 0) console.log('   none — every branch had at most one admin.');

    /* ---------------- 4. write ---------------- */
    const changes = users.filter((u) => target.get(u.id) !== 'sales' || u.old_role);
    console.log(`4. Writing ${changes.length} role${changes.length === 1 ? '' : 's'}…`);

    for (const u of users) {
      const role = target.get(u.id)!;
      const where = u.branch_code ?? 'all branches';
      console.log(`   ${(u.old_role ?? '-').padEnd(12)} → ${role.padEnd(12)} ${u.email} (${where})`);
      if (!DRY_RUN) {
        await tx.query(`update app_user set role_code = $2, updated_at = now() where id = $1`, [u.id, role]);
      }
    }

    /* ---------------- 5. drop the old tables ---------------- */
    if (DRY_RUN) {
      console.log('5. Would drop user_role and role.');
    } else {
      console.log('5. Dropping user_role and role…');
      await tx.query(`drop table if exists user_role`);
      await tx.query(`drop table if exists role`);
    }
  });

  if (DRY_RUN) {
    console.log('\nDry run — nothing was changed. Re-run without --dry-run to apply.\n');
    return;
  }

  // Re-run so the diff notices the dropped tables and settles.
  console.log('6. Settling the schema…');
  const result = await syncSchema(pool, 'safe');
  if (result.skipped.length > 0) {
    console.error('\nSome changes still failed:');
    for (const c of result.skipped) console.error(`   ${c.description}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nDone. Roles are now on app_user, and each branch has one admin.\n');
}

main()
  .catch((error) => { logger.error({ err: error }, 'Migration failed'); process.exitCode = 1; })
  .finally(closePool);
