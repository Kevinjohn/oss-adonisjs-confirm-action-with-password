import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import { collectExit, captureChildOutput } from '../helpers/child_process.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Run the repository's bin/test.ts in a checkout holding only the given spec files. */
async function runSpecs(
  specs: Record<string, string>,
  cleanup: (callback: () => void | Promise<void>) => void
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'confirm-action-test-runner-'))
  cleanup(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'bin'))
  await mkdir(path.join(root, 'tests'))
  await writeFile(
    path.join(root, 'bin/test.ts'),
    await readFile(path.join(repoRoot, 'bin/test.ts'))
  )
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n')
  await symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  await symlink(path.join(repoRoot, 'tsconfig.json'), path.join(root, 'tsconfig.json'))
  for (const [name, source] of Object.entries(specs)) {
    await writeFile(path.join(root, 'tests', name), source)
  }
  const child = spawn(process.execPath, ['--import=@poppinss/ts-exec', 'bin/test.ts'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  cleanup(() => void child.kill('SIGKILL'))
  return collectExit(child, await captureChildOutput(child))
}

const skipped = `import { test } from '@japa/runner'\ntest('never runs', () => {\n  throw new Error('ran')\n}).skip(true)\n`

test('a run whose only tests are skipped fails as executing no tests', async ({ cleanup }) => {
  const result = await runSpecs({ 'skipped.spec.ts': skipped }, cleanup)
  assert.equal(result.code, 1, result.text)
  assert.match(result.text, /No tests executed/)
}).timeout(30_000)

test('a run with one passing test and one skipped test passes', async ({ cleanup }) => {
  const result = await runSpecs(
    {
      'skipped.spec.ts': skipped,
      'passing.spec.ts': `import { test } from '@japa/runner'\ntest('runs', () => {})\n`,
    },
    cleanup
  )
  assert.equal(result.code, 0, result.text)
  assert.doesNotMatch(result.text, /No tests executed/)
}).timeout(30_000)
