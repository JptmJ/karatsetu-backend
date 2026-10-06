/**
 * `npm run seed:superadmin` — creates or resets a platform operator.
 *
 * Operators exist only because of this command. The API has no endpoint that
 * creates one: the account that can reach every tenant on the platform should
 * not be something a form can multiply.
 *
 * Running it again for the same email resets the password and clears any
 * lockout, which is the intended recovery path if the password is lost.
 *
 *   npm run seed:superadmin -- --password='...'
 *   npm run seed:superadmin -- --role=support_engineer --email=asha@… --password='...'
 *
 * There is exactly one `super_admin`, so seeding one retires any other. The
 * three lower roles are defined and enforceable but have no account until one is
 * made here, and seeding them leaves the super admin alone.
 */
import '../bootstrap.js';
import { closePool, checkConnection, pool } from '../core/db/pool.js';
import { asPlatform } from '../core/db/client.js';
import { syncSchema } from '../core/db/schema/sync.js';
import { hashPassword } from '../modules/identity/auth.service.js';
import { PLATFORM_ROLE_CODES, platformRole, SUPER_ADMIN } from '../modules/platform/roles.js';
import { newId } from '../core/util/id.js';

const DEFAULT_EMAIL = 's.admin@swarnay.com';
const DEFAULT_NAME = 'Super Admin';

const arg = (name: string, fallback?: string): string | undefined => {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};

async function main(): Promise<void> {
  const email = (arg('email', DEFAULT_EMAIL) as string).toLowerCase();
  const password = arg('password') ?? process.env.SUPER_ADMIN_PASSWORD;
  const roleCode = arg('role', SUPER_ADMIN.code) as string;

  if (!password) {
    console.error(`
The password is required.

  npm run seed:superadmin -- --password='...'
  SUPER_ADMIN_PASSWORD='...' npm run seed:superadmin

Defaults to ${DEFAULT_EMAIL}; override with --email=.
Pass --role= to seed one of the other platform roles:
  ${PLATFORM_ROLE_CODES.join(', ')}
`);
    process.exitCode = 1;
    return;
  }

  const role = platformRole(roleCode);
  if (!role) {
    console.error(`\n"${roleCode}" is not a platform role. Pick one of: ${PLATFORM_ROLE_CODES.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const isSuperAdmin = roleCode === SUPER_ADMIN.code;
  const name = arg('name', isSuperAdmin ? DEFAULT_NAME : role.name) as string;

  await checkConnection();
  await syncSchema(pool, 'safe');

  await asPlatform(async (tx) => {
    const passwordHash = await hashPassword(password);

    const existing = await tx.maybeOne<{ id: string; email: string }>(
      `select id, email from platform_user where lower(email) = lower($1)`, [email]);

    if (existing) {
      await tx.query(
        `update platform_user
            set password_hash = $2, full_name = $3, role = $4, is_active = true,
                failed_login_count = 0, locked_until = null, deleted_at = null, updated_at = now()
          where id = $1`,
        [existing.id, passwordHash, name, roleCode]);
      console.log(`\nReset the password for ${email}.`);
    } else {
      await tx.query(
        `insert into platform_user (id, email, full_name, password_hash, role, is_active)
         values ($1, $2, $3, $4, $5, true)`,
        [newId(), email, name, passwordHash, roleCode]);
      console.log(`\nCreated ${email}.`);
    }

    /*
     * There is one super admin. Seeding it retires any *other* super admin,
     * which is what clears out accounts left over from the old multi-operator
     * model rather than leaving live credentials into every tenant.
     *
     * Support, sales and billing operators are deliberately untouched: they are
     * meant to coexist, and retiring them here would make adding a teammate
     * undo itself the next time a password was reset.
     */
    if (isSuperAdmin) {
      const others = await tx.query<{ email: string }>(
        `update platform_user set is_active = false, deleted_at = now(), updated_at = now()
          where lower(email) <> lower($1) and role = $2 and deleted_at is null
          returning email`, [email, SUPER_ADMIN.code]);

      if (others.length > 0) {
        console.log(`\nRetired ${others.length} other super admin account${others.length === 1 ? '' : 's'}:`);
        for (const o of others) console.log(`  ${o.email}`);
        console.log('  (deactivated — there is only one super admin)');
      }
    }

    console.log(`
  email  ${email}
  role   ${role.name}
  grants ${role.permissions.join(', ')}

  curl -s $BACKEND/api/platform/auth/login \\
    -H 'content-type: application/json' \\
    -d '{"email":"${email}","password":"..."}'
`);
  });
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(closePool);
