"use client";

import { useEffect } from "react";

export function ClearSavedState() {
  useEffect(() => {
    try {
      sessionStorage.removeItem("stockwise:v1");
    } catch {}
  }, []);
  return null;
}
