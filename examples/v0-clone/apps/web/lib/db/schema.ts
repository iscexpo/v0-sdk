import { pgTable, text, timestamp, uuid, integer, jsonb, unique, index } from 'drizzle-orm/pg-core'

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  sandboxName: text('sandbox_name').notNull().unique(),
  status: text('status').notNull().default('active'),
  framework: text('framework'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.workspaceId, table.slug)])

export const chats = pgTable('chats', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull(),
  title: text('title').notNull().default('New chat'),
  status: text('status').notNull().default('idle'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('chats_project_updated_idx').on(table.projectId, table.updatedAt)])

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  chatId: uuid('chat_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('messages_chat_created_idx').on(table.chatId, table.createdAt)])

export const messageParts = pgTable('message_parts', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: uuid('message_id').notNull(),
  type: text('type').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  sequence: integer('sequence').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('message_parts_message_sequence_idx').on(table.messageId, table.sequence)])

export const sandboxes = pgTable('sandboxes', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().unique(),
  sandboxName: text('sandbox_name').notNull().unique(),
  status: text('status').notNull().default('stopped'),
  currentSessionId: text('current_session_id'),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  snapshotExpiration: timestamp('snapshot_expiration', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type Chat = typeof chats.$inferSelect
export type Message = typeof messages.$inferSelect
