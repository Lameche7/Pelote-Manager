import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

const tokenRules = [
  {
    name: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  },
  {
    name: "GitHub fine-grained PAT",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
  },
  {
    name: "Supabase secret key",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "AWS access key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    name: "OpenAI API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "Bearer JWT",
    pattern:
      /\bBearer\s+eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
];

const sensitiveAssignmentPattern =
  /\b([A-Z0-9_]*(?:SECRET|PRIVATE_KEY|SERVICE_ROLE_KEY|ACCESS_TOKEN|AUTH_TOKEN|WEBHOOK_TOKEN|PASSWORD)[A-Z0-9_]*)\s*[:=]\s*["'`]?([^\s"'`;#]+)/g;

const placeholderFragments = [
  "example",
  "placeholder",
  "replace",
  "remplacer",
  "changeme",
  "your_",
  "your-",
  "dummy",
  "fake",
  "mock",
  "test",
  "interdit",
  "redacted",
  "xxxxx",
  "<secret>",
];

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function looksLikeLiteralSecret(value) {
  const normalized = value.trim().toLowerCase();

  if (value.length < 16) return false;
  if (
    value.startsWith("$") ||
    value.startsWith("{{") ||
    value.startsWith("<") ||
    value.startsWith("process.") ||
    value.startsWith("Deno.") ||
    value.startsWith("import.")
  ) {
    return false;
  }

  return !placeholderFragments.some((fragment) =>
    normalized.includes(fragment),
  );
}

export function isForbiddenEnvPath(filePath) {
  const baseName = path.basename(filePath);
  return (
    (baseName === ".env" || baseName.startsWith(".env.")) &&
    baseName !== ".env.example"
  );
}

export function scanText(text) {
  const findings = [];

  for (const rule of tokenRules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        rule: rule.name,
        line: lineNumberAt(text, match.index ?? 0),
      });
    }
  }

  sensitiveAssignmentPattern.lastIndex = 0;
  for (const match of text.matchAll(sensitiveAssignmentPattern)) {
    const value = match[2] ?? "";
    if (!looksLikeLiteralSecret(value)) continue;

    findings.push({
      rule: `literal value assigned to ${match[1]}`,
      line: lineNumberAt(text, match.index ?? 0),
    });
  }

  return findings;
}

function trackedFiles(rootDir) {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: rootDir,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

export function scanRepository(rootDir = process.cwd()) {
  const findings = [];

  for (const relativePath of trackedFiles(rootDir)) {
    if (isForbiddenEnvPath(relativePath)) {
      findings.push({
        file: relativePath,
        line: 1,
        rule: "tracked environment file",
      });
      continue;
    }

    const absolutePath = path.join(rootDir, relativePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_TEXT_FILE_BYTES) continue;

    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) continue;

    const text = buffer.toString("utf8");
    for (const finding of scanText(text)) {
      findings.push({ file: relativePath, ...finding });
    }
  }

  return findings;
}

function printReport(findings) {
  if (findings.length === 0) {
    console.log(
      "Secret scan: aucun secret évident détecté dans les fichiers suivis.",
    );
    return;
  }

  console.error(
    `Secret scan: ${findings.length} élément(s) potentiellement sensible(s) détecté(s).`,
  );
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} — ${finding.rule}`);
  }
  console.error(
    "Aucune valeur sensible n'est affichée. Déplacez le secret vers les variables d'environnement puis relancez le contrôle.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const findings = scanRepository();
  printReport(findings);
  if (findings.length > 0) process.exitCode = 1;
}
