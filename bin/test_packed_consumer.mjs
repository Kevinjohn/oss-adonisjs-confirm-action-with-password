import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = await realpath(fileURLToPath(new URL('../', import.meta.url)))
const name = '@kevinjohn/adonisjs-confirm-action-with-password'
const tarball = await realpath(resolve(process.argv[2] ?? ''))
const manifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'))
if (!tarball.endsWith('.tgz')) throw new Error('Pass the exact candidate .tgz archive')

// Use independent, explicit host dependencies, matching the source suite's tested peer versions
// (tests/tooling/packed_consumer_pins.spec.ts compares them with pnpm-lock.yaml).
// Keep the released Account Kit archive: its package is not published to npm.
const hostDependencies = {
  '@adonisjs/assembler': '8.6.0',
  '@adonisjs/core': '7.6.0',
  '@adonisjs/limiter': '3.0.1',
  '@adonisjs/lucid': '22.4.2',
  '@adonisjs/session': '8.3.0',
  '@kevinjohn/adonisjs-account-kit': manifest.devDependencies['@kevinjohn/adonisjs-account-kit'],
  '@vinejs/vine': '4.4.0',
  '@types/node': '24.19.2',
  '@types/luxon': '3.7.6',
  '@poppinss/ts-exec': '1.5.1',
  'better-sqlite3': '13.0.3',
  'luxon': '3.7.2',
  'youch': '4.1.1',
  [name]: 'file:./candidate.tgz',
}
const env = { ...process.env }
delete env.NODE_PATH
delete env.NODE_OPTIONS

for (const compiler of ['5.9.3', '6.0.3']) {
  const host = await realpath(await mkdtemp(join(tmpdir(), 'password-confirmations-consumer-')))
  try {
    if (host === repository || host.startsWith(repository + sep)) {
      throw new Error('Packed host must be outside the repository dependency ancestry')
    }
    // Also reject a TMPDIR under a workspace with an inherited node_modules tree.
    let ancestor = dirname(host)
    while (true) {
      const modules = join(ancestor, 'node_modules')
      const found = await stat(modules).catch((error) => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      })
      if (found) throw new Error(`Packed host would inherit dependencies from ${modules}`)
      if (ancestor === dirname(ancestor)) break
      ancestor = dirname(ancestor)
    }
    await copyFile(tarball, join(host, 'candidate.tgz'))
    await writeFile(
      join(host, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        packageManager: manifest.packageManager,
        dependencies: { ...hostDependencies, typescript: compiler },
      })
    )
    await writeFile(
      join(host, 'pnpm-workspace.yaml'),
      `autoInstallPeers: false\nstrictPeerDependencies: true\nallowBuilds:\n  '@swc/core': true\n  better-sqlite3: true\n  esbuild: true\n`
    )
    await writeFile(
      join(host, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          module: 'NodeNext',
          // Lucid loads migration modules by their .ts URLs when running from source.
          rewriteRelativeImportExtensions: true,
          strict: true,
          // Match the AdonisJS tsconfig; the host separately asserts public types are not any.
          skipLibCheck: true,
          noEmit: true,
          types: ['node'],
        },
        // Assembler codemods must see the actual rc and env modules in the host TS project.
        include: [
          'host.ts',
          'adonisrc.ts',
          'start/env.ts',
          'config/password_confirmations.ts',
          'database/migrations/**/*.ts',
        ],
      })
    )
    await copyFile(join(repository, 'examples/packed-consumer/host.ts'), join(host, 'host.ts'))
    const run = (command, args) => execFileSync(command, args, { cwd: host, env, stdio: 'inherit' })
    run('pnpm', ['install', '--no-frozen-lockfile', '--prefer-offline'])
    run('pnpm', ['list', '--depth', '0'])
    run('pnpm', ['exec', 'tsc', '--version'])
    run(process.execPath, [
      '--import=@poppinss/ts-exec',
      'host.ts',
      name,
      manifest.version,
      compiler,
    ])
    run('pnpm', ['exec', 'tsc', '--noEmit'])
    console.log(`isolated packed consumer ok (TypeScript ${compiler})`)
  } finally {
    await rm(host, { recursive: true, force: true })
  }
}
