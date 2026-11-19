import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from '@japa/runner'
import { collectExit, captureChildOutput, waitForPid } from '../helpers/child_process.js'

async function directory(cleanup: (callback: () => void | Promise<void>) => void): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'confirm-action-wait-for-pid-'))
  cleanup(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('waitForPid returns the pid a complete file holds', async ({ cleanup }) => {
  const file = path.join(await directory(cleanup), 'worker.pid')
  await writeFile(file, '4242\n')
  assert.equal(await waitForPid(file), 4242)
})

test('waitForPid rejects a file that never holds a positive pid', async ({ cleanup }) => {
  const file = path.join(await directory(cleanup), 'worker.pid')
  for (const content of ['', 'abc', '0', '-5', '1.5']) {
    await writeFile(file, content)
    await assert.rejects(waitForPid(file, 100), /Timed out waiting for a pid/, content)
  }
})

test('waitForPid surfaces read errors other than a missing file', async ({ cleanup }) => {
  await assert.rejects(waitForPid(await directory(cleanup), 100), { code: 'EISDIR' })
})

test('collectExit waits for output written after the child itself exited', async () => {
  // The grandchild shares the child's stdout and writes only once the child is gone.
  const grandchild = `
const parent = Number(process.argv[1])
const poll = setInterval(() => {
  try { process.kill(parent, 0) } catch { clearInterval(poll); process.stdout.write('late output') }
}, 10)
`
  const child = spawn(
    process.execPath,
    [
      '-e',
      `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, String(process.pid)], { stdio: ['ignore', 'inherit', 'inherit'] }).unref()`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const result = await collectExit(child, await captureChildOutput(child))
  assert.equal(result.code, 0)
  assert.equal(result.text, 'late output')
})
