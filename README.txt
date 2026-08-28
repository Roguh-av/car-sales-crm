Car Sales CRM V3.2 — Multi-user safe

Changes:
- Removed the old one-time claim mechanism from the frontend.
- Each salesperson uses their own Supabase login.
- Row Level Security limits every table to owner_id = authenticated user.
- owner_id is now mandatory and defaults to the signed-in user for new records.
- New accounts start with an empty CRM and cannot see another user's customers, leads, follow-ups, deliveries, leases, or lead history.
- Added Sign out button.

Your existing records remain assigned to your account.
