# KaratSetu / RatnaGrid — Database Architecture & Data Dictionary

Comprehensive Technical Reference of all Database Tables and Columns.

- **Total Database Tables:** 68
- **Total Columns:** 1504
- **Functional Modules:** 18
- **Generated On:** 2026-09-25
- **Database Engine:** PostgreSQL (Supabase / Self-Hosted) with Row-Level Security (RLS)

---

## 1. Executive Summary & Architecture Overview

The backend uses a modular schema definition registry where every table is strongly typed and automatically configured with multi-tenancy, RLS (Row-Level Security) isolation, and audit timestamps.

### Architectural Conventions
1. **Multi-Tenancy Isolation (`tenant_id`):**
   - 62 out of 68 tables are **tenant-scoped**, automatically including a foreign key `tenant_id` referencing the `tenant` table.
   - Isolation is strictly enforced at the PostgreSQL level via Row Level Security policies (`current_tenant_id()`).
   - Tenant tables have composite indexes and unique keys automatically prefixed with `tenant_id`.
   - Only 6 platform/operator tables (`tenant`, `platform_user`, `platform_refresh_token`, `platform_audit_log`, `feature_flag`, `support_session`) are global.
2. **Deterministic Identifiers (`id`):**
   - Primary keys use **UUID v7** (`uuid`), providing time-sortable 128-bit globally unique IDs.
3. **Audit Tracking:**
   - Every audited table includes `created_at` (timestamptz), `updated_at` (timestamptz), `created_by` (uuid referencing `app_user`), and `updated_by` (uuid referencing `app_user`).
4. **Soft Deletes (`deleted_at`):**
   - Master data and core financial entities support soft deletion via nullable `deleted_at` timestamps.
5. **High Precision Numeric Types:**
   - **Monetary amounts:** `numeric(20,4)` (stored as exact decimals, never floating-point).
   - **Precious metal weights:** `numeric(16,6)` (grams down to micrograms).
   - **Metal purity:** `numeric(7,3)` (percentage purity).
   - **Exchange & metal rates:** `numeric(14,6)`.

---

## 2. Master Table Index by Module

| # | Module | Module Title | Tables | Total Columns | Table Names |
|---|---|---|:---:|:---:|---|
| 1 | `core` | **Core & System Configuration** | 1 | 10 | [`config_value`](#table-config-value) |
| 2 | `tenancy` | **Multi-Tenancy & Organizations** | 1 | 18 | [`tenant`](#table-tenant) |
| 3 | `platform` | **Platform Administration & SaaS Operator** | 6 | 74 | [`feature_flag`](#table-feature-flag), [`platform_audit_log`](#table-platform-audit-log), [`platform_refresh_token`](#table-platform-refresh-token), [`platform_user`](#table-platform-user), [`support_session`](#table-support-session), [`tenant_module`](#table-tenant-module) |
| 4 | `settings` | **Theme & Custom Settings** | 1 | 13 | [`tenant_theme`](#table-tenant-theme) |
| 5 | `dashboard` | **Business Dashboard & Widgets** | 1 | 10 | [`dashboard_layout`](#table-dashboard-layout) |
| 6 | `identity` | **Identity, Authentication & Audit** | 3 | 40 | [`app_user`](#table-app-user), [`audit_log`](#table-audit-log), [`refresh_token`](#table-refresh-token) |
| 7 | `masters` | **Master Data & Reference Catalogs** | 8 | 133 | [`branch`](#table-branch), [`item`](#table-item), [`item_category`](#table-item-category), [`metal`](#table-metal), [`metal_rate`](#table-metal-rate), [`party`](#table-party), [`purity`](#table-purity), [`stock_location`](#table-stock-location) |
| 8 | `numbering` | **Document Numbering & Sequences** | 2 | 25 | [`numbering_gap`](#table-numbering-gap), [`numbering_series`](#table-numbering-series) |
| 9 | `accounts` | **Financial & Dual-Metal Accounting Ledgers** | 4 | 65 | [`account`](#table-account), [`ledger_entry`](#table-ledger-entry), [`metal_ledger_entry`](#table-metal-ledger-entry), [`voucher`](#table-voucher) |
| 10 | `inventory` | **Stock Management & Vault Balances** | 3 | 67 | [`stock_balance`](#table-stock-balance), [`stock_movement`](#table-stock-movement), [`stock_piece`](#table-stock-piece) |
| 11 | `tagging` | **Jewellery Tagging, Barcoding & HUID** | 4 | 59 | [`huid_assignment`](#table-huid-assignment), [`tag_print_job`](#table-tag-print-job), [`tag_print_job_item`](#table-tag-print-job-item), [`tag_template`](#table-tag-template) |
| 12 | `purchase` | **Procurement & Purchase Invoices** | 8 | 307 | [`goods_receipt`](#table-goods-receipt), [`goods_receipt_line`](#table-goods-receipt-line), [`purchase_invoice`](#table-purchase-invoice), [`purchase_invoice_line`](#table-purchase-invoice-line), [`purchase_order`](#table-purchase-order), [`purchase_order_line`](#table-purchase-order-line), [`purchase_return`](#table-purchase-return), [`purchase_return_line`](#table-purchase-return-line) |
| 13 | `sales` | **Point of Sale (POS) & Sales Invoicing** | 5 | 180 | [`sales_invoice`](#table-sales-invoice), [`sales_invoice_line`](#table-sales-invoice-line), [`sales_payment`](#table-sales-payment), [`sales_return`](#table-sales-return), [`sales_return_line`](#table-sales-return-line) |
| 14 | `orders` | **Custom Jewellery Orders & Pipelines** | 8 | 171 | [`order_acknowledgement`](#table-order-acknowledgement), [`order_attachment`](#table-order-attachment), [`order_communication`](#table-order-communication), [`order_line`](#table-order-line), [`order_payment`](#table-order-payment), [`order_pipeline`](#table-order-pipeline), [`order_stage_event`](#table-order-stage-event), [`retail_order`](#table-retail-order) |
| 15 | `oldgold` | **Old Gold Exchange & Melting Batches** | 3 | 84 | [`melt_batch`](#table-melt-batch), [`old_gold_intake`](#table-old-gold-intake), [`old_gold_item`](#table-old-gold-item) |
| 16 | `schemes` | **Chit Funds & Gold Savings Schemes (Swarna Nidhi)** | 4 | 98 | [`scheme_account`](#table-scheme-account), [`scheme_installment`](#table-scheme-installment), [`scheme_plan`](#table-scheme-plan), [`scheme_redemption`](#table-scheme-redemption) |
| 17 | `girvi` | **Mortgage & Girvi Pawn Loans** | 4 | 108 | [`girvi_accrual`](#table-girvi-accrual), [`girvi_collateral`](#table-girvi-collateral), [`girvi_loan`](#table-girvi-loan), [`girvi_repayment`](#table-girvi-repayment) |
| 18 | `master` | **Karigar / Artisan Management** | 2 | 42 | [`karigar`](#table-karigar), [`karigar_ledger`](#table-karigar-ledger) |

---

## 3. Alphabetical Table Directory

| # | Table Name | Module | Columns | Tenant Scoped | Soft Delete | Description |
|---|---|---|:---:|:---:|:---:|---|
| 1 | [`account`](#table-account) | `accounts` | 16 | Yes | Yes | Chart of accounts (Module 9.2). |
| 2 | [`app_user`](#table-app-user) | `identity` | 17 | Yes | Yes | A person who can sign in. Scoped to one tenant. Created only by the super admin. |
| 3 | [`audit_log`](#table-audit-log) | `identity` | 11 | Yes | No | - |
| 4 | [`branch`](#table-branch) | `masters` | 20 | Yes | Yes | A physical location. Stock always sits at a branch, never at "the company". |
| 5 | [`config_value`](#table-config-value) | `core` | 10 | Yes | No | Per-tenant and per-branch overrides of the settings declared in code. |
| 6 | [`dashboard_layout`](#table-dashboard-layout) | `dashboard` | 10 | Yes | No | - |
| 7 | [`feature_flag`](#table-feature-flag) | `platform` | 10 | No (Platform) | No | System feature flags. Null tenant_id = global default. |
| 8 | [`girvi_accrual`](#table-girvi-accrual) | `girvi` | 16 | Yes | No | One row per interest period. Written once, never recalculated. |
| 9 | [`girvi_collateral`](#table-girvi-collateral) | `girvi` | 24 | Yes | No | The individual articles held against the loan. |
| 10 | [`girvi_loan`](#table-girvi-loan) | `girvi` | 49 | Yes | No | The pawn agreement. |
| 11 | [`girvi_repayment`](#table-girvi-repayment) | `girvi` | 19 | Yes | No | Money coming back in. Interest is cleared before principal. |
| 12 | [`goods_receipt`](#table-goods-receipt) | `purchase` | 38 | Yes | No | What physically arrived. This is the document that raises stock. |
| 13 | [`goods_receipt_line`](#table-goods-receipt-line) | `purchase` | 40 | Yes | No | - |
| 14 | [`huid_assignment`](#table-huid-assignment) | `tagging` | 16 | Yes | No | - |
| 15 | [`item`](#table-item) | `masters` | 20 | Yes | Yes | The product master. One row per thing you can buy, make or sell. |
| 16 | [`item_category`](#table-item-category) | `masters` | 12 | Yes | No | - |
| 17 | [`karigar`](#table-karigar) | `master` | 21 | Yes | Yes | Goldsmith master. Can be an employee or an outside workshop. |
| 18 | [`karigar_ledger`](#table-karigar-ledger) | `master` | 21 | Yes | No | Metal and wages per karigar. Append-only. |
| 19 | [`ledger_entry`](#table-ledger-entry) | `accounts` | 16 | Yes | No | The money side. Debits and credits in the base currency. |
| 20 | [`melt_batch`](#table-melt-batch) | `oldgold` | 25 | Yes | No | Scrap collected, melted and assayed. Closes the loop on metal reconciliation. |
| 21 | [`metal`](#table-metal) | `masters` | 12 | Yes | No | Gold, silver, platinum. Kept as data so a tenant can add one. |
| 22 | [`metal_ledger_entry`](#table-metal-ledger-entry) | `accounts` | 18 | Yes | No | The metal side. Weights in fine grams, so 22K and 24K are directly comparable. |
| 23 | [`metal_rate`](#table-metal-rate) | `masters` | 13 | Yes | No | Historic rates are never edited — a new rate is a new row, so old invoices stay explainable. |
| 24 | [`numbering_gap`](#table-numbering-gap) | `numbering` | 9 | Yes | No | - |
| 25 | [`numbering_series`](#table-numbering-series) | `numbering` | 16 | Yes | No | One row per document type per branch, e.g. sales invoices at the Andheri showroom. |
| 26 | [`old_gold_intake`](#table-old-gold-intake) | `oldgold` | 31 | Yes | No | The appraisal voucher. One per customer visit. |
| 27 | [`old_gold_item`](#table-old-gold-item) | `oldgold` | 28 | Yes | No | One row per physical article brought in. Weighed and tested individually. |
| 28 | [`order_acknowledgement`](#table-order-acknowledgement) | `orders` | 12 | Yes | No | - |
| 29 | [`order_attachment`](#table-order-attachment) | `orders` | 14 | Yes | No | Reference images for custom work, condition photos for repairs. |
| 30 | [`order_communication`](#table-order-communication) | `orders` | 13 | Yes | No | - |
| 31 | [`order_line`](#table-order-line) | `orders` | 35 | Yes | No | A wedding order mixes ready-stock bookings and made-to-order pieces line by line. |
| 32 | [`order_payment`](#table-order-payment) | `orders` | 15 | Yes | No | Advance and token collections against an order, before it is billed. |
| 33 | [`order_pipeline`](#table-order-pipeline) | `orders` | 9 | Yes | No | Config-driven Kanban stages. Absent rows fall back to the built-in defaults. |
| 34 | [`order_stage_event`](#table-order-stage-event) | `orders` | 11 | Yes | No | - |
| 35 | [`party`](#table-party) | `masters` | 29 | Yes | Yes | Customers and suppliers. The same firm is often both, so one row serves both. |
| 36 | [`platform_audit_log`](#table-platform-audit-log) | `platform` | 10 | No (Platform) | No | - |
| 37 | [`platform_refresh_token`](#table-platform-refresh-token) | `platform` | 11 | No (Platform) | No | - |
| 38 | [`platform_user`](#table-platform-user) | `platform` | 16 | No (Platform) | Yes | The super admin. Exactly one row, seeded from the CLI — never created through the API. |
| 39 | [`purchase_invoice`](#table-purchase-invoice) | `purchase` | 42 | Yes | No | What we owe the supplier. This is the document that moves the ledger. |
| 40 | [`purchase_invoice_line`](#table-purchase-invoice-line) | `purchase` | 37 | Yes | No | - |
| 41 | [`purchase_order`](#table-purchase-order) | `purchase` | 37 | Yes | No | What we asked the supplier for. Affects nothing until goods arrive. |
| 42 | [`purchase_order_line`](#table-purchase-order-line) | `purchase` | 38 | Yes | No | - |
| 43 | [`purchase_return`](#table-purchase-return) | `purchase` | 38 | Yes | No | - |
| 44 | [`purchase_return_line`](#table-purchase-return-line) | `purchase` | 37 | Yes | No | - |
| 45 | [`purity`](#table-purity) | `masters` | 14 | Yes | No | Module 10.1 — 22K gold is one row: fineness 91.600, karat 22. |
| 46 | [`refresh_token`](#table-refresh-token) | `identity` | 12 | Yes | No | - |
| 47 | [`retail_order`](#table-retail-order) | `orders` | 62 | Yes | No | All five order types. Type-specific fields are null for the others. |
| 48 | [`sales_invoice`](#table-sales-invoice) | `sales` | 50 | Yes | No | Module 5.2 — counter, wholesale and export billing share this table. |
| 49 | [`sales_invoice_line`](#table-sales-invoice-line) | `sales` | 39 | Yes | No | - |
| 50 | [`sales_payment`](#table-sales-payment) | `sales` | 14 | Yes | No | One row per tender. A single sale usually has several. |
| 51 | [`sales_return`](#table-sales-return) | `sales` | 40 | Yes | No | - |
| 52 | [`sales_return_line`](#table-sales-return-line) | `sales` | 37 | Yes | No | - |
| 53 | [`scheme_account`](#table-scheme-account) | `schemes` | 30 | Yes | No | One customer enrolled in one scheme. |
| 54 | [`scheme_installment`](#table-scheme-installment) | `schemes` | 23 | Yes | No | The full schedule, generated at enrollment. Each row is later paid or missed. |
| 55 | [`scheme_plan`](#table-scheme-plan) | `schemes` | 25 | Yes | Yes | The scheme product: tenure, installment, bonus rules. |
| 56 | [`scheme_redemption`](#table-scheme-redemption) | `schemes` | 20 | Yes | No | Turning a matured account into jewellery. Partial redemption leaves the account open. |
| 57 | [`stock_balance`](#table-stock-balance) | `inventory` | 16 | Yes | No | A running total, kept in step with stock_movement inside the same transaction. |
| 58 | [`stock_location`](#table-stock-location) | `masters` | 13 | Yes | Yes | - |
| 59 | [`stock_movement`](#table-stock-movement) | `inventory` | 23 | Yes | No | Append-only. Never updated, never deleted — a mistake is corrected by a reversing row. |
| 60 | [`stock_piece`](#table-stock-piece) | `inventory` | 28 | Yes | No | One row per physically tagged item. Only used by items with tracking = piece. |
| 61 | [`support_session`](#table-support-session) | `platform` | 13 | No (Platform) | No | - |
| 62 | [`tag_print_job`](#table-tag-print-job) | `tagging` | 15 | Yes | No | The thermal printer queue the tagging screen shows. |
| 63 | [`tag_print_job_item`](#table-tag-print-job-item) | `tagging` | 11 | Yes | No | - |
| 64 | [`tag_template`](#table-tag-template) | `tagging` | 17 | Yes | Yes | Label layouts. Dual-wing string tags are the common jewellery format. |
| 65 | [`tenant`](#table-tenant) | `tenancy` | 18 | No (Platform) | Yes | One row per customer business. Everything else in the database points here. |
| 66 | [`tenant_module`](#table-tenant-module) | `platform` | 14 | Yes | No | Which modules a tenant holds, and on what terms. Drives the module dock. |
| 67 | [`tenant_theme`](#table-tenant-theme) | `settings` | 13 | Yes | No | Theme Studio. preset_key matches the frontend theme ids. |
| 68 | [`voucher`](#table-voucher) | `accounts` | 15 | Yes | No | The accounting header. Every posted document creates exactly one. |

---

## 4. Complete Table Specifications (All 68 Tables & All 1,504 Columns)


## Module: Core & System Configuration (`core`)

<a id="table-config-value"></a>

### Table: `config_value`

> **Purpose:** Per-tenant and per-branch overrides of the settings declared in code.

- **Module:** `core`
- **Total Columns:** `10`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, branch_id, config_key)` [NULLS NOT DISTINCT]
- **Indexes:** `(tenant_id)`, `(config_key)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `branch_id` | `uuid` | Yes | - | `branch.id` (restrict) | Null means the value applies to the whole tenant. |
| 4 | `config_key` | `text` | **No** | - | - | - |
| 5 | `value` | `jsonb` | **No** | - | - | Always an object: { "v": <the value> }. |
| 6 | `updated_reason` | `text` | Yes | - | - | - |
| 7 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 8 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 9 | `created_by` | `uuid` | Yes | - | - | - |
| 10 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Multi-Tenancy & Organizations (`tenancy`)

<a id="table-tenant"></a>

### Table: `tenant`

> **Purpose:** One row per customer business. Everything else in the database points here.

- **Module:** `tenancy`
- **Total Columns:** `18`
- **Scope:** 🌐 **Platform-Level** (Global)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Indexes:** `(status)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `code` | `text` | **No** | - | - | UNIQUE · Short slug used in URLs and logs. |
| 3 | `legal_name` | `text` | **No** | - | - | - |
| 4 | `display_name` | `text` | **No** | - | - | - |
| 5 | `kind` | `text` | **No** | `'retailer'` | - | CHECK: `{col} in ('manufacturer', 'retailer', 'both')` |
| 6 | `status` | `text` | **No** | `'trial'` | - | CHECK: `{col} in ('trial', 'active', 'suspended', 'closed')` |
| 7 | `country` | `text` | **No** | `'IN'` | - | - |
| 8 | `base_currency` | `text` | **No** | `'INR'` | - | - |
| 9 | `timezone` | `text` | **No** | `'Asia/Kolkata'` | - | - |
| 10 | `gstin` | `text` | Yes | - | - | - |
| 11 | `pan` | `text` | Yes | - | - | - |
| 12 | `metadata` | `jsonb` | **No** | `'{}'::jsonb` | - | - |
| 13 | `activated_at` | `timestamptz` | Yes | - | - | - |
| 14 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 15 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 16 | `created_by` | `uuid` | Yes | - | - | - |
| 17 | `updated_by` | `uuid` | Yes | - | - | - |
| 18 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---


## Module: Platform Administration & SaaS Operator (`platform`)

<a id="table-feature-flag"></a>

### Table: `feature_flag`

> **Purpose:** System feature flags. Null tenant_id = global default.

- **Module:** `platform`
- **Total Columns:** `10`
- **Scope:** 🌐 **Platform-Level** (Global)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, flag_key)` [NULLS NOT DISTINCT]

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | Yes | - | `tenant.id` (restrict) | Null means this is the global default. |
| 3 | `flag_key` | `text` | **No** | - | - | - |
| 4 | `enabled` | `boolean` | **No** | `false` | - | - |
| 5 | `description` | `text` | Yes | - | - | - |
| 6 | `payload` | `jsonb` | **No** | `'{}'::jsonb` | - | - |
| 7 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 8 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 9 | `created_by` | `uuid` | Yes | - | - | - |
| 10 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-platform-audit-log"></a>

### Table: `platform_audit_log`

- **Module:** `platform`
- **Total Columns:** `10`
- **Scope:** 🌐 **Platform-Level** (Global)
- **Timestamps:** None
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(at)`, `(platform_user_id, at)`, `(target_tenant_id, at)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `at` | `timestamptz` | **No** | `now()` | - | - |
| 3 | `platform_user_id` | `uuid` | Yes | - | `platform_user.id` (restrict) | - |
| 4 | `action` | `text` | **No** | - | - | e.g. "tenant.create", "tenant.suspend", "user.create" |
| 5 | `target_tenant_id` | `uuid` | Yes | - | `tenant.id` (restrict) | - |
| 6 | `target_type` | `text` | Yes | - | - | - |
| 7 | `target_id` | `uuid` | Yes | - | - | - |
| 8 | `changes` | `jsonb` | Yes | - | - | - |
| 9 | `ip_address` | `text` | Yes | - | - | - |
| 10 | `request_id` | `text` | Yes | - | - | - |

---

<a id="table-platform-refresh-token"></a>

### Table: `platform_refresh_token`

- **Module:** `platform`
- **Total Columns:** `11`
- **Scope:** 🌐 **Platform-Level** (Global)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(token_hash)`, `(platform_user_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `platform_user_id` | `uuid` | **No** | - | `platform_user.id` (cascade) | - |
| 3 | `token_hash` | `text` | **No** | - | - | - |
| 4 | `expires_at` | `timestamptz` | **No** | - | - | - |
| 5 | `revoked_at` | `timestamptz` | Yes | - | - | - |
| 6 | `user_agent` | `text` | Yes | - | - | - |
| 7 | `ip_address` | `text` | Yes | - | - | - |
| 8 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 9 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 10 | `created_by` | `uuid` | Yes | - | - | - |
| 11 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-platform-user"></a>

### Table: `platform_user`

> **Purpose:** The super admin. Exactly one row, seeded from the CLI — never created through the API.

- **Module:** `platform`
- **Total Columns:** `16`
- **Scope:** 🌐 **Platform-Level** (Global)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Indexes:** `(role)`, `(is_active)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `email` | `text` | **No** | - | - | UNIQUE |
| 3 | `full_name` | `text` | **No** | - | - | - |
| 4 | `password_hash` | `text` | **No** | - | - | - |
| 5 | `role` | `text` | **No** | `'super_admin'` | - | CHECK: `{col} in ('super_admin')` |
| 6 | `phone` | `text` | Yes | - | - | - |
| 7 | `is_active` | `boolean` | **No** | `true` | - | - |
| 8 | `last_login_at` | `timestamptz` | Yes | - | - | - |
| 9 | `failed_login_count` | `integer` | **No** | `0` | - | - |
| 10 | `locked_until` | `timestamptz` | Yes | - | - | - |
| 11 | `created_by_platform_user_id` | `uuid` | Yes | - | `platform_user.id` (restrict) | - |
| 12 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 13 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `created_by` | `uuid` | Yes | - | - | - |
| 15 | `updated_by` | `uuid` | Yes | - | - | - |
| 16 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---

<a id="table-support-session"></a>

### Table: `support_session`

- **Module:** `platform`
- **Total Columns:** `13`
- **Scope:** 🌐 **Platform-Level** (Global)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id, started_at)`, `(operator_user_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | - |
| 3 | `operator_user_id` | `uuid` | **No** | - | `app_user.id` (restrict) | - |
| 4 | `reason` | `text` | **No** | - | - | - |
| 5 | `started_at` | `timestamptz` | **No** | `now()` | - | - |
| 6 | `ends_at` | `timestamptz` | **No** | - | - | - |
| 7 | `ended_at` | `timestamptz` | Yes | - | - | - |
| 8 | `can_write` | `boolean` | **No** | `false` | - | - |
| 9 | `ip_address` | `text` | Yes | - | - | - |
| 10 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 11 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 12 | `created_by` | `uuid` | Yes | - | - | - |
| 13 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-tenant-module"></a>

### Table: `tenant_module`

> **Purpose:** Which modules a tenant holds, and on what terms. Drives the module dock.

- **Module:** `platform`
- **Total Columns:** `14`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, module_key)`
- **Indexes:** `(tenant_id)`, `(licence)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `module_key` | `text` | **No** | - | - | orders, stock, tagging, pos, oldgold, schemes, girvi, accounts, master, reports, settings, platform |
| 4 | `enabled` | `boolean` | **No** | `true` | - | - |
| 5 | `licence` | `text` | **No** | `'included'` | - | CHECK: `{col} in ('included', 'purchased', 'trial', 'expired')` |
| 6 | `trial_ends_at` | `timestamptz` | Yes | - | - | - |
| 7 | `expires_at` | `timestamptz` | Yes | - | - | - |
| 8 | `purchased_at` | `timestamptz` | Yes | - | - | - |
| 9 | `disabled_submodules` | `jsonb` | **No** | `'[]'::jsonb` | - | - |
| 10 | `settings` | `jsonb` | **No** | `'{}'::jsonb` | - | - |
| 11 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 12 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 13 | `created_by` | `uuid` | Yes | - | - | - |
| 14 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Theme & Custom Settings (`settings`)

<a id="table-tenant-theme"></a>

### Table: `tenant_theme`

> **Purpose:** Theme Studio. preset_key matches the frontend theme ids.

- **Module:** `settings`
- **Total Columns:** `13`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, branch_id)` [NULLS NOT DISTINCT]
- **Indexes:** `(tenant_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `preset_key` | `text` | **No** | `'deep-forest'` | - | CHECK: `{col} in ('deep-forest', 'royal-ruby', 'sapphire-platinum', 'obsidian-luxury', 'rose-gold', 'custom')` |
| 4 | `css_variables` | `jsonb` | **No** | `'{}'::jsonb` | - | - |
| 5 | `logo_url` | `text` | Yes | - | - | - |
| 6 | `logo_dark_url` | `text` | Yes | - | - | - |
| 7 | `favicon_url` | `text` | Yes | - | - | - |
| 8 | `branch_id` | `uuid` | Yes | - | `branch.id` (restrict) | - |
| 9 | `is_active` | `boolean` | **No** | `true` | - | - |
| 10 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 11 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 12 | `created_by` | `uuid` | Yes | - | - | - |
| 13 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Business Dashboard & Widgets (`dashboard`)

<a id="table-dashboard-layout"></a>

### Table: `dashboard_layout`

- **Module:** `dashboard`
- **Total Columns:** `10`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, user_id, role_code)` [NULLS NOT DISTINCT]
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `user_or_role`: `(user_id is not null) <> (role_code is not null)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `user_id` | `uuid` | Yes | - | `app_user.id` (cascade) | Null when this is a role default. |
| 4 | `role_code` | `text` | Yes | - | - | Set instead of user_id for a role-level default. |
| 5 | `widgets` | `jsonb` | **No** | `'[]'::jsonb` | - | - |
| 6 | `is_default` | `boolean` | **No** | `false` | - | - |
| 7 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 8 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 9 | `created_by` | `uuid` | Yes | - | - | - |
| 10 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Identity, Authentication & Audit (`identity`)

<a id="table-app-user"></a>

### Table: `app_user`

> **Purpose:** A person who can sign in. Scoped to one tenant. Created only by the super admin.

- **Module:** `identity`
- **Total Columns:** `17`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Unique Constraints:** `(tenant_id, email)`
- **Indexes:** `(tenant_id)`, `(role_code)`, `(default_branch_id)`, `(tenant_id, default_branch_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `email` | `text` | **No** | - | - | - |
| 4 | `phone` | `text` | Yes | - | - | - |
| 5 | `full_name` | `text` | **No** | - | - | - |
| 6 | `password_hash` | `text` | **No** | - | - | scrypt: salt:hash, both hex. |
| 7 | `role_code` | `text` | **No** | `'sales'` | - | CHECK: `{col} in ('admin', 'sales', 'accountant', 'storekeeper')` |
| 8 | `is_active` | `boolean` | **No** | `true` | - | - |
| 9 | `default_branch_id` | `uuid` | Yes | - | `branch.id` (restrict) | - |
| 10 | `last_login_at` | `timestamptz` | Yes | - | - | - |
| 11 | `failed_login_count` | `integer` | **No** | `0` | - | - |
| 12 | `locked_until` | `timestamptz` | Yes | - | - | - |
| 13 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 15 | `created_by` | `uuid` | Yes | - | - | - |
| 16 | `updated_by` | `uuid` | Yes | - | - | - |
| 17 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---

<a id="table-audit-log"></a>

### Table: `audit_log`

- **Module:** `identity`
- **Total Columns:** `11`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** None
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(at)`, `(entity_table, entity_id)`, `(user_id, at)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `at` | `timestamptz` | **No** | `now()` | - | - |
| 4 | `user_id` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 5 | `branch_id` | `uuid` | Yes | - | `branch.id` (restrict) | - |
| 6 | `action` | `text` | **No** | - | - | e.g. "sales_invoice.post" |
| 7 | `entity_table` | `text` | Yes | - | - | - |
| 8 | `entity_id` | `uuid` | Yes | - | - | - |
| 9 | `changes` | `jsonb` | Yes | - | - | - |
| 10 | `request_id` | `text` | Yes | - | - | - |
| 11 | `ip_address` | `text` | Yes | - | - | - |

---

<a id="table-refresh-token"></a>

### Table: `refresh_token`

- **Module:** `identity`
- **Total Columns:** `12`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(token_hash)`, `(user_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `user_id` | `uuid` | **No** | - | `app_user.id` (cascade) | - |
| 4 | `token_hash` | `text` | **No** | - | - | sha256 of the token — the token itself is never stored. |
| 5 | `expires_at` | `timestamptz` | **No** | - | - | - |
| 6 | `revoked_at` | `timestamptz` | Yes | - | - | - |
| 7 | `user_agent` | `text` | Yes | - | - | - |
| 8 | `ip_address` | `text` | Yes | - | - | - |
| 9 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 10 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 11 | `created_by` | `uuid` | Yes | - | - | - |
| 12 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Master Data & Reference Catalogs (`masters`)

<a id="table-branch"></a>

### Table: `branch`

> **Purpose:** A physical location. Stock always sits at a branch, never at "the company".

- **Module:** `masters`
- **Total Columns:** `20`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Unique Constraints:** `(tenant_id, code)`
- **Indexes:** `(tenant_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `code` | `text` | **No** | - | - | - |
| 4 | `name` | `text` | **No** | - | - | - |
| 5 | `kind` | `text` | **No** | `'showroom'` | - | CHECK: `{col} in ('showroom', 'factory', 'warehouse', 'office')` |
| 6 | `gstin` | `text` | Yes | - | - | - |
| 7 | `state_code` | `text` | Yes | - | - | GST state code — decides CGST+SGST versus IGST. |
| 8 | `address_line1` | `text` | Yes | - | - | - |
| 9 | `address_line2` | `text` | Yes | - | - | - |
| 10 | `city` | `text` | Yes | - | - | - |
| 11 | `state` | `text` | Yes | - | - | - |
| 12 | `pincode` | `text` | Yes | - | - | - |
| 13 | `phone` | `text` | Yes | - | - | - |
| 14 | `email` | `text` | Yes | - | - | - |
| 15 | `is_active` | `boolean` | **No** | `true` | - | - |
| 16 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 17 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 18 | `created_by` | `uuid` | Yes | - | - | - |
| 19 | `updated_by` | `uuid` | Yes | - | - | - |
| 20 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---

<a id="table-item"></a>

### Table: `item`

> **Purpose:** The product master. One row per thing you can buy, make or sell.

- **Module:** `masters`
- **Total Columns:** `20`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Unique Constraints:** `(tenant_id, code)`
- **Indexes:** `(tenant_id)`, `(nature)`, `(category_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `code` | `text` | **No** | - | - | - |
| 4 | `name` | `text` | **No** | - | - | - |
| 5 | `nature` | `text` | **No** | `'finished'` | - | CHECK: `{col} in ('raw_metal', 'finished', 'stone', 'consumable', 'service')` |
| 6 | `tracking` | `text` | **No** | `'piece'` | - | CHECK: `{col} in ('lot', 'piece')` |
| 7 | `category_id` | `uuid` | Yes | - | `item_category.id` (restrict) | - |
| 8 | `metal_id` | `uuid` | Yes | - | `metal.id` (restrict) | - |
| 9 | `default_purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 10 | `hsn_code` | `text` | Yes | - | - | - |
| 11 | `default_making_rate` | `numeric(14,6)` | Yes | - | - | - |
| 12 | `default_wastage_percent` | `numeric(14,6)` | Yes | - | - | - |
| 13 | `uom` | `text` | **No** | `'gram'` | - | CHECK: `{col} in ('gram', 'piece', 'carat', 'millilitre')` |
| 14 | `is_active` | `boolean` | **No** | `true` | - | - |
| 15 | `attributes` | `jsonb` | **No** | `'{}'::jsonb` | - | - |
| 16 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 17 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 18 | `created_by` | `uuid` | Yes | - | - | - |
| 19 | `updated_by` | `uuid` | Yes | - | - | - |
| 20 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---

<a id="table-item-category"></a>

### Table: `item_category`

- **Module:** `masters`
- **Total Columns:** `12`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, code)`
- **Indexes:** `(tenant_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `parent_id` | `uuid` | Yes | - | `item_category.id` (restrict) | - |
| 4 | `code` | `text` | **No** | - | - | - |
| 5 | `name` | `text` | **No** | - | - | - |
| 6 | `hsn_code` | `text` | Yes | - | - | - |
| 7 | `sort_order` | `integer` | **No** | `0` | - | - |
| 8 | `is_active` | `boolean` | **No** | `true` | - | - |
| 9 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 10 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 11 | `created_by` | `uuid` | Yes | - | - | - |
| 12 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-metal"></a>

### Table: `metal`

> **Purpose:** Gold, silver, platinum. Kept as data so a tenant can add one.

- **Module:** `masters`
- **Total Columns:** `12`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, code)`
- **Indexes:** `(tenant_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `code` | `text` | **No** | - | - | GOLD, SILVER, PLATINUM |
| 4 | `name` | `text` | **No** | - | - | - |
| 5 | `default_display_unit` | `text` | **No** | `'gram'` | - | CHECK: `{col} in ('gram', 'tola', 'kilo', 'carat')` |
| 6 | `hsn_code` | `text` | Yes | - | - | - |
| 7 | `is_active` | `boolean` | **No** | `true` | - | - |
| 8 | `sort_order` | `integer` | **No** | `0` | - | - |
| 9 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 10 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 11 | `created_by` | `uuid` | Yes | - | - | - |
| 12 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-metal-rate"></a>

### Table: `metal_rate`

> **Purpose:** Historic rates are never edited — a new rate is a new row, so old invoices stay explainable.

- **Module:** `masters`
- **Total Columns:** `13`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(metal_id, purity_id, effective_from)`
- **Check Constraints:** `rate_positive`: `rate_per_gram > 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `metal_id` | `uuid` | **No** | - | `metal.id` (restrict) | - |
| 4 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | Null means the rate is for 100% pure metal. |
| 5 | `effective_from` | `timestamptz` | **No** | `now()` | - | - |
| 6 | `rate_per_gram` | `numeric(20,4)` | **No** | - | - | - |
| 7 | `buying_rate_per_gram` | `numeric(20,4)` | Yes | - | - | What the shop pays for old gold — normally lower. |
| 8 | `source` | `text` | **No** | `'manual'` | - | CHECK: `{col} in ('manual', 'feed')` |
| 9 | `branch_id` | `uuid` | Yes | - | `branch.id` (restrict) | Null means the rate applies to every branch. |
| 10 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 11 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 12 | `created_by` | `uuid` | Yes | - | - | - |
| 13 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-party"></a>

### Table: `party`

> **Purpose:** Customers and suppliers. The same firm is often both, so one row serves both.

- **Module:** `masters`
- **Total Columns:** `29`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Unique Constraints:** `(tenant_id, code)`
- **Indexes:** `(tenant_id)`, `(name)`, `(phone)`, `(is_customer)`, `(is_supplier)`
- **Check Constraints:** `is_customer_or_supplier`: `is_customer = true or is_supplier = true`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `code` | `text` | **No** | - | - | - |
| 4 | `name` | `text` | **No** | - | - | - |
| 5 | `is_customer` | `boolean` | **No** | `false` | - | - |
| 6 | `is_supplier` | `boolean` | **No** | `false` | - | - |
| 7 | `party_type` | `text` | **No** | `'individual'` | - | CHECK: `{col} in ('individual', 'business')` |
| 8 | `phone` | `text` | Yes | - | - | - |
| 9 | `email` | `text` | Yes | - | - | - |
| 10 | `gstin` | `text` | Yes | - | - | - |
| 11 | `pan` | `text` | Yes | - | - | - |
| 12 | `state_code` | `text` | Yes | - | - | Decides CGST+SGST versus IGST against the branch. |
| 13 | `address_line1` | `text` | Yes | - | - | - |
| 14 | `address_line2` | `text` | Yes | - | - | - |
| 15 | `city` | `text` | Yes | - | - | - |
| 16 | `state` | `text` | Yes | - | - | - |
| 17 | `pincode` | `text` | Yes | - | - | - |
| 18 | `credit_limit` | `numeric(20,4)` | Yes | - | - | - |
| 19 | `credit_days` | `integer` | Yes | - | - | - |
| 20 | `kyc_status` | `text` | **No** | `'none'` | - | CHECK: `{col} in ('none', 'pending', 'verified', 'rejected')` |
| 21 | `date_of_birth` | `date` | Yes | - | - | - |
| 22 | `anniversary` | `date` | Yes | - | - | - |
| 23 | `notes` | `text` | Yes | - | - | - |
| 24 | `is_active` | `boolean` | **No** | `true` | - | - |
| 25 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 26 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 27 | `created_by` | `uuid` | Yes | - | - | - |
| 28 | `updated_by` | `uuid` | Yes | - | - | - |
| 29 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---

<a id="table-purity"></a>

### Table: `purity`

> **Purpose:** Module 10.1 — 22K gold is one row: fineness 91.600, karat 22.

- **Module:** `masters`
- **Total Columns:** `14`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, metal_id, code)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `fineness_range`: `fineness_percent > 0 and fineness_percent <= 100`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `metal_id` | `uuid` | **No** | - | `metal.id` (restrict) | - |
| 4 | `code` | `text` | **No** | - | - | e.g. 22K, 18K, 916, 995 |
| 5 | `name` | `text` | **No** | - | - | - |
| 6 | `fineness_percent` | `numeric(7,3)` | **No** | - | - | - |
| 7 | `karat` | `numeric(5,2)` | Yes | - | - | Null for silver and platinum. |
| 8 | `is_hallmarkable` | `boolean` | **No** | `true` | - | - |
| 9 | `is_active` | `boolean` | **No** | `true` | - | - |
| 10 | `sort_order` | `integer` | **No** | `0` | - | - |
| 11 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 12 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 13 | `created_by` | `uuid` | Yes | - | - | - |
| 14 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-stock-location"></a>

### Table: `stock_location`

- **Module:** `masters`
- **Total Columns:** `13`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Unique Constraints:** `(tenant_id, branch_id, code)`
- **Indexes:** `(tenant_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 4 | `code` | `text` | **No** | - | - | - |
| 5 | `name` | `text` | **No** | - | - | - |
| 6 | `kind` | `text` | **No** | `'counter'` | - | CHECK: `{col} in ('counter', 'vault', 'window', 'floor', 'transit', 'karigar')` |
| 7 | `is_default` | `boolean` | **No** | `false` | - | - |
| 8 | `is_active` | `boolean` | **No** | `true` | - | - |
| 9 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 10 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 11 | `created_by` | `uuid` | Yes | - | - | - |
| 12 | `updated_by` | `uuid` | Yes | - | - | - |
| 13 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---


## Module: Document Numbering & Sequences (`numbering`)

<a id="table-numbering-gap"></a>

### Table: `numbering_gap`

- **Module:** `numbering`
- **Total Columns:** `9`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(series_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `series_id` | `uuid` | **No** | - | `numbering_series.id` (restrict) | - |
| 4 | `doc_number` | `text` | **No** | - | - | - |
| 5 | `reason` | `text` | **No** | - | - | - |
| 6 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 7 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 8 | `created_by` | `uuid` | Yes | - | - | - |
| 9 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-numbering-series"></a>

### Table: `numbering_series`

> **Purpose:** One row per document type per branch, e.g. sales invoices at the Andheri showroom.

- **Module:** `numbering`
- **Total Columns:** `16`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, doc_type, branch_id)` [NULLS NOT DISTINCT]
- **Indexes:** `(tenant_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `doc_type` | `text` | **No** | - | - | purchase_order, sales_invoice, grn, tag... |
| 4 | `branch_id` | `uuid` | Yes | - | `branch.id` (restrict) | Null means one shared series across all branches. |
| 5 | `name` | `text` | **No** | - | - | - |
| 6 | `prefix` | `text` | **No** | `''` | - | Supports {FY}, {YY}, {MM}, {BRANCH}. |
| 7 | `suffix` | `text` | **No** | `''` | - | - |
| 8 | `padding` | `integer` | **No** | `5` | - | - |
| 9 | `next_number` | `bigint` | **No** | `1` | - | - |
| 10 | `reset_period` | `text` | **No** | `'financial_yearly'` | - | CHECK: `{col} in ('never', 'yearly', 'financial_yearly', 'monthly')` |
| 11 | `current_period` | `text` | Yes | - | - | - |
| 12 | `is_active` | `boolean` | **No** | `true` | - | - |
| 13 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 15 | `created_by` | `uuid` | Yes | - | - | - |
| 16 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Financial & Dual-Metal Accounting Ledgers (`accounts`)

<a id="table-account"></a>

### Table: `account`

> **Purpose:** Chart of accounts (Module 9.2).

- **Module:** `accounts`
- **Total Columns:** `16`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Unique Constraints:** `(tenant_id, code)`
- **Indexes:** `(tenant_id)`, `(account_type)`, `(parent_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `code` | `text` | **No** | - | - | - |
| 4 | `name` | `text` | **No** | - | - | - |
| 5 | `account_type` | `text` | **No** | - | - | CHECK: `{col} in ('asset', 'liability', 'equity', 'income', 'expense')` |
| 6 | `parent_id` | `uuid` | Yes | - | `account.id` (restrict) | - |
| 7 | `is_control` | `boolean` | **No** | `false` | - | - |
| 8 | `control_for` | `text` | Yes | - | - | CHECK: `{col} in ('customer', 'supplier', 'karigar')` |
| 9 | `tracks_metal` | `boolean` | **No** | `false` | - | - |
| 10 | `is_system` | `boolean` | **No** | `false` | - | - |
| 11 | `is_active` | `boolean` | **No** | `true` | - | - |
| 12 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 13 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `created_by` | `uuid` | Yes | - | - | - |
| 15 | `updated_by` | `uuid` | Yes | - | - | - |
| 16 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---

<a id="table-ledger-entry"></a>

### Table: `ledger_entry`

> **Purpose:** The money side. Debits and credits in the base currency.

- **Module:** `accounts`
- **Total Columns:** `16`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(account_id, entry_date)`, `(party_id, entry_date)`, `(voucher_id)`
- **Check Constraints:** `one_side_only`: `(debit = 0 or credit = 0) and debit >= 0 and credit >= 0 and (debit + credit) > 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `voucher_id` | `uuid` | **No** | - | `voucher.id` (cascade) | - |
| 4 | `account_id` | `uuid` | **No** | - | `account.id` (restrict) | - |
| 5 | `party_id` | `uuid` | Yes | - | `party.id` (restrict) | - |
| 6 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 7 | `entry_date` | `date` | **No** | - | - | - |
| 8 | `debit` | `numeric(20,4)` | **No** | `0` | - | - |
| 9 | `credit` | `numeric(20,4)` | **No** | `0` | - | - |
| 10 | `narration` | `text` | Yes | - | - | - |
| 11 | `against_type` | `text` | Yes | - | - | - |
| 12 | `against_id` | `uuid` | Yes | - | - | - |
| 13 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 15 | `created_by` | `uuid` | Yes | - | - | - |
| 16 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-metal-ledger-entry"></a>

### Table: `metal_ledger_entry`

> **Purpose:** The metal side. Weights in fine grams, so 22K and 24K are directly comparable.

- **Module:** `accounts`
- **Total Columns:** `18`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(account_id, entry_date)`, `(party_id, metal_id, entry_date)`, `(voucher_id)`
- **Check Constraints:** `one_direction_only`: `(weight_in = 0 or weight_out = 0) and weight_in >= 0 and weight_out >= 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `voucher_id` | `uuid` | **No** | - | `voucher.id` (cascade) | - |
| 4 | `account_id` | `uuid` | **No** | - | `account.id` (restrict) | - |
| 5 | `party_id` | `uuid` | Yes | - | `party.id` (restrict) | - |
| 6 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 7 | `entry_date` | `date` | **No** | - | - | - |
| 8 | `metal_id` | `uuid` | **No** | - | `metal.id` (restrict) | - |
| 9 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 10 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 11 | `weight_in` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `weight_out` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `rate_per_gram` | `numeric(20,4)` | Yes | - | - | - |
| 14 | `narration` | `text` | Yes | - | - | - |
| 15 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 16 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 17 | `created_by` | `uuid` | Yes | - | - | - |
| 18 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-voucher"></a>

### Table: `voucher`

> **Purpose:** The accounting header. Every posted document creates exactly one.

- **Module:** `accounts`
- **Total Columns:** `15`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, voucher_number)`
- **Indexes:** `(tenant_id)`, `(voucher_date)`, `(source_type, source_id)`, `(voucher_type, voucher_date)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `voucher_number` | `text` | **No** | - | - | - |
| 4 | `voucher_type` | `text` | **No** | - | - | CHECK: `{col} in ('opening', 'purchase', 'purchase_return', 'sale', 'sales_return', 'receipt', 'payment', 'journal', 'old_gold', 'scheme', 'mortgage', 'production')` |
| 5 | `voucher_date` | `date` | **No** | - | - | - |
| 6 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 7 | `narration` | `text` | Yes | - | - | - |
| 8 | `source_type` | `text` | **No** | - | - | - |
| 9 | `source_id` | `uuid` | **No** | - | - | - |
| 10 | `is_reversed` | `boolean` | **No** | `false` | - | - |
| 11 | `reverses_voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 12 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 13 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `created_by` | `uuid` | Yes | - | - | - |
| 15 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Stock Management & Vault Balances (`inventory`)

<a id="table-stock-balance"></a>

### Table: `stock_balance`

> **Purpose:** A running total, kept in step with stock_movement inside the same transaction.

- **Module:** `inventory`
- **Total Columns:** `16`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, item_id, purity_id, location_id)` [NULLS NOT DISTINCT]
- **Indexes:** `(tenant_id)`, `(location_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `item_id` | `uuid` | **No** | - | `item.id` (restrict) | - |
| 4 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 5 | `location_id` | `uuid` | **No** | - | `stock_location.id` (restrict) | - |
| 6 | `quantity` | `numeric(14,3)` | **No** | `0` | - | - |
| 7 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 8 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 9 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 10 | `value` | `numeric(20,4)` | **No** | `0` | - | - |
| 11 | `average_rate` | `numeric(20,4)` | **No** | `0` | - | - |
| 12 | `last_movement_at` | `timestamptz` | Yes | - | - | - |
| 13 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 15 | `created_by` | `uuid` | Yes | - | - | - |
| 16 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-stock-movement"></a>

### Table: `stock_movement`

> **Purpose:** Append-only. Never updated, never deleted — a mistake is corrected by a reversing row.

- **Module:** `inventory`
- **Total Columns:** `23`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(item_id, purity_id, location_id, moved_at)`, `(source_type, source_id)`, `(piece_id)`, `(moved_at)`
- **Check Constraints:** `nothing_negative`: `quantity >= 0 and gross_weight >= 0 and net_weight >= 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `moved_at` | `timestamptz` | **No** | `now()` | - | - |
| 4 | `direction` | `text` | **No** | - | - | CHECK: `{col} in ('in', 'out')` |
| 5 | `reason` | `text` | **No** | - | - | CHECK: `{col} in ('opening', 'purchase', 'purchase_return', 'sale', 'sales_return', 'transfer_out', 'transfer_in', 'production_issue', 'production_receipt', 'old_gold_intake', 'melting', 'adjustment', 'memo_out', 'memo_in')` |
| 6 | `item_id` | `uuid` | **No** | - | `item.id` (restrict) | - |
| 7 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 8 | `location_id` | `uuid` | **No** | - | `stock_location.id` (restrict) | - |
| 9 | `piece_id` | `uuid` | Yes | - | `stock_piece.id` (restrict) | Set for piece-tracked items, null for bulk metal. |
| 10 | `quantity` | `numeric(14,3)` | **No** | `0` | - | Piece count, or units for consumables. |
| 11 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `value` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `source_type` | `text` | **No** | - | - | - |
| 16 | `source_id` | `uuid` | **No** | - | - | - |
| 17 | `source_line_id` | `uuid` | Yes | - | - | - |
| 18 | `reverses_movement_id` | `uuid` | Yes | - | `stock_movement.id` (restrict) | - |
| 19 | `note` | `text` | Yes | - | - | - |
| 20 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 21 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 22 | `created_by` | `uuid` | Yes | - | - | - |
| 23 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-stock-piece"></a>

### Table: `stock_piece`

> **Purpose:** One row per physically tagged item. Only used by items with tracking = piece.

- **Module:** `inventory`
- **Total Columns:** `28`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, tag_number)`
- **Indexes:** `(tenant_id)`, `(item_id)`, `(location_id, status)`, `(huid)`, `(status, received_at)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `tag_number` | `text` | **No** | - | - | What is printed on the label. |
| 4 | `item_id` | `uuid` | **No** | - | `item.id` (restrict) | - |
| 5 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 6 | `location_id` | `uuid` | **No** | - | `stock_location.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'in_stock'` | - | CHECK: `{col} in ('in_stock', 'on_memo', 'sold', 'in_transit', 'with_karigar', 'in_repair', 'melted', 'written_off')` |
| 8 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 9 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | Metal only — what purity applies to. |
| 10 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 11 | `other_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | net_weight x purity — the pure metal content. |
| 13 | `stone_count` | `integer` | Yes | - | - | - |
| 14 | `huid` | `text` | Yes | - | - | - |
| 15 | `hallmark_centre` | `text` | Yes | - | - | - |
| 16 | `cost_value` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `making_cost` | `numeric(20,4)` | **No** | `0` | - | - |
| 18 | `stone_cost` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `design_id` | `uuid` | Yes | - | - | Filled in once Module 2 exists. |
| 20 | `supplier_id` | `uuid` | Yes | - | `party.id` (restrict) | - |
| 21 | `received_at` | `timestamptz` | **No** | `now()` | - | - |
| 22 | `sold_at` | `timestamptz` | Yes | - | - | - |
| 23 | `image_urls` | `jsonb` | **No** | `'[]'::jsonb` | - | - |
| 24 | `attributes` | `jsonb` | **No** | `'{}'::jsonb` | - | - |
| 25 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 26 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 27 | `created_by` | `uuid` | Yes | - | - | - |
| 28 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Jewellery Tagging, Barcoding & HUID (`tagging`)

<a id="table-huid-assignment"></a>

### Table: `huid_assignment`

- **Module:** `tagging`
- **Total Columns:** `16`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(huid)`, `(piece_id, superseded_at)`
- **Check Constraints:** `huid_format`: `huid ~ '^[A-Z0-9]{6}$'`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `piece_id` | `uuid` | **No** | - | `stock_piece.id` (restrict) | - |
| 4 | `huid` | `text` | **No** | - | - | The BIS 6-character alphanumeric identifier. |
| 5 | `hallmark_centre_code` | `text` | Yes | - | - | - |
| 6 | `hallmark_centre_name` | `text` | Yes | - | - | - |
| 7 | `hallmarked_on` | `date` | Yes | - | - | - |
| 8 | `certified_purity_percent` | `numeric(7,3)` | Yes | - | - | - |
| 9 | `certificate_number` | `text` | Yes | - | - | - |
| 10 | `superseded_at` | `timestamptz` | Yes | - | - | - |
| 11 | `supersede_reason` | `text` | Yes | - | - | - |
| 12 | `assigned_by` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 13 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 15 | `created_by` | `uuid` | Yes | - | - | - |
| 16 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-tag-print-job"></a>

### Table: `tag_print_job`

> **Purpose:** The thermal printer queue the tagging screen shows.

- **Module:** `tagging`
- **Total Columns:** `15`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(status, queued_at)`, `(branch_id, status)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `tag_template_id` | `uuid` | **No** | - | `tag_template.id` (restrict) | - |
| 4 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 5 | `status` | `text` | **No** | `'queued'` | - | CHECK: `{col} in ('queued', 'printing', 'printed', 'failed', 'cancelled')` |
| 6 | `piece_count` | `integer` | **No** | `0` | - | - |
| 7 | `queued_by` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 8 | `queued_at` | `timestamptz` | **No** | `now()` | - | - |
| 9 | `printed_at` | `timestamptz` | Yes | - | - | - |
| 10 | `printer_name` | `text` | Yes | - | - | - |
| 11 | `error_message` | `text` | Yes | - | - | - |
| 12 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 13 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `created_by` | `uuid` | Yes | - | - | - |
| 15 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-tag-print-job-item"></a>

### Table: `tag_print_job_item`

- **Module:** `tagging`
- **Total Columns:** `11`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, tag_print_job_id, piece_id)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `copies_positive`: `copies > 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `tag_print_job_id` | `uuid` | **No** | - | `tag_print_job.id` (cascade) | - |
| 4 | `piece_id` | `uuid` | **No** | - | `stock_piece.id` (restrict) | - |
| 5 | `copies` | `integer` | **No** | `1` | - | - |
| 6 | `rendered_payload` | `jsonb` | **No** | `'{}'::jsonb` | - | - |
| 7 | `printed` | `boolean` | **No** | `false` | - | - |
| 8 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 9 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 10 | `created_by` | `uuid` | Yes | - | - | - |
| 11 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-tag-template"></a>

### Table: `tag_template`

> **Purpose:** Label layouts. Dual-wing string tags are the common jewellery format.

- **Module:** `tagging`
- **Total Columns:** `17`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Unique Constraints:** `(tenant_id, code)`
- **Indexes:** `(tenant_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `code` | `text` | **No** | - | - | - |
| 4 | `name` | `text` | **No** | - | - | - |
| 5 | `format` | `text` | **No** | `'string_tag_dual_wing'` | - | CHECK: `{col} in ('string_tag_dual_wing', 'sticker', 'hang_tag', 'box_label')` |
| 6 | `width_mm` | `numeric(6,2)` | **No** | `85` | - | - |
| 7 | `height_mm` | `numeric(6,2)` | **No** | `15` | - | - |
| 8 | `barcode_type` | `text` | **No** | `'code128'` | - | CHECK: `{col} in ('code128', 'qr', 'datamatrix', 'ean13')` |
| 9 | `layout` | `jsonb` | **No** | `'{}'::jsonb` | - | - |
| 10 | `printer_model` | `text` | Yes | - | - | - |
| 11 | `is_default` | `boolean` | **No** | `false` | - | - |
| 12 | `is_active` | `boolean` | **No** | `true` | - | - |
| 13 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 15 | `created_by` | `uuid` | Yes | - | - | - |
| 16 | `updated_by` | `uuid` | Yes | - | - | - |
| 17 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---


## Module: Procurement & Purchase Invoices (`purchase`)

<a id="table-goods-receipt"></a>

### Table: `goods_receipt`

> **Purpose:** What physically arrived. This is the document that raises stock.

- **Module:** `purchase`
- **Total Columns:** `38`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, doc_number)`
- **Indexes:** `(tenant_id)`, `(supplier_id, doc_date)`, `(purchase_order_id)`, `(status, doc_date)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `doc_number` | `text` | **No** | - | - | - |
| 4 | `doc_date` | `date` | **No** | - | - | - |
| 5 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 6 | `supplier_id` | `uuid` | **No** | - | `party.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'draft'` | - | CHECK: `{col} in ('draft', 'confirmed', 'posted', 'cancelled', 'closed')` |
| 8 | `reference_number` | `text` | Yes | - | - | The other side's document number. |
| 9 | `reference_date` | `date` | Yes | - | - | - |
| 10 | `notes` | `text` | Yes | - | - | - |
| 11 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 12 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 13 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 14 | `other_charges` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 18 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `round_off` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `total_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 22 | `total_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 23 | `total_net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 24 | `total_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 25 | `posted_at` | `timestamptz` | Yes | - | - | - |
| 26 | `posted_by` | `uuid` | Yes | - | - | - |
| 27 | `cancelled_at` | `timestamptz` | Yes | - | - | - |
| 28 | `cancelled_by` | `uuid` | Yes | - | - | - |
| 29 | `cancel_reason` | `text` | Yes | - | - | - |
| 30 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | The accounting entry created at posting. |
| 31 | `purchase_order_id` | `uuid` | Yes | - | `purchase_order.id` (restrict) | - |
| 32 | `received_at` | `timestamptz` | **No** | `now()` | - | - |
| 33 | `weighed_by` | `uuid` | Yes | - | - | - |
| 34 | `transport_details` | `text` | Yes | - | - | - |
| 35 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 36 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 37 | `created_by` | `uuid` | Yes | - | - | - |
| 38 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-goods-receipt-line"></a>

### Table: `goods_receipt_line`

- **Module:** `purchase`
- **Total Columns:** `40`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, goods_receipt_id, line_number)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `quantity_positive`: `quantity > 0`; `weights_not_negative`: `gross_weight >= 0 and net_weight >= 0 and fine_weight >= 0`; `net_within_gross`: `net_weight <= gross_weight`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `goods_receipt_id` | `uuid` | **No** | - | `goods_receipt.id` (cascade) | - |
| 4 | `line_number` | `integer` | **No** | - | - | - |
| 5 | `item_id` | `uuid` | **No** | - | `item.id` (restrict) | - |
| 6 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 7 | `piece_id` | `uuid` | Yes | - | `stock_piece.id` (restrict) | Set when a specific tagged piece is involved. |
| 8 | `description` | `text` | Yes | - | - | - |
| 9 | `hsn_code` | `text` | Yes | - | - | - |
| 10 | `quantity` | `numeric(14,3)` | **No** | `1` | - | - |
| 11 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 15 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `making_basis` | `text` | **No** | `'per_gram'` | - | CHECK: `{col} in ('per_gram', 'percent', 'flat')` |
| 18 | `making_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 19 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `wastage_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 21 | `wastage_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 22 | `wastage_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 23 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 24 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 25 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 26 | `gst_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 27 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 28 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 29 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 30 | `line_total` | `numeric(20,4)` | **No** | `0` | - | - |
| 31 | `location_id` | `uuid` | Yes | - | `stock_location.id` (restrict) | - |
| 32 | `notes` | `text` | Yes | - | - | - |
| 33 | `purchase_order_line_id` | `uuid` | Yes | - | `purchase_order_line.id` (restrict) | - |
| 34 | `declared_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 35 | `weight_variance` | `numeric(16,6)` | **No** | `0` | - | - |
| 36 | `tested_purity_percent` | `numeric(7,3)` | Yes | - | - | - |
| 37 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 38 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 39 | `created_by` | `uuid` | Yes | - | - | - |
| 40 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-purchase-invoice"></a>

### Table: `purchase_invoice`

> **Purpose:** What we owe the supplier. This is the document that moves the ledger.

- **Module:** `purchase`
- **Total Columns:** `42`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, doc_number)`
- **Indexes:** `(tenant_id)`, `(supplier_id, doc_date)`, `(status, due_date)`, `(goods_receipt_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `doc_number` | `text` | **No** | - | - | - |
| 4 | `doc_date` | `date` | **No** | - | - | - |
| 5 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 6 | `supplier_id` | `uuid` | **No** | - | `party.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'draft'` | - | CHECK: `{col} in ('draft', 'confirmed', 'posted', 'cancelled', 'closed')` |
| 8 | `reference_number` | `text` | Yes | - | - | The other side's document number. |
| 9 | `reference_date` | `date` | Yes | - | - | - |
| 10 | `notes` | `text` | Yes | - | - | - |
| 11 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 12 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 13 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 14 | `other_charges` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 18 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `round_off` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `total_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 22 | `total_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 23 | `total_net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 24 | `total_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 25 | `posted_at` | `timestamptz` | Yes | - | - | - |
| 26 | `posted_by` | `uuid` | Yes | - | - | - |
| 27 | `cancelled_at` | `timestamptz` | Yes | - | - | - |
| 28 | `cancelled_by` | `uuid` | Yes | - | - | - |
| 29 | `cancel_reason` | `text` | Yes | - | - | - |
| 30 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | The accounting entry created at posting. |
| 31 | `goods_receipt_id` | `uuid` | Yes | - | `goods_receipt.id` (restrict) | - |
| 32 | `purchase_order_id` | `uuid` | Yes | - | `purchase_order.id` (restrict) | - |
| 33 | `supplier_invoice_number` | `text` | Yes | - | - | - |
| 34 | `supplier_invoice_date` | `date` | Yes | - | - | - |
| 35 | `due_date` | `date` | Yes | - | - | - |
| 36 | `raises_stock` | `boolean` | **No** | `false` | - | - |
| 37 | `paid_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 38 | `metal_settled_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 39 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 40 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 41 | `created_by` | `uuid` | Yes | - | - | - |
| 42 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-purchase-invoice-line"></a>

### Table: `purchase_invoice_line`

- **Module:** `purchase`
- **Total Columns:** `37`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, purchase_invoice_id, line_number)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `quantity_positive`: `quantity > 0`; `weights_not_negative`: `gross_weight >= 0 and net_weight >= 0 and fine_weight >= 0`; `net_within_gross`: `net_weight <= gross_weight`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `purchase_invoice_id` | `uuid` | **No** | - | `purchase_invoice.id` (cascade) | - |
| 4 | `line_number` | `integer` | **No** | - | - | - |
| 5 | `item_id` | `uuid` | **No** | - | `item.id` (restrict) | - |
| 6 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 7 | `piece_id` | `uuid` | Yes | - | `stock_piece.id` (restrict) | Set when a specific tagged piece is involved. |
| 8 | `description` | `text` | Yes | - | - | - |
| 9 | `hsn_code` | `text` | Yes | - | - | - |
| 10 | `quantity` | `numeric(14,3)` | **No** | `1` | - | - |
| 11 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 15 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `making_basis` | `text` | **No** | `'per_gram'` | - | CHECK: `{col} in ('per_gram', 'percent', 'flat')` |
| 18 | `making_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 19 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `wastage_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 21 | `wastage_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 22 | `wastage_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 23 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 24 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 25 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 26 | `gst_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 27 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 28 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 29 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 30 | `line_total` | `numeric(20,4)` | **No** | `0` | - | - |
| 31 | `location_id` | `uuid` | Yes | - | `stock_location.id` (restrict) | - |
| 32 | `notes` | `text` | Yes | - | - | - |
| 33 | `goods_receipt_line_id` | `uuid` | Yes | - | `goods_receipt_line.id` (restrict) | - |
| 34 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 35 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 36 | `created_by` | `uuid` | Yes | - | - | - |
| 37 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-purchase-order"></a>

### Table: `purchase_order`

> **Purpose:** What we asked the supplier for. Affects nothing until goods arrive.

- **Module:** `purchase`
- **Total Columns:** `37`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, doc_number)`
- **Indexes:** `(tenant_id)`, `(supplier_id, doc_date)`, `(status, doc_date)`, `(branch_id, doc_date)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `doc_number` | `text` | **No** | - | - | - |
| 4 | `doc_date` | `date` | **No** | - | - | - |
| 5 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 6 | `supplier_id` | `uuid` | **No** | - | `party.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'draft'` | - | CHECK: `{col} in ('draft', 'confirmed', 'posted', 'cancelled', 'closed')` |
| 8 | `reference_number` | `text` | Yes | - | - | The other side's document number. |
| 9 | `reference_date` | `date` | Yes | - | - | - |
| 10 | `notes` | `text` | Yes | - | - | - |
| 11 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 12 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 13 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 14 | `other_charges` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 18 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `round_off` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `total_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 22 | `total_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 23 | `total_net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 24 | `total_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 25 | `posted_at` | `timestamptz` | Yes | - | - | - |
| 26 | `posted_by` | `uuid` | Yes | - | - | - |
| 27 | `cancelled_at` | `timestamptz` | Yes | - | - | - |
| 28 | `cancelled_by` | `uuid` | Yes | - | - | - |
| 29 | `cancel_reason` | `text` | Yes | - | - | - |
| 30 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | The accounting entry created at posting. |
| 31 | `expected_date` | `date` | Yes | - | - | - |
| 32 | `rate_basis` | `text` | **No** | `'fixed'` | - | CHECK: `{col} in ('fixed', 'on_delivery')` |
| 33 | `fulfilled_weight` | `numeric(16,6)` | **No** | `0` | - | Rolled up from receipts. |
| 34 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 35 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 36 | `created_by` | `uuid` | Yes | - | - | - |
| 37 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-purchase-order-line"></a>

### Table: `purchase_order_line`

- **Module:** `purchase`
- **Total Columns:** `38`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, purchase_order_id, line_number)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `quantity_positive`: `quantity > 0`; `weights_not_negative`: `gross_weight >= 0 and net_weight >= 0 and fine_weight >= 0`; `net_within_gross`: `net_weight <= gross_weight`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `purchase_order_id` | `uuid` | **No** | - | `purchase_order.id` (cascade) | - |
| 4 | `line_number` | `integer` | **No** | - | - | - |
| 5 | `item_id` | `uuid` | **No** | - | `item.id` (restrict) | - |
| 6 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 7 | `piece_id` | `uuid` | Yes | - | `stock_piece.id` (restrict) | Set when a specific tagged piece is involved. |
| 8 | `description` | `text` | Yes | - | - | - |
| 9 | `hsn_code` | `text` | Yes | - | - | - |
| 10 | `quantity` | `numeric(14,3)` | **No** | `1` | - | - |
| 11 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 15 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `making_basis` | `text` | **No** | `'per_gram'` | - | CHECK: `{col} in ('per_gram', 'percent', 'flat')` |
| 18 | `making_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 19 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `wastage_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 21 | `wastage_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 22 | `wastage_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 23 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 24 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 25 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 26 | `gst_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 27 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 28 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 29 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 30 | `line_total` | `numeric(20,4)` | **No** | `0` | - | - |
| 31 | `location_id` | `uuid` | Yes | - | `stock_location.id` (restrict) | - |
| 32 | `notes` | `text` | Yes | - | - | - |
| 33 | `received_quantity` | `numeric(14,3)` | **No** | `0` | - | - |
| 34 | `received_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 35 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 36 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 37 | `created_by` | `uuid` | Yes | - | - | - |
| 38 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-purchase-return"></a>

### Table: `purchase_return`

- **Module:** `purchase`
- **Total Columns:** `38`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, doc_number)`
- **Indexes:** `(tenant_id)`, `(supplier_id, doc_date)`, `(purchase_invoice_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `doc_number` | `text` | **No** | - | - | - |
| 4 | `doc_date` | `date` | **No** | - | - | - |
| 5 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 6 | `supplier_id` | `uuid` | **No** | - | `party.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'draft'` | - | CHECK: `{col} in ('draft', 'confirmed', 'posted', 'cancelled', 'closed')` |
| 8 | `reference_number` | `text` | Yes | - | - | The other side's document number. |
| 9 | `reference_date` | `date` | Yes | - | - | - |
| 10 | `notes` | `text` | Yes | - | - | - |
| 11 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 12 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 13 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 14 | `other_charges` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 18 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `round_off` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `total_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 22 | `total_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 23 | `total_net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 24 | `total_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 25 | `posted_at` | `timestamptz` | Yes | - | - | - |
| 26 | `posted_by` | `uuid` | Yes | - | - | - |
| 27 | `cancelled_at` | `timestamptz` | Yes | - | - | - |
| 28 | `cancelled_by` | `uuid` | Yes | - | - | - |
| 29 | `cancel_reason` | `text` | Yes | - | - | - |
| 30 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | The accounting entry created at posting. |
| 31 | `purchase_invoice_id` | `uuid` | Yes | - | `purchase_invoice.id` (restrict) | - |
| 32 | `goods_receipt_id` | `uuid` | Yes | - | `goods_receipt.id` (restrict) | - |
| 33 | `reason` | `text` | **No** | `'other'` | - | CHECK: `{col} in ('quality', 'wrong_item', 'excess', 'damaged', 'other')` |
| 34 | `credit_note_number` | `text` | Yes | - | - | - |
| 35 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 36 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 37 | `created_by` | `uuid` | Yes | - | - | - |
| 38 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-purchase-return-line"></a>

### Table: `purchase_return_line`

- **Module:** `purchase`
- **Total Columns:** `37`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, purchase_return_id, line_number)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `quantity_positive`: `quantity > 0`; `weights_not_negative`: `gross_weight >= 0 and net_weight >= 0 and fine_weight >= 0`; `net_within_gross`: `net_weight <= gross_weight`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `purchase_return_id` | `uuid` | **No** | - | `purchase_return.id` (cascade) | - |
| 4 | `line_number` | `integer` | **No** | - | - | - |
| 5 | `item_id` | `uuid` | **No** | - | `item.id` (restrict) | - |
| 6 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 7 | `piece_id` | `uuid` | Yes | - | `stock_piece.id` (restrict) | Set when a specific tagged piece is involved. |
| 8 | `description` | `text` | Yes | - | - | - |
| 9 | `hsn_code` | `text` | Yes | - | - | - |
| 10 | `quantity` | `numeric(14,3)` | **No** | `1` | - | - |
| 11 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 15 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `making_basis` | `text` | **No** | `'per_gram'` | - | CHECK: `{col} in ('per_gram', 'percent', 'flat')` |
| 18 | `making_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 19 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `wastage_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 21 | `wastage_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 22 | `wastage_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 23 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 24 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 25 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 26 | `gst_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 27 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 28 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 29 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 30 | `line_total` | `numeric(20,4)` | **No** | `0` | - | - |
| 31 | `location_id` | `uuid` | Yes | - | `stock_location.id` (restrict) | - |
| 32 | `notes` | `text` | Yes | - | - | - |
| 33 | `purchase_invoice_line_id` | `uuid` | Yes | - | `purchase_invoice_line.id` (restrict) | - |
| 34 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 35 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 36 | `created_by` | `uuid` | Yes | - | - | - |
| 37 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Point of Sale (POS) & Sales Invoicing (`sales`)

<a id="table-sales-invoice"></a>

### Table: `sales_invoice`

> **Purpose:** Module 5.2 — counter, wholesale and export billing share this table.

- **Module:** `sales`
- **Total Columns:** `50`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, doc_number)`
- **Indexes:** `(tenant_id)`, `(customer_id, doc_date)`, `(status, doc_date)`, `(branch_id, doc_date)`, `(salesperson_id, doc_date)`, `(irn)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `doc_number` | `text` | **No** | - | - | - |
| 4 | `doc_date` | `date` | **No** | - | - | - |
| 5 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 6 | `customer_id` | `uuid` | **No** | - | `party.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'draft'` | - | CHECK: `{col} in ('draft', 'confirmed', 'posted', 'cancelled', 'closed')` |
| 8 | `reference_number` | `text` | Yes | - | - | The other side's document number. |
| 9 | `reference_date` | `date` | Yes | - | - | - |
| 10 | `notes` | `text` | Yes | - | - | - |
| 11 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 12 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 13 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 14 | `other_charges` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 18 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `round_off` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `total_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 22 | `total_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 23 | `total_net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 24 | `total_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 25 | `posted_at` | `timestamptz` | Yes | - | - | - |
| 26 | `posted_by` | `uuid` | Yes | - | - | - |
| 27 | `cancelled_at` | `timestamptz` | Yes | - | - | - |
| 28 | `cancelled_by` | `uuid` | Yes | - | - | - |
| 29 | `cancel_reason` | `text` | Yes | - | - | - |
| 30 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | The accounting entry created at posting. |
| 31 | `channel` | `text` | **No** | `'counter'` | - | CHECK: `{col} in ('counter', 'wholesale', 'export', 'online')` |
| 32 | `salesperson_id` | `uuid` | Yes | - | `app_user.id` (restrict) | Drives staff-wise sales reports (Module 11.4). |
| 33 | `place_of_supply_code` | `text` | Yes | - | - | - |
| 34 | `is_export` | `boolean` | **No** | `false` | - | - |
| 35 | `export_currency` | `text` | Yes | - | - | - |
| 36 | `export_rate` | `numeric(14,6)` | Yes | - | - | - |
| 37 | `irn` | `text` | Yes | - | - | - |
| 38 | `irn_status` | `text` | **No** | `'not_required'` | - | CHECK: `{col} in ('not_required', 'pending', 'generated', 'cancelled', 'failed')` |
| 39 | `irn_generated_at` | `timestamptz` | Yes | - | - | - |
| 40 | `ack_number` | `text` | Yes | - | - | - |
| 41 | `qr_code_data` | `text` | Yes | - | - | - |
| 42 | `paid_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 43 | `old_gold_amount` | `numeric(20,4)` | **No** | `0` | - | Credit applied from Module 6. |
| 44 | `scheme_amount` | `numeric(20,4)` | **No** | `0` | - | Credit applied from Module 7. |
| 45 | `balance_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 46 | `order_id` | `uuid` | Yes | - | - | Links back to Module 1 once orders are built. |
| 47 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 48 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 49 | `created_by` | `uuid` | Yes | - | - | - |
| 50 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-sales-invoice-line"></a>

### Table: `sales_invoice_line`

- **Module:** `sales`
- **Total Columns:** `39`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, sales_invoice_id, line_number)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `quantity_positive`: `quantity > 0`; `weights_not_negative`: `gross_weight >= 0 and net_weight >= 0 and fine_weight >= 0`; `net_within_gross`: `net_weight <= gross_weight`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `sales_invoice_id` | `uuid` | **No** | - | `sales_invoice.id` (cascade) | - |
| 4 | `line_number` | `integer` | **No** | - | - | - |
| 5 | `item_id` | `uuid` | **No** | - | `item.id` (restrict) | - |
| 6 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 7 | `piece_id` | `uuid` | Yes | - | `stock_piece.id` (restrict) | Set when a specific tagged piece is involved. |
| 8 | `description` | `text` | Yes | - | - | - |
| 9 | `hsn_code` | `text` | Yes | - | - | - |
| 10 | `quantity` | `numeric(14,3)` | **No** | `1` | - | - |
| 11 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 15 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `making_basis` | `text` | **No** | `'per_gram'` | - | CHECK: `{col} in ('per_gram', 'percent', 'flat')` |
| 18 | `making_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 19 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `wastage_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 21 | `wastage_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 22 | `wastage_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 23 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 24 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 25 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 26 | `gst_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 27 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 28 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 29 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 30 | `line_total` | `numeric(20,4)` | **No** | `0` | - | - |
| 31 | `location_id` | `uuid` | Yes | - | `stock_location.id` (restrict) | - |
| 32 | `notes` | `text` | Yes | - | - | - |
| 33 | `cost_value` | `numeric(20,4)` | **No** | `0` | - | - |
| 34 | `hallmark_charge` | `numeric(20,4)` | **No** | `0` | - | - |
| 35 | `certificate_number` | `text` | Yes | - | - | - |
| 36 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 37 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 38 | `created_by` | `uuid` | Yes | - | - | - |
| 39 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-sales-payment"></a>

### Table: `sales_payment`

> **Purpose:** One row per tender. A single sale usually has several.

- **Module:** `sales`
- **Total Columns:** `14`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(sales_invoice_id)`, `(mode, received_at)`
- **Check Constraints:** `amount_positive`: `amount > 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `sales_invoice_id` | `uuid` | **No** | - | `sales_invoice.id` (cascade) | - |
| 4 | `mode` | `text` | **No** | - | - | CHECK: `{col} in ('cash', 'card', 'upi', 'bank_transfer', 'cheque', 'credit', 'old_gold', 'scheme', 'advance')` |
| 5 | `amount` | `numeric(20,4)` | **No** | - | - | - |
| 6 | `reference` | `text` | Yes | - | - | Cheque number, UPI reference, card approval code. |
| 7 | `account_id` | `uuid` | Yes | - | `account.id` (restrict) | Which cash or bank account this landed in. |
| 8 | `received_at` | `timestamptz` | **No** | `now()` | - | - |
| 9 | `old_gold_intake_id` | `uuid` | Yes | - | - | - |
| 10 | `notes` | `text` | Yes | - | - | - |
| 11 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 12 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 13 | `created_by` | `uuid` | Yes | - | - | - |
| 14 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-sales-return"></a>

### Table: `sales_return`

- **Module:** `sales`
- **Total Columns:** `40`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, doc_number)`
- **Indexes:** `(tenant_id)`, `(customer_id, doc_date)`, `(sales_invoice_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `doc_number` | `text` | **No** | - | - | - |
| 4 | `doc_date` | `date` | **No** | - | - | - |
| 5 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 6 | `customer_id` | `uuid` | **No** | - | `party.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'draft'` | - | CHECK: `{col} in ('draft', 'confirmed', 'posted', 'cancelled', 'closed')` |
| 8 | `reference_number` | `text` | Yes | - | - | The other side's document number. |
| 9 | `reference_date` | `date` | Yes | - | - | - |
| 10 | `notes` | `text` | Yes | - | - | - |
| 11 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 12 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 13 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 14 | `other_charges` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 18 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `round_off` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `total_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 22 | `total_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 23 | `total_net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 24 | `total_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 25 | `posted_at` | `timestamptz` | Yes | - | - | - |
| 26 | `posted_by` | `uuid` | Yes | - | - | - |
| 27 | `cancelled_at` | `timestamptz` | Yes | - | - | - |
| 28 | `cancelled_by` | `uuid` | Yes | - | - | - |
| 29 | `cancel_reason` | `text` | Yes | - | - | - |
| 30 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | The accounting entry created at posting. |
| 31 | `sales_invoice_id` | `uuid` | Yes | - | `sales_invoice.id` (restrict) | - |
| 32 | `settlement` | `text` | **No** | `'credit_note'` | - | CHECK: `{col} in ('refund', 'exchange', 'credit_note')` |
| 33 | `reason` | `text` | **No** | `'other'` | - | CHECK: `{col} in ('defect', 'size', 'dislike', 'wrong_item', 'other')` |
| 34 | `retested` | `boolean` | **No** | `false` | - | - |
| 35 | `restock` | `boolean` | **No** | `true` | - | - |
| 36 | `refund_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 37 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 38 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 39 | `created_by` | `uuid` | Yes | - | - | - |
| 40 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-sales-return-line"></a>

### Table: `sales_return_line`

- **Module:** `sales`
- **Total Columns:** `37`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, sales_return_id, line_number)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `quantity_positive`: `quantity > 0`; `weights_not_negative`: `gross_weight >= 0 and net_weight >= 0 and fine_weight >= 0`; `net_within_gross`: `net_weight <= gross_weight`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `sales_return_id` | `uuid` | **No** | - | `sales_return.id` (cascade) | - |
| 4 | `line_number` | `integer` | **No** | - | - | - |
| 5 | `item_id` | `uuid` | **No** | - | `item.id` (restrict) | - |
| 6 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 7 | `piece_id` | `uuid` | Yes | - | `stock_piece.id` (restrict) | Set when a specific tagged piece is involved. |
| 8 | `description` | `text` | Yes | - | - | - |
| 9 | `hsn_code` | `text` | Yes | - | - | - |
| 10 | `quantity` | `numeric(14,3)` | **No** | `1` | - | - |
| 11 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 15 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `making_basis` | `text` | **No** | `'per_gram'` | - | CHECK: `{col} in ('per_gram', 'percent', 'flat')` |
| 18 | `making_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 19 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `wastage_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 21 | `wastage_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 22 | `wastage_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 23 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 24 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 25 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 26 | `gst_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 27 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 28 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 29 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 30 | `line_total` | `numeric(20,4)` | **No** | `0` | - | - |
| 31 | `location_id` | `uuid` | Yes | - | `stock_location.id` (restrict) | - |
| 32 | `notes` | `text` | Yes | - | - | - |
| 33 | `sales_invoice_line_id` | `uuid` | Yes | - | `sales_invoice_line.id` (restrict) | - |
| 34 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 35 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 36 | `created_by` | `uuid` | Yes | - | - | - |
| 37 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Custom Jewellery Orders & Pipelines (`orders`)

<a id="table-order-acknowledgement"></a>

### Table: `order_acknowledgement`

- **Module:** `orders`
- **Total Columns:** `12`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, retail_order_id)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `method_evidence_present`: `(method = 'signature' and signature_storage_key is not null) or (method = 'otp' and otp_reference is not null)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `retail_order_id` | `uuid` | **No** | - | `retail_order.id` (cascade) | - |
| 4 | `method` | `text` | **No** | - | - | CHECK: `{col} in ('signature', 'otp')` |
| 5 | `signature_storage_key` | `text` | Yes | - | - | - |
| 6 | `otp_reference` | `text` | Yes | - | - | The reference returned by the OTP provider, not the code. |
| 7 | `acknowledged_at` | `timestamptz` | **No** | `now()` | - | - |
| 8 | `acknowledged_by_name` | `text` | Yes | - | - | - |
| 9 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 10 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 11 | `created_by` | `uuid` | Yes | - | - | - |
| 12 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-order-attachment"></a>

### Table: `order_attachment`

> **Purpose:** Reference images for custom work, condition photos for repairs.

- **Module:** `orders`
- **Total Columns:** `14`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(retail_order_id, kind)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `retail_order_id` | `uuid` | **No** | - | `retail_order.id` (cascade) | - |
| 4 | `kind` | `text` | **No** | `'reference'` | - | CHECK: `{col} in ('reference', 'intake_photo', 'design', 'cad', 'delivery_proof', 'document')` |
| 5 | `file_name` | `text` | **No** | - | - | - |
| 6 | `storage_key` | `text` | **No** | - | - | - |
| 7 | `content_type` | `text` | Yes | - | - | - |
| 8 | `size_bytes` | `bigint` | Yes | - | - | - |
| 9 | `caption` | `text` | Yes | - | - | - |
| 10 | `sort_order` | `integer` | **No** | `0` | - | - |
| 11 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 12 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 13 | `created_by` | `uuid` | Yes | - | - | - |
| 14 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-order-communication"></a>

### Table: `order_communication`

- **Module:** `orders`
- **Total Columns:** `13`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(retail_order_id, sent_at)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `retail_order_id` | `uuid` | **No** | - | `retail_order.id` (cascade) | - |
| 4 | `channel` | `text` | **No** | `'whatsapp'` | - | CHECK: `{col} in ('sms', 'whatsapp', 'email', 'call', 'in_person')` |
| 5 | `direction` | `text` | **No** | `'outbound'` | - | CHECK: `{col} in ('outbound', 'inbound')` |
| 6 | `message` | `text` | **No** | - | - | - |
| 7 | `sent_at` | `timestamptz` | **No** | `now()` | - | - |
| 8 | `delivery_status` | `text` | **No** | `'queued'` | - | CHECK: `{col} in ('queued', 'sent', 'delivered', 'read', 'failed')` |
| 9 | `actor_user_id` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 10 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 11 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 12 | `created_by` | `uuid` | Yes | - | - | - |
| 13 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-order-line"></a>

### Table: `order_line`

> **Purpose:** A wedding order mixes ready-stock bookings and made-to-order pieces line by line.

- **Module:** `orders`
- **Total Columns:** `35`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, retail_order_id, line_number)`
- **Indexes:** `(tenant_id)`, `(piece_id)`
- **Check Constraints:** `quantity_positive`: `quantity > 0`; `net_within_gross`: `net_weight <= gross_weight`; `title_not_blank`: `length(btrim(title)) > 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `retail_order_id` | `uuid` | **No** | - | `retail_order.id` (cascade) | - |
| 4 | `line_number` | `integer` | **No** | - | - | - |
| 5 | `line_mode` | `text` | **No** | `'booking'` | - | CHECK: `{col} in ('booking', 'custom')` |
| 6 | `title` | `text` | **No** | - | - | - |
| 7 | `design_specification` | `text` | Yes | - | - | - |
| 8 | `item_id` | `uuid` | Yes | - | `item.id` (restrict) | - |
| 9 | `piece_id` | `uuid` | Yes | - | `stock_piece.id` (restrict) | Set when a specific tagged piece is reserved. |
| 10 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 11 | `category_id` | `uuid` | Yes | - | `item_category.id` (restrict) | - |
| 12 | `quantity` | `numeric(14,3)` | **No** | `1` | - | - |
| 13 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 15 | `net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 16 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 18 | `making_basis` | `text` | **No** | `'per_gram'` | - | CHECK: `{col} in ('per_gram', 'percent', 'flat')` |
| 19 | `making_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 20 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `wastage_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 22 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 23 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 24 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 25 | `gst_rate` | `numeric(14,6)` | **No** | `0` | - | - |
| 26 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 27 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 28 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 29 | `line_total` | `numeric(20,4)` | **No** | `0` | - | - |
| 30 | `hsn_code` | `text` | Yes | - | - | - |
| 31 | `special_instructions` | `text` | Yes | - | - | - |
| 32 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 33 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 34 | `created_by` | `uuid` | Yes | - | - | - |
| 35 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-order-payment"></a>

### Table: `order_payment`

> **Purpose:** Advance and token collections against an order, before it is billed.

- **Module:** `orders`
- **Total Columns:** `15`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(retail_order_id)`
- **Check Constraints:** `amount_positive`: `amount > 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `retail_order_id` | `uuid` | **No** | - | `retail_order.id` (cascade) | - |
| 4 | `mode` | `text` | **No** | - | - | CHECK: `{col} in ('cash', 'card', 'upi', 'bank_transfer', 'cheque', 'emi', 'old_gold', 'scheme')` |
| 5 | `amount` | `numeric(20,4)` | **No** | - | - | - |
| 6 | `reference` | `text` | Yes | - | - | - |
| 7 | `received_at` | `timestamptz` | **No** | `now()` | - | - |
| 8 | `receipt_number` | `text` | Yes | - | - | - |
| 9 | `account_id` | `uuid` | Yes | - | `account.id` (restrict) | - |
| 10 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 11 | `notes` | `text` | Yes | - | - | - |
| 12 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 13 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `created_by` | `uuid` | Yes | - | - | - |
| 15 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-order-pipeline"></a>

### Table: `order_pipeline`

> **Purpose:** Config-driven Kanban stages. Absent rows fall back to the built-in defaults.

- **Module:** `orders`
- **Total Columns:** `9`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, order_type)`
- **Indexes:** `(tenant_id)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `order_type` | `text` | **No** | - | - | CHECK: `{col} in ('booking', 'custom', 'repair', 'wedding', 'corporate')` |
| 4 | `stages` | `jsonb` | **No** | `'[]'::jsonb` | - | - |
| 5 | `is_active` | `boolean` | **No** | `true` | - | - |
| 6 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 7 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 8 | `created_by` | `uuid` | Yes | - | - | - |
| 9 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-order-stage-event"></a>

### Table: `order_stage_event`

- **Module:** `orders`
- **Total Columns:** `11`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** None
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(retail_order_id, at)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `retail_order_id` | `uuid` | **No** | - | `retail_order.id` (cascade) | - |
| 4 | `at` | `timestamptz` | **No** | `now()` | - | - |
| 5 | `from_stage` | `text` | Yes | - | - | - |
| 6 | `to_stage` | `text` | **No** | - | - | - |
| 7 | `direction` | `text` | **No** | `'forward'` | - | CHECK: `{col} in ('forward', 'backward', 'same')` |
| 8 | `reason` | `text` | Yes | - | - | - |
| 9 | `note` | `text` | Yes | - | - | - |
| 10 | `actor_user_id` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 11 | `karigar_id` | `uuid` | Yes | - | `karigar.id` (restrict) | - |

---

<a id="table-retail-order"></a>

### Table: `retail_order`

> **Purpose:** All five order types. Type-specific fields are null for the others.

- **Module:** `orders`
- **Total Columns:** `62`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, order_number)`
- **Indexes:** `(tenant_id)`, `(order_type, stage)`, `(customer_id, order_date)`, `(branch_id, order_date)`, `(status, expected_delivery_date)`, `(karigar_id)`, `(expected_delivery_date)`
- **Check Constraints:** `budget_range`: `budget_min is null or budget_max is null or budget_min <= budget_max`; `advance_within_total`: `advance_amount <= total_amount + 0.01`; `amounts_not_negative`: `metal_amount >= 0 and making_amount >= 0 and stone_amount >= 0 and total_amount >= 0 and advance_amount >= 0`; `corporate_needs_po`: `order_type <> 'corporate' or (company_name is not null and po_reference is not null)`; `repair_needs_item`: `order_type <> 'repair' or repair_item_description is not null`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `order_number` | `text` | **No** | - | - | - |
| 4 | `order_type` | `text` | **No** | - | - | CHECK: `{col} in ('booking', 'custom', 'repair', 'wedding', 'corporate')` |
| 5 | `status` | `text` | **No** | `'draft'` | - | CHECK: `{col} in ('draft', 'active', 'completed', 'cancelled')` |
| 6 | `stage` | `text` | **No** | - | - | CHECK: `{col} in ('booked', 'compliance', 'confirmed', 'crafting', 'delivered', 'design', 'finishing', 'intake', 'planning', 'production', 'quality', 'ready', 'received', 'repair', 'sourcing')` |
| 7 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 8 | `customer_id` | `uuid` | **No** | - | `party.id` (restrict) | - |
| 9 | `salesperson_id` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 10 | `karigar_id` | `uuid` | Yes | - | `karigar.id` (restrict) | - |
| 11 | `order_date` | `date` | **No** | - | - | - |
| 12 | `expected_delivery_date` | `date` | **No** | - | - | - |
| 13 | `delivered_at` | `timestamptz` | Yes | - | - | - |
| 14 | `is_sla_breached` | `boolean` | **No** | `false` | - | - |
| 15 | `rate_lock_type` | `text` | **No** | `'today'` | - | CHECK: `{col} in ('today', 'floating', 'fixed_future')` |
| 16 | `locked_rate_per_gram` | `numeric(20,4)` | Yes | - | - | Frozen at booking for today/fixed_future locks. |
| 17 | `rate_locked_at` | `timestamptz` | Yes | - | - | - |
| 18 | `rate_lock_expires_at` | `timestamptz` | Yes | - | - | - |
| 19 | `metal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `making_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `stone_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 22 | `discount_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 23 | `taxable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 24 | `cgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 25 | `sgst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 26 | `igst_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 27 | `total_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 28 | `advance_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 29 | `old_gold_credit` | `numeric(20,4)` | **No** | `0` | - | - |
| 30 | `scheme_credit` | `numeric(20,4)` | **No** | `0` | - | - |
| 31 | `balance_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 32 | `total_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 33 | `total_net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 34 | `requirement_description` | `text` | Yes | - | - | - |
| 35 | `size_specifications` | `text` | Yes | - | - | - |
| 36 | `budget_min` | `numeric(20,4)` | Yes | - | - | - |
| 37 | `budget_max` | `numeric(20,4)` | Yes | - | - | - |
| 38 | `design_approval` | `text` | Yes | - | - | CHECK: `{col} in ('pending', 'approved', 'revision_requested')` |
| 39 | `manufacturing_route` | `text` | Yes | - | - | CHECK: `{col} in ('in_house', 'external')` |
| 40 | `external_manufacturer_id` | `uuid` | Yes | - | `party.id` (restrict) | - |
| 41 | `production_status` | `text` | Yes | - | - | CHECK: `{col} in ('not_started', 'sent_to_manufacturer', 'quote_received', 'in_production', 'completed')` |
| 42 | `repair_item_description` | `text` | Yes | - | - | - |
| 43 | `repair_issue_description` | `text` | Yes | - | - | - |
| 44 | `repair_issue_types` | `jsonb` | **No** | `'[]'::jsonb` | - | - |
| 45 | `under_warranty` | `boolean` | **No** | `false` | - | - |
| 46 | `original_invoice_number` | `text` | Yes | - | - | Links a warranty repair back to the sale. |
| 47 | `event_date` | `date` | Yes | - | - | - |
| 48 | `event_type` | `text` | Yes | - | - | - |
| 49 | `company_name` | `text` | Yes | - | - | - |
| 50 | `company_gstin` | `text` | Yes | - | - | - |
| 51 | `po_reference` | `text` | Yes | - | - | - |
| 52 | `credit_terms` | `text` | Yes | - | - | CHECK: `{col} in ('net_15', 'net_30', 'custom')` |
| 53 | `credit_terms_note` | `text` | Yes | - | - | - |
| 54 | `branding_notes` | `text` | Yes | - | - | - |
| 55 | `notes` | `text` | Yes | - | - | - |
| 56 | `cancelled_at` | `timestamptz` | Yes | - | - | - |
| 57 | `cancel_reason` | `text` | Yes | - | - | - |
| 58 | `sales_invoice_id` | `uuid` | Yes | - | `sales_invoice.id` (restrict) | - |
| 59 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 60 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 61 | `created_by` | `uuid` | Yes | - | - | - |
| 62 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Old Gold Exchange & Melting Batches (`oldgold`)

<a id="table-melt-batch"></a>

### Table: `melt_batch`

> **Purpose:** Scrap collected, melted and assayed. Closes the loop on metal reconciliation.

- **Module:** `oldgold`
- **Total Columns:** `25`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, batch_number)`
- **Indexes:** `(tenant_id)`, `(status, batch_date)`, `(metal_id, batch_date)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `batch_number` | `text` | **No** | - | - | - |
| 4 | `batch_date` | `date` | **No** | - | - | - |
| 5 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 6 | `metal_id` | `uuid` | **No** | - | `metal.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'open'` | - | CHECK: `{col} in ('open', 'sent', 'melted', 'received', 'closed')` |
| 8 | `input_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 9 | `input_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 10 | `output_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 11 | `output_purity_percent` | `numeric(7,3)` | Yes | - | - | - |
| 12 | `output_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `loss_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `refiner_id` | `uuid` | Yes | - | `party.id` (restrict) | The refinery, when sent out. |
| 15 | `refining_charge` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `sent_at` | `timestamptz` | Yes | - | - | - |
| 17 | `received_at` | `timestamptz` | Yes | - | - | - |
| 18 | `assay_certificate_number` | `text` | Yes | - | - | - |
| 19 | `received_into_location_id` | `uuid` | Yes | - | `stock_location.id` (restrict) | - |
| 20 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 21 | `notes` | `text` | Yes | - | - | - |
| 22 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 23 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 24 | `created_by` | `uuid` | Yes | - | - | - |
| 25 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-old-gold-intake"></a>

### Table: `old_gold_intake`

> **Purpose:** The appraisal voucher. One per customer visit.

- **Module:** `oldgold`
- **Total Columns:** `31`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, voucher_number)`
- **Indexes:** `(tenant_id)`, `(customer_id, voucher_date)`, `(status, voucher_date)`, `(branch_id, voucher_date)`
- **Check Constraints:** `weights_not_negative`: `total_gross_weight >= 0 and total_net_weight >= 0`; `net_within_gross`: `total_net_weight <= total_gross_weight`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `voucher_number` | `text` | **No** | - | - | - |
| 4 | `voucher_date` | `date` | **No** | - | - | - |
| 5 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 6 | `customer_id` | `uuid` | **No** | - | `party.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'draft'` | - | CHECK: `{col} in ('draft', 'tested', 'approved', 'settled', 'returned', 'cancelled')` |
| 8 | `settlement_type` | `text` | Yes | - | - | CHECK: `{col} in ('exchange', 'buyback')` |
| 9 | `tested_by` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 10 | `approved_by` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 11 | `approved_at` | `timestamptz` | Yes | - | - | - |
| 12 | `total_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 13 | `total_deduction_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `total_net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 15 | `total_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 16 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `gross_value` | `numeric(20,4)` | **No** | `0` | - | - |
| 18 | `deduction_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `net_value` | `numeric(20,4)` | **No** | `0` | - | - |
| 20 | `applied_to_invoice_id` | `uuid` | Yes | - | `sales_invoice.id` (restrict) | - |
| 21 | `applied_to_order_id` | `uuid` | Yes | - | `retail_order.id` (restrict) | - |
| 22 | `payout_mode` | `text` | Yes | - | - | CHECK: `{col} in ('cash', 'bank_transfer', 'upi', 'cheque')` |
| 23 | `payout_reference` | `text` | Yes | - | - | - |
| 24 | `settled_at` | `timestamptz` | Yes | - | - | - |
| 25 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 26 | `melt_batch_id` | `uuid` | Yes | - | `melt_batch.id` (restrict) | - |
| 27 | `notes` | `text` | Yes | - | - | - |
| 28 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 29 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 30 | `created_by` | `uuid` | Yes | - | - | - |
| 31 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-old-gold-item"></a>

### Table: `old_gold_item`

> **Purpose:** One row per physical article brought in. Weighed and tested individually.

- **Module:** `oldgold`
- **Total Columns:** `28`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, old_gold_intake_id, line_number)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `gross_positive`: `gross_weight > 0`; `deductions_within_gross`: `stone_weight + dirt_weight + solder_weight <= gross_weight`; `net_within_gross`: `net_weight <= gross_weight`; `purity_range`: `tested_purity_percent > 0 and tested_purity_percent <= 100`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `old_gold_intake_id` | `uuid` | **No** | - | `old_gold_intake.id` (cascade) | - |
| 4 | `line_number` | `integer` | **No** | - | - | - |
| 5 | `description` | `text` | **No** | - | - | - |
| 6 | `item_category_id` | `uuid` | Yes | - | `item_category.id` (restrict) | - |
| 7 | `metal_id` | `uuid` | **No** | - | `metal.id` (restrict) | - |
| 8 | `gross_weight` | `numeric(16,6)` | **No** | - | - | - |
| 9 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 10 | `dirt_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 11 | `solder_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `net_weight` | `numeric(16,6)` | **No** | - | - | - |
| 13 | `test_method` | `text` | **No** | `'xrf'` | - | CHECK: `{col} in ('xrf', 'touchstone', 'fire_assay', 'declared', 'visual')` |
| 14 | `tested_purity_percent` | `numeric(7,3)` | **No** | - | - | - |
| 15 | `declared_purity_percent` | `numeric(7,3)` | Yes | - | - | - |
| 16 | `test_instrument` | `text` | Yes | - | - | - |
| 17 | `test_reading_raw` | `jsonb` | **No** | `'{}'::jsonb` | - | - |
| 18 | `tested_at` | `timestamptz` | Yes | - | - | - |
| 19 | `fine_weight` | `numeric(16,6)` | **No** | - | - | net_weight x tested_purity_percent. |
| 20 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `value` | `numeric(20,4)` | **No** | `0` | - | - |
| 22 | `photo_storage_key` | `text` | Yes | - | - | - |
| 23 | `is_returned` | `boolean` | **No** | `false` | - | - |
| 24 | `notes` | `text` | Yes | - | - | - |
| 25 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 26 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 27 | `created_by` | `uuid` | Yes | - | - | - |
| 28 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Chit Funds & Gold Savings Schemes (Swarna Nidhi) (`schemes`)

<a id="table-scheme-account"></a>

### Table: `scheme_account`

> **Purpose:** One customer enrolled in one scheme.

- **Module:** `schemes`
- **Total Columns:** `30`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, account_number)`
- **Indexes:** `(tenant_id)`, `(customer_id, status)`, `(status, maturity_date)`, `(branch_id, status)`, `(due_day)`
- **Check Constraints:** `due_day_valid`: `due_day between 1 and 28`; `totals_not_negative`: `total_paid >= 0 and installments_paid >= 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `account_number` | `text` | **No** | - | - | - |
| 4 | `scheme_plan_id` | `uuid` | **No** | - | `scheme_plan.id` (restrict) | - |
| 5 | `customer_id` | `uuid` | **No** | - | `party.id` (restrict) | - |
| 6 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 7 | `status` | `text` | **No** | `'active'` | - | CHECK: `{col} in ('active', 'matured', 'redeemed', 'defaulted', 'cancelled', 'closed')` |
| 8 | `enrolled_on` | `date` | **No** | - | - | - |
| 9 | `maturity_date` | `date` | **No** | - | - | - |
| 10 | `due_day` | `integer` | **No** | `1` | - | - |
| 11 | `installment_amount` | `numeric(20,4)` | **No** | - | - | - |
| 12 | `installments_paid` | `integer` | **No** | `0` | - | - |
| 13 | `installments_due` | `integer` | **No** | `0` | - | - |
| 14 | `total_paid` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `total_weight_accrued` | `numeric(16,6)` | **No** | `0` | - | - |
| 16 | `bonus_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `bonus_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 18 | `redeemable_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `redeemable_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 20 | `is_bonus_forfeited` | `boolean` | **No** | `false` | - | - |
| 21 | `nominee_name` | `text` | Yes | - | - | - |
| 22 | `nominee_relationship` | `text` | Yes | - | - | - |
| 23 | `nominee_phone` | `text` | Yes | - | - | - |
| 24 | `matured_at` | `timestamptz` | Yes | - | - | - |
| 25 | `closed_at` | `timestamptz` | Yes | - | - | - |
| 26 | `close_reason` | `text` | Yes | - | - | - |
| 27 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 28 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 29 | `created_by` | `uuid` | Yes | - | - | - |
| 30 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-scheme-installment"></a>

### Table: `scheme_installment`

> **Purpose:** The full schedule, generated at enrollment. Each row is later paid or missed.

- **Module:** `schemes`
- **Total Columns:** `23`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, scheme_account_id, installment_number)`
- **Indexes:** `(tenant_id)`, `(due_date, status)`, `(status, due_date)`, `(scheme_account_id, status)`
- **Check Constraints:** `amounts_not_negative`: `amount_due >= 0 and amount_paid >= 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `scheme_account_id` | `uuid` | **No** | - | `scheme_account.id` (cascade) | - |
| 4 | `installment_number` | `integer` | **No** | - | - | - |
| 5 | `due_date` | `date` | **No** | - | - | - |
| 6 | `status` | `text` | **No** | `'due'` | - | CHECK: `{col} in ('due', 'paid', 'missed', 'waived', 'advance')` |
| 7 | `amount_due` | `numeric(20,4)` | **No** | - | - | - |
| 8 | `amount_paid` | `numeric(20,4)` | **No** | `0` | - | - |
| 9 | `paid_on` | `date` | Yes | - | - | - |
| 10 | `rate_per_gram` | `numeric(20,4)` | Yes | - | - | - |
| 11 | `weight_accrued` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `payment_mode` | `text` | Yes | - | - | CHECK: `{col} in ('cash', 'card', 'upi', 'bank_transfer', 'cheque', 'auto_debit')` |
| 13 | `payment_reference` | `text` | Yes | - | - | - |
| 14 | `receipt_number` | `text` | Yes | - | - | - |
| 15 | `collected_by` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 16 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 17 | `last_reminder_at` | `timestamptz` | Yes | - | - | - |
| 18 | `reminder_count` | `integer` | **No** | `0` | - | - |
| 19 | `notes` | `text` | Yes | - | - | - |
| 20 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 21 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 22 | `created_by` | `uuid` | Yes | - | - | - |
| 23 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-scheme-plan"></a>

### Table: `scheme_plan`

> **Purpose:** The scheme product: tenure, installment, bonus rules.

- **Module:** `schemes`
- **Total Columns:** `25`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Unique Constraints:** `(tenant_id, code)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `tenure_positive`: `tenure_months > 0`; `bonus_not_negative`: `bonus_installments >= 0 and bonus_percent >= 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `code` | `text` | **No** | - | - | - |
| 4 | `name` | `text` | **No** | - | - | - |
| 5 | `description` | `text` | Yes | - | - | - |
| 6 | `metal_id` | `uuid` | **No** | - | `metal.id` (restrict) | - |
| 7 | `accrual_basis` | `text` | **No** | `'rupee'` | - | CHECK: `{col} in ('rupee', 'weight')` |
| 8 | `tenure_months` | `integer` | **No** | - | - | - |
| 9 | `installment_amount` | `numeric(20,4)` | Yes | - | - | Null for flexible-amount schemes. |
| 10 | `minimum_installment` | `numeric(20,4)` | Yes | - | - | - |
| 11 | `is_flexible_amount` | `boolean` | **No** | `false` | - | - |
| 12 | `bonus_installments` | `numeric(6,3)` | **No** | `0` | - | - |
| 13 | `bonus_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 14 | `max_missed_installments` | `integer` | **No** | `2` | - | - |
| 15 | `making_charge_discount_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 16 | `allow_partial_redemption` | `boolean` | **No** | `false` | - | - |
| 17 | `allow_cash_redemption` | `boolean` | **No** | `false` | - | - |
| 18 | `grace_period_days` | `integer` | **No** | `7` | - | - |
| 19 | `terms_and_conditions` | `text` | Yes | - | - | - |
| 20 | `is_active` | `boolean` | **No** | `true` | - | - |
| 21 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 22 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 23 | `created_by` | `uuid` | Yes | - | - | - |
| 24 | `updated_by` | `uuid` | Yes | - | - | - |
| 25 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---

<a id="table-scheme-redemption"></a>

### Table: `scheme_redemption`

> **Purpose:** Turning a matured account into jewellery. Partial redemption leaves the account open.

- **Module:** `schemes`
- **Total Columns:** `20`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, redemption_number)`
- **Indexes:** `(tenant_id)`, `(scheme_account_id, redeemed_on)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `scheme_account_id` | `uuid` | **No** | - | `scheme_account.id` (restrict) | - |
| 4 | `redemption_number` | `text` | **No** | - | - | - |
| 5 | `redeemed_on` | `date` | **No** | - | - | - |
| 6 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 7 | `is_partial` | `boolean` | **No** | `false` | - | - |
| 8 | `amount_redeemed` | `numeric(20,4)` | **No** | `0` | - | - |
| 9 | `weight_redeemed` | `numeric(16,6)` | **No** | `0` | - | - |
| 10 | `bonus_applied` | `numeric(20,4)` | **No** | `0` | - | - |
| 11 | `rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 12 | `sales_invoice_id` | `uuid` | Yes | - | `sales_invoice.id` (restrict) | - |
| 13 | `retail_order_id` | `uuid` | Yes | - | `retail_order.id` (restrict) | - |
| 14 | `cash_paid_out` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 16 | `notes` | `text` | Yes | - | - | - |
| 17 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 18 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 19 | `created_by` | `uuid` | Yes | - | - | - |
| 20 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Mortgage & Girvi Pawn Loans (`girvi`)

<a id="table-girvi-accrual"></a>

### Table: `girvi_accrual`

> **Purpose:** One row per interest period. Written once, never recalculated.

- **Module:** `girvi`
- **Total Columns:** `16`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, girvi_loan_id, period_start)`
- **Indexes:** `(tenant_id)`, `(period_end)`
- **Check Constraints:** `period_ordered`: `period_end >= period_start`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `girvi_loan_id` | `uuid` | **No** | - | `girvi_loan.id` (cascade) | - |
| 4 | `period_start` | `date` | **No** | - | - | - |
| 5 | `period_end` | `date` | **No** | - | - | - |
| 6 | `principal_base` | `numeric(20,4)` | **No** | - | - | - |
| 7 | `rate_monthly` | `numeric(14,6)` | **No** | - | - | - |
| 8 | `days` | `integer` | **No** | - | - | - |
| 9 | `interest_amount` | `numeric(20,4)` | **No** | - | - | - |
| 10 | `is_waived` | `boolean` | **No** | `false` | - | - |
| 11 | `waive_reason` | `text` | Yes | - | - | - |
| 12 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 13 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 14 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 15 | `created_by` | `uuid` | Yes | - | - | - |
| 16 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-girvi-collateral"></a>

### Table: `girvi_collateral`

> **Purpose:** The individual articles held against the loan.

- **Module:** `girvi`
- **Total Columns:** `24`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, girvi_loan_id, line_number)`
- **Indexes:** `(tenant_id)`
- **Check Constraints:** `gross_positive`: `gross_weight > 0`; `net_within_gross`: `net_weight <= gross_weight`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `girvi_loan_id` | `uuid` | **No** | - | `girvi_loan.id` (cascade) | - |
| 4 | `line_number` | `integer` | **No** | - | - | - |
| 5 | `description` | `text` | **No** | - | - | - |
| 6 | `item_category_id` | `uuid` | Yes | - | `item_category.id` (restrict) | - |
| 7 | `metal_id` | `uuid` | **No** | - | `metal.id` (restrict) | - |
| 8 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 9 | `quantity` | `integer` | **No** | `1` | - | - |
| 10 | `gross_weight` | `numeric(16,6)` | **No** | - | - | - |
| 11 | `stone_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `net_weight` | `numeric(16,6)` | **No** | - | - | - |
| 13 | `fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 14 | `tested_purity_percent` | `numeric(7,3)` | Yes | - | - | - |
| 15 | `test_method` | `text` | **No** | `'xrf'` | - | CHECK: `{col} in ('xrf', 'touchstone', 'declared')` |
| 16 | `appraised_value` | `numeric(20,4)` | **No** | `0` | - | - |
| 17 | `condition_notes` | `text` | Yes | - | - | - |
| 18 | `photo_storage_key` | `text` | Yes | - | - | - |
| 19 | `is_released` | `boolean` | **No** | `false` | - | - |
| 20 | `released_at` | `timestamptz` | Yes | - | - | - |
| 21 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 22 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 23 | `created_by` | `uuid` | Yes | - | - | - |
| 24 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-girvi-loan"></a>

### Table: `girvi_loan`

> **Purpose:** The pawn agreement.

- **Module:** `girvi`
- **Total Columns:** `49`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, loan_number)`
- **Indexes:** `(tenant_id)`, `(status, due_date)`, `(customer_id)`, `(borrower_phone)`, `(vault_packet_number)`, `(branch_id, sanctioned_on)`
- **Check Constraints:** `ltv_within_cap`: `ltv_percent > 0 and ltv_percent <= 90`; `principal_within_eligible`: `principal_amount <= max_eligible_amount + 0.01`; `amounts_not_negative`: `principal_amount >= 0 and interest_accrued >= 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `loan_number` | `text` | **No** | - | - | - |
| 4 | `status` | `text` | **No** | `'draft'` | - | CHECK: `{col} in ('draft', 'sanctioned', 'active', 'overdue', 'redeemed', 'defaulted', 'auctioned', 'cancelled')` |
| 5 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 6 | `customer_id` | `uuid` | Yes | - | `party.id` (restrict) | - |
| 7 | `borrower_name` | `text` | **No** | - | - | - |
| 8 | `borrower_phone` | `text` | **No** | - | - | - |
| 9 | `borrower_address` | `text` | Yes | - | - | - |
| 10 | `borrower_id_type` | `text` | Yes | - | - | CHECK: `{col} in ('aadhaar', 'pan', 'voter', 'driving_licence', 'passport')` |
| 11 | `borrower_id_number` | `text` | Yes | - | - | - |
| 12 | `borrower_photo_key` | `text` | Yes | - | - | - |
| 13 | `sanctioned_on` | `date` | Yes | - | - | - |
| 14 | `due_date` | `date` | Yes | - | - | - |
| 15 | `total_gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 16 | `total_net_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 17 | `total_fine_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 18 | `appraised_value` | `numeric(20,4)` | **No** | `0` | - | - |
| 19 | `ltv_percent` | `numeric(14,6)` | **No** | `75` | - | - |
| 20 | `max_eligible_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 21 | `principal_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 22 | `interest_rate_monthly` | `numeric(14,6)` | **No** | `0` | - | - |
| 23 | `interest_method` | `text` | **No** | `'simple'` | - | CHECK: `{col} in ('simple', 'compound')` |
| 24 | `processing_fee` | `numeric(20,4)` | **No** | `0` | - | - |
| 25 | `disbursed_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 26 | `disbursal_mode` | `text` | Yes | - | - | CHECK: `{col} in ('cash', 'bank_transfer', 'upi', 'cheque')` |
| 27 | `disbursal_reference` | `text` | Yes | - | - | - |
| 28 | `disbursed_at` | `timestamptz` | Yes | - | - | - |
| 29 | `interest_accrued` | `numeric(20,4)` | **No** | `0` | - | - |
| 30 | `interest_paid` | `numeric(20,4)` | **No** | `0` | - | - |
| 31 | `principal_repaid` | `numeric(20,4)` | **No** | `0` | - | - |
| 32 | `outstanding_amount` | `numeric(20,4)` | **No** | `0` | - | - |
| 33 | `last_accrued_on` | `date` | Yes | - | - | - |
| 34 | `vault_packet_number` | `text` | Yes | - | - | The sealed packet the collateral sits in. |
| 35 | `vault_location_id` | `uuid` | Yes | - | `stock_location.id` (restrict) | - |
| 36 | `packet_sealed_at` | `timestamptz` | Yes | - | - | - |
| 37 | `packet_opened_at` | `timestamptz` | Yes | - | - | - |
| 38 | `redeemed_at` | `timestamptz` | Yes | - | - | - |
| 39 | `release_receipt_number` | `text` | Yes | - | - | - |
| 40 | `default_notice_sent_at` | `timestamptz` | Yes | - | - | - |
| 41 | `auction_date` | `date` | Yes | - | - | - |
| 42 | `auction_proceeds` | `numeric(20,4)` | Yes | - | - | - |
| 43 | `surplus_returned` | `numeric(20,4)` | Yes | - | - | - |
| 44 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 45 | `notes` | `text` | Yes | - | - | - |
| 46 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 47 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 48 | `created_by` | `uuid` | Yes | - | - | - |
| 49 | `updated_by` | `uuid` | Yes | - | - | - |

---

<a id="table-girvi-repayment"></a>

### Table: `girvi_repayment`

> **Purpose:** Money coming back in. Interest is cleared before principal.

- **Module:** `girvi`
- **Total Columns:** `19`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Unique Constraints:** `(tenant_id, receipt_number)`
- **Indexes:** `(tenant_id)`, `(girvi_loan_id, paid_on)`
- **Check Constraints:** `amount_positive`: `amount > 0`; `components_sum_to_amount`: `abs((interest_component + principal_component + penalty_component) - amount) < 0.01`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `girvi_loan_id` | `uuid` | **No** | - | `girvi_loan.id` (cascade) | - |
| 4 | `receipt_number` | `text` | **No** | - | - | - |
| 5 | `paid_on` | `date` | **No** | - | - | - |
| 6 | `amount` | `numeric(20,4)` | **No** | - | - | - |
| 7 | `interest_component` | `numeric(20,4)` | **No** | `0` | - | - |
| 8 | `principal_component` | `numeric(20,4)` | **No** | `0` | - | - |
| 9 | `penalty_component` | `numeric(20,4)` | **No** | `0` | - | - |
| 10 | `mode` | `text` | **No** | `'cash'` | - | CHECK: `{col} in ('cash', 'card', 'upi', 'bank_transfer', 'cheque')` |
| 11 | `reference` | `text` | Yes | - | - | - |
| 12 | `collected_by` | `uuid` | Yes | - | `app_user.id` (restrict) | - |
| 13 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 14 | `outstanding_after` | `numeric(20,4)` | **No** | `0` | - | - |
| 15 | `notes` | `text` | Yes | - | - | - |
| 16 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 17 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 18 | `created_by` | `uuid` | Yes | - | - | - |
| 19 | `updated_by` | `uuid` | Yes | - | - | - |

---


## Module: Karigar / Artisan Management (`master`)

<a id="table-karigar"></a>

### Table: `karigar`

> **Purpose:** Goldsmith master. Can be an employee or an outside workshop.

- **Module:** `master`
- **Total Columns:** `21`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** Yes (`deleted_at`)
- **Unique Constraints:** `(tenant_id, code)`
- **Indexes:** `(tenant_id)`, `(name)`, `(engagement, is_active)`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `code` | `text` | **No** | - | - | - |
| 4 | `name` | `text` | **No** | - | - | - |
| 5 | `workshop_name` | `text` | Yes | - | - | - |
| 6 | `engagement` | `text` | **No** | `'external'` | - | CHECK: `{col} in ('in_house', 'external')` |
| 7 | `speciality` | `text` | Yes | - | - | - |
| 8 | `phone` | `text` | Yes | - | - | - |
| 9 | `address` | `text` | Yes | - | - | - |
| 10 | `pan` | `text` | Yes | - | - | - |
| 11 | `gstin` | `text` | Yes | - | - | - |
| 12 | `standard_ghat_percent` | `numeric(14,6)` | **No** | `0` | - | - |
| 13 | `labour_rate_per_gram` | `numeric(20,4)` | **No** | `0` | - | - |
| 14 | `metal_balance_fine` | `numeric(16,6)` | **No** | `0` | - | - |
| 15 | `wage_balance` | `numeric(20,4)` | **No** | `0` | - | - |
| 16 | `is_active` | `boolean` | **No** | `true` | - | - |
| 17 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 18 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 19 | `created_by` | `uuid` | Yes | - | - | - |
| 20 | `updated_by` | `uuid` | Yes | - | - | - |
| 21 | `deleted_at` | `timestamptz` | Yes | - | - | - |

---

<a id="table-karigar-ledger"></a>

### Table: `karigar_ledger`

> **Purpose:** Metal and wages per karigar. Append-only.

- **Module:** `master`
- **Total Columns:** `21`
- **Scope:** 🏢 **Tenant-Scoped** (Row Level Security Isolated)
- **Timestamps:** `created_at`, `updated_at`, `created_by`, `updated_by`
- **Soft Delete:** No (Hard delete)
- **Indexes:** `(tenant_id)`, `(karigar_id, entry_date)`, `(retail_order_id)`, `(entry_type, entry_date)`
- **Check Constraints:** `one_metal_direction`: `weight_in = 0 or weight_out = 0`; `one_money_direction`: `amount_debit = 0 or amount_credit = 0`

#### Columns

| # | Column Name | Data Type | Nullable | Default | FK Reference | Description / Constraint |
|---|---|---|:---:|---|---|---|
| 1 | **`id`** 🔑 | `uuid` | **No** | - | - | Primary Key (UUID v7) |
| 2 | `tenant_id` | `uuid` | **No** | - | `tenant.id` (restrict) | Owning tenant. Enforced by Row Level Security, not just by queries. |
| 3 | `karigar_id` | `uuid` | **No** | - | `karigar.id` (restrict) | - |
| 4 | `entry_type` | `text` | **No** | - | - | CHECK: `{col} in ('issue', 'return', 'ghat_allowed', 'ghat_excess', 'wage_earned', 'wage_paid', 'adjustment')` |
| 5 | `entry_date` | `date` | **No** | - | - | - |
| 6 | `branch_id` | `uuid` | **No** | - | `branch.id` (restrict) | - |
| 7 | `metal_id` | `uuid` | Yes | - | `metal.id` (restrict) | - |
| 8 | `purity_id` | `uuid` | Yes | - | `purity.id` (restrict) | - |
| 9 | `gross_weight` | `numeric(16,6)` | **No** | `0` | - | - |
| 10 | `weight_in` | `numeric(16,6)` | **No** | `0` | - | - |
| 11 | `weight_out` | `numeric(16,6)` | **No** | `0` | - | - |
| 12 | `amount_debit` | `numeric(20,4)` | **No** | `0` | - | - |
| 13 | `amount_credit` | `numeric(20,4)` | **No** | `0` | - | - |
| 14 | `retail_order_id` | `uuid` | Yes | - | `retail_order.id` (restrict) | - |
| 15 | `job_card_id` | `uuid` | Yes | - | - | Reserved for the manufacturer production module. |
| 16 | `voucher_id` | `uuid` | Yes | - | `voucher.id` (restrict) | - |
| 17 | `narration` | `text` | Yes | - | - | - |
| 18 | `created_at` | `timestamptz` | **No** | `now()` | - | - |
| 19 | `updated_at` | `timestamptz` | **No** | `now()` | - | - |
| 20 | `created_by` | `uuid` | Yes | - | - | - |
| 21 | `updated_by` | `uuid` | Yes | - | - | - |

---
