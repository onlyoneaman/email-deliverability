# Security Policy

## Supported Versions

Security fixes are provided for the latest published minor version.

## Reporting a Vulnerability

Report security issues privately through GitHub Security Advisories for the
repository or by contacting the package maintainer. Do not open public issues
for vulnerabilities involving SMTP probing, SSRF protections, dataset poisoning,
or package supply-chain integrity.

## Scope

Important security-sensitive areas include:

- SMTP target resolution and private/reserved network blocking.
- DNS resolver injection and timeout handling.
- Generated disposable/free-provider datasets.
- npm package publishing and provenance.

