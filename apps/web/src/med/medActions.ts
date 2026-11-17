/**
 * T3 Med: one change by the doctor, done at once and said in a toast. Where there is a way
 * back the toast offers it as Undo, so nothing but a loss of data asks first.
 */
import { toastManager } from "../components/ui/toast";
import { changeMed, type MedChangeResult, type MedSend } from "./medData";

export interface MedUndo {
  readonly send: MedSend<unknown>;
  readonly done: string;
  readonly failed: string;
}

export interface MedAct<A> {
  readonly send: MedSend<A>;
  /** What the toast says once it is done; from the answer when that says how much was done. */
  readonly done: string | ((value: A) => string);
  /** A second line under it: what exactly was changed, when the title only counts it. */
  readonly detail?: ((value: A) => string | undefined) | undefined;
  /** The toast's title when it fails. Left out by a form, which shows the reason itself. */
  readonly failed?: string | undefined;
  /**
   * The way back. Built from the answer when the undo has to name what it reverses: the
   * correction it takes back, or the row as this change left it. The server refuses an undo
   * whose row changed since, and the toast then says so.
   */
  readonly undo?: MedUndo | ((value: A) => MedUndo | undefined) | undefined;
}

export async function actOnMed<A>(act: MedAct<A>): Promise<MedChangeResult<A>> {
  const result = await changeMed(act.send);
  if (!result.ok) {
    if (act.failed !== undefined) {
      toastManager.add({ type: "error", title: act.failed, description: result.message });
    }
    return result;
  }
  const undo = typeof act.undo === "function" ? act.undo(result.value) : act.undo;
  const detail = act.detail?.(result.value);
  const id = toastManager.add({
    type: "success",
    title: typeof act.done === "function" ? act.done(result.value) : act.done,
    ...(detail === undefined ? {} : { description: detail }),
    ...(undo === undefined
      ? {}
      : {
          actionProps: {
            children: "Undo",
            onClick: () => {
              toastManager.close(id);
              void actOnMed({ send: undo.send, done: undo.done, failed: undo.failed });
            },
          },
        }),
  });
  return result;
}
