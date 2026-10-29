/** Shows an evaluation error the Bob Ross way: as a happy accident. */
export function EvalNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="absolute inset-x-4 bottom-4 max-h-[30%] overflow-auto rounded-xl border border-l-[3px] border-border border-l-oil bg-card px-4 py-3 font-mono text-[13px] whitespace-pre-wrap"
    >
      <span className="mr-2 font-sans font-medium text-oil">Happy accident:</span>
      {message}
    </div>
  );
}
