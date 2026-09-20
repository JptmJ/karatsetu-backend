# RatnaGrid — Code & Database Structure

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
| `platform_user` | The single super admin. **No tenant** — they run the platform. Seeded from the CLI, never creatable through the API. |
| `platform_refresh_token` | Their sessions. |
| `platform_audit_log` | Every super-admin action: who created which tenant, when. |
| `tenant` | One row per jewellery business. Everything else points here. |
| `app_user` | Staff inside a business. |
| *(roles)* | Not a table — the four roles live in code, and `app_user.role_code` says which one a person holds. |
| `refresh_token` | Staff sessions. |
| `audit_log` | Actions inside one tenant. |
| `support_session` | A time-boxed window where an operator can see into a tenant. |

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

This is enforced by a partial unique index rather than a service check, so it
holds even against a direct `INSERT`:

```sql
unique index ux_app_user_one_admin_per_branch
  on app_user (tenant_id, default_branch_id) nulls not distinct
  where role_code = 'admin' and is_active = true and deleted_at is null
```

`nulls not distinct` is what makes the all-branches slot (a null branch) collide
with itself, so one index covers both halves of the rule.

### The four roles

| Role | Code | What they do | Limit |
|---|---|---|---|
| **Branch Admin** | `admin` | Runs a branch: billing, orders, stock, old gold, rates, reports, settings. | One per branch |
| **Sales Executive** | `sales` | Bills customers, books orders, takes old gold in. | — |
| **Accountant** | `accountant` | Books, GST, reports. Read-only on operations. | — |
| **Store Keeper** | `storekeeper` | Receives goods, tags pieces, moves stock. | — |

Roles live in code, not in a table. A user holds exactly one, stored as
`app_user.role_code` — which is what makes the one-admin-per-branch rule
expressible as a constraint at all.

The only admin in a business cannot be deactivated: the shop would be left with
nobody able to run it.

## Conventions

- **Money** is `numeric(20,4)`, **weight** is `numeric(16,6)` grams. Never floats;
  they travel as strings in JSON.
- **Fine weight** means pure metal: 10g of 22K is 9.16g fine. That is the number
  the ledger adds up.
- **Dates** are plain `YYYY-MM-DD` strings, never JS `Date` objects.
- **Posted documents are read-only.** Corrections are reversing documents.
- **Journals are append-only** — `stock_movement`, `ledger_entry`,
  `metal_ledger_entry`, `girvi_accrual`, `order_stage_event`.
