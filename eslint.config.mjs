import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  /**
   * `m`, NEVER `motion`.
   *
   * `MotionRoot` mounts `LazyMotion` with `strict`, which throws the moment a
   * `motion` component renders inside it — but ONLY in development. The check
   * in framer-motion's `motion/index.mjs` is wrapped in
   * `process.env.NODE_ENV !== "production"`, so a production build sails
   * straight past it and ships the whole library instead of the tree-shaken
   * slice. Verified by building with a deliberate `motion.div` in place: exit 0.
   *
   * So the runtime guard needs a static one beside it. This is the half that
   * runs in CI, and it is the half that fails a pull request.
   */
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "framer-motion",
              importNames: ["motion"],
              message:
                "Import `m` instead of `motion`. The app mounts LazyMotion with `strict`; a `motion` component throws in dev and silently defeats tree shaking in production. See components/motion/MotionRoot.tsx.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
