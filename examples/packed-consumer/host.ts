// This is copied into an isolated host and typechecked against the installed release candidate.
import assert from 'node:assert/strict'
import { access, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ListLoader } from '@adonisjs/core/ace'
import Configure from '@adonisjs/core/commands/configure'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { defineConfig as defineLimiterConfig, stores } from '@adonisjs/limiter'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { AccountKit, defineConfig as defineKitConfig } from '@kevinjohn/adonisjs-account-kit'
import { createSqlUsersAdapter } from '@kevinjohn/adonisjs-account-kit/adapters/sql'
import { captureNotifications } from '@kevinjohn/adonisjs-account-kit/testing/notifications'
import {
  PasswordConfirmations,
  PasswordConfirmationRequiredException,
  errors,
  defineConfig,
} from '@kevinjohn/adonisjs-confirm-action-with-password'
import type { PasswordConfirmationsDependencies as RootDependencies } from '@kevinjohn/adonisjs-confirm-action-with-password'
import type {
  ConfirmationRequest,
  IssuedConfirmation,
  PasswordConfirmationsDependencies,
} from '@kevinjohn/adonisjs-confirm-action-with-password/types'

type IsAny<T> = 0 extends 1 & T ? true : false
type AssertNotAny<T extends false> = T

const [name, version, compiler] = process.argv.slice(2)
const root = import.meta.dirname
const withinHost = `${await realpath(join(root, 'node_modules'))}${sep}`
// Check real paths, not merely symlink spellings, before exercising the installed package.
for (const specifier of [
  name,
  `${name}/types`,
  `${name}/password_confirmations_provider`,
  `${name}/services/main`,
  '@adonisjs/core',
  '@adonisjs/assembler',
  '@adonisjs/lucid',
  '@adonisjs/session',
  '@adonisjs/limiter',
  '@kevinjohn/adonisjs-account-kit',
  'typescript',
  'better-sqlite3',
  '@vinejs/vine',
  'luxon',
]) {
  assert.ok(
    (await realpath(fileURLToPath(import.meta.resolve(specifier)))).startsWith(withinHost),
    `outside packed host: ${specifier}`
  )
}
const installed = JSON.parse(
  await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')
)
assert.equal(installed.name, name)
assert.equal(installed.version, version)
assert.equal(
  JSON.parse(await readFile(join(root, 'node_modules/typescript/package.json'), 'utf8')).version,
  compiler
)
const main = await import(name)
await import(`${name}/types`)
await import(`${name}/password_confirmations_provider`)
for (const exportName of [
  'configure',
  'defineConfig',
  'PasswordConfirmations',
  'errors',
  'stubsRoot',
]) {
  assert.ok(exportName in main, `packed entry is missing ${exportName}`)
}
for (const stub of [
  'config/password_confirmations.stub',
  'migrations/create_password_confirmations_table.stub',
]) {
  await access(join(main.stubsRoot, stub))
}
assert.equal(errors.E_PASSWORD_CONFIRMATION_REQUIRED, PasswordConfirmationRequiredException)

await mkdir(join(root, 'database/migrations'), { recursive: true })
await mkdir(join(root, 'start'))
await writeFile(
  join(root, 'adonisrc.ts'),
  `import { defineConfig } from '@adonisjs/core/app'\nexport default defineConfig({ providers: [], commands: [] })\n`
)
await writeFile(
  join(root, 'start/env.ts'),
  `import { Env } from '@adonisjs/core/env'\nexport default await Env.create(new URL('../', import.meta.url), {})\n`
)
await writeFile(
  join(root, 'database/migrations/0000000000000_create_users_table.ts'),
  `import { BaseSchema } from '@adonisjs/lucid/schema'
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('users', (table) => {
      table.increments('id')
      table.string('email', 254).notNullable().unique()
      table.string('password').notNullable()
    })
    this.schema.createTable('effects', (table) => { table.increments('id'); table.string('label').notNullable() })
  }
}
`
)
const appRoot = new URL('./', import.meta.url)
const ignitor = new IgnitorFactory()
  .withCoreProviders()
  .withCoreConfig()
  .merge({
    rcFileContents: { providers: [], commands: [async () => new ListLoader([Configure])] },
  })
  .create(appRoot, { importer: (specifier) => import(specifier) })
await ignitor.ace().handle(['configure', '@kevinjohn/adonisjs-account-kit'])
assert.ok(!process.exitCode, 'Account Kit configure failed')
await ignitor.ace().handle(['configure', name])
assert.ok(!process.exitCode, 'Password Confirmations configure failed')
const migrationNames = await readdir(join(root, 'database/migrations'))
const kitMigration = migrationNames.find((file) =>
  file.endsWith('_account_kit_create_account_sessions.ts')
)
const migration = migrationNames.find((file) =>
  file.endsWith('_create_password_confirmations_table.ts')
)
assert.ok(kitMigration && migration && migration > kitMigration)
const rc = await readFile(join(root, 'adonisrc.ts'), 'utf8')
assert.match(rc, /adonisjs-confirm-action-with-password\/password_confirmations_provider/)
const { default: generatedRc } = await import('./adonisrc.js')
const { default: generatedConfig } = await import('./config/password_confirmations.js')
const mail = captureNotifications()
const app = new IgnitorFactory()
  .withCoreProviders()
  .withCoreConfig()
  .merge({
    rcFileContents: {
      providers: [
        () => import('@adonisjs/lucid/database_provider'),
        () => import('@adonisjs/limiter/limiter_provider'),
        ...(generatedRc.providers ?? []),
      ],
    },
    config: {
      database: {
        connection: 'sqlite',
        connections: {
          sqlite: {
            client: 'better-sqlite3',
            connection: { filename: join(root, 'db.sqlite3') },
            useNullAsDefault: true,
            migrations: { paths: ['database/migrations'] },
          },
        },
      },
      limiter: defineLimiterConfig({ default: 'memory', stores: { memory: stores.memory({}) } }),
      account_kit: defineKitConfig({
        users: createSqlUsersAdapter({ table: 'users' }),
        enabled: ['sessionManagement'],
        urls: {},
        notify: mail.notify,
        limiterSecret: 'a'.repeat(40),
        registration: { availability: 'closed' },
        authentication: { strategy: 'session', guard: 'web' },
        sessionManagement: {},
        minRequestMs: 0,
      }),
      password_confirmations: generatedConfig,
    },
  })
  .create(appRoot, { importer: (specifier) => import(specifier) })
  .createApp('test')
await app.init()
await app.boot()
try {
  const db = await app.container.make('lucid.db')
  const migrator = new MigrationRunner(db, app, { direction: 'up', dryRun: false })
  await migrator.run()
  if (migrator.error) throw migrator.error
  const kit = await app.container.make(AccountKit)
  const hash = await app.container.make('hash')
  const limiter = await app.container.make('limiter.manager')
  const service = await app.container.make('password_confirmations')
  const { default: publicService } =
    await import('@kevinjohn/adonisjs-confirm-action-with-password/services/main')
  type ServiceIsTyped = AssertNotAny<IsAny<typeof publicService>>
  type ContainerServiceIsTyped = AssertNotAny<IsAny<typeof service>>
  type DependencyConfigIsTyped = AssertNotAny<IsAny<PasswordConfirmationsDependencies['config']>>
  assert.ok(service instanceof PasswordConfirmations)
  assert.equal(service, publicService)
  assert.equal(service, await app.container.make(PasswordConfirmations))
  assert.equal(service.windowMs, generatedConfig.windowMs)

  // Exercise the exported dependency types and an inferred callback result in each compiler lane.
  const dependencies: PasswordConfirmationsDependencies = {
    kit,
    db,
    limiter,
    config: defineConfig(),
    verifyPassword: (hashed, password) => hash.verify(hashed, password),
  }
  const legacyDependencies: RootDependencies = dependencies
  assert.ok(new PasswordConfirmations(legacyDependencies) instanceof PasswordConfirmations)
  const password = 'packed-host-test-password-71'
  const email = 'packed-host@example.test'
  await db
    .table('users')
    .insert({ email, password: await hash.make(password), email_verified_at: new Date() })
  const { credential: input } = await kit.authentication.login(
    { email, password, clientKey: 'packed-host' },
    {
      strategy: 'session',
      name: 'web',
      async establish(userId, revision, handle) {
        return { userId: String(userId), revision, sessionHandle: handle! }
      },
      async terminate() {},
    }
  )
  const request: ConfirmationRequest = {
    action: 'write',
    scope: 'example',
    intent: { label: 'packed' },
  }
  const issued: IssuedConfirmation = await publicService.confirmPassword(input, {
    ...request,
    password,
  })
  const consumeRequest = { ...request, confirmationId: issued.confirmationId }
  const result = await publicService.withConfirmation(
    input,
    consumeRequest,
    async ({ trx, account }) => {
      type TransactionIsTyped = AssertNotAny<IsAny<typeof trx>>
      type AccountIdIsTyped = AssertNotAny<IsAny<typeof account.id>>
      await trx.table('effects').insert({ label: 'packed' })
      return { accountId: account.id, written: true as const }
    }
  )
  type ResultIsTyped = AssertNotAny<IsAny<typeof result>>
  const written: true = result.written
  assert.ok(written)
  assert.equal(String(result.accountId), String(input.userId))
  await assert.rejects(
    () =>
      publicService.withConfirmation(input, consumeRequest, async () => {
        throw new Error('replayed callback must never run')
      }),
    errors.E_PASSWORD_CONFIRMATION_REQUIRED
  )
  assert.equal((await db.from('effects')).length, 1)
  console.log('packed layout, configure, migrations, service identity, issue and single spend ok')
} finally {
  await app.terminate()
}
