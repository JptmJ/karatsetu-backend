# Swarnay — Code & Database Structure

A plain-language tour of how the backend is laid out and what each table is for.
For the full column-by-column reference, see **[DATABASE.md](DATABASE.md)** —
that file is generated from the code, so it is never out of date.

---

## The three applications

| | What it is | Runs on | Who uses it |
|---|---|---|---|
| **Backend** | The API and the database. Everything else talks to this. | `:4000` | — |
| **Super Admin panel** | Next.js. Creates tenants, their Admin, branches and licences. | `:4100` | Platform operators |
| **ERP frontend** | The jewellery ERP itself. | Vercel | Shop staff |

---

## Backend layout

```
src/
  core/                  machinery every module uses
    db/
      schema/            ← the self-updating schema engine
        types.ts           what a table definition looks like
        columns.ts         col.money(), col.weight(), col.fk(), col.enum()
        registry.ts        the list of every table; adds tenant_id + audit columns
        introspect.ts      reads what the database actually looks like
        diff.ts            compares the two, rates each change safe/warn/stop
        sync.ts            applies what is safe, refuses what is not
        document.ts        the shared shape of every invoice/order/receipt
      client.ts          tenant-scoped transactions (this is where RLS is pinned)
      repository.ts      insert/update/find without the boilerplate
      pool.ts            connection pool; numeric and date stay strings here
    config/              the settings engine — declare once, override per tenant/branch
    context/             who is making this request (AsyncLocalStorage)
    http/
      middleware.ts      auth, permissions, validation, error shaping
      route-registry.ts  ← one declaration → route + docs + client
    docs/                /dev-docs renderer and the error catalogue
    util/                decimal maths, uuid v7, logging

  modules/               one folder per business area
    platform/            super admin: operators, roles, tenant provisioning
    tenancy/             tenants, module catalog, licences
    identity/            tenant users, sign-in
    master/…             see the table map below
    orders/  pricing/  inventory/  tagging/
    purchase/ sales/  accounts/  oldgold/  schemes/  girvi/  karigar/

  api/                   the HTTP surface, grouped by area
    schemas.ts           shared request pieces (money, weight, uuid, pagination)
    crud.ts              builds the five standard master endpoints
    routes.*.ts          every endpoint, declared via defineRoute()

  cli/                   db:plan · db:sync · db:seed · gen:client · gen:docs
  bootstrap.ts           imports every module — this is what makes the registry complete
  app.ts                 routers, CORS, /dev-docs, /health
  server.ts              boot: connect → sync schema → listen
```

### The three ideas worth understanding

**1. The database follows the code.** Tables are declared in `*.schema.ts`. On
boot the app reads the real database, compares, and applies what is safe.
Adding is automatic; dropping and rewriting are refused. You never write a
migration file.

**2. One declaration per endpoint.** `defineRoute()` feeds the live route,
`/dev-docs`, and the generated TypeScript client together. They cannot drift.

**3. Tenant isolation is the database's job.** Every business table carries
`tenant_id` with Row Level Security *forced* on. A query that forgets to filter
returns nothing rather than someone else's data.

---

## The tables, by what they are for

### Who can sign in

| Table | What it holds |
|---|---|
| `platform_user` | Platform operators. **No tenant** — they run the platform. One row today, the super admin, seeded from the CLI and never creatable through the API. |
| `platform_refresh_token` | Their sessions. |
| `platform_audit_log` | Every super-admin action: who created which tenant, when. |
| `tenant` | One row per jewellery business. Everything else points here. |
| `app_user` | Staff inside a business. |
| `role` / `user_role` | Seeded per business from the fixed templates in code. `user_role` says who holds which, and at which branch. |
| `refresh_token` | Staff sessions. |
| `audit_log` | Actions inside one tenant. `support_session_id` is set when an operator did it. |
| `support_session` | A time-boxed window where an operator can see into a tenant. Holds the session token’s hash; checked on every request. |

### What the business is set up as

| Table | What it holds |
|---|---|
| `tenant_module` | Which modules a tenant has, and on what licence (included / purchased / trial / expired). |
| `tenant_theme` | Which of the five themes they use, plus any CSS overrides. |
| `feature_flag` | Platform flags, optionally targeted at one tenant. |
| `config_value` | Per-tenant and per-branch setting overrides. |
| `numbering_series` | How each document type is numbered (`INV/2026-27/00001`). |
| `numbering_gap` | Numbers issued but never used — GST wants gaps explained. |
| `dashboard_layout` | Each user's saved widget arrangement. |

### Reference data (Master / Rate Hub)

| Table | What it holds |
|---|---|
| `branch` | A physical location. Stock always sits at a branch. |
| `stock_location` | Counter, vault, window, factory floor — inside a branch. |
| `metal` / `purity` | Gold, silver, platinum and their finenesses (22K = 91.6%). |
| `item_category` | Rings, necklaces, bangles… |
| `item` | The product master. `tracking` decides pieces vs grams. |
| `party` | Customers **and** suppliers in one table — the same firm is often both. |
| `karigar` | Goldsmiths, with their agreed ghat (metal loss) allowance. |
| `karigar_ledger` | Metal issued to and returned by each karigar, and the wages. |
| `metal_rate` | The daily broadcast rate. Never edited — a new rate is a new row. |

### Stock

| Table | What it holds |
|---|---|
| `stock_piece` | One row per physically tagged item, with its HUID and weights. |
| `stock_movement` | **Append-only.** Every gram in or out, and why. |
| `stock_balance` | A running total, kept in step with the journal. Rebuildable. |
| `tag_template` / `tag_print_job` / `tag_print_job_item` | Label layouts and the thermal printer queue. |
| `huid_assignment` | The history of BIS hallmark IDs on a piece. |

### Selling and buying

| Table | What it holds |
|---|---|
| `sales_invoice` + `_line` | Counter, wholesale and export billing. |
| `sales_payment` | One row per tender — a sale is often cash + UPI + old gold. |
| `sales_return` + `_line` | Customer returns. |
| `purchase_order` + `_line` | What we asked a supplier for. |
| `goods_receipt` + `_line` | What actually arrived. This raises stock. |
| `purchase_invoice` + `_line` | What we owe. This moves the ledger. |
| `purchase_return` + `_line` | Return to vendor. |

### Orders

| Table | What it holds |
|---|---|
| `retail_order` | All five types — booking, custom, repair, wedding, corporate. |
| `order_line` | A wedding order mixes ready stock and made-to-order, line by line. |
| `order_pipeline` | Per-type Kanban stages. Each type has its own sequence. |
| `order_stage_event` | The timeline. Every move, forward or backward, with its reason. |
| `order_attachment` | Reference images, repair condition photos. |
| `order_acknowledgement` | The customer's signature or OTP at repair intake. |
| `order_payment` | Advances and tokens taken before billing. |
| `order_communication` | Messages sent to the customer. |

### Old gold

| Table | What it holds |
|---|---|
| `old_gold_intake` | The appraisal voucher for one customer visit. |
| `old_gold_item` | Each article: gross, stones, dirt, solder, XRF reading, fine weight. |
| `melt_batch` | Scrap sent for melting, and what came back. Closes metal reconciliation. |

### Schemes and loans

| Table | What it holds |
|---|---|
| `scheme_plan` | The savings product: tenure, installment, bonus rules. |
| `scheme_account` | One customer enrolled in one scheme. |
| `scheme_installment` | The whole schedule, written at enrollment. |
| `scheme_redemption` | Turning a matured account into jewellery. |
| `girvi_loan` | The pawn agreement — LTV, interest, vault packet. |
| `girvi_collateral` | The articles held against it. |
| `girvi_accrual` | One row per interest period. Written once, never recalculated. |
| `girvi_repayment` | Money back in. Interest clears before principal. |

### The books

| Table | What it holds |
|---|---|
| `account` | Chart of accounts. |
| `voucher` | One per posted document. Both ledgers hang off it. |
| `ledger_entry` | The money side. Debits and credits in rupees. |
| `metal_ledger_entry` | The metal side. In and out in **fine grams**. |

---

## Who can do what

```
Super Admin ──creates──► Tenant (a jewellery shop)
             ──creates──► its branches
             ──creates──► every user in every branch
```

**There is exactly one super admin.** It is seeded by `npm run seed:superadmin`
and there is no endpoint that creates another — the account that can reach every
tenant on the platform should not be something a form can multiply.

**Only the super admin manages users.** Nobody inside a jewellery business can
create, promote or deactivate anyone, not even a branch admin. Two reasons:
every account stays traceable to one person, and a compromised shop account
cannot mint more shop accounts. A branch admin can *see* their staff list
(`GET /api/settings/users`) and nothing more — the write endpoints do not exist.

**A branch has exactly one admin.** Either each branch has its own, or a single
admin covers all of them. Both shapes are allowed, and they can be mixed: a
business may have one all-branches admin plus a dedicated admin at a busy
branch.

This is enforced in `assertBranchAdminFree` (platform provisioning), not by a
database constraint. It cannot be an index: the rule spans `user_role` rows and
treats a null branch as *all* branches rather than *no* branch, and "all
branches" has to collide with every branch at once. An earlier version of this
document described a partial unique index that was never built; the check is the
only thing holding the rule, so it has to stay on every path that assigns a
role.

## Roles

One platform operator, and three kinds of role inside a business. A platform
token is refused by every tenant route and a tenant token by every platform
route, so the only way from the console into a business's data is a support
session.

### The platform operator

One role, `super_admin`, holding `*`. One account, seeded by
`npm run seed:superadmin`, never creatable through the API — the account that
reaches every tenant is not something a form should be able to multiply. Routes
still declare a `permission:` for documentation; `*` satisfies all of them, and
a test asserts it.

### Inside a business

| Kind | Code | What it is | Limit |
|---|---|---|---|
| **Owner** | `owner` | The proprietor. Everything, every branch. | One per branch |
| **Branch Admin** | `admin` | Runs a branch: billing, orders, stock, old gold, rates, reports, and the shop's own branch list. Can switch a staff account off. | One per branch |
| **Staff** | *(named per business)* | Everyone else. Named and given permissions per business. | — |

Only `owner` and `admin` are seeded, from `TENANT_ROLES`. **Staff roles are not
templates.** The super admin names one per business and ticks exactly what it
reaches, because one shop's "Accountant" handles billing and another's handles
billing and tagging — a fixed ladder cannot express that, and guessing a seeded
set would be a guess about how that shop is run.

`role.role_type` says which kind a row is. Owner and admin are refused edits:
narrowing an owner would lock a shop out of its own books, and an admin that
cannot run a branch is not an admin.

A user holds one role, through a `user_role` row carrying the branch it applies
at. Only the super admin assigns it. The only admin in a business cannot be
deactivated: the shop would be left with nobody able to run it.

### What a staff role may be given

`permissionTree()` arranges the permission catalog as module → group → action,
and the console's role builder ticks it. It is built from the live routes, so it
cannot offer a switch the API does not enforce — the thing that would otherwise
turn the builder into a screen of decorative toggles. Ticking a whole module
grants its wildcard (`pos.*`) rather than every leaf, so a role granted "all of
Billing" still means that when billing endpoints are added later.

`app_user.role_code` is a dead column. It once held a fixed role name and is now
plain text; roles live in `user_role`.

## Branches

One path, `tenancy/branch.service.ts`, used by the console and by the shop's own
Masters screen alike. There used to be two, and they disagreed: the console
seeded a branch's stock locations and the Masters screen did not, so a branch
added from inside the business had nowhere to put stock and its first sale would
have failed.

A branch arrives with the locations its kind needs — Counter, Vault and Window
for a showroom; Vault and Production Floor for a factory. Numbering needs
nothing: a business's series are shared across branches, and split per branch
only when the number format contains `{BRANCH}`.

`tenant.max_branches` is how many that business may have, as sold. Null means no
limit, which is where every tenant starts. It is checked on both paths, counts
branches that still exist including deactivated ones — otherwise a shop could
park a branch to reclaim the slot — and a limit below the current count is
allowed, which stops further additions without closing a branch they trade from.

## Support sessions

The one path from a platform operator to a tenant's data, since a platform token
reaches no tenant route. `POST /api/platform/support-sessions` mints a third kind
of token — `scope: 'support'`, handled by `authenticateSupport` — and the
session row is re-read on every request, so closing a session locks the operator
out at once instead of whenever the token would lapse. Read-only is the default
and refuses anything that is not a GET; writing needs `platform.support.write`.

An operator has no `app_user` row, so the session supplies a stand-in identity
(`supportAccess`) for `/api/me` and the services below it, while `ctx.userId`
stays null and every audit row carries `support_session_id` instead.

## Conventions

- **Money** is `numeric(20,4)`, **weight** is `numeric(16,6)` grams. Never floats;
  they travel as strings in JSON.
- **Fine weight** means pure metal: 10g of 22K is 9.16g fine. That is the number
  the ledger adds up.
- **Dates** are plain `YYYY-MM-DD` strings, never JS `Date` objects.
- **Posted documents are read-only.** Corrections are reversing documents.
- **Journals are append-only** — `stock_movement`, `ledger_entry`,
  `metal_ledger_entry`, `girvi_accrual`, `order_stage_event`.
