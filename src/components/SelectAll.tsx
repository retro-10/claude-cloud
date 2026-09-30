"use client";

// Ticks every lead checkbox (name="ids") inside the same form.
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all leads on this page"
      onChange={(e) => {
        const form = e.currentTarget.closest("form");
        form?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((c) => (c.checked = e.currentTarget.checked));
      }}
    />
  );
}
