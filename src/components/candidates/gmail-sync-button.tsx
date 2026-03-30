"use client";

import { useState } from "react";
import { syncResumesFromGmail } from "@/lib/actions/candidates";
import { Button } from "@/components/ui/button";

interface GmailSyncButtonProps {
  campaignId: string;
}

export function GmailSyncButton({ campaignId }: GmailSyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      setResult(null);
      const res = await syncResumesFromGmail(campaignId);
      setResult({ success: res.success, message: res.message });
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        onClick={handleSync}
        disabled={isSyncing}
        variant="outline"
        className="gap-2 border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900"
      >
        {isSyncing ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-800 border-t-transparent" />
            Syncing Resumes...
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            Sync from Gmail
          </>
        )}
      </Button>

      {result && (
        <span
          className={`text-sm font-medium ${
            result.success ? "text-emerald-600" : "text-red-500"
          }`}
        >
          {result.message}
        </span>
      )}
    </div>
  );
}
