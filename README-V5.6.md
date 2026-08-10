# BlockHost V5.6

V5.6 adds a PostgreSQL persistence layer while preserving the existing JSON data format as a rollback-safe compatibility layer.

### Recommended production topology

- Render: BlockHost Web Service / API
- Managed PostgreSQL: persistent customer, billing, server, ticket and security data
- Minecraft nodes: Linux VPS with Docker + Node Agent

### Important

Set `DATABASE_URL` only as a server environment variable. Never expose it to frontend code or commit it to Git.
