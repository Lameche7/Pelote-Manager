import { Outlet } from "react-router-dom";
import { PlatformAuthProvider } from "./PlatformAuthProvider";

export function PlatformProviderLayout() {
  return (
    <PlatformAuthProvider>
      <Outlet />
    </PlatformAuthProvider>
  );
}
