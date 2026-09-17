# Grill Tracker

A one-screen app for logging how many chicken and duck skewers (Hendlspieße /
Entenspieße) are **currently on the grill**, with a timestamp, straight into a
Google Sheet. Built for a tablet or phone at a festival stand — two big
buttons, a number pad, done. A comparison graph shows today's readings against
a historical weekday average, to help anticipate demand before you run low.

## 1. Create the Google Sheet + backend (one-time setup)

1. Go to [sheets.google.com](https://sheets.google.com) and create a new,
   blank spreadsheet. Name it something like "Grill Tracker Log".
2. In the menu, go to **Extensions -> Apps Script**.
3. Delete any starter code in the editor and paste in the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this project.
4. Click **Deploy -> New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, and authorize the script when prompted (you'll see
     an "unverified app" warning since it's your own script — click
     **Advanced -> Go to (project name)** to proceed).
5. Copy the **Web app URL** it gives you (ends in `/exec`).
6. Open [`app.js`](app.js) in this project, and paste that URL into the
   `scriptUrl` value near the top of the file, replacing
   `"PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE"`.

Every time you log or delete an entry, a row (Date, Time, Type,
Quantity, ID) is added to or removed from a "Log" sheet in that
spreadsheet. The ID column is an internal reference the app uses to
find the right row — you can ignore it. "Quantity" here means the
current count on the grill at that moment, not an amount added — see
"Using it" below.

**Robustness:** the app keeps every add/delete in a local queue and
retries automatically (on load, when the connection comes back, and
every 15 seconds) until it's confirmed sent — so a dropped wifi signal
for a few seconds doesn't lose an entry. The Apps Script backend is
idempotent (it checks the ID before writing), so a retried request can
never create a duplicate row. A small line under the totals reads
"✓ Synced to Sheet" or "⏳ N pending sync" so you can see at a glance
if anything is still waiting to go out.

## 2. Host it and send the link to your boss

Any static file host works — the fastest way to get a real link to send
today is **Netlify Drop**, no account required:

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag this whole `grill-tracker` folder onto the page.
3. Netlify uploads it and gives you a live HTTPS link (something like
   `https://random-name-123.netlify.app`) within seconds.
4. Send that link to your boss (text, WhatsApp, email — whatever's
   easiest). Opening it works on any phone or tablet immediately.

That link works right away but is anonymous/temporary. If you want a
stable link you can update later, create a free Netlify account (you
can do this after the drop too, via "Claim this deploy") — then you can
drag-and-drop an updated folder onto the same site any time you make a
change here.

**Alternative — GitHub Pages** (better if you're already using git and
want every change to deploy automatically):

1. Create a new GitHub repo and push the contents of this folder to it.
2. In the repo's Settings -> Pages, set the source to the main branch
   (root).
3. GitHub gives you a URL like `https://yourname.github.io/grill-tracker/`.

## 3. Add it to the home screen (iPhone/iPad)

Have your boss do this once, on his own device:

1. Open the link you sent him in **Safari**.
2. Tap the Share icon -> **Add to Home Screen**.
3. Launching it from the home screen now opens full-screen, no browser
   bar — like a normal app.

## Using it

- On first open (per device), enter the **PIN: `1855`**. It's remembered
  after that, so it only needs entering once per phone/tablet.
- Tap **Hendlspieße** or **Entenspieße**.
- Type how many skewers are **currently hanging on the grill right now**
  (not how many you just added — e.g. if 15 were up and you hang 20 more
  while also pulling 10 off, enter `25`, the new total on the grill).
- Tap **Confirm**. A row is saved to the Google Sheet with the current
  date and time, and the on-screen "aktuell" figure updates to that
  number.
- Made a mistake? Tap the **✕** next to the entry in the "Letzte
  Einträge" list, confirm, and it's removed from both the app and the
  Google Sheet.
- Overall sold totals for the day aren't tracked by this app — that
  comes from the point-of-sale system. This app is only about the live
  count on the grill, to help judge when to hang more.

## Comparison graph

Tap the **📊** button (top-right) to see today's readings plotted against
a comparison line for today's weekday — e.g. it's 13:30 on a Saturday,
you have 20 up, but Saturdays usually have 40 by 14:00, which is a signal
to hang more now. A picker under the 🐔/🦆 toggle lets you choose what
that comparison line shows: the overall **"Durchschnitt"** average, or
one specific past **year**.

### Durchschnitt (average)

Comes from a **"Referenz"** sheet tab (created automatically, empty, the
first time the app tries to read it) with columns:

| Wochentag | Zeit  | Hendlspieße | Entenspieße |
|-----------|-------|-------------|-------------|
| Samstag   | 13:00 | 25          | 8           |
| Samstag   | 14:00 | 40          | 12          |
| Samstag   | 15:00 | 38          | 15          |

Fill in as many rows as you like, for whichever weekdays/times you have
historical data for — any granularity works, the graph just plots
whatever rows match today's weekday, sorted by time.

### Specific years

Add a sheet tab named exactly the year, e.g. **"2024"**, with columns:

| Date       | Time  | Type  | Quantity |
|------------|-------|-------|----------|
| 2024-08-17 | 13:05 | hendl | 22       |
| 2024-08-17 | 13:40 | ente  | 6        |
| 2024-08-17 | 14:10 | hendl | 38       |

Same idea as the "Log" sheet, minus the ID column — one row per actual
reading, `Type` is `hendl` or `ente`. Any sheet whose name is a
4-digit year is picked up automatically as a picker option; no code
change needed to add a new one. The app filters each year's rows to
whichever weekday matches today (computed from `Date`) before plotting,
same as the Durchschnitt average.

**Building up years over time:** once a season has been run through the
app, open the spreadsheet and use the **Grill Tracker -> Season
abschließen: Log archivieren** menu (added by the Apps Script). It asks
which year to file the current "Log" contents under, copies those rows
into a new (or existing) year sheet in the format above, and optionally
clears "Log" so the next season starts empty — "Log" itself keeps
meaning exactly what it means today, the current season's live data.
For years before this app existed, just type the rows in by hand.

Until any of this is filled in, the graph still shows today's actual
readings, just with nothing to compare against.

**Note:** reading these tabs requires the Apps Script's `doGet`/`onOpen`
functions — if you deployed the Apps Script before this feature existed,
redeploy it (see "Notes" below) for the graph and the archive menu to
work.

## Access control

**PIN lock** (`APP_PIN` in `app.js`, currently `1855`) — the app is
unusable until the right PIN is entered. Change it any time by editing
that constant. Not bulletproof against someone determined enough to
read the app's JavaScript source (there's no way around that for a
pure client-side app without a real login system), but it stops
casual/accidental access, which is what this is for.

## Notes

- Every entry is saved to the phone/tablet immediately (so nothing is
  lost even on a brief connection drop) and synced to the Sheet in the
  background — see "Robustness" above.
- `icons/icon-192.png` and `icon-512.png` are plain placeholder color
  swatches. Swap them for a real icon any time — same filenames, same
  sizes (192x192 and 512x512 PNG).
- If you ever change the Apps Script code after it's already deployed,
  you need to redeploy it for the change to take effect: **Deploy ->
  Manage deployments -> edit (pencil icon) -> New version -> Deploy**.
  The URL stays the same, so you won't need to update `app.js` again.
