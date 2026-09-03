import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const binaryPath = path.resolve('src-tauri/binaries/mediainfo-x86_64-pc-windows-msvc.exe');
const licensePath = path.resolve('src-tauri/binaries/MediaInfo-LICENSE.txt');
const provenancePath = path.resolve('src-tauri/binaries/MediaInfo-PROVENANCE.md');
const expectedSha256 = '30f2828a45a1895b033c3cd7784581033327e7b393033c55f4a03bb15cab0d89';
const expectedSize = 9_293_720;

const [binary, binaryStat, license, provenance] = await Promise.all([
  readFile(binaryPath),
  stat(binaryPath),
  readFile(licensePath, 'utf8'),
  readFile(provenancePath, 'utf8'),
]);

const actualSha256 = createHash('sha256').update(binary).digest('hex');
if (actualSha256 !== expectedSha256 || binaryStat.size !== expectedSize) {
  throw new Error(`MediaInfo binary drift: ${actualSha256}, ${binaryStat.size} bytes`);
}
if (!license.includes('BSD 2-Clause License') || !license.includes('MediaArea.net SARL')) {
  throw new Error('MediaInfo license notice is missing or incomplete');
}
if (!provenance.includes(expectedSha256)) {
  throw new Error('MediaInfo provenance does not contain the pinned executable checksum');
}

console.log(`MediaInfo verified: ${actualSha256} (${binaryStat.size} bytes)`);
