/**
 * `npm run seed:superadmin` — creates or resets the one super admin.
 *
 * There is exactly one, and it exists only because of this command. The API has
 * no endpoint that creates a platform operator: the account that can reach
 * every tenant on the platform should not be something a form can multiply.
 *
 * Running it again resets the password and clears any lockout, which is the
 * intended recovery path if the password is lost.
 */
import '../bootstrap.js';
import { closePool, checkConnection, pool } from '../core/db/pool.js';
import { asPlatform } from '../core/db/client.js';
import { syncSchema } from '../core/db/schema/sync.js';
import { hashPassword } from '../modules/identity/auth.service.js';
import { SUPER_ADMIN } from '../modules/platform/roles.js';
import { newId } from '../core/util/id.js';

const DEFAULT_EMAIL = 's.admin@ratnagrid.com';
const DEFAULT_NAME = 'Super Admin';

const arg = (name: string, fallback?: string): string | undefined => {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};

async function main(): Promise<void> {
  const email = (arg('email', DEFAULT_EMAIL) as string).toLowerCase();
  const password = arg('password') ?? process.env.SUPER_ADMIN_PASSWORD;
  const name = arg('name', DEFAULT_NAME) as string;

  if (!password) {
    console.error(`
The password is required.

  npm run seed:superadmin -- --password='...'
  SUPER_ADMIN_PASSWORD='...' npm run seed:superadmin

Defaults to ${DEFAULT_EMAIL}; override with --email=.
`);
    process.exitCode = 1;
    return;
  }

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
        [existing.id, passwordHash, name, SUPER_ADMIN.code]);
      console.log(`\nReset the password for ${email}.`);
    } else {
      await tx.query(
        `insert into platform_user (id, email, full_name, password_hash, role, is_active)
         values ($1, $2, $3, $4, $5, true)`,
        [newId(), email, name, passwordHash, SUPER_ADMIN.code]);
      console.log(`\nCreated ${email}.`);
    }

    // Any other operator is left over from the old multi-operator model. There
    // is one super admin now, so the rest are retired rather than left as live
    // credentials into every tenant on the platform.
    const others = await tx.query<{ email: string }>(
      `update platform_user set is_active = false, deleted_at = now(), updated_at = now()
        where lower(email) <> lower($1) and deleted_at is null
        returning email`, [email]);

    if (others.length > 0) {
      console.log(`\nRetired ${others.length} other operator account${others.length === 1 ? '' : 's'}:`);
      for (const o of others) console.log(`  ${o.email}`);
      console.log('  (deactivated — there is only one super admin now)');
    }

    console.log(`
  email  ${email}
  role   ${SUPER_ADMIN.name}

  curl -s $BACKEND/api/platform/auth/login \\
    -H 'content-type: application/json' \\
    -d '{"email":"${email}","password":"..."}'
`);
  });
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(closePool);
