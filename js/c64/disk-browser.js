import { $ } from '../dom.js';
import { showToast } from '../toast.js';
import { petsciiToString, readD64 } from './d64.js';
import { detectFormat, loadAddress } from './formats.js';
import { MODES } from './modes.js';
import { loadC64Bytes } from './c64-document.js';

// ══════════════════════════════════════════════════════════════
//  Disk browser: C64-style directory listing of a D64 image with
//  loadable pictures highlighted
// ══════════════════════════════════════════════════════════════

const hex4 = n => '$' + n.toString(16).padStart(4, '0');

/** Classify a directory entry: loadable picture, program, or other data. */
export function classifyFile(file, name) {
  if (file.type === 'DEL' || file.data.length === 0) return { kind: 'none' };
  const format = detectFormat(file.data, name);
  if (format) return { kind: 'picture', format, label: `${format.label} · ${MODES[format.mode].label}` };
  const addr = loadAddress(file.data);
  if (addr === 0x0801) return { kind: 'program', label: 'program' };
  return { kind: 'data', label: `${hex4(addr)} · ${file.data.length} bytes` };
}

function quoted(name) {
  // C64 shows the name in quotes, padded to 16 characters
  return `"${name}"`.padEnd(18, ' ');
}

export function openDiskBrowser(bytes, fileName) {
  let disk;
  try {
    disk = readD64(bytes);
  } catch (err) {
    showToast('Could not read disk image: ' + err.message, 'error');
    return;
  }

  $('disk-filename').textContent = fileName;
  const list = $('disk-listing');
  list.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'disk-line disk-title';
  header.textContent = `0 "${petsciiToString(disk.title).padEnd(16, ' ')}" ${petsciiToString(disk.id)}`;
  list.appendChild(header);

  let candidates = 0;
  for (const file of disk.files) {
    const name = petsciiToString(file.name);
    const info = classifyFile(file, name);
    const line = document.createElement(info.kind === 'picture' ? 'button' : 'div');
    line.className = `disk-line disk-${info.kind}`;

    const blocks = String(file.blocks).padEnd(5, ' ');
    const type = `${file.closed ? ' ' : '*'}${file.type}${file.locked ? '<' : ' '}`;
    const text = document.createElement('span');
    text.className = 'disk-entry';
    text.textContent = `${blocks}${quoted(name)}${type}`;
    line.appendChild(text);

    if (info.label) {
      const tag = document.createElement('span');
      tag.className = 'disk-tag';
      tag.textContent = info.label;
      line.appendChild(tag);
    }
    if (info.kind === 'picture') {
      candidates++;
      line.type = 'button';
      line.title = `Load "${name}" as ${info.label}`;
      line.addEventListener('click', () => {
        if (loadC64Bytes(file.data, name)) closeDiskBrowser();
      });
    }
    list.appendChild(line);
  }

  const footer = document.createElement('div');
  footer.className = 'disk-line';
  footer.textContent = `${disk.blocksFree} BLOCKS FREE.`;
  list.appendChild(footer);

  $('disk-hint').textContent = candidates
    ? `${candidates} loadable picture${candidates > 1 ? 's' : ''} highlighted — click to load.`
    : 'No loadable pictures on this disk. Programs (packed viewers, demos) cannot be loaded.';
  $('disk-overlay').classList.remove('hidden');
  list.querySelector('.disk-picture')?.focus();
}

export function closeDiskBrowser() {
  $('disk-overlay').classList.add('hidden');
}

$('disk-close').addEventListener('click', closeDiskBrowser);
$('disk-overlay').addEventListener('click', e => { if (e.target === $('disk-overlay')) closeDiskBrowser(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('disk-overlay').classList.contains('hidden')) closeDiskBrowser();
});
