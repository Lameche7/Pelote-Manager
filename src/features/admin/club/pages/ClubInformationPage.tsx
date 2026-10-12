import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ClubMediaManager } from "../components/ClubMediaManager";
import {
  clubBrandingUploadService,
  type BrandingImageKind,
} from "../services/clubBrandingUploadService";
import { clubAdminService, type Club } from "../services/clubAdminService";
import "./ClubPages.css";
import "./ClubBranding.css";

type PreviewStyle = CSSProperties & {
  "--preview-primary": string;
  "--preview-secondary": string;
  "--preview-accent": string;
  "--preview-neutral": string;
  "--preview-hero": string;
};

const colorFields: Array<{ key: keyof Club; label: string; help: string }> = [
  {
    key: "primaryColor",
    label: "Couleur principale",
    help: "Navigation, fonds forts et titres principaux.",
  },
  {
    key: "secondaryColor",
    label: "Couleur secondaire",
    help: "Liens, éléments complémentaires et repères.",
  },
  {
    key: "accentColor",
    label: "Couleur d’accent",
    help: "Boutons importants, alertes et mises en avant.",
  },
  {
    key: "neutralColor",
    label: "Couleur neutre",
    help: "Textes secondaires, bordures et informations discrètes.",
  },
];

export function ClubInformationPage() {
  const [club, setClub] = useState<Club | null>(null);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState<BrandingImageKind | null>(null);

  useEffect(() => {
    clubAdminService
      .getClֻǱ˞