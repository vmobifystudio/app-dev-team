/**
 * Hash a release artifact — a file (.ipa/.aab/.apk) or a directory (a web build's output dir).
 *
 * A file hashes exactly as lib/dossier.mjs `hashFile` does, so every existing record still verifies.
 * A directory hashes its sorted `relative-path NUL sha256` lines, so a renamed, added, removed or
 * edited file inside the build output changes the digest. Symlinks are hashed as their target
 * string, never followed — a link out of the build dir must not pull bytes from elsewhere.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function hashArtifact(path) {
  if (!lstatSync(path).isDirectory()) return sha(readFileSync(path));
  const lines = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const st = lstatSync(abs);
      const rel = relative(path, abs).split(sep).join('/');
      if (st.isDirectory()) walk(abs);
      else lines.push(`${rel}\0${st.isSymbolicLink() ? sha(`link:${readlinkSync(abs)}`) : sha(readFileSync(abs))}`);
    }
  };
  walk(path);
  return sha(lines.sort().join('\n'));
}

/** Total bytes of a file, or of every regular file under a directory. */
export function artifactSize(path) {
  const st = lstatSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((n, name) => n + artifactSize(join(path, name)), 0);
}
