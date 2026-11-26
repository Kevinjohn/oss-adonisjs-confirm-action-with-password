/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import { buildConfirmationBinding } from '../src/intent_hash.ts'

const hashIntent = (intent: unknown, operation = 'a', scope = 's') =>
  buildConfirmationBinding({ operation, scope, intent }).intentHash

test.group('buildConfirmationBinding', () => {
  test('key order does not matter; values, array order, operation and scope do', ({ assert }) => {
    assert.equal(hashIntent({ a: 1, b: [1, 2] }), hashIntent({ b: [1, 2], a: 1 }))
    assert.notEqual(hashIntent({ a: 1 }), hashIntent({ a: '1' }))
    assert.notEqual(hashIntent([1, 2]), hashIntent([2, 1]))
    assert.notEqual(hashIntent({}, 'a'), hashIntent({}, 'b'))
    assert.notEqual(hashIntent({}, 'a', 's'), hashIntent({}, 'a', 't'))
    assert.equal(hashIntent({ n: null, t: true }), hashIntent(JSON.parse('{"t":true,"n":null}')))
  })

  test('arrays, objects with index keys, -0 and unsafe integers never collide', ({ assert }) => {
    assert.notEqual(hashIntent([1, 2]), hashIntent({ 0: 1, 1: 2 }))
    assert.notEqual(hashIntent({ list: ['a'] }), hashIntent({ list: { 0: 'a' } }))
    // Pinned choice: -0 === 0, so an operation cannot distinguish them with ===; same hash, same confirmation.
    assert.equal(hashIntent({ n: -0 }), hashIntent({ n: 0 }))
    for (const unsafe of [2 ** 53, -(2 ** 53), 2 ** 53 + 2, 1e21]) {
      assert.throws(() => hashIntent({ n: unsafe }), /unsafe integer/)
    }
    assert.equal(hashIntent({ n: 2 ** 53 - 1 }), hashIntent({ n: Number.MAX_SAFE_INTEGER }))
    assert.notEqual(hashIntent({ n: 0.1 }), hashIntent({ n: 0.10000000000000002 }))
  })

  test('__proto__ is an ordinary own key', ({ assert }) => {
    const withProto = JSON.parse('{"__proto__":{"admin":true},"x":1}')
    assert.notEqual(hashIntent(withProto), hashIntent({ x: 1 }))
    assert.equal(
      hashIntent(withProto),
      hashIntent(JSON.parse('{"x":1,"__proto__":{"admin":true}}'))
    )
    assert.equal(hashIntent(Object.create(null)), hashIntent({}))
  })

  test('refuses values JSON cannot round-trip', ({ assert }) => {
    for (const intent of [
      { at: new Date(0) },
      { n: Number.NaN },
      { n: Infinity },
      { f: () => 1 },
      { u: undefined },
      undefined,
      { big: 1n },
      Array(1),
      Object.assign(Array(3), [1], { 2: 3 }),
    ]) {
      assert.throws(() => hashIntent(intent), /Invalid password confirmation request/)
    }
    let deep: unknown = 1
    for (let i = 0; i < 40; i++) deep = [deep]
    assert.throws(() => hashIntent(deep), /nested too deeply/)
  })

  test('requires short non-empty operation and scope strings', ({ assert }) => {
    assert.throws(() => hashIntent({}, ''), /operation must be/)
    assert.throws(() => hashIntent({}, 'a', 'x'.repeat(256)), /scope must be/)
    assert.throws(() =>
      buildConfirmationBinding({ operation: 1 as unknown as string, scope: 's', intent: {} })
    )
  })
})
