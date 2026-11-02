// ══════════════════════════════════════════════════════════════
//  NUFLI displayer template
//
//  The parts of a NUFLI Editor (Crest) .nuf file that are not picture
//  data. They are identical in every file saved by the editor's newer
//  displayer version, so new pictures can be saved with them:
//
//  $3000–$31ff  displayer: init, speedcode generator, raster IRQ
//  $3300–$33d7  speedcode templates and the table-entry decoder ($33b0)
//  $3fc0–$3fef  VIC register values copied to $d000–$d02f at start
//  table        8 sprite Y moves ($4x entries) in rows 62..84
// ══════════════════════════════════════════════════════════════

const CODE = 'eKkBjQ3cqRCNFAOpMY0VA6IvvcA/nQDQyhD3qQCF+6kQhfyiAIopA6i5SDONUDC5RDONPTC5QDONpDCouQAzmQAzyMAH0PW9ASSgKCCwM40AM4wIM72BJKApILAzjQszjA0zvQEooCogsDONEDOMEjO9gSigKyCwM40VM4wXM70BLKAsILAzjRozjBwzvYEsoC0gsDONHzOMITO9TDONJDOGAqIAoAC9ADOR+8jo4CjQ9ZgYZfuQAub8hfumAujgZPADTCUwoAW5xzOR+4gQ+KkAjb4Zqd2NvxmpOoU6qaCNJhCiJ72AIp2AAr3Yc53YM8oQ8aIHvfgjnfgDqQCd+H+p/p34B8oQ7a0N3FhMDTGpKo0S0KkwjRQD7hnQWOrq6urq6urq6urq6urq6kweMbqKGGkGqpqg/7kB3Cn8rhLQ4CrwAIwY0AkCjQDdoiuOAdCOA9COBdCOB9COCdCOC9CODdCOD9CuACSOKNCugCSOKdCuACiOKtCugCiOK9CuACyOLNCugCyOLdCiqo4B0I4D0I4F0I4H0I4J0I4L0I4N0I4P0AkBjbwZqQCMF9CZGNCMF9CgBYjQ/a3wP40m0K3xP40l0K33P40n0K32P40u0CQAqTigeIwY0KI+IAAQqQCNF9CpKY0S0KkQjRQD7hnQTIHqAAAAAAAAAAAAAAA=';
const SPEEDCODE = 'AAAAAAAAAIwo0KAAjCnQoACMKtCgAIwr0KAAjCzQoACMLdCgAIwY0KQ6jBHQoACgPIwR0KAAoACOEdCNEdCgAAIAAAI5KC80BgYGA2hYSDgoGAh4aFhIOCgYCHhoWEg4KBgIeGhYSDgoGAh4aFhIOCgYCHhoWEg4KBgIeGhYSDgoGAh4aFhIOCgYCAOYqLiImKi4iJiouIiYqLiImKi4mKi4iJiouIiYqLiImKi4iBiFA0pKSkrwDMkE0AWkA6nUYAkgqKUDYKAQjBHQYAAAAAAAAAAAAAAA';
const VIC_INIT = 'GCswK2ArkCvAK/ArICsYK0B4KQAA/wgAFAAB/4B+AAAAAAAAAAAAAAAAAAAAAAAA';

/** Sprite Y moves: [table column, row, entry] ($4x = sprite Y register 2x−1 := $d4). */
export const SPRITE_Y_MOVES = [
  [1, 71, 0x49], [1, 77, 0x41], [1, 78, 0x4f], [1, 80, 0x43],
  [2, 63, 0x45], [2, 67, 0x47], [2, 72, 0x4b], [2, 77, 0x4d],
];

const decode = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

/** [address, bytes] blocks of the template. */
export const TEMPLATE_BLOCKS = [
  [0x3000, decode(CODE)],
  [0x3300, decode(SPEEDCODE)],
  [0x3fc0, decode(VIC_INIT)],
];
