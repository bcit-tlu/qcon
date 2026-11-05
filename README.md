<!-- SPDX-License-Identifier: MPL-2.0 -->
# qcon

Convert, edit, and export question libraries - Word (.docx) and QTI/SCORM packages (D2L Brightspace) - entirely in the browser. No server, database, Java, or Pandoc required.

Full rebuild of the [qcon-api](https://github.com/bcit-ltc/qcon-api) pipeline around a single typed model with bidirectional codecs and an online editor. See the [Qcon User Guide](https://qcon-guide.ltc.bcit.ca) for the authoring format.

## Developing

```
npm install
npm run dev
```

- `npm test`: vitest suite
- `npm run typecheck`: strict TS check
- `npm run build`: static build to `dist/`, hostable anywhere
- `npm run compact`: single-file build (all assets inlined into one HTML)

## Deployment

The site is deployed to Kubernetes via Flux CD (see `bcit-tlu/flux-fleet`). CI builds and publishes the OCI image + Helm chart to GHCR and uploads `dist/` to the CDN on every push to `main`; releases promote the same artifact to the stable channel. `dist/` is never committed; it's built in CI.

## Docker (optional)

```bash
# Local dev (vite preview on port 9000)
docker compose up --build

# Production-like (nginx on port 8080)
docker compose -f docker-compose.prod.yml up --build
```

### Regenerating package-lock.json

Generate the lockfile inside the same Node image the Dockerfile builds with, so
resolved versions match the container build regardless of the host OS:

```bash
docker run --rm -v "${PWD}:/app" -w /app node:26.13.0-alpine3.24 npm install --package-lock-only
```

On Windows (Git Bash / MSYS):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/app" -w /app node:26.13.0-alpine3.24 npm install --package-lock-only
```

`--package-lock-only` updates only `package-lock.json`; `node_modules` is left
untouched.

## Project layout

```
src/model/        canonical question-library schema, factories, validation
src/codecs/qti/   model <-> QTI (questestinterop, D2L d2l_2p0) + SCORM zip
src/codecs/docx/  model <-> Word .docx (direct OOXML, numbering-aware)
src/editor/       structured editor UI (HugeRTE rich-text fields)
src/app/          shell: import -> edit -> export
charts/           Helm chart for Kubernetes deployment
conf.d/           nginx server configuration
tests/            chart/pipeline verification scripts
```
