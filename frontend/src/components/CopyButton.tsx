import { useState } from "react";
import { CopyIcon } from "./Icons";

/* Clipboard write with a fallback for browsers that block the async API (plain http, older Safari). */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export default function CopyButton({ text, label = "Copy", className = "btn" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  return (
    <button type="button" onClick={copy} className={className}>
      <CopyIcon /> {copied ? "Copied" : label}
    </button>
  );
}
