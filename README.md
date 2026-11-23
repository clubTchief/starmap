# STARMAP

[![Uptime check](https://github.com/clubTchief/starmap/actions/workflows/uptime-check.yml/badge.svg)](https://github.com/clubTchief/starmap/actions/workflows/uptime-check.yml)
[![Deploy to Cloud Run](https://github.com/clubTchief/starmap/actions/workflows/deploy-cloud-run.yml/badge.svg)](https://github.com/clubTchief/starmap/actions/workflows/deploy-cloud-run.yml)

STARMAP is an interactive geospatial and astrodynamics visualization app that combines live GNSS tracking, satellite tracking, and Solar System views.

## Features

- Live GNSS position and satellite signal tracking, with simulated GPS for development
- Earth-centered and heliocentric equatorial/ecliptic reference frames
- Satellite orbit tracking and ground tracks (ISS is tracked by default)
- Star catalogue and celestial reference-grid overlays
- Health and metrics endpoints for monitoring

![STARMAP web interface preview](starmap-overview.png)

## Run locally

### Requirements

- Java 25
- Maven
- Internet access for CesiumJS map assets and satellite data

### Start with simulated GPS

Simulation is recommended unless a supported GPS receiver is connected. In PowerShell:

```powershell
$env:GPS_SIMULATE = "true"
mvn spring-boot:run
```

In Bash:

```bash
GPS_SIMULATE=true mvn spring-boot:run
```

Open <http://localhost:8080>. The health endpoint is <http://localhost:8080/actuator/health>.

To use a physical receiver, leave `GPS_SIMULATE` unset or set it to `false`; the serial defaults are COM8 at 9600 baud.

### Run with Docker Compose

```powershell
docker compose up --build
```

Compose enables GPS simulation, publishes port 8080, and persists the satellite cache in a named volume.

## Configuration

Spring Boot properties can be overridden with environment variables:

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `GPS_SIMULATE` | Use simulated GPS instead of a serial receiver | `false` |
| `GPS_SERIAL_PORT` | GPS receiver serial port | `COM8` |
| `GPS_SERIAL_BAUD` | GPS receiver baud rate | `9600` |
| `OBSERVER_DEFAULT_LAT`, `OBSERVER_DEFAULT_LON`, `OBSERVER_DEFAULT_ALT` | Initial observer location | Mumbai |
| `SAT_TRACK_NORAD_IDS` | Comma-separated satellite catalog IDs | `25544` (ISS) |
| `STARMAP_API_KEY` | Protect observer and satellite write endpoints | unset |

When `STARMAP_API_KEY` is set, protected requests must include the matching `X-API-Key` header. This is intended for API clients; the built-in browser UI does not provide a key-entry control. Keep the key server-side and never commit it to the repository.

## Troubleshooting

- **No GPS fix:** Use simulated GPS for development, or check the serial port and baud rate for the connected receiver.
- **Globe or map imagery is blank:** Check that the browser can access the required CesiumJS assets and map services.
- **Satellite data is missing:** Confirm outbound internet access; satellite elements are fetched from CelesTrak and cached locally.
- **Application fails during startup:** Run `mvn -B verify` and check the application logs for Orekit data or port errors.

## Deployment

Production runs on [Google Cloud Run](https://tiara.club) in `europe-west1`. Changes to application, Docker, Orekit data, or deployment workflow files on `main` run Maven verification and deploy a new revision. Documentation-only changes do not trigger deployment; the workflow can also be started manually from GitHub Actions.

GitHub tracks these deployments under the `cloud-run-production` environment. The scheduled uptime workflow checks `/actuator/health` every 15 minutes.
