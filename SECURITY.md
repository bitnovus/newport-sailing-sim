# Security policy

## Supported version

Security fixes are applied to the latest revision of `main` while the project is
in public beta.

## Reporting a vulnerability

Please use GitHub's **Security → Report a vulnerability** flow so sensitive
details remain private. Include the affected revision, reproduction steps,
impact, and any suggested mitigation.

If private vulnerability reporting is not available, open a public issue that
asks the maintainer to establish a private contact channel, but do not include
the vulnerability details in that issue.

Do not open a public issue for an unpatched vulnerability. For ordinary bugs
that do not expose data or create a security boundary failure, use the public
issue tracker.

You should receive an acknowledgment within seven days. No service-level or
bounty commitment is offered, but good-faith reports will be investigated and
credited with the reporter's permission.

## Scope notes

The application is a static browser client with no authentication or backend.
Its main external boundaries are map/weather providers, browser storage, build
dependencies, and developer data-import tools. `VITE_*` settings are compiled
into client code and must never contain secrets.
