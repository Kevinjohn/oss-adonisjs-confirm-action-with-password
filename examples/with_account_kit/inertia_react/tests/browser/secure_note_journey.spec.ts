import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { setupAccountDatabase } from '#tests/helpers/account_database'

test.group('secure note confirmation', (group) => {
  group.each.setup(setupAccountDatabase)

  test('a signed-in user confirms a password before a durable note write', async ({
    visit,
    assert,
  }) => {
    const page = await visit('/signup')
    await page.getByLabel('Email').fill('note@example.test')
    await page.getByLabel('Password', { exact: true }).fill('SignupPass123!')
    await page.getByLabel('Confirm password').fill('SignupPass123!')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/dashboard')
    await page.goto('/settings/secure-note')
    await page.getByLabel('New note').fill('Remember this')
    await page.getByLabel('Current password').fill('WrongPassword!')
    const rejected = page.waitForResponse(
      (response) =>
        response.url().endsWith('/settings/secure-note/confirm') &&
        response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Confirm password' }).click()
    await rejected
    await page.getByText('The password is incorrect.').waitFor()
    const beforeSave = await db.from('secure_notes')
    assert.equal(beforeSave.length, 0)
    await page.goto('/settings/secure-note')
    await page.getByLabel('New note').fill('Remember this')
    await page.getByLabel('Current password').fill('SignupPass123!')
    await page.getByRole('button', { name: 'Confirm password' }).click()
    await page.getByRole('button', { name: 'Save confirmed note' }).click()
    await page.getByText('Saved note: Remember this').waitFor()
    const notes = await db.from('secure_notes').select('body')
    assert.equal(notes.length, 1)
    assert.equal(notes[0].body, 'Remember this')
    const [confirmation] = await db
      .from('password_confirmations')
      .select('sign_in_id', 'consumed_at')
    assert.isNumber(confirmation.sign_in_id)
    assert.isNotNull(confirmation.consumed_at)
    await page.goto('/settings/secure-note')
    assert.equal(await page.getByRole('button', { name: 'Save confirmed note' }).count(), 0)
  })
})
