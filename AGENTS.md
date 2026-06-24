# Agent Notes

This repository is an npm package for honest email validation and deliverability
signals. Keep process knowledge in files, not chat history.

Read `docs/CONTRACT.md` before making broad API, release, dataset, SMTP, or
package-shape changes.

## Commands

Use Bun as the primary developer runtime:

```sh
bun install --frozen-lockfile
bun run build
bun test
bun run typecheck
bun run datasets:verify
bun run release:check
```

Before publishing or tagging, `bun run release:check` is the source of truth.
After publishing, use `bun run release:published` to verify the npm registry
artifact.

## Boundaries

- Do not edit `.github/workflows/*` unless the user explicitly asks for CI work.
- Do not introduce runtime dependencies casually; packed size target is under
  100 KiB (102,400 bytes).
- Do not publish `src/`, `tests/`, `docs/`, or `scripts/` in the npm tarball
  unless the package contract is deliberately changed.
- Do not make SMTP probing default-proof of mailbox existence. It is diagnostic
  only.
- Keep the primary validation call simple: `validateEmail(email)` returns
  top-level `status`, `reason`, and `recommendation`; detailed evidence belongs
  in `checks`, `issues`, and `decision.blockedBy`.
- When SMTP is enabled, catch-all detection is on by default after the target
  recipient is accepted. Use `smtp.detectCatchAll: false` only as an explicit
  low-level opt-out.
- Do not weaken SMTP private/reserved network blocking without explicit security
  review and tests.

## Package Shape

- Main export: `email-deliverability`, server-side Bun/Node API.
- Syntax export: `email-deliverability/syntax`, parser/normalizer only.
- Browser export: `email-deliverability/browser`, browser-safe parsing/dataset
  helpers only.
- Current package format is ESM-only. Do not add CommonJS output unless there is
  a measured compatibility need and the package-size tradeoff is explicit.

Browser-safe exports must not import `node:`, DNS, TCP, or TLS modules.

## Dataset Rules

Disposable domains take precedence over free-provider domains. The generated
free-provider dataset must exclude every disposable domain. After touching
generated data or dataset logic, run:

```sh
bun run datasets:verify
bun test tests/datasets.test.ts
```

Keep `NOTICE` and generated source metadata accurate when dataset sources,
versions, counts, or licenses change.

## Release Rules

- Update `package.json` and `CHANGELOG.md` together.
- Tag names must match package versions: `vX.Y.Z` for version `X.Y.Z`.
- npm versions are immutable. If a version is already published, fix forward
  with a new version.
- Local fallback publish command is:

```sh
npm publish --access public --provenance=false
```

Local provenance is unsupported; use it only as a fallback after release gates
pass.
