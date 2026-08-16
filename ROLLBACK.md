# STARMAP — Rollback Runbook

If a deploy goes wrong, follow this rather than debugging live in production.

## 1. Confirm it's actually broken

- Check `https://starmap-production-fbf2.up.railway.app/actuator/health` — if it doesn't return `{"status":"UP"}`, that's real.
- Check Railway → `starmap` service → Deploy Logs for the current deployment for errors.
- Open the app itself and confirm the globe/GNSS panel are actually broken, not just slow to load.

## 2. Find the last known-good image tag

Every CI build publishes an immutable `:<commit-sha>` tag to GHCR, in addition to `:latest` and `:production` — these are never deleted by the cleanup workflow (the last 15 are always retained). To find one:

- GitHub → **Actions** → **Build and publish Docker image** → find the most recent run that was known to work (check the commit message/date), and copy its commit SHA.
- Or: `https://github.com/clubTchief/starmap/pkgs/container/starmap` → browse tags directly by date.

## 3. Roll back the running image

In Railway → `starmap` service → **Settings → Source**, change the image reference from `:production` to the specific known-good tag:

```
ghcr.io/clubtchief/starmap:<last-good-commit-sha>
```

Save — this triggers an immediate redeploy of that exact image.

**Do not just click "Redeploy" on `:production`** — that re-pulls whatever is currently at that tag, which is the broken one.

## 4. Fix forward, don't leave it pinned

Once you've rolled back, `:production` still points at the broken build. Fix the actual issue on `main`, push, let CI rebuild and republish `:production`, confirm it's healthy, **then** switch Railway's Source back from the pinned SHA to `:production` so future automated redeploys resume working normally.

## 5. Revert the source too

```
git revert <bad-commit-sha>
git push
```

This keeps `main`'s history consistent with what's actually running, rather than leaving `main` ahead of production with a known-broken commit sitting in it.

## Quick reference

| Situation | Action |
|---|---|
| App down, need it back *now* | Pin Railway to last-good `:<sha>` tag (step 3) |
| Have time to investigate | Check Deploy Logs first, compare against the "Where Things Stood at the Last Successful Build" section of the Development Flow document |
| Root cause found and fixed | Push fix to `main`, wait for CI, confirm health, unpin Railway back to `:production` |
| CI itself is broken (not the app) | The automated redeploy won't fire — you'll need to redeploy manually via Railway's dashboard once GHCR has a working image |
