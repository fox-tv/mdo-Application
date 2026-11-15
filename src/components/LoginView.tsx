import React, { useState } from "react";
import { AlertCircle, Eye, EyeOff, Lock, User } from "lucide-react";
import { apiRequest, setAuthToken } from "../utils/api";
import { PublicUser } from "../types";

export interface PublicBranding {
  websiteName: string;
  websiteSubtitle: string;
  footerText: string;
  orgNameBn: string;
  logoDataUrl: string;
  primaryColor?: string;
  surfaceBgColor?: string;
  showLoginLogo?: boolean;
  showDefaultAdminHint: boolean;
}

interface LoginViewProps {
  branding: PublicBranding;
  onLoginSuccess: () => Promise<void>;
}

export const LoginView: React.FC<LoginViewProps> = ({
  branding,
  onLoginSuccess,
}) => {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const primaryColor = branding.primaryColor || "#1E3A8A";
  const bgColor = branding.surfaceBgColor || "#F6F5F1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!userId.trim() || !password) {
      setError("অনুগ্রহ করে ইউজার আইডি ও পাসওয়ার্ড লিখুন।");
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: PublicUser }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ userId: userId.trim(), password }),
        }
      );
      setAuthToken(res.token);
      await onLoginSuccess();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "লগইন করতে সমস্যা হয়েছে।"
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col justify-between px-4 py-8"
      style={{ backgroundColor: bgColor }}
    >
      <main className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md bg-white border border-stone-200 rounded-xl p-7 sm:p-8 shadow-xs">
          <div className="text-center pb-6 border-b border-stone-200">
            {branding.showLoginLogo !== false && branding.logoDataUrl && (
              <div className="flex justify-center mb-3">
                <img
                  src={branding.logoDataUrl}
                  alt={branding.orgNameBn}
                  referrerPolicy="no-referrer"
                  className="h-16 w-16 object-contain"
                />
              </div>
            )}
            <h1
              className="text-2xl font-bold font-letter-serif"
              style={{ color: primaryColor }}
            >
              {branding.websiteName}
            </h1>
            <p className="mt-1 text-xs font-medium text-stone-600">
              {branding.orgNameBn}
            </p>
            <p className="mt-0.5 text-xs text-stone-500">
              {branding.websiteSubtitle}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="login-userid"
                className="block text-xs font-medium text-stone-700 mb-1.5"
              >
                ইউজার আইডি
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-userid"
                  name="userId"
                  type="text"
                  autoComplete="username"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="আপনার ইউজার আইডি লিখুন"
                  className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-medium text-stone-700 mb-1.5"
              >
                পাসওয়ার্ড
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="পাসওয়ার্ড লিখুন"
                  className="w-full h-11 pl-10 pr-10 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  aria-label={showPassword ? "পাসওয়ার্ড লুকান" : "পাসওয়ার্ড দেখুন"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              style={{ backgroundColor: primaryColor }}
              className="w-full h-11 rounded-lg text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity cursor-pointer"
            >
              {isLoading ? "যাচাই করা হচ্ছে..." : "প্রবেশ করুন"}
            </button>
          </form>

          {branding.showDefaultAdminHint && (
            <div className="mt-5 pt-4 border-t border-stone-200 text-xs text-stone-600 bg-stone-50 rounded-lg p-3">
              <p className="font-semibold text-stone-800 mb-1">
                প্রথমবার অ্যাডমিন লগইন তথ্য:
              </p>
              <p className="tabular-nums">
                ইউজার আইডি: <span className="font-mono-tabular font-semibold">admin</span>
                {" · "}
                পাসওয়ার্ড: <span className="font-mono-tabular font-semibold">mdo@2026</span>
              </p>
              <p className="mt-1 text-[11px] text-stone-500">
                লগইন করে অ্যাডমিন প্যানেল থেকে পাসওয়ার্ড পরিবর্তন ও নতুন ইউজার তৈরি করতে পারবেন।
              </p>
            </div>
          )}
        </div>
      </main>

      <footer className="text-center text-xs text-stone-500 mt-6">
        {branding.footerText}
      </footer>
    </div>
  );
};
