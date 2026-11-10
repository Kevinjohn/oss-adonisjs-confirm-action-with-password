/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ListLoader } from '@adonisjs/core/ace'
import Configure from '@adonisjs/core/commands/configure'
import { IgnitorFactory } from '@adonisjs/core/factories'
import type { ApplicationService } from '@adonisjs/core/types'
import type { Database } from '@adonisjs/lucid/database'
import { AccountKit, defineConfig as defineKitConfig } from '@kevinjohn/adonisjs-account-kit'
import { createSqlUsersAdapter } from '@kevinjohn/adonisjs-account-kit/adapters/sql'
import { captureNotifications } from '@kevinjohn/adonisjs-account-kit/testing/notifications'
import { defineConfig as defineLimiterConfig, stores } from '@adonisjs/limiter'
import { PasswordConfirmations } from '../src/password_confirmations.js'
import { defineConfig } from '../src/define_config.js'
import type { PasswordConfirmationsConfig } from '../src/types.js'

const packageRoot = new URL('../', import.meta.url)
const self = '@kevinjohn/adonisjs-confirm-action-with-password'

/** Resolves this package's own specifiers to source, everything else normally. */
const importer = (specifier: string) => {
  if (specifier === self) return import(new URL('index.ts', packageRoot).href)
  if (specifier.startsWith(`${self}/`)) {
    const path = specifier.slice(self.length + 1)
    const file = path === 'password_confirmations_provider' ? `providers/${path}.ts` : `${path}.ts`
    return import(new URL(file, packageRoot).href)
  }
  return import(specifier)
}

const usersMigration = `import { BaseSchema } from '@adonisjs/lucid/schema'
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('users', (table) => {
      table.increments('id')
      table.string('email', 254).notNullable().unique()
      table.string('password').notNullable()
      // Host restriction state for Account Kit's changeRestriction and canAccess.
      table.boolean('restricted').notNullable().defaultTo(false)
    })
    // Stand-in for the product write a confirmation authorizes.
    // Account Kit's access-token table, for the token-strategy fixture.
    this.schema.createTable('auth_access_tokens', (table) => {
      table.increments('id')
      table.integer('tokenable_id').notNullable()
    })
    this.schema.createTable('effects', (table) => {
      table.increments('id')
      table.string('label').notNullable()
    })
  }
}
`

/** A fresh AdonisJS app root with a users migration, then both packages' `node ace configure`. */
export async function configuredAppRoot(hostProfile = false) {
  const root = await mkdtemp(join(tmpdir(), 'adonisjs-confirm-action-with-password-'))
  await writeFile(
    join(root, 'package.json'),
    '{"type":"module","devDependencies":{"@adonisjs/assembler":"8.6.0"}}'
  )
  await writeFile(join(root, 'tsconfig.json'), '{}')
  await writeFile(
    join(root, 'adonisrc.ts'),
    `import { defineConfig } from '@adonisjs/core/app'\nexport default defineConfig({ providers: [], commands: [] })\n`
  )
  await mkdir(join(root, 'database/migrations'), { recursive: true })
  await mkdir(join(root, 'start'))
  await writeFile(
    join(root, 'start/env.ts'),
    `import { Env } from '@adonisjs/core/env'\nexport default await Env.create(new URL('../', import.meta.url), {})\n`
  )
  await writeFile(
    join(root, 'database/migrations/0000000000000_create_users_table.ts'),
    hostProfile
      ? usersMigration.replace("table.increments('id')", "table.string('id').primary()")
      : usersMigration
  )
  await symlink(fileURLToPath(new URL('node_modules', packageRoot)), join(root, 'node_modules'))

  const ignitor = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: { providers: [], commands: [async () => new ListLoader([Configure])] },
    })
    .create(pathToFileURL(`${root}/`), { importer })
  const idFlags = hostProfile ? ['--user-id-type=string'] : []
  await ignitor.ace().handle(['configure', '@kevinjohn/adonisjs-account-kit', ...idFlags])
  await ignitor.ace().handle(['configure', self, ...idFlags])
  if (hostProfile) {
    const migrations = join(root, 'database/migrations')
    await writeFile(
      join(migrations, '0000000000001_create_host_tables.ts'),
      `import { BaseSchema } from '@adonisjs/lucid/schema'
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('accounts', (table) => { table.string('id').primary() })
    this.schema.createTable('rate_limits', (table) => {
      table.string('key', 255).notNullable().primary()
      table.integer('points', 9).notNullable().defaultTo(0)
      table.bigint('expire').unsigned()
    })
  }
}`
    )
    const files = await readdir(migrations)
    const confirmationFile = files.find((file) =>
      file.endsWith('_create_password_confirmations_table.ts')
    )!
    const confirmationPath = join(migrations, confirmationFile)
    const migration = await readFile(confirmationPath, 'utf8')
    await writeFile(
      confirmationPath,
      migration.replace(
        "table.string('scope', 255).notNullable()",
        "table.string('scope', 255).notNullable().references('id').inTable('accounts').onDelete('CASCADE')"
      )
    )
  }
  return { root, ignitor, importer }
}

/** The error code a call rejects with, or 'resolved'. */
export const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error) => (error.code as string) ?? String(error)
  )

/** A guard port standing in for the session guard: `establish` returns what a cookie session holds. */
export function fakeSessionGuard() {
  return {
    strategy: 'session' as const,
    name: 'web',
    async establish(userId: string | number, revision: string | null, handle?: string) {
      return { userId: String(userId), revision, sessionHandle: handle! }
    },
    async terminate() {},
  }
}

const anyUrl = new Proxy({}, { get: () => (token: string) => `http://localhost/${token}` })

export interface Fixture {
  app: ApplicationService
  db: Database
  kit: AccountKit
  root: string
  /** Builds an `PasswordConfirmations` on the booted app with a movable clock. */
  confirmations(config?: PasswordConfirmationsConfig): PasswordConfirmations
  clock: { now: number }
  /** Account Kit notifications captured in place of mail: read tokens with `tokenFor`. */
  mail: ReturnType<typeof captureNotifications>
  createUser(email: string, password: string): Promise<number | string>
  login(
    email: string,
    password: string
  ): Promise<{ userId: string; revision: string | null; sessionHandle: string }>
  close(): Promise<void>
}

/** Boots a real AdonisJS app with Lucid, the limiter, Account Kit 0.3.4 and this package. */
export async function bootFixture(
  options: { strategy?: 'session' | 'access_tokens'; hostProfile?: boolean } = {}
): Promise<Fixture> {
  const tokens = options.strategy === 'access_tokens'
  const { root } = await configuredAppRoot(options.hostProfile)
  const mail = captureNotifications()
  const ignitor = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: {
        providers: [
          () => import('@adonisjs/lucid/database_provider'),
          () => import('@adonisjs/limiter/limiter_provider'),
          () => import('@kevinjohn/adonisjs-account-kit/account_kit_provider'),
          () => importer(`${self}/password_confirmations_provider`),
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
              ...(options.hostProfile
                ? {
                    pool: {
                      min: 1,
                      max: 1,
                      acquireTimeoutMillis: 5000,
                      afterCreate(
                        connection: { pragma: (sql: string) => void },
                        done: (error: Error | null, connection: unknown) => void
                      ) {
                        connection.pragma('foreign_keys = ON')
                        connection.pragma('journal_mode = WAL')
                        connection.pragma('busy_timeout = 1000')
                        done(null, connection)
                      },
                    },
                  }
                : {}),
              migrations: { paths: ['database/migrations'] },
            },
          },
        },
        limiter: options.hostProfile
          ? defineLimiterConfig({
              default: 'database',
              stores: { database: stores.database({ tableName: 'rate_limits' }) },
            })
          : defineLimiterConfig({ default: 'memory', stores: { memory: stores.memory({}) } }),
        account_kit: defineKitConfig({
          users: createSqlUsersAdapter({ table: 'users' }),
          enabled: [
            'passwordReset',
            'emailVerification',
            'emailPasswordManagement',
            ...(tokens ? [] : (['sessionManagement'] as const)),
            'accountDeletion',
          ],
          urls: anyUrl,
          notify: mail.notify,
          limiterSecret: 'a'.repeat(40),
          registration: { availability: 'closed' },
          authentication: {
            strategy: tokens ? 'access_tokens' : 'session',
            guard: tokens ? 'api' : 'web',
            canAccess: async (user, trx) => {
              const row = await trx.from('users').select('restricted').where('id', user.id).first()
              return !row?.restricted
            },
          },
          ...(tokens ? {} : { sessionManagement: {} }),
          minRequestMs: 0,
        }),
        password_confirmations: defineConfig(),
      },
    })
    .create(pathToFileURL(`${root}/`), { importer })
  const app = ignitor.createApp('test')
  await app.init()
  await app.boot()
  const db = await app.container.make('lucid.db')
  const { MigrationRunner } = await import('@adonisjs/lucid/migration')
  const migrator = new MigrationRunner(db, app, { direction: 'up', dryRun: false })
  await migrator.run()
  if (migrator.error) throw migrator.error
  const kit = await app.container.make(AccountKit)
  const hash = await app.container.make('hash')
  const limiter = await app.container.make('limiter.manager')
  const clock = { now: Date.now() }

  return {
    app,
    db,
    kit,
    root,
    clock,
    mail,
    confirmations: (config = {}) =>
      new PasswordConfirmations({
        kit,
        db,
        limiter,
        config: defineConfig(config),
        verifyPassword: (hashed, password) => hash.verify(hashed, password),
        now: () => clock.now,
      }),
    async createUser(email, password) {
      const userId = options.hostProfile ? randomUUID() : undefined
      const [id] = await db
        .table('users')
        .insert({
          ...(userId ? { id: userId } : {}),
          email,
          password: await hash.make(password),
          email_verified_at: new Date(),
        })
        .returning('id')
      const value = typeof id === 'object' ? id.id : id
      return userId ?? Number(value)
    },
    async login(email, password) {
      const { credential } = await kit.authentication.login(
        { email, password, clientKey: 'test-client' },
        fakeSessionGuard()
      )
      return credential
    },
    async close() {
      await app.terminate()
      await rm(root, { recursive: true, force: true })
    },
  }
}
