# GitHub Copilot / AI Agent Instructions

Purpose
- Help an AI coding agent be immediately productive in this repository: a minimal static web project with a single `index.html` entry point.

Big picture (what I inferred)
- This repo currently contains a single static page: `index.html` at the project root. There is no build system, package manifest, or server code present.
- Treat the project as a small static site / prototype. Changes are likely to be simple edits to HTML/CSS/JS files or adding assets.

Key files and where to look
- `index.html` — single-page entry; inspect for inline scripts, CSS, and external asset references. Use this as the primary source of truth for UI and static behavior.
- `.github/copilot-instructions.md` — this file (you are reading it).

Developer workflows (project-specific)
- Run locally: open `index.html` in a browser. For iterative development prefer a local static server / VS Code Live Server.
  - Example: `npx http-server .` or use the VS Code Live Server extension.
- No test runner or build pipeline detected. If you add Node/webpack/Vite, include `package.json` and update these instructions.

Conventions & patterns (observed)
- Flat static layout: keep new assets under `assets/` or `static/` if you introduce them.
- If adding JS files, prefer modular files under `js/` rather than large inline scripts in `index.html` to keep the HTML readable.

Integration points & dependencies
- No external services are referenced in current files. If you introduce APIs, document endpoint URLs and expected auth in this file.

What AI agents should do first (practical steps)
1. Open `index.html` and list the top-level sections (head, body, scripts, styles). Report any inline scripts or external references.
2. If asked to implement features, propose adding small modular files (e.g., `js/main.js`, `css/site.css`) and update `index.html` accordingly.
3. If user requests a dev server, add a minimal `package.json` with a `start` script (e.g., `http-server` or `vite`) and update these instructions.

Examples (concrete snippets tied to this repo)
- To serve locally for testing: `npx http-server . -p 8080` (then open `http://localhost:8080/index.html`).
- To extract inline script into a module: create `js/main.js`, move the script content, then add `<script src="js/main.js" type="module"></script>` before `</body>`.

When to ask the user
- If changes require build tooling, package.json, or new directories, ask whether they want a simple static-server setup or a modern toolchain (Vite/webpack).
- Ask for the intended deployment target (GitHub Pages, static host, internal server) before adding CI or publish workflows.

Notes for reviewers
- Keep instructions concise and grounded in repository contents. Do not add speculative architectural claims beyond what files reveal.

If something here is missing or incorrect, tell me which files or workflows I should inspect next and I will update this file.
