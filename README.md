# Room Studio: Baker Tower 126 and 226

A personal room planning studio for a two level apartment in Baker Tower, Cornell University:

- **Room 126 (Lower)**: the only entrance.
- **Room 226 (Upper)**: reached by the internal winding staircase from 126.

Draw both rooms to scale from your own measurements, place and move furniture, try different layouts, keep shopping, get-rid-of and to-do lists tied to the plan, and share or co-edit it. It is a static web app (plain HTML, CSS and JavaScript, no build step, no server) that runs on GitHub Pages, installs to your phone's home screen, and works offline.

The project starts empty: two floors, no walls. Nothing about the rooms is invented; you enter every measurement.

---

## What it does

**Rooms drawn to scale**
- Two floors as tabs. The staircase appears on both floors in the same position and stays linked: move or resize it on one floor and the other follows.
- Units: centimeters or feet and inches (everything is stored in cm).
- Draw walls by typing lengths and turns (for example `412 cm, 90 deg, 356 cm, 90 deg, 412 cm, 90 deg, 356 cm`) or by tapping corners on a snapping grid. Tap any wall later and type its exact length; the next wall slides along so rectangles stay square.
- Fixed elements with exact sizes: doors (swing arc, hinge side, inward or outward, entrance flag), windows, radiators, AC unit, fireplace and mantel, kitchen counter, fridge, stove, closet, washroom, staircase (winding, spiral or straight), outlets and light fixtures. Doors, windows and wall-hung fixtures snap onto the nearest wall while dragged.
- Sloped ceiling zones (for 226): draw a zone, enter the low and high heights. Low areas are shaded, a red dashed line marks 190 cm headroom, and items taller than the ceiling above them are flagged.
- Trace mode: upload a photo of a hand sketch or the official plan, calibrate it by tapping two points and typing the real distance, then adjust opacity, lock or hide it.
- Grid of 5, 10, 25 or 50 cm with snap on or off, rulers, live wall dimensions, live size labels on the selected item, and distance-to-wall readouts while dragging.

**Furniture**
- Searchable library with real default sizes (sofas, beds, desks, rugs, floor cushions, poufs, macrame, lamps, plants including pothos, spider plant, Tradescantia pallida and Callisia fragrans, storage and more). All sizes are editable.
- Custom items: name, width, depth, height, rectangle, circle or L-shape, color and notes.
- Drag to move, rotate handle with 15 degree snap (hold Shift for free rotation), resize handles, duplicate, delete, lock, bring forward or send back, group and ungroup.
- Touch: one finger moves an item, two fingers pan and pinch-zoom, long-press opens the item menu.
- Status per item: Existing-Keep, Existing-Move, Existing-Remove, To Buy, Bought, each with its own outline style. Filter the view by status.
- Clearance checker: marks walkways under 90 cm in red and flags items that block a door swing, the staircase or the entrance.
- Layers: Structure, Furniture, Rugs, Lighting, Plants, Notes, Background trace.

**Layouts**
- Several named layouts per floor (Current, Option A, Option B...). Duplicate a layout to branch from it.
- Side by side compare, with a Swap button for quick toggling.
- Undo and redo for at least 150 steps (Ctrl or Cmd + Z, Ctrl or Cmd + Shift + Z, or the buttons in the top bar).

**Lists tied to the design**
- Shopping list: every To Buy item appears automatically with size, room, store, product link, price, priority (Must, Should, Nice) and a Bought checkbox. Tap a row to find the item on the plan; select an item on the plan to highlight its row.
- Budget tracker: planned spend against your budget (default USD 1,000 to 2,000, editable), with subtotals per room and per priority.
- Get-rid-of list for Existing-Remove items: sell, donate, move to storage, reuse elsewhere, recycle.
- To-do list with due dates, drag to reorder, and links to an item or a room.
- Sticky notes on the plan.
- Lists sort by room, priority, price or status, and filter.

**Working together**
1. Local first (default): autosaves in your browser (IndexedDB, with a localStorage fallback).
2. Share link: compresses the project into a link you can text. The other person opens it as their own editable copy and can send a link back.
3. Project file: save and open a `.json` file of the full project.
4. Optional live sync through a free Firebase Realtime Database (see below). Shows who is online and when the plan was last edited. Last write wins per item.
- Comment threads on every item.
- Describe for AI: copies the current floor as clean structured text to paste into an AI assistant.

**Export**: PNG and SVG of the current floor with dimensions and a legend, a printable PDF (one page per floor plus the shopping list), and the shopping list as CSV.

---

## Files

```
index.html
css/styles.css
js/app.js        app start, panels, toolbars, dialogs, shortcuts, tour
js/canvas.js     SVG plan rendering, geometry, touch and mouse interaction
js/state.js      data model, schema version and migration, undo store, sync merge
js/library.js    furniture library panel and custom items
js/lists.js      shopping list, budget, get-rid-of, to-do, notes
js/props.js      properties panel and comments
js/storage.js    IndexedDB with localStorage fallback
js/share.js      share links, project files, live sync, Describe for AI
js/export.js     PNG, SVG, PDF and CSV export
js/ui.js         small shared helpers (icons, dialogs, toasts)
data/furniture-library.json
manifest.json, service-worker.js, icons/
```

Libraries load from CDNs only when needed: lz-string (share links), jsPDF (PDF) and Rough.js (sketch style).

---

## Deploy to GitHub Pages (beginner steps)

1. Sign in at [github.com](https://github.com). Click the **+** in the top right, then **New repository**.
2. Name it, for example `baker-room-studio`. Choose **Public** (free GitHub Pages needs a public repository). Click **Create repository**.
3. On the new repository page, click **uploading an existing file**. Drag in everything from this folder: `index.html`, `manifest.json`, `service-worker.js`, `README.md`, and the folders `css`, `js`, `data` and `icons`. Keep the folder structure. Click **Commit changes**.
4. Go to **Settings**, then **Pages** in the left menu. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose the branch **main** and the folder **/ (root)**, and click **Save**.
5. Wait about a minute and refresh the Pages settings screen. Your address appears at the top, for example `https://YOUR-USERNAME.github.io/baker-room-studio/`. Open it on your laptop and phone.

To update the app later, upload changed files the same way. The service worker fetches fresh files first, so a normal reload picks up changes. If you add new files, also add them to the `APP_SHELL` list in `service-worker.js` and bump `VERSION` so they work offline.

---

## Install on your phone

**iPhone (Safari)**
1. Open your Pages address in Safari.
2. Tap the **Share** button (square with an arrow).
3. Scroll and tap **Add to Home Screen**, then **Add**.
4. Open Room Studio from the home screen. It runs full screen and works offline.

**Android (Chrome)**
1. Open your Pages address in Chrome.
2. Tap the three dots menu, then **Install app** (or **Add to Home screen**). On some phones a banner offers to install automatically, and Room Studio also shows **Install app** in its More menu.
3. Open it from the home screen or app drawer.

Each browser and installed app keeps its own saved copy. Use a share link, a project file or live sync to move the plan between devices.

---

## Optional live sync with Firebase (free)

Live sync lets two people edit the same plan at the same time. It uses the Firebase Realtime Database over its REST interface, so there is no SDK or account login inside the app. Background trace images stay on each device.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with a Google account.
2. Click **Create a project** (or **Add project**). Give it a name such as `room-studio`. You can turn off Google Analytics. Click **Create project**, then **Continue**.
3. In the left menu open **Build**, then **Realtime Database**. Click **Create Database**. Pick a location (for example United States), choose **Start in locked mode**, and click **Enable**.
4. Open the **Rules** tab, replace everything with the rules below, and click **Publish**:

   ```json
   {
     "rules": {
       ".read": false,
       ".write": false,
       "rooms": {
         "$room": {
           ".read": "$room.length >= 12",
           ".write": "$room.length >= 12"
         }
       }
     }
   }
   ```

   These rules let anyone who knows a room code of 12 or more characters read and write that room, and nothing else. Nobody can list the rooms. Treat the room code like a password.
5. Open the **Data** tab and copy the database address at the top. It looks like `https://room-studio-default-rtdb.firebaseio.com` (or ends in `firebasedatabase.app`).
6. In Room Studio, open **More**, then **Live sync**. Paste the address (or your whole Firebase config, the app finds the `databaseURL`), keep the suggested room code or type your own (12 or more characters), enter your name, and click **Connect**.
7. On the second device or for your partner: open the app, choose **More**, then **Live sync**, and enter the same address and the same room code.

The chip in the top bar shows **Live**, who is online, and when the plan was last edited and by whom. Edits are merged per item; if two people change the same item at once, the later change wins. To stop, open **Live sync** and click **Turn off**. The free Spark plan (1 GB stored, 10 GB downloaded per month) is far more than a room plan needs.

---

## Back up and restore your project

- **Automatic saving**: every change saves in the browser right away.
- **Back up**: **More**, then **Save project file**. This downloads a `.json` file with everything, including background images. Keep it in iCloud Drive, Google Drive or email it to yourself.
- **Restore**: **More**, then **Open project file**, and pick the `.json` file. Before replacing anything, the app saves your current project as a backup.
- **Undo a restore or a shared link**: **More**, then **Restore backup** swaps the backup back in (and keeps the other copy as the new backup).
- **Damaged files**: if a file cannot be read, the app shows a message and keeps your current project unchanged.
- **Private browsing**: some browsers block storage there. The app warns you; save a project file before closing.

---

## Testing checklist

Run through these once on a laptop and once on a phone.

**Desktop (Chrome, Firefox or Safari)**
- [ ] The app opens with two floor tabs, an empty grid and the five-step tour. Skip it, then reopen it from **More**, **Help and tour**.
- [ ] **Type lengths**: enter `400, 90, 300, 90, 400, 90, 300` and add. A closed 400 by 300 cm rectangle appears with wall labels.
- [ ] Click the top wall, change Length to `412`. The rectangle stays square and both long walls read 412 cm.
- [ ] Switch units to ft-in in **View**; labels change. Switch back.
- [ ] Add a sofa from the library. Drag it near a wall: dashed distance readouts appear and it snaps flush. Resize with a corner handle, rotate with the round handle (snaps by 15 degrees).
- [ ] Right-click the sofa: Duplicate, Set status, Lock, Delete all work. Ctrl + Z and Ctrl + Shift + Z undo and redo.
- [ ] Shift-click two items, press Ctrl + G to group, drag them together, then ungroup.
- [ ] In **Structure**, add a door and drag it onto a wall: it snaps in and shows its swing. Add the staircase, then switch to 226: it is in the same place.
- [ ] On 226, use **Sloped ceiling**, tap two corners, enter `120` and `240`. Put a tall bookshelf under the low side: it gets a red warning.
- [ ] Turn on **Clearance**: gaps under 90 cm and items in a door swing show in red.
- [ ] Mark the sofa To Buy, open **Shopping**, enter a price: the budget bar updates. Click the row: the sofa pulses on the plan.
- [ ] Add a to-do linked to the sofa, drag it to reorder, check it off.
- [ ] **Layouts**: duplicate Current as Option A, move something, then **Compare**. Use **Swap**.
- [ ] **More**: Export PNG, SVG, PDF and CSV. Save a project file, then open it again.
- [ ] **Share link**: copy it, open it in a private window, accept the copy.
- [ ] Upload a background image, **Calibrate** with two points and a real distance, adjust opacity, lock it.
- [ ] Toggle **Sketch style** and **Dark** theme.
- [ ] Reload the page: everything is still there.

**Phone (iPhone Safari and Android Chrome)**
- [ ] Install to the home screen and open it from there.
- [ ] Use the bottom bar: **Add** opens the library sheet, **Lists** opens the lists sheet, **More** opens the menu, **Draw** shows the drawing bar.
- [ ] Tap corners to draw a wall chain; tap the last point again to finish.
- [ ] One finger drags an item; two fingers pan and pinch-zoom; long-press opens the item menu.
- [ ] Tap an item: the properties sheet slides up and the item moves into view above it. Swipe the sheet handle down to close.
- [ ] Undo and redo buttons in the top bar work.
- [ ] Turn on airplane mode and reopen the app: it still loads and your plan is there.
- [ ] Optional: connect live sync on two devices and watch an item move on the other screen.
