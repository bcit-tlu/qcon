# AGENTS.md

## Setup Commands

- Install dependencies: `npm install`
- Build for production: `npm run build`
- Compact build (single-file): `npm run compact`
- Preview (build + serve): `npm run preview`
- Run tests: `npm test`
- Type check: `npm run typecheck`
- Helm lint: `helm lint charts/`
- Helm validate: `helm template test charts/ | kubeconform -strict -summary -schema-location default -ignore-missing-schemas`
- Verify CDN rewrite initContainer: `bash tests/helm-cdn-rewrite.sh` (needs helm + yq)
- Use `nix-shell -p {binary}` for ad-hoc tools not in PATH.
  - Preferred form: `nix-shell -p {binary} --run "<command>"`
  - Examples:
    - `nix-shell -p nodejs --run "npm test"`

## Code Style

- TypeScript with strict type checking
- React 19 functional components with hooks
- Follow conventional commit format for PR titles
- License: MPL-2.0

## Project Structure

- `/src/model`: Canonical question-library schema, factories, validation
- `/src/codecs/qti`: Model <-> QTI (questestinterop, D2L d2l_2p0) + SCORM zip
- `/src/codecs/docx`: Model <-> Word .docx (direct OOXML, numbering-aware)
- `/src/editor`: Structured editor UI (HugeRTE rich-text fields)
- `/src/app`: App shell: import -> edit -> export
- `/charts`: Helm chart for Kubernetes deployment (flat layout)
- `/conf.d`: Nginx server configuration (health endpoints, caching, logging)
- `/tests`: Shell-based chart/pipeline verification scripts
- `/.github/workflows/`: CI/CD pipelines

## CI/CD

- CI uses shared `bcit-tlu/.github` OCI build reusable workflow
- `helm-lint` validates Helm charts on every push and PR
- `release-please` manages versioning via conventional commits (`release-type: "simple"`)
- Version is tracked in `.release-please-manifest.json` and `Chart.yaml` (`# x-release-please-version` annotations)
- Images are published to `ghcr.io/bcit-tlu/qcon/qcon`
- Charts are published to `oci://ghcr.io/bcit-tlu/qcon/charts`
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` is set in all workflows

### CDN channel isolation

- Latest and stable assets live in separate **storage accounts** (communal `CDN_ACCOUNT_NAME_LATEST`/`CDN_ACCOUNT_NAME_STABLE`); the channel boundary is at the account level
- The repo's container is `qcon` on both accounts; public path is `/<repo>/<ref>/` on the per-env Front Door endpoints (`CDN_BASE_URL_{LATEST,STABLE}`); `<ref>` is the content hash of the uploaded file set
- `ci.yaml` verifies dist/ is host-agnostic and uploads it verbatim to the latest account on every `main` push (writing `.by-commit/<sha>`); `helm-publish.yaml` rejects tags whose chart predates the `cdn.contentRef` schema (`resolve-tag`), then promotes by server-side copying that prefix latest→stable — no rebuild (the `stable` UAMI has Blob Data Reader on the repo's latest container)

### Release/versioning

- Config: `release-please-config.json`; state: `.release-please-manifest.json`
- Versioned files kept in sync by release-please:
  - `package.json`, `package-lock.json` (root + `packages['']`)
  - `charts/Chart.yaml` (version + appVersion)
- Tags: `vX.Y.Z`
- Dependency updates are handled by self-hosted Renovate (`renovate.yaml`, scheduled via the shared `bcit-tlu/.github` workflow), configured by root `renovate.json` extending the shared `bcit-tlu/.github` default preset

## Deployment

- Deployed to Kubernetes via Flux CD (see `bcit-tlu/flux-fleet`)
- Ingress: `qcon.<CLUSTER_ENV>.ltc.bcit.ca`
- Static site served by nginx-unprivileged on port 8080
- **Optional Docker**: local prod-like via `docker-compose.prod.yml` (nginx on port 8080)

### Container/runtime

- Multi-stage Dockerfile: builder (`node:26-alpine`) → runtime (`nginx/nginx-unprivileged`, `-perl` variant required: the cdn-rewrite initContainer runs perl from this image)
- Runtime config: `conf.d/default.conf` (static asset caching + structured logs + SPA fallback)
- Compose files:
  - `docker-compose.yml`: local dev (`vite preview` on port `9000`)
  - `docker-compose.prod.yml`: local prod-like nginx run (port `8080`)

## Development Workflow

- Create feature branches from `main`
- Use pull requests for code review
- PR titles must follow conventional commit format (enforced by `pr-title-lint.yaml`)
- Squash commits before merging

## Agent Change Guardrails

When changing operational behavior, update all coupled files in the same PR:

- Workflow logic ↔ release docs/config (`.github/workflows/*`, `release-please-config.json`)
- Chart behavior ↔ chart tests/pipeline (`charts/`, `tests/helm-cdn-rewrite.sh`, `helm-lint` `extra_command`)
- Container behavior ↔ Docker/nginx/compose (`Dockerfile`, `conf.d/default.conf`, `docker-compose*.yml`)

Keep comments short and intent-focused; avoid long narrative comments unless they capture non-obvious constraints.
