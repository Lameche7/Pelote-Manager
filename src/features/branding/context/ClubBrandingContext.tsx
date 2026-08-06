import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CLUB_BRANDING_CHANGED_EVENT,
  DEFAULT_CLUB_BRANDING,
  clubBrandingService,
  type ClubBranding,
} from "../services/clubBrandingService";

type ClubBrandingContextValue = {
  branding: ClubBranding;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const ClubBrandingContext = createContext<ClubBrandingContextValue>({
  branding: DEFAULT_CLUB_BRANDING,
  isLoading: true,
  refresh: async () => undefined,
});

const hexToRgb = (hex: string) => ({
  red: Number.parseInt(hex.slice(1, 3), 16),
  green: Number.parseInt(hex.slice(3, 5), 16),
  blue: Number.parseInt(hex.slice(5, 7), 16),
});

const toHex = (value: number) =>
  Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");

const blendWithWhite = (hex: string, colorWeight: number) => {
  const rgb = hexToRgb(hex);
  return `#${toHex(rgb.red * colorWeight + 255 * (1 - colorWeight))}${toHex(
    rgb.green * colorWeight + 255 * (1 - colorWeight),
  )}${toHex(rgb.blue * colorWeight + 255 * (1 - colorWeight))}`;
};

const applyBrandingVariables = (branding: ClubBranding) => {
  const root = document.documentElement;
  root.style.setProperty("--club-primary", branding.primaryColor);
  root.style.setProperty("--club-secondary", branding.secondaryColor);
  root.style.setProperty("--club-accent", branding.accentColor);
  root.style.setProperty("--club-neutral", branding.neutralColor);
  root.style.setProperty("--brand-green", branding.primaryColor);
  root.style.setProperty(
    "--brand-green-light",
    blendWithWhite(branding.primaryColor, 0.78),
  );
  root.style.setProperty("--brand-blue", branding.secondaryColor);
  root.style.setProperty(
    "--brand-blue-light",
    blendWithWhite(branding.secondaryColor, 0.78),
  );
  root.style.setProperty("--brand-red", branding.accentColor);
  root.style.setProperty("--muted", branding.neutralColor);
  root.style.setProperty(
    "--brand-paper",
    blendWithWhite(branding.neutralColor, 0.06),
  );
  root.style.setProperty("--line", blendWithWhite(branding.neutralColor, 0.22));
};

export function ClubBrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState(DEFAULT_CLUB_BRANDING);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const nextBranding = await clubBrandingService.getPublicBranding();
      setBranding(nextBranding);
    } catch {
      setBranding((current) => current || DEFAULT_CLUB_BRANDING);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const reloadBranding = () => void refresh();
    window.addEventListener(CLUB_BRANDING_CHANGED_EVENT, reloadBranding);
    return () =>
      window.removeEventListener(CLUB_BRANDING_CHANGED_EVENT, reloadBranding);
  }, [refresh]);

  useEffect(() => {
    applyBrandingVariables(branding);
  }, [branding]);

  const value = useMemo(
    () => ({ branding, isLoading, refresh }),
    [branding, isLoading, refresh],
  );

  return (
    <ClubBrandingContext.Provider value={value}>
      {children}
    </ClubBrandingContext.Provider>
  );
}

export const useClubBranding = () => useContext(ClubBrandingContext);
