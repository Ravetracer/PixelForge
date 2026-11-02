# PixelForge

A web based pixel editor including support for Commodore C64 image formats.

Runs entirely in the browser — plain HTML, CSS and JavaScript (ES modules), no framework and no build step.

## Features

- Drawing tools: pencil, eraser, fill, eyedropper, line, rectangle, circle, dither brush, shading, colour replace
- Brush size and shape, mirror drawing (X/Y), tile mode for seamless textures, pixel-perfect strokes
- Selections (rectangle, lasso, magic wand), move, copy/paste via the system clipboard, flip and rotate
- Layers with opacity, undo/redo, reference image overlay, live preview window
- Palettes, including Lospec palette search
- Image tracer: converts high-resolution images into pixel graphics with palette reduction and dithering

### C64 graphics modes

Each mode enforces the colour limits of the real hardware while painting.

| Mode | Load | Save |
|---|---|---|
| Multicolor bitmap | Koala Painter | Koala `.koa` |
| Hires bitmap | Art Studio, Interpaint Hires, Hi-Eddi, Doodle (also packed), Image System, mono bitmaps | Art Studio `.art` |
| FLI | FLI Graph / Blackmail (also packed), FLI Designer | FLI Graph `.bml` |
| AFLI | AFLI Editor | `.afl` |
| IFLI | Gunpaint, Funpaint II, Pixel Perfect (also packed) | Gunpaint `.gun` |

D64 disk images open in a C64-style directory browser that highlights the pictures that can be loaded.

## Running

ES modules do not load from `file://`, so serve the directory with any static web server, for example:

```sh
npm install
npm start
```

and open the printed URL. For deployment, copy `index.html`, `style.css` and `js/` to any static web host.

## License

MIT — see [LICENSE](LICENSE).
