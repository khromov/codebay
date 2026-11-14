---
name: avatar-contribution-pr
description: Turn an avatar GitHub issue (from the in-app avatar-editor easter egg) into a merged sprite — validate the art, then either add a new module or replace an existing one, and open a PR that closes the issue. Handles both "Avatar contribution: <name>" (a brand-new sprite) and "Avatar edit: <name>" (a hand-redraw of an existing AI-generated sprite). Use when the user asks to resolve/land/ship an avatar contribution or edit issue, or references an issue whose title starts with "Avatar contribution:" or "Avatar edit:".
---

This skill lands an avatar submission from `codebay`'s hidden avatar-editor easter egg. The editor (`src/components/AvatarEditor.svelte`) serializes a drawing via `src/avatars/serialize.ts::toIssueUrl`, which produces one of two issue shapes depending on whether the user drew a new sprite or redrew an existing one. Both carry the pixel art in a plain fenced block and a byte-identical ready-to-paste `src/avatars/<name>.ts` module in a ` ```ts ` block. This skill reverses that: read the issue, decide create vs. edit, validate the art, and turn it into a merged PR.

## 1. Fetch the issue and pick the mode

Accept an issue number or URL as input. Fetch it:

```sh
gh issue view <number-or-url> --json number,title,body,url
```

The **title prefix** decides the mode — the rest of the skill branches on it:

- **`Avatar contribution: <name>`** → **create**: a brand-new sprite. Add a new module and wire it into the catalog.
- **`Avatar edit: <name>`** → **edit**: a hand-redraw of an existing AI-generated sprite. Overwrite the existing module in place; the replacement drops the `robot` flag, so landing it promotes the sprite from robot-drawn to hand-drawn. **Do not** add a new file or touch `index.ts`.

Either way, confirm the body matches what `serialize.ts::toIssueUrl` produces:

- Body contains a plain fenced block with 8 lines of `#`/`+`/`.` art (`#` = on, `+` = gray, `.` = off)
- Body contains a ` ```ts ` fenced block with a full `AvatarArt` module (`import type { AvatarArt } from './types.ts'; ... export default art;`)

If the issue doesn't look like this — title is neither prefix, missing code block, art that isn't 8×8 — **stop and tell the user what's off** rather than guessing at intent or trying to reshape it into something that fits.

## 2. Extract & validate

Pull `name` and the module source out of the ` ```ts ` block. Before writing anything, validate the art against the same rules `src/avatars/avatars.test.ts` enforces:

- Exactly 8 rows in `pixels`
- Each row is exactly 8 characters, only `#`, `+` or `.` (the editor never emits raw spaces, but treat space as off too if you see one)

The **name rule depends on the mode**:

- **create**: `name` is non-empty and **not already present** in `src/avatars/index.ts`'s `avatars[]` array (it's a brand-new sprite).
- **edit**: `name` **must already be present** in `avatars[]`, and the existing `src/avatars/<name>.ts` should currently carry `robot: true` (an edit is a redraw of an AI-generated placeholder). If the name isn't found, or the existing sprite isn't robot-flagged, **stop and ask** — an "edit" of a non-existent or already-hand-drawn sprite is a mismatch worth surfacing.

The replacement module in an edit issue **must not** contain `robot: true` — that's the whole point (it becomes hand-drawn). If it somehow does, drop that line.

If any rule fails, report exactly which rule and which row failed. Do not "fix" bad art or auto-rename a colliding name — ask the user how they want to handle it.

## 3. Branch

Make sure `main` is current, then branch off it. Name the branch by mode:

```sh
git fetch origin main
git checkout -b avatar/<name> origin/main       # create
git checkout -b avatar-edit/<name> origin/main  # edit
```

(`<name>` is the sprite's `name`, e.g. `bob-marley`.)

## 4. Write the sprite file

Write `src/avatars/<name>.ts` with the module pasted **verbatim** from the issue — it's already formatted exactly as `serialize.ts::toModuleSource` emits it (tabs, single quotes, trailing newline), so don't run it through any reformatting by hand; `bun run checks`'s prettier pass will catch it if something's actually off.

- **create**: this is a new file.
- **edit**: this **overwrites** the existing `src/avatars/<name>.ts`. The pasted module has no `robot` flag, so the overwrite is what promotes the sprite from robot-drawn to hand-drawn.

## 5. Wire it into the registry

**Edit mode: skip this step entirely** — the sprite is already imported and listed in `src/avatars/index.ts`; a redraw only changes the module's pixels, not the registry.

**Create mode**, edit `src/avatars/index.ts`:

- Add an import line: `import <camelCaseName> from './<name>.ts';`
- Insert `<camelCaseName>` into the `avatars[]` array

**Both insertions go in alphabetical order by sprite name** — the import list and the array are both fully alphabetical today (`anchor, bear, bee, cat, cherry, ...`), and that ordering matters for readability/diffs, not behavior. Find the two neighbors the new name sorts between and insert there.

## 6. Format

```sh
bun run format
```

Run this explicitly after writing the sprite file (and, in create mode, editing `index.ts`) — it's a `prettier --write .`, so it auto-fixes any formatting drift from the hand-edit before you move on. `bun run checks` (next step) re-runs it too, but running it here means a stray formatting fix doesn't show up disguised as a test failure.

## 7. Verify

```sh
bun run checks
```

This is the real gate: `avatars.test.ts` re-checks the 8×8/charset/uniqueness rules programmatically (and confirms the `robot` flag only ever marks a subset of the original AI batch — so an edit that sheds the flag stays green), and typecheck/format catch anything hand-editing might have broken. Fix anything it flags — don't skip or weaken this step.

## 8. Ship it

Pushing a branch and opening a PR are visible, hard-to-reverse actions — **confirm with the user before this step** unless they've already made clear (e.g. "just land it", "do the whole thing") that they want the full loop run without a pause.

**Create mode** — new file plus the registry edit:

```sh
git add src/avatars/<name>.ts src/avatars/index.ts
git commit -m "feat: add <name> avatar contribution"
git push -u origin avatar/<name>
gh pr create --title "Add <name> avatar contribution" --body "Closes #<issue-number>

..."
```

**Edit mode** — just the redrawn module (no `index.ts` change):

```sh
git add src/avatars/<name>.ts
git commit -m "feat: redraw <name> avatar by hand"
git push -u origin avatar-edit/<name>
gh pr create --title "Redraw <name> avatar by hand" --body "Closes #<issue-number>

Replaces the AI-generated \`<name>\` placeholder with a hand-drawn sprite (drops the \`robot\` flag).

..."
```

Report the PR URL back to the user.
