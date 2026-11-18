/**
 * T3 Med: remote access in Settings > Sharing & access. The doctor names the public address a
 * tunnel answers at (docs/t3-med/REMOTE.md) and makes a one-time link for another computer's
 * browser. Shown on the laptop only: a paired browser's session cannot manage access.
 */
import {
  MED_REMOTE_ADDRESS_RULE,
  type MedRemoteAccess,
  type MedRemotePairingLink,
  normalizeMedRemoteAddress,
} from "@t3tools/contracts/med";
import * as DateTime from "effect/DateTime";
import { useId, useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { callMedRemote, type MedRemoteResult } from "./medRemote";

const formatTime = (expiresAt: MedRemotePairingLink["expiresAt"]) =>
  DateTime.toDate(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function RemoteAccessForm({ initial }: { readonly initial: MedRemoteAccess }) {
  const id = useId();
  const [access, setAccess] = useState(initial);
  const [address, setAddress] = useState(initial.address ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<MedRemotePairingLink | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  const take = (next: MedRemoteAccess) => {
    setAccess(next);
    setAddress(next.address ?? "");
  };

  const run = async <A,>(
    send: Parameters<typeof callMedRemote<A>>[0],
    done: (value: A) => void,
  ) => {
    setBusy(true);
    setProblem(null);
    const result = await callMedRemote(send);
    setBusy(false);
    if (result.ok) done(result.value);
    else setProblem(result.message);
  };

  const saveAddress = (next: string | null) => {
    if (next !== null && normalizeMedRemoteAddress(next) === undefined) {
      setProblem(MED_REMOTE_ADDRESS_RULE);
      return;
    }
    void run(
      (client) => client.setAddress({ headers: {}, payload: { address: next } }),
      (value) => {
        take(value);
        setLink(null);
      },
    );
  };

  const saved = access.address;
  const changed = address.trim() !== (saved ?? "");
  const moved = access.keptPort !== null && access.keptPort !== access.port;

  return (
    <>
      <DialogPanel>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            saveAddress(address);
          }}
        >
          <Label htmlFor={`${id}-address`}>Public address</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-address`}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="https://med.example.com"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <Button type="submit" variant="outline" disabled={busy || !changed}>
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The tunnel on this laptop sends that address to http://127.0.0.1:{access.port}. T3 Med
            itself listens on this laptop only.
          </p>
          {moved ? (
            <p className="text-xs text-warning">
              The tunnel points at port {access.keptPort}, which another program held when T3 Med
              started, so T3 Med is on port {access.port} and cannot be reached from outside. Close
              that program and start T3 Med again.
            </p>
          ) : null}
        </form>

        {saved !== null ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-medium text-foreground">One-time link</h3>
                <p className="text-xs text-muted-foreground">
                  Open it once in the other computer&apos;s browser. That browser can read and work
                  in chats and patient pages. It cannot make links or remove clients.
                </p>
              </div>
              <Button
                className="shrink-0"
                disabled={busy || changed}
                onClick={() =>
                  void run((client) => client.createPairingLink({ headers: {} }), setLink)
                }
              >
                {link === null ? "Create link" : "New link"}
              </Button>
            </div>
            {link !== null ? (
              <>
                <Textarea
                  readOnly
                  aria-label="One-time link"
                  rows={3}
                  value={link.url}
                  onFocus={(event) => event.currentTarget.select()}
                  onClick={(event) => event.currentTarget.select()}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Works once, until {formatTime(link.expiresAt)}. It is shown here only.
                  </p>
                  <Button size="xs" variant="outline" onClick={() => copyToClipboard(link.url)}>
                    {isCopied ? "Copied" : "Copy link"}
                  </Button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {problem !== null ? <p className="text-xs text-destructive">{problem}</p> : null}
      </DialogPanel>
      <DialogFooter variant="bare">
        {saved !== null ? (
          <Button variant="destructive-outline" disabled={busy} onClick={() => saveAddress(null)}>
            Turn off
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

/** The button beside "Revoke others", and its dialog. */
export function MedRemoteAccessAction() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<MedRemoteResult<MedRemoteAccess> | null>(null);
  const openOrClose = (next: boolean) => {
    setOpen(next);
    setLoaded(null);
    if (next) void callMedRemote((client) => client.read({ headers: {} })).then(setLoaded);
  };
  return (
    <Dialog open={open} onOpenChange={openOrClose}>
      <DialogTrigger render={<Button size="xs" variant="default" />}>Remote access</DialogTrigger>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Open T3 Med from another computer</DialogTitle>
          <DialogDescription>
            Through a tunnel you run on this laptop, at an address of your own. Patient data and
            agents stay on this laptop.
          </DialogDescription>
        </DialogHeader>
        {loaded === null ? (
          <DialogPanel>
            <p className="text-xs text-muted-foreground">Loading…</p>
          </DialogPanel>
        ) : loaded.ok ? (
          <RemoteAccessForm initial={loaded.value} />
        ) : (
          <DialogPanel>
            <p className="text-xs text-destructive">{loaded.message}</p>
          </DialogPanel>
        )}
      </DialogPopup>
    </Dialog>
  );
}
