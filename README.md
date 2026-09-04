# Grill Tracker

A one-screen app for logging how many chicken and duck skewers go on the
grill, with a timestamp, straight into a Google Sheet. Built for a tablet
or phone at a festival stand — two big buttons, a number pad, done.

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
find the right row — you can ignore it.

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
- Tap **Hendl** or **Ente**.
- Type the quantity on the number pad (e.g. `20`).
- Tap **Confirm**. A row is saved to the Google Sheet with the current
  date and time, and the on-screen "heute" totals update.
- Made a mistake? Tap the **✕** next to the entry in the "Letzte
  Einträge" list, confirm, and it's removed from both the app and the
  Google Sheet.

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
