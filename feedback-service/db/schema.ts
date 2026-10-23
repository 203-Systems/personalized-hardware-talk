import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const feedback = sqliteTable('feedback', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  version: text('version').notNull(),
  slide: integer('slide').notNull(),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  author: text('author').notNull(),
  x: real('x'),
  y: real('y'),
  status: text('status').notNull().default('open'),
  editHash: text('edit_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [index('feedback_page').on(table.version, table.slide, table.createdAt), index('feedback_parent').on(table.parentId)]);

export const limits = sqliteTable('rate_limits', {
  bucket: text('bucket').primaryKey(),
  count: integer('count').notNull(),
  resetAt: integer('reset_at').notNull(),
});
