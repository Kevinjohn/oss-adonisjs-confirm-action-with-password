import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'

const releaseScript = new URL('../../bin/release_check.sh', import.meta.url)
const digest = 'a'.repeat(64)

for (const outcome of ['missing', 'failing', 'malformed', 'valid']) {
  test(`the release gate handles a ${outcome} archive digest`, async ({ assert, cleanup }) => {
    const root = await mkdtemp(join(tmpdir(), 'confirm-release-'))
    cleanup(() => rm(root, { recursive: true, force: true }))
    const bin = join(root, 'bin')
    const packed = join(root, 'package')
    await mkdir(bin)
    await mkdir(join(packed, 'stubs/config'), { recursive: true })
    await mkdir(join(packed, 'stubs/migrations'))
    for (const name of [
      'awk',
      'basename',
      'cut',
      'dirname',
      'gzip',
      'ls',
      'mkdir',
      'mv',
      'rm',
      'tar',
    ]) {
      const located = spawnSync('which', [name], { encoding: 'utf8' })
      assert.equal(located.status, 0, name)
      await symlink(located.stdout.trim(), join(bin, name))
    }
    await symlink(process.execPath, join(bin, 'node'))
    await writeFile(join(bin, 'git'), '#!/bin/bash\nexit 1\n', { mode: 0o755 })
    await writeFile(
      join(bin, 'pnpm'),
      '#!/bin/bash\ncase "$1" in\n  build) exit 0;;\n  pack) tar -czf "$3/fixture.tgz" package;;\n  *) exit 2;;\nesac\n',
      { mode: 0o755 }
    )
    if (outcome !== 'missing') {
      const result = {
        failing: `printf '${digest}  fixture.tgz\\n'\nexit 2`,
        malformed: "printf 'not-a-digest  fixture.tgz\\n'",
        valid: `printf '${digest}  fixture.tgz\\n'`,
      }[outcome]
      await writeFile(join(bin, 'shasum'), `#!/bin/bash\n${result}\n`, { mode: 0o755 })
    }
    await writeFile(join(root, 'package.json'), '{"version":"1.2.3"}\n')
    await writeFile(
      join(root, 'CHANGELOG.md'),
      '## Unreleased\n\n## 1.2.3 - 2026-11-19\n\nFixture release.\n'
    )
    await writeFile(
      join(packed, 'package.json'),
      JSON.stringify({
        name: '@kevinjohn/adonisjs-confirm-action-with-password',
        type: 'module',
        exports: {
          '.': './index.js',
          './types': './index.js',
          './password_confirmations_provider': './index.js',
        },
      })
    )
    await writeFile(
      join(packed, 'index.js'),
      `
      export const configure = null, defineConfig = null, PasswordConfirmations = null, errors = null
      export const stubsRoot = import.meta.dirname + '/stubs'
    `
    )
    await writeFile(join(packed, 'stubs/config/password_confirmations.stub'), '')
    await writeFile(join(packed, 'stubs/migrations/create_password_confirmations_table.stub'), '')
    const output = join(root, 'outputs')
    await writeFile(output, '')
    const result = spawnSync('/bin/bash', ['-s'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: bin, GITHUB_REPOSITORY: 'example/fixture', GITHUB_OUTPUT: output },
      input: await readFile(releaseScript, 'utf8'),
    })
    assert.include(result.stdout, 'packed layout ok', result.stderr)
    const notes = join(root, 'tmp/release/notes.md')
    if (outcome === 'valid') {
      assert.equal(result.status, 0, result.stderr)
      assert.include(await readFile(notes, 'utf8'), `SHA-256: \`${digest}\``)
      assert.equal(await readFile(output, 'utf8'), 'version=1.2.3\ntarball=fixture.tgz\n')
    } else {
      assert.equal(result.status, 1, result.stderr)
      assert.include(result.stderr, 'Could not calculate a valid SHA-256 digest')
      assert.equal(await readFile(output, 'utf8'), '')
      await assert.rejects(() => access(notes), /ENOENT/)
    }
  })
}
