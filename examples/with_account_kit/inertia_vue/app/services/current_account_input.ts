import type { HttpContext } from '@adonisjs/core/http'
import type { CurrentAccountInput } from '@kevinjohn/adonisjs-account-kit/types'

export function currentAccountInput(ctx: HttpContext): CurrentAccountInput {
  const revision = ctx.session.get('accountKitRevision')
  const sessionHandle = ctx.session.get('accountKitSessionHandle')
  if (revision === undefined || typeof sessionHandle !== 'string') {
    throw new Error('The current sign-in has no managed session')
  }
  return {
    userId: ctx.auth.getUserOrFail().id,
    revision: revision === '' ? null : revision,
    sessionHandle,
  }
}
