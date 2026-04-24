import { Pool } from 'pg';
import { nanoid } from 'nanoid';
import type { AuthUser } from '@krunker-arena/shared';

export type UserRecord = AuthUser & { passwordHash: string };

export interface UserStore {
  readonly kind: 'postgres' | 'memory';
  migrate(): Promise<void>;
  ready(): Promise<void>;
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  createUser(input: { username: string; displayName: string; passwordHash: string }): Promise<UserRecord>;
  close(): Promise<void>;
}

export type PostgresUserStoreOptions = {
  maxConnections: number;
};

export class PostgresUserStore implements UserStore {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;

  constructor(databaseUrl: string, options: PostgresUserStoreOptions) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: options.maxConnections,
      application_name: 'krunker-arena-server',
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 30_000,
    });
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      create table if not exists users (
        id text primary key,
        username text not null unique,
        display_name text not null,
        password_hash text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
  }

  async ready(): Promise<void> {
    await this.pool.query('select 1');
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const result = await this.pool.query('select * from users where username = $1 limit 1', [username]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query('select * from users where id = $1 limit 1', [id]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async createUser(input: { username: string; displayName: string; passwordHash: string }): Promise<UserRecord> {
    const id = nanoid(16);
    const result = await this.pool.query(
      'insert into users (id, username, display_name, password_hash) values ($1, $2, $3, $4) returning *',
      [id, input.username, input.displayName, input.passwordHash],
    );
    return mapUser(result.rows[0]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class MemoryUserStore implements UserStore {
  readonly kind = 'memory' as const;
  private readonly users = new Map<string, UserRecord>();

  async migrate(): Promise<void> {}

  async ready(): Promise<void> {}

  async findByUsername(username: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(input: { username: string; displayName: string; passwordHash: string }): Promise<UserRecord> {
    if (await this.findByUsername(input.username)) throw new Error('USERNAME_TAKEN');
    const user: UserRecord = { id: nanoid(16), username: input.username, displayName: input.displayName, passwordHash: input.passwordHash };
    this.users.set(user.id, user);
    return user;
  }

  async close(): Promise<void> {}
}

function mapUser(row: any): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
  };
}
