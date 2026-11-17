import kit from '@kevinjohn/adonisjs-account-kit/services/main'
import type { HttpContext } from '@adonisjs/core/http'
import { updateProfileValidator } from '#validators/profile'
import { currentAccountInput } from '#services/current_account_input'

export default class ProfileController {
  async edit({ auth, inertia }: HttpContext) {
    const user = auth.getUserOrFail()
    return inertia.render('settings/profile', {
      profile: { fullName: user.fullName, email: user.email },
    })
  }

  async update(ctx: HttpContext) {
    const { auth, request, response, session } = ctx
    const { fullName, currentPassword } = await request.validateUsing(updateProfileValidator)
    const current = await currentAccountInput(ctx)
    await kit.emailPasswordManagement.updateProfile({
      actorId: auth.getUserOrFail().id,
      currentPassword,
      registrationData: { fullName },
      keepCurrent: { sessionHandle: current.sessionHandle },
    })
    session.flash('success', 'Your profile has been updated.')
    return response.redirect().toRoute('profile.edit')
  }
}
