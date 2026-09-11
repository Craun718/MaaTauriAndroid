import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals, so Testing Library's automatic cleanup never fires.
// Without this, a file that renders the same component twice (see tests/App.test.tsx)
// leaves the first render in the document and its queries match two elements.
afterEach(() => {
  cleanup();
});
