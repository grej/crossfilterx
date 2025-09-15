# Repository Guidelines

## Project Structure & Module Organization
Plan for a top-level `src/` tree for the runtime library, grouped by domain (`src/dimension`, `src/filter`, `src/math`). Keep shared helpers in `src/utils/` and avoid cross-importing between unrelated modules. Store demos under `examples/` and documentation notes in `docs/`. Data snapshots or generated assets should stay out of version control unless they are tiny fixtures checked into `test/fixtures/`.

## Build, Test, and Development Commands
After cloning, install dependencies with `npm install`. Use `npm run build` to emit the bundled library in `dist/` (configure Rollup or Vite for both ESM and UMD outputs). During local development, wire up `npm run dev` to watch the library and refresh example pages.

## Coding Style & Naming Conventions
Stick to modern TypeScript or ES2022 modules with two-space indentation. Prefer small, pure functions and named exports; reserve default exports for the top-level entry point. Use camelCase for functions and variables, PascalCase for types and classes, and kebab-case for filenames (`src/filter/apply-range.ts`). Enforce formatting with Prettier (`npm run lint -- --fix`) and surface static issues with ESLint before opening a pull request.

## Testing Guidelines
Unit and property tests should live in `test/`, mirroring the `src/` layout (`src/dimension/index.ts` → `test/dimension/index.test.ts`). Adopt Vitest or Jest, and run the suite with `npm test`. Add coverage reporting via `npm test -- --coverage` and keep the overall branch coverage at or above 90%. When fixing a regression, add a test that fails prior to the patch so future contributors can see the guardrail.

## Commit & Pull Request Guidelines
The git history is empty, so start with Conventional Commit messages (`feat: add dimension filtering API`). Describe observable changes, note performance impacts, and reference issues in the body. Pull requests should include a concise summary, reproduction steps for bug fixes, and screenshots or benchmark diffs for visual or performance changes. Ensure CI passes (`npm run build`, `npm test`, `npm run lint`) before requesting review.

## Documentation & Examples
Update `docs/` with API signatures and migration notes whenever behavior changes. Keep interactive examples in `examples/` aligned with the latest API so downstream users can copy working snippets. When adding a new capability, pair it with an example that loads a small dataset and demonstrates expected filtering latency.
