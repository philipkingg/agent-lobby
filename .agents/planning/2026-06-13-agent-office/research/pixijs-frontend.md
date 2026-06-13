# Research: PixiJS + React for the office canvas

Sources:
- [@pixi/react — official React bindings](https://blog.logrocket.com/getting-started-pixijs-react-create-canvas/)
- [react-pixi-tilemap (Tiled .tmx maps)](https://github.com/vocksel/react-pixi-tilemap)
- [PixiJS Tilemap Kit 3](https://www.shukantpal.com/posts/pixijs-tilemap-kit-3/)

## Recommendation
- `@pixi/react` — official PixiJS team library, React 19 + PixiJS v8 support, automatic resource management/lifecycle. Use this instead of raw PixiJS imperative code to keep the canvas declarative and integrate cleanly with React state (agent list, statuses).
- Sprite rendering: `<Sprite>` component per agent, position driven by React state (desk coordinates from layout config).
- Tilemaps: for the office floor/desks background, either:
  - Static pre-rendered background image (simplest for v1 — single PNG floor plan with desk positions defined in a JSON config), or
  - `react-pixi-tilemap` if using Tiled-authored `.tmx` maps for a more flexible/editable layout later.
- **v1 recommendation:** static background image + JSON desk-position config (x/y per desk slot). Avoids tilemap library complexity until the office layout needs to grow dynamically (ties into Q4's "start with A, allow B/C later").

## Sprite animation states (maps to Q5 states)
Each agent sprite needs frame-sets for: `idle`, `working` (typing/walking to desk), `blocked` (badge overlay + idle pose), `done` (slacking-off idle animation per Q10), `error` (badge overlay).
- Implement via PixiJS `AnimatedSprite` with per-state texture arrays, switched based on agent state from backend (via WebSocket).
- Badge overlay (blocked/error) = small separate sprite/icon positioned at corner of agent sprite, toggled independently of body animation.

## Data flow
- Backend pushes agent state updates over WebSocket (same channel as PTY/SDK status, or separate "office state" channel).
- Frontend keeps a simple `Record<agentId, AgentState>` in React state/store (e.g. Zustand), `@pixi/react` re-renders sprites reactively on change.
