# Release Process

This package is intentionally small, dependency-light, Bun-first, and Node-compatible.
Do not rely on chat history for release knowledge; keep the process here and in scripts.

## Release Gates

Run this before tagging:

```sh
bun install --frozen-lockfile
bun run release:check
```

`release:check` runs:

- `bun run build`
- `bun test`
- `bun run typecheck`
- `bun run datasets:verify`
- `npm pack --dry-run --json`

It also enforces the packed tarball budget. The default budget is 102,400 bytes.
Override only deliberately:

```sh
PACKAGE_SIZE_LIMIT_BYTES=120000 bun run release:check
```

## Versioning

1. Update `package.json` version.
2. Update `CHANGELOG.md`.
3. Run `bun run release:check`.
4. Commit the version and changelog changes.

Do not push the tag before publishing locally. The existing repository workflow
also reacts to `v*` tags, so pushing a tag first can create a race with the
local-first publish process.

Create the local tag only after the local publish succeeds:

```sh
git tag vX.Y.Z
```

Never move a public npm version. npm versions are immutable; if a bad version was
published, fix forward with a new version.

## Publishing

Current maintained process is local-first: run the release gate, publish with
npm auth from a trusted maintainer machine, then verify the registry artifact.
Do not add or modify GitHub CI/release automation unless that is explicitly in
scope.

Publish command:

```sh
npm publish --access public --provenance=false
```

Use this only after `bun run release:check` passes. Local npm cannot generate
GitHub provenance.

## Post-Publish Verification

Verify the registry artifact, not just local output:

```sh
bun run release:published
npm view email-deliverability name version dist.tarball repository.url --json
npm pack email-deliverability@X.Y.Z --dry-run --json
```

After registry verification, push the commit and tag:

```sh
git push origin main
git push origin vX.Y.Z
```

Create a GitHub Release for the pushed tag:

```sh
gh release create vX.Y.Z \
  --repo onlyoneaman/email-deliverability \
  --title "email-deliverability vX.Y.Z" \
  --notes-file CHANGELOG.md
```

## Known Release Failure Modes

- `npm publish --provenance` from a local shell fails because automatic provenance
  is only supported in recognized CI providers.
- An immediate `npm view` after publish may briefly return `E404` while registry
  visibility catches up. Recheck before assuming publish failed.
- If `npm view email-deliverability@X.Y.Z` succeeds, republishing that version
  will fail. Bump the version instead.
- A tag that does not match `package.json` version is a release process error.
  Fix the tag/version mismatch before publishing.
- Pushing a `v*` tag before local publishing can trigger the existing workflow's
  publish job. For this local-first process, publish and verify npm first, then
  push the tag.
