/** Modal wiring context — all fields supplied by App.tsx. */
export type AppModalsContext = Record<string, unknown>;

/** Runtime view used inside AppModals (typed loosely to avoid 400-field interface). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppModalsRuntime = Record<string, any>;

export function buildAppModalsContext<const T extends AppModalsContext>(ctx: T): T {
  return ctx;
}
