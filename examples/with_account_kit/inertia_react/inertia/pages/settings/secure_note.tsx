import AppLayout from '~/layouts/app'
import SettingsLayout from '~/layouts/settings'
import Section from '~/components/section'
import { Form } from '@adonisjs/inertia/react'

export default function SecureNote({ body, pending }: { body: string; pending: boolean }) {
  return (
    <Section title="Secure note" description="Save a note after confirming your current password.">
      <p>Saved note: {body}</p>
      <Form method="post" action="/settings/secure-note/confirm">
        {({ processing }) => (
          <div className="auth__form">
            <label htmlFor="body">New note</label>
            <input id="body" name="body" maxLength={500} required />
            <label htmlFor="password">Current password</label>
            <input id="password" name="password" type="password" required />
            <button type="submit" disabled={processing}>
              Confirm password
            </button>
          </div>
        )}
      </Form>
      {pending && (
        <Form method="post" action="/settings/secure-note">
          {({ processing }) => (
            <button type="submit" disabled={processing}>
              Save confirmed note
            </button>
          )}
        </Form>
      )}
    </Section>
  )
}
SecureNote.layout = [AppLayout, SettingsLayout]
