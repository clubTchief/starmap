# STARMAP

[![Uptime check](https://github.com/clubTchief/starmap/actions/workflows/uptime-check.yml/badge.svg)](https://github.com/clubTchief/starmap/actions/workflows/uptime-check.yml)
[![Deploy to Cloud Run](https://github.com/clubTchief/starmap/actions/workflows/deploy-cloud-run.yml/badge.svg)](https://github.com/clubTchief/starmap/actions/workflows/deploy-cloud-run.yml)

STARMAP is an interactive geospatial and astrodynamics visualization app that combines live GNSS tracking, satellite tracking, and Solar System views.

## Requirements

- Java 25
- Maven

## Run locally

```powershell
mvn spring-boot:run
```

The application runs at <http://localhost:8080>. Its health endpoint is <http://localhost:8080/actuator/health>.

## Deployment

Production runs on [Google Cloud Run](https://starmap-tvyqcsjjqq-ew.a.run.app) in `europe-west1`. Each push to `main` runs Maven verification, builds and pushes the container image, and deploys the service.

GitHub tracks these deployments under the `cloud-run-production` environment. The scheduled uptime workflow checks `/actuator/health` every 15 minutes.
