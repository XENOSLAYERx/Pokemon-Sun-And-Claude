# Tutorial: from nothing to your first catch

This walks you through everything, one step at a time: installing what you need,
downloading the game, starting it, and your first ten minutes in Alola. It takes
about ten minutes. No programming knowledge needed.

You'll type commands into a **terminal**. For each grey box: copy it, paste it
into the terminal, press **Enter**, and wait for it to finish before the next
one.

> **Pasting into a terminal:** on a Chromebook it's **Ctrl+Shift+V**, not
> Ctrl+V. On a Mac it's Cmd+V. In Git Bash on Windows it's **Shift+Insert**.

Already set up and just want the controls? See [PLAYING.md](PLAYING.md).

---

## Part 1 — Set up (once)

### Step 1. Open a terminal

- **Chromebook:** open the **Terminal** app and click **penguin**. If you don't
  have it, open Settings, search for **Linux**, and turn on the *Linux
  development environment* first. You'll see a prompt like `you@penguin:~$`.
- **Mac:** open **Terminal** (press Cmd+Space and type *Terminal*).
- **Windows:** install [Git for Windows](https://git-scm.com/download/win),
  then open **Git Bash** from the Start menu.

### Step 2. Install git and curl (Chromebook and Linux only)

```bash
sudo apt update && sudo apt install -y git curl
```

Mac and Windows: skip this. Git for Windows already includes git, and Macs
offer to install it the first time you use it.

### Step 3. Install Node

Node is what runs the game's local server. You need **version 22 or newer**.

**Chromebook, Linux and Mac** — use nvm, which installs Node without needing
admin rights:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
```

**Now close the terminal and open a new one** (nvm only works in a fresh
terminal). Then:

```bash
nvm install --lts
```

**Windows** — download the **LTS** installer from [nodejs.org](https://nodejs.org),
run it with the default options, then close and reopen Git Bash.

Check it worked:

```bash
node -v
```

It should print `v22` or higher, e.g. `v24.21.0`.

### Step 4. Download the game

```bash
cd ~
git clone -b claude/quirky-dijkstra-ibrhxg https://github.com/XENOSLAYERx/Pokemon-Sun-And-Claude.git
```

This makes a folder called `Pokemon-Sun-And-Claude` in your home folder.
(`-b claude/quirky-dijkstra-ibrhxg` picks the branch with the newest version: the
3D models and the lag fixes. Once that's merged, plain `git clone` gets it too.)

**Already downloaded it before?** Don't clone again; update it instead:

```bash
cd ~/Pokemon-Sun-And-Claude
git fetch
git checkout claude/quirky-dijkstra-ibrhxg
git pull
```

### Step 5. Go into the game's folder

**This is the step that's easy to miss.** Every `npm` command has to be run
from inside the game's folder, not your home folder:

```bash
cd ~/Pokemon-Sun-And-Claude
```

Your prompt changes to show where you are:

```
you@penguin:~$                           ← home folder: npm won't work here
you@penguin:~/Pokemon-Sun-And-Claude$    ← game folder: this is where you want to be
```

If npm ever says `ENOENT … Could not read package.json`, you're in the wrong
folder. Run this `cd` again.

### Step 6. Install the game's parts

```bash
npm install
```

Takes a minute and downloads about 100 MB. It ends with something like
`found 0 vulnerabilities`. If newer npm versions print a warning about
**esbuild** and install scripts, ignore it: the game works without that
script.

---

## Part 2 — Start the game

### Step 7. Start the server

Still in the game's folder:

```bash
npm run dev
```

After a moment:

```
  VITE v6.4.3  ready in 209 ms

  ➜  Local:   http://localhost:5173/
```

**Leave this terminal open.** It's the game's server. Closing it, or pressing
**Ctrl+C** in it, stops the game.

### Step 8. Open it in your browser

Go to **<http://localhost:5173/>** in Chrome.

The first load takes a few seconds while it builds the islands; the progress
bar shows what it's doing.

> **Chromebook: page won't load?** Try **<http://penguin.linux.test:5173/>**
> instead. That's your Linux container's own address. The browser keeps saves
> per address, so stick with whichever one works for you.

---

## Part 3 — Your first ten minutes

**1. Make your trainer.** Type a name and pick a partner: Rowlet (Grass),
Litten (Fire) or Popplio (Water). Press **Begin**. You can press *Roll again*
for a different look.

**2. Look around.** Drag with the mouse to turn the camera. Move with
**W A S D**; hold **Shift** to sprint.

**3. Find a Pokémon.** The **Nearby** panel in the bottom-right lists the wild
Pokémon around you, how far away they are and what they're doing. Walk toward
one. They're real animals: some graze, some flee, some flock, and a few will
come for you.

**4. Start a battle.** When you're close enough, a prompt appears at the
bottom: **E** *battle the wild Grubbin (Lv 8)*. Press **E**. The fight happens
right where you're standing, with no loading screen.

**5. Fight.** Use the arrow keys (or W/S) and **Enter** to choose, or click.
**Fight** shows your moves with their type and power. Fire beats Grass, Water
beats Fire, Grass beats Water.

**6. Catch it.** Lower its HP first, since a weakened Pokémon is much easier to
catch. Then choose **Bag → Poké Ball**. If it breaks free, hit it once more and
try again.

**7. Check your team.** Press **Tab** to see your team, bag and Pokédex. Your
new Pokémon is there.

**8. Save.** **Tab → Save**. The game also saves by itself every couple of
minutes while you're exploring.

**Then try:**

| Key | What happens |
|-----|--------------|
| **Space** | Ride. Faster, and you can cross the sea on Lapras |
| **T** | Skip an hour; watch the light change |
| **R** | Change the weather; watch the sea get rough |
| **F** | Fly the camera around to see the other islands |
| **Q** | Change graphics quality (lower it if the game is slow) |

To look at every Pokémon's 3D model up close, open
<http://localhost:5173/models.html>.

---

## Part 4 — Next time you play

Open a terminal and run:

```bash
cd ~/Pokemon-Sun-And-Claude
npm run dev
```

Then open <http://localhost:5173/>. Your save is kept in the browser, so you
carry on where you left off (as long as you use the same browser and don't clear
its site data).

**Getting the latest version:**

```bash
cd ~/Pokemon-Sun-And-Claude
git pull
npm install
```

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `npm error enoent Could not read package.json: … open '/home/you/package.json'` | You're in your home folder, not the game's. Run `cd ~/Pokemon-Sun-And-Claude` (Step 5). |
| `cd: Pokemon-Sun-And-Claude: No such file or directory` | The game isn't downloaded yet. Do Step 4. |
| `git: command not found` | Do Step 2. |
| `nvm: command not found` | Close the terminal and open a new one. Still missing? Run `source ~/.bashrc`. |
| `node: bad option: --experimental-strip-types` | Your Node is too old. Do Step 3, then check `node -v` shows v22 or higher. |
| `Port 5173 is in use, trying another one...` | The game is already running in another terminal. Stop this one with Ctrl+C and use that one. (A different port also means a different save: the browser keeps saves per address.) |
| The page won't load on a Chromebook | Open <http://penguin.linux.test:5173/> instead of localhost. |
| The game is slow or choppy | Press **Q** to lower the quality. In Chrome, check Settings → System → *Use graphics acceleration when available* is on. |

Want to check the whole thing is healthy? In the game's folder, run
`npm test`. It runs 553 checks in a couple of seconds and should end with
`fail 0`.

More help, including controls and how battles work, is in
[PLAYING.md](PLAYING.md).
