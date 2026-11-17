import type { HttpContext } from '@adonisjs/core/http'
import { createManagedGuard } from '@kevinjohn/adonisjs-account-kit/http'
import User from '#models/user'

const managedGuard = createManagedGuard({
  strategy: 'session',
  name: 'web',
  loadUser: async () => User,
})

export function currentAccountInput(ctx: HttpContext) {
  return managedGuard.current(ctx)
}
