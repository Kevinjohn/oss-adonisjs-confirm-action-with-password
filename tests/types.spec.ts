/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import type { ContainerBindings } from '@adonisjs/core/types'
import type { CurrentAccountInput, Trx, UserId } from '@kevinjohn/adonisjs-account-kit/types'
import {
  defineConfig,
  type AuthorizeConfirmation,
  type ConfirmationRequest,
  type ConfirmPasswordRequest,
  type ConsumeRequest,
  type IssuedConfirmation,
  type KitContext,
  type LoadConfirmationAuthorization,
  type PasswordConfirmationAuthorization,
  type PasswordConfirmations,
  type PasswordConfirmationsConfig,
  type PasswordConfirmationsDependencies,
  type ResolvedPasswordConfirmationsConfig,
} from '../index.ts'
import type passwordConfirmations from '../services/main.ts'
import type PasswordConfirmationsProvider from '../providers/password_confirmations_provider.ts'

test.group('public types', () => {
  test('services/main and container binding resolve to PasswordConfirmations', ({
    expectTypeOf,
  }) => {
    expectTypeOf<typeof passwordConfirmations>().toEqualTypeOf<PasswordConfirmations>()
    expectTypeOf<
      ContainerBindings['password_confirmations.manager']
    >().toEqualTypeOf<PasswordConfirmations>()
    expectTypeOf<PasswordConfirmationsProvider>().toHaveProperty('register')
  })

  test('defineConfig infers ResolvedPasswordConfirmationsConfig and callback signatures', ({
    expectTypeOf,
  }) => {
    const defaults = defineConfig()
    expectTypeOf(defaults).toEqualTypeOf<ResolvedPasswordConfirmationsConfig>()

    const custom = defineConfig({
      window: '3 minutes',
      throttle: false,
      readPasswordHash: async (userId, trx) => {
        expectTypeOf(userId).toEqualTypeOf<UserId>()
        expectTypeOf(trx).toEqualTypeOf<Trx>()
        return null
      },
      authorize: async (context, request) => {
        expectTypeOf(context).toEqualTypeOf<KitContext>()
        expectTypeOf(request).toEqualTypeOf<ConfirmationRequest>()
        return true
      },
    })
    expectTypeOf(custom).toEqualTypeOf<ResolvedPasswordConfirmationsConfig>()
    expectTypeOf(defineConfig).parameter(0).toEqualTypeOf<PasswordConfirmationsConfig | undefined>()
  })

  test('withConfirmation infers callback return type and types KitContext', ({ expectTypeOf }) => {
    const runWithConfirmation = (
      service: PasswordConfirmations,
      input: CurrentAccountInput,
      request: ConsumeRequest
    ) =>
      service.withConfirmation(input, request, async (context) => {
        expectTypeOf(context).toEqualTypeOf<KitContext>()
        expectTypeOf(context.trx).toEqualTypeOf<Trx>()
        expectTypeOf(context.account.id).toEqualTypeOf<UserId>()
        return { accountId: context.account.id, written: true as const }
      })

    expectTypeOf(runWithConfirmation).returns.toEqualTypeOf<
      Promise<{ accountId: UserId; written: true }>
    >()

    expectTypeOf<PasswordConfirmations['confirmPassword']>().returns.toEqualTypeOf<
      Promise<IssuedConfirmation>
    >()
    expectTypeOf<PasswordConfirmations['consume']>().returns.toEqualTypeOf<Promise<void>>()
    expectTypeOf<PasswordConfirmations['prune']>().returns.toEqualTypeOf<Promise<number>>()
  })

  test('PasswordConfirmationsDependencies, request types and authorization loader contracts', ({
    expectTypeOf,
  }) => {
    expectTypeOf<
      PasswordConfirmationsDependencies['config']
    >().toEqualTypeOf<ResolvedPasswordConfirmationsConfig>()
    expectTypeOf<PasswordConfirmationsDependencies['verifyPassword']>().toEqualTypeOf<
      (hashed: string, password: string) => Promise<boolean>
    >()
    expectTypeOf<PasswordConfirmationsDependencies['now']>().toEqualTypeOf<
      (() => number) | undefined
    >()

    expectTypeOf<ConfirmPasswordRequest>().toExtend<ConfirmationRequest>()
    expectTypeOf<ConsumeRequest>().toExtend<ConfirmationRequest>()
    expectTypeOf<AuthorizeConfirmation>().toEqualTypeOf<
      (context: KitContext, request: ConfirmationRequest) => Promise<boolean>
    >()
    expectTypeOf<PasswordConfirmationAuthorization['register']>().parameters.toEqualTypeOf<
      [load: LoadConfirmationAuthorization]
    >()
  })
})
