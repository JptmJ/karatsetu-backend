# RatnaGrid — Database Reference

Generated from the schema definitions on 2026-09-20.
**Do not edit by hand** — run `npm run gen:docs`.

68 tables · 1504 columns.

---

## How to read this

**Required** says whether you must supply the value when inserting:

- **yes** — no default, and the database rejects a null
- **auto** — required, but filled in for you (a default, or set by the service)
- **no** — optional

**Every table also has these**, added automatically, so they are not repeated below:

| Column | Type | What it is |
|---|---|---|
| `id` | uuid | Primary key. UUID v7, so rows sort by creation time. |
| `tenant_id` | → tenant | Which business owns the row. Enforced by Postgres, not by queries. |
| `created_at` / `updated_at` | timestamp | Set automatically. |
| `created_by` / `updated_by` | → app_user | Who did it. |
| `deleted_at` | timestamp | Only on soft-delete tables. Non-null means hidden. |

A few conventions worth knowing:

- **Money is `money` (numeric 20,4) and weight is `weight` (numeric 16,6), never floats.** They travel as strings in JSON.
- **`→ table`** in the Type column means a foreign key to that table.
- **Weights are grams.** "Fine weight" means pure metal content: 10g of 22K is 9.16g fine.

---

## Tables by module

| Module | Tables | Names |
|---|---|---|
| Dual-Metal & Cash Ledgers | 4 | `account`, `ledger_entry`, `metal_ledger_entry`, `voucher` |
| Core / shared | 1 | `config_value` |
| Business Dashboard | 1 | `dashboard_layout` |
| Mortgage / Girvi (Pawn Loans) | 4 | `girvi_accrual`, `girvi_collateral`, `girvi_loan`, `girvi_repayment` |
| Users & roles | 3 | `app_user`, `audit_log`, `refresh_token` |
| Stock | 3 | `stock_balance`, `stock_movement`, `stock_piece` |
| Master Data & Rate Hub | 2 | `karigar`, `karigar_ledger` |
| masters | 8 | `branch`, `item`, `item_category`, `metal`, `metal_rate`, `party`, `purity`, `stock_location` |
| Document numbering | 2 | `numbering_gap`, `numbering_series` |
| Old Gold Exchange & Melt | 3 | `melt_batch`, `old_gold_intake`, `old_gold_item` |
| Custom Orders & Karigar | 8 | `order_acknowledgement`, `order_attachment`, `order_communication`, `order_line`, `order_payment`, `order_pipeline`, `order_stage_event`, `retail_order` |
| Platform Operator & SaaS Admin | 6 | `feature_flag`, `platform_audit_log`, `platform_refresh_token`, `platform_user`, `support_session`, `tenant_module` |
| Purchase | 8 | `goods_receipt`, `goods_receipt_line`, `purchase_invoice`, `purchase_invoice_line`, `purchase_order`, `purchase_order_line`, `purchase_return`, `purchase_return_line` |
| Sales / POS | 5 | `sales_invoice`, `sales_invoice_line`, `sales_payment`, `sales_return`, `sales_return_line` |
| Swarna Nidhi (Chit Schemes) | 4 | `scheme_account`, `scheme_installment`, `scheme_plan`, `scheme_redemption` |
| Settings & Theme Studio | 1 | `tenant_theme` |
| Tagging & Barcoding | 4 | `huid_assignment`, `tag_print_job`, `tag_print_job_item`, `tag_template` |
| Tenancy | 1 | `tenant` |

---

## Dual-Metal & Cash Ledgers

### `account`

Chart of accounts (Module 9.2).

soft delete · unique: code

| Column | Type | Required | Notes |
|---|---|---|---|
| `code` | text | **yes** |  |
| `name` | text | **yes** |  |
| `account_type` | text | **yes** | one of: asset, liability, equity, income, expense |
| `parent_id` | → account | no |  |
| `is_control` | boolean | auto | default false |
| `control_for` | text | no | one of: customer, supplier, karigar |
| `tracks_metal` | boolean | auto | default false |
| `is_system` | boolean | auto | default false |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `code`, `name`, `account_type`

---

### `ledger_entry`

The money side. Debits and credits in the base currency.


| Column | Type | Required | Notes |
|---|---|---|---|
| `voucher_id` | → voucher | **yes** |  |
| `account_id` | → account | **yes** |  |
| `party_id` | → party | no |  |
| `branch_id` | → branch | **yes** |  |
| `entry_date` | date | **yes** |  |
| `debit` | money | auto | default 0 |
| `credit` | money | auto | default 0 |
| `narration` | text | no |  |
| `against_type` | text | no |  |
| `against_id` | uuid | no |  |

**Must supply on insert:** `voucher_id`, `account_id`, `branch_id`, `entry_date`

---

### `metal_ledger_entry`

The metal side. Weights in fine grams, so 22K and 24K are directly comparable.


| Column | Type | Required | Notes |
|---|---|---|---|
| `voucher_id` | → voucher | **yes** |  |
| `account_id` | → account | **yes** |  |
| `party_id` | → party | no |  |
| `branch_id` | → branch | **yes** |  |
| `entry_date` | date | **yes** |  |
| `metal_id` | → metal | **yes** |  |
| `purity_id` | → purity | no |  |
| `gross_weight` | weight (g) | auto | default 0 |
| `weight_in` | weight (g) | auto | default 0 |
| `weight_out` | weight (g) | auto | default 0 |
| `rate_per_gram` | money | no |  |
| `narration` | text | no |  |

**Must supply on insert:** `voucher_id`, `account_id`, `branch_id`, `entry_date`, `metal_id`

---

### `voucher`

The accounting header. Every posted document creates exactly one.

unique: voucher_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `voucher_number` | text | **yes** |  |
| `voucher_type` | text | **yes** | one of: opening, purchase, purchase_return, sale, sales_return, receipt, payment, journal, old_gold, scheme, mortgage, production |
| `voucher_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `narration` | text | no |  |
| `source_type` | text | **yes** |  |
| `source_id` | uuid | **yes** |  |
| `is_reversed` | boolean | auto | default false |
| `reverses_voucher_id` | → voucher | no |  |

**Must supply on insert:** `voucher_number`, `voucher_type`, `voucher_date`, `branch_id`, `source_type`, `source_id`


## Core / shared

### `config_value`

Per-tenant and per-branch overrides of the settings declared in code.

unique: branch_id + config_key

| Column | Type | Required | Notes |
|---|---|---|---|
| `branch_id` | → branch | no | Null means the value applies to the whole tenant. |
| `config_key` | text | **yes** |  |
| `value` | json | **yes** | Always an object: { "v": <the value> }. |
| `updated_reason` | text | no |  |

**Must supply on insert:** `config_key`, `value`


## Business Dashboard

### `dashboard_layout`



unique: user_id + role_code

| Column | Type | Required | Notes |
|---|---|---|---|
| `user_id` | → app_user | no | Null when this is a role default. |
| `role_code` | text | no | Set instead of user_id for a role-level default. |
| `widgets` | json | auto | default '[]' |
| `is_default` | boolean | auto | default false |

_Nothing is required beyond the automatic columns._


## Mortgage / Girvi (Pawn Loans)

### `girvi_accrual`

One row per interest period. Written once, never recalculated.

unique: girvi_loan_id + period_start

| Column | Type | Required | Notes |
|---|---|---|---|
| `girvi_loan_id` | → girvi_loan | **yes** |  |
| `period_start` | date | **yes** |  |
| `period_end` | date | **yes** |  |
| `principal_base` | money | **yes** |  |
| `rate_monthly` | rate | **yes** |  |
| `days` | integer | **yes** |  |
| `interest_amount` | money | **yes** |  |
| `is_waived` | boolean | auto | default false |
| `waive_reason` | text | no |  |
| `voucher_id` | → voucher | no |  |

**Must supply on insert:** `girvi_loan_id`, `period_start`, `period_end`, `principal_base`, `rate_monthly`, `days`, `interest_amount`

---

### `girvi_collateral`

The individual articles held against the loan.

unique: girvi_loan_id + line_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `girvi_loan_id` | → girvi_loan | **yes** |  |
| `line_number` | integer | **yes** |  |
| `description` | text | **yes** |  |
| `item_category_id` | → item_category | no |  |
| `metal_id` | → metal | **yes** |  |
| `purity_id` | → purity | no |  |
| `quantity` | integer | auto | default 1 |
| `gross_weight` | weight (g) | **yes** |  |
| `stone_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | **yes** |  |
| `fine_weight` | weight (g) | auto | default 0 |
| `tested_purity_percent` | purity % | no |  |
| `test_method` | text | auto | one of: xrf, touchstone, declared · default 'xrf' |
| `appraised_value` | money | auto | default 0 |
| `condition_notes` | text | no |  |
| `photo_storage_key` | text | no |  |
| `is_released` | boolean | auto | default false |
| `released_at` | timestamp | no |  |

**Must supply on insert:** `girvi_loan_id`, `line_number`, `description`, `metal_id`, `gross_weight`, `net_weight`

---

### `girvi_loan`

The pawn agreement.

unique: loan_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `loan_number` | text | **yes** |  |
| `status` | text | auto | one of: draft, sanctioned, active, overdue, redeemed, defaulted, auctioned, cancelled · default 'draft' |
| `branch_id` | → branch | **yes** |  |
| `customer_id` | → party | no |  |
| `borrower_name` | text | **yes** |  |
| `borrower_phone` | text | **yes** |  |
| `borrower_address` | text | no |  |
| `borrower_id_type` | text | no | one of: aadhaar, pan, voter, driving_licence, passport |
| `borrower_id_number` | text | no |  |
| `borrower_photo_key` | text | no |  |
| `sanctioned_on` | date | no |  |
| `due_date` | date | no |  |
| `total_gross_weight` | weight (g) | auto | default 0 |
| `total_net_weight` | weight (g) | auto | default 0 |
| `total_fine_weight` | weight (g) | auto | default 0 |
| `appraised_value` | money | auto | default 0 |
| `ltv_percent` | rate | auto | default 75 |
| `max_eligible_amount` | money | auto | default 0 |
| `principal_amount` | money | auto | default 0 |
| `interest_rate_monthly` | rate | auto | default 0 |
| `interest_method` | text | auto | one of: simple, compound · default 'simple' |
| `processing_fee` | money | auto | default 0 |
| `disbursed_amount` | money | auto | default 0 |
| `disbursal_mode` | text | no | one of: cash, bank_transfer, upi, cheque |
| `disbursal_reference` | text | no |  |
| `disbursed_at` | timestamp | no |  |
| `interest_accrued` | money | auto | default 0 |
| `interest_paid` | money | auto | default 0 |
| `principal_repaid` | money | auto | default 0 |
| `outstanding_amount` | money | auto | default 0 |
| `last_accrued_on` | date | no |  |
| `vault_packet_number` | text | no | The sealed packet the collateral sits in. |
| `vault_location_id` | → stock_location | no |  |
| `packet_sealed_at` | timestamp | no |  |
| `packet_opened_at` | timestamp | no |  |
| `redeemed_at` | timestamp | no |  |
| `release_receipt_number` | text | no |  |
| `default_notice_sent_at` | timestamp | no |  |
| `auction_date` | date | no |  |
| `auction_proceeds` | money | no |  |
| `surplus_returned` | money | no |  |
| `voucher_id` | → voucher | no |  |
| `notes` | text | no |  |

**Must supply on insert:** `loan_number`, `branch_id`, `borrower_name`, `borrower_phone`

---

### `girvi_repayment`

Money coming back in. Interest is cleared before principal.

unique: receipt_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `girvi_loan_id` | → girvi_loan | **yes** |  |
| `receipt_number` | text | **yes** |  |
| `paid_on` | date | **yes** |  |
| `amount` | money | **yes** |  |
| `interest_component` | money | auto | default 0 |
| `principal_component` | money | auto | default 0 |
| `penalty_component` | money | auto | default 0 |
| `mode` | text | auto | one of: cash, card, upi, bank_transfer, cheque · default 'cash' |
| `reference` | text | no |  |
| `collected_by` | → app_user | no |  |
| `voucher_id` | → voucher | no |  |
| `outstanding_after` | money | auto | default 0 |
| `notes` | text | no |  |

**Must supply on insert:** `girvi_loan_id`, `receipt_number`, `paid_on`, `amount`


## Users & roles

### `app_user`

A person who can sign in. Scoped to one tenant. Created only by the super admin.

soft delete · unique: email

| Column | Type | Required | Notes |
|---|---|---|---|
| `email` | text | **yes** |  |
| `phone` | text | no |  |
| `full_name` | text | **yes** |  |
| `password_hash` | text | **yes** | scrypt: salt:hash, both hex. |
| `role_code` | text | auto | one of: admin, sales, accountant, storekeeper · default 'sales' |
| `is_active` | boolean | auto | default true |
| `default_branch_id` | → branch | no |  |
| `last_login_at` | timestamp | no |  |
| `failed_login_count` | integer | auto | default 0 |
| `locked_until` | timestamp | no |  |

**Must supply on insert:** `email`, `full_name`, `password_hash`

---

### `audit_log`




| Column | Type | Required | Notes |
|---|---|---|---|
| `at` | timestamp | auto |  |
| `user_id` | → app_user | no |  |
| `branch_id` | → branch | no |  |
| `action` | text | **yes** | e.g. "sales_invoice.post" |
| `entity_table` | text | no |  |
| `entity_id` | uuid | no |  |
| `changes` | json | no |  |
| `request_id` | text | no |  |
| `ip_address` | text | no |  |

**Must supply on insert:** `action`

---

### `refresh_token`




| Column | Type | Required | Notes |
|---|---|---|---|
| `user_id` | → app_user | **yes** |  |
| `token_hash` | text | **yes** | sha256 of the token — the token itself is never stored. |
| `expires_at` | timestamp | **yes** |  |
| `revoked_at` | timestamp | no |  |
| `user_agent` | text | no |  |
| `ip_address` | text | no |  |

**Must supply on insert:** `user_id`, `token_hash`, `expires_at`


## Stock

### `stock_balance`

A running total, kept in step with stock_movement inside the same transaction.

unique: item_id + purity_id + location_id

| Column | Type | Required | Notes |
|---|---|---|---|
| `item_id` | → item | **yes** |  |
| `purity_id` | → purity | no |  |
| `location_id` | → stock_location | **yes** |  |
| `quantity` | number(14,3) | auto | default 0 |
| `gross_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 |
| `fine_weight` | weight (g) | auto | default 0 |
| `value` | money | auto | default 0 |
| `average_rate` | money | auto | default 0 |
| `last_movement_at` | timestamp | no |  |

**Must supply on insert:** `item_id`, `location_id`

---

### `stock_movement`

Append-only. Never updated, never deleted — a mistake is corrected by a reversing row.


| Column | Type | Required | Notes |
|---|---|---|---|
| `moved_at` | timestamp | auto |  |
| `direction` | text | **yes** | one of: in, out |
| `reason` | text | **yes** | one of: opening, purchase, purchase_return, sale, sales_return, transfer_out, transfer_in, production_issue, production_receipt, old_gold_intake, melting, adjustment, memo_out, memo_in |
| `item_id` | → item | **yes** |  |
| `purity_id` | → purity | no |  |
| `location_id` | → stock_location | **yes** |  |
| `piece_id` | → stock_piece | no | Set for piece-tracked items, null for bulk metal. |
| `quantity` | number(14,3) | auto | default 0 · Piece count, or units for consumables. |
| `gross_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 |
| `fine_weight` | weight (g) | auto | default 0 |
| `value` | money | auto | default 0 |
| `source_type` | text | **yes** |  |
| `source_id` | uuid | **yes** |  |
| `source_line_id` | uuid | no |  |
| `reverses_movement_id` | → stock_movement | no |  |
| `note` | text | no |  |

**Must supply on insert:** `direction`, `reason`, `item_id`, `location_id`, `source_type`, `source_id`

---

### `stock_piece`

One row per physically tagged item. Only used by items with tracking = piece.

unique: tag_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `tag_number` | text | **yes** | What is printed on the label. |
| `item_id` | → item | **yes** |  |
| `purity_id` | → purity | no |  |
| `location_id` | → stock_location | **yes** |  |
| `status` | text | auto | one of: in_stock, on_memo, sold, in_transit, with_karigar, in_repair, melted, written_off · default 'in_stock' |
| `gross_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 · Metal only — what purity applies to. |
| `stone_weight` | weight (g) | auto | default 0 |
| `other_weight` | weight (g) | auto | default 0 |
| `fine_weight` | weight (g) | auto | default 0 · net_weight x purity — the pure metal content. |
| `stone_count` | integer | no |  |
| `huid` | text | no |  |
| `hallmark_centre` | text | no |  |
| `cost_value` | money | auto | default 0 |
| `making_cost` | money | auto | default 0 |
| `stone_cost` | money | auto | default 0 |
| `design_id` | uuid | no | Filled in once Module 2 exists. |
| `supplier_id` | → party | no |  |
| `received_at` | timestamp | auto |  |
| `sold_at` | timestamp | no |  |
| `image_urls` | json | auto | default '[]' |
| `attributes` | json | auto | default '{}' |

**Must supply on insert:** `tag_number`, `item_id`, `location_id`


## Master Data & Rate Hub

### `karigar`

Goldsmith master. Can be an employee or an outside workshop.

soft delete · unique: code

| Column | Type | Required | Notes |
|---|---|---|---|
| `code` | text | **yes** |  |
| `name` | text | **yes** |  |
| `workshop_name` | text | no |  |
| `engagement` | text | auto | one of: in_house, external · default 'external' |
| `speciality` | text | no |  |
| `phone` | text | no |  |
| `address` | text | no |  |
| `pan` | text | no |  |
| `gstin` | text | no |  |
| `standard_ghat_percent` | rate | auto | default 0 |
| `labour_rate_per_gram` | money | auto | default 0 |
| `metal_balance_fine` | weight (g) | auto | default 0 |
| `wage_balance` | money | auto | default 0 |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `code`, `name`

---

### `karigar_ledger`

Metal and wages per karigar. Append-only.


| Column | Type | Required | Notes |
|---|---|---|---|
| `karigar_id` | → karigar | **yes** |  |
| `entry_type` | text | **yes** | one of: issue, return, ghat_allowed, ghat_excess, wage_earned, wage_paid, adjustment |
| `entry_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `metal_id` | → metal | no |  |
| `purity_id` | → purity | no |  |
| `gross_weight` | weight (g) | auto | default 0 |
| `weight_in` | weight (g) | auto | default 0 |
| `weight_out` | weight (g) | auto | default 0 |
| `amount_debit` | money | auto | default 0 |
| `amount_credit` | money | auto | default 0 |
| `retail_order_id` | → retail_order | no |  |
| `job_card_id` | uuid | no | Reserved for the manufacturer production module. |
| `voucher_id` | → voucher | no |  |
| `narration` | text | no |  |

**Must supply on insert:** `karigar_id`, `entry_type`, `entry_date`, `branch_id`


## masters

### `branch`

A physical location. Stock always sits at a branch, never at "the company".

soft delete · unique: code

| Column | Type | Required | Notes |
|---|---|---|---|
| `code` | text | **yes** |  |
| `name` | text | **yes** |  |
| `kind` | text | auto | one of: showroom, factory, warehouse, office · default 'showroom' |
| `gstin` | text | no |  |
| `state_code` | text | no | GST state code — decides CGST+SGST versus IGST. |
| `address_line1` | text | no |  |
| `address_line2` | text | no |  |
| `city` | text | no |  |
| `state` | text | no |  |
| `pincode` | text | no |  |
| `phone` | text | no |  |
| `email` | text | no |  |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `code`, `name`

---

### `item`

The product master. One row per thing you can buy, make or sell.

soft delete · unique: code

| Column | Type | Required | Notes |
|---|---|---|---|
| `code` | text | **yes** |  |
| `name` | text | **yes** |  |
| `nature` | text | auto | one of: raw_metal, finished, stone, consumable, service · default 'finished' |
| `tracking` | text | auto | one of: lot, piece · default 'piece' |
| `category_id` | → item_category | no |  |
| `metal_id` | → metal | no |  |
| `default_purity_id` | → purity | no |  |
| `hsn_code` | text | no |  |
| `default_making_rate` | rate | no |  |
| `default_wastage_percent` | rate | no |  |
| `uom` | text | auto | one of: gram, piece, carat, millilitre · default 'gram' |
| `is_active` | boolean | auto | default true |
| `attributes` | json | auto | default '{}' |

**Must supply on insert:** `code`, `name`

---

### `item_category`



unique: code

| Column | Type | Required | Notes |
|---|---|---|---|
| `parent_id` | → item_category | no |  |
| `code` | text | **yes** |  |
| `name` | text | **yes** |  |
| `hsn_code` | text | no |  |
| `sort_order` | integer | auto | default 0 |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `code`, `name`

---

### `metal`

Gold, silver, platinum. Kept as data so a tenant can add one.

unique: code

| Column | Type | Required | Notes |
|---|---|---|---|
| `code` | text | **yes** | GOLD, SILVER, PLATINUM |
| `name` | text | **yes** |  |
| `default_display_unit` | text | auto | one of: gram, tola, kilo, carat · default 'gram' |
| `hsn_code` | text | no |  |
| `is_active` | boolean | auto | default true |
| `sort_order` | integer | auto | default 0 |

**Must supply on insert:** `code`, `name`

---

### `metal_rate`

Historic rates are never edited — a new rate is a new row, so old invoices stay explainable.


| Column | Type | Required | Notes |
|---|---|---|---|
| `metal_id` | → metal | **yes** |  |
| `purity_id` | → purity | no | Null means the rate is for 100% pure metal. |
| `effective_from` | timestamp | auto |  |
| `rate_per_gram` | money | **yes** |  |
| `buying_rate_per_gram` | money | no | What the shop pays for old gold — normally lower. |
| `source` | text | auto | one of: manual, feed · default 'manual' |
| `branch_id` | → branch | no | Null means the rate applies to every branch. |

**Must supply on insert:** `metal_id`, `rate_per_gram`

---

### `party`

Customers and suppliers. The same firm is often both, so one row serves both.

soft delete · unique: code

| Column | Type | Required | Notes |
|---|---|---|---|
| `code` | text | **yes** |  |
| `name` | text | **yes** |  |
| `is_customer` | boolean | auto | default false |
| `is_supplier` | boolean | auto | default false |
| `party_type` | text | auto | one of: individual, business · default 'individual' |
| `phone` | text | no |  |
| `email` | text | no |  |
| `gstin` | text | no |  |
| `pan` | text | no |  |
| `state_code` | text | no | Decides CGST+SGST versus IGST against the branch. |
| `address_line1` | text | no |  |
| `address_line2` | text | no |  |
| `city` | text | no |  |
| `state` | text | no |  |
| `pincode` | text | no |  |
| `credit_limit` | money | no |  |
| `credit_days` | integer | no |  |
| `kyc_status` | text | auto | one of: none, pending, verified, rejected · default 'none' |
| `date_of_birth` | date | no |  |
| `anniversary` | date | no |  |
| `notes` | text | no |  |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `code`, `name`

---

### `purity`

Module 10.1 — 22K gold is one row: fineness 91.600, karat 22.

unique: metal_id + code

| Column | Type | Required | Notes |
|---|---|---|---|
| `metal_id` | → metal | **yes** |  |
| `code` | text | **yes** | e.g. 22K, 18K, 916, 995 |
| `name` | text | **yes** |  |
| `fineness_percent` | purity % | **yes** |  |
| `karat` | number(5,2) | no | Null for silver and platinum. |
| `is_hallmarkable` | boolean | auto | default true |
| `is_active` | boolean | auto | default true |
| `sort_order` | integer | auto | default 0 |

**Must supply on insert:** `metal_id`, `code`, `name`, `fineness_percent`

---

### `stock_location`



soft delete · unique: branch_id + code

| Column | Type | Required | Notes |
|---|---|---|---|
| `branch_id` | → branch | **yes** |  |
| `code` | text | **yes** |  |
| `name` | text | **yes** |  |
| `kind` | text | auto | one of: counter, vault, window, floor, transit, karigar · default 'counter' |
| `is_default` | boolean | auto | default false |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `branch_id`, `code`, `name`


## Document numbering

### `numbering_gap`




| Column | Type | Required | Notes |
|---|---|---|---|
| `series_id` | → numbering_series | **yes** |  |
| `doc_number` | text | **yes** |  |
| `reason` | text | **yes** |  |

**Must supply on insert:** `series_id`, `doc_number`, `reason`

---

### `numbering_series`

One row per document type per branch, e.g. sales invoices at the Andheri showroom.

unique: doc_type + branch_id

| Column | Type | Required | Notes |
|---|---|---|---|
| `doc_type` | text | **yes** | purchase_order, sales_invoice, grn, tag... |
| `branch_id` | → branch | no | Null means one shared series across all branches. |
| `name` | text | **yes** |  |
| `prefix` | text | auto | default '' · Supports {FY}, {YY}, {MM}, {BRANCH}. |
| `suffix` | text | auto | default '' |
| `padding` | integer | auto | default 5 |
| `next_number` | bigint | auto | default 1 |
| `reset_period` | text | auto | one of: never, yearly, financial_yearly, monthly · default 'financial_yearly' |
| `current_period` | text | no |  |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `doc_type`, `name`


## Old Gold Exchange & Melt

### `melt_batch`

Scrap collected, melted and assayed. Closes the loop on metal reconciliation.

unique: batch_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `batch_number` | text | **yes** |  |
| `batch_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `metal_id` | → metal | **yes** |  |
| `status` | text | auto | one of: open, sent, melted, received, closed · default 'open' |
| `input_gross_weight` | weight (g) | auto | default 0 |
| `input_fine_weight` | weight (g) | auto | default 0 |
| `output_weight` | weight (g) | auto | default 0 |
| `output_purity_percent` | purity % | no |  |
| `output_fine_weight` | weight (g) | auto | default 0 |
| `loss_fine_weight` | weight (g) | auto | default 0 |
| `refiner_id` | → party | no | The refinery, when sent out. |
| `refining_charge` | money | auto | default 0 |
| `sent_at` | timestamp | no |  |
| `received_at` | timestamp | no |  |
| `assay_certificate_number` | text | no |  |
| `received_into_location_id` | → stock_location | no |  |
| `voucher_id` | → voucher | no |  |
| `notes` | text | no |  |

**Must supply on insert:** `batch_number`, `batch_date`, `branch_id`, `metal_id`

---

### `old_gold_intake`

The appraisal voucher. One per customer visit.

unique: voucher_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `voucher_number` | text | **yes** |  |
| `voucher_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `customer_id` | → party | **yes** |  |
| `status` | text | auto | one of: draft, tested, approved, settled, returned, cancelled · default 'draft' |
| `settlement_type` | text | no | one of: exchange, buyback |
| `tested_by` | → app_user | no |  |
| `approved_by` | → app_user | no |  |
| `approved_at` | timestamp | no |  |
| `total_gross_weight` | weight (g) | auto | default 0 |
| `total_deduction_weight` | weight (g) | auto | default 0 |
| `total_net_weight` | weight (g) | auto | default 0 |
| `total_fine_weight` | weight (g) | auto | default 0 |
| `rate_per_gram` | money | auto | default 0 |
| `gross_value` | money | auto | default 0 |
| `deduction_amount` | money | auto | default 0 |
| `net_value` | money | auto | default 0 |
| `applied_to_invoice_id` | → sales_invoice | no |  |
| `applied_to_order_id` | → retail_order | no |  |
| `payout_mode` | text | no | one of: cash, bank_transfer, upi, cheque |
| `payout_reference` | text | no |  |
| `settled_at` | timestamp | no |  |
| `voucher_id` | → voucher | no |  |
| `melt_batch_id` | → melt_batch | no |  |
| `notes` | text | no |  |

**Must supply on insert:** `voucher_number`, `voucher_date`, `branch_id`, `customer_id`

---

### `old_gold_item`

One row per physical article brought in. Weighed and tested individually.

unique: old_gold_intake_id + line_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `old_gold_intake_id` | → old_gold_intake | **yes** |  |
| `line_number` | integer | **yes** |  |
| `description` | text | **yes** |  |
| `item_category_id` | → item_category | no |  |
| `metal_id` | → metal | **yes** |  |
| `gross_weight` | weight (g) | **yes** |  |
| `stone_weight` | weight (g) | auto | default 0 |
| `dirt_weight` | weight (g) | auto | default 0 |
| `solder_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | **yes** |  |
| `test_method` | text | auto | one of: xrf, touchstone, fire_assay, declared, visual · default 'xrf' |
| `tested_purity_percent` | purity % | **yes** |  |
| `declared_purity_percent` | purity % | no |  |
| `test_instrument` | text | no |  |
| `test_reading_raw` | json | auto | default '{}' |
| `tested_at` | timestamp | no |  |
| `fine_weight` | weight (g) | **yes** | net_weight x tested_purity_percent. |
| `rate_per_gram` | money | auto | default 0 |
| `value` | money | auto | default 0 |
| `photo_storage_key` | text | no |  |
| `is_returned` | boolean | auto | default false |
| `notes` | text | no |  |

**Must supply on insert:** `old_gold_intake_id`, `line_number`, `description`, `metal_id`, `gross_weight`, `net_weight`, `tested_purity_percent`, `fine_weight`


## Custom Orders & Karigar

### `order_acknowledgement`



unique: retail_order_id

| Column | Type | Required | Notes |
|---|---|---|---|
| `retail_order_id` | → retail_order | **yes** |  |
| `method` | text | **yes** | one of: signature, otp |
| `signature_storage_key` | text | no |  |
| `otp_reference` | text | no | The reference returned by the OTP provider, not the code. |
| `acknowledged_at` | timestamp | auto |  |
| `acknowledged_by_name` | text | no |  |

**Must supply on insert:** `retail_order_id`, `method`

---

### `order_attachment`

Reference images for custom work, condition photos for repairs.


| Column | Type | Required | Notes |
|---|---|---|---|
| `retail_order_id` | → retail_order | **yes** |  |
| `kind` | text | auto | one of: reference, intake_photo, design, cad, delivery_proof, document · default 'reference' |
| `file_name` | text | **yes** |  |
| `storage_key` | text | **yes** |  |
| `content_type` | text | no |  |
| `size_bytes` | bigint | no |  |
| `caption` | text | no |  |
| `sort_order` | integer | auto | default 0 |

**Must supply on insert:** `retail_order_id`, `file_name`, `storage_key`

---

### `order_communication`




| Column | Type | Required | Notes |
|---|---|---|---|
| `retail_order_id` | → retail_order | **yes** |  |
| `channel` | text | auto | one of: sms, whatsapp, email, call, in_person · default 'whatsapp' |
| `direction` | text | auto | one of: outbound, inbound · default 'outbound' |
| `message` | text | **yes** |  |
| `sent_at` | timestamp | auto |  |
| `delivery_status` | text | auto | one of: queued, sent, delivered, read, failed · default 'queued' |
| `actor_user_id` | → app_user | no |  |

**Must supply on insert:** `retail_order_id`, `message`

---

### `order_line`

A wedding order mixes ready-stock bookings and made-to-order pieces line by line.

unique: retail_order_id + line_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `retail_order_id` | → retail_order | **yes** |  |
| `line_number` | integer | **yes** |  |
| `line_mode` | text | auto | one of: booking, custom · default 'booking' |
| `title` | text | **yes** |  |
| `design_specification` | text | no |  |
| `item_id` | → item | no |  |
| `piece_id` | → stock_piece | no | Set when a specific tagged piece is reserved. |
| `purity_id` | → purity | no |  |
| `category_id` | → item_category | no |  |
| `quantity` | number(14,3) | auto | default 1 |
| `gross_weight` | weight (g) | auto | default 0 |
| `stone_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 |
| `rate_per_gram` | money | auto | default 0 |
| `metal_amount` | money | auto | default 0 |
| `making_basis` | text | auto | one of: per_gram, percent, flat · default 'per_gram' |
| `making_rate` | rate | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `wastage_percent` | rate | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `gst_rate` | rate | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `line_total` | money | auto | default 0 |
| `hsn_code` | text | no |  |
| `special_instructions` | text | no |  |

**Must supply on insert:** `retail_order_id`, `line_number`, `title`

---

### `order_payment`

Advance and token collections against an order, before it is billed.


| Column | Type | Required | Notes |
|---|---|---|---|
| `retail_order_id` | → retail_order | **yes** |  |
| `mode` | text | **yes** | one of: cash, card, upi, bank_transfer, cheque, emi, old_gold, scheme |
| `amount` | money | **yes** |  |
| `reference` | text | no |  |
| `received_at` | timestamp | auto |  |
| `receipt_number` | text | no |  |
| `account_id` | → account | no |  |
| `voucher_id` | → voucher | no |  |
| `notes` | text | no |  |

**Must supply on insert:** `retail_order_id`, `mode`, `amount`

---

### `order_pipeline`

Config-driven Kanban stages. Absent rows fall back to the built-in defaults.

unique: order_type

| Column | Type | Required | Notes |
|---|---|---|---|
| `order_type` | text | **yes** | one of: booking, custom, repair, wedding, corporate |
| `stages` | json | auto | default '[]' |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `order_type`

---

### `order_stage_event`




| Column | Type | Required | Notes |
|---|---|---|---|
| `retail_order_id` | → retail_order | **yes** |  |
| `at` | timestamp | auto |  |
| `from_stage` | text | no |  |
| `to_stage` | text | **yes** |  |
| `direction` | text | auto | one of: forward, backward, same · default 'forward' |
| `reason` | text | no |  |
| `note` | text | no |  |
| `actor_user_id` | → app_user | no |  |
| `karigar_id` | → karigar | no |  |

**Must supply on insert:** `retail_order_id`, `to_stage`

---

### `retail_order`

All five order types. Type-specific fields are null for the others.

unique: order_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `order_number` | text | **yes** |  |
| `order_type` | text | **yes** | one of: booking, custom, repair, wedding, corporate |
| `status` | text | auto | one of: draft, active, completed, cancelled · default 'draft' |
| `stage` | text | **yes** | one of: booked, compliance, confirmed, crafting, delivered, design, finishing, intake, planning, production, quality, ready, received, repair, sourcing |
| `branch_id` | → branch | **yes** |  |
| `customer_id` | → party | **yes** |  |
| `salesperson_id` | → app_user | no |  |
| `karigar_id` | → karigar | no |  |
| `order_date` | date | **yes** |  |
| `expected_delivery_date` | date | **yes** |  |
| `delivered_at` | timestamp | no |  |
| `is_sla_breached` | boolean | auto | default false |
| `rate_lock_type` | text | auto | one of: today, floating, fixed_future · default 'today' |
| `locked_rate_per_gram` | money | no | Frozen at booking for today/fixed_future locks. |
| `rate_locked_at` | timestamp | no |  |
| `rate_lock_expires_at` | timestamp | no |  |
| `metal_amount` | money | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `total_amount` | money | auto | default 0 |
| `advance_amount` | money | auto | default 0 |
| `old_gold_credit` | money | auto | default 0 |
| `scheme_credit` | money | auto | default 0 |
| `balance_amount` | money | auto | default 0 |
| `total_gross_weight` | weight (g) | auto | default 0 |
| `total_net_weight` | weight (g) | auto | default 0 |
| `requirement_description` | text | no |  |
| `size_specifications` | text | no |  |
| `budget_min` | money | no |  |
| `budget_max` | money | no |  |
| `design_approval` | text | no | one of: pending, approved, revision_requested |
| `manufacturing_route` | text | no | one of: in_house, external |
| `external_manufacturer_id` | → party | no |  |
| `production_status` | text | no | one of: not_started, sent_to_manufacturer, quote_received, in_production, completed |
| `repair_item_description` | text | no |  |
| `repair_issue_description` | text | no |  |
| `repair_issue_types` | json | auto | default '[]' |
| `under_warranty` | boolean | auto | default false |
| `original_invoice_number` | text | no | Links a warranty repair back to the sale. |
| `event_date` | date | no |  |
| `event_type` | text | no |  |
| `company_name` | text | no |  |
| `company_gstin` | text | no |  |
| `po_reference` | text | no |  |
| `credit_terms` | text | no | one of: net_15, net_30, custom |
| `credit_terms_note` | text | no |  |
| `branding_notes` | text | no |  |
| `notes` | text | no |  |
| `cancelled_at` | timestamp | no |  |
| `cancel_reason` | text | no |  |
| `sales_invoice_id` | → sales_invoice | no |  |

**Must supply on insert:** `order_number`, `order_type`, `stage`, `branch_id`, `customer_id`, `order_date`, `expected_delivery_date`


## Platform Operator & SaaS Admin

### `feature_flag`

System feature flags. Null tenant_id = global default.

**platform-level** (not tenant-scoped) · unique: flag_key

| Column | Type | Required | Notes |
|---|---|---|---|
| `flag_key` | text | **yes** |  |
| `enabled` | boolean | auto | default false |
| `description` | text | no |  |
| `payload` | json | auto | default '{}' |

**Must supply on insert:** `flag_key`

---

### `platform_audit_log`



**platform-level** (not tenant-scoped)

| Column | Type | Required | Notes |
|---|---|---|---|
| `at` | timestamp | auto |  |
| `platform_user_id` | → platform_user | no |  |
| `action` | text | **yes** | e.g. "tenant.create", "tenant.suspend", "user.create" |
| `target_tenant_id` | → tenant | no |  |
| `target_type` | text | no |  |
| `target_id` | uuid | no |  |
| `changes` | json | no |  |
| `ip_address` | text | no |  |
| `request_id` | text | no |  |

**Must supply on insert:** `action`

---

### `platform_refresh_token`



**platform-level** (not tenant-scoped)

| Column | Type | Required | Notes |
|---|---|---|---|
| `platform_user_id` | → platform_user | **yes** |  |
| `token_hash` | text | **yes** |  |
| `expires_at` | timestamp | **yes** |  |
| `revoked_at` | timestamp | no |  |
| `user_agent` | text | no |  |
| `ip_address` | text | no |  |

**Must supply on insert:** `platform_user_id`, `token_hash`, `expires_at`

---

### `platform_user`

The super admin. Exactly one row, seeded from the CLI — never created through the API.

**platform-level** (not tenant-scoped) · soft delete

| Column | Type | Required | Notes |
|---|---|---|---|
| `email` | text | **yes** | unique |
| `full_name` | text | **yes** |  |
| `password_hash` | text | **yes** |  |
| `role` | text | auto | one of: super_admin · default 'super_admin' |
| `phone` | text | no |  |
| `is_active` | boolean | auto | default true |
| `last_login_at` | timestamp | no |  |
| `failed_login_count` | integer | auto | default 0 |
| `locked_until` | timestamp | no |  |
| `created_by_platform_user_id` | → platform_user | no |  |

**Must supply on insert:** `email`, `full_name`, `password_hash`

---

### `support_session`



**platform-level** (not tenant-scoped)

| Column | Type | Required | Notes |
|---|---|---|---|
| `operator_user_id` | → app_user | **yes** |  |
| `reason` | text | **yes** |  |
| `started_at` | timestamp | auto |  |
| `ends_at` | timestamp | **yes** |  |
| `ended_at` | timestamp | no |  |
| `can_write` | boolean | auto | default false |
| `ip_address` | text | no |  |

**Must supply on insert:** `operator_user_id`, `reason`, `ends_at`

---

### `tenant_module`

Which modules a tenant holds, and on what terms. Drives the module dock.

unique: module_key

| Column | Type | Required | Notes |
|---|---|---|---|
| `module_key` | text | **yes** | orders, stock, tagging, pos, oldgold, schemes, girvi, accounts, master, reports, settings, platform |
| `enabled` | boolean | auto | default true |
| `licence` | text | auto | one of: included, purchased, trial, expired · default 'included' |
| `trial_ends_at` | timestamp | no |  |
| `expires_at` | timestamp | no |  |
| `purchased_at` | timestamp | no |  |
| `disabled_submodules` | json | auto | default '[]' |
| `settings` | json | auto | default '{}' |

**Must supply on insert:** `module_key`


## Purchase

### `goods_receipt`

What physically arrived. This is the document that raises stock.

unique: doc_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `doc_number` | text | **yes** |  |
| `doc_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `supplier_id` | → party | **yes** |  |
| `status` | text | auto | one of: draft, confirmed, posted, cancelled, closed · default 'draft' |
| `reference_number` | text | no | The other side's document number. |
| `reference_date` | date | no |  |
| `notes` | text | no |  |
| `metal_amount` | money | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `other_charges` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `round_off` | money | auto | default 0 |
| `total_amount` | money | auto | default 0 |
| `total_gross_weight` | weight (g) | auto | default 0 |
| `total_net_weight` | weight (g) | auto | default 0 |
| `total_fine_weight` | weight (g) | auto | default 0 |
| `posted_at` | timestamp | no |  |
| `posted_by` | uuid | no |  |
| `cancelled_at` | timestamp | no |  |
| `cancelled_by` | uuid | no |  |
| `cancel_reason` | text | no |  |
| `voucher_id` | → voucher | no | The accounting entry created at posting. |
| `purchase_order_id` | → purchase_order | no |  |
| `received_at` | timestamp | auto |  |
| `weighed_by` | uuid | no |  |
| `transport_details` | text | no |  |

**Must supply on insert:** `doc_number`, `doc_date`, `branch_id`, `supplier_id`

---

### `goods_receipt_line`



unique: goods_receipt_id + line_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `goods_receipt_id` | → goods_receipt | **yes** |  |
| `line_number` | integer | **yes** |  |
| `item_id` | → item | **yes** |  |
| `purity_id` | → purity | no |  |
| `piece_id` | → stock_piece | no | Set when a specific tagged piece is involved. |
| `description` | text | no |  |
| `hsn_code` | text | no |  |
| `quantity` | number(14,3) | auto | default 1 |
| `gross_weight` | weight (g) | auto | default 0 |
| `stone_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 |
| `fine_weight` | weight (g) | auto | default 0 |
| `rate_per_gram` | money | auto | default 0 |
| `metal_amount` | money | auto | default 0 |
| `making_basis` | text | auto | one of: per_gram, percent, flat · default 'per_gram' |
| `making_rate` | rate | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `wastage_percent` | rate | auto | default 0 |
| `wastage_weight` | weight (g) | auto | default 0 |
| `wastage_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `gst_rate` | rate | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `line_total` | money | auto | default 0 |
| `location_id` | → stock_location | no |  |
| `notes` | text | no |  |
| `purchase_order_line_id` | → purchase_order_line | no |  |
| `declared_weight` | weight (g) | auto | default 0 |
| `weight_variance` | weight (g) | auto | default 0 |
| `tested_purity_percent` | purity % | no |  |

**Must supply on insert:** `goods_receipt_id`, `line_number`, `item_id`

---

### `purchase_invoice`

What we owe the supplier. This is the document that moves the ledger.

unique: doc_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `doc_number` | text | **yes** |  |
| `doc_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `supplier_id` | → party | **yes** |  |
| `status` | text | auto | one of: draft, confirmed, posted, cancelled, closed · default 'draft' |
| `reference_number` | text | no | The other side's document number. |
| `reference_date` | date | no |  |
| `notes` | text | no |  |
| `metal_amount` | money | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `other_charges` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `round_off` | money | auto | default 0 |
| `total_amount` | money | auto | default 0 |
| `total_gross_weight` | weight (g) | auto | default 0 |
| `total_net_weight` | weight (g) | auto | default 0 |
| `total_fine_weight` | weight (g) | auto | default 0 |
| `posted_at` | timestamp | no |  |
| `posted_by` | uuid | no |  |
| `cancelled_at` | timestamp | no |  |
| `cancelled_by` | uuid | no |  |
| `cancel_reason` | text | no |  |
| `voucher_id` | → voucher | no | The accounting entry created at posting. |
| `goods_receipt_id` | → goods_receipt | no |  |
| `purchase_order_id` | → purchase_order | no |  |
| `supplier_invoice_number` | text | no |  |
| `supplier_invoice_date` | date | no |  |
| `due_date` | date | no |  |
| `raises_stock` | boolean | auto | default false |
| `paid_amount` | money | auto | default 0 |
| `metal_settled_weight` | weight (g) | auto | default 0 |

**Must supply on insert:** `doc_number`, `doc_date`, `branch_id`, `supplier_id`

---

### `purchase_invoice_line`



unique: purchase_invoice_id + line_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `purchase_invoice_id` | → purchase_invoice | **yes** |  |
| `line_number` | integer | **yes** |  |
| `item_id` | → item | **yes** |  |
| `purity_id` | → purity | no |  |
| `piece_id` | → stock_piece | no | Set when a specific tagged piece is involved. |
| `description` | text | no |  |
| `hsn_code` | text | no |  |
| `quantity` | number(14,3) | auto | default 1 |
| `gross_weight` | weight (g) | auto | default 0 |
| `stone_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 |
| `fine_weight` | weight (g) | auto | default 0 |
| `rate_per_gram` | money | auto | default 0 |
| `metal_amount` | money | auto | default 0 |
| `making_basis` | text | auto | one of: per_gram, percent, flat · default 'per_gram' |
| `making_rate` | rate | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `wastage_percent` | rate | auto | default 0 |
| `wastage_weight` | weight (g) | auto | default 0 |
| `wastage_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `gst_rate` | rate | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `line_total` | money | auto | default 0 |
| `location_id` | → stock_location | no |  |
| `notes` | text | no |  |
| `goods_receipt_line_id` | → goods_receipt_line | no |  |

**Must supply on insert:** `purchase_invoice_id`, `line_number`, `item_id`

---

### `purchase_order`

What we asked the supplier for. Affects nothing until goods arrive.

unique: doc_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `doc_number` | text | **yes** |  |
| `doc_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `supplier_id` | → party | **yes** |  |
| `status` | text | auto | one of: draft, confirmed, posted, cancelled, closed · default 'draft' |
| `reference_number` | text | no | The other side's document number. |
| `reference_date` | date | no |  |
| `notes` | text | no |  |
| `metal_amount` | money | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `other_charges` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `round_off` | money | auto | default 0 |
| `total_amount` | money | auto | default 0 |
| `total_gross_weight` | weight (g) | auto | default 0 |
| `total_net_weight` | weight (g) | auto | default 0 |
| `total_fine_weight` | weight (g) | auto | default 0 |
| `posted_at` | timestamp | no |  |
| `posted_by` | uuid | no |  |
| `cancelled_at` | timestamp | no |  |
| `cancelled_by` | uuid | no |  |
| `cancel_reason` | text | no |  |
| `voucher_id` | → voucher | no | The accounting entry created at posting. |
| `expected_date` | date | no |  |
| `rate_basis` | text | auto | one of: fixed, on_delivery · default 'fixed' |
| `fulfilled_weight` | weight (g) | auto | default 0 · Rolled up from receipts. |

**Must supply on insert:** `doc_number`, `doc_date`, `branch_id`, `supplier_id`

---

### `purchase_order_line`



unique: purchase_order_id + line_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `purchase_order_id` | → purchase_order | **yes** |  |
| `line_number` | integer | **yes** |  |
| `item_id` | → item | **yes** |  |
| `purity_id` | → purity | no |  |
| `piece_id` | → stock_piece | no | Set when a specific tagged piece is involved. |
| `description` | text | no |  |
| `hsn_code` | text | no |  |
| `quantity` | number(14,3) | auto | default 1 |
| `gross_weight` | weight (g) | auto | default 0 |
| `stone_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 |
| `fine_weight` | weight (g) | auto | default 0 |
| `rate_per_gram` | money | auto | default 0 |
| `metal_amount` | money | auto | default 0 |
| `making_basis` | text | auto | one of: per_gram, percent, flat · default 'per_gram' |
| `making_rate` | rate | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `wastage_percent` | rate | auto | default 0 |
| `wastage_weight` | weight (g) | auto | default 0 |
| `wastage_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `gst_rate` | rate | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `line_total` | money | auto | default 0 |
| `location_id` | → stock_location | no |  |
| `notes` | text | no |  |
| `received_quantity` | number(14,3) | auto | default 0 |
| `received_weight` | weight (g) | auto | default 0 |

**Must supply on insert:** `purchase_order_id`, `line_number`, `item_id`

---

### `purchase_return`



unique: doc_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `doc_number` | text | **yes** |  |
| `doc_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `supplier_id` | → party | **yes** |  |
| `status` | text | auto | one of: draft, confirmed, posted, cancelled, closed · default 'draft' |
| `reference_number` | text | no | The other side's document number. |
| `reference_date` | date | no |  |
| `notes` | text | no |  |
| `metal_amount` | money | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `other_charges` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `round_off` | money | auto | default 0 |
| `total_amount` | money | auto | default 0 |
| `total_gross_weight` | weight (g) | auto | default 0 |
| `total_net_weight` | weight (g) | auto | default 0 |
| `total_fine_weight` | weight (g) | auto | default 0 |
| `posted_at` | timestamp | no |  |
| `posted_by` | uuid | no |  |
| `cancelled_at` | timestamp | no |  |
| `cancelled_by` | uuid | no |  |
| `cancel_reason` | text | no |  |
| `voucher_id` | → voucher | no | The accounting entry created at posting. |
| `purchase_invoice_id` | → purchase_invoice | no |  |
| `goods_receipt_id` | → goods_receipt | no |  |
| `reason` | text | auto | one of: quality, wrong_item, excess, damaged, other · default 'other' |
| `credit_note_number` | text | no |  |

**Must supply on insert:** `doc_number`, `doc_date`, `branch_id`, `supplier_id`

---

### `purchase_return_line`



unique: purchase_return_id + line_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `purchase_return_id` | → purchase_return | **yes** |  |
| `line_number` | integer | **yes** |  |
| `item_id` | → item | **yes** |  |
| `purity_id` | → purity | no |  |
| `piece_id` | → stock_piece | no | Set when a specific tagged piece is involved. |
| `description` | text | no |  |
| `hsn_code` | text | no |  |
| `quantity` | number(14,3) | auto | default 1 |
| `gross_weight` | weight (g) | auto | default 0 |
| `stone_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 |
| `fine_weight` | weight (g) | auto | default 0 |
| `rate_per_gram` | money | auto | default 0 |
| `metal_amount` | money | auto | default 0 |
| `making_basis` | text | auto | one of: per_gram, percent, flat · default 'per_gram' |
| `making_rate` | rate | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `wastage_percent` | rate | auto | default 0 |
| `wastage_weight` | weight (g) | auto | default 0 |
| `wastage_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `gst_rate` | rate | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `line_total` | money | auto | default 0 |
| `location_id` | → stock_location | no |  |
| `notes` | text | no |  |
| `purchase_invoice_line_id` | → purchase_invoice_line | no |  |

**Must supply on insert:** `purchase_return_id`, `line_number`, `item_id`


## Sales / POS

### `sales_invoice`

Module 5.2 — counter, wholesale and export billing share this table.

unique: doc_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `doc_number` | text | **yes** |  |
| `doc_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `customer_id` | → party | **yes** |  |
| `status` | text | auto | one of: draft, confirmed, posted, cancelled, closed · default 'draft' |
| `reference_number` | text | no | The other side's document number. |
| `reference_date` | date | no |  |
| `notes` | text | no |  |
| `metal_amount` | money | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `other_charges` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `round_off` | money | auto | default 0 |
| `total_amount` | money | auto | default 0 |
| `total_gross_weight` | weight (g) | auto | default 0 |
| `total_net_weight` | weight (g) | auto | default 0 |
| `total_fine_weight` | weight (g) | auto | default 0 |
| `posted_at` | timestamp | no |  |
| `posted_by` | uuid | no |  |
| `cancelled_at` | timestamp | no |  |
| `cancelled_by` | uuid | no |  |
| `cancel_reason` | text | no |  |
| `voucher_id` | → voucher | no | The accounting entry created at posting. |
| `channel` | text | auto | one of: counter, wholesale, export, online · default 'counter' |
| `salesperson_id` | → app_user | no | Drives staff-wise sales reports (Module 11.4). |
| `place_of_supply_code` | text | no |  |
| `is_export` | boolean | auto | default false |
| `export_currency` | text | no |  |
| `export_rate` | rate | no |  |
| `irn` | text | no |  |
| `irn_status` | text | auto | one of: not_required, pending, generated, cancelled, failed · default 'not_required' |
| `irn_generated_at` | timestamp | no |  |
| `ack_number` | text | no |  |
| `qr_code_data` | text | no |  |
| `paid_amount` | money | auto | default 0 |
| `old_gold_amount` | money | auto | default 0 · Credit applied from Module 6. |
| `scheme_amount` | money | auto | default 0 · Credit applied from Module 7. |
| `balance_amount` | money | auto | default 0 |
| `order_id` | uuid | no | Links back to Module 1 once orders are built. |

**Must supply on insert:** `doc_number`, `doc_date`, `branch_id`, `customer_id`

---

### `sales_invoice_line`



unique: sales_invoice_id + line_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `sales_invoice_id` | → sales_invoice | **yes** |  |
| `line_number` | integer | **yes** |  |
| `item_id` | → item | **yes** |  |
| `purity_id` | → purity | no |  |
| `piece_id` | → stock_piece | no | Set when a specific tagged piece is involved. |
| `description` | text | no |  |
| `hsn_code` | text | no |  |
| `quantity` | number(14,3) | auto | default 1 |
| `gross_weight` | weight (g) | auto | default 0 |
| `stone_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 |
| `fine_weight` | weight (g) | auto | default 0 |
| `rate_per_gram` | money | auto | default 0 |
| `metal_amount` | money | auto | default 0 |
| `making_basis` | text | auto | one of: per_gram, percent, flat · default 'per_gram' |
| `making_rate` | rate | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `wastage_percent` | rate | auto | default 0 |
| `wastage_weight` | weight (g) | auto | default 0 |
| `wastage_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `gst_rate` | rate | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `line_total` | money | auto | default 0 |
| `location_id` | → stock_location | no |  |
| `notes` | text | no |  |
| `cost_value` | money | auto | default 0 |
| `hallmark_charge` | money | auto | default 0 |
| `certificate_number` | text | no |  |

**Must supply on insert:** `sales_invoice_id`, `line_number`, `item_id`

---

### `sales_payment`

One row per tender. A single sale usually has several.


| Column | Type | Required | Notes |
|---|---|---|---|
| `sales_invoice_id` | → sales_invoice | **yes** |  |
| `mode` | text | **yes** | one of: cash, card, upi, bank_transfer, cheque, credit, old_gold, scheme, advance |
| `amount` | money | **yes** |  |
| `reference` | text | no | Cheque number, UPI reference, card approval code. |
| `account_id` | → account | no | Which cash or bank account this landed in. |
| `received_at` | timestamp | auto |  |
| `old_gold_intake_id` | uuid | no |  |
| `notes` | text | no |  |

**Must supply on insert:** `sales_invoice_id`, `mode`, `amount`

---

### `sales_return`



unique: doc_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `doc_number` | text | **yes** |  |
| `doc_date` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `customer_id` | → party | **yes** |  |
| `status` | text | auto | one of: draft, confirmed, posted, cancelled, closed · default 'draft' |
| `reference_number` | text | no | The other side's document number. |
| `reference_date` | date | no |  |
| `notes` | text | no |  |
| `metal_amount` | money | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `other_charges` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `round_off` | money | auto | default 0 |
| `total_amount` | money | auto | default 0 |
| `total_gross_weight` | weight (g) | auto | default 0 |
| `total_net_weight` | weight (g) | auto | default 0 |
| `total_fine_weight` | weight (g) | auto | default 0 |
| `posted_at` | timestamp | no |  |
| `posted_by` | uuid | no |  |
| `cancelled_at` | timestamp | no |  |
| `cancelled_by` | uuid | no |  |
| `cancel_reason` | text | no |  |
| `voucher_id` | → voucher | no | The accounting entry created at posting. |
| `sales_invoice_id` | → sales_invoice | no |  |
| `settlement` | text | auto | one of: refund, exchange, credit_note · default 'credit_note' |
| `reason` | text | auto | one of: defect, size, dislike, wrong_item, other · default 'other' |
| `retested` | boolean | auto | default false |
| `restock` | boolean | auto | default true |
| `refund_amount` | money | auto | default 0 |

**Must supply on insert:** `doc_number`, `doc_date`, `branch_id`, `customer_id`

---

### `sales_return_line`



unique: sales_return_id + line_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `sales_return_id` | → sales_return | **yes** |  |
| `line_number` | integer | **yes** |  |
| `item_id` | → item | **yes** |  |
| `purity_id` | → purity | no |  |
| `piece_id` | → stock_piece | no | Set when a specific tagged piece is involved. |
| `description` | text | no |  |
| `hsn_code` | text | no |  |
| `quantity` | number(14,3) | auto | default 1 |
| `gross_weight` | weight (g) | auto | default 0 |
| `stone_weight` | weight (g) | auto | default 0 |
| `net_weight` | weight (g) | auto | default 0 |
| `fine_weight` | weight (g) | auto | default 0 |
| `rate_per_gram` | money | auto | default 0 |
| `metal_amount` | money | auto | default 0 |
| `making_basis` | text | auto | one of: per_gram, percent, flat · default 'per_gram' |
| `making_rate` | rate | auto | default 0 |
| `making_amount` | money | auto | default 0 |
| `wastage_percent` | rate | auto | default 0 |
| `wastage_weight` | weight (g) | auto | default 0 |
| `wastage_amount` | money | auto | default 0 |
| `stone_amount` | money | auto | default 0 |
| `discount_amount` | money | auto | default 0 |
| `taxable_amount` | money | auto | default 0 |
| `gst_rate` | rate | auto | default 0 |
| `cgst_amount` | money | auto | default 0 |
| `sgst_amount` | money | auto | default 0 |
| `igst_amount` | money | auto | default 0 |
| `line_total` | money | auto | default 0 |
| `location_id` | → stock_location | no |  |
| `notes` | text | no |  |
| `sales_invoice_line_id` | → sales_invoice_line | no |  |

**Must supply on insert:** `sales_return_id`, `line_number`, `item_id`


## Swarna Nidhi (Chit Schemes)

### `scheme_account`

One customer enrolled in one scheme.

unique: account_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `account_number` | text | **yes** |  |
| `scheme_plan_id` | → scheme_plan | **yes** |  |
| `customer_id` | → party | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `status` | text | auto | one of: active, matured, redeemed, defaulted, cancelled, closed · default 'active' |
| `enrolled_on` | date | **yes** |  |
| `maturity_date` | date | **yes** |  |
| `due_day` | integer | auto | default 1 |
| `installment_amount` | money | **yes** |  |
| `installments_paid` | integer | auto | default 0 |
| `installments_due` | integer | auto | default 0 |
| `total_paid` | money | auto | default 0 |
| `total_weight_accrued` | weight (g) | auto | default 0 |
| `bonus_amount` | money | auto | default 0 |
| `bonus_weight` | weight (g) | auto | default 0 |
| `redeemable_amount` | money | auto | default 0 |
| `redeemable_weight` | weight (g) | auto | default 0 |
| `is_bonus_forfeited` | boolean | auto | default false |
| `nominee_name` | text | no |  |
| `nominee_relationship` | text | no |  |
| `nominee_phone` | text | no |  |
| `matured_at` | timestamp | no |  |
| `closed_at` | timestamp | no |  |
| `close_reason` | text | no |  |

**Must supply on insert:** `account_number`, `scheme_plan_id`, `customer_id`, `branch_id`, `enrolled_on`, `maturity_date`, `installment_amount`

---

### `scheme_installment`

The full schedule, generated at enrollment. Each row is later paid or missed.

unique: scheme_account_id + installment_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `scheme_account_id` | → scheme_account | **yes** |  |
| `installment_number` | integer | **yes** |  |
| `due_date` | date | **yes** |  |
| `status` | text | auto | one of: due, paid, missed, waived, advance · default 'due' |
| `amount_due` | money | **yes** |  |
| `amount_paid` | money | auto | default 0 |
| `paid_on` | date | no |  |
| `rate_per_gram` | money | no |  |
| `weight_accrued` | weight (g) | auto | default 0 |
| `payment_mode` | text | no | one of: cash, card, upi, bank_transfer, cheque, auto_debit |
| `payment_reference` | text | no |  |
| `receipt_number` | text | no |  |
| `collected_by` | → app_user | no |  |
| `voucher_id` | → voucher | no |  |
| `last_reminder_at` | timestamp | no |  |
| `reminder_count` | integer | auto | default 0 |
| `notes` | text | no |  |

**Must supply on insert:** `scheme_account_id`, `installment_number`, `due_date`, `amount_due`

---

### `scheme_plan`

The scheme product: tenure, installment, bonus rules.

soft delete · unique: code

| Column | Type | Required | Notes |
|---|---|---|---|
| `code` | text | **yes** |  |
| `name` | text | **yes** |  |
| `description` | text | no |  |
| `metal_id` | → metal | **yes** |  |
| `accrual_basis` | text | auto | one of: rupee, weight · default 'rupee' |
| `tenure_months` | integer | **yes** |  |
| `installment_amount` | money | no | Null for flexible-amount schemes. |
| `minimum_installment` | money | no |  |
| `is_flexible_amount` | boolean | auto | default false |
| `bonus_installments` | number(6,3) | auto | default 0 |
| `bonus_percent` | rate | auto | default 0 |
| `max_missed_installments` | integer | auto | default 2 |
| `making_charge_discount_percent` | rate | auto | default 0 |
| `allow_partial_redemption` | boolean | auto | default false |
| `allow_cash_redemption` | boolean | auto | default false |
| `grace_period_days` | integer | auto | default 7 |
| `terms_and_conditions` | text | no |  |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `code`, `name`, `metal_id`, `tenure_months`

---

### `scheme_redemption`

Turning a matured account into jewellery. Partial redemption leaves the account open.

unique: redemption_number

| Column | Type | Required | Notes |
|---|---|---|---|
| `scheme_account_id` | → scheme_account | **yes** |  |
| `redemption_number` | text | **yes** |  |
| `redeemed_on` | date | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `is_partial` | boolean | auto | default false |
| `amount_redeemed` | money | auto | default 0 |
| `weight_redeemed` | weight (g) | auto | default 0 |
| `bonus_applied` | money | auto | default 0 |
| `rate_per_gram` | money | auto | default 0 |
| `sales_invoice_id` | → sales_invoice | no |  |
| `retail_order_id` | → retail_order | no |  |
| `cash_paid_out` | money | auto | default 0 |
| `voucher_id` | → voucher | no |  |
| `notes` | text | no |  |

**Must supply on insert:** `scheme_account_id`, `redemption_number`, `redeemed_on`, `branch_id`


## Settings & Theme Studio

### `tenant_theme`

Theme Studio. preset_key matches the frontend theme ids.

unique: branch_id

| Column | Type | Required | Notes |
|---|---|---|---|
| `preset_key` | text | auto | one of: deep-forest, royal-ruby, sapphire-platinum, obsidian-luxury, rose-gold, custom · default 'deep-forest' |
| `css_variables` | json | auto | default '{}' |
| `logo_url` | text | no |  |
| `logo_dark_url` | text | no |  |
| `favicon_url` | text | no |  |
| `branch_id` | → branch | no |  |
| `is_active` | boolean | auto | default true |

_Nothing is required beyond the automatic columns._


## Tagging & Barcoding

### `huid_assignment`




| Column | Type | Required | Notes |
|---|---|---|---|
| `piece_id` | → stock_piece | **yes** |  |
| `huid` | text | **yes** | The BIS 6-character alphanumeric identifier. |
| `hallmark_centre_code` | text | no |  |
| `hallmark_centre_name` | text | no |  |
| `hallmarked_on` | date | no |  |
| `certified_purity_percent` | purity % | no |  |
| `certificate_number` | text | no |  |
| `superseded_at` | timestamp | no |  |
| `supersede_reason` | text | no |  |
| `assigned_by` | → app_user | no |  |

**Must supply on insert:** `piece_id`, `huid`

---

### `tag_print_job`

The thermal printer queue the tagging screen shows.


| Column | Type | Required | Notes |
|---|---|---|---|
| `tag_template_id` | → tag_template | **yes** |  |
| `branch_id` | → branch | **yes** |  |
| `status` | text | auto | one of: queued, printing, printed, failed, cancelled · default 'queued' |
| `piece_count` | integer | auto | default 0 |
| `queued_by` | → app_user | no |  |
| `queued_at` | timestamp | auto |  |
| `printed_at` | timestamp | no |  |
| `printer_name` | text | no |  |
| `error_message` | text | no |  |

**Must supply on insert:** `tag_template_id`, `branch_id`

---

### `tag_print_job_item`



unique: tag_print_job_id + piece_id

| Column | Type | Required | Notes |
|---|---|---|---|
| `tag_print_job_id` | → tag_print_job | **yes** |  |
| `piece_id` | → stock_piece | **yes** |  |
| `copies` | integer | auto | default 1 |
| `rendered_payload` | json | auto | default '{}' |
| `printed` | boolean | auto | default false |

**Must supply on insert:** `tag_print_job_id`, `piece_id`

---

### `tag_template`

Label layouts. Dual-wing string tags are the common jewellery format.

soft delete · unique: code

| Column | Type | Required | Notes |
|---|---|---|---|
| `code` | text | **yes** |  |
| `name` | text | **yes** |  |
| `format` | text | auto | one of: string_tag_dual_wing, sticker, hang_tag, box_label · default 'string_tag_dual_wing' |
| `width_mm` | number(6,2) | auto | default 85 |
| `height_mm` | number(6,2) | auto | default 15 |
| `barcode_type` | text | auto | one of: code128, qr, datamatrix, ean13 · default 'code128' |
| `layout` | json | auto | default '{}' |
| `printer_model` | text | no |  |
| `is_default` | boolean | auto | default false |
| `is_active` | boolean | auto | default true |

**Must supply on insert:** `code`, `name`


## Tenancy

### `tenant`

One row per customer business. Everything else in the database points here.

**platform-level** (not tenant-scoped) · soft delete

| Column | Type | Required | Notes |
|---|---|---|---|
| `code` | text | **yes** | unique · Short slug used in URLs and logs. |
| `legal_name` | text | **yes** |  |
| `display_name` | text | **yes** |  |
| `kind` | text | auto | one of: manufacturer, retailer, both · default 'retailer' |
| `status` | text | auto | one of: trial, active, suspended, closed · default 'trial' |
| `country` | text | auto | default 'IN' |
| `base_currency` | text | auto | default 'INR' |
| `timezone` | text | auto | default 'Asia/Kolkata' |
| `gstin` | text | no |  |
| `pan` | text | no |  |
| `metadata` | json | auto | default '{}' |
| `activated_at` | timestamp | no |  |

**Must supply on insert:** `code`, `legal_name`, `display_name`

