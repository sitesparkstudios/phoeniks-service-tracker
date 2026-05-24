# Phoeniks Service Tracker — Setup & Edit Guide

## Quick Start (Local)

### Option A — VS Code + Live Server (recommended)
1. Download and install **VS Code**: https://code.visualstudio.com
2. Install the **Live Server** extension (search "Live Server" by Ritwick Dey in the Extensions panel)
3. Open the `phoeniks-tracker` folder in VS Code
4. Right-click `index.html` → **Open with Live Server**
5. App opens at `http://127.0.0.1:5500` — auto-refreshes on every save ✓

### Option B — Python (no install needed if you have Python)
```bash
cd phoeniks-tracker
python -m http.server 8080
# then open http://localhost:8080
```

> **Why not just double-click index.html?**
> The browser blocks local JS file imports for security (`file://` protocol).
> A local server (either option above) fixes this instantly.

---

## File Map — What to Edit for Each Change

| File | What lives here | When to edit |
|------|----------------|--------------|
| `index.html` | Page structure, sidebar nav, page HTML skeletons | Adding a new page, changing nav labels, adding a new HTML section |
| `styles.css` | All colours, fonts, spacing, layout | Colour changes, dark/light mode, spacing tweaks, new component styles |
| `data.js` | Data storage, CSV import/export, Odoo field mapping, chatter parser, seed demo data | Odoo field changes, new fields, import logic, adding new job properties |
| `render.js` | Dashboard, All Jobs, Bottleneck, Suppliers, Job modal render functions | Changing what columns show, adding KPI cards, changing table layout |
| `meeting.js` | Monday meeting mode — all 4 slides | Adding/removing meeting slides, changing meeting layout |
| `app.js` | Page routing, save/edit/delete job, form handling, keyboard shortcuts | Adding new pages, form fields, keyboard shortcuts |

---

## Common Edit Examples

### Change brand colours
Edit `:root` variables at the top of `styles.css`:
```css
--phoenix: #ff5f1f;   /* main brand orange — change this */
--bg:      #0d0f12;   /* dark background */
```

### Add a new Odoo CSV field
In `data.js`, add to `ODOO_MAP`:
```js
const ODOO_MAP = {
  ...
  'your new odoo column name': 'internalFieldKey',
};
```
Then handle `internalFieldKey` in the `processCSVFile` function.

### Add a new meeting slide
In `meeting.js`:
1. Increase `MEETING_TOTAL` from 4 to 5
2. Add the HTML div in `index.html`: `<div class="meeting-slide" id="slide-4">...</div>`
3. Add build logic in `buildMeetingSlides()`

### Change the overdue threshold (currently 14 days)
In `render.js` search for `> 14` — there are 3 occurrences (dashboard, jobs list, meeting).
Also in `data.js` if you want CSV import to flag them.

### Add a new job field (e.g. Serial Number)
1. `index.html` — add input to the Add/Edit form
2. `data.js` `seedDemo()` — add to sample data
3. `app.js` `saveJob()` and `editJob()` — read/write the new field
4. `render.js` `openJobModal()` — show in modal
5. `render.js` `renderJobs()` — optionally show in table

---

## Deploying for the Team

When you're ready to share with staff, the simplest free options are:

### Netlify Drop (30 seconds, free)
1. Go to https://app.netlify.com/drop
2. Drag the entire `phoeniks-tracker` folder onto the page
3. You get a live URL like `https://amazing-name-123.netlify.app`
4. Share that URL with your team

### GitHub Pages (free, version-controlled)
1. Push the folder to a GitHub repo
2. Settings → Pages → Deploy from branch → `main` / `root`
3. Live at `https://yourusername.github.io/phoeniks-tracker`

### Future: Multi-user with a backend
When you want real-time shared data (multiple staff editing simultaneously),
the next step is adding a small backend. Good options:
- **Supabase** (free tier) — Postgres database + auth, minimal code change
- **Firebase** — Google's real-time database, works well for this use case
- Both can be added without rebuilding the whole front end

---

## Data
All job data is stored in your browser's `localStorage` under the key `phoeniks_tracker_v2`.
To back it up: Export CSV from the topbar. To restore: re-import the CSV.
