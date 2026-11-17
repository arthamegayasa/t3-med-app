/**
 * T3 Med: one change by the doctor, done at once and said in a toast. Where there is a way
 * back the toast offers it as Undo, so nothing but a loss of data asks first.
 */
import { toastManager } from "../components/ui/toast";
import { changeMed, type MedChangeResult, type MedSend } from "./medData";

export interface MedAct<A> {
  readonly send: MedSend<A>;
  /** What the toast says once it is done; from the answer when that says how much was done. */
  readonly done: string | ((value: A) => string);
  /** The toast's title when it fails. Left out by a form, which shows the reason itself. */
  readonly failed?: string | undefined;
  readonly undo?:
    | { readonly send: MedSend<unknown>; readonly done: string; readonly failed: string }
    | undefined;
}

export async function actOnMed<A>(act: MedAct<A>): Promise<MedChangeResult<A>> {
  const result = await changeMed(act.send);
  if (!result.ok) {
    if (act.failed !== undefined) {
      toastManager.add({ type: "error", title: act.failed, description: result.message });
    }
    return result;
  }
  const { undo } = act;
  const id = toastManager.add({
    type: "success",
    title: typeof act.done === "function" ? act.done(result.value) : act.done,
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
