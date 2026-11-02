# PixelForge

This project is a web based pixel graphics editor.
It's able to load and save PNG files as well as Commodore C64 Koala Painter formats including the restrictions of the image format.
Furthermore it supports adding reference images to paint over and a tracer which traces high resolution images into pixel graphics.

## Project Structure

This is a Web Application built with JavaScript.

## Key Files & Directories

index.html - Web page frontend (loads `js/main.js` as an ES module)
style.css - The editors styles
js/ - Application code as native ES modules (no bundler):
- main.js - Entry point, `init()`
- state.js - Central state object `S` (document state and transient runtime state shared between modules)
- constants.js, dom.js, color.js - Constants, DOM references, colour helpers
- pixels.js, draw-algorithms.js, history.js - Pixel access incl. C64 tile rules, shape generators/flood fill, undo/redo
- render.js, view.js, input.js - Canvas rendering, zoom/coordinates, mouse drawing handlers
- layers.js, layer-panel.js - Layer model and layer panel UI
- brush.js - Brush footprint (size/shape), mirror symmetry, tile-mode wrapping, dither/shade inks
- selection.js, selection-tools.js - Selection mask (`S.selection`), floating pixels (`S.floating`), transforms, clipboard, marching ants; mouse handling for select/lasso/wand/move
- palette.js, color-controls.js, adjustments.js, reference.js - Palette/Lospec, colour pickers, image adjustments, reference image
- crt.js - CRT look for the preview window
- zip.js - minimal stored-ZIP writer (multi-file downloads, e.g. tall FLI/AFLI pages)
- io.js, document.js, preview-window.js, toolbar.js, shortcuts.js, toast.js, help.js - Files, new image, UI chrome
- c64/ - C64 graphics modes: modes.js (colour rules, encode/decode per mode), formats.js (file formats: detect/read/write), c64-document.js (open/load/export), nufli.js (NUFLI memory model, decoder, region encoder), d64.js + disk-browser.js (D64 directory), colors.js, c64-ui.js
- tracer/ - Image tracer (state, viewport, settings, dithering, image processing; pixelart.js: Kuwahara smoothing, edge detection, majority downscale, outlines, cleanup, LCh palette matching, IFLI frame split)

The app must be served over HTTP (`npm start`); ES modules do not load from `file://`.
Distribution: `npm run build` (scripts/build.mjs) bundles js/ into dist/pixelforge/app.js with esbuild; never hand-edit dist/.
Module imports are read-only bindings: mutable state shared across modules lives on `S`.

## Development Guidelines

### Coding Style

- Follow javascript best practices
- Write clear, self-documenting code
- Use meaningful variable and function names
- Keep functions small and focused

## Files to Avoid

- node_modules/
- .env files
- Build artifacts (dist/, build/)
- Log files

## Special Instructions

- Don't use frameworks, only VanillaJS.
- Keep existing functionality fully intact

## Working with Claude Code

### Preferred Workflow

1. **Explore**: First understand the codebase
2. **Plan**: Discuss the approach before coding

### Communication Style

- Ask clarifying questions before implementing
- Explain technical decisions
- Suggest improvements when relevant
- Point out potential issues proactively
