import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import confirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main'
import { errors } from '@kevinjohn/adonisjs-confirm-action-with-password'
import { currentAccountInput } from '#services/current_account_input'

function noteRequest(userId: number | string, body: string) {
  return { action: 'save-secure-note', scope: String(userId), intent: { body } }
}

export default class SecureNotesController {
  async edit(ctx: HttpContext) {
    const userId = ctx.auth.getUserOrFail().id
    const note = await db.from('secure_notes').where('user_id', userId).first()
    const props = { body: note?.body ?? '', pending: Boolean(ctx.session.get('pendingSecureNote')) }
    return ctx.inertia.render('settings/secure_note', props)
  }

  async confirm(ctx: HttpContext) {
    const body = ctx.request.input('body')
    const password = ctx.request.input('password')
    if (
      typeof body !== 'string' ||
      body.length < 1 ||
      body.length > 500 ||
      typeof password !== 'string'
    ) {
      ctx.session.flash('error', 'Enter a note of 1 to 500 characters and your password.')
      return ctx.response.redirect().back()
    }
    const input = currentAccountInput(ctx)
    let confirmationId: string
    try {
      const issued = await confirmations.confirmPassword(input, {
        ...noteRequest(input.userId, body),
        password,
      })
      confirmationId = issued.confirmationId
    } catch (error) {
      if (error instanceof errors.PasswordConfirmationDeniedException) {
        ctx.session.flash('error', 'The password is incorrect.')
        return ctx.response.redirect().back()
      }
      if (error instanceof errors.PasswordConfirmationThrottledException) {
        ctx.session.flash('error', 'Too many attempts. Wait before trying again.')
        return ctx.response.redirect().back()
      }
      if (error instanceof errors.PasswordConfirmationStaleException) {
        ctx.session.flash('error', 'Confirmation timed out. Try again.')
        return ctx.response.redirect().back()
      }
      throw error
    }
    ctx.session.put('pendingSecureNote', { body, confirmationId })
    return ctx.response.redirect().toPath('/settings/secure-note')
  }

  async update(ctx: HttpContext) {
    const pending = ctx.session.get('pendingSecureNote') as
      { body?: unknown; confirmationId?: unknown } | undefined
    if (
      !pending ||
      typeof pending.body !== 'string' ||
      typeof pending.confirmationId !== 'string'
    ) {
      ctx.session.flash('error', 'Confirm your password again before saving.')
      return ctx.response.redirect().toPath('/settings/secure-note')
    }
    const input = currentAccountInput(ctx)
    try {
      await confirmations.withConfirmation(
        input,
        { ...noteRequest(input.userId, pending.body), confirmationId: pending.confirmationId },
        async ({ trx }) => {
          await trx
            .table('secure_notes')
            .insert({ user_id: input.userId, body: pending.body })
            .onConflict('user_id')
            .merge()
        }
      )
    } catch (error) {
      if (
        error instanceof errors.PasswordConfirmationRequiredException ||
        error instanceof errors.PasswordConfirmationStaleException
      ) {
        ctx.session.forget('pendingSecureNote')
        ctx.session.flash(
          'error',
          'Confirmation expired or was already used. Confirm your password again.'
        )
        return ctx.response.redirect().toPath('/settings/secure-note')
      }
      throw error
    }
    ctx.session.forget('pendingSecureNote')
    ctx.session.flash('success', 'Secure note saved.')
    return ctx.response.redirect().toPath('/settings/secure-note')
  }
}
