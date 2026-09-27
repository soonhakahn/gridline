# GRIDLINE

A browser-based 3D open-wheel racing game. Fictional teams, fictional cars,
fictional circuit — no real-world racing series, teams, drivers, sponsors,
or tracks are used anywhere in this project.

- **Costa Verde** — an original ~5.4 km, 18-corner coastal circuit
- **Quick Race** — 5 laps, 8 cars, standing start with start lights
- **Time Trial** — unlimited laps, best-lap ghost, `R` resets the car
- **Active Aero** — rear wing opens automatically in SM zones (Straight Mode),
  closes for corners (Corner Mode); wings visibly animate
- **Battery + Boost + Overtake** — regen under braking, boost on demand,
  and a one-lap Overtake mode armed by being within 1 s at a DET board
- **Chase / cockpit / TV cameras**, keyboard + gamepad, Low/High graphics

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # production bundle in dist/
npm run simtest  # headless physics/race simulation test
npm run smoke    # jsdom browser smoke test (menus, lights, driving, pause, false start)
```

## Controls

| Throttle / brake | ↑ / ↓ (or W / S) | RT / LT |
| Steer | ← / → (or A / D) | Left stick |
| Boost | Space | A |
| Active aero toggle (in SM zones) | Shift | X |
| Camera | C | Y |
| Look back | V | LB |
| Reset to track (Time Trial) | R | Start |
| Pause | Esc | Menu |
| Mute | M | — |

Manual gears: **Q** (up) / **E** (down). (The original spec used `A` for
downshift, but `A` steers, so it was moved to `E`.)

### Touch controls (phones/tablets)

On touch devices the game shows on-screen controls automatically — no
keyboard needed:

| Action | Touch |
|---|---|
| Steer | ◀ ▶ buttons (bottom-left) |
| Throttle / brake | GAS / BRAKE pedals (bottom-right) |
| Boost | BOOST button (hold) |
| Active aero toggle | AERO |
| Camera | CAM |
| Reset to track (Time Trial) | RST |
| Pause | ❚❚ |

Multi-touch is supported, so you can steer and hold GAS at the same time.

## Simplifications vs. real simulation

- Physics is an arcade track-space (s/d) model pinned to the racing surface —
  cars cannot leave the track or fall through the ground; invisible walls line
  both edges. No general-purpose rigid-body engine is integrated.
- Tire model: grip + wear multipliers only, no slip curves or thermal model.
- Battery: linear regen/assist, one shared Boost pool, no deployment maps.
- Damage, pit strategy, fuel, and weather are not simulated.

## Tech

Vite + TypeScript + Three.js (r170+). Fixed 60 Hz physics accumulator,
decoupled render rate.
