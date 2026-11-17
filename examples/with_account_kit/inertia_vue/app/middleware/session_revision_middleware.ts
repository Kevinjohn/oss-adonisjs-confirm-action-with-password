import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import kit from '@kevinjohn/adonisjs-account-kit/services/main'
import { InvalidSessionError } from '@kevinjohn/adonisjs-account-kit'
import { accountKitSessionGuard } from '#services/session_guard'
import { currentAccountInput } from '#services/current_account_input'

/**
 * Signs out a session that started before the latest password change or reset. Runs after the
 * silent auth middleware, so public pages then see no user, and the auth middleware sends
 * protected requests to the login page.
 */
export default class SessionRevisionMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (ctx.auth.isAuthenticated) {
      try {
        await kit.authentication.current(await currentAccountInput(ctx))
      } catch (error) {
        if (!(error instanceof InvalidSessionError)) throw error
        await accountKitSessionGuard(ctx).terminate()
      }
    }

    return next()
  }
}
