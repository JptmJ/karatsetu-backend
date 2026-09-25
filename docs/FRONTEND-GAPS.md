# What the frontend has that the backend does not

Checked on 2026-09-20 against the live site.
The frontend bundle has grown from 831 KB to 1.75 MB since 14 September, so
there is a lot of new screen work to catch up with.

---

## The good news first

**Every endpoint your frontend calls already exists.** I pulled the list of API
calls straight out of the deployed JavaScript and compared it to the backend's
route list. All 59 of them match. Nothing the screens ask for is missing.

The frontend is already pointed at `https://karatsetu-backend.onrender.com` and
signs in properly. You can see it in the code: messages like *"Connected to
Karatsetu Live Cloud Backend"* and *"Live GST sales invoices synchronized with
Karatsetu backend"*.

**One thing to note:** the deployed backend is a few days behind. It reports
106 endpoints; the code now has 122. Deploy again to pick up today's work.

---

## The gap: ten screens with nowhere to save

These are features the frontend has **built the screen for**, but the backend
has no table to store. Right now the data lives only in the browser — refresh
the page and it is gone. You can see the frontend admitting this: it has
fallback messages like *"Backend createIntake fallback to local receipt"* and
*"Could not sync order to backend"*.

Ranked by how much trouble each one causes if left alone.

### 1. HSN / GST rate master, with versions

**What the screen does:** stores tax rates against HSN codes (7113 at 3%,
9988 job-work at 5%), each with the government notification it comes from, and
a "publish new version" button.

**Why it matters most:** the screen says *"Creates an immutable version without
affecting historical invoices"* — that is exactly right, and it is the whole
point. When GST changes, last year's invoices must keep last year's rate or your
returns will not reconcile. Today the rate is a single number in settings, so
changing it would silently rewrite history.

**Needs:** `hsn_code` and `tax_rate_version` tables, and invoice lines pointing
at the version they used.

### 2. Making-charge formula master

**What the screen does:** named, reusable pricing formulas — *"Bridal Intricate
(Base + %)"*, *"Daily Wear Flat Per-Gram"*, *"Tiered per-gram making charge that
decreases as piece weight increases"*. It mentions *"5 Module Formula Engines"*.

**Why it matters:** the backend today has one making-charge setting for the whole
business. The screen assumes you can pick a different formula per category or per
item. Tiered pricing is not supported at all.

**Needs:** a `making_charge_formula` table, and a link from item/category to it.

### 3. Cash limit and PAN rules (Section 269ST)

**What the screen does:** sets a maximum cash amount per transaction and per day
(₹2 lakh), and the point at which PAN must be collected under Rule 114B.

**Why it matters:** this is a legal limit, not a preference. Taking ₹2,50,000 in
cash is a penalty on the shop. The backend does not check it at all today, so
nothing stops a counter from booking it.

**Needs:** two config settings, plus a check when a POS payment is saved.

### 4. Payment modes and settlement

**What the screen does:** a master list of tender types — UPI QR, card machine,
EMI, bank transfer — with which account each settles into and what the gateway
charges.

**Why it matters:** payment modes are a fixed list in code right now. You cannot
add a new UPI provider without a deploy, and the gateway fee is not recorded
anywhere, so takings never quite reconcile with the bank.

**Needs:** a `payment_mode` table.

### 5. Print and document templates

**What the screen does:** a full visual designer — drag boxes, set fonts and
colours, snap to a 1 mm grid, pick paper size (A4 invoice, 80 mm thermal roll,
85×15 mm butterfly tag). It calls this *"6 Production Formats"*.

**Why it matters:** label templates have a home (`tag_template`), but invoices,
estimate slips, delivery challans and pawn tickets do not. A designed template
currently vanishes on refresh.

**Needs:** a `document_template` table holding the saved canvas layout.

### 6. Customer loyalty tiers

**What the screen does:** shows a loyalty tier and VIP status on the customer
record.

**Needs:** a couple of columns on `party`, plus the rule that sets the tier.

### 7. XRF machine settings

**What the screen does:** stores calibration rules for the purity-testing
machine — *"ThermoFisher XRF Serial Port Driver"*, touchstone and acid-test
deduction rules, and a calibration PDF to download.

**Why it matters:** the deduction rules decide how much you pay for old gold. If
they are not saved, two counters can value the same bangle differently and
nobody can explain why afterwards.

**Needs:** an `xrf_profile` table; the serial-port link stays in the browser.

### 8. Vault stations and counter passcodes

**What the screen does:** *"Enter station passcode"*, *"Local Vault Station
Mode"* — a physical till or vault terminal that staff unlock.

**Needs:** a `station` table, and the passcode check.

### 9. Reverse charge (RCM) on job work

**What the screen does:** an *"Apply Reverse Charge"* tick box, for job work
bought from an unregistered artisan.

**Why it matters:** with RCM the shop pays the GST instead of the artisan. The
invoice needs to record that it happened or the GST return is wrong.

**Needs:** one flag on purchase invoices and their lines, and the posting rule.

### 10. Government integrations

Two buttons that currently do nothing at the backend:

- **e-Invoice / IRN** — the columns exist on `sales_invoice`, but nothing talks
  to the government portal yet. Only required above the turnover threshold.
- **BIS portal sync** for HUID — no groundwork yet.

---

## Things that look missing but are fine

- **PDF generation** — done in the browser with jsPDF. Correct place for it.
- **Offline POS sync** — the browser stores unsent bills and pushes them later.
  Nothing for the backend to do beyond accepting them when they arrive.
- **Draft auto-save** — kept in the browser on purpose, so a half-typed order
  survives a refresh. It should not reach the server until confirmed.
- **Amount in words** — formatting, done on screen.

---

## Suggested order

| | What | Why now |
|---|---|---|
| 1 | HSN / GST versions | Legal, and it corrupts old invoices if added later |
| 2 | Cash limit + PAN rules | Legal, and it is a small change |
| 3 | Making-charge formulas | Pricing is wrong on every bill without it |
| 4 | Payment modes | Takings do not reconcile without it |
| 5 | Document templates | Big screen, already built, nowhere to save |
| 6 | RCM flag | Needed before the first artisan job-work bill |
| 7 | Loyalty tiers | Useful, not urgent |
| 8 | XRF profiles | Matters once more than one person tests gold |
| 9 | Vault stations | Matters once there is more than one counter |
| 10 | e-Invoice / BIS | Only when you cross the threshold |

Items 1 to 4 are about a week of backend work together, and they are the ones
that cause real trouble if they are bolted on after you have live invoices.
