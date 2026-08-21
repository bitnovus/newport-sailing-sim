# Newport Harbor Sailing Simulator

A browser-based 3D sailing simulator for tiller-steered keelboats on **real
water** — Newport Harbor, Newport Beach CA first, extensible to any harbor.
Sails a **W.D. Schock Harbor 20** with a self-tacking jib, optional live wind,
and **man-overboard (MOB) drill scoring**.

**Public beta:** this is an experimental simulator, not a navigation aid or a
substitute for formal sailing instruction. Use official charts and sound
seamanship on the water.

Live demo: <https://bitnovus.github.io/newport-sailing-sim/>

## Quick start

Node.js 24 and npm 11.19 are recommended. With `nvm`, run `nvm use` to select
the checked-in Node version; minimum supported versions are listed in
`package.json`.

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # deterministic unit tests (vitest)
npm run build      # typecheck + production build
npm run check      # test + build release check
```

The release-safe default uses manual wind, OpenStreetMap, and OpenSeaMap. It
does not contact Open-Meteo or an imagery provider unless the operator opts in.
Copy `.env.example` to `.env.local` to change browser-visible configuration.
Never put secrets in `VITE_*` variables; Vite embeds them in the client bundle.

| Setting | Default | Purpose |
| --- | --- | --- |
| `VITE_BASE_PATH` | `/` | Deployment path; GitHub Pages CI sets the repository path |
| `VITE_ENABLE_LIVE_WIND` | `false` | Enables Open-Meteo polling and the live/manual toggle |
| `VITE_OPEN_METEO_BASE_URL` | public Open-Meteo endpoint | Open-Meteo-compatible API base URL |
| `VITE_OSM_TILE_URL` | OSM standard tiles | Configurable chart basemap |
| `VITE_OPENSEAMAP_TILE_URL` | OpenSeaMap seamarks | Configurable nautical overlay |
| `VITE_SATELLITE_TILE_URL` | unset | Optional licensed imagery tile template |
| `VITE_SATELLITE_ATTRIBUTION` | unset | Required attribution for optional imagery |

Operators are responsible for the terms, capacity limits, privacy obligations,
and attribution requirements of every configured hosted service.

## Controls

| Input | Action |
| --- | --- |
| `←/→` or `A/D` | tiller (realistic mode: push right = turn left, like a real boat) |
| `S/W` | mainsheet in/out |
| Jib trim slider | limits the self-tending jib club boom; wind swings it across |
| `C` or `↓` | center the tiller |
| `SPACE` / MOB button | drop MOB marker, start drill |
| `E` | electric auxiliary drive |
| `V` | chase ↔ chartplotter (north-up) view |
| `M` | configured imagery ↔ chart; hidden when imagery is not configured |
| `G` / JIB WING button | throw a winking jib to weather for wing-and-wing on a deep run |
| `+`/`−` / wheel / ZOOM buttons | zoom either view (chase 3D or top-down) |
| CLEAR button | wipe the track line and remove/reset the MOB marker |
| WIND button | manual wind panel; live ↔ manual when live wind is enabled |

The yellow track line persists across page reloads (`localStorage`), so a
refresh no longer loses your sail history — CLEAR is the intentional reset
for both the track and MOB drill.
MOB recovery scoring arms after the boat first separates 15 m from the marker,
preventing an immediate recovery while stopped at the drop point.
The tiller slider at screen bottom holds any selected helm angle; CENTER
returns it to 0°. The jib trim slider holds a separate jib-sheet limit while
wind pressure self-tends the club boom. Touch/hold mainsheet buttons remain
available for mouse-only steering.

On a deep broad reach, the jib progressively loses pressure in the mainsail's
shadow and visibly winks toward the centerline. At 158° apparent wind or
deeper, use `G` / JIB WING to throw and hold the club boom on the weather side;
the sail then fills on its reverse face for wing-and-wing. Release it—or head
up—and normal self-tacking behavior resumes without changing the jib trim.

## Architecture

```
src/
  core/        pure TS physics — no DOM, deterministic, unit-testable
    sim.ts       fixed 60 Hz integration (surge/sway/yaw/heel)
    physics/     apparent wind, sail lift/drag (luff/stall), hull drag,
                 keel leeway, rudder/yaw, righting moment
    environment  true wind + OU gust process + tidal current
  boats/       boats as data (Harbor 20 first; drop in more as configs)
  harbors/     harbors as data (water polygons + harbor.json per harbor)
  providers/   external data seams: WindProvider (Open-Meteo, manual),
               AisProvider (future — see below)
  render/      MapLibre map + Three.js custom layer (procedural Harbor 20,
               wake, MOB marker)
  ui/          controls (keyboard/touch), HUD instruments, MOB drill logic
scripts/
  fetch-harbor.ts   Overpass → src/harbors/<name>/water.json
  debug-polar.ts    hold one TWA, print the polar point + traces
  debug-downwind.ts downwind TWA sweep + jibe maneuver diagnostics
```

### Physics highlights

- True wind from the provider is rendered *apparent* per instant: gusts are an
  Ornstein-Uhlenbeck process scaled by the reported gust excess.
- Sails modeled with luffing (<6° angle of attack), attached flow to ~18°,
  soft stall, and drag-plate behavior downwind. Both the main and the
  self-tending jib's club boom swing under apparent-wind torque with their own
  inertia and damping; their independent sheets set outward stops. The jib
  loses pressure and winks in the main's deep-downwind shadow, while its
  club-boom winger can hold the reverse face to weather for wing-and-wing. It
  also retains a modest efficiency penalty at the sheeting extremes.
- Hull drag has the classic wave-making knee at hull speed (5.6 kn for the
  H20); keel leeway needs flow (no steerage way / no leeway resistance when
  stopped); sway is solved semi-implicitly for numerical stability at 60 Hz.
- The electric auxiliary uses a static-thrust cap plus a constant-power
  propeller curve, calibrated to about 5 kn in calm water with unloaded sails.
- Realistic no-go zone (~35°), tacking angles (~45°), heel-to-leeward with
  depower, flow-dependent weather helm, and rudder lift that contributes both
  turning moment and windward/leeward side-force.

### Adding a harbor

```bash
npx tsx scripts/fetch-harbor.ts <name> <south> <west> <north> <east>
```

Then create `src/harbors/<name>/harbor.json` (anchor, start pose, current,
marks, optional `openWater` / `excludeBboxes` patches for OSM quirks), add an
adjacent data-provenance/license notice, and register it in
`src/harbors/registry.ts`. Collision is point-in-polygon over the water
polygons with holes (islands), on a precomputed spatial grid.

### Adding a boat

Copy `src/boats/harbor20.ts`, tune the numbers, register in
`src/boats/registry.ts`. Sail trim policies are per-sail: `{kind: "sheet"}`
(a user-set limit around a freely swinging boom) or `{kind: "selfTacking"}`.

### Wind data

Manual wind is the default. When explicitly enabled, the Open-Meteo-compatible
provider polls every 10 minutes, fails soft to the last sample, and shows linked
attribution beside the wind instruments. Open-Meteo's public free endpoint is
limited to non-commercial use and published request limits; commercial or
high-volume deployments must use a suitable subscription or self-hosted service.

### AIS (future seam, not yet wired)

`src/providers/types.ts` defines `AisProvider`/`Vessel` and
`extrapolateVessel()` dead-reckoning. Any future implementation must keep
provider credentials outside the browser bundle, document vessel-data privacy
and retention, and comply with the selected provider's terms.

## Known simplifications

- The OSM "Newport Bay" polygon bulges over a residential corner NW of the
  harbor (verified against OSM's own `is_in`); it's patched out of the
  collision grid with `excludeBboxes` until OSM fixes the relation.
- Depth/bathymetry, spatially-varying current, and tide height are future
  work; current is a uniform vector per harbor.

## Data, sources, and trademarks

Basemap/harbor geometry: © OpenStreetMap contributors (ODbL) · nautical
overlay: © OpenSeaMap contributors (CC BY-SA 2.0) · optional wind:
[Open-Meteo](https://open-meteo.com) (CC BY 4.0; hosted-service terms also
apply). Newport Harbor data provenance is documented in
[`DATA_LICENSE.md`](src/harbors/newport-harbor/DATA_LICENSE.md).

Harbor 20 dimensions and equipment references come from the
[builder's published specifications](https://wdschockcorp.com/harbor-20) and
the [Harbor 20 Class Association rules](https://www.harbor20.org/about-the-class/organization/bylaws/).
Physics coefficients and the procedural 3D model are original approximations.

Harbor 20 and W.D. Schock are used descriptively and may be trademarks of their
respective owners. This independent project is not affiliated with, sponsored
by, or endorsed by W.D. Schock Corp. or the Harbor 20 Class Association.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and pull-request guidance. Use
the private process in [SECURITY.md](SECURITY.md) for vulnerability reports.

Original application code is available under the [MIT License](LICENSE).
Provider and data-license details are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Runtime dependency license
texts are included in every production build as `THIRD_PARTY_LICENSES.txt`.
