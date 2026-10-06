# Security policy

## Supported versions

Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting
(*Security* tab → *Report a vulnerability*) on this repository. Include:

- a description of the problem and its impact,
- steps to reproduce (or a proof of concept),
- affected version / commit.

You will get an acknowledgement as soon as a maintainer can review it. We ask for
coordinated disclosure: please give us reasonable time to fix the issue before publishing.

## Scope

In scope: the API, the web panel, the MCP/OAuth server and the default Docker setup.
Out of scope: vulnerabilities in third-party providers (Evolution API, WuzAPI, WhatsApp),
and issues that require a malicious server administrator.

## If you find a leaked secret

If you notice a credential, token or personal data accidentally committed to this
repository, report it privately the same way so it can be rotated and removed.
