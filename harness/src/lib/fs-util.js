import { existsSync, readFileSync } from 'node:fs';

export function readFileIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}
