---
name: avatar-contribution-pr
description: Turn a "Avatar contribution: <name>" GitHub issue (from the in-app avatar-editor easter egg) into a merged sprite — validate the art, add the module, wire it into the catalog, and open a PR that closes the issue. Use when the user asks to resolve/land/ship an avatar contribution issue, or references an issue whose title starts with "Avatar contribution:".
---

This skill lands a community avatar submission from `codebay`'s hidden avatar-editor easter egg. The editor (`src/components/AvatarEditor.svelte`) serializes a drawing via `src/avatars/serialize.ts::toIssueUrl`, which always produces an issue with the same shape: title `Avatar contribution: <name>`, the pixel art in a fenced block, and a byte-identical ready-to-paste `src/avatars/<name>.ts` module in a ` ```ts ` block. This skill reverses that: read the issue, validate the art, and turn it into a merged PR.

## 1. Fetch the issue

Accept an issue number or URL as input. Fetch it:

```sh
gh issue view <number-or-url> --json number,title,body,url
```

Confirm the shape matches what `serialize.ts::toIssueUrl` produces:

- Title is `Avatar contribution: <name>`
- Body contains a plain fenced block with 8 lines of `#`/`.` art
- Body contains a ` ```ts ` fenced block with a full `AvatarArt` module (`import type { AvatarArt } from './types.ts'; ... export default art;`)

If the issue doesn't look like this — wrong title format, missing code block, art that isn't 8×8 — **stop and tell the user what's off** rather than guessing at intent or trying to reshape it into something that fits.

## 2. Extract & validate

Pull `name` and the module source out of the ` ```ts ` block. Before writing anything, validate against the same rules `src/avatars/avatars.test.ts` enforces:

- Exactly 8 rows in `pixels`
- Each row is exactly 8 characters, only `#` or `.` (the editor never emits raw spaces, but treat space as off too if you see one)
- `name` is non-empty and **not already present** in `src/avatars/index.ts`'s `avatars[]` array

If any rule fails, report exactly which rule and which row failed. Do not "fix" bad art or auto-rename a colliding name — ask the user how they want to handle it.

## 3. Branch

Make sure `main` is current, then branch off it:

```sh
git fetch origin main
git checkout -b avatar/<name> origin/main
```

(`<name>` is the sprite's `name`, e.g. `bob-marley`.)

## 4. Write the sprite file

Create `src/avatars/<name>.ts` with the module pasted **verbatim** from the issue — it's already formatted exactly as `serialize.ts::toModuleSource` emits it (tabs, single quotes, trailing newline), so don't run it through any reformatting by hand; `bun run checks`'s prettier pass will catch it if something's actually off.

## 5. Wire it into the registry

Edit `src/avatars/index.ts`:

- Add an import line: `import <camelCaseName> from './<name>.ts';`
- Insert `<camelCaseName>` into the `avatars[]` array

**Both insertions go in alphabetical order by sprite name** — the import list and the array are both fully alphabetical today (`anchor, bear, bee, cat, cherry, ...`), and that ordering matters for readability/diffs, not behavior. Find the two neighbors the new name sorts between and insert there.

## 6. Verify

```sh
bun run checks
```

This is the real gate: `avatars.test.ts` re-checks the 8×8/charset/uniqueness rules programmatically, and typecheck/format catch anything hand-editing `index.ts` might have broken. Fix anything it flags — don't skip or weaken this step.

## 7. Ship it

Pushing a branch and opening a PR are visible, hard-to-reverse actions — **confirm with the user before this step** unless they've already made clear (e.g. "just land it", "do the whole thing") that they want the full loop run without a pause.

```sh
git add src/avatars/<name>.ts src/avatars/index.ts
git commit -m "feat: add <name> avatar contribution"
git push -u origin avatar/<name>
gh pr create --title "Add <name> avatar contribution" --body "Closes #<issue-number>

..."
```

Report the PR URL back to the user.
