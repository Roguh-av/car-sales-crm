# CRM audit and focused repair — 9 September 2026

Baseline: `054ecca52500ee87d479d7dff4fe454c98b1c4ce` in `Roguh-av/car-sales-crm`.

## How the existing CRM works

The frontend is a buildless HTML application: CSS and most page logic live in `index.html`. Pages are toggled in place; navigation preferences are stored per user. Supabase Auth handles email/password sessions; `crm_account_access` supplies approval and administrator status. Owner-scoped row-level policies protect the business tables. GitHub is connected to the existing Cloudflare deployment. The repository still contains legacy Netlify injection scripts and configuration; Cloudflare account build settings are not recorded in the repository.

`customers` is the shared identity. `leads`, `leases`, and `finance_contracts` reference it. Appointments are `followups` with action type Appointment. Followups can also reference a lead, lease, finance contract or delivery. The calendar renders those rows plus `deliveries`. Call history is split across `lead_history`, `lease_outreach_history` and `finance_outreach_history`. `daily_priority_calls` stores daily call completion snapshots. Orders are separate customer/lead-linked rows.

## Already working

- Real Supabase records feed the dashboard, opportunity lists and calendar.
- Approval and owner-based RLS are enabled on all inspected public tables.
- Call-result RPCs save interactions transactionally and daily progress already exists.
- Day/Week/Month calendar views, filters, completion checkboxes and the current dark layout exist.
- Finance and lease outreach queues retain closed opportunities.

## Problems found

- Lead notes, status changes and scheduling entries incorrectly counted as contact. Completed actions used their scheduled time instead of actual completion time.
- An old open appointment was labeled missed without evidence. Negotiating was treated as proof of a quote; Showed was treated as a recent visit without checking its date.
- Future-appointment queue filtering also excluded old appointments from Top 10 consideration.
- The extra-five logic could display more cards than requested. Completion counted opportunity rows rather than distinct customers. Server and client could use different dates around midnight.
- There was no combined customer timeline or timestamped customer-level note form.
- Calendar edits performed separate writes to followups and contracts. These could diverge; lead next-action dates were inconsistently synchronized.
- New call results could leave multiple obsolete future reminders. Lease removal deleted reminders and daily completion records.
- Data loading had no pagination and could leave a partially updated cache on a query error. Authentication callbacks repeatedly loaded the app; the service worker navigated all open windows on activation, risking unsaved forms.
- Several lead history writes ignored database errors. Legacy build injectors and duplicated calendar-editor code make maintenance brittle.

## Real data and unsupported assumptions

The read-only audit found 240 customers, 224 finance contracts, 15 leases, 6 leads, 6 followups and 3 daily-call records. Counts are a point-in-time observation. There were no exact duplicate open actions or mismatched opportunity/customer followup links in those records. No fake customer dataset was found in the deployed application source.

Missing contact history does not prove a customer was never contacted. The repaired wording is **No contact recorded**. Finance ownership is calculated only from an actual stored delivery date, never estimated from loan maturity and term. Old history is preserved; unknown completion timestamps are not backfilled. Quotes and visits earn specific ranking reasons only when supported by dated activity. The existing dealer review URL and public Supabase publishable key are configuration, not placeholder customer data.

## Implemented in this change

1. Extract deterministic, separately testable ranking rules into `priority-engine.mjs`. Deduplicate customers; exclude closed/removed/DNC opportunities; use Toronto business dates; correct the bounded progress list and explain missing data.
2. Preserve removed leases and reminders. Use cancellation timestamps and existing lease removal fields; retain daily completion records.
3. Add an append-only `customer_activity` journal for customer notes and calendar/delivery changes. Merge it with existing history sources rather than copying customers or opportunities.
4. Synchronize next-action dates with remaining open reminders in database triggers. Validate linked customer ownership. Reject missing/past next-action dates and stale closed Top 10 calls. Replace obsolete call reminders non-destructively.
5. Show the combined customer history and manual note form. Let the existing lead note form record explicit visit, test-drive, quote and interest activity.
6. Load complete datasets with pagination before replacing the cache. Avoid unnecessary auth reloads and service-worker page navigation. Refresh visible data periodically without interrupting an open form.

## Verification and release status

- 32 ranking/static checks, 12 isolated PostgreSQL workflow/RLS checks, and 7 DOM interaction checks pass.
- Database tests use a schema-only production snapshot in local PGlite, authenticated roles, and rolled-back test records. They cover save/reload, required next dates, calendar synchronization, lease retention, owner isolation, DNC and closed-opportunity protection, notes, and delivery reminder uniqueness.
- DOM tests cover dashboard/calendar rendering, Call & Update, customer notes, session refresh, paginated loading and failed-query cache retention. DOM tests do not prove visual layout.
- The real site's login screen was reached, but the test browser then timed out. Signed-in desktop/mobile screenshots, actual Supabase HTTP write/reload and post-deployment checks remain unverified.
- These migrations have **not** been applied to production and the frontend has **not** been deployed in this repair pass. No production customer data was changed.

## Rollout order and remaining work

Apply `supabase/crm_integrity_v2.sql` once, then `supabase/call_workflow_v2.sql`, using tracked Supabase migrations. Release the frontend and both `.mjs` files together through the existing GitHub/Cloudflare path. Validate authenticated saves/reloads and inspect both viewport sizes before declaring the release fully verified. Never run the test schema fixture against Supabase; it is only for the isolated test database.

Keep schema additions if a frontend rollback is needed: dropping the activity journal or cancellation columns would destroy newly recorded history. Restoring the old frontend would also reintroduce its separate next-action writes and false contact assumptions, so prefer a forward fix.

Later work should consolidate the two existing calendar editors, version/pin the externally loaded Supabase client, document Cloudflare build configuration, and audit the older CRUD paths (customer-plus-lead creation and order/delivery edits). This repair does not implement or verify push notifications. Their database tables alone do not establish a working notification service.

## Running the regression checks

Install test-only dependencies with `npm install --prefix tests`, then run `npm test --prefix tests`. Production remains buildless and does not load these dependencies. Test fixtures are synthetic and isolated from the application. `CRM_TEST_PGLITE` and `CRM_TEST_JSDOM` can point to an already-installed test runtime.
