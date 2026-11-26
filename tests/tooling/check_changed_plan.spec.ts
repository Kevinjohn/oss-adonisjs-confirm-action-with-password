import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import {
  countExecutedTests,
  planChangedChecks,
  type ChangedFile,
  type PlannedCheckStep,
} from '../../bin/check_changed_plan.ts'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const makeChangedPaths = (...paths: string[]): ChangedFile[] =>
  paths.map((path) => ({ path, deleted: false }))

function listRunnableSteps(plan: PlannedCheckStep[]): Record<string, string[]> {
  return Object.fromEntries(
    plan.flatMap((step) => ('command' in step ? [[step.label, step.command]] : []))
  )
}

test('a changed spec runs on its own and requires executed tests', ({ assert }) => {
  const plan = planChangedChecks(makeChangedPaths('tests/password_confirmations.spec.ts'))
  const tests = plan.find((step) => step.label === 'tests')

  assert.deepEqual(Object.keys(listRunnableSteps(plan)), ['format', 'lint', 'typecheck', 'tests'])
  assert.deepInclude(tests, {
    command: ['pnpm', 'quick:test', '--files=tests/password_confirmations.spec.ts'],
    countsTests: true,
    requiresTests: true,
  })
})

test('package source and manifests run the suite and build', ({ assert }) => {
  for (const path of ['src/password_confirmations.ts', 'package.json', 'pnpm-lock.yaml']) {
    const commands = listRunnableSteps(
      planChangedChecks(makeChangedPaths(path, 'tests/password_confirmations.spec.ts'))
    )
    assert.deepEqual(commands.tests, ['pnpm', 'quick:test'], path)
    assert.deepEqual(commands.build, ['pnpm', 'build'], path)
  }
})

test('files the specs read run the full suite without building the package', ({ assert }) => {
  for (const path of [
    'tests/helpers.ts',
    'CHANGELOG.md',
    '.github/workflows/checks.yml',
    'user-stories/US-CONFIRM-01-issue-confirmation.md',
  ]) {
    const commands = listRunnableSteps(planChangedChecks(makeChangedPaths(path)))
    assert.deepEqual(commands.tests, ['pnpm', 'quick:test'], path)
    assert.notProperty(commands, 'build', path)
  }
})

test('lockfile and workspace changes run lint and typecheck', ({ assert }) => {
  for (const path of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    assert.properties(
      listRunnableSteps(planChangedChecks(makeChangedPaths(path))),
      ['lint', 'typecheck'],
      path
    )
  }
})

test('deleted files select checks but are never passed to tools', ({ assert }) => {
  const commands = listRunnableSteps(
    planChangedChecks([
      { path: 'src/old_module.ts', deleted: true },
      { path: 'tests/old_module.spec.ts', deleted: true },
    ])
  )

  assert.notProperty(commands, 'format')
  assert.deepEqual(commands.typecheck, ['pnpm', 'typecheck'])
  assert.deepEqual(commands.tests, ['pnpm', 'quick:test'])
  assert.notInclude(commands.lint.join(' '), 'old_module')
  assert.deepEqual(
    listRunnableSteps(planChangedChecks([{ path: 'tests/old_module.spec.ts', deleted: true }]))
      .tests,
    ['pnpm', 'quick:test']
  )
})

test('formats only existing files and leaves the lockfile to pnpm', ({ assert }) => {
  const commands = listRunnableSteps(
    planChangedChecks(makeChangedPaths('README.md', 'pnpm-lock.yaml'))
  )

  assert.deepEqual(commands.format.slice(-1), ['README.md'])
  assert.include(commands.format, '--ignore-unknown')
  assert.include(commands.format, '--no-error-on-unmatched-pattern')
})

test('Prettier checks a leading-dash filename as a literal path', async ({ assert, cleanup }) => {
  const root = await mkdtemp(join(tmpdir(), 'confirm-format-'))
  cleanup(() => rm(root, { recursive: true, force: true }))
  const file = '--sample.ts'
  const command = listRunnableSteps(planChangedChecks(makeChangedPaths(file))).format
  const run = () =>
    spawnSync(
      process.execPath,
      [join(repoRoot, 'node_modules/prettier/bin/prettier.cjs'), ...command.slice(3)],
      { cwd: root, encoding: 'utf8' }
    )
  await writeFile(join(root, file), 'const value=  1')
  const failure = run()
  assert.equal(failure.status, 1, failure.stderr)
  assert.include(failure.stderr, file)
  await writeFile(join(root, file), 'const value = 1;\n')
  const success = run()
  assert.equal(success.status, 0, success.stderr)
  assert.deepEqual(command.slice(-2), ['--', file])
})

test('formatter configuration checks the whole tree', ({ assert }) => {
  for (const path of ['.prettierignore', '.editorconfig', 'package.json'])
    assert.deepEqual(
      listRunnableSteps(planChangedChecks(makeChangedPaths(path))).format,
      ['pnpm', 'format:check'],
      path
    )
})

test('a change to the stub root module selects lint, typecheck and build', ({ assert }) => {
  const steps = listRunnableSteps(planChangedChecks(makeChangedPaths('stubs/main.ts')))
  assert.property(steps, 'lint')
  assert.property(steps, 'typecheck')
  assert.property(steps, 'build')
})

test('lint allows no warnings and skips files ESLint ignores', async ({ assert }) => {
  assert.deepEqual(
    listRunnableSteps(planChangedChecks(makeChangedPaths('services/main.ts'))).lint,
    ['pnpm', 'lint']
  )
  // The repository's own lint script carries the zero-warning limit for every caller.
  const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  assert.include(manifest.scripts.lint, '--max-warnings 0')
  assert.notProperty(
    listRunnableSteps(
      planChangedChecks(makeChangedPaths('tests/fixtures/packed_consumer/host.ts'))
    ),
    'lint'
  )
})

test('--static names each selected suite in a skip line instead of running it', ({ assert }) => {
  const plan = planChangedChecks(
    makeChangedPaths('src/password_confirmations.ts', 'package.json', 'CHANGELOG.md'),
    {
      static: true,
    }
  )

  assert.deepEqual(Object.keys(listRunnableSteps(plan)), ['format', 'lint', 'typecheck'])
  for (const [label, skip] of [
    ['test suite', '--static leaves out pnpm quick:test'],
    ['build', '--static leaves out pnpm build'],
  ])
    assert.deepInclude(plan, { label, skip })
})

test('--static still runs the changed specs on their own', ({ assert }) => {
  const plan = planChangedChecks(
    makeChangedPaths('src/password_confirmations.ts', 'tests/password_confirmations.spec.ts'),
    {
      static: true,
    }
  )

  assert.deepEqual(listRunnableSteps(plan).tests, [
    'pnpm',
    'quick:test',
    '--files=tests/password_confirmations.spec.ts',
  ])
  assert.deepInclude(plan, { label: 'test suite', skip: '--static leaves out pnpm quick:test' })
  assert.deepInclude(
    planChangedChecks(makeChangedPaths('src/password_confirmations.ts'), { static: true }),
    {
      label: 'tests',
      skip: 'no test files changed',
    }
  )
})

test('--static plans a spec-only change exactly as the default does', ({ assert }) => {
  assert.deepEqual(
    planChangedChecks(makeChangedPaths('tests/password_confirmations.spec.ts'), { static: true }),
    planChangedChecks(makeChangedPaths('tests/password_confirmations.spec.ts'))
  )
})

test('counts executed tests from the Japa summary', ({ assert }) => {
  assert.equal(countExecutedTests('\u001b[2mTests\u001b[22m  335 passed, 2 skipped (337)'), 335)
  assert.equal(countExecutedTests('Tests  14 passed, 1 failed (15)'), 15)
  assert.equal(countExecutedTests('Tests  1 regression (1)'), 1)
  assert.equal(countExecutedTests('Tests  2 passed, 1 regression, 3 skipped (6)'), 3)
  assert.equal(countExecutedTests(' NO TESTS EXECUTED '), 0)
})

test('the package script runs the check:changed entry point', async ({ assert }) => {
  const scripts = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')).scripts

  assert.equal(
    scripts['check:changed'],
    'node --import=@poppinss/ts-exec --enable-source-maps bin/check_changed.ts'
  )
})
