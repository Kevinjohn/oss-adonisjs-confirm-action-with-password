/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'

test('README installs the release archive for the current package version', async ({ assert }) => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const readme = await readFile('README.md', 'utf8')
  const archive = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`
  const installs = [...readme.matchAll(/releases\/download\/(v[^/\s]+)\/(\S+\.tgz)/g)]

  assert.isAbove(installs.length, 0)
  for (const [, tag, file] of installs) {
    assert.equal(tag, `v${manifest.version}`)
    assert.equal(file, archive)
  }
})

test('README links resolve from the packed archive or name this release', async ({ assert }) => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const readme = await readFile('README.md', 'utf8')
  // What the archive holds beside the README: package.json `files` plus what pnpm always packs.
  const packed = ['build/', 'CHANGELOG.md', 'LICENSE', 'package.json']
  const relative = [...readme.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)].map(([, target]) => target)
  for (const target of relative) {
    assert.isTrue(
      packed.some((entry) => target === entry || (entry.endsWith('/') && target.startsWith(entry))),
      `${target} is not in the archive; link the tagged repository file instead`
    )
  }
  const tagged = [...readme.matchAll(/\/blob\/([^/\s]+)\//g)].map(([, tag]) => tag)
  assert.isAbove(tagged.length, 0)
  for (const tag of tagged) assert.equal(tag, `v${manifest.version}`)
})
