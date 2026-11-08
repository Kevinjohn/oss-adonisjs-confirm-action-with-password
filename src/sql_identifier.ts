/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

/** A plain SQL identifier: letters, digits and underscores, not starting with a digit. */
export function isSqlIdentifier(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}
