# KER Writer on Web

Chrome browser app for AVR Tiny1616 programming workflow.

## Scope (current)

- Chrome Web Serial connection UI (connect, reconnect, disconnect)
- Firmware selection from the local `firmware/` folder bundled with the app
- Tiny1616 UPDI flash write via browser (Web Serial + vendored `webUPDI` core)
- Tiny1616 verify flow via browser
- Tiny1616 fixed fuse write flow (with readback validation)
- Tiny1616 fixed fuse policy with safety checks:
  - fuse0: 0x00
  - fuse1: 0x00
  - fuse2: 0x02
  - fuse5: 0xC5
  - fuse6: 0x04
  - fuse7: 0x00
  - fuse8: 0x00

## Not implemented yet

- Production hardening of retry logic and rich error classification
- Advanced manufacturing features (batch mode, job presets)

Write/Verify/Fuse buttons are wired to real UPDI flows.

The current programming backend is based on the `serialupdi` implementation from `manuelkasper/webupdi`, vendored under `src/vendor/webupdi`.

The UI no longer uploads arbitrary HEX files at runtime. Instead, it offers a single-select firmware list generated from files in the project `firmware/` folder.

## Publishing

This app can be hosted as a static site, including GitHub Pages.

Web Serial requirements still apply after publishing:

- Open the site in a Chromium-based browser
- Serve over HTTPS, or use localhost for local testing
- Port access must still be granted by the user from the browser UI

### GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml` for GitHub Pages deployment.

1. Create a GitHub repository and push this project to `main` or `master`
2. In GitHub, open `Settings > Pages`
3. Set the source to `GitHub Actions`
4. Push to `main` or run the `Deploy GitHub Pages` workflow manually

The site will be built from `dist/` and published automatically.

## Requirements

- Node.js 20+
- npm 10+
- Chrome (Web Serial capable)

## Development

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome.

## Build and lint

```bash
npm run build
npm run lint
```

## Notes

- Web Serial works only in secure contexts (localhost or HTTPS).
- This app is intentionally Tiny1616-only.
- Unsafe fuse edits must remain blocked, especially SYSCFG0 (fuse5) CRCSRC bits.
- If raw serial is connected, the app closes that session before running UPDI write/verify/fuse operations.
