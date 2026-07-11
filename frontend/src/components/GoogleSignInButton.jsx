import React, { useEffect, useRef, useState } from "react";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";
const GIS_SRC = "https://accounts.google.com/gsi/client";

let gisScriptPromise = null;

function loadGoogleScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("Browser unavailable"));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return gisScriptPromise;
}

export default function GoogleSignInButton({ onCredential, disabled = false }) {
  const buttonRef = useRef(null);
  const callbackRef = useRef(onCredential);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (!buttonRef.current) {
      setUnavailable(true);
      return;
    }
    if (!GOOGLE_CLIENT_ID) return;

    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            if (response?.credential) callbackRef.current(response.credential);
          },
        });
        buttonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          type: "standard",
          shape: "rectangular",
          text: "continue_with",
          width: Math.min(buttonRef.current.offsetWidth || 360, 400),
        });
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!GOOGLE_CLIENT_ID) {
    return (
      <button
        type="button"
        disabled
        className="flex h-[44px] w-full items-center justify-center gap-3 rounded-[6px] border border-[#0F172A]/10 bg-white px-4 text-[14px] font-semibold text-[#0F172A]/45"
        title="Set REACT_APP_GOOGLE_CLIENT_ID to enable Google Sign-In"
        data-testid="google-signin-disabled"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0F172A]/5 text-[12px] font-bold">G</span>
        <span>Continue with Google</span>
      </button>
    );
  }

  if (unavailable) return null;

  return (
    <div className={disabled ? "pointer-events-none opacity-60" : ""} data-testid="google-signin-wrap">
      <div ref={buttonRef} className="flex min-h-[44px] w-full justify-center" />
    </div>
  );
}
