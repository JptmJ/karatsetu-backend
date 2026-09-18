# KaratSetu Backend

Multi-tenant backend for jewellery manufacturers and retailers.
Node.js · TypeScript · PostgreSQL · Express 5.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for how it is built and why.

---

## Getting started

```bash
npm install
cp .env.example .env      # paste your DATABASE_URL
npm run db:sync           # create/update the tables
npm run db:seed           # a demo tenant you can log into
npm run dev
```

Then:

```bash
curl -s localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"tenantCode":"demo","email":"owner@demo.test","password":"demo12345"}'
```

### One database requirement

The app must **not** connect as a Postgres superuser — superusers bypass Row
Level Security, which is what keeps tenants apart. Create a dedicated role:

```sql
CREATE ROLE karatsetu_app LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT ALL ON DATABASE your_db TO karatsetu_app;
GRANT ALL ON SCHEMA public TO karatsetu_app;
ALTER SCHEMA public OWNER TO karatsetu_app;
```

Postgres 15 or newer (uses `UNIQUE NULLS NOT DISTINCT`).

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Sync the schema, then serve on :4000 with reload |
| `npm run db:plan` | Show what the next boot would change. Changes nothing. |
| `npm run db:sync` | Apply schema changes without starting the server |
| `npm run db:seed` | Create a demo tenant (`-- --code=x --email=y --password=z`) |
| `npm test` | Run the test suite |
| `npm run typecheck` | Type-check without emitting |
| `npm run build` | Compile to `dist/` |

---

## Layout

```
src/
  core/                    machinery every module uses
    db/
      schema/              ← the self-updating schema engine
        types.ts             what a table definition looks like
        columns.ts           col.money(), col.weight(), col.fk()...
        registry.ts          the list of every table
        introspect.ts        read the real database
        diff.ts              compare, and rate each change by risk
        sync.ts              apply what is safe, refuse what is not
      client.ts            tenant-scoped transactions
      repository.ts        insert/update/find without boilerplate
    config/                the settings engine (Module 12.1)
    context/               who is making this request
    http/                  auth, permissions, validation, errors
    util/                  decimal maths, ids, logging

  modules/
    tenancy/               tenants and which modules they see
    identity/              users, roles, sign-in
    masters/               branch, party, item, purity, rates (Module 10)
    numbering/             document numbering (Module 4.3)
    accounts/              dual ledger (Module 9)
    inventory/             stock journal and balances (Module 3)
    pricing/               weights → money, config-driven
    purchase/              Module 5.1
    sales/                 Module 5.2

  bootstrap.ts             imports every module → registry is complete
  app.ts                   routes
  server.ts                boot: connect → sync schema → listen
```

---

## Adding a module

1. Write `src/modules/<name>/<name>.schema.ts` using `defineTable`
2. Add one import line to `src/bootstrap.ts`
3. Write the service and routes, wire the router into `app.ts`
4. Restart — the tables appear

No migration files. The database is brought in line with the code on boot.

---

## Environment

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Required |
| `DATABASE_SSL` | `false` | `true`, `false`, or `no-verify` for managed providers |
| `SCHEMA_SYNC_MODE` | `safe` | `off` · `verify` · `safe` · `force` — use **`verify`** in production |
| `JWT_SECRET` | — | Required, 16+ characters |
| `PORT` | `4000` | |

---

## API

| Method | Path | Permission |
|---|---|---|
| `POST` | `/api/auth/login` | — |
| `POST` | `/api/auth/refresh` | — |
| `GET` | `/api/tenancy/modules` | any signed-in user |
| `GET` `PUT` | `/api/settings/config` | `settings.config.*` |
| `GET` `POST` `PATCH` `DELETE` | `/api/masters/{branches,parties,items,purities}` | `masters.*` |
| `GET` `POST` | `/api/masters/rates` | `settings.rates.*` |
| `POST` | `/api/purchase/invoices` | `trade.purchase.create` |
| `POST` | `/api/purchase/invoices/:id/post` | `trade.purchase.post` |
| `POST` | `/api/purchase/invoices/:id/cancel` | `trade.purchase.cancel` |
| `POST` | `/api/sales/invoices` | `trade.sales.create` |
| `POST` | `/api/sales/invoices/:id/post` | `trade.sales.post` |
| `POST` | `/api/sales/invoices/:id/cancel` | `trade.sales.cancel` |
| `GET` | `/api/inventory/balances` | `stock.*.view` |
| `GET` | `/api/inventory/movements` | `stock.*.view` |

Send `Authorization: Bearer <token>`, and optionally `X-Branch-Id` to act at a
specific branch.
