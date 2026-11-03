/**
 * In-memory stand-in for `@aws-sdk/lib-dynamodb` (DocumentClient + commands) so tests run
 * the real `dynamodb.ts` — including its demo-tenant isolation — without AWS.
 * Supports the expressions dynamodb.ts sends: SET updates, simple key conditions,
 * entityType / isDemoData scan filters, and AND / OR / IN / attribute_(not_)exists conditions.
 */
type Item = Record<string, any>;

export const table = new Map<string, Item>();
const keyOf = (k: { pk: string; sk: string }) => `${k.pk}|${k.sk}`;
const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

export function allItems(entityType?: string): Item[] {
  return [...table.values()].filter((i) => !entityType || i.entityType === entityType).map(clone);
}

function evaluate(expr: string, item: Item, values: Item = {}, names: Record<string, string> = {}): boolean {
  const tokens = expr.match(/attribute_not_exists|attribute_exists|begins_with|<>|<=|>=|[()=<>,]|:[A-Za-z0-9_]+|#[A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const attr = (t: string) => (t.startsWith("#") ? names[t] : t);
  const has = (name: string) => Object.prototype.hasOwnProperty.call(item, name);
  const operand = () => {
    const t = next();
    if (t.startsWith(":")) return { v: values[t], exists: true };
    return { v: item[attr(t)], exists: has(attr(t)) };
  };
  const factor = (): boolean => {
    const t = peek();
    if (t === "(") {
      next();
      const v = orExpr();
      next();
      return v;
    }
    if (t === "attribute_not_exists" || t === "attribute_exists") {
      next();
      next();
      const name = attr(next());
      next();
      return t === "attribute_exists" ? has(name) : !has(name);
    }
    if (t === "begins_with") {
      next();
      next();
      const a = operand();
      next();
      const b = operand();
      next();
      return typeof a.v === "string" && a.v.startsWith(b.v);
    }
    const left = operand();
    const op = next();
    if (op === "IN") {
      next();
      const list: any[] = [];
      for (;;) {
        list.push(operand().v);
        if (next() === ")") break;
      }
      return list.includes(left.v);
    }
    const right = operand();
    // DynamoDB: any comparison against a missing attribute is false.
    if (!left.exists || !right.exists) return false;
    switch (op) {
      case "=":
        return left.v === right.v;
      case "<>":
        return left.v !== right.v;
      default:
        throw new Error(`fake-dynamo: unsupported operator ${op}`);
    }
  };
  const andExpr = (): boolean => {
    let v = factor();
    while (peek() === "AND") {
      next();
      const r = factor();
      v = v && r;
    }
    return v;
  };
  const orExpr = (): boolean => {
    let v = andExpr();
    while (peek() === "OR") {
      next();
      const r = andExpr();
      v = v || r;
    }
    return v;
  };
  return orExpr();
}

function conditionFailed() {
  const e = new Error("The conditional request failed");
  e.name = "ConditionalCheckFailedException";
  return e;
}

function checkCondition(input: any, current: Item | undefined) {
  if (input.ConditionExpression && !evaluate(input.ConditionExpression, current ?? {}, input.ExpressionAttributeValues, input.ExpressionAttributeNames)) {
    throw conditionFailed();
  }
}

class Command {
  constructor(public input: any) {}
}
export class GetCommand extends Command {}
export class PutCommand extends Command {}
export class UpdateCommand extends Command {}
export class DeleteCommand extends Command {}
export class QueryCommand extends Command {}
export class ScanCommand extends Command {}

async function send(cmd: Command): Promise<any> {
  const input = cmd.input;
  if (cmd instanceof GetCommand) return { Item: clone(table.get(keyOf(input.Key))) };
  if (cmd instanceof PutCommand) {
    const k = keyOf(input.Item);
    checkCondition(input, table.get(k));
    table.set(k, clone(input.Item));
    return {};
  }
  if (cmd instanceof UpdateCommand) {
    const k = keyOf(input.Key);
    const current = table.get(k);
    checkCondition(input, current);
    const next: Item = { ...(current ?? input.Key) };
    const set = String(input.UpdateExpression).replace(/^SET\s+/, "");
    for (const part of set.split(/,\s*/)) {
      const [name, value] = part.split(/\s*=\s*/);
      next[input.ExpressionAttributeNames[name]] = clone(input.ExpressionAttributeValues[value]);
    }
    table.set(k, next);
    return { Attributes: clone(next) };
  }
  if (cmd instanceof DeleteCommand) {
    const k = keyOf(input.Key);
    checkCondition(input, table.get(k));
    table.delete(k);
    return {};
  }
  if (cmd instanceof QueryCommand) {
    const field = input.IndexName === "GSI1" ? "gsi1" : input.IndexName === "GSI2" ? "gsi2" : "";
    const pkField = field ? `${field}pk` : "pk";
    const skField = field ? `${field}sk` : "sk";
    const values = input.ExpressionAttributeValues;
    let items = [...table.values()].filter((i) => i[pkField] === values[":pk"]);
    if (values[":type"]) items = items.filter((i) => String(i[skField] ?? "").startsWith(values[":type"]));
    items.sort((a, b) => String(a[skField]).localeCompare(String(b[skField])));
    if (input.ScanIndexForward === false) items.reverse();
    return { Items: items.slice(0, input.Limit ?? items.length).map(clone) };
  }
  if (cmd instanceof ScanCommand) {
    const items = [...table.values()].filter((i) =>
      input.FilterExpression ? evaluate(input.FilterExpression, i, input.ExpressionAttributeValues, input.ExpressionAttributeNames) : true,
    );
    return { Items: items.map(clone) };
  }
  throw new Error("fake-dynamo: unsupported command");
}

export const DynamoDBDocumentClient = { from: () => ({ send }) };
