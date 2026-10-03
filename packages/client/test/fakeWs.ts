export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset() { FakeWebSocket.instances = []; }
  static get last() { return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!; }
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  // test helpers
  open() { this.readyState = 1; this.onopen?.(); }
  receive(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}
export const asImpl = FakeWebSocket as unknown as new (url: string) => WebSocket;
