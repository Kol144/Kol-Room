import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

async function outputFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? outputFiles(path) : path;
  }));
  return paths.flat();
}

export default {
  base: './',
  worker: { format: 'es' },
  plugins: [{
    name: 'frumos-offline-files',
    apply: 'build',
    async writeBundle(options) {
      const root = resolve(options.dir);
      const sw = join(root,'sw.js');
      const paths = (await outputFiles(root)).filter(path=>path!==sw).sort();
      const names = paths.map(path=>relative(root,path).split(sep).join('/'));
      const template = await readFile(sw,'utf8');
      const hash = createHash('sha256').update(template).update(JSON.stringify(names));
      for(const path of paths) hash.update(await readFile(path));
      await writeFile(sw,template.replace('/* BUILD_FILES */ []',JSON.stringify(names))
        .replace('BUILD_VERSION',hash.digest('hex').slice(0,16)));
    },
  }],
};
