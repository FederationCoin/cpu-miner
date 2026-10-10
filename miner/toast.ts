export type ToastKind = 'ok' | 'error';

export type MinerToast = {
  message: string;
  kind: ToastKind;
};

export function toastKindFromMessage(message: string): ToastKind {
  return /fail|error|refus|reject|denied|invalid|bad |not live|not hard|closed|timeout/i.test(message)
    ? 'error'
    : 'ok';
}
