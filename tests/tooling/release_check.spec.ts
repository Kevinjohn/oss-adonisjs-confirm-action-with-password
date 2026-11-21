import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'

const releaseScript = new URL('../../bin/release_check.sh', import.meta.url)
const digest = 'a'.repeat(64)

for (const digestCase of [
  'missing',
  'failing',
  'malformed',
  'consumer-fails',
  'changed',
  'valid',
]) {
  test(`the release gate handles a ${digestCase} archive validation result`, async ({
    assert,
    cleanup,
  }) => {
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
    if (digestCase !== 'missing') {
      const result = {
        'failing': `printf '${digest}  fixture.tgz\\n'\nexit 2`,
        'malformed': "printf 'not-a-digest  fixture.tgz\\n'",
        'consumer-fails': `printf '${digest}  fixture.tgz\\n'`,
        'changed': `if [[ -f tmp/release/changed ]]; then printf '${'b'.repeat(64)}  fixture.tgz\\n'; else printf '${digest}  fixture.tgz\\n'; fi`,
        'valid': `printf '${digest}  fixture.tgz\\n'`,
      }[digestCase]
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
    // The real consumer is exercised in CI against the exact package. Here only test release
    // hand-off and failure propagation, using a stand-in that receives the archive path.
    await writeFile(
      join(bin, 'test_packed_consumer.mjs'),
      `
import assert from 'node:assert/strict'
import { access, writeFile } from 'node:fs/promises'
assert.equal(process.argv[2], 'tmp/release/fixture.tgz')
await access(process.argv[2])
console.log('consumer checked fixture archive')
${digestCase === 'changed' ? "await writeFile('tmp/release/changed', '')" : ''}
process.exit(${digestCase === 'consumer-fails' ? 42 : 0})
`
    )
    const output = join(root, 'outputs')
    await writeFile(output, '')
    const result = spawnSync('/bin/bash', ['-s'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: bin, GITHUB_REPOSITORY: 'example/fixture', GITHUB_OUTPUT: output },
      input: await readFile(releaseScript, 'utf8'),
    })
    const notes = join(root, 'tmp/release/notes.md')
    if (digestCase === 'valid') {
      assert.include(result.stdout, 'consumer checked fixture archive', result.stderr)
      assert.equal(result.status, 0, result.stderr)
      assert.include(await readFile(notes, 'utf8'), `SHA-256: \`${digest}\``)
      assert.equal(await readFile(output, 'utf8'), 'version=1.2.3\ntarball=fixture.tgz\n')
    } else if (digestCase === 'consumer-fails') {
      assert.equal(result.status, 42, result.stderr)
      assert.include(result.stdout, 'consumer checked fixture archive')
      assert.equal(await readFile(output, 'utf8'), '')
      await assert.rejects(() => access(notes), /ENOENT/)
    } else if (digestCase === 'changed') {
      assert.equal(result.status, 1, result.stderr)
      assert.include(result.stderr, 'The checked archive changed during consumer validation')
      assert.equal(await readFile(output, 'utf8'), '')
      await assert.rejects(() => access(notes), /ENOENT/)
    } else {
      assert.equal(result.status, 1, result.stderr)
      assert.include(result.stderr, 'Could not calculate a valid SHA-256 digest')
      assert.notInclude(result.stdout, 'consumer checked fixture archive')
      assert.equal(await readFile(output, 'utf8'), '')
      await assert.rejects(() => access(notes), /ENOENT/)
    }
  })
}
