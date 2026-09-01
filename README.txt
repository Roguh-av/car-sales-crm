Car Sales CRM V4.9 — Morning Plan and Mobile Lease Fix

What is new in V4.9:
- A Morning Sales Plan now appears near the top of the dashboard.
- The plan prioritizes overdue follow-ups, today's remaining schedule,
  deliveries today or tomorrow, and active leads without a next action.
- Each plan item opens the related follow-up, delivery or lead directly.
- The dedicated Deliveries tab and app shortcut have been removed.
- Delivery records remain available in the calendar, notifications, lead files,
  reports and the Sold / Lost / Delivered archive.
- Lease customers now display as complete phone-friendly cards.
- Phone lease cards show phone, vehicle, stock, lease start, term, lease end,
  VIN, transaction number, payment mode, sales rep and notes.
- Call and Text buttons are available directly on each phone lease card.
- Updated the app cache so installed phones receive the new version.

Previous V4.8 features:
- Customer records display as clean cards on phones.
- Call and Text buttons remain side by side without overlapping.
- Customer names, phone numbers, cities and statuses wrap correctly.
- The customer page does not create sideways page scrolling.
- The full customer table remains available on PC.

Previous V4.7 features:
- Install the CRM on an Android home screen as a full-screen app.
- Background push notifications work even when the CRM is closed.
- Appointment reminders: 1 day before and 1 hour before.
- Delivery reminders: 1 day before and 1 hour before.
- Dashboard setup card shows App and Notification status.
- One-tap Enable, Test and Disable notification controls.
- Secure per-user device subscriptions protected by Supabase row-level security.
- Automatic reminder job runs every 5 minutes and prevents duplicate reminders.
- No Play Store, paid notification provider or app-store fee is required.

Installation:
1. Upload this ZIP to the existing Netlify site.
2. Open the Netlify website in Chrome on the Android phone.
3. Sign in to the CRM.
4. Tap Install App in the Phone App & Reminders card. If Chrome does not show
   the prompt, tap Chrome's three-dot menu and choose Add to Home screen.
5. Open the installed CRM from the new home-screen icon.
6. Tap Enable Notifications, then Allow.
7. Tap Test and confirm the notification appears.

Keep:
- Continue using the same Supabase project. The notification database and
  background reminder service have already been configured for it.
- Continue deploying updates to the same Netlify site so the installed app
  keeps the same address and automatically receives updates.

Existing V4.6 features remain, including the Sunday-Saturday calendar, previous
and future week navigation, in-app date picker, message templates, dedicated
follow-ups, archive workflow, backups and live used-inventory shortcut.
