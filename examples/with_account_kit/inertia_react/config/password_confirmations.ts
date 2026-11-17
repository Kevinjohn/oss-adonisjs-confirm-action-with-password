import { defineConfig } from '@kevinjohn/adonisjs-confirm-action-with-password'

export default defineConfig({
  window: '5m',
  table: 'password_confirmations',
  usersTable: 'users',
  authorize: async (context, request) =>
    request.action === 'save-secure-note' && request.scope === String(context.account.id),
})
