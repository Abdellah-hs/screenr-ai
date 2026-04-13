"use client";

import { useState } from "react";
import { sendScreeningQuestionsBulk } from "@/lib/actions/screening-questions";
import { Button } from "@/components/ui/button";

interface SendScreeningQuestionsBulkButtonProps {
  campaignId: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function SendScreeningQuestionsBulkButton({
  campaignId,
  disabled,
  disabledReason,
}: SendScreeningQuestionsBulkButtonProps) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSend = async () => {
    const confirmed = window.confirm(
      "Send screening questions to every resume-scored candidate in this campaign? Each candidate will get a personal link by email."
    );
    if (!confirmed) return;

    try {
      setSending(true);
      setResult(null);
      const res = await sendScreeningQuestionsBulk(campaignId);
      if (res.sent > 0) {
        setResult({
          success: true,
          message: `Sent to ${res.sent} candidate${res.sent === 1 ? "" : "s"}${
            res.failed > 0 ? ` (${res.failed} failed)` : ""
          }`,
        });
      } else {
        setResult({
          success: false,
          message: res.errors[0] ?? "Nothing was sent",
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to send",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        onClick={handleSend}
        disabled={sending || disabled}
        variant="secondary"
        title={disabled ? disabledReason : undefined}
        className="gap-2 border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:text-sky-900"
      >
        {sending ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-800 border-t-transparent" />
            Sending…
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
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
            Send Screening Questions
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
