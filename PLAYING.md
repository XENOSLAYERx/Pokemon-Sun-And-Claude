# Playing Project Alola

Runs in any modern browser on Windows, macOS or Linux. There is nothing to
install beyond Node — no game client, no account, no build step.

---

## 1. Get Node

You need **Node 20.11 or newer**. Check what you have:

```bash
node -v
```

If that errors or prints something below `v20.11`, install it from
[nodejs.org](https://nodejs.org) (take the LTS build) and reopen your terminal.

## 2. Get the code

```bash
git clone https://github.com/XENOSLAYERx/Pokemon-Sun-And-Claude.git
cd Pokemon-Sun-And-Claude
git checkout claude/quirky-dijkstra-ibrhxg
```

That branch is the one with the game on it. (If it has been merged by the time
you read this, plain `main` is fine.)

## 3. Install and run

```bash
npm install
npm run dev
```

You'll see:

```
  VITE v6.4.3  ready in 209 ms

  ➜  Local:   http://localhost:5173/
```

**Open <http://localhost:5173/> in Chrome.** Leave the terminal running — that
is the server. `Ctrl+C` stops it.

Edge, Firefox and Safari all work too; anything with WebGL2 will do.

First load takes a little while — it is generating five islands, streaming the
ground under your feet, and populating the area before it hands you the world.
The progress bar tells you which stage it is on.

---

## 4. Start playing

You'll get a **name box and three partners** — Rowlet, Litten or Popplio. Pick
one and press **Begin**. Your starter's level is set from whatever actually
lives on the coastline you spawn on, so the first few fights are winnable.

### Controls

| Key | Does |
|-----|------|
| **W A S D** | Move (relative to the camera) |
| **mouse drag** | Look around |
| **Shift** | Sprint |
| **Space** | Toggle riding — much faster, and you can cross water |
| **E** | **Battle the nearest wild Pokémon** |
| **Tab** | Team, bag, Pokédex, rest and save |
| **T** | Skip an hour (watch the light change) |
| **R** | Cycle the weather (watch the sea change) |
| **F** | Free-fly camera — good for looking at the islands |
| **Q** | Cycle graphics quality |

### Finding a fight

Walk around. When something engageable is nearby, a prompt appears at the
bottom of the screen:

> **E**  battle the wild Grubbin (Lv 8)

Press **E**. The camera moves into the fight on the ground you were already
standing on — there is no encounter screen and nothing loads.

You can't pull a battle out of a Pokémon that's asleep or already running away.
Some will start the fight themselves: an aggressive, territorial or apex
species that has decided to hunt you. You can run from most things. You cannot
run from an apex predator, or from a Bewear that has decided you're a threat.

### In a battle

Arrow keys or **W/A/S/D** move the cursor, **Enter** or **Space** chooses,
**Esc** backs out. The mouse works for all of it too.

- **Fight** — your moves, with type, category, power and PP
- **Bag** — throw a Poké Ball, or use a Potion
- **Pokémon** — switch
- **Run** — leave

Weaken something before you throw a ball; a nearly-fainted Pokémon is far
easier to catch. Status helps too — sleep most of all.

If you have a Z-Ring and a matching crystal, a **Z-Move** button appears. It
opens a short pose: hit the arrow sequence shown, in order, before the timer
runs out. Fumbling it still delivers most of the power.

### Saving

**Tab → Save.** It writes to your browser's storage for this site, and
autosaves every couple of minutes while you're exploring (never mid-battle).
Reopening `localhost:5173` picks up where you left off.

Note this means your save lives in *that browser on that machine*. Clearing
site data for `localhost` deletes it.

---

## Troubleshooting

**It's slow / the frame rate is bad.**
Press **Q** to step down the quality preset. Check the `quality` line in the
Performance panel — if it says *Software fallback*, Chrome isn't using your
GPU. Turn on `chrome://settings/system` → "Use graphics acceleration when
available" and restart Chrome.

**`npm install` fails.**
Almost always an old Node. `node -v` must be ≥ 20.11.

**Port 5173 is already in use.**
`npm run dev -- --port 5200`, then open that port instead.

**Black screen, or it never finishes loading.**
Open DevTools (`F12`) → Console. If it mentions WebGL, your browser can't get a
3D context — see the graphics acceleration note above.

**I want to start over.**
DevTools → Application → Local Storage → `http://localhost:5173` → delete the
`alola.save.0` entry. Reload and you'll get the new-game screen.

**Playing from another device on your network.**
The dev server already listens on your LAN — use the `Network:` address it
printed (e.g. `http://192.168.1.20:5173/`) from a phone or tablet on the same
Wi-Fi. There are no touch controls, so you'll want a keyboard.

---

## Using your own models

Every Pokémon and the player already has a 3D model, built in code — you don't
need to download anything. To see them all, open
<http://localhost:5173/models.html> (add `?walk` to watch them move).

If you have `.glb` models you'd rather use (made yourself, or ones whose licence
lets you use them), put them in `apps/client/public/models/` and list them in
`manifest.json` there:

```json
{
  "player": "trainer.glb",
  "species": { "PIKACHU": "pikachu.glb" }
}
```

Reload and they replace the built-in ones, in the world and in battle. Size and
position are fixed up automatically; animations named *idle*, *walk* or *run*
are used if the file has them. A file that fails to load is skipped with a
notice and the built-in model stays. Pictures alone won't work — it needs a 3D
model file.

To start from the built-in models in Blender:

```bash
npm run models:export -- PIKACHU LAPRAS --player   # or --all
```

Details in [`apps/client/public/models/README.md`](apps/client/public/models/README.md).

---

## Making a shareable build

```bash
npm run build
```

Writes a static site to `apps/client/dist/`. Serve it with anything:

```bash
npx http-server apps/client/dist -p 4173
```

It's plain static files — host it on GitHub Pages, Netlify, or any web server.
There is no backend.

---

## What to expect

This is a working vertical slice, not a finished product. In particular:

- **The models are built in code, not hand-made art.** Each species has its
  own recognisable shape, colours and animation, but they are simple and toon-
  shaded rather than detailed. Grass, trees and buildings aren't in yet, so the
  ground is bare.
- **No trainers, no evolution, no shops, no story.** Wild battles, catching and
  levelling work; the trials and quests exist as tested systems with nothing
  authored in front of them yet.
- The world itself is the point: five islands, seamless streaming, weather
  driving the ocean, and Pokémon that hunt, flock, sleep and defend territory
  whether or not you're watching.

`npm test` runs 553 tests in a couple of seconds if you want to see the
machinery underneath. [`docs/README.md`](docs/README.md) explains how all of it
works.
