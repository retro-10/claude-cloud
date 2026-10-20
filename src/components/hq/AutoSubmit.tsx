"use client";

/**
 * A select that saves as soon as it changes: the status, priority and assignee pickers in List and Table views.
 * Without JavaScript the form still has its own button.
 */
export function AutoSelect(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const { label, className = "", ...rest } = props;
  return (
    <select
      aria-label={label}
      {...rest}
      className={className || "input input-sm"}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    />
  );
}
