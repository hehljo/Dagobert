// Apple lehnt den Store-Upload ab, wenn das App-Icon einen Alphakanal hat
// ("Invalid large app icon ... can't be transparent", belegt 06.11.2026, Build 17).
// Gemessen wird der PNG-Farbtyp im IHDR, nicht das Aussehen: auf dem Gerät wirkt
// ein freigestelltes Icon schwarz hinterlegt und fällt deshalb nie auf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ICONSET = new URL('../ios/App/App/Assets.xcassets/AppIcon.appiconset/', import.meta.url);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Liefert null für ein PNG ohne Alpha, sonst den Grund. */
export function alphaProblem(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(SIGNATURE) || buffer.toString('latin1', 12, 16) !== 'IHDR') {
    return 'kein lesbares PNG';
  }
  const colorType = buffer[25];
  if (colorType === 4 || colorType === 6) return `Farbtyp ${colorType} mit Alphakanal`;
  // Farbtyp 2/3 kann Transparenz über einen tRNS-Block tragen.
  if (buffer.includes(Buffer.from('tRNS', 'latin1'))) return 'tRNS-Transparenz';
  return null;
}

function header(colorType) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1024, 0); ihdr.writeUInt32BE(1024, 4); ihdr[8] = 8; ihdr[9] = colorType;
  const length = Buffer.alloc(4); length.writeUInt32BE(13);
  return Buffer.concat([SIGNATURE, length, Buffer.from('IHDR', 'latin1'), ihdr, Buffer.alloc(4)]);
}

test('Gegenprobe: RGBA wird erkannt, RGB nicht', () => {
  assert.match(alphaProblem(header(6)), /Alphakanal/);
  assert.equal(alphaProblem(header(2)), null);
});

test('App-Icons im Asset-Katalog haben keinen Alphakanal', () => {
  const pngs = readdirSync(ICONSET).filter((name) => name.endsWith('.png'));
  assert.ok(pngs.length > 0, 'kein App-Icon gefunden – nicht gemessen ist nicht bestanden');
  for (const name of pngs) {
    assert.equal(alphaProblem(readFileSync(join(ICONSET.pathname, name))), null, name);
  }
});
