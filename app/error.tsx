"use client";

import { useEffect } from "react";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Cash Ledger encountered an unexpected error.", error);
  }, [error]);

  return (
    <main
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center bg-[#f3f5f2] px-5 text-center text-[#17251f]"
    >
      <h1 className="m-0 text-[18px] font-semibold">The ledger hit a snag.</h1>
      <p className="mb-4 mt-2 max-w-[360px] text-[12px] leading-5 text-[#758178]">
        Your saved records are unchanged. Reload this view to continue.
      </p>
      <button
        type="button"
        onClick={retry}
        className="flex h-9 items-center rounded-[7px] bg-[#173c31] px-4 text-[11px] font-semibold text-white transition hover:bg-[#245745]"
      >
        Reload view
      </button>
    </main>
  );
}