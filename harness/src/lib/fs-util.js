import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function readFileIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

export function findUp(startDir, marker) {
  let dir = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
