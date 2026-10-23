import { useOutletContext } from "react-router";

export interface LayoutContext {
  openMenu: () => void;
}

export const useLayout = () => useOutletContext<LayoutContext>();
