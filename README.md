# Farkle Dice Scorer

A mobile web app that scores Farkle automatically, tracked separately per dice
color — each color is one player's own set of dice. It supports both a
camera mode (point your phone at the rolled dice) and a manual-entry mode
(tap in the numbers yourself), so it keeps working even if the camera
detection has trouble with your lighting or dice.

## Why it needs to be hosted somewhere (not just opened as a file)

iPhone Safari only allows camera access (`getUserMedia`) on pages loaded
over **HTTPS** — opening `index.html` directly from the Files app will not
be able to use the camera. You need to put these files on any plain HTTPS
static web host, then open that URL in Safari on your iPhone and choose
**Share → Add to Home Screen**. After that it behaves like a regular app
icon (full screen, no Safari address bar).

The two easiest ways to do this, both free, and both **you set up yourself
in your own browser** (nothing here required me to create or log into any
account on your behalf):

### Option A — GitHub Pages (recommended, stays online indefinitely)
1. Create a new repository on github.com (or use one you already have).
2. Upload everything in this `site/` folder to the repo (drag-and-drop on
   github.com works fine, or `git push` if you're comfortable with git).
3. In the repo, go to **Settings → Pages**, set the source to the branch
   you uploaded to (root folder), and save.
4. GitHub gives you a URL like `https://yourname.github.io/your-repo/`.
   Open that on your iPhone in Safari, then **Share → Add to Home Screen**.

### Option B — Netlify Drop (fastest, no account required to try it)
1. On your computer, go to **app.netlify.com/drop** in a browser.
2. Drag the whole `site/` folder onto the page.
3. It gives you an instant `https://...netlify.app` URL. Open it on your
   iPhone in Safari, then **Share → Add to Home Screen**.
   (Sign up on Netlify afterwards only if you want that URL to stay
   permanent / be easy to update later — the initial drop works without it.)

Either way, re-upload the files any time you want to update the app.

## First-time setup in the app

1. Open the app and go to **Settings → Dice Colors**. For each color of
   dice you play with, tap **Calibrate**, center that die in the circle
   under normal lighting, and tap **Sample**.
2. Tap **Start New Game**, check the 2+ colors playing this game, and tap
   **Start Game**.
3. On your turn, tap **Roll Dice**, physically roll your colored dice, then
   either:
   - **Camera tab** — tap **Capture**, check the detected values (tap any
     chip's − / + to fix a misread, ✕ to remove a false detection, or
     "+ Add a die I missed"), then **Confirm & Score**; or
   - **Manual tab** — tap each die face to set what it actually rolled,
     then **Confirm & Score**.
4. The app totals the roll using Farkle scoring rules, adds it to your turn
   score, and tells you how many dice are left to roll (or if you got Hot
   Dice / Farkled). Tap **Bank Score** whenever you want to lock in your
   turn total and pass to the next color.

House rules (three-pairs value, straight value, what counts as four/five/six
of a kind, the minimum score needed to get on the board, the winning score,
etc.) are all editable under **Settings → Farkle House Rules**, since real
groups play Farkle slightly differently.

## Notes on the camera detection

Dice reading is done entirely on-device with OpenCV.js: it looks for blobs
matching each calibrated color, then counts the pips inside each one. It's a
heuristic, not a trained model, so glare, shadows, touching dice, or very
low light can throw it off — that's exactly why every detected value is
editable before it's scored, and why Manual entry exists as a full
equivalent, not an afterthought. Recalibrating a color (Settings → that
color → Recalibrate) in the lighting you'll actually be playing under
usually fixes most misreads.

## Files

- `index.html`, `style.css`, `app.js` — the app shell and UI logic
- `farkle-engine.js` — pure scoring logic (unit-tested; see `/test` in the
  project source if you ever want to re-run the checks)
- `dice-vision.js` — camera-based color + pip detection (uses OpenCV.js)
- `manifest.json`, `icons/`, `service-worker.js` — Add-to-Home-Screen support
