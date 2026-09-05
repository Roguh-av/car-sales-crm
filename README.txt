Car Sales CRM V3.2 — Multi-user safe

Changes:
- Removed the old one-time claim mechanism from the frontend.
- Each salesperson uses their own Supabase login.
- Row Level Security limits every table to owner_id = authenticated user.
- owner_id is now mandatory and defaults to the signed-in user for new records.
- New accounts start with an empty CRM and cannot see another user's customers, leads, follow-ups, deliveries, leases, or lead history.
- Added Sign out button.

Your existing records remain assigned to your account.

Cloudflare deployment enabled
Deployment retry 2

Top 10 Calls Today:
- Ranks live lead, lease and finance opportunities on the dashboard.
- Records each call result and next action in Supabase.
- Keeps the existing metrics, action list and Day / Week / Month calendar below it.
