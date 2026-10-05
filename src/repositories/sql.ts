// Builds a parameterised WHERE clause; values are always bound, never pasted into the SQL.
export class Where {
  private readonly clauses: string[] = [];
  readonly params: unknown[] = [];

  // add("d.province_id = ?", value): each ? becomes the next $n
  add(clause: string, ...values: unknown[]): this {
    let text = clause;
    for (const v of values) {
      this.params.push(v);
      text = text.replace('?', `$${this.params.length}`);
    }
    this.clauses.push(text);
    return this;
  }

  addIf(condition: unknown, clause: string, ...values: unknown[]): this {
    return condition === undefined || condition === null ? this : this.add(clause, ...values);
  }

  toSql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }

  // adds a parameter after the WHERE ones, e.g. for LIMIT/OFFSET
  next(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
}

// most recent of the given dates, or null
export function latest(...dates: (Date | string | null | undefined)[]): Date | null {
  let max: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    const date = d instanceof Date ? d : new Date(d);
    if (!max || date > max) max = date;
  }
  return max;
}
