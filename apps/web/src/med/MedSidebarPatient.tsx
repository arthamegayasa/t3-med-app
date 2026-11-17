/**
 * T3 Med: the patient of a thread in the sidebar. A row's first line names the patient where
 * upstream names the project, and its hover card adds the URN. Every row reads the one shared
 * answer of `useThreadPatientLink`; a thread with no patient shows nothing there.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import { useThreadPatientLink } from "./medData";
import { T3MED } from "./t3med";

interface RowThread {
  readonly environmentId: EnvironmentId;
  readonly id: string;
}

/**
 * A thread row's props with the patient's name in place of the project's: the row draws
 * `projectDisplayName` on its first line, in its hover card and in its accessible label.
 */
export function usePatientRow<
  Props extends { readonly thread: RowThread; readonly projectDisplayName: string | null },
>(props: Props): Props {
  const link = useThreadPatientLink(props.thread.environmentId, props.thread.id);
  if (!T3MED) return props;
  const name = link?.name ?? null;
  return name === props.projectDisplayName ? props : { ...props, projectDisplayName: name };
}

/** The linked patient's URN, as a line of a thread's hover card; nothing without one. */
export function MedSidebarPatientUrn({ thread }: { readonly thread: RowThread }) {
  const link = useThreadPatientLink(thread.environmentId, thread.id);
  if (link === null || link.urn === null) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 truncate text-foreground/75">URN {link.urn}</div>
    </div>
  );
}
