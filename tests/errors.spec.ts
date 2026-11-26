/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import type { Exception } from '@adonisjs/core/exceptions'
import {
  E_PASSWORD_CONFIRMATION_DENIED,
  E_PASSWORD_CONFIRMATION_FORBIDDEN,
  E_PASSWORD_CONFIRMATION_REQUIRED,
  E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED,
  E_PASSWORD_CONFIRMATION_STALE,
} from '../src/errors.ts'

test.group('errors', () => {
  test('fixed exceptions keep their code, status and message when a caller passes options', ({
    assert,
  }) => {
    const override = { code: 'E_OTHER', status: 200 }
    const fixedErrors = [
      E_PASSWORD_CONFIRMATION_REQUIRED,
      E_PASSWORD_CONFIRMATION_DENIED,
      E_PASSWORD_CONFIRMATION_STALE,
      E_PASSWORD_CONFIRMATION_FORBIDDEN,
      E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED,
    ]
    for (const ErrorType of fixedErrors) {
      const error: Exception = Reflect.construct(ErrorType, ['another message', override])
      assert.equal(error.code, ErrorType.code, ErrorType.name)
      assert.equal(error.status, ErrorType.status, ErrorType.name)
      assert.equal(error.message, ErrorType.message, ErrorType.name)
    }
  })
})
