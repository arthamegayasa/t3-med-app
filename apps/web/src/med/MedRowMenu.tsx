/** T3 Med: the menu at the end of a row that can be changed: what the doctor can do to it. */
import { EllipsisIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";

export interface MedRowAction {
  readonly label: string;
  readonly onSelect: () => void;
}

export function MedRowMenu({
  label,
  actions,
}: {
  /** Names the row for a reader who cannot see which one the button ends. */
  readonly label: string;
  readonly actions: ReadonlyArray<MedRowAction>;
}) {
  if (actions.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={label} />}>
        <EllipsisIcon aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end">
        {actions.map((action) => (
          <MenuItem key={action.label} onClick={action.onSelect}>
            {action.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
