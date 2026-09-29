// Result banner for pages whose forms redirect back with ?notice=… or ?error=…
export function Flash({ notice, error }: { notice?: string; error?: string }) {
  if (error)
    return (
      <p role="alert" className="mb-3 rounded border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
        {error}
      </p>
    );
  if (notice)
    return (
      <p role="status" className="mb-3 rounded border border-line bg-surface px-3 py-2 text-sm">
        {notice}
      </p>
    );
  return null;
}
