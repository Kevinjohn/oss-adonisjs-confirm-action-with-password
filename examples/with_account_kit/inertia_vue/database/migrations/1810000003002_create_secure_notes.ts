import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'secure_notes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table
        .integer('user_id')
        .unsigned()
        .primary()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('body', 500).notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
