export type LogLine = {
  t: number;
  mode: string;
  message: string;
};

const MAX = 500;
const lines: LogLine[] = [];

export function pushLog(mode: string, message: string): LogLine {
  const line: LogLine = { t: Date.now(), mode, message };
  lines.push(line);
  if (lines.length > MAX) {
    lines.splice(0, lines.length - MAX);
  }
  return line;
}

export function logHistory(): LogLine[] {
  return lines.slice();
}

export function redactSecret(s: string, secret: string): string {
  const t = secret.trim();
  if (t.length < 4) {
    return s;
  }
  return s.split(t).join('***');
}
