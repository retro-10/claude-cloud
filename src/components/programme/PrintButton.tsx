"use client";

import { Icon } from "../ui/Icon";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
      <Icon name="download" size={14} /> Print or save as PDF
    </button>
  );
}
