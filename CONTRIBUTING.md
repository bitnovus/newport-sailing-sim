# Contributing

Thanks for helping improve the simulator.

## Development setup

1. Install Node.js 24 and npm 11.19 (`nvm use` reads the checked-in `.nvmrc`).
2. Run `npm ci`.
3. Run `npm run dev` and open the URL printed by Vite.
4. Before submitting a change, run `npm run check`.

The test suite is deterministic and should not require network access. Manual
wind is the default; copy `.env.example` to `.env.local` only when testing an
external provider. All `VITE_*` values are public browser configuration and
must not contain credentials.

npm's dependency-install hooks are denied by default. `package.json` contains
exact-version approvals only for the reviewed esbuild and macOS fsevents hooks;
the release check fails when a dependency introduces an unreviewed hook. Review
and update those approvals deliberately when the dependency tree changes.

## Pull requests

- Keep changes focused and explain user-visible behavior and tradeoffs.
- Add or update tests for physics, harbor-domain, or provider behavior.
- Update the README when controls, setup, configuration, or limitations change.
- Do not commit generated `dist/`, dependencies, credentials, private data, or
  provider keys.
- Preserve third-party attribution and license notices.

## Harbor data

New harbor extracts and all alterations must include an adjacent data-license
and provenance notice. OpenStreetMap-derived databases and alteration files are
subject to the ODbL; see the Newport Harbor `DATA_LICENSE.md` for the expected
format.

## Security reports

Do not disclose suspected vulnerabilities in a public issue. Follow
`SECURITY.md` instead.

By contributing, you agree that your contribution is licensed under the MIT
License for application code or the documented data license for data files.
