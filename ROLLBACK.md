# STARMAP - Cloud Run Rollback Runbook
[![Uptime check](https://github.com/clubTchief/starmap/actions/workflows/uptime-check.yml/badge.svg)](https://github.com/clubTchief/starmap/actions/workflows/uptime-check.yml)
[![Deploy to Cloud Run](https://github.com/clubTchief/starmap/actions/workflows/deploy-cloud-run.yml/badge.svg)](https://github.com/clubTchief/starmap/actions/workflows/deploy-cloud-run.yml)

Use this runbook to restore the last healthy Cloud Run revision. Cloud Run revisions are immutable, so rollback switches traffic to a known-good revision without rebuilding an image.

## 1. Confirm the incident

- Check `https://tiara.club/actuator/health` and `https://www.tiara.club/actuator/health`; a healthy response includes `"status":"UP"`.
- Check the **Deploy to Cloud Run** workflow in GitHub Actions for the latest deployment result and logs.
- Confirm the issue in the application before changing production traffic.

## 2. Identify a known-good revision

List revisions and their readiness, creation time, and image:

```powershell
gcloud run revisions list `
  --service=starmap `
  --region=europe-west1 `
  --project=maps-31544 `
  --format="table(metadata.name,status.conditions[0].status,metadata.creationTimestamp,spec.containers[0].image)"
```

Choose a previous revision that was serving successfully before the incident. Record its full revision name (for example, `starmap-00009-abc`). To inspect its details:

```powershell
gcloud run revisions describe REVISION_NAME `
  --region=europe-west1 `
  --project=maps-31544
```

## 3. Send production traffic to the known-good revision

Replace `REVISION_NAME` with the revision selected above:

```powershell
gcloud run services update-traffic starmap `
  --region=europe-west1 `
  --project=maps-31544 `
  --to-revisions=REVISION_NAME=100
```

Verify the service's traffic allocation and health:

```powershell
gcloud run services describe starmap `
  --region=europe-west1 `
  --project=maps-31544 `
  --format="yaml(status.url,status.traffic,status.latestReadyRevisionName)"

curl.exe -fsS https://tiara.club/actuator/health
```

## 4. Fix forward

A rollback only changes traffic; it does not revert source code. Fix the issue on a branch and merge it to `main`. Changes to application, Docker, Orekit data, or deployment workflow files run verification and deploy a new revision. Documentation-only changes do not trigger a Cloud Run deployment. The deployment workflow can also be started manually from GitHub Actions.

## Quick reference

| Situation | Action |
|---|---|
| Application is unhealthy | Check the deployment workflow and Cloud Run revision logs |
| Need immediate recovery | Set 100% traffic to a known-good revision (step 3) |
| Fixed the root cause | Merge the fix to `main` and verify the new revision |
| Build/deployment workflow failed before deployment | Review the workflow logs; the previous Cloud Run revision should remain available |