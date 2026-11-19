import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || "অপ্রত্যাশিত ত্রুটি ঘটেছে।",
    };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let displayMessage = this.state.message;
    try {
      const parsed = JSON.parse(this.state.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed?.error) {
        displayMessage = `ডাটাবেস কার্যক্রম (${parsed.operationType || "access"}) সম্পন্ন করা যায়নি: ${parsed.error}`;
      }
    } catch {
      // Plain error string
    }

    return (
      <div className="min-h-screen bg-[#F6F5F1] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-stone-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0 text-red-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-stone-900">
                সাময়িক ত্রুটি দেখা দিয়েছে
              </h1>
              <p className="mt-1 text-xs text-stone-600 leading-relaxed break-words">
                {displayMessage}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="w-full h-10 rounded-lg bg-[#1E3A8A] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:opacity-90 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>পুনরায় চেষ্টা করুন</span>
          </button>
        </div>
      </div>
    );
  }
}
