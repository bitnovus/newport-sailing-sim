# Newport Harbor Sailing Simulator

A browser-based 3D sailing simulator for tiller-steered keelboats on **real
water** — Newport Harbor, Newport Beach CA first, extensible to any harbor.
Sails a **W.D. Schock Harbor 20** with a self-tacking jib under **live wind
from Open-Meteo**, with **man-overboard (MOB) drill scoring**.

**Public beta:** this is an experimental simulator, not a navigation aid or a
substitute for formal sailing instruction. Use official charts and sound
seamanship on the water.

Live demo: <https://bitnovus.github.io/newport-sailing-sim/>

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics unit tests (vitest)
npm run build      # typecheck + production build
```

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
| `M` | satellite ↔ chart (OSM + OpenSeaMap) basemap |
| `+`/`−` / wheel / ZOOM buttons | zoom either view (chase 3D or top-down) |
| CLEAR button | wipe the track line and remove/reset the MOB marker |
| WIND button | live ↔ manual wind (slider panel) |

The yellow track line persists across page reloads (`localStorage`), so a
refresh no longer loses your sail history — CLEAR is the intentional reset
for both the track and MOB drill.
MOB recovery scoring arms after the boat first separates 15 m from the marker,
preventing an immediate recovery while stopped at the drop point.
The tiller slider at screen bottom holds any selected helm angle; CENTER
returns it to 0°. The jib trim slider holds a separate jib-sheet limit while
wind pressure self-tends the club boom. Touch/hold mainsheet buttons remain
available for mouse-only steering.

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
  retains a modest efficiency penalty at the sheeting extremes.
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
marks, optional `openWater` / `excludeBboxes` patches for OSM quirks) and
register it in `src/harbors/registry.ts`. Collision is point-in-polygon over
the water polygons with holes (islands), on a precomputed spatial grid.

### Adding a boat

Copy `src/boats/harbor20.ts`, tune the numbers, register in
`src/boats/registry.ts`. Sail trim policies are per-sail: `{kind: "sheet"}`
(a user-set limit around a freely swinging boom) or `{kind: "selfTacking"}`.

### Wind data

Open-Meteo forecast API — free, keyless, CORS-open; polled every 10 minutes,
fail-soft to the last sample, with a manual slider fallback. Marine wave data
is available from the same provider's marine API when sea state is added.

### AIS (future seam, not yet wired)

`src/providers/types.ts` defines `AisProvider`/`Vessel` +
`extrapolateVessel()` dead-reckoning. The intended first implementation is
[aisstream.io](https://aisstream.io) — a free WebSocket AIS API (free key via
signup): subscribe to position reports for the harbor bbox, map
`PositionReport.Latitude/Longitude/Sog/Cog/TrueHeading` and
`MetaData.ShipName/length/width` onto `Vessel`, render + extrapolate. No
physics changes needed.

## Known simplifications

- The OSM "Newport Bay" polygon bulges over a residential corner NW of the
  harbor (verified against OSM's own `is_in`); it's patched out of the
  collision grid with `excludeBboxes` until OSM fixes the relation.
- Depth/bathymetry, spatially-varying current, and tide height are future
  work; current is a uniform vector per harbor.

## Credits

Wind: [Open-Meteo](https://open-meteo.com) (CC BY 4.0) · Imagery: Esri World
Imagery · Basemap/nautical: © OpenStreetMap contributors, © OpenSeaMap
contributors · Harbor geometry: © OpenStreetMap contributors (ODbL).

Original application code is available under the [MIT License](LICENSE).
Provider and data-license details are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
