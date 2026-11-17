/** T3 Med: what an empty draft asks, in place of upstream's question about what to build. */
export function MedDraftHero() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
      <h1 className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
        Which patient is this about?
      </h1>
      <p className="mt-2 w-full text-center text-muted-foreground text-sm">
        Start with a URN or a name, then ask, or paste labs, notes and plans to file.
      </p>
    </div>
  );
}
