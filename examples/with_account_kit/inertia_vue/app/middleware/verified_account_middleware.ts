import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { errors } from '@kevinjohn/adonisjs-account-kit'
import kit from '@kevinjohn/adonisjs-account-kit/services/main'
import { currentAccountInput } from '#services/current_account_input'

export default class VerifiedAccountMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    try {
      await kit.authentication.requireActive(await currentAccountInput(ctx))
    } catch (error) {
      if (!(error instanceof errors.UnverifiedEmailError)) throw error
      ctx.session.flash('error', 'Confirm your email address before opening this page.')
      return ctx.response.redirect().toRoute('dashboard')
    }

    return next()
  }
}
