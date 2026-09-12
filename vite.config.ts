import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const LEGACY_BRAND = "Pelote Manager";
const CURRENT_BRAND = "PILOTOKI";

function pilotokiBrandingGuard(): Plugin {
  return {
    name: "pilotoki-branding-guard",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/src/") || !/\.[cm]?[jt]sx?$/.test(id)) return null;

      let brandedCode = code.replaceAll(LEGACY_BRAND, CURRENT_BRAND);

      // The marketing mockup still uses the historical PM placeholder while
      // the definitive PILOTOKI logo is being designed. Avoid displaying the
      // old initials during the PCL pilot.
      if (id.endsWith("/MarketingPage.tsx")) {
        brandedCode = brandedCode.replace(/>(\s*)PM(\s*)</g, ">$1P$2<");
      }

      if (brandedCode === code) return null;
      return { code: brandedCode, map: null };
    },
  };
}

export default defineConfig({
  plugins: [pilotokiBrandingGuard(), react(), tsconfigPaths()],
});
