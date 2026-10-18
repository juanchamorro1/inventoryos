export type ActionState<T = unknown> = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  data?: T;
  /** Cambia en cada envío para que el formulario pueda reaccionar. */
  at?: number;
};

export const initialState: ActionState = { ok: false };
