# Test task: verify the separate Codebay devcontainer config end to end

This branch changes how Codebay injects its config: instead of overwriting the project's own
`devcontainer.json` inside the instance copy (which made every git-tracked project show a dirty
file), the merged config is written to a Codebay-owned sibling file and `devcontainer up` boots
from it via `--config`:

- nested canonical config (or no config at all) → `.devcontainer/codebay.devcontainer.json`
- flat canonical `.devcontainer.json` → `.codebay.devcontainer.json` at the workspace root

Both are hidden from git via the managed block in `.git/info/exclude`. Instances created before
this change are migrated on their next rebuild: `restoreCanonicalConfig` detects the legacy
fingerprint (`codebay-tmux` in the tracked config) and restores the file with `git checkout`.

The automated suite (`bun run checks`) covers all of this against stubs. **This task is the live
verification** — run it in an environment where `docker info` succeeds.

## Setup

```sh
docker info            # must succeed; abort and report if it doesn't
bun install
bun run dev            # serves on http://localhost:6969 (dev DATA_DIR is ./.codebay)
```

Instance copies land under `./.codebay/instances/<id>/`. To find an instance's id, check the
dashboard URL, `sqlite3 ./.codebay/app.sqlite 'select id, source_path, status from instances'`, or
just `ls ./.codebay/instances/`.

## Scenario 1 — git project with a tracked nested config

1. Create a local fixture:
   ```sh
   mkdir -p /tmp/fixture-nested/.devcontainer
   cat > /tmp/fixture-nested/.devcontainer/devcontainer.json <<'EOF'
   {
     // JSONC comment on purpose — must survive untouched
     "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
     "forwardPorts": [3000],
   }
   EOF
   git -C /tmp/fixture-nested init -b main
   git -C /tmp/fixture-nested add -A
   git -C /tmp/fixture-nested -c user.email=t@t -c user.name=t commit -m init
   ```
2. In the UI, create an instance from `/tmp/fixture-nested` (folder picker). Wait for `running`
   and the IDE to load.
3. Assert, with `WS=./.codebay/instances/<id>`:
   - `git -C $WS status --porcelain` prints **nothing** (the whole point of the change).
   - `cat $WS/.devcontainer/devcontainer.json` is byte-identical to the fixture (comment intact).
   - `$WS/.devcontainer/codebay.devcontainer.json` exists and contains the code-server feature.
   - The boot log (instance page) shows `--config` in effect: the container came up and the
     dashboard shows a forward for port 3000 (declared `forwardPorts` still seeded).
   - `docker inspect <container> --format '{{index .Config.Labels "devcontainer.config_file"}}'`
     points at `codebay.devcontainer.json`.

## Scenario 2 — flat `.devcontainer.json`

1. Same as scenario 1 but the fixture has a single `/tmp/fixture-flat/.devcontainer.json`
   (same JSONC content, committed).
2. Assert:
   - `git status --porcelain` in the instance copy is empty.
   - `.codebay.devcontainer.json` exists at the workspace root; the original `.devcontainer.json`
     is untouched.
   - If the CLI dropped a lockfile (`.devcontainer-lock.json` at the root), it must also be
     git-invisible (covered by the exclude block — verify status stays empty).

## Scenario 3 — project with no devcontainer config

1. Create an instance from a folder containing only a README (git init + commit it).
2. Assert: it boots on the default image; `.devcontainer/devcontainer.json` does **not** exist in
   the copy; `.devcontainer/codebay.devcontainer.json` does; git status is empty.

## Scenario 4 — migration of a pre-upgrade instance

1. With the scenario 1 instance running, simulate the legacy state:
   ```sh
   WS=./.codebay/instances/<id>
   # Bake the old-style injections into the tracked file (fingerprint: codebay-tmux).
   cp $WS/.devcontainer/codebay.devcontainer.json $WS/.devcontainer/devcontainer.json
   git -C $WS status --porcelain   # should now show .devcontainer/devcontainer.json modified
   ```
2. Trigger **Rebuild** from the UI.
3. Assert:
   - The boot log contains `Restored the project devcontainer config`.
   - After the rebuild, `git -C $WS status --porcelain` is empty and the tracked file matches the
     committed fixture again.
   - The rebuild did **not** fail on a host-port bind (the old container is removed by ID before
     `devcontainer up`, since the CLI's own label match no longer finds it).

## Scenario 5 — port forwards + rebuild

1. On any running instance, add a port forward in the UI, then rebuild.
2. Assert: the forward appears in `codebay.devcontainer.json`'s `appPort`, the canonical config is
   still untouched, and git status stays empty. Remove the forward, rebuild again, and confirm the
   mapping is gone.

## Report

For each scenario: pass/fail, plus the relevant command output (`git status --porcelain`, boot-log
excerpts) for anything that failed. Delete this file once the verification has been signed off.
