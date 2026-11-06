import { useOutletContext } from "react-router";
import type { SearchScope } from "../components/SearchPalette";

export interface LayoutContext {
  openMenu: () => void;
  /** Opens the search palette, optionally offering to search one chat. */
  openSearch: (scope?: SearchScope) => void;
}

export const useLayout = () => useOutletContext<LayoutContext>();
