/**
 * Column classification for the future SpacetimeDB module.
 * This file is not a module, does not connect, and does not persist data.
 * Every column is metadata or ciphertext. There is no plaintext class.
 */

export const COLUMN_CLASSES = ["metadata", "ciphertext"] as const;

export type ColumnClass = (typeof COLUMN_CLASSES)[number];

export const SPACETIMEDB_TABLES = {
  incident_shell: {
    id: "metadata",
    status: "metadata",
    started_at: "metadata",
    sealed_brief: "ciphertext",
    integrity_status: "metadata",
    integrity_source: "metadata",
  },
  member_shell: {
    id: "metadata",
    incident_id: "metadata",
    role: "metadata",
    joined_at: "metadata",
    public_key_id: "metadata",
    integrity_status: "metadata",
    integrity_source: "metadata",
  },
  channel_shell: {
    id: "metadata",
    incident_id: "metadata",
    kind: "metadata",
    created_at: "metadata",
    sealed_topic: "ciphertext",
  },
  incident_event_shell: {
    id: "metadata",
    incident_id: "metadata",
    channel_id: "metadata",
    author_member_id: "metadata",
    created_at: "metadata",
    sealed_body: "ciphertext",
    integrity_status: "metadata",
    integrity_source: "metadata",
  },
  task_shell: {
    id: "metadata",
    incident_id: "metadata",
    status: "metadata",
    assignee_member_id: "metadata",
    due_at: "metadata",
    sealed_details: "ciphertext",
  },
  affected_asset_shell: {
    id: "metadata",
    incident_id: "metadata",
    kind: "metadata",
    sealed_descriptor: "ciphertext",
    integrity_status: "metadata",
    integrity_source: "metadata",
  },
} as const satisfies Record<string, Record<string, ColumnClass>>;

const DENIED_COLUMNS = new Set([
  "title",
  "summary",
  "body",
  "narrative",
  "description",
  "hostname",
  "private_key",
  "channel_key",
  "key_material",
  "password",
  "secret",
  "display_name",
  "plaintext",
  "message",
  "note",
]);

export function findPlaintextColumns(): string[] {
  const found: string[] = [];
  for (const [table, columns] of Object.entries(SPACETIMEDB_TABLES)) {
    for (const [column, klass] of Object.entries(columns)) {
      if (klass !== "metadata" && klass !== "ciphertext") {
        found.push(`${table}.${column}`);
      }
      if (DENIED_COLUMNS.has(column)) {
        found.push(`${table}.${column}`);
      }
    }
  }
  return found;
}
