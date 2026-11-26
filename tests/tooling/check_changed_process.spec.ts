import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { test } from '@japa/runner'
import {
  collectExit,
  isAlive,
  captureChildOutput,
  waitForFile,
  waitForPid,
} from '../helpers/child_process.ts'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const runnerPath = path.join(repoRoot, 'bin/check_changed.ts')
const plannerPath = path.join(repoRoot, 'bin/check_changed_plan.ts')

/** The shim logs each step's arguments without the `pnpm` prefix, one step per line. */
const laterSteps = /^(lint|typecheck)$/m

type FixtureOptions = {
  command?: 'normal' | 'hang' | 'missing'
  hook?: 'record-term' | 'fail-reap'
}

type Fixture = {
  directory: string
  root: string
  bin: string
  log: string
  ready: string
  termSent: string
  base: string
  environment: NodeJS.ProcessEnv
}

async function makeCheckProcessFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'confirm-action-check-changed-'))
  const root = path.join(directory, 'checkout')
  const bin = path.join(directory, 'bin')
  const supportBin = path.join(directory, 'support-bin')
  await mkdir(path.join(root, 'bin'), { recursive: true })
  await mkdir(bin)
  await mkdir(supportBin)
  await writeFile(path.join(root, 'bin/check_changed.ts'), await readFile(runnerPath))
  await writeFile(path.join(root, 'bin/check_changed_plan.ts'), await readFile(plannerPath))
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n')
  await writeFile(path.join(root, 'README.md'), 'fixture baseline\n')
  await symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir')

  const git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  await symlink(git, path.join(supportBin, 'git'))
  const runGit = (commandArguments: string[]) =>
    execFileSync(git, commandArguments, { cwd: root, stdio: 'ignore' })
  runGit(['init', '-q'])
  runGit(['config', 'user.email', 'fixture@example.test'])
  runGit(['config', 'user.name', 'Fixture'])
  runGit(['add', '.'])
  runGit(['commit', '-qm', 'fixture baseline'])
  const base = execFileSync(git, ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  await writeFile(path.join(root, 'src-trigger.ts'), 'export const changed = true\n')
  runGit(['add', 'src-trigger.ts'])
  runGit(['commit', '-qm', 'select static checks'])
  const log = path.join(directory, 'commands.log')
  const ready = path.join(directory, 'descendant.pid')
  const termSent = path.join(directory, 'term-sent')
  await writeFile(log, '')

  await writeFile(
    path.join(root, 'worker.js'),
    `import { rename, writeFile } from 'node:fs/promises'\nprocess.on('SIGTERM', () => {})\nawait writeFile(${JSON.stringify(ready + '.tmp')}, String(process.pid))\nawait rename(${JSON.stringify(ready + '.tmp')}, ${JSON.stringify(ready)})\nsetInterval(() => {}, 1000)\n`
  )
  if (options.command !== 'missing') {
    const commandPath = path.join(bin, 'pnpm')
    await writeFile(
      commandPath,
      `#!${process.execPath}\nimport { spawn } from 'node:child_process'\nimport { readFile, writeFile } from 'node:fs/promises'\nconst commandArguments = process.argv.slice(2)\nawait writeFile(${JSON.stringify(log)}, (await readFile(${JSON.stringify(log)}, 'utf8')) + commandArguments.join(' ') + '\\n')\nif (process.env.CHECK_CHANGED_FLOOD && commandArguments[0] === 'exec') {\n  const line = 'x'.repeat(1023) + '\\n'\n  const block = line.repeat(1024)\n  for (let mib = 0; mib < Number(process.env.CHECK_CHANGED_FLOOD); mib++) {\n    if (!process.stdout.write(block)) await new Promise((resolve) => process.stdout.once('drain', resolve))\n  }\n}\nif (process.env.CHECK_CHANGED_HANG === '1') {\n  spawn(process.execPath, ['worker.js'], { cwd: process.cwd(), stdio: 'ignore' })\n  for (let attempt = 0; attempt < 250; attempt++) {\n    if (await readFile(${JSON.stringify(ready)}, 'utf8').catch(() => '')) break\n    await new Promise((resolve) => setTimeout(resolve, 20))\n  }\n  setInterval(() => {}, 1000)\n}\n`,
      { mode: 0o755 }
    )
  }

  if (options.hook) {
    const hookPath = path.join(directory, 'process-hook.cjs')
    const recordTerm = options.hook === 'record-term'
    await writeFile(
      hookPath,
      `const original = process.kill.bind(process)\nlet killedGroup = null\nprocess.kill = (pid, signal) => {\n  if (pid < 0 && signal === 'SIGTERM') require('node:fs').writeFileSync(${JSON.stringify(termSent)}, 'yes')\n  if (pid < 0 && signal === 'SIGKILL') { killedGroup = pid; return original(pid, signal) }\n  if (${recordTerm ? 'false' : 'true'} && pid === killedGroup && signal === 0) return true\n  return original(pid, signal)\n}\n`
    )
  }

  await chmod(directory, 0o755)
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${supportBin}`,
  }
  delete environment.CHECK_CHANGED_HANG
  delete environment.CHECK_CHANGED_FLOOD
  if (options.command === 'hang') environment.CHECK_CHANGED_HANG = '1'
  if (options.hook) {
    environment.NODE_OPTIONS =
      `${environment.NODE_OPTIONS ?? ''} --require=${path.join(directory, 'process-hook.cjs')}`.trim()
  }
  return { directory, root, bin, log, ready, termSent, base, environment }
}

/** Start the runner in its own process group and own it, and anything it starts, from now on. */
function launch(
  fixture: Fixture,
  cleanup: (callback: () => void | Promise<void>) => void
): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      '--import=@poppinss/ts-exec',
      path.join(fixture.root, 'bin/check_changed.ts'),
      '--static',
      fixture.base,
    ],
    {
      cwd: fixture.root,
      env: fixture.environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    }
  )
  cleanup(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {}
  })
  return child
}

/**
 * Wait for the hanging step's worker and own it. The runner starts each step in a process group
 * of its own, so killing the runner's group leaves the step's command and the worker running.
 */
async function ownDescendant(
  fixture: Fixture,
  cleanup: (callback: () => void | Promise<void>) => void
): Promise<number> {
  const pid = await waitForPid(fixture.ready)
  const group = Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  )
  assert.ok(Number.isSafeInteger(group) && group > 1, `worker ${pid} has no process group`)
  cleanup(() => {
    for (const target of [-group, pid]) {
      try {
        process.kill(target, 'SIGKILL')
      } catch {}
    }
  })
  return pid
}

test('runs selected static checks normally and observes a missing command spawn error', async ({
  cleanup,
}) => {
  const normal = await makeCheckProcessFixture()
  cleanup(() => rm(normal.directory, { recursive: true, force: true }))
  const normalChild = launch(normal, cleanup)
  const normalOutput = await captureChildOutput(normalChild)
  const normalResult = await collectExit(normalChild, normalOutput)
  assert.equal(normalResult.code, 0, normalResult.text)
  assert.match(normalResult.text, /pass format/)
  const normalLog = await readFile(normal.log, 'utf8')
  assert.match(normalLog, /exec prettier --check/)
  // Positive control: this is how the shim logs the steps the interrupt tests must not see.
  assert.match(normalLog, laterSteps)

  const missing = await makeCheckProcessFixture({ command: 'missing' })
  cleanup(() => rm(missing.directory, { recursive: true, force: true }))
  const missingChild = launch(missing, cleanup)
  const missingOutput = await captureChildOutput(missingChild)
  const missingResult = await collectExit(missingChild, missingOutput)
  assert.equal(missingResult.code, 1, missingResult.text)
  assert.match(missingResult.text, /spawn failed: spawn pnpm ENOENT/)
  assert.doesNotMatch(missingResult.text, /UnhandledPromiseRejection|unhandledRejection/)
}).timeout(30_000)

test('TERM-resistant descendants receive KILL, are reaped, and block later selected checks', async ({
  cleanup,
}) => {
  const fixture = await makeCheckProcessFixture({ command: 'hang' })
  cleanup(() => rm(fixture.directory, { recursive: true, force: true }))
  const child = launch(fixture, cleanup)
  const output = await captureChildOutput(child)
  const descendantPid = await ownDescendant(fixture, cleanup)
  child.kill('SIGTERM')
  const result = await collectExit(child, output)
  assert.equal(result.code, 143, result.text)
  assert.match(result.text, /fail format \(exit killed\)/)
  assert.doesNotMatch(await readFile(fixture.log, 'utf8'), laterSteps)
  assert.equal(await isAlive(descendantPid), false)
  assert.doesNotMatch(result.text, /UnhandledPromiseRejection|unhandledRejection/)
}).timeout(20_000)

test('a second signal escalates immediately while the first signal determines the exit code', async ({
  cleanup,
}) => {
  const fixture = await makeCheckProcessFixture({ command: 'hang', hook: 'record-term' })
  cleanup(() => rm(fixture.directory, { recursive: true, force: true }))
  const child = launch(fixture, cleanup)
  const output = await captureChildOutput(child)
  const descendantPid = await ownDescendant(fixture, cleanup)
  child.kill('SIGTERM')
  await waitForFile(fixture.termSent)
  child.kill('SIGINT')
  const result = await collectExit(child, output)
  assert.equal(result.code, 143, result.text)
  assert.equal(await isAlive(descendantPid), false)
  assert.doesNotMatch(await readFile(fixture.log, 'utf8'), laterSteps)
}).timeout(15_000)

test('reports failed final reap and retains the first signal result', async ({ cleanup }) => {
  const fixture = await makeCheckProcessFixture({ command: 'hang', hook: 'fail-reap' })
  cleanup(() => rm(fixture.directory, { recursive: true, force: true }))
  const child = launch(fixture, cleanup)
  const output = await captureChildOutput(child)
  await ownDescendant(fixture, cleanup)
  child.kill('SIGTERM')
  const result = await collectExit(child, output)
  assert.equal(result.code, 143, result.text)
  assert.match(result.text, /cleanup failed:.*did not exit after SIGKILL/s)
  assert.doesNotMatch(await readFile(fixture.log, 'utf8'), laterSteps)
  assert.doesNotMatch(result.text, /UnhandledPromiseRejection|unhandledRejection/)
}).timeout(20_000)

test('interrupt settles a never-closing owned child and releases its live local handles', async ({
  cleanup,
}) => {
  const fixture = await makeCheckProcessFixture()
  cleanup(() => rm(fixture.directory, { recursive: true, force: true }))
  const hook = path.join(fixture.directory, 'never-close.cjs')
  await writeFile(
    hook,
    `
const cp = require('node:child_process')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
cp.spawn = () => {
 const child = new EventEmitter(); child.pid = 99999999; child.exitCode = child.signalCode = null
 child.stdout = new PassThrough(); child.stderr = new PassThrough()
 const liveHandle = setInterval(() => {}, 1000)
 child.unref = () => { clearInterval(liveHandle); console.log('LOCAL_HANDLE_RELEASED') }
 setImmediate(() => { child.stdout.write('partial output'); process.emit('SIGTERM') })
 return child
}
process.kill = () => true
let clock = 0; Date.now = () => (clock += 6000)
require('node:module').syncBuiltinESMExports()
`
  )
  fixture.environment.NODE_OPTIONS = `${fixture.environment.NODE_OPTIONS ?? ''} --require=${hook}`
  const child = launch(fixture, cleanup)
  const output = await captureChildOutput(child)
  const result = await collectExit(child, output)
  assert.equal(result.code, 143, result.text)
  assert.match(result.text, /did not exit after SIGKILL/)
  assert.match(result.text, /partial output/)
  assert.match(result.text, /LOCAL_HANDLE_RELEASED/)
  assert.equal(await readFile(fixture.log, 'utf8'), '')
}).timeout(10_000)

test('keeps a bounded tail of a step that prints far more than the heap allows', async ({
  cleanup,
}) => {
  const fixture = await makeCheckProcessFixture()
  cleanup(() => rm(fixture.directory, { recursive: true, force: true }))
  // 256 MiB of output against a 64 MiB heap: an unbounded buffer runs out of memory.
  fixture.environment.CHECK_CHANGED_FLOOD = '256'
  fixture.environment.NODE_OPTIONS = `${fixture.environment.NODE_OPTIONS ?? ''} --max-old-space-size=64`
  const child = launch(fixture, cleanup)
  const output = await captureChildOutput(child)
  const result = await collectExit(child, output)
  assert.equal(result.code, 0, result.text.slice(-2000))
  assert.match(result.text, /pass format/)
}).timeout(60_000)

test('a step past its deadline whose group cannot be killed is abandoned and stops later checks', async ({
  cleanup,
}) => {
  const fixture = await makeCheckProcessFixture()
  cleanup(() => rm(fixture.directory, { recursive: true, force: true }))
  const hook = path.join(fixture.directory, 'never-close.cjs')
  await writeFile(
    hook,
    `
const cp = require('node:child_process')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
cp.spawn = (command, commandArguments) => {
 fs.appendFileSync(${JSON.stringify(fixture.log)}, commandArguments.join(' ') + '\\n')
 const child = new EventEmitter(); child.pid = 99999999; child.exitCode = child.signalCode = null
 child.stdout = new PassThrough(); child.stderr = new PassThrough()
 const liveHandle = setInterval(() => {}, 1000)
 child.unref = () => { clearInterval(liveHandle); console.log('LOCAL_HANDLE_RELEASED') }
 return child
}
process.kill = () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }) }
let clock = 0; Date.now = () => (clock += 6000)
require('node:module').syncBuiltinESMExports()
`
  )
  fixture.environment.NODE_OPTIONS = `${fixture.environment.NODE_OPTIONS ?? ''} --require=${hook}`
  fixture.environment.CHECK_CHANGED_STEP_LIMIT_MS = '50'
  const child = launch(fixture, cleanup)
  const output = await captureChildOutput(child)
  const result = await collectExit(child, output)
  assert.equal(result.code, 1, result.text)
  assert.match(result.text, /fail format \(exit killed\)/)
  assert.match(result.text, /cleanup failed:.*kill EPERM/s)
  assert.match(result.text, /LOCAL_HANDLE_RELEASED/)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, /^exec prettier --check/m)
  assert.doesNotMatch(log, laterSteps)
}).timeout(10_000)

for (const groupExits of [true, false]) {
  test(`a timed-out child closes before cleanup finishes (group exits: ${groupExits})`, async ({
    cleanup,
  }) => {
    const f = await makeCheckProcessFixture()
    cleanup(() => rm(f.directory, { recursive: true, force: true }))
    const hook = path.join(f.directory, 'close-during-timeout.cjs')
    await writeFile(
      hook,
      `
const cp = require('node:child_process')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const spawn = cp.spawn
const child = new EventEmitter()
child.pid = 99999999
child.stdout = new PassThrough()
child.stderr = new PassThrough()
child.unref = () => {}
let firstSpawn = true
let probes = 0
let clock = 0
Date.now = () => (clock += 6000)
cp.spawn = (...args) => {
  if (firstSpawn) { firstSpawn = false; return child }
  console.log('NEXT_STEP_AFTER_PROBES=' + probes)
  return spawn(...args)
}
process.kill = (pid, signal) => {
  if (pid !== -child.pid) throw new Error('unexpected process group')
  if (signal === 'SIGTERM') { child.emit('close', null, 'SIGTERM'); return true }
  if (signal === 'SIGKILL') return true
  if (signal !== 0) throw new Error('unexpected signal')
  ++probes
  if (!${groupExits} || probes === 1) return true
  throw Object.assign(new Error('gone'), { code: 'ESRCH' })
}
require('node:module').syncBuiltinESMExports()
`
    )
    f.environment.NODE_OPTIONS = `--require=${hook}`
    f.environment.CHECK_CHANGED_STEP_LIMIT_MS = '1000'
    const child = launch(f, cleanup)
    const output = await captureChildOutput(child)
    const result = await collectExit(child, output)
    assert.equal(result.code, 1, result.text)
    assert.match(result.text, /fail format \(exit killed\)/)
    if (groupExits) {
      assert.match(result.text, /NEXT_STEP_AFTER_PROBES=2/)
      assert.doesNotMatch(result.text, /NEXT_STEP_AFTER_PROBES=[01]/)
      assert.match(result.text, /pass lint/)
    } else {
      assert.match(result.text, /cleanup failed:[\s\S]*did not exit after SIGKILL/)
      assert.doesNotMatch(result.text, /NEXT_STEP_AFTER_PROBES/)
      assert.equal(await readFile(f.log, 'utf8'), '')
    }
  }).timeout(10_000)
}
