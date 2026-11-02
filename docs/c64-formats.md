# C64 graphics formats: byte layouts for PixelForge

All research files are in
the research scratch directory (not part of the repository).
That directory is referred to as `research/` below.

## Conventions

- Every file is a PRG. **Offsets** are file offsets and include the 2-byte load address. A layout
  given as an address `$xxxx` maps to file offset `$xxxx - load + 2`.
- "Cell" means one 8x8 character cell, numbered `cell = (y>>3)*40 + (x>>3)`. A standard VIC bitmap
  byte for pixel (x,y) is at `bitmap + cell*8 + (y&7)`. Its bit `7-(x&7)` is the hires bit; for
  multicolour use the bit pair at `6-(x&6)`.
- Hires: bit 1 takes the **upper** nibble of the screen byte (ink), bit 0 takes the **lower** nibble (paper).
- Multicolour: `00` is the background, `01` is the upper screen nibble, `10` is the lower screen nibble,
  and `11` is the colour RAM low nibble.
- FLI: raster line y uses screen RAM `screens + (y&7)*$400`, unless a format says otherwise.
- **FLI bug**: on FLI lines the VIC cannot fetch the first 3 character columns (x 0..23). It shows
  `$ff` as screen data, so ink and paper are both light grey, and the colour RAM value is undefined.
  Treat columns 0-2 as not editable. RECOIL crops them, which gives the 296 px (hires) or 148 px
  (multicolour) widths. Only NUFLI covers this area with sprites.
- Packer notation: "backwards" means the depacker starts at the last file byte and walks down, while
  it fills the target from its highest address down.

Confidence levels:

- **VERIFIED**: a decoder in `research/` renders a real example correctly.
- **MODEL-VERIFIED**: the pixel model was checked, but on data that is not a file of this format.
- **UNVERIFIED**: the layout comes from documentation only.

---

## 1. Hires bitmap formats (320x200, 2 colours per 8x8 cell)

Editing constraint for all of them: each 8x8 cell has 1 ink and 1 paper colour (any 2 of 16). Mono
`.hbw`/`.hir` files are fixed to white ink on black paper.

| Format | Ext | Load | Size | Bitmap | Screen RAM | Extra | Status |
|---|---|---|---|---|---|---|---|
| Art Studio 1.0-1.1 (OCP) | .art .aas .hpi | $2000 | 9009 (also 9003, 9002) | $2000-$3f3f (off 2) | $3f40-$4327 (off $1f42) | $4328 = border colour (9003/9009). 9009 has 6 more padding bytes, all 0 in the samples | **VERIFIED** with STREETSCENE.ART (9009) and MAKE FIRE.ART / C64FOREVER.ART (9003) |
| Interpaint hires | .iph .ip64h | $4000 | 9002 | $4000-$5f3f (off 2) | $5f40-$6327 (off $1f42) | - | **VERIFIED** with MIDDLE EARTH.IPH and CELTICDOODLE.IPH |
| Hi-Eddi (M&T) | .hed | $2000 | 9218 | $2000-$3f3f (off 2) | $4000-$43e7 (off $2002) | $43e8-$43ff unused | **VERIFIED** with FACESSPHERES.HED |
| Doodle (OMNI) | .dd .ddl | $5c00 | 9218 (RECOIL also accepts 9026, 9217, 9346) | $6000-$7f3f (off $402) | $5c00-$5fe7 (off 2) | $5fe8-$5fff unused | **VERIFIED** with VENICE.DDL. codebase64 lists the bitmap at "$7000"; that is a typo |
| Doodle packed | .jj | $5c00 | variable | RLE of the 9216 bytes above: `$FE VALUE COUNT` = VALUE repeated COUNT times, any other byte is a literal | | | UNVERIFIED (no sample) |
| Image System hires | .ish | $4000 | 9194 | $4000-$5f3f (off 2) | $6000-$63e7 (off $2002) | | UNVERIFIED |
| Hires bitmap mono | .hbw .hir .fgs | $2000 | 8002 | $2000-$3f3f | none | white on black | **VERIFIED** with ROBOT-HW.HBW |

Hires Manager (Cosmos), `.him`, is hires FLI and is covered under AFLI in section 4.

Sources:

- RECOIL `DecodeIph`, `DecodeHed`, `DecodeDd`, `DecodeC64Hir` in https://github.com/pfusik/recoil/blob/master/recoil.fu
- codebase64 spec list (archived): https://web.archive.org/web/2023/https://codebase64.org/doku.php?id=base:c64_grafix_files_specs_list_v0.03
- Samples: C64 OS "Graphics Samples Set #1" (https://c64os.com/c64os/c64ossoftwarereleases/mediapacks), unpacked to `research/samples/`

---

## 2. FLI Graph / Blackmail FLI (.bml .fli .flg), multicolour FLI with $d021 per line

- **Identification**: load $3b00, 17474 bytes. There is no signature.
- **Layout** (offset = address - $3b00 + 2):

| Address | Offset | Size | Content |
|---|---|---|---|
| $3b00-$3bc7 | 2 | 200 | background colour ($d021) for raster line 0..199, low nibble |
| $3bc8-$3bff | $0ca | 56 | unused (0) |
| $3c00-$3fe7 | $102 | 1000 | colour RAM (one byte per cell, low nibble) |
| $3fe8-$3fff | | 24 | unused |
| $4000-$5fff | $502 | 8x$400 | 8 screen RAMs. Screen k ($4000+k*$400, bytes 0..999) is used on lines with y&7 == k |
| $6000-$7f3f | $2502 | 8000 | multicolour bitmap |

- **Pixel decoding**: multicolour. `00` gives `bg[y]`, `01` gives `screen[y&7][cell]>>4`, `10` gives
  `screen[y&7][cell]&15`, and `11` gives `colorram[cell]&15`.
- **Editing constraint**: per 4x1 block of fat pixels (one cell, one line) you get 2 free colours
  (the screen byte for that line) plus 1 colour shared by the whole 8x8 cell (colour RAM) plus the
  line background. Columns 0-2 are the FLI bug: 296 usable hires px, 148 fat px.
- **Packed variant** (codebase64):
  - Load $38f0. $38f0 holds the escape byte, $38f1/2 the address of the last packed byte
    (`= load + filesize - 3`), and $38f3/4 the unpacked end address ($7f3f).
  - The data is read backwards from the end of the file. In reading order a run is
    `ESC COUNT VALUE` (COUNT 0 = 256), so in memory it is stored as `VALUE COUNT ESC`. Any other
    byte is a literal. The output fills $7f3f down to $3b00 (17472 bytes).
  - The packer itself is VERIFIED through FLIP files, which use the identical header and RLE:
    5 files from `flip.D64` (CSDb release 158847) unpack exactly into 17216 bytes $3c00-$7f3f
    (colour RAM $3c00, screens $4000, bitmap $6000, no $d021 table).
  - In those files the bytes $38f5-$3901 are padding and the packed data starts at offset 18.
  - The FLI Graph target length of 17472 bytes is taken from the documentation.
- **Status**: **VERIFIED**. All 10 raw examples in `fli_examples/` render correctly (alapalooza,
  blackmail, budlight, clown, Colibri, Fish, Giger1, Hands, KMpec, LawnmowerMan).
- **Sources**: RECOIL `DecodeBml`, `DecodeFbi`; codebase64 list (FLI Graph 2.2).

## 3. FLI Designer (.fd2 / .fli), multicolour FLI with a global background

- **Identification**: load $3c00, size 17409 (FLI Designer 1.1/2.0 saves) or 17218 (.fd2 without
  padding). No signature.
- **Layout**:

| Address | Offset | Size | Content |
|---|---|---|---|
| $3c00-$3fe7 | 2 | 1000 | colour RAM |
| $4000-$5fff | $402 | 8x$400 | 8 screen RAMs (screen y&7) |
| $6000-$7f3f | $2402 | 8000 | bitmap |
| $7f40-$7ffe | $4342 | 191 | padding, only in the 17409-byte version (all 0 in the sample) |

- **Background**: not stored. RECOIL uses black ($d021 = 0).
- **Pixel decoding and constraint**: as FLI Graph, but with a single global background.
- **Status**: **VERIFIED** with `TUM99_GFX+MUSIC.D64` "NEPOMUK /DIVER" (17409 bytes). The disk's
  `NEPOMUK .TXT` also says "you must load FLI Designer before you can watch this picture".
- **Variant**: codebase64 lists an "FLI Designer 2" variant at $3ff0 with colour RAM $3ff0, screens
  $43f0 and bitmap $63f0. UNVERIFIED.

## 4. AFLI, hires FLI (.afl, AFLI-editor v2.0 by Topaz Beerline)

- **Identification**: load $4000, 16385 bytes ($4000-$7fff).
- **Layout**:

| Address | Offset | Content |
|---|---|---|
| $4000-$5fff | 2 | 8 screen RAMs ($400 apart, 1000 bytes used each). Line y uses screen y&7 |
| $6000-$7f3f | $2002 | hires bitmap |

- **Pixel decoding**: hires. Bit 1 gives `screen[y&7][cell]>>4`, bit 0 gives `screen[y&7][cell]&15`.
- **Editing constraint**: 2 colours (ink and paper) per 8x1 pixel row of each cell, chosen freely
  per line. Columns 0-2 are the FLI bug, leaving 296x200 usable.
- **Status**:
  - File offsets: UNVERIFIED. No raw .afl example exists; RECOIL `DecodeAfl` and codebase64 agree.
  - Pixel model: **MODEL-VERIFIED**. `afli_examples/aflipic.prg` was depacked with a small 6502
    runner (`research/emu6502.js`). Its RAM (bitmap $4000, screens $6000+k*$400) renders correctly
    with the AFLI rule: `png/emu_aflipic_A.png`.
  - That viewer uses the Hires-Manager memory order (bitmap first), not the .afl file order.
- **Related layouts** (same pixel model, UNVERIFIED):
  - **Hires FLI (Crest) .hfc**: $4000, 16386 bytes. Bitmap $4000, screens $6000. RECOIL shows only
    112 lines.
  - **Hires Manager .him**: $4000, 16385 bytes unpacked. Bitmap $4000-$5f3f; $4001 = $ff marks an
    unpacked file; screens $6000-$7fff. The picture is 192 lines (char rows 1..24).
  - **Hires Manager packed**:
    - Header: $4000/1 holds the address of the last packed byte and $4002/3 = $7ff2.
    - The data is read backwards down to file offset 18.
    - Byte `$00` is followed by COUNT and VALUE (in reading order) and makes a run.
    - Any other byte b is followed by b-1 literal bytes.
    - The output fills $7ff1 down to $4140.
  - **ECI** (interlaced AFLI): $4000, 32770 bytes. Bitmap1 $4000, screens1 $6000, bitmap2 $8000,
    screens2 $a000.
- **Sources**: RECOIL `DecodeAfl`, `DecodeHfc`, `DecodeHim`, `DecodeEci`; codebase64 list.

## 5. IFLI: two multicolour FLI frames, shown alternately (interlace)

How IFLI is displayed (common to all IFLI formats):

- Two complete multicolour FLI frames (bitmap and 8 screens each) alternate every video frame.
- Frame 2 is displayed **1 hires pixel to the right** of frame 1 ($d016 xscroll + 1).
- Both frames share **one colour RAM**, because colour RAM cannot be switched quickly.
- The background is global (Pixel Perfect, Funpaint) or per raster line (Gunpaint), and is the same
  for both frames.
- Perceived pixel at hires x = blend(frame1 fat pixel `x>>1`, frame2 fat pixel `(x-1)>>1`). This
  gives 320 px of horizontal "resolution" with mixed colours.
- Columns 0-2 (FLI bug) are unusable, so RECOIL shows 296 px.
- Shift direction check on the examples: frame 2 shifted −1 is clearly worse than 0/+1 in
  inter-frame difference. +1 matches RECOIL and renders sharply.

Editing constraint, per frame:

- Every 4-fat-pixel run on one line can use 2 free colours (that frame's screen byte for line y)
  plus the colour RAM colour shared by both frames for the whole 8x8 cell, plus the background.
- An editor should work on the two frames separately, or convert target colours into
  (frame1, frame2) colour pairs.

### 5a. Gunpaint (.gun, .ifl)

- **Identification**: load $4000, 33603 bytes (RECOIL also accepts 33602). The signature
  `"GUNPAINT (JZ)   "` (16 bytes) is at $43e8 (offset $3ea), in the unused bytes of screen 0.
- **Layout**:

| Address | Offset | Content |
|---|---|---|
| $4000-$5fff | 2 | frame 1: 8 screens |
| $6000-$7f3f | $2002 | frame 1: bitmap |
| $7f4f-$7fff | $3f51 | $d021 for lines 0..176 (177 bytes) |
| $8000-$83e7 | $4002 | colour RAM (shared) |
| $8400-$a3ff | $4402 | frame 2: 8 screens |
| $87e8-$87fb | $47ea | $d021 for lines 177..196 (20 bytes, in the unused part of frame 2 screen 0); lines 197..199 reuse $87fb |
| $a400-$c33f | $6402 | frame 2: bitmap |
| $c340 | $8342 | 1 extra byte (33603 version) |

- **Status**: **VERIFIED** with `ifli_examples/ifli_logo.ifl` (frames and colour RAM).
  - The $d021 tables are documented by RECOIL and codebase64, but they are all 0 in the sample, so
    the per-line background is UNVERIFIED in practice.
  - codebase64 notes that Gunpaint's display code is buggy: the last lines repeat one colour.

### 5b. Funpaint II (.fun, .fp2)

- **Identification**: load $3ff0. Offsets 2..15 ($3ff0-$3ffd) hold `"FUNPAINT (MT) "` (14 bytes,
  trailing space).
  - Offset 16 ($3ffe): packed flag (0 = unpacked).
  - Offset 17 ($3fff): escape byte, stored even when the file is unpacked.
  - Unpacked size: 33694 bytes.
- **Layout** (unpacked):

| Address | Offset | Content |
|---|---|---|
| $4000-$5fff | $12 | frame 1: 8 screens |
| $6000-$7f3f | $2012 | frame 1: bitmap |
| $8000-$83e7 | $4012 | colour RAM (shared) |
| $83e8-$a3e7 | $43fa | frame 2: 8 screens (note: NOT $400-aligned in the file) |
| $a3e8-$c327 | $63fa | frame 2: bitmap |
| $c328-$c38d | $833a | tail (102 bytes) |

- **Background**: RECOIL uses black. codebase64 lists two 100-byte $d021 tables at $7f48-$7fab and
  $c328-$c38b and adds that the "addresses might not be correct". Both samples have zeros there
  (only $7f40/41 and $c328/29 are non-zero), so this is UNVERIFIED.
- **Packing** (flag != 0):
  - Data from offset 18 is a **forward** stream that produces bytes for offsets 18..33693.
  - `ESC COUNT VALUE` repeats VALUE COUNT times, and COUNT 0 produces nothing.
  - Any other byte is a literal. The stream must end exactly.
- **Status**:
  - Frames: **VERIFIED** with CH1 (childhood.d64) and VAA1 (valentine1.d64). Both are stored unpacked.
  - Packing: UNVERIFIED against a real packed file; only a round-trip test in `research/packers.py`.
  - The safe choice is to save unpacked (flag 0).

### 5c. Pixel Perfect (.pp unpacked, .ppp packed)

- **Unpacked (.pp)**: load $3c00, 33602 bytes.

| Address | Offset | Content |
|---|---|---|
| $3c00 | 2 | colour RAM (shared) |
| $4000 | $402 | frame 1: 8 screens |
| $6000 | $2402 | frame 1: bitmap |
| $7f7f | $4381 | global background colour |
| $8000 | $4402 | frame 2: 8 screens |
| $a000 | $6402 | frame 2: bitmap (to $bf3f) |

- **Packed (.ppp)**: load $3bfc.
  - Header: $3bfc-$3bfe = `$10 $10 $10` (signature), $3bff = escape byte.
  - Data from offset 6 is a **forward** stream that produces the 33600 bytes $3c00-$bf3f.
  - `ESC COUNT VALUE` repeats VALUE **COUNT+1** times (1..256). Any other byte is a literal.
  - Encoder rule (reproduces `BROKEN.PPP` **byte-identically**): runs of length >= 4, or any run of
    the escape value, become `ESC len-1 VALUE`, with at most 256 per token. The escape is the least
    frequent byte value.
- **Status**: **VERIFIED**. `BROKEN.PPP` from `ifli_examples/broken.d64` is identified as Pixel
  Perfect packed IFLI. It depacks exactly (all 28895 bytes consumed, 33600 produced) and renders
  correctly. The repack is byte-identical.

Sources for section 5: RECOIL `DecodeGun`, `DecodeC64Fun`, `DecodePp`, `DecodeIfli`, `CmpStream`,
`DrpStream`; codebase64 list; PRONOM fmt/1786 (Funpaint signature),
https://www.nationalarchives.gov.uk/PRONOM/fmt/1786

## 6. NUFLI (.nuf) / packed .nup, from the NUFLI Editor (Crest)

- **Identification**:
  - .nuf: load $2000, 23042 bytes ($2000-$79ff).
  - `TRAIN2009.NUF` is 23114 bytes: 72 extra trailing bytes that look like sprite data and are not
    used by the decoder. Accept sizes of 23042 or more.
  - The file contains the displayer, started with SYS 12288 ($3000).
- **Display**: hires bitmap with FLI every **2** lines (attribute block 8x2), plus 8 sprites (all
  Y-expanded) as **underlays**: bitmap ink is in front of the sprites, paper is behind them.

### Memory map (offset = address - $2000 + 2)

This map comes from instrumenting the decoder (`research/png/nufli_usage.txt`). Every byte not
listed must be preserved from a template.

| Address | Content |
|---|---|
| $2000-$2fff | 4 screens for the lower part (lines 128..199), $400 apart. Only rows 16..24 are used ($x280-$x3e7), plus sprite pointers $x3f8-$x3ff. The free rows 0..15 hold the colour table and sprite blocks |
| $2400-$2464, $2480-$24e4, $2800-$2864, $2880-$28e4, $2c00-$2c64, $2c80-$2ce4 | colour/register table, 6 columns x 101 rows. Column c is at `$2400 + ((c&6)<<9) + ((c&1)<<7)`, row r is at +r |
| $3000-$31ff | displayer code (preserve; a few bytes differ between pictures: $3003-$3005, $30c9) |
| $3200-$33ff | sprite blocks (lower part, bug hires sprite: pointers $c8-$cb) |
| $3400-$3f3f | bitmap rows 16..24 (lines 128..199); the VIC bitmap base is $2000 |
| $3ff0 | initial bug-sprite multicolour 11 ($d026) |
| $3ff1 | initial bug-sprite multicolour 01 ($d025) |
| $3ff6 | initial bug multicolour sprite colour, bits 10 ($d02e) |
| $3ff7 | initial bug hires sprite colour ($d027) |
| other $3ff2-$3fff bytes | unknown, preserve ($3ff4 = $0b in 2 of 3 files) |
| $4000-$5fff | 8 screens for the upper part (lines 0..127), $400 apart. Rows 0..15 used ($x000-$x27f), pointers $x3f8-$x3ff; free rows 16..24 hold sprite blocks |
| $6000-$73ff | bitmap rows 0..15 (lines 0..127) |
| $7400-$79ff | sprite blocks |

### Per-line sources (y = 0..199, x = 0..319)

**Screen RAM for line y**:

- `y < 128`: `$4000 + (7 - ((y>>1)&7))*$400`. Line pairs (0,1) use $5c00, (2,3) use $5800, and so
  on down to (14,15), which use $4000.
- `y >= 128`: `$2000 + ((((y>>1) + (y>=168 ? 1 : 0)) & 3) * $400)`.

**Bitmap base**: `y < 128` uses $6000, otherwise $2000. The byte is at `base + cell*8 + (y&7)`.

**Sprite pointer** for sprite s is at `screen(y) + $3f8 + s`. The block address is
`(y<128 ? $4000 : $0000) + ptr*64`.

The pointers are fixed and identical in all examples:

| Screen | Pointers |
|---|---|
| upper screen k | `$e0+k, $0a+$10k, $0b+$10k, $0c+$10k, $0d+$10k, $0e+$10k, $d0+k, $d8+k` |
| lower screen k | `$c8+k, $84+$10k, $85+$10k, $86+$10k, $87+$10k, $88+$10k, $89+$10k, $80+k` |

Treat them as constants. Every sprite byte belongs to exactly one (line, sprite, byte): 4800 bytes
= 200 lines x 8 sprites x 3 bytes, with no sharing. So the sprite layer can be edited per pixel at
sprite resolution.

**Sprite row byte**: `rowbyte(y,k) = ((((y+47)>>1)*3 + k + adj) & 63)`, where adj is 0 for y<123,
1 for 123<=y<165 and 2 for y>=165. This follows from the Y-expansion plus the sprite-crunch trick,
and k = 0..2 is the byte within the 24-px row.

**Sprite roles** (the physical sprite number is also its priority; 0 is on top):

- Sprite 0: hires, not X-expanded. Covers the FLI-bug area, x 0..23. Pixel x maps to byte `x>>3`,
  bit `7-(x&7)`.
- Sprites 1..6: hires, **X-expanded** underlays for the main area. Sprite s covers x
  `24+48(s-1) .. 71+48(s-1)`, which is character columns 3..38. Sprite pixel `sx = ((x-24)>>1) % 24`.
- Sprite 7: **multicolour**, not X-expanded. Covers x 0..23 with 12 fat pixels at lowest priority.
  Bit pair `(byte>>(6-(x&6)))&3`: 01 = $d025, 10 = its own colour $d02e, 11 = $d026.
- Character column 39 (x 312..319) has no sprite.

**Pixel colour**:

1. Take the screen byte for (line, cell). In the bug area (columns 0..2) on lines where `(y&6) != 0`,
   the byte is `$ff` (light grey ink and paper). On the first 2 lines of each char row the real
   screen byte is used.
2. If the bitmap bit is 1, the pixel is ink (in front of all sprites).
3. Otherwise, for columns < 39: if the relevant hires sprite bit (sprite 0 in the bug area, sprite
   1..6 in the main area) is set, use that sprite's current colour. In the bug area, if the
   multicolour sprite 7 pair is non-zero, use that pair's colour. Otherwise use paper.

**Colour/register table**: 6 columns x 101 rows. Row 0 holds the initial underlay colours of
sprites 1..6. Before line y (y >= 1), row `r = (y+1)>>1`, column i is evaluated:

| Entry | Effect | When it takes effect |
|---|---|---|
| `$0x` | underlay colour of sprite 1+i := x | odd y only, i.e. lines 2r-1. This is **one line after** the bitmap's 2-line FLI pairs (2r, 2r+1) |
| `$5x` | $d025 := x | on line 2r-1 if i == 0, otherwise on line 2r |
| `$6x` | $d026 := x | same timing as `$5x` |
| `$7x` | sprite 0 (bug hires) colour := x | same timing as `$5x` |
| `$ex` | sprite 7 colour := x | same timing as `$5x` |
| `$1x` (and `$4x`) | `$1x` is sprite Y repositioning (NUFLIX article), structural. Found 8 times around rows 62..84 per file. DONTMESS01 has 8 `$4x` entries in the same place instead; that they are also Y moves is my inference | preserve |
| `$2x` | border colour | preserve |
| `$8x-$dx`, other | undocumented, used by the code generator | preserve |

So each 2-line section has only **6 register writes**. A slot spent on a bug colour or border
update is not available for that underlay column's colour change.

### Editing constraints

**Main area, x 24..311**:

- Per 8x2 block (even-aligned line pair): 1 ink + 1 paper.
- Plus 1 underlay colour per 48-px column (sprite 1..6). It can change every 2 lines, phase-shifted
  by 1 line, and only when that column's table slot is free.
- Underlay pixels are 2x1 hires px and show only where the bitmap bit is 0.
- Net result: up to 3 colours per 8x1 pixel row.

**x 312..319**: ink and paper only.

**Bug area, x 0..23**:

- Ink is light grey, except on the first 2 lines of each char row, where real ink and paper apply.
- Sprite 0 adds 1 colour at hires resolution.
- Sprite 7 adds 3 colours as 2x1 fat pixels.
- Paper is light grey on FLI lines.
- These 4 colours can change every 2 lines only through free table slots.

**Re-encoding**:

- Keep a template .nuf: the displayer at $3000-$31ff, pointers, the structural table entries
  ($1x/$4x/$2x) and unknown bytes.
- Then write bitmap bits, screen bytes, sprite bits (inverse of the formulas above) and `$0x`/bug
  colour entries in free slots.
- Converting a picture from scratch needs a Mufflon/NUFLIX-style optimiser.

### .nup (packed)

- **Header**: load $0fff. Offset 2 ($0fff) = `$fd` (signature), offset 3 = escape byte.
- **Packed data**: offsets 4..end, read **backwards** from the last byte. In reading order a run is
  `ESC COUNT VALUE` (COUNT 0 = 256); any other byte is a literal.
- **Output**: fills $79ff down to $2000 (23040 bytes). The stream ends exactly at offset 4.
- **Encoder rule** (reproduces all 5 .NUP files **byte-identically**): tokenize the 23040 data bytes
  in **forward** address order.
  - Runs of length >= 3, or any run of the escape value, are stored as `VALUE COUNT ESC`, with at
    most 255 per token.
  - Literals are stored as-is, in forward order.
- **Escape choice**: any rarely used byte value (the editor chose $73 / $8b).

**Status**: **VERIFIED**.

- `DONTMESS01-05.NUF`, `79END.NUF`, `TRAIN2009.NUF` and all five `deadly chords` .NUP files
  (0E/24/41/6A/79END, which are work-in-progress stages) render correctly.
- The bug columns also look right.

**Sources**:

- RECOIL `DecodeNuf`, `DecodeNup`
- Patai Gergely, "Pushing the Boundaries of C64 Graphics with NUFLIX":
  https://cobbpg.github.io/articles/nuflix.html (sprite configuration, 6x101 table, entry codes,
  crunch schedule, 1-line colour offset)
- c64-wiki NUFLI (https://www.c64-wiki.com/wiki/NUFLI), from a search snippet: $2000-$7a00, SYS 12288

## 7. "Super hires" variants (hires bitmap + hires sprite layers in front of the bitmap)

**What the example folders are**: all files in `superhires_examples/`, `superhires-fli_examples/`
and `superhires-ifli_examples/` (including the .d64s) are crunched executables, except "DATA 02"
(SHX) and NEPOMUK (FLI Designer). Their viewer memory layouts are custom, not editor files.

For reference, the depacked `oldguy.prg` and `DONALD_PABLO.PRG` enable all 8 sprites, hires and
unexpanded, at X = 88, 112, ..., 232 (+ sprite 7) over a hires bitmap in bank $4000. That is a
super-hires layout of about 168 px. Their RAM does not match the SHX layout (`png/shx_memshx_*.png`
is garbage).

The editor formats behind the three folder names:

### 7a. superhires: "Super Hires Interlace Editor" .shi (Vermes)

This is the most common super-hires editor format with real samples.

- **Identification**: load $7fff.
  - Offset 2 ($7fff): 0 = unpacked, otherwise (1) = packed.
  - Unpacked: 15355 bytes; data from $8000 (offset 3).
- **Layout** (offset = address - $7fff + 2):

| Offset | Content |
|---|---|
| $003 | frame 1 bitmap: 12 columns x 25 rows. Byte at `$003 + ((y>>3)*12 + (x>>3))*8 + (y&7)` |
| $963 | frame 2 bitmap, same shape |
| $12c3 | frame 1 sprites, "front" layer. Block `((y/21)*8 + x/24)` x 64, byte `+(y%21)*3 + (x>>3)%3`. 4 sprites wide x 10 bands; each band has 8 blocks: 0-3 front, 4-7 back |
| $13c3 | frame 1 back layer (= front + 4 blocks) |
| $26c3 / $27c3 | frame 2 front / back sprites, same scheme |
| $3ac3 | screen RAM: 12 x 25 bytes (ink<<4 \| paper), **shared by both frames** |
| $3bef-$3bf2 | front-layer colour per 24-px sprite column (4 bytes) |
| $3bf3-$3bf6 | back-layer colour per sprite column (4 bytes) |

- **Packing**:
  - Data from offset 3 is a forward stream.
  - A control byte c < $80 is followed by c literal bytes.
  - A control byte c >= $80 makes the next byte repeat c-$80 times.
- **Pixel**: front sprite bit, then back sprite bit, then bitmap ink/paper. The two frames are
  blended with no $d016 shift.
- **Editing constraint**: 96x200 per frame.
  - 2 sprite colours per 24-px column, fixed for the whole height.
  - Ink and paper per 8x8 cell, shared by both frames.
  - Effectively 4 colours per 8 px, plus the interlace mix.
- **Status**: **VERIFIED** with V1.3B samples from CSDb release 35973 (GIRL 00-04, BORIS, …;
  `png/shi_*.png`).
  - Files from "disk B" unpack to 15479 bytes: 127 extra trailing bytes, decoded fine.
  - **SHIE V1.2 files** unpack to 12493 bytes and use a different, older layout. The editor ships a
    "1.2&1.3 TO 1.3B" converter. That layout is UNKNOWN and not decoded.
  - The "Miniu SHI collection" files (flag $10/$30) are another program. UNKNOWN.

Other plain super-hires formats (RECOIL; UNVERIFIED, no samples):

- **SH1** (Super-hires Editor I, 96x168): 14770 bytes unpacked.
- **SH2** (Super-hires Editor II, 192x168, 1 sprite layer): 14770 bytes.
- **SHE** (Super Hires Editor 1/2): 3250 or 8642 bytes.
- **SHS** (Super Hires Studio, 320x200): 14338 bytes.
  - Bitmap at offset 2 and screen at $3402.
  - Two sprite layers at $2002 (back) and $2802 (front), 4 sprites wide, at columns 2..13 and
    lines 17..184.
  - Colours at $1f42 (back) and $1f46 (front).
- The offsets for these are in RECOIL `DecodeSh1`, `DecodeSh2`, `DecodeShe`, `DecodeShs`.

### 7b. superhires-fli: Super Hires FLI = hires FLI + hires sprite overlay

**SHF-XL Edit (.shx)**:

- **Identification**: load $4000, 15362 bytes ($4000-$7bff). "DATA 02" from
  `wild west tank girl.d64` is this format.
- **Layout**:

| Address | Content |
|---|---|
| $4000 + k*$400, k = 0..7 | FLI screens (line y uses screen y&7). The picture uses columns **11..28** only (18 columns = 144 px), rows 0..20 (168 lines) |
| $43e8 | unknown ($0b) |
| $43e9 | sprite colour: one colour for the whole overlay |
| $4000 + k*$400 + $3f8 | sprite pointers: `$ef, p1..p6, $00` |
| $6000-$7f3f | bitmap (same cell addressing; columns 11..28 used) |
| inside $6000-$7bff | sprite blocks, in the unused bitmap columns. Pointer p is at $4000 + p*64 |

  The pointers p1..p6 by screen k:

| Screen k | p1..p6 |
|---|---|
| 0 | 80 84 85 89 8a 8e |
| 1 | 8f 93 94 98 99 9d |
| 2 | 9e a2 a3 a7 a8 ac |
| 3 | ad b1 b2 b6 b7 bb |
| 4 | bc c0 c1 c5 c6 ca |
| 5 | cb cf d0 d4 d5 d9 |
| 6 | da de df e3 e4 e8 |
| 7 | e9 ea eb ec ed ee |

- **Pixel** at picture (x,y), x 0..143, y 0..167:
  - Sprite s = `(x>>3)/3` (0..5).
  - Block `n = ((y-1)&7)*15 + s`; if n < $69 then `n += ((s+1)>>1)*3`. The sprite pointer lags one
    line behind the screen.
  - Byte = `$6000 + n*64 + (y%21)*3 + (x>>3)%3`, bit `7-(x&7)`. If it is set, the pixel takes the
    sprite colour (overlay in front of the bitmap).
  - Otherwise hires FLI with screen `y&7` and column `11 + (x>>3)`.
- **Editing constraint**: per 8x1 run, ink + paper (FLI, every line) plus the one global sprite
  colour at any pixel. No sprite byte is shared between lines (checked: 3024 bytes, 0 shared).
- **Status**: **VERIFIED** with DATA 02 (`png/shx_wild_west_tank_girl__DATA_02*.png`).
- **Sources**: RECOIL `DecodeShx`; codebase64 "SHFLI-XL" (pointer table).

**Crest Super Hires FLI Editor (.shf)**: UNVERIFIED, no sample. The CSDb editor disk contains only
the editor.

- **Unpacked**: load $4000, 15874 bytes, 208x167.
  - Screens at $4000 + k*$400. The picture starts at screen column **14** and the screen line is y+1.
  - Bitmap at $6000 (column 14 → offset $2072).
  - Two sprite layers on the left 96 px (12 columns). Sprite colours at $43e8 (front) and $43e9 (back).
  - The pointer table per screen is `80 84 85 89 8a 8e 8f 93 / 94 98 99 9d 9e a2 a3 a7 / ...` (codebase64).
  - RECOIL's sprite order: block = table[((y&7)<<3) + col/3] (front) and table[... + 4] (back).
- **Packed**: load address + escape byte at offset 2.
  - Forward stream from offset 3: `ESC COUNT(0=256) VALUE`, else literal.
  - It produces 8170 bytes of a **linear** editor layout: front-sprite bits $000, back-sprite bits
    $800, bitmap $1000, colours $1800 (all 12 bytes per line, 167 lines), colour byte $1fe8.

### 7c. superhires-ifli: Super Hires Interlace FLI (Crest SHIF-Editor, file names `*.SHIF`; RECOIL calls it `.sif`)

- **Identification**: there is no fixed load address; it varies with the size. The file consists of:
  - frame-1 block: `[2-byte word W1][escape][packed data...]`, where W1 is also the PRG load address
    and the block length is `W1 - $9402` bytes after the word;
  - frame-2 block: `[W2][escape][packed data...]`, same scheme;
  - 4 bytes: front1, back1, front2, back2 sprite colours.
  - Total length = 2 + (W1-$9402) + 2 + (W2-$9402) + 4.
- **Packing** (each block):
  - Read **backwards** from the block end down to the byte after the escape.
  - `ESC COUNT(0=256) VALUE`, else literal.
  - Output 8176 bytes, filled from the end.
- **Unpacked frame**: linear, 12 bytes per raster line, 167 lines.

| Offset | Content |
|---|---|
| $000 | front sprite bitmap (1 bit per pixel) |
| $800 | back sprite bitmap |
| $1000 | hires bitmap |
| $1800 | colour per 8x1 (ink<<4 \| paper), i.e. FLI on every line |

- **Pixel**: front bit gives the frame's front colour, back bit the back colour, otherwise ink or
  paper. The two frames are blended with no shift.
- **Editing constraint**: 96x167.
  - Per 8x1 run per frame: ink + paper + 2 global sprite colours (front and back per frame).
  - Interlace mix between the frames.
- **Status**: **VERIFIED** with DOMINA, ROBOTICA, GOLDFISH .SHIF from `flip.D64` (CSDb 158847/12669).
  The stream lengths match exactly and the images are correct (`png/shif_*.png`).
- **Note**: this linear file layout is the editor's own. The editor converts it to VIC memory
  (2 x 8 screens + sprite pointer tables as in codebase64 "SHIFLI") at display time.
- **Sources**: RECOIL `DecodeC64Sif`, `UifStream.StartSifFrame`; codebase64 "SHIFLI".

## 8. Identified unknown files

| File | Identification |
|---|---|
| `ifli_examples/broken.d64` "BROKEN.PPP" ($3bfc, 28895) | **Pixel Perfect packed IFLI** (section 5c). `$10 $10 $10` signature, escape $87 |
| `superhires-fli_examples/wild west tank girl.d64` "DATA 02" ($4000, 15362) | **SHF-XL Edit (.shx)**, super-hires FLI 144x168 (section 7b). "DATA 01" ($1000, 254 bytes) and the 189-byte "TANK GIRL WEC" are presumably the loader and viewer (not checked) |
| `nufli_examples/deadly chords.d64` "*.NUP" ($0fff) | **NUFLI Editor packed** (section 6). `$fd` signature + escape, backwards RLE |
| `TUM99_GFX+MUSIC.D64` "NEPOMUK /DIVER" ($3c00, 17409) | **FLI Designer** (section 3) |

## Scripts and output (all in `research/`)

| File | Covers |
|---|---|
| `c64lib.py` | palette, PNG output (2 frames are blended, FLI bug columns get a magenta dot pattern) |
| `dec_hires.py` | Art Studio, Interpaint, Hi-Eddi, Doodle (+ .jj), mono |
| `dec_fli.py` | FLI Graph / BML, FLI Designer, FLIP packed |
| `dec_ifli.py` | Gunpaint, Funpaint II, Pixel Perfect (.pp/.ppp); also writes the frame1/frame2 PNGs |
| `dec_nufli.py` | .nuf / .nup; writes `png/nufli_usage.txt` (data-byte map) |
| `dec_shx.py` | SHF-XL |
| `dec_superhires.py` | SHI, SHIF |
| `dec_afli_mem.py` | AFLI model check on a RAM dump |
| `packers.py` | reference packers + round-trip / byte-identity tests (NUP, PPP, Funpaint) |
| `emu6502.js` | minimal 6502 runner used to depack viewer executables (research only) |
| `extract.js` + `d64lib.js` | D64 extraction |

Other locations:

- Contact sheets: `sheet_*.png`
- Single renders: `png/`
- Extracted D64 files: `extract/`
- Downloaded samples (C64 OS pack, CSDb SHI/SHIF/FLIP disks): `samples/`

Note on licensing: RECOIL's `recoil.fu` header now says `SPDX-License-Identifier: MIT` (2009-2026),
not GPL. These scripts are independent re-implementations; no code was copied.
