/**
 * T3 Med: what the Authorized clients list offers in Settings > Sharing & access. Upstream's
 * header makes a pairing link with any scopes and opens "Use in another app (MCP)"; here it
 * revokes the other clients and opens T3 Med's own remote access. `ConnectionsSettings.tsx`
 * imports it from this file.
 */
import type { ComponentProps, ReactNode } from "react";

import * as Upstream from "../components/settings/AuthorizedClientsSettings";
import { canRevokeOtherClients } from "../components/settings/ConnectionsSettings.logic";
import { Button } from "../components/ui/button";
import { MedRemoteAccessAction } from "./MedRemoteAccess";
import { T3MED } from "./t3med";

type Props = ComponentProps<typeof Upstream.AuthorizedClientsHeaderAction>;

function RevokeOthers({ clientSessions, isRevokingOtherClients, onRevokeOtherClients }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        size="xs"
        variant="destructive-outline"
        disabled={isRevokingOtherClients || !canRevokeOtherClients(clientSessions)}
        onClick={() => void onRevokeOtherClients()}
      >
        {isRevokingOtherClients ? "Revoking…" : "Revoke others"}
      </Button>
      <MedRemoteAccessAction />
    </div>
  );
}

export const AuthorizedClientsHeaderAction: (props: Props) => ReactNode = T3MED
  ? RevokeOthers
  : Upstream.AuthorizedClientsHeaderAction;
