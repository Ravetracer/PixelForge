# PixelForge

A web based pixel editor including support for Commodore C64 image formats.

Runs entirely in the browser — plain HTML, CSS and JavaScript (ES modules), no framework and no build step.

## Features

- Drawing tools: pencil, eraser, fill, eyedropper, line, rectangle, circle, dither brush, shading, colour replace
- Brush size and shape, mirror drawing (X/Y), tile mode for seamless textures, pixel-perfect strokes
- Selections (rectangle, lasso, magic wand), move, copy/paste via the system clipboard, flip and rotate
- Layers with opacity, undo/redo, reference image overlay, live preview window
- Palettes, including Lospec palette search
- Image tracer: converts images into pixel art (edge-preserving smoothing, outlines, clean colour areas) or dithered graphics, for normal images and every C64 mode
- Preview window with a simple CRT look, a PAL video chain emulation (VIC-II signal, PAL encoding/decoding with delay line, RF/composite artifacts, picture tube; WebGL2) and interlace flicker

### C64 graphics modes

Each mode enforces the colour limits of the real hardware while painting.

| Mode | Load | Save |
|---|---|---|
| Multicolor bitmap | Koala Painter | Koala `.koa` |
| Hires bitmap | Art Studio, Interpaint Hires, Hi-Eddi, Doodle (also packed), Image System, mono bitmaps | Art Studio `.art` |
| FLI | FLI Graph / Blackmail (also packed), FLI Designer | FLI Graph `.bml` |
| AFLI | AFLI Editor | `.afl` |
| IFLI | Gunpaint, Funpaint II, Pixel Perfect (also packed) | Gunpaint `.gun` |
| NUFLI | NUFLI Editor `.nuf`, packed `.nup` | `.nuf` |
| SHI (super hires interlace) | Super Hires Interlace Editor `.shi` | `.shi` |
| SHF-XL (super hires FLI) | SHF-XL Edit `.shx` | `.shx` |
| SHIF (super hires interlace FLI) | Crest SHIF-Editor `.shif` | `.shif` |

Every mode keeps its width but accepts any height in its line steps (usually whole character rows).
Pictures taller than one screen are saved as a ZIP with one standard file per page.
The global sprite colours of the super hires modes are picked automatically when tracing and can be changed in the toolbar.

D64 disk images open in a C64-style directory browser that highlights the pictures that can be loaded.

## Running

ES modules do not load from `file://`, so serve the directory with any static web server, for example:

```sh
npm install
npm start
```

and open the printed URL.

## Deployment

```sh
npm install
npm run build
```

creates `dist/pixelforge/` and `dist/pixelforge-<version>.zip` for distribution:
`index.html`, `style.css` (minified), `app.js` (all modules bundled and minified with esbuild) and `LICENSE`.
Upload them to any static web host — no server-side runtime is required. The bundle is a classic script,
so the build also runs when `index.html` is opened directly from disk. Script and stylesheet carry the build
version as query string, so browsers load the new version after an update.

Development uses the ES modules in `js/` directly (`npm start`).

## License

MIT — see [LICENSE](LICENSE).
