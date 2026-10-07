/**
 * In-memory stand-in for `ctx.getDataClient()` (Rayfin typed entity API), covering exactly
 * what `rayfin/functions/src/sync.ts` uses plus a minimal query chain:
 *
 *   create(input)                     → inserts; throws on duplicate id
 *   update(where, data)               → merges; THROWS when the id does not exist (like DAB)
 *   upsert(where, create, update)     → create-or-update by id
 *   select(fields).where(c).first(n).execute()
 *   where(c) / first(n) / findById / findMany
 *
 * Like the real client's `formatMutationInput`, fields whose value is `undefined` are not
 * sent, so an `update` with `{ x: undefined }` leaves the stored `x` untouched.
 *
 * Every mutation is recorded in `calls` and every read in `reads`, so tests can assert
 * request counts and ordering (the sync trades per-row `findById` for batched lookups).
 */

type Row = { id: string } & Record<string, unknown>;

type Condition = Record<string, { eq?: unknown; gte?: unknown; lte?: unknown; in?: unknown[] }>;

export interface MutationCall {
  entity: string;
  op: 'create' | 'update' | 'upsert';
  id: string;
  /** For upsert: whether the row existed before the call. */
  existed?: boolean;
}

export interface ReadCall {
  entity: string;
  op: 'query' | 'findById' | 'findMany';
  where?: Condition;
  /** Page size for `query` (the `first(n)` argument, 100 when not given). */
  limit?: number;
}

function matches(row: Row, where: Condition | undefined): boolean {
  if (!where) return true;
  for (const [field, ops] of Object.entries(where)) {
    const value = row[field];
    if (ops.eq !== undefined && value !== ops.eq) return false;
    if (ops.gte !== undefined && !((value as number | string) >= (ops.gte as number | string))) return false;
    if (ops.lte !== undefined && !((value as number | string) <= (ops.lte as number | string))) return false;
    if (ops.in !== undefined && !ops.in.includes(value)) return false;
  }
  return true;
}

/** Drops `undefined` values, as the real client does before building a mutation. */
function definedFields<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

class FakeQuery<T extends Row> {
  private condition: Condition | undefined;
  private limit = 100; // one page by default, like the real client

  constructor(
    private readonly table: Map<string, T>,
    private readonly record: (read: Omit<ReadCall, 'entity' | 'op'>) => void,
    private readonly guard: () => void = () => {},
  ) {}

  select(_fields: readonly string[]): this {
    return this;
  }

  where(condition: Condition): this {
    this.condition = condition;
    return this;
  }

  first(count: number): this {
    this.limit = count;
    return this;
  }

  orderBy(_order: Record<string, 'asc' | 'desc'>): this {
    return this;
  }

  async execute(): Promise<T[]> {
    this.guard();
    this.record({ where: this.condition, limit: this.limit });
    return [...this.table.values()].filter((row) => matches(row, this.condition)).slice(0, this.limit);
  }
}

export class FakeEntityClient<T extends Row> {
  readonly rows = new Map<string, T>();
  /** When set, the next matching operation throws this error (used for error-path tests). */
  failNext: { op: MutationCall['op']; error: Error } | null = null;
  /**
   * Runs before every `create`, after `failNext` and before the duplicate check: a test can
   * insert the same id here to simulate a concurrent writer racing the insert.
   */
  onCreate: ((input: Partial<T> & Record<string, unknown>) => void) | null = null;
  /** When set, the next query `execute()` on this entity throws this error (lookup-failure tests). */
  failNextRead: Error | null = null;

  constructor(
    readonly name: string,
    private readonly calls: MutationCall[],
    private readonly reads: ReadCall[],
  ) {}

  private maybeFail(op: MutationCall['op']): void {
    if (this.failNext && this.failNext.op === op) {
      const { error } = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  async create(input: Partial<T> & Record<string, unknown>): Promise<T> {
    this.maybeFail('create');
    this.onCreate?.(input);
    const id = typeof input.id === 'string' ? input.id : `generated-${this.rows.size + 1}`;
    if (this.rows.has(id)) throw new Error(`${this.name}: duplicate id ${id}`);
    const row = { ...definedFields(input), id } as T;
    this.rows.set(id, row);
    this.calls.push({ entity: this.name, op: 'create', id });
    return row;
  }

  async update(where: { id: string }, data: Partial<T> & Record<string, unknown>): Promise<T> {
    this.maybeFail('update');
    const existing = this.rows.get(where.id);
    if (!existing) throw new Error(`${this.name}: no row with id ${where.id}`);
    const row = { ...existing, ...definedFields(data), id: where.id } as T;
    this.rows.set(where.id, row);
    this.calls.push({ entity: this.name, op: 'update', id: where.id });
    return row;
  }

  async upsert(
    where: { id: string },
    create: Partial<T> & Record<string, unknown>,
    update: Partial<T> & Record<string, unknown>,
  ): Promise<T> {
    this.maybeFail('upsert');
    const existing = this.rows.get(where.id);
    const row = (
      existing ? { ...existing, ...definedFields(update), id: where.id } : { ...definedFields(create), id: where.id }
    ) as T;
    this.rows.set(where.id, row);
    this.calls.push({ entity: this.name, op: 'upsert', id: where.id, existed: Boolean(existing) });
    return row;
  }

  private query(): FakeQuery<T> {
    return new FakeQuery<T>(
      this.rows,
      (read) => this.reads.push({ entity: this.name, op: 'query', ...read }),
      () => {
        if (this.failNextRead) {
          const error = this.failNextRead;
          this.failNextRead = null;
          throw error;
        }
      },
    );
  }

  select(fields: readonly string[]): FakeQuery<T> {
    return this.query().select(fields);
  }

  where(condition: Condition): FakeQuery<T> {
    return this.query().where(condition);
  }

  first(count: number): FakeQuery<T> {
    return this.query().first(count);
  }

  async findById(id: string): Promise<T | null> {
    this.reads.push({ entity: this.name, op: 'findById', where: { id: { eq: id } } });
    return this.rows.get(id) ?? null;
  }

  async findMany(condition?: Condition): Promise<T[]> {
    this.reads.push({ entity: this.name, op: 'findMany', where: condition });
    return [...this.rows.values()].filter((row) => matches(row, condition));
  }
}

export interface StationRow extends Row {
  sepaId: number;
  code: string;
  name: string;
  municipality?: string;
  latitude?: number;
  longitude?: number;
  active: boolean;
  lastObservationAt?: Date;
  updatedAt: Date;
}

export interface SnapshotRow extends Row {
  station_id: string;
  observedAt: Date;
  category: number;
  dominant: string;
  valuesJson: string;
  seriesJson: string;
  updatedAt: Date;
}

export interface DailyStatRow extends Row {
  station_id: string;
  parameter: string;
  day: string;
  avgValue: number;
  maxValue: number;
  minValue: number;
  maxHour: number;
  hours: number;
  categoryMax: number;
  updatedAt: Date;
}

export interface SyncRunRow extends Row {
  kind: 'sync' | 'backfill';
  status: 'running' | 'ok' | 'error';
  startedAt: Date;
  finishedAt?: Date;
  windowFrom: Date;
  windowTo: Date;
  stationsSeen: number;
  observationsSeen: number;
  rowsWritten: number;
  message?: string;
}

export class FakeDataClient {
  readonly calls: MutationCall[] = [];
  readonly reads: ReadCall[] = [];
  readonly Station = new FakeEntityClient<StationRow>('Station', this.calls, this.reads);
  readonly StationSnapshot = new FakeEntityClient<SnapshotRow>('StationSnapshot', this.calls, this.reads);
  readonly DailyStat = new FakeEntityClient<DailyStatRow>('DailyStat', this.calls, this.reads);
  readonly SyncRun = new FakeEntityClient<SyncRunRow>('SyncRun', this.calls, this.reads);

  countCalls(entity: string, op?: MutationCall['op']): number {
    return this.calls.filter((c) => c.entity === entity && (op === undefined || c.op === op)).length;
  }

  countReads(entity: string, op?: ReadCall['op']): number {
    return this.reads.filter((r) => r.entity === entity && (op === undefined || r.op === op)).length;
  }

  /** The single SyncRun row (tests create exactly one run per call). */
  onlySyncRun(): SyncRunRow {
    const runs = [...this.SyncRun.rows.values()];
    if (runs.length !== 1) throw new Error(`expected exactly one SyncRun, found ${runs.length}`);
    return runs[0];
  }
}

/**
 * Builds a `RayfinContext`-shaped object exposing only `getDataClient()`. The cast is
 * confined to this helper: `sync.ts` touches nothing else on the context.
 */
export function fakeContext<TCtx>(data: FakeDataClient): TCtx {
  return { getDataClient: () => data } as unknown as TCtx;
}
