/**
 * T3 Med: what the Authorized clients list offers in Settings > Sharing & access. Upstream's
 * header also makes a pairing link for another device and opens "Use in another app (MCP)";
 * here it only revokes the other clients. `ConnectionsSettings.tsx` imports it from this file.
 */
import type { ComponentProps, ReactNode } from "react";

import * as Upstream from "../components/settings/AuthorizedClientsSettings";
import { canRevokeOtherClients } from "../components/settings/ConnectionsSettings.logic";
import { Button } from "../components/ui/button";
import { T3MED } from "./t3med";

type Props = ComponentProps<typeof Upstream.AuthorizedClientsHeaderAction>;

function RevokeOthers({ clientSessions, isRevokingOtherClients, onRevokeOtherClients }: Props) {
  return (
    <Button
      size="xs"
      variant="destructive-outline"
      disabled={isRevokingOtherClients || !canRevokeOtherClients(clientSessions)}
      onClick={() => void onRevokeOtherClients()}
    >
      {isRevokingOtherClients ? "Revoking…" : "Revoke others"}
    </Button>
  );
}

export const AuthorizedClientsHeaderAction: (props: Props) => ReactNode = T3MED
  ? RevokeOthers
  : Upstream.AuthorizedClientsHeaderAction;
