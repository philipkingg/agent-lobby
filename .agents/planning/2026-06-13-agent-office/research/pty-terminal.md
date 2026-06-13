# Research: node-pty + xterm.js for interactive `claude` sessions

Sources:
- [microsoft/node-pty](https://github.com/microsoft/node-pty)
- [xtermjs/attach addon over websockets gist](https://gist.github.com/iam-abdul/ef2df0da36d91325bb623ce10947e857)
- [Creating a browser-based interactive terminal (XtermJS + NodeJS)](https://www.eddymens.com/blog/creating-a-browser-based-interactive-terminal-using-xtermjs-and-nodejs)

## Architecture
- Backend: `node-pty` spawns `claude` (or any shell) as a real pseudoterminal process. The PTY stays alive until explicitly closed — good for long-running interactive sessions you attach/detach from.
- Transport: WebSocket between browser and backend. `ptyProcess.write()` sends keystrokes from browser → PTY stdin; PTY stdout/stderr stream back over the same socket.
- Frontend: `xterm.js` renders the terminal; the `@xterm/addon-attach` addon binds an `xterm.js` instance directly to a WebSocket for input/output, minimal glue code needed.

## Pattern for our app (right-side terminal panel, Q5)
1. Each "session" (headless task OR interactive PTY) gets a unique id.
2. For PTY-backed sessions: backend keeps a `Map<sessionId, IPty>` of live processes. Multiple browser tabs/clients can attach to the same `sessionId` (multiplex the PTY output to all connected sockets) — supports "attach to existing session" from Q2 option B/C.
3. Resizing: forward terminal resize events (`pty.resize(cols, rows)`) from xterm.js `onResize`.
4. Detach ≠ kill: closing the WebSocket should NOT kill the PTY — only an explicit "stop task" action does. This is what makes "fire and forget, check back later" work.

## Headless (SDK) sessions vs PTY sessions
- SDK headless tasks (Q2 option A) don't have a literal PTY — but we can still pipe a synthetic transcript (assistant messages, tool calls/results formatted as text) into the same right-side panel UI for consistency, OR render it as a structured log instead of raw terminal. Decide in design: probably render SDK message stream as a formatted log (not raw ANSI), while PTY-attached sessions show raw terminal — both live in the same panel component but with different renderers.

## Process lifecycle / resource limits
- Need a cap on concurrent PTY/SDK processes (design should define a configurable max, e.g. default 4-6) to avoid CPU/memory blowup — flagged as an open question for design doc since not covered in idea-honing.
