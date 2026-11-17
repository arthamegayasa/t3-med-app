/**
 * T3 Med: the title of the Version row in Settings > About. Upstream's `AboutVersionTitle`
 * shows one number; this one shows T3 Med's version and the upstream release it is built on.
 * `SettingsPanels.tsx` imports it in place of upstream's file, which stays as it is.
 */
import { APP_VERSION } from "../branding";
import { InlineButton } from "../components/ui/button";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { describeMedVersion } from "./medVersion";

export function AboutVersionTitle() {
  const { copyToClipboard } = useCopyToClipboard<void>({
    target: "version",
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy version",
          description: error.message,
        }),
      );
    },
  });
  const version = describeMedVersion(APP_VERSION);

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>Version</span>
      <code className="text-2xs font-medium">
        <Tooltip>
          <TooltipTrigger
            render={
              <InlineButton
                tone="muted"
                aria-label={`Copy version ${version.label}`}
                onClick={() => copyToClipboard(version.copyText, undefined)}
              >
                {version.label}
              </InlineButton>
            }
          />
          <TooltipPopup>Copy version</TooltipPopup>
        </Tooltip>
      </code>
      <span className="text-2xs font-normal text-muted-foreground">{version.builtOn}</span>
    </span>
  );
}
