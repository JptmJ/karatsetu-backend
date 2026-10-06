/**
 * `npm run db:migrate-role-types` — moves existing businesses onto the
 * owner / admin / staff model.
 *
 * Three things happen, per tenant:
 *
 *   1. `owner` and `admin` get their `role_type`. Everything else defaults to
 *      `staff`, which is already right for any role a shop defined itself.
 *   2. The four retired templates — sales, cashier, accountant, storekeeper —
 *      are deleted, along with the assignments holding people to them. Those
 *      people keep their accounts and can sign in; they reach nothing until a
 *      staff role is made for them, which is the deliberate choice here rather
 *      than guessing a replacement.
 *   3. Anyone left with no role at all is reported, so they can be picked up in
 *      the console rather than discovered by a confused shopkeeper.
 *
 * Safe to re-run: every step is idempotent. Pass --dry-run to see the damage
 * before doing it.
 */
import '../bootstrap.js';
import { closePool, checkConnection, pool } from '../core/db/pool.js';
import { asPlatform } from '../core/db/client.js';
import { syncSchema } from '../core/db/schema/sync.js';
import { ADMIN_ROLE, OWNER_ROLE } from '../modules/platform/roles.js';

/** Replaced by staff roles named per business. */
const RETIRED = ['sales', 'cashier', 'accountant', 'storekeeper'];

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  await checkConnection();
  if (!dryRun) await syncSchema(pool, 'safe');

  await asPlatform(async (tx) => {
    const doomed = await tx.query<{ tenant: string; role: string; holders: number }>(
      `select t.code as tenant, r.code as role,
              (select count(distinct ur.user_id)::int
                 from user_role ur join app_user u on u.id = ur.user_id and u.deleted_at is null
                where ur.role_id = r.id) as holders
         from role r join tenant t on t.id = r.tenant_id
        where r.code = any($1::text[]) and r.deleted_at is null
        order by t.code, r.code`,
      [RETIRED]);

    console.log(`\nRetired roles found: ${doomed.length}`);
    for (const d of doomed) {
      console.log(`  ${d.tenant.padEnd(12)} ${d.role.padEnd(13)} ${d.holders} holder(s)`);
    }

    if (dryRun) {
      console.log('\n--dry-run: nothing changed.\n');
      return;
    }

    // 1. Type the two templates. Anything else is staff, which is the default.
    const typed = await tx.query<{ code: string }>(
      `update role set role_type = case code when $1 then 'owner' else 'admin' end, updated_at = now()
        where code in ($1, $2) and deleted_at is null and role_type <> case code when $1 then 'owner' else 'admin' end
        returning code`,
      [OWNER_ROLE, ADMIN_ROLE]);
    console.log(`\nTyped ${typed.length} owner/admin role row(s).`);

    // 2. Unassign, then delete. Assignments first, or the FK blocks the delete.
    const unassigned = await tx.query<{ user_id: string }>(
      `delete from user_role where role_id in
         (select id from role where code = any($1::text[]) and deleted_at is null)
       returning user_id`, [RETIRED]);

    await tx.query(
      `delete from role_permission where role_id in
         (select id from role where code = any($1::text[]) and deleted_at is null)`, [RETIRED]);

    const deleted = await tx.query<{ id: string }>(
      `update role set deleted_at = now(), updated_at = now()
        where code = any($1::text[]) and deleted_at is null returning id`, [RETIRED]);

    console.log(`Removed ${deleted.length} role(s) and ${unassigned.length} assignment(s).`);

    // Their tokens still carry the old grants until they turn over.
    if (unassigned.length) {
      await tx.query(
        `update app_user set token_version = token_version + 1 where id = any($1::uuid[])`,
        [unassigned.map((u) => u.user_id)]);
    }

    // 3. Who is now holding nothing.
    const stranded = await tx.query<{ tenant: string; email: string; full_name: string }>(
      `select t.code as tenant, coalesce(u.email, u.phone, '(no contact)') as email, u.full_name
         from app_user u join tenant t on t.id = u.tenant_id
        where u.deleted_at is null and u.is_active
          and not exists (select 1 from user_role ur where ur.user_id = u.id)
        order by t.code, u.full_name`);

    if (stranded.length) {
      console.log(`\n${stranded.length} active user(s) now hold no role. Give them one in the console:`);
      for (const s of stranded) console.log(`  ${s.tenant.padEnd(12)} ${s.full_name} <${s.email}>`);
    } else {
      console.log('\nEveryone still holds a role.');
    }
    console.log();
  });
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(closePool);
