# Hypermedia confirmation example

This runnable AdonisJS 7 app is derived from [Account Kit v0.4.0's hypermedia example](https://github.com/Kevinjohn/oss-adonisjs-account-kit/tree/v0.4.0/examples/hypermedia). Its account flows and presentation come from that release. The added **Secure note** journey uses Confirm Action with Password v0.2.0. Both packages are installed from their released GitHub archives, as recorded in `package.json` and `pnpm-lock.yaml`.

## Run

Use Node 24 and pnpm 11.23.0. From this directory:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm exec node ace generate:key --force
pnpm exec node ace codegen
pnpm exec node ace migration:run
pnpm dev
```

Open the printed local URL. Create an account, then open **Secure note** from account settings. Enter a note and your current password, choose **Confirm password**, then **Save confirmed note**. The note is stored in SQLite and is shown after the redirect. A confirmation is bound to the signed-in account, its managed session and the exact note; it is single use. Wrong passwords, expired confirmations and changed sessions do not authorize a write.

The app uses SQLite at `tmp/db.sqlite3`, database-backed sessions and an in-memory limiter. Keep `SESSION_DRIVER=database`. Create a unique `APP_KEY` for each deployment. Development email links are printed to the server output by the inherited Account Kit example.

## Check

```sh
pnpm exec node ace codegen
pnpm typecheck
pnpm lint
pnpm build
pnpm exec node ace test --suites browser --files tests/browser/secure_note_journey.spec.ts
```

Install Playwright Chromium first with `pnpm exec playwright install chromium` if the browser test requests it. The browser test exercises signup, password confirmation, the HTTP save and the persisted note.
